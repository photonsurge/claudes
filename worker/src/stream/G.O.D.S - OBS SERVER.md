https://chatgpt.com/c/6a9edbf0-8fbc-83eb-bd59-7325381c336f

Yep — for channel 1, whose Chromium debug port is 9221, run this on your local machine:

ssh -N -L 9221:127.0.0.1:9221 root@gds1.thronix.uk

Then locally open:

http://127.0.0.1:9221

You should see the Chromium/CEF debug targets f

# G.O.D.S. GPU VPS – Headless Multi-OBS Setup

This documents the working setup for running multiple independent OBS Studio instances on a headless Ubuntu GPU VPS.




## Server

* Ubuntu 24.04 LTS
* NVIDIA GTX 1080 Ti
* NVIDIA driver 580.x
* OBS Studio 32.2.0
* Xorg headless display
* Five reusable OBS channels
* NVIDIA NVENC encoding
* OBS WebSocket control
* No GNOME/XFCE/desktop environment required

Architecture:

```text
                     GTX 1080 Ti
                          │
                    Headless Xorg :0
                          │
        ┌─────────┬───────┼───────┬─────────┐
        │         │       │       │         │
      OBS 01    OBS 02  OBS 03  OBS 04    OBS 05
      :4451     :4452   :4453   :4454     :4455
        │         │       │       │         │
    separate   separate separate separate separate
      config     config   config   config   config
```

Each OBS process uses the same GPU/Xorg display but has completely separate:

* OBS config
* browser/CEF state
* cache
* data
* runtime directory
* OBS WebSocket port

---

# 1. NVIDIA Driver

Check the GPU:

```bash
lspci | grep -i nvidia
```

Check the driver:

```bash
nvidia-smi
```

Expected GPU:

```text
NVIDIA GeForce GTX 1080 Ti
```

Check NVENC support:

```bash
ffmpeg -hide_banner -encoders | grep nvenc
```

Expected:

```text
h264_nvenc
hevc_nvenc
```

The 1080 Ti does not support AV1 hardware encoding even if `av1_nvenc` appears in the FFmpeg encoder list.

---

# 2. Required Packages

```bash
apt update

apt install -y \
    ffmpeg \
    obs-studio \
    xserver-xorg-core \
    x11-xserver-utils \
    x11-utils \
    mesa-utils \
    dbus-x11 \
    rsync \
    xdotool
```

---

# 3. Dedicated OBS User

Create a dedicated user:

```bash
useradd -m -s /bin/bash gods
```

Home directory:

```text
/home/gods
```

OBS should run as `gods`, not root.

---

# 4. Headless NVIDIA Xorg

Create:

```text
/etc/X11/xorg.conf
```

Contents:

```text
Section "ServerLayout"
    Identifier "Layout0"
    Screen 0 "Screen0"
EndSection

Section "Device"
    Identifier "Nvidia0"
    Driver "nvidia"
    BusID "PCI:6:0:0"
    Option "AllowEmptyInitialConfiguration" "True"
EndSection

Section "Screen"
    Identifier "Screen0"
    Device "Nvidia0"
    DefaultDepth 24

    SubSection "Display"
        Depth 24
        Virtual 1920 1080
    EndSubSection
EndSection
```

The important option is:

```text
Option "AllowEmptyInitialConfiguration" "True"
```

This allows NVIDIA Xorg to run without a physical monitor.

The PCI BusID came from:

```bash
lspci | grep -i nvidia
```

For this server:

```text
06:00.0 VGA compatible controller: NVIDIA Corporation GP102 [GeForce GTX 1080 Ti]
```

Therefore:

```text
BusID "PCI:6:0:0"
```

---

# 5. Xorg systemd Service

Create:

```text
/etc/systemd/system/gods-xorg.service
```

Contents:

