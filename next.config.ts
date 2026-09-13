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
    "/api/**": ["./node_modules/@miden-sdk/miden-sdk/dist/st/assets/*.wasm"],
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
  // Baseline response headers. This dashboard authenticates Guardian operators
  // and drives pause/unpause on live accounts, so the cheap browser-side
  // defenses are worth having even though none of them replaces the auth checks
  // in proxy.ts and lib/require-admin.ts.
  //
  // Deliberately limited to headers that cannot change how the app renders:
  // - `frame-ancestors 'none'` is the CSP form of clickjacking protection; the
  //   dashboard is never embedded. No `default-src`/`script-src` is set, because
  //   Next injects inline bootstrap scripts and locking those down needs
  //   per-request nonces rather than a static config entry.
  // - `nosniff` stops a JSON route from being re-interpreted as HTML or script.
  // - `Referrer-Policy` keeps account ids in dashboard URLs out of the Referer
  //   header on outbound navigations (PostHog assets are proxied through
  //   /ingest/* above, so they are same-origin and unaffected).
  // - HSTS is set with a modest max-age and no `preload`, so it is reversible.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
