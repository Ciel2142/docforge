import { load as loadHtml } from "cheerio";
import { FetchError } from "./fetch.js";
import { log } from "../log.js";
import type { Browser, BrowserContext } from "playwright";

export const JS_RENDERED_TEXT_THRESHOLD = 200;

/**
 * Cheap signal that a page is a client-rendered shell: after dropping
 * script/style/noscript/template, almost no visible body text remains.
 * False positives (legitimately tiny pages) cost one wasted render.
 * False negatives are escape-hatched by --render force.
 */
export function looksJsRendered(html: string): boolean {
  const $ = loadHtml(html);
  $("script, style, noscript, template").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text.length < JS_RENDERED_TEXT_THRESHOLD;
}

export interface RenderOptions {
  userAgent: string;
  timeoutMs: number; // navigation timeout (reuse fetchOptions.timeoutMs)
  maxBytes: number;
  auth?: { header: string; origin: string }; // same shape as FetchOptions.auth
}

export interface RenderResult {
  bytes: Buffer;
  contentType: "text/html";
}

export interface PageRenderer {
  render(url: string): Promise<RenderResult>;
}

export interface RendererHandle extends PageRenderer {
  close(): Promise<void>;
}

export const RENDER_INSTALL_HINT =
  "--render requires playwright: npm i playwright && npx playwright install chromium";

type PlaywrightModule = typeof import("playwright");

async function importPlaywright(): Promise<PlaywrightModule> {
  try {
    return await import("playwright");
  } catch (e) {
    throw new Error(RENDER_INSTALL_HINT, { cause: e });
  }
}

/** Fail-fast probe for the CLI: throws with install instructions when playwright is absent. */
export async function probeRenderAvailable(): Promise<void> {
  await importPlaywright();
}

export async function createRenderer(opts: RenderOptions): Promise<Renderer> {
  const pw = await importPlaywright();
  return new Renderer(pw, opts);
}

const NETWORKIDLE_SETTLE_MS = 5_000;

export class Renderer implements RendererHandle {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private relaunchBudget = 1; // one relaunch per consecutive-crash streak

  constructor(
    private readonly pw: PlaywrightModule,
    private readonly opts: RenderOptions,
  ) {}

  private async getContext(): Promise<BrowserContext> {
    if (this.context && this.browser?.isConnected()) return this.context;
    if (this.browser) await this.browser.close().catch(() => {});
    this.browser = await this.pw.chromium.launch({ headless: true });
    this.context = await this.browser.newContext({ userAgent: this.opts.userAgent });
    const auth = this.opts.auth;
    if (auth) {
      // Origin-scoped auth via route interception. setExtraHTTPHeaders would send
      // the credential on EVERY request from the context, including cross-origin
      // subresources — same invariant as fetch.ts (header only when origin matches).
      await this.context.route("**/*", async (route) => {
        let origin = "";
        try {
          origin = new URL(route.request().url()).origin;
        } catch {
          // data:/about: etc — pass through untouched
        }
        if (origin === auth.origin) {
          await route.continue({
            headers: { ...route.request().headers(), authorization: auth.header },
          });
        } else {
          await route.continue();
        }
      });
    }
    return this.context;
  }

  async render(url: string): Promise<RenderResult> {
    try {
      const result = await this.renderOnce(url);
      this.relaunchBudget = 1; // success resets the streak
      return result;
    } catch (e) {
      if (e instanceof FetchError) throw e; // e.g. maxBytes — not a crash
      const browserDead = this.browser !== null && !this.browser.isConnected();
      if (browserDead && this.relaunchBudget > 0) {
        this.relaunchBudget -= 1;
        this.context = null;
        log("warn", `render browser died, relaunching for ${url}`);
        try {
          const result = await this.renderOnce(url);
          this.relaunchBudget = 1;
          return result;
        } catch (e2) {
          throw toRenderFetchError(url, e2);
        }
      }
      throw toRenderFetchError(url, e);
    }
  }

  private async renderOnce(url: string): Promise<RenderResult> {
    const context = await this.getContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.opts.timeoutMs });
      // Bounded settle: polling/analytics sites never reach networkidle — best effort.
      await page
        .waitForLoadState("networkidle", { timeout: NETWORKIDLE_SETTLE_MS })
        .catch(() => {});
      const html = await page.content();
      const bytes = Buffer.from(html, "utf8");
      if (bytes.length > this.opts.maxBytes) {
        throw new FetchError(
          `render body ${bytes.length} bytes exceeds maxBytes ${this.opts.maxBytes} for ${url}`,
        );
      }
      return { bytes, contentType: "text/html" };
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    if (this.browser) await this.browser.close().catch(() => {});
    this.browser = null;
    this.context = null;
  }
}

function toRenderFetchError(url: string, e: unknown): FetchError {
  if (e instanceof FetchError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new FetchError(`render failed ${url}: ${msg}`, null, e);
}
