"use client";

/**
 * /admin/crosswords/approve — the approval queue (docs/crossword-mode-plan.md
 * §7.4): one pending word at a time, most common first, decided from the
 * keyboard. Word: A approve, R reject, F family friendly (Shift+F: not). Clue:
 * 1–9 select, Y approve, E edit, X reject, T family friendly (Shift+T: not).
 * U saves the stored suggestion as a candidate clue. N or Enter next, S skip.
 *
 * Focus stays on the page body (never on a vanished button), so the keys work
 * after every click and every advance; the edit box takes focus while editing
 * and hands it back on Enter or Esc. Keys are ignored while typing in a field
 * or holding a modifier. A decision is applied locally only once the server
 * has saved it. Skipped and seen words are excluded from later fetches.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { BANK_ZIPF_BANDS, type BankPoolCounts, type BankQueueWord, type BankZipfBand } from "@photonsurge/shared/crossword-bank";
import AdminPageShell from "../../AdminPageShell";
import { font } from "../../../../theme/tokens";
import { SUGGEST_POLL_MAX, SUGGEST_POLL_MS, getBankWord, patchBankClue, patchBankWord, postSuggest, type Outcome } from "../words/api";
import PoolCounter from "../words/PoolCounter";
import { getQueue } from "./api";
import type { QueueFilters } from "./query";
import QueueWord from "./QueueWord";
import { withClueApproval, withClueEdit, withClueFamily, withClues, withWordApproval, withWordFamily } from "./queueState";

const FETCH_BATCH = 5;
/** Fetch more when this few words are left in hand. */
const LOW_WATER = 2;
/** Most words one suggest request carries (the route's cap). */
const SUGGEST_MAX = 50;
const LENGTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const KEY_MAP: [string, string][] = [
  ["A", "approve word"],
  ["R", "reject word"],
  ["F", "word family friendly (Shift+F: not)"],
  ["1–9, J / K", "select a clue (J next, K previous)"],
  ["Y", "approve clue"],
  ["E", "edit clue"],
  ["X", "reject clue"],
  ["T", "clue family friendly (Shift+T: not)"],
  ["U", "add the suggestion as a clue"],
  ["N / Enter", "next word (counts as skipped if undecided)"],
  ["S", "skip word"],
  ["Esc", "clear clue selection"],
];

/** The skipped list sent to the server is capped at this many of the latest ids. */
const SKIPPED_MAX = 200;
const WIDGET = '[role="combobox"], [role="option"], [role="menuitem"], [role="listbox"], [role="menu"]';

/** True while the key belongs to a field or a dropdown (MUI selects included), not to the queue. */
const typing = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return true;
  if (el.closest?.(WIDGET)) return true;
  // A menu or popover is open (its list may hold focus elsewhere).
  return !!document.querySelector('.MuiPopover-root [role="listbox"], .MuiPopover-root [role="menu"]');
};

