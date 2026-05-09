import { describe, expect, test } from "vitest";
import {
  SlugCollisionError,
  detectEndpointCollisions,
  endpointFilename,
  schemaFilename,
  slugPath,
} from "../../src/openapi/paths.js";

describe("slugPath", () => {
  test("replaces slashes and braces with underscores", () => {
    expect(slugPath("/pets/{id}")).toBe("pets_id");
  });

  test("collapses repeated underscores", () => {
    expect(slugPath("//a//b")).toBe("a_b");
  });

  test("returns 'root' for empty path", () => {
    expect(slugPath("/")).toBe("root");
    expect(slugPath("")).toBe("root");
  });
});

describe("endpointFilename", () => {
  test("uppercases method and slugs path", () => {
    expect(endpointFilename("get", "/pets/{id}")).toBe("GET_pets_id.md");
  });
});

describe("schemaFilename", () => {
  test("appends .md", () => {
    expect(schemaFilename("Pet")).toBe("Pet.md");
  });
});

describe("detectEndpointCollisions", () => {
  test("no-op when unique", () => {
    expect(() =>
      detectEndpointCollisions([["get", "/a"], ["post", "/a"]]),
    ).not.toThrow();
  });

  test("throws on collision", () => {
    expect(() =>
      detectEndpointCollisions([["get", "/a/b"], ["get", "/a_b"]]),
    ).toThrow(SlugCollisionError);
  });

  test("collision message lists offending pairs", () => {
    try {
      detectEndpointCollisions([["get", "/a/b"], ["get", "/a_b"]]);
      throw new Error("expected throw");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("/a/b");
      expect(msg).toContain("/a_b");
    }
  });
});
