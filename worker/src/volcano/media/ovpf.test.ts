import { parseOvpfCameras } from "./ovpf";
test("OVPF discovers stable current camera images", () => { expect(parseOvpfCameras('<img src="/volcanoweb/reunion/Cameras/CameraBasalte.jpg"><img src="/volcanoweb/reunion/Cameras/CameraBory.jpg">')).toHaveLength(2); });
