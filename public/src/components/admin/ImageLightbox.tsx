"use client";

import { useEffect } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { surface } from "../../theme/tokens";

export interface LightboxImage {
  src: string;
  alt: string;
  caption?: string;
}

export default function ImageLightbox({ image, onClose }: { image: LightboxImage; onClose: () => void }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "grid",
        gridTemplateRows: "1fr auto",
        placeItems: "center",
        p: 3,
        boxSizing: "border-box",
        // Near-opaque page tone: a lightbox is the one admin surface that should
        // black out everything behind the picture it's showing.
        bgcolor: alpha(surface.sunken, 0.96),
      }}
    >
      <IconButton
        aria-label="Close image preview"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        sx={{
          position: "fixed",
          top: 18,
          right: 20,
          zIndex: 1,
          width: 42,
          height: 42,
          border: 1,
          borderColor: "divider",
          borderRadius: "999px",
          color: "text.primary",
          bgcolor: alpha(surface.raised, 0.85),
          fontSize: 25,
          lineHeight: 1,
        }}
      >
        ×
      </IconButton>
      <Box
        component="img"
        src={image.src}
        alt={image.alt}
        onClick={(event: React.MouseEvent) => event.stopPropagation()}
        sx={{ maxWidth: "100%", maxHeight: "calc(100vh - 90px)", objectFit: "contain", borderRadius: 1 }}
      />
      {image.caption && (
        <Typography
          variant="body2"
          color="text.secondary"
          onClick={(event) => event.stopPropagation()}
          sx={{ pt: 1.5 }}
        >
          {image.caption}
        </Typography>
      )}
    </Box>
  );
}
