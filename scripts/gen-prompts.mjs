import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const packages = ["core", "secretary", "console"];
const root = resolve(dirname(new URL(import.meta.url).pathname), "..");

function identifier(name) {
  return name
    .replace(/\.tpl\.md$/u, "")
    .replace(/\.md$/u, "")
    .split(/[^a-zA-Z0-9]+/u)
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
}

for (const pkg of packages) {
  const dir = join(root, "packages", pkg, "src", "prompts");
  let files;
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
  } catch {
    continue;
  }

  const lines = [
    "// GENERATED FILE — do not edit. Source: src/prompts/*.md, *.tpl.md",
    "// Regenerate with: pnpm prompts:generate",
    "",
  ];
  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    const name = identifier(basename(file));
    const literal = JSON.stringify(text);
    // Keep generated code Biome-formatted: break long string literals onto their own line.
    if (`export const ${name} = ${literal};`.length > 100) {
      lines.push(`export const ${name} =`, `  ${literal};`);
    } else {
      lines.push(`export const ${name} = ${literal};`);
    }
  }
  lines.push("");
  await writeFile(join(dir, "index.ts"), lines.join("\n"));
  console.log(`[prompts] ${pkg}: ${files.length} template(s) -> src/prompts/index.ts`);
}
