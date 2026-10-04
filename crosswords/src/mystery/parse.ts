// mystery/parse.ts
import { Mystery, PlayerIntent, Id } from "./types";

const normalize = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s\-']/g, "")
    .replace(/\s+/g, " ");

const findByName = <T extends { id: Id; name: string }>(
  map: Record<Id, T>,
  raw: string
): T | null => {
  const q = normalize(raw);
  const exact = Object.values(map).find((n) => normalize(n.name) === q);
  if (exact) return exact;
  const contains = Object.values(map).find((n) => normalize(n.name).includes(q));
  return contains ?? null;
};

const pickId = (m: Mystery, raw: string): { kind: "location" | "suspect" | "node"; id: Id } | null => {
  const q = normalize(raw);

  // if user typed an actual id
  if (m.locations[q as Id]) return { kind: "location", id: q as Id };
  if (m.suspects[q as Id]) return { kind: "suspect", id: q as Id };
  if (m.clues[q as Id] || m.events[q as Id]) return { kind: "node", id: q as Id };

  // name match
  const loc = findByName(m.locations, raw);
  if (loc) return { kind: "location", id: loc.id };

  const sus = findByName(m.suspects, raw);
  if (sus) return { kind: "suspect", id: sus.id };

  const clue = findByName(m.clues, raw);
  if (clue) return { kind: "node", id: clue.id };

  const evt = findByName(m.events, raw);
  if (evt) return { kind: "node", id: evt.id };

  return null;
};

export const parseMysteryMessage = (m: Mystery, textRaw: string): PlayerIntent => {
  const text = normalize(textRaw);

  if (!text) return { kind: "unknown", text: textRaw };

  if (text === "help" || text === "?" || text.includes("what can i do")) return { kind: "help" };

  // show ...
  const showMatch = text.match(/^show\s+(map|evidence|suspects|timeline|notes)\b/);
  if (showMatch) return { kind: "show", view: showMatch[1] as any };

  // go ...
  const goMatch = text.match(/^(go|enter|walk to|head to|move to)\s+(.+)$/);
  if (goMatch) {
    const picked = pickId(m, goMatch[2]);
    if (picked?.kind === "location") return { kind: "go", locationId: picked.id };
  }

  // inspect ...
  const inspMatch = text.match(/^(inspect|examine|search|look at)\s+(.+)$/);
  if (inspMatch) {
    const picked = pickId(m, inspMatch[2]);
    if (picked) return { kind: "inspect", targetId: picked.id };
  }

  // talk ...
  const talkMatch = text.match(/^(talk to|speak to|question)\s+(.+)$/);
  if (talkMatch) {
    const picked = pickId(m, talkMatch[2]);
    if (picked?.kind === "suspect") return { kind: "talk", suspectId: picked.id };
  }

  // ask <suspect> about <topic>
  const askMatch = text.match(/^(ask)\s+(.+?)\s+(about|re)\s+(.+)$/);
  if (askMatch) {
    const picked = pickId(m, askMatch[2]);
    if (picked?.kind === "suspect") return { kind: "ask", suspectId: picked.id, topic: askMatch[4] };
  }

  // accuse ...
  const accuseMatch = text.match(/^(accuse|arrest)\s+(.+?)(?:\s+because\s+(.+))?$/);
  if (accuseMatch) {
    const picked = pickId(m, accuseMatch[2]);
    if (picked?.kind === "suspect") return { kind: "accuse", suspectId: picked.id, theory: accuseMatch[3] };
  }

  return { kind: "unknown", text: textRaw };
};
