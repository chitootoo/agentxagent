import {
  AxaError,
  listRegisteredProjects,
  registerProject,
  removeRegisteredProject,
  restoreProject,
  setDefaultProject,
} from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { printProjects } from "../format.js";

interface AddOptions {
  name?: string;
  init?: boolean;
}

interface RestoreOptions {
  all?: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerProjectsCommand(program: Command): void {
  const projects = program.command("projects").description("Manage registered axa projects");

  projects
    .command("list")
    .alias("ls")
    .description("List registered projects")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const list = await listRegisteredProjects();
      if (options.json) {
        console.log(JSON.stringify(list, null, 2));
        return;
      }
      printProjects(list);
    });

  projects
    .command("add")
    .description("Register an existing project, or initialize it with --init")
    .argument("<path>")
    .option("-n, --name <name>", "display name")
    .option("--init", "initialize .axa/ if the directory is not managed yet")
    .action(async (pathArg: string, options: AddOptions) => {
      const project = await registerProject({
        path: pathArg,
        ...(options.name ? { name: options.name } : {}),
        ...(options.init ? { initialize: true } : {}),
      });
      console.log(`${pc.green("✓")} Registered ${pc.bold(project.id)} at ${project.path}`);
    });

  projects
    .command("remove")
    .alias("rm")
    .description("Unregister a project (does not touch its files)")
    .argument("<id>")
    .action(async (id: string) => {
      const project = await removeRegisteredProject(id);
      console.log(`${pc.green("✓")} Removed ${pc.bold(project.name)} from the registry.`);
    });

  projects
    .command("restore")
    .description("Clone a missing project checkout from its project.ref")
    .argument("[id]")
    .option("--all", "restore every missing registered project")
    .action(async (id: string | undefined, options: RestoreOptions) => {
      if (id === undefined && !options.all) {
        throw new AxaError(
          "INVALID_PROJECT",
          "Pass a project id, or --all to restore every project.",
        );
      }
      if (id !== undefined && options.all) {
        throw new AxaError("INVALID_PROJECT", "Pass either a project id or --all, not both.");
      }

      const targets =
        id !== undefined
          ? [id]
          : (await listRegisteredProjects())
              .filter((project) => !project.exists)
              .map((project) => project.id);
      if (targets.length === 0) {
        console.log(`${pc.green("✓")} All registered projects are present.`);
        return;
      }

      let failed = 0;
      for (const target of targets) {
        try {
          const project = await restoreProject(target);
          console.log(`${pc.green("✓")} Restored ${pc.bold(project.id)} -> ${project.path}`);
        } catch (error) {
          failed += 1;
          console.error(`${pc.red("✗")} ${target}: ${errorMessage(error)}`);
        }
      }
      if (failed > 0) process.exitCode = 1;
    });

  projects
    .command("use")
    .description("Set the default project used outside a project directory")
    .argument("<id>")
    .action(async (id: string) => {
      const project = await setDefaultProject(id);
      console.log(`${pc.green("✓")} Default project: ${pc.bold(project.id)}`);
    });
}
