"use client";

/**
 * <ModelViewer> — the React face of lib/three/model-stage.ts.
 *
 * The stage owns the WebGL context and everything in it; this component makes
 * one when it mounts, hands it the current settings, loads `src` whenever it
 * changes, and disposes the stage when it unmounts. What it draws on top is
 * only state: a loading ring, a failure with a retry, and a one-time hint on
 * how to move the camera.
 */

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ModelStage, type LightPreset, type LoadResult, type ModelStats, type ViewMode } from "@/lib/three/model-stage";

export type { LightPreset, ModelStats, ViewMode };

export interface ModelViewerHandle {
  resetView(): void;
  /** The current view as a transparent PNG, or null if it could not be drawn. */
  snapshot(): Promise<Blob | null>;
}

interface Loaded {
  src: string;
  attempt: number;
  result: LoadResult;
}

export function ModelViewer({
  src,
  mode = "textured",
  light = "studio",
  autoRotate = false,
  grid = false,
  onStats,
  ref,
}: {
  /** Same-origin URL of a GLB, or null to show the idle hologram. */
  src: string | null;
  mode?: ViewMode;
  light?: LightPreset;
  autoRotate?: boolean;
  grid?: boolean;
  /** Called after each successful load. */
  onStats?: (stats: ModelStats | null) => void;
  ref?: Ref<ModelViewerHandle>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<ModelStage | null>(null);
  const onStatsRef = useRef(onStats);
  const [noWebGl, setNoWebGl] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [hinted, setHinted] = useState(false);

  useEffect(() => {
    onStatsRef.current = onStats;
  }, [onStats]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const stage = ModelStage.create(host);
    if (!stage) {
      // Known only once the browser has been asked for a context.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNoWebGl(true);
      return;
    }
    stage.onFirstInteraction(() => setHinted(true));
    stageRef.current = stage;
    return () => {
      stageRef.current = null;
      stage.dispose();
    };
  }, []);

  useEffect(() => { stageRef.current?.setMode(mode); }, [mode]);
  useEffect(() => { stageRef.current?.setLight(light); }, [light]);
  useEffect(() => { stageRef.current?.setAutoRotate(autoRotate); }, [autoRotate]);
  useEffect(() => { stageRef.current?.setGrid(grid); }, [grid]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (!src) {
      stage.showEmpty();
      onStatsRef.current?.(null);
      return;
    }
    let live = true;
    stage.load(src).then((result) => {
      if (!live || (!result.ok && result.aborted)) return;
      setLoaded({ src, attempt, result });
      onStatsRef.current?.(result.ok ? result.stats : null);
    });
    return () => { live = false; };
  }, [src, attempt]);

  useImperativeHandle(ref, () => ({
    resetView: () => stageRef.current?.resetView(),
    snapshot: () => stageRef.current?.snapshot() ?? Promise.resolve(null),
  }), []);

  const current = src && loaded && loaded.src === src && loaded.attempt === attempt ? loaded.result : null;
  const isLoading = Boolean(src) && !current && !noWebGl;
  const error = current && !current.ok && !current.aborted ? current.error : null;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />

      {noWebGl && (
        <div className="m3v-center">
          <div className="m3v-card">
            <div style={{ fontSize: 22, marginBottom: 6 }}>⬡</div>
            เบราว์เซอร์นี้แสดงภาพ 3D ไม่ได้ (WebGL ถูกปิดอยู่)
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>ยังดาวน์โหลดไฟล์ GLB ไปเปิดในโปรแกรมอื่นได้ตามปกติ</div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="m3v-center" aria-live="polite">
          <div className="m3v-card">
            <span className="m3v-spin" aria-hidden="true" />
            กำลังโหลดโมเดล…
          </div>
        </div>
      )}

      {error && (
        <div className="m3v-center" role="alert">
          <div className="m3v-card">
            {error}
            <button type="button" className="m3v-retry" onClick={() => setAttempt((n) => n + 1)}>ลองอีกครั้ง</button>
          </div>
        </div>
      )}

      {current?.ok && !hinted && (
        <div className="m3v-hint" aria-hidden="true">
          <span className="m3v-hint-desk">ลากเพื่อหมุน · สกรอลล์เพื่อซูม · คลิกขวาลากเพื่อเลื่อน</span>
          <span className="m3v-hint-touch">ลากนิ้วเพื่อหมุน · จีบนิ้วเพื่อซูม · สองนิ้วเพื่อเลื่อน</span>
        </div>
      )}

      <style>{`
        .m3v-center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; padding: 16px; }
        .m3v-card { pointer-events: auto; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
          padding: 16px 20px; border-radius: 14px; font-size: 13px; color: #e2e8f0; max-width: 320px;
          background: rgba(2,6,23,0.72); border: 1px solid rgba(165,243,252,0.18); backdrop-filter: blur(12px); }
        .m3v-spin { width: 26px; height: 26px; border-radius: 50%; border: 2px solid rgba(165,243,252,0.2); border-top-color: #22d3ee; animation: m3v-rot 0.9s linear infinite; }
        .m3v-retry { margin-top: 2px; padding: 7px 14px; border-radius: 999px; font-size: 12px; cursor: pointer; color: #fff;
          background: linear-gradient(135deg, rgba(16,185,129,0.35), rgba(139,92,246,0.35)); border: 1px solid rgba(165,243,252,0.3); }
        .m3v-hint { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); pointer-events: none; white-space: nowrap;
          padding: 6px 12px; border-radius: 999px; font-size: 11.5px; color: rgba(226,232,240,0.85);
          background: rgba(2,6,23,0.55); border: 1px solid rgba(255,255,255,0.08); animation: m3v-fade 600ms ease-out; }
        .m3v-hint-touch { display: none; }
        @media (hover: none) { .m3v-hint-desk { display: none; } .m3v-hint-touch { display: inline; } }
        @keyframes m3v-rot { to { transform: rotate(360deg); } }
        @keyframes m3v-fade { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @media (prefers-reduced-motion: reduce) { .m3v-spin { animation-duration: 2.4s; } .m3v-hint { animation: none; } }
      `}</style>
    </div>
  );
}
