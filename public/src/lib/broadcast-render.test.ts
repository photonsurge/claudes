// Unit tests for the OBS render-mode detection + GPU renderer telemetry.
import {
  detectObsRender,
  isSoftwareRenderer,
  setRendererInfo,
  getRendererInfo,
} from "./broadcast-render";

describe("detectObsRender", () => {
  it("is false with no window / a plain browser window", () => {
    expect(detectObsRender(undefined)).toBe(false);
    expect(detectObsRender(null)).toBe(false);
    expect(detectObsRender({ location: { search: "" } })).toBe(false);
    expect(detectObsRender({ location: { search: "?token=abc" } })).toBe(false);
  });

  it("detects the obsstudio object CEF injects", () => {
    expect(detectObsRender({ obsstudio: { pluginVersion: "5.0" } })).toBe(true);
  });

  it("honours the ?obs=1 test override, but not lookalikes", () => {
    expect(detectObsRender({ location: { search: "?obs=1" } })).toBe(true);
    expect(detectObsRender({ location: { search: "?token=abc&obs=1" } })).toBe(true);
    expect(detectObsRender({ location: { search: "?obs=10" } })).toBe(false);
    expect(detectObsRender({ location: { search: "?jobs=1" } })).toBe(false);
  });
});

describe("isSoftwareRenderer", () => {
  it("flags the CPU rasterisers", () => {
    expect(isSoftwareRenderer("Google SwiftShader")).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("Microsoft Basic Render Driver")).toBe(true);
  });

  it("passes real GPUs", () => {
    expect(isSoftwareRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11)")).toBe(false);
    expect(isSoftwareRenderer("NVIDIA GeForce RTX 3060/PCIe/SSE2")).toBe(false);
    expect(isSoftwareRenderer("Mesa Intel(R) UHD Graphics 630")).toBe(false);
  });
});

describe("renderer info store", () => {
  it("stores the last reported device with a software verdict", () => {
    setRendererInfo("Mesa", "llvmpipe (LLVM 15.0.7, 256 bits)");
    expect(getRendererInfo()).toEqual({
      vendor: "Mesa",
      renderer: "llvmpipe (LLVM 15.0.7, 256 bits)",
      software: true,
    });
    setRendererInfo("NVIDIA Corporation", "NVIDIA GeForce RTX 3060/PCIe/SSE2");
    expect(getRendererInfo()?.software).toBe(false);
  });
});
