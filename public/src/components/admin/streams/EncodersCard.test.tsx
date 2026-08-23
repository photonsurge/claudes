/**
 * EncodersCard — the OBS registry rows and the add form's minimal validation.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import EncodersCard from "./EncodersCard";
import type { StreamEncoderInfo } from "@photonsurge/shared/runs";
import type { SceneMeta } from "@photonsurge/shared/control";

const SCENES: SceneMeta[] = [
  { id: "wind", name: "Wind" },
  { id: "temp", name: "Temp" },
] as SceneMeta[];

const ENCODERS: StreamEncoderInfo[] = [
  { id: "obs-1", name: "Wind rig", url: "ws://127.0.0.1:4455", sceneId: "wind", enabled: true, hasPassword: true },
  { id: "obs-2", url: "ws://127.0.0.1:4456", enabled: false, hasPassword: false },
];

describe("EncodersCard", () => {
  it("lists registered encoders with their endpoint and channel binding", () => {
    render(<EncodersCard encoders={ENCODERS} scenes={SCENES} onSave={jest.fn()} onDelete={jest.fn()} onTest={jest.fn()} />);

    expect(screen.getByText("Wind rig")).toBeInTheDocument();
    expect(screen.getByText("ws://127.0.0.1:4455")).toBeInTheDocument();
    expect(screen.getByText(/channel wind · password set/)).toBeInTheDocument();
    expect(screen.getByText(/any channel/)).toBeInTheDocument();
  });

  it("explains the fallback when nothing is registered", () => {
    render(<EncodersCard encoders={[]} scenes={SCENES} onSave={jest.fn()} onDelete={jest.fn()} onTest={jest.fn()} />);
    expect(screen.getByText(/OBS_WEBSOCKET_URL instance \(one stream at a time\)/)).toBeInTheDocument();
  });

  it("toggling a row saves the enabled flag", () => {
    const onSave = jest.fn(async () => ({}));
    render(<EncodersCard encoders={ENCODERS} scenes={SCENES} onSave={onSave} onDelete={jest.fn()} onTest={jest.fn()} />);

    fireEvent.click(screen.getByRole("switch", { name: "enable Wind rig" }));

    expect(onSave).toHaveBeenCalledWith({ id: "obs-1", url: "ws://127.0.0.1:4455", enabled: false });
  });

  it("won't add an encoder without a websocket url", () => {
    render(<EncodersCard encoders={[]} scenes={SCENES} onSave={jest.fn()} onDelete={jest.fn()} onTest={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Add encoder" })).toBeDisabled();
  });

  it("probes an encoder and shows the reachability result", async () => {
    const onTest = jest.fn(async () => ({
      reachable: true,
      url: "ws://127.0.0.1:4455",
      obsVersion: "30.1.2",
      websocketVersion: "5.4.2",
      streaming: false,
    }));
    render(<EncodersCard encoders={ENCODERS} scenes={SCENES} onSave={jest.fn()} onDelete={jest.fn()} onTest={onTest} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Test" })[0]);

    expect(onTest).toHaveBeenCalledWith("obs-1");
    await waitFor(() => expect(screen.getByText(/✓ reached .*OBS 30\.1\.2/)).toBeInTheDocument());
  });

  it("shows the failure reason when a probe can't reach OBS", async () => {
    const onTest = jest.fn(async () => ({ reachable: false, error: "cannot reach OBS at ws://127.0.0.1:4455: connect timeout" }));
    render(<EncodersCard encoders={ENCODERS} scenes={SCENES} onSave={jest.fn()} onDelete={jest.fn()} onTest={onTest} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Test" })[0]);

    await waitFor(() => expect(screen.getByText(/✗ .*connect timeout/)).toBeInTheDocument());
  });

  it("adds an encoder with the typed endpoint", () => {
    const onSave = jest.fn(async () => ({}));
    render(<EncodersCard encoders={[]} scenes={SCENES} onSave={onSave} onDelete={jest.fn()} onTest={jest.fn()} />);

    fireEvent.change(screen.getByLabelText("ws://host:4455"), { target: { value: "ws://gpu:4457" } });
    fireEvent.click(screen.getByRole("button", { name: "Add encoder" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ url: "ws://gpu:4457" }));
  });
});
