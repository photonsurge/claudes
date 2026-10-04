import { auth } from "@/auth";
import MysteryDetailClient from "@/lib/components/mysteries/MysteryDetailClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const MysteryDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const p = await params;
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=/mysteries/${encodeURIComponent(p.id)}`);
  }
  return <MysteryDetailClient id={p.id} />;
};

export default MysteryDetailPage;
