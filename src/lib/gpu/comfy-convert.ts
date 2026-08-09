import type { ComfyGraph, ComfyObjectInfo } from './comfy-validate';

/**
 * Convert a ComfyUI **UI-format** workflow into the **API format** that
 * `POST /prompt` accepts.
 *
 * Comfy-Org publishes ~450 official templates, but they are all UI format —
 * node/link arrays, with the interesting parts wrapped in reusable subgraphs.
 * `/prompt` accepts none of that. Hand-transcribing each one is possible (the
 * MiniMax H3 workflow was built that way) but it does not scale to a catalogue
 * of models and silently rots whenever ComfyUI renames an input.
 *
 * So this does it mechanically, using the worker's own `/object_info` as the
 * authority for input names and ordering. Two things make that necessary:
 *
 *  - A UI node's `inputs[]` only enumerates *link* inputs for many node types
 *    (`BasicScheduler` lists `model` but not `scheduler`/`steps`/`denoise`),
 *    so widget names cannot be recovered from the workflow file alone.
 *  - `widgets_values` is positional. Mapping it back to names requires knowing
 *    the declared order of the node's widget inputs, which only the running
 *    ComfyUI can tell us.
 */

/** Input types that carry a value, as opposed to a wire from another node. */
const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO']);

/** Values ComfyUI appends after a seed widget for its "control after generate" mode. */
const SEED_CONTROL_VALUES = new Set(['fixed', 'increment', 'decrement', 'randomize']);

interface UiLink {
  id: number;
  originId: number;
  originSlot: number;
  targetId: number;
  targetSlot: number;
}

interface UiNodeInput {
  name: string;
  type?: string;
  link?: number | null;
  widget?: { name?: string };
}

interface UiNode {
  id: number;
  type: string;
  inputs?: UiNodeInput[];
  outputs?: { name?: string; links?: number[] | null }[];
  widgets_values?: unknown[];
  mode?: number;
}

interface UiSubgraph {
  id: string;
  nodes?: UiNode[];
  links?: unknown[];
  inputs?: { name: string; type: string }[];
  outputs?: { name: string; type: string }[];
  inputNode?: { id: number };
  outputNode?: { id: number };
}

export interface UiWorkflow {
  nodes?: UiNode[];
  links?: unknown[];
  definitions?: { subgraphs?: UiSubgraph[] };
}

/** A resolved source for one input: either a wire, or nothing (use the widget). */
type Wire = { node: string; slot: number };

/** Normalise both link encodings. Outer graphs use arrays, subgraphs use objects. */
function normaliseLinks(raw: unknown[] | undefined): Map<number, UiLink> {
  const out = new Map<number, UiLink>();
  for (const item of raw ?? []) {
    if (Array.isArray(item) && item.length >= 5) {
      const [id, originId, originSlot, targetId, targetSlot] = item as number[];
      out.set(id, { id, originId, originSlot, targetId, targetSlot });
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, number>;
      if (typeof o.id === 'number') {
        out.set(o.id, {
          id: o.id,
          originId: o.origin_id,
          originSlot: o.origin_slot,
          targetId: o.target_id,
          targetSlot: o.target_slot,
        });
      }
    }
  }
  return out;
}

/**
 * Ordered widget-input names for a node class, from the live schema.
 * Combo inputs are widgets; typed wires (MODEL, IMAGE, …) are not.
 */
function widgetInputNames(spec: ComfyObjectInfo[string] | undefined): string[] {
  if (!spec?.input) return [];
  const names: string[] = [];
  for (const group of [spec.input.required, spec.input.optional]) {
    for (const [name, def] of Object.entries(group ?? {})) {
      const first = Array.isArray(def) ? def[0] : undefined;
      if (Array.isArray(first)) {
        names.push(name); // combo: [[...choices], {...}]
        continue;
      }
      if (typeof first === 'string' && WIDGET_TYPES.has(first)) names.push(name);
    }
  }
  return names;
}

/** True when this input's schema carries ComfyUI's seed control companion. */
function hasSeedControl(spec: ComfyObjectInfo[string] | undefined, name: string): boolean {
  const def = (spec?.input?.required?.[name] ?? spec?.input?.optional?.[name]) as unknown[] | undefined;
  const opts = Array.isArray(def) && def.length > 1 ? (def[1] as Record<string, unknown>) : undefined;
  return Boolean(opts && 'control_after_generate' in opts);
}

/**
 * Flatten a workflow — expanding every subgraph — into plain nodes with their
 * incoming wires already resolved across subgraph boundaries.
 */
