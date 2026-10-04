import Link from "next/link";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PrettyJson from "../words/PrettyJson";
import { SvgFromString } from "../SvgFromString";
import type { MurderMysteryOutline } from "@/lib/mystery/interface";
import { MysteryDetail } from "./types";

type Props = {
  mystery: MysteryDetail;
};

const SectionJson = ({ value }: { value: unknown }) => (
  <Accordion disableGutters variant="outlined" sx={{ mt: 1 }}>
    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
      <Typography variant="caption">Section JSON</Typography>
    </AccordionSummary>
    <AccordionDetails>
      <Box sx={{ p: 1, borderRadius: 1, bgcolor: "action.hover", overflowX: "auto" }}>
        <PrettyJson value={value} />
      </Box>
    </AccordionDetails>
  </Accordion>
);

const fmtDate = (raw: string | Date | undefined) => {
  if (!raw) return "unknown";
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString();
};

const asRecord = (v: unknown): Record<string, unknown> | null => {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
};

const parseOutline = (mystery: MysteryDetail): MurderMysteryOutline | null => {
  if (mystery.outline && typeof mystery.outline === "object" && !Array.isArray(mystery.outline)) {
    return mystery.outline as unknown as MurderMysteryOutline;
  }
  if (typeof mystery.outlineJson === "string" && mystery.outlineJson.trim()) {
    try {
      const parsed = JSON.parse(mystery.outlineJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as unknown as MurderMysteryOutline;
      }
    } catch {
      return null;
    }
  }
  return null;
};

const chapterNumberFromDoc = (chapter: Record<string, unknown>, idx: number) => {
  const a = chapter.chapterNumber;
  const b = chapter.chapter_number;
  const raw = typeof a === "number" ? a : typeof b === "number" ? b : idx + 1;
  return Number.isFinite(raw) ? raw : idx + 1;
};

const keyName = (s: string) => s.trim().toLowerCase();
const assetSrc = (imagePath: string) => `/api/mysteries/asset?path=${encodeURIComponent(imagePath)}`;

