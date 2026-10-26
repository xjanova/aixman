"use client";

/**
 * The read-only node diagram on /admin/workflows' "โหนดและการเชื่อม" tab.
 *
 * It draws the graph the server laid out (`/api/admin/workflows/[key]` →
 * `graph`): the same nodes and wires as the table below it, coloured by where
 * each value comes from. Nothing here edits anything — nodes cannot be dragged
 * or wired, and a click only asks the page to open the form that edits that
 * node.
 */

import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphView, GraphViewNode } from "@/lib/gpu/workflow-graph";

export type ValueSource = "job" | "tunable" | "fixed" | "admin";

/** Strongest first: what a node's border shows when its inputs disagree. */
const PRIORITY: ValueSource[] = ["admin", "job", "tunable", "fixed"];

export const SOURCE_COLOR: Record<ValueSource | "template", { border: string; chip: string; label: string; minimap: string }> = {
  job: { border: "border-cyan-400/70", chip: "bg-cyan-500/15 text-cyan-200", label: "จากออเดอร์", minimap: "#22d3ee" },
  tunable: { border: "border-violet-400/70", chip: "bg-violet-500/15 text-violet-200", label: "ปรับได้", minimap: "#a78bfa" },
  fixed: { border: "border-slate-400/60", chip: "bg-slate-500/20 text-slate-200", label: "คงที่", minimap: "#94a3b8" },
  admin: { border: "border-amber-400/80", chip: "bg-amber-500/15 text-amber-200", label: "แอดมินตั้ง", minimap: "#fbbf24" },
  template: { border: "border-border", chip: "text-muted", label: "ค่าจากเทมเพลต", minimap: "#475569" },
};

function short(v: unknown, max = 28): string {
  const s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v);
  if (s === undefined) return "—";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

type WfNodeData = {
  node: GraphViewNode;
  sources: Record<string, ValueSource | undefined>;
  strongest: ValueSource | "template";
};

type GroupData = { label: string };

