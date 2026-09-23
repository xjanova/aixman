import { composeMusicTags } from '@/lib/music-style';
import type { CatalogEntry, CatalogJobParams } from './catalog';
import {
  bindParameters,
  convertUiWorkflowToApi,
  describeUnmatched,
  injectNodes,
  pruneByClass,
  pruneUnreachable,
  type ParameterBinding,
  type UiWorkflow,
} from './comfy-convert';
import type { ComfyGraph, ComfyObjectInfo } from './comfy-validate';
import { resolveTunables } from './tunables';
import type { EffectiveWorkflow } from './workflow-overrides';
import { frameLengthFor } from './workflows/minimax-h3';

/**
 * Turn a catalogue entry plus one job into the graph ComfyUI receives.
 *
 * Pure: no network, no database. The worker client calls it with the live
 * `/object_info` of the machine about to render; /admin/workflows calls it with
 * a stored copy of that schema to show an admin, before anything is rented,
 * exactly what a change to a workflow will send.
 */

export interface BuiltGraph {
  graph: ComfyGraph;
  /** Things an admin should know about, none of them fatal. */
  warnings: string[];
  /** Built from an admin's custom graph rather than the catalogue template. */
  custom: boolean;
}

/** What a job put in the worker's input dir, by filename. */
export interface StagedInputs {
  first?: string;
  last?: string;
  audio?: string;
}

/**
 * Substitute `{{name}}` placeholders throughout a ComfyUI graph.
 *
 * A string that is *exactly* a placeholder adopts the value's real type, so
 * `"width": "{{width}}"` becomes the number 768 rather than the string "768" —
 * ComfyUI rejects string-typed numeric inputs.
 */
export function applyWorkflowVars(graph: unknown, vars: Record<string, unknown>): unknown {
  const exact = /^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/;

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const match = node.match(exact);
      if (match) {
        return Object.prototype.hasOwnProperty.call(vars, match[1]) ? vars[match[1]] : node;
      }
      return node.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, key: string) =>
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole
      );
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };

  return walk(graph);
}

/** The placeholders a custom graph may use, with what each one holds. Shown on the admin page. */
export const CUSTOM_GRAPH_PLACEHOLDERS: { name: string; description: string }[] = [
  { name: 'prompt', description: 'พรอมต์ของลูกค้า (รวมข้อความเติมหน้า/หลังของแอดมินแล้ว)' },
  { name: 'negative_prompt', description: 'negative prompt ของลูกค้า (ว่างได้)' },
  { name: 'width', description: 'ความกว้างที่สั่ง (ตัวเลข)' },
  { name: 'height', description: 'ความสูงที่สั่ง (ตัวเลข)' },
  { name: 'seed', description: 'seed ของงาน (ตัวเลข)' },
  { name: 'steps', description: 'สเต็ปที่ผู้สั่งส่งมา (ถ้ามี) ไม่งั้นว่าง' },
  { name: 'duration', description: 'ความยาวคลิป/เพลง เป็นวินาที' },
  { name: 'fps', description: 'เฟรมต่อวินาที' },
  { name: 'length', description: 'จำนวนเฟรมแบบ 17k+5 สำหรับ H3 (คำนวณจาก duration/fps)' },
  { name: 'first_frame', description: 'ชื่อไฟล์ภาพแรกในโฟลเดอร์ input ของเครื่อง (ใส่ใน LoadImage)' },
  { name: 'last_frame', description: 'ชื่อไฟล์ภาพสุดท้ายในโฟลเดอร์ input' },
  { name: 'input_audio', description: 'ชื่อไฟล์เสียงที่อัปโหลด (ใส่ใน LoadAudio)' },
  { name: 'lyrics', description: 'เนื้อเพลง (ว่าง = บรรเลง)' },
  { name: 'music_tags', description: 'แท็กสไตล์เพลงที่ประกอบจากตัวเลือกของลูกค้า' },
  { name: 'quality', description: 'โหมดคุณภาพที่ลูกค้าเลือก (id)' },
  { name: 'resolution', description: 'preset ความละเอียดที่ลูกค้าเลือก (id)' },
];

/** The customer's prompt with the admin's prefix and suffix around it. */
export function shapePrompt(prompt: string, workflow: Pick<EffectiveWorkflow, 'promptPrefix' | 'promptSuffix'> | null): string {
  const pre = workflow?.promptPrefix?.trim() ?? '';
  const post = workflow?.promptSuffix?.trim() ?? '';
  const body = prompt.trim();
  const join = (a: string, b: string) => (!a ? b : !b ? a : /[,.;:\s]$/.test(a) || /^[,.;:]/.test(b) ? `${a} ${b}` : `${a}, ${b}`);
  return join(join(pre, body), post);
}

