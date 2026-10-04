import PuzzleDetailPage from "../../../../../components/admin/crosswords/puzzles/PuzzleDetailPage";

/** /admin/crosswords/puzzles/:id — review one puzzle; the page body is a client component. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PuzzleDetailPage id={decodeURIComponent(id)} />;
}
