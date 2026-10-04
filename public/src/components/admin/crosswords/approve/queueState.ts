/**
 * Local updates to a queue word after a decision has been saved, mirroring
 * what the bank repo stores (docs/crossword-mode-plan.md §7.4): so the queue
 * can show the result without refetching the word. Pure.
 *
 *  • approving a clue stores its cleaned text (`cleanClue`);
 *  • editing a clue sends an approved one back to pending and clears its tag;
 *  • a clue's `cleaned` text and `problem` are recomputed from what is stored.
 */
import { cleanClue, validateClue } from "@photonsurge/shared/crossword";
import type { BankApprovalStatus, BankClue, BankQueueClue, BankQueueWord, BankWordDetail } from "@photonsurge/shared/crossword-bank";

/** Who the page shows for a decision it has just made (the server records the session's identity). */
export const YOU = "you";

/** A stored clue as the queue shows it. */
export const toQueueClue = (c: BankClue, norm: string): BankQueueClue => {
  const cleaned = cleanClue(c.text);
  return { ...c, cleaned, problem: validateClue(cleaned, norm) };
};

const mapClue = (w: BankQueueWord, id: string, f: (c: BankQueueClue) => BankQueueClue): BankQueueWord => ({
  ...w,
  clues: w.clues.map((c) => (c.id === id ? f(c) : c)),
});

export function withWordApproval(w: BankQueueWord, status: BankApprovalStatus, at: number): BankQueueWord {
  return { ...w, approval: { status, by: YOU, at } };
}

export function withWordFamily(w: BankQueueWord, value: boolean | null, at: number): BankQueueWord {
  return { ...w, familyFriendly: value, familyFriendlyBy: YOU, familyFriendlyAt: at };
}

export function withClueApproval(w: BankQueueWord, id: string, status: BankApprovalStatus, at: number): BankQueueWord {
  // A rejected clue leaves the queue's list, as it does on the next fetch.
  if (status === "rejected") return { ...w, clues: w.clues.filter((c) => c.id !== id) };
  return mapClue(w, id, (c) => {
    const text = status === "approved" && c.cleaned ? c.cleaned : c.text;
    return {
      ...c,
      text,
      original: text !== c.text && c.original === undefined ? c.text : c.original,
      cleaned: cleanClue(text),
      approval: { status, by: YOU, at },
    };
  });
}

export function withClueFamily(w: BankQueueWord, id: string, value: boolean | null, at: number): BankQueueWord {
  return mapClue(w, id, (c) => ({ ...c, familyFriendly: value, familyFriendlyBy: YOU, familyFriendlyAt: at }));
}

export function withClueEdit(w: BankQueueWord, id: string, raw: string, at: number): BankQueueWord {
  const text = raw.replace(/\s+/g, " ").trim();
  return mapClue(w, id, (c) => {
    const cleaned = cleanClue(text);
    return {
      ...c,
      text,
      original: c.original ?? c.text,
      editedBy: YOU,
      editedAt: at,
      cleaned,
      problem: validateClue(cleaned, w.norm),
      familyFriendly: null,
      familyFriendlyBy: YOU,
      familyFriendlyAt: at,
      approval: c.approval.status === "approved" ? { status: "pending", by: YOU, at } : c.approval,
    };
  });
}

/** The word's clues replaced from a fresh detail (after a suggestion is saved as a clue). */
export function withClues(w: BankQueueWord, detail: BankWordDetail): BankQueueWord {
  return { ...w, clues: detail.clues.filter((c) => c.approval.status !== "rejected").map((c) => toQueueClue(c, w.norm)) };
}
