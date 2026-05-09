import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function buildOutput(
  title: string,
  sourceRelpath: string,
  bodyMd: string,
): string {
  return `# ${title}\n\nSource: ${sourceRelpath}\n\n${bodyMd.trim()}\n`;
}

export function writeOutput(outPath: string, content: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content, "utf8");
}
