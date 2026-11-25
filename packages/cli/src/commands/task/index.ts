import type { Command } from "commander";
import { registerBoardCommand } from "./board.js";
import { registerClaimCommand } from "./claim.js";
import { registerCreateCommand } from "./create.js";
import { registerDoneCommand } from "./done.js";
import { registerListCommand } from "./list.js";
import { registerReleaseCommand } from "./release.js";
import { registerShowCommand } from "./show.js";
import { registerSummaryCommand } from "./summary.js";

export function registerTaskCommands(program: Command): void {
  registerCreateCommand(program);
  registerListCommand(program);
  registerBoardCommand(program);
  registerShowCommand(program);
  registerClaimCommand(program);
  registerSummaryCommand(program);
  registerReleaseCommand(program);
  registerDoneCommand(program);
}
