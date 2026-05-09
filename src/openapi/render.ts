import type { Endpoint, Schema } from "./iter.js";
import { refLink, type FromKind } from "./refs.js";

export function jsonpointerEncode(s: string): string {
  return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function typeStr(schema: Record<string, unknown>): string {
  const t = schema.type;
  const fmt = schema.format;
  if (typeof t === "string" && typeof fmt === "string") return `${t} (${fmt})`;
  if (typeof t === "string") return t;
  return "any";
}

function schemaSummary(
  schema: Record<string, unknown>,
  opts: { fromKind: FromKind },
): string {
  if (typeof schema.$ref === "string") {
    const [label, href] = refLink(schema.$ref, opts);
    return `[${label}](${href})`;
  }
  if (schema.type === "array") {
    const items = isPlainObject(schema.items) ? schema.items : {};
    return `array of ${schemaSummary(items, opts)}`;
  }
  return `\`${typeStr(schema)}\``;
}

function renderParameters(params: unknown[]): string[] {
  if (params.length === 0) return [];
  const lines = [
    "## Parameters",
    "",
    "| Name | In | Type | Required | Description |",
    "|------|----|----|----------|-------------|",
  ];
  for (const p of params) {
    if (!isPlainObject(p)) continue;
    const name = typeof p.name === "string" ? p.name : "";
    const loc = typeof p.in === "string" ? p.in : "";
    const schema = isPlainObject(p.schema) ? p.schema : {};
    const tStr = typeStr(schema);
    const required = p.required ? "yes" : "no";
    const descRaw = typeof p.description === "string" ? p.description : "";
    const desc = descRaw.replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${name} | ${loc} | ${tStr} | ${required} | ${desc} |`);
  }
  lines.push("");
  return lines;
}

function renderRequestBody(body: unknown): string[] {
  if (!isPlainObject(body)) return [];
  const lines = ["## Request Body", ""];
  const requiredMarker = body.required ? " (required)" : "";
  if (typeof body.description === "string" && body.description.trim()) {
    lines.push(body.description.trim());
    lines.push("");
  }
  const content = isPlainObject(body.content) ? body.content : {};
  for (const [ctype, media] of Object.entries(content)) {
    if (!isPlainObject(media)) continue;
    const schema = isPlainObject(media.schema) ? media.schema : {};
    const summary = schemaSummary(schema, { fromKind: "endpoint" });
    lines.push(`\`${ctype}\`: ${summary}${requiredMarker}`);
  }
  lines.push("");
  return lines;
}

function renderResponses(responses: Record<string, unknown>): string[] {
  if (Object.keys(responses).length === 0) return [];
  const lines = ["## Responses", ""];
  for (const [code, resp] of Object.entries(responses)) {
    if (!isPlainObject(resp)) continue;
    const desc = typeof resp.description === "string" ? resp.description.trim() : "";
    lines.push(`### ${code} ${desc}`.trimEnd());
    lines.push("");
    const content = isPlainObject(resp.content) ? resp.content : {};
    for (const [ctype, media] of Object.entries(content)) {
      if (!isPlainObject(media)) continue;
      const schema = isPlainObject(media.schema) ? media.schema : {};
      const summary = schemaSummary(schema, { fromKind: "endpoint" });
      lines.push(`\`${ctype}\`: ${summary}`);
    }
    lines.push("");
  }
  return lines;
}

export function renderEndpoint(
  ep: Endpoint,
  opts: { specFilename: string },
): string {
  const pointer = `#/paths/${jsonpointerEncode(ep.path)}/${ep.method}`;
  const out: string[] = [
    `# ${ep.method.toUpperCase()} ${ep.path}`,
    "",
    `Source: ${opts.specFilename}${pointer}`,
    "",
  ];
  if (ep.tags.length > 0) {
    out.push(`**Tags:** ${ep.tags.join(", ")}`);
    out.push("");
  }
  if (ep.description.trim()) {
    out.push(ep.description.trim());
    out.push("");
  } else if (ep.summary.trim()) {
    out.push(ep.summary.trim());
    out.push("");
  }

  const params = Array.isArray(ep.operation.parameters) ? ep.operation.parameters : [];
  out.push(...renderParameters(params));
  out.push(...renderRequestBody(ep.operation.requestBody));
  const responses = isPlainObject(ep.operation.responses) ? ep.operation.responses : {};
  out.push(...renderResponses(responses));

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

function propertyType(schema: Record<string, unknown>): string {
  if (typeof schema.$ref === "string") {
    const [label, href] = refLink(schema.$ref, { fromKind: "schema" });
    return `[${label}](${href})`;
  }
  if (schema.type === "array") {
    const items = isPlainObject(schema.items) ? schema.items : {};
    return `array of ${propertyType(items)}`;
  }
  return typeStr(schema);
}

export function renderSchema(
  sc: Schema,
  opts: { specFilename: string },
): string {
  const body = sc.body;
  const out: string[] = [
    `# ${sc.name}`,
    "",
    `Source: ${opts.specFilename}#/components/schemas/${sc.name}`,
    "",
  ];
  const desc = typeof body.description === "string" ? body.description.trim() : "";
  if (desc) {
    out.push(desc);
    out.push("");
  }

  const properties =
    body.type === "object" && isPlainObject(body.properties)
      ? body.properties
      : null;

  if (properties) {
    const required = new Set(
      Array.isArray(body.required) ? body.required.map(String) : [],
    );
    out.push(
      "## Properties",
      "",
      "| Name | Type | Required | Description |",
      "|------|------|----------|-------------|",
    );
    for (const [propName, prop] of Object.entries(properties)) {
      const p = isPlainObject(prop) ? prop : {};
      const tStr = propertyType(p);
      const req = required.has(propName) ? "yes" : "no";
      const pdescRaw = typeof p.description === "string" ? p.description : "";
      const pdesc = pdescRaw.replace(/\|/g, "\\|").replace(/\n/g, " ");
      out.push(`| ${propName} | ${tStr} | ${req} | ${pdesc} |`);
    }
    out.push("");
  } else {
    out.push("## Definition");
    out.push("");
    out.push("```json");
    out.push(JSON.stringify(body, null, 2));
    out.push("```");
    out.push("");
  }

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}
