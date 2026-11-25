import { registerTaskCommands } from "./commands/task/index.js";
import { createProgram, runProgram } from "./program.js";

const program = createProgram(
  "axa-task",
  "Worker task protocol: list, show, board, create, claim, summary, release, done",
);

registerTaskCommands(program);

runProgram(program, "axa-task");
