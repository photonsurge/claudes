import {
  buildMrmsUrl,
  mrmsDirUrl,
  mrmsFileName,
  mrmsYmd,
  mrmsHms,
  parseMrmsTime,
  mrmsLatestAvailable,
  mrmsLatestByPoll,
  MRMS_BASE,
  MRMS_PRODUCT,
  MRMS_AGL,
  MRMS_MATCH,
  MRMS_TARGET_GRID,
  MRMS_TARGET_BOUNDS,
  MRMS_NEWGRID,
} from "./mrms";

const T = new Date(Date.UTC(2026, 5, 28, 12, 34, 0)); // 2026-06-28 12:34:00Z

describe("MRMS time formatting", () => {
  it("formats UTC YYYYMMDD", () => {
    expect(mrmsYmd(T)).toBe("20260628");
  });
  it("formats UTC HHMMSS zero-padded", () => {
    expect(mrmsHms(T)).toBe("123400");
    expect(mrmsHms(new Date(Date.UTC(2026, 0, 3, 4, 5, 6)))).toBe("040506");
  });
});

describe("mrmsFileName / buildMrmsUrl", () => {
  it("builds the gzip'd GRIB2 filename with product + AGL + timestamp", () => {
    expect(mrmsFileName(T)).toBe(
      `MRMS_${MRMS_PRODUCT}_${MRMS_AGL}_20260628-123400.grib2.gz`,
    );
  });

  it("builds the full direct download URL", () => {
    expect(buildMrmsUrl(T)).toBe(
      `${MRMS_BASE}/${MRMS_PRODUCT}/MRMS_${MRMS_PRODUCT}_${MRMS_AGL}_20260628-123400.grib2.gz`,
    );
  });

  it("dir URL ends in the product folder with a trailing slash", () => {
    expect(mrmsDirUrl()).toBe(`${MRMS_BASE}/${MRMS_PRODUCT}/`);
    expect(buildMrmsUrl(T).startsWith(mrmsDirUrl())).toBe(true);
  });
});

describe("parseMrmsTime", () => {
  it("round-trips a built filename back to its valid time", () => {
    const parsed = parseMrmsTime(mrmsFileName(T));
    expect(parsed?.toISOString()).toBe(T.toISOString());
  });

  it("tolerates a leading directory and a plain .grib2 (no .gz)", () => {
    const parsed = parseMrmsTime(
      `/data/2D/x/MRMS_${MRMS_PRODUCT}_${MRMS_AGL}_20260101-000000.grib2`,
    );
    expect(parsed?.toISOString()).toBe(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString());
  });

  it("returns null for a non-matching name", () => {
    expect(parseMrmsTime("not-a-mrms-file.txt")).toBeNull();
    expect(parseMrmsTime("MRMS_Foo_00.50_2026.grib2.gz")).toBeNull();
  });
});

describe("mrmsLatestAvailable (directory listing)", () => {
  it("picks the newest file scraped from an Apache-style index", async () => {
    const older = mrmsFileName(new Date(Date.UTC(2026, 5, 28, 12, 30, 0)));
    const newest = mrmsFileName(new Date(Date.UTC(2026, 5, 28, 12, 34, 0)));
    const mid = mrmsFileName(new Date(Date.UTC(2026, 5, 28, 12, 32, 0)));
    const html = `<html><body>
      <a href="${older}">${older}</a>
      <a href="${newest}">${newest}</a>
      <a href="${mid}">${mid}</a>
    </body></html>`;
    const latest = await mrmsLatestAvailable(async () => html);
    expect(latest?.name).toBe(newest);
    expect(latest?.validTime.toISOString()).toBe(new Date(Date.UTC(2026, 5, 28, 12, 34, 0)).toISOString());
    expect(latest?.url).toBe(`${mrmsDirUrl()}${newest}`);
  });

  it("returns null when nothing parseable is present", async () => {
    expect(await mrmsLatestAvailable(async () => "<html>empty</html>")).toBeNull();
  });

  it("returns null when the listing fetch throws", async () => {
    expect(await mrmsLatestAvailable(async () => { throw new Error("boom"); })).toBeNull();
  });
});

describe("mrmsLatestByPoll (HEAD fallback)", () => {
  it("snaps to the even minute and returns the newest existing slot", async () => {
    const now = new Date(Date.UTC(2026, 5, 28, 12, 35, 40)); // 12:35:40 → snaps to 12:34:00
    const hit = mrmsFileName(new Date(Date.UTC(2026, 5, 28, 12, 32, 0)));
    const seen: string[] = [];
    const latest = await mrmsLatestByPoll(now, async (url) => {
      seen.push(url);
      return url.includes(hit);
    });
    expect(latest?.validTime.toISOString()).toBe(new Date(Date.UTC(2026, 5, 28, 12, 32, 0)).toISOString());
    // first probe is the snapped even-minute slot (12:34:00)
    expect(seen[0]).toContain("20260628-123400");
  });

  it("returns null when no slot exists within the window", async () => {
    const now = new Date(Date.UTC(2026, 5, 28, 12, 0, 0));
    expect(await mrmsLatestByPoll(now, async () => false, 3)).toBeNull();
  });
});

describe("MRMS constants", () => {
  it("uses the reflectivity match token", () => {
    expect(MRMS_MATCH).toBe(":MergedReflectivityQCComposite:");
  });

  it("descriptor grid is 3500×1750 @ 0.02° over the CONUS bbox", () => {
    expect(MRMS_TARGET_GRID).toEqual({ width: 3500, height: 1750, res: 0.02 });
    expect(MRMS_TARGET_BOUNDS).toEqual([-130, 20, -60, 55]);
    // bbox span / resolution must equal the grid dims.
    const [w, s, e, n] = MRMS_TARGET_BOUNDS;
    expect(Math.round((e - w) / MRMS_TARGET_GRID.res)).toBe(MRMS_TARGET_GRID.width);
    expect(Math.round((n - s) / MRMS_TARGET_GRID.res)).toBe(MRMS_TARGET_GRID.height);
  });

  it("new_grid spec matches the descriptor grid", () => {
    expect(MRMS_NEWGRID).toBe("latlon -130:3500:0.02 20:1750:0.02");
  });
});
