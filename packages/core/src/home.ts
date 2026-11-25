import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandHomePath } from "./paths.js";

/** Every "@contagxt" package keeps its data under one hidden home directory. */
const CONTAGXT_DIR = ".contagxt";
const AXA_DIR_NAME = "axa";

export function getAxaHome(): string {
  return process.env.AXA_HOME
    ? resolve(expandHomePath(process.env.AXA_HOME))
    : join(homedir(), CONTAGXT_DIR, AXA_DIR_NAME);
}

export function getConfigPath(): string {
  return join(getAxaHome(), "config.json");
}

export function getProjectsRoot(): string {
  return join(getAxaHome(), "projects");
}
