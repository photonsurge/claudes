import { GLOBE_LOG_MAX, godsLog } from "./globe-log";

type LogWindow = Window & { __godsLog?: string[] };
const ring = () => (window as LogWindow).__godsLog;

describe("godsLog", () => {
  beforeEach(() => {
    delete (window as LogWindow).__godsLog;
    jest.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("prints the line and keeps it on window with a timestamp", () => {
    godsLog("[globe] hello");
    expect(console.info).toHaveBeenCalledWith("[globe] hello");
    expect(ring()).toHaveLength(1);
    expect(ring()?.[0]).toMatch(/^\d{2}:\d{2}:\d{2} \[globe\] hello$/);
  });

  it("keeps the newest lines once the ring is full", () => {
    for (let i = 0; i < GLOBE_LOG_MAX + 25; i++) godsLog(`[globe] ${i}`);
    const log = ring() as string[];
    expect(log).toHaveLength(GLOBE_LOG_MAX);
    expect(log[log.length - 1]).toContain(`[globe] ${GLOBE_LOG_MAX + 24}`);
    expect(log[0]).toContain(`[globe] 25`);
  });
});
