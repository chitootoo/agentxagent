import {
  listRegisteredProjects,
  registerProject,
  removeRegisteredProject,
  setDefaultProject,
} from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";
import { printProjects } from "../format.js";

interface AddOptions {
  name?: string;
  init?: boolean;
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
    .command("use")
    .description("Set the default project used outside a project directory")
    .argument("<id>")
    .action(async (id: string) => {
      const project = await setDefaultProject(id);
      console.log(`${pc.green("✓")} Default project: ${pc.bold(project.id)}`);
    });
}
