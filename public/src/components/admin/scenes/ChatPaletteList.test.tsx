import { fireEvent, render, screen } from "@testing-library/react";
import { BUILT_IN_PALETTES } from "@photonsurge/shared/chat-policy";
import ChatPaletteList from "./ChatPaletteList";

it("offers the built-ins until the channel customises the list", () => {
  const onChange = jest.fn();
  render(<ChatPaletteList palettes={[]} onChange={onChange} />);
  expect(screen.getByText(/built-in palettes: command, aurora, storm/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Customise the list" }));
  expect(onChange).toHaveBeenCalledWith(BUILT_IN_PALETTES.map((p) => ({ ...p })));
});

it("renames a palette, re-deriving its chat id", () => {
  const onChange = jest.fn();
  render(<ChatPaletteList palettes={[{ id: "a", label: "A", broadcastTheme: "storm" }]} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Night Mode!" } });
  expect(onChange).toHaveBeenCalledWith([{ id: "night-mode", label: "Night Mode!", broadcastTheme: "storm" }]);
});

it("adds and removes palettes", () => {
  const onChange = jest.fn();
  render(<ChatPaletteList palettes={[{ id: "a", label: "A", broadcastTheme: "storm" }]} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a palette" }));
  expect(onChange).toHaveBeenLastCalledWith([
    { id: "a", label: "A", broadcastTheme: "storm" },
    { id: "palette-2", label: "Palette 2", broadcastTheme: "command" },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Remove palette A" }));
  expect(onChange).toHaveBeenLastCalledWith([]);
});
