import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getAxaHome } from "@contagxt/axa-core";
import { defineConfig } from "drizzle-kit";

const home = resolve(getAxaHome());
const key = createHash("sha256").update(home).digest("hex").slice(0, 12);

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.AXA_CONSOLE_DB ?? join(tmpdir(), "axa-console", key, "console.db"),
  },
});