class Flattener {
  private readonly subgraphs = new Map<string, UiSubgraph>();
  private readonly out = new Map<string, { type: string; widgets: unknown[]; wires: Map<number, Wire> }>();

  constructor(workflow: UiWorkflow) {
    for (const sg of workflow.definitions?.subgraphs ?? []) this.subgraphs.set(sg.id, sg);
  }

  /**
   * @param boundary resolves a subgraph's boundary input slot to a wire in the
   *   parent scope (undefined when nothing is connected there).
   */
  private walk(
    nodes: UiNode[],
    links: Map<number, UiLink>,
    prefix: string,
    boundary?: (slot: number) => Wire | undefined
  ): Map<number, (slot: number) => Wire | undefined> {
    const id = (n: number) => `${prefix}${n}`;
    const live = nodes.filter((n) => n.mode !== 2 && n.mode !== 4); // 2/4 = muted/bypassed
    const byId = new Map(live.map((n) => [n.id, n]));

    // How to resolve one output slot of a node in this scope. Subgraph entries
    // are produced lazily so a node declared *before* the subgraph it consumes
    // still resolves — template node order is arbitrary.
    const resolvers = new Map<number, (slot: number) => Wire | undefined>();
    const expanded = new Map<number, (slot: number) => Wire | undefined>();

    for (const node of live) {
      if (!this.subgraphs.has(node.type)) {
        resolvers.set(node.id, (slot) => ({ node: id(node.id), slot }));
      }
    }

    const resolverFor = (nodeId: number): ((slot: number) => Wire | undefined) | undefined => {
      const direct = resolvers.get(nodeId);
      if (direct) return direct;
      const node = byId.get(nodeId);
      const sub = node && this.subgraphs.get(node.type);
      if (!node || !sub) return undefined;
      const already = expanded.get(nodeId);
      if (already) return already;
      return this.expandSubgraph(sub, node, id(nodeId), sourceOfBoundary(node, sub), expanded);
    };

    /** Resolve whatever feeds `targetId`'s input slot, following boundaries. */
    const sourceOf = (targetId: number, targetSlot: number): Wire | undefined => {
      for (const link of links.values()) {
        if (link.targetId !== targetId || link.targetSlot !== targetSlot) continue;
        // -10 is the subgraph's input node: hop out to the parent scope.
        if (link.originId === -10 || link.originId === -1) {
          return boundary?.(link.originSlot);
        }
        return resolverFor(link.originId)?.(link.originSlot);
      }
      return undefined;
    };

    /**
     * Boundary slots are indexed against `subgraph.inputs`, but the parent
     * node's own `inputs[]` only lists the boundary inputs the UI chose to
     * show — 6 of 11 in the MiniMax template. Indexing one by the other slides
     * every wire along by the difference, so match on name instead.
     */
    function sourceOfBoundary(node: UiNode, sub: UiSubgraph) {
      const outerSlotByName = new Map<string, number>();
      (node.inputs ?? []).forEach((input, slot) => outerSlotByName.set(input.name, slot));
      return (boundarySlot: number): Wire | undefined => {
        const name = sub.inputs?.[boundarySlot]?.name;
        if (name == null) return undefined;
        const outerSlot = outerSlotByName.get(name);
        if (outerSlot == null) return undefined;
        return sourceOf(node.id, outerSlot);
      };
    }

    for (const node of live) {
      if (this.subgraphs.has(node.type)) {
        resolverFor(node.id); // force expansion even if nothing consumes it
        continue;
      }

      const wires = new Map<number, Wire>();
      (node.inputs ?? []).forEach((input, slot) => {
        if (input.link == null) return;
        const src = sourceOf(node.id, slot);
        if (src) wires.set(slot, src);
      });

      this.out.set(id(node.id), { type: node.type, widgets: node.widgets_values ?? [], wires });
      // Record the input names alongside, so emit() can pair wires with names.
      this.inputNames.set(id(node.id), (node.inputs ?? []).map((i) => i.name));
    }

    return resolvers;
  }

  /** Expand one subgraph node and return a resolver for its output slots. */
  private expandSubgraph(
    sub: UiSubgraph,
    node: UiNode,
    flatId: string,
    innerBoundary: (slot: number) => Wire | undefined,
    expanded: Map<number, (slot: number) => Wire | undefined>
  ): (slot: number) => Wire | undefined {
    const innerLinks = normaliseLinks(sub.links);
    const innerResolvers = this.walk(sub.nodes ?? [], innerLinks, `${flatId}_`, innerBoundary);

    // Outer consumers of this subgraph's outputs must land on the inner node
    // that feeds the corresponding boundary output (-20).
    const resolver = (slot: number): Wire | undefined => {
      for (const link of innerLinks.values()) {
        if ((link.targetId === -20 || link.targetId === -2) && link.targetSlot === slot) {
          return innerResolvers.get(link.originId)?.(link.originSlot);
        }
      }
      return undefined;
    };
    expanded.set(node.id, resolver);

    this.promoteSubgraphWidgets(sub, node, `${flatId}_`, innerLinks, innerBoundary);
    return resolver;
  }

