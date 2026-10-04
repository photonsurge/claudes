import WordDetail from "../../../../../components/admin/crosswords/words/WordDetail";

/** /admin/crosswords/words/:id — one bank word; the page body is a client component. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WordDetail id={id} />;
}
