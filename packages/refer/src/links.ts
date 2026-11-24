import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname } from "node:path";
import { die, usageError } from "./errors.js";
import { git } from "./git.js";
import type { Session } from "./io.js";
import { expandPath, isSymlink, lexists, normPath } from "./paths.js";

// Add "/<name>" to the .gitignore next to <path>, if that directory is inside
// a git work tree and the path is not ignored already.
export function gitignoreAdd(path: string, session: Session): void {
  const dir = dirname(path);
  const name = basename(path);

  const inside = git(["-C", dir, "rev-parse", "--is-inside-work-tree"], session);
  if (inside.stdout.trim() !== "true") {
    session.reporter.debug(`${dir} is not in a git work tree; not touching .gitignore`);
    return;
  }

  const file = `${dir}/.gitignore`;
  if (existsSync(file)) {
    const lines = readFileSync(file, "utf8").split("\n");
    const candidates = [name, `${name}/`, `/${name}`, `/${name}/`];
    if (candidates.some((candidate) => lines.includes(candidate))) {
      session.reporter.debug(`${name} already listed in ${file}`);
      return;
    }
  }

  const ignored = git(["-C", dir, "check-ignore", "-q", "--", name], session);
  if (ignored.status === 0) {
    session.reporter.debug(`${path} is already ignored`);
    return;
  }

  let prefix = "";
  if (existsSync(file) && statSync(file).size > 0) {
    const content = readFileSync(file, "utf8");
    if (!content.endsWith("\n")) prefix = "\n";
  }
  appendFileSync(file, `${prefix}/${name}\n`);
  session.reporter.log(`Added /${name} to ${file}`);
}

export function checkSymlinkTokens(tokens: string[]): void {
  const seen: string[] = [];
  for (const raw of tokens) {
    if (raw === ":global") {
      usageError(`'${raw}' is not valid as a symlink path`);
    }
    if (raw === ":auto" || raw === "") continue;
    const normalized = normPath(raw);
    if (seen.includes(normalized)) usageError(`duplicate symlink path '${normalized}'`);
    seen.push(normalized);
  }
}

// Pick the name for an :auto symlink: <base>, <base>2, <base>3, ... The first
// name that is free, or that already links to <target>, so replays are stable.
export function autoLinkName(
  base: string,
  target: string,
  reserved: string,
  taken: string[],
): string {
  let candidate = base;
  let counter = 2;
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    if (candidate !== reserved && !taken.includes(candidate)) {
      if (isSymlink(candidate) && readlinkSync(candidate) === target) return candidate;
      if (!lexists(candidate)) return candidate;
    }
    candidate = `${base}${counter}`;
    counter += 1;
  }
  die(`cannot find a free symlink name for '${base}'`);
}

// Find an existing :auto symlink to <target> (used by clean); empty if none.
export function findAutoLink(
  base: string,
  target: string,
  reserved: string,
  removed: string[],
): string | undefined {
  let candidate = base;
  let counter = 2;
  while (counter <= 100) {
    if (
      candidate !== reserved &&
      !removed.includes(candidate) &&
      isSymlink(candidate) &&
      readlinkSync(candidate) === target
    ) {
      return candidate;
    }
    candidate = `${base}${counter}`;
    counter += 1;
  }
  return undefined;
}

export function makeLink(link: string, target: string, session: Session): void {
  if (isSymlink(link)) {
    if (readlinkSync(link) === target) {
      session.reporter.log(`Up to date: ${link} -> ${target}`);
      gitignoreAdd(link, session);
      return;
    }
    unlinkSync(link);
  } else if (lexists(link)) {
    if (!session.force) {
      die(`'${link}' already exists and is not a symlink; move it away or re-run with --force`);
    }
    session.reporter.warn(`replacing existing '${link}' (--force)`);
    rmSync(link, { recursive: true, force: true });
  }

  try {
    mkdirSync(dirname(link), { recursive: true });
  } catch {
    die(`cannot create the directory for ${link}`);
  }
  try {
    symlinkSync(target, link);
  } catch {
    die(`cannot create symlink ${link}`);
  }
  session.reporter.log(`Linked ${link} -> ${target}`);
  gitignoreAdd(link, session);
}

// Resolve symlink tokens to concrete link paths. Explicit paths are claimed
// first so an :auto name never collides with one of them.
export function resolveLinks(
  base: string,
  target: string,
  reserved: string,
  tokens: string[],
  session: Session,
): string[] {
  const explicit = tokens
    .filter((token) => token !== "" && token !== ":auto")
    .map((token) => normPath(expandPath(token, session.env)));

  const resolved: string[] = [];
  for (const raw of tokens) {
    if (raw === "") continue;
    if (raw === ":auto") {
      resolved.push(autoLinkName(base, target, reserved, [...explicit, ...resolved]));
    } else {
      resolved.push(normPath(expandPath(raw, session.env)));
    }
  }
  return resolved;
}
