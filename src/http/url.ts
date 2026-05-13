import { posix } from "node:path";

const DEFAULT_PORTS: Record<string, string> = {
  "http:": "80",
  "https:": "443",
};

const PATH_SEGMENT_SAFE = /^[A-Za-z0-9\-._~!$&'()*+,;=:@]$/;

function canonicalizePercentEncoding(s: string): string {
  return s.replace(/%([0-9A-Fa-f]{2})/g, (match, hex: string) => {
    const ch = String.fromCharCode(parseInt(hex, 16));
    return PATH_SEGMENT_SAFE.test(ch) ? ch : `%${hex.toUpperCase()}`;
  });
}

export function normalizeUrl(input: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(input, base) : new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  u.search = "";
  if (u.port && DEFAULT_PORTS[u.protocol] === u.port) u.port = "";
  u.hostname = u.hostname.toLowerCase();
  u.pathname = canonicalizePercentEncoding(u.pathname);
  return u.toString();
}

export function sameOrigin(a: string, b: string): boolean {
  const na = normalizeUrl(a);
  const nb = normalizeUrl(b);
  if (!na || !nb) return false;
  const ua = new URL(na);
  const ub = new URL(nb);
  return ua.protocol === ub.protocol && ua.host === ub.host;
}

export function urlToOutputPath(url: string, outputDir: string): string {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    throw new Error(`cannot map non-http url to output path: ${url}`);
  }
  const u = new URL(normalized);
  let path = decodeURIComponent(u.pathname);
  if (path.endsWith("/") || path === "") {
    path = `${path}index.md`;
  } else if (/\.html?$/i.test(path)) {
    path = path.replace(/\.html?$/i, ".md");
  } else {
    path = `${path}.md`;
  }
  const sanitized = path.split("/").map(sanitizeSegment).join("/");
  return posix.join(outputDir, sanitized.replace(/^\/+/, ""));
}

function sanitizeSegment(seg: string): string {
  return seg.replace(/[<>:"|?*\0]/g, "_");
}
