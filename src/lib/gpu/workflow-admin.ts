import prisma from '@/lib/db';
import { MODEL_CATALOG, downloadGb, type CatalogEntry, type CatalogJobParams } from './catalog';
import { validateGraph, type ComfyGraph, type ComfyObjectInfo } from './comfy-validate';
import { COMFYUI_REF } from './provision';
import { alternativeTunables, resolveTunables, type TunableValue, type WorkflowTunable } from './tunables';
import { buildJobGraph, listTemplateNodes, sampleJob, templateClasses, type TemplateNode } from './workflow-build';
import {
  effectiveQualityModes,
  effectiveWorkflow,
  getAllStoredWorkflows,
  getLastGraph,
  getSchemaSnapshot,
  getStoredWorkflow,
  getWorkflowHistory,
  type LastGraph,
  type SchemaSnapshot,
  type StoredWorkflow,
  type WorkflowOverride,
} from './workflow-overrides';
import baseline from './workflows/schema/baseline-v0.36.0.json';

/**
 * The read side of /admin/workflows: what each catalogue workflow is, what it
 * binds, how it has been doing, and what a change to it would send.
 *
 * Server-only (Prisma). The route handlers stay thin and the page gets plain
 * JSON it can render without knowing how a template converts.
 */

// ---------------------------------------------------------------------------
// Schema — a live worker's copy when there is one, the vendored baseline under it
// ---------------------------------------------------------------------------

const BASELINE = baseline as { comfyVersion: string; capturedAt: string; classes: ComfyObjectInfo };

export interface SchemaInfo {
  source: 'worker' | 'baseline';
  capturedAt: string;
  comfyVersion: string;
  gpuModel: string | null;
  classCount: number;
}

/**
 * The schema a dry run converts against. The baseline was dumped from a CPU
 * ComfyUI at the pinned version with every catalogue weight present as a stub,
 * so its loader lists are exactly what a rented worker downloads. A live
 * worker's copy, when one has been captured, is laid over it: it is what
 * production actually runs.
 */
async function schemaFor(modelKey: string): Promise<{ classes: ComfyObjectInfo; info: SchemaInfo }> {
  const live: SchemaSnapshot | null = await getSchemaSnapshot(modelKey).catch(() => null);
  const classes: ComfyObjectInfo = { ...BASELINE.classes, ...(live?.classes ?? {}) };
  return {
    classes,
    info: {
      source: live ? 'worker' : 'baseline',
      capturedAt: live?.capturedAt ?? BASELINE.capturedAt,
      comfyVersion: live?.comfyVersion ?? BASELINE.comfyVersion,
      gpuModel: live?.gpuModel ?? null,
      classCount: Object.keys(classes).length,
    },
  };
}

/** A copy of `schema` in which the preview's stand-in uploads exist on "disk". */
function withStagedFiles(schema: ComfyObjectInfo, files: { image: string[]; audio: string[] }): ComfyObjectInfo {
  const out: ComfyObjectInfo = { ...schema };
  const add = (cls: string, input: string, names: string[]) => {
    const spec = out[cls];
    const def = spec?.input?.required?.[input];
    if (!spec || !Array.isArray(def) || names.length === 0) return;
    let next: unknown[];
    if (Array.isArray(def[0])) {
      next = [[...(def[0] as unknown[]), ...names], ...def.slice(1)];
    } else if (def[0] === 'COMBO') {
      const opts = (def[1] ?? {}) as { options?: unknown[] };
      next = ['COMBO', { ...opts, options: [...(opts.options ?? []), ...names] }];
    } else {
      return;
    }
    out[cls] = { ...spec, input: { ...spec.input, required: { ...spec.input?.required, [input]: next } } };
  };
  add('LoadImage', 'image', files.image);
  add('LoadAudio', 'audio', files.audio);
  return out;
}

