import { isAxaError } from "@contagxt/axa-core";
import { Command } from "commander";
import pc from "picocolors";
import { registerApproveCommand } from "./commands/approve.js";
import { registerClaimCommand } from "./commands/claim.js";
import { registerCreateCommand } from "./commands/create.js";
import { registerDoneCommand } from "./commands/done.js";
import { registerInitCommand } from "./commands/init.js";
import { registerListCommand } from "./commands/list.js";
import { registerProjectsCommand } from "./commands/projects.js";
import { registerReclaimCommand } from "./commands/reclaim.js";
import { registerReleaseCommand } from "./commands/release.js";
import { registerShowCommand } from "./commands/show.js";

const program = new Command();

program
  .name("axa")
  .description("Local-first task management for humans and AI agents")
  .version("0.1.0")
  .showHelpAfterError();

registerInitCommand(program);
registerProjectsCommand(program);
registerCreateCommand(program);
registerListCommand(program);
registerShowCommand(program);
registerClaimCommand(program);
registerReleaseCommand(program);
registerDoneCommand(program);
registerApproveCommand(program);
registerReclaimCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = isAxaError(error)
    ? error.message
    : error instanceof Error
      ? error.message
      : String(error);
  console.error(`${pc.red("axa:")} ${message}`);
  if (process.env.DEBUG) {
    console.error(error);
  }
  process.exitCode = 1;
});
