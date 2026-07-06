// npm "version" lifecycle hook: keep src/index.ts VERSION in lockstep with
// package.json (npm bumps only the latter; tests/version.test.ts asserts the
// match but the publish path never runs tests — docf-2l4).
import { readFileSync, writeFileSync } from "node:fs";

const version = process.env.npm_package_version;
if (!version) {
  console.error("sync-version: npm_package_version not set (run via npm version)");
  process.exit(1);
}
const file = new URL("../src/index.ts", import.meta.url);
const src = readFileSync(file, "utf8");
const next = src.replace(/VERSION = "[^"]+"/, `VERSION = "${version}"`);
if (next === src && !src.includes(`VERSION = "${version}"`)) {
  console.error("sync-version: VERSION assignment not found in src/index.ts");
  process.exit(1);
}
writeFileSync(file, next);
console.log(`sync-version: src/index.ts VERSION = ${version}`);
