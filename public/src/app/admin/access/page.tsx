"use client";

/**
 * /admin/access — tokened OBS/YouTube URLs, one per broadcast scene.
 * `/watch/:id` can't do interactive login (it's loaded by OBS/YouTube), so
 * each scene carries a secret `watchToken`; the URL here is the only place
 * that secret is exposed. Kept separate from /admin/scenes (which manages
 * scene *content*, not access) so rotating a token is a deliberate, isolated
 * action.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MAIN_SCENE_ID, type SceneMeta } from "@photonsurge/shared/control";
import { listScenes, rotateSceneToken } from "../../../lib/scenes";

export default function AccessPage() {
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setScenes(await listScenes());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const rotate = async (id: string) => {
    if (!confirm("Rotate this scene's watch token? Any previously-copied /watch URL will stop working.")) return;
    setRotatingId(id);
    const { error: err } = await rotateSceneToken(id);
    setRotatingId(null);
    if (err) setError(err);
    refresh();
  };

  const copy = (id: string, url: string) => {
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
        <h2 style={{ margin: 0 }}>Access</h2>
        <p style={{ color: "#8b95a7", marginTop: 6 }}>
          Tokened OBS/YouTube URLs for each scene. Paste the copied URL into your OBS browser
          source instead of the bare <code>/watch/&lt;id&gt;</code> address — anyone with the
          token can view the output, so rotate it if a URL ever leaks. Manage scene content in{" "}
          <Link href="/admin/scenes" style={{ color: "#60a5fa" }}>Scenes</Link>.
        </p>
        {error && <div style={{ color: "#fca5a5", fontSize: 13, marginTop: 8 }}>{error}</div>}

        <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
          {scenes.map((s) => {
            const watch = `/watch/${s.id}`;
            const tokenedUrl = s.watchToken ? `${origin}${watch}?token=${s.watchToken}` : null;
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
                    {tokenedUrl ?? "no token yet — generate one"}
                  </div>
                </div>
                {tokenedUrl && (
                  <button
                    type="button"
                    onClick={() => copy(s.id, tokenedUrl)}
                    style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #2a3344", background: "#0a0e16", color: "#cdd4e0", cursor: "pointer", fontSize: 13 }}
                  >
                    {copiedId === s.id ? "Copied" : "Copy"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => rotate(s.id)}
                  disabled={rotatingId === s.id}
                  style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #2a3344", background: "#0a0e16", color: "#cdd4e0", cursor: "pointer", fontSize: 13 }}
                >
                  {rotatingId === s.id ? "…" : s.watchToken ? "Rotate token" : "Generate token"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
