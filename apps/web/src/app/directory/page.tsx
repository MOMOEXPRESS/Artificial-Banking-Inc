import { redirect } from "next/navigation";

/** Public directory removed — discovery is private on the seller’s site. */
export default function DirectoryRedirectPage() {
  redirect("/partnerships");
}
