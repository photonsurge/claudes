import { fireEvent, render, screen } from "@testing-library/react";
import StreamTitleField from "./StreamTitleField";

it("previews UK time and explains month/minute codes and restarts", () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-08T13:05:00Z"));
  render(<StreamTitleField value="Weather %d/%m/%Y %H:%M" onChange={jest.fn()} recurring />);
  expect(screen.getByText("Weather 08/09/2026 14:05")).toBeInTheDocument();
  expect(screen.getByText(/Every restart gets a fresh date/)).toBeInTheDocument();
  expect(screen.getByText(/%m is month, %M is minutes/)).toBeInTheDocument();
  jest.useRealTimers();
});

it("inserts the chosen code into the template", () => {
  const onChange = jest.fn();
  render(<StreamTitleField value="Weather " onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "%Y · Year (2026)" }));
  expect(onChange).toHaveBeenCalledWith("Weather %Y");
});
