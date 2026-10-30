/** Quick-reply chips under the ABI Assistant chat. */

export const DEFAULT_CHIPS = [
  "What should I do next?",
  "Show recent payments",
  "What's waiting on me?",
  "Show policy bands",
  "What do you remember?",
];

/**
 * Chips follow the conversation: the latest assistant reply carries
 * context-aware follow-ups (meta.suggestions, read-only questions only).
 * Older replies without them fall back to the defaults.
 */
export function quickReplies(
  messages: { role: string; meta?: Record<string, unknown> }[],
): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    const s = m.meta?.suggestions;
    if (Array.isArray(s) && s.length) {
      const chips = s
        .filter((x): x is string => typeof x === "string" && x.length <= 80)
        .slice(0, 4);
      if (chips.length) {
        if (!chips.includes("What do you remember?") && chips.length < 5) {
          chips.push("What do you remember?");
        }
        return chips;
      }
    }
    break;
  }
  return DEFAULT_CHIPS;
}
