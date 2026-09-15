import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Obsidian provides one shared CodeMirror instance at runtime.
    dedupe: ["@codemirror/state", "@codemirror/view"],
    alias: {
      obsidian: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)),
    },
  },
  test: {
    server: { deps: { inline: [/@codemirror\//] } },
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    coverage: {
      include: ["src/backlinks/**/*.ts", "src/utils/**/*.ts"],
    },
  },
});
