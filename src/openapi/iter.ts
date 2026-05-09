const HTTP_METHODS = new Set([
  "get", "post", "put", "delete", "patch", "head", "options", "trace",
]);

export interface Endpoint {
  method: string;
  path: string;
  operation: Record<string, unknown>;
  tags: string[];
  summary: string;
  description: string;
}

export interface Schema {
  name: string;
  body: Record<string, unknown>;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

export function* iterEndpoints(
  spec: Record<string, unknown>,
): Generator<Endpoint> {
  const paths = isPlainObject(spec.paths) ? spec.paths : {};
  for (const [path, item] of Object.entries(paths)) {
    if (!isPlainObject(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      const lower = method.toLowerCase();
      if (!HTTP_METHODS.has(lower)) continue;
      if (!isPlainObject(op)) continue;
      const tagsRaw = op.tags;
      const tags = Array.isArray(tagsRaw)
        ? tagsRaw.map((t) => String(t))
        : [];
      yield {
        method: lower,
        path,
        operation: op,
        tags,
        summary: typeof op.summary === "string" ? op.summary : "",
        description: typeof op.description === "string" ? op.description : "",
      };
    }
  }
}

export function* iterSchemas(
  spec: Record<string, unknown>,
): Generator<Schema> {
  const components = isPlainObject(spec.components) ? spec.components : {};
  const schemas = isPlainObject(components.schemas) ? components.schemas : {};
  for (const [name, body] of Object.entries(schemas)) {
    if (!isPlainObject(body)) continue;
    yield { name, body };
  }
}
