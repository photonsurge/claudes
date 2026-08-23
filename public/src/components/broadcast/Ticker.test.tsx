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
});
