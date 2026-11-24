import { basename } from "node:path";
import { die, ReferError, usageError } from "./errors.js";
import { gitAvailable } from "./git.js";
import { createReporter, type Reporter, type Session } from "./io.js";
import { HOMEPAGE, readRef, VERSION, writeRef } from "./manifest.js";
import { expandPath, homeDir, isFile, refPath } from "./paths.js";
import { applyRef, cleanRef, listRefs, replayAll, replayRef, reportError } from "./reference.js";
import { loadRemote, remoteName } from "./remote.js";

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  reporter?: Reporter;
}

interface GetOptions {
  remote: string;
  local: string;
  symlinks: string[];
  update: boolean;
  recursive: boolean;
  name: string;
  global: boolean;
  positional: string[];
}

function hasValue(args: string[], index: number): boolean {
  const next = args[index + 1];
  return index + 1 < args.length && next !== undefined && next !== "" && !next.startsWith("-");
}

function helpText(): string {
  return `refer ${VERSION} - reference external repos and directories via .ref manifests

Usage:
  refer get -r <remote> [-l [<path>] | -g] [-s [<path>]]... [-u] [-n <name>]
  refer get -l <path> [-s [<path>]]... [-n <name>]
  refer get [-u] [-R] [<file.ref>...]
  refer clean [-f] <name>[.ref]...
  refer list [-R]
  refer help | version

With no file arguments, 'get' restores every .ref in this directory. Add -R
to include subdirectories.

Commands:
  get        Clone/link a reference and write <name>.ref, or replay manifests
  clean      Remove the checkouts and symlinks a manifest created (keeps .ref)
  list       Show manifests and the state of their checkouts and symlinks
  help       Show this help
  version    Show the version

Options for 'get':
  -r, --remote <remote>   Git remote: <url>[@<branch|tag|sha>][/<sub/path>]
  -l, --local [<path>]    Checkout path for a remote (default/no value: :auto),
                          or the existing directory/file to link without -r
  -g, --global            Keep the checkout in the shared cache ($REFER_REPOS_ROOT)
  -s, --symlink [<path>]  Create a symlink to the reference (repeatable;
                          no value: :auto, a free name based on the resource)
  -u, --update            Fast-forward existing checkouts (stored in the .ref)
  -n, --name <name>       Manifest name (default: repo or sub path basename)
  -R, --recursive         Replay .ref files in subdirectories too
  -f, --force             Replace existing non-symlink files at symlink paths

Options for 'clean':
  -f, --force             Also delete checkouts with uncommitted/unpushed work

Options for 'list':
  -R, --recursive         Include .ref files in subdirectories

Global options:
  -v, --verbose           Print debug output
  -V, --version           Show the version
  -h, --help              Show this help

.ref format (one 'key: value' per line; lines starting with '#' are comments):
  remote:  <url>[@<rev>][/<sub/path>]   empty or absent = local-only reference
  local:   :auto | :global | <path>     checkout path, or linked local path
  symlink: :auto | <path>               repeatable
  flags:   update                       ('global' is accepted for compatibility)

  Relative paths are resolved from the directory containing the .ref file.
  Paths may use ~ and $VAR / \${VAR}; nothing else is expanded or executed.
  Paths under $HOME are written as ~/...; quote '$VAR' to keep it literal.

Environment:
  REFER_REPOS_ROOT      Shared checkout cache
                        (default: \${XDG_DATA_HOME:-~/.local/share}/refer/repos)
  REFER_VERBOSE=1       Same as -v

Examples:
  refer get -r https://github.com/example/tools.git
  refer get -r https://github.com/anthropics/skills.git/skills/skill-creator -g \\
            -s .agents/skills/skill-creator -s .claude/skills/skill-creator
  refer get -l ~/notes -s ./notes
  refer get -R
  refer clean tools.ref

More: ${HOMEPAGE}
`;
}

function parseGet(args: string[], session: Session): GetOptions {
  const options: GetOptions = {
    remote: "",
    local: "",
    symlinks: [],
    update: false,
    recursive: false,
    name: "",
    global: false,
    positional: [],
  };

  let index = 0;
  while (index < args.length) {
    const arg = args[index]!;
    switch (arg) {
      case "-r":
      case "--remote":
        if (!hasValue(args, index)) usageError(`${arg} requires a remote URL`);
        options.remote = args[index + 1]!;
        index += 2;
        break;
      case "-l":
      case "--local":
        if (hasValue(args, index)) {
          options.local = args[index + 1]!;
          index += 2;
        } else {
          options.local = ":auto";
          index += 1;
        }
        break;
      case "-g":
      case "--global":
        options.global = true;
        index += 1;
        break;
      case "-s":
      case "--symlink":
        if (hasValue(args, index)) {
          options.symlinks.push(args[index + 1]!);
          index += 2;
        } else {
          options.symlinks.push(":auto");
          index += 1;
        }
        break;
      case "-n":
      case "--name":
        if (!hasValue(args, index)) usageError(`${arg} requires a name`);
        options.name = args[index + 1]!;
        index += 2;
        break;
      case "-u":
      case "--update":
        options.update = true;
        index += 1;
        break;
      case "-R":
      case "--recursive":
        options.recursive = true;
        index += 1;
        break;
      case "-f":
      case "--force":
        session.force = true;
        index += 1;
        break;
      case "--":
        options.positional.push(...args.slice(index + 1));
        index = args.length;
        break;
      default:
        if (arg.startsWith("-")) usageError(`unknown option '${arg}'`);
        options.positional.push(arg);
        index += 1;
    }
  }

  if (options.global) {
    if (options.local !== "" && options.local !== ":auto") {
      usageError("--global cannot be combined with an explicit local path");
    }
    options.local = ":global";
  }
  return options;
}