/**
 * Build the graph for one job.
 *
 * With a custom graph the admin's API-format JSON is used as-is, placeholders
 * filled. Otherwise the vendored template is converted against `objectInfo`,
 * the entry injects and binds the job, the admin's node overrides land on top,
 * and whatever no output depends on is pruned. A catalogue binding that misses
 * throws — it would otherwise render the template's demo prompt and charge for
 * it. An admin override that misses only warns: it must never cost a customer
 * their render.
 */
export function buildJobGraph(
  entry: CatalogEntry,
  objectInfo: ComfyObjectInfo,
  job: Omit<CatalogJobParams, 'tuning'>,
  workflow: EffectiveWorkflow | null,
  staged: StagedInputs = {}
): BuiltGraph {
  const warnings: string[] = [];
  const prompt = shapePrompt(job.prompt, workflow);

  if (workflow?.customGraph) {
    const graph = applyWorkflowVars(workflow.customGraph, {
      prompt,
      negative_prompt: job.negativePrompt ?? '',
      width: job.width,
      height: job.height,
      seed: job.seed,
      steps: job.steps ?? '',
      duration: job.durationSeconds,
      fps: job.fps,
      length: frameLengthFor(job.durationSeconds, job.fps),
      first_frame: staged.first ?? '',
      last_frame: staged.last ?? '',
      input_audio: staged.audio ?? '',
      lyrics: job.music?.instrumental ? '' : (job.lyrics ?? ''),
      music_tags: composeMusicTags(job.prompt, job.music),
      quality: job.quality ?? '',
      resolution: job.resolution ?? '',
    }) as ComfyGraph;
    const leftover = new Set<string>();
    JSON.stringify(graph, (_k, v) => {
      if (typeof v === 'string') for (const m of v.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) leftover.add(m[1]);
      return v;
    });
    if (leftover.size > 0) warnings.push(`กราฟกำหนดเองมีตัวแปรที่ระบบไม่รู้จัก: ${[...leftover].join(', ')}`);
    return { graph, warnings, custom: true };
  }

  const params: CatalogJobParams = {
    ...job,
    prompt,
    tuning: workflow?.tuning ?? resolveTunables(entry.tunables, null),
  };

  let graph = convertUiWorkflowToApi(entry.template, objectInfo);
  if (entry.inject) graph = injectNodes(graph, entry.inject(params));
  // Bind before pruning: pruning cascades through dependants, so redirecting a
  // path first is what stops the cascade from eating it. The schema lets
  // `connect` bindings wire sockets the template left open (H3's frames).
  const bound = bindParameters(graph, entry.bind(params), objectInfo);
  if (bound.unmatched.length > 0) {
    throw new Error(
      `Workflow for "${entry.key}" does not accept: ${describeUnmatched(bound.unmatched)}. ` +
        'The template or the node signatures have changed — the catalogue binding needs updating. ' +
        'Refusing to render with the template default values.'
    );
  }
  graph = bound.graph;

  // The admin's own node inputs, last so they win. Bound strictly only to
  // learn which ones missed; a miss is reported, never thrown.
  const overrides: ParameterBinding[] = (workflow?.nodeInputs ?? []).map((o) => ({
    nodeId: o.nodeId,
    input: o.input,
    value: o.value,
    connect: true,
  }));
  if (overrides.length > 0) {
    const tuned = bindParameters(graph, overrides, objectInfo);
    for (const miss of tuned.unmatched) {
      warnings.push(`ค่าที่แอดมินตั้งไม่ถูกใช้: ${miss.nodeId}.${miss.input} (ไม่มีโหนดหรือ input นี้ในกราฟ)`);
    }
    graph = tuned.graph;
  }

  if (entry.prune?.length) graph = pruneByClass(graph, entry.prune);
  // Helpers whose output a binding replaced are now dead weight that can still
  // fail validation — drop everything no output depends on.
  graph = pruneUnreachable(graph, objectInfo);
  return { graph, warnings, custom: false };
}

// ---------------------------------------------------------------------------
// A worker's schema, kept small enough to store
// ---------------------------------------------------------------------------

/** Combo lists longer than this are cut: a community node may list hundreds of files. */
const MAX_COMBO_CHOICES = 200;

/** One node class's schema, with oversized file lists trimmed. */
function trimSpec(spec: ComfyObjectInfo[string]): ComfyObjectInfo[string] {
  const trimGroup = (group?: Record<string, unknown>) => {
    if (!group) return group;
    const out: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(group)) {
      if (Array.isArray(def) && Array.isArray(def[0]) && def[0].length > MAX_COMBO_CHOICES) {
        out[name] = [def[0].slice(0, MAX_COMBO_CHOICES), ...def.slice(1)];
      } else {
        out[name] = def;
      }
    }
    return out;
  };
  return {
    ...spec,
    input: spec.input ? { required: trimGroup(spec.input.required), optional: trimGroup(spec.input.optional) } : spec.input,
  };
}

