export interface MurderMysteryOutline {
  title: string;
  logline: string;
  setting: Setting;
  cast: CastMember[];
  victim: Victim;
  detective: Detective;
  solution: Solution;
  red_herrings: RedHerring[];     // exactly 3 in your constraint, but JSON can still parse as array
  chapter_plan: ChapterPlanItem[]; // you currently have 1–6, but keep as array
  clue_ledger: ClueLedgerItem[];
  timeline: TimelineEvent[];
}

export interface Setting {
  location: string;
  era: string;
  containment: string;
  tone_notes: string[];
}

export interface CastMember {
  name: string;
  role: string;
  public_persona: string;
  private_secret: string;
  relationships: Relationship[];
  alibi_windows: AlibiWindow[];
  means_access: string;
  appearance_summary?: string;
  signature_item?: string;
  color_palette?: string[];
  portrait_brief?: string;
}

export interface Relationship {
  with: string;
  type: string;
  note: string;
}

export interface AlibiWindow {
  from: string;   // e.g. "8:00 PM"
  to: string;     // e.g. "8:30 PM"
  claim: string;  // e.g. "Reading in her bedroom"
}

export interface Victim {
  name: string;
  why_hated: string;
}

export interface Detective {
  name: string;
  style: string;
  blind_spot: string;
}

export interface Solution {
  murderer: string;
  motive: string;
  method: string;
  locked_room_explanation: string;
}

export interface RedHerring {
  label: string;
  appears_as: string;
  truth: string;
  how_resolved: string;
}

export interface ChapterPlanItem {
  chapter: number;
  purpose: string;
  key_scenes: string[];
  chapter_end_hook: string;
  clues_to_seed: string[];
}

export interface ClueLedgerItem {
  clue: string;
  planted_in_chapter: number;
  surface_interpretation: string;
  true_meaning: string;
}

export interface TimelineEvent {
  time: string;   // e.g. "8:15 PM"
  event: string;
}
