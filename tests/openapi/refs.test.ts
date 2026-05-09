import { describe, expect, test } from "vitest";
import { refLink, refToSchemaName } from "../../src/openapi/refs.js";

describe("refToSchemaName", () => {
  test("extracts schema name", () => {
    expect(refToSchemaName("#/components/schemas/Foo")).toBe("Foo");
  });

  test("returns null for unrelated ref", () => {
    expect(refToSchemaName("#/paths/~1pets")).toBeNull();
  });

  test("returns null for empty schema name", () => {
    expect(refToSchemaName("#/components/schemas/")).toBeNull();
  });

  test("returns null for non-string", () => {
    expect(refToSchemaName(undefined as unknown as string)).toBeNull();
  });
});

describe("refLink", () => {
  test("from endpoint links to ../schemas/<name>.md", () => {
    expect(refLink("#/components/schemas/Foo", { fromKind: "endpoint" })).toEqual([
      "Foo",
      "../schemas/Foo.md",
    ]);
  });

  test("from schema links to <name>.md", () => {
    expect(refLink("#/components/schemas/Foo", { fromKind: "schema" })).toEqual([
      "Foo",
      "Foo.md",
    ]);
  });

  test("non-schema ref returned verbatim as both label and href", () => {
    expect(refLink("#/paths/~1pets", { fromKind: "endpoint" })).toEqual([
      "#/paths/~1pets",
      "#/paths/~1pets",
    ]);
  });

  test("rejects unknown fromKind", () => {
    expect(() =>
      refLink("#/components/schemas/Foo", { fromKind: "bogus" as never }),
    ).toThrow();
  });
});
