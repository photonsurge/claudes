import { render, screen } from "@testing-library/react";
import type { ViewerRequest } from "@photonsurge/shared/viewer";
import ViewerPickChip, { remainingLabel } from "./ViewerPickChip";
import { DEFAULT_THEME } from "./config";

const T = Date.UTC(2026, 9, 4, 12);
const pick = (over: Partial<ViewerRequest> = {}): ViewerRequest => ({
  slot: "audioMode",
  value: "deep",
  label: "Deep",
  by: { author: "ann", platform: "sim" },
  requestedAt: T,
  until: T + 300_000,
  holdMs: 300_000,
  ...over,
});

afterEach(() => jest.useRealTimers());

it("announces a fresh pick in full", () => {
  jest.useFakeTimers({ now: T + 1000 });
  render(<ViewerPickChip picks={[pick()]} theme={DEFAULT_THEME} />);
  expect(screen.getByLabelText("Viewer picks")).toHaveTextContent("VIEWER PICK · Music: Deep · @ann · 5 min");
});

it("shrinks to a countdown after the announcement", () => {
  jest.useFakeTimers({ now: T + 120_000 });
  render(<ViewerPickChip picks={[pick({ slot: "theme", label: "Storm" })]} theme={DEFAULT_THEME} />);
  expect(screen.getByLabelText("Viewer picks")).toHaveTextContent("VIEWER PICK · Storm · 3 min");
});

it("renders nothing without picks", () => {
  const { container } = render(<ViewerPickChip picks={[]} theme={DEFAULT_THEME} />);
  expect(container).toBeEmptyDOMElement();
});

it("formats what's left", () => {
  expect(remainingLabel(T + 45_000, T)).toBe("45s");
  expect(remainingLabel(T + 61_000, T)).toBe("2 min");
  expect(remainingLabel(T - 1, T)).toBe("0s");
});