const MysteryDetailView = ({ mystery }: Props) => {
  const outline = parseOutline(mystery);
  const title = typeof mystery.title === "string" && mystery.title.trim() ? mystery.title : "(untitled mystery)";
  const logline = typeof outline?.logline === "string" ? outline.logline : "";
  const story = typeof mystery.story === "string" ? mystery.story : "";
  const chapters = (Array.isArray(mystery.chapters) ? mystery.chapters : []).filter(
    (c): c is Record<string, unknown> => typeof c === "object" && c !== null && !Array.isArray(c)
  );
  const cast = Array.isArray(outline?.cast) ? outline.cast : [];
  const clueLedger = Array.isArray(outline?.clue_ledger) ? outline.clue_ledger : [];
  const timeline = Array.isArray(outline?.timeline) ? outline.timeline : [];
  const chapterPlan = Array.isArray(outline?.chapter_plan) ? outline.chapter_plan : [];
  const redHerrings = Array.isArray(outline?.red_herrings) ? outline.red_herrings : [];
  const setting = asRecord(outline?.setting);
  const victim = asRecord(outline?.victim);
  const detective = asRecord(outline?.detective);
  const solution = asRecord(outline?.solution);
  const visualCharacters = Array.isArray(mystery.characterVisuals?.characters) ? mystery.characterVisuals.characters : [];
  const visualLocations = Array.isArray(mystery.locationVisuals?.locations) ? mystery.locationVisuals.locations : [];
  const characterVisualCount = visualCharacters.reduce(
    (sum, c) => sum + (Array.isArray(c.options) ? c.options.length : 0),
    0
  );
  const locationVisualCount = visualLocations.reduce(
    (sum, l) => sum + (Array.isArray(l.options) ? l.options.length : 0),
    0
  );
  const visualsByName = new Map(
    visualCharacters.map((c) => [keyName(c.character_name ?? ""), Array.isArray(c.options) ? c.options : []])
  );

  return (
    <Stack gap={2.5}>
      <Box>
        <Link href="/mysteries" style={{ textDecoration: "none" }}>
          <Button size="small" variant="text" sx={{ px: 0.5 }}>
            Back to mysteries
          </Button>
        </Link>
        <Typography variant="h4" sx={{ mt: 1, fontWeight: 800 }}>
          {title}
        </Typography>
        {logline ? (
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {logline}
          </Typography>
        ) : null}
      </Box>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction={{ xs: "column", sm: "row" }} gap={1} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Chip label={`kind: ${mystery.kind ?? "unknown"}`} color="primary" />
            <Chip label={`chapters: ${chapters.length}`} variant="outlined" />
            <Chip label={`cast: ${cast.length}`} variant="outlined" />
            <Chip label={`clues: ${clueLedger.length}`} variant="outlined" />
            <Chip label={`char visuals: ${characterVisualCount}`} variant="outlined" />
            <Chip label={`location visuals: ${locationVisualCount}`} variant="outlined" />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            created: {fmtDate(mystery.createdAt)} | updated: {fmtDate(mystery.updatedAt)}
          </Typography>
        </Stack>
      </Paper>

      <Accordion disableGutters variant="outlined" defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Outline Summary
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack gap={2}>
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                Setting
              </Typography>
              <Typography variant="body2">
                <Box component="span" sx={{ fontWeight: 700 }}>
                  location:
                </Box>{" "}
                {typeof setting?.location === "string" ? setting.location : "-"}
              </Typography>
              <Typography variant="body2">
                <Box component="span" sx={{ fontWeight: 700 }}>
                  era:
                </Box>{" "}
                {typeof setting?.era === "string" ? setting.era : "-"}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                <Box component="span" sx={{ fontWeight: 700 }}>
                  containment:
                </Box>{" "}
                {typeof setting?.containment === "string" ? setting.containment : "-"}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                <Box component="span" sx={{ fontWeight: 700 }}>
                  tone notes:
                </Box>{" "}
                {Array.isArray(setting?.tone_notes) ? setting?.tone_notes.join(", ") : "-"}
              </Typography>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                Victim & Detective
              </Typography>
              <Typography variant="body2">
                <Box component="span" sx={{ fontWeight: 700 }}>
                  victim:
                </Box>{" "}
                {typeof victim?.name === "string" ? victim.name : "-"} {typeof victim?.why_hated === "string" ? `- ${victim.why_hated}` : ""}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                <Box component="span" sx={{ fontWeight: 700 }}>
                  detective:
                </Box>{" "}
                {typeof detective?.name === "string" ? detective.name : "-"}{" "}
                {typeof detective?.style === "string" ? `- ${detective.style}` : ""}
              </Typography>
              {typeof detective?.blind_spot === "string" ? (
                <Typography variant="body2">
                  <Box component="span" sx={{ fontWeight: 700 }}>
                    blind spot:
                  </Box>{" "}
                  {detective.blind_spot}
                </Typography>
              ) : null}
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                Solution
              </Typography>
              <Typography variant="body2">
                <Box component="span" sx={{ fontWeight: 700 }}>
                  murderer:
                </Box>{" "}
                {typeof solution?.murderer === "string" ? solution.murderer : "-"}
              </Typography>
              <Typography variant="body2">
                <Box component="span" sx={{ fontWeight: 700 }}>
                  motive:
                </Box>{" "}
                {typeof solution?.motive === "string" ? solution.motive : "-"}
              </Typography>
              <Typography variant="body2">
                <Box component="span" sx={{ fontWeight: 700 }}>
                  method:
                </Box>{" "}
                {typeof solution?.method === "string" ? solution.method : "-"}
              </Typography>
              <Typography variant="body2">
                <Box component="span" sx={{ fontWeight: 700 }}>
                  locked room explanation:
                </Box>{" "}
                {typeof solution?.locked_room_explanation === "string" ? solution.locked_room_explanation : "-"}
              </Typography>
            </Paper>
            <SectionJson
              value={{
                setting: outline?.setting ?? null,
                victim: outline?.victim ?? null,
                detective: outline?.detective ?? null,
                solution: outline?.solution ?? null,
              }}
            />
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters variant="outlined" defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Cast
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack gap={1.25}>
            {cast.length === 0 ? <Typography color="text.secondary">No cast data.</Typography> : null}
            {cast.map((member, idx) => (
              <Paper key={`${member.name}-${idx}`} variant="outlined" sx={{ p: 1.25 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {member.name} <Typography component="span" color="text.secondary">({member.role})</Typography>
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  public persona: {member.public_persona}
                </Typography>
                <Typography variant="body2">private secret: {member.private_secret}</Typography>
                <Typography variant="body2">means/access: {member.means_access}</Typography>
                {member.appearance_summary ? (
                  <Typography variant="body2">appearance: {member.appearance_summary}</Typography>
                ) : null}
                {member.signature_item ? (
                  <Typography variant="body2">signature item: {member.signature_item}</Typography>
                ) : null}
                {Array.isArray(member.color_palette) && member.color_palette.length > 0 ? (
                  <Typography variant="body2">color palette: {member.color_palette.join(", ")}</Typography>
                ) : null}
                {member.portrait_brief ? (
                  <Typography variant="body2">portrait brief: {member.portrait_brief}</Typography>
                ) : null}
                {(() => {
                  const options = visualsByName.get(keyName(member.name)) ?? [];
                  if (options.length === 0) return null;
                  return (
                    <>
                      <Divider sx={{ my: 1 }} />
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        Portrait options
                      </Typography>
                      <Stack direction={{ xs: "column", md: "row" }} gap={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
                        {options.map((opt, optIdx) => (
                          <Paper key={`${member.name}-portrait-${opt.option_id ?? optIdx}`} variant="outlined" sx={{ p: 1, flex: "1 1 250px" }}>
                            <Typography variant="caption" sx={{ fontWeight: 700 }}>
                              {opt.label ?? `Option ${optIdx + 1}`}
                            </Typography>
                            {Array.isArray(opt.style_tags) && opt.style_tags.length > 0 ? (
                              <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                                {opt.style_tags.map((tag) => (
                                  <Chip key={`${member.name}-${optIdx}-${tag}`} size="small" label={tag} variant="outlined" />
                                ))}
                              </Stack>
                            ) : null}
                            {typeof opt.image_path === "string" && opt.image_path.trim().length > 0 ? (
                              <Box
                                component="img"
                                src={assetSrc(opt.image_path)}
                                alt={`${member.name} ${opt.label ?? `Option ${optIdx + 1}`}`}
                                sx={{
                                  mt: 1,
                                  display: "block",
                                  width: "100%",
                                  height: 220,
                                  objectFit: "contain",
                                  border: "1px solid",
                                  borderColor: "divider",
                                  borderRadius: 1,
                                  bgcolor: "transparent",
                                }}
                              />
                            ) : typeof opt.svg === "string" && opt.svg.trim().length > 0 ? (
                              <Box sx={{ mt: 1, border: "1px solid", borderColor: "divider", borderRadius: 1, p: 0.5, bgcolor: "background.paper" }}>
                                <SvgFromString svg={opt.svg} />
                              </Box>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                Missing image.
                              </Typography>
                            )}
                          </Paper>
                        ))}
                      </Stack>
                    </>
                  );
                })()}
                {Array.isArray(member.relationships) && member.relationships.length > 0 ? (
                  <>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      Relationships
                    </Typography>
                    <Stack gap={0.35} sx={{ mt: 0.5 }}>
                      {member.relationships.map((r, rIdx) => (
                        <Typography key={`${member.name}-rel-${rIdx}`} variant="body2" color="text.secondary">
                          {r.with}: {r.type} - {r.note}
                        </Typography>
                      ))}
                    </Stack>
                  </>
                ) : null}
                {Array.isArray(member.alibi_windows) && member.alibi_windows.length > 0 ? (
                  <>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      Alibi windows
                    </Typography>
                    <Stack gap={0.35} sx={{ mt: 0.5 }}>
                      {member.alibi_windows.map((a, aIdx) => (
                        <Typography key={`${member.name}-alibi-${aIdx}`} variant="body2" color="text.secondary">
                          {a.from} - {a.to}: {a.claim}
                        </Typography>
                      ))}
                    </Stack>
                  </>
                ) : null}
              </Paper>
            ))}
            <SectionJson value={cast} />
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters variant="outlined" defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Clue Ledger
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Clue</TableCell>
                  <TableCell sx={{ width: 100 }}>Chapter</TableCell>
                  <TableCell>Surface Interpretation</TableCell>
                  <TableCell>True Meaning</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {clueLedger.length === 0 ? (
                  <TableRow>
                    <TableCell>No clue ledger data.</TableCell>
                    <TableCell>-</TableCell>
                    <TableCell>-</TableCell>
                    <TableCell>-</TableCell>
                  </TableRow>
                ) : null}
                {clueLedger.map((c, idx) => (
                  <TableRow key={`${c.clue}-${idx}`}>
                    <TableCell>{c.clue}</TableCell>
                    <TableCell>{c.planted_in_chapter}</TableCell>
                    <TableCell>{c.surface_interpretation}</TableCell>
                    <TableCell>{c.true_meaning}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <SectionJson value={clueLedger} />
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters variant="outlined" defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Timeline
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 140 }}>Time</TableCell>
                  <TableCell>Event</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {timeline.length === 0 ? (
                  <TableRow>
                    <TableCell>No timeline data.</TableCell>
                    <TableCell>-</TableCell>
                  </TableRow>
                ) : null}
                {timeline.map((t, idx) => (
                  <TableRow key={`${t.time}-${idx}`}>
                    <TableCell>{t.time}</TableCell>
                    <TableCell>{t.event}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <SectionJson value={timeline} />
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters variant="outlined">
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Chapter Plan & Red Herrings
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack gap={2}>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 80 }}>Chapter</TableCell>
                    <TableCell>Purpose</TableCell>
                    <TableCell>Key Scenes</TableCell>
                    <TableCell>Hook</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {chapterPlan.length === 0 ? (
                    <TableRow>
                      <TableCell>No chapter plan data.</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell>-</TableCell>
                    </TableRow>
                  ) : null}
                  {chapterPlan.map((cp, idx) => (
                    <TableRow key={`cp-${cp.chapter}-${idx}`}>
                      <TableCell>{cp.chapter}</TableCell>
                      <TableCell>{cp.purpose}</TableCell>
                      <TableCell>{Array.isArray(cp.key_scenes) ? cp.key_scenes.join(", ") : "-"}</TableCell>
                      <TableCell>{cp.chapter_end_hook}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Label</TableCell>
                    <TableCell>Appears As</TableCell>
                    <TableCell>Truth</TableCell>
                    <TableCell>How Resolved</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {redHerrings.length === 0 ? (
                    <TableRow>
                      <TableCell>No red herring data.</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell>-</TableCell>
                    </TableRow>
                  ) : null}
                  {redHerrings.map((rh, idx) => (
                    <TableRow key={`${rh.label}-${idx}`}>
                      <TableCell>{rh.label}</TableCell>
                      <TableCell>{rh.appears_as}</TableCell>
                      <TableCell>{rh.truth}</TableCell>
                      <TableCell>{rh.how_resolved}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
          <SectionJson value={{ chapter_plan: chapterPlan, red_herrings: redHerrings }} />
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters variant="outlined" defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Location Visuals
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack gap={1.25}>
            {visualLocations.length === 0 ? <Typography color="text.secondary">No location visuals.</Typography> : null}
            {visualLocations.map((loc, idx) => {
              const options = Array.isArray(loc.options) ? loc.options : [];
              return (
                <Paper key={`${loc.location_name ?? "location"}-${idx}`} variant="outlined" sx={{ p: 1.25 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {loc.location_name || `Location ${idx + 1}`}
                  </Typography>
                  {loc.location_description ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {loc.location_description}
                    </Typography>
                  ) : null}
                  {options.length === 0 ? (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                      No visual options.
                    </Typography>
                  ) : (
                    <Stack direction={{ xs: "column", md: "row" }} gap={1} flexWrap="wrap" sx={{ mt: 1 }}>
                      {options.map((opt, optIdx) => (
                        <Paper key={`${loc.location_name}-${opt.option_id ?? optIdx}`} variant="outlined" sx={{ p: 1, flex: "1 1 320px" }}>
                          <Typography variant="caption" sx={{ fontWeight: 700 }}>
                            {opt.label ?? `Option ${optIdx + 1}`}
                          </Typography>
                          {Array.isArray(opt.style_tags) && opt.style_tags.length > 0 ? (
                            <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                              {opt.style_tags.map((tag) => (
                                <Chip key={`${loc.location_name}-${optIdx}-${tag}`} size="small" label={tag} variant="outlined" />
                              ))}
                            </Stack>
                          ) : null}
                          {typeof opt.image_path === "string" && opt.image_path.trim().length > 0 ? (
                            <Box
                              component="img"
                              src={assetSrc(opt.image_path)}
                              alt={`${loc.location_name ?? "Location"} ${opt.label ?? `Option ${optIdx + 1}`}`}
                              sx={{
                                mt: 1,
                                display: "block",
                                width: "100%",
                                height: 220,
                                objectFit: "cover",
                                border: "1px solid",
                                borderColor: "divider",
                                borderRadius: 1,
                                bgcolor: "background.default",
                              }}
                            />
                          ) : (
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                              Missing image.
                            </Typography>
                          )}
                        </Paper>
                      ))}
                    </Stack>
                  )}
                </Paper>
              );
            })}
            <SectionJson value={visualLocations} />
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters variant="outlined" defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Chapters
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack gap={1}>
            {chapters.length === 0 ? <Typography color="text.secondary">No chapter docs.</Typography> : null}
            {chapters.map((chapter, idx) => {
              const chapterNo = chapterNumberFromDoc(chapter, idx);
              const chapterTitle =
                typeof chapter.chapterTitle === "string"
                  ? chapter.chapterTitle
                  : typeof chapter.chapter_title === "string"
                  ? chapter.chapter_title
                  : `Chapter ${chapterNo}`;
              const prose = typeof chapter.prose === "string" ? chapter.prose : "";
              const summary = typeof chapter.summary === "string" ? chapter.summary : "";
              return (
                <Accordion key={`chapter-${chapterNo}-${idx}`} disableGutters variant="outlined">
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {chapterTitle}
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack gap={1}>
                      {summary ? (
                        <Typography variant="body2" color="text.secondary">
                          {summary}
                        </Typography>
                      ) : null}
                      {prose ? (
                        <Paper variant="outlined" sx={{ p: 1.25, maxHeight: 420, overflow: "auto" }}>
                          <Typography sx={{ whiteSpace: "pre-wrap" }}>{prose}</Typography>
                        </Paper>
                      ) : null}
                      <Accordion disableGutters variant="outlined">
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <Typography variant="caption">Raw chapter JSON</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                          <Box sx={{ p: 1, borderRadius: 1, bgcolor: "action.hover", overflowX: "auto" }}>
                            <PrettyJson value={chapter} />
                          </Box>
                        </AccordionDetails>
                      </Accordion>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              );
            })}
            <SectionJson value={chapters} />
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters variant="outlined">
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Story
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography sx={{ whiteSpace: "pre-wrap" }}>{story || "No story text."}</Typography>
          <SectionJson value={{ story }} />
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters variant="outlined">
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Raw JSON Blob
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ p: 1, borderRadius: 1, bgcolor: "action.hover", overflowX: "auto" }}>
            <PrettyJson value={mystery} />
          </Box>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
};

export default MysteryDetailView;
