import { orbitFarZ } from "./globe-depth";

/** deck's own far plane for the globe, to compare against (globe-viewport.js). */
const deckFarZ = (zoom: number, latitude: number, height: number) =>
  1.5 + (256 * 2 * (Math.pow(2, zoom) / (Math.PI * Math.cos((latitude * Math.PI) / 180)))) / height;

const BROADCAST = { latitude: 20, height: 1080 };
const GEO_M = 35_786_000;
const GPS_M = 20_200_000;
const LEO_M = 550_000;

describe("orbitFarZ", () => {
  it("reaches past deck's own far plane for a geostationary shell", () => {
    const zoom = 0.38;
    const far = orbitFarZ({ ...BROADCAST, zoom, maxAltitudeM: GEO_M });
    expect(far).toBeDefined();
    // The regression: deck's plane stops at the back of the PLANET, so the back
    // of the belt — 6.6 radii out — was clipped away.
    expect(far as number).toBeGreaterThan(deckFarZ(zoom, BROADCAST.latitude, BROADCAST.height));
  });

  it("reaches the back of the shell, measured from the surface point deck centres on", () => {
    const zoom = 0.38;
    const scale = Math.pow(2, zoom) / (Math.PI * Math.cos((BROADCAST.latitude * Math.PI) / 180));
    const planet = (256 * scale) / BROADCAST.height;
    const shell = (GEO_M / 6370972 + 1) * planet;
    const far = orbitFarZ({ ...BROADCAST, zoom, maxAltitudeM: GEO_M }) as number;
    // Surface → centre is one planet radius, centre → the far side of the shell
    // is the shell's; nothing on the shell can be deeper than the sum.
    expect(far).toBeGreaterThanOrEqual(1.5 + planet + shell);
    // ...and not wastefully further, which would cost depth precision.
    expect(far).toBeLessThan((1.5 + planet + shell) * 1.05);
  });

  it("pushes further out the higher the shell", () => {
    const geo = orbitFarZ({ ...BROADCAST, zoom: 0.4, maxAltitudeM: GEO_M }) as number;
    const gps = orbitFarZ({ ...BROADCAST, zoom: 0.4, maxAltitudeM: GPS_M }) as number;
    expect(geo).toBeGreaterThan(gps);
  });

  it("leaves deck's plane alone when there are no orbits to reach", () => {
    expect(orbitFarZ({ ...BROADCAST, zoom: 3.0, maxAltitudeM: 0 })).toBeUndefined();
  });

  it("barely moves the plane for a shell that hugs the surface", () => {
    const deck = deckFarZ(3.0, BROADCAST.latitude, BROADCAST.height);
    // A ring just above the ground needs what the planet needs, and no more.
    const far = orbitFarZ({ ...BROADCAST, zoom: 3.0, maxAltitudeM: 1000 }) as number;
    expect(far / deck).toBeLessThan(1.03);
    // Low Earth orbit is a few percent further out again.
    expect(orbitFarZ({ ...BROADCAST, zoom: 3.0, maxAltitudeM: LEO_M }) as number).toBeGreaterThan(far);
  });

  it("does not stretch the depth range for a shell that is nowhere near the frame", () => {
    // Zoomed into a country with satellites on: the shell is many frame-heights
    // wide, so reaching it would trade real depth precision for nothing on screen.
    expect(orbitFarZ({ ...BROADCAST, zoom: 6, maxAltitudeM: GEO_M })).toBeUndefined();
  });

  it("ignores a viewport it cannot measure", () => {
    expect(orbitFarZ({ ...BROADCAST, height: 0, zoom: 1, maxAltitudeM: GEO_M })).toBeUndefined();
    expect(orbitFarZ({ ...BROADCAST, zoom: NaN, maxAltitudeM: GEO_M })).toBeUndefined();
  });
});
