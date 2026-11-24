import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { die } from "./errors.js";
import type { Session } from "./io.js";
import { isDirectory, lexists } from "./paths.js";
import { isCommitSha } from "./remote.js";

interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function git(args: string[], session: Session): GitResult {
  const result = spawnSync("git", args, { encoding: "utf8", env: session.env });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function gitAvailable(session: Session): boolean {
  const result = spawnSync("git", ["--version"], { env: session.env, stdio: "ignore" });
  return result.status === 0;
}

function failWithGitOutput(result: GitResult, session: Session): void {
  const detail = result.stderr.trim();
  if (detail !== "") session.reporter.error(detail);
}

export function ensureCheckout(
  url: string,
  rev: string,
  dir: string,
  update: boolean,
  session: Session,
): void {
  if (lexists(`${dir}/.git`)) {
    session.reporter.debug(`found existing checkout at ${dir}`);
    if (update) updateCheckout(dir, session);
    return;
  }

  if (lexists(dir)) {
    const empty = isDirectory(dir) && readdirSync(dir).length === 0;
    if (!empty) die(`'${dir}' already exists and is not a git checkout`);
  }

  try {
    mkdirSync(dirname(dir), { recursive: true });
  } catch {
    die(`cannot create the parent directory of ${dir}`);
  }

  session.reporter.log(`Cloning ${url}${rev !== "" ? ` (${rev})` : ""} into ${dir}`);

  if (rev !== "" && isCommitSha(rev)) {
    const clone = git(["clone", "--", url, dir], session);
    if (clone.status !== 0) {
      failWithGitOutput(clone, session);
      die(`failed to clone ${url}`);
    }
    const checkout = git(
      ["-C", dir, "-c", "advice.detachedHead=false", "checkout", "--quiet", rev],
      session,
    );
    if (checkout.status !== 0) {
      failWithGitOutput(checkout, session);
      die(`revision '${rev}' not found in ${url}`);
    }
    return;
  }

  if (rev !== "") {
    const clone = git(["clone", "--branch", rev, "--", url, dir], session);
    if (clone.status !== 0) {
      failWithGitOutput(clone, session);
      die(`failed to clone ${url} (branch or tag '${rev}')`);
    }
    return;
  }

  const clone = git(["clone", "--", url, dir], session);
  if (clone.status !== 0) {
    failWithGitOutput(clone, session);
    die(`failed to clone ${url}`);
  }
}

export function updateCheckout(dir: string, session: Session): void {
  const head = git(["-C", dir, "symbolic-ref", "-q", "HEAD"], session);
  if (head.status !== 0) {
    session.reporter.log(`Skipping update of ${dir} (pinned to a fixed revision)`);
    return;
  }

  session.reporter.log(`Updating ${dir}`);
  const pull = git(["-C", dir, "pull", "--ff-only", "--quiet"], session);
  if (pull.status !== 0) {
    session.reporter.warn(`could not fast-forward ${dir}; leaving it as is`);
  }
}

// Refuse to delete a checkout that holds work that exists nowhere else.
export function checkoutDisposable(
  dir: string,
  session: Session,
): { ok: true } | { ok: false; message: string } {
  const status = git(["-C", dir, "status", "--porcelain"], session);
  if (status.status !== 0) {
    return { ok: false, message: `cannot inspect ${dir}` };
  }
  if (status.stdout.trim() !== "") {
    return {
      ok: false,
      message: `${dir} has uncommitted changes; commit/stash them or use 'refer clean -f'`,
    };
  }

  const unpushed = git(
    ["-C", dir, "log", "--branches", "--not", "--remotes", "--oneline"],
    session,
  );
  if (unpushed.status !== 0) {
    return { ok: false, message: `cannot inspect ${dir}` };
  }
  if (unpushed.stdout.trim() !== "") {
    return {
      ok: false,
      message: `${dir} has commits that are not on any remote; push them or use 'refer clean -f'`,
    };
  }
  return { ok: true };
}
