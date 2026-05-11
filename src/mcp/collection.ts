import { basename } from "node:path";

export const COLLECTION_NAME_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

export class CollectionNameError extends Error {
  readonly code = "INVALID_CORPUS_NAME";
  constructor(value: string, reason: string) {
    super(`INVALID_CORPUS_NAME: "${value}" — ${reason}`);
  }
}

export class InvalidUrlError extends Error {
  readonly code = "INVALID_URL";
  constructor(value: string, reason: string) {
    super(`INVALID_URL: "${value}" — ${reason}`);
  }
}

export function validateCollectionName(name: string): string {
  if (!name) throw new CollectionNameError(name, "empty");
  if (name.length > 128) throw new CollectionNameError(name, "exceeds 128 chars");
  if (!COLLECTION_NAME_RE.test(name)) {
    throw new CollectionNameError(name, "must match /^[a-z0-9][a-z0-9-]{0,127}$/");
  }
  return name;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 128);
}

export interface OpenApiInfo {
  title: string;
  version?: string;
}

export interface DeriveInput {
  url: string;
  openApi?: OpenApiInfo;
  override?: string;
}

export function deriveCollectionName(input: DeriveInput): string {
  if (input.override !== undefined) {
    return validateCollectionName(input.override);
  }

  if (input.openApi?.title) {
    const base = slugify(input.openApi.title);
    // Only treat as parseable if version looks like semver (vN, N, N.M, N.M.P).
    // Reject date-like versions (e.g. "2025-01-01") by requiring the major is
    // not followed by a dash (which would indicate a date segment).
    const majorMatch = input.openApi.version?.match(/^v?(\d+)(?:\.|$)/);
    if (majorMatch) {
      const candidate = `${base}-v${majorMatch[1]}`;
      if (COLLECTION_NAME_RE.test(candidate)) return candidate;
    }
    // Version not parseable as semver: use title slug + URL first path segment
    // if it looks like a version marker (e.g. "v1"), otherwise just the title slug.
    let parsed2: URL;
    try {
      parsed2 = new URL(input.url);
    } catch {
      throw new InvalidUrlError(input.url, "not a parseable URL");
    }
    const firstSeg = parsed2.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
    if (/^v\d+$/.test(firstSeg)) {
      const candidate = `${base}-${firstSeg}`;
      if (COLLECTION_NAME_RE.test(candidate)) return candidate;
    }
    if (COLLECTION_NAME_RE.test(base)) return base;
  }

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new InvalidUrlError(input.url, "not a parseable URL");
  }

  if (parsed.protocol === "file:") {
    const path = decodeURIComponent(parsed.pathname).replace(/\/+$/, "");
    const name = slugify(basename(path));
    return validateCollectionName(name);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidUrlError(input.url, `unsupported scheme: ${parsed.protocol}`);
  }

  const host = parsed.hostname;
  const firstSegment = parsed.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  const raw = firstSegment ? `${host}-${firstSegment}` : host;
  const name = slugify(raw);
  return validateCollectionName(name);
}