function checkpointsIn(schema: ComfyObjectInfo): string[] {
  const slot = schema?.CheckpointLoaderSimple?.input?.required?.ckpt_name;
  const choices = Array.isArray(slot) ? slot[0] : undefined;
  return Array.isArray(choices) ? choices.filter((c): c is string => typeof c === 'string') : [];
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

export interface PreviewInput {
  prompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  quality?: string;
  resolution?: string;
  firstFrame?: boolean;
  lastFrame?: boolean;
}

export interface PreviewResult {
  ok: boolean;
  graph: ComfyGraph | null;
  warnings: string[];
  error: string | null;
  custom: boolean;
  schema: SchemaInfo;
  /** The job the graph was built for, so the page can say so. */
  job: Pick<CatalogJobParams, 'prompt' | 'width' | 'height' | 'durationSeconds' | 'quality' | 'resolution'> & {
    firstFrame: boolean;
    lastFrame: boolean;
  };
}

const PREVIEW_FIRST = 'aixman-first-preview.png';
const PREVIEW_LAST = 'aixman-last-preview.png';
const PREVIEW_AUDIO = 'aixman-source-preview.mp3';

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Build and validate exactly what a job would send, without renting anything.
 * `override` is what the admin is looking at — saved or not — applied as it
 * would be to an admin's own order.
 */
export async function previewWorkflow(
  entry: CatalogEntry,
  override: WorkflowOverride | null,
  input: PreviewInput = {}
): Promise<PreviewResult> {
  const { classes, info } = await schemaFor(entry.key);
  const base = sampleJob(entry);
  const firstFrame = input.firstFrame === true && entry.video?.firstFrame === true;
  const lastFrame = firstFrame && input.lastFrame === true && entry.video?.lastFrame === true;
  const quality = entry.qualityModes?.some((m) => m.id === input.quality) ? input.quality : base.quality;
  const resolution = entry.video?.resolutions?.some((r) => r.id === input.resolution) ? input.resolution : undefined;

  const job: Omit<CatalogJobParams, 'tuning'> = {
    ...base,
    prompt: typeof input.prompt === 'string' && input.prompt.trim() ? input.prompt.slice(0, 10_000) : base.prompt,
    negativePrompt: typeof input.negativePrompt === 'string' ? input.negativePrompt.slice(0, 4000) : base.negativePrompt,
    width: Math.round(num(input.width, base.width, 64, 4096)),
    height: Math.round(num(input.height, base.height, 64, 4096)),
    durationSeconds: num(input.durationSeconds, base.durationSeconds, 0, entry.limits?.maxDuration ?? 600),
    quality,
    resolution,
    imageFilename: firstFrame ? PREVIEW_FIRST : undefined,
    lastImageFilename: lastFrame ? PREVIEW_LAST : undefined,
    audioFilename: entry.needs?.audio ? PREVIEW_AUDIO : undefined,
    checkpoints: checkpointsIn(classes),
  };
  delete (job as Partial<CatalogJobParams>).tuning;

  const stored: StoredWorkflow | null = override
    ? { override, version: 0, updatedAt: new Date().toISOString(), updatedBy: null, note: null }
    : null;
  const workflow = effectiveWorkflow(entry, stored, true);
  const schema = withStagedFiles(classes, {
    image: [PREVIEW_FIRST, PREVIEW_LAST],
    audio: [PREVIEW_AUDIO],
  });

  const shown = {
    prompt: job.prompt,
    width: job.width,
    height: job.height,
    durationSeconds: job.durationSeconds,
    quality: job.quality,
    resolution: job.resolution,
    firstFrame,
    lastFrame,
  };

  try {
    const built = buildJobGraph(entry, schema, job, workflow, {
      first: job.imageFilename,
      last: job.lastImageFilename,
      audio: job.audioFilename,
    });
    const validated = validateGraph(built.graph, schema);
    return {
      ok: true,
      graph: validated.graph,
      warnings: [...built.warnings, ...validated.warnings],
      error: null,
      custom: built.custom,
      schema: info,
      job: shown,
    };
  } catch (error) {
    return { ok: false, graph: null, warnings: [], error: (error as Error).message, custom: !!workflow.customGraph, schema: info, job: shown };
  }
}

// ---------------------------------------------------------------------------
// What the catalogue binds, and which of it an order or a tunable changes
// ---------------------------------------------------------------------------

export type BindingSource = 'job' | 'tunable' | 'fixed';

export interface BindingRow {
  nodeId: string;
  input: string;
  /** The value for the default sample order, shortened for display. */
  value: unknown;
  source: BindingSource;
  optional: boolean;
  /** A wire to another node rather than a literal. */
  link: boolean;
}

function shorten(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 240) return `${value.slice(0, 237)}…`;
  return value;
}

