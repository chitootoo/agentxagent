import { Code, ConnectError } from "@connectrpc/connect";
import { type AxaError, isAxaError } from "@contagxt/axa-core";

const CODE_MAP: Record<AxaError["code"], Code> = {
  NOT_FOUND: Code.NotFound,
  INVALID_PROJECT: Code.FailedPrecondition,
  INVALID_TASK: Code.InvalidArgument,
  INVALID_STATE: Code.FailedPrecondition,
  ALREADY_CLAIMED: Code.AlreadyExists,
  CONFLICT: Code.Aborted,
  LOCK_TIMEOUT: Code.Aborted,
  CONFIG_ERROR: Code.Internal,
};

export function toConnectError(error: unknown): ConnectError {
  if (error instanceof ConnectError) {
    return error;
  }
  if (isAxaError(error)) {
    return new ConnectError(error.message, CODE_MAP[error.code]);
  }
  console.error("[axa] Unexpected RPC error:", error);
  return new ConnectError("Unexpected server error.", Code.Internal);
}
