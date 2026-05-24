import { describe, expect, test } from "vitest";
import { buildObsidianOutput } from "../src/obsidian.js";

describe("buildObsidianOutput", () => {
  test("emits frontmatter (title, source) then body", () => {
    expect(
      buildObsidianOutput("My Title", "dir/page.html", "# My Title\n\nBody."),
    ).toBe(
      '---\ntitle: "My Title"\nsource: "dir/page.html"\n---\n\n# My Title\n\nBody.\n',
    );
  });

  test("escapes double quotes and backslashes in title", () => {
    expect(
      buildObsidianOutput('He said "hi" \\o/', "p.html", "Body."),
    ).toBe(
      '---\ntitle: "He said \\"hi\\" \\\\o/"\nsource: "p.html"\n---\n\nBody.\n',
    );
  });

  test("trims surrounding whitespace in body", () => {
    expect(buildObsidianOutput("T", "p.html", "  Body.  \n\n  ")).toBe(
      '---\ntitle: "T"\nsource: "p.html"\n---\n\nBody.\n',
    );
  });
});
