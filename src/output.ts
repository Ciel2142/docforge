import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, join } from "node:path";

export function buildOutput(
  title: string,
  sourceRelpath: string,
  bodyMd: string,
): string {
  const trimmed = bodyMd.trim();
  const newlineIdx = trimmed.indexOf("\n");
  const firstLine = newlineIdx >= 0 ? trimmed.slice(0, newlineIdx) : trimmed;
  if (firstLine.startsWith("# ")) {
    const rest = newlineIdx >= 0
      ? trimmed.slice(newlineIdx + 1).replace(/^\n+/, "")
      : "";
    const tail = rest ? `\n\n${rest}` : "";
    return `${firstLine}\n\nSource: ${sourceRelpath}${tail}\n`;
  }
  return `# ${title}\n\nSource: ${sourceRelpath}\n\n${trimmed}\n`;
}

export function writeOutput(outPath: string, content: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content, "utf8");
}

export class CollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollisionError";
  }
}

export function detectCollisions(
  inputs: string[],
  sourceRoot: string,
  outputRoot: string,
  opts?: { caseInsensitive?: boolean },
): Map<string, string> {
  const caseInsensitive = opts?.caseInsensitive ?? false;
  const mapping = new Map<string, string>();
  const inverse = new Map<string, string[]>();

  for (const inPath of inputs) {
    const rel = relative(sourceRoot, inPath);
    const outRel = rel.replace(/\.html?$/i, ".md");
    const outPath = join(outputRoot, outRel);
    mapping.set(inPath, outPath);
    const key = caseInsensitive ? outPath.toLowerCase() : outPath;
    const arr = inverse.get(key) ?? [];
    arr.push(inPath);
    inverse.set(key, arr);
  }

  const collisions: [string, string[]][] = [];
  for (const [k, sources] of inverse) {
    if (sources.length > 1) collisions.push([k, sources]);
  }

  if (collisions.length > 0) {
    const lines = ["output path collisions detected:"];
    for (const [k, sources] of collisions) {
      lines.push(`  -> ${k}`);
      for (const s of sources) lines.push(`      from ${s}`);
    }
    throw new CollisionError(lines.join("\n"));
  }

  return mapping;
}

export type ReportStatus = "ok" | "empty" | "failed" | "skipped";

export interface ReportEntry {
  input: string;
  output: string | null;
  status: ReportStatus;
  error?: string;
}

export interface Report {
  entries: ReportEntry[];
}

export function writeReportJson(path: string, entries: ReportEntry[]): void {
  const report: Report = { entries };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
}
