import { render, screen } from "@testing-library/react";
import OnAirCard from "./OnAirCard";
import type { Segment } from "@photonsurge/shared/director";
import type { AreaInfo } from "./mode-slides";

const seg = (over: Record<string, unknown> = {}): Segment =>
  ({ kind: "quake", id: "quake:x", title: "M6.1 — Off Coast", camera: { center: [0, 0], zoom: 6 }, ...over }) as unknown as Segment;

describe("OnAirCard", () => {
  it("carries the uniform lede header: kind badge, title and ON AIR", () => {
    render(<OnAirCard segment={seg()} />);
    expect(screen.getByText("Seismic")).toBeInTheDocument(); // KIND_LABEL[quake]
    expect(screen.getByText(/M6.1 — Off Coast/)).toBeInTheDocument();
    expect(screen.getByText("ON AIR")).toBeInTheDocument();
  });

  it("renders the area block (name + blurb) when areaInfo is supplied", () => {
    const area: AreaInfo = { name: "Japan", photo: null, blurb: "An island nation in East Asia." };
    render(<OnAirCard segment={seg()} areaInfo={area} />);
    expect(screen.getByText("The Area")).toBeInTheDocument();
    expect(screen.getByText("Japan")).toBeInTheDocument();
    expect(screen.getByText("An island nation in East Asia.")).toBeInTheDocument();
  });

  it("omits the area block when areaInfo has neither photo nor blurb", () => {
    render(<OnAirCard segment={seg()} areaInfo={{ name: "Nowhere", photo: null, blurb: null }} />);
    expect(screen.queryByText("The Area")).not.toBeInTheDocument();
  });
});
