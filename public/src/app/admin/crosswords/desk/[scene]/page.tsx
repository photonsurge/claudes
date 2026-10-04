import DeskPage from "../../../../../components/admin/crosswords/desk/DeskPage";

/** /admin/crosswords/desk/:scene — live operation of one crossword channel; the page body is a client component. */
export default async function Page({ params }: { params: Promise<{ scene: string }> }) {
  const { scene } = await params;
  return <DeskPage sceneId={decodeURIComponent(scene)} />;
}
