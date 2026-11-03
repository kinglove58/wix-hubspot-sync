import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    maxWorkers: 4,
    reporters: ["default", ["junit", { outputFile: "reports/vitest.xml" }]],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        "src/lib/webhooks/*-signature.ts": { statements: 100, branches: 100, functions: 100, lines: 100, perFile: true },
        "src/lib/webhooks/retry-policy.ts": { statements: 100, branches: 100, functions: 100, lines: 100 },
        "src/lib/sync/engine.ts": { statements: 90, branches: 90, functions: 90, lines: 90 },
        "src/lib/sync/form-submission.ts": { statements: 90, branches: 90, functions: 90, lines: 90 },
        "src/lib/sync/**/*.ts": { statements: 90, branches: 90, functions: 90, lines: 90 },
      },
    },
  },
});
