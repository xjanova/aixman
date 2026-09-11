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
  /** Save/preview nodes — the roots ComfyUI executes from. */
  output_node?: boolean;
}

export type ComfyObjectInfo = Record<string, ComfyNodeSpec>;

export type ComfyGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export interface ValidationResult {
  graph: ComfyGraph;
  /** Non-fatal adjustments, worth logging for an admin. */
  warnings: string[];
}

/**
 * The choices of a combo input, in either schema dialect: legacy nodes send
 * `[[...choices], {…}]`, V3 nodes send `["COMBO", { options: [...] }]` (and a
 * dynamic combo's options are objects keyed by `key`). For loader nodes the
 * choices are the files actually present on disk, which is exactly what we need
 * to confirm the weights arrived.
 */
function comboChoices(spec: unknown): string[] | null {
  if (!Array.isArray(spec) || spec.length === 0) return null;
  const first = spec[0];
  if (Array.isArray(first)) return first.filter((c): c is string => typeof c === 'string');
  if (first !== 'COMBO' && first !== 'COMFY_DYNAMICCOMBO_V3') return null;
  const opts = spec[1] as { options?: unknown[] } | undefined;
  if (!Array.isArray(opts?.options)) return null;
  return opts.options
    .map((o) => (typeof o === 'string' ? o : (o as { key?: unknown })?.key))
    .filter((c): c is string => typeof c === 'string');
}

/** Input types whose chosen value carries further inputs, sent as `name.child`. */
const NESTING_TYPES = new Set(['COMFY_DYNAMICCOMBO_V3', 'COMFY_AUTOGROW_V3']);

function specOptions(spec: unknown): Record<string, unknown> {
  const opts = Array.isArray(spec) && spec.length > 1 ? spec[1] : undefined;
  return opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : {};
}

function specType(spec: unknown): string | undefined {
  const first = Array.isArray(spec) ? spec[0] : undefined;
  return typeof first === 'string' ? first : undefined;
}

/**
 * Supply every required input the graph leaves out, the way the editor would.
 *
 * ComfyUI's server fills in nothing: a required input that is absent fails the
 * prompt even when the schema declares a default. Templates hit this whenever a
 * node gains an input after the template was saved — ACE-Step's text encoder
 * grew six sampling knobs the vendored file never mentions. A dynamic combo's
 * chosen option has required inputs of its own, filled under `name.child`.
 */
function fillRequired(
  groups: { required?: Record<string, unknown> } | undefined,
  inputs: Record<string, unknown>,
  prefix: string,
  where: string,
  warnings: string[]
): void {
  for (const [name, spec] of Object.entries(groups?.required ?? {})) {
    const key = prefix ? `${prefix}.${name}` : name;
    const opts = specOptions(spec);
    if (opts.hidden === true) continue;

    if (!(key in inputs)) {
      const choices = comboChoices(spec);
      if ('default' in opts) {
        inputs[key] = opts.default;
      } else if (choices && choices.length > 0) {
        inputs[key] = choices[0];
      } else {
        throw new Error(
          `${where} is missing required input "${key}". The workflow needs updating for this ComfyUI version.`
        );
      }
      warnings.push(`${where}: "${key}" not in the workflow, used ${JSON.stringify(inputs[key])}`);
    }

    if (specType(spec) === 'COMFY_DYNAMICCOMBO_V3') {
      const options = Array.isArray(opts.options) ? (opts.options as { key?: unknown; inputs?: { required?: Record<string, unknown> } }[]) : [];
      const chosen = options.find((o) => o?.key === inputs[key]);
      if (chosen) fillRequired(chosen.inputs, inputs, key, where, warnings);
    }
  }
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
        'The pinned ComfyUI version or a custom node pack does not match this workflow.'
    );
  }

  for (const [nodeId, node] of Object.entries(graph)) {
    const spec = objectInfo[node.class_type];
    const required = spec.input?.required ?? {};
    const optional = spec.input?.optional ?? {};
    const known = new Set([...Object.keys(required), ...Object.keys(optional)]);
    // `format.codec` belongs to the dynamic combo `format`.
    const isNested = (key: string) => {
      const root = key.split('.')[0];
      return key.includes('.') && known.has(root) && NESTING_TYPES.has(specType(required[root] ?? optional[root]) ?? '');
    };

    const inputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.inputs)) {
      if (isNested(key)) {
        inputs[key] = value;
        continue;
      }
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

    fillRequired(spec.input, inputs, '', `${node.class_type}#${nodeId}`, warnings);

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
