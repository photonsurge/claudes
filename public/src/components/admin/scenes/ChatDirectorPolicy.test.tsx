import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_CHAT_COMMAND_SETTINGS } from "@photonsurge/shared/chat-policy";
import ChatDirectorPolicy from "./ChatDirectorPolicy";

const renderPolicy = (over: Record<string, unknown> = {}) => {
  const set = jest.fn();
  render(<ChatDirectorPolicy policy={{ ...DEFAULT_CHAT_COMMAND_SETTINGS, enabled: true, ...over }} set={set} />);
  return set;
};

it("is off by default, saying the operator's own commands are unaffected", () => {
  renderPolicy();
  expect(screen.getByRole("switch", { name: "Viewers may steer the director" })).not.toBeChecked();
  expect(screen.getByText(/the operator's own commands are unaffected/)).toBeInTheDocument();
});

it("switches steering on as a complete director block", () => {
  const set = renderPolicy();
  fireEvent.click(screen.getByRole("switch", { name: "Viewers may steer the director" }));
  expect(set).toHaveBeenCalledWith({ director: { ...DEFAULT_CHAT_COMMAND_SETTINGS.director, enabled: true } });
});

it("allows cities only when ticked", () => {
  const set = renderPolicy({ director: { ...DEFAULT_CHAT_COMMAND_SETTINGS.director, enabled: true } });
  const places = screen.getByRole("group", { name: "Places viewers may ask for" });
  expect(within(places).getByRole("checkbox", { name: "Cities" })).not.toBeChecked();
  fireEvent.click(within(places).getByRole("checkbox", { name: "Cities" }));
  expect(set.mock.calls[0][0].director.places).toEqual({ countries: true, regions: true, cities: true });
});

it("narrows the map looks viewers may pick", () => {
  const set = renderPolicy();
  const looks = screen.getByRole("group", { name: "Map looks viewers may pick" });
  const boxes = within(looks).getAllByRole("checkbox");
  fireEvent.click(boxes[0]);
  expect(set.mock.calls[0][0].mapType.allowed).toHaveLength(boxes.length - 1);
});

it("chooses when a viewer request airs", () => {
  const set = renderPolicy({ director: { ...DEFAULT_CHAT_COMMAND_SETTINGS.director, enabled: true } });
  fireEvent.click(screen.getByRole("radio", { name: "Straight away" }));
  expect(set.mock.calls[0][0].director.mode).toBe("immediate");
});
