const SCHEMA_PREFIX = "#/components/schemas/";
const FROM_KINDS = new Set(["endpoint", "schema"]);

export type FromKind = "endpoint" | "schema";

export function refToSchemaName(ref: unknown): string | null {
  if (typeof ref !== "string" || !ref.startsWith(SCHEMA_PREFIX)) return null;
  const name = ref.slice(SCHEMA_PREFIX.length);
  return name || null;
}

export function refLink(
  ref: string,
  opts: { fromKind: FromKind },
): [string, string] {
  if (!FROM_KINDS.has(opts.fromKind)) {
    throw new Error(`fromKind must be 'endpoint' or 'schema', got '${opts.fromKind}'`);
  }
  const name = refToSchemaName(ref);
  if (name === null) return [ref, ref];
  if (opts.fromKind === "endpoint") return [name, `../schemas/${name}.md`];
  return [name, `${name}.md`];
}
