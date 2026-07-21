import { startRedisWatchdog } from "./redisWatchdog";

jest.mock("@photonsurge/shared/bull/bull", () => ({ redisOutageSince: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { redisOutageSince } = require("@photonsurge/shared/bull/bull") as { redisOutageSince: jest.Mock };

describe("startRedisWatchdog", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-21T09:00:00Z"));
    redisOutageSince.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  // Modern fake timers move Date.now() along with the timers, so this is enough
  // to age an outage — advancing the system clock as well would double-count it.
  const advance = (ms: number) => jest.advanceTimersByTime(ms);

  it("does nothing while redis is healthy", () => {
    redisOutageSince.mockReturnValue(null);
    const onFatal = jest.fn();
    const stop = startRedisWatchdog(onFatal);
    advance(60 * 60_000);
    expect(onFatal).not.toHaveBeenCalled();
    stop();
  });

  it("rides out a short outage — a redis container recreate must not kill the worker", () => {
    const start = Date.now();
    redisOutageSince.mockReturnValue(start);
    const onFatal = jest.fn();
    const stop = startRedisWatchdog(onFatal);

    advance(60_000);
    expect(onFatal).not.toHaveBeenCalled();

    redisOutageSince.mockReturnValue(null); // reconnected
    advance(60 * 60_000);
    expect(onFatal).not.toHaveBeenCalled();
    stop();
  });

  it("fires once redis has been gone past the threshold", () => {
    const start = Date.now();
    redisOutageSince.mockReturnValue(start);
    const onFatal = jest.fn();
    const stop = startRedisWatchdog(onFatal);

    advance(4 * 60_000);
    expect(onFatal).not.toHaveBeenCalled();

    advance(2 * 60_000);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0]).toBeGreaterThanOrEqual(5 * 60_000);

    // ...and only once, however long the outage drags on.
    advance(60 * 60_000);
    expect(onFatal).toHaveBeenCalledTimes(1);
    stop();
  });

  it("honours REDIS_OUTAGE_EXIT_MS=0 as a kill switch", () => {
    process.env.REDIS_OUTAGE_EXIT_MS = "0";
    redisOutageSince.mockReturnValue(Date.now());
    const onFatal = jest.fn();
    const stop = startRedisWatchdog(onFatal);
    advance(60 * 60_000);
    expect(onFatal).not.toHaveBeenCalled();
    stop();
    delete process.env.REDIS_OUTAGE_EXIT_MS;
  });

  it("stops checking once stopped", () => {
    redisOutageSince.mockReturnValue(Date.now());
    const onFatal = jest.fn();
    startRedisWatchdog(onFatal)();
    advance(60 * 60_000);
    expect(onFatal).not.toHaveBeenCalled();
  });
});
