import { render, screen } from "@testing-library/react";
import GodsBanner from "./GodsBanner";

describe("GodsBanner", () => {
  it("renders the masthead with the scene accent and no hole by default", () => {
    render(<GodsBanner accent="#f43f5e" clock={false} />);
    const banner = screen.getByRole("img", {
      name: "Global Orbital Detection System",
    });

    expect(banner.querySelector('[stroke="#f43f5e"]')).toBeInTheDocument();
    // No aperture mask unless liveCore asks for one.
    expect(banner.querySelector("mask")).not.toBeInTheDocument();
    expect(banner.querySelector('[data-layer="panel"]')?.getAttribute("mask")).toBeNull();
  });

  it("shows the supplied channels, coords and ticker line", () => {
    render(
      <GodsBanner
        clock={false}
        channels={["SEISMIC", "VOLCANIC"]}
        coords={{ lat: -15.389, lon: 167.835 }}
        ticker="UP NEXT · TEST EVENT"
      />,
    );
    expect(screen.getByText("SEISMIC")).toBeInTheDocument();
    expect(screen.getByText("VOLCANIC")).toBeInTheDocument();
    expect(screen.getByText("-15.389")).toBeInTheDocument();
    expect(screen.getByText("167.835")).toBeInTheDocument();
    expect(screen.getByText("UP NEXT · TEST EVENT")).toBeInTheDocument();
    // Empty ticker (the default) hides the whole tape row — no fake events.
  });

  it("hides coords and the tape row when not supplied", () => {
    render(<GodsBanner clock={false} />);
    const banner = screen.getByRole("img");
    expect(screen.queryByText("LAT")).not.toBeInTheDocument();
    expect(banner.querySelector('[data-layer="ticker"]')).not.toBeInTheDocument();
  });

  it("ticks a live UTC clock with the five city times", () => {
    render(<GodsBanner />);
    expect(screen.getByText(/\d{2}:\d{2}:\d{2} UTC/)).toBeInTheDocument();
    const cities = screen.getByText(/LONDON \d{2}:\d{2}:\d{2}/);
    for (const name of ["NEW YORK", "BEIJING", "TOKYO", "MOSCOW"]) {
      expect(cities).toHaveTextContent(new RegExp(`${name} \\d{2}:\\d{2}:\\d{2}`));
    }
  });

  it("counts down to the next cut in the tape row", () => {
    render(<GodsBanner clock={false} ticker="UP NEXT · TEST EVENT" nextAt={Date.now() + 125_000} />);
    // ~125s out → 02:05 (allow a boundary second either side).
    expect(screen.getByText(/NEXT IN 02:0[3-5]/)).toBeInTheDocument();
    // The countdown replaces the VIGIL TAPE filler while live.
    expect(screen.queryByText(/VIGIL TAPE/)).not.toBeInTheDocument();
  });

  it("shows the tape row for a countdown even with no up-next line", () => {
    render(<GodsBanner clock={false} nextAt={Date.now() + 65_000} />);
    expect(screen.getByText(/NEXT IN 01:0[3-5]/)).toBeInTheDocument();
  });

  it("punches the globe aperture through the panel when liveCore", () => {
    render(<GodsBanner liveCore clock={false} />);
    const banner = screen.getByRole("img");

    // The hole mask exists and the panel layer (which spans the globe area)
    // carries it — otherwise the aperture would just show the panel fill.
    expect(banner.querySelector("mask circle")).toBeInTheDocument();
    expect(banner.querySelector('[data-layer="panel"]')?.getAttribute("mask")).toMatch(/^url\(#gb-hole-/);
  });

  it("uses unique paint-server ids for multiple banners", () => {
    render(
      <>
        <GodsBanner label="First banner" clock={false} />
        <GodsBanner label="Second banner" clock={false} />
      </>,
    );
    const [first, second] = screen.getAllByRole("img");
    const firstGradient = first.querySelector("linearGradient")?.id;
    const secondGradient = second.querySelector("linearGradient")?.id;

    expect(firstGradient).toBeTruthy();
    expect(secondGradient).toBeTruthy();
    expect(firstGradient).not.toBe(secondGradient);
  });
});
