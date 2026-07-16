"use client";

/**
 * The uniform image manager for any admin entity: a gallery of uploaded images
 * with upload (file), set-primary (the hero used on air), caption/credit edit
 * and delete. Bytes are stored in Mongo and served from /api/media/:id; this
 * component only ever deals in metadata + the serve URL. Notifies the parent on
 * any change so the on-air preview + list thumbnails refresh.
 */
import { useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { AdminEntityType } from "@photonsurge/shared/admin-content/types";
import {
  adminMediaPath,
  deleteImage,
  patchImage,
  setPrimaryImage,
  uploadImage,
  type AdminImage,
} from "../../../lib/admin-content/client";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";

export default function ImageManager({
  type,
  entityId,
  images,
  onChange,
}: {
  type: AdminEntityType;
  entityId: string;
  images: AdminImage[];
  onChange: (images: AdminImage[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = (next: AdminImage[]) => onChange(next);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true);
    setNote(null);
    const added: AdminImage[] = [];
    for (const file of files) {
      const res = await uploadImage(type, entityId, file);
      if ("error" in res) {
        setNote(res.error);
        break;
      }
      added.push(res.image);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (added.length) refresh([...images, ...added]);
  };

  const makePrimary = async (id: string) => {
    setBusy(true);
    const res = await setPrimaryImage(type, entityId, id);
    setBusy(false);
    if ("error" in res) return setNote(res.error);
    refresh(images.map((im) => ({ ...im, primary: im.id === id })));
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this image?")) return;
    setBusy(true);
    const res = await deleteImage(type, entityId, id);
    setBusy(false);
    if ("error" in res) return setNote(res.error);
    const next = images.filter((im) => im.id !== id);
    // If we removed the primary, the server promotes the next one — mirror that.
    if (!next.some((im) => im.primary) && next[0]) next[0] = { ...next[0], primary: true };
    refresh(next);
  };

  const saveMeta = async (id: string, patch: { caption?: string; credit?: string }) => {
    const res = await patchImage(type, entityId, id, patch);
    if ("error" in res) return setNote(res.error);
    refresh(images.map((im) => (im.id === id ? res.image : im)));
  };

  return (
    <Box>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mb: 1.25 }}>
        {/* Upload is what this panel exists for, so it's the one filled button. */}
        <Button variant="contained" component="label" sx={{ cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Uploading…" : "＋ Upload image"}
          <Box
            component="input"
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            onChange={onUpload}
            disabled={busy}
            sx={{ display: "none" }}
          />
        </Button>
        <Typography variant="caption" color="text.disabled">
          PNG/JPEG/WebP/GIF/AVIF · up to 12 MB
        </Typography>
        {note ? (
          <Typography variant="caption" color="error.main">
            {note}
          </Typography>
        ) : null}
      </Stack>

      {images.length === 0 ? (
        <Typography variant="body2" color="text.disabled" sx={{ py: 1.25 }}>
          No images yet. The first you upload becomes the primary (on-air) image.
        </Typography>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 1.25 }}>
          {images.map((im) => (
            <Paper
              key={im.id}
              sx={{
                overflow: "hidden",
                bgcolor: "background.default",
                // The hero going to air earns the only coloured edge here.
                borderColor: im.primary ? "warning.main" : "divider",
              }}
            >
              <Box sx={{ position: "relative" }}>
                <Box
                  component="img"
                  src={adminMediaPath(im.id, im.updatedAt)}
                  alt={im.caption ?? ""}
                  sx={{ width: "100%", height: 100, objectFit: "cover", display: "block" }}
                />
                {im.primary ? (
                  <Chip
                    variant="filled"
                    color="warning"
                    label="★ PRIMARY"
                    sx={{ position: "absolute", top: 6, left: 6, color: "background.default" }}
                  />
                ) : null}
              </Box>
              <Stack spacing={0.75} sx={{ p: 1 }}>
                <TextField
                  defaultValue={im.caption ?? ""}
                  placeholder="Caption"
                  onBlur={(e) => e.target.value !== (im.caption ?? "") && saveMeta(im.id, { caption: e.target.value })}
                  fullWidth
                />
                <TextField
                  defaultValue={im.credit ?? ""}
                  placeholder="Credit"
                  onBlur={(e) => e.target.value !== (im.credit ?? "") && saveMeta(im.id, { credit: e.target.value })}
                  fullWidth
                />
                <Stack direction="row" spacing={0.75}>
                  <Button
                    variant="outlined"
                    onClick={() => makePrimary(im.id)}
                    disabled={busy || im.primary}
                    sx={{ flex: 1 }}
                  >
                    {im.primary ? "Primary" : "Set primary"}
                  </Button>
                  <Button variant="outlined" color="error" onClick={() => remove(im.id)} disabled={busy}>
                    Delete
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}
