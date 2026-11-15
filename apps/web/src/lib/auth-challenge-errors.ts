export const AUTH_CANONICAL_ORIGIN = "https://artificial-banking-inc-web.vercel.app";
export const AUTH_PRODUCTION_ALIASES = [
  "artificial-banking-inc-web-momoexpress-projects.vercel.app",
  "artificial-banking-inc-web-git-main-momoexpress-projects.vercel.app",
];
export function challengeErrorMessage(code: string) {
  if (code === "110200")
    return "This website address is not enabled for the security check. Open the main ABI website to sign in.";
  if (["110100", "110110", "400020", "400021", "400070"].includes(code))
    return "The security check configuration could not be confirmed. Continue with Google or GitHub, or try again shortly.";
  if (code === "200500")
    return "Cloudflare’s security check could not connect. Retry the check; if it persists, check whether your browser or network blocks challenges.cloudflare.com.";
  if (["110600", "110620"].includes(code))
    return "The security check timed out. Retry it without re-entering your details.";
  if (code === "200100")
    return "The security check could not confirm your browser’s time or cached data. Check your device clock and retry.";
  return "Cloudflare could not complete the security check. Retry it, or continue with Google or GitHub.";
}
