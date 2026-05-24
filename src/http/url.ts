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

// A same-origin link is a "page" (will have a converted .md) if its path is a
// directory (ends with "/"), an HTML file, or extensionless (e.g. /guide/intro).
// Asset links (.png, .pdf, .css, ...) are NOT converted, so leave them absolute.
function isLikelyPageUrl(pathname: string): boolean {
  if (pathname.endsWith("/")) return true;
  if (/\.html?$/i.test(pathname)) return true;
  const last = pathname.split("/").pop() ?? "";
  return !last.includes(".");
}

// Markdown inline link [text](url) — NOT an image (negative lookbehind on `!`).
const ABS_LINK_RE = /(?<!!)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const ABS_AUTOLINK_RE = /<(https?:\/\/[^>\s]+)>/g;

/**
 * Rewrite SAME-ORIGIN page links in `md` from absolute URLs to paths relative
 * to `pageUrl`'s converted output (.md), preserving the `#fragment`. External
 * links, same-origin non-page assets, and images are left untouched. Mirrors
 * delocalizeLinks but for real-origin (URL-crawl) sources.
 */
export function relativizeSameOriginLinks(md: string, pageUrl: string): string {
  const pageRel = urlToOutputPath(pageUrl, ""); // bare posix relpath, e.g. "guide/intro.md"
  const fromDir = posix.dirname(pageRel);
  const toRel = (absUrl: string): string | null => {
    if (!sameOrigin(absUrl, pageUrl)) return null;
    // sameOrigin already parsed absUrl via normalizeUrl, so this cannot throw.
    const u = new URL(absUrl);
    if (!isLikelyPageUrl(u.pathname)) return null;
    const targetRel = urlToOutputPath(absUrl, "");
    const rel = posix.relative(fromDir, targetRel) || posix.basename(targetRel);
    return rel + u.hash;
  };
  return md
    .replace(ABS_LINK_RE, (m, text: string, url: string) => {
      const r = toRel(url);
      return r === null ? m : `[${text}](${r})`;
    })
    .replace(ABS_AUTOLINK_RE, (m, url: string) => {
      const r = toRel(url);
      return r === null ? m : `<${r}>`;
    });
}
