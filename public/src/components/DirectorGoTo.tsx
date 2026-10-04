"use client";

/**
 * "Go to…" for the director desk: type a country, an area or a city and cut
 * there, or air its latest round-up (empty = the world round-up). Countries
 * and areas are suggested as you type; the worker resolves the name itself
 * (shared/director-places.ts, then the City collection).
 */
import { useState } from "react";
import type { DirectorOp } from "@photonsurge/shared/director-commands";
import { COUNTRY_SHOTS } from "@photonsurge/shared/director-countries";
import { REGION_SHOTS } from "@photonsurge/shared/director-regions";
import { box } from "./panelBox";

// A country and an area can share a name (the UK); suggest each name once.
const SUGGESTIONS = [...new Set([...COUNTRY_SHOTS.map((c) => c.name), ...REGION_SHOTS.map((r) => r.name)])];
const btn = { ...box, cursor: "pointer", padding: "3px 8px", fontSize: 12 } as const;

export default function DirectorGoTo({ send }: { send: (op: DirectorOp) => void | Promise<void> }) {
  const [place, setPlace] = useState("");
  const query = place.trim();

  const go = () => {
    if (!query) return;
    void send({ op: "cut", target: { type: "place", query } });
  };

  return (
    <form
      style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <input
        aria-label="Go to place"
        placeholder="Go to… (country, area or city)"
        list="director-goto-places"
        value={place}
        onChange={(e) => setPlace(e.target.value)}
        style={{ ...box, flex: 1, minWidth: 0 }}
      />
      <datalist id="director-goto-places">
        {SUGGESTIONS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <button type="submit" style={btn} disabled={!query}>
        Go
      </button>
      <button
        type="button"
        style={btn}
        title={query ? `Air ${query}'s latest round-up` : "Air the latest world round-up"}
        onClick={() => void send({ op: "cut", target: query ? { type: "roundup", place: query } : { type: "roundup" } })}
      >
        Round-up
      </button>
    </form>
  );
}
