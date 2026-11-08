import path from "node:path";

// The metadata layer lives at the repository root (server/) while the Next app lives in
// frontend/. Point Turbopack and output tracing at the workspace root so the route
// handlers can import those server-only modules.
const workspaceRoot = path.resolve(import.meta.dirname, "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  // The libSQL client is loaded through createRequire so the metadata layer can stay
  // database-agnostic. Next's static tracer cannot see that runtime require, so without
  // these includes the Vercel function can boot without @libsql/client and every Turso
  // request fails closed as metadata_store_unavailable. Include the client and its
  // transitive runtime dependencies in the API function bundle.
  outputFileTracingIncludes: {
    "/api/**": [
      "node_modules/@libsql/**/*",
      "node_modules/libsql/**/*",
      "node_modules/@neon-rs/**/*",
      "node_modules/detect-libc/**/*",
      "node_modules/js-base64/**/*",
      "node_modules/promise-limit/**/*",
    ],
  },
};

export default nextConfig;
