import { render, screen } from "@testing-library/react";
import BrandPanel from "./BrandPanel";
import { BROADCAST_THEMES } from "./config";

describe("BrandPanel", () => {
  it("hides the LIVE badge when the director isn't driving the broadcast", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.command} />);
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });

  it("shows the LIVE badge once the director goes active", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.command} live />);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("renders the G.O.D.S. banner asset for G.O.D.S. themes", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.command} />);
    const banner = screen.getByAltText("G.O.D.S. Global Orbital Detection System");
    expect(banner).toHaveAttribute("src", "/gods_banner_transparent.png");
    expect(banner).toHaveStyle({ width: "500px" });
  });

  it("renders the global city clock strip", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.command} />);
    expect(screen.getByText("LONDON")).toBeInTheDocument();
    expect(screen.getByText("NEW YORK")).toBeInTheDocument();
    expect(screen.getByText("BEIJING")).toBeInTheDocument();
    expect(screen.getByText("TOKYO")).toBeInTheDocument();
    expect(screen.getByText("MOSCOW")).toBeInTheDocument();
  });

  it("renders theme text for non-G.O.D.S. themes", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.storm} />);
    expect(screen.getByText("STORM WATCH LIVE")).toBeInTheDocument();
    expect(screen.getByText("SEVERE WEATHER OPERATIONS")).toBeInTheDocument();
  });
});
