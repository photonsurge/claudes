#!/usr/bin/env node
// scripts/inspect-node.mjs <inspector-port>
//
// One-shot memory/handles probe of a live Node process over the V8 inspector —
// no pause, no snapshot, no restart. Pairs with the per-service `yarn
// dev:inspect` scripts (public router 9230 → next-server child auto-increments
// to 9231; worker 9240; socket 9250), or any process sent SIGUSR1 (port 9229).
//
// Prints: rss vs JS-heap split (the gap = native memory V8 can't see), heap
// spaces, and live libuv handles/requests by type (socket pile-ups show here).
//
//   node scripts/inspect-node.mjs 9240
const port = Number(process.argv[2] || 9229);

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
if (!Array.isArray(targets) || !targets.length) {
  console.error(`no inspector target on :${port} — run the service via 'yarn dev:inspect' (or kill -USR1 <pid> for 9229)`);
  process.exit(1);
}
const wsUrl = targets[0].webSocketDebuggerUrl;
console.error(`target: ${targets[0].title}`);

const EXPR = `JSON.stringify((() => {
  const h = process._getActiveHandles(), r = process._getActiveRequests();
  const by = {}; for (const x of h) { const n = x?.constructor?.name ?? "?"; by[n] = (by[n] || 0) + 1; }
  const rq = {}; for (const x of r) { const n = x?.constructor?.name ?? "?"; rq[n] = (rq[n] || 0) + 1; }
  const m = process.memoryUsage();
  let spaces = null;
  try {
    const v8 = process.getBuiltinModule ? process.getBuiltinModule("v8") : null;
    if (v8) spaces = Object.fromEntries(
      v8.getHeapSpaceStatistics().filter(s => s.space_used_size > 1048576)
        .map(s => [s.space_name, Math.round(s.space_used_size / 1048576) + "MB"]));
  } catch {}
  return {
    pid: process.pid, uptimeMin: Math.round(process.uptime() / 60),
    rssMB: Math.round(m.rss / 1048576),
    heapUsedMB: Math.round(m.heapUsed / 1048576), heapTotalMB: Math.round(m.heapTotal / 1048576),
    nativeGapMB: Math.round((m.rss - m.heapTotal) / 1048576),
    externalMB: Math.round(m.external / 1048576), arrayBuffersMB: Math.round(m.arrayBuffers / 1048576),
    spaces, handles: h.length, byHandle: by, requests: r.length, byRequest: rq,
  };
})())`;

const ws = new WebSocket(wsUrl);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: EXPR, returnByValue: true } }));
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== 1) return;
  if (msg.error || msg.result?.exceptionDetails) {
    console.error("evaluate failed:", JSON.stringify(msg.error || msg.result.exceptionDetails).slice(0, 400));
    process.exit(1);
  }
  console.log(JSON.stringify(JSON.parse(msg.result.result.value), null, 1));
  ws.close();
  process.exit(0);
};
ws.onerror = (e) => { console.error("ws error:", e.message || "connect failed"); process.exit(1); };
setTimeout(() => { console.error("timeout"); process.exit(1); }, 10_000);
