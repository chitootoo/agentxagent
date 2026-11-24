import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests change the process working directory, so isolate every test file.
    pool: "forks",
    fileParallelism: false,
  },
});
