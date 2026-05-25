import { describe, expect, test } from "vitest";
import { fenceRanges, inAnyRange } from "../src/md-fences.js";

describe("fenceRanges", () => {
  test("no fences → empty", () => {
    expect(fenceRanges("plain text\nmore text")).toEqual([]);
  });

  test("one ``` fence → one range covering it", () => {
    const md = "before\n```\ncode\n```\nafter";
    const ranges = fenceRanges(md);
    expect(ranges).toHaveLength(1);
    const [start, end] = ranges[0]!;
    expect(md.slice(start, end)).toContain("```\ncode\n```");
  });

  test("unterminated fence runs to end of string", () => {
    const md = "x\n```\ncode never closed";
    const ranges = fenceRanges(md);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]![1]).toBe(md.length);
  });

  test("~~~ fence recognized", () => {
    expect(fenceRanges("~~~\ncode\n~~~")).toHaveLength(1);
  });

  test("two complete fences → two ranges", () => {
    const md = "a\n```\none\n```\nb\n~~~\ntwo\n~~~\nc";
    const ranges = fenceRanges(md);
    expect(ranges).toHaveLength(2);
    expect(md.slice(ranges[0]![0], ranges[0]![1])).toContain("one");
    expect(md.slice(ranges[1]![0], ranges[1]![1])).toContain("two");
  });
});

describe("inAnyRange", () => {
  test("inside a range → true; outside → false", () => {
    const ranges: Array<[number, number]> = [[5, 10]];
    expect(inAnyRange(7, ranges)).toBe(true);
    expect(inAnyRange(5, ranges)).toBe(true);  // start inclusive
    expect(inAnyRange(10, ranges)).toBe(false); // end exclusive
    expect(inAnyRange(2, ranges)).toBe(false);
  });
});
