import type { Metadata } from "next";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Approvals",
  description: "Mobile-friendly inbox to approve or deny pending agent payments.",
  path: "/approvals",
  noIndex: true,
});

export default function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
