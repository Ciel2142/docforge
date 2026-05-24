import { posix } from "node:path";

function yamlQuote(s: string): string {
  return `"${s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

/** Render an Obsidian-vault note: YAML frontmatter (title, source) + body. */
export function buildObsidianOutput(
  title: string,
  source: string,
  bodyMd: string,
): string {
  const body = bodyMd.trim();
  return `---\ntitle: ${yamlQuote(title)}\nsource: ${yamlQuote(source)}\n---\n\n${body}\n`;
}

// Internal markdown link [text](target.{html,md}#anchor?) — NOT an image (negative lookbehind on `!`),
// NOT external/mailto/bare-anchor.
const MD_LINK_RE =
  /(?<!!)\[([^\]]*)\]\((?!https?:\/\/|\/\/|mailto:|#)([^)\s]+?)\.(?:html?|md)(?:#[^)\s]*)?\)/g;
// Autolink <target.{html,md}#anchor?> for internal targets only.
const AUTOLINK_RE =
  /<(?!https?:\/\/|\/\/|mailto:)([^>\s]+?)\.(?:html?|md)(?:#[^>\s]*)?>/g;

/**
 * Rewrite internal markdown links and autolinks into Obsidian wikilinks.
 * `fromRelpath` is the document's POSIX path relative to the vault (output) root,
 * used to resolve relative targets to vault-relative paths. Slug anchors are dropped.
 */
export function toObsidianWikilinks(md: string, fromRelpath: string): string {
  const fromDir = posix.dirname(fromRelpath);
  const resolveVault = (raw: string): string | null => {
    // Root-absolute targets (/foo) can't be mapped to a vault path without
    // assuming vault root == site root; leave them untouched, like external links.
    if (raw.startsWith("/")) return null;
    const vault = posix.join(fromDir, raw);
    // Targets above the vault root cannot be represented as a wikilink path.
    if (vault === ".." || vault.startsWith("../")) return null;
    return vault;
  };
  return md
    .replace(MD_LINK_RE, (match, text: string, rawPath: string) => {
      const vault = resolveVault(rawPath);
      if (vault === null) return match;
      const base = vault.split("/").pop() ?? vault;
      // No alias when the text adds nothing: equal to the basename, or to the
      // full vault path (Obsidian renders [[x|x]] identically to [[x]]).
      const alias = text && text !== base && text !== vault ? `|${text}` : "";
      return `[[${vault}${alias}]]`;
    })
    .replace(AUTOLINK_RE, (match, rawPath: string) => {
      const vault = resolveVault(rawPath);
      if (vault === null) return match;
      return `[[${vault}]]`;
    });
}
