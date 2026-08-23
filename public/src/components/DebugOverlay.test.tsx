import { render, screen, fireEvent } from "@testing-library/react";
import DebugOverlay, { prepare } from "./DebugOverlay";

const ctrlD = () => fireEvent.keyDown(window, { key: "d", ctrlKey: true });

describe("DebugOverlay", () => {
  it("is hidden until Ctrl+D, then shows sections and their JSON", () => {
    render(<DebugOverlay data={{ control: { activeVariable: "temp" } }} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    ctrlD();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/control/i)).toBeInTheDocument();
    expect(screen.getByText('"activeVariable"' + ":")).toBeInTheDocument();
    expect(screen.getByText('"temp"')).toBeInTheDocument();
  });

  it("toggles closed on a second Ctrl+D and closes on Escape", () => {
    render(<DebugOverlay data={{ a: 1 }} />);
    ctrlD();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    ctrlD();
    expect(screen.queryByRole("dialog")).toBeNull();

    ctrlD();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("preventDefaults Ctrl+D (no browser bookmark dialog) but not plain keys", () => {
    render(<DebugOverlay data={{}} />);
    // fireEvent returns false when preventDefault was called.
    expect(ctrlD()).toBe(false);
    expect(fireEvent.keyDown(window, { key: "d" })).toBe(true);
  });

  it("ignores plain 'd' and Ctrl+Shift+D", () => {
    render(<DebugOverlay data={{ a: 1 }} />);
    fireEvent.keyDown(window, { key: "d" });
    fireEvent.keyDown(window, { key: "d", ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("collapses a section when its heading is clicked", () => {
    render(<DebugOverlay data={{ stuff: { hello: "world" } }} />);
    ctrlD();
    expect(screen.getByText('"world"')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /stuff/i }));
    expect(screen.queryByText('"world"')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /stuff/i }));
    expect(screen.getByText('"world"')).toBeInTheDocument();
  });

  it("copies the full prepared JSON to the clipboard", () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DebugOverlay data={{ a: 1 }} />);
    ctrlD();

    fireEvent.click(screen.getByRole("button", { name: /copy json/i }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ a: 1 }, null, 2));
  });
});

describe("prepare", () => {
  it("caps long arrays with a remainder marker", () => {
    const out = prepare(Array.from({ length: 25 }, (_, i) => i)) as unknown[];
    expect(out).toHaveLength(11);
    expect(out[10]).toBe("… +15 more");
  });

  it("truncates long strings and reports their length", () => {
    const out = prepare("x".repeat(500)) as string;
    expect(out.endsWith("… (500 chars)")).toBe(true);
  });

  it("cuts cycles instead of recursing forever", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(prepare(a)).toEqual({ self: "[circular]" });
  });

  it("bottoms out at the depth cap", () => {
    let v: unknown = "leaf";
    for (let i = 0; i < 12; i++) v = { v };
    const json = JSON.stringify(prepare(v));
    expect(json).toContain("{…deep}");
  });

  it("keeps JSON-safe scalars and converts the awkward ones", () => {
    expect(prepare(42)).toBe(42);
    expect(prepare(true)).toBe(true);
    expect(prepare(undefined)).toBeNull();
    expect(prepare(NaN)).toBe("NaN");
    expect(prepare(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
    expect(prepare(() => 1)).toBe("[fn]");
  });
});