/**
 * Every node input the entry writes for a job, labelled by where the value
 * comes from: the customer's order, an admin tunable, or the catalogue itself.
 * Worked out by binding three sample orders and seeing what moves.
 */
export function describeBindings(entry: CatalogEntry): BindingRow[] {
  const a = sampleJob(entry);
  const b = sampleJob(entry, {
    prompt: `${a.prompt} — another take`,
    negativePrompt: 'another negative',
    seed: 987654321,
    width: a.width === 1024 ? 1216 : 768,
    height: a.height === 1024 ? 832 : 1344,
    durationSeconds: a.durationSeconds > 0 ? Math.min(a.durationSeconds * 2, entry.limits?.maxDuration ?? a.durationSeconds * 2) : 0,
    lyrics: a.lyrics ? `${a.lyrics}\nอีกท่อน` : a.lyrics,
  });
  const t = sampleJob(entry, { tuning: alternativeTunables(entry.tunables) });

  const keyed = (rows: ReturnType<CatalogEntry['bind']>) => {
    const m = new Map<string, { value: unknown; optional: boolean }>();
    for (const r of rows) {
      const input = Array.isArray(r.input) ? r.input.join('|') : r.input;
      m.set(`${r.nodeId ?? r.nodeType}\u0000${input}`, { value: r.value, optional: r.optional === true });
    }
    return m;
  };
  const ba = keyed(entry.bind(a));
  const bb = keyed(entry.bind(b));
  const bt = keyed(entry.bind(t));
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

  const rows: BindingRow[] = [];
  for (const [key, { value, optional }] of ba) {
    const [nodeId, input] = key.split('\u0000');
    const source: BindingSource = !bb.has(key) || !same(bb.get(key)?.value, value)
      ? 'job'
      : !bt.has(key) || !same(bt.get(key)?.value, value)
        ? 'tunable'
        : 'fixed';
    const link = Array.isArray(value) && value.length === 2 && typeof value[1] === 'number';
    rows.push({ nodeId, input, value: shorten(value), source, optional, link });
  }
  return rows;
}

