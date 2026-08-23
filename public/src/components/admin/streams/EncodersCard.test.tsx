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
  it("lists encoders with endpoint, password state, and the bound channel's watch URL", () => {
    render(<EncodersCard encoders={ENCODERS} scenes={SCENES} onSave={jest.fn()} onDelete={jest.fn()} onTest={jest.fn()} onProvision={jest.fn()} onRefresh={jest.fn()} />);

    expect(screen.getByText("Wind rig")).toBeInTheDocument();
    expect(screen.getByText("ws://127.0.0.1:4455")).toBeInTheDocument();
    expect(screen.getByText("password set")).toBeInTheDocument();
    // The bound channel resolves to a shown /watch URL; the unbound encoder prompts to bind one.
    expect(screen.getByText(/\/watch\/wind/)).toBeInTheDocument();
    expect(screen.getByText(/bind a channel/)).toBeInTheDocument();
  });

  it("changing a row's channel re-binds the encoder", async () => {
    const onSave = jest.fn(async () => ({}));
    render(<EncodersCard encoders={ENCODERS} scenes={SCENES} onSave={onSave} onDelete={jest.fn()} onTest={jest.fn()} onProvision={jest.fn()} onRefresh={jest.fn()} />);

    // Open the second encoder's channel select (currently unbound) and pick Temp.
    fireEvent.mouseDown(screen.getAllByRole("combobox")[1]);
    fireEvent.click(screen.getByRole("option", { name: "Temp" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ id: "obs-2", url: "ws://127.0.0.1:4456", sceneId: "temp" }),
    );
  });

  it("explains the fallback when nothing is registered", () => {
    render(<EncodersCard encoders={[]} scenes={SCENES} onSave={jest.fn()} onDelete={jest.fn()} onTest={jest.fn()} onProvision={jest.fn()} onRefresh={jest.fn()} />);
    expect(screen.getByText(/OBS_WEBSOCKET_URL instance \(one stream at a time\)/)).toBeInTheDocument();
  });

  it("toggling a row saves the enabled flag", async () => {
    const onSave = jest.fn(async () => ({}));
    render(<EncodersCard encoders={ENCODERS} scenes={SCENES} onSave={onSave} onDelete={jest.fn()} onTest={jest.fn()} onProvision={jest.fn()} onRefresh={jest.fn()} />);

    fireEvent.click(screen.getByRole("switch", { name: "enable Wind rig" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ id: "obs-1", url: "ws://127.0.0.1:4455", enabled: false }),
    );
  });

  it("won't add an encoder without a websocket url", () => {
    render(<EncodersCard encoders={[]} scenes={SCENES} onSave={jest.fn()} onDelete={jest.fn()} onTest={jest.fn()} onProvision={jest.fn()} onRefresh={jest.fn()} />);
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
    render(<EncodersCard encoders={ENCODERS} scenes={SCENES} onSave={jest.fn()} onDelete={jest.fn()} onTest={onTest} onProvision={jest.fn()} onRefresh={jest.fn()} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Test" })[0]);

    expect(onTest).toHaveBeenCalledWith("obs-1");
    await waitFor(() => expect(screen.getByText(/✓ reached .*OBS 30\.1\.2/)).toBeInTheDocument());
  });

  it("shows the failure reason when a probe can't reach OBS", async () => {
    const onTest = jest.fn(async () => ({ reachable: false, error: "cannot reach OBS at ws://127.0.0.1:4455: connect timeout" }));
    render(<EncodersCard encoders={ENCODERS} scenes={SCENES} onSave={jest.fn()} onDelete={jest.fn()} onTest={onTest} onProvision={jest.fn()} onRefresh={jest.fn()} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Test" })[0]);

    await waitFor(() => expect(screen.getByText(/✗ .*connect timeout/)).toBeInTheDocument());
  });

  it("provisions the browser source into OBS and reports the result", async () => {
    const onProvision = jest.fn(async () => ({
      ok: true,
      sceneName: "PhotonSurge — wind",
      inputName: "PhotonSurge globe — wind",
      url: "https://io.photonsurge.uk/watch/wind?token=abc",
      width: 1920,
      height: 1080,
      created: true,
      switched: true,
    }));
    render(
      <EncodersCard
        encoders={ENCODERS}
        scenes={SCENES}
        onSave={jest.fn()}
        onDelete={jest.fn()}
        onTest={jest.fn()}
        onProvision={onProvision}
        onRefresh={jest.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Set up in OBS" })[0]);

    expect(onProvision).toHaveBeenCalledWith("obs-1");
    await waitFor(() => expect(screen.getByText(/✓ created .*switched OBS to it/)).toBeInTheDocument());
  });

  it("adds an encoder with the typed endpoint", () => {
    const onSave = jest.fn(async () => ({}));
    render(<EncodersCard encoders={[]} scenes={SCENES} onSave={onSave} onDelete={jest.fn()} onTest={jest.fn()} onProvision={jest.fn()} onRefresh={jest.fn()} />);

    fireEvent.change(screen.getByLabelText("ws://host:4455"), { target: { value: "ws://gpu:4457" } });
    fireEvent.click(screen.getByRole("button", { name: "Add encoder" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ url: "ws://gpu:4457" }));
  });
});
