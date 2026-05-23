export type ErrorCode =
  | "INVALID_URL"
  | "INVALID_CORPUS_NAME"
  | "INVALID_ARGS"
  | "ROBOTS_BLOCKED"
  | "SOURCE_MISMATCH"
  | "LLMS_FULL_MISSING"
  | "LLMS_INDEX_MISSING"
  | "OPENAPI_PARSE"
  | "FETCH_FAILED"
  | "WRITE_FAILED"
  | "NOT_WRITABLE_QMD_ROOT"
  | "BUSY"
  | "CANCELLED";

export class McpError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.code = code;
    if (hint !== undefined) this.hint = hint;
  }
}

export interface ErrorEnvelope {
  isError: true;
  code: ErrorCode;
  message: string;
  hint?: string;
}

export function toErrorEnvelope(err: unknown): ErrorEnvelope {
  if (err instanceof McpError) {
    const env: ErrorEnvelope = { isError: true, code: err.code, message: err.message };
    if (err.hint !== undefined) env.hint = err.hint;
    return env;
  }
  if (err instanceof Error) {
    return { isError: true, code: "WRITE_FAILED", message: err.message };
  }
  return { isError: true, code: "WRITE_FAILED", message: String(err) };
}
