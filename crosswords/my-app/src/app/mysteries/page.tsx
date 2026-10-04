import { auth } from "@/auth";
import MysteriesPageClient from "@/lib/components/mysteries/MysteriesPageClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const MysteriesPage = async () => {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/mysteries");
  }
  return <MysteriesPageClient />;
};

export default MysteriesPage;
