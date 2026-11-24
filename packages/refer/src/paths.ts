import { lstatSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";

export function lexists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function homeDir(env: NodeJS.ProcessEnv): string {
  return env.HOME ?? "";
}

// Expand a leading ~ and $VAR / ${VAR} references. Nothing else is evaluated,
// so a .ref file can never execute code.
export function expandPath(input: string, env: NodeJS.ProcessEnv): string {
  let rest = input;
  const home = homeDir(env);
  if (rest === "~") rest = home;
  else if (rest.startsWith("~/")) rest = `${home}/${rest.slice(2)}`;

  const pattern = /^([^$]*)\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))(.*)$/;
  let output = "";
  for (;;) {
    const match = pattern.exec(rest);
    if (!match) break;
    const name = match[2] ?? match[3] ?? "";
    output += match[1] ?? "";
    rest = match[4] ?? "";
    const value = env[name];
    if (value === undefined) {
      throw new Error(`environment variable $${name} is not set (in path '${input}')`);
    }
    output += value;
  }
  return output + rest;
}

// Write a path the way it should appear in a .ref file.
export function refPath(path: string, home: string): string {
  if (path === home) return "~";
  if (home !== "" && path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}

// Absolute, physical path. The path itself may be missing; its parent may not.
export function absPath(path: string): string {
  if (isDirectory(path) && !isSymlink(path)) return realpathSync(path);
  const parent = dirname(path);
  const base = basename(path);
  const realParent = realpathSync(parent);
  return realParent === "/" ? `/${base}` : `${realParent}/${base}`;
}

// Like realpath(3): absolute path with every symlink resolved.
export function realPath(path: string): string {
  let current = path;
  let hops = 0;
  while (isSymlink(current)) {
    hops += 1;
    if (hops > 40) throw new Error(`too many levels of symbolic links: ${path}`);
    const target = readlinkSync(current);
    current = isAbsolute(target) ? target : `${dirname(current)}/${target}`;
  }
  return absPath(current);
}

// Canonical spelling of a relative path for comparisons: "./a/" -> "a".
export function normPath(path: string): string {
  let result = path;
  while (result.startsWith("./")) result = result.slice(2);
  while (result.length > 1 && result.endsWith("/")) result = result.slice(0, -1);
  return result === "" ? "." : result;
}

export function hasDotDot(path: string): boolean {
  return `/${path}/`.includes("/../");
}
