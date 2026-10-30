import type { Metadata } from "next";
import { WaitlistPage } from "./waitlist-page";

export const metadata: Metadata = {
  title: "Join the waitlist · Artificial Banking Inc.",
  description:
    "ABI lets AI agents pay for things under your rules. Join the waitlist for early access.",
  openGraph: {
    title: "Join the ABI waitlist",
    description: "Let AI agents pay for things — without losing control.",
  },
};

export default function Page() {
  return <WaitlistPage />;
}
