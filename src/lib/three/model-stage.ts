/**
 * The 3D viewer behind /generate/3d and the gallery: a three.js scene that
 * shows one GLB with orbit controls, four looks (textured, clay, wireframe,
 * normals) and three lights, and tears itself down completely when its page
 * goes — a browser holds only a handful of WebGL contexts, and a viewer that
 * leaks one per visit ends with blank canvases.
 *
 * Plain TypeScript, not a component: the React side creates one, hands it
 * settings and disposes it. Failures come back as values, so the component
 * calling it needs no try/catch (React Compiler gives up on a component whose
 * try/catch holds a value block — see lib/client-actions.ts).
 *
 * Browser-only: import it from a client component.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type ViewMode = 'textured' | 'clay' | 'wire' | 'normal';
export type LightPreset = 'studio' | 'sunset' | 'neon';

export interface ModelStats {
  triangles: number;
  vertices: number;
  meshes: number;
  /** Largest texture side in pixels; 0 when the model has none. */
  textureSize: number;
  /** Size of the file that was loaded. */
  bytes: number;
  /** Width × height × depth, scaled so the largest is 1. */
  proportions: [number, number, number];
}

export type LoadResult =
  | { ok: true; stats: ModelStats }
  | { ok: false; aborted: true }
  | { ok: false; aborted: false; error: string };

/** The model's longest side, in scene units. Lights and shadows are set for it. */
const FIT_SIZE = 2;
/** Where the camera looks from: in front, a little right and above. */
const VIEW_DIRECTION = new THREE.Vector3(0.55, 0.32, 1).normalize();

const LIGHTS: Record<LightPreset, {
  env: number; exposure: number;
  hemi: [number, number, number];
  key: [number, number, [number, number, number]];
  fill: [number, number];
  rimA: [number, number];
  rimB: [number, number];
  glow: [number, number];
}> = {
  studio: { env: 1, exposure: 1, hemi: [0xffffff, 0x1e293b, 0.35], key: [0xffffff, 2, [3, 5, 4]], fill: [0x93c5fd, 0.35], rimA: [0x22d3ee, 0], rimB: [0xe879f9, 0], glow: [0x22d3ee, 0.3] },
  sunset: { env: 0.45, exposure: 1.05, hemi: [0xffd2a1, 0x2a1b3d, 0.18], key: [0xffa45c, 2.8, [4, 1.6, 2.5]], fill: [0x6d7cff, 0.5], rimA: [0xff6a3d, 1.2], rimB: [0xe879f9, 0], glow: [0xff9a5c, 0.35] },
  neon: { env: 0.3, exposure: 1.1, hemi: [0x67e8f9, 0x0b1020, 0.1], key: [0xffffff, 0.7, [3, 5, 4]], fill: [0x93c5fd, 0], rimA: [0x22d3ee, 3.2], rimB: [0xe879f9, 3.2], glow: [0xa855f7, 0.5] },
};

function isMesh(o: THREE.Object3D): o is THREE.Mesh {
  return (o as THREE.Mesh).isMesh === true;
}

function materialsOf(m: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(m) ? m : [m];
}

function texturesOf(m: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const value of Object.values(m)) {
    if (value && (value as THREE.Texture).isTexture) out.push(value as THREE.Texture);
  }
  return out;
}

function disposeMaterial(m: THREE.Material): void {
  for (const t of texturesOf(m)) t.dispose();
  m.dispose();
}

