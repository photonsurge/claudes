"use client";

/**
 * A settings section that is greyed out (and inert) with its reason when the
 * switch that gates it is off — so nothing on a card looks armed that cannot
 * fire.
 */
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/** A section that is greyed out (and inert) with its reason when its gate is off. */
export default function Gated({ off, reason, children }: { off: boolean; reason: string; children: ReactNode }) {
  return (
    <Box aria-disabled={off} sx={{ opacity: off ? 0.5 : 1, pointerEvents: off ? "none" : undefined }}>
      {off ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          {reason}
        </Typography>
      ) : null}
      {children}
    </Box>
  );
}

