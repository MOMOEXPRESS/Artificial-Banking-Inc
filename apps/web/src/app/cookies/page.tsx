import { MarketingShell, SectionHead } from "../../lib/marketing-shell";

export const metadata = {
  title: "Cookie Notice — Artificial Banking Incorporated",
  description: "The cookies and browser storage ABI uses. Strictly necessary only; no trackers.",
};

const ROWS: [string, string, string][] = [
  ["abi_session", "Cookie", "Keeps you signed in to the console (HttpOnly)."],
  ["abi_csrf", "Cookie", "Protects console actions from cross-site request forgery."],
  [
    "abi_partner_session / abi_partner_csrf",
    "Cookie",
    "The same, for the seller (partner) console.",
  ],
  ["pv_session", "Local storage", "Which organization this browser has open."],
  [
    "pv_prefs, abi_nav_collapsed, abi_theme_v2",
    "Local storage",
    "Console preferences such as layout and light/dark theme.",
  ],
  ["abi_cookie_notice", "Local storage", "Remembers that you dismissed the cookie notice."],
];

export default function CookiesPage() {
  return (
    <MarketingShell active="about">
      <section className="mkt-page">
        <div className="mkt-page-inner">
          <SectionHead
            title="Cookie notice"
            sub="ABI uses only what it needs to sign you in, protect your session and remember preferences. No advertising or analytics cookies."
          />
          <div className="mkt-prose">
            <p>
              Because everything below is strictly necessary for a service you asked for, it does
              not require consent. Clearing this site&apos;s data signs you out.
            </p>
            <table className="mkt-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([name, type, purpose]) => (
                  <tr key={name}>
                    <td className="mono">{name}</td>
                    <td>{type}</td>
                    <td>{purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              The hosting providers (Vercel, Cloudflare) may set their own strictly necessary
              security cookies. See also the <a href="/privacy">Privacy notice</a>.
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
