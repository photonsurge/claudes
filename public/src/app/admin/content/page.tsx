"use client";

/**
 * /admin/content — the content-editor hub: pick a catalog/signal type to edit
 * its items' on-air text + images. Each card deep-links to that type's list
 * (/admin/content/[type]), where every item opens an edit popover with a live
 * on-air preview.
 */
import Link from "next/link";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { ADMIN_ENTITY_TYPES } from "@photonsurge/shared/admin-content/types";
import { ENTITY_SCHEMAS } from "@photonsurge/shared/admin-content/schema";
import AdminPageShell from "../../../components/admin/AdminPageShell";

const DESC: Record<string, string> = {
  city: "City markers — name, blurb and on-air imagery.",
  country: "Countries — capital, blurb, currency and imagery.",
  region: "Oceans, continents and blocs — name, blurb and imagery.",
  volcano: "Active volcanoes — status, reports, blurb and imagery.",
  alert: "Weather alerts — headline, description and instruction.",
  quake: "Earthquakes — place label and imagery.",
  seismic: "Seismic stations — site name and imagery.",
};

const ICON: Record<string, string> = {
  city: "🏙️",
  country: "🏳️",
  region: "🌍",
  volcano: "🌋",
  alert: "⚠️",
  quake: "🌐",
  seismic: "📡",
};

export default function AdminContentHub() {
  return (
    <AdminPageShell
      title="Content editor"
      description="Edit the on-air text and images for any catalog or signal item — with a live preview of how it looks on air. Edits survive feed refreshes."
      crumbs={[{ label: "Content" }]}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 1.5 }}>
        {ADMIN_ENTITY_TYPES.map((type) => (
          <MuiLink
            key={type}
            component={Link}
            href={`/admin/content/${type}`}
            underline="none"
            color="inherit"
            sx={{ display: "block", height: "100%" }}
          >
            <Paper
              sx={{
                p: 2,
                height: "100%",
                // The one affordance the flat palette allows — the hairline picks
                // up the accent so the card reads as a target.
                transition: "border-color 120ms, background-color 120ms",
                "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Box component="span" aria-hidden sx={{ fontSize: 18 }}>
                  {ICON[type]}
                </Box>
                <Typography variant="h3" component="h3">
                  {ENTITY_SCHEMAS[type].plural}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                {DESC[type]}
              </Typography>
            </Paper>
          </MuiLink>
        ))}
      </Box>
    </AdminPageShell>
  );
}
