import { parseGeonetCams } from "./geonet-cams";

// Trimmed real-shape sample (top-level is a list of { features: [...] }).
const SAMPLE = [
  {
    features: [
      {
        type: "Feature",
        id: "ngauruhoe",
        geometry: { type: "Point", coordinates: [-39.16732, 175.48055] }, // [lat, lng]
        "volcano-id": ["ngauruhoe"],
        "volcano-title": ["Ngauruhoe"],
        properties: {
          title: "Ngauruhoe from West",
          azimuth: 84,
          "latest-image-large": "latest/ngauruhoe.jpg",
          "latest-image-thumb": "latest/t-ngauruhoe.jpg",
          "latest-timestamp": " 4:10 pm (NZST) 13 Jul 2026",
        },
      },
      {
        type: "Feature",
        id: "ngauruhoetongariro",
        geometry: { type: "Point", coordinates: [-39.29642, 175.7663] },
        "volcano-id": ["ngauruhoe", "tongariro"],
        properties: { title: "Ngauruhoe & Tongariro from SE", "latest-image-large": "latest/ngauruhoetongariro.jpg" },
      },
      // No large image — skipped.
      { type: "Feature", id: "broken", geometry: { type: "Point", coordinates: [-39, 175] }, "volcano-id": ["x"], properties: { title: "x" } },
    ],
  },
];

describe("parseGeonetCams", () => {
  const cams = parseGeonetCams(SAMPLE);

  it("skips cameras without a latest large image", () => {
    expect(cams).toHaveLength(2);
    expect(cams.some((c) => c.cameraId === "broken")).toBe(false);
  });

  it("reads [lat, lng] in GeoNet's reversed order", () => {
    const n = cams.find((c) => c.cameraId === "ngauruhoe")!;
    expect(n.lat).toBe(-39.16732);
    expect(n.lng).toBe(175.48055);
  });

  it("builds the absolute latest-image URL + reads azimuth", () => {
    const n = cams.find((c) => c.cameraId === "ngauruhoe")!;
    expect(n.imageUrl).toBe("https://images.geonet.org.nz/volcano/cameras/latest/ngauruhoe.jpg");
    expect(n.azimuthDeg).toBe(84);
  });

  it("keeps all volcano slugs for a multi-volcano camera", () => {
    const m = cams.find((c) => c.cameraId === "ngauruhoetongariro")!;
    expect(m.volcanoSlugs).toEqual(["ngauruhoe", "tongariro"]);
  });
});
