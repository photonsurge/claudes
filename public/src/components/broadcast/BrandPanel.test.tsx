import { render, screen } from "@testing-library/react";
import BrandPanel from "./BrandPanel";
import { BROADCAST_THEMES } from "./config";

describe("BrandPanel", () => {
  it("does not duplicate LIVE or map status beneath the brand", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.command} />);
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
    expect(screen.queryByText("MAP")).not.toBeInTheDocument();
  });

  it("renders the scene-coloured G.O.D.S. vector banner", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.command} />);
    const banner = screen.getByRole("img", {
      name: "G.O.D.S. Global Orbital Detection System",
    });
    expect(banner.tagName).toBe("svg");
    expect(banner).toHaveAttribute("width", "620");
    expect(banner.querySelector(`[stroke="${BROADCAST_THEMES.command.accent}"]`)).toBeInTheDocument();
  });

  it("no longer carries the world clocks (they ride the masthead map plate)", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.command} />);
    expect(screen.queryByText("LONDON")).not.toBeInTheDocument();
    expect(screen.queryByText("MOSCOW")).not.toBeInTheDocument();
  });

  it("renders theme text for non-G.O.D.S. themes", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.storm} />);
    expect(screen.getByText("STORM WATCH LIVE")).toBeInTheDocument();
    expect(screen.getByText("SEVERE WEATHER OPERATIONS")).toBeInTheDocument();
  });
});
