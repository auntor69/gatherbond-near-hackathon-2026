import path from "node:path";

// The metadata layer lives at the repository root (server/) while the Next app lives in
// frontend/. Point Turbopack and output tracing at the workspace root so the route
// handlers can import those server-only modules.
const workspaceRoot = path.resolve(import.meta.dirname, "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The browser preview is served from 127.0.0.1 while Next reports localhost.
  // Allow that loopback origin so HMR and client hydration work in local preview.
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  // The libSQL client is loaded through createRequire so the metadata layer can stay
  // database-agnostic. Next's static tracer cannot see that runtime require, so without
  // these includes the Vercel function can boot without @libsql/client and every Turso
  // request fails closed as metadata_store_unavailable. Include the client and its
  // transitive runtime dependencies in every server surface that reads verified events:
  // API routes, the homepage shelf, event/recap pages, social cards and the sitemap.
  outputFileTracingIncludes: {
    "/api/**": [
      "node_modules/@libsql/**/*",
      "node_modules/ws/**/*",
      "node_modules/js-base64/**/*",
      "node_modules/promise-limit/**/*",
    ],
    "/": [
      "node_modules/@libsql/**/*",
      "node_modules/ws/**/*",
      "node_modules/js-base64/**/*",
      "node_modules/promise-limit/**/*",
    ],
    "/events/**": [
      "node_modules/@libsql/**/*",
      "node_modules/ws/**/*",
      "node_modules/js-base64/**/*",
      "node_modules/promise-limit/**/*",
    ],
    "/sitemap.xml": [
      "node_modules/@libsql/**/*",
      "node_modules/ws/**/*",
      "node_modules/js-base64/**/*",
      "node_modules/promise-limit/**/*",
    ],
  },
};

export default nextConfig;
