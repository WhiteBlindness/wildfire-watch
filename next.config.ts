import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare Workers has no image-optimization server; ship images as-is
  // rather than routing through Next's optimizer, which would 404 there.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
