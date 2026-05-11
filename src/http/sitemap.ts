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
  const sm = new Sitemapper({
    url,
    timeout: opts.timeoutMs,
    requestHeaders: { "user-agent": opts.userAgent },
  });
  try {
    const { sites } = await sm.fetch();
    return sites ?? [];
  } catch {
    return [];
  }
}
