import { isAxaError } from "@contagxt/axa-core";
import { Command } from "commander";
import pc from "picocolors";

const CLI_VERSION = "0.1.0";

export function createProgram(name: string, description: string): Command {
  return new Command()
    .name(name)
    .description(description)
    .version(CLI_VERSION)
    .showHelpAfterError();
}

export function runProgram(program: Command, label: string): void {
  program.parseAsync(process.argv).catch((error: unknown) => {
    const message = isAxaError(error)
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
    console.error(`${pc.red(`${label}:`)} ${message}`);
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exitCode = 1;
  });
}
