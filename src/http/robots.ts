import { RobotsTxtFile } from "@crawlee/utils";
import { fetchUrl, FetchError, type FetchOptions } from "./fetch.js";

export interface Robots {
  isAllowed(url: string, userAgent: string): boolean;
  getCrawlDelay(userAgent: string): number;
  getSitemaps(): string[];
}

interface RobotsParserLike {
  getCrawlDelay(userAgent?: string): number | undefined;
}

interface RobotsTxtFileInternal {
  robots: RobotsParserLike;
}

const cache = new Map<string, Robots>();

export function __clearRobotsCache(): void {
  cache.clear();
}

const ALLOW_ALL: Robots = {
  isAllowed: () => true,
  getCrawlDelay: () => 0,
  getSitemaps: () => [],
};

export async function getRobots(origin: string, opts: FetchOptions): Promise<Robots> {
  const key = origin.replace(/\/+$/, "");
  const cached = cache.get(key);
  if (cached) return cached;

  const url = `${key}/robots.txt`;
  let body: string;
  try {
    const result = await fetchUrl(url, opts);
    body = result.bytes.toString("utf8");
  } catch (e) {
    if (e instanceof FetchError) {
      cache.set(key, ALLOW_ALL);
      return ALLOW_ALL;
    }
    throw e;
  }

  const parsed = RobotsTxtFile.from(url, body);
  // RobotsTxtFile wraps `robots-parser` but does not expose getCrawlDelay.
  // The underlying parser is stored on the (TS-private but runtime-enumerable)
  // `robots` field; cast to access it.
  const inner = (parsed as unknown as RobotsTxtFileInternal).robots;

  const robots: Robots = {
    isAllowed: (u, ua) => parsed.isAllowed(u, ua),
    getCrawlDelay: (ua) => inner.getCrawlDelay(ua) ?? 0,
    getSitemaps: () => parsed.getSitemaps(),
  };
  cache.set(key, robots);
  return robots;
}
