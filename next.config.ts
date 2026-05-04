import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["systeminformation", "dockerode", "@miden-sdk/miden-sdk"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@miden-sdk/miden-sdk/dist/assets/*.wasm"],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