/** The nodes an entry adds to its template for the default order. */
export function describeInjected(entry: CatalogEntry): { id: string; classType: string; inputs: Record<string, unknown> }[] {
  if (!entry.inject) return [];
  return Object.entries(entry.inject(sampleJob(entry))).map(([id, n]) => ({
    id,
    classType: n.class_type,
    inputs: Object.fromEntries(Object.entries(n.inputs).map(([k, v]) => [k, shorten(v)])),
  }));
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface WorkflowStats {
  completed30d: number;
  failed30d: number;
  running: number;
  queued: number;
  avgGpuSeconds: number | null;
  lastRunAt: string | null;
  lastError: string | null;
}

export interface WorkflowModelRow {
  id: number;
  name: string;
  isActive: boolean;
  readiness: string;
  readinessNote: string | null;
  failureStreak: number;
  creditsPerUnit: number;
}

export interface WorkflowSummary {
  key: string;
  name: string;
  kind: CatalogEntry['kind'];
  outputKind: CatalogEntry['outputKind'];
  description: string;
  source: CatalogEntry['source'] | null;
  nodeCount: number;
  classes: string[];
  weightsGb: number;
  minVramGb: number;
  diskGb: number;
  minArch: string | null;
  customNodes: { repo: string; ref?: string }[];
  pricing: CatalogEntry['pricing'];
  qualityModes: ReturnType<typeof effectiveQualityModes>;
  tunableCount: number;
  models: WorkflowModelRow[];
  override: {
    version: number;
    updatedAt: string;
    updatedBy: string | null;
    note: string | null;
    enabled: boolean;
    rollout: 'admin' | 'all';
    tuned: number;
    nodeInputs: number;
    prompt: boolean;
    customGraph: boolean;
  } | null;
  stats: WorkflowStats;
  lastGraphAt: string | null;
  comfyRef: string;
}

function overrideSummary(stored: StoredWorkflow | null): WorkflowSummary['override'] {
  if (!stored) return null;
  const o = stored.override;
  return {
    version: stored.version,
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedBy,
    note: stored.note,
    enabled: o.enabled,
    rollout: o.rollout,
    tuned: Object.keys(o.tuning ?? {}).length,
    nodeInputs: o.nodeInputs?.length ?? 0,
    prompt: !!(o.promptPrefix || o.promptSuffix),
    customGraph: !!o.customGraph?.enabled,
  };
}

async function statsFor(keys: string[]): Promise<Map<string, WorkflowStats>> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [groups, live, lastFailures, lastRuns] = await Promise.all([
    prisma.aiGpuJob.groupBy({
      by: ['modelKey', 'status'],
      where: { modelKey: { in: keys }, queuedAt: { gte: since }, status: { in: ['completed', 'failed'] } },
      _count: { _all: true },
      _avg: { gpuSeconds: true },
    }),
    prisma.aiGpuJob.groupBy({
      by: ['modelKey', 'status'],
      where: { modelKey: { in: keys }, status: { in: ['queued', 'assigned', 'running'] } },
      _count: { _all: true },
    }),
    Promise.all(
      keys.map((k) =>
        prisma.aiGpuJob.findFirst({
          where: { modelKey: k, status: 'failed' },
          orderBy: { id: 'desc' },
          select: { errorMessage: true },
        })
      )
    ),
    Promise.all(
      keys.map((k) =>
        prisma.aiGpuJob.findFirst({
          where: { modelKey: k, status: 'completed' },
          orderBy: { id: 'desc' },
          select: { completedAt: true },
        })
      )
    ),
  ]);

  const out = new Map<string, WorkflowStats>();
  keys.forEach((k, i) => {
    const done = groups.find((g) => g.modelKey === k && g.status === 'completed');
    const failed = groups.find((g) => g.modelKey === k && g.status === 'failed');
    const count = (status: string[]) =>
      live.filter((g) => g.modelKey === k && status.includes(g.status)).reduce((s, g) => s + g._count._all, 0);
    out.set(k, {
      completed30d: done?._count._all ?? 0,
      failed30d: failed?._count._all ?? 0,
      running: count(['assigned', 'running']),
      queued: count(['queued']),
      avgGpuSeconds: done?._avg.gpuSeconds != null ? Math.round(done._avg.gpuSeconds) : null,
      lastRunAt: lastRuns[i]?.completedAt?.toISOString() ?? null,
      lastError: lastFailures[i]?.errorMessage?.slice(0, 300) ?? null,
    });
  });
  return out;
}