/** A soft round glow for under the model, drawn once. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ModelStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
  private readonly controls: OrbitControls;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envTexture: THREE.Texture;
  private readonly hemi = new THREE.HemisphereLight();
  private readonly key = new THREE.DirectionalLight();
  private readonly fill = new THREE.DirectionalLight();
  private readonly rimA = new THREE.DirectionalLight();
  private readonly rimB = new THREE.DirectionalLight();
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private readonly glow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly grid: THREE.GridHelper;
  private readonly looks: Record<'clay' | 'dark' | 'wire' | 'normal', THREE.Material>;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersection: IntersectionObserver;

  private placeholder: THREE.Group | null = null;
  private model: THREE.Object3D | null = null;
  private readonly originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private wires: THREE.Mesh[] = [];
  private mode: ViewMode = 'textured';
  private readonly home = { position: new THREE.Vector3(2.4, 1.5, 3.2), target: new THREE.Vector3(0, 1, 0) };
  private raf = 0;
  private last = 0;
  private onScreen = true;
  private disposed = false;
  private loadSeq = 0;
  private loading: AbortController | null = null;
  private interacted: (() => void) | null = null;

  /** A stage in `container`, or null when this browser cannot draw WebGL. */
  static create(container: HTMLElement): ModelStage | null {
    try {
      return new ModelStage(container);
    } catch {
      return null;
    }
  }

  private constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.setClearColor(0x000000, 0);
    const canvas = r.domElement;
    Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none', outline: 'none' });
    container.appendChild(canvas);

    this.pmrem = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment();
    this.envTexture = this.pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    this.scene.environment = this.envTexture;

    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -2.5;
    sc.right = sc.top = 2.5;
    sc.near = 0.5;
    sc.far = 20;
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 4;
    this.fill.position.set(-4, 2, -2);
    this.rimA.position.set(-3.5, 2.5, -3);
    this.rimB.position.set(3.5, 2.2, -3);
    this.scene.add(this.hemi, this.key, this.fill, this.rimA, this.rimB);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.32 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.glow = new THREE.Mesh(
      new THREE.CircleGeometry(1.7, 64),
      new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.002;
    this.grid = new THREE.GridHelper(12, 24, 0x22d3ee, 0x334155);
    const gridMaterial = this.grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.28;
    gridMaterial.depthWrite = false;
    this.grid.visible = false;
    this.scene.add(this.ground, this.glow, this.grid);

    this.looks = {
      clay: new THREE.MeshStandardMaterial({ color: 0xd6d3cd, roughness: 0.78, metalness: 0 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
      wire: new THREE.MeshBasicMaterial({ color: 0x67e8f9, wireframe: true, transparent: true, opacity: 0.4, depthWrite: false }),
      normal: new THREE.MeshNormalMaterial(),
    };

    this.controls = new OrbitControls(this.camera, canvas);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.autoRotateSpeed = 1.4;
    c.screenSpacePanning = true;
    c.maxPolarAngle = Math.PI * 0.92;
    c.addEventListener('start', this.onStart);
    c.addEventListener('change', this.kick);

    this.setLight('studio');
    this.setPlaceholder(true);
    this.goHome();

    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.intersection = new IntersectionObserver((entries) => {
      this.onScreen = entries.some((e) => e.isIntersecting);
      this.kick();
    });
    this.intersection.observe(container);
    document.addEventListener('visibilitychange', this.kick);
    this.resize();
  }

  /** Called once, the first time someone drags, pinches or scrolls the model. */
  onFirstInteraction(callback: () => void): void {
    this.interacted = callback;
  }

  /**
   * Fetch and show the GLB at `url` (same origin — the R2 bucket sends no CORS
   * headers). A newer call, `showEmpty` or `dispose` makes an older one resolve
   * as aborted, so a slow file never lands over the one picked after it.
   */
  async load(url: string): Promise<LoadResult> {
    const seq = ++this.loadSeq;
    this.loading?.abort();
    const ctrl = new AbortController();
    this.loading = ctrl;

    let buffer: ArrayBuffer;
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        const error =
          res.status === 410 ? 'ไฟล์โมเดลนี้หมดอายุและถูกลบแล้ว'
          : res.status === 429 ? 'เปิดโมเดลบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
          : 'โหลดไฟล์โมเดลไม่สำเร็จ';
        return { ok: false, aborted: false, error };
      }
      buffer = await res.arrayBuffer();
    } catch {
      if (ctrl.signal.aborted || seq !== this.loadSeq) return { ok: false, aborted: true };
      return { ok: false, aborted: false, error: 'โหลดไฟล์โมเดลไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' };
    }
    if (seq !== this.loadSeq || this.disposed) return { ok: false, aborted: true };

    let root: THREE.Object3D;
    try {
      root = (await new GLTFLoader().parseAsync(buffer, '')).scene;
    } catch {
      if (seq !== this.loadSeq || this.disposed) return { ok: false, aborted: true };
      return { ok: false, aborted: false, error: 'ไฟล์โมเดลเสียหรือเปิดไม่ได้' };
    }
    if (seq !== this.loadSeq || this.disposed) {
      this.disposeObject(root);
      return { ok: false, aborted: true };
    }

    this.clearModel();
    this.setPlaceholder(false);

    const raw = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    const longest = Math.max(raw.x, raw.y, raw.z) || 1;
    root.scale.setScalar(FIT_SIZE / longest);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -box.min.y, -center.z);

    let triangles = 0;
    let vertices = 0;
    let meshes = 0;
    let textureSize = 0;
    root.traverse((o) => {
      if (!isMesh(o)) return;
      meshes++;
      o.castShadow = true;
      o.receiveShadow = true;
      this.originals.set(o, o.material);
      const position = o.geometry.getAttribute('position');
      const count = position ? position.count : 0;
      vertices += count;
      triangles += o.geometry.index ? o.geometry.index.count / 3 : count / 3;
      for (const m of materialsOf(o.material)) {
        for (const t of texturesOf(m)) {
          const image = t.image as { width?: number; height?: number } | null | undefined;
          textureSize = Math.max(textureSize, image?.width ?? 0, image?.height ?? 0);
        }
      }
    });

    this.scene.add(root);
    this.model = root;
    this.applyMode();
    this.frame(new THREE.Box3().setFromObject(root));
    this.kick();

    return {
      ok: true,
      stats: {
        triangles: Math.round(triangles),
        vertices,
        meshes,
        textureSize,
        bytes: buffer.byteLength,
        proportions: [raw.x / longest, raw.y / longest, raw.z / longest],
      },
    };
  }

  /** Drop the model (and any load in flight) and show the idle hologram. */
  showEmpty(): void {
    this.loadSeq++;
    this.loading?.abort();
    this.loading = null;
    this.clearModel();
    this.setPlaceholder(true);
    this.home.position.set(2.4, 1.5, 3.2);
    this.home.target.set(0, 1, 0);
    this.goHome();
    this.kick();
  }

  setMode(mode: ViewMode): void {
    this.mode = mode;
    this.applyMode();
    this.kick();
  }

  setLight(preset: LightPreset): void {
    const p = LIGHTS[preset];
    this.scene.environmentIntensity = p.env;
    this.renderer.toneMappingExposure = p.exposure;
    this.hemi.color.setHex(p.hemi[0]);
    this.hemi.groundColor.setHex(p.hemi[1]);
    this.hemi.intensity = p.hemi[2];
    this.key.color.setHex(p.key[0]);
    this.key.intensity = p.key[1];
    this.key.position.set(...p.key[2]);
    this.fill.color.setHex(p.fill[0]);
    this.fill.intensity = p.fill[1];
    this.rimA.color.setHex(p.rimA[0]);
    this.rimA.intensity = p.rimA[1];
    this.rimB.color.setHex(p.rimB[0]);
    this.rimB.intensity = p.rimB[1];
    this.glow.material.color.setHex(p.glow[0]);
    this.glow.material.opacity = p.glow[1];
    this.kick();
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on;
    this.kick();
  }

  setGrid(on: boolean): void {
    this.grid.visible = on;
    this.kick();
  }

  /** Back to the view the model was framed with. */
  resetView(): void {
    this.goHome();
    this.kick();
  }

  /** The current view as a PNG with a transparent background. */
  snapshot(): Promise<Blob | null> {
    this.renderer.render(this.scene, this.camera);
    // toBlob copies the drawing buffer when it is called, so no
    // preserveDrawingBuffer (and its cost on every frame) is needed.
    return new Promise((resolve) => this.renderer.domElement.toBlob((b) => resolve(b), 'image/png'));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadSeq++;
    this.loading?.abort();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObserver.disconnect();
    this.intersection.disconnect();
    document.removeEventListener('visibilitychange', this.kick);
    this.controls.removeEventListener('start', this.onStart);
    this.controls.removeEventListener('change', this.kick);
    this.controls.dispose();
    this.clearModel();
    this.setPlaceholder(false);
    for (const m of Object.values(this.looks)) m.dispose();
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.glow.geometry.dispose();
    disposeMaterial(this.glow.material);
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.envTexture.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    // Hand the context back now rather than whenever the GC gets to it.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // ─── internals ────────────────────────────────────────────────────────

  private readonly onStart = () => {
    const cb = this.interacted;
    this.interacted = null;
    cb?.();
  };

  private readonly resize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.kick();
  };

  /** Start the loop if it is stopped and anything could be seen. */
  private readonly kick = () => {
    if (this.raf || this.disposed || !this.onScreen || document.hidden) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.tick);
  };

  /**
   * One frame. The loop keeps running while something moves — auto-rotate,
   * the hologram, damping settling after a drag — and stops otherwise, so a
   * still model on an open tab costs nothing.
   */
  private readonly tick = (now: number) => {
    this.raf = 0;
    if (this.disposed || !this.onScreen || document.hidden) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    if (this.placeholder) {
      this.placeholder.rotation.y += dt * 0.5;
      this.placeholder.children[1].rotation.x += dt * 0.7;
      this.placeholder.children[2].rotation.z += dt * 0.35;
      this.placeholder.position.y = 1 + Math.sin(now / 900) * 0.05;
    }
    const moved = this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
    if (moved || this.controls.autoRotate || this.placeholder) {
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  /** Point the camera at `box` from the usual angle, close enough to fill the view. */
  private frame(box: THREE.Box3): void {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const distance = (sphere.radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.05;
    this.home.target.copy(sphere.center);
    this.home.position.copy(sphere.center).addScaledVector(VIEW_DIRECTION, distance);
    this.camera.near = distance / 100;
    this.camera.far = distance * 30;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = sphere.radius * 0.35;
    this.controls.maxDistance = distance * 4;
    this.goHome();
  }

  private goHome(): void {
    this.camera.position.copy(this.home.position);
    this.controls.target.copy(this.home.target);
    this.controls.update();
  }

  private applyMode(): void {
    for (const w of this.wires) w.removeFromParent();
    this.wires = [];
    for (const [mesh, original] of this.originals) {
      switch (this.mode) {
        case 'textured':
          mesh.material = original;
          break;
        case 'clay':
          mesh.material = this.looks.clay;
          break;
        case 'normal':
          mesh.material = this.looks.normal;
          break;
        case 'wire': {
          mesh.material = this.looks.dark;
          // Shares the mesh's geometry, so removing it frees nothing extra.
          const overlay = new THREE.Mesh(mesh.geometry, this.looks.wire);
          mesh.add(overlay);
          this.wires.push(overlay);
          break;
        }
      }
    }
  }

  private clearModel(): void {
    for (const w of this.wires) w.removeFromParent();
    this.wires = [];
    if (!this.model) return;
    // Put the model's own materials back first so they are the ones disposed;
    // the shared looks belong to the stage.
    for (const [mesh, original] of this.originals) mesh.material = original;
    this.originals.clear();
    this.model.removeFromParent();
    this.disposeObject(this.model);
    this.model = null;
  }

  private disposeObject(root: THREE.Object3D): void {
    root.traverse((o) => {
      if (!isMesh(o)) return;
      o.geometry.dispose();
      for (const m of materialsOf(o.material)) disposeMaterial(m);
    });
  }

  private setPlaceholder(on: boolean): void {
    if (on && !this.placeholder) {
      const group = new THREE.Group();
      const ico = new THREE.IcosahedronGeometry(0.62, 1);
      const shell = new THREE.LineSegments(
        new THREE.WireframeGeometry(ico),
        new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.5 })
      );
      ico.dispose();
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.28, 0),
        new THREE.MeshStandardMaterial({ color: 0x0e7490, emissive: 0x7c3aed, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.6, flatShading: true })
      );
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.95, 0.008, 8, 160),
        new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.65 })
      );
      ring.rotation.x = Math.PI / 2.4;
      group.add(shell, core, ring);
      group.position.y = 1;
      this.scene.add(group);
      this.placeholder = group;
    } else if (!on && this.placeholder) {
      const group = this.placeholder;
      this.placeholder = null;
      group.removeFromParent();
      group.traverse((o) => {
        const item = o as THREE.Mesh | THREE.LineSegments;
        if (!('geometry' in item) || !item.geometry) return;
        item.geometry.dispose();
        for (const m of materialsOf(item.material)) m.dispose();
      });
    }
  }
}
