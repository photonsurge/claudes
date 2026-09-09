import { render, screen } from "@testing-library/react";
import FittedColumn from "./FittedColumn";

jest.mock("./AutoScroll", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="scrolling-report">{children}</div>,
}));

it("keeps the alert outside the scrolling report and never scales the column", () => {
  const { container, rerender } = render(
    <FittedColumn top={100} right={20} maxHeight={600} header={<div>New alert</div>}>Report</FittedColumn>,
  );
  const column = container.firstChild as HTMLElement;
  expect(column).toHaveStyle({ maxHeight: "600px", overflow: "hidden", width: "400px" });
  expect(column.style.transform).toBe("");
  expect(screen.getByTestId("scrolling-report")).toHaveTextContent("Report");
  expect(screen.getByTestId("scrolling-report")).not.toContainElement(screen.getByText("New alert"));
  rerender(<FittedColumn top={100} right={20} maxHeight={400}>Another report</FittedColumn>);
  expect(column).toHaveStyle({ maxHeight: "400px", width: "400px" });
  expect(column.style.transform).toBe("");
});