```ini
[Unit]
Description=G.O.D.S. Headless NVIDIA Xorg
After=systemd-user-sessions.service

[Service]
Type=simple
ExecStart=/usr/bin/Xorg :0 -config /etc/X11/xorg.conf -noreset -nolisten tcp -ac
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

Reload systemd:

```bash
systemctl daemon-reload
```

Enable and start Xorg:

```bash
systemctl enable --now gods-xorg
```

Check:

```bash
systemctl status gods-xorg --no-pager
```

Verify that the `gods` user gets hardware OpenGL:

```bash
sudo -u gods env DISPLAY=:0 glxinfo -B
```

Expected:

```text
direct rendering: Yes
OpenGL vendor string: NVIDIA Corporation
OpenGL renderer string: NVIDIA GeForce GTX 1080 Ti/PCIe/SSE2
```

If the renderer says `llvmpipe`, GPU rendering is not working correctly.

---

# 6. OBS WebSocket Password

Create a secure password file:

```bash
install -d -o gods -g gods -m 700 /home/gods/.config/gods
```

Generate a password:

```bash
sudo -u gods bash -c '
umask 077
openssl rand -hex 24 > /home/gods/.config/gods/ws-password
'
```

View it if required:

```bash
cat /home/gods/.config/gods/ws-password
```

The G.O.D.S. controller needs this password when connecting to OBS WebSocket.

---

# 7. OBS Channel Layout

Five reusable slots are configured:

```text
channel01 → WebSocket 4451
channel02 → WebSocket 4452
channel03 → WebSocket 4453
channel04 → WebSocket 4454
channel05 → WebSocket 4455
```

Directories are automatically created under:

```text
/home/gods/obs-instances/
```

Example:

```text
/home/gods/obs-instances/channel01/
    config/
    cache/
    data/
    runtime/
```

The channels are intentionally generic.

For example:

```text
channel01 = Weather today
channel01 = Volcanoes later
```

The channel slot does not care what content it is currently streaming.

---

# 8. OBS Channel Launcher

Current working launcher:

```text
/usr/local/bin/gods-obs-channel
```

Contents:

```bash
#!/usr/bin/env bash
set -euo pipefail

