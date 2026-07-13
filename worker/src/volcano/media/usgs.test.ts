import { parseUsgsAshcam, parseUsgsCameraDetail, parseUsgsVolcanoWebcams } from "./usgs";

describe("USGS VHP media adapter", () => {
  it("discovers camera codes and thermal classification from a volcano page", () => {
    const rows = parseUsgsVolcanoWebcams(`
      <a href="/media/webcams/v3cam">[V3cam] South crater</a>
      <a href="/media/webcams/f1cam">[F1cam] thermal image from west rim</a>
    `, "https://www.usgs.gov/volcanoes/kilauea/webcams");
    expect(rows.map((r) => [r.sourceCameraId, r.mode])).toEqual([["V3cam", "UNKNOWN"], ["F1cam", "THERMAL"]]);
  });

  it("discovers the current still, 24-hour animation and item rights", () => {
    const camera = parseUsgsVolcanoWebcams('<a href="/cam/v3">[V3cam] crater</a>', "https://www.usgs.gov/volcanoes/kilauea/webcams")[0];
    const row = parseUsgsCameraDetail(camera, `
      <img src="/media/v3-current.jpg"><a href="/media/v3-24-hour.gif">24 hour animation</a>
      Sources/Usage: Public Domain
    `);
    expect(row.currentImageUrl).toBe("https://www.usgs.gov/media/v3-current.jpg");
    expect(row.gif24hUrl).toBe("https://www.usgs.gov/media/v3-24-hour.gif");
    expect(row.reuseAllowed).toBe(true);
  });

  it("treats an access-controlled volcano page as a source miss", async () => {
    const fetchImpl = jest.fn(async () => new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
    await expect((await import("./usgs")).fetchUsgsVolcanoWebcams("https://www.usgs.gov/volcanoes/x/webcams", fetchImpl))
      .resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("parses Ashcam API records with their stable GVP crosswalk", () => {
    expect(parseUsgsAshcam([{ webcamCode: "F1cam", webcamName: "Kilauea thermal", vnum: "332010",
      vName: "Kilauea", latitude: 19.4, longitude: -155.3, newestImageUrl: "https://example.test/F1.jpg" }])[0])
      .toMatchObject({ sourceCameraId: "F1cam", volcanoNumber: "332010", mode: "THERMAL", currentImageUrl: "https://example.test/F1.jpg" });
  });
});
