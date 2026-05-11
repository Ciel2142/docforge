import { writeFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
import { extractBytesSync } from "@kreuzberg/node";
import Sitemapper from "sitemapper";
import got from "got";

const ROOT = "https://docs.kreuzberg.dev";
const SITEMAP = `${ROOT}/sitemap.xml`;
const TARGET = 10;

interface SpikeResult {
  url: string;
  status: "ok" | "empty" | "failed";
  wordCount?: number;
  hasH1?: boolean;
  mdLen?: number;
  error?: string;
}

async function main(): Promise<void> {
  const sitemap = new Sitemapper({ url: SITEMAP, timeout: 30_000 });
  const { sites } = await sitemap.fetch();
  const urls = sites.slice(0, TARGET);
  console.log(`fetched ${sites.length} sitemap urls, sampling first ${urls.length}`);

  const results: SpikeResult[] = [];
  for (const url of urls) {
    try {
      const html = await got(url, { timeout: { request: 30_000 } }).text();
      const { document } = parseHTML(html);
      const defuddled = await Defuddle(document as unknown as Document, url, {
        markdown: false,
        removePartialSelectors: true,
      });
      if (!defuddled?.content || defuddled.wordCount < 5) {
        results.push({ url, status: "empty", wordCount: defuddled?.wordCount ?? 0 });
        continue;
      }
      const md = extractBytesSync(
        Buffer.from(defuddled.content, "utf8"),
        "text/html",
        { useCache: false, outputFormat: "markdown" },
      );
      const hasH1 = /^# .+/m.test(md.content);
      results.push({
        url,
        status: "ok",
        wordCount: defuddled.wordCount,
        hasH1,
        mdLen: md.content.length,
      });
    } catch (e) {
      results.push({ url, status: "failed", error: (e as Error).message });
    }
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const okWithH1 = results.filter((r) => r.status === "ok" && r.hasH1).length;
  console.log(`\nSPIKE RESULT: ${ok}/${urls.length} converted (${okWithH1} with H1)`);
  for (const r of results) {
    const flag = r.status === "ok" ? (r.hasH1 ? "OK" : "OK-no-H1") : r.status.toUpperCase();
    console.log(`  [${flag.padEnd(8)}] ${r.url} ${r.wordCount ?? "-"}w`);
  }

  writeFileSync(
    "/tmp/defuddle-spike-report.json",
    JSON.stringify({ results, summary: { ok, okWithH1, total: urls.length } }, null, 2),
  );
  console.log(`\nreport: /tmp/defuddle-spike-report.json`);

  const PASS = ok >= 8;
  process.exit(PASS ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
