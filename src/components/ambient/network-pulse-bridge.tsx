"use client";

/**
 * NetworkPulseBridge — wraps window.fetch (and XHR) so any outgoing
 * request fires `app:network:start` on window. The 3D HeroScene picks
 * the event up and renders an electric-arc pulse between two of its
 * orbs, which stays visible for ≥ 2 s.
 *
 * Mounted once in the root layout. Idempotent — guarded by a flag so
 * it never wraps twice (e.g. on hot-reload).
 */

import { useEffect } from "react";

declare global {
  interface Window {
    __aixmanNetworkBridge?: boolean;
  }
}

export function NetworkPulseBridge() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.__aixmanNetworkBridge) return;
    window.__aixmanNetworkBridge = true;

    // ── fetch ──────────────────────────────────────────────────────
    const origFetch = window.fetch.bind(window);
    window.fetch = (...args: Parameters<typeof fetch>) => {
      try {
        const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
        // Skip noisy/low-value targets (analytics, telemetry, hot-reload)
        if (!/^(https?:|\/)/.test(url) || /__nextjs|hot-update|favicon|webpack-hmr/.test(url)) {
          return origFetch(...args);
        }
        window.dispatchEvent(new CustomEvent("app:network:start", { detail: { url, method: (args[1]?.method ?? "GET").toUpperCase() } }));
      } catch {
        /* ignore detection errors — never break the actual request */
      }
      return origFetch(...args);
    };

    // ── XMLHttpRequest ─────────────────────────────────────────────
    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR && OrigXHR.prototype && OrigXHR.prototype.open) {
      const origOpen = OrigXHR.prototype.open;
      const origSend = OrigXHR.prototype.send;
      // Stash captured request info on the instance
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      OrigXHR.prototype.open = function (this: any, method: string, url: string | URL, ...rest: unknown[]) {
        this.__pulseUrl = String(url);
        this.__pulseMethod = method.toUpperCase();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return origOpen.apply(this, [method, url, ...rest] as any);
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      OrigXHR.prototype.send = function (this: any, ...args: unknown[]) {
        try {
          const url = this.__pulseUrl;
          if (url && !/__nextjs|hot-update|favicon|webpack-hmr/.test(url)) {
            window.dispatchEvent(new CustomEvent("app:network:start", { detail: { url, method: this.__pulseMethod ?? "GET" } }));
          }
        } catch {
          /* ignore */
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return origSend.apply(this, args as any);
      };
    }

    // No cleanup — bridge is meant to live for the whole session.
  }, []);

  return null;
}
