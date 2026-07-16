import { closeEndedAlertEvents } from "./close";

/**
 * Promotion derives ENDED from `alert.active === false`, but only ever runs for
 * alerts in a freshly parsed feed — and a lapsing alert never arrives that way.
 * expire()/deactivateMissing() flip `active` in a bulk updateMany and nothing
 * tells the event, so it stayed ACTIVE forever while its schedule polled a
 * finished warning every 5 minutes: 3,858 schedules, ~70% of them for events that
 * were over, all answering `changed: false`.
 */
const mkDb = (opts: {
  events: any[];
  alerts: any[];
  over?: any[];
}) => {
  const closeMany = jest.fn(async (rows: any[]) => rows.length) as jest.Mock;
  const removeForEvents = jest.fn(async (ids: string[]) => ids.length) as jest.Mock;
  const db = {
    watchedEvents: {
      list: async ({ status }: any) => opts.events.filter((e) => e.status === status),
      closeMany,
      model: {
        find: (q: any) => ({
          lean: () => ({
            exec: async () =>
              opts.over ?? opts.events.filter((e) => q.status?.$in?.includes(e.status)).map((e) => ({ id: e.id })),
          }),
        }),
      },
    },
    alerts: {
      model: {
        find: (q: any) => ({
          lean: () => ({
            exec: async () =>
              opts.alerts.filter((a) => a.source === q.source && q.identifier.$in.includes(a.identifier)),
          }),
        }),
      },
    },
    eventWatch: { removeForEvents },
  } as any;
  return { db, closeMany, removeForEvents };
};

const evt = (id: string, source: string, sid: string, status = "ACTIVE") => ({
  id,
  status,
  primarySource: source,
  primarySourceId: sid,
});

describe("closeEndedAlertEvents", () => {
  it("closes an event whose alert has lapsed, and dates it from the alert", async () => {
    const { db, closeMany } = mkDb({
      events: [evt("e1", "wmo", "cap-1")],
      alerts: [{ source: "wmo", identifier: "cap-1", active: false, expiresAt: "2026-07-14T00:00:00Z" }],
    });

    const r = await closeEndedAlertEvents(db);

    expect(r.closed).toBe(1);
    expect(closeMany.mock.calls[0][0]).toEqual([{ id: "e1", endedAt: "2026-07-14T00:00:00Z" }]);
  });

  it("leaves an event whose alert is still active", async () => {
    const { db, closeMany } = mkDb({
      events: [evt("e1", "wmo", "cap-1")],
      alerts: [{ source: "wmo", identifier: "cap-1", active: true }],
    });

    const r = await closeEndedAlertEvents(db);

    expect(r.closed).toBe(0);
    expect(closeMany).not.toHaveBeenCalled();
  });

  it("never closes a volcano — its primary source is not an alert at all", async () => {
    // The reason this matches on the alert EXISTING rather than on
    // `type !== "VOLCANO"`: a type check works today and breaks silently the
    // first time a non-alert source is added.
    const { db, closeMany } = mkDb({
      events: [evt("v1", "gvp", "342090")],
      alerts: [],
    });

    const r = await closeEndedAlertEvents(db);

    expect(r.candidates).toBe(1);
    expect(r.closed).toBe(0);
    expect(closeMany).not.toHaveBeenCalled();
  });

  it("retires the schedules of everything that's over, not just what it closed", async () => {
    // The 1,348: events that ENDED long ago and kept their schedule anyway.
    const { db, removeForEvents } = mkDb({
      events: [evt("e1", "wmo", "cap-1")],
      alerts: [{ source: "wmo", identifier: "cap-1", active: false }],
      over: [{ id: "e1" }, { id: "old-1" }, { id: "old-2" }],
    });

    const r = await closeEndedAlertEvents(db);

    expect(removeForEvents).toHaveBeenCalledWith(["e1", "old-1", "old-2"]);
    expect(r.schedulesRetired).toBe(3);
  });

  it("batches the alert lookups by source rather than one per event", async () => {
    const finds: any[] = [];
    const { db } = mkDb({
      events: [evt("e1", "wmo", "a"), evt("e2", "wmo", "b"), evt("e3", "meteoalarm", "c")],
      alerts: [],
    });
    const orig = db.alerts.model.find;
    db.alerts.model.find = (q: any) => {
      finds.push(q);
      return orig(q);
    };

    await closeEndedAlertEvents(db);

    // Two sources => two queries, each covered by the (source, identifier) index.
    expect(finds).toHaveLength(2);
    expect(finds[0].identifier.$in).toEqual(["a", "b"]);
    expect(finds[1].identifier.$in).toEqual(["c"]);
  });

  it("does nothing when there is nothing to close (so it can run every tick)", async () => {
    const { db, closeMany, removeForEvents } = mkDb({ events: [], alerts: [], over: [] });

    const r = await closeEndedAlertEvents(db);

    expect(r).toEqual({ candidates: 0, closed: 0, schedulesRetired: 0 });
    expect(closeMany).not.toHaveBeenCalled();
    expect(removeForEvents).not.toHaveBeenCalled();
  });
});
