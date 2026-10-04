import { auth } from "@/auth";
import WordsPageClient from "@/lib/components/words/WordsPageClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const WordsPage = async () => {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/words");
  }
  return <WordsPageClient />;
};

export default WordsPage;
