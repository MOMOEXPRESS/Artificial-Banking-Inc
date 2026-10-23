/**
 * One sign-out path for every logout control in the web app (topbar button,
 * account menu, Settings → Organization profile, mobile approvals page).
 *
 * Order matters:
 *  1. Revoke the server session first (account sessions only). Clearing local
 *     state alone would leave the httpOnly cookie valid until it expired.
 *  2. Clear every browser-side trace of the session: the stored session row
 *     (which is also where a guardian-key session keeps its key) and the
 *     per-tab scratch values tied to that session.
 *  3. Hard-navigate to the sign-in screen so no in-memory React state (org,
 *     approvals, one-time keys, a guardian key) survives into the next login.
 *
 * Preferences that are not about who is signed in (theme, nav collapsed,
 * console prefs) are kept on purpose.
 */

/** localStorage keys that identify or authenticate the signed-in user. */
export const SESSION_LOCAL_KEYS = ["pv_session"] as const;
/** sessionStorage keys that belong to the signed-in session. */
export const SESSION_TAB_KEYS = ["abi_e2e_wallet", "abi_treasury_tab"] as const;

/** Query flag the sign-in screen reads to show a normal "Signed out" notice. */
export const SIGNED_OUT_PARAM = "signed_out";

export type SignOutOutcome = "ok" | "everywhere" | "local";

type StorageLike = Pick<Storage, "removeItem">;

export type SignOutDeps = {
  apiBase: string;
  /** "session" = email/password account (httpOnly cookie); "key" = guardian key. */
  mode: "session" | "key" | undefined;
  everywhere?: boolean;
  csrf: string;
  orgId?: string;
  fetchImpl?: typeof fetch;
  local?: StorageLike | null;
  tab?: StorageLike | null;
};

/** Remove every client-side session trace. Safe to call more than once. */
export function clearClientSession(local?: StorageLike | null, tab?: StorageLike | null): void {
  for (const k of SESSION_LOCAL_KEYS) {
    try {
      local?.removeItem(k);
    } catch {
      /* storage disabled: nothing to clear */
    }
  }
  for (const k of SESSION_TAB_KEYS) {
    try {
      tab?.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Revoke the server session (when there is one) and clear the browser state.
 * Local state is cleared even when the server call fails, so the button always
 * signs this browser out; the outcome says whether the server confirmed it.
 */
export async function performSignOut(deps: SignOutDeps): Promise<SignOutOutcome> {
  const doFetch = deps.fetchImpl ?? fetch;
  let outcome: SignOutOutcome = deps.everywhere ? "everywhere" : "ok";
  if (deps.mode === "session") {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (deps.csrf) headers["x-abi-csrf"] = deps.csrf;
    if (deps.orgId) headers["x-abi-org"] = deps.orgId;
    try {
      const res = await doFetch(
        `${deps.apiBase}${deps.everywhere ? "/v1/auth/logout-all" : "/v1/auth/logout"}`,
        { method: "POST", credentials: "include", headers },
      );
      // 401 means the server session was already gone: that is signed out.
      if (!res.ok && res.status !== 401) outcome = "local";
    } catch {
      outcome = "local";
    }
  }
  clearClientSession(deps.local, deps.tab);
  return outcome;
}

/** Where to send the browser after signing out. */
export function signedOutUrl(outcome: SignOutOutcome): string {
  return `/console?${SIGNED_OUT_PARAM}=${outcome}`;
}

/** The notice the sign-in screen shows for a `signed_out` flag, or null. */
export function signedOutNotice(value: string | null): { msg: string; kind: "ok" | "info" } | null {
  if (value === "ok") return { msg: "Signed out.", kind: "ok" };
  if (value === "everywhere") return { msg: "Signed out on every device.", kind: "ok" };
  if (value === "local")
    return {
      msg: "Signed out of this browser. The server did not confirm, so sign in and use Log out everywhere if this was a shared device.",
      kind: "info",
    };
  return null;
}

/** Read the double-submit CSRF cookie the API set next to the session cookie. */
export function readCsrfCookie(cookie: string): string {
  const hit = cookie.split(";").find((c) => c.trim().startsWith("abi_csrf="));
  return hit ? decodeURIComponent(hit.trim().slice("abi_csrf=".length)) : "";
}
