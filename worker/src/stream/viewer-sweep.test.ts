jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));

import { emptyViewerState, grantRequest, type ViewerState } from "@photonsurge/shared/viewer";
import { sweepViewers } from "./viewer-sweep";

const T = 1_000_000;
const withPick = (sceneId: string, holdMs: number): ViewerState =>
  grantRequest(
    emptyViewerState(sceneId),
    { slot: "audioMode", value: "deep", label: "Deep", by: { author: "a", platform: "sim" }, requestedAt: T, holdMs },
    10,
    T,
  ).state;

it("saves and emits only the scenes whose picks changed", async () => {
  const states = [withPick("a", 1_000), withPick("b", 60_000)];
  const save = jest.fn(async () => undefined);
  const emit = jest.fn();
  const changed = await sweepViewers({ viewerState: { withPicks: async () => states, save } } as never, T + 5_000, emit);
  expect(changed).toEqual(["a"]);
  expect(save).toHaveBeenCalledTimes(1);
  expect(emit.mock.calls[0][0]).toMatchObject({ sceneId: "a", active: {} });
});
