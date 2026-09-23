import prisma, { SLOW_DB_TX } from '@/lib/db';
import type { Prisma } from '@/generated/prisma/client';
import type { CatalogEntry } from './catalog';
import type { ComfyGraph, ComfyObjectInfo } from './comfy-validate';
import { coerceTunable, resolveTunables, tunableError, type QualityMode, type TunableValue } from './tunables';

/**
 * What an admin changed about a catalogue workflow, from /admin/workflows.
 *
 * Stored in `ai_settings` (group `workflows`) rather than a table of its own:
 * the deploy applies SQL migrations best-effort, and a missing table would take
 * every render down with it, while a missing settings row only means "the
 * catalogue as shipped". One row per model holds the live override; another
 * keeps the versions it replaced, so any save can be taken back.
 *
 * Rollout is the safety catch. A new override starts as `admin`: only jobs an
 * admin ordered render with it, so the first bad value costs one test render
 * instead of three customers and a demoted model (model-readiness.ts). Moving
 * it to `all` is a separate, deliberate step.
 */

export const WORKFLOW_SETTING_GROUP = 'workflows';
export const OVERRIDE_PREFIX = 'wf_override_';
export const HISTORY_PREFIX = 'wf_history_';
export const SCHEMA_PREFIX = 'wf_schema_';
export const LAST_GRAPH_PREFIX = 'wf_last_graph_';

/** Versions kept for rollback, newest first. */
const HISTORY_LIMIT = 20;
const MAX_NODE_INPUTS = 60;
const MAX_PROMPT_AFFIX = 2000;
const MAX_CUSTOM_GRAPH_BYTES = 400_000;
const MAX_CUSTOM_GRAPH_NODES = 400;
const MAX_VALUE_BYTES = 20_000;

/** Write one input of one node, after the catalogue's own bindings (so it wins). */
export interface NodeInputOverride {
  nodeId: string;
  input: string;
  value: unknown;
  note?: string;
}

/** An API-format graph that replaces the catalogue's entirely, with `{{placeholders}}`. */
export interface CustomGraph {
  enabled: boolean;
  graph: ComfyGraph;
}

export interface QualityAdjust {
  creditsMultiplier?: number;
  /** true: every customer sees it · false: admins only · absent: the catalogue's own setting. */
  public?: boolean;
}

export interface WorkflowOverride {
  /** Off keeps everything saved but renders (and prices) the catalogue as shipped. */
  enabled: boolean;
  /** Who renders with the changes below: only admins' own orders, or everyone. */
  rollout: 'admin' | 'all';
  /** Only the tunables that differ from their defaults. */
  tuning?: Record<string, TunableValue>;
  nodeInputs?: NodeInputOverride[];
  promptPrefix?: string;
  promptSuffix?: string;
  /**
   * Price and visibility of quality modes. Not gated by `rollout`: a mode's
   * own `public` flag is already that gate, and a price must be the same for
   * everyone.
   */
  quality?: Record<string, QualityAdjust>;
  customGraph?: CustomGraph | null;
}

export interface StoredWorkflow {
  override: WorkflowOverride;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
  note: string | null;
}

export const EMPTY_OVERRIDE: WorkflowOverride = { enabled: true, rollout: 'admin' };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const NODE_ID = /^[A-Za-z0-9_:.-]{1,64}$/;
const INPUT_NAME = /^[A-Za-z0-9_.]{1,100}$/;

function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Infinity;
  }
}

function isApiGraph(value: unknown): value is ComfyGraph {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const nodes = Object.values(value as Record<string, unknown>);
  if (nodes.length === 0) return false;
  return nodes.every(
    (n) =>
      !!n &&
      typeof n === 'object' &&
      typeof (n as { class_type?: unknown }).class_type === 'string' &&
      !!(n as { inputs?: unknown }).inputs &&
      typeof (n as { inputs?: unknown }).inputs === 'object'
  );
}

