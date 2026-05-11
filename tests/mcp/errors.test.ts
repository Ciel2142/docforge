import { describe, expect, test } from "vitest";
import { McpError, toErrorEnvelope, type ErrorCode } from "../../src/mcp/errors.js";

describe("McpError", () => {
  test("stores code, message, hint", () => {
    const e = new McpError("SOURCE_MISMATCH", "stored source differs", "pass force_refresh=true");
    expect(e.code).toBe("SOURCE_MISMATCH");
    expect(e.message).toBe("stored source differs");
    expect(e.hint).toBe("pass force_refresh=true");
  });

  test("hint optional", () => {
    const e = new McpError("INVALID_URL", "bad url");
    expect(e.hint).toBeUndefined();
  });
});

describe("toErrorEnvelope", () => {
  test("wraps McpError verbatim", () => {
    const e = new McpError("BUSY", "in progress", "retry shortly");
    expect(toErrorEnvelope(e)).toEqual({
      isError: true,
      code: "BUSY",
      message: "in progress",
      hint: "retry shortly",
    });
  });

  test("wraps generic Error as WRITE_FAILED", () => {
    const env = toErrorEnvelope(new Error("disk full"));
    expect(env.isError).toBe(true);
    expect(env.code).toBe("WRITE_FAILED");
    expect(env.message).toContain("disk full");
  });

  test("all declared codes are accepted by McpError", () => {
    const codes: ErrorCode[] = [
      "INVALID_URL", "INVALID_CORPUS_NAME", "ROBOTS_BLOCKED", "SOURCE_MISMATCH",
      "LLMS_FULL_MISSING", "OPENAPI_PARSE", "FETCH_FAILED", "WRITE_FAILED",
      "NOT_WRITABLE_QMD_ROOT", "BUSY", "CANCELLED",
    ];
    for (const c of codes) {
      expect(() => new McpError(c, "msg")).not.toThrow();
    }
  });
});
