/** HourStrip — 24 toggles, pressed state mirrors `hours`, click reports the hour. */
import { fireEvent, render, screen } from "@testing-library/react";
import HourStrip from "./HourStrip";

it("draws 24 toggles with the given hours pressed", () => {
  render(<HourStrip hours={[0, 13]} label="Daily" onToggle={jest.fn()} />);
  expect(screen.getAllByRole("button")).toHaveLength(24);
  expect(screen.getByRole("button", { name: "Daily 13:00" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Daily 14:00" })).toHaveAttribute("aria-pressed", "false");
});

it("reports the clicked hour", () => {
  const onToggle = jest.fn();
  render(<HourStrip hours={[]} label="Daily" onToggle={onToggle} />);
  fireEvent.click(screen.getByRole("button", { name: "Daily 07:00" }));
  expect(onToggle).toHaveBeenCalledWith(7);
});
