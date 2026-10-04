import ChannelSettingsPage from "../../../../../components/admin/crosswords/channels/ChannelSettingsPage";

/** /admin/crosswords/channels/:id — a crossword channel's settings; the page body is a client component. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChannelSettingsPage sceneId={decodeURIComponent(id)} />;
}
