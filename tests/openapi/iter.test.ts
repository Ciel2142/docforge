import { describe, expect, test } from "vitest";
import { iterEndpoints, iterSchemas } from "../../src/openapi/iter.js";

describe("iterEndpoints", () => {
  test("yields one entry per http method", () => {
    const spec = {
      paths: {
        "/foo": {
          get: { summary: "g" },
          post: { summary: "p" },
          parameters: [], // not a method, must be skipped
        },
      },
    };
    const eps = Array.from(iterEndpoints(spec));
    expect(eps.map((e) => e.method).sort()).toEqual(["get", "post"]);
  });

  test("lowercases method", () => {
    const spec = { paths: { "/x": { GET: {} } } };
    expect(Array.from(iterEndpoints(spec))[0]!.method).toBe("get");
  });

  test("populates tags + summary + description", () => {
    const spec = {
      paths: {
        "/x": {
          get: {
            tags: ["t1", "t2"],
            summary: "S",
            description: "D",
          },
        },
      },
    };
    const ep = Array.from(iterEndpoints(spec))[0]!;
    expect(ep.tags).toEqual(["t1", "t2"]);
    expect(ep.summary).toBe("S");
    expect(ep.description).toBe("D");
  });

  test("skips when path-item is not an object", () => {
    const spec = { paths: { "/x": "nope" } };
    expect(Array.from(iterEndpoints(spec))).toEqual([]);
  });
});

describe("iterSchemas", () => {
  test("yields entries from components.schemas", () => {
    const spec = {
      components: { schemas: { A: { type: "object" }, B: { type: "string" } } },
    };
    const names = Array.from(iterSchemas(spec)).map((s) => s.name);
    expect(names.sort()).toEqual(["A", "B"]);
  });

  test("yields nothing when components missing", () => {
    expect(Array.from(iterSchemas({}))).toEqual([]);
  });

  test("skips non-object schema bodies", () => {
    const spec = { components: { schemas: { A: "bad", B: { type: "string" } } } };
    expect(Array.from(iterSchemas(spec)).map((s) => s.name)).toEqual(["B"]);
  });
});
