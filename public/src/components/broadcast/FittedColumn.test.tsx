import { render, screen } from "@testing-library/react";
import FittedColumn from "./FittedColumn";

it("stacks the alert above the report and never scales or auto-scrolls the column", () => {
  const { container, rerender } = render(
    <FittedColumn top={100} right={20} maxHeight={600} header={<div>New alert</div>}>Report</FittedColumn>,
  );
  const column = container.firstChild as HTMLElement;
  expect(column).toHaveStyle({ maxHeight: "600px", overflow: "hidden", width: "400px" });
  expect(column.style.transform).toBe("");
  expect(screen.getByText("New alert")).toBeInTheDocument();
  expect(screen.getByText("Report")).toBeInTheDocument();
  // No scroll region: nothing in the column carries the AutoScroll marquee's
  // compositor hint, so the deck sits still and simply clips at the ticker.
  expect(container.querySelector('[style*="will-change"]')).toBeNull();
  rerender(<FittedColumn top={100} right={20} maxHeight={400}>Another report</FittedColumn>);
  expect(column).toHaveStyle({ maxHeight: "400px", width: "400px" });
  expect(column.style.transform).toBe("");
  expect(screen.getByText("Another report")).toBeInTheDocument();
});
