import { MarketingShell, SectionHead } from "../../lib/marketing-shell";

export const metadata = {
  title: "Privacy Notice — Artificial Banking Incorporated",
  description:
    "What ABI stores for accounts, sessions, verification and audit trails during pre-beta.",
};

export default function PrivacyPage() {
  return (
    <MarketingShell active="about">
      <section className="mkt-page">
        <div className="mkt-page-inner">
          <SectionHead
            title="Privacy notice"
            sub="Version 2026-10-30. What ABI stores during pre-beta, why, and what you can ask for."
          />
          <div className="mkt-prose">
            <h3>Account data</h3>
            <p>
              When you create an account, ABI stores your email address, display name, a password
              hash (never the password), organization membership, the version and time you accepted
              the terms, and session metadata such as user agent and IP address at sign-in. We use
              it to run your account, keep it secure, and send verification, invitation and approval
              emails.
            </p>
            <h3>Verification (KYC and KYA)</h3>
            <p>
              If you complete verification, ABI stores your legal name, country, account type,
              business name and registration number if you give them, your attestations (age,
              sanctions, politically exposed person), expected volume, and what your agents are for.
              No identity documents, photos or date of birth are collected, and none of this is sent
              to a third-party verification provider: the checks run inside ABI. We use it to decide
              your spending limits and to keep a record of who stands behind each agent.
            </p>
            <h3>Operational data</h3>
            <p>
              The API keeps policy decisions, approvals, ledger journals, notifications, webhook
              delivery attempts, assistant conversations and related audit records needed to operate
              the product and explain every payment. Vault private keys are encrypted at rest.
            </p>
            <h3>Waitlist</h3>
            <p>
              If you join the waitlist we store your email, where you signed up from, and a one-way
              hash of your IP address for abuse limits. We use it only to contact you about access.
            </p>
            <h3>AI assistant</h3>
            <p>
              The in-console assistant answers from your organization&apos;s data on ABI&apos;s own
              servers. Sending data to an outside model provider is off by default and only happens
              if an owner turns it on under Settings → AI &amp; data, which lists exactly what is
              sent.
            </p>
            <h3>Who processes it</h3>
            <p>
              The console is hosted on Vercel and the API on Cloudflare; email is delivered by the
              configured email provider. They process data on our behalf under their own terms. ABI
              does not sell personal data and does not use advertising or analytics trackers.
            </p>
            <h3>Retention and your rights</h3>
            <p>
              We keep account and audit data while your account exists and for as long as needed to
              explain past payments. You can ask for a copy of your data, a correction, or deletion
              of an account you control, and, where the GDPR or similar laws apply, you may object
              or complain to your data-protection authority. Contact the operator through the{" "}
              <a href="https://github.com/MOMOEXPRESS/Artificial-Banking-Inc">project repository</a>
              . Cookies are described in the <a href="/cookies">Cookie notice</a>.
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
