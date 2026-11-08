// Lazily constructed runtime shared by the Next route handlers. Construction is deferred
// until the first request, so importing a route module never requires credentials or a
// database and cannot crash the build.

import { createMetadataRuntime } from "../metadata/runtime.mjs";

// @libsql/client is installed in frontend/ (the Next project), while the metadata layer
// lives at the repository root. Resolve the package lazily from the app manifest (the
// working directory of `next build`/`next start`) so module evaluation during the build
// never touches the filesystem. The loader only runs when Turso credentials exist.
async function importLibsql() {
  const [{ createRequire }, path] = await Promise.all([
    import("node:module"),
    import("node:path"),
  ]);
  // Next may start with either the app directory or the workspace root as cwd depending
  // on how it is launched. Try both manifests before failing closed.
  const candidates = [process.cwd(), path.resolve(process.cwd(), "frontend")];
  let lastError;
  for (const directory of candidates) {
    try {
      const requireFromApp = createRequire(path.join(directory, "package.json"));
      // @libsql/client exports a CJS build (`require` condition). Requiring it avoids
      // Turbopack trying to analyze a runtime file-URL import in dev.
      const loaded = requireFromApp("@libsql/client");
      return loaded?.default?.createClient ? loaded.default : loaded;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
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
