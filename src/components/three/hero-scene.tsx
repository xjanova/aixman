"use client";

import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Float,
  MeshDistortMaterial,
  MeshWobbleMaterial,
  Sparkles,
  Stars,
} from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  ChromaticAberration,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";

const CA_OFFSET = new THREE.Vector2(0.0005, 0.0005);

// Fade thresholds — orb is fully solid past `farDist`, fully sheer (almost
// invisible) past `nearDist`. Linear ramp between the two.
const ORB_NEAR_DIST = 1.6; // camera within this distance → orb fades to nearOpacity
const ORB_FAR_DIST = 5.5;  // camera beyond this → orb at full opacity
const ORB_NEAR_OPACITY = 0.08;
const ORB_FAR_OPACITY = 0.92;

function FloatingOrb({
  position,
  color,
  size = 1,
  speed = 1,
  distort = 0.3,
}: {
  position: [number, number, number];
  color: string;
  size?: number;
  speed?: number;
  distort?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  // drei MeshDistortMaterial doesn't expose its impl type cleanly — keep
  // it loose; we only ever read/write opacity + emissiveIntensity which
  // are present on every Material derivative.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matRef = useRef<any>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = state.clock.elapsedTime * 0.15 * speed;
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.2 * speed;
    }
    // Per-orb fade-on-zoom: opacity drops as the auto-orbiting camera
    // approaches this orb's world position. Each orb gets its own fade,
    // so they pulse in/out as the camera glides past.
    if (matRef.current && meshRef.current) {
      const worldPos = meshRef.current.getWorldPosition(new THREE.Vector3());
      const dist = state.camera.position.distanceTo(worldPos);
      const t = THREE.MathUtils.clamp(
        (dist - ORB_NEAR_DIST) / (ORB_FAR_DIST - ORB_NEAR_DIST),
        0,
        1,
      );
      const op = THREE.MathUtils.lerp(ORB_NEAR_OPACITY, ORB_FAR_OPACITY, t);
      matRef.current.opacity = op;
      if ("emissiveIntensity" in matRef.current && matRef.current.emissiveIntensity !== undefined) {
        matRef.current.emissiveIntensity = THREE.MathUtils.lerp(0.05, 0.35, t);
      }
    }
  });

  return (
    <Float speed={speed * 1.5} rotationIntensity={0.4} floatIntensity={2}>
      <mesh ref={meshRef} position={position}>
        <icosahedronGeometry args={[size, 6]} />
        <MeshDistortMaterial
          ref={matRef}
          color={color}
          roughness={0.05}
          metalness={0.9}
          distort={distort}
          speed={1.5}
          transparent
          opacity={ORB_FAR_OPACITY}
          emissive={color}
          emissiveIntensity={0.35}
        />
      </mesh>
    </Float>
  );
}

function DreamRing({
  position,
  color,
  radius = 1.2,
}: {
  position: [number, number, number];
  color: string;
  radius?: number;
}) {
  const ref = useRef<THREE.Mesh>(null!);

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.x =
        Math.PI / 3 + Math.sin(state.clock.elapsedTime * 0.3) * 0.2;
      ref.current.rotation.z = state.clock.elapsedTime * 0.15;
    }
  });

  return (
    <Float speed={1.2} rotationIntensity={0.8} floatIntensity={1.5}>
      <mesh ref={ref} position={position}>
        <torusGeometry args={[radius, 0.08, 32, 100]} />
        <MeshWobbleMaterial
          color={color}
          roughness={0.05}
          metalness={0.95}
          factor={0.15}
          speed={1}
          transparent
          opacity={0.5}
          emissive={color}
          emissiveIntensity={0.3}
        />
      </mesh>
    </Float>
  );
}

function ParticleField() {
  const count = 600;
  // Deterministic PRNG (mulberry32) so React's purity check is happy and
  // particle positions are stable across re-renders / SSR hydration.
  const positions = useMemo(() => {
    let seed = 0x9e3779b9;
    const rand = () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() - 0.5) * 35;
      pos[i * 3 + 1] = (rand() - 0.5) * 35;
      pos[i * 3 + 2] = (rand() - 0.5) * 35;
    }
    return pos;
  }, []);

  const ref = useRef<THREE.Points>(null!);

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.015;
      ref.current.rotation.x = state.clock.elapsedTime * 0.008;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#60A5FA"
        size={0.025}
        transparent
        opacity={0.5}
        sizeAttenuation
      />
    </points>
  );
}

