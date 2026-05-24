import { posix } from "node:path";

const MD_LINK_RE = /\]\((?!https?:\/\/|\/\/|mailto:|#)([^)\s]+?)\.html(#[^)\s]*)?\)/g;
const AUTOLINK_RE = /<(?!https?:\/\/|\/\/|mailto:)([^>\s]+?)\.html(#[^>\s]*)?>/g;

export function rewriteInternalLinks(md: string): string {
  return md
    .replace(MD_LINK_RE, (_match, p1: string, p2?: string) => `](${p1}.md${p2 ?? ""})`)
    .replace(AUTOLINK_RE, (_match, p1: string, p2?: string) => `<${p1}.md${p2 ?? ""}>`);
}

// llms-full.txt sources embed heading anchors as literal trailing text,
// e.g. "LM Studio 0.4.1 [#lm-studio-041]" — pure embedding noise.
const HEADING_ANCHOR_RE = /[ \t]*\[#[a-z0-9-]+\][ \t]*$/gm;

export function stripHeadingAnchors(md: string): string {
  return md.replace(HEADING_ANCHOR_RE, "");
}

// Synthetic base URL handed to Defuddle for LOCAL (non-URL) sources, so it
// resolves relative internal links against a stable, structure-preserving
// origin instead of an empty base (which yields `about:blank/...`).
// `.invalid` is reserved (RFC 2606) and can never be a real link target.
export const LOCAL_BASE = "http://docforge.invalid/";

// These share the `[^)\s]` link-body limitation with rewriteInternalLinks above:
// a URL path containing a literal `)` (e.g. `.../foo_(bar)/x.html`) is not handled.
// Defuddle/Kreuzberg rarely emit such paths for doc corpora; if support is needed,
// fix all link regexes in this file together (tracked separately, not here).
const SENTINEL_LINK_RE = /\]\((http:\/\/docforge\.invalid\/[^)\s]*)\)/g;
const SENTINEL_AUTOLINK_RE = /<(http:\/\/docforge\.invalid\/[^>\s]*)>/g;

/**
 * Convert sentinel-absolute internal links (produced when LOCAL_BASE was the
 * Defuddle base) back into paths relative to `fromRelpath` (the document's
 * POSIX path relative to the corpus/output root). Fragments are preserved.
 * Real http(s) links (URL sources, external links) are left untouched.
 */
export function delocalizeLinks(md: string, fromRelpath: string): string {
  const fromDir = posix.dirname(fromRelpath);
  const toRel = (abs: string): string => {
    const u = new URL(abs);
    const targetPath = decodeURI(u.pathname).replace(/^\//, "");
    if (!targetPath) return u.hash || "."; // bare site-root target (e.g. a "home" link)
    let rel = posix.relative(fromDir, targetPath);
    if (rel === "") rel = posix.basename(targetPath);
    return rel + u.search + u.hash;
  };
  return md
    .replace(SENTINEL_LINK_RE, (_m, abs: string) => `](${toRel(abs)})`)
    .replace(SENTINEL_AUTOLINK_RE, (_m, abs: string) => `<${toRel(abs)}>`);
}
