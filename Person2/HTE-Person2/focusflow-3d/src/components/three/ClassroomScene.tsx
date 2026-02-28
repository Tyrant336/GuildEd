"use client";

import React from "react";
import { useRef, useState, useMemo, useEffect, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  Text,
  Float,
  useGLTF,
  useAnimations,
} from "@react-three/drei";
import * as THREE from "three";
import { useFocusFlowStore } from "@/store/useFocusFlowStore";

// ─── Mastery Color Helper ───────────────────────────────────────────────────

function getMasteryColor(mastery: number): string {
  if (mastery >= 70) return "#22c55e"; // green
  if (mastery >= 30) return "#eab308"; // yellow
  return "#ef4444"; // red
}

// ─── GLB Classroom Environment ──────────────────────────────────────────────

function ClassroomModel({ dimLevel = 0 }: { dimLevel?: number }) {
  const { scene } = useGLTF("/models/classroom.glb");
  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    clonedScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [clonedScene]);

  const ambientIntensity = 0.6 - dimLevel * 0.3;

  return (
    <group>
      <primitive object={clonedScene} scale={1.5} position={[0, -0.5, 0]} />
      <ambientLight intensity={ambientIntensity} color="#ffeedd" />
      <directionalLight
        position={[5, 8, 5]}
        intensity={0.8 - dimLevel * 0.4}
        castShadow
        shadow-mapSize={1024}
      />
      <pointLight position={[-3, 3, 2]} intensity={0.4} color="#ffd4a0" />
    </group>
  );
}

// ─── Fallback Room (flat planes if GLB fails) ───────────────────────────────

