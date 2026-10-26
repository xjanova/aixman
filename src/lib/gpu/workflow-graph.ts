import dagre from '@dagrejs/dagre';
import type { ComfyGraph, ComfyObjectInfo } from './comfy-validate';
import type { TemplateNode } from './workflow-build';

/**
 * A ComfyUI API graph laid out for the read-only diagram on /admin/workflows.
 *
 * The page draws exactly the graph a job sends — the same one its table lists —
 * so every node and wire here is real. The template's own coordinates are not
 * reused: they are sized for ComfyUI's widgets (a 612×680 prompt box, image
 * previews), and in most templates the work sits inside a collapsed subgraph
 * whose nodes live in a coordinate space of their own. Dagre lays the graph out
 * left to right instead, with each subgraph's nodes boxed under its name.
 *
 * Sizes are fixed here and the page renders nodes at exactly these sizes, so
 * the layout cannot overlap once drawn.
 */

export const NODE_WIDTH = 260;
export const NODE_HEADER = 44;
export const NODE_ROW = 20;
/** The row list's vertical padding plus the card's 2 px border, top and bottom. */
export const NODE_PADDING = 12;

export interface GraphViewInput {
  name: string;
  /** The wire feeding it, or null for a literal value. */
  link: { from: string; slot: number } | null;
  /** The literal, shortened for display. */
  value: unknown;
}

export interface GraphViewNode {
  id: string;
  classType: string;
  /** The template's title for the node, else the class's display name. */
  title: string | null;
  /** Key of the subgraph box it sits in. */
  group: string | null;
  /** Not in the template: the catalogue entry added it (a LoRA, a sigma shift). */
  injected: boolean;
  inputs: GraphViewInput[];
  outputs: string[];
  /** Top-left corner and size, in diagram units. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphViewEdge {
  id: string;
  source: string;
  sourceSlot: number;
  target: string;
  targetInput: string;
}

export interface GraphViewGroup {
  key: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphView {
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  groups: GraphViewGroup[];
}

interface SchemaOutputs {
  output_name?: unknown;
  output?: unknown;
  display_name?: unknown;
}

function isLink(v: unknown): v is [string | number, number] {
  return Array.isArray(v) && v.length === 2 && (typeof v[0] === 'string' || typeof v[0] === 'number') && typeof v[1] === 'number';
}

function shorten(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 120) return `${value.slice(0, 117)}…`;
  return value;
}

function stringList(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : null;
}

/** `105_104` sits in subgraph instance `105`; `3` sits at the top level. */
function instancePath(id: string): string | null {
  const cut = id.lastIndexOf('_');
  return cut > 0 ? id.slice(0, cut) : null;
}

export function nodeHeight(rows: number): number {
  return NODE_HEADER + Math.max(rows, 1) * NODE_ROW + NODE_PADDING;
}

/**
 * Lay out `graph`. `templateNodes` supplies titles and which subgraph a
 * converted id came from; nodes an entry injected have neither and sit
 * outside every box.
 */
export function layoutGraph(graph: ComfyGraph, templateNodes: TemplateNode[], schema: ComfyObjectInfo): GraphView {
  const fromTemplate = new Map(templateNodes.map((n) => [n.id, n]));
  const ids = Object.keys(graph).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const edges: GraphViewEdge[] = [];
  const draft = ids.map((id) => {
    const node = graph[id];
    const spec = (schema[node.class_type] ?? {}) as SchemaOutputs;
    const inputs: GraphViewInput[] = Object.entries(node.inputs).map(([name, v]) => {
      if (isLink(v) && graph[String(v[0])]) {
        const from = String(v[0]);
        edges.push({ id: `${from}:${v[1]}->${id}.${name}`, source: from, sourceSlot: v[1], target: id, targetInput: name });
        return { name, link: { from, slot: v[1] }, value: null };
      }
      return { name, link: null, value: shorten(v) };
    });
    const tpl = fromTemplate.get(id);
    const path = instancePath(id);
    return {
      id,
      classType: node.class_type,
      title: tpl?.title ?? (typeof spec.display_name === 'string' && spec.display_name !== node.class_type ? spec.display_name : null),
      group: tpl?.group && path ? `sg:${path}` : null,
      groupLabel: tpl?.group ?? null,
      // A template-less entry (SDXL) is all catalogue; flagging every node says nothing.
      injected: !tpl && templateNodes.length > 0,
      inputs,
      outputs: stringList(spec.output_name) ?? stringList(spec.output) ?? [],
    };
  });

  // A wire from a slot the schema does not list (a stale or custom class)
  // still needs somewhere to start.
  const byId = new Map(draft.map((n) => [n.id, n]));
  for (const e of edges) {
    const source = byId.get(e.source);
    if (source) while (source.outputs.length <= e.sourceSlot) source.outputs.push(`#${source.outputs.length}`);
  }

  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 22, ranksep: 70, edgesep: 10, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  const groupLabels = new Map<string, string>();
  for (const n of draft) {
    if (n.group && n.groupLabel && !groupLabels.has(n.group)) {
      groupLabels.set(n.group, n.groupLabel);
      // Room at the top of the box for its name.
      g.setNode(n.group, { label: n.groupLabel, paddingTop: 36, paddingLeft: 16, paddingRight: 16, paddingBottom: 16 });
    }
  }
  for (const n of draft) {
    g.setNode(n.id, { width: NODE_WIDTH, height: nodeHeight(n.inputs.length + n.outputs.length) });
    if (n.group) g.setParent(n.id, n.group);
  }
  for (const e of edges) g.setEdge(e.source, e.target, {}, e.id);

  dagre.layout(g);

  const nodes: GraphViewNode[] = draft.map((n) => {
    const box = g.node(n.id);
    return {
      id: n.id,
      classType: n.classType,
      title: n.title,
      group: n.group,
      injected: n.injected,
      inputs: n.inputs,
      outputs: n.outputs,
      x: Math.round(box.x - box.width / 2),
      y: Math.round(box.y - box.height / 2),
      width: box.width,
      height: box.height,
    };
  });

  // Dagre's own box for the cluster: its border keeps every other node out.
  const groups: GraphViewGroup[] = [...groupLabels.entries()].map(([key, label]) => {
    const box = g.node(key);
    return { key, label, x: Math.round(box.x - box.width / 2), y: Math.round(box.y - box.height / 2), width: box.width, height: box.height };
  });

  return { nodes, edges, groups };
}
