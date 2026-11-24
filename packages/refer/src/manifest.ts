import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { die } from "./errors.js";
import type { Session } from "./io.js";
import { homeDir, refPath } from "./paths.js";

export const VERSION = "0.1.0";
export const HOMEPAGE = "https://github.com/chitootoo/agentxagent/tree/main/packages/refer";

export interface RefManifest {
  remote: string;
  local: string;
  update: boolean;
  symlinks: string[];
}

export function readRef(file: string, session: Session): RefManifest {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    die(`manifest '${file}' does not exist`);
  }

  let remote = "";
  let local = "";
  let update = false;
  let global = false;
  const symlinks: string[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const separator = line.indexOf(":");
    if (separator === -1) {
      session.reporter.warn(`${file}: ignoring malformed line '${line}'`);
      continue;
    }

    const key = line.slice(0, separator);
    const value = line.slice(separator + 1).trim();
    switch (key) {
      case "remote":
        remote = value;
        break;
      case "local":
        local = value;
        break;
      case "symlink":
        if (value !== "") symlinks.push(value);
        break;
      case "flags":
        for (const flag of value.split(/\s+/u).filter(Boolean)) {
          if (flag === "update") update = true;
          else if (flag === "global") global = true;
          else session.reporter.warn(`${file}: unknown flag '${flag}'`);
        }
        break;
      default:
        session.reporter.warn(`${file}: ignoring unknown key '${key}'`);
    }
  }

  // Legacy manifests express a shared checkout as "flags: global".
  if (global && local === "" && remote !== "") local = ":global";
  if (remote === "" && local === "") {
    die(`manifest '${file}' has neither 'remote' nor 'local'`);
  }
  return { remote, local, update, symlinks };
}

export function writeRef(
  file: string,
  remote: string,
  localToken: string,
  update: boolean,
  symlinks: string[],
  session: Session,
): void {
  let header: string[];
  if (existsSync(file)) {
    header = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("#"));
  } else {
    header = [`# Managed by refer - ${HOMEPAGE}`];
  }

  const home = homeDir(session.env);
  const lines: string[] = [];
  if (header.length > 0) lines.push(header.join("\n"), "");
  if (remote !== "") lines.push(`remote: ${remote}`);
  if (localToken !== "") lines.push(`local: ${refPath(localToken, home)}`);
  for (const symlink of symlinks) {
    if (symlink !== "") lines.push(`symlink: ${refPath(symlink, home)}`);
  }
  if (update) lines.push("flags: update");

  writeFileSync(file, `${lines.join("\n")}\n`);
  session.reporter.log(`Wrote ${file}`);
}
