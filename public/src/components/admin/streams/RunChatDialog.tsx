"use client";

/**
 * /admin/streams per-run chat log viewer. Fetches the FULL logged history for a
 * run (live or long-finished) from GET /api/streams/:id/chat and lists it in air
 * order — the durable counterpart to the ephemeral /control LiveChatPanel tail.
 * No cap: the whole log, scrollable.
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import type { ChatMessage } from "@photonsurge/shared/runs";
import { fetchChatLog } from "../../../lib/chat";

const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function RunChatDialog({
  runId,
  title,
  open,
  onClose,
}: {
  runId: string;
  title: string;
  open: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMessages(null);
    setErr(null);
    fetchChatLog(runId)
      .then((msgs) => {
        if (!cancelled) setMessages(msgs);
      })
      .catch((e) => {
        if (!cancelled) setErr(String((e as Error)?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, runId]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Chat — {title}
        {messages ? (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {messages.length} message{messages.length === 1 ? "" : "s"}
          </Typography>
        ) : null}
      </DialogTitle>
      <DialogContent dividers>
        {err && <Alert severity="error">{err}</Alert>}
        {!err && messages === null && (
          <Typography variant="body2" color="text.secondary">
            Loading…
          </Typography>
        )}
        {!err && messages !== null && messages.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No chat logged for this run.
          </Typography>
        )}
        {!err && messages !== null && messages.length > 0 && (
          <Box sx={{ display: "grid", gap: 0.5 }}>
            {messages.map((m) => (
              <Typography key={m.id} variant="body2" sx={{ lineHeight: 1.4 }}>
                <Typography component="span" variant="caption" color="text.secondary" sx={{ mr: 0.75 }}>
                  {timeOf(m.ts)}
                </Typography>
                <Box
                  component="span"
                  sx={{ fontWeight: 700, color: m.isOwner ? "warning.main" : m.isMod ? "info.main" : "text.primary" }}
                >
                  {m.author}
                </Box>
                {m.superchatAmount ? (
                  <Box component="span" sx={{ color: "success.main", fontWeight: 700 }}>
                    {" "}
                    {m.superchatAmount}
                  </Box>
                ) : null}
                <Box component="span" sx={{ opacity: 0.6 }}>
                  {": "}
                </Box>
                {m.text}
              </Typography>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
