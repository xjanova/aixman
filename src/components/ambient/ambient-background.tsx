"use client";

/**
 * AmbientBackground — global ambient layer rendered behind every page.
 *
 * Replaced the previous orb-based blur layer with X-DREAMER fiber threads,
 * so the dark woven-light identity is consistent across landing, generate,
 * gallery, profile, pricing, and admin views.
 *
 * The component must remain a client component with the same export name —
 * it is mounted once in `src/app/layout.tsx` and inherited by every route.
 */

import { FiberThreads } from "@/components/xdreamer/shared";

export function AmbientBackground() {
  return (
    <div
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      {/* Deep base + radial vignette — establishes the X-DREAMER palette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 30%, #060A14 0%, #030612 60%, #02040c 100%)",
        }}
      />

      {/* Animated fiber threads — soft global layer (DPR 1.5, 30fps cap, IO-paused) */}
      <div className="absolute inset-0 opacity-50">
        <FiberThreads density={50} speed={0.7} hueShift={70} opacity={0.45} interactive={false} />
      </div>

      {/* Very subtle noise/grain overlay for depth */}
      <div
        className="absolute inset-0 opacity-[0.025] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />
    </div>
  );
}
