"use client";

/**
 * AmbientBackground — global ambient layer rendered behind every page.
 *
 * Replaced the previous orb-based blur layer with X-DREAMER fiber threads,
 * so the dark woven-light identity is consistent across landing, generate,
 * gallery, profile, pricing, and admin views.
 *
 * Scroll-fade behaviour (matches the template's `App` component):
 *   On the landing page (`/`), the fiber-threads layer is brighter at the
 *   top and fades into a frosted, blurred state as the user scrolls past
 *   ~600px. On every other route the layer is held at a soft static
 *   opacity (no fade — the background is just ambient context).
 *
 *   Per template spec:
 *     baseOpacity = 0.28     // always-on
 *     heroBoost   = 0…0.55   // extra brightness near hero (top of /)
 *     heroAmount  = max(0, 1 - scrollY / 600)  // 1 → 0 over 600px
 *     overlay alpha + backdrop-blur scale with (1 - heroAmount)
 */

import { FiberThreads } from "@/components/xdreamer/shared";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export function AmbientBackground() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [scrollY, setScrollY] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isHome) {
      // Reset scroll-tied state on non-home routes so the background sits
      // at its calm baseline; we still want to react if the user navigates
      // back to /.
      setScrollY(0);
      return;
    }
    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        setScrollY(window.scrollY);
        rafRef.current = null;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [isHome]);

  const heroAmount = isHome ? Math.max(0, 1 - scrollY / 600) : 0;
  const fiberOpacity = 0.28 + heroAmount * 0.55; // 0.28..0.83
  const overlayInner = 0.15 + (1 - heroAmount) * 0.35; // 0.15..0.5
  const overlayMid = 0.55 + (1 - heroAmount) * 0.3; // 0.55..0.85
  const blur = (1 - heroAmount) * 6; // 0..6px

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

      {/* Animated fiber threads — opacity scales with hero proximity on / */}
      <div
        className="absolute inset-0"
        style={{
          opacity: fiberOpacity,
          transition: "opacity 120ms linear",
        }}
      >
        <FiberThreads density={50} speed={0.7} hueShift={70} opacity={1} interactive={isHome && heroAmount > 0.3} />
      </div>

      {/* Frosted vignette that intensifies as you scroll (template behaviour) */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at 50% 30%, rgba(3,6,18,${overlayInner}) 0%, rgba(3,6,18,${overlayMid}) 55%, rgba(3,6,18,0.85) 100%)`,
          backdropFilter: `blur(${blur}px)`,
          WebkitBackdropFilter: `blur(${blur}px)`,
          transition: "backdrop-filter 150ms linear, -webkit-backdrop-filter 150ms linear",
        }}
      />

      {/* Subtle noise/grain overlay for depth */}
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
