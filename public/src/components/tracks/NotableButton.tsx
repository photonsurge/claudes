"use client";

/**
 * Per-row toggle on the live aircraft/ship tables: add this craft to the notable
 * catalog (+ kick a targeted enrichment so its photo/blurb fill in seconds), or
 * remove it. "☆ Enrich" when not catalogued, "★ Notable" once it is.
 */
import { useState } from "react";
import { addNotable, removeNotable, keyFor, type NotableKind } from "../../lib/tracks/notable";

export default function NotableButton({
  kind,
  code,
  label,
  isNotable,
  onChange,
}: {
  kind: NotableKind;
  code: string;
  label?: string;
  isNotable: boolean;
  onChange?: (nowNotable: boolean) => void;
}) {
  const [on, setOn] = useState(isNotable);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      if (on) {
        await removeNotable(keyFor(kind, code));
        setOn(false);
        onChange?.(false);
      } else {
        await addNotable({ kind, code, label });
        setOn(true);
        onChange?.(true);
      }
    } catch {
      /* leave the button as-is; the operator can retry */
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={on ? "Remove from the notable catalog" : "Add to the notable catalog + enrich (photo, info)"}
      style={{
        padding: "3px 9px",
        borderRadius: 6,
        border: `1px solid ${on ? "#b48a1f" : "#333"}`,
        background: on ? "#3a2f10" : "#1a1f2b",
        color: on ? "#ffd76a" : "#cbd5e1",
        cursor: busy ? "default" : "pointer",
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      {busy ? "…" : on ? "★ Notable" : "☆ Enrich"}
    </button>
  );
}