function AutoCamera() {
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Slow horizontal/vertical drift + slow zoom cycle so the camera
    // periodically sails close to each orb. Combined with the per-orb
    // distance-based opacity, orbs gently fade as the camera passes.
    state.camera.position.x = Math.sin(t * 0.07) * 3.2;
    state.camera.position.y = Math.cos(t * 0.05) * 1.6;
    state.camera.position.z = 8 + Math.sin(t * 0.04) * 4; // 4..12
    state.camera.lookAt(0, 0, 0);
  });
  return null;
}

// ─── Electric pulse — fires on every network request ──────────────────
//
// On `app:network:start` window event we pick two random orbs and
// dispatch an arc: a bright dot travels along the line between them
// (~0.6 s travel), then the destination flashes for ~1.9 s with a
// pulsing emissive halo. Total cycle ≥ 2 s so the eye can catch it,
// and animation runs inside the R3F render loop so it stays smooth
// (no React re-renders per frame).
//
// Simultaneous fetches stack — multiple arcs render concurrently.

const ORB_POSITIONS: [number, number, number][] = [
  [0, 0.3, 0],
  [3.5, 1.2, -2],
  [-3, -0.5, -1.5],
  [2.5, -2, 1],
  [-2, 2.5, -2.5],
];

type Pulse = {
  id: number;
  from: [number, number, number];
  to: [number, number, number];
  duration: number;
  travelDuration: number;
};

