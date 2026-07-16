"use client";

/**
 * One CAP <info> block on /admin/alerts/:id — headline/description/instruction
 * (English translation preferred, original shown under it), the source's own
 * parameters, and the affected areas with their geocodes.
 */
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import {
  displayDescription,
  displayHeadline,
  displayInstruction,
  severityColor,
  severityLabel,
  type AlertInfo,
} from "../../lib/alerts";
import { surface } from "../../theme/tokens";

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

function TextRow({ label, text, original }: { label: string; text?: string; original?: string }) {
  if (!text) return null;
  const translated = original && original !== text;
  return (
    <Box sx={{ mt: 1.25 }}>
      <Typography variant="overline" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {text}
      </Typography>
      {translated && (
        <Typography variant="caption" color="text.disabled" sx={{ display: "block", fontStyle: "italic", mt: 0.5, whiteSpace: "pre-wrap" }}>
          orig: {original}
        </Typography>
      )}
    </Box>
  );
}

export default function AlertInfoBlock({ info, index }: { info: AlertInfo; index: number }) {
  return (
    <Paper sx={{ p: 1.75, mt: 1.75 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="overline" color="text.secondary">
          Info #{index + 1}
        </Typography>
        {/*
          The severity swatch is filled with the rank's own ramp colour
          (DESIGN_BIBLE §4.4) rather than a theme semantic: rank IS the meaning
          here, and severityColor() is the product-wide source of that ramp.
        */}
        <Box
          component="span"
          title={severityLabel(info.severityRank)}
          sx={{
            px: 1,
            borderRadius: 1,
            fontSize: 11,
            fontWeight: 700,
            color: surface.page,
            bgcolor: severityColor(info.severityRank),
          }}
        >
          {info.severityRank} · {severityLabel(info.severityRank)}
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {info.event}
        </Typography>
        {info.severity && (
          <Typography variant="caption" color="text.secondary">
            source: {info.severity}
          </Typography>
        )}
        {info.detectedLanguage && info.translatedAt && (
          <Box
            component="span"
            sx={{ border: 1, borderColor: "divider", borderRadius: 1, px: 0.75, fontSize: 11, color: "text.secondary" }}
          >
            {info.detectedLanguage.toUpperCase()}→EN
          </Box>
        )}
      </Stack>

      <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: "wrap", color: "text.secondary" }}>
        {info.onset && <Typography variant="caption">onset <code>{fmtTime(info.onset)}</code></Typography>}
        {info.effective && <Typography variant="caption">effective <code>{fmtTime(info.effective)}</code></Typography>}
        {info.expires && <Typography variant="caption">expires <code>{fmtTime(info.expires)}</code></Typography>}
        {info.web && (
          <Link href={info.web} target="_blank" rel="noreferrer" variant="caption">
            source page ↗
          </Link>
        )}
      </Stack>

      <TextRow label="Headline" text={displayHeadline(info)} original={info.headline} />
      <TextRow label="Description" text={displayDescription(info)} original={info.description} />
      <TextRow label="Instruction" text={displayInstruction(info)} original={info.instruction} />

      {!!info.area?.length && (
        <Box sx={{ mt: 1.25 }}>
          <Typography variant="overline" color="text.secondary" component="div">
            Areas ({info.area.length})
          </Typography>
          {info.area.map((a, i) => (
            <Typography key={i} variant="body2" sx={{ py: 0.375 }}>
              {a.areaDesc || "(unnamed area)"}
              {a.geometry ? (
                <Typography component="span" variant="caption" color="text.disabled">
                  {" "}
                  · {a.geometry.type}
                </Typography>
              ) : null}
              {!!a.geocodes?.length && (
                <Typography component="span" variant="caption" color="text.disabled">
                  {" "}
                  · <code>{a.geocodes.map((g) => `${g.valueName}:${g.value}`).join(", ")}</code>
                </Typography>
              )}
            </Typography>
          ))}
        </Box>
      )}

      {info.parameters && Object.keys(info.parameters).length > 0 && (
        <Box sx={{ mt: 1.25 }}>
          <Typography variant="overline" color="text.secondary" component="div">
            Parameters
          </Typography>
          <Table sx={{ width: "auto" }}>
            <TableBody>
              {Object.entries(info.parameters).map(([k, v]) => (
                <TableRow key={k}>
                  <TableCell sx={{ color: "text.disabled", border: 0, py: 0.25, pl: 0, pr: 1.75, whiteSpace: "nowrap", verticalAlign: "top" }}>
                    {k}
                  </TableCell>
                  <TableCell sx={{ border: 0, py: 0.25, px: 0, wordBreak: "break-word" }}>{String(v)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Paper>
  );
}
