/**
 * The /admin/workflows diagram: every catalogue entry's sample graph, laid out
 * by `layoutGraph`, must draw every node once, wire only to nodes that exist,
 * and never put two nodes on top of each other — a diagram that hides a node
 * behind another one lies about the graph.
 *
 * Run: npx tsx --test src/lib/gpu/__tests__/workflow-graph.test.mts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The admin module imports Prisma, whose adapter wants a URL at import time.
// Nothing here queries a database.
process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';

const { MODEL_CATALOG } = await import('@/lib/gpu/catalog');
const { validateGraph } = await import('@/lib/gpu/comfy-validate');
const { buildJobGraph, listTemplateNodes, sampleJob } = await import('@/lib/gpu/workflow-build');
const { layoutGraph } = await import('@/lib/gpu/workflow-graph');
const { describeBindings } = await import('@/lib/gpu/workflow-admin');
const baseline = (await import('@/lib/gpu/workflows/schema/baseline-v0.36.0.json')).default as { classes: Record<string, unknown> };
const hunyuan3dPack = (await import('@/lib/gpu/workflows/schema/hunyuan3d21-pack.json')).default as { classes: Record<string, unknown> };
const latentsyncPack = (await import('@/lib/gpu/workflows/schema/latentsync-pack.json')).default as { classes: Record<string, unknown> };

type Schema = Parameters<typeof validateGraph>[1];

/** The baseline with the sample job's stand-in uploads present, as the admin preview stages them. */
function schema(): Schema {
  const s = JSON.parse(JSON.stringify({ ...baseline.classes, ...hunyuan3dPack.classes, ...latentsyncPack.classes })) as Record<string, { input?: { required?: Record<string, unknown[]> } }>;
  const add = (cls: string, input: string, names: string[]) => {
    const def = s[cls]?.input?.required?.[input];
    if (!def) return;
    if (Array.isArray(def[0])) (def[0] as unknown[]).push(...names);
    else if (def[0] === 'COMBO') {
      const opts = (def[1] ?? {}) as { options?: unknown[] };
      opts.options = [...(opts.options ?? []), ...names];
      def[1] = opts;
    }
  };
  add('LoadImage', 'image', ['aixman-first-sample.png']);
  add('Hy3D21LoadImageWithTransparency', 'image', ['aixman-first-sample.png']);
  add('LoadAudio', 'audio', ['aixman-source-sample.mp3']);
  return s as Schema;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

for (const entry of MODEL_CATALOG) {
  test(`${entry.key}: the diagram draws the whole graph without overlaps`, () => {
    const s = schema();
    const job = sampleJob(entry);
    const { tuning: _unused, ...params } = job;
    void _unused;
    const built = buildJobGraph(entry, s, params, null, {
      first: job.imageFilename,
      audio: job.audioFilename,
      video: job.videoFilename,
    });
    const graph = validateGraph(built.graph, s).graph;
    const template = entry.templateFor?.(job) ?? entry.template;
    const view = layoutGraph(graph, listTemplateNodes(template), s);

    assert.deepEqual(view.nodes.map((n) => n.id).sort(), Object.keys(graph).sort(), 'every node drawn exactly once');

    const ids = new Set(view.nodes.map((n) => n.id));
    let links = 0;
    for (const node of Object.values(graph)) {
      for (const v of Object.values(node.inputs)) if (Array.isArray(v) && v.length === 2 && ids.has(String(v[0]))) links++;
    }
    assert.equal(view.edges.length, links, 'one edge per wired input');
    for (const e of view.edges) {
      assert.ok(ids.has(e.source) && ids.has(e.target), `edge ${e.id} joins drawn nodes`);
      const source = view.nodes.find((n) => n.id === e.source)!;
      assert.ok(e.sourceSlot < source.outputs.length, `edge ${e.id} leaves from a listed output`);
    }

    for (const n of view.nodes) {
      assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${n.id} has a position`);
    }
    for (let i = 0; i < view.nodes.length; i++) {
      for (let j = i + 1; j < view.nodes.length; j++) {
        assert.ok(!overlaps(view.nodes[i], view.nodes[j]), `${view.nodes[i].id} and ${view.nodes[j].id} overlap`);
      }
    }

    for (const g of view.groups) {
      for (const n of view.nodes.filter((m) => m.group === g.key)) {
        assert.ok(n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height, `${n.id} inside box ${g.label}`);
      }
      for (const n of view.nodes.filter((m) => m.group !== g.key)) {
        assert.ok(!overlaps(n, g), `${n.id} is outside box ${g.label} but drawn over it`);
      }
    }
  });
}

test('a tunable binding names the knob that moves it', () => {
  for (const entry of MODEL_CATALOG) {
    for (const row of describeBindings(entry)) {
      if (row.source === 'tunable') assert.ok(row.tunables.length > 0, `${entry.key} ${row.nodeId}.${row.input} is tunable but no knob claims it`);
      if (row.source === 'fixed') assert.equal(row.tunables.length, 0, `${entry.key} ${row.nodeId}.${row.input} is fixed yet a knob moves it`);
    }
  }
});
