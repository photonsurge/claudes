/**
 * Ticker — the crawl band follows the theme's tickerBg/tickerText tokens, the
 * title chip rides the accent, and the chip text stays white regardless.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import Ticker, { entryKeys, feedStart } from "./Ticker";
import { DEFAULT_THEME } from "./config";

describe("Ticker", () => {
  const themed = {
    ...DEFAULT_THEME,
    accent: "#112233",
    tickerBg: "rgb(1, 2, 3)",
    tickerText: "#445566",
  };

  it("keeps the crawl's DOM when the feed is re-derived with the same lines, and adopts new content at the segment boundary", () => {
    const { rerender } = render(<Ticker title="T" items={["ONE", "TWO"]} edge="top" theme={themed} />);
    const before = screen.getAllByText("TWO")[0];
    // The track feed hands the ticker a fresh array every second: same lines, same nodes.
    rerender(<Ticker title="T" items={["ONE", "TWO"]} edge="top" theme={themed} />);
    expect(screen.getAllByText("TWO")[0]).toBe(before);
    // New content mid-segment: the running segment keeps rolling, untouched —
    // no rewind, no rebuilt track (every director cut changes the feed).
    rerender(<Ticker title="T" items={["ZERO", "ONE", "TWO", "TWO"]} edge="top" theme={themed} />);
    expect(screen.queryByText("ZERO")).toBeNull();
    expect(screen.getAllByText("TWO")[0]).toBe(before);
    // When the segment ends, the next one is cut from the new feed.
    fireEvent.animationEnd(before.closest("div")!);
    expect(screen.getAllByText("ZERO").length).toBeGreaterThan(0);
    // Keys are the text; repeats (a sponsor line twice, say) get a suffix.
    expect(entryKeys(["A", "B", "A", { text: "A", ad: true }])).toEqual(["A", "B", "A#1", "A#2"]);
  });

  it("sizes the crawl from a ResizeObserver, never a forced rect read", () => {
    // The widths arrive after the frame's own layout (round 55); the effect
    // reads no rects itself, so a segment mounting inside a cut's commit can't
    // force a layout of the cut's fresh DOM.
    const observed: Element[] = [];
    let deliver: ResizeObserverCallback | null = null;
    const Observer = class {
      constructor(cb: ResizeObserverCallback) {
        deliver = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      unobserve() {}
      disconnect() {}
    };
    const real = globalThis.ResizeObserver;
    globalThis.ResizeObserver = Observer as unknown as typeof ResizeObserver;
    const rect = jest.spyOn(Element.prototype, "getBoundingClientRect");
    try {
      render(<Ticker items={["one", "two", "three"]} edge="bottom" />);
      const [head, track, viewport] = observed as HTMLElement[];
      expect(track).toBe(head.parentElement);
      expect(viewport).toBe(track.parentElement);
      expect(track.style.animation).toBe("");
      const entry = (target: Element, width: number) => ({ target, contentRect: { width } }) as unknown as ResizeObserverEntry;
      act(() => deliver!([entry(head, 900), entry(track, 2400), entry(viewport, 1200)], {} as ResizeObserver));
      expect(track.style.animation).toMatch(/^bcast-crawl-0 [\d.]+s linear forwards$/);
      expect(rect).not.toHaveBeenCalled();
    } finally {
      globalThis.ResizeObserver = real;
      rect.mockRestore();
    }
  });

  it("adopts the first real feed straight away after standby", () => {
    const { rerender } = render(<Ticker title="T" items={[]} edge="bottom" theme={themed} />);
    expect(screen.getAllByText(/STANDING BY/).length).toBeGreaterThan(0);
    rerender(<Ticker title="T" items={["FIRST LINE"]} edge="bottom" theme={themed} />);
    expect(screen.getAllByText("FIRST LINE").length).toBeGreaterThan(0);
    expect(screen.queryByText(/STANDING BY/)).toBeNull();
  });

  it("feedStart continues at the entry that was due next when the feed changes", () => {
    const window = { head: [{ entry: "A", index: 0 }], tail: [{ entry: "B", index: 1 }] };
    // Same feed: straight after the head.
    expect(feedStart(0, window, ["A", "B", "C"])).toBe(1);
    // A line inserted ahead: B is still due next, now at index 2.
    expect(feedStart(0, window, ["X", "A", "B", "C"])).toBe(2);
    // B gone: the same position modulo the new length, never a rewind to 0 by accident.
    expect(feedStart(0, window, ["A", "C"])).toBe(1);
  });

  it("renders a window of a long feed, and advances when the head has scrolled out", () => {
    const items = Array.from({ length: 3000 }, (_, i) => `LINE ${i} OF THE LONG FEED TONIGHT`);
    render(<Ticker title="T" items={items} edge="top" theme={themed} />);
    const spans = document.querySelectorAll("span").length;
    expect(spans).toBeLessThan(120); // not 3000 × 2 × 2
    expect(screen.getAllByText("LINE 0 OF THE LONG FEED TONIGHT").length).toBe(1);
    expect(screen.queryByText("LINE 200 OF THE LONG FEED TONIGHT")).toBeNull();
    const track = screen.getByText("LINE 0 OF THE LONG FEED TONIGHT").closest("div")!;
    fireEvent.animationEnd(track);
    // The next segment starts where the previous tail began.
    expect(screen.queryByText("LINE 0 OF THE LONG FEED TONIGHT")).toBeNull();
    expect(screen.getAllByText(/^LINE \d+ OF THE LONG FEED TONIGHT$/).length).toBeGreaterThan(0);
  });

  it("themes the band background and crawl ink", () => {
    render(<Ticker title="VIGIL TAPE" items={["ONE", "TWO"]} edge="top" theme={themed} />);

    const chip = screen.getByText("VIGIL TAPE");
    const band = chip.parentElement as HTMLElement;
    expect(band).toHaveStyle({ background: "rgb(1, 2, 3)", color: "rgb(68, 85, 102)" });
    // Chip: accent background, text stays white for contrast on any accent.
    expect(chip).toHaveStyle({ background: "rgb(17, 34, 51)", color: "rgb(255, 255, 255)" });
  });

  // A woven sponsored mention (lib/broadcast weaveSponsors) rides the crawl in
  // the accent ink with an AD tag; plain feed lines keep the band's ink.
  it("renders a sponsored entry in the accent with an AD tag", () => {
    render(
      <Ticker
        title="FEED"
        items={["ONE", { text: "Sponsored by Acme", ad: true }]}
        edge="bottom"
        theme={themed}
      />,
    );

    const mention = screen.getAllByText(/Sponsored by Acme/)[0];
    expect(mention).toHaveStyle({ color: "rgb(17, 34, 51)" });
    expect(screen.getAllByText("AD").length).toBeGreaterThan(0);
    // The plain line stays on the band ink (inherited, so no own color style).
    expect(screen.getAllByText("ONE")[0]).not.toHaveStyle({ color: "rgb(17, 34, 51)" });
  });

  it("falls back to the standby line with no items", () => {
    render(<Ticker title="FEED" items={[]} edge="bottom" />);
    expect(screen.getAllByText(/STANDING BY · AWAITING LIVE FEED/).length).toBeGreaterThan(0);
  });

  // The top crawl's behind-the-masthead mode: no chip, and the crawl viewport
  // starts contentInset px into the band (the band still spans full width) so
  // the text clips at the banner artwork's right edge.
  it("renders chip-less with the crawl clipped at contentInset", () => {
    render(<Ticker title={null} items={["ONE"]} edge="top" contentInset={760} theme={themed} />);

    const band = screen.getAllByText(/ONE/)[0].closest("div")!
      .parentElement!.parentElement as HTMLElement;
    expect(band).toHaveStyle({ background: "rgb(1, 2, 3)" });
    // No accent chip in the band — just the keyframes <style> and the viewport.
    expect(band.children).toHaveLength(2);
    const viewport = screen.getAllByText(/ONE/)[0].closest("div")!.parentElement as HTMLElement;
    expect(viewport).toHaveStyle({ marginLeft: "760px" });
  });
});
