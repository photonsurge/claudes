"use client";

/**
 * /admin/content/[type] — the admin list for one editable entity type (city,
 * country, region, volcano, alert, quake, seismic). Every row links to its
 * detail subpage where the edit popover lives. Shows a hero thumbnail, an
 * "edited" marker and image count so curated items stand out. Client-side search
 * over the full list (no arbitrary caps — the whole catalog loads).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { isAdminEntityType } from "@photonsurge/shared/admin-content/types";
import { ENTITY_SCHEMAS } from "@photonsurge/shared/admin-content/schema";
import AdminPageShell from "../../../../components/admin/AdminPageShell";
import { adminMediaPath, listContent, type ContentListItem } from "../../../../lib/admin-content/client";

export default function AdminContentListPage() {
  const { type } = useParams<{ type: string }>();
  const valid = isAdminEntityType(type);
  const [items, setItems] = useState<ContentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!valid) return;
    let live = true;
    setLoading(true);
    listContent(type).then((rows) => {
      if (!live) return;
      setItems(rows);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [type, valid]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => `${i.name} ${i.subtitle}`.toLowerCase().includes(needle));
  }, [items, q]);

  if (!valid) {
    return (
      <AdminPageShell title="Content" description="Unknown entity type.">
        <Alert severity="error">No such content type.</Alert>
      </AdminPageShell>
    );
  }

  const schema = ENTITY_SCHEMAS[type];
  const editedCount = items.filter((i) => i.edited || i.imageCount > 0).length;
  const activeOnly = type === "alert" || type === "volcano" || type === "seismic";

  return (
    <AdminPageShell
      title={schema.plural}
      description={`Edit on-air text and images for ${schema.plural.toLowerCase()}${activeOnly ? " (active only)" : ""}. ${editedCount} curated.`}
      crumbs={[{ label: schema.plural }]}
      actions={
        <TextField
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${schema.plural.toLowerCase()}…`}
          sx={{ minWidth: 240 }}
        />
      }
    >
      {loading ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : filtered.length === 0 ? (
        <Typography color="text.secondary">{items.length ? "No matches." : "Nothing here yet."}</Typography>
      ) : (
        <Stack spacing={1}>
          <Typography variant="caption" color="text.disabled">
            {filtered.length.toLocaleString()} items
          </Typography>
          {filtered.map((i) => (
            <MuiLink
              key={i.id}
              component={Link}
              href={`/admin/content/${type}/${encodeURIComponent(i.id)}`}
              underline="none"
              color="inherit"
            >
              <Paper
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  px: 1.5,
                  py: 1,
                  transition: "border-color 120ms, background-color 120ms",
                  "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                }}
              >
                <Box
                  sx={{
                    width: 52,
                    height: 40,
                    borderRadius: 1,
                    bgcolor: "background.default",
                    flexShrink: 0,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "text.disabled",
                    fontSize: 18,
                  }}
                >
                  {i.primaryImageId ? (
                    <Box
                      component="img"
                      src={adminMediaPath(i.primaryImageId)}
                      alt=""
                      sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    "▦"
                  )}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {i.name || i.id}
                  </Typography>
                  {i.subtitle ? (
                    <Typography variant="caption" color="text.secondary" component="div">
                      {i.subtitle}
                    </Typography>
                  ) : null}
                </Box>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexShrink: 0 }}>
                  {i.edited ? <Chip color="warning" label="edited" /> : null}
                  {i.imageCount > 0 ? <Chip color="primary" label={`${i.imageCount} img`} /> : null}
                  <Box component="span" aria-hidden sx={{ color: "text.disabled" }}>
                    ›
                  </Box>
                </Stack>
              </Paper>
            </MuiLink>
          ))}
        </Stack>
      )}
    </AdminPageShell>
  );
}
