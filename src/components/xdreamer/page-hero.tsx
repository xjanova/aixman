/**
 * Shared page furniture for the non-landing routes.
 *
 * Every app page used to open on a bare `<h1>` against the ambient
 * background, which made them feel like scaffolding next to the landing.
 * `PageHero` gives each route a cinematic band of its own artwork, and
 * `EmptyState` gives the "you have nothing yet" screens something to look at
 * besides a sentence.
 *
 * Server-safe: no hooks, no "use client". Pages that are client components
 * can still render these.
 */

import Image from "next/image";
import type { ReactNode } from "react";

const HUE = 70;

type PageHeroProps = {
  /** Background art from /public/showcase */
  image: string;
  eyebrow: string;
  /** Plain leading half of the headline */
  title: string;
  /** Gradient italic half */
  emphasis?: string;
  sub?: string;
  /** Base hue for the emphasis gradient */
  hue?: number;
  /** "slim" for legal pages, "tall" for marketing ones */
  size?: "slim" | "tall";
  /** Optional CTA row rendered under the copy */
  children?: ReactNode;
  /** Focal point of the background image */
  objectPosition?: string;
};

export function PageHero({
  image,
  eyebrow,
  title,
  emphasis,
  sub,
  hue = 220,
  size = "tall",
  children,
  objectPosition = "center",
}: PageHeroProps) {
  const h = (hue + HUE) % 360;
  const minHeight = size === "slim" ? 210 : 320;

  return (
    <section className="xdr-pagehero" style={{ minHeight }}>
      <div className="xdr-pagehero-media">
        <Image
          src={image}
          alt=""
          fill
          priority
          sizes="100vw"
          style={{ objectFit: "cover", objectPosition }}
        />
        {/* Two scrims: one for text contrast, one to melt into the page */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, rgba(3,6,18,0.95) 0%, rgba(3,6,18,0.8) 45%, rgba(3,6,18,0.35) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(3,6,18,0.7) 0%, rgba(3,6,18,0.2) 35%, rgba(3,6,18,0.75) 80%, #030612 100%)",
          }}
        />
      </div>

      <div className="xdr-pagehero-inner">
        <div className="xdr-pagehero-eyebrow">{eyebrow}</div>
        <h1 className="xdr-pagehero-title">
          {title}
          {emphasis && (
            <>
              {" "}
              <span
                className="xdr-italic-th"
                style={{
                  fontStyle: "italic",
                  fontWeight: 200,
                  background: `linear-gradient(120deg, hsl(${h},85%,72%), hsl(${(h + 55) % 360},85%,78%))`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {emphasis}
              </span>
            </>
          )}
        </h1>
        {sub && <p className="xdr-pagehero-sub">{sub}</p>}
        {children && <div style={{ marginTop: 22 }}>{children}</div>}
      </div>
    </section>
  );
}

type EmptyStateProps = {
  /** Optional wide artwork behind the card */
  image?: string;
  title: string;
  sub: string;
  children?: ReactNode;
  /** Show the woven-loom emblem. It is a transparent WebP, so it sits on
   *  whatever is behind it without a plate. */
  emblem?: boolean;
};

export function EmptyState({ image, title, sub, children, emblem = true }: EmptyStateProps) {
  return (
    <div className="xdr-empty">
      {image && (
        <div className="xdr-empty-media">
          <Image src={image} alt="" fill sizes="(max-width:900px) 100vw, 900px" style={{ objectFit: "cover" }} />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse at 50% 45%, rgba(3,6,18,0.45) 0%, rgba(3,6,18,0.88) 60%, #030612 100%)",
            }}
          />
        </div>
      )}
      <div className="xdr-empty-inner">
        {emblem && (
          <Image
            src="/showcase/emblem.webp"
            alt=""
            width={132}
            height={132}
            className="xdr-emblem"
            sizes="132px"
          />
        )}
        <div className="xdr-empty-title">{title}</div>
        <p className="xdr-empty-sub">{sub}</p>
        {children && <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>{children}</div>}
      </div>
    </div>
  );
}

/** Primary pill button used across the app pages. */
export function CtaButton({ href, children, tone = "primary" }: { href: string; children: ReactNode; tone?: "primary" | "ghost" }) {
  const primary = tone === "primary";
  return (
    <a
      href={href}
      className={primary ? "xdr-cta-primary" : "xdr-cta-ghost"}
    >
      {children}
    </a>
  );
}
