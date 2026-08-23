/**
 * Bundles worker.mjs and the two cron scripts into dist/, for the runtime
 * image.
 *
 * The scripts are TypeScript and import through the `@/` alias, so running
 * them in production would otherwise mean shipping tsx, the TypeScript
 * sources, and a tsconfig — none of which belong in a runtime image, and all
 * of which are excluded from Next's standalone output anyway.
 *
 * Bundling collapses each entry point and everything under src/lib that it
 * touches into one file. `pg` stays external because it resolves optional
 * native bindings at require time and does not bundle cleanly; dist/ is placed
 * beside the standalone node_modules in the image, so Node finds it by walking
 * up. Everything else (dotenv, node-cron) is inlined, so the worker needs no
 * package of its own.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = path.dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: {
    worker: path.join(root, "worker.mjs"),
    "scripts/process-recurring-payments": path.join(
      root,
      "scripts/process-recurring-payments.ts"
    ),
    "scripts/process-monthly-balance-snapshot": path.join(
      root,
      "scripts/process-monthly-balance-snapshot.ts"
    ),
  },
  outdir: path.join(root, "dist"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Mirrors the "@/*" path in tsconfig.json.
  alias: { "@": path.join(root, "src") },
  // `pg` resolves optional native bindings at require time. `node-cron`
  // resolves a daemon.js off disk relative to __dirname, so it cannot be
  // bundled at all — the Dockerfile copies it into the runtime node_modules
  // instead. It has no dependencies of its own and is 523K.
  external: ["pg", "node-cron"],
  // Some transitive code still calls require() for Node builtins, which
  // esbuild's ESM output cannot do — its shim throws "Dynamic require of
  // ... is not supported" at startup. Defining one from import.meta.url is
  // the standard fix, and the shim picks it up.
  banner: {
    js:
      `import { createRequire as __nodeCreateRequire } from "node:module";\n` +
      `const require = __nodeCreateRequire(import.meta.url);`,
  },
  logLevel: "info",
})
