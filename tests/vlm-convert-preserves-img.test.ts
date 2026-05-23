import { describe, expect, test } from "vitest";
import { convertHtml } from "../src/convert.js";

describe("convertHtml preserves image references (VLM pass precondition)", () => {
  test("an <img> survives as a Markdown image ref with alt + src", async () => {
    const html =
      `<html><head><title>T</title></head><body><div role="main">` +
      `<div itemprop="articleBody"><h1>Arch</h1>` +
      `<p>The deployment topology below shows the system layout in fine detail here.</p>` +
      `<figure><img src="diagrams/arch.png" alt="Architecture overview"></figure>` +
      `<p>More explanatory body text after the figure to clear the word threshold.</p>` +
      `</div></div></body></html>`;
    const r = await convertHtml(html);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(/!\[Architecture overview\]\([^)]*arch\.png[^)]*\)/.test(r.body_md)).toBe(true);
    }
  });
});
