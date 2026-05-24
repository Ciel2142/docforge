import { describe, expect, test } from "vitest";
import { convertTool } from "../src/mcp/tools/convert.js";

describe("MCP convert tool format arg", () => {
  test("inputSchema exposes format enum default|obsidian", () => {
    const props = (convertTool.inputSchema as {
      properties: Record<string, { enum?: string[]; default?: string }>;
    }).properties;
    expect(props.format).toBeDefined();
    expect(props.format.enum).toEqual(["default", "obsidian"]);
    expect(props.format.default).toBe("default");
  });
});
