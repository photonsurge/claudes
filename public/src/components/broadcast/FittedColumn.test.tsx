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
