"use client";

/**
 * LanePill — one queue lane as a readable pill: ● name  active/cap  +pending.
 * The fraction goes amber when the lane is saturated (active == cap → everything
 * else waits). Shared by /admin/queue (header) and the /admin/jobs health card.
 */
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { accent, font, ink, status } from "../../theme/tokens";

const TIER_DOT: Record<string, string> = {
  foreground: accent.main,
  mid: ink.secondary,
  background: status.warning,
};

export default function LanePill({
  tier,
  name,
  active,
  pending,
  cap,
}: {
  tier: string;
  name: string;
  active: number;
  pending: number;
  cap?: number;
}) {
  const full = cap != null && active >= cap && active > 0;
  return (
    <Stack
      component="span"
      direction="row"
      spacing={0.875}
      sx={{ alignItems: "center", px: 1, py: 0.375, borderRadius: 1, border: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}
      title={`${name}: ${active} active${cap != null ? ` of ${cap} lanes` : ""}, ${pending} queued${full ? " — saturated" : ""}`}
    >
      <Box component="span" sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: TIER_DOT[tier] ?? ink.secondary }} />
      <Box component="span" sx={{ fontSize: 13, color: "text.secondary", textTransform: "capitalize" }}>
        {tier}
      </Box>
      <Box component="span" sx={{ fontSize: 13, fontFamily: font.mono, fontWeight: 600, color: full ? "warning.main" : "text.primary" }}>
        {active}
        {cap != null && (
          <Box component="span" sx={{ color: "text.disabled", fontWeight: 400 }}>
            /{cap}
          </Box>
        )}
      </Box>
      {pending > 0 && (
        <Box component="span" sx={{ fontSize: 12.5, fontFamily: font.mono, color: "text.disabled" }} title={`${pending} queued`}>
          +{pending}
        </Box>
      )}
    </Stack>
  );
}
