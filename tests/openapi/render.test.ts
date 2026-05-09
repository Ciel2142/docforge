import { describe, expect, test } from "vitest";
import { renderEndpoint, renderSchema } from "../../src/openapi/render.js";
import type { Endpoint, Schema } from "../../src/openapi/iter.js";

describe("renderEndpoint", () => {
  test("renders header with method, path, source pointer", () => {
    const ep: Endpoint = {
      method: "get",
      path: "/pets/{id}",
      operation: {},
      tags: [],
      summary: "",
      description: "",
    };
    const md = renderEndpoint(ep, { specFilename: "pet.json" });
    expect(md.startsWith("# GET /pets/{id}\n")).toBe(true);
    expect(md.includes("Source: pet.json#/paths/~1pets~1{id}/get\n")).toBe(true);
  });

  test("renders tags + description", () => {
    const ep: Endpoint = {
      method: "get",
      path: "/x",
      operation: {},
      tags: ["t1", "t2"],
      summary: "S",
      description: "D",
    };
    const md = renderEndpoint(ep, { specFilename: "s.json" });
    expect(md).toContain("**Tags:** t1, t2");
    expect(md).toContain("D");
  });

  test("renders parameters table", () => {
    const ep: Endpoint = {
      method: "get",
      path: "/x",
      operation: {
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer" },
            required: true,
            description: "max items",
          },
        ],
      },
      tags: [],
      summary: "",
      description: "",
    };
    const md = renderEndpoint(ep, { specFilename: "s.json" });
    expect(md).toContain("## Parameters");
    expect(md).toContain("| limit | query | integer | yes | max items |");
  });

  test("renders request body and responses with $ref summary", () => {
    const ep: Endpoint = {
      method: "post",
      path: "/x",
      operation: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/NewPet" },
            },
          },
        },
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Pet" },
              },
            },
          },
        },
      },
      tags: [],
      summary: "",
      description: "",
    };
    const md = renderEndpoint(ep, { specFilename: "s.json" });
    expect(md).toContain("## Request Body");
    expect(md).toContain("[NewPet](../schemas/NewPet.md)");
    expect(md).toContain("## Responses");
    expect(md).toContain("### 200 OK");
    expect(md).toContain("[Pet](../schemas/Pet.md)");
  });
});

describe("renderSchema", () => {
  test("renders properties table for object", () => {
    const sc: Schema = {
      name: "Pet",
      body: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "integer", description: "primary key" },
          name: { type: "string" },
        },
      },
    };
    const md = renderSchema(sc, { specFilename: "s.json" });
    expect(md.startsWith("# Pet\n")).toBe(true);
    expect(md).toContain("Source: s.json#/components/schemas/Pet");
    expect(md).toContain("| id | integer | yes | primary key |");
    expect(md).toContain("| name | string | no |");
  });

  test("renders json definition fallback for non-object", () => {
    const sc: Schema = {
      name: "Color",
      body: { type: "string", enum: ["red", "blue"] },
    };
    const md = renderSchema(sc, { specFilename: "s.json" });
    expect(md).toContain("## Definition");
    expect(md).toContain('"enum"');
  });
});