function WfNode({ data }: NodeProps<Node<WfNodeData, "wf">>) {
  const { node, sources, strongest } = data;
  return (
    <div
      className={`rounded-lg border-2 bg-surface/95 shadow-lg cursor-pointer hover:brightness-125 transition ${SOURCE_COLOR[strongest].border}`}
      style={{ width: node.width, height: node.height }}
      title="คลิกเพื่อไปที่ช่องแก้ค่าของโหนดนี้"
    >
      <div className="px-2.5 pt-1.5 h-11 border-b border-border/60">
        <div className="flex items-center gap-1.5">
          <div className="text-[12px] font-semibold truncate text-foreground">{node.title ?? node.classType}</div>
          {node.injected && <span className="shrink-0 px-1 rounded text-[9.5px] bg-sky-500/15 text-sky-200" title="ไม่มีในเทมเพลต — แคตตาล็อกเพิ่มเข้าไป">แคตตาล็อกเพิ่ม</span>}
        </div>
        <div className="text-[10px] text-muted font-mono truncate">#{node.id} · {node.classType}</div>
      </div>
      <div className="py-1">
        {node.inputs.map((input) => {
          const source = sources[input.name];
          return (
            <div key={input.name} className="relative h-5 px-2.5 flex items-center gap-1.5 text-[10.5px] font-mono">
              <Handle type="target" id={`in:${input.name}`} position={Position.Left} isConnectable={false} className="!w-2 !h-2 !min-w-0 !min-h-0 !bg-slate-400 !border-0" />
              <span className={`px-1 rounded truncate max-w-[45%] ${source ? SOURCE_COLOR[source].chip : "text-muted"}`}>{input.name}</span>
              <span className="truncate text-muted">{input.link ? `← #${input.link.from}` : short(input.value)}</span>
            </div>
          );
        })}
        {node.outputs.map((name, slot) => (
          <div key={`out-${slot}`} className="relative h-5 px-2.5 flex items-center justify-end text-[10.5px] font-mono text-emerald-200/90">
            {name}
            <Handle type="source" id={`out:${slot}`} position={Position.Right} isConnectable={false} className="!w-2 !h-2 !min-w-0 !min-h-0 !bg-emerald-400 !border-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupBox({ data }: NodeProps<Node<GroupData, "group-box">>) {
  return (
    <div className="relative w-full h-full rounded-xl border border-dashed border-primary/40 bg-primary/[0.04] pointer-events-none">
      {/* On the border, like a fieldset legend: dagre leaves as little as 16 px above the top member. */}
      <div data-group-label className="absolute -top-[9px] left-3 max-w-[calc(100%-24px)] px-1.5 rounded bg-surface leading-[18px] text-[11px] text-primary-light font-medium truncate">subgraph · {data.label}</div>
    </div>
  );
}

// Module level: React Flow re-mounts every node when this object changes identity.
const NODE_TYPES = { wf: WfNode, "group-box": GroupBox };

function strongestOf(sources: Record<string, ValueSource | undefined>): ValueSource | "template" {
  const present = new Set(Object.values(sources).filter(Boolean));
  return PRIORITY.find((p) => present.has(p)) ?? "template";
}

export default function WorkflowDiagram({
  graph,
  marks,
  onNodeClick,
}: {
  graph: GraphView;
  /** `nodeId.input` → where that value comes from. */
  marks: Map<string, ValueSource>;
  onNodeClick: (nodeId: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const groupNodes: Node[] = graph.groups.map((g) => ({
      id: `group:${g.key}`,
      type: "group-box",
      position: { x: g.x, y: g.y },
      data: { label: g.label },
      style: { width: g.width, height: g.height },
      width: g.width,
      height: g.height,
      selectable: false,
      draggable: false,
      focusable: false,
      zIndex: -1,
    }));
    const wfNodes: Node[] = graph.nodes.map((n) => {
      const sources = Object.fromEntries(n.inputs.map((i) => [i.name, marks.get(`${n.id}.${i.name}`)]));
      return {
        id: n.id,
        type: "wf",
        position: { x: n.x, y: n.y },
        data: { node: n, sources, strongest: strongestOf(sources) },
        // The MiniMap sizes nodes from these, not from what React Flow measured:
        // with no onNodesChange the measurement never reaches this object.
        width: n.width,
        height: n.height,
        draggable: false,
        connectable: false,
      };
    });
    const flowEdges: Edge[] = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: `out:${e.sourceSlot}`,
      targetHandle: `in:${e.targetInput}`,
      focusable: false,
      style: { stroke: "#64748b", strokeWidth: 1.5 },
    }));
    return { nodes: [...groupNodes, ...wfNodes], edges: flowEdges };
  }, [graph, marks]);

  return (
    <div className="h-[640px] rounded-lg overflow-hidden border border-border bg-black/30">
      <ReactFlow
        ariaLabelConfig={{
          "node.a11yDescription.default": "แผนภาพดูอย่างเดียว — คลิกโหนดเพื่อไปที่ช่องแก้ค่า",
          "node.a11yDescription.keyboardDisabled": "แผนภาพดูอย่างเดียว",
          "edge.a11yDescription.default": "เส้นเชื่อมระหว่างโหนด (ดูอย่างเดียว)",
        }}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        zoomOnScroll={false}
        panOnScroll={false}
        preventScrolling={false}
        zoomOnDoubleClick={false}
        onNodeClick={(_, node) => { if (node.type === "wf") onNodeClick(node.id); }}
      >
        <Background gap={24} size={1} color="#334155" />
        <Controls showInteractive={false} position="bottom-left" />
        {graph.nodes.length > 12 && (
          <MiniMap pannable zoomable position="bottom-right" bgColor="rgba(2,6,23,0.85)" maskColor="rgba(15,23,42,0.6)"
            nodeColor={(n) => (n.type === "wf" ? SOURCE_COLOR[(n.data as WfNodeData).strongest].minimap : "transparent")} />
        )}
      </ReactFlow>
    </div>
  );
}
