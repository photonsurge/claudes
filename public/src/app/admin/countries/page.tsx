import { redirect } from "next/navigation";

/** The country catalog moved to its own first-class page (like /cities). */
export default function AdminCountriesRedirect() {
  redirect("/countries");
}
