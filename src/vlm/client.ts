import got from "got";
import type { FetchedImage, VlmOptions } from "./types.js";

/** Bump when PROMPT changes — invalidates cached descriptions. */
export const PROMPT_VERSION = "v1";

const PROMPT =
  "You are describing an image from technical documentation for a search index. " +
  "Write a single factual paragraph of at most ~120 words. " +
  "Transcribe ALL visible text verbatim: labels, axes, legends, code, UI strings, table cells. " +
  "Describe diagram structure and flow. Do not speculate about anything not visible. " +
  "Output only the description, with no preamble.";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/** Call an OpenAI-compatible VLM with one image. Throws on transport or empty response. */
export async function callVlm(opts: VlmOptions, image: FetchedImage, context: string): Promise<string> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const dataUrl = `data:${image.mime};base64,${image.bytes.toString("base64")}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;

  const body = {
    model: opts.model,
    temperature: 0,
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: context ? `${PROMPT}\n\nContext:\n${context}` : PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  };

  const res = await got
    .post(url, { json: body, headers, timeout: { request: opts.timeoutMs }, retry: { limit: 0 } })
    .json<ChatResponse>();

  const text = res.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("VLM returned empty content");
  return text;
}
