import { store } from "../store.js";
import { verifyCode } from "./totp.js";
export function accountMfaProblem(userId: string, code: unknown) {
  const mfa = store.getMfa(userId);
  if (!mfa?.confirmed) return null;
  if (typeof code !== "string" || !code)
    return { code: "MFA_REQUIRED", message: "Enter a code from your authenticator app." };
  const check = verifyCode(mfa.secret, code, { lastUsedStep: mfa.lastStep });
  if (check.ok) {
    store.recordMfaStep(userId, check.step);
    return null;
  }
  if (store.useRecoveryCode(userId, code)) return null;
  return { code: "MFA_INVALID", message: "That authenticator or recovery code is not valid." };
}
