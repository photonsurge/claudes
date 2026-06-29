import sharp from "sharp";

// Mock the IO boundaries so no network / no wgrib2 CLI is touched.
jest.mock("./download", () => ({
  downloadToTemp: jest.fn(),
}));
jest.mock("../grib/wgrib2", () => ({
  extractField: jest.fn(),
}));

import { bakeVariableStep } from "./bakeVariableStep";
import { downloadToTemp } from "./download";
import { extractField } from "../grib/wgrib2";
import { GFS_GRID, WIND_IMAGE_UNSCALE } from "../grib/bake";
import { VARIABLE_REGISTRY } from "@photonsurge/shared/variables";

const mockDownload = downloadToTemp as jest.Mock;
const mockExtract = extractField as jest.Mock;

const grid = (fill: number) => ({
  width: 4,
  height: 2,
  values: new Float32Array(8).fill(fill),
});

// Rain itself is now instantaneous PRATE, so synthesise an accumulated variable
// (APCP-style) to exercise bakeVariableStep's previous-grid de-accumulation path.
const accumulatedVar = {
  ...VARIABLE_REGISTRY.rain,
  gfs: { vars: ["APCP"], levels: ["surface"], accumulated: true },
};

describe("bakeVariableStep", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDownload.mockResolvedValue("/tmp/gfs-xyz/file.grib2");
  });

  it("builds the NOMADS url from variable meta and downloads to a fhr-named temp file", async () => {
    mockExtract.mockResolvedValue(grid(290));
    await bakeVariableStep(VARIABLE_REGISTRY.temp, "20260628", "06", 12, undefined, 3);
    const [url, name] = mockDownload.mock.calls[0];
    expect(url).toContain("file=gfs.t06z.pgrb2.0p25.f012");
    expect(url).toContain("var_TMP=on");
    expect(url).toContain("lev_2_m_above_ground=on");
    expect(name).toBe("temp.f012.grib2");
  });

  it("extracts two fields and bakes a uv texture for wind", async () => {
    mockExtract.mockResolvedValueOnce(grid(5)).mockResolvedValueOnce(grid(-5));
    const res = await bakeVariableStep(VARIABLE_REGISTRY.wind, "20260628", "00", 0, undefined, 3);
    expect(res.encoding).toBe("uv");
    expect(res.imageUnscale).toEqual(WIND_IMAGE_UNSCALE);
    expect(res.gribPath).toBe("/tmp/gfs-xyz/file.grib2");
    // wind extracts UGRD then VGRD against the same grib file
    expect(mockExtract).toHaveBeenCalledTimes(2);
    expect(mockExtract.mock.calls[0][0]).toMatchObject({ match: ":UGRD:", ...GFS_GRID });
    expect(mockExtract.mock.calls[1][0]).toMatchObject({ match: ":VGRD:", ...GFS_GRID });
    const meta = await sharp(res.buffer).metadata();
    expect(meta.format).toBe("png");
  });

  it("bakes a scalar texture for temp (single extract)", async () => {
    mockExtract.mockResolvedValue(grid(300));
    const res = await bakeVariableStep(VARIABLE_REGISTRY.temp, "20260628", "00", 3, undefined, 3);
    expect(res.encoding).toBe("scalar");
    expect(mockExtract).toHaveBeenCalledTimes(1);
    expect(mockExtract.mock.calls[0][0]).toMatchObject({ match: ":TMP:" });
  });

  it("does NOT read a previous grid for an accumulated var at f000 (no prevAccumPath)", async () => {
    mockExtract.mockResolvedValue(grid(0));
    await bakeVariableStep(accumulatedVar, "20260628", "00", 0, undefined, 3);
    // only the current field is extracted (no prev)
    expect(mockExtract).toHaveBeenCalledTimes(1);
    expect(mockExtract.mock.calls[0][0]).toMatchObject({ match: ":APCP:" });
  });

  it("reads the previous accumulation grid when prevAccumPath is supplied", async () => {
    mockExtract.mockResolvedValueOnce(grid(9)).mockResolvedValueOnce(grid(3)); // curr, prev
    const res = await bakeVariableStep(
      accumulatedVar,
      "20260628",
      "00",
      3,
      "/tmp/prev.grib2",
      3,
    );
    expect(res.encoding).toBe("scalar");
    expect(mockExtract).toHaveBeenCalledTimes(2);
    // current uses the freshly downloaded path, prev uses prevAccumPath
    expect(mockExtract.mock.calls[0][0]).toMatchObject({ gribPath: "/tmp/gfs-xyz/file.grib2" });
    expect(mockExtract.mock.calls[1][0]).toMatchObject({ gribPath: "/tmp/prev.grib2" });
  });

  it("propagates a short-output / missing-field error so the caller can skip the variable", async () => {
    mockExtract.mockRejectedValue(new Error("wgrib2: short output (0 < 16 bytes)"));
    await expect(
      bakeVariableStep(VARIABLE_REGISTRY.rain, "20260628", "00", 0, undefined, 3),
    ).rejects.toThrow(/short output/);
  });
});
