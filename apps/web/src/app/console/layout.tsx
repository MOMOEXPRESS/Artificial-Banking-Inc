import type { Metadata } from "next";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Console",
  description:
    "Guardian console for Artificial Banking Incorporated — treasury, agents, policy, approvals, and playground.",
  path: "/console",
  noIndex: true,
});

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
