import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path mapping in tsconfig.json. A regex + normalized
    // forward-slash replacement is deliberate: Vite's string alias worked on
    // Linux CI but resolved `@/` imports as packages on Windows.
    alias: [
      {
        find: /^@\//,
        replacement: `${fileURLToPath(new URL("./src/", import.meta.url)).replaceAll("\\", "/")}/`,
      },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
