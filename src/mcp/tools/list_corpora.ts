import type { ToolDefinition } from "../server.js";
import { McpError } from "../errors.js";

export const listCorporaTool: ToolDefinition = {
  name: "list_corpora",
  description: "Enumerate docforge-produced corpora under $DOCFORGE_QMD_ROOT.",
  inputSchema: {
    type: "object",
    properties: {
      filter: { type: "string", description: "substring match on collection name" },
    },
    additionalProperties: false,
  },
  handler: async (_args, _ctx) => {
    throw new McpError("WRITE_FAILED", "list_corpora handler not yet implemented");
  },
};
