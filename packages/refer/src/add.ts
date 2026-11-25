import { basename, isAbsolute, resolve } from "node:path";
import { die, usageError } from "./errors.js";
import { gitOrigin } from "./git.js";
import type { Session } from "./io.js";
import { readRef, writeRef } from "./manifest.js";
import { expandPath, homeDir, isFile, refPath } from "./paths.js";
import { applyRef } from "./reference.js";
import { isGitUrl, loadRemote, parseRemote, remoteName } from "./remote.js";

export interface LocalReference {
  remote: string;
  local: string;
}

export interface AddRefOptions {
  /** Path token to link, or `:auto` / `:global` when a remote is given. */
  local: string;
  /** Explicit remote; when omitted it is derived from a git work tree. */
  remote?: string;
  /** Symlink tokens; relative ones resolve from `baseDir`. */
  symlinks?: string[];
  update?: boolean;
  /** Manifest name; derived from the remote or local path when omitted. */
  name?: string;
  /** Manifest path. Defaults to `./<name>.ref` like the CLI. */
  file?: string;
  /** Directory relative tokens resolve from. Defaults to the process cwd. */
  baseDir?: string;
  /** Create checkouts/symlinks now. Defaults to true; set false to only record. */
  apply?: boolean;
}

export interface AddRefResult {
  file: string;
  remote: string;
  local: string;
  symlinks: string[];
}

function isSpecialToken(token: string): boolean {
  return token === ":auto" || token === ":global";
}

function resolveToken(token: string, baseDir: string, session: Session): string {
  if (token === "" || isSpecialToken(token)) return token;
  const expanded = expandPath(token, session.env);
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

// Without an explicit remote, a path inside a git work tree is recorded as a
// reference to that repository's origin, so the manifest restores elsewhere.
export function resolveLocalReference(
  local: string,
  session: Session,
  baseDir = process.cwd(),
): LocalReference {
  const source = resolveToken(local, baseDir, session);
  const origin = gitOrigin(source, session);
  if (origin === undefined) return { remote: "", local };

  const candidate = origin.subpath === "" ? origin.url : `${origin.url}/${origin.subpath}`;
  const parsed = parseRemote(candidate);
  if (isGitUrl(origin.url) && parsed.url === origin.url && parsed.subpath === origin.subpath) {
    session.reporter.debug(`recording ${origin.url} (${origin.root}) for ${source}`);
    return { remote: candidate, local: origin.root };
  }
  if (origin.subpath !== "") {
    session.reporter.warn(
      `cannot record remote '${origin.url}': the URL must end in .git to carry a sub path; writing a local-only reference`,
    );
  }
  return { remote: "", local };
}

// Single implementation of "record a reference" shared by the CLI and library
// callers, so both entry points can never drift apart.
export function addRef(options: AddRefOptions, session: Session): AddRefResult {
  const baseDir = options.baseDir ?? process.cwd();
  const update = options.update ?? false;
  let remote = options.remote ?? "";
  let local = options.local;
  const symlinks = [...(options.symlinks ?? [])];

  if (remote !== "" && local === "") local = ":auto";
  if (remote === "" && (local === "" || isSpecialToken(local))) {
    usageError("without a remote, the local path must be an existing file or directory");
  }

  const source = resolveToken(local, baseDir, session);

  if (remote === "") {
    const derived = resolveLocalReference(local, session, baseDir);
    remote = derived.remote;
    local = derived.local;
    // Keep the local-only default: a link named after the target.
    if (remote !== "" && symlinks.length === 0) {
      const fallback = basename(source);
      if (fallback !== "" && fallback !== "." && fallback !== "..") symlinks.push(fallback);
    }
  }

  let name = options.name ?? "";
  if (name === "") {
    name = remote !== "" ? remoteName(loadRemote(remote, session)) : basename(source);
  }
  if (name === "" || name === "." || name === ".." || name.includes("/")) {
    usageError(`invalid manifest name '${name}'`);
  }
  if (name.endsWith(".ref")) name = name.slice(0, -4);
  const file = options.file ?? `./${name}.ref`;

  if (isFile(file)) {
    const existing = readRef(file, session);
    if (
      existing.remote !== remote ||
      (remote === "" && existing.local !== refPath(local, homeDir(session.env)))
    ) {
      die(`${file} already describes a different reference; pick another name with -n`);
    }
  }

  if (options.apply !== false) {
    // applyRef owns token resolution: relative tokens, symlink paths and :auto
    // names all resolve from baseDir while the process cwd stays untouched.
    applyRef(remote, local, update, symlinks, session, baseDir);
  }
  writeRef(file, remote, local, update, symlinks, session);
  return { file, remote, local, symlinks };
}
