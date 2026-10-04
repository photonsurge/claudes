"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { formatStreamTitle, STREAM_TITLE_TOKENS } from "@photonsurge/shared/stream-title";
import TokenChips from "./TokenChips";

export default function StreamTitleField({ value, onChange, recurring = false }: {
  value: string;
  onChange: (value: string) => void;
  recurring?: boolean;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const preview = now && value ? formatStreamTitle(value, now) : "";
  return (
    <Box sx={{ width: "100%", minWidth: 0 }}>
      <TextField
        fullWidth label="YouTube title (optional)" value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Weather live — %d/%m/%Y %H:%M"
        helperText="Leave blank for an automatic title. Use the date and time codes below, or type a plain title."
      />
      <Box sx={{ mt: 1, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
        <Typography variant="overline" color="text.secondary">Title preview · UK time</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere", mb: 1 }}>
          {preview || "Your automatic title will be used"}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
          Dates use Europe/London time (GMT/BST automatically). Codes are replaced when the YouTube broadcast is created.
          {recurring ? " Every restart gets a fresh date and time; the saved template stays unchanged." : " The published title stays fixed during the stream."}
        </Typography>
        <TokenChips
          title="Date & time codes — click a code to add it"
          tokens={STREAM_TITLE_TOKENS}
          onPick={(code) => onChange(value + code)}
        />
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          SOMETHING %D → SOMETHING TUESDAY. %D is the full uppercase weekday; %d is the day number.
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          Example: %d/%m/%Y %H:%M → 08/09/2026 14:05. Codes are case-sensitive: %m is month, %M is minutes, %H is the 24-hour clock. %% prints a literal %; unknown codes stay unchanged.
        </Typography>
        {preview.length > 100 && <Typography variant="caption" color="error">This preview exceeds YouTube’s 100-character title limit.</Typography>}
      </Box>
    </Box>
  );
}
