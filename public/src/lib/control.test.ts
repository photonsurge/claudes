import {
  DEFAULT_CONTROL_STATE,
  mergeControlState,
  CONTROL_STATE,
} from "@photonsurge/shared/control";
import { emitControlState, fetchBroadcastState } from "./control";

describe("mergeControlState round-trip from socket payloads", () => {
  it("applies a partial patch and keeps untouched fields", () => {
    const patch = { activeVariable: "rain", fhr: 6 };
    const merged = mergeControlState(DEFAULT_CONTROL_STATE, patch);
    expect(merged.activeVariable).toBe("rain");
    expect(merged.fhr).toBe(6);
    expect(merged.basemap).toBe(DEFAULT_CONTROL_STATE.basemap);
    expect(merged.units).toEqual(DEFAULT_CONTROL_STATE.units);
  });

  it("survives a serialise→deserialise round-trip (socket wire)", () => {
    const next = mergeControlState(DEFAULT_CONTROL_STATE, {
      activeVariable: "temp",
      showWind: false,
      camera: { center: [10, 20], zoom: 3 },
      units: { wind: "m/s", temp: "F" },
    });
    const wire = JSON.parse(JSON.stringify(next));
    const reapplied = mergeControlState(DEFAULT_CONTROL_STATE, wire);
    expect(reapplied).toEqual(next);
  });

  it("allows clearing the active variable to null", () => {
    const merged = mergeControlState({ ...DEFAULT_CONTROL_STATE, activeVariable: "temp" }, {
      activeVariable: null,
    });
    expect(merged.activeVariable).toBeNull();
  });
});

describe("emitControlState", () => {
  it("emits CONTROL_STATE over the socket and calls persist", () => {
    const emit = jest.fn();
    const persist = jest.fn();
    const socket = { emit } as unknown as Parameters<typeof emitControlState>[0];
    emitControlState(socket, DEFAULT_CONTROL_STATE, persist);
    expect(emit).toHaveBeenCalledWith(CONTROL_STATE, DEFAULT_CONTROL_STATE);
    expect(persist).toHaveBeenCalledWith(DEFAULT_CONTROL_STATE);
  });

  it("still persists when there is no socket", () => {
    const persist = jest.fn();
    emitControlState(null, DEFAULT_CONTROL_STATE, persist);
    expect(persist).toHaveBeenCalled();
  });
});

describe("fetchBroadcastState", () => {
  afterEach(() => jest.restoreAllMocks());

  it("flags a 401 as tokenError instead of silently returning defaults", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
    const { state, tokenError } = await fetchBroadcastState("bad-token");
    expect(tokenError).toBe(true);
    expect(state).toEqual(DEFAULT_CONTROL_STATE);
    expect(global.fetch).toHaveBeenCalledWith("/api/broadcast/state?token=bad-token", { cache: "no-store" });
  });

  it("returns the parsed state with tokenError false on success", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ activeVariable: "wind" }),
    })) as unknown as typeof fetch;
    const { state, tokenError } = await fetchBroadcastState();
    expect(tokenError).toBe(false);
    expect(state.activeVariable).toBe("wind");
  });
});
