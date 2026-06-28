"use client";

/**
 * Add/edit a city. Fields: name/country/lat/lng/population/isCapital, plus
 * add-via-geocode (fills lat/lng/name from a place search). Validation uses the
 * shared pure `validateCity`.
 */
import { useState } from "react";
import { geocode } from "../lib/geocode";
import { validateCity, type ValidatedCity } from "../lib/cities";

export interface CityEditorProps {
  initial?: Partial<ValidatedCity>;
  submitLabel?: string;
  onSubmit: (city: ValidatedCity) => void | Promise<void>;
  onCancel?: () => void;
}

type FormState = {
  name: string;
  country: string;
  lat: string;
  lng: string;
  population: string;
  isCapital: boolean;
};

export default function CityEditor({
  initial,
  submitLabel = "Save",
  onSubmit,
  onCancel,
}: CityEditorProps) {
  const [form, setForm] = useState<FormState>({
    name: initial?.name ?? "",
    country: initial?.country ?? "",
    lat: initial?.lat !== undefined ? String(initial.lat) : "",
    lng: initial?.lng !== undefined ? String(initial.lng) : "",
    population: initial?.population !== undefined ? String(initial.population) : "",
    isCapital: initial?.isCapital ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [geoBusy, setGeoBusy] = useState(false);

  const set = (k: keyof FormState, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const fillFromGeocode = async () => {
    if (!form.name.trim()) return;
    setGeoBusy(true);
    const hit = await geocode(form.name);
    setGeoBusy(false);
    if (!hit) {
      setErrors((e) => ({ ...e, name: "No geocode result" }));
      return;
    }
    setForm((f) => ({
      ...f,
      lng: String(hit.center[0]),
      lat: String(hit.center[1]),
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateCity(form);
    if (!result.ok || !result.value) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    await onSubmit(result.value);
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8, color: "#fff", maxWidth: 360 }}>
      <Field label="Name" error={errors.name}>
        <input value={form.name} onChange={(e) => set("name", e.target.value)} style={inp} aria-label="name" />
      </Field>
      <button type="button" onClick={fillFromGeocode} disabled={geoBusy} style={ghost}>
        {geoBusy ? "Locating…" : "Fill lat/lng from name"}
      </button>
      <Field label="Country" error={errors.country}>
        <input value={form.country} onChange={(e) => set("country", e.target.value)} style={inp} aria-label="country" />
      </Field>
      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Lat" error={errors.lat}>
          <input value={form.lat} onChange={(e) => set("lat", e.target.value)} style={inp} aria-label="lat" />
        </Field>
        <Field label="Lng" error={errors.lng}>
          <input value={form.lng} onChange={(e) => set("lng", e.target.value)} style={inp} aria-label="lng" />
        </Field>
      </div>
      <Field label="Population" error={errors.population}>
        <input value={form.population} onChange={(e) => set("population", e.target.value)} style={inp} aria-label="population" />
      </Field>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
        <input
          type="checkbox"
          checked={form.isCapital}
          onChange={(e) => set("isCapital", e.target.checked)}
          aria-label="is capital"
        />
        Capital
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" style={primary}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={ghost}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 2, fontSize: 12, flex: 1 }}>
      <span>{label}</span>
      {children}
      {error && <span style={{ color: "#f87171", fontSize: 11 }}>{error}</span>}
    </label>
  );
}

const inp: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#0f131c",
  color: "#fff",
  width: "100%",
};
const primary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};
const ghost: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#1a1f2b",
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
};
