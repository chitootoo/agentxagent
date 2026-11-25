import { initProject, registerProject, toAbsolutePath } from "@contagxt/axa-core";
import type { Command } from "commander";
import pc from "picocolors";

interface InitOptions {
  register?: boolean;
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize .axa/ in a project and register it")
    .argument("[path]", "project directory", ".")
    .option("--no-register", "create .axa/ without adding to the project registry")
    .action(async (pathArg: string, options: InitOptions) => {
      const projectRoot = toAbsolutePath(pathArg);
      const info = await initProject({ projectRoot });
      console.log(`${pc.green("✓")} Initialized ${pc.bold(info.axaPath)}`);

      if (options.register !== false) {
        const project = await registerProject({ path: projectRoot });
        console.log(
          `${pc.green("✓")} Registered as ${pc.bold(project.id)} (${pc.dim(project.path)})`,
        );
      }
    });
}
