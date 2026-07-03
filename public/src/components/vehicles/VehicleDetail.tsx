"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getVehicle, queueVehicleEnrichment, type VehicleRecord } from "../../lib/vehicles/client";
import { asOf, primary } from "../tracks/styles";

const muted = "#8b95a7";
const panel = { border: "1px solid #1b2030", borderRadius: 8, background: "#0c111c" } as const;

function displayName(vehicle: VehicleRecord): string {
  return vehicle.label?.trim() || vehicle.wikiTitle?.trim() || vehicle.name?.trim() || vehicle.code.toUpperCase();
}

function formatDate(value?: string | number): string {
  if (value == null) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt style={{ color: muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</dt>
      <dd style={{ margin: "3px 0 0", fontSize: 13, overflowWrap: "anywhere" }}>{children ?? "—"}</dd>
    </div>
  );
}

function SourceStatus({ name, state, detail }: { name: string; state: "ready" | "miss" | "pending"; detail: string }) {
  const color = state === "ready" ? "#34d399" : state === "miss" ? "#fbbf24" : muted;
  return (
    <div style={{ ...panel, padding: 10 }}>
      <div style={{ color, fontSize: 12 }}>● {name}</div>
      <div style={{ ...asOf, marginTop: 4 }}>{detail}</div>
    </div>
  );
}

export default function VehicleDetail({ id }: { id: string }) {
  const [vehicle, setVehicle] = useState<VehicleRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getVehicle(id);
    if (result.vehicle) setVehicle(result.vehicle);
    else setError(result.error ?? "Could not load this vehicle.");
    setLoading(false);
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading && !vehicle) return <div style={{ ...panel, padding: 18, color: muted }}>Loading vehicle…</div>;
  if (!vehicle) return <div role="alert" style={{ ...panel, padding: 18, color: "#fca5a5" }}>{error ?? "Vehicle not found."}</div>;

  const meta = vehicle.aircraftMeta;
  const type = vehicle.type || meta?.type;
  const operator = vehicle.operator || meta?.operator;
  const manufacturer = vehicle.manufacturer || meta?.manufacturer;
  const registration = vehicle.registration || meta?.registration;
  const photo = vehicle.photoUrlOverride || vehicle.photoUrl;
  const blurb = vehicle.blurbOverride || vehicle.wikiExtract;
  const metaState = meta?.notFound ? "miss" : meta ? "ready" : "pending";
  const wikiState = vehicle.wikiFetchedAt ? (vehicle.wikiExtract ? "ready" : "miss") : "pending";
  const photoState = vehicle.photoFetchedAt ? (vehicle.photoUrl ? "ready" : "miss") : "pending";

  const enrich = async () => {
    setBusy(true);
    setNote(null);
    const result = await queueVehicleEnrichment(vehicle);
    if (result.vehicle) {
      setVehicle((current) => current ? { ...current, ...result.vehicle } : result.vehicle!);
      setNote("Enrichment queued. Refresh after the worker has run.");
    } else {
      setNote(result.error ?? "Could not queue enrichment.");
    }
    setBusy(false);
  };

  return (
    <div>
      <Link href="/admin/vehicles" style={{ color: "#60a5fa", textDecoration: "none", fontSize: 13 }}>← Vehicles in DB</Link>
      <article style={{ ...panel, padding: 18, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0 }}>{displayName(vehicle)}</h2>
              <span style={{ color: muted, fontSize: 12 }}>{vehicle.kind === "aircraft" ? "Aircraft" : "Ship"}</span>
              {vehicle.notable && <span style={{ color: "#ffd76a", fontSize: 12 }}>★ notable</span>}
              {vehicle.vip && <span style={{ color: "#f0abfc", fontSize: 12 }}>VIP</span>}
            </div>
            <div style={{ ...asOf, marginTop: 5 }}>{vehicle.id}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={enrich} disabled={busy} style={primary}>
              {busy ? "…" : vehicle.notable ? "Re-run enrichment" : "Make notable + enrich"}
            </button>
            <button type="button" onClick={refresh} disabled={busy || loading} style={{ ...primary, background: "#1a1f2b" }}>Refresh result</button>
          </div>
        </div>

        {note && <div role="status" style={{ ...asOf, color: note.includes("Could not") ? "#fca5a5" : "#a7f3d0", marginTop: 10 }}>{note}</div>}
        {error && <div role="alert" style={{ ...asOf, color: "#fca5a5" }}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: photo ? "minmax(260px, .8fr) minmax(0, 1.2fr)" : "1fr", gap: 20, marginTop: 18 }}>
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 7, background: "#080b11" }} />
          )}
          <div>
            <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>Identity</h3>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "13px 16px", margin: 0 }}>
              <Field label={vehicle.kind === "aircraft" ? "ICAO24" : "MMSI"}>{vehicle.code}</Field>
              <Field label="Callsign / name">{vehicle.name || "—"}</Field>
              <Field label="Registration / IMO">{registration || vehicle.imo || "—"}</Field>
              <Field label="Country">{[vehicle.flag, vehicle.country].filter(Boolean).join(" ") || "—"}</Field>
              <Field label="Type">{type || "—"}</Field>
              <Field label="Type code">{meta?.typeCode || "—"}</Field>
              <Field label="Manufacturer">{manufacturer || "—"}</Field>
              <Field label="Operator">{operator || "—"}</Field>
            </dl>
            {blurb && <p style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.55, margin: "18px 0 0" }}>{blurb}</p>}
          </div>
        </div>

        <h3 style={{ fontSize: 14, margin: "22px 0 10px" }}>Enrichment sources</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
          {vehicle.kind === "aircraft" && (
            <SourceStatus
              name="hexdb aircraft metadata"
              state={metaState}
              detail={meta ? `${meta.notFound ? "No match" : "Cached match"} · ${formatDate(meta.fetchedAt)}` : "Not yet present in the cache"}
            />
          )}
          <SourceStatus name="Wikipedia summary" state={wikiState} detail={vehicle.wikiFetchedAt ? `${vehicle.wikiExtract ? "Stored result" : "No match"} · ${formatDate(vehicle.wikiFetchedAt)}` : "Not run"} />
          {vehicle.kind === "aircraft" && (
            <SourceStatus name="Planespotters photo" state={photoState} detail={vehicle.photoFetchedAt ? `${vehicle.photoUrl ? "Stored result" : "No match"} · ${formatDate(vehicle.photoFetchedAt)}` : "Not run"} />
          )}
        </div>

        <h3 style={{ fontSize: 14, margin: "22px 0 10px" }}>Lifecycle</h3>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "13px 16px", margin: 0 }}>
          <Field label="First seen">{formatDate(vehicle.firstSeen)}</Field>
          <Field label="Last seen">{formatDate(vehicle.lastSeen)}</Field>
          <Field label="Sightings">{vehicle.timesSeen?.toLocaleString() ?? "—"}</Field>
          <Field label="Last position">{vehicle.lastLat != null && vehicle.lastLng != null ? `${vehicle.lastLat.toFixed(4)}, ${vehicle.lastLng.toFixed(4)}` : "—"}</Field>
          <Field label="Saved path points">{vehicle.pathPoints ?? vehicle.path?.length ?? 0}</Field>
          <Field label="Record updated">{formatDate(vehicle.updated)}</Field>
        </dl>

        {(vehicle.photoLink || vehicle.photoUrl) && (
          <div style={{ display: "flex", gap: 12, marginTop: 14, fontSize: 12 }}>
            {vehicle.photoLink && <a href={vehicle.photoLink} target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>Photo source ↗</a>}
            {vehicle.photoUrl && <a href={vehicle.photoUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>Image URL ↗</a>}
          </div>
        )}
        {vehicle.notes && <p style={{ color: "#cbd5e1", fontSize: 13 }}><span style={{ color: muted }}>Notes: </span>{vehicle.notes}</p>}

        <details style={{ marginTop: 18 }}>
          <summary style={{ color: muted, fontSize: 12, cursor: "pointer" }}>Raw DB/API record</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11, color: "#aab4c5", background: "#080b11", padding: 10, borderRadius: 6, maxHeight: 420, overflow: "auto" }}>
            {JSON.stringify(vehicle, null, 2)}
          </pre>
        </details>
      </article>
    </div>
  );
}
