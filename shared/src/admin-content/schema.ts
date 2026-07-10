import type { AdminEntityType } from "./types";

/**
 * One editable text field on an entity's edit form. `field` is BOTH the key in
 * the stored overrides map AND (by default) the base-entity property it
 * overrides at read time. `base` names a different base property when the two
 * diverge (e.g. an alert's `headline` lives at `info[0].headline`, applied in
 * the alert resolver, not by the generic shallow merge).
 */
export interface EditFieldSpec {
  field: string;
  label: string;
  type: "text" | "textarea";
  /** Base property this overrides; defaults to `field`. */
  base?: string;
  /** Placeholder / helper hint shown under the input. */
  hint?: string;
}

/** The edit definition for one admin-editable entity type. */
export interface EntitySchema {
  type: AdminEntityType;
  /** Singular display label, e.g. "City". */
  label: string;
  /** Plural display label, e.g. "Cities". */
  plural: string;
  /** The stable id field on the base entity used as the content `entityId`. */
  idField: string;
  /** Every visible text field the operator can override. */
  fields: EditFieldSpec[];
}

/**
 * The admin-editable text surface per entity. Keep these aligned with what the
 * detail page actually renders — "all visible text editable" means every field
 * a viewer sees on air / in the panel should appear here. Images are handled
 * uniformly by the image manager and aren't listed as fields.
 */
export const ENTITY_SCHEMAS: Record<AdminEntityType, EntitySchema> = {
  city: {
    type: "city",
    label: "City",
    plural: "Cities",
    idField: "id",
    fields: [
      { field: "name", label: "Name", type: "text" },
      { field: "country", label: "Country", type: "text" },
      { field: "region", label: "Region / state", type: "text" },
      { field: "wikiTitle", label: "Article title", type: "text" },
      { field: "wikiExtract", label: "Blurb", type: "textarea", hint: "The on-air description." },
    ],
  },
  country: {
    type: "country",
    label: "Country",
    plural: "Countries",
    idField: "countryId",
    fields: [
      { field: "name", label: "Name", type: "text" },
      { field: "capital", label: "Capital", type: "text" },
      { field: "continent", label: "Continent", type: "text" },
      { field: "subregion", label: "Subregion", type: "text" },
      { field: "currency", label: "Currency", type: "text" },
      { field: "wikiTitle", label: "Article title", type: "text" },
      { field: "wikiExtract", label: "Blurb", type: "textarea", hint: "The on-air description." },
    ],
  },
  region: {
    type: "region",
    label: "Region",
    plural: "Regions",
    idField: "regionId",
    fields: [
      { field: "name", label: "Name", type: "text" },
      { field: "wikiTitle", label: "Article title", type: "text" },
      { field: "wikiExtract", label: "Blurb", type: "textarea", hint: "The on-air description." },
    ],
  },
  volcano: {
    type: "volcano",
    label: "Volcano",
    plural: "Volcanoes",
    idField: "id",
    fields: [
      { field: "name", label: "Name", type: "text" },
      { field: "country", label: "Country", type: "text" },
      { field: "status", label: "Status", type: "text" },
      { field: "volcanoType", label: "Type", type: "text" },
      { field: "latestReport", label: "Latest report", type: "textarea" },
      { field: "usgsNoticeSynopsis", label: "USGS synopsis", type: "textarea" },
      { field: "wikiExtract", label: "Blurb", type: "textarea", hint: "The on-air description." },
    ],
  },
  alert: {
    type: "alert",
    label: "Alert",
    plural: "Alerts",
    idField: "id",
    // Applied to the alert's primary info block by the alert resolver.
    fields: [
      { field: "event", label: "Event", type: "text", base: "info.event" },
      { field: "headline", label: "Headline", type: "text", base: "info.headline" },
      { field: "description", label: "Description", type: "textarea", base: "info.description" },
      { field: "instruction", label: "Instruction", type: "textarea", base: "info.instruction" },
    ],
  },
  quake: {
    type: "quake",
    label: "Quake",
    plural: "Quakes",
    idField: "quakeId",
    fields: [
      { field: "place", label: "Place", type: "text", hint: "e.g. “12km SW of Reykjavík”." },
    ],
  },
  seismic: {
    type: "seismic",
    label: "Seismic station",
    plural: "Seismic stations",
    idField: "key",
    fields: [
      { field: "siteName", label: "Site name", type: "text" },
    ],
  },
};

/** The set of valid override keys for one entity type (for API validation). */
export const editableFieldKeys = (type: AdminEntityType): string[] =>
  ENTITY_SCHEMAS[type].fields.map((f) => f.field);