  /** Input names per flattened node, positionally aligned with `wires` slots. */
  readonly inputNames = new Map<string, string[]>();
  /** Boundary widget values pushed into a subgraph, keyed by inner node id. */
  readonly boundaryWidgets = new Map<string, Map<string, unknown>>();

  /**
   * Distribute a subgraph node's `widgets_values` onto the inner nodes.
   *
   * The values line up, in order, with the boundary inputs that are widget
   * typed — link-typed boundary inputs (IMAGE, MODEL, …) are skipped. A boundary
   * input that the parent has wired still consumes its slot in the array, so the
   * index must advance for it either way.
   */
  private promoteSubgraphWidgets(
    sub: UiSubgraph,
    node: UiNode,
    innerPrefix: string,
    innerLinks: Map<number, UiLink>,
    innerBoundary: (slot: number) => Wire | undefined
  ): void {
    const values = node.widgets_values ?? [];
    let vi = 0;

    (sub.inputs ?? []).forEach((boundaryInput, slot) => {
      const isWidget = WIDGET_TYPES.has((boundaryInput.type || '').toUpperCase());
      if (!isWidget) return;

      const value = values[vi++];
      // A wired boundary input wins over the promoted widget value.
      if (innerBoundary(slot)) return;

      // Deliver the value to every inner node consuming this boundary slot.
      for (const link of innerLinks.values()) {
        if (link.originId !== -10 && link.originId !== -1) continue;
        if (link.originSlot !== slot) continue;
        const innerId = `${innerPrefix}${link.targetId}`;
        const bag = this.boundaryWidgets.get(innerId) ?? new Map<string, unknown>();
        bag.set(String(link.targetSlot), value);
        this.boundaryWidgets.set(innerId, bag);
      }
    });
  }

  run(workflow: UiWorkflow) {
    this.walk(workflow.nodes ?? [], normaliseLinks(workflow.links), '');
    return this.out;
  }
}

/**
 * Convert a UI workflow to API format.
 *
 * `objectInfo` must come from the worker that will run it — that is what makes
 * the widget mapping correct rather than guessed.
 */
export function convertUiWorkflowToApi(workflow: UiWorkflow, objectInfo: ComfyObjectInfo): ComfyGraph {
  const flattener = new Flattener(workflow);
  const flat = flattener.run(workflow);
  const graph: ComfyGraph = {};

  for (const [nodeId, node] of flat) {
    const spec = objectInfo[node.type];
    if (!spec) {
      throw new Error(
        `Workflow uses node "${node.type}" which this worker does not provide. ` +
          'The container image may be missing a custom node pack, or ComfyUI is too old.'
      );
    }

    const inputs: Record<string, unknown> = {};
    const names = flattener.inputNames.get(nodeId) ?? [];

    // 1. Wires win over everything.
    for (const [slot, wire] of node.wires) {
      const name = names[slot];
      if (name) inputs[name] = [wire.node, wire.slot];
    }

    // 2. Values promoted down from a subgraph boundary.
    for (const [slot, value] of flattener.boundaryWidgets.get(nodeId) ?? []) {
      const name = names[Number(slot)];
      if (name && !(name in inputs)) inputs[name] = value;
    }

    // 3. Positional widgets_values, against the schema's declared widget order.
    const widgetNames = widgetInputNames(spec);
    let vi = 0;
    for (const name of widgetNames) {
      if (vi >= node.widgets.length) break;
      const value = node.widgets[vi++];
      if (!(name in inputs)) inputs[name] = value;
      // A seed widget is followed by its control mode ("randomize" etc.), which
      // is UI state and must not be mistaken for the next widget's value.
      if (
        hasSeedControl(spec, name) &&
        typeof node.widgets[vi] === 'string' &&
        SEED_CONTROL_VALUES.has(node.widgets[vi] as string)
      ) {
        vi++;
      }
    }

    graph[nodeId] = { class_type: node.type, inputs };
  }

  return graph;
}

/**
 * Add nodes to a converted graph.
 *
 * Official templates are built around whatever input the demo used — the
 * lip-sync template drives its audio from an ElevenLabs TTS call. Serving our
 * own customers means feeding it an uploaded file instead, which needs a
 * `LoadAudio`/`LoadImage` node the template never had.
 */
