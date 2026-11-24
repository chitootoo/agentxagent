import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./cli.js";
import type { Reporter } from "./io.js";
import { VERSION } from "./manifest.js";
import { expandPath, normPath, refPath } from "./paths.js";
import { globalCheckoutDir, isGitUrl, parseRemote, repoName } from "./remote.js";

interface Captured {
  logs: string[];
  warnings: string[];
  errors: string[];
  hints: string[];
  debug: string[];
}

function captureReporter(): { reporter: Reporter; captured: Captured } {
  const captured: Captured = { logs: [], warnings: [], errors: [], hints: [], debug: [] };
  return {
    reporter: {
      log: (message) => captured.logs.push(message),
      warn: (message) => captured.warnings.push(message),
      error: (message) => captured.errors.push(message),
      hint: (message) => captured.hints.push(message),
      debug: (message) => captured.debug.push(message),
    },
    captured,
  };
}

let tmp = "";
let work = "";
let env: NodeJS.ProcessEnv = {};
let originalCwd = "";

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd: cwd ?? process.cwd(),
    env,
    encoding: "utf8",
  });
}

function refer(args: string[]) {
  const { reporter, captured } = captureReporter();
  const code = run(args, { env, reporter });
  return { code, captured };
}

function output(captured: Captured): string {
  return [...captured.logs, ...captured.warnings, ...captured.errors, ...captured.hints].join("\n");
}

function makeRemote(name: string): string {
  const dir = join(tmp, "remotes", `${name}.git`);
  mkdirSync(join(dir, "packages/core"), { recursive: true });
  git(["init", "-q"], dir);
  writeFileSync(join(dir, "README.md"), "content\n");
  writeFileSync(join(dir, "packages/core/index.txt"), "core\n");
  git(["add", "-A"], dir);
  git(["commit", "-qm", "init"], dir);
  return `file://${dir}`;
}

function remoteDir(name: string): string {
  return join(tmp, "remotes", `${name}.git`);
}

function commitTo(name: string, file: string, content: string): void {
  const dir = remoteDir(name);
  writeFileSync(join(dir, file), `${content}\n`);
  git(["add", "-A"], dir);
  git(["commit", "-qm", `update ${file}`], dir);
}

function globalCache(name: string): string {
  return `${env.REFER_REPOS_ROOT}${tmp}/remotes/${name}`;
}

function expectLink(path: string, target?: string): void {
  expect(lstatSync(path).isSymbolicLink()).toBe(true);
  if (target !== undefined) expect(readlinkSync(path)).toBe(target);
}

function expectMissing(path: string): void {
  expect(() => lstatSync(path)).toThrow();
}

function readLines(file: string): string[] {
  return readFileSync(file, "utf8").split("\n");
}

function expectLine(file: string, line: string): void {
  expect(readLines(file)).toContain(line);
}

function expectNoLine(file: string, line: string): void {
  expect(readLines(file)).not.toContain(line);
}

function expectCount(file: string, line: string, count: number): void {
  expect(readLines(file).filter((entry) => entry === line)).toHaveLength(count);
}

beforeEach(() => {
  originalCwd = process.cwd();
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "refer-test-")));
  work = join(tmp, "work");
  mkdirSync(work, { recursive: true });
  process.chdir(work);

  const home = join(tmp, "home");
  mkdirSync(home, { recursive: true });
  env = {
    ...process.env,
    HOME: home,
    REFER_REPOS_ROOT: join(tmp, "cache"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
  };
  delete env.XDG_DATA_HOME;
  delete env.REFER_VERBOSE;

  writeFileSync(
    join(home, ".gitconfig"),
    [
      "[user]",
      "  name = refer tests",
      "  email = tests@example.invalid",
      "[init]",
      "  defaultBranch = main",
      '[protocol "file"]',
      "  allow = always",
      "[advice]",
      "  detachedHead = false",
      "",
    ].join("\n"),
  );
  git(["init", "-q"]);
});

