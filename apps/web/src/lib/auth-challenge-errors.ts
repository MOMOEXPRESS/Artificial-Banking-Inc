export function challengeErrorMessage(code: string) {
  if (code === "110200")
    return "The security check could not verify this website address. Please retry shortly.";
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
