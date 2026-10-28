/**
 * Draws every camera preview on the page from one WebGL context.
 *
 * Browsers keep only about sixteen WebGL contexts alive and the studio shows
 * more tiles than that, so each tile is a plain 2D canvas: per frame the shared
 * renderer draws a tile's view into a corner of its own buffer and the tile
 * copies it across. Only tiles on screen are drawn, at 30 fps; with reduced
 * motion each is drawn once, mostly through its move. The renderer and scene
 * are released a while after the last tile goes.
 *
 * The scene's layout is what `src/lib/camera-shots.ts` measures against.
 */
import * as THREE from "three";
import { loopSeconds, shotAt, STILL_PHASE, type HeroPose, type ShotSpec } from "@/lib/camera-shots";

const FPS = 30;
const RELEASE_AFTER_MS = 15_000;
/** `ShotFrame.blur` is in px at this tile width. */
const BLUR_BASE_WIDTH = 160;
/** Objects drawn sharp over a blurred background live on this layer while it is drawn. */
const FOCUS_LAYER = 1;

interface Tile {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  spec: ShotSpec;
  period: number;
  start: number;
  visible: boolean;
  w: number;
  h: number;
  /** Reduced motion: the one still is on the canvas. */
  drawn: boolean;
}

interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  legA: THREE.Group;
  legB: THREE.Group;
  /** The arm on +x — the one that waves. */
  armA: THREE.Group;
  armB: THREE.Group;
  shadow: THREE.Mesh;
}

interface World {
  scene: THREE.Scene;
  rig: Rig;
  bloom: THREE.Group;
  sharp: { hero: THREE.Object3D[]; flower: THREE.Object3D[] };
  fireflies: THREE.Points;
  fireflyHome: Float32Array;
}

