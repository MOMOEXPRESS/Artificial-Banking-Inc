import type { Metadata } from "next";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description:
    "ABI is in pre-beta. Explore sandbox and developer capabilities while billing, paid plans, and live custody services are not enabled.",
  path: "/pricing",
});

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
