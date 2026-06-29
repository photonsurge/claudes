/**
 * Operator-triggerable worker jobs — the single source of truth for the admin
 * "Jobs" panel and the enqueue API. Each maps to a BullMQ `{ domain, type, event }`
 * routed to `worker/src/jobs/<type>.ts#<event>`. Keep this an allowlist so the
 * admin can only enqueue known, safe jobs.
 */
export interface TriggerableJob {
  id: string;
  label: string;
  description: string;
  domain: string;
  type: string;
  event: string;
}

export const TRIGGERABLE_JOBS: TriggerableJob[] = [
  {
    id: "alerts-ingest",
    label: "Ingest alerts",
    description: "Pull active NWS alerts into Mongo.",
    domain: "alerts",
    type: "alerts",
    event: "ingest",
  },
  {
    id: "tles",
    label: "Refresh satellite TLEs",
    description: "Fetch the configured Celestrak groups into Mongo.",
    domain: "tracks",
    type: "tracks",
    event: "ingestTles",
  },
  {
    id: "snapshot-aircraft",
    label: "Snapshot aircraft",
    description: "Cache a fresh ADS-B frame for the overlay.",
    domain: "tracks",
    type: "tracks",
    event: "snapshotAircraft",
  },
  {
    id: "snapshot-ships",
    label: "Snapshot ships",
    description: "Cache a fresh AIS frame (needs AISSTREAM_API_KEY).",
    domain: "tracks",
    type: "tracks",
    event: "snapshotShips",
  },
  {
    id: "snapshot-seismic",
    label: "Snapshot earthquakes",
    description: "Cache recent USGS earthquakes for the overlay.",
    domain: "tracks",
    type: "tracks",
    event: "snapshotSeismic",
  },
  {
    id: "weather-check",
    label: "Check weather run",
    description: "Look for a newer GFS run and bake it.",
    domain: "weather",
    type: "weather",
    event: "check",
  },
];

export const getTriggerableJob = (id: string): TriggerableJob | undefined =>
  TRIGGERABLE_JOBS.find((j) => j.id === id);
