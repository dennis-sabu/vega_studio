import type { NextConfig } from "next";

const backendUrl =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8765";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev overlay adds work on every render; keep the UI lean.
  devIndicators: false,
  experimental: {
    // Tree-shake icon imports into per-icon modules so dev compiles and the
    // client bundle stay small.
    optimizePackageImports: ["lucide-react"],
  },
  env: {
    NEXT_PUBLIC_BACKEND_URL: backendUrl,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
