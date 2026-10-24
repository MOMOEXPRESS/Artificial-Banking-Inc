/**
 * Deterministic parser for the assistant's durable-memory commands.
 *
 * Before this existed, "remember" only fired for messages that *started* with
 * "remember" or contained the exact words "remember that". Natural phrasings
 * like "Please remember our fiscal year starts in April", "Keep in mind …",
 * "Note: …" or "… remember it." fell through to the survey tools, nothing was
 * saved, and a later "what do you remember?" truthfully said "No saved notes".
 *
 * This runs before the LLM and the keyword brain, so saving / forgetting a
 * note never depends on a model choosing to call a tool.
 */

export type MemoryCommand =
  | { kind: "remember"; fact: string }
  | { kind: "forget"; target: string; all: boolean }
  | { kind: "recall"; query: string };

/** Leading politeness / addressing that carries no meaning. */
const LEAD =
  /^(?:(?:hey|hi|ok|okay|so|and|also)\s*,?\s+)*(?:abi\s*[,:]?\s+)?(?:(?:please|pls|kindly)\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need|would\s+like|'d\s+like)\s+you\s+to\s+|i'd\s+like\s+you\s+to\s+)?(?:please\s+)?/i;

const REMEMBER_VERB =
  /^(?:remember|memori[sz]e|keep\s+in\s+mind|bear\s+in\s+mind|note\s+down|take\s+note(?:\s+of)?|make\s+a\s+note(?:\s+of)?|note|save|store|record|log|don'?t\s+forget|do\s+not\s+forget|never\s+forget|for\s+the\s+record|fyi)\b\s*(?:(?:this|that|the\s+following)\b\s*)?(?:(?:org(?:anization)?\s+)?(?:fact|note|info(?:rmation)?)s?\s*)?(?:that\b\s*)?[:,\-–—]?\s*/i;

/** "<fact>. Remember that." / "<fact> — please remember it" */
const TRAILING_REMEMBER =
  /[\s,.;:!\-–—]+(?:(?:please|pls)\s+)?(?:(?:can|could)\s+you\s+)?(?:remember|memori[sz]e|note|save|keep\s+in\s+mind)\s*(?:it|that|this)?(?:\s+(?:please|for\s+me|for\s+later))?\s*[.!]*$/i;

/** "Org fact: …", "Note: …", "Fact to remember: …" */
const LABELLED =
  /^(?:(?:our\s+|an?\s+)?(?:org(?:anization)?\s+)?(?:fact|note|memo)(?:\s+to\s+remember)?)\s*[:\-–—]\s*/i;

const RECALL =
  /\b(?:what\s+(?:do|did)\s+you\s+(?:remember|know\s+about\s+(?:us|me|our\s+(?:org|organi[sz]ation|company|team)))|what\s+(?:have|did)\s+i\s+(?:told|tell)\s+you|what\s+did\s+i\s+ask\s+you\s+to\s+remember|recall|your\s+(?:notes|memory|memories)|(?:list|show)\s+(?:me\s+)?(?:your\s+|my\s+|the\s+|saved\s+)*(?:notes|memories|memory|facts)|what(?:'s|\s+is)\s+in\s+your\s+memory|do\s+you\s+remember)\b/i;

const FORGET_ALL =
  /^(?:forget|delete|erase|clear|wipe|remove)\s+(?:all|everything|every\s+(?:note|fact|memory))(?:\s+(?:you\s+(?:remember|know)|(?:your\s+)?(?:notes|facts|memories|memory)|i\s+told\s+you))?\s*[.!]*$|^(?:clear|wipe|erase|reset)\s+(?:your\s+|the\s+|all\s+)?(?:memory|memories|notes|saved\s+(?:notes|facts))\s*[.!]*$/i;

const FORGET =
  /^(?:forget|delete|erase|remove|drop|unlearn)\s+(?:(?:the\s+)?(?:note|fact|memory)\s*(?:about|that|on)?\s*|about\s+|that\s+)?/i;

function tidy(s: string): string {
  return s
    .trim()
    .replace(/^["“'‘]+|["”'’]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,;:\-–—]+$/g, "")
    .trim();
}

/**
 * Parse a chat message into a memory command, or null when the message is a
 * normal question. Questions ("do you remember …?") are recalls, not saves.
 */
export function parseMemoryCommand(message: string): MemoryCommand | null {
  const raw = message.trim();
  if (!raw) return null;
  const body = raw.replace(LEAD, "");
  const isQuestion = /\?\s*$/.test(raw);

  // Forget / clear first so "forget that X" never becomes a save.
  if (FORGET_ALL.test(body)) return { kind: "forget", target: "", all: true };
  if (
    /^(?:forget|unlearn)\b/i.test(body) ||
    /^(?:delete|erase|remove|drop)\s+(?:the\s+)?(?:note|fact|memory)\b/i.test(body)
  ) {
    if (/^don'?t\s+forget/i.test(body)) {
      /* handled as remember below */
    } else {
      const target = tidy(body.replace(FORGET, "").replace(/[.!?]+$/g, ""));
      if (/^(?:it|that|this)$/i.test(target)) return { kind: "forget", target: "", all: false };
      return { kind: "forget", target, all: false };
    }
  }

  if (RECALL.test(raw) && (isQuestion || !REMEMBER_VERB.test(body))) {
    const q = raw
      .replace(
        /^.*?\b(?:what\s+do\s+you\s+remember|what\s+do\s+you\s+know|what\s+did\s+i\s+tell\s+you|what\s+have\s+i\s+told\s+you|do\s+you\s+remember|recall|your\s+notes|(?:list|show)\s+(?:me\s+)?(?:your\s+)?(?:notes|memories|facts))\b/i,
        "",
      )
      .replace(/^\s*(?:about|on|regarding|re:?)\s+/i, "")
      .replace(/[?!.]+$/g, "")
      .trim();
    const generic =
      /^(?:us|me|our\s+(?:org|organi[sz]ation|company|team)|anything|everything|so\s+far)?$/i;
    return { kind: "recall", query: generic.test(q) ? "" : q };
  }
  if (isQuestion) return null;

  const lead = body.match(REMEMBER_VERB);
  // "save" / "store" / "record" / "log" / "note" alone are too generic (e.g.
  // "save the policy") — only treat them as memory when followed by a fact
  // marker ("note: …", "save this fact …", "note that …").
  if (lead) {
    const verb = lead[0].toLowerCase();
    const generic = /^(?:save|store|record|log|note)\b(?!\s+down)/.test(verb);
    const afterVerb = verb.replace(/^\S+/, "");
    const marked = /(?:fact|note|info|that|:|this|following)/.test(afterVerb);
    if (!generic || marked) {
      const fact = tidy(body.slice(lead[0].length).replace(TRAILING_REMEMBER, ""));
      if (fact.length >= 3) return { kind: "remember", fact };
      return { kind: "remember", fact: "" };
    }
  }

  const labelled = body.match(LABELLED);
  if (labelled) {
    const fact = tidy(body.slice(labelled[0].length).replace(TRAILING_REMEMBER, ""));
    if (fact.length >= 3) return { kind: "remember", fact };
  }

  if (TRAILING_REMEMBER.test(body)) {
    const fact = tidy(body.replace(TRAILING_REMEMBER, "").replace(LABELLED, ""));
    if (fact.length >= 3) return { kind: "remember", fact };
  }

  // "… and remember that X" in the middle of a sentence.
  const mid = body.match(/\b(?:remember|keep\s+in\s+mind|note)\s+that\s+(.{3,})$/i);
  if (mid?.[1]) return { kind: "remember", fact: tidy(mid[1]) };

  return null;
}