function FallbackRoom({ dimLevel = 0 }: { dimLevel?: number }) {
  const ambientIntensity = 0.6 - dimLevel * 0.3;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[12, 10]} />
        <meshStandardMaterial color="#b8a88a" roughness={0.8} />
      </mesh>
      <mesh position={[0, 2, -5]} receiveShadow>
        <planeGeometry args={[12, 5]} />
        <meshStandardMaterial color="#d4c5a9" roughness={0.9} />
      </mesh>
      <mesh position={[-6, 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color="#c9bba0" roughness={0.9} />
      </mesh>
      <mesh position={[6, 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color="#c9bba0" roughness={0.9} />
      </mesh>
      <ambientLight intensity={ambientIntensity} color="#ffeedd" />
      <directionalLight position={[5, 8, 5]} intensity={0.8 - dimLevel * 0.4} castShadow shadow-mapSize={1024} />
      <pointLight position={[-3, 3, 2]} intensity={0.4} color="#ffd4a0" />
    </group>
  );
}

// ─── Animated GLB Character ─────────────────────────────────────────────────

function AnimatedCharacter({
  url,
  position,
  scale = 1,
  rotation = [0, 0, 0],
}: {
  url: string;
  position: [number, number, number];
  scale?: number;
  rotation?: [number, number, number];
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(url);
  const clonedScene = useMemo(() => scene.clone(true), [scene]);
  const { actions } = useAnimations(animations, groupRef);

  useEffect(() => {
    clonedScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [clonedScene]);

  // Play the first available animation (idle)
  useEffect(() => {
    const actionNames = Object.keys(actions);
    if (actionNames.length > 0 && actions[actionNames[0]]) {
      actions[actionNames[0]]!.reset().fadeIn(0.5).play();
    }
    return () => {
      actionNames.forEach((name) => actions[name]?.fadeOut(0.5));
    };
  }, [actions]);

  return (
    <group ref={groupRef} position={position} scale={scale} rotation={rotation}>
      <primitive object={clonedScene} />
    </group>
  );
}

// ─── Interactive Clickable Hotspot ──────────────────────────────────────────

interface HotspotProps {
  position: [number, number, number];
  size: [number, number, number];
  label: string;
  panelId: string;
  mastery?: number;
  locked?: boolean;
  visible?: boolean;
  color?: string;
  hoverColor?: string;
}

function Hotspot({
  position,
  size,
  label,
  panelId,
  mastery,
  locked = false,
  visible = true,
  color = "#ffffff",
  hoverColor = "#60a5fa",
}: HotspotProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const setActivePanel = useFocusFlowStore((s) => s.setActivePanel);

  const displayColor = useMemo(() => {
    if (locked) return "#6b7280";
    if (hovered) return hoverColor;
    if (mastery !== undefined) return getMasteryColor(mastery);
    return color;
  }, [locked, hovered, hoverColor, mastery, color]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    if (hovered && !locked) {
      meshRef.current.position.y = position[1] + Math.sin(Date.now() * 0.003) * 0.05;
    } else {
      meshRef.current.position.y = THREE.MathUtils.lerp(
        meshRef.current.position.y,
        position[1],
        delta * 5
      );
    }
  });

  return (
    <group>
      <mesh
        ref={meshRef}
        position={position}
        onPointerOver={(e) => {
          e.stopPropagation();
          if (!locked) {
            setHovered(true);
            document.body.style.cursor = "pointer";
          }
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (!locked) setActivePanel(panelId);
        }}
        castShadow
        receiveShadow
      >
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={displayColor}
          emissive={hovered && !locked ? displayColor : "#000000"}
          emissiveIntensity={hovered ? 0.3 : 0}
          roughness={0.4}
          metalness={0.1}
          transparent={!visible}
          opacity={visible ? 1 : 0.15}
        />
      </mesh>
      <Text
        position={[position[0], position[1] + size[1] / 2 + 0.3, position[2]]}
        fontSize={0.18}
        color={locked ? "#9ca3af" : "#ffffff"}
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.02}
        outlineColor="#000000"
      >
        {locked ? `🔒 ${label}` : label}
      </Text>
      {mastery !== undefined && !locked && (
        <mesh
          position={[
            position[0] + size[0] / 2 + 0.15,
            position[1] + size[1] / 2,
            position[2],
          ]}
        >
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial
            color={getMasteryColor(mastery)}
            emissive={getMasteryColor(mastery)}
            emissiveIntensity={0.5}
          />
        </mesh>
      )}
    </group>
  );
}

// ─── AI Tutor (Teacher GLB or fallback avatar) ─────────────────────────────

function AITutorCharacter() {
  const setActivePanel = useFocusFlowStore((s) => s.setActivePanel);
  const [hovered, setHovered] = useState(false);

  return (
    <Float speed={2} rotationIntensity={0.1} floatIntensity={0.3}>
      <group
        position={[3.5, -0.5, -2]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
        onClick={(e) => {
          e.stopPropagation();
          setActivePanel("tutor");
        }}
      >
        <AnimatedCharacter
          url="/models/teacher.glb"
          position={[0, 0, 0]}
          scale={0.8}
          rotation={[0, -Math.PI / 4, 0]}
        />
        {/* Glow ring when hovered */}
        {hovered && (
          <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.5, 0.7, 32]} />
            <meshBasicMaterial color="#60a5fa" transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
        )}
        <Text
          position={[0, 2.2, 0]}
          fontSize={0.2}
          color="#ffffff"
          anchorX="center"
          outlineWidth={0.02}
          outlineColor="#000000"
        >
          AI Tutor
        </Text>
      </group>
    </Float>
  );
}

// ─── Fallback AI Tutor (sphere + capsule if GLB fails) ─────────────────────

function FallbackTutor() {
  const setActivePanel = useFocusFlowStore((s) => s.setActivePanel);
  const [hovered, setHovered] = useState(false);

  return (
    <Float speed={2} rotationIntensity={0.2} floatIntensity={0.5}>
      <group
        position={[4, 1.5, -2]}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = "auto"; }}
        onClick={(e) => { e.stopPropagation(); setActivePanel("tutor"); }}
      >
        <mesh position={[0, 0.5, 0]} castShadow>
          <sphereGeometry args={[0.3, 32, 32]} />
          <meshStandardMaterial
            color={hovered ? "#60a5fa" : "#a78bfa"}
            emissive={hovered ? "#60a5fa" : "#a78bfa"}
            emissiveIntensity={hovered ? 0.5 : 0.2}
          />
        </mesh>
        <mesh position={[0, 0, 0]} castShadow>
          <capsuleGeometry args={[0.2, 0.4, 8, 16]} />
          <meshStandardMaterial
            color={hovered ? "#818cf8" : "#7c3aed"}
            emissive={hovered ? "#818cf8" : "#7c3aed"}
            emissiveIntensity={hovered ? 0.4 : 0.15}
          />
        </mesh>
        <Text position={[0, 1.0, 0]} fontSize={0.18} color="#ffffff" anchorX="center" outlineWidth={0.02} outlineColor="#000000">
          AI Tutor
        </Text>
      </group>
    </Float>
  );
}

// ─── Student Character ──────────────────────────────────────────────────────

function StudentCharacter() {
  return (
    <AnimatedCharacter
      url="/models/character.glb"
      position={[0, -0.5, 1.5]}
      scale={0.7}
      rotation={[0, Math.PI, 0]}
    />
  );
}

// ─── Error Boundary Wrapper for GLB Loading ─────────────────────────────────

