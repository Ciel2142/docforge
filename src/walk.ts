import { lstatSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { log } from "./log.js";

const SKIP_DIRS = new Set([
  "_static", "_downloads", ".git", ".venv", "node_modules",
  ".tox", "__pycache__", "dist", "build",
]);
const SKIP_FILES = new Set(["genindex.html", "search.html", "robots.txt", "rss.xml"]);
const SKIP_EXT = new Set([
  ".css", ".js", ".xml", ".xsd", ".txt",
  ".eot", ".ttf", ".woff", ".woff2",
  ".png", ".jpg", ".jpeg", ".ico",
]);
const HTML_EXT = new Set([".html", ".htm"]);

export interface WalkResult {
  paths: string[];
  skippedCount: number;
}

export function iterHtmlFiles(source: string, maxBytes: number): WalkResult {
  const result: WalkResult = { paths: [], skippedCount: 0 };

  let st;
  try {
    st = lstatSync(source);
  } catch {
    return result;
  }
  if (st.isSymbolicLink()) return result;

  if (st.isFile()) {
    if (passesFileFilters(source, maxBytes, result)) result.paths.push(source);
    return result;
  }
  if (st.isDirectory()) {
    walkDir(source, maxBytes, result);
  }
  return result;
}

function walkDir(dir: string, maxBytes: number, result: WalkResult): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walkDir(full, maxBytes, result);
    } else if (entry.isFile()) {
      if (passesFileFilters(full, maxBytes, result)) result.paths.push(full);
    }
  }
}

function passesFileFilters(
  path: string,
  maxBytes: number,
  result: WalkResult,
): boolean {
  const name = path.split(/[\\/]/).at(-1)!;
  if (SKIP_FILES.has(name)) {
    result.skippedCount += 1;
    return false;
  }
  const suffix = extname(name).toLowerCase();
  if (SKIP_EXT.has(suffix)) {
    result.skippedCount += 1;
    return false;
  }
  if (!HTML_EXT.has(suffix)) {
    result.skippedCount += 1;
    return false;
  }
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    result.skippedCount += 1;
    return false;
  }
  if (size > maxBytes) {
    log("warn", `large-file skipped: ${path} (${size} bytes > ${maxBytes})`);
    result.skippedCount += 1;
    return false;
  }
  return true;
}
