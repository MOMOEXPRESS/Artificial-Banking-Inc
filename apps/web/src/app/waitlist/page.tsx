import type { Metadata } from "next";
import { WaitlistPage } from "./waitlist-page";
import { OG_IMAGE } from "../../lib/og";

export const metadata: Metadata = {
  title: "Join the waitlist · Artificial Banking Inc.",
  description:
    "ABI lets AI agents pay for things under your rules. Join the waitlist for early access.",
  openGraph: {
    title: "Join the ABI waitlist",
    description: "Let AI agents pay for things — without losing control.",
    url: "/waitlist",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "Join the ABI waitlist",
    description: "Let AI agents pay for things — without losing control.",
    images: [OG_IMAGE.url],
  },
};

export default function Page() {
  return <WaitlistPage />;
}
