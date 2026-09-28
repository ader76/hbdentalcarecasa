import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  resolve: { alias: { "@": resolve(root, "src"), "server-only": resolve(root, "tests/helpers/empty.ts") } },
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node", setupFiles: ["fake-indexeddb/auto"] } },
      { extends: true, test: { name: "integration", include: ["tests/integration/**/*.test.ts"], environment: "node",
        globalSetup: ["tests/integration/global-setup.ts"], testTimeout: 60_000, hookTimeout: 180_000, fileParallelism: false } },
    ],
  },
});
