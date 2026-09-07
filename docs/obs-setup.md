# OBS setup — capturing `/watch` and letting the app drive it

What you're producing by the end of this doc:

```bash
OBS_WEBSOCKET_URL=ws://127.0.0.1:4455
OBS_WEBSOCKET_PASSWORD=<the password OBS generates for you>
```

…plus an OBS scene that shows the globe, so that clicking **Go Live** in the app
actually pushes pixels to YouTube.

**What the app does to OBS** (so nothing surprises you):
- sets **Settings → Stream** to *Custom…* with YouTube's ingest URL + the per-run
  stream key (`SetStreamServiceSettings`)
- presses **Start Streaming** / **Stop Streaming**
- reads status (bitrate, dropped frames, uptime) for the health readout
- auto-provisions **its own** capture scene (`PhotonSurge — <scene>`) with a
  full-canvas browser source on the channel's tokened /watch URL, with managed
  performance settings (30fps custom frame rate, shutdown-on-hidden off — see
  the performance section below)
- **hard-resets that source at every go-live** (constant-stream relaunches and
  recycles included): any stale streaming output is stopped first, then the
  browser source is torn down and rebuilt — a fresh Chromium with zero
  accumulated state, your custom CSS carried over. `OBS_HARD_PROVISION=off`
  falls back to a settings-restamp + no-cache refresh.

It owns the settings it stamps on that one source (URL, size, fps, visibility
flags, audio reroute — your custom CSS and other tweaks survive). It does
**not** touch any other scene or source, and never your encoder settings. You
own those.

---

## Step 1 — Install OBS 28 or newer

<https://obsproject.com/download>

obs-websocket **5.x is built into OBS 28+** — no plugin needed. (If you're on OBS 27
or older, upgrade; the old obs-websocket 4.x protocol is not compatible.)

Check: **Help → About** shows the version.

---

## Step 2 — Enable the WebSocket server (this is where the password comes from)

1. In OBS: **Tools → WebSocket Server Settings**
2. Tick **Enable WebSocket server**
3. **Server Port**: leave `4455` (the default)
4. Leave **Enable Authentication** ticked
5. Click **Show Connect Info** → this reveals the **Server Password**.
   **That is your `OBS_WEBSOCKET_PASSWORD`.**
   You can click **Generate Password** for a fresh one, or type your own.
6. **Apply → OK**

> The "Connect Info" dialog also shows a Server IP and a QR code — ignore those,
> they're for phone remotes. You only need the port and the password.

---

## Step 3 — Put it in the root `.env`

Edit `/home/rich/code/thronix/WeatherChannel/.env`:

```bash
OBS_WEBSOCKET_URL=ws://127.0.0.1:4455
OBS_WEBSOCKET_PASSWORD=<the Server Password from step 2>
```

