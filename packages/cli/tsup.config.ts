import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/task.ts", "src/project.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  splitting: false,
  banner: { js: "#!/usr/bin/env node" },
});
