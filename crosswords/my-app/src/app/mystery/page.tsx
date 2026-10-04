// app/mystery/page.tsx
"use client";

import { CaseBoard } from "@/lib/components/CaseBoard";
import { initGameState, runTurn } from "@/lib/mystery/engine";
import { parseMysteryMessage } from "@/lib/mystery/parse";
import { sampleMystery } from "@/lib/mystery/simple";
import { Box, Button, Container, Paper, Stack, TextField, Typography } from "@mui/material";
import React, { useMemo, useState } from "react";

type ChatLine = { who: "you" | "game"; text: string };

export default function MysteryPage() {
  const mystery = useMemo(() => sampleMystery, []);
  const [state, setState] = useState(() => initGameState(mystery));
  const [lines, setLines] = useState<ChatLine[]>([
    { who: "game", text: `Case started: ${mystery.title}. Type "help".` },
  ]);
  const [input, setInput] = useState("");

  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;

    setLines((prev) => [...prev, { who: "you", text: t }]);

    setState((prev) => {
      // clone-ish for MVP: engine mutates state, so copy Sets properly
      const next = {
        ...prev,
        unlocked: {
          locations: new Set(prev.unlocked.locations),
          suspects: new Set(prev.unlocked.suspects),
          clues: new Set(prev.unlocked.clues),
          events: new Set(prev.unlocked.events),
        },
        notes: [...prev.notes],
      };

      const intent = parseMysteryMessage(mystery, t);
      const res = runTurn(mystery, next, intent);

      setLines((p) => [...p, { who: "game", text: res.reply }]);

      return next;
    });

    setInput("");
  };

  return (
    <Container maxWidth="xl" sx={{ py: 2 }}>
      <Stack gap={1.5}>
        <Typography variant="h5">Mystery</Typography>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", lg: "1.2fr 0.8fr" },
          }}
        >
          <CaseBoard mystery={mystery} state={state} onCommand={send} />

          <Paper
            variant="outlined"
            sx={{
              p: 1.5,
              display: "grid",
              gridTemplateRows: "1fr auto",
              minHeight: { xs: 340, md: 520 },
            }}
          >
            <Box sx={{ overflow: "auto", pr: 0.5 }}>
              {lines.map((l, i) => (
                <Typography key={i} variant="body2" sx={{ mb: 1.25, opacity: l.who === "you" ? 0.9 : 1 }}>
                  <strong>{l.who === "you" ? "You" : "Game"}:</strong> {l.text}
                </Typography>
              ))}
            </Box>

            <Box
              component="form"
              onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                send(input);
              }}
              sx={{ display: "flex", gap: 1 }}
            >
              <TextField
                value={input}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
                placeholder='Try: "inspect study"'
                size="small"
                fullWidth
              />
              <Button type="submit" variant="contained">
                Send
              </Button>
            </Box>
          </Paper>
        </Box>
      </Stack>
    </Container>
  );
}
