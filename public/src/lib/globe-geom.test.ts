import { limbPoint, discFromProject } from "./globe-geom";

const DEG = Math.PI / 180;

/** Great-circle angular distance (degrees) between two [lng,lat] points. */
function arcDeg(a: [number, number], b: [number, number]): number {
  const [la1, la2] = [a[1] * DEG, b[1] * DEG];
  const dLng = (a[0] - b[0]) * DEG;
  const c = Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dLng);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

describe("limbPoint", () => {
  it("returns a point exactly 90° away from the centre for any bearing", () => {
    for (const center of [[0, 0], [30, 45], [-120, -60], [170, 10]] as [number, number][]) {
      for (const bearing of [0, 45, 90, 200, 359]) {
        const p = limbPoint(center[0], center[1], bearing);
        expect(arcDeg(center, p)).toBeCloseTo(90, 4);
      }
    }
  });
});

describe("discFromProject", () => {
  // A true orthographic projection centred on the sub-camera point: the limb
  // (every point 90° away) maps exactly onto the circle of radius R about
  // (cx,cy), mirroring how deck's globe silhouette behaves.
  function fakeProject(center: [number, number], cx: number, cy: number, R: number) {
    const lat0 = center[1] * DEG;
    return (coord: [number, number]): number[] => {
      const lat = coord[1] * DEG;
      const dLng = (coord[0] - center[0]) * DEG;
      const x = cx + R * Math.cos(lat) * Math.sin(dLng);
      const y = cy - R * (Math.cos(lat0) * Math.sin(lat) - Math.sin(lat0) * Math.cos(lat) * Math.cos(dLng));
      return [x, y];
    };
  }

  it("recovers the disc centre and radius", () => {
    const center: [number, number] = [0, 0];
    const disc = discFromProject(fakeProject(center, 400, 300, 250), center[0], center[1], 24);
    expect(disc).not.toBeNull();
    expect(disc!.cx).toBeCloseTo(400, 0);
    expect(disc!.cy).toBeCloseTo(300, 0);
    expect(disc!.r).toBeCloseTo(250, 0);
  });

  it("returns null when the projection is non-finite", () => {
    const disc = discFromProject(() => [NaN, NaN], 0, 0);
    expect(disc).toBeNull();
  });
});
