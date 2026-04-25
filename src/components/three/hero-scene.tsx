"use client";

import { useRef, useMemo } from "react";
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

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = state.clock.elapsedTime * 0.15 * speed;
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.2 * speed;
    }
  });

  return (
    <Float speed={speed * 1.5} rotationIntensity={0.4} floatIntensity={2}>
      <mesh ref={meshRef} position={position}>
        <icosahedronGeometry args={[size, 6]} />
        <MeshDistortMaterial
          color={color}
          roughness={0.05}
          metalness={0.9}
          distort={distort}
          speed={1.5}
          transparent
          opacity={0.7}
          emissive={color}
          emissiveIntensity={0.15}
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
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 35;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 35;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 35;
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
    state.camera.position.x = Math.sin(t * 0.05) * 1.5;
    state.camera.position.y = Math.cos(t * 0.03) * 0.8;
    state.camera.lookAt(0, 0, 0);
  });
  return null;
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
    <div className="absolute inset-0 -z-10">
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
