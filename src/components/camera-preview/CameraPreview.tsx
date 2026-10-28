"use client";

import { useEffect, useRef } from "react";
import { parseShotKey, shotKey, type ShotSpec } from "@/lib/camera-shots";

// Outside the component: React Compiler cannot lower an import() inside one,
// and bailing out would switch the hooks checks off for the whole component.
const loadEngine = () => import("./engine");

/**
 * A small looping 3D view of one camera option. three.js and the scene load on
 * the first preview shown (they are large) and are shared by every preview on
 * the page — see `engine.ts`. Size it with CSS; it fills its box.
 */
export function CameraPreview({ shot, className, style }: { shot: ShotSpec; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // A string, so a new spec object with the same content does not restart the loop.
  const key = shotKey(shot);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let detach: (() => void) | null = null;
    let gone = false;
    loadEngine()
      .then(({ attachPreview }) => {
        if (!gone) detach = attachPreview(canvas, parseShotKey(key));
      })
      .catch(() => {
        canvas.dataset.failed = "true";
      });
    return () => {
      gone = true;
      detach?.();
    };
  }, [key]);

  return <canvas ref={ref} className={className} style={style} aria-hidden="true" />;
}
