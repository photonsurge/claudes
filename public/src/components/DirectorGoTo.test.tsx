import { fireEvent, render, screen } from "@testing-library/react";
import DirectorGoTo from "./DirectorGoTo";

it("cuts to a typed place", () => {
  const send = jest.fn();
  render(<DirectorGoTo send={send} />);
  fireEvent.change(screen.getByLabelText("Go to place"), { target: { value: " Japan " } });
  fireEvent.click(screen.getByRole("button", { name: "Go" }));
  expect(send).toHaveBeenCalledWith({ op: "cut", target: { type: "place", query: "Japan" } });
});

it("submits on Enter, and does nothing for an empty box", () => {
  const send = jest.fn();
  render(<DirectorGoTo send={send} />);
  expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
  fireEvent.submit(screen.getByLabelText("Go to place"));
  expect(send).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Go to place"), { target: { value: "Iberia" } });
  fireEvent.submit(screen.getByLabelText("Go to place"));
  expect(send).toHaveBeenCalledWith({ op: "cut", target: { type: "place", query: "Iberia" } });
});

it("airs the typed place's round-up, or the world round-up when empty", () => {
  const send = jest.fn();
  render(<DirectorGoTo send={send} />);
  fireEvent.click(screen.getByRole("button", { name: "Round-up" }));
  expect(send).toHaveBeenLastCalledWith({ op: "cut", target: { type: "roundup" } });
  fireEvent.change(screen.getByLabelText("Go to place"), { target: { value: "uk" } });
  fireEvent.click(screen.getByRole("button", { name: "Round-up" }));
  expect(send).toHaveBeenLastCalledWith({ op: "cut", target: { type: "roundup", place: "uk" } });
});

it("suggests countries and areas", () => {
  const { container } = render(<DirectorGoTo send={jest.fn()} />);
  const options = [...container.querySelectorAll("#director-goto-places option")].map((o) => o.getAttribute("value"));
  expect(options).toContain("Japan");
  expect(options).toContain("Iberia");
});
