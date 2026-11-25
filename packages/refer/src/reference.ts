import { type Dirent, existsSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { die, ReferError, usageError } from "./errors.js";
import { ensureCheckout } from "./git.js";
import type { Session } from "./io.js";
import { checkSymlinkTokens, gitignoreAdd, makeLink, resolveLinks } from "./links.js";
import { readRef, refreshHeader } from "./manifest.js";
import { absPath, expandPath, isSymlink, lexists, realPath } from "./paths.js";
import {
  globalCheckoutDir,
  loadRemote,
  type ParsedRemote,
  remoteName,
  repoName,
} from "./remote.js";

interface Checkout {
  path: string;
  global: boolean;
}

function resolveCheckout(
  remote: ParsedRemote,
  localToken: string,
  session: Session,
  baseDir: string,
): Checkout {
  if (localToken === ":global") {
    return { path: globalCheckoutDir(remote.url, session.env), global: true };
  }
  if (localToken === "" || localToken === ":auto") {
    return { path: resolve(baseDir, repoName(remote.url)), global: false };
  }
  const expanded = expandPath(localToken, session.env);
  return {
    path: isAbsolute(expanded) ? expanded : resolve(baseDir, expanded),
    global: false,
  };
}

// A checkout directly in the base directory reserves its own name for :auto links.
function reservedName(checkout: Checkout, baseDir: string): string {
  if (!checkout.global && dirname(checkout.path) === baseDir) return basename(checkout.path);
  return "";
}

function applyRemote(
  remote: string,
  localToken: string,
  update: boolean,
  symlinkTokens: string[],
  session: Session,
  baseDir: string,
): void {
  const parsed = loadRemote(remote, session);
  checkSymlinkTokens(symlinkTokens);

  const name = remoteName(parsed);
  const checkout = resolveCheckout(parsed, localToken, session, baseDir);
  ensureCheckout(parsed.url, parsed.rev, checkout.path, update, session);

  let target: string;
  try {
    target = absPath(checkout.path);
  } catch {
    die(`cannot resolve ${checkout.path}`);
  }
  if (parsed.subpath !== "") {
    target = `${target}/${parsed.subpath}`;
    if (!lexists(target)) {
      die(`sub path '${parsed.subpath}' does not exist in ${parsed.url}`);
    }
  }

  const links = resolveLinks(
    name,
    target,
    reservedName(checkout, baseDir),
    symlinkTokens,
    session,
    baseDir,
  );
  for (const link of links) makeLink(link, target, session);

  if (!checkout.global) gitignoreAdd(checkout.path, session);
  if (parsed.subpath !== "" && symlinkTokens.length === 0) {
    session.reporter.warn(
      `no symlink requested; '${parsed.subpath}' is only reachable inside ${checkout.path} (add -s)`,
    );
  }
}

function applyLocal(
  localToken: string,
  symlinkTokens: string[],
  session: Session,
  baseDir: string,
): void {
  if (localToken === "" || localToken === ":auto" || localToken === ":global") {
    usageError("without a remote, the local path must be an existing file or directory");
  }
  checkSymlinkTokens(symlinkTokens);

  const expanded = expandPath(localToken, session.env);
  const source = isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
  if (!existsSync(source)) die(`local path '${source}' does not exist`);

  let sourceAbsolute: string;
  try {
    sourceAbsolute = realPath(source);
  } catch {
    die(`cannot resolve ${source}`);
  }

  const name = basename(source);
  const links = resolveLinks(name, sourceAbsolute, "", symlinkTokens, session, baseDir);
  if (links.length === 0) links.push(resolve(baseDir, name));

  for (const link of links) {
    if (existsSync(link) && !isSymlink(link)) {
      let linkReal: string | undefined;
      try {
        linkReal = realPath(link);
      } catch {
        linkReal = undefined;
      }
      if (linkReal === sourceAbsolute) {
        session.reporter.log(`Skipping ${link}: it is the local path itself`);
        continue;
      }
    }
    makeLink(link, sourceAbsolute, session);
  }
}

export function applyRef(
  remote: string,
  localToken: string,
  update: boolean,
  symlinkTokens: string[],
  session: Session,
  baseDir: string = process.cwd(),
): void {
  if (remote !== "") {
    applyRemote(remote, localToken, update, symlinkTokens, session, baseDir);
  } else {
    applyLocal(localToken, symlinkTokens, session, baseDir);
  }
}

export interface ReplayOptions {
  /** Directory relative tokens resolve from. Defaults to the manifest's directory. */
  baseDir?: string;
  /**
   * Skip creating symlinks. Used when restoring a checkout that is not ready
   * yet (the project path does not exist); only remote references can restore.
   */
  link?: boolean;
}

// Run one manifest against its own directory without changing the process cwd,
// so replays are safe inside a server process.
export function replayRef(
  file: string,
  updateOverride: boolean,
  session: Session,
  options: ReplayOptions = {},
): void {
  const ref = readRef(file, session);
  const update = updateOverride || ref.update;
  const baseDir = resolve(/* turbopackIgnore: true */ options.baseDir ?? dirname(file));

  if (options.link === false) {
    if (ref.remote === "") {
      die(`manifest '${file}' is local-only; there is no remote to restore it from`);
    }
    applyRef(ref.remote, ref.local, update, [], session, baseDir);
  } else {
    applyRef(ref.remote, ref.local, update, ref.symlinks, session, baseDir);
  }
  refreshHeader(file, session);
}

function walkRefs(dir: string, root: boolean, found: string[]): void {
  // Manifests inside a dependency's own git repository are theirs to manage.
  if (!root && lexists(`${dir}/.git`)) return;

  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const path = dir === "." ? `./${entry.name}` : `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkRefs(path, false, found);
    else if (entry.isFile() && entry.name.endsWith(".ref")) found.push(path);
  }
}

// Print .ref files under ".", skipping nested git repositories when recursive.
export function findRefs(recursive: boolean): string[] {
  if (!recursive) {
    return readdirSync(".", { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ref"))
      .map((entry) => `./${entry.name}`)
      .sort();
  }

  const found: string[] = [];
  walkRefs(".", true, found);
  return found.sort();
}

export function replayAll(recursive: boolean, updateOverride: boolean, session: Session): number {
  const files = findRefs(recursive);
  if (files.length === 0) {
    session.reporter.log(`No .ref files found in this directory${recursive ? " or below" : ""}`);
    return 0;
  }

  let failed = 0;
  for (const file of files) {
    session.reporter.log(`==> ${file}`);
    try {
      replayRef(file, updateOverride, session);
    } catch (error) {
      failed += 1;
      reportError(session, error);
    }
  }

  if (failed > 0) {
    session.reporter.error(`${failed} of ${files.length} manifest(s) failed`);
    return 1;
  }
  session.reporter.log(`Processed ${files.length} manifest(s)`);
  return 0;
}

export function reportError(session: Session, error: unknown): void {
  if (error instanceof ReferError) {
    if (error.message !== "") session.reporter.error(error.message);
    if (error.exitCode === 2) session.reporter.hint("Run 'refer help' for usage.");
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  session.reporter.error(message);
}
