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

  it("renders the theme's name, tagline and strapline", () => {
    render(<BrandPanel theme={BROADCAST_THEMES.command} />);
    expect(screen.getByText("G.O.D.S.")).toBeInTheDocument();
    expect(screen.getByText("GLOBAL ORBITAL DETECTION SYSTEM")).toBeInTheDocument();
    expect(screen.getByText("DETECT. TRACK. PROTECT.")).toBeInTheDocument();
  });
});
