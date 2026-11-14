"use client";
import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { browserApiBase } from "./browser-api";
const cookie = (name: string) =>
  document.cookie
    .split("; ")
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1) ?? "";
export function CompleteSignIn({ destination }: { destination: "console" | "seller" }) {
  const [terms, setTerms] = useState(false),
    [link, setLink] = useState(false),
    [needsLink, setNeedsLink] = useState(false),
    [needsMfa, setNeedsMfa] = useState(false),
    [mfa, setMfa] = useState(""),
    [seller, setSeller] = useState(destination === "seller"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function finish() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/identity/complete", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-abi-identity-csrf": decodeURIComponent(cookie("abi_identity_csrf")),
        },
        body: JSON.stringify({
          acceptTerms: terms,
          linkExisting: link,
          ...(mfa ? { mfaCode: mfa } : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.error?.code === "ACCOUNT_LINK_REQUIRED") setNeedsLink(true);
        if (["MFA_REQUIRED", "MFA_INVALID"].includes(data.error?.code)) setNeedsMfa(true);
        throw Error(
          data.error?.message ?? "Sign-in could not finish. Restart sign-in and try again.",
        );
      }
      const org = data.orgs?.[0];
      if (!org) throw Error("No ABI workspace is available. Contact the account owner.");
      localStorage.setItem(
        "pv_session",
        JSON.stringify({
          mode: "session",
          guardianKey: "",
          orgId: org.id,
          user: data.user,
          agentKeys: [],
        }),
      );
      if (seller) {
        try {
          const list = await fetch(`${browserApiBase()}/v1/account/workspaces`, {
            credentials: "include",
          }).then((r) => r.json());
          const wallet = list.workspaces?.find(
            (w: { orgId: string; isDefault: boolean }) => w.orgId === org.id && w.isDefault,
          );
          if (!wallet) throw Error();
          const enabled = await fetch(
            `${browserApiBase()}/v1/guardian/workspaces/${wallet.id}/seller`,
            {
              method: "POST",
              credentials: "include",
              headers: {
                "content-type": "application/json",
                "x-abi-org": org.id,
                "x-abi-workspace": wallet.id,
                "x-abi-csrf": decodeURIComponent(cookie("abi_csrf")),
              },
              body: '{"linkExisting":false}',
            },
          );
          if (!enabled.ok) throw Error();
          localStorage.setItem(`abi_workspace:${org.id}`, wallet.id);
          sessionStorage.setItem("abi_seller_workspace", wallet.id);
          window.location.assign("/seller/catalog");
          return;
        } catch {
          window.location.assign("/console?view=connect");
          return;
        }
      }
      window.location.assign("/console");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="abi-identity-complete">
      <Link href="/" className="abi-identity-brand">
        ABI
      </Link>
      <section>
        <ShieldCheck size={28} />
        <h1>Finish signing in</h1>
        <p>
          Your Google or GitHub identity is verified before ABI gives access to a workspace.
          Existing wallets stay with their account.
        </p>
        {needsLink && (
          <div className="abi-identity-link">
            <p>Sign in to your existing ABI account in another tab, then return here to link it.</p>
            <a href="/console?legacy=1" target="_blank" rel="noopener noreferrer">
              Open existing account sign-in
            </a>
            <label>
              <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} />
              Link this provider to my signed-in ABI account
            </label>
          </div>
        )}
        {needsMfa && (
          <label>
            Authenticator or recovery code
            <input
              autoComplete="one-time-code"
              value={mfa}
              onChange={(e) => setMfa(e.target.value)}
              maxLength={100}
            />
          </label>
        )}
        <label className="abi-identity-check">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>
            I accept the <Link href="/terms">Terms</Link> and{" "}
            <Link href="/privacy">Privacy Notice</Link> when creating a new account.
          </span>
        </label>
        {destination === "seller" && (
          <label className="abi-identity-check">
            <input type="checkbox" checked={seller} onChange={(e) => setSeller(e.target.checked)} />
            Enable seller tools in my default workspace
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          onClick={() => void finish()}
          disabled={busy || (needsLink && !link) || (needsMfa && !mfa.trim())}
        >
          {busy ? "Connecting…" : "Continue to ABI"}
          <ArrowRight size={17} />
        </button>
        <Link href="/console">Back to sign-in</Link>
      </section>
    </main>
  );
}
