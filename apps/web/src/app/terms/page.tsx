import { MarketingShell, SectionHead } from "../../lib/marketing-shell";

export const metadata = {
  title: "Terms of Use — Artificial Banking Incorporated",
  description: "Terms of use for the Artificial Banking Incorporated console and API.",
};

const TERMS_VERSION = "2026-10-30";

export default function TermsPage() {
  return (
    <MarketingShell active="about">
      <section className="mkt-page">
        <div className="mkt-page-inner">
          <SectionHead
            title="Terms of use"
            sub={`Version ${TERMS_VERSION}. Pre-beta software on a test network. Not a bank. Operators remain responsible for agent spend.`}
          />
          <div className="mkt-prose">
            <h3>1. What ABI is, and is not</h3>
            <p>
              Artificial Banking Incorporated (&ldquo;ABI&rdquo;) is software that puts spending
              policies, human approvals and an audit trail between AI agents and an
              organization&apos;s funds. Despite the name, ABI is <b>not a bank</b>, credit
              institution, money transmitter, payment institution, e-money issuer, broker or
              custodian, and holds no banking, money-transmission or other financial licence. ABI
              does not take deposits, lend, pay interest, or offer investment advice. Balances are
              not insured by the FDIC or any deposit-guarantee scheme.
            </p>
            <h3>2. Test network only</h3>
            <p>
              This deployment runs on Base Sepolia, a public test network. Test USDC has no cash
              value and cannot be redeemed. Mainnet settlement and managed custody are not offered.
              The vault signing key for each organization is held encrypted by the server, which
              means the operator of this deployment could technically move test funds; do not send
              real assets to a vault address.
            </p>
            <h3>3. Pre-beta</h3>
            <p>
              Features may change, break or be withdrawn without notice, and data may be reset. The
              service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
              warranties of any kind, to the extent the law allows.
            </p>
            <h3>4. Eligibility and verification</h3>
            <p>
              You must be at least 18 and able to enter a binding agreement. You may not use ABI if
              you, or anyone you act for, is subject to sanctions or located in an embargoed country
              or region. ABI runs its own basic checks (&ldquo;know your customer&rdquo; and
              &ldquo;know your agent&rdquo;): you attest to who you are and what each agent is for,
              and ABI compares the country you give against a small bundled list. These are
              internal, self-attested checks, not regulated identity verification or sanctions
              screening, and they do not certify compliance with any law. Until you complete them,
              starter spending limits apply. ABI may restrict an organization that fails them.
            </p>
            <h3>5. Your responsibilities</h3>
            <p>
              You are responsible for the credentials issued to your organization, for the policies
              you configure, for approvals you grant, for what your agents do, and for any transfers
              initiated through your vault. Keep API keys and guardian keys secret and revoke
              compromised credentials immediately. Information you give us must be true.
            </p>
            <h3>6. Acceptable use</h3>
            <p>
              Do not use ABI for anything unlawful, including fraud, money laundering, sanctions
              evasion or financing of terrorism; do not attack, probe or overload the service; do
              not access another organization&apos;s data; and do not use ABI to pay for goods or
              services that are illegal where you or the seller are.
            </p>
            <h3>7. Third parties</h3>
            <p>
              Payments may reach third-party sellers, x402 facilitators, blockchain networks and
              stablecoin issuers. ABI is not affiliated with them and is not responsible for their
              services. Names and logos of AI providers and other companies shown on this site are
              trademarks of their owners, used only to describe compatibility; their use does not
              imply endorsement or partnership.
            </p>
            <h3>8. Liability</h3>
            <p>
              To the extent the law allows, ABI is not liable for indirect or consequential loss, or
              for loss of test assets, data or profits. Nothing in these terms limits liability that
              cannot be limited by law.
            </p>
            <h3>9. Changes and contact</h3>
            <p>
              We may update these terms; the version above changes when we do, and continued use
              means you accept the update. For questions, open an issue on the{" "}
              <a href="https://github.com/MOMOEXPRESS/Artificial-Banking-Inc">project repository</a>
              . These terms are a short operator notice for the public pre-beta console; they are
              not a negotiated commercial agreement. See also the{" "}
              <a href="/privacy">Privacy notice</a> and <a href="/cookies">Cookie notice</a>.
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
