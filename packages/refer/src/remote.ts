import { die } from "./errors.js";
import type { Session } from "./io.js";
import { hasDotDot } from "./paths.js";

export interface ParsedRemote {
  url: string;
  rev: string;
  subpath: string;
}

export function isGitUrl(value: string): boolean {
  if (/^(?:https?|ssh|git|file):\/\//.test(value)) return true;
  if (value.startsWith("-")) return false;
  if (value.includes("@") && value.indexOf(":") > value.indexOf("@")) return true;
  return value.endsWith(".git") || value.includes(".git/") || value.includes(".git@");
}

// Split <url>[@<rev>][/<sub/path>] into url, rev and subpath. The URL ends at
// the first ".git" followed by "@", "/" or the end of the input.
export function parseRemote(input: string): ParsedRemote {
  let url = input;
  let rev = "";
  let subpath = "";

  const atIndex = input.indexOf(".git@");
  const slashIndex = input.indexOf(".git/");
  const at = atIndex === -1 ? input : input.slice(0, atIndex);
  const slash = slashIndex === -1 ? input : input.slice(0, slashIndex);

  if (at !== input && (slash === input || at.length <= slash.length)) {
    url = `${at}.git`;
    const rest = input.slice(url.length + 1);
    const separator = rest.indexOf("/");
    if (separator >= 0) {
      rev = rest.slice(0, separator);
      subpath = rest.slice(separator + 1);
    } else {
      rev = rest;
    }
  } else if (slash !== input) {
    url = `${slash}.git`;
    subpath = input.slice(url.length + 1);
  }

  while (subpath.endsWith("/")) subpath = subpath.slice(0, -1);
  return { url, rev, subpath };
}

export function repoName(url: string): string {
  let name = url.endsWith("/") ? url.slice(0, -1) : url;
  name = name.slice(name.lastIndexOf("/") + 1);
  name = name.slice(name.lastIndexOf(":") + 1);
  return name.endsWith(".git") ? name.slice(0, -4) : name;
}

export function remoteName(remote: ParsedRemote): string {
  if (remote.subpath !== "") {
    const parts = remote.subpath.split("/");
    return parts[parts.length - 1] ?? remote.subpath;
  }
  return repoName(remote.url);
}

export function isCommitSha(value: string): boolean {
  return /^[0-9a-fA-F]{7,40}$/.test(value);
}

export function reposRoot(env: NodeJS.ProcessEnv): string {
  if (env.REFER_REPOS_ROOT) return env.REFER_REPOS_ROOT;
  return `${env.HOME ?? ""}/.contagxt/repos`;
}

// Shared cache location for a URL: $REFER_REPOS_ROOT/<host>/<path>.
export function globalCheckoutDir(url: string, env: NodeJS.ProcessEnv): string {
  const scheme = url.indexOf("://");
  let path = scheme === -1 ? url : url.slice(scheme + 3);

  const slash = path.indexOf("/");
  const firstSegment = slash === -1 ? path : path.slice(0, slash);
  if (firstSegment.includes("@")) path = path.slice(path.indexOf("@") + 1);

  if (path.endsWith("/")) path = path.slice(0, -1);
  if (path.endsWith(".git")) path = path.slice(0, -4);
  path = path.replace(":", "/");
  path = path.replace(/^\/+/u, "");

  if (path === "" || path.split("/").includes("..")) {
    die(`cannot derive a safe cache path from remote '${url}'`);
  }
  return `${reposRoot(env)}/${path}`;
}

export function loadRemote(remote: string, session: Session): ParsedRemote {
  if (!isGitUrl(remote)) {
    die(`invalid remote '${remote}' (expected a git URL such as https://host/user/repo.git)`);
  }
  const parsed = parseRemote(remote);
  if (parsed.rev === "" && (remote.endsWith(".git@") || remote.includes(".git@/"))) {
    die(`empty revision after '@' in remote '${remote}'`);
  }
  if (hasDotDot(parsed.subpath)) {
    die(`sub path must not contain '..': '${parsed.subpath}'`);
  }
  session.reporter.debug(`remote url=${parsed.url} rev=${parsed.rev} subpath=${parsed.subpath}`);
  return parsed;
}
