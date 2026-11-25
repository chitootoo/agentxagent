import { registerInitCommand } from "./commands/project/init.js";
import { registerProjectActions } from "./commands/project/projects.js";
import { createProgram, runProgram } from "./program.js";

const program = createProgram("axa-project", "Initialize, register, and recover axa projects");

registerInitCommand(program);
registerProjectActions(program);

runProgram(program, "axa-project");
