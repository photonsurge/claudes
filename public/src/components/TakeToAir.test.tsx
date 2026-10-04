jest.mock("../lib/director-commands", () => ({ sendCommand: jest.fn() }));

import { fireEvent, render, screen } from "@testing-library/react";
import type { Segment } from "@photonsurge/shared/director";
import { sendCommand } from "../lib/director-commands";
import TakeToAir from "./TakeToAir";

const segment = { id: "quake:us1", kind: "quake", title: "M6", camera: { center: [0, 0], zoom: 4 }, patch: {}, holdMs: 1 } as Segment;

it("queues a cut to the selected segment", async () => {
  (sendCommand as jest.Mock).mockResolvedValue({ ok: true, command: {} });
  render(<TakeToAir sceneId="wind" segment={segment} />);
  fireEvent.click(screen.getByRole("button", { name: "Take to air" }));
  expect(await screen.findByText(/cutting now/)).toBeInTheDocument();
  expect(sendCommand).toHaveBeenCalledWith("wind", { op: "cut", target: { type: "segment", id: "quake:us1" } });
});

it("shows a refusal", async () => {
  (sendCommand as jest.Mock).mockResolvedValue({ ok: false, error: "director is off" });
  render(<TakeToAir sceneId="wind" segment={segment} />);
  fireEvent.click(screen.getByRole("button", { name: "Take to air" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("director is off");
});
