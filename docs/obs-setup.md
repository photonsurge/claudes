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

It does **not** touch your scenes, sources, or encoder settings. You own those.

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

Only the URL changes:

```bash
OBS_WEBSOCKET_URL=ws://192.168.1.50:4455   # the machine running OBS
```

and you must:
- allow TCP **4455** through that machine's firewall
- make sure the two boxes can actually reach each other

Note this is an **unencrypted** websocket — keep it on a trusted LAN, or tunnel it
(e.g. `ssh -L 4455:127.0.0.1:4455 user@obsbox`, then keep the URL as `127.0.0.1`).

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

- run a virtual display (`Xvfb`, or an X server with the NVIDIA driver attached) and
  launch OBS against it, e.g. `DISPLAY=:99 obs --startvirtualcam --minimize-to-tray`
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
| Stuck on **AWAITING INGEST** | OBS isn't actually sending. Check OBS's own status bar for a bitrate; check Settings → Stream got populated. Use the manual key card to verify. |
| Black frame / globe missing | Browser source had **Shutdown source when not visible** ticked, or the watch URL needs a token (get it from `/admin/access`). |
| Choppy output, dropped frames climbing | Encoder overloaded — drop to 30 fps, lower bitrate, or switch to NVENC. The panel's **Dropped** % is the number to watch. |
| Stream drops after a few hours | Keyframe interval not set to 2 (step 5), or upstream bandwidth. |

Related: [youtube-setup.md](youtube-setup.md) · [streaming-runs-plan.md](streaming-runs-plan.md)
