import { canRelayControlState, canRelayWorkerEvent, resolveWorkerEventName } from "./relay";
import { registerHandlers } from "./index";
import { PUBLIC_ROOM } from "../rooms";
import { CONTROL_STATE } from "@photonsurge/shared/control";

describe("relay policy", () => {
  it("worker/service may relay worker events; users may not", () => {
    expect(canRelayWorkerEvent("worker")).toBe(true);
    expect(canRelayWorkerEvent("service")).toBe(true);
    expect(canRelayWorkerEvent("user")).toBe(false);
  });
  it("only users may relay control state", () => {
    expect(canRelayControlState("user")).toBe(true);
    expect(canRelayControlState("worker")).toBe(false);
    expect(canRelayControlState("service")).toBe(false);
  });
  it("resolves the worker event name from payload.type", () => {
    expect(resolveWorkerEventName({ type: "weather:run" })).toBe("weather:run");
    expect(resolveWorkerEventName({})).toBe("worker:event");
  });
});

// Minimal io/socket doubles so we can exercise registerHandlers without a server.
function makeHarness(actorType: "user" | "worker" | "service") {
  const handlers: Record<string, (...a: any[]) => void> = {};
  const emit = jest.fn();
  const io = { to: jest.fn(() => ({ emit })) } as any;
  const socket = {
    id: "sock1",
    data: { context: { actorType, actorId: `${actorType}-1`, ip: "127.0.0.1" } },
    on: (event: string, cb: (...a: any[]) => void) => {
      handlers[event] = cb;
    },
  } as any;
  registerHandlers(io, socket);
  return { io, emit, handlers };
}

describe("control:state relay wiring", () => {
  it("relays an operator's control state to the public room", () => {
    const { io, emit, handlers } = makeHarness("user");
    const payload = { fhr: 6, basemap: "satellite" };
    handlers[CONTROL_STATE](payload);
    expect(io.to).toHaveBeenCalledWith(PUBLIC_ROOM);
    expect(emit).toHaveBeenCalledWith(CONTROL_STATE, payload);
  });

  it("ignores control:state from a worker actor", () => {
    const { io, emit, handlers } = makeHarness("worker");
    handlers[CONTROL_STATE]({ fhr: 1 });
    expect(io.to).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("relays weather:run worker events under their type", () => {
    const { io, emit, handlers } = makeHarness("worker");
    const payload = { type: "weather:run", data: { run: "2026-06-28T12:00:00Z" } };
    handlers["worker:event"](payload);
    expect(io.to).toHaveBeenCalledWith(PUBLIC_ROOM);
    expect(emit).toHaveBeenCalledWith("weather:run", payload);
  });
});
