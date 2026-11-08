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
};

export default nextConfig;
