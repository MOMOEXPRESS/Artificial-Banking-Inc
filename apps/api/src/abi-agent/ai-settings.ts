/**
 * Per-organization control over where financial data goes (P8-T2, finding M4).
 *
 * The chat assistant builds a system prompt containing balances, agent names,
 * spend figures and remembered facts, and posted it to api.openai.com under a
 * *platform* API key, for every organization, enabled by default. There was no
 * opt-out, no way to use your own vendor account, no data-residency control and
 * no disclosure anywhere in the product. An enterprise security questionnaire
 * fails on that line alone, and rightly.
 *
 * Three modes now, and the default is the conservative one:
 *
 *   off       — nothing leaves. The keyword assistant still answers; it is
 *               narrower, not broken. This is the default for every org,
 *               including existing ones.
 *   platform  — the operator's OPENAI_API_KEY, explicitly opted into by an
 *               owner who has been shown what gets sent.
 *   byo       — the org's own credential and endpoint. Their vendor contract,
 *               their DPA, their region.
 *
 * Defaulting to `off` means an org that was silently sending data yesterday
 * stops today. That is the point: consent cannot be retroactive, and the
 * fallback path already works.
 */
import { decryptSecret, encryptSecret, isEncrypted } from "../auth/key-encryption.js";
import { store } from "../store.js";

export type AiMode = "off" | "platform" | "byo";

/** What an operator sees and edits. Never contains key material. */
export type AiSettingsView = {
  mode: AiMode;
  /** Provider host data is sent to under the current mode; null when off. */
  egressHost: string | null;
  model: string;
  /** True when a BYO credential is stored. The key itself is never returned. */
  hasOwnKey: boolean;
  baseUrl: string | null;
  /** Why the effective mode may differ from the configured one. */
  note?: string;
};

type StoredAiSettings = {
  mode?: AiMode;
  /** Encrypted under ABI_KEK with the org id as AAD. */
  apiKeyEnc?: string;
  baseUrl?: string;
  model?: string;
};

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

function read(orgId: string): StoredAiSettings {
  const settings = store.getOrg(orgId)?.settings ?? {};
  const ai = (settings as Record<string, unknown>).ai;
  return ai && typeof ai === "object" ? (ai as StoredAiSettings) : {};
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * The resolved configuration the chat loop should use, or null when this org
 * has not agreed to send its data anywhere.
 */
export function resolveAiEgress(orgId: string): {
  apiKey: string;
  baseUrl: string;
  model: string;
  mode: Exclude<AiMode, "off">;
} | null {
  // A kill switch for the whole deployment still wins over any org's choice.
  if (process.env.ABI_CHAT_LLM === "0") return null;

  const stored = read(orgId);
  const mode: AiMode = stored.mode ?? "off";
  if (mode === "off") return null;

  const baseUrl = (stored.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = stored.model?.trim() || process.env.ABI_OPENAI_MODEL?.trim() || DEFAULT_MODEL;

  if (mode === "byo") {
    if (!stored.apiKeyEnc) return null;
    // decryptSecret passes plaintext through unchanged, which is right for the
    // legacy vault-key migration and wrong here: a corrupt or hand-edited value
    // would be sent verbatim to a model provider as a bearer token. Require
    // real ciphertext.
    if (!isEncrypted(stored.apiKeyEnc)) return null;
    let apiKey: string;
    try {
      apiKey = decryptSecret(stored.apiKeyEnc, orgId);
    } catch {
      // A key we cannot decrypt is not a reason to silently fall back to the
      // platform account — that would send their data to a vendor they did not
      // choose. Degrade to the keyword assistant instead.
      return null;
    }
    return { apiKey, baseUrl, model, mode };
  }

  const platformKey = process.env.OPENAI_API_KEY?.trim();
  if (!platformKey) return null;
  return { apiKey: platformKey, baseUrl, model, mode };
}

/** Operator-facing view, including why a chosen mode may not be active. */
export function aiSettingsView(orgId: string): AiSettingsView {
  const stored = read(orgId);
  const mode: AiMode = stored.mode ?? "off";
  const baseUrl = (stored.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = stored.model?.trim() || process.env.ABI_OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  const hasOwnKey = Boolean(stored.apiKeyEnc);

  let note: string | undefined;
  if (process.env.ABI_CHAT_LLM === "0" && mode !== "off") {
    note = "Disabled for the whole deployment by ABI_CHAT_LLM=0 — nothing is being sent.";
  } else if (mode === "platform" && !process.env.OPENAI_API_KEY?.trim()) {
    note = "No platform model credential is configured, so the keyword assistant is answering.";
  } else if (mode === "byo" && !hasOwnKey) {
    note = "No API key stored yet, so the keyword assistant is answering.";
  }

  return {
    mode,
    egressHost: mode === "off" ? null : hostOf(baseUrl),
    model,
    hasOwnKey,
    baseUrl: mode === "off" ? null : baseUrl,
    note,
  };
}

export class AiSettingsError extends Error {}

/**
 * Update an org's AI settings.
 *
 * `apiKey: null` clears a stored credential; omitting it leaves it alone, so
 * an operator can change the model without re-entering a secret.
 */
export function updateAiSettings(
  orgId: string,
  input: { mode?: AiMode; apiKey?: string | null; baseUrl?: string | null; model?: string | null },
): AiSettingsView {
  const org = store.getOrg(orgId);
  if (!org) throw new AiSettingsError("Unknown organization");
  const current = read(orgId);
  const next: StoredAiSettings = { ...current };

  if (input.mode !== undefined) next.mode = input.mode;

  if (input.apiKey !== undefined) {
    if (input.apiKey === null || input.apiKey.trim() === "") {
      delete next.apiKeyEnc;
    } else {
      next.apiKeyEnc = encryptSecret(input.apiKey.trim(), orgId);
    }
  }

  if (input.baseUrl !== undefined) {
    if (input.baseUrl === null || input.baseUrl.trim() === "") {
      delete next.baseUrl;
    } else {
      const trimmed = input.baseUrl.trim();
      // Plaintext HTTP to a model provider would put the org's balances on the
      // wire in the clear.
      if (!/^https:\/\//i.test(trimmed)) {
        throw new AiSettingsError("The model endpoint must be an https:// URL");
      }
      next.baseUrl = trimmed.replace(/\/$/, "");
    }
  }

  if (input.model !== undefined) {
    if (input.model === null || input.model.trim() === "") delete next.model;
    else next.model = input.model.trim();
  }

  if (next.mode === "byo" && !next.apiKeyEnc) {
    throw new AiSettingsError("Bring-your-own mode needs an API key for your own account");
  }

  store.setOrgSettings(orgId, {
    ...(org.settings ?? {}),
    ai: next,
  });
  return aiSettingsView(orgId);
}

/**
 * Exactly what leaves the platform when the assistant runs, in plain language.
 *
 * Kept next to the code that does the sending so it cannot drift into being
 * wrong — if the prompt in llm-loop.ts changes, this list changes with it.
 */
export const AI_EGRESS_DISCLOSURE = [
  "Your organization's name, and the names and status of your agents",
  "Balances, 24h spend figures, and your policy limits",
  "The question you type, and recent messages in this chat",
  "Facts you have asked the assistant to remember",
] as const;
