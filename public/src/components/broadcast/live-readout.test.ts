import { createReadoutStore } from "./live-readout";

describe("createReadoutStore", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("hands back the initial value before anything is published", () => {
    const store = createReadoutStore({ lat: 1, lon: 2 });
    expect(store.get()).toEqual({ lat: 1, lon: 2 });
    store.dispose();
  });

  it("notifies immediately for the first move, then coalesces the burst", () => {
    const store = createReadoutStore(null, 250);
    const listener = jest.fn();
    store.subscribe(listener);

    store.set({ lat: 0, lon: 0 });
    expect(listener).toHaveBeenCalledTimes(1);

    // A locator tick every 80 ms: three more moves inside the window notify once.
    for (const lon of [1, 2, 3]) {
      jest.advanceTimersByTime(80);
      store.set({ lat: 0, lon });
    }
    expect(listener).toHaveBeenCalledTimes(1);
    // …and the trailing notify carries the LATEST position, not the first.
    jest.advanceTimersByTime(250);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get()).toEqual({ lat: 0, lon: 3 });
    store.dispose();
  });

  it("drops moves too small to change the printed readout", () => {
    const store = createReadoutStore({ lat: 10, lon: 20 }, 250);
    const listener = jest.fn();
    store.subscribe(listener);

    store.set({ lat: 10.00004, lon: 20.0001 }); // under 3 dp
    jest.advanceTimersByTime(1000);
    expect(listener).not.toHaveBeenCalled();

    store.set({ lat: 10.002, lon: 20 });
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it("notifies when only the place changes", () => {
    const store = createReadoutStore({ lat: 10, lon: 20, country: null }, 250);
    const listener = jest.fn();
    store.subscribe(listener);

    store.set({ lat: 10, lon: 20, country: "France", continent: "Europe" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()?.country).toBe("France");
    store.dispose();
  });

  it("keeps snapshot identity stable so a subscriber never re-renders for nothing", () => {
    const store = createReadoutStore({ lat: 1, lon: 1 }, 250);
    const first = store.get();
    store.set({ lat: 1, lon: 1 });
    expect(store.get()).toBe(first);
    store.dispose();
  });

  it("stops listening and cancels the pending notify on dispose", () => {
    const store = createReadoutStore(null, 250);
    const listener = jest.fn();
    store.subscribe(listener);
    store.set({ lat: 0, lon: 0 }); // leading notify
    store.set({ lat: 0, lon: 1 }); // queues the trailing one
    store.dispose();
    jest.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes cleanly", () => {
    const store = createReadoutStore(null, 250);
    const listener = jest.fn();
    const off = store.subscribe(listener);
    off();
    store.set({ lat: 5, lon: 5 });
    expect(listener).not.toHaveBeenCalled();
    store.dispose();
  });
});
