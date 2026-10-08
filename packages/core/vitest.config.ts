import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
      exclude: ["src/**/*.sql"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        // F02 §6.5: o domínio de perfis tem o mesmo piso, medido em separado
        "src/profile/**": { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
    testTimeout: 30_000,
  },
});
