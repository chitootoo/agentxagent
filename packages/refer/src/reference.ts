import { type Dirent, existsSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { basename, dirname } from "node:path";
import { die, ReferError, usageError } from "./errors.js";
import { checkoutDisposable, ensureCheckout } from "./git.js";
import type { Session } from "./io.js";
import { checkSymlinkTokens, findAutoLink, gitignoreAdd, makeLink, resolveLinks } from "./links.js";
import { readRef } from "./manifest.js";
import { absPath, expandPath, isSymlink, lexists, normPath, realPath } from "./paths.js";
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

function resolveCheckout(remote: ParsedRemote, localToken: string, session: Session): Checkout {
  if (localToken === ":global") {
    return { path: globalCheckoutDir(remote.url, session.env), global: true };
  }
  if (localToken === "" || localToken === ":auto") {
    return { path: `./${repoName(remote.url)}`, global: false };
  }
  return { path: expandPath(localToken, session.env), global: false };
}

// A checkout in the current directory reserves its own name for :auto links.
function reservedName(checkout: Checkout): string {
  if (!checkout.global && dirname(checkout.path) === ".") return basename(checkout.path);
  return "";
}

function applyRemote(
  remote: string,
  localToken: string,
  update: boolean,
  symlinkTokens: string[],
  session: Session,
): void {
  const parsed = loadRemote(remote, session);
  checkSymlinkTokens(symlinkTokens);

  const name = remoteName(parsed);
  const checkout = resolveCheckout(parsed, localToken, session);
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

  const links = resolveLinks(name, target, reservedName(checkout), symlinkTokens, session);
  for (const link of links) makeLink(link, target, session);

  if (!checkout.global) gitignoreAdd(checkout.path, session);
  if (parsed.subpath !== "" && symlinkTokens.length === 0) {
    session.reporter.warn(
      `no symlink requested; '${parsed.subpath}' is only reachable inside ${checkout.path} (add -s)`,
    );
  }
}

function applyLocal(localToken: string, symlinkTokens: string[], session: Session): void {
  if (localToken === "" || localToken === ":auto" || localToken === ":global") {
    usageError("without a remote, the local path must be an existing file or directory");
  }
  checkSymlinkTokens(symlinkTokens);

  const source = expandPath(localToken, session.env);
  if (!existsSync(source)) die(`local path '${source}' does not exist`);

  let sourceAbsolute: string;
  try {
    sourceAbsolute = realPath(source);
  } catch {
    die(`cannot resolve ${source}`);
  }

  const name = basename(source);
  const links = resolveLinks(name, sourceAbsolute, "", symlinkTokens, session);
  if (links.length === 0) links.push(name);

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
): void {
  if (remote !== "") {
    applyRemote(remote, localToken, update, symlinkTokens, session);
  } else {
    applyLocal(localToken, symlinkTokens, session);
  }
}

// Run one manifest in its own working directory so relative paths resolve
// from the manifest's directory.
export function replayRef(file: string, updateOverride: boolean, session: Session): void {
  const ref = readRef(file, session);
  const update = updateOverride || ref.update;
  const previous = process.cwd();
  const dir = dirname(file);

  try {
    process.chdir(dir);
  } catch {
    die(`cannot change directory to ${dir}`);
  }
  try {
    applyRef(ref.remote, ref.local, update, ref.symlinks, session);
  } finally {
    try {
      process.chdir(previous);
    } catch {
      // The original working directory disappeared; nothing useful to do.
    }
  }
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

function removeLink(link: string, session: Session): void {
  if (isSymlink(link)) {
    rmSync(link, { force: true });
    session.reporter.log(`Removed symlink ${link}`);
  } else if (lexists(link)) {
    session.reporter.warn(`'${link}' is not a symlink; left in place`);
  }
}

export function cleanRef(file: string, session: Session): void {
  const ref = readRef(file, session);
  const previous = process.cwd();
  const dir = dirname(file);

  try {
    process.chdir(dir);
  } catch {
    die(`cannot change directory to ${dir}`);
  }

  try {
    let base = "";
    let target = "";
    let reserved = "";
    let checkout: Checkout | undefined;

    if (ref.remote !== "") {
      const parsed = loadRemote(ref.remote, session);
      base = remoteName(parsed);
      checkout = resolveCheckout(parsed, ref.local, session);
      try {
        target = absPath(checkout.path);
      } catch {
        target = checkout.path;
      }
      if (parsed.subpath !== "") target = `${target}/${parsed.subpath}`;
      reserved = reservedName(checkout);
    } else {
      const source = expandPath(ref.local, session.env);
      base = basename(source);
      try {
        target = realPath(source);
      } catch {
        target = source;
      }
    }

    const links = ref.symlinks.length === 0 ? [base] : ref.symlinks;
    const removed: string[] = [];
    for (const raw of links) {
      let link: string | undefined;
      if (raw === ":auto") {
        link = findAutoLink(base, target, reserved, removed);
        if (link === undefined) continue;
      } else {
        link = expandPath(raw, session.env);
      }
      // Never delete the referenced local path itself (local-only mode).
      if (ref.remote === "" && !isSymlink(link)) continue;
      removeLink(link, session);
      removed.push(link);
    }

    // Local-only references never own their source: leave it alone.
    if (ref.remote === "") return;
    if (checkout === undefined) return;

    if (checkout.global) {
      session.reporter.log(`Kept shared checkout ${checkout.path}`);
      return;
    }
    if (isSymlink(checkout.path)) {
      removeLink(checkout.path, session);
      return;
    }
    if (lexists(`${checkout.path}/.git`)) {
      if (!session.force) {
        const disposable = checkoutDisposable(checkout.path, session);
        if (!disposable.ok) throw new ReferError(disposable.message);
      }
      try {
        rmSync(checkout.path, { recursive: true, force: true });
      } catch {
        die(`cannot remove ${checkout.path}`);
      }
      session.reporter.log(`Removed checkout ${checkout.path}`);
      return;
    }
    if (lexists(checkout.path)) {
      session.reporter.warn(`'${checkout.path}' is not a git checkout; left in place`);
    }
  } finally {
    try {
      process.chdir(previous);
    } catch {
      // The original working directory disappeared; nothing useful to do.
    }
  }
}

function checkoutState(path: string): string {
  if (lexists(`${path}/.git`)) return "ok";
  if (lexists(path)) return "not a git checkout";
  return "missing";
}

function linkState(link: string, target: string): string {
  if (!lexists(link)) return "missing";
  if (!isSymlink(link)) return "not a symlink";
  return readlinkSync(link) === target ? "ok" : "stale";
}

function listRef(file: string, session: Session): void {
  const ref = readRef(file, session);
  checkSymlinkTokens(ref.symlinks);

  const previous = process.cwd();
  const dir = dirname(file);

  try {
    process.chdir(dir);
  } catch {
    die(`cannot change directory to ${dir}`);
  }

  try {
    let base = "";
    let target = "";
    let reserved = "";

    if (ref.remote !== "") {
      const parsed = loadRemote(ref.remote, session);
      base = remoteName(parsed);
      const checkout = resolveCheckout(parsed, ref.local, session);
      try {
        target = absPath(checkout.path);
      } catch {
        target = checkout.path;
      }
      if (parsed.subpath !== "") target = `${target}/${parsed.subpath}`;
      reserved = reservedName(checkout);

      session.reporter.log(`  remote: ${ref.remote}`);
      session.reporter.log(
        `  checkout: ${checkout.path} (${checkoutState(checkout.path)}${checkout.global ? ", shared" : ""})`,
      );
      if (parsed.subpath !== "") {
        session.reporter.log(
          `  subpath: ${parsed.subpath} (${lexists(target) ? "ok" : "missing"})`,
        );
      }
    } else {
      const source = expandPath(ref.local, session.env);
      base = basename(source);
      try {
        target = realPath(source);
      } catch {
        target = source;
      }
      session.reporter.log(`  local: ${ref.local}`);
      session.reporter.log(`  source: ${source} (${lexists(source) ? "ok" : "missing"})`);
    }

    const tokens = ref.remote === "" && ref.symlinks.length === 0 ? [":auto"] : ref.symlinks;
    if (tokens.length === 0) {
      session.reporter.log("  links: none");
      return;
    }

    const removed: string[] = [];
    for (const raw of tokens) {
      let link: string;
      if (raw === ":auto") {
        const found = findAutoLink(base, target, reserved, removed);
        if (found === undefined) {
          session.reporter.log("  symlink: :auto (missing)");
          continue;
        }
        removed.push(found);
        link = found;
      } else {
        link = normPath(expandPath(raw, session.env));
      }
      session.reporter.log(`  symlink: ${link} -> ${target} (${linkState(link, target)})`);
    }
  } finally {
    try {
      process.chdir(previous);
    } catch {
      // The original working directory disappeared; nothing useful to do.
    }
  }
}

export function listRefs(recursive: boolean, session: Session): number {
  const files = findRefs(recursive);
  if (files.length === 0) {
    session.reporter.log(`No .ref files found in this directory${recursive ? " or below" : ""}`);
    return 0;
  }

  let failed = 0;
  for (const file of files) {
    session.reporter.log(`==> ${file}`);
    try {
      listRef(file, session);
    } catch (error) {
      failed += 1;
      reportError(session, error);
    }
  }

  if (failed > 0) {
    session.reporter.error(`${failed} of ${files.length} manifest(s) failed`);
    return 1;
  }
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
