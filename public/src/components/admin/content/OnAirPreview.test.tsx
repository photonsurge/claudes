import { render, screen } from "@testing-library/react";
import OnAirPreview from "./OnAirPreview";

describe("OnAirPreview", () => {
  it("renders the volcano lede + facts signature card from the merged entity", () => {
    render(
      <OnAirPreview
        type="volcano"
        entity={{
          id: "vc1",
          name: "Etna",
          country: "Italy",
          status: "Erupting",
          volcanoType: "Stratovolcano",
          elevationM: 3357,
          lat: 37.75,
          lng: 14.99,
          wikiExtract: "Europe's tallest active volcano.",
        }}
        images={[]}
      />,
    );
    // Lede title (from the deck chrome header) + area blurb.
    expect(screen.getAllByText(/Etna/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Europe's tallest active volcano/).length).toBeGreaterThan(0);
    // Signature card body (facts) — the eyebrow is replaced by the deck header on air.
    expect(screen.getAllByText(/Stratovolcano/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3357 m/).length).toBeGreaterThan(0);
  });

  it("renders the quake lede + seismic report signature card", () => {
    render(
      <OnAirPreview
        type="quake"
        entity={{ quakeId: "us1", mag: 6.2, depthKm: 12, place: "80km S of Reykjavík", lat: 63, lng: -21 }}
        images={[]}
      />,
    );
    expect(screen.getAllByText(/Reykjavík/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("M6.2").length).toBeGreaterThan(0);
    // Seismic report body (depth classification) proves the signature card rendered.
    expect(screen.getByText(/Shallow/)).toBeInTheDocument();
  });

  it("uses an uploaded primary image as the on-air area photo", () => {
    render(
      <OnAirPreview
        type="city"
        entity={{ id: "c1", name: "Oslo", country: "Norway", lat: 59.9, lng: 10.7 }}
        images={[
          { id: "img1", entityType: "city", entityId: "c1", contentType: "image/png", byteSize: 1, primary: true, sort: 0, updatedAt: 5 },
        ]}
      />,
    );
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toContain("/api/media/img1");
  });
});
