export type AxaErrorCode =
  | "NOT_FOUND"
  | "INVALID_PROJECT"
  | "INVALID_TASK"
  | "INVALID_STATE"
  | "ALREADY_CLAIMED"
  | "CONFLICT"
  | "LOCK_TIMEOUT"
  | "CONFIG_ERROR";

export class AxaError extends Error {
  readonly code: AxaErrorCode;

  constructor(code: AxaErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AxaError";
    this.code = code;
  }
}

export function isAxaError(error: unknown): error is AxaError {
  return error instanceof AxaError;
}
