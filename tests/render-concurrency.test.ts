import { describe, expect, test } from "vitest";
import { Renderer } from "../src/http/render.js";

// Renderer's constructor takes the playwright module as its first argument —
// inject a fake so this test never touches real chromium.
type FakePwModule = ConstructorParameters<typeof Renderer>[0];

function makeFakePw(): { pw: FakePwModule; launchCalls: () => number } {
  let launchCalls = 0;

  const fakePage = {
    goto: async () => {},
    waitForLoadState: async () => {},
    content: async () => "<html><body>ok</body></html>",
    close: async () => {},
  };

  const fakeContext = {
    route: async () => {},
    newPage: async () => fakePage,
  };

  const fakeBrowser = {
    isConnected: () => true,
    close: async () => {},
    newContext: async () => fakeContext,
  };

  const pw = {
    chromium: {
      launch: async () => {
        launchCalls += 1;
        return fakeBrowser;
      },
    },
  } as unknown as FakePwModule;

  return { pw, launchCalls: () => launchCalls };
}

describe("Renderer.getContext concurrency", () => {
  test("concurrent render() calls during the init window share one browser launch", async () => {
    const { pw, launchCalls } = makeFakePw();
    const renderer = new Renderer(pw, { userAgent: "t", timeoutMs: 1000, maxBytes: 1_000_000 });

    // Fire both without awaiting the first: both must race into getContext()
    // while it's still uninitialized (context null, no live browser).
    const [a, b] = await Promise.all([
      renderer.render("http://example.test/a"),
      renderer.render("http://example.test/b"),
    ]);

    expect(a.bytes.toString("utf8")).toContain("ok");
    expect(b.bytes.toString("utf8")).toContain("ok");
    expect(launchCalls()).toBe(1);
  });

  test("sequential renders after the first still reuse the live context", async () => {
    const { pw, launchCalls } = makeFakePw();
    const renderer = new Renderer(pw, { userAgent: "t", timeoutMs: 1000, maxBytes: 1_000_000 });

    await renderer.render("http://example.test/a");
    await renderer.render("http://example.test/b");
    await renderer.render("http://example.test/c");

    expect(launchCalls()).toBe(1);
  });
});
