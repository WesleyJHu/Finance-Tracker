import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emits .next/standalone: a self-contained server plus only the
   * node_modules Next's tracing proves are reachable. That is what lets the
   * runtime image skip the ~1 GB of build-time dependencies (typescript,
   * eslint, tailwind, vitest) the previous single-stage image shipped.
   */
  output: "standalone",
};

export default nextConfig;