function cmdGet(args: string[], session: Session): number {
  const options = parseGet(args, session);
  const { remote, positional } = options;
  let { local } = options;

  const addInput =
    remote !== "" || local !== "" || options.symlinks.length > 0 || options.name !== "";
  if (options.recursive && addInput) {
    usageError("-R/--recursive only applies when replaying manifests");
  }

  // Replay mode: explicit manifests, or no add input at all.
  if (positional.length > 0 || !addInput) {
    if (addInput) {
      usageError("manifest arguments cannot be combined with -r/-l/-g/-s/-n");
    }
    if (positional.length === 0) {
      return replayAll(options.recursive, options.update, session);
    }

    let failed = false;
    for (const file of positional) {
      if (!file.endsWith(".ref")) usageError(`expected a .ref file, got '${file}'`);
      try {
        replayRef(file, options.update, session);
      } catch (error) {
        reportError(session, error);
        failed = true;
      }
    }
    return failed ? 1 : 0;
  }

  if (remote === "" && local === "") {
    usageError("'get' needs -r <remote> or -l <path>");
  }
  if (remote !== "" && local === "") local = ":auto";

  // Work out the manifest name before touching anything.
  let manifestName = options.name;
  if (manifestName === "") {
    if (remote !== "") {
      manifestName = remoteName(loadRemote(remote, session));
    } else {
      if (local === ":auto" || local === ":global") {
        usageError("without a remote, the local path must be an existing file or directory");
      }
      manifestName = basename(expandPath(local, session.env));
    }
  }
  if (
    manifestName === "" ||
    manifestName === "." ||
    manifestName === ".." ||
    manifestName.includes("/")
  ) {
    usageError(`invalid manifest name '${manifestName}'`);
  }
  if (manifestName.endsWith(".ref")) manifestName = manifestName.slice(0, -4);
  const file = `./${manifestName}.ref`;

  if (isFile(file)) {
    const existing = readRef(file, session);
    if (
      existing.remote !== remote ||
      (remote === "" && existing.local !== refPath(local, homeDir(session.env)))
    ) {
      die(`${file} already describes a different reference; pick another name with -n`);
    }
  }

  applyRef(remote, local, options.update, options.symlinks, session);
  writeRef(file, remote, local, options.update, options.symlinks, session);
  return 0;
}

function cmdClean(args: string[], session: Session): number {
  const files: string[] = [];
  let index = 0;
  while (index < args.length) {
    const arg = args[index]!;
    if (arg === "-f" || arg === "--force") {
      session.force = true;
      index += 1;
    } else if (arg === "--") {
      files.push(...args.slice(index + 1));
      break;
    } else if (arg.startsWith("-")) {
      usageError(`unknown option '${arg}'`);
    } else {
      files.push(arg);
      index += 1;
    }
  }
  if (files.length === 0) usageError("'clean' needs at least one .ref file");

  let failed = false;
  for (const arg of files) {
    const file = arg.endsWith(".ref") ? arg : `${arg}.ref`;
    try {
      cleanRef(file, session);
    } catch (error) {
      reportError(session, error);
      failed = true;
    }
  }
  return failed ? 1 : 0;
}

function cmdList(args: string[], session: Session): number {
  let recursive = false;
  for (const arg of args) {
    if (arg === "-R" || arg === "--recursive") recursive = true;
    else if (arg.startsWith("-")) usageError(`unknown option '${arg}'`);
    else usageError(`unexpected argument '${arg}'`);
  }
  return listRefs(recursive, session);
}

const HELP_COMMANDS = new Set(["get", "clean", "list"]);

function wantsHelp(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--") return false;
    if (arg === "-h" || arg === "--help") return true;
  }
  return false;
}

export function run(argv: string[], options: RunOptions = {}): number {
  const env = options.env ?? process.env;
  let verbose = env.REFER_VERBOSE === "1";

  const cleaned: string[] = [];
  for (const arg of argv) {
    if (arg === "-v" || arg === "--verbose") verbose = true;
    else cleaned.push(arg);
  }

  const reporter = options.reporter ?? createReporter(verbose);
  const session: Session = { env, reporter, force: false };

  try {
    if (cleaned.length === 0) {
      reporter.log(helpText());
      return 0;
    }

    const command = cleaned[0]!;
    const rest = cleaned.slice(1);

    if (command === "help" || command === "-h" || command === "--help") {
      reporter.log(helpText());
      return 0;
    }
    if (wantsHelp(rest) && HELP_COMMANDS.has(command)) {
      reporter.log(helpText());
      return 0;
    }
    if (command === "version" || command === "-V" || command === "--version") {
      reporter.log(`refer ${VERSION}`);
      return 0;
    }
    if (!gitAvailable(session)) {
      die("git is required but was not found in PATH");
    }

    switch (command) {
      case "get":
        return cmdGet(rest, session);
      case "clean":
        return cmdClean(rest, session);
      case "list":
        return cmdList(rest, session);
      default:
        usageError(`unknown command '${command}'`);
    }
  } catch (error) {
    if (error instanceof ReferError) {
      if (error.message !== "") reporter.error(error.message);
      if (error.exitCode === 2) reporter.hint("Run 'refer help' for usage.");
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : String(error);
    reporter.error(message);
    if (env.DEBUG !== undefined && error instanceof Error && error.stack !== undefined) {
      reporter.hint(error.stack);
    }
    return 1;
  }
}
