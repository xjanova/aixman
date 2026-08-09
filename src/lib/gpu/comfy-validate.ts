/**
 * Validate a generated ComfyUI graph against the schema the *running* worker
 * reports at `/object_info`.
 *
 * The built-in workflow is transcribed from an official template, but ComfyUI
 * node signatures drift between releases. Posting a stale graph produces an
 * opaque 400 after we have already paid to rent and warm a GPU. Checking first
 * turns that into a precise, actionable message — and catches the much more
 * common failure of a weights file that did not finish downloading.
 */

export interface ComfyNodeSpec {
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
  };
}

export type ComfyObjectInfo = Record<string, ComfyNodeSpec>;

export type ComfyGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export interface ValidationResult {
  graph: ComfyGraph;
  /** Non-fatal adjustments, worth logging for an admin. */
  warnings: string[];
}

/**
 * ComfyUI describes a combo input as `[[...choices], {…}]`. For loader nodes the
 * choices are the files actually present on disk, which is exactly what we need
 * to confirm the weights arrived.
 */
function comboChoices(spec: unknown): string[] | null {
  if (!Array.isArray(spec) || spec.length === 0) return null;
  const first = spec[0];
  if (!Array.isArray(first)) return null;
  return first.filter((c): c is string => typeof c === 'string');
}

function hasDefault(spec: unknown): boolean {
  if (!Array.isArray(spec) || spec.length < 2) return false;
  const opts = spec[1];
  return Boolean(opts && typeof opts === 'object' && 'default' in (opts as object));
}

/** A `[nodeId, slot]` reference to another node's output. */
function isLink(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && typeof value[1] === 'number';
}

export function validateGraph(graph: ComfyGraph, objectInfo: ComfyObjectInfo): ValidationResult {
  const warnings: string[] = [];
  const result: ComfyGraph = {};

  const missingNodes = [...new Set(Object.values(graph).map((n) => n.class_type))].filter(
    (cls) => !objectInfo[cls]
  );
  if (missingNodes.length > 0) {
    throw new Error(
      `The worker's ComfyUI does not provide these nodes: ${missingNodes.join(', ')}. ` +
        'MiniMax H3 needs ComfyUI 0.30.0 or newer — update the container image.'
    );
  }

  for (const [nodeId, node] of Object.entries(graph)) {
    const spec = objectInfo[node.class_type];
    const required = spec.input?.required ?? {};
    const optional = spec.input?.optional ?? {};
    const known = new Set([...Object.keys(required), ...Object.keys(optional)]);

    const inputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.inputs)) {
      if (!known.has(key)) {
        // Dropping is right: a renamed input is better sent as its default than
        // rejected wholesale, and the warning tells the admin what shifted.
        warnings.push(`${node.class_type}#${nodeId}: dropped unknown input "${key}"`);
        continue;
      }

      // A combo value must be one of the choices the worker offers. For loader
      // nodes that list is the on-disk file set, so a mismatch here almost
      // always means a weights download failed or is still running.
      const choices = comboChoices(required[key] ?? optional[key]);
      if (choices && typeof value === 'string' && !choices.includes(value)) {
        throw new Error(
          `${node.class_type}#${nodeId}: "${value}" is not available on the worker for input ` +
            `"${key}". Present: ${choices.slice(0, 8).join(', ') || '(none)'}${choices.length > 8 ? ', …' : ''}. ` +
            'This usually means the model download did not complete.'
        );
      }

      inputs[key] = value;
    }

    for (const [key, keySpec] of Object.entries(required)) {
      if (key in inputs) continue;
      if (hasDefault(keySpec)) continue;
      // Combos default to their first choice in ComfyUI, so they are safe to omit.
      if (comboChoices(keySpec)) continue;
      throw new Error(
        `${node.class_type}#${nodeId} is missing required input "${key}". ` +
          'The built-in MiniMax H3 workflow needs updating for this ComfyUI version.'
      );
    }

    result[nodeId] = { class_type: node.class_type, inputs };
  }

  // Every link must point at a node that still exists, or ComfyUI hangs the
  // prompt rather than rejecting it.
  for (const [nodeId, node] of Object.entries(result)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (!isLink(value)) continue;
      const target = String((value as unknown[])[0]);
      if (!result[target]) {
        throw new Error(
          `${node.class_type}#${nodeId}.${key} references node "${target}", which is not in the graph.`
        );
      }
    }
  }

  return { graph: result, warnings };
}

/**
 * `/object_info` is several megabytes, so it is fetched once per worker
 * endpoint. Entries are dropped when a worker is released, and the map is
 * bounded so a long-running process cannot accumulate dead endpoints.
 */
const schemaCache = new Map<string, ComfyObjectInfo>();
const SCHEMA_CACHE_LIMIT = 8;

export function cacheSchema(endpoint: string, info: ComfyObjectInfo): void {
  if (schemaCache.size >= SCHEMA_CACHE_LIMIT) {
    const oldest = schemaCache.keys().next().value;
    if (oldest) schemaCache.delete(oldest);
  }
  schemaCache.set(endpoint, info);
}

export function getCachedSchema(endpoint: string): ComfyObjectInfo | undefined {
  return schemaCache.get(endpoint);
}

export function clearSchema(endpoint: string): void {
  schemaCache.delete(endpoint);
}