/** The part of a worker's `/object_info` that `classes` need. */
export function schemaSubset(info: ComfyObjectInfo, classes: Iterable<string>): ComfyObjectInfo {
  const out: ComfyObjectInfo = {};
  for (const cls of classes) {
    if (info[cls]) out[cls] = trimSpec(info[cls]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading a UI template without ComfyUI — for the admin page
// ---------------------------------------------------------------------------

/** Editor-only node types: they never reach the server. */
const EDITOR_ONLY = new Set(['Note', 'MarkdownNote', 'PrimitiveNode', 'Reroute']);

export interface TemplateNode {
  /** The id the node gets once converted (`105_104` for node 104 in subgraph instance 105). */
  id: string;
  type: string;
  title: string | null;
  /** 0 normal · 2 muted · 4 bypassed. */
  mode: number;
  widgets: unknown[];
  editorOnly: boolean;
  /** Name of the subgraph it came from, when it came from one. */
  group: string | null;
}

interface RawNode {
  id: number;
  type: string;
  title?: string;
  mode?: number;
  widgets_values?: unknown[];
}

/**
 * Every node of a UI template with the id the converter will give it,
 * subgraphs expanded. For display only: it does not resolve links or widget
 * names — that takes a live schema (`convertUiWorkflowToApi`).
 */
export function listTemplateNodes(workflow: UiWorkflow): TemplateNode[] {
  const subgraphs = new Map<string, { name?: string; nodes?: RawNode[] }>();
  for (const sg of (workflow.definitions?.subgraphs ?? []) as { id: string; name?: string; nodes?: RawNode[] }[]) {
    subgraphs.set(sg.id, sg);
  }
  const out: TemplateNode[] = [];
  const walk = (nodes: RawNode[], prefix: string, group: string | null, depth: number) => {
    for (const n of nodes) {
      const id = `${prefix}${n.id}`;
      const sub = subgraphs.get(n.type);
      if (sub && depth < 6) {
        walk(sub.nodes ?? [], `${id}_`, sub.name ?? n.type, depth + 1);
        continue;
      }
      out.push({
        id,
        type: n.type,
        title: typeof n.title === 'string' ? n.title : null,
        mode: typeof n.mode === 'number' ? n.mode : 0,
        widgets: Array.isArray(n.widgets_values) ? n.widgets_values : [],
        editorOnly: EDITOR_ONLY.has(n.type),
        group,
      });
    }
  };
  walk((workflow.nodes ?? []) as RawNode[], '', null, 0);
  return out;
}

/** The node classes a template, plus what an entry injects, will ask a worker for. */
export function templateClasses(entry: CatalogEntry, sample?: CatalogJobParams): string[] {
  const classes = new Set<string>();
  for (const n of listTemplateNodes(entry.template)) {
    if (!n.editorOnly && n.mode !== 2) classes.add(n.type);
  }
  if (entry.inject && sample) {
    for (const node of Object.values(entry.inject(sample))) classes.add(node.class_type);
  }
  return [...classes].sort();
}

/**
 * A job to describe an entry with: every input a customer can send, filled
 * with a value that reads as what it is. The admin page binds this to show
 * which node input receives which part of an order.
 */
export function sampleJob(entry: CatalogEntry, overrides: Partial<CatalogJobParams> = {}): CatalogJobParams {
  const video = entry.outputKind === 'video';
  const audio = entry.outputKind === 'audio';
  return {
    prompt: video
      ? 'A lone lighthouse on a cliff at dusk, waves crashing below, the camera slowly pushes in.'
      : audio
        ? 'thai pop, bright female vocal, acoustic guitar, upbeat'
        : 'A cozy Bangkok street café at golden hour, neon sign reading "XDREAMER", cinematic lighting',
    negativePrompt: '',
    width: video ? 1344 : 1024,
    height: video ? 768 : 1024,
    durationSeconds: video ? 5 : audio ? 120 : 0,
    fps: 24,
    seed: 123456789,
    lyrics: audio ? '[Verse]\nแสงไฟยามค่ำ\n\n[Chorus]\nฝันไปด้วยกัน' : undefined,
    audioFilename: entry.needs?.audio ? 'aixman-source-sample.mp3' : undefined,
    quality: entry.qualityModes?.find((m) => m.isDefault)?.id,
    tuning: resolveTunables(entry.tunables, null),
    ...overrides,
  };
}
