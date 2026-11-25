import { registerInitCommand } from "./commands/project/init.js";
import { registerProjectsGroup } from "./commands/project/projects.js";
import { registerTaskCommands } from "./commands/task/index.js";
import { createProgram, runProgram } from "./program.js";

const program = createProgram("axa", "Local-first task management for humans and AI agents");

registerTaskCommands(program);
registerInitCommand(program);
registerProjectsGroup(program);

runProgram(program, "axa");
