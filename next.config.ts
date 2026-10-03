import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // Cloudflare Workers has no image-optimization server; ship images as-is
  // rather than routing through Next's optimizer, which would 404 there.
  images: {
    unoptimized: true,
  },
  // Static assets get the same headers from public/_headers.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders({ development: process.env.NODE_ENV === "development" }) }];
  },
};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
