// mystery/types.ts
export type Id = string;

export type Mystery = {
  id: Id;
  title: string;

  locations: Record<Id, LocationNode>;
  suspects: Record<Id, SuspectNode>;
  clues: Record<Id, ClueNode>;
  events: Record<Id, EventNode>;

  // connections shown on the board (can be static; visibility can still be gated)
  links: Link[];

  // starting state
  start: {
    locationId: Id;
    unlocked: {
      locations: Id[];
      suspects: Id[];
      clues: Id[];
      events: Id[];
    };
  };

  // rules: when player does X, reveal Y (simple MVP)
  rules: Rule[];
};

export type LocationNode = {
  id: Id;
  kind: "location";
  name: string;
  description: string;
  // optional: used for SVG placement
  pos?: { x: number; y: number };
};

export type SuspectNode = {
  id: Id;
  kind: "suspect";
  name: string;
  bio: string;
  pos?: { x: number; y: number };
  // topics they can respond to (key is topic slug)
  topics?: Record<string, { title: string; lines: string[]; reveals?: Id[] }>;
};

export type ClueNode = {
  id: Id;
  kind: "clue";
  name: string;
  description: string;
  pos?: { x: number; y: number };
};

export type EventNode = {
  id: Id;
  kind: "event";
  name: string;
  at: string; // "21:10" or "Act 2"
  description: string;
  pos?: { x: number; y: number };
};

export type Link = {
  from: Id;
  to: Id;
  label?: string;
};

export type Rule =
  | {
      when: { kind: "inspect"; targetId: Id };
      reveal?: { clues?: Id[]; suspects?: Id[]; locations?: Id[]; events?: Id[] };
      say?: string;
    }
  | {
      when: { kind: "talk"; suspectId: Id };
      reveal?: { clues?: Id[]; events?: Id[] };
      say?: string;
    }
  | {
      when: { kind: "ask"; suspectId: Id; topic: string };
      reveal?: { clues?: Id[]; events?: Id[] };
      say?: string;
    };

export type GameState = {
  mysteryId: Id;
  locationId: Id;

  unlocked: {
    locations: Set<Id>;
    suspects: Set<Id>;
    clues: Set<Id>;
    events: Set<Id>;
  };

  notes: string[];
  lastNpcLine?: string;
};

export type VisibleNode =
  | LocationNode
  | SuspectNode
  | ClueNode
  | EventNode;

export type PlayerIntent =
  | { kind: "help" }
  | { kind: "show"; view: "map" | "evidence" | "suspects" | "timeline" | "notes" }
  | { kind: "go"; locationId: Id }
  | { kind: "inspect"; targetId: Id }
  | { kind: "talk"; suspectId: Id }
  | { kind: "ask"; suspectId: Id; topic: string }
  | { kind: "accuse"; suspectId: Id; theory?: string }
  | { kind: "unknown"; text: string };

export type EngineResult = {
  reply: string;              // what to print in chat
  revealed: Id[];             // node ids revealed this turn
  notesAdded?: string[];
};