export function injectNodes(
  graph: ComfyGraph,
  nodes: Record<string, { class_type: string; inputs: Record<string, unknown> }>
): ComfyGraph {
  const out: ComfyGraph = {};
  for (const [id, node] of Object.entries(graph)) {
    out[id] = { class_type: node.class_type, inputs: { ...node.inputs } };
  }
  for (const [id, node] of Object.entries(nodes)) {
    out[id] = { class_type: node.class_type, inputs: { ...node.inputs } };
  }
  return out;
}

/**
 * Remove nodes by class, cascading to anything left depending on them.
 *
 * Used to strip paid-API nodes (ElevenLabs, Gemini) out of official templates.
 * The cascade matters: deleting the TTS node alone would leave a SaveAudioMP3
 * pointing at nothing, and ComfyUI fails the whole prompt on a dangling input
 * rather than skipping that branch.
 *
 * Rewire before pruning — otherwise the cascade eats the very path being
 * redirected.
 */
export function pruneByClass(graph: ComfyGraph, classes: string[]): ComfyGraph {
  const doomed = new Set(classes);
  const out: ComfyGraph = {};
  for (const [id, node] of Object.entries(graph)) {
    out[id] = { class_type: node.class_type, inputs: { ...node.inputs } };
  }

  const removed = new Set<string>();
  for (const [id, node] of Object.entries(out)) {
    if (doomed.has(node.class_type)) {
      removed.add(id);
      delete out[id];
    }
  }

  // Cascade until stable: anything still wired to a removed node is itself
  // unrunnable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, node] of Object.entries(out)) {
      for (const value of Object.values(node.inputs)) {
        if (!Array.isArray(value) || typeof value[1] !== 'number') continue;
        if (removed.has(String(value[0]))) {
          removed.add(id);
          delete out[id];
          changed = true;
          break;
        }
      }
    }
  }

  return out;
}

/** One per-job value to force into the converted graph. */
export interface ParameterBinding {
  /**
   * Exact node id from the pinned template. Preferred over `nodeType` whenever
   * a template has more than one node of a class — the two CLIPTextEncode nodes
   * for positive and negative prompt are indistinguishable by class, and
   * getting them the wrong way round silently inverts the prompt.
   */
  nodeId?: string;
  /** Node class to target, when id is not known. */
  nodeType?: string;
  /**
   * Input name, or several candidates tried in order. Candidates exist because
   * equivalent inputs are named differently across model families (`seed` vs
   * `noise_seed`, `tags` vs `text`); the first one the node actually declares
   * is used and the rest are ignored.
   */
  input: string | string[];
  value: unknown;
  /** Bind only the Nth node of `nodeType`. Ignored when `nodeId` is set. */
  index?: number;
}

/**
 * Apply per-job values on top of a converted graph.
 *
 * This has to be able to *replace a wire*, not just fill a blank: official
 * templates often compute inputs from helper nodes (the MiniMax template drives
 * width/height from a ResolutionSelector), and the customer's chosen size must
 * win over the template's default. Writing a literal where a wire was simply
 * orphans the helper node, which ComfyUI ignores.
 *
 * Returns a new graph; the input is left untouched so a cached conversion can
 * be reused across jobs.
 */
export function bindParameters(graph: ComfyGraph, bindings: ParameterBinding[]): ComfyGraph {
  const out: ComfyGraph = {};
  for (const [id, node] of Object.entries(graph)) {
    out[id] = { class_type: node.class_type, inputs: { ...node.inputs } };
  }

  const orderedIds = Object.keys(out);

  /** Write to the first candidate name the node actually declares. */
  const assign = (node: ComfyGraph[string], input: string | string[], value: unknown): void => {
    for (const name of Array.isArray(input) ? input : [input]) {
      // Only bind inputs the node declares, so a stale binding after a template
      // change is inert rather than injecting a bogus input ComfyUI rejects.
      if (name in node.inputs) {
        node.inputs[name] = value;
        return;
      }
    }
  };

  for (const binding of bindings) {
    if (binding.value === undefined) continue;

    if (binding.nodeId) {
      const node = out[binding.nodeId];
      if (node) assign(node, binding.input, binding.value);
      continue;
    }

    let matchIndex = 0;
    for (const id of orderedIds) {
      const node = out[id];
      if (node.class_type !== binding.nodeType) continue;
      const thisIndex = matchIndex++;
      if (binding.index !== undefined && binding.index !== thisIndex) continue;
      assign(node, binding.input, binding.value);
    }
  }

  return out;
}
