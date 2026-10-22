import type { Metadata } from "next";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "About",
  description:
    "What Artificial Banking Incorporated is and is not: policy-gated agent wallets, approvals, and an audit trail — not a consumer bank or chat that moves money.",
  path: "/about",
});

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
