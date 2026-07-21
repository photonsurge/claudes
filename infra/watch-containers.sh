#!/usr/bin/env bash
# Container incident recorder — answers "what stopped my containers?".
#
# WHY THIS EXISTS: on 2026-07-21 redis took a clean SIGTERM at 09:00:18 ("User
# requested shutdown") and no redis existed again until 12:28:36. Nothing in the
# app talks to Docker, so the order came from OUTSIDE the stack — and by the time
# anyone looked, the only trace left was the worker's reconnect spam. Docker
# `events` is a LIVE stream with no history, so the cause has to be recorded
# BEFORE the next occurrence, not hunted after it.
#
# ./deployMiranda starts it on the host automatically. To run it by hand:
#   nohup setsid ~/weather/watch-containers.sh </dev/null >/dev/null 2>&1 &
# Read it after the next incident:
#   grep -vF ' hb ' ~/weather-incidents.log | tail -50
#
# Starting it twice is safe — a second copy sees the pidfile and exits.
#
# What the log tells you, by the event that shows up when a container goes away:
#   kill sig=15 → die → stop        someone ran `docker stop` / `compose stop`
#   ...also followed by destroy     someone ran `compose down` / `docker rm`
#   die with NO preceding kill      the process exited on its own (crash/OOM in-container)
#   oom                             the container hit its mem_limit
#   type=daemon                     dockerd itself restarted (apt upgrade, systemctl)
#   a boot= change on the next line the HOST rebooted — nothing "stopped" anything
#   stream ended + gap in heartbeat the daemon or the box went down under us
#
# Deliberately dependency-free (docker + coreutils) and safe to leave running:
# one `docker events` client and a 60s heartbeat, no writes to the stack.
set -uo pipefail

LOG="${WATCH_LOG:-$HOME/weather-incidents.log}"
PIDFILE="${WATCH_PIDFILE:-$HOME/.weather-watcher.pid}"
HEARTBEAT_SEC="${WATCH_HEARTBEAT_SEC:-60}"

say() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; }

# Single-instance guard, so every deploy can just try to start it. A stale
# pidfile (previous run killed, or the host rebooted) fails the kill -0 and gets
# overwritten — the whole point is that this survives the events it records.
if [ -e "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "watcher already running (pid $(cat "$PIDFILE")) — leaving it alone"
  exit 0
fi
echo $$ >"$PIDFILE"

boot_id() { cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo unknown; }

# Every container's name + status on one line, so a heartbeat doubles as a
# before/after snapshot around whatever the next event turns out to be.
snapshot() {
  docker ps -a --format '{{.Names}}={{.State}}' 2>/dev/null | sort | tr '\n' ' '
}

say "=== watcher started pid=$$ boot=$(boot_id) uptime=$(uptime -p 2>/dev/null) docker=$(docker version -f '{{.Server.Version}}' 2>/dev/null)"
say "state $(snapshot)"
# Container IPs at start: if these shuffle across a restart, anything holding a
# hardcoded address (rather than the `redis` / `mongodb` service name) breaks.
docker ps -q 2>/dev/null | while read -r id; do
  say "ip $(docker inspect "$id" --format '{{.Name}} {{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' 2>/dev/null)"
done

# Heartbeat: proves the watcher was alive and watching. A GAP in these lines is
# itself the finding — it means the host or the daemon went down, in which case
# no event was ever emitted to be recorded.
(
  last_boot="$(boot_id)"
  while true; do
    sleep "$HEARTBEAT_SEC"
    now_boot="$(boot_id)"
    if [ "$now_boot" != "$last_boot" ]; then
      say "!!! HOST REBOOTED — boot $last_boot -> $now_boot (uptime $(uptime -p 2>/dev/null))"
      last_boot="$now_boot"
    fi
    say "hb load=$(cut -d' ' -f1-3 /proc/loadavg) mem_avail_kb=$(awk '/MemAvailable/{print $2}' /proc/meminfo) $(snapshot)"
  done
) &
HB_PID=$!
EV_PID=""

cleanup() {
  [ -n "$HB_PID" ] && kill "$HB_PID" 2>/dev/null
  # Kill the stream subshell AND the `docker events` client under it — killing
  # only the subshell leaves the client parented to init, still holding the
  # daemon's event stream open.
  if [ -n "$EV_PID" ]; then
    pkill -P "$EV_PID" 2>/dev/null
    kill "$EV_PID" 2>/dev/null
  fi
  rm -f "$PIDFILE"
  say "=== watcher stopped"
  exit 0
}
trap cleanup INT TERM

stream_events() {
  docker events \
    --filter type=container --filter type=daemon --filter type=network \
    --format '{{.Type}} {{.Action}} name={{index .Actor.Attributes "name"}} svc={{index .Actor.Attributes "com.docker.compose.service"}} sig={{index .Actor.Attributes "signal"}} exit={{index .Actor.Attributes "exitCode"}}' \
    2>>"$LOG" |
    while IFS= read -r line; do
      case "$line" in
        # Noise: every healthcheck is an exec_create/exec_start/exec_die triple.
        *exec_*) continue ;;
      esac
      say "event $line"
      case "$line" in
        *" die "*|*" kill "*|*" oom "*|*" destroy "*)
          say "  ctx state=[$(snapshot)] load=$(cut -d' ' -f1-3 /proc/loadavg) mem_avail_kb=$(awk '/MemAvailable/{print $2}' /proc/meminfo)"
          ;;
      esac
    done
}

# The event stream. `docker events` dies when the daemon does, so supervise and
# reconnect — the reconnect line is itself evidence that dockerd bounced.
#
# It runs BACKGROUNDED and we `wait` on it, rather than in the foreground: bash
# defers trap handling until the current foreground command returns, and
# `docker events` never returns — so a foreground pipeline here would make the
# watcher ignore SIGTERM entirely and need a kill -9. `wait` is interruptible,
# so signals land immediately.
while true; do
  stream_events &
  EV_PID=$!
  wait "$EV_PID"
  EV_PID=""
  say "!!! docker events stream ended (daemon restarting or down?) — reconnecting in 3s"
  sleep 3
done
