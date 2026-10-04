import { auth } from "@/auth";
import WordDetailClient from "@/lib/components/words/WordDetailClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const WordDetail = async ({ params }: { params: Promise<{ id: string }> }) => {
  const p = await params;
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=/words/${encodeURIComponent(p.id)}`);
  }
  return <WordDetailClient id={p.id} />;
};

export default WordDetail;
