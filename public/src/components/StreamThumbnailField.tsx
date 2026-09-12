"use client";

/**
 * Thumbnail source for a run / constant stream: an http(s) URL or a site path
 * ("/images/wind.png"). Blank = the horizontal logo. Whatever is given is
 * letterboxed to 1280×720 by the worker, so any decodable image works. Shows
 * the image so the operator can check it before the broadcast is created.
 */
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  DEFAULT_THUMBNAIL_PATH,
  normalizeThumbnailSource,
  resolveThumbnailUrl,
} from "@photonsurge/shared/stream-description";

export default function StreamThumbnailField({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) {
  const normalized = normalizeThumbnailSource(value);
  const invalid = normalized === null;
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";
  const previewUrl = invalid ? null : resolveThumbnailUrl(normalized, siteUrl);
  return (
    <Box sx={{ width: "100%", minWidth: 0, display: "flex", gap: 1.5, alignItems: "flex-start", flexWrap: "wrap" }}>
      <TextField
        sx={{ flex: 1, minWidth: 240 }}
        label="Thumbnail image (optional)" value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={DEFAULT_THUMBNAIL_PATH}
        error={invalid}
        helperText={invalid
          ? "Use an http(s) URL or a site path starting with /"
          : "An image URL or a path on this site. Any size — it is letterboxed to 1280×720. Blank = the logo. Custom thumbnails need a phone-verified YouTube channel."}
      />
      {previewUrl && (
        <Box sx={{ width: 192, aspectRatio: "16 / 9", bgcolor: "#080c18", borderRadius: 1, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="thumbnail preview" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </Box>
      )}
      {!previewUrl && (
        <Typography variant="caption" color="error">No preview</Typography>
      )}
    </Box>
  );
}
