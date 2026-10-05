// Manual Provision / Refresh of an encoder (crossword plan §10): refused while a
// run shows another channel on it, since either would swap that run's picture.
jest.mock("../stream/announce", () => ({}));
jest.mock("../stream/chapters", () => ({}));
jest.mock("../stream/thumbnail", () => ({}));
jest.mock("../stream/lifecycle", () => ({}));
jest.mock("../stream/slots", () => ({}));
jest.mock("../obs/client", () => ({}));
jest.mock("../stream/script-run", () => ({}));
jest.mock("../stream/render-queue", () => ({}));
jest.mock("../stream/render-preflight", () => ({}));
jest.mock("../stream/script-shots", () => ({}));
let borrower: any = null;
jest.mock("../stream/encoders", () => ({
  borrowingRun: jest.fn(async () => borrower),
  endpointForEncoderId: jest.fn(),
  provisionEncoderScene: jest.fn(async () => ({ sceneId: "volcano", url: "u" })),
  refreshEncoderScene: jest.fn(async () => ({ sceneId: "volcano", inputName: "i" })),
}));

import type { Job } from "bullmq";
import { provisionEncoder, refreshEncoder } from "./run-lifecycle";
import { provisionEncoderScene, refreshEncoderScene } from "../stream/encoders";

const job = { data: { data: { encoderId: "gpu-1" } } } as unknown as Job;

beforeEach(() => {
  borrower = null;
  jest.clearAllMocks();
});

it("refuses Provision and Refresh while a run borrows the encoder, naming the run", async () => {
  borrower = { id: "run-7", sceneId: "daily" };
  const p = await provisionEncoder(job);
  expect(p).toMatchObject({ ok: false });
  expect((p as { error: string }).error).toMatch(/run run-7 is showing channel "daily"/);
  expect(await refreshEncoder(job)).toMatchObject({ ok: false });
  expect(provisionEncoderScene).not.toHaveBeenCalled();
  expect(refreshEncoderScene).not.toHaveBeenCalled();
});

it("provisions and refreshes as before otherwise", async () => {
  expect(await provisionEncoder(job)).toMatchObject({ ok: true, sceneId: "volcano" });
  expect(await refreshEncoder(job)).toMatchObject({ ok: true });
});
