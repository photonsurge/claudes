/**
 * The Formats section on /admin/shorts: lists formats with their script
 * counts, makes a new one by duplicating a channel, duplicates a row, and
 * shows the API's reason when a delete is refused. The default format's
 * Delete is disabled.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultShortFormat } from "@photonsurge/shared/short-format";
import FormatsSection from "./FormatsSection";
import type { ShortFormatItem } from "../../../../lib/shorts";

const item = (id: string, name: string, scriptCount = 0): ShortFormatItem => ({ ...defaultShortFormat(id, name), scriptCount });

const sources = () => ({
  channels: [
    { id: "default", name: "Main" },
    { id: "wind", name: "Atlantic Wind" },
  ],
  formats: [item("shorts", "Round-up", 3), item("short-europe", "Europe", 2)],
});

it("lists the formats with their script counts and editor links", async () => {
  render(<FormatsSection load={async () => sources()} />);
  expect(await screen.findByText("Europe")).toBeInTheDocument();
  expect(screen.getByText("Formats (2)")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Europe" })).toHaveAttribute("href", "/admin/shorts/formats/short-europe");
  expect(screen.getByText("default")).toBeInTheDocument();
});

it("disables Delete on the default format", async () => {
  render(<FormatsSection load={async () => sources()} />);
  await screen.findByText("Europe");
  const deletes = screen.getAllByRole("button", { name: "Delete" });
  expect(deletes[0]).toBeDisabled();
  expect(deletes[1]).toBeEnabled();
});

it("makes a new format from a channel and links to its editor", async () => {
  const create = jest.fn(async (name: string) => ({ ok: true as const, data: { format: defaultShortFormat("short-uk", name) } }));
  const onChanged = jest.fn();
  render(<FormatsSection load={async () => sources()} create={create} onChanged={onChanged} />);
  await screen.findByText("Europe");

  fireEvent.change(screen.getByLabelText("New format name"), { target: { value: "UK" } });
  fireEvent.click(screen.getByRole("button", { name: "New format" }));

  await waitFor(() => expect(create).toHaveBeenCalledWith("UK", "default"));
  expect(await screen.findByText("Made “UK”.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open editor" })).toHaveAttribute("href", "/admin/shorts/formats/short-uk");
  expect(onChanged).toHaveBeenCalled();
});

it("duplicates a format under a new name", async () => {
  const create = jest.fn(async (name: string) => ({ ok: true as const, data: { format: defaultShortFormat("short-x", name) } }));
  render(<FormatsSection load={async () => sources()} create={create} prompt={() => "Europe late"} />);
  await screen.findByText("Europe");
  fireEvent.click(screen.getAllByRole("button", { name: "Duplicate" })[1]);
  await waitFor(() => expect(create).toHaveBeenCalledWith("Europe late", "short-europe"));
});

it("shows the API's refusal with the script count", async () => {
  const remove = jest.fn(async () => ({ ok: false as const, error: "2 scripts use this format — delete them first" }));
  render(<FormatsSection load={async () => sources()} remove={remove} confirm={() => true} />);
  await screen.findByText("Europe");
  fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);
  expect(await screen.findByText(/Couldn't delete “Europe”: 2 scripts use this format — delete them first/)).toBeInTheDocument();
  expect(remove).toHaveBeenCalledWith("short-europe");
});

it("doesn't delete without a confirm", async () => {
  const remove = jest.fn();
  render(<FormatsSection load={async () => sources()} remove={remove} confirm={() => false} />);
  await screen.findByText("Europe");
  fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);
  expect(remove).not.toHaveBeenCalled();
});