Then **restart the `worker`** (it's the only service that talks to OBS).

`/admin/streams` should now show a green **OBS configured** chip instead of
**OBS: manual handoff**.

### If OBS is NOT on the same machine as the worker

This is fully supported. **obs-websocket is a server that lives inside OBS**, and the
worker is the client that dials out to it — so OBS can run anywhere the worker can
reach. Only the URL changes:

```bash
OBS_WEBSOCKET_URL=ws://192.168.1.50:4455   # the machine running OBS
```

**The video path does not go through the worker's host.** OBS loads `/watch` over
HTTPS in its browser source and pushes RTMP straight to YouTube itself. The worker
only sends control messages (set key / start / stop / status). So the OBS box needs
the GPU and the upstream bandwidth; the "mother" needs neither.

Requirements:
- TCP **4455** open on the OBS host's firewall
- the connection direction is **worker → OBS**, so the OBS host must be reachable
  *inbound* from the worker

#### If the OBS box is behind NAT (worker can't reach in)

Common case: OBS on a home/office machine, worker on a cloud VM. Two fixes, both run
**from the OBS box** (it dials out, so NAT is no obstacle):

**Reverse SSH tunnel** — OBS box connects to the mother and publishes its 4455 there:

```bash
# run ON the OBS machine; keep it up with autossh/systemd for production
ssh -N -R 4455:127.0.0.1:4455 user@mother-host
```

Then on the mother, leave the URL as loopback — it's now the tunnel mouth:

```bash
OBS_WEBSOCKET_URL=ws://127.0.0.1:4455
```

**Or a mesh VPN** (Tailscale / WireGuard) — join both boxes, then use the OBS box's
mesh IP directly: `OBS_WEBSOCKET_URL=ws://100.x.y.z:4455`. Nicer for a permanent rig.

#### Security

The websocket is **plaintext `ws://`** with a single static password (obs-websocket
has no TLS, no per-client tokens). **Never expose 4455 to the public internet** — the
handshake is challenge-response, but everything after it is sniffable and a static
password is all that stands in front of "start/stop my broadcast". Keep it on a LAN,
a mesh VPN, or an SSH tunnel. Every option above satisfies that.

#### Multi-stream (the encoder registry)

One OBS instance = one streaming output — that hasn't changed. What has: the worker
is no longer limited to the single `OBS_WEBSOCKET_URL`. **`/admin/streams` now has an
"OBS encoders" registry** — one row per OBS instance (url, password, and which scene
that instance's browser source captures). N registered encoders = N concurrent
streams; a second run on the *same* encoder still gets a 409.

To run 3 constant streams you therefore run **3 OBS instances**, each with its own
websocket port and its own browser source pointed at a different `/watch/<scene-id>`.
On one Linux box, separate profiles + portable mode keep them apart:

```bash
# one launcher per stream — different profile, scene collection, and WS port
obs --multi --profile "wind"  --collection "wind"  --scene "Globe" &
obs --multi --profile "temp"  --collection "temp"  --scene "Globe" &
obs --multi --profile "storm" --collection "storm" --scene "Globe" &
```

In each instance: **Tools → WebSocket Server Settings** → a DIFFERENT port
(`4455` / `4456` / `4457`) and its own password, then build that instance's capture
scene per Step 4 with its scene's watch URL. Register each in
`/admin/streams → OBS encoders` (`ws://127.0.0.1:4455` etc.) and bind it to its
scene — run-creation then auto-picks the right instance, and the "Constant streams"
slots keep them live 24/7.

`OBS_WEBSOCKET_URL` still works and appears as the implicit `env` encoder, so a
single-OBS setup needs no registry at all.

Encoding load: three 1080p30 NVENC sessions are fine on any recent NVIDIA card
(consumer cards allow 5+ concurrent sessions); on CPU-only x264 budget ~3–4 cores
per 1080p30 stream, or drop the extra streams to 720p.

---

## Step 4 — Build the capture scene

1. **Scenes** panel → **+** → name it e.g. `Globe`
2. **Sources** panel → **+** → **Browser**
3. Configure the browser source:
   - **URL**: your watch URL. Use the tokened one from **`/admin/access`** if the
     instance is public; locally `http://localhost:10100/watch` is fine.
     For a named scene it's `http://localhost:10100/watch/<scene-id>`.
   - **Width** `1920`, **Height** `1080`
   - **Use custom frame rate**: tick, set **30** (or 60 if your GPU/upload can hold it)
   - **Shutdown source when not visible**: **UNTICK** — otherwise the globe reloads
     every scene switch and you get a black frame + re-fetch storm
   - **Refresh browser when scene becomes active**: untick (same reason)
4. OK. The globe should appear. Right-click the source → **Transform → Fit to screen**
   if it isn't filling the canvas.

**Audio:** the app's generative music bed plays inside the page, so the browser
source carries it. Make sure the Browser source's audio isn't muted in the **Audio
Mixer**, and that **Control audio via OBS** is ticked on the source if you want its
level in the mixer.

> Hand-building this scene is only needed if you skip auto-provision: on go-live
> the worker creates/updates its own `PhotonSurge — <scene>` scene with exactly
> these settings (and respects anything you've changed on it since).

---

## Browser sources: performance & the GPU (multi-stream Chromium)

Every OBS browser source is a **full embedded Chromium (CEF) rendering the whole
/watch page** — 4 constant streams means the entire globe UI is rendered 4 times
over. The stack is architected so that stays cheap, but two halves have to
cooperate: the app's half is automatic, yours is a one-time OBS setting per
instance.

**What the app does automatically:**

- **Auto-provisioned sources run a 30fps custom frame rate**, and
  `OBS_BROWSER_FPS` in the root `.env` (10–60) is THE knob: it is re-stamped on
  every provision, so bump it, restart the worker, and the next
  go-live/recycle applies it to every managed source. Everything animated on
  /watch — the spin, wind particles, label projection, pulses — runs off
  `requestAnimationFrame`, so CEF's paint cap throttles the *whole page's*
  render work to the stream's real output rate instead of Chromium's default
  60. (Want a manually-tuned source instead? Build one under your own name —
  provisioning only ever touches `PhotonSurge globe — <scene>`.)
- **Shutdown-on-hidden / refresh-on-activate stay off** on provisioned sources,
  so a scene switch never reloads the globe (black frame + texture refetch storm).
- **Every go-live is a hard reset** (default; `OBS_HARD_PROVISION=off` reverts
  to refresh-only): the browser source is removed and recreated, which kills
  and respawns its CEF browser — hours of accumulated renderer state and memory
  gone, page cold-started fresh on the new run's URL. A stale streaming output
  from a crashed run is stopped before the new key is set, so a relaunch can
  never keep pushing to a dead broadcast.

**Pushing the frame rate up (1080p60):** set `OBS_BROWSER_FPS=60` + worker
restart, and in EACH OBS instance set Settings → Video FPS to 60 and raise the
stream bitrate to ~9000 Kbps (Step 5). Keep the two fps equal — a 60fps canvas
over a 30fps source (or vice versa) buys nothing and doubles work on one side.
Budget check first: 60fps doubles per-instance render AND encode cost, ×N
constant streams.
- **The page detects it's inside OBS** (CEF's `window.obsstudio`; force it in a
  normal browser with `?obs=1` on the watch URL) and switches to broadcast-render
  mode: backdrop-filter blurs behind the glass panels are dropped (a per-frame
  GPU tax invisible through H.264), the WebGL canvas renders at exactly 1× device
  pixels, and the context asks for the `high-performance` (discrete) GPU.
- **It tells you when the GPU is missing**: if WebGL initialises on a software
  rasteriser (llvmpipe / SwiftShader), the page draws a red **⚠ SOFTWARE
  RENDER** chip top-left — visible straight in that encoder's OBS preview — and
  logs the device string (`[globe] WebGL device: …`) to the source's console.

**What only you can set (once per OBS instance):**

1. **Settings → Advanced → Sources → "Enable Browser Source Hardware
   Acceleration" — ON.** Without it every browser source composites on the CPU
   regardless of anything else. (Needs an OBS restart to take effect.)
2. **Keep Settings → Video FPS equal to the browser-source fps** (30/30 by
   default) — a 60fps canvas over a 30fps source buys nothing and doubles
   compositing.
3. **Verify the NVIDIA card is really doing the work** (run these on the OBS box):

   ```bash
   nvidia-smi                       # obs should be listed with GPU memory in use
   ```

   On a hybrid-GPU (laptop/iGPU+dGPU) machine, launch OBS onto the NVIDIA card:

   ```bash
   prime-run obs        # or:
   __NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia obs
   ```

   If the SOFTWARE RENDER chip shows, Chromium fell back to CPU rasterisation —
   fix the display/driver situation rather than living with it: 4×1080p30 of
   llvmpipe is exactly the "streams melt the box" failure mode.

Cost expectations once all of the above holds: each 1080p30 instance is one CEF
render + one NVENC session; recent consumer NVIDIA cards run 3–5 such streams
comfortably (NVENC allows 5+ sessions), and the shared Mongo/socket backend does
no extra work per stream — each page just reads the same cached feeds.

---

## Step 5 — Encoder / output settings

**Settings → Video**
- Base (Canvas) Resolution: `1920x1080`
- Output (Scaled) Resolution: `1920x1080`
- Common FPS Values: `30` (or `60`)

**Settings → Output** → Output Mode: **Advanced** → **Streaming** tab
- **Encoder**: `NVIDIA NVENC H.264` on the GPU box (falls back to `x264` if no GPU —
  use preset `veryfast` if so)
- **Rate Control**: `CBR`
- **Bitrate**: `6000` Kbps for 1080p30, `9000` for 1080p60
- **Keyframe Interval**: **`2`** ← YouTube requires ≤4s and recommends 2. Do not leave
  this on `0`/auto for a long-running stream.
- **Preset**: `Quality` (NVENC) · **Profile**: `high`

**Settings → Audio**
- Sample Rate: `48 kHz` (YouTube's expected rate)

**Settings → Stream** — **leave it alone.** The app overwrites this per run with the
YouTube ingest URL + key. Anything you type here gets replaced on Go Live.

---

## Step 6 — Verify

1. OBS is **running** with the Globe scene active (OBS must be open — the app can
   start streaming, but it can't launch OBS for you).
2. `/admin/streams` shows **OBS configured**.
3. Hit **● Go Live** from `/control`.
4. Expected: OBS's status bar starts showing a bitrate, and the panel walks
   `STARTING → AWAITING INGEST → LIVE` within ~5–20 seconds.

---

## The manual fallback (when OBS can't be reached)

This is by design, not an error: if the worker can't reach OBS, the run **does not
fail**. It parks on **AWAITING INGEST** and the Stream panel shows an orange card:

> **OBS not connected — paste this key into OBS → Settings → Stream**
> → click **Show stream key**

Then in OBS: **Settings → Stream** → Service: **Custom…** → paste **Server** and
**Stream Key** → OK → **Start Streaming**. The moment YouTube sees bytes, the app
detects it and transitions the broadcast to live automatically.

Use this any time OBS is on a machine the worker can't talk to.

---

## Running OBS on a headless GPU VM (later)

OBS needs a display server; it will not start on a bare headless box. On a GPU VM:

- run a virtual display and launch OBS against it, e.g.
  `DISPLAY=:99 obs --startvirtualcam --minimize-to-tray` — but note **`Xvfb` is
  pure software GL (llvmpipe)**: fine for a smoke test, ruinous for real streams
  (the /watch page will show its SOFTWARE RENDER chip). For production use an X
  server attached to the NVIDIA driver (headless `xorg.conf` with
  `Option "AllowEmptyInitialConfiguration"`, or a virtual display on the card)
- keep `OBS_WEBSOCKET_URL=ws://127.0.0.1:4455` — the worker runs on that same VM, so
  nothing else changes
- NVENC needs the real NVIDIA driver in the VM (not llvmpipe/software GL), or the
  browser source will render slowly and the encoder won't be available

This is exactly why the endpoint is an env var: same code, local box today, GPU VM later.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/admin/streams` says **OBS: manual handoff** | `OBS_WEBSOCKET_URL` not set, or worker not restarted after editing `.env`. |
| Worker logs `cannot reach OBS at ws://…` | OBS not running, WebSocket server not enabled (step 2), wrong port, or firewall. |
| Connects but every call fails auth | `OBS_WEBSOCKET_PASSWORD` doesn't match **Show Connect Info**. Re-copy it; don't include quotes. |
| Stuck on **AWAITING INGEST** | OBS isn't actually sending. obs-websocket's `StartStream` is fire-and-forget — OBS says OK and only later fails (encoder init, RTMP connect). The run row shows `obs-output: OBS accepted StartStream but its streaming output is not running (last OBS state: …)` once the worker notices; the reason itself is in **OBS's own log** on the encoder host (`Help → Log Files`, or `…/obs-studio/logs/`). The **Test** button now also prints what Settings → Stream holds (`stream: rtmp_custom → rtmp://… (key set)`) and OBS's last output state. |
| Need to see exactly what the worker told OBS | Every websocket request/response and every `StreamStateChanged` event is logged under `[obs]` in the worker log (`→ ws://… StartStream` / `← … ok 3ms` / `event StreamStateChanged OBS_WEBSOCKET_OUTPUT_STOPPED`); the go-live steps also show in `/admin/queue` on that run's job. `OBS_WS_LOG=all` logs every status poll too, `OBS_WS_LOG=off` silences requests. |
| Black frame / globe missing | Browser source had **Shutdown source when not visible** ticked, or the watch URL needs a token (get it from `/admin/access`). |
| Choppy output, dropped frames climbing | Encoder overloaded — drop to 30 fps, lower bitrate, or switch to NVENC. The panel's **Dropped** % is the number to watch. |
| Red **⚠ SOFTWARE RENDER** chip on the globe | WebGL fell back to CPU rasterisation (llvmpipe/SwiftShader) inside that browser source. Enable Browser Source Hardware Acceleration, check the NVIDIA driver/display setup (see the performance section), restart OBS. |
| Whole OBS sluggish with several browser sources | Browser Source Hardware Acceleration off, sources running 60fps (re-provision or set custom frame rate 30), or everything landed on the iGPU/software GL. |
| Stream drops after a few hours | Keyframe interval not set to 2 (step 5), or upstream bandwidth. |

Related: [youtube-setup.md](youtube-setup.md) · [streaming-runs-plan.md](streaming-runs-plan.md)
