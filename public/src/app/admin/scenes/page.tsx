"use client";

/**
 * /admin/scenes — CRUD for broadcast scenes. Each scene is a named ControlState
 * rendered full-bleed at `/watch/:id` (an OBS browser source / overlay window).
 * Create seeds from the main scene (or a chosen one); the operator then drives
 * it live from /control by selecting it in the scene picker. The main scene is
 * protected (no delete).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MAIN_SCENE_ID, type SceneMeta } from "@photonsurge/shared/control";
import { listScenes, createScene, deleteScene } from "../../../lib/scenes";
import AdminPageShell from "../../../components/admin/AdminPageShell";

export default function ScenesPage() {
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState<string>(MAIN_SCENE_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setScenes(await listScenes());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await createScene(name.trim(), copyFrom);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setName("");
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm(`Delete scene "${id}"? This cannot be undone.`)) return;
    const { error: err } = await deleteScene(id);
    if (err) setError(err);
    refresh();
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <AdminPageShell
      title="Scenes"
      description={
        <>
          Each scene renders at <code>/watch/&lt;id&gt;</code> — use that URL as an OBS browser
          source or overlay window. Drive a scene live from the <Link href="/control" style={{ color: "#60a5fa" }}>operator console</Link>.
          Tokened OBS URLs live in <Link href="/admin/access" style={{ color: "#60a5fa" }}>Access</Link>.
        </>
      }
      maxWidth={760}
    >

      {/* Create */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          padding: 14,
          borderRadius: 8,
          border: "1px solid #1b2030",
          background: "#0c111c",
          marginTop: 14,
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New scene name (e.g. Atlantic Wind)"
          onKeyDown={(e) => e.key === "Enter" && name.trim() && add()}
          style={{ flex: 1, minWidth: 200, background: "#0a0e16", color: "#fff", border: "1px solid #2a3344", borderRadius: 6, padding: "8px 10px" }}
        />
        <label style={{ color: "#8b95a7", fontSize: 13 }}>
          copy from{" "}
          <select
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
            style={{ background: "#0a0e16", color: "#fff", border: "1px solid #2a3344", borderRadius: 6, padding: "6px 8px" }}
          >
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={add}
          disabled={busy || !name.trim()}
          style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #333", background: busy || !name.trim() ? "#1a1f2b" : "#2563eb", color: "#fff", cursor: "pointer" }}
        >
          {busy ? "…" : "Create"}
        </button>
      </div>
      {error && <div style={{ color: "#fca5a5", fontSize: 13, marginTop: 8 }}>{error}</div>}

      {/* List */}
      <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
        {scenes.map((s) => {
          const watch = `/watch/${s.id}`;
          return (
            <div
              key={s.id}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, borderRadius: 8, border: "1px solid #1b2030", background: "#0c111c" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {s.name}
                  {s.id === MAIN_SCENE_ID && (
                    <span style={{ fontSize: 11, color: "#8b95a7", border: "1px solid #2a3344", borderRadius: 4, padding: "1px 5px", marginLeft: 8 }}>main</span>
                  )}
                </div>
                <div style={{ color: "#8b95a7", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {origin}
                  {watch}
                </div>
              </div>
              <Link href={watch} target="_blank" style={{ color: "#60a5fa", fontSize: 13, textDecoration: "none" }}>
                Open ↗
              </Link>
              {s.id !== MAIN_SCENE_ID && (
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #5b2330", background: "#1a1014", color: "#fca5a5", cursor: "pointer", fontSize: 13 }}
                >
                  Delete
                </button>
              )}
            </div>
          );
        })}
      </div>
    </AdminPageShell>
  );
}
