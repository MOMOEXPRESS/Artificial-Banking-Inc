import { MarketingShell, SectionHead } from "../../lib/marketing-shell";

export const metadata = {
  title: "Privacy — Artificial Banking Incorporated",
  description: "Privacy notice for the Artificial Banking Incorporated console and API.",
};

export default function PrivacyPage() {
  return (
    <MarketingShell active="about">
      <section className="mkt-page">
        <div className="mkt-page-inner">
          <SectionHead
            eyebrow="Legal"
            title="Privacy notice"
            sub="What ABI stores for accounts, sessions, and money-path audit trails during pre-beta."
          />
          <div className="mkt-prose">
            <h3>Account data</h3>
            <p>
              When you create an account, ABI stores your email address, display name, password
              hash, organization membership, and session metadata (for example user agent and IP at
              sign-in). Email verification and invitation links are sent only when an email backend
              is configured on the API host.
            </p>
            <h3>Operational data</h3>
            <p>
              The API persists policy decisions, approvals, ledger journals, webhook delivery
              attempts, and related audit records needed to operate the product. Vault private keys
              are encrypted at rest with the host-configured key encryption key.
            </p>
            <h3>Hosting</h3>
            <p>
              The public console and API are hosted by the operator&apos;s chosen providers. Those
              providers may process request logs under their own terms. ABI does not sell personal
              data.
            </p>
            <h3>Contact</h3>
            <p>
              To request deletion of an account you control, contact the deployment operator through
              the project repository. Self-serve deletion tooling may expand as the product leaves
              pre-beta.
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
