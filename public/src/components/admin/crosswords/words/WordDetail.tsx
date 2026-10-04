"use client";

/**
 * /admin/crosswords/words/:id — one bank word in full (§8.3): status, length,
 * categories, senses with their definitions, the raw Wiktionary definitions, every clue with its difficulty,
 * source and status, the validation verdict with what each source said, and
 * the raw attempts and validation JSON (collapsed). Read-only for now.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { BankClue, BankWordDetail } from "@photonsurge/shared/crossword-bank";
import AdminPageShell from "../../AdminPageShell";
import { font } from "../../../../theme/tokens";
import { getBankWord } from "./api";
import { ClueStatusChip, DecisionChip, FlagChips, fmtTime, zipfLabel } from "./chips";

// WP5 rework: approval and family-friendly decisions are not on this page yet.
const CLUE_STATUS_COLOR: Record<BankClue["approval"]["status"], "default" | "success" | "error"> = {
  pending: "default",
  approved: "success",
  rejected: "error",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 120 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Box sx={{ typography: "body2" }}>{children}</Box>
    </Box>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <Box component="pre" sx={{ m: 0, fontFamily: font.mono, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {value === undefined ? "—" : JSON.stringify(value, null, 2)}
    </Box>
  );
}

/** A collapsed raw-JSON block. */
function RawJson({ title, value }: { title: string; value: unknown }) {
  return (
    <Box component="details" sx={{ "& summary": { cursor: "pointer", typography: "body2", fontWeight: 600, mb: 1 } }}>
      <summary>{title}</summary>
      <Json value={value} />
    </Box>
  );
}

/** The per-source verdicts as a table when they are a plain object, raw JSON otherwise. */
function Sources({ value }: { value: unknown }) {
  if (value == null) return <Typography variant="body2" color="text.secondary">No per-source verdicts stored.</Typography>;
  if (typeof value !== "object" || Array.isArray(value)) return <Json value={value} />;
  return (
    <Table size="small">
      <TableBody>
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <TableRow key={k}>
            <TableCell sx={{ fontWeight: 600, width: 160 }}>{k}</TableCell>
            <TableCell>
              {v !== null && typeof v === "object" ? <Json value={v} /> : String(v)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function WordDetailView({ word }: { word: BankWordDetail }) {
  return (
    <Stack spacing={1.75}>
      <Section title="Word">
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 3 }}>
          <Fact label="Length">{word.length}</Fact>
          <Fact label="Clue status">
            <ClueStatusChip status={word.clueStatus} />
          </Fact>
          <Fact label="Decision">
            <DecisionChip decision={word.decision} by={word.decisionBy} />
          </Fact>
          <Fact label="Frequency">{zipfLabel(word.zipf)}</Fact>
          <Fact label="Part of speech">{word.pos.join(", ") || "—"}</Fact>
          <Fact label="Flags">
            <FlagChips flags={word.flags} />
          </Fact>
          <Fact label="Model">{word.model ?? "—"}</Fact>
          <Fact label="Updated">{fmtTime(word.updatedAt)}</Fact>
        </Stack>
        {word.reason && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            Reason: {word.reason}
          </Typography>
        )}
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 1.5 }} aria-label="Categories">
          {word.categories.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No categories.
            </Typography>
          ) : (
            word.categories.map((c) => <Chip key={c} size="small" label={c} variant="outlined" />)
          )}
        </Stack>
      </Section>

      <Section title={`Senses (${word.senses.length})`}>
        {word.senses.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No senses stored.
          </Typography>
        ) : (
          <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
            {word.senses.map((s, i) => (
              <Box component="li" key={i} sx={{ mb: 1 }}>
                {s.pos && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                    {s.pos}
                  </Typography>
                )}
                {s.definitions.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    —
                  </Typography>
                ) : (
                  s.definitions.map((d, j) => (
                    <Typography key={j} variant="body2">
                      {d}
                    </Typography>
                  ))
                )}
              </Box>
            ))}
          </Box>
        )}
      </Section>

      <Section title={`Wiktionary definitions (${word.definitions.length})`}>
        {word.definitions.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            None stored.
          </Typography>
        ) : (
          <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
            {word.definitions.map((d, i) => (
              <Typography component="li" key={i} variant="body2" sx={{ mb: 0.5 }}>
                {d}
              </Typography>
            ))}
          </Box>
        )}
      </Section>

      <Section title={`Clues (${word.clues.length})`}>
        {word.clues.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No clues written.
          </Typography>
        ) : (
          <Table size="small" aria-label="Clues">
            <TableHead>
              <TableRow>
                <TableCell>Clue</TableCell>
                <TableCell align="right">Difficulty</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Model</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {word.clues.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    {c.text}
                    {c.original && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        was: {c.original}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{c.difficulty ?? "—"}</TableCell>
                  <TableCell>{c.source ?? "—"}</TableCell>
                  <TableCell sx={{ fontFamily: font.mono, fontSize: 12 }}>{c.model ?? "—"}</TableCell>
                  <TableCell>
                    <Chip size="small" label={c.approval.status} color={CLUE_STATUS_COLOR[c.approval.status]} variant="outlined" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Validation">
        <Stack direction="row" sx={{ gap: 3, mb: 1.5 }}>
          <Fact label="Verdict">
            <DecisionChip decision={word.decision} by={word.decisionBy} />
          </Fact>
          <Fact label="Frequency">{zipfLabel(word.zipf)}</Fact>
        </Stack>
        <Sources value={word.validationSources} />
      </Section>

      <Section title="Raw">
        <Stack spacing={1}>
          <RawJson title="Clue attempts" value={word.raw.attempts} />
          <RawJson title="Validation" value={word.raw.validation} />
        </Stack>
      </Section>
    </Stack>
  );
}

export default function WordDetail({ id }: { id: string }) {
  const [word, setWord] = useState<BankWordDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getBankWord(id).then((res) => {
      if (!live) return;
      if (res.ok) setWord(res.data);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <AdminPageShell
      title={word?.word ?? "Word"}
      maxWidth={1200}
      crumbs={[
        { href: "/admin/crosswords", label: "Crosswords" },
        { href: "/admin/crosswords/words", label: "Words" },
        { label: word?.word ?? id },
      ]}
    >
      {error ? (
        <Alert severity="error">Couldn&apos;t load this word: {error}</Alert>
      ) : !word ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : (
        <WordDetailView word={word} />
      )}
    </AdminPageShell>
  );
}
