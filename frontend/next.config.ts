import type { NextConfig } from "next";

const backendUrl =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8765";
const isStaticExport = process.env.VEGA_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev overlay adds work on every render; keep the UI lean.
  devIndicators: false,
  ...(isStaticExport
    ? {
        output: "export",
        images: {
          unoptimized: true,
        },
      }
    : {}),
  experimental: {
    // Tree-shake icon imports into per-icon modules so dev compiles and the
    // client bundle stay small.
    optimizePackageImports: ["lucide-react"],
  },
  env: {
    NEXT_PUBLIC_BACKEND_URL: backendUrl,
  },
  ...(!isStaticExport
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${backendUrl}/api/:path*`,
            },
          ];
        },
      }
    : {}),
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
