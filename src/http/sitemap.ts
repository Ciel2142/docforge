import Sitemapper from "sitemapper";
import type { Robots } from "./robots.js";
import type { FetchOptions } from "./fetch.js";

export async function discoverSitemaps(
  rootUrl: string,
  robots: Robots,
  opts: FetchOptions,
): Promise<string[]> {
  const origin = new URL(rootUrl).origin;
  const probes = [
    ...robots.getSitemaps(),
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ];

  const collected = new Set<string>();
  for (const probe of probes) {
    const urls = await fetchSitemap(probe, opts);
    for (const u of urls) collected.add(u);
    if (collected.size > 0) break;
  }
  return [...collected];
}

async function fetchSitemap(url: string, opts: FetchOptions): Promise<string[]> {
  try {
    const requestHeaders: Record<string, string> = { "user-agent": opts.userAgent };
    // Sitemapper is a separate HTTP client and never goes through fetchUrl, so
    // the auth header has to be attached here too — origin-gated, mirroring the
    // gate in fetchUrl (docf-sbf).
    if (opts.auth && new URL(url).origin === opts.auth.origin) {
      requestHeaders.authorization = opts.auth.header;
    }
    const sm = new Sitemapper({ url, timeout: opts.timeoutMs, requestHeaders });
    const { sites } = await sm.fetch();
    return sites ?? [];
  } catch {
    return [];
  }
}
