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
