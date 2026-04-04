"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Float,
  MeshDistortMaterial,
  MeshWobbleMaterial,
  Sparkles,
  Stars,
  OrbitControls,
} from "@react-three/drei";
import * as THREE from "three";

function FloatingOrb({ position, color, size = 1, speed = 1 }: {
  position: [number, number, number];
  color: string;
  size?: number;
  speed?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = state.clock.elapsedTime * 0.2 * speed;
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.3 * speed;
    }
  });

  return (
    <Float speed={speed * 2} rotationIntensity={0.5} floatIntensity={1.5}>
      <mesh ref={meshRef} position={position}>
        <icosahedronGeometry args={[size, 4]} />
        <MeshDistortMaterial
          color={color}
          roughness={0.1}
          metalness={0.8}
          distort={0.3}
          speed={2}
          transparent
          opacity={0.8}
        />
      </mesh>
    </Float>
  );
}

function WobblyTorus({ position }: { position: [number, number, number] }) {
  return (
    <Float speed={1.5} rotationIntensity={1} floatIntensity={1}>
      <mesh position={position} rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[1.2, 0.3, 32, 64]} />
        <MeshWobbleMaterial
          color="#06b6d4"
          roughness={0.1}
          metalness={0.9}
          factor={0.3}
          speed={2}
          transparent
          opacity={0.6}
        />
      </mesh>
    </Float>
  );
}

function ParticleField() {
  const count = 500;
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    return pos;
  }, []);

  const ref = useRef<THREE.Points>(null!);

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.02;
      ref.current.rotation.x = state.clock.elapsedTime * 0.01;
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
        color="#6366f1"
        size={0.03}
        transparent
        opacity={0.6}
        sizeAttenuation
      />
    </points>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={1} color="#6366f1" />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="#06b6d4" />
      <spotLight position={[0, 10, 0]} intensity={0.8} angle={0.6} penumbra={1} color="#f472b6" />

      {/* Main orbs */}
      <FloatingOrb position={[0, 0, 0]} color="#6366f1" size={1.5} speed={0.8} />
      <FloatingOrb position={[3, 1, -2]} color="#06b6d4" size={0.8} speed={1.2} />
      <FloatingOrb position={[-3, -1, -1]} color="#f472b6" size={0.6} speed={1} />
      <FloatingOrb position={[2, -2, 1]} color="#818cf8" size={0.4} speed={1.5} />

      {/* Torus ring */}
      <WobblyTorus position={[-2, 2, -3]} />

      {/* Particles */}
      <ParticleField />
      <Sparkles count={100} scale={15} size={2} speed={0.3} color="#6366f1" />

      {/* Background stars */}
      <Stars radius={50} depth={50} count={2000} factor={3} saturation={0.5} fade speed={0.5} />

      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate
        autoRotateSpeed={0.5}
        maxPolarAngle={Math.PI / 1.5}
        minPolarAngle={Math.PI / 3}
      />
    </>
  );
}

export function HeroScene() {
  return (
    <div className="absolute inset-0 -z-10">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 60 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
