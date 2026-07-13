"use client";

/**
 * /admin/events — the unified WatchedEvent list. Every significant alert (and
 * later quake) promoted by the ingest bridge appears here as a cross-source event
 * dossier; click through to its timeline, sources, resources and snapshots.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { useTableSort } from "../../../components/admin/useTableSort";
import { getEventList, eventStatusColor } from "../../../lib/events";
import type { iWatchedEvent } from "@photonsurge/shared/db/watched-event-model";

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

const cell: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid #1c2333", fontSize: 13 };
const head: React.CSSProperties = { ...cell, color: "#8b95a7", fontWeight: 600, textAlign: "left" };

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
        <p style={{ color: "#8b95a7" }}>Loading…</p>
      ) : events.length === 0 ? (
        <p style={{ color: "#8b95a7" }}>
          No watched events yet. Promotion is opt-in — set <code>EVENTS_UNIFIED_ENABLED=true</code> and run the alert
          ingest so significant alerts become events.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={head}>{sorted.header("event", "Event")}</th>
                <th style={head}>{sorted.header("type", "Type")}</th>
                <th style={head}>{sorted.header("status", "Status")}</th>
                <th style={head}>{sorted.header("primary", "Primary")}</th>
                <th style={head}>{sorted.header("started", "Started")}</th>
                <th style={head}>{sorted.header("checked", "Last checked")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((e) => (
                <tr key={e.id}>
                  <td style={cell}>
                    <Link href={`/admin/events/${e.id}`} style={{ color: "#60a5fa", textDecoration: "none" }}>
                      {e.title || e.primarySourceId}
                    </Link>
                  </td>
                  <td style={cell}>{e.type}</td>
                  <td style={cell}>
                    <span style={{ color: eventStatusColor(e.status), fontWeight: 600 }}>{e.status}</span>
                  </td>
                  <td style={cell}>
                    {e.primarySource}:{e.primarySourceId}
                  </td>
                  <td style={cell}>{fmtTime(e.startedAt)}</td>
                  <td style={cell}>{fmtTime(e.lastCheckedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminPageShell>
  );
}