function GLBWithFallback({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

// ─── Loading Indicator ──────────────────────────────────────────────────────

function LoadingSpinner() {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta * 2;
  });
  return (
    <mesh ref={meshRef} position={[0, 1, 0]}>
      <torusGeometry args={[0.5, 0.1, 8, 32]} />
      <meshBasicMaterial color="#60a5fa" wireframe />
    </mesh>
  );
}

// ─── Main Classroom Scene ───────────────────────────────────────────────────

function ClassroomContent() {
  const cogState = useFocusFlowStore((s) => s.learnerState.cognitive_state);
  const learnerState = useFocusFlowStore((s) => s.learnerState);

  const dimLevel = cogState === "focused" ? 0.4 : cogState === "drifting" ? -0.1 : 0;

  const avgMastery = useMemo(() => {
    const vals = Object.values(learnerState.concepts);
    if (vals.length === 0) return 50;
    return vals.reduce((sum, c) => sum + c.mastery, 0) / vals.length;
  }, [learnerState.concepts]);

  return (
    <>
      {/* 3D Classroom Environment — GLB with flat-plane fallback */}
      <GLBWithFallback fallback={<FallbackRoom dimLevel={dimLevel} />}>
        <ClassroomModel dimLevel={dimLevel} />
      </GLBWithFallback>

      {/* Interactive Hotspots (clickable zones on top of classroom) */}
      <Hotspot
        position={[0, 1.5, -4.9]}
        size={[3, 1.8, 0.1]}
        color="#f5f5f5"
        hoverColor="#dbeafe"
        label="Whiteboard"
        panelId="whiteboard"
        mastery={avgMastery}
        visible={false}
      />

      <Hotspot
        position={[0, 0.1, 0]}
        size={[2, 0.6, 1.2]}
        color="#8b6f47"
        hoverColor="#a0845c"
        label="Desk"
        panelId="study"
        visible={false}
      />

      <Hotspot
        position={[5.5, 1, -2]}
        size={[0.6, 2, 1.5]}
        color="#654321"
        hoverColor="#7a5630"
        label="Bookshelf"
        panelId="bookshelf"
        visible={false}
      />

      <Hotspot
        position={[-4, 0.1, -1]}
        size={[2, 0.7, 1]}
        color="#4a7c59"
        hoverColor="#5a9c6d"
        label="Lab Bench"
        panelId="challenge"
        visible={false}
      />

      <Hotspot
        position={[-5.5, 1.5, 1]}
        size={[0.1, 1.5, 1.5]}
        color="#1e40af"
        hoverColor="#3b82f6"
        label="Quiz Board"
        panelId="quiz"
        visible={false}
      />

      <Hotspot
        position={[5.5, 2, 2]}
        size={[0.1, 1.5, 2]}
        color="#87ceeb"
        hoverColor="#bae6fd"
        label="Progress"
        panelId="progress"
        visible={false}
      />

      {/* AI Tutor — Teacher GLB with fallback avatar */}
      <GLBWithFallback fallback={<FallbackTutor />}>
        <AITutorCharacter />
      </GLBWithFallback>

      {/* Student Character — sitting at desk */}
      <GLBWithFallback fallback={null}>
        <StudentCharacter />
      </GLBWithFallback>

      <OrbitControls
        enablePan={false}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={3}
        maxDistance={10}
        target={[0, 1, 0]}
      />
    </>
  );
}

// ─── Error Boundary for WebGL/Canvas Crashes ─────────────────────────────────

class CanvasErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-[#1a1a2e] to-[#16213e] text-white p-8">
          <div className="text-center max-w-md">
            <div className="text-4xl mb-4">&#x1F3EB;</div>
            <h2 className="text-xl font-bold mb-2">3D Classroom Unavailable</h2>
            <p className="text-white/70 mb-4">
              Your browser may not support WebGL, or the 3D scene failed to load.
              You can still use all learning features through the panels below.
            </p>
            <p className="text-xs text-white/40">{this.state.error?.message}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ClassroomScene() {
  return (
    <CanvasErrorBoundary>
      <Canvas
        shadows
        camera={{ position: [0, 3, 6], fov: 60 }}
        style={{ background: "linear-gradient(to bottom, #1a1a2e, #16213e)" }}
      >
        <Suspense fallback={<LoadingSpinner />}>
          <ClassroomContent />
        </Suspense>
      </Canvas>
    </CanvasErrorBoundary>
  );
}

// Preload GLB assets
useGLTF.preload("/models/classroom.glb");
useGLTF.preload("/models/teacher.glb");
useGLTF.preload("/models/character.glb");
