export interface Reporter {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  hint(message: string): void;
  debug(message: string): void;
}

export interface Session {
  env: NodeJS.ProcessEnv;
  reporter: Reporter;
  force: boolean;
}

export function createReporter(
  verbose: boolean,
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr,
): Reporter {
  return {
    log: (message) => stdout.write(`${message}\n`),
    warn: (message) => stderr.write(`refer: warning: ${message}\n`),
    error: (message) => stderr.write(`refer: error: ${message}\n`),
    hint: (message) => stderr.write(`${message}\n`),
    debug: (message) => {
      if (verbose) stderr.write(`[debug] ${message}\n`);
    },
  };
}
