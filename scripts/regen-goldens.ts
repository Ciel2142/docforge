import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { convertHtml } from "../src/convert.js";

const cases = [
  "sphinx-method",
  "sphinx-proto",
  "sphinx-proto-blockquote",
  "sphinx-guide",
  "sphinx-internal-link",
  "sphinx-highlight-default",
];

for (const name of cases) {
  const raw = readFileSync(join("tests/fixtures", `${name}.html`), "utf8");
  const r = convertHtml(raw);
  if (r.status !== "ok") {
    throw new Error(`${name}: status=${r.status}`);
  }
  const out = join("tests/expected", `${name}.md`);
  writeFileSync(out, r.body_md.trim() + "\n", "utf8");
  console.log(`wrote ${out} (${r.body_md.length} chars)`);
}