function summarize(
  entry: CatalogEntry,
  stored: StoredWorkflow | null,
  models: WorkflowModelRow[],
  stats: WorkflowStats | undefined,
  lastGraphAt: string | null
): WorkflowSummary {
  const nodes = listTemplateNodes(entry.template).filter((n) => !n.editorOnly);
  return {
    key: entry.key,
    name: entry.name,
    kind: entry.kind,
    outputKind: entry.outputKind,
    description: entry.description,
    source: entry.source ?? null,
    nodeCount: entry.template.nodes?.length ? nodes.length : Object.keys(entry.inject?.(sampleJob(entry)) ?? {}).length,
    classes: templateClasses(entry, sampleJob(entry)),
    weightsGb: downloadGb(entry),
    minVramGb: Math.round((entry.hardware.minVramMb / 1024) * 10) / 10,
    diskGb: entry.hardware.diskGb,
    minArch: entry.hardware.minArch ?? null,
    customNodes: entry.customNodes ?? [],
    pricing: entry.pricing,
    qualityModes: effectiveQualityModes(entry, stored),
    tunableCount: entry.tunables?.length ?? 0,
    models,
    override: overrideSummary(stored),
    stats: stats ?? {
      completed30d: 0,
      failed30d: 0,
      running: 0,
      queued: 0,
      avgGpuSeconds: null,
      lastRunAt: null,
      lastError: null,
    },
    lastGraphAt,
    comfyRef: COMFYUI_REF,
  };
}

async function modelRows(keys: string[]): Promise<Map<string, WorkflowModelRow[]>> {
  const rows = await prisma.aiModel.findMany({
    where: { modelId: { in: keys } },
    select: {
      id: true,
      modelId: true,
      name: true,
      isActive: true,
      readiness: true,
      readinessNote: true,
      failureStreak: true,
      creditsPerUnit: true,
    },
    orderBy: { id: 'asc' },
  });
  const out = new Map<string, WorkflowModelRow[]>();
  for (const r of rows) {
    const list = out.get(r.modelId) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      isActive: r.isActive,
      readiness: r.readiness,
      readinessNote: r.readinessNote,
      failureStreak: r.failureStreak,
      creditsPerUnit: r.creditsPerUnit,
    });
    out.set(r.modelId, list);
  }
  return out;
}

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  const keys = MODEL_CATALOG.map((e) => e.key);
  const [stored, models, stats, lastGraphs] = await Promise.all([
    getAllStoredWorkflows(),
    modelRows(keys),
    statsFor(keys),
    Promise.all(keys.map((k) => getLastGraph(k).catch(() => null))),
  ]);
  return MODEL_CATALOG.map((entry, i) =>
    summarize(entry, stored.get(entry.key) ?? null, models.get(entry.key) ?? [], stats.get(entry.key), lastGraphs[i]?.capturedAt ?? null)
  );
}

export interface TunableRow extends WorkflowTunable {
  /** What renders now, for jobs this override applies to. */
  value: TunableValue;
  overridden: boolean;
}

export interface WorkflowDetail {
  summary: WorkflowSummary;
  tunables: TunableRow[];
  stored: StoredWorkflow | null;
  history: StoredWorkflow[];
  templateNodes: TemplateNode[];
  bindings: BindingRow[];
  injected: ReturnType<typeof describeInjected>;
  downloads: CatalogEntry['downloads'];
  lastGraph: LastGraph | null;
  preview: PreviewResult;
  video: CatalogEntry['video'] | null;
  needsAudio: boolean;
}

export async function workflowDetail(entry: CatalogEntry): Promise<WorkflowDetail> {
  const [stored, history, models, stats, lastGraph] = await Promise.all([
    getStoredWorkflow(entry.key),
    getWorkflowHistory(entry.key),
    modelRows([entry.key]),
    statsFor([entry.key]),
    getLastGraph(entry.key).catch(() => null),
  ]);
  const values = resolveTunables(entry.tunables, stored?.override.tuning);
  const preview = await previewWorkflow(entry, stored?.override ?? null);
  return {
    summary: summarize(entry, stored, models.get(entry.key) ?? [], stats.get(entry.key), lastGraph?.capturedAt ?? null),
    tunables: (entry.tunables ?? []).map((def) => ({
      ...def,
      value: values[def.id],
      overridden: stored?.override.tuning?.[def.id] !== undefined,
    })),
    stored,
    history,
    templateNodes: listTemplateNodes(entry.template),
    bindings: describeBindings(entry),
    injected: describeInjected(entry),
    downloads: entry.downloads,
    lastGraph,
    preview,
    video: entry.video ?? null,
    needsAudio: entry.needs?.audio === true,
  };
}
