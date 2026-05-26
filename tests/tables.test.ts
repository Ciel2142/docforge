import { describe, expect, test } from "vitest";
import { restoreTables, swapComplexTables } from "../src/tables.js";

describe("restoreTables", () => {
  test("replaces each token with its HTML block and tidies blank lines", () => {
    const md = "before\n\nDOCFORGETABLEab12N0END\n\nafter";
    const out = restoreTables(md, [
      { token: "DOCFORGETABLEab12N0END", html: "<table><tr><td>x</td></tr></table>" },
    ]);
    expect(out).toContain("<table><tr><td>x</td></tr></table>");
    expect(out).not.toContain("DOCFORGETABLEab12N0END");
    expect(out).not.toMatch(/\n{3,}/);
  });

  test("is a no-op when there are no placeholders", () => {
    expect(restoreTables("hello\n\n\nworld", [])).toBe("hello\n\n\nworld");
  });
});

describe("swapComplexTables — simple tables", () => {
  test("leaves a simple table untouched", () => {
    const html =
      `<p>intro</p><table><thead><tr><th>Name</th><th>Role</th></tr></thead>` +
      `<tbody><tr><td>Ada</td><td>Eng</td></tr></tbody></table>`;
    const { html: out, placeholders } = swapComplexTables(html);
    expect(placeholders).toHaveLength(0);
    expect(out).toContain("<table");
    expect(out).toContain("Ada");
  });
});

describe("swapComplexTables — classification", () => {
  test("swaps a table with colspan >= 2", () => {
    const html = `<table><tr><td colspan="2">Span</td></tr><tr><td>a</td><td>b</td></tr></table>`;
    const { html: out, placeholders } = swapComplexTables(html);
    expect(placeholders).toHaveLength(1);
    expect(out).toContain(placeholders[0]!.token);
    expect(out).not.toContain("<table");
  });

  test("swaps a table with rowspan >= 2", () => {
    const html = `<table><tr><td rowspan="2">A</td><td>b</td></tr><tr><td>c</td></tr></table>`;
    const { placeholders } = swapComplexTables(html);
    expect(placeholders).toHaveLength(1);
  });

  test("swaps a table with block content (list) in a cell", () => {
    const html = `<table><tr><td><ul><li>core</li><li>API</li></ul></td><td>x</td></tr></table>`;
    const { placeholders } = swapComplexTables(html);
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]!.html).toContain("<ul>");
  });

  test("does NOT swap a table whose cells hold only inline content", () => {
    const html =
      `<table><tr><td><strong>b</strong> <code>x()</code><br>line <a href="/y">y</a></td></tr></table>`;
    const { placeholders } = swapComplexTables(html);
    expect(placeholders).toHaveLength(0);
  });
});

describe("swapComplexTables — sanitization", () => {
  test("strips class/style/onclick/data-* but keeps colspan", () => {
    const html =
      `<table><tr><td colspan="2" class="c" style="color:red" data-x="1" onclick="e()">h</td></tr>` +
      `<tr><td>a</td><td>b</td></tr></table>`;
    const { placeholders } = swapComplexTables(html);
    const out = placeholders[0]!.html;
    expect(out).toContain('colspan="2"');
    expect(out).not.toContain("class");
    expect(out).not.toContain("style");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("data-x");
  });

  test("removes <script> and unwraps disallowed elements to their text", () => {
    const html =
      `<table><tr><td colspan="2"><span class="status">Done</span><script>evil()</script></td></tr>` +
      `<tr><td>a</td><td>b</td></tr></table>`;
    const out = swapComplexTables(html).placeholders[0]!.html;
    expect(out).toContain("Done");
    expect(out).not.toContain("<span");
    expect(out).not.toContain("evil");
    expect(out).not.toContain("<script");
  });

  test("keeps inline formatting and literal pipes inside cells", () => {
    const html =
      `<table><tr><td colspan="2"><strong>b</strong> a | b <code>x()</code></td></tr>` +
      `<tr><td>a</td><td>b</td></tr></table>`;
    const out = swapComplexTables(html).placeholders[0]!.html;
    expect(out).toContain("<strong>b</strong>");
    expect(out).toContain("<code>x()</code>");
    expect(out).toContain("|");
  });
});

describe("swapComplexTables — nested tables", () => {
  test("emits a single placeholder; the inner table rides inside the outer block", () => {
    const html =
      `<table><tr><td><table><tr><td colspan="2">inner</td></tr></table></td></tr></table>`;
    const { html: out, placeholders } = swapComplexTables(html);
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]!.html).toContain("inner");
    expect((placeholders[0]!.html.match(/<table/g) ?? []).length).toBe(2);
    expect(out).not.toContain("<table");
  });
});