function ElectricPulse({
  from, to, duration, travelDuration, onExpire,
}: Pulse & { onExpire: () => void }) {
  const startRef = useRef<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineMatRef = useRef<any>(null);
  const dotRef = useRef<THREE.Mesh>(null!);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dotMatRef = useRef<any>(null);
  const flashRef = useRef<THREE.Mesh>(null!);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flashMatRef = useRef<any>(null);

  const fromVec = useMemo(() => new THREE.Vector3(...from), [from]);
  const toVec = useMemo(() => new THREE.Vector3(...to), [to]);

  // Static line geometry between the two orbs
  const lineGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([...from, ...to]),
        3,
      ),
    );
    return g;
  }, [from, to]);

  useFrame((state) => {
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - startRef.current;

    if (elapsed > duration) {
      onExpire();
      return;
    }

    if (elapsed < travelDuration) {
      // Phase 1: travelling dot
      const t = elapsed / travelDuration;
      const pos = fromVec.clone().lerp(toVec, t);
      if (dotRef.current) {
        dotRef.current.position.copy(pos);
      }
      if (dotMatRef.current) dotMatRef.current.opacity = 1;
      if (flashMatRef.current) flashMatRef.current.opacity = 0;
    } else {
      // Phase 2: flash at destination
      const flashElapsed = elapsed - travelDuration;
      const flashTotal = duration - travelDuration;
      const flashT = flashElapsed / flashTotal;
      // 4 Hz pulse with decay envelope
      const pulse = (Math.sin(flashElapsed * Math.PI * 4) * 0.5 + 0.5) * (1 - flashT);
      if (dotMatRef.current) dotMatRef.current.opacity = 0;
      if (flashRef.current) flashRef.current.scale.setScalar(0.6 + pulse * 0.8);
      if (flashMatRef.current) flashMatRef.current.opacity = pulse * 0.85;
    }

    // Connecting line gently fades over the whole cycle
    if (lineMatRef.current) {
      lineMatRef.current.opacity = (1 - elapsed / duration) * 0.55;
    }
  });

  return (
    <group>
      {/* lineSegments (not line) — TS intrinsic <line> maps to SVGLineElement */}
      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial
          ref={lineMatRef}
          color="#a5f3fc"
          transparent
          opacity={0.55}
        />
      </lineSegments>

      <mesh ref={dotRef} position={from}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshBasicMaterial
          ref={dotMatRef}
          color="#ffffff"
          transparent
          opacity={1}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh ref={flashRef} position={to}>
        <sphereGeometry args={[0.5, 24, 24]} />
        <meshBasicMaterial
          ref={flashMatRef}
          color="#a5f3fc"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function ElectricArcs() {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const idRef = useRef(0);

  const removePulse = useCallback((id: number) => {
    setPulses((prev) => prev.filter((p) => p.id !== id));
  }, []);

  useEffect(() => {
    const handler = () => {
      if (ORB_POSITIONS.length < 2) return;
      const fromIdx = Math.floor(Math.random() * ORB_POSITIONS.length);
      let toIdx = Math.floor(Math.random() * ORB_POSITIONS.length);
      while (toIdx === fromIdx) {
        toIdx = Math.floor(Math.random() * ORB_POSITIONS.length);
      }
      idRef.current += 1;
      const id = idRef.current;
      setPulses((prev) => [
        ...prev,
        {
          id,
          from: ORB_POSITIONS[fromIdx],
          to: ORB_POSITIONS[toIdx],
          duration: 2.5,        // ≥ 2 s end-to-end so the user sees the flash
          travelDuration: 0.6,
        },
      ]);
    };
    window.addEventListener("app:network:start", handler);
    return () => window.removeEventListener("app:network:start", handler);
  }, []);

  return (
    <>
      {pulses.map((p) => (
        <ElectricPulse
          key={p.id}
          {...p}
          onExpire={() => removePulse(p.id)}
        />
      ))}
    </>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.2} />
      <pointLight position={[10, 10, 10]} intensity={1.2} color="#3B82F6" />
      <pointLight
        position={[-10, -10, -10]}
        intensity={0.6}
        color="#8B5CF6"
      />
      <pointLight position={[0, 10, -5]} intensity={0.4} color="#06B6D4" />

      {/* Main blue orb */}
      <FloatingOrb
        position={[0, 0.3, 0]}
        color="#3B82F6"
        size={1.8}
        speed={0.5}
        distort={0.35}
      />
      {/* Purple orb */}
      <FloatingOrb
        position={[3.5, 1.2, -2]}
        color="#8B5CF6"
        size={0.9}
        speed={0.8}
        distort={0.25}
      />
      {/* Cyan orb */}
      <FloatingOrb
        position={[-3, -0.5, -1.5]}
        color="#06B6D4"
        size={0.7}
        speed={1}
        distort={0.2}
      />
      {/* Small accent orbs */}
      <FloatingOrb
        position={[2.5, -2, 1]}
        color="#60A5FA"
        size={0.35}
        speed={1.3}
      />
      <FloatingOrb
        position={[-2, 2.5, -2.5]}
        color="#A78BFA"
        size={0.4}
        speed={1.1}
      />

      {/* Electric pulses (fires on every network request) */}
      <ElectricArcs />

      {/* Dreamy rings */}
      <DreamRing position={[-2.5, 1.5, -3]} color="#3B82F6" radius={1.5} />
      <DreamRing position={[2, -1.5, -2]} color="#8B5CF6" radius={0.9} />

      {/* Particles */}
      <ParticleField />
      <Sparkles
        count={120}
        scale={18}
        size={2.5}
        speed={0.2}
        color="#60A5FA"
      />
      <Sparkles
        count={60}
        scale={15}
        size={1.5}
        speed={0.15}
        color="#A78BFA"
      />

      {/* Deep starfield */}
      <Stars
        radius={60}
        depth={60}
        count={2500}
        factor={3}
        saturation={0.3}
        fade
        speed={0.3}
      />

      {/* Auto-orbiting camera */}
      <AutoCamera />

      {/* Post-processing */}
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.2}
          luminanceSmoothing={0.9}
          intensity={0.8}
          mipmapBlur
        />
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={CA_OFFSET}
        />
      </EffectComposer>
    </>
  );
}

export function HeroScene() {
  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 60 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ background: "transparent" }}
        dpr={[1, 1.5]}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
