import { satcatToMeta, ownerName, type SatcatRecord } from "./celestrak";

const HUBBLE: SatcatRecord = {
  OBJECT_NAME: "HST",
  OBJECT_ID: "1990-037B",
  NORAD_CAT_ID: 20580,
  OBJECT_TYPE: "PAY",
  OPS_STATUS_CODE: "+",
  OWNER: "US",
  LAUNCH_DATE: "1990-04-24",
  LAUNCH_SITE: "AFETR",
  DECAY_DATE: "",
  PERIOD: 95.42,
  INCLINATION: 28.47,
  APOGEE: 538,
  PERIGEE: 522,
};

describe("ownerName", () => {
  it("resolves known SATCAT codes to readable names", () => {
    expect(ownerName("US")).toBe("United States");
    expect(ownerName("EUME")).toBe("EUMETSAT");
  });

  it("falls back to the raw code for the long tail, and passes through undefined", () => {
    expect(ownerName("ZZZ")).toBe("ZZZ");
    expect(ownerName(undefined)).toBeUndefined();
  });
});

describe("satcatToMeta", () => {
  it("maps a SATCAT row onto noradId + meta", () => {
    const { noradId, meta } = satcatToMeta(HUBBLE);
    expect(noradId).toBe("20580");
    expect(meta.objectId).toBe("1990-037B");
    expect(meta.owner).toBe("US");
    expect(meta.ownerName).toBe("United States");
    expect(meta.objectType).toBe("PAY");
    expect(meta.launchDate).toBe("1990-04-24");
    expect(meta.launchSite).toBe("AFETR");
    expect(meta.periodMin).toBe(95.42);
    expect(meta.inclinationDeg).toBe(28.47);
    expect(meta.apogeeKm).toBe(538);
    expect(meta.perigeeKm).toBe(522);
  });

  it("drops empty strings and zero/unknown numerics", () => {
    const { meta } = satcatToMeta({
      OBJECT_NAME: "UNKNOWN",
      OBJECT_ID: "",
      NORAD_CAT_ID: 99999,
      OWNER: "",
      LAUNCH_DATE: "",
      PERIOD: 0,
      APOGEE: 0,
    });
    expect(meta.objectId).toBeUndefined();
    expect(meta.owner).toBeUndefined();
    expect(meta.ownerName).toBeUndefined();
    expect(meta.launchDate).toBeUndefined();
    expect(meta.periodMin).toBeUndefined();
    expect(meta.apogeeKm).toBeUndefined();
  });
});
