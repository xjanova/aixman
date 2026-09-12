import type { NextConfig } from "next";

/**
 * This project's own directory. Next infers the workspace root from the
 * nearest lockfile going *up* the tree, and on the server a stray, empty
 * `/home/admin/package-lock.json` (an accidental `npm install` in $HOME) made
 * it pick /home/admin — a warning on every build and start, and the wrong
 * root for file tracing and Turbopack. Builds and PM2 both run from here.
 */
const projectRoot = process.cwd();

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  turbopack: { root: projectRoot },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.replicate.delivery' },
      { protocol: 'https', hostname: 'replicate.delivery' },
      { protocol: 'https', hostname: 'pbxt.replicate.delivery' },
      { protocol: 'https', hostname: '**.stability.ai' },
      { protocol: 'https', hostname: 'oaidalleapiprodscus.blob.core.windows.net' },
      { protocol: 'https', hostname: '**.openai.com' },
      { protocol: 'https', hostname: 'fal.media' },
      { protocol: 'https', hostname: '**.fal.media' },
      { protocol: 'https', hostname: '**.runwayml.com' },
      { protocol: 'https', hostname: '**.klingai.com' },
      { protocol: 'https', hostname: '**.lumalabs.ai' },
      { protocol: 'https', hostname: '**.leonardo.ai' },
      { protocol: 'https', hostname: 'cdn.leonardo.ai' },
      { protocol: 'https', hostname: '**.bytepluses.com' },
      { protocol: 'https', hostname: '**.byteimg.com' },
      { protocol: 'https', hostname: 'ai.xman4289.com' },
    ],
  },
};

export default nextConfig;
