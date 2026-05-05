import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@miden-sdk/miden-sdk"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@miden-sdk/miden-sdk/dist/assets/*.wasm"],
  },
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
