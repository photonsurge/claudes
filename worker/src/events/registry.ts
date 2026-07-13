import type { ExternalSource } from "./source-types";
import { gdacsDetailSource } from "./gdacs-detail";
import { eonetSource } from "./eonet";
import { copernicusSource } from "./copernicus";

/**
 * The external-source registry. `events.acquire` runs every ENABLED adapter whose
 * `appliesTo(event)` matches, so each source stays independent and self-gates.
 * Mirrors alerts/registry.ts. Order is unimportant (adapters don't interact).
 */
export const EVENT_SOURCES: ExternalSource[] = [gdacsDetailSource, eonetSource, copernicusSource];

export const enabledEventSources = (): ExternalSource[] => EVENT_SOURCES.filter((s) => s.enabled());

export const getEventSource = (id: string): ExternalSource | undefined =>
  EVENT_SOURCES.find((s) => s.id === id);