afterEach(() => {
  try {
    process.chdir(originalCwd);
  } catch {
    // ignore
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe("parsing helpers", () => {
  it("splits remotes into url, revision and sub path", () => {
    const cases: Array<[string, string, string, string]> = [
      ["https://github.com/u/r.git", "https://github.com/u/r.git", "", ""],
      ["https://github.com/u/r.git@main", "https://github.com/u/r.git", "main", ""],
      ["https://github.com/u/r.git@main/src", "https://github.com/u/r.git", "main", "src"],
      ["https://github.com/u/r.git/a/b/", "https://github.com/u/r.git", "", "a/b"],
      ["git@github.com:u/r.git", "git@github.com:u/r.git", "", ""],
      ["git@github.com:u/r.git@v1.2.0", "git@github.com:u/r.git", "v1.2.0", ""],
      ["git@github.com:u/r.git@main/src", "git@github.com:u/r.git", "main", "src"],
      ["git@github.com:u/r.git/src", "git@github.com:u/r.git", "", "src"],
      ["file:///tmp/plain", "file:///tmp/plain", "", ""],
    ];
    for (const [input, url, rev, subpath] of cases) {
      expect(parseRemote(input), input).toEqual({ url, rev, subpath });
    }
  });

  it("recognises git URLs", () => {
    for (const value of [
      "https://github.com/u/r.git",
      "https://github.com/u/r",
      "http://h/r.git",
      "git@github.com:u/r.git",
      "git://h/r.git",
      "ssh://git@h/r.git",
      "file:///tmp/r",
      "/srv/r.git",
    ]) {
      expect(isGitUrl(value), value).toBe(true);
    }
    for (const value of ["/local/path", "myrepo", "./dir", "--upload-pack=x", ""]) {
      expect(isGitUrl(value), value).toBe(false);
    }
  });

  it("derives shared cache paths safely", () => {
    const rooted = { ...env, REFER_REPOS_ROOT: "/c" };
    expect(globalCheckoutDir("https://github.com/u/r.git", rooted)).toBe("/c/github.com/u/r");
    expect(globalCheckoutDir("git@github.com:u/r.git", rooted)).toBe("/c/github.com/u/r");
    expect(globalCheckoutDir("https://user:token@github.com/u/r.git", rooted)).toBe(
      "/c/github.com/u/r",
    );
    expect(globalCheckoutDir("ssh://git@h/u/r.git", rooted)).toBe("/c/h/u/r");
    expect(globalCheckoutDir("file:///tmp/r.git", rooted)).toBe("/c/tmp/r");
    expect(() => globalCheckoutDir("https://h/../../etc.git", rooted)).toThrow(/safe cache path/u);
  });

  it("expands only ~ and environment variables", () => {
    const local: NodeJS.ProcessEnv = { ...env, MY_DIR: "/data" };
    expect(expandPath("~", local)).toBe(local.HOME);
    expect(expandPath("~/x", local)).toBe(`${local.HOME}/x`);
    expect(expandPath("$MY_DIR/x", local)).toBe("/data/x");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal ${VAR} expansion
    expect(expandPath("${MY_DIR}-y/z", local)).toBe("/data-y/z");
    expect(expandPath("a~b", local)).toBe("a~b");
    expect(expandPath("$(touch pwned)", local)).toBe("$(touch pwned)");
    expect(expandPath("`touch pwned`", local)).toBe("`touch pwned`");
    expect(() => expandPath("$NOT_DEFINED_ANYWHERE/x", local)).toThrow(/is not set/u);
  });

  it("writes home paths with a tilde", () => {
    const home = env.HOME ?? "";
    expect(refPath(`${home}/a/b`, home)).toBe("~/a/b");
    expect(refPath(home, home)).toBe("~");
    expect(refPath("/elsewhere", home)).toBe("/elsewhere");
    expect(refPath(`${home}-not-home`, home)).toBe(`${home}-not-home`);
  });

  it("normalises relative paths for comparisons", () => {
    expect(normPath("./a/")).toBe("a");
    expect(normPath("././a")).toBe("a");
    expect(normPath("a//")).toBe("a");
    expect(normPath("./")).toBe(".");
    expect(normPath("/")).toBe("/");
  });

  it("derives repository names", () => {
    expect(repoName("https://github.com/u/r.git/")).toBe("r");
    expect(repoName("git@github.com:u/r.git")).toBe("r");
    expect(repoName("host:repo.git")).toBe("repo");
  });
});

describe("CLI basics", () => {
  it("shows help for help, --help, -h and no arguments", () => {
    for (const args of [[], ["help"], ["--help"], ["-h"], ["-v"]]) {
      const { code, captured } = refer(args);
      expect(code).toBe(0);
      const text = output(captured);
      expect(text).toContain("Usage:");
      expect(text).toContain("refer get -r <remote>");
      expect(text).toContain("refer clean");
      expect(text).toContain("refer list");
      expect(text).toContain(".ref format");
      expect(text).toContain("REFER_REPOS_ROOT");
    }
  });

  it("shows help after a subcommand", () => {
    for (const args of [
      ["get", "-h"],
      ["clean", "--help"],
      ["list", "-h"],
    ]) {
      const { code, captured } = refer(args);
      expect(code).toBe(0);
      expect(output(captured)).toContain("Usage:");
    }
  });

  it("prints the version", () => {
    for (const args of [["version"], ["--version"], ["-V"]]) {
      const { code, captured } = refer(args);
      expect(code).toBe(0);
      expect(output(captured)).toBe(`refer ${VERSION}`);
    }
  });

  it("keeps VERSION in sync with package.json", () => {
    const file = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it("returns exit code 2 for usage errors", () => {
    expect(refer(["frobnicate"]).code).toBe(2);
    expect(output(refer(["frobnicate"]).captured)).toContain("unknown command");
    expect(refer(["get", "-s"]).code).toBe(2);
    expect(output(refer(["get", "-s"]).captured)).toContain("needs -r <remote> or -l <path>");
    expect(refer(["get", "--bogus"]).code).toBe(2);
    expect(refer(["get", "-r"]).code).toBe(2);
    expect(refer(["get", "README.md"]).code).toBe(2);
    expect(refer(["get", "*"]).code).toBe(2);
    expect(output(refer(["get", "*"]).captured)).toContain("expected a .ref file, got '*'");
    expect(refer(["clean"]).code).toBe(2);
  });
});

describe("get: remote references", () => {
  it("clones a remote into ./<repo> and records the manifest", () => {
    const url = makeRemote("tools");
    const { code } = refer(["get", "-r", url]);
    expect(code).toBe(0);
    expect(existsSync("tools/.git")).toBe(true);
    expect(existsSync("tools/README.md")).toBe(true);
    expectLine("tools.ref", `remote: ${url}`);
    expectLine("tools.ref", "local: :auto");
    expectLine(
      "tools.ref",
      "# Managed by refer - https://github.com/chitootoo/agentxagent/tree/main/packages/refer",
    );
    expectLine(".gitignore", "/tools");
    expectNoLine(".gitignore", "tools.ref");
  });

  it("rejects -R when adding a reference", () => {
    const url = makeRemote("rec");
    const { code, captured } = refer(["get", "-R", "-r", url]);
    expect(code).toBe(2);
    expect(output(captured)).toContain("only applies");
    expectMissing("rec");
  });

  it("supports shared checkouts with automatic link names", () => {
    const url = makeRemote("shared");
    const cache = globalCache("shared");
    expect(refer(["get", "-r", url, "-g", "-s", "-s"]).code).toBe(0);
    expect(existsSync(`${cache}/.git`)).toBe(true);
    expectLink("shared", cache);
    expectLink("shared2", cache);
    expectLine("shared.ref", "local: :global");
    expectCount("shared.ref", "symlink: :auto", 2);

    expect(refer(["get", "-r", url, "-g", "-s", "./other", "-n", "other"]).code).toBe(0);
    expectLink("other", cache);
  });

  it("reserves the checkout name for automatic links", () => {
    const url = makeRemote("hello");
    expect(refer(["get", "-r", url, "-l", "-s", "-s"]).code).toBe(0);
    expect(existsSync("hello/.git")).toBe(true);
    expectLink("hello2", join(work, "hello"));
    expectLink("hello3", join(work, "hello"));
    expectLine("hello.ref", "local: :auto");
    expectCount("hello.ref", "symlink: :auto", 2);
  });

  it("clones into an explicit local path", () => {
    const url = makeRemote("lib");
    expect(refer(["get", "-r", url, "-l", "vendor/lib"]).code).toBe(0);
    expect(existsSync("vendor/lib/.git")).toBe(true);
    expectLine("lib.ref", "local: vendor/lib");
    expectLine("vendor/.gitignore", "/lib");
  });

  it("links only a sub path of a repository", () => {
    const url = makeRemote("mono");
    expect(refer(["get", "-r", `${url}/packages/core`, "-s", "-s", "./core"]).code).toBe(0);
    expect(existsSync("mono/.git")).toBe(true);
    expectLink("core", join(work, "mono/packages/core"));
    expectLink("core2", join(work, "mono/packages/core"));
    expect(readFileSync("core/index.txt", "utf8")).toBe("core\n");
    expectLine("core.ref", `remote: ${url}/packages/core`);

    const second = refer(["get", "-r", `${url}/packages/core`, "-n", "core-nolink", "-l", "other"]);
    expect(second.code).toBe(0);
    expect(output(second.captured)).toContain("add -s");
  });

  it("fails when the sub path is missing", () => {
    const url = makeRemote("mono");
    const { code, captured } = refer(["get", "-r", `${url}/does/not/exist`, "-s", "./x"]);
    expect(code).toBe(1);
    expect(output(captured)).toContain("does not exist");
    expectMissing("x.ref");
    expectMissing("exist.ref");
  });

  it("rejects .. in sub paths", () => {
    const url = makeRemote("mono");
    const { code, captured } = refer(["get", "-r", `${url}/../../etc`, "-s", "./x"]);
    expect(code).toBe(1);
    expect(output(captured)).toContain("must not contain '..'");
  });

  it("checks out branches, tags and pinned commits", () => {
    const url = makeRemote("rev");
    const dir = remoteDir("rev");
    const first = git(["rev-parse", "HEAD"], dir).trim();
    git(["checkout", "-qb", "dev"], dir);
    commitTo("rev", "dev.txt", "dev");
    git(["checkout", "-q", "main"], dir);

    expect(refer(["get", "-r", `${url}@dev`, "-n", "rev-dev", "-l", "rev-dev"]).code).toBe(0);
    expect(existsSync("rev-dev/dev.txt")).toBe(true);

    expect(
      refer(["get", "-r", `${url}@${first}`, "-n", "rev-pinned", "-l", "rev-pinned"]).code,
    ).toBe(0);
    expect(git(["rev-parse", "HEAD"], "rev-pinned").trim()).toBe(first);

    commitTo("rev", "later.txt", "later");
    const updated = refer(["get", "-u", "rev-pinned.ref"]);
    expect(updated.code).toBe(0);
    expect(output(updated.captured)).toContain("pinned");
    expect(git(["rev-parse", "HEAD"], "rev-pinned").trim()).toBe(first);
  });

  it("rejects invalid and unreachable remotes", () => {
    const invalid = refer(["get", "-r", "not-a-url"]);
    expect(invalid.code).toBe(1);
    expect(output(invalid.captured)).toContain("invalid remote");

    const unreachable = refer(["get", "-r", `file://${tmp}/nowhere.git`]);
    expect(unreachable.code).toBe(1);
    expectMissing("nowhere.ref");
  });

  it("links across directories with absolute targets", () => {
    const url = makeRemote("skills");
    expect(refer(["get", "-r", url, "-s", ".agents/skills/x", "-s", ".claude/skills/x"]).code).toBe(
      0,
    );
    expectLink(".agents/skills/x", join(work, "skills"));
    expect(readFileSync(".claude/skills/x/README.md", "utf8")).toBe("content\n");
    expectLine(".agents/skills/.gitignore", "/x");
  });

  it("fast-forwards checkouts when the manifest asks for updates", () => {
    const url = makeRemote("upd");
    expect(refer(["get", "-r", url, "-u"]).code).toBe(0);
    expectLine("upd.ref", "flags: update");
    commitTo("upd", "new.txt", "fresh");
    expect(refer(["get", "upd.ref"]).code).toBe(0);
    expect(readFileSync("upd/new.txt", "utf8")).toBe("fresh\n");
  });

  it("does not update unless requested or overridden", () => {
    const url = makeRemote("upd");
    expect(refer(["get", "-r", url]).code).toBe(0);
    commitTo("upd", "new.txt", "fresh");
    expect(refer(["get", "upd.ref"]).code).toBe(0);
    expectMissing("upd/new.txt");
    expect(refer(["get", "-u", "upd.ref"]).code).toBe(0);
    expect(existsSync("upd/new.txt")).toBe(true);
  });
});

describe("get: local references", () => {
  it("links a local directory with automatic names", () => {
    mkdirSync("source");
    writeFileSync("source/file.txt", "payload\n");
    expect(refer(["get", "-l", "./source", "-s", "-s"]).code).toBe(0);
    expectLink("source2", join(work, "source"));
    expectLink("source3", join(work, "source"));
    expectLine("source.ref", "local: ./source");
    expectNoLine("source.ref", "remote:");
  });

  it("links a local directory under its basename by default", () => {
    const outside = join(tmp, "outside/workspace");
    mkdirSync(outside, { recursive: true });
    expect(refer(["get", "-l", outside]).code).toBe(0);
    expectLink("workspace", outside);
    expectLine(".gitignore", "/workspace");
  });

  it("skips a link that points at the local path itself", () => {
    writeFileSync("target_file", "x\n");
    const { code, captured } = refer(["get", "-l", "./target_file", "-s", "./target_file"]);
    expect(code).toBe(0);
    expect(output(captured)).toContain("is the local path itself");
    expect(lstatSync("target_file").isSymbolicLink()).toBe(false);
  });

  it("resolves symlinked local sources", () => {
    const real = join(tmp, "real");
    mkdirSync(real);
    symlinkSync(real, join(tmp, "alias"));
    expect(refer(["get", "-l", join(tmp, "alias"), "-s", "./x"]).code).toBe(0);
    expectLink("x", real);
  });

  it("rejects missing and special local paths", () => {
    expect(refer(["get", "-l", "./missing"]).code).toBe(1);
    const noValue = refer(["get", "-l"]);
    expect(noValue.code).toBe(2);
    expect(output(noValue.captured)).toContain("must be an existing file or directory");
    expect(refer(["get", "-l", ":global"]).code).toBe(2);
  });

  it("keeps environment variables and tildes in the manifest", () => {
    mkdirSync("shared/data", { recursive: true });
    mkdirSync(join(env.HOME ?? "", "stuff"), { recursive: true });
    env.MY_SHARED_PATH = "./shared/data";

    expect(refer(["get", "-l", "$MY_SHARED_PATH", "-s"]).code).toBe(0);
    expectLine("data.ref", "local: $MY_SHARED_PATH");
    expectLine("data.ref", "symlink: :auto");
    expectLink("data", join(work, "shared/data"));

    expect(refer(["get", "-l", `${env.HOME}/stuff`, "-s", `${env.HOME}/stuff-link`]).code).toBe(0);
    expectLine("stuff.ref", "local: ~/stuff");
    expectLine("stuff.ref", "symlink: ~/stuff-link");
  });

  it("validates symlink tokens", () => {
    mkdirSync("src");
    expect(refer(["get", "-l", "./src", "-s", ":global"]).code).toBe(2);
    const duplicate = refer(["get", "-l", "./src", "-s", "./a", "-s", "./a"]);
    expect(duplicate.code).toBe(2);
    expect(output(duplicate.captured)).toContain("duplicate");
  });

  it("refuses to clobber real files unless forced", () => {
    mkdirSync("src");
    mkdirSync("precious");
    writeFileSync("precious/data", "keep\n");

    const blocked = refer(["get", "-l", "./src", "-s", "./precious"]);
    expect(blocked.code).toBe(1);
    expect(output(blocked.captured)).toContain("not a symlink");
    expect(readFileSync("precious/data", "utf8")).toBe("keep\n");

    expect(refer(["get", "-f", "-l", "./src", "-s", "./precious"]).code).toBe(0);
    expectLink("precious", join(work, "src"));
  });

  it("replaces a stale symlink", () => {
    mkdirSync("a");
    mkdirSync("b");
    symlinkSync(join(work, "a"), "link");
    expect(refer(["get", "-l", "./b", "-s", "./link"]).code).toBe(0);
    expectLink("link", join(work, "b"));
  });
});

describe("manifests", () => {
  it("rewrites a manifest without duplicating fields and keeps comments", () => {
    const url = makeRemote("dup");
    expect(refer(["get", "-r", url, "-s"]).code).toBe(0);
    const original = readFileSync("dup.ref", "utf8");
    writeFileSync("dup.ref", `# my note\n${original}`);
    expect(refer(["get", "-r", url, "-s"]).code).toBe(0);
    expectCount("dup.ref", `remote: ${url}`, 1);
    expectCount("dup.ref", "symlink: :auto", 1);
    expectLine("dup.ref", "# my note");
  });

  it("refuses to reuse a manifest name for a different reference", () => {
    const one = makeRemote("one");
    const two = makeRemote("two");
    expect(refer(["get", "-r", one, "-l", "one", "-n", "utils"]).code).toBe(0);

    const collision = refer(["get", "-r", two, "-l", "two", "-n", "utils"]);
    expect(collision.code).toBe(1);
    expect(output(collision.captured)).toContain("different reference");
    expectLine("utils.ref", `remote: ${one}`);
    expect(refer(["get", "-r", two, "-n", "utils2"]).code).toBe(0);
  });

  it("replays manifests idempotently", () => {
    const url = makeRemote("idem");
    expect(refer(["get", "-r", url, "-s", "-s"]).code).toBe(0);
    expect(refer(["get", "idem.ref"]).code).toBe(0);
    expect(refer(["get", "idem.ref"]).code).toBe(0);
    expectLink("idem2");
    expectLink("idem3");
    expectMissing("idem4");
    expectCount(".gitignore", "/idem2", 1);
  });

  it("resolves relative paths from the manifest directory", () => {
    const url = makeRemote("portable");
    mkdirSync("proj");
    mkdirSync(join(tmp, "assets"));
    writeFileSync("proj/portable.ref", `remote: ${url}\nlocal: :auto\nsymlink: :auto\n`);
    writeFileSync("proj/local.ref", "local: $PORTABLE_ASSETS\nsymlink: :auto\n");

    process.chdir(tmp);
    env.PORTABLE_ASSETS = "../../assets";
    const { code } = refer(["get", join(work, "proj/portable.ref"), join(work, "proj/local.ref")]);
    expect(code).toBe(0);
    expect(existsSync(join(work, "proj/portable/.git"))).toBe(true);
    expectLink(join(work, "proj/portable2"), join(work, "proj/portable"));
    expectLink(join(work, "proj/assets"), join(tmp, "assets"));
  });

  it("restores a fresh clone to a clean git status", () => {
    const url = makeRemote("dep");
    expect(refer(["get", "-r", url, "-s", "./linked"]).code).toBe(0);
    git(["add", "-A"]);
    git(["commit", "-qm", "add dep"]);

    const fresh = join(tmp, "fresh");
    git(["clone", "-q", work, fresh]);
    process.chdir(fresh);
    expect(existsSync("dep.ref")).toBe(true);
    expectMissing("dep");

    expect(refer(["get"]).code).toBe(0);
    expect(existsSync("dep/.git")).toBe(true);
    expectLink("linked", join(fresh, "dep"));
    expect(git(["status", "--porcelain"])).toBe("");
  });

  it("replays every manifest when given no arguments", () => {
    const url = makeRemote("plain");
    writeFileSync("plain.ref", `remote: ${url}\n`);

    const { code, captured } = refer(["get"]);
    expect(code).toBe(0);
    expect(existsSync("plain/.git")).toBe(true);
    expect(output(captured)).toContain("Processed 1 manifest(s)");
  });

  it("replays all manifests, recursively when asked", () => {
    const top = makeRemote("top");
    const nested = makeRemote("nested");
    writeFileSync("top.ref", `remote: ${top}\n`);
    mkdirSync("sub");
    writeFileSync("sub/nested.ref", `remote: ${nested}\n`);

    expect(refer(["get"]).code).toBe(0);
    expect(existsSync("top/.git")).toBe(true);
    expectMissing("sub/nested");

    const recursive = refer(["get", "-R"]);
    expect(recursive.code).toBe(0);
    expect(existsSync("sub/nested/.git")).toBe(true);
    expect(output(recursive.captured)).toContain("Processed 2 manifest(s)");
  });

  it("skips manifests inside nested git repositories", () => {
    const url = makeRemote("inner");
    mkdirSync("vendored");
    git(["init", "-q"], "vendored");
    writeFileSync("vendored/inner.ref", `remote: ${url}\n`);

    const { code, captured } = refer(["get", "-R"]);
    expect(code).toBe(0);
    expectMissing("vendored/inner");
    expect(output(captured)).toContain("No .ref files found");
  });

  it("reports per-manifest failures and continues", () => {
    const good = makeRemote("good");
    writeFileSync("a-good.ref", `remote: ${good}\n`);
    writeFileSync("b-bad.ref", `remote: file://${tmp}/missing.git\n`);
    writeFileSync("c-bad.ref", "local: ./nope\n");

    const { code, captured } = refer(["get"]);
    expect(code).toBe(1);
    expect(existsSync("good/.git")).toBe(true);
    expect(output(captured)).toContain("2 of 3 manifest(s) failed");
  });

  it("reports when there are no manifests", () => {
    for (const args of [["get"], ["get", "-R"]]) {
      const { code, captured } = refer(args);
      expect(code).toBe(0);
      expect(output(captured)).toContain("No .ref files found in this directory");
    }
  });

  it("supports legacy global flags and empty remote lines", () => {
    const url = makeRemote("legacy");
    writeFileSync("pure.ref", `remote: ${url}\nsymlink: ./pure\nflags: global\n`);
    mkdirSync("source");
    writeFileSync("local.ref", "remote: \nlocal: ./source\nsymlink: ./mylink\n");

    expect(refer(["get", "pure.ref", "local.ref"]).code).toBe(0);
    expectLink("pure", globalCache("legacy"));
    expectLink("mylink", join(work, "source"));
  });

  it("handles CRLF and comments", () => {
    mkdirSync("source");
    writeFileSync("w.ref", "# comment\r\n\r\nlocal: ./source\r\nsymlink: ./crlf\r\n");
    expect(refer(["get", "w.ref"]).code).toBe(0);
    expectLink("crlf", join(work, "source"));
  });

  it("never evaluates code from a manifest", () => {
    writeFileSync("evil.ref", `local: $(touch ${tmp}/pwned)\n`);
    writeFileSync("evil2.ref", `local: ./x\nsymlink: \`touch ${tmp}/pwned2\`\n`);
    mkdirSync("x");

    refer(["get", "evil.ref", "evil2.ref"]);
    expectMissing(`${tmp}/pwned`);
    expectMissing(`${tmp}/pwned2`);
  });

  it("fails on undefined environment variables", () => {
    writeFileSync("u.ref", "local: $SURELY_UNDEFINED_VAR/x\n");
    const { code, captured } = refer(["get", "u.ref"]);
    expect(code).toBe(1);
    expect(output(captured)).toContain("is not set");
  });
});

describe(".gitignore handling", () => {
  it("adds one entry per link and respects existing patterns", () => {
    mkdirSync("src");
    writeFileSync(".gitignore", "node_modules");
    expect(refer(["get", "-l", "./src", "-s", "./a"]).code).toBe(0);
    expectLine(".gitignore", "node_modules");
    expectLine(".gitignore", "/a");

    writeFileSync(".gitignore", `${readFileSync(".gitignore", "utf8")}b/\n`);
    expect(refer(["get", "-l", "./src", "-s", "./b", "-n", "src-b"]).code).toBe(0);
    expectNoLine(".gitignore", "/b");

    writeFileSync(".gitignore", `${readFileSync(".gitignore", "utf8")}ignored-*\n`);
    expect(refer(["get", "-l", "./src", "-s", "./ignored-c", "-n", "src-c"]).code).toBe(0);
    expectNoLine(".gitignore", "/ignored-c");
  });

  it("does not touch .gitignore outside a git work tree", () => {
    const plain = join(tmp, "plain");
    mkdirSync(join(plain, "src"), { recursive: true });
    process.chdir(plain);
    expect(refer(["get", "-l", "./src", "-s", "./a"]).code).toBe(0);
    expectMissing(join(plain, ".gitignore"));
  });
});

describe("clean", () => {
  it("removes explicit links and keeps the manifest", () => {
    writeFileSync(
      "myref.ref",
      "remote: file:///some/where.git\nlocal: :global\nsymlink: ./l1\nsymlink: ./l2\n",
    );
    symlinkSync("/some/path", "l1");
    symlinkSync("/some/path", "l2");

    expect(refer(["clean", "myref.ref"]).code).toBe(0);
    expect(existsSync("myref.ref")).toBe(true);
    expectMissing("l1");
    expectMissing("l2");
  });

  it("removes automatic links and the project-local checkout", () => {
    const url = makeRemote("tools");
    expect(refer(["get", "-r", url, "-s", "-s", "./elsewhere/t"]).code).toBe(0);
    expect(refer(["clean", "tools"]).code).toBe(0);
    expect(existsSync("tools.ref")).toBe(true);
    expectMissing("tools");
    expectMissing("tools2");
    expectMissing("tools3");
    expectMissing("elsewhere/t");
  });

  it("never deletes a local-only source", () => {
    mkdirSync("source");
    writeFileSync("source/data", "precious\n");
    expect(refer(["get", "-l", "./source", "-s", "./link", "-s"]).code).toBe(0);
    expect(refer(["clean", "source.ref"]).code).toBe(0);
    expect(readFileSync("source/data", "utf8")).toBe("precious\n");
    expectMissing("link");
    expectMissing("source2");
  });

  it("refuses to delete unsaved work without --force", () => {
    const url = makeRemote("work");
    expect(refer(["get", "-r", url]).code).toBe(0);
    writeFileSync("work/README.md", "content\nedit\n");

    const dirty = refer(["clean", "work.ref"]);
    expect(dirty.code).toBe(1);
    expect(output(dirty.captured)).toContain("uncommitted changes");
    expect(existsSync("work/.git")).toBe(true);

    git(["commit", "-qam", "local only"], "work");
    const unpushed = refer(["clean", "work.ref"]);
    expect(unpushed.code).toBe(1);
    expect(output(unpushed.captured)).toContain("not on any remote");

    expect(refer(["clean", "-f", "work.ref"]).code).toBe(0);
    expectMissing("work");
  });

  it("keeps shared checkouts", () => {
    const url = makeRemote("shared");
    expect(refer(["get", "-r", url, "-g", "-s", "./s"]).code).toBe(0);
    const { code, captured } = refer(["clean", "shared.ref"]);
    expect(code).toBe(0);
    expectMissing("s");
    expect(existsSync(`${globalCache("shared")}/.git`)).toBe(true);
    expect(output(captured)).toContain("Kept shared checkout");
  });

  it("fails when the manifest is missing", () => {
    const { code, captured } = refer(["clean", "nothing.ref"]);
    expect(code).toBe(1);
    expect(output(captured)).toContain("does not exist");
  });

  it("allows get to restore after clean", () => {
    const url = makeRemote("cycle");
    expect(refer(["get", "-r", url, "-s"]).code).toBe(0);
    expect(refer(["clean", "cycle.ref"]).code).toBe(0);
    expect(refer(["get", "cycle.ref"]).code).toBe(0);
    expectLink("cycle2", join(work, "cycle"));
  });
});

describe("list", () => {
  it("shows checkout and link state", () => {
    const url = makeRemote("dep");
    expect(refer(["get", "-r", url, "-s", "./linked"]).code).toBe(0);

    const { code, captured } = refer(["list"]);
    expect(code).toBe(0);
    const text = output(captured);
    expect(text).toContain("==> ./dep.ref");
    expect(text).toContain(`remote: ${url}`);
    expect(text).toContain("checkout: ./dep (ok)");
    expect(text).toContain("symlink: linked -> ");
    expect(text).toContain("(ok)");
  });

  it("reports missing and stale links", () => {
    mkdirSync("source");
    mkdirSync("other");
    expect(refer(["get", "-l", "./source", "-s", "./link"]).code).toBe(0);

    rmSync("link");
    expect(output(refer(["list"]).captured)).toContain("symlink: link -> ");
    expect(output(refer(["list"]).captured)).toContain("(missing)");

    symlinkSync(join(work, "other"), "link");
    expect(output(refer(["list"]).captured)).toContain("(stale)");
  });

  it("resolves automatic links", () => {
    const url = makeRemote("auto");
    expect(refer(["get", "-r", url, "-s"]).code).toBe(0);
    const text = output(refer(["list"]).captured);
    expect(text).toContain("symlink: auto2 -> ");
    expect(text).toContain("(ok)");

    rmSync("auto2");
    expect(output(refer(["list"]).captured)).toContain("symlink: :auto (missing)");
  });

  it("includes nested manifests only with -R", () => {
    const url = makeRemote("nested");
    mkdirSync("sub");
    writeFileSync("sub/nested.ref", `remote: ${url}\n`);

    expect(output(refer(["list"]).captured)).not.toContain("sub/nested.ref");
    expect(output(refer(["list", "-R"]).captured)).toContain("==> ./sub/nested.ref");
  });

  it("reports when there are no manifests", () => {
    const { code, captured } = refer(["list"]);
    expect(code).toBe(0);
    expect(output(captured)).toContain("No .ref files found in this directory");
  });

  it("rejects unknown options and arguments", () => {
    expect(refer(["list", "--bogus"]).code).toBe(2);
    expect(refer(["list", "extra"]).code).toBe(2);
  });
});
