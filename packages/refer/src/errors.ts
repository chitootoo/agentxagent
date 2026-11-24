export class ReferError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = "ReferError";
  }
}

export function die(message: string): never {
  throw new ReferError(message, 1);
}

export function usageError(message: string): never {
  throw new ReferError(message, 2);
}
