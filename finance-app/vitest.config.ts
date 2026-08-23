import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path in tsconfig.json. Set explicitly rather than via
    // vite-tsconfig-paths, which is ESM-only and cannot be required from a
    // CommonJS config in this package.
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    // Node, not jsdom: everything under test is server-side money math.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Builds the throwaway database from db/schema.sql once per run.
    globalSetup: ["tests/integration/support/global-setup.ts"],
    // Points DATABASE_URL at that database before any test file imports
    // src/lib/db.ts, which reads it at module load.
    setupFiles: ["tests/integration/support/env.ts"],
    // The integration tests share one throwaway database, so files must not
    // run in parallel with each other.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
