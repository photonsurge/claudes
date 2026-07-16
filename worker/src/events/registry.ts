import type { iWatchedEvent } from "@photonsurge/shared/db/watched-event-model";
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

/**
 * Is there anything to acquire for this event at all?
 *
 * A watch schedule with no adapter behind it is a job that fetches nothing and
 * reports `changed: false` forever. 927 of 1,148 scheduled events (81%) were
 * exactly that — plain WEATHER_ALERTs whose only matching adapter was Copernicus,
 * which had never linked a single event in the layer's lifetime.
 *
 * Derived from the registry rather than a hardcoded type list, so the answer
 * follows the adapters: add one that serves weather alerts and they schedule
 * themselves again, with nothing here to remember to update.
 */
export const isServable = (event: iWatchedEvent): boolean =>
  enabledEventSources().some((s) => s.appliesTo(event));

export const getEventSource = (id: string): ExternalSource | undefined =>
  EVENT_SOURCES.find((s) => s.id === id);
