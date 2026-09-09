import { act, render } from "@testing-library/react";
import FittedColumn from "./FittedColumn";

it("fits the column again when report slides change height", () => {
  let height = 1000;
  let resize = () => {};
  const original = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  const measure = jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => height);
  try {
    const { container, rerender, unmount } = render(<FittedColumn top={100} right={20} maxHeight={600}>Report</FittedColumn>);
    expect(container.firstChild).toHaveStyle({ transform: "scale(0.6)" });
    height = 500;
    act(() => resize());
    expect(container.firstChild).toHaveStyle({ transform: "scale(1.16)" });
    rerender(<FittedColumn top={100} right={20} maxHeight={400}>Report</FittedColumn>);
    expect(container.firstChild).toHaveStyle({ transform: "scale(0.8)" });
    unmount();
  } finally {
    measure.mockRestore();
    global.ResizeObserver = original;
  }
});

it("re-fits from the size the observer already measured, without reading layout back", () => {
  let resize: (entries: unknown[]) => void = () => {};
  const original = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(callback: (entries: unknown[]) => void) { resize = callback; }
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  const measure = jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(1000);
  try {
    const { container, unmount } = render(<FittedColumn top={0} right={0} maxHeight={600}>Deck</FittedColumn>);
    expect(container.firstChild).toHaveStyle({ transform: "scale(0.6)" });
    const reads = measure.mock.calls.length;

    // The alert card below shrinks to fit a warning that carries no advice text.
    act(() => resize([{ borderBoxSize: [{ blockSize: 500, inlineSize: 400 }] }]));
    expect(container.firstChild).toHaveStyle({ transform: "scale(1.16)" });
    // Forcing a reflow inside the callback is the stall we are avoiding.
    expect(measure.mock.calls.length).toBe(reads);
    unmount();
  } finally {
    measure.mockRestore();
    global.ResizeObserver = original;
  }
});

it("ignores sub-pixel noise that cannot move the scale", () => {
  let resize: (entries: unknown[]) => void = () => {};
  const original = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(callback: (entries: unknown[]) => void) { resize = callback; }
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  const measure = jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(500);
  try {
    const { container, unmount } = render(<FittedColumn top={0} right={0} maxHeight={400}>Deck</FittedColumn>);
    expect(container.firstChild).toHaveStyle({ transform: "scale(0.8)" });
    act(() => resize([{ borderBoxSize: [{ blockSize: 500.4, inlineSize: 400 }] }]));
    expect(container.firstChild).toHaveStyle({ transform: "scale(0.8)" }); // unchanged
    act(() => resize([{ borderBoxSize: [{ blockSize: 800, inlineSize: 400 }] }]));
    expect(container.firstChild).toHaveStyle({ transform: "scale(0.5)" }); // a real change still lands
    unmount();
  } finally {
    measure.mockRestore();
    global.ResizeObserver = original;
  }
});
