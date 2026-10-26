import { redirect } from "next/navigation";

// A real 307 per request (a prerendered redirect would rely on the client router).
export const dynamic = "force-dynamic";

/** /docs/mcp — the link BrainX and CluadeX print next to their XDREAMER connection: the MCP part of the guide. */
export default function DocsMcp() {
  redirect("/docs#mcp");
}
