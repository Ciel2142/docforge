import type { ToolDefinition } from "../server.js";
import { McpError } from "../errors.js";

export const convertOpenapiTool: ToolDefinition = {
  name: "convert_openapi",
  description: "Convert an OpenAPI spec (URL or inline) to per-operation Markdown.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "URL or raw spec text" },
      is_inline: { type: "boolean", default: false },
      format: { type: "string", enum: ["auto", "json", "yaml"], default: "auto" },
      corpus: { type: "string" },
      force_refresh: { type: "boolean", default: false },
      preview_bytes: { type: "integer" },
    },
    required: ["source"],
    additionalProperties: false,
  },
  handler: async (_args, _ctx) => {
    throw new McpError("WRITE_FAILED", "convert_openapi handler not yet implemented");
  },
};
