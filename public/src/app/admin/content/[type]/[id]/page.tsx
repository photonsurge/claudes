"use client";

/**
 * /admin/content/[type]/[id] — one entity's detail: its current on-air text +
 * images, a live ON-AIR PREVIEW, and the ✎ Edit popover (text + image manager +
 * preview). Everything here is the override-applied view, so it reflects what's
 * actually going to air.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { isAdminEntityType } from "@photonsurge/shared/admin-content/types";
import { ENTITY_SCHEMAS } from "@photonsurge/shared/admin-content/schema";
import AdminPageShell from "../../../../../components/admin/AdminPageShell";
import ContentEditorModal from "../../../../../components/admin/content/ContentEditorModal";
import OnAirPreview from "../../../../../components/admin/content/OnAirPreview";
import { adminMediaPath, getContent, type ResolvedContent } from "../../../../../lib/admin-content/client";

export default function AdminContentDetailPage() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const valid = isAdminEntityType(type);
  const [content, setContent] = useState<ResolvedContent | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);

  const reload = useCallback(async () => {
    if (!valid) return;
    const c = await getContent(type, decodeURIComponent(id));
    if (!c) setMissing(true);
    else {
      setContent(c);
      setMissing(false);
    }
  }, [type, id, valid]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!valid) {
    return (
      <AdminPageShell title="Content">
        <Alert severity="error">No such content type.</Alert>
      </AdminPageShell>
    );
  }

  const schema = ENTITY_SCHEMAS[type];
  const name = (content?.entity?.name as string) || content?.entityId || decodeURIComponent(id);

  return (
    <AdminPageShell
      title={name}
      crumbs={[
        { href: `/admin/content/${type}`, label: schema.plural },
        { label: name },
      ]}
      actions={
        content ? (
          // The one genuinely primary action on this page, so it earns the fill
          // (DESIGN_BIBLE §5.6 — everything else here stays quiet).
          <Button variant="contained" onClick={() => setEditing(true)}>
            ✎ Edit
          </Button>
        ) : null
      }
    >
      {missing ? (
        <Alert severity="error">This item no longer exists.</Alert>
      ) : !content ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 470px", gap: 3, alignItems: "start" }}>
          <Stack spacing={2.5}>
            <Box component="section">
              <SectionLabel>Text</SectionLabel>
              <Stack spacing={1.25}>
                {schema.fields.map((f) => {
                  const value = fieldValue(type, content.entity, f.field);
                  const overridden = !!content.text[f.field];
                  return (
                    <Box key={f.field}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                        <Typography variant="caption" color="text.disabled">
                          {f.label}
                        </Typography>
                        {overridden ? (
                          <Typography variant="caption" color="warning.main" sx={{ fontWeight: 800 }}>
                            ● edited
                          </Typography>
                        ) : null}
                      </Stack>
                      <Typography color={value ? "text.primary" : "text.disabled"} sx={{ whiteSpace: "pre-wrap" }}>
                        {value || "—"}
                      </Typography>
                    </Box>
                  );
                })}
              </Stack>
            </Box>

            <Box component="section">
              <SectionLabel>Images ({content.images.length})</SectionLabel>
              {content.images.length === 0 ? (
                <Typography variant="body2" color="text.disabled">
                  No images. Use Edit to upload.
                </Typography>
              ) : (
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
                  {content.images.map((im) => (
                    <Box key={im.id} sx={{ position: "relative" }}>
                      <Box
                        component="img"
                        src={adminMediaPath(im.id, im.updatedAt)}
                        alt={im.caption ?? ""}
                        sx={{
                          width: 130,
                          height: 90,
                          objectFit: "cover",
                          borderRadius: 1,
                          // The hero going to air is the one thing worth spotting
                          // in a wall of thumbnails.
                          border: im.primary ? 2 : 1,
                          borderColor: im.primary ? "warning.main" : "divider",
                        }}
                      />
                      {im.primary ? (
                        <Box
                          component="span"
                          sx={{
                            position: "absolute",
                            top: 4,
                            left: 4,
                            bgcolor: "warning.main",
                            color: "background.default",
                            fontSize: 9,
                            fontWeight: 800,
                            px: 0.625,
                            py: "1px",
                            borderRadius: 0.5,
                          }}
                        >
                          ★
                        </Box>
                      ) : null}
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>
          </Stack>

          <Box sx={{ position: "sticky", top: 16 }}>
            <OnAirPreview type={type} entity={content.entity ?? {}} images={content.images} />
          </Box>
        </Box>
      )}

      {editing && content ? (
        <ContentEditorModal
          type={type}
          id={content.entityId}
          label={name}
          onClose={() => setEditing(false)}
          onChanged={reload}
        />
      ) : null}
    </AdminPageShell>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="overline" color="text.secondary" component="div" sx={{ mb: 1.25 }}>
      {children}
    </Typography>
  );
}

/** The displayed value of an editable field (alerts read from info[0]). */
function fieldValue(type: string, entity: Record<string, any> | null, field: string): string {
  if (!entity) return "";
  const source = type === "alert" ? (Array.isArray(entity.info) && entity.info[0]) || {} : entity;
  const v = source[field];
  return v === undefined || v === null ? "" : String(v);
}
