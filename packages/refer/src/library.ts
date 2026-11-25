// Public library entry for programs that want to read, write, or apply refs
// without going through the CLI. The CLI entry stays in `index.ts`.
export {
  type AddRefOptions,
  type AddRefResult,
  addRef,
  type LocalReference,
  resolveLocalReference,
} from "./add.js";
export { ReferError } from "./errors.js";
export type { Reporter, Session } from "./io.js";
export { HOMEPAGE, type RefManifest, readRef, VERSION, writeRef } from "./manifest.js";
export { expandPath, homeDir, refPath } from "./paths.js";
export { applyRef, replayRef } from "./reference.js";
