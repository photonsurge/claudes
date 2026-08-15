// Unit tests for encoder → OBS endpoint resolution. Every failure mode must be
// ObsUnavailableError so the lifecycle lands on manual key handoff, not failure.

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

const encoders = new Map<string, any>();
const db = { getStreamEncoder: jest.fn(async (id: string) => encoders.get(id) ?? null) };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

jest.mock("@photonsurge/shared/utill/secretbox", () => ({
  decryptSecret: jest.fn((blob: string) => {
    if (blob === "v1.good") return "s3cret";
    throw new Error("bad blob");
  }),
}));

import { ObsUnavailableError } from "../obs/client";
import { endpointForEncoderId, endpointForRun } from "./encoders";

beforeEach(() => {
  encoders.clear();
  jest.clearAllMocks();
  delete process.env.OBS_WEBSOCKET_URL;
  delete process.env.OBS_WEBSOCKET_PASSWORD;
});

describe("endpointForEncoderId", () => {
  it("resolves the env encoder from OBS_WEBSOCKET_URL", async () => {
    process.env.OBS_WEBSOCKET_URL = "ws://127.0.0.1:4455";
    process.env.OBS_WEBSOCKET_PASSWORD = "pw";
    await expect(endpointForEncoderId("env")).resolves.toEqual({ url: "ws://127.0.0.1:4455", password: "pw" });
    // Unset / empty ids mean the env encoder too (legacy runs).
    await expect(endpointForEncoderId(undefined)).resolves.toMatchObject({ url: "ws://127.0.0.1:4455" });
  });

  it("throws ObsUnavailableError when the env encoder is not configured", async () => {
    await expect(endpointForEncoderId("env")).rejects.toBeInstanceOf(ObsUnavailableError);
  });

  it("resolves a registered encoder, decrypting its password", async () => {
    encoders.set("obs-2", { id: "obs-2", url: "ws://gpu:4456", passwordEnc: "v1.good", enabled: true });
    await expect(endpointForEncoderId("obs-2")).resolves.toEqual({ url: "ws://gpu:4456", password: "s3cret" });
  });

  it("throws ObsUnavailableError for missing, disabled, or undecryptable encoders", async () => {
    await expect(endpointForEncoderId("ghost")).rejects.toBeInstanceOf(ObsUnavailableError);

    encoders.set("off", { id: "off", url: "ws://x:1", enabled: false });
    await expect(endpointForEncoderId("off")).rejects.toBeInstanceOf(ObsUnavailableError);

    encoders.set("bad", { id: "bad", url: "ws://x:1", passwordEnc: "v1.corrupt", enabled: true });
    await expect(endpointForEncoderId("bad")).rejects.toBeInstanceOf(ObsUnavailableError);
  });

  it("omits the password for a password-less encoder", async () => {
    encoders.set("open", { id: "open", url: "ws://x:1", enabled: true });
    await expect(endpointForEncoderId("open")).resolves.toEqual({ url: "ws://x:1" });
  });
});

describe("endpointForRun", () => {
  it("maps a run's encoderId through the same resolution", async () => {
    encoders.set("obs-2", { id: "obs-2", url: "ws://gpu:4456", enabled: true });
    await expect(endpointForRun({ encoderId: "obs-2" })).resolves.toEqual({ url: "ws://gpu:4456" });
  });
});
