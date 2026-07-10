import { render, screen } from "@testing-library/react";
import type { Segment } from "@photonsurge/shared/director";
import TrackInfoPanel from "./TrackInfoPanel";

const base: Segment = {
  id: "flight:adfeb7",
  kind: "flight",
  title: "AF1",
  camera: { center: [0, 0], zoom: 6 },
  patch: {},
  holdMs: 1000,
  details: [
    { label: "Type", value: "Boeing VC-25A" },
    { label: "Altitude", value: "FL300 · 9,144 m" },
    { label: "Heading", value: "270°" },
  ],
};

describe("TrackInfoPanel", () => {
  it("renders nothing without trackInfo", () => {
    const { container } = render(<TrackInfoPanel segment={base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the catalog label, type/operator, photo and blurb for a notable craft", () => {
    const seg: Segment = {
      ...base,
      trackInfo: {
        label: "Air Force One",
        type: "Boeing VC-25A",
        operator: "United States Air Force",
        photoUrl: "https://cdn/af1.jpg",
        photoCredit: "Jane Doe",
        extract: "The VC-25A is the presidential aircraft.",
        notable: true,
      },
    };
    render(<TrackInfoPanel segment={seg} />);
    expect(screen.getByText("Air Force One")).toBeInTheDocument();
    expect(screen.getByText("Boeing VC-25A · United States Air Force")).toBeInTheDocument();
    expect(screen.getByText(/presidential aircraft/)).toBeInTheDocument();
    const img = screen.getByAltText("Air Force One") as HTMLImageElement;
    expect(img.src).toContain("af1.jpg");
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
    // Only the live stats surface here (identity lives in the header rows).
    expect(screen.getByText("Altitude")).toBeInTheDocument();
    expect(screen.getByText("Heading")).toBeInTheDocument();
  });

  it("surfaces the live aircraft telemetry rows (speed, vertical rate, callsign)", () => {
    const seg: Segment = {
      ...base,
      details: [
        { label: "Type", value: "Boeing VC-25A" },
        { label: "Altitude", value: "FL300 · 9,144 m" },
        { label: "Speed", value: "480 kn · 889 km/h" },
        { label: "Heading", value: "270°" },
        { label: "Vert. rate", value: "▲ 1,200 fpm" },
        { label: "Callsign", value: "AF1" },
      ],
      trackInfo: { label: "Air Force One", notable: true },
    };
    render(<TrackInfoPanel segment={seg} />);
    expect(screen.getByText("Speed")).toBeInTheDocument();
    expect(screen.getByText("480 kn · 889 km/h")).toBeInTheDocument();
    expect(screen.getByText("Vert. rate")).toBeInTheDocument();
    expect(screen.getByText("▲ 1,200 fpm")).toBeInTheDocument();
    expect(screen.getByText("Callsign")).toBeInTheDocument();
    // Type stays an identity row, never a live-stat chip.
    expect(screen.queryByText("Type")).not.toBeInTheDocument();
  });

  it("flags a VIP with the VIP heading", () => {
    const seg: Segment = { ...base, trackInfo: { label: "Air Force One", vip: true, notable: true } };
    render(<TrackInfoPanel segment={seg} />);
    expect(screen.getByText(/VIP TRACK/)).toBeInTheDocument();
  });

  it("shows the catalog category as a badge and the manufacturer alongside type/operator", () => {
    const seg: Segment = {
      ...base,
      trackInfo: {
        label: "Queen Mary 2",
        category: "cruise",
        manufacturer: "Fincantieri",
        type: "Ocean liner",
        operator: "Cunard",
        notable: true,
      },
    };
    render(<TrackInfoPanel segment={seg} />);
    expect(screen.getByText("cruise")).toBeInTheDocument();
    expect(screen.getByText("Fincantieri · Ocean liner · Cunard")).toBeInTheDocument();
  });

  it("hides manufacturer when type already leads with it (avoids redundancy)", () => {
    const seg: Segment = {
      ...base,
      trackInfo: { label: "Air Force One", manufacturer: "Boeing", type: "Boeing VC-25A", notable: true },
    };
    render(<TrackInfoPanel segment={seg} />);
    expect(screen.getByText("Boeing VC-25A")).toBeInTheDocument();
  });
});
