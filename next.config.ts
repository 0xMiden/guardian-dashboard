import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  webpack(config) {
    // Parent /Code/package.json confuses enhanced-resolve — pin tailwindcss to this project.
    config.resolve.alias = {
      ...config.resolve.alias,
      tailwindcss: path.resolve(__dirname, "node_modules/tailwindcss"),
    };
    return config;
  },
  serverExternalPackages: ["@miden-sdk/miden-sdk"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@miden-sdk/miden-sdk/dist/assets/*.wasm"],
  },
  turbopack: {
    // Parent /Code/package-lock.json causes Turbopack to pick the wrong workspace root.
    root: __dirname,
    resolveAlias: {
      tailwindcss: path.resolve(__dirname, "node_modules/tailwindcss"),
    },
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
