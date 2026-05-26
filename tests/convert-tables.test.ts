import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { convertHtml } from "../src/convert.js";

describe("convertHtml — table fidelity", () => {
  test("keeps simple tables as GFM and complex tables as faithful HTML", async () => {
    const html = `<!doctype html><html><body><main>
<h1>Doc</h1>
<p>Intro paragraph with enough words to keep this as real article content here.</p>
<table><thead><tr><th>Name</th><th>Role</th></tr></thead>
<tbody><tr><td>Ada</td><td>Engineer</td></tr></tbody></table>
<p>Middle paragraph separating the two tables with several words of filler.</p>
<table>
<tr><td rowspan="2">Ada</td><td>Owns:<ul><li>core</li><li>API</li></ul></td></tr>
<tr><td>Author</td></tr>
</table>
<p>Trailing paragraph also with several words to keep the body large enough.</p>
</main></body></html>`;
    const r = await convertHtml(html);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const md = r.body_md;
    // simple table -> GFM
    expect(md).toContain("| Name | Role |");
    expect(md).toContain("| --- | --- |");
    // complex table -> embedded HTML, rowspan + list preserved
    expect(md).toContain("<table");
    expect(md).toContain('rowspan="2"');
    expect(md).toContain("<li>core</li>");
    // the corruption we are fixing must NOT occur
    expect(md).not.toContain("coreAPI");
    // no placeholder leaks into output
    expect(md).not.toMatch(/DOCFORGETABLE/);
  });

  test("recognises real Confluence markup and preserves status text", async () => {
    const html = readFileSync("tests/fixtures/confluence-table.html", "utf8");
    const r = await convertHtml(html);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const md = r.body_md;
    expect(md).toContain("<table");
    expect(md).toContain('colspan="2"');
    expect(md).toContain('rowspan="2"');
    expect(md).toContain("DONE");
    expect(md).toContain("IN PROGRESS");
    expect(md).not.toContain("confluenceTable"); // class attr stripped
    expect(md).not.toContain("aui-lozenge");      // status <span> unwrapped to text
    expect(md).not.toMatch(/DOCFORGETABLE/);
  });
});
