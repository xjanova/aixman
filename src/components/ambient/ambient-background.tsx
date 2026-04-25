"use client";

/**
 * AmbientBackground — global ambient layer rendered behind every page.
 *
 * Two-mode strategy:
 *   - On `/` (landing): GPU-accelerated 3D HeroScene (R3F + drei + bloom)
 *     — floating distort-orbs whose opacity fades as the auto-orbiting
 *     camera approaches each one, plus particle field, sparkles, stars.
 *     2D canvas was bottlenecking on bezier+gradient stroke; GPU path is
 *     smoother at higher visual density.
 *   - Every other route: cheap 2D fiber-threads canvas (DPR 1.5, 30fps,
 *     IntersectionObserver-paused). Subroutes are content-heavy and
 *     don't need the hero spectacle.
 *
 * Scroll-fade still applies on `/`: as the user scrolls past ~600px,
 * the radial overlay darkens and a backdrop blur kicks in to push the
 * scene back behind the foreground content.
 */

import { FiberThreads } from "@/components/xdreamer/shared";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

// HeroScene is heavy (R3F + drei + postprocessing). Lazy-load + skip SSR
// so it only ships when actually used (i.e. on /).
const HeroScene = dynamic(
  () => import("@/components/three/hero-scene").then((m) => m.HeroScene),
  { ssr: false },
);

export function AmbientBackground() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const apply = (heroAmount: number) => {
      const overlayInner = 0.15 + (1 - heroAmount) * 0.35; // 0.15..0.5
      const overlayMid = 0.55 + (1 - heroAmount) * 0.3;    // 0.55..0.85
      const blur = (1 - heroAmount) * 6;                   // 0..6px
      if (overlayRef.current) {
        overlayRef.current.style.background =
          `radial-gradient(ellipse at 50% 30%, rgba(3,6,18,${overlayInner}) 0%, rgba(3,6,18,${overlayMid}) 55%, rgba(3,6,18,0.85) 100%)`;
        overlayRef.current.style.backdropFilter = `blur(${blur}px)`;
        overlayRef.current.style.setProperty("-webkit-backdrop-filter", `blur(${blur}px)`);
      }
    };

    if (!isHome) {
      apply(0);
      return;
    }

    let raf: number | null = null;
    const onScroll = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        const heroAmount = Math.max(0, 1 - window.scrollY / 600);
        apply(heroAmount);
        raf = null;
      });
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [isHome]);

  return (
    <div
      // Fixed at z-0 so the ambient layer sits behind page content.
      className="fixed inset-0 z-0 overflow-hidden pointer-events-none"
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

      {/* Animated layer — 3D HeroScene on /, 2D fiber threads elsewhere */}
      <div className="absolute inset-0">
        {isHome ? (
          <HeroScene />
        ) : (
          <FiberThreads density={50} speed={0.7} hueShift={70} opacity={0.45} interactive={false} />
        )}
      </div>

      {/* Frosted vignette — initial state matches heroAmount=1 (calm at top
          of /) so the 3D scene isn't masked by a heavy overlay before the
          useEffect runs. Non-home routes immediately get apply(0) which
          dims this back to the dark baseline. */}
      <div
        ref={overlayRef}
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 30%, rgba(3,6,18,0.15) 0%, rgba(3,6,18,0.55) 55%, rgba(3,6,18,0.85) 100%)",
          backdropFilter: "blur(0px)",
          WebkitBackdropFilter: "blur(0px)",
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
