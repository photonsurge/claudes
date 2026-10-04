import { Id, Mystery, VisibleNode } from "./types";

export const getNode = (m: Mystery, id: Id): VisibleNode | null => {
  return m.locations[id] ?? m.suspects[id] ?? m.clues[id] ?? m.events[id] ?? null;
};
