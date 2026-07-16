"use client";

/**
 * /admin/events — the unified WatchedEvent list. Every significant alert (and
 * later quake) promoted by the ingest bridge appears here as a cross-source event
 * dossier; click through to its timeline, sources, resources and snapshots.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { useTableSort } from "../../../components/admin/useTableSort";
import { getEventList, eventStatusColor } from "../../../lib/events";
import type { iWatchedEvent } from "@photonsurge/shared/db/watched-event-model";

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

export default function EventsListPage() {
  const [events, setEvents] = useState<iWatchedEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getEventList()
      .then((e) => setEvents(e))
      .finally(() => setLoading(false));
  }, []);
  const sorted = useTableSort(events, {
    event: (e) => e.title || e.primarySourceId,
    type: (e) => e.type,
    status: (e) => e.status,
    primary: (e) => `${e.primarySource}:${e.primarySourceId}`,
    started: (e) => e.startedAt,
    checked: (e) => e.lastCheckedAt,
  }, "checked", true);

  return (
    <AdminPageShell
      title="Watched Events"
      description="Cross-source event dossiers — promoted from significant alerts, enriched by external sources."
      crumbs={[{ label: "Watched Events" }]}
    >
      {loading ? (
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      ) : events.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No watched events yet. Promotion is opt-in — set <code>EVENTS_UNIFIED_ENABLED=true</code> and run the alert
          ingest so significant alerts become events.
        </Typography>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{sorted.header("event", "Event")}</TableCell>
                <TableCell>{sorted.header("type", "Type")}</TableCell>
                <TableCell>{sorted.header("status", "Status")}</TableCell>
                <TableCell>{sorted.header("primary", "Primary")}</TableCell>
                <TableCell>{sorted.header("started", "Started")}</TableCell>
                <TableCell>{sorted.header("checked", "Last checked")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <MuiLink component={Link} href={`/admin/events/${e.id}`}>
                      {e.title || e.primarySourceId}
                    </MuiLink>
                  </TableCell>
                  <TableCell>{e.type}</TableCell>
                  <TableCell>
                    <Box component="span" sx={{ color: eventStatusColor(e.status), fontWeight: 600 }}>
                      {e.status}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <code>
                      {e.primarySource}:{e.primarySourceId}
                    </code>
                  </TableCell>
                  <TableCell>
                    <code>{fmtTime(e.startedAt)}</code>
                  </TableCell>
                  <TableCell>
                    <code>{fmtTime(e.lastCheckedAt)}</code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </AdminPageShell>
  );
}
