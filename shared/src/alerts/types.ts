import type {
  AlertGeometry,
  AlertMsgType,
  AlertStatus,
  AlertScope,
  SeverityRank,
  iAlert,
} from "../db/alert-model";

/**
 * Adapter contract (spec §6). Every source implements the same three steps so
 * adding a region is one new file: fetch → parse → normalise. `CapMessage` is a
 * thin intermediate decoupling format-specific parsing from the lifecycle/derived
 * fields that `canonicaliseCapMessages` fills in identically for every source.
 */

export interface RawPayload {
  contentType: string;
  /** Raw XML / Atom / JSON / RSS as fetched. */
  body: string;
  fetchedAt: string;
}

export interface CapArea {
  areaDesc: string;
  geometry?: AlertGeometry | null;
  geocodes: { valueName: string; value: string }[];
}

export interface CapInfo {
  language?: string;
  category: string[];
  event: string;
  urgency?: string;
  severity?: string;
  certainty?: string;
  /** Normalised 0–4 — the adapter fills this since the native scale is source-specific. */
  severityRank: SeverityRank;
  onset?: string;
  effective?: string;
  expires?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  web?: string;
  sourceSeverity?: string;
  parameters?: Record<string, string>;
  area: CapArea[];
}

/** Parsed CAP message before lifecycle/derived fields are computed. */
export interface CapMessage {
  source: string;
  identifier: string;
  sender: string;
  sent: string;
  msgType: AlertMsgType;
  status: AlertStatus;
  scope?: AlertScope;
  /** Each "sender,identifier,sent" this message supersedes. */
  references: string[];
  info: CapInfo[];
  raw?: unknown;
}

export interface AlertSource {
  id: string;
  region: string;
  pollIntervalSec: number;
  enabled: boolean;
  /**
   * When true, the feed is a reliable full snapshot of "all currently active"
   * for this source, so alerts NOT in a tick's batch are treated as withdrawn
   * and deactivated (not just time-expired). Leave false for fan-out feeds that
   * can partially fail (e.g. MeteoAlarm's per-country fetches), where a missing
   * alert may just be a transient gap.
   */
  reconcile?: boolean;

  /** HTTP(s) fetch; sets required headers (e.g. NWS User-Agent). */
  fetch(): Promise<RawPayload[]>;
  /** Format-specific parse into intermediate CAP messages. */
  parse(raw: RawPayload[]): CapMessage[];
  /**
   * OPTIONAL fused fetch+parse that never materialises the raw payloads —
   * for feeds big enough that buffering the whole snapshot as a string (plus
   * its parsed tree) dominates the worker's heap (WMO streams features off the
   * socket; MeteoAlarm parses per country and releases). When present, ingest
   * uses this and skips fetch()/parse(), which remain for tests and probes.
   * May THROW on a malformed body where parse() would return [] — on a
   * reconcile source, "zero messages" from a bad response would deactivate
   * every live alert, so failing the tick is the safe behaviour.
   */
  fetchParsed?(): Promise<CapMessage[]>;
  /** CAP → canonical (fills lifecycle/derived). Usually delegates to the shared helper. */
  normalise(msgs: CapMessage[], now?: Date): iAlert[];
}
