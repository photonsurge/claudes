// mystery/engine.ts
import { EngineResult, GameState, Mystery, PlayerIntent, Id } from "./types";

const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));

const reveal = (s: GameState, ids: Id[]) => {
  for (const id of ids) {
    if (s.unlocked.locations.has(id)) continue;
    if (s.unlocked.suspects.has(id)) continue;
    if (s.unlocked.clues.has(id)) continue;
    if (s.unlocked.events.has(id)) continue;

    // we don't know which bucket it belongs to here; caller should
    // BUT for MVP you can just push to a "revealed list" and separately add to bucket.
  }
};

const addToBucket = (m: Mystery, s: GameState, id: Id) => {
  if (m.locations[id]) s.unlocked.locations.add(id);
  else if (m.suspects[id]) s.unlocked.suspects.add(id);
  else if (m.clues[id]) s.unlocked.clues.add(id);
  else if (m.events[id]) s.unlocked.events.add(id);
};

const applyReveal = (m: Mystery, s: GameState, r?: { clues?: Id[]; suspects?: Id[]; locations?: Id[]; events?: Id[] }) => {
  const out: Id[] = [];
  const push = (ids?: Id[]) => {
    for (const id of ids ?? []) {
      if (
        s.unlocked.locations.has(id) ||
        s.unlocked.suspects.has(id) ||
        s.unlocked.clues.has(id) ||
        s.unlocked.events.has(id)
      ) continue;

      addToBucket(m, s, id);
      out.push(id);
    }
  };
  push(r?.locations);
  push(r?.suspects);
  push(r?.clues);
  push(r?.events);
  return out;
};

export const initGameState = (m: Mystery): GameState => ({
  mysteryId: m.id,
  locationId: m.start.locationId,
  unlocked: {
    locations: new Set(m.start.unlocked.locations),
    suspects: new Set(m.start.unlocked.suspects),
    clues: new Set(m.start.unlocked.clues),
    events: new Set(m.start.unlocked.events),
  },
  notes: [],
});

export const runTurn = (m: Mystery, s: GameState, intent: PlayerIntent): EngineResult => {
  const revealed: Id[] = [];

  if (intent.kind === "help") {
    return {
      reply:
        "Try: go <room>, inspect <thing>, talk to <suspect>, ask <suspect> about <topic>, show evidence, show timeline, accuse <name>.",
      revealed,
    };
  }

  if (intent.kind === "show") {
    const counts = {
      locations: s.unlocked.locations.size,
      suspects: s.unlocked.suspects.size,
      clues: s.unlocked.clues.size,
      events: s.unlocked.events.size,
    };
    return {
      reply: `Noted. (${intent.view}) — You currently have ${counts.clues} clues, ${counts.suspects} suspects, ${counts.locations} locations, ${counts.events} events.`,
      revealed,
    };
  }

  if (intent.kind === "go") {
    if (!s.unlocked.locations.has(intent.locationId)) {
      return { reply: "You can’t get there yet.", revealed };
    }

    s.locationId = intent.locationId;

    // optional: location-based reveals by scanning rules or doing your own map
    // quick scan:
    for (const rule of m.rules) {
      // allow "go" rule if present in data
      if ((rule as any).when?.kind === "go" && (rule as any).when.locationId === intent.locationId) {
        revealed.push(...applyReveal(m, s, (rule as any).reveal));
        return { reply: (rule as any).say ?? `You enter ${m.locations[intent.locationId].name}.`, revealed: uniq(revealed) };
      }
    }

    return { reply: `You enter ${m.locations[intent.locationId].name}.`, revealed };
  }

  if (intent.kind === "inspect") {
    // allow inspecting locked nodes? usually no
    const isKnown =
      s.unlocked.locations.has(intent.targetId) ||
      s.unlocked.clues.has(intent.targetId) ||
      s.unlocked.events.has(intent.targetId) ||
      s.unlocked.suspects.has(intent.targetId);

    if (!isKnown) return { reply: "You don’t know enough about that yet.", revealed };

    const rule = m.rules.find((r) => r.when.kind === "inspect" && r.when.targetId === intent.targetId);
    if (rule) {
      revealed.push(...applyReveal(m, s, rule.reveal));
      return { reply: rule.say ?? "You take a closer look.", revealed: uniq(revealed) };
    }

    // fallback description
    const node:any =
      m.locations[intent.targetId] ??
      m.clues[intent.targetId] ??
      m.events[intent.targetId] ??
      m.suspects[intent.targetId];

    return { reply: node?.description ?? node?.bio ?? "Nothing stands out.", revealed };
  }

  if (intent.kind === "talk") {
    if (!s.unlocked.suspects.has(intent.suspectId)) return { reply: "They’re not available yet.", revealed };

    const rule = m.rules.find((r) => r.when.kind === "talk" && r.when.suspectId === intent.suspectId);
    if (rule) {
      revealed.push(...applyReveal(m, s, rule.reveal));
      return { reply: rule.say ?? `You speak with ${m.suspects[intent.suspectId].name}.`, revealed: uniq(revealed) };
    }

    return { reply: `${m.suspects[intent.suspectId].name} watches you carefully. (Try: ask about alibi / study / cufflink)`, revealed };
  }

  if (intent.kind === "ask") {
    if (!s.unlocked.suspects.has(intent.suspectId)) return { reply: "They’re not available yet.", revealed };

    const suspect = m.suspects[intent.suspectId];
    const topicKey = intent.topic.toLowerCase().trim();
    const topic =
      suspect.topics?.[topicKey] ??
      Object.entries(suspect.topics ?? {}).find(([k, v]) => v.title.toLowerCase() === topicKey)?.[1];

    if (topic) {
      // reveal from topic
      for (const id of topic.reveals ?? []) {
        if (
          s.unlocked.locations.has(id) ||
          s.unlocked.suspects.has(id) ||
          s.unlocked.clues.has(id) ||
          s.unlocked.events.has(id)
        ) continue;
        addToBucket(m, s, id);
        revealed.push(id);
      }
      const line = topic.lines[Math.floor(Math.random() * topic.lines.length)];
      return { reply: `${suspect.name}: ${line}`, revealed: uniq(revealed) };
    }

    // rule-based ask
    const rule = m.rules.find(
      (r) => r.when.kind === "ask" && r.when.suspectId === intent.suspectId && r.when.topic.toLowerCase() === topicKey
    );
    if (rule) {
      revealed.push(...applyReveal(m, s, rule.reveal));
      return { reply: rule.say ?? `${suspect.name} answers carefully.`, revealed: uniq(revealed) };
    }

    return { reply: `${suspect.name}: “Be specific. Ask me about something you’ve actually found.”`, revealed };
  }

  if (intent.kind === "accuse") {
    if (!s.unlocked.suspects.has(intent.suspectId)) return { reply: "You can’t accuse someone you haven’t met.", revealed };
    // MVP: no win logic yet
    return { reply: `You accuse ${m.suspects[intent.suspectId].name}. The room goes quiet… (Endings/WIN logic next.)`, revealed };
  }

  // unknown
  return { reply: "I didn’t understand that. Type: help", revealed };
};
