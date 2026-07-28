import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/helpers/env.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false, // integration tests share one Postgres test DB
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
