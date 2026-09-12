"use client";

/**
 * YouTube description template editor (runs + constant streams). Same date
 * codes as the title; resolved once when the broadcast is created. Blank =
 * the built-in globe blurb. Shows a live preview so the operator sees the
 * exact text YouTube will get (the as-run chapters are appended later).
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { YT_DESCRIPTION_MAX, buildBroadcastDescription } from "@photonsurge/shared/stream-description";

export default function StreamDescriptionField({ value, onChange, recurring = false }: {
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
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";
  const preview = now ? buildBroadcastDescription({ template: value, siteUrl, now }) : "";
  return (
    <Box sx={{ width: "100%", minWidth: 0 }}>
      <TextField
        fullWidth multiline minRows={2} maxRows={8}
        label="YouTube description (optional)" value={value}
        onChange={(e) => onChange(e.target.value.slice(0, YT_DESCRIPTION_MAX))}
        placeholder="Leave blank for the standard description"
        helperText={`Same date and time codes as the title. ${recurring ? "Every restart resolves them afresh. " : ""}The site link is added automatically; the as-run chapters go underneath once the stream ends.`}
      />
      <Box sx={{ mt: 1, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
        <Typography variant="overline" color="text.secondary">Description preview</Typography>
        <Typography variant="body2" component="pre" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", m: 0, fontFamily: "inherit" }}>
          {preview}
        </Typography>
        {value.length > YT_DESCRIPTION_MAX - 200 && (
          <Typography variant="caption" color="warning.main">Close to YouTube’s {YT_DESCRIPTION_MAX}-character limit — the chapters block may be trimmed.</Typography>
        )}
      </Box>
    </Box>
  );
}
