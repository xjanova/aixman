/**
 * /admin/providers — server wrapper
 *
 * Sets `dynamic = "force-dynamic"` so the page is rendered on every request
 * instead of being baked into Next.js's static prerender cache (5-min ISR
 * stale window). Admin UI changes need to appear immediately.
 *
 * The actual UI lives in providers-client.tsx (a client component, can't
 * declare its own route segment config).
 */

import ProvidersClient from "./providers-client";

export const dynamic = "force-dynamic";

export default function Page() {
  return <ProvidersClient />;
}
