"use client";

/**
 * Feeds the per-job log store from the socket. Mounted once on /admin/queue so a
 * single `queue:log` subscription fans lines into `queue-log-store`, keyed by
 * jobId — QueueJob cards then read their own instance's lines via useJobLog.
 * Renders nothing.
 */
import { useEffect } from "react";
import { useSocket } from "../../lib/socket-provider";
import { pushJobLog } from "../../lib/queue-log-store";

interface QueueLogData {
  jobId: string | null;
  label: string | null;
  seq?: number;
  ts?: number;
  level: "info" | "warn" | "error";
  line: string;
}

interface Msg {
  data?: QueueLogData;
}

export default function QueueLogCollector() {
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;
    const onLog = (msg: Msg) => {
      const d = msg?.data;
      if (!d || !d.jobId || typeof d.line !== "string") return;
      // Fall back to a client seq/ts for older workers that don't send them; the
      // negative seq keeps these ordered before any server-numbered lines.
      pushJobLog(d.jobId, {
        seq: typeof d.seq === "number" ? d.seq : -Date.now(),
        ts: typeof d.ts === "number" ? d.ts : Date.now(),
        level: d.level ?? "info",
        line: d.line,
      });
    };
    socket.on("queue:log", onLog);
    return () => {
      socket.off("queue:log", onLog);
    };
  }, [socket]);

  return null;
}
