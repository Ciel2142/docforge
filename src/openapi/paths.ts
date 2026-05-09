const NON_SLUG_CHARS = /[/{}]+/g;
const MULTI_UNDERSCORE = /_+/g;

export class SlugCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlugCollisionError";
  }
}

export function slugPath(path: string): string {
  let s = path.replace(NON_SLUG_CHARS, "_");
  s = s.replace(MULTI_UNDERSCORE, "_");
  s = s.replace(/^_+|_+$/g, "");
  return s || "root";
}

export function endpointFilename(method: string, path: string): string {
  return `${method.toUpperCase()}_${slugPath(path)}.md`;
}

export function schemaFilename(name: string): string {
  return `${name}.md`;
}

export function detectEndpointCollisions(
  pairs: Array<[string, string]>,
): void {
  const inverse = new Map<string, Array<[string, string]>>();
  for (const [method, path] of pairs) {
    const fname = endpointFilename(method, path);
    const arr = inverse.get(fname) ?? [];
    arr.push([method, path]);
    inverse.set(fname, arr);
  }
  const dupes: Array<[string, Array<[string, string]>]> = [];
  for (const [k, sources] of inverse) {
    if (sources.length > 1) dupes.push([k, sources]);
  }
  if (dupes.length === 0) return;
  const lines = ["endpoint filename collisions:"];
  for (const [fname, sources] of dupes) {
    lines.push(`  -> ${fname}`);
    for (const [m, p] of sources) lines.push(`      from ${m.toUpperCase()} ${p}`);
  }
  throw new SlugCollisionError(lines.join("\n"));
}
