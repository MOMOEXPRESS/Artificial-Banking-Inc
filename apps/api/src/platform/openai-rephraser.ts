/**
 * Optional OpenAI fact rephraser — only polishes language; never invents money facts.
 *
 * Credentials and endpoint are resolved PER ORGANIZATION at call time, not
 * captured at boot from the platform key: this call sends the org's own
 * balances and spend figures, so it obeys the same egress consent as the chat
 * loop. See abi-agent/ai-settings.ts (P8-T2).
 */
import type { FactRephraser } from "./ai.js";

export function createOpenAiFactRephraser(config: {
  apiKey: string;
  baseUrl: string;
  model: string;
}): FactRephraser {
  const { apiKey, baseUrl, model } = config;
  return {
    name: "openai",
    async rewrite({ question, facts }) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You are ABI, Artificial Banking's guardian assistant. Rewrite the FACTS into a clear, concise reply for the guardian. Do not invent numbers, agents, or payments. Do not offer to move money. Keep USD amounts exactly as given. Plain text only — no markdown fences.",
            },
            {
              role: "user",
              content: `Question: ${question}\n\nFACTS (must preserve):\n${facts}`,
            },
          ],
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`openai rephraser HTTP ${res.status}: ${err.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("openai rephraser empty");
      return text;
    },
  };
}