interface Engine {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  world: World;
  tiles: Set<Tile>;
  tileOf: Map<Element, Tile>;
  io: IntersectionObserver;
  ro: ResizeObserver;
  still: MediaQueryList;
  onStillChange: () => void;
  raf: number;
  last: number;
  lost: boolean;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

let engine: Engine | null = null;

// ── scene ─────────────────────────────────────────────────────────────────

/** Deterministic, so every visit shows the same little world. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const std = (color: string, roughness = 0.6, flat = false) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: flat });

function buildHero(): Rig {
  const skin = std("#f2c4a0", 0.55);
  const jacket = std("#fb7185", 0.5);
  const pants = std("#3730a3", 0.7);
  const hair = std("#1e1b3a", 0.6);
  const dark = std("#0b1020", 0.4);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const leg = (x: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0.86, 0);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.62, 4, 10), pants);
    shin.position.y = -0.4;
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.21), dark);
    shoe.position.set(0, -0.82, 0.03);
    g.add(shin, shoe);
    root.add(g);
    return g;
  };
  const legA = leg(0.1);
  const legB = leg(-0.1);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 4, 14), jacket);
  torso.position.y = 1.07;
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.045, 8, 18), std("#fde68a", 0.7));
  scarf.position.y = 1.4;
  scarf.rotation.x = Math.PI / 2;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.14), std("#22d3ee", 0.4));
  pack.position.set(0, 1.12, -0.24);
  body.add(torso, scarf, pack);

  const arm = (x: number) => {
    const g = new THREE.Group();
    g.position.set(x, 1.33, 0);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.42, 4, 10), jacket);
    sleeve.position.y = -0.26;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), skin);
    hand.position.y = -0.58;
    g.add(sleeve, hand);
    body.add(g);
    return g;
  };
  const armA = arm(0.28);
  const armB = arm(-0.28);

  const head = new THREE.Group();
  head.position.y = 1.55;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 18), skin);
  // A cap of hair over the top and back, so which way the figure faces reads at a glance.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.182, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), hair);
  cap.rotation.x = -0.45;
  const eye = (x: number) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), dark);
    e.position.set(x, 0.02, 0.155);
    return e;
  };
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 8), std("#be4b62", 0.5));
  mouth.scale.set(1, 0.45, 0.5);
  mouth.position.set(0, -0.055, 0.158);
  const cheek = (x: number) => {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), std("#f9a8b8", 0.7));
    c.scale.set(1, 0.6, 0.4);
    c.position.set(x, -0.03, 0.145);
    return c;
  };
  head.add(face, cap, eye(0.06), eye(-0.06), mouth, cheek(0.095), cheek(-0.095));
  body.add(head);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 32),
    new THREE.MeshBasicMaterial({ map: radialTexture("rgba(0,0,0,0.6)", "rgba(0,0,0,0)"), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;

  return { root, body, head, legA, legB, armA, armB, shadow };
}

function buildFlower(petal: string): { group: THREE.Group; bloom: THREE.Group } {
  const group = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.01, 0.23, 6), std("#22c55e", 0.7));
  stem.position.y = 0.115;
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 6), std("#16a34a", 0.7));
  leaf.scale.set(1.4, 0.25, 0.6);
  leaf.position.set(0.03, 0.07, 0);
  leaf.rotation.z = 0.5;
  const bloom = new THREE.Group();
  bloom.position.y = 0.235;
  bloom.rotation.x = 0.55;
  const petalMat = std(petal, 0.45);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 8), petalMat);
    p.scale.set(1, 0.32, 0.62);
    p.position.set(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04);
    p.rotation.y = -a;
    bloom.add(p);
  }
  const heart = new THREE.Mesh(new THREE.SphereGeometry(0.021, 12, 8), std("#facc15", 0.5));
  heart.position.y = 0.008;
  bloom.add(heart);
  group.add(stem, leaf, bloom);
  return { group, bloom };
}

function buildWorld(): World {
  const scene = new THREE.Scene();
  const horizon = new THREE.Color("#5a2a7e");
  scene.fog = new THREE.Fog(horizon, 20, 105);
  const rand = rng(20261028);

  // Sky dome: night blue overhead, violet at the horizon (the fog's colour, so hills melt into it).
  const skyGeo = new THREE.SphereGeometry(100, 32, 20);
  const skyPos = skyGeo.attributes.position;
  const skyCol = new Float32Array(skyPos.count * 3);
  const top = new THREE.Color("#080c28");
  const mid = new THREE.Color("#28297a");
  const below = new THREE.Color("#1a1034");
  const c = new THREE.Color();
  for (let i = 0; i < skyPos.count; i++) {
    const y = skyPos.getY(i) / 100;
    if (y < 0) c.copy(horizon).lerp(below, Math.min(1, -y * 4));
    else if (y < 0.3) c.copy(horizon).lerp(mid, y / 0.3);
    else c.copy(mid).lerp(top, (y - 0.3) / 0.7);
    c.toArray(skyCol, i * 3);
  }
  skyGeo.setAttribute("color", new THREE.BufferAttribute(skyCol, 3));
  scene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false })));

  const starPos: number[] = [];
  while (starPos.length < 260 * 3) {
    const az = rand() * Math.PI * 2;
    const el = 0.2 + rand() * 1.3;
    if (el > Math.PI / 2) continue;
    starPos.push(Math.cos(el) * Math.sin(az) * 95, Math.sin(el) * 95, Math.cos(el) * Math.cos(az) * 95);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: "#e0e7ff", size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false, toneMapped: false })));

  const moon = new THREE.Mesh(new THREE.CircleGeometry(3.4, 40), new THREE.MeshBasicMaterial({ color: "#fef3c7", fog: false, toneMapped: false }));
  moon.position.set(-8, 40, -60);
  moon.lookAt(0, 1.5, 0);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture("rgba(253,230,138,0.55)", "rgba(253,230,138,0)"),
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  }));
  glow.position.set(-8.3, 40.4, -60.6);
  glow.scale.setScalar(20);
  scene.add(moon, glow);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 48), std("#26335e", 1));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  // The grid is what makes movement legible: it slides, tilts and turns with the camera.
  const grid = new THREE.GridHelper(80, 80, "#22d3ee", "#22d3ee");
  const gridMat = grid.material as THREE.LineBasicMaterial;
  gridMat.transparent = true;
  gridMat.opacity = 0.13;
  grid.position.y = 0.006;
  scene.add(grid);

  // Stepping stones from the figure's back down −z: the walking shots' path.
  const stones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.3, 0.05, 7), std("#4b4775", 0.9, true), 34);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < 34; i++) {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 3);
    m.compose(v.set((rand() - 0.5) * 0.24, 0.02, -0.8 - i * 0.85), q, s.set(1, 1, 1));
    stones.setMatrixAt(i, m);
  }
  scene.add(stones);

  // Trees: none within 6 of the figure, none in the wedge in front of it (every
  // framing looks through it), none on the path behind it.
  const spots: [number, number][] = [];
  while (spots.length < 70) {
    const r = 6.5 + rand() * 36;
    const a = rand() * Math.PI * 2;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    if (z > 0 && Math.abs(x) < 2.5 + 0.35 * z) continue;
    if (z < 0 && Math.abs(x) < 2.4) continue;
    spots.push([x, z]);
  }
  // A wood along both sides of the path, for the walking and flying shots to pass.
  while (spots.length < 110) {
    const z = -6.5 - rand() * 34;
    const x = (2.7 + rand() * 7) * (rand() < 0.5 ? -1 : 1);
    spots.push([x, z]);
  }
  const cone = new THREE.ConeGeometry(1, 1, 7);
  const leaves = new THREE.InstancedMesh(cone, std("#ffffff", 0.75, true), spots.length * 2);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.12, 1, 6), std("#3b2a4d", 0.9, true), spots.length);
  const greens = ["#0f766e", "#0d9488", "#115e59", "#14705f", "#1e6b5c"].map((h) => new THREE.Color(h));
  const blossom = new THREE.Color("#be185d");
  spots.forEach(([x, z], i) => {
    const h = 1.6 + rand() * 1.8;
    const w = 0.5 + rand() * 0.45;
    const col = rand() < 0.16 ? blossom : greens[Math.floor(rand() * greens.length)];
    q.identity();
    m.compose(v.set(x, h * 0.18, z), q, s.set(1, h * 0.36, 1));
    trunks.setMatrixAt(i, m);
    m.compose(v.set(x, h * 0.5, z), q, s.set(w, h * 0.55, w));
    leaves.setMatrixAt(i * 2, m);
    leaves.setColorAt(i * 2, col);
    m.compose(v.set(x, h * 0.8, z), q, s.set(w * 0.72, h * 0.42, w * 0.72));
    leaves.setMatrixAt(i * 2 + 1, m);
    leaves.setColorAt(i * 2 + 1, col);
  });
  scene.add(leaves, trunks);

  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), std("#3f3a66", 0.95, true), 28);
  for (let i = 0; i < 28; i++) {
    let x = 0;
    let z = 0;
    do {
      const r = 2 + rand() * 14;
      const a = rand() * Math.PI * 2;
      x = Math.sin(a) * r;
      z = Math.cos(a) * r;
    } while ((z > 0 && Math.abs(x) < 2.5 + 0.35 * z) || (z < 0 && Math.abs(x) < 1.2));
    const k = 0.08 + rand() * 0.22;
    q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
    m.compose(v.set(x, k * 0.4, z), q, s.set(k, k * 0.7, k));
    rocks.setMatrixAt(i, m);
  }
  scene.add(rocks);

  const hills = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), std("#24184a", 1, true), 12);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rand() * 0.4;
    const r = 58 + rand() * 18;
    const h = 10 + rand() * 12;
    const w = 10 + rand() * 8;
    q.identity();
    m.compose(v.set(Math.sin(a) * r, h / 2 - 0.5, Math.cos(a) * r), q, s.set(w, h, w));
    hills.setMatrixAt(i, m);
  }
  scene.add(hills);

  const rig = buildHero();
  scene.add(rig.root, rig.shadow);

  const focus = buildFlower("#f472b6");
  focus.group.position.set(0.35, 0, 0.9);
  scene.add(focus.group);
  for (const [x, z, col] of [[-0.7, 0.4, "#a78bfa"], [0.95, -0.5, "#fb923c"], [-1.2, -0.9, "#f472b6"], [1.4, 0.6, "#a78bfa"]] as const) {
    const f = buildFlower(col);
    f.group.position.set(x, 0, z);
    f.group.rotation.y = x;
    scene.add(f.group);
  }

  const flyCount = 36;
  const fireflyHome = new Float32Array(flyCount * 3);
  for (let i = 0; i < flyCount; i++) {
    const r = 1.2 + rand() * 4.5;
    const a = rand() * Math.PI * 2;
    fireflyHome.set([Math.sin(a) * r, 0.3 + rand() * 2, Math.cos(a) * r], i * 3);
  }
  const flyGeo = new THREE.BufferGeometry();
  flyGeo.setAttribute("position", new THREE.BufferAttribute(fireflyHome.slice(), 3));
  const fireflies = new THREE.Points(flyGeo, new THREE.PointsMaterial({
    map: radialTexture("rgba(254,240,138,1)", "rgba(254,240,138,0)"), size: 0.09, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  scene.add(fireflies);

  const hemi = new THREE.HemisphereLight("#9aa5ff", "#1a1033", 1.1);
  const key = new THREE.DirectionalLight("#ffd7a8", 2.2);
  key.position.set(4, 6, 5);
  const rim = new THREE.DirectionalLight("#5eead4", 1.7);
  rim.position.set(-3, 3, -5);
  // Lights are filtered by layer too: they must reach the sharp pass.
  for (const l of [hemi, key, rim]) {
    l.layers.enableAll();
    scene.add(l);
  }

  const meshes = (o: THREE.Object3D) => {
    const out: THREE.Object3D[] = [];
    o.traverse((n) => out.push(n));
    return out;
  };
  return { scene, rig, bloom: focus.bloom, sharp: { hero: meshes(rig.root), flower: meshes(focus.group) }, fireflies, fireflyHome };
}

// ── per frame ─────────────────────────────────────────────────────────────

function poseHero(rig: Rig, pose: HeroPose, time: number) {
  rig.root.position.set(pose.x, 0, pose.z);
  rig.root.rotation.y = pose.heading;
  rig.shadow.position.set(pose.x, 0.012, pose.z);
  const swing = pose.walk * Math.sin(pose.phase);
  rig.legA.rotation.x = swing * 0.55;
  rig.legB.rotation.x = -swing * 0.55;
  rig.armA.rotation.x = -swing * 0.5;
  rig.armB.rotation.x = swing * 0.5;
  rig.body.position.y = pose.walk * Math.abs(Math.cos(pose.phase)) * 0.04 + Math.sin(time * 2.1) * 0.006;
  rig.head.rotation.y = (1 - pose.walk) * 0.14 * Math.sin(time * 0.7);
  rig.armA.rotation.z = 0.08 + pose.wave * (2.45 + 0.3 * Math.sin(time * 9));
  rig.armB.rotation.z = -0.08;
}

function animateWorld(world: World, time: number) {
  world.bloom.rotation.z = 0.08 * Math.sin(time * 1.7);
  const pos = world.fireflies.geometry.attributes.position as THREE.BufferAttribute;
  const home = world.fireflyHome;
  for (let i = 0; i < pos.count; i++) {
    const k = i * 1.37;
    pos.setXYZ(
      i,
      home[i * 3] + 0.25 * Math.sin(time * 0.6 + k),
      home[i * 3 + 1] + 0.18 * Math.sin(time * 0.9 + k * 2),
      home[i * 3 + 2] + 0.25 * Math.cos(time * 0.5 + k),
    );
  }
  pos.needsUpdate = true;
}

function setSharp(world: World, focus: "hero" | "flower" | null) {
  for (const o of world.sharp.hero) o.layers.set(focus === "hero" ? FOCUS_LAYER : 0);
  for (const o of world.sharp.flower) o.layers.set(focus === "flower" ? FOCUS_LAYER : 0);
}

function draw(e: Engine, tile: Tile, now: number) {
  const { renderer, camera, world } = e;
  const t = e.still.matches ? STILL_PHASE : ((now - tile.start) / 1000 / tile.period) % 1;
  const f = shotAt(tile.spec, t);
  poseHero(world.rig, f.hero, now / 1000);

  camera.fov = f.fov;
  camera.aspect = tile.w / tile.h;
  camera.position.set(...f.eye);
  camera.up.set(0, 1, 0);
  camera.lookAt(...f.target);
  if (f.roll) camera.rotateZ(f.roll);
  camera.updateProjectionMatrix();

  const buf = renderer.getSize(new THREE.Vector2());
  if (buf.x < tile.w || buf.y < tile.h) renderer.setSize(Math.max(buf.x, tile.w), Math.max(buf.y, tile.h), false);
  const src = renderer.domElement;
  const sy = src.height - tile.h;
  renderer.setViewport(0, 0, tile.w, tile.h);
  renderer.setScissor(0, 0, tile.w, tile.h);
  renderer.setScissorTest(true);
  const { ctx } = tile;

  if (f.blur > 0.05) {
    // Background first, blurred; then the subject alone on a clear buffer, drawn sharp over it.
    setSharp(world, f.focus);
    camera.layers.set(0);
    renderer.render(world.scene, camera);
    const px = f.blur * (tile.w / BLUR_BASE_WIDTH);
    ctx.filter = `blur(${px.toFixed(2)}px)`;
    ctx.drawImage(src, 0, sy, tile.w, tile.h, -px, -px, tile.w + px * 2, tile.h + px * 2);
    ctx.filter = "none";
    camera.layers.set(FOCUS_LAYER);
    renderer.render(world.scene, camera);
    ctx.drawImage(src, 0, sy, tile.w, tile.h, 0, 0, tile.w, tile.h);
    setSharp(world, null);
    camera.layers.set(0);
  } else {
    renderer.render(world.scene, camera);
    ctx.drawImage(src, 0, sy, tile.w, tile.h, 0, 0, tile.w, tile.h);
  }
  if (f.fade > 0) {
    ctx.fillStyle = `rgba(7, 6, 26, ${f.fade.toFixed(3)})`;
    ctx.fillRect(0, 0, tile.w, tile.h);
  }
}

function wants(tile: Tile, still: boolean) {
  return tile.visible && tile.w > 0 && tile.h > 0 && (!still || !tile.drawn);
}

function tick(now: number) {
  const e = engine;
  if (!e) return;
  e.raf = 0;
  if (e.lost) return;
  const still = e.still.matches;
  if (now - e.last >= 1000 / FPS - 2) {
    e.last = now;
    animateWorld(e.world, now / 1000);
    for (const tile of e.tiles) {
      if (!wants(tile, still)) continue;
      draw(e, tile, now);
      tile.drawn = true;
    }
  }
  for (const tile of e.tiles) {
    if (wants(tile, still)) {
      e.raf = requestAnimationFrame(tick);
      return;
    }
  }
}

function kick(e: Engine) {
  if (!e.raf && !e.lost) e.raf = requestAnimationFrame(tick);
}

// ── lifetime ──────────────────────────────────────────────────────────────

function create(): Engine | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    return null;
  }
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);
  const tileOf = new Map<Element, Tile>();
  const e: Engine = {
    renderer,
    camera: new THREE.PerspectiveCamera(38, 16 / 9, 0.02, 220),
    world: buildWorld(),
    tiles: new Set(),
    tileOf,
    io: new IntersectionObserver((entries) => {
      for (const en of entries) {
        const tile = tileOf.get(en.target);
        if (tile) tile.visible = en.isIntersecting;
      }
      kick(e);
    }, { rootMargin: "40px" }),
    ro: new ResizeObserver((entries) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const en of entries) {
        const tile = tileOf.get(en.target);
        if (!tile) continue;
        const w = Math.round(en.contentRect.width * dpr);
        const h = Math.round(en.contentRect.height * dpr);
        if (w === tile.w && h === tile.h) continue;
        tile.w = tile.canvas.width = w;
        tile.h = tile.canvas.height = h;
        tile.drawn = false;
      }
      kick(e);
    }),
    still: window.matchMedia("(prefers-reduced-motion: reduce)"),
    onStillChange: () => {
      for (const tile of e.tiles) tile.drawn = false;
      kick(e);
    },
    raf: 0,
    last: 0,
    lost: false,
    releaseTimer: null,
  };
  e.still.addEventListener("change", e.onStillChange);
  renderer.domElement.addEventListener("webglcontextlost", (ev) => {
    ev.preventDefault();
    e.lost = true;
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    e.lost = false;
    for (const tile of e.tiles) tile.drawn = false;
    kick(e);
  });
  return e;
}

function release(e: Engine) {
  if (engine !== e) return;
  engine = null;
  if (e.raf) cancelAnimationFrame(e.raf);
  e.io.disconnect();
  e.ro.disconnect();
  e.still.removeEventListener("change", e.onStillChange);
  e.world.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const mat of mats) {
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
  e.renderer.dispose();
  e.renderer.forceContextLoss();
}

/**
 * Starts drawing `spec` into `canvas` (sized by CSS). Returns the detach.
 * Without WebGL the canvas is marked `data-failed` and left alone.
 */
export function attachPreview(canvas: HTMLCanvasElement, spec: ShotSpec): () => void {
  if (!engine) engine = create();
  const e = engine;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!e || !ctx) {
    canvas.dataset.failed = "true";
    return () => {};
  }
  if (e.releaseTimer) {
    clearTimeout(e.releaseTimer);
    e.releaseTimer = null;
  }
  const { tileOf } = e;
  const tile: Tile = { canvas, ctx, spec, period: loopSeconds(spec), start: performance.now(), visible: false, w: 0, h: 0, drawn: false };
  e.tiles.add(tile);
  tileOf.set(canvas, tile);
  e.io.observe(canvas);
  e.ro.observe(canvas);
  return () => {
    e.tiles.delete(tile);
    tileOf.delete(canvas);
    e.io.unobserve(canvas);
    e.ro.unobserve(canvas);
    if (e.tiles.size === 0 && engine === e) e.releaseTimer = setTimeout(() => release(e), RELEASE_AFTER_MS);
  };
}
