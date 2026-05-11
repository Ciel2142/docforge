import { describe, expect, test } from "vitest";
import { Keyv } from "keyv";
import { CompatKeyv } from "../src/http/compat-keyv.js";

// Regression coverage for the listener leak that caused infra-mzl:
// keyv@5 ships its own EventManager whose once() wrapper has no Node-style
// `.listener` back-pointer, so removeListener(event, original) cannot find
// it and the listener stays in the array. cacheable-request@13 uses the
// standard Node EE contract — one HTTP request per leaked listener.

describe("vanilla Keyv (documents the upstream bug)", () => {
  test("once + removeListener does NOT remove the listener (proves the leak)", () => {
    const k = new Keyv();
    const handler = (): void => {};
    k.once("error", handler);
    expect(k.listeners("error").length).toBe(1);
    k.removeListener("error", handler);
    expect(k.listeners("error").length).toBe(1);
  });
});

describe("CompatKeyv", () => {
  test("is still an instance of Keyv (cacheable-request relies on instanceof)", () => {
    const k = new CompatKeyv();
    expect(k).toBeInstanceOf(Keyv);
  });

  test("once + removeListener removes the listener (Node-style interop)", () => {
    const k = new CompatKeyv();
    const handler = (): void => {};
    k.once("error", handler);
    expect(k.listeners("error").length).toBe(1);
    k.removeListener("error", handler);
    expect(k.listeners("error").length).toBe(0);
  });

  test("once + off (alias) removes the listener", () => {
    const k = new CompatKeyv();
    const handler = (): void => {};
    k.once("error", handler);
    k.off("error", handler);
    expect(k.listeners("error").length).toBe(0);
  });

  test("once still self-cleans when the event fires", () => {
    const k = new CompatKeyv();
    let fired = 0;
    k.once("error", () => {
      fired += 1;
    });
    k.emit("error", new Error("boom"));
    k.emit("error", new Error("ignored"));
    expect(fired).toBe(1);
    expect(k.listeners("error").length).toBe(0);
  });

  test("200 once+removeListener cycles leave zero residual listeners", () => {
    const k = new CompatKeyv();
    for (let i = 0; i < 200; i += 1) {
      const h = (): void => {};
      k.once("error", h);
      k.removeListener("error", h);
    }
    expect(k.listeners("error").length).toBe(0);
  });

  test("on + removeListener still works (no regression vs. plain Keyv)", () => {
    const k = new CompatKeyv();
    const handler = (): void => {};
    k.on("error", handler);
    expect(k.listeners("error").length).toBe(1);
    k.removeListener("error", handler);
    expect(k.listeners("error").length).toBe(0);
  });
});
