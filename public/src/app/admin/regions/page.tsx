import { redirect } from "next/navigation";

/** The region catalog moved to its own first-class page (like /cities). */
export default function AdminRegionsRedirect() {
  redirect("/regions");
}
