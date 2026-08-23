/**
 * Ticker — the crawl band follows the theme's tickerBg/tickerText tokens, the
 * title chip rides the accent, and the chip text stays white regardless.
 */
import { render, screen } from "@testing-library/react";
import Ticker from "./Ticker";
import { DEFAULT_THEME } from "./config";

describe("Ticker", () => {
  const themed = {
    ...DEFAULT_THEME,
    accent: "#112233",
    tickerBg: "rgb(1, 2, 3)",
    tickerText: "#445566",
  };

  it("themes the band background and crawl ink", () => {
    render(<Ticker title="VIGIL TAPE" items={["ONE", "TWO"]} edge="top" theme={themed} />);

    const chip = screen.getByText("VIGIL TAPE");
    const band = chip.parentElement as HTMLElement;
    expect(band).toHaveStyle({ background: "rgb(1, 2, 3)", color: "rgb(68, 85, 102)" });
    // Chip: accent background, text stays white for contrast on any accent.
    expect(chip).toHaveStyle({ background: "rgb(17, 34, 51)", color: "rgb(255, 255, 255)" });
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
