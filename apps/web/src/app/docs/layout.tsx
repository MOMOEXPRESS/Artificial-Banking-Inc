import type { Metadata } from "next";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Docs",
  description:
    "Build agents that can spend under policy: create an org, issue agent keys, set rules, and call pay / pay_api / escrow endpoints. Keys never enter the model.",
  path: "/docs",
});

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
