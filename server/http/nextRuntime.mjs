// Lazily constructed runtime shared by the Next route handlers. Construction is deferred
// until the first request, so importing a route module never requires credentials or a
// database and cannot crash the build.

import { createMetadataRuntime } from "../metadata/runtime.mjs";

// @libsql/client is installed in frontend/ (the Next project), while the metadata layer
// lives at the repository root. Resolve the package lazily from the app manifest (the
// working directory of `next build`/`next start`) so module evaluation during the build
// never touches the filesystem. The loader only runs when Turso credentials exist.
async function importLibsql() {
  const [{ createRequire }, { pathToFileURL }, path] = await Promise.all([
    import("node:module"),
    import("node:url"),
    import("node:path"),
  ]);
  const requireFromApp = createRequire(path.join(process.cwd(), "package.json"));
  const resolved = requireFromApp.resolve("@libsql/client");
  return import(pathToFileURL(resolved).href);
}

let pending;

function getRuntime() {
  if (!pending) {
    pending = createMetadataRuntime({ env: process.env, importLibsql });
  }
  return pending;
}

export function getMetadataRoutes() {
  return getRuntime().then((runtime) => runtime.routes);
}

export function getAuthRoutes() {
  return getRuntime().then((runtime) => runtime.authRoutes);
}

/** Test-only: drop the cached runtime so environment changes take effect. */
export function resetMetadataRoutesForTests() {
  pending = undefined;
}
