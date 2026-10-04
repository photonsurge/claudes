import Link from "next/link";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import AdminPageShell from "../../../components/admin/AdminPageShell";

/**
 * /admin/crosswords — the crossword section's hub (docs/crossword-mode-plan.md
 * §8.3): what is shared across crossword channels. Each channel's live Desk is
 * reached from the Channels list.
 */
const LINKS = [
  { href: "/admin/crosswords/words", title: "Words", desc: "The imported word bank — clue status, approval, family-friendly tag, frequency, senses and clues." },
  { href: "/admin/crosswords/approve", title: "Approve", desc: "The approval queue: approve words and clues and tag them family friendly, one word at a time, from the keyboard." },
  { href: "/admin/crosswords/puzzles", title: "Puzzles", desc: "The stock: built, approved and played puzzles. Generate, edit, approve or reject." },
  { href: "/admin/crosswords/players", title: "Players", desc: "Totals per player; hide and unhide." },
];

export default function CrosswordsPage() {
  return (
    <AdminPageShell title="Crosswords" description="Words, puzzles and players shared across crossword channels." maxWidth={1180}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 1.5 }}>
        {LINKS.map((l) => (
          // Plain <Link> around the card: a server component can't pass Link as a prop (see /admin).
          <Link key={l.href} href={l.href} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
            <Paper sx={{ p: 2, height: "100%", "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" } }}>
              <Typography variant="h3" color="text.primary">
                {l.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                {l.desc}
              </Typography>
            </Paper>
          </Link>
        ))}
      </Box>
    </AdminPageShell>
  );
}
