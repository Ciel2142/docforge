import { fetchUrl, FetchError, type FetchOptions } from "./fetch.js";

export interface LlmsFullResult {
  url: string;
  bytes: Buffer;
  contentType: string;
}

export async function probeLlmsFullTxt(
  rootUrl: string,
  opts: FetchOptions,
): Promise<LlmsFullResult | null> {
  const origin = new URL(rootUrl).origin;
  const candidate = `${origin}/llms-full.txt`;
  try {
    const res = await fetchUrl(candidate, opts);
    if (res.status !== 200) return null;
    const ct = res.contentType.toLowerCase();
    if (!ct.startsWith("text/")) return null;
    return {
      url: candidate,
      bytes: res.bytes,
      contentType: res.contentType,
    };
  } catch (e) {
    if (e instanceof FetchError) return null;
    throw e;
  }
}
