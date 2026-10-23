import { redirect } from "next/navigation";

/** Legacy / deep link: signup lives on the console login surface. */
export default function ConsoleSignupPage() {
  redirect("/console?signup=1");
}
