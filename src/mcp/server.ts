import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig, type McpConfig } from "./config.js";
import { toErrorEnvelope } from "./errors.js";
import { LockManager } from "./locks.js";
import { removeStaleTmpDirs } from "./atomic.js";
import { convertTool } from "./tools/convert.js";
import { convertOpenapiTool } from "./tools/convert_openapi.js";
import { listCorporaTool } from "./tools/list_corpora.js";
import { VERSION } from "../index.js";

export interface ServerContext {
  config: McpConfig;
  locks: LockManager;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (
    args: Record<string, unknown>,
    ctx: ServerContext,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
  }>;
}

export async function startServer(): Promise<void> {
  const config = loadConfig();
  removeStaleTmpDirs(config.qmdRoot, 3600 * 1000);

  const ctx: ServerContext = { config, locks: new LockManager() };
  const tools: Record<string, ToolDefinition> = {
    [convertTool.name]: convertTool,
    [convertOpenapiTool.name]: convertOpenapiTool,
    [listCorporaTool.name]: listCorporaTool,
  };

  const server = new Server(
    { name: "docforge", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(tools).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools[req.params.name];
    if (!tool) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              isError: true,
              code: "WRITE_FAILED",
              message: `unknown tool: ${req.params.name}`,
            }),
          },
        ],
        isError: true,
      };
    }
    try {
      const result = await tool.handler(req.params.arguments ?? {}, ctx);
      return result;
    } catch (e) {
      const env = toErrorEnvelope(e);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(env) }],
        isError: true,
        structuredContent: env,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
