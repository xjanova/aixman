"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Not in dev. sw.js is cache-first for static assets, and Turbopack serves
    // every rebuild of globals.css under the *same* chunk URL — so the first
    // cached copy wins forever and CSS edits silently stop appearing. In
    // production each build emits a new hashed URL, so this doesn't happen.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Service worker registration failed — non-critical
    });
  }, []);

  return null;
}