/** Does any string anywhere in the graph carry `{{name}}`? */
export function graphUsesPlaceholder(graph: unknown, name: string): boolean {
  const pattern = new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`);
  const walk = (node: unknown): boolean => {
    if (typeof node === 'string') return pattern.test(node);
    if (Array.isArray(node)) return node.some(walk);
    if (node && typeof node === 'object') return Object.values(node).some(walk);
    return false;
  };
  return walk(graph);
}

/**
 * Check an override for `entry` and return the part worth storing.
 *
 * Errors are Thai sentences for the admin page. Unknown tunables and values
 * equal to their default are dropped rather than refused — a form posts every
 * field, and "back to the default" should read as "not overridden".
 */
export function sanitizeOverride(
  entry: CatalogEntry,
  raw: unknown
): { override: WorkflowOverride; errors: string[] } {
  const errors: string[] = [];
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: WorkflowOverride = {
    enabled: src.enabled !== false,
    rollout: src.rollout === 'all' ? 'all' : 'admin',
  };

  // Tunables.
  if (src.tuning && typeof src.tuning === 'object') {
    const tuning: Record<string, TunableValue> = {};
    for (const def of entry.tunables ?? []) {
      const rawValue = (src.tuning as Record<string, unknown>)[def.id];
      if (rawValue === undefined || rawValue === null || rawValue === '') {
        // An empty text field is a real value for text tunables (e.g. "no negative").
        if (!(def.type === 'text' && rawValue === '')) continue;
      }
      const err = tunableError(def, rawValue);
      if (err) {
        errors.push(err);
        continue;
      }
      const value = coerceTunable(def, rawValue);
      if (value !== null && value !== def.default) tuning[def.id] = value;
    }
    if (Object.keys(tuning).length > 0) out.tuning = tuning;
  }

  // Raw node inputs.
  if (Array.isArray(src.nodeInputs)) {
    if (src.nodeInputs.length > MAX_NODE_INPUTS) errors.push(`แก้ค่าโหนดได้สูงสุด ${MAX_NODE_INPUTS} รายการ`);
    const rows: NodeInputOverride[] = [];
    src.nodeInputs.slice(0, MAX_NODE_INPUTS).forEach((row, i) => {
      const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
      const nodeId = typeof r.nodeId === 'string' ? r.nodeId.trim() : '';
      const input = typeof r.input === 'string' ? r.input.trim() : '';
      if (!nodeId && !input) return; // an empty row the form left behind
      if (!NODE_ID.test(nodeId)) {
        errors.push(`แถวที่ ${i + 1}: รหัสโหนด "${nodeId}" ไม่ถูกต้อง`);
        return;
      }
      if (!INPUT_NAME.test(input)) {
        errors.push(`แถวที่ ${i + 1}: ชื่อ input "${input}" ไม่ถูกต้อง`);
        return;
      }
      if (r.value === undefined) {
        errors.push(`แถวที่ ${i + 1}: ยังไม่ได้ใส่ค่า`);
        return;
      }
      if (jsonSize(r.value) > MAX_VALUE_BYTES) {
        errors.push(`แถวที่ ${i + 1}: ค่ายาวเกินไป`);
        return;
      }
      const note = typeof r.note === 'string' ? r.note.trim().slice(0, 200) : '';
      rows.push({ nodeId, input, value: r.value, ...(note ? { note } : {}) });
    });
    if (rows.length > 0) out.nodeInputs = rows;
  }

  // Prompt affixes.
  for (const key of ['promptPrefix', 'promptSuffix'] as const) {
    const v = src[key];
    if (typeof v === 'string' && v.trim()) {
      if (v.length > MAX_PROMPT_AFFIX) errors.push(`ข้อความเติมพรอมต์ยาวได้ไม่เกิน ${MAX_PROMPT_AFFIX} ตัวอักษร`);
      else out[key] = v;
    }
  }

  // Quality modes.
  if (src.quality && typeof src.quality === 'object' && entry.qualityModes?.length) {
    const quality: Record<string, QualityAdjust> = {};
    for (const mode of entry.qualityModes) {
      const adj = (src.quality as Record<string, unknown>)[mode.id];
      if (!adj || typeof adj !== 'object') continue;
      const a = adj as Record<string, unknown>;
      const next: QualityAdjust = {};
      if (a.creditsMultiplier !== undefined && a.creditsMultiplier !== null && a.creditsMultiplier !== '') {
        const m = Number(a.creditsMultiplier);
        if (!Number.isFinite(m) || m < 0.5 || m > 10) {
          errors.push(`${mode.label}: ตัวคูณราคาต้องอยู่ระหว่าง 0.5–10`);
        } else if (Math.round(m * 100) / 100 !== mode.creditsMultiplier) {
          next.creditsMultiplier = Math.round(m * 100) / 100;
        }
      }
      if (typeof a.public === 'boolean' && a.public === !!mode.adminOnly) next.public = a.public;
      if (Object.keys(next).length > 0) quality[mode.id] = next;
    }
    if (Object.keys(quality).length > 0) out.quality = quality;
  }

  // Custom graph.
  if (src.customGraph && typeof src.customGraph === 'object') {
    const cg = src.customGraph as Record<string, unknown>;
    let graph: unknown = cg.graph;
    if (typeof graph === 'string') {
      try {
        graph = graph.trim() ? JSON.parse(graph) : null;
      } catch {
        errors.push('กราฟกำหนดเอง: JSON ไม่ถูกต้อง');
        graph = null;
      }
    }
    if (graph) {
      // ComfyUI's "Export (API)" nests nothing; its UI export has `nodes`/`links`.
      if (!isApiGraph(graph)) {
        errors.push(
          'กราฟกำหนดเองต้องเป็นรูปแบบ API (ใน ComfyUI ใช้ Workflow → Export (API)) — ไฟล์ workflow ธรรมดาที่มี nodes/links ใช้ตรงนี้ไม่ได้'
        );
      } else if (jsonSize(graph) > MAX_CUSTOM_GRAPH_BYTES) {
        errors.push('กราฟกำหนดเองใหญ่เกินไป');
      } else if (Object.keys(graph).length > MAX_CUSTOM_GRAPH_NODES) {
        errors.push(`กราฟกำหนดเองมีโหนดได้ไม่เกิน ${MAX_CUSTOM_GRAPH_NODES}`);
      } else if (!graphUsesPlaceholder(graph, 'prompt')) {
        // Without it every paying customer gets the same render.
        errors.push('กราฟกำหนดเองต้องมี {{prompt}} อย่างน้อยหนึ่งที่ ไม่งั้นลูกค้าทุกคนจะได้ผลงานเดิม');
      } else {
        out.customGraph = { enabled: cg.enabled === true, graph };
      }
    }
  }

  return { override: out, errors };
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

function parseStored(raw: string | null | undefined): StoredWorkflow | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredWorkflow;
    if (!parsed || typeof parsed !== 'object' || !parsed.override || typeof parsed.version !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseHistory(raw: string | null | undefined): StoredWorkflow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredWorkflow[]).filter((s) => s && typeof s.version === 'number') : [];
  } catch {
    return [];
  }
}

/** The live override for one model, or null when the catalogue runs as shipped. */
export async function getStoredWorkflow(modelKey: string): Promise<StoredWorkflow | null> {
  const row = await prisma.aiSetting.findUnique({ where: { key: `${OVERRIDE_PREFIX}${modelKey}` } });
  const stored = parseStored(row?.value);
  if (row?.value && !stored) {
    // A hand-edited row that no longer parses must not take renders down;
    // the admin page shows it as unreadable.
    console.error(`[workflows] ${OVERRIDE_PREFIX}${modelKey} is not valid — rendering the catalogue as shipped`);
  }
  return stored;
}

/** Every stored override, keyed by model — one query for the model list. */
export async function getAllStoredWorkflows(): Promise<Map<string, StoredWorkflow>> {
  const rows = await prisma.aiSetting.findMany({
    where: { group: WORKFLOW_SETTING_GROUP, key: { startsWith: OVERRIDE_PREFIX } },
  });
  const out = new Map<string, StoredWorkflow>();
  for (const row of rows) {
    const stored = parseStored(row.value);
    if (stored) out.set(row.key.slice(OVERRIDE_PREFIX.length), stored);
  }
  return out;
}

export async function getWorkflowHistory(modelKey: string): Promise<StoredWorkflow[]> {
  const row = await prisma.aiSetting.findUnique({ where: { key: `${HISTORY_PREFIX}${modelKey}` } });
  return parseHistory(row?.value);
}

async function upsertSetting(
  tx: Prisma.TransactionClient,
  key: string,
  value: string
): Promise<void> {
  await tx.aiSetting.upsert({
    where: { key },
    update: { value, group: WORKFLOW_SETTING_GROUP, type: 'json' },
    create: { key, value, group: WORKFLOW_SETTING_GROUP, type: 'json' },
  });
}

/**
 * Store a new version of a model's override, moving the one it replaces into
 * the history. The version number only ever grows, so "restore version 3"
 * names the same thing tomorrow as today.
 */
export async function saveWorkflow(
  modelKey: string,
  override: WorkflowOverride,
  meta: { by: string | null; note?: string | null }
): Promise<StoredWorkflow> {
  return prisma.$transaction(async (tx) => {
    const [currentRow, historyRow] = await Promise.all([
      tx.aiSetting.findUnique({ where: { key: `${OVERRIDE_PREFIX}${modelKey}` } }),
      tx.aiSetting.findUnique({ where: { key: `${HISTORY_PREFIX}${modelKey}` } }),
    ]);
    const current = parseStored(currentRow?.value);
    const history = parseHistory(historyRow?.value);
    const highest = Math.max(current?.version ?? 0, ...history.map((h) => h.version));

    const next: StoredWorkflow = {
      override,
      version: highest + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: meta.by,
      note: meta.note?.trim().slice(0, 300) || null,
    };

    const nextHistory = current ? [current, ...history].slice(0, HISTORY_LIMIT) : history;
    await upsertSetting(tx, `${OVERRIDE_PREFIX}${modelKey}`, JSON.stringify(next));
    await upsertSetting(tx, `${HISTORY_PREFIX}${modelKey}`, JSON.stringify(nextHistory));
    return next;
  }, SLOW_DB_TX);
}

// ---------------------------------------------------------------------------
// What a job renders with
// ---------------------------------------------------------------------------

/** The override as it applies to one job. */
export interface EffectiveWorkflow {
  tuning: Record<string, TunableValue>;
  nodeInputs: NodeInputOverride[];
  promptPrefix: string;
  promptSuffix: string;
  customGraph: ComfyGraph | null;
  /** The override version applied, or null for the catalogue as shipped. */
  version: number | null;
}

/**
 * Resolve what `entry` renders with for one job. `adminRun` is whether an
 * admin placed the order — an override still in `admin` rollout applies to
 * those jobs only.
 */
export function effectiveWorkflow(
  entry: CatalogEntry,
  stored: StoredWorkflow | null,
  adminRun: boolean
): EffectiveWorkflow {
  const o = stored?.override;
  const applies = !!o && o.enabled && (o.rollout === 'all' || adminRun);
  if (!applies) {
    return {
      tuning: resolveTunables(entry.tunables, null),
      nodeInputs: [],
      promptPrefix: '',
      promptSuffix: '',
      customGraph: null,
      version: null,
    };
  }
  return {
    tuning: resolveTunables(entry.tunables, o.tuning),
    nodeInputs: o.nodeInputs ?? [],
    promptPrefix: o.promptPrefix ?? '',
    promptSuffix: o.promptSuffix ?? '',
    customGraph: o.customGraph?.enabled ? o.customGraph.graph : null,
    version: stored.version,
  };
}

/** Quality modes with the admin's price and visibility applied. */
export function effectiveQualityModes(entry: CatalogEntry | undefined, stored: StoredWorkflow | null): QualityMode[] {
  const modes = entry?.qualityModes ?? [];
  const adjust = stored?.override.enabled ? stored.override.quality : undefined;
  return modes.map((mode) => {
    const a = adjust?.[mode.id];
    return {
      ...mode,
      creditsMultiplier: a?.creditsMultiplier ?? mode.creditsMultiplier,
      adminOnly: a?.public === undefined ? mode.adminOnly : !a.public,
    };
  });
}

/** The modes one caller may see — admin-only ones are left out for everyone else. */
export function visibleQualityModes(
  entry: CatalogEntry | undefined,
  stored: StoredWorkflow | null,
  isAdmin: boolean
): QualityMode[] {
  return effectiveQualityModes(entry, stored).filter((m) => isAdmin || !m.adminOnly);
}

/**
 * The mode an order renders and is priced at: the requested one when this
 * caller may use it, else the default. Null for a model without modes.
 */
export function pickQualityMode(
  entry: CatalogEntry | undefined,
  stored: StoredWorkflow | null,
  requested: unknown,
  isAdmin: boolean
): QualityMode | null {
  const modes = visibleQualityModes(entry, stored, isAdmin);
  if (modes.length === 0) return null;
  return modes.find((m) => m.id === requested) ?? modes.find((m) => m.isDefault) ?? modes[0];
}

// ---------------------------------------------------------------------------
// What the workers actually saw — for the admin page's graph view and dry runs
// ---------------------------------------------------------------------------

export interface SchemaSnapshot {
  capturedAt: string;
  /** Where it came from: a live worker, or the vendored baseline. */
  source: 'worker' | 'baseline';
  comfyVersion?: string;
  gpuModel?: string | null;
  classes: ComfyObjectInfo;
}

export interface LastGraph {
  capturedAt: string;
  generationId: number;
  jobId: number;
  workerId: number;
  gpuModel: string | null;
  overrideVersion: number | null;
  adminRun: boolean;
  custom: boolean;
  warnings: string[];
  graph: ComfyGraph;
}

export async function saveSchemaSnapshot(modelKey: string, snapshot: SchemaSnapshot): Promise<void> {
  await prisma.aiSetting.upsert({
    where: { key: `${SCHEMA_PREFIX}${modelKey}` },
    update: { value: JSON.stringify(snapshot), group: WORKFLOW_SETTING_GROUP, type: 'json' },
    create: { key: `${SCHEMA_PREFIX}${modelKey}`, value: JSON.stringify(snapshot), group: WORKFLOW_SETTING_GROUP, type: 'json' },
  });
}

export async function getSchemaSnapshot(modelKey: string): Promise<SchemaSnapshot | null> {
  const row = await prisma.aiSetting.findUnique({ where: { key: `${SCHEMA_PREFIX}${modelKey}` } });
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as SchemaSnapshot;
    return parsed && parsed.classes ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveLastGraph(modelKey: string, last: LastGraph): Promise<void> {
  await prisma.aiSetting.upsert({
    where: { key: `${LAST_GRAPH_PREFIX}${modelKey}` },
    update: { value: JSON.stringify(last), group: WORKFLOW_SETTING_GROUP, type: 'json' },
    create: { key: `${LAST_GRAPH_PREFIX}${modelKey}`, value: JSON.stringify(last), group: WORKFLOW_SETTING_GROUP, type: 'json' },
  });
}

export async function getLastGraph(modelKey: string): Promise<LastGraph | null> {
  const row = await prisma.aiSetting.findUnique({ where: { key: `${LAST_GRAPH_PREFIX}${modelKey}` } });
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as LastGraph;
    return parsed && parsed.graph ? parsed : null;
  } catch {
    return null;
  }
}
