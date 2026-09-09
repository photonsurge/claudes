/**
 * Ticker — the crawl band follows the theme's tickerBg/tickerText tokens, the
 * title chip rides the accent, and the chip text stays white regardless.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import Ticker, { entryKeys } from "./Ticker";
import { DEFAULT_THEME } from "./config";

describe("Ticker", () => {
  const themed = {
    ...DEFAULT_THEME,
    accent: "#112233",
    tickerBg: "rgb(1, 2, 3)",
    tickerText: "#445566",
  };

  it("keeps the crawl's DOM when the feed is re-derived with the same lines, restarts on new content", () => {
    const { rerender } = render(<Ticker title="T" items={["ONE", "TWO"]} edge="top" theme={themed} />);
    const before = screen.getAllByText("TWO")[0];
    // The track feed hands the ticker a fresh array every second: same lines, same nodes.
    rerender(<Ticker title="T" items={["ONE", "TWO"]} edge="top" theme={themed} />);
    expect(screen.getAllByText("TWO")[0]).toBe(before);
    // New content: the crawl restarts from the feed's first entry.
    rerender(<Ticker title="T" items={["ZERO", "ONE", "TWO", "TWO"]} edge="top" theme={themed} />);
    expect(screen.getAllByText("ZERO").length).toBeGreaterThan(0);
    const track = screen.getAllByText("ZERO")[0].closest("div")!;
    expect(track.textContent!.startsWith("ZERO")).toBe(true);
    // Keys are the text; repeats (a sponsor line twice, say) get a suffix.
    expect(entryKeys(["A", "B", "A", { text: "A", ad: true }])).toEqual(["A", "B", "A#1", "A#2"]);
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
