import { fetchUrl, FetchError, type FetchOptions } from "./fetch.js";
import { normalizeUrl } from "./url.js";

export interface LlmsIndexEntry {
  url: string;
  title?: string;
  section?: string;
  description?: string;
}

export interface LlmsIndex {
  title?: string;
  tagline?: string;
  links: LlmsIndexEntry[];
}

export interface LlmsIndexProbeResult {
  url: string;
  bytes: Buffer;
  contentType: string;
  parsed: LlmsIndex;
}

export async function probeLlmsTxt(
  rootUrl: string,
  opts: FetchOptions,
): Promise<LlmsIndexProbeResult | null> {
  const origin = new URL(rootUrl).origin;
  const candidate = `${origin}/llms.txt`;
  try {
    const res = await fetchUrl(candidate, opts);
    if (res.status !== 200) return null;
    const ct = res.contentType.toLowerCase();
    if (!ct.startsWith("text/")) return null;
    const text = res.bytes.toString("utf8");
    const parsed = parseLlmsTxt(text, candidate);
    if (parsed.links.length === 0) return null;
    return {
      url: candidate,
      bytes: res.bytes,
      contentType: res.contentType,
      parsed,
    };
  } catch (e) {
    if (e instanceof FetchError) return null;
    throw e;
  }
}

const LINK_RE = /^[-*]\s+\[([^\]]+)\]\(([^)]+)\)(?:\s*:\s*(.*))?$/;
const TITLE_RE = /^#\s+(.+)$/;
const TAGLINE_RE = /^>\s+(.+)$/;
const SECTION_RE = /^##\s+(.+)$/;

export function parseLlmsTxt(text: string, baseUrl: string): LlmsIndex {
  const index: LlmsIndex = { links: [] };
  let section: string | undefined;
  let inFence = false;
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (index.title === undefined) {
      const m = TITLE_RE.exec(line);
      if (m && m[1]) {
        index.title = m[1].trim();
        continue;
      }
    }

    if (index.tagline === undefined) {
      const m = TAGLINE_RE.exec(line);
      if (m && m[1]) {
        index.tagline = m[1].trim();
        continue;
      }
    }

    const sect = SECTION_RE.exec(line);
    if (sect && sect[1]) {
      section = sect[1].trim();
      continue;
    }

    const link = LINK_RE.exec(line.trimStart());
    if (link && link[1] && link[2]) {
      const normalized = normalizeUrl(link[2], baseUrl);
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const entry: LlmsIndexEntry = { url: normalized, title: link[1].trim() };
      if (section !== undefined) entry.section = section;
      if (link[3] !== undefined) entry.description = link[3].trim();
      index.links.push(entry);
    }
  }

  return index;
}