RAW="${1:?channel number required}"
IDX=$((10#$RAW))

if (( IDX < 1 || IDX > 5 )); then
    echo "Channel must be 01-05" >&2
    exit 2
fi

CHANNEL=$(printf 'channel%02d' "$IDX")
PORT=$((4450 + IDX))

ROOT="$HOME/obs-instances/$CHANNEL"

CFG="$ROOT/config"
CACHE="$ROOT/cache"
DATA="$ROOT/data"
RUNTIME="$ROOT/runtime"

WS_PASSWORD_FILE="$HOME/.config/gods/ws-password"
WS_PASSWORD="$(<"$WS_PASSWORD_FILE")"

mkdir -p \
    "$CFG" \
    "$CACHE" \
    "$DATA" \
    "$RUNTIME"

chmod 700 "$RUNTIME"

# Always start browser sources with a completely clean Chromium/CEF state.
BROWSER_DIR="$CFG/obs-studio/plugin_config/obs-browser"
rm -rf "$BROWSER_DIR"
mkdir -p "$BROWSER_DIR"

# Clean stale Chromium/CEF singleton locks after crashes.
rm -f \
    "$CFG"/obs-studio/plugin_config/obs-browser/Singleton* \
    2>/dev/null || true

# Give every channel its own websocket configuration.
mkdir -p "$CFG/obs-studio/plugin_config/obs-websocket"

WS_CONFIG="$CFG/obs-studio/plugin_config/obs-websocket/config.json"

if [[ ! -f "$WS_CONFIG" ]]; then
cat > "$WS_CONFIG" <<EOF
{
  "alerts_enabled": false,
  "auth_required": true,
  "first_load": false,
  "server_enabled": true,
  "server_password": "$WS_PASSWORD",
  "server_port": $PORT
}
EOF
fi

export HOME=/home/gods
export DISPLAY=:0

export XDG_CONFIG_HOME="$CFG"
export XDG_CACHE_HOME="$CACHE"
export XDG_DATA_HOME="$DATA"
export XDG_RUNTIME_DIR="$RUNTIME"

export QT_QPA_PLATFORM=xcb

mkdir -p "$CFG/obs-studio"

USER_INI="$CFG/obs-studio/user.ini"

if [[ ! -f "$USER_INI" ]]; then
cat > "$USER_INI" <<EOF
[General]
FirstRun=true
EOF
fi

DEBUG_PORT=$((9220 + IDX))

echo "Starting $CHANNEL"
echo "WebSocket port: $PORT"

exec /usr/bin/obs \
    --enable-gpu \
    --remote-debugging-port="$DEBUG_PORT" \
    --remote-allow-origins=* \
    --multi \
    --disable-missing-files-check \
    --websocket_port "$PORT" \
    --websocket_password "$WS_PASSWORD"
```

Make executable:

```bash
chmod +x /usr/local/bin/gods-obs-channel
```

Browser debugging ports therefore map as:

```text
channel01 → 9221
channel02 → 9222
channel03 → 9223
channel04 → 9224
channel05 → 9225
```

---

# 9. OBS systemd Template

Create:

```text
/etc/systemd/system/gods-obs@.service
```

Contents:

```ini
[Unit]
Description=G.O.D.S. OBS Channel %i
Requires=gods-xorg.service
After=gods-xorg.service network-online.target
Wants=network-online.target

[Service]
Type=simple

User=gods
Group=gods

Environment=HOME=/home/gods
Environment=DISPLAY=:0

ExecStart=/usr/local/bin/gods-obs-channel %i

Restart=always
RestartSec=5

KillSignal=SIGINT
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
```

Reload systemd:

```bash
systemctl daemon-reload
```

Enable all five channels:

```bash
systemctl enable \
    gods-obs@01 \
    gods-obs@02 \
    gods-obs@03 \
    gods-obs@04 \
    gods-obs@05
```

Start all five:

```bash
systemctl start \
    gods-obs@01 \
    gods-obs@02 \
    gods-obs@03 \
    gods-obs@04 \
    gods-obs@05
```

Or enable and start together:

```bash
systemctl enable --now \
    gods-obs@01 \
    gods-obs@02 \
    gods-obs@03 \
    gods-obs@04 \
    gods-obs@05
```

---

# 10. Managing Channels

Restart one channel:

```bash
systemctl restart gods-obs@01
```

Stop one:

```bash
systemctl stop gods-obs@01
```

Start one:

```bash
systemctl start gods-obs@01
```

Status:

```bash
systemctl status gods-obs@01
```

All five:

```bash
systemctl --no-pager --full status \
    gods-obs@01 \
    gods-obs@02 \
    gods-obs@03 \
    gods-obs@04 \
    gods-obs@05
```

List OBS processes:

```bash
pgrep -a obs
```

---

# 11. Viewing OBS Logs

Live log for channel 1:

```bash
journalctl -u gods-obs@01 -f
```

Channel 3:

```bash
journalctl -u gods-obs@03 -f
```

Last 100 lines:

```bash
journalctl -u gods-obs@01 -n 100 --no-pager
```

Current boot:

```bash
journalctl -u gods-obs@01 -b
```

Last 10 minutes:

```bash
journalctl -u gods-obs@01 --since "10 minutes ago"
```

Search for streaming/encoding problems:

```bash
journalctl -u gods-obs@01 -f | \
grep -Ei 'dropped|lag|missed|render|encode|overload|nvenc|stream'
```

OBS also maintains its own logs beneath the channel configuration:

```text
/home/gods/obs-instances/channel01/config/obs-studio/logs/
```

---

# 12. Verify WebSocket Ports

Check all five:

```bash
ss -ltnp | grep -E ':445[1-5]\b'
```

Expected:

```text
4451
4452
4453
4454
4455
```

Mapping:

```text
01 → 4451
02 → 4452
03 → 4453
04 → 4454
05 → 4455
```

---

# 13. First-Run OBS Dialogs

When OBS was initially started, each instance displayed:

* Auto-Configuration Wizard
* WebSocket Server Settings

These modal windows interfered with unattended operation.

List OBS/X11 windows:

```bash
sudo -u gods env DISPLAY=:0 xwininfo -root -tree
```

Useful filtered version:

```bash
sudo -u gods env DISPLAY=:0 xwininfo -root -tree | \
grep -E 'Auto-Configuration|WebSocket Server Settings|OBS 32'
```

If the setup is healthy, normally only the main OBS windows should remain.

If necessary, dialogs can be closed using `xdotool`.

Example:

```bash
sudo -u gods env DISPLAY=:0 xdotool key --window 0xWINDOWID Escape
```

---

# 14. Taking Screenshots of the Headless Display

Capture the entire virtual X display:

```bash
sudo -u gods env DISPLAY=:0 ffmpeg \
    -f x11grab \
    -video_size 1920x1080 \
    -i :0.0 \
    -frames:v 1 \
    /tmp/gods-screen.png
```

Copy to another machine:

```bash
scp root@gds1.thronix.uk:/tmp/gods-screen.png .
```

List individual windows:

```bash
sudo -u gods env DISPLAY=:0 xwininfo -root -tree
```

Capture a specific X11 window:

```bash
sudo -u gods env DISPLAY=:0 ffmpeg \
    -f x11grab \
    -window_id 0xWINDOWID \
    -frames:v 1 \
    /tmp/obs-window.png
```

---

# 15. Confirm GPU Rendering

Check NVIDIA:

```bash
nvidia-smi
```

Check OpenGL from the same user that runs OBS:

```bash
sudo -u gods env DISPLAY=:0 glxinfo -B
```

Healthy result:

```text
direct rendering: Yes
OpenGL vendor string: NVIDIA Corporation
OpenGL renderer string: NVIDIA GeForce GTX 1080 Ti/PCIe/SSE2
```

Check GPU use live:

```bash
watch -n1 nvidia-smi
```

---

# 16. Confirm NVENC in OBS

Successful OBS startup currently reports:

```text
NVENC version: 12.1 (compiled) / 13.0 (driver)
AV1 supported: false
```

Available GPU encoders:

```text
NVIDIA NVENC H.264
NVIDIA NVENC HEVC
```

When streaming successfully, OBS produces output similar to:

```text
codec:        H264
rate_control: CBR
bitrate:      6000
width:        1920
height:       1080
```

And successful YouTube connection:

```text
Connection to rtmp://a.rtmp.youtube.com/live2 successful
==== Streaming Start ====
```

---

# 17. Current Browser-Source Behaviour

OBS currently reports:

```text
Browser Hardware Acceleration: true
```

but the OBS browser plugin has also reported:

```text
Blacklisted driver detected, disabling browser source hardware acceleration.
```

This may be relevant to future G.O.D.S. rendering-performance investigation.

The channel launcher currently removes the browser-source Chromium/CEF state every time the OBS instance starts:

```bash
BROWSER_DIR="$CFG/obs-studio/plugin_config/obs-browser"
rm -rf "$BROWSER_DIR"
mkdir -p "$BROWSER_DIR"
```

This deliberately avoids stale Chromium state and singleton-lock problems between launches.

Each OBS channel has a separate browser configuration tree regardless.

---

# 18. Current Working Result

The G.O.D.S. controller has successfully:

1. Connected to channel 01 using OBS WebSocket.
2. Created/selected the required G.O.D.S. scene.
3. Created a browser source.
4. Selected the scene.
5. Started NVIDIA NVENC.
6. Connected to YouTube RTMP.
7. Started streaming successfully.

Observed example:

```text
New WebSocket client has connected

Switched to scene 'PhotonSurge — weather'

[obs-nvenc: 'simple_video_stream'] settings:
codec: H264
bitrate: 6000
width: 1920
height: 1080

Connection to rtmp://a.rtmp.youtube.com/live2 successful

==== Streaming Start ====
```

The five-channel infrastructure is therefore operational.

---

# Useful Quick Commands

```bash
# Xorg
systemctl status gods-xorg

# All OBS processes
pgrep -a obs

# Channel status
systemctl status gods-obs@01

# Restart channel
systemctl restart gods-obs@01

# Live channel log
journalctl -u gods-obs@01 -f

# Check WebSockets
ss -ltnp | grep -E ':445[1-5]\b'

# GPU
nvidia-smi

# GPU rendering
sudo -u gods env DISPLAY=:0 glxinfo -B

# List graphical windows
sudo -u gods env DISPLAY=:0 xwininfo -root -tree

# Screenshot headless display
sudo -u gods env DISPLAY=:0 ffmpeg \
    -f x11grab \
    -video_size 1920x1080 \
    -i :0.0 \
    -frames:v 1 \
    /tmp/gods-screen.png
```
