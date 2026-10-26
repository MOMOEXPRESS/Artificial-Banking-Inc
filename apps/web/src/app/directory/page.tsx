import { redirect } from "next/navigation";

/** No buyer directory UI yet; the listing is served by GET /v1/directory/offers. */
export default function DirectoryRedirectPage() {
  redirect("/partnerships");
}