export default function ApprovePage() {
  const [filters, setFilters] = useState<QueueFilters>({});
  const [queue, setQueue] = useState<BankQueueWord[]>([]);
  const [pool, setPool] = useState<BankPoolCounts | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [done, setDone] = useState({ decided: 0, skipped: 0 });
  /** Words queued for suggestions and still waiting for them. */
  const [awaiting, setAwaiting] = useState<string[]>([]);

  /** Skipped (or left undecided) words: the only ids sent as `exclude`, with the ones in hand. */
  const skipped = useRef<string[]>([]);
  const inHand = useRef<string[]>([]);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const bodyRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const word = queue[0];

  const focusBody = useCallback(() => bodyRef.current?.focus({ preventScroll: true }), []);

  // Fetch more words whenever the hand runs low. A failure stops the loop until the filters change or Retry.
  useEffect(() => {
    if (loading || exhausted || error || queue.length >= LOW_WATER) return;
    const gen = generation.current;
    setLoading(true);
    const exclude = [...new Set([...skipped.current, ...inHand.current])];
    getQueue(filters, exclude, FETCH_BATCH).then((res) => {
      if (gen !== generation.current) return;
      setLoading(false);
      if (!res.ok) return setError(res.error);
      setPool(res.data.pool);
      const fresh = res.data.words.filter((w) => !inHand.current.includes(w.id) && !skipped.current.includes(w.id));
      inHand.current = [...inHand.current, ...fresh.map((w) => w.id)];
      if (fresh.length === 0) setExhausted(true);
      setQueue((q) => [...q, ...fresh]);
    });
  }, [queue.length, loading, exhausted, error, filters]);

  // Focus the body once the first word is there, and announce each word.
  const wordId = word?.id;
  useEffect(() => {
    if (wordId) {
      focusBody();
      setStatus(`Showing ${word?.norm}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordId, focusBody]);

  const changeFilters = (f: QueueFilters) => {
    generation.current++;
    skipped.current = [];
    inHand.current = [];
    setFilters(f);
    setQueue([]);
    setSelected(null);
    setEditing(null);
    setExhausted(false);
    setError(null);
    setLoading(false);
  };

  /** Move on. A word still pending (whatever the key) is skipped: counted so and left out of later fetches. */
  const advance = useCallback(() => {
    const w = word;
    if (!w) return;
    const wasDecided = w.approval.status !== "pending";
    if (!wasDecided) skipped.current = [...skipped.current, w.id].slice(-SKIPPED_MAX);
    inHand.current = inHand.current.filter((id) => id !== w.id);
    setQueue((q) => q.slice(1));
    setSelected(null);
    setEditing(null);
    setDone((d) => (wasDecided ? { ...d, decided: d.decided + 1 } : { ...d, skipped: d.skipped + 1 }));
  }, [word]);

  /** Save a decision, then update the word on screen. A failure leaves everything as it was. */
  const run = useCallback(
    async (label: string, call: () => Promise<Outcome<unknown>>, apply: (w: BankQueueWord, at: number) => BankQueueWord) => {
      if (busyRef.current || !word) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      const res = await call();
      busyRef.current = false;
      setBusy(false);
      if (!res.ok) {
        setError(`Couldn't save: ${res.error}`);
        return;
      }
      const at = Date.now();
      const id = word.id;
      setQueue((q) => q.map((w) => (w.id === id ? apply(w, at) : w)));
      setStatus(label);
      focusBody();
    },
    [word, focusBody],
  );

  /** Words in view with no suggestion yet (the one on screen first), up to the route's cap. */
  const suggestable = queue.filter((w) => !w.suggestion && !awaiting.includes(w.id)).slice(0, SUGGEST_MAX);

  /** Queue `crossword.suggest` for the pending words in view, then refetch them until the suggestions land. */
  const suggestNext = async () => {
    const ids = suggestable.map((w) => w.id);
    if (!ids.length || awaiting.length) return;
    setError(null);
    const res = await postSuggest(ids);
    if (!res.ok) return setError(`Couldn't queue suggestions: ${res.error}`);
    setAwaiting(ids);
    setStatus(`Queued suggestions for ${ids.length} words`);
    let left = ids;
    for (let i = 0; i < SUGGEST_POLL_MAX && left.length; i++) {
      await new Promise((r) => setTimeout(r, SUGGEST_POLL_MS));
      if (!mounted.current) return;
      const fresh = (await Promise.all(left.map((id) => getBankWord(id)))).flatMap((r) => (r.ok && r.data?.suggestion ? [r.data] : []));
      if (!mounted.current) return;
      if (!fresh.length) continue;
      const got = new Map(fresh.map((d) => [d.id, d.suggestion!]));
      setQueue((q) => q.map((w) => (got.has(w.id) ? { ...w, suggestion: got.get(w.id) } : w)));
      left = left.filter((id) => !got.has(id));
      setAwaiting(left);
    }
    setAwaiting([]);
    setStatus(left.length ? `${left.length} suggestions have not arrived yet` : "Suggestions are in");
  };

  const clueAt = (i: number | null) => (word && i !== null ? word.clues[i] : undefined);

  const act = {
    wordApproval: (s: "approved" | "rejected") =>
      word && run(`${s === "approved" ? "Approved" : "Rejected"} ${word.norm}`, () => patchBankWord(word.id, { approval: s }), (w, at) => withWordApproval(w, s, at)),
    wordFamily: (v: boolean | null) =>
      word && run(`${word.norm} ${v === true ? "family friendly" : v === false ? "not family friendly" : "untagged"}`, () => patchBankWord(word.id, { familyFriendly: v }), (w, at) => withWordFamily(w, v, at)),
    clueApproval: (id: string, s: "approved" | "rejected") =>
      run(`${s === "approved" ? "Approved" : "Rejected"} clue`, () => patchBankClue(id, { approval: s }, word?.id), (w, at) => withClueApproval(w, id, s, at)).then(() => {
        if (s === "rejected") setSelected(null);
      }),
    clueFamily: (id: string, v: boolean | null) =>
      run(`Clue ${v === true ? "family friendly" : v === false ? "not family friendly" : "untagged"}`, () => patchBankClue(id, { familyFriendly: v }), (w, at) => withClueFamily(w, id, v, at)),
    editSave: () => {
      if (!editing) return;
      const { id, draft } = editing;
      const original = word?.clues.find((c) => c.id === id)?.text;
      setEditing(null);
      if (!draft.trim() || draft.trim() === original) return focusBody();
      return run("Edited clue; it is pending until approved", () => patchBankClue(id, { text: draft }), (w, at) => withClueEdit(w, id, draft, at));
    },
    editCancel: () => {
      setEditing(null);
      focusBody();
    },
    /** Tab or a click away from the edit box drops the edit (cancel, never commit) and leaves focus where it went. */
    editBlur: () => setEditing(null),
    acceptSuggestion: async () => {
      if (!word?.suggestion?.clue || busyRef.current) return;
      const id = word.id;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      const res = await patchBankWord(id, { acceptSuggestion: true });
      let detail = res.ok ? res.data : null;
      if (res.ok && (!detail || !Array.isArray(detail.clues))) {
        const again = await getBankWord(id);
        detail = again.ok ? again.data : null;
      }
      busyRef.current = false;
      setBusy(false);
      if (!res.ok || !detail) return setError(`Couldn't save: ${res.ok ? "could not reload the word" : res.error}`);
      setQueue((q) => q.map((w) => (w.id === id ? withClues(w, detail!) : w)));
      setStatus("Suggestion added as a pending clue; approve it to use it");
      focusBody();
    },
  };

  const startEdit = (id: string) => {
    const c = word?.clues.find((x) => x.id === id);
    if (c) setEditing({ id, draft: c.cleaned || c.text });
  };

  // One window listener, reading the latest state through a ref.
  const latest = useRef({ word, selected, editing, act, advance, startEdit });
  latest.current = { word, selected, editing, act, advance, startEdit };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { word: w, selected: sel, editing: ed, act: a, advance: adv, startEdit: edit } = latest.current;
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || ed || !w) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if ((e.key === "Enter" || e.key === " ") && (tag === "BUTTON" || (e.target as HTMLElement).getAttribute("role") === "button")) return;
      const k = e.key.toLowerCase();
      const clue = sel !== null ? w.clues[sel] : undefined;
      const handled = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (k === "a") handled(() => a.wordApproval("approved"));
      else if (k === "r") handled(() => a.wordApproval("rejected"));
      else if (k === "f") handled(() => a.wordFamily(e.shiftKey ? (w.familyFriendly === false ? null : false) : w.familyFriendly === true ? null : true));
      else if (/^[1-9]$/.test(e.key)) handled(() => Number(e.key) <= w.clues.length && setSelected(Number(e.key) - 1));
      else if (e.key === "Escape") handled(() => setSelected(null));
      else if (k === "y" && clue) handled(() => !clue.problem && a.clueApproval(clue.id, "approved"));
      else if (k === "j" || k === "k") handled(() => setSelected((i) => (k === "j" ? (i === null ? 0 : Math.min(w.clues.length - 1, i + 1)) : i === null ? w.clues.length - 1 : Math.max(0, i - 1))));
      else if (k === "x" && clue) handled(() => a.clueApproval(clue.id, "rejected"));
      else if (k === "e" && clue) handled(() => edit(clue.id));
      else if (k === "t" && clue) handled(() => a.clueFamily(clue.id, e.shiftKey ? (clue.familyFriendly === false ? null : false) : clue.familyFriendly === true ? null : true));
      else if (k === "u") handled(() => void a.acceptSuggestion());
      else if (k === "n" || e.key === "Enter") handled(() => !busyRef.current && adv());
      else if (k === "s") handled(() => !busyRef.current && adv());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const set = (patch: Partial<QueueFilters>) => changeFilters({ ...filters, ...patch });

  return (
    <AdminPageShell
      title="Approve"
      description="Approve words and clues for the crossword pool, one word at a time. Nothing from the bank airs until it is approved here."
      maxWidth={1100}
      crumbs={[{ href: "/admin/crosswords", label: "Crosswords" }, { label: "Approve" }]}
    >
      <Stack spacing={1.75}>
        {pool && <PoolCounter pool={pool} dense />}

        <Paper sx={{ p: 1.5 }}>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
            <TextField select size="small" label="Frequency" value={filters.band ?? ""} onChange={(e) => set({ band: (e.target.value || undefined) as BankZipfBand | undefined })} sx={{ width: 170 }}>
              <MenuItem value="">Any</MenuItem>
              {BANK_ZIPF_BANDS.map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Min length" value={filters.minLength ?? ""} onChange={(e) => set({ minLength: Number(e.target.value) || undefined })} sx={{ width: 110 }}>
              <MenuItem value="">Any</MenuItem>
              {LENGTHS.map((n) => (
                <MenuItem key={n} value={n}>
                  {n}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Max length" value={filters.maxLength ?? ""} onChange={(e) => set({ maxLength: Number(e.target.value) || undefined })} sx={{ width: 110 }}>
              <MenuItem value="">Any</MenuItem>
              {LENGTHS.map((n) => (
                <MenuItem key={n} value={n}>
                  {n}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Starts with"
              value={filters.startsWith ?? ""}
              onChange={(e) => set({ startsWith: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1) || undefined })}
              slotProps={{ htmlInput: { maxLength: 1, "aria-label": "Starts with" } }}
              sx={{ width: 100 }}
            />
            <FormControlLabel
              control={<Switch checked={!!filters.withSuggestions} onChange={(e) => set({ withSuggestions: e.target.checked || undefined })} />}
              label="Only with suggestions"
            />
            <Button size="small" variant="outlined" disabled={awaiting.length > 0 || suggestable.length === 0} onClick={() => void suggestNext()}>
              {awaiting.length > 0 ? `Waiting for ${awaiting.length} suggestions…` : `Suggest for the next ${suggestable.length}`}
            </Button>
          </Stack>
        </Paper>

        {error && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => setError(null)}>
                Dismiss
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        <Box
          ref={bodyRef}
          tabIndex={-1}
          aria-label="Approval queue"
          sx={{ outline: "none", "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 4 } }}
        >
          {word ? (
            <QueueWord
              word={word}
              selected={selected}
              editing={editing}
              busy={busy}
              onSelect={(i) => {
                setSelected(i);
                focusBody();
              }}
              onWordApproval={act.wordApproval}
              onWordFamily={act.wordFamily}
              onClueApproval={act.clueApproval}
              onClueFamily={act.clueFamily}
              onEditStart={startEdit}
              onEditChange={(draft) => setEditing((e) => (e ? { ...e, draft } : e))}
              onEditSave={act.editSave}
              onEditCancel={act.editCancel}
              onEditBlur={act.editBlur}
              onAcceptSuggestion={act.acceptSuggestion}
            />
          ) : loading ? (
            <Typography color="text.secondary">Loading…</Typography>
          ) : (
            !error && (
              <Alert severity="success">
                {done.decided + done.skipped > 0 ? "That is the queue for these filters." : "No pending words match these filters."}{" "}
                {pool ? "Widen the filters, or check the Words list." : ""}
              </Alert>
            )
          )}
        </Box>

        {word && (
          <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="contained" disabled={busy} onClick={() => { advance(); focusBody(); }}>
              Next
            </Button>
            <Button disabled={busy} onClick={() => { advance(); focusBody(); }}>
              Skip
            </Button>
            <Typography variant="body2" color="text.secondary">
              {done.decided} done · {done.skipped} skipped this session
            </Typography>
          </Stack>
        )}
        {error && !loading && queue.length < LOW_WATER && (
          <Box>
            <Button size="small" onClick={() => setError(null)}>
              Retry loading
            </Button>
          </Box>
        )}

        <Paper sx={{ p: 1.5 }} aria-label="Key map">
          <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
            Keys
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 0.5 }}>
            {KEY_MAP.map(([k, d]) => (
              <Typography key={k} variant="body2">
                <Box component="kbd" sx={{ fontFamily: font.mono, fontSize: 12, px: 0.5, border: 1, borderColor: "divider", borderRadius: 0.5, mr: 1 }}>
                  {k}
                </Box>
                {d}
              </Typography>
            ))}
          </Box>
        </Paper>

        <Box role="status" aria-live="polite" sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          {status}
        </Box>
      </Stack>
    </AdminPageShell>
  );
}
