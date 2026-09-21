import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The service worker must never be cached by the CDN, or a stale one keeps
  // serving an old app shell after a deploy.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
