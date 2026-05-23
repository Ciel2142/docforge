export interface VlmOptions {
  /** OpenAI-compatible base URL, including the `/v1` segment. */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Skip images whose longest side is below this many pixels. */
  minDim: number;
  /** Maximum number of images described per document. */
  maxImages: number;
  /** Parallel VLM calls. */
  concurrency: number;
  /** Per-call timeout in milliseconds. */
  timeoutMs: number;
}

export interface ImageRef {
  /** The full matched Markdown image, e.g. `![alt](src "title")`. */
  match: string;
  alt: string;
  /** First token inside the parentheses (title stripped). */
  src: string;
  /** Start offset of `match` within the source Markdown. */
  index: number;
}

export interface DescribeStats {
  described: number;
  skipped: number;
  failed: number;
  cached: number;
}

export interface FetchedImage {
  bytes: Buffer;
  /** MIME type without parameters, e.g. `image/png`. */
  mime: string;
}

export interface VlmCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export interface DescribeDeps {
  /** Fetch image bytes for an absolute URL or `data:` URI. Throws on failure. */
  fetchImage: (url: string) => Promise<FetchedImage>;
  /** Call the VLM. Returns a one-paragraph description. Throws on failure. */
  describe: (image: FetchedImage, context: string) => Promise<string>;
  /** Read pixel dimensions from image bytes. Returns `{}` if undetectable. */
  sizeOf: (bytes: Buffer) => { width?: number; height?: number };
  /** Optional persistent cache keyed by content hash. */
  cache?: VlmCache;
  /** Bumped when the prompt changes, to invalidate stale cache entries. */
  promptVersion: string;
}
