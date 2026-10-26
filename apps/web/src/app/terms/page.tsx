import { MarketingShell, SectionHead } from "../../lib/marketing-shell";

export const metadata = {
  title: "Terms of Use — Artificial Banking Incorporated",
  description: "Terms of use for the Artificial Banking Incorporated console and API.",
};

export default function TermsPage() {
  return (
    <MarketingShell active="about">
      <section className="mkt-page">
        <div className="mkt-page-inner">
          <SectionHead
            title="Terms of use"
            sub="Pre-beta software. Not a bank. Not FDIC insured. Operators remain responsible for agent spend."
          />
          <div className="mkt-prose">
            <h3>Status</h3>
            <p>
              Artificial Banking Incorporated (ABI) is pre-beta. Features may change, break, or be
              withdrawn without notice. Do not use ABI to hold or move funds you cannot afford to
              lose, and do not treat console balances as a bank deposit.
            </p>
            <h3>Your responsibilities</h3>
            <p>
              You are responsible for credentials issued to your organization, for the policies you
              configure, for approvals you grant, and for any on-chain transfers initiated through
              your vault. Keep API keys and guardian keys secret. Revoke compromised credentials
              immediately.
            </p>
            <h3>Test networks</h3>
            <p>
              Default deployments target Base Sepolia and other test networks. Test assets have no
              cash value. Moving to a mainnet chain is an operator decision and requires your own
              review of custody, compliance, and risk controls.
            </p>
            <h3>Contact</h3>
            <p>
              For product questions, use the project repository. These terms are a short operator
              notice for the public console; they are not a substitute for a negotiated commercial
              agreement.
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
