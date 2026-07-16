"use client";

/**
 * The admin surface's reusable overlay dialog — a centred panel over a scrim,
 * closable by Escape, backdrop click, or the × button. Lifted from the one-off
 * "debug" modal that lived inline in the alerts list so every edit popover
 * shares the same chrome + a11y.
 *
 * `disablePortal` is load-bearing: AdminPageShell zooms the page for the
 * text-size control, and CSS `zoom` only scales fixed-position descendants that
 * are still inside it — a portalled dialog would ignore the operator's setting.
 * It also keeps the modal's own scrollport (`.MuiDialog-container`) as the one
 * the sticky on-air preview column sticks within.
 */
import type { ReactNode } from "react";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export default function EditModal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 1040,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      disablePortal
      scroll="body"
      maxWidth={false}
      slotProps={{
        paper: { sx: { width: "100%", maxWidth: width, my: "5vh", mx: 2 } },
      }}
    >
      <Stack
        component="header"
        direction="row"
        spacing={1.5}
        sx={{
          alignItems: "flex-start",
          justifyContent: "space-between",
          px: 2.25,
          py: 1.75,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography variant="h2" component="div" sx={{ minWidth: 0 }}>
          {title}
          {subtitle ? (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.375, fontWeight: 400, letterSpacing: 0 }}>
              {subtitle}
            </Typography>
          ) : null}
        </Typography>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ flexShrink: 0, border: 1, borderColor: "divider", borderRadius: 1, width: 30, height: 30, fontSize: 16 }}
        >
          ×
        </IconButton>
      </Stack>

      <DialogContent sx={{ p: 2.25 }}>{children}</DialogContent>

      {footer ? (
        <DialogActions sx={{ px: 2.25, py: 1.5, gap: 1.25, borderTop: 1, borderColor: "divider" }}>{footer}</DialogActions>
      ) : null}
    </Dialog>
  );
}
