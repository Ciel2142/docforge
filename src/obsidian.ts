function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
