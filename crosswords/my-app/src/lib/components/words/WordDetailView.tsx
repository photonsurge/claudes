import Link from "next/link";
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, Divider, List, ListItem, ListItemText, Paper, Stack, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import JsonPanel from "./JsonPanel";
import PrettyJson from "./PrettyJson";
import { WordClue, WordListItem } from "./types";

type Props = {
  word: WordListItem;
  clues: WordClue[];
};

const WordDetailView = ({ word, clues }: Props) => {
  const displayWord = word.norm || word.word || "(unknown)";
  const model = word.enrichment?.model || "n/a";
  const status = word.enrichment?.status ?? "unknown";
  const categories = Array.isArray(word.categorySlugs) ? word.categorySlugs : [];
  const flags = word.flags && typeof word.flags === "object" ? (word.flags as Record<string, unknown>) : {};
  const flagEntries = Object.entries(flags);
  const senses = Array.isArray(word.senses) ? (word.senses as Array<Record<string, unknown>>) : [];
  const validation = word.validation;
  const validationNotes = Array.isArray(validation?.notes) ? validation.notes : [];
  const validationSources = validation?.sources && typeof validation.sources === "object" ? Object.entries(validation.sources) : [];

  const validationColor = (decision?: string) => {
    if (decision === "accepted") return "success";
    if (decision === "review") return "warning";
    if (decision === "reject") return "error";
    return "default";
  };

  const sourceSummary = (name: string, src: Record<string, unknown>) => {
    const checked = src.checked === true;
    if (!checked) return `not checked${typeof src.reason === "string" ? ` (${src.reason})` : ""}`;

    if (name === "hunspell") return `accepted: ${String(Boolean(src.accepted))}`;
    if (name === "scowl") return `in list: ${String(Boolean(src.inList))}`;
    if (name === "wordnet") {
      const found = String(Boolean(src.foundLemma));
      const synsetCount = typeof src.synsetCount === "number" ? src.synsetCount : "-";
      return `lemma: ${found}, synsets: ${synsetCount}`;
    }
    if (name === "wordfreq") {
      const zipf = typeof src.zipf === "number" ? src.zipf : "-";
      const band = typeof src.rankBand === "string" ? src.rankBand : "-";
      return `zipf: ${zipf}, band: ${band}`;
    }
    return "checked";
  };

  return (
    <Stack gap={2.5}>
      <Box>
        <Link href="/words" style={{ textDecoration: "none" }}>
          <Button size="small" variant="text" sx={{ px: 0.5 }}>
            Back to words
          </Button>
        </Link>
        <Typography variant="h4" sx={{ mt: 1, fontWeight: 800 }}>
          {displayWord}
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction={{ xs: "column", sm: "row" }} gap={1} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Chip label={`status: ${status}`} color="primary" variant="filled" />
            <Chip label={`length: ${word.length ?? "-"}`} variant="outlined" />
            <Chip label={`clues: ${clues.length}`} variant="outlined" />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: { xs: "100%", md: 420 }, wordBreak: "break-word" }}>
            model: {model}
          </Typography>
        </Stack>
        {word.enrichment?.reason ? (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography variant="body2" color="text.secondary">
              reason: {word.enrichment.reason}
            </Typography>
          </>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
          Categories ({categories.length})
        </Typography>
        <Stack direction="row" gap={1} flexWrap="wrap">
          {categories.length === 0 ? <Typography color="text.secondary">No categories.</Typography> : null}
          {categories.map((c) => (
            <Chip key={c} label={c} size="small" variant="outlined" />
          ))}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
          Flags ({flagEntries.length})
        </Typography>
        <List dense disablePadding>
          {flagEntries.length === 0 ? (
            <ListItem disableGutters>
              <ListItemText primary="No flags." />
            </ListItem>
          ) : null}
          {flagEntries.map(([k, v], idx) => (
            <ListItem key={k} disableGutters divider={idx < flagEntries.length - 1}>
              <ListItemText primary={k} secondary={String(v)} />
            </ListItem>
          ))}
        </List>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
          Senses ({senses.length})
        </Typography>
        <List dense disablePadding>
          {senses.length === 0 ? (
            <ListItem disableGutters>
              <ListItemText primary="No senses." />
            </ListItem>
          ) : null}
          {senses.map((s, i) => {
            const pos = typeof s.pos === "string" ? s.pos : undefined;
            const definition = typeof s.definition === "string" ? s.definition : JSON.stringify(s);
            const register = typeof s.register === "string" ? s.register : undefined;
            const domains = Array.isArray(s.domains) ? (s.domains as string[]) : [];
            const metaParts = [pos ? `pos: ${pos}` : null, register ? `register: ${register}` : null, domains.length ? `domains: ${domains.join(", ")}` : null].filter(Boolean);
            return (
              <ListItem key={`${i}-${definition.slice(0, 24)}`} disableGutters divider alignItems="flex-start">
                <ListItemText
                  primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
                  primary={definition}
                  secondary={metaParts.join(" • ")}
                />
              </ListItem>
            );
          })}
        </List>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
          Validation
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} gap={1} alignItems={{ xs: "flex-start", sm: "center" }}>
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Chip
              label={`decision: ${validation?.decision ?? "n/a"}`}
              color={validationColor(validation?.decision)}
              variant={validation?.decision ? "filled" : "outlined"}
            />
            <Chip
              label={`score: ${typeof validation?.score === "number" ? validation.score.toFixed(2) : "-"}`}
              variant="outlined"
            />
            <Chip label={`version: ${validation?.version ?? "-"}`} variant="outlined" />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            runAt: {validation?.runAt ?? "-"}
          </Typography>
        </Stack>
        <List dense disablePadding sx={{ mt: 1 }}>
          {validationNotes.length === 0 ? (
            <ListItem disableGutters>
              <ListItemText primary="Notes: none" />
            </ListItem>
          ) : null}
          {validationNotes.map((note, idx) => (
            <ListItem key={`${note}-${idx}`} disableGutters divider={idx < validationNotes.length - 1}>
              <ListItemText primary={`note: ${note}`} />
            </ListItem>
          ))}
        </List>
        <Divider sx={{ my: 1 }} />
        <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
          Sources ({validationSources.length})
        </Typography>
        <List dense disablePadding>
          {validationSources.length === 0 ? (
            <ListItem disableGutters>
              <ListItemText primary="No validation sources." />
            </ListItem>
          ) : null}
          {validationSources.map(([name, raw], idx) => {
            const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
            return (
              <ListItem key={name} disableGutters divider={idx < validationSources.length - 1} alignItems="flex-start">
                <ListItemText
                  primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }}
                  primary={name}
                  secondary={sourceSummary(name, src)}
                />
              </ListItem>
            );
          })}
        </List>
      </Paper>

      <JsonPanel title="Attempts" value={word.enrichment?.attempts || []} />
      <JsonPanel title="Validation JSON" value={word.validation || {}} />

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
          Clues ({clues.length})
        </Typography>
        <List dense disablePadding>
          {clues.length === 0 ? (
            <ListItem disableGutters>
              <ListItemText primary="No clues yet." />
            </ListItem>
          ) : null}
          {clues.map((c, i) => (
            <ListItem key={`${i}-${c.clue}`} disableGutters divider alignItems="flex-start">
              <ListItemText
                primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
                primary={c.clue}
                secondary={
                  c.source
                    ? `difficulty ${c.difficulty ?? "?"} • source: ${c.source.name ?? "?"}${c.source.ref ? `/${c.source.ref}` : ""}${c.source.createdBy ? ` (${c.source.createdBy})` : ""}`
                    : `difficulty ${c.difficulty ?? "?"}`
                }
              />
            </ListItem>
          ))}
        </List>
      </Paper>

      <Accordion disableGutters variant="outlined">
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Raw JSON Blob
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ p: 1, borderRadius: 1, bgcolor: "action.hover", overflowX: "auto" }}>
            <PrettyJson value={{ word, clues }} />
          </Box>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
};

export default WordDetailView;
