import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
