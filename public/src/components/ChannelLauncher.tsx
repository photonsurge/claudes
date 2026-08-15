"use client";

/**
 * Home-page channel launcher: one card per broadcast channel (a scene) with a
 * link to its operator console (/control?scene=:id) and its full-screen output
 * (/watch/:id). Mirrors the links on /admin/scenes so the login-gated home page
 * is a fast jump-off to drive or preview any channel.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { MAIN_SCENE_ID, type SceneMeta } from "@photonsurge/shared/control";
import { listScenes } from "../lib/scenes";

const controlHref = (id: string) => (id === MAIN_SCENE_ID ? "/control" : `/control?scene=${id}`);
const watchHref = (id: string) => `/watch/${id}`;

export default function ChannelLauncher() {
  const [scenes, setScenes] = useState<SceneMeta[] | null>(null);

  useEffect(() => {
    listScenes()
      .then(setScenes)
      .catch(() => setScenes([]));
  }, []);

  return (
    <section style={{ width: "100%", maxWidth: 820 }}>
      <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "#8b95a7", marginBottom: 10 }}>
        Channels
      </div>
      {scenes === null ? (
        <div style={{ color: "#8b95a7", fontSize: 14 }}>Loading channels…</div>
      ) : scenes.length === 0 ? (
        <div style={{ color: "#8b95a7", fontSize: 14 }}>
          No channels yet — create one in{" "}
          <Link href="/admin/scenes" style={{ color: "#6b93e0" }}>
            Channels admin
          </Link>
          .
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 12,
          }}
        >
          {scenes.map((s) => (
            <div
              key={s.id}
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                border: "1px solid #2a3142",
                background: "#121826",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>{s.name}</div>
                {s.id === MAIN_SCENE_ID && (
                  <span style={{ fontSize: 11, color: "#8b95a7", border: "1px solid #2a3142", borderRadius: 4, padding: "1px 6px" }}>
                    main
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 14 }}>
                <Link href={controlHref(s.id)} style={{ color: "#6b93e0", textDecoration: "none" }}>
                  Control
                </Link>
                <Link href={watchHref(s.id)} target="_blank" rel="noreferrer" style={{ color: "#6b93e0", textDecoration: "none" }}>
                  Watch ↗
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
