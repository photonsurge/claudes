import { Mystery } from "./types";


export const sampleMystery: Mystery = {
  id: "myst-rosewood-01",
  title: "The Rosewood Study",

  locations: {
    "loc-foyer": {
      id: "loc-foyer",
      kind: "location",
      name: "Foyer",
      description: "A marble floor. Wet footprints fade toward the hall.",
      pos: { x: 140, y: 210 },
    },
    "loc-study": {
      id: "loc-study",
      kind: "location",
      name: "Study",
      description: "A dim room. The desk drawer is slightly open.",
      pos: { x: 420, y: 160 },
    },
    "loc-kitchen": {
      id: "loc-kitchen",
      kind: "location",
      name: "Kitchen",
      description: "Clean counters… too clean. Something smells like bleach.",
      pos: { x: 420, y: 310 },
    },
  },

  suspects: {
    "sus-maya": {
      id: "sus-maya",
      kind: "suspect",
      name: "Maya Trent",
      bio: "Personal assistant. Efficient, guarded.",
      pos: { x: 700, y: 150 },
      topics: {
        alibi: {
          title: "Alibi",
          lines: [
            "I was on the phone with the bank at nine. Check the call logs.",
            "I never went near the study tonight.",
          ],
          reveals: ["evt-call-2100"],
        },
        cufflink: {
          title: "Cufflink",
          lines: [
            "That? Not mine. Looks expensive.",
            "Someone wants you looking at the wrong person.",
          ],
        },
      },
    },
    "sus-daniel": {
      id: "sus-daniel",
      kind: "suspect",
      name: "Daniel Hargreaves",
      bio: "Heir. Charming on the surface, tense underneath.",
      pos: { x: 700, y: 270 },
      topics: {
        alibi: {
          title: "Alibi",
          lines: [
            "I was in the foyer. Waiting. I didn’t go upstairs.",
            "Ask the staff. They saw me.",
          ],
        },
        study: {
          title: "Study",
          lines: [
            "I had no reason to enter the study.",
            "Father kept secrets in there. That’s all.",
          ],
        },
      },
    },
  },

  clues: {
    "clu-cufflink": {
      id: "clu-cufflink",
      kind: "clue",
      name: "Silver cufflink",
      description: "Found near the study door. Initials: D.H.",
      pos: { x: 420, y: 60 },
    },
    "clu-bleach": {
      id: "clu-bleach",
      kind: "clue",
      name: "Bleach scent",
      description: "Strong smell in the kitchen. Someone cleaned something recently.",
      pos: { x: 420, y: 390 },
    },
    "clu-ledger": {
      id: "clu-ledger",
      kind: "clue",
      name: "Private ledger page",
      description: "Torn page listing payments to an unknown account.",
      pos: { x: 300, y: 160 },
    },
  },

  events: {
    "evt-body-2055": {
      id: "evt-body-2055",
      kind: "event",
      name: "Body discovered",
      at: "20:55",
      description: "You arrive to find the victim in the study.",
      pos: { x: 140, y: 60 },
    },
    "evt-call-2100": {
      id: "evt-call-2100",
      kind: "event",
      name: "Bank call",
      at: "21:00",
      description: "A bank call took place. Call logs could verify who was on it.",
      pos: { x: 140, y: 120 },
    },
  },

  links: [
    { from: "loc-study", to: "clu-cufflink", label: "found near" },
    { from: "loc-kitchen", to: "clu-bleach", label: "smell" },
    { from: "loc-study", to: "clu-ledger", label: "drawer" },
    { from: "sus-daniel", to: "clu-cufflink", label: "initials" },
    { from: "sus-maya", to: "evt-call-2100", label: "mentions" },
    { from: "evt-body-2055", to: "loc-study", label: "in" },
  ],

  start: {
    locationId: "loc-foyer",
    unlocked: {
      locations: ["loc-foyer", "loc-study"],
      suspects: ["sus-maya", "sus-daniel"],
      clues: [],
      events: ["evt-body-2055"],
    },
  },

  rules: [
    {
      when: { kind: "inspect", targetId: "loc-study" },
      reveal: { clues: ["clu-ledger", "clu-cufflink"] },
      say: "You notice a torn ledger page in the desk drawer, and a cufflink near the doorframe.",
    },
    {
      when: { kind: "go", locationId: "loc-kitchen" } as any, // (handled by engine; kept simple)
      reveal: { clues: ["clu-bleach"] },
      say: "The kitchen is spotless. The bleach smell hits you immediately.",
    },
  ],
};
