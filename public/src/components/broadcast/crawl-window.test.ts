import { charsOf, crawlWindow, cycleSeconds, entryText, GAP_CHARS, nextStart, windowKeys } from "./crawl-window";

describe("crawl window", () => {
  const feed = ["ALPHA LINE", "BRAVO LINE LONGER", "CHARLIE", "DELTA FOUR", "ECHO FIVE FIVE"];

  it("counts characters the way the old whole-crawl line did", () => {
    const line = feed.map(entryText).join("     ❯     ");
    expect(charsOf(feed)).toBe(line.length);
    expect(GAP_CHARS).toBe("     ❯     ".length);
    expect(cycleSeconds(feed)).toBe(Math.max(24, line.length * 0.16));
    expect(cycleSeconds(["hi"])).toBe(24);
  });

  it("takes a head of at least headChars then a tail, wrapping round the feed", () => {
    const w = crawlWindow(feed, 3, 25, 25);
    expect(w.head.map((e) => e.index)).toEqual([3, 4]); // "DELTA FOUR" + gap = 21 < 25 → one more
    expect(w.tail.map((e) => e.index)).toEqual([0, 1]); // continues after the head, wrapped
    expect(w.tail[0].entry).toBe(feed[0]);
    // A one-line feed repeats itself to fill both parts.
    const one = crawlWindow(["STANDING BY"], 0, 30, 30);
    expect(one.head.length).toBeGreaterThan(1);
    expect(one.tail.every((e) => e.index === 0)).toBe(true);
    expect(crawlWindow([], 0)).toEqual({ head: [], tail: [] });
  });

  it("advances by the head and wraps", () => {
    const w = crawlWindow(feed, 3, 25, 25);
    expect(nextStart(3, w, feed.length)).toBe(0);
    expect(nextStart(0, crawlWindow(feed, 0, 1, 1), feed.length)).toBe(1);
  });

  it("keys entries by text with repeats suffixed", () => {
    const w = crawlWindow(["A", "B", "A"], 0, 30, 1);
    expect(windowKeys(w.head)).toEqual(["A", "B", "A#1", "A#2", "B#1", "A#3"].slice(0, w.head.length));
  });
});
