const MD_LINK_RE = /\]\((?!https?:\/\/|\/\/|mailto:|#)([^)\s]+?)\.html(#[^)\s]*)?\)/g;
const AUTOLINK_RE = /<(?!https?:\/\/|\/\/|mailto:)([^>\s]+?)\.html(#[^>\s]*)?>/g;

export function rewriteInternalLinks(md: string): string {
  return md
    .replace(MD_LINK_RE, (_match, p1: string, p2?: string) => `](${p1}.md${p2 ?? ""})`)
    .replace(AUTOLINK_RE, (_match, p1: string, p2?: string) => `<${p1}.md${p2 ?? ""}>`);
}
