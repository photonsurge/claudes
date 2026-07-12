import { formatLogLine } from "./jobLog";

describe("formatLogLine", () => {
  it("formats console args the way console would", () => {
    expect(formatLogLine(["worker", "job:start", 42])).toBe("worker job:start 42");
  });

  it("inspects objects like console.log", () => {
    expect(formatLogLine(["state", { a: 1 }])).toBe("state { a: 1 }");
  });

  it("truncates very long lines with an ellipsis", () => {
    const out = formatLogLine(["x".repeat(5000)]);
    expect(out.length).toBe(2001); // 2000 chars + "…"
    expect(out.endsWith("…")).toBe(true);
  });

  it("handles no args", () => {
    expect(formatLogLine([])).toBe("");
  });
});
