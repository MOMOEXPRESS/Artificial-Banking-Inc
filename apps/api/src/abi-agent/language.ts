/**
 * Language understanding for the keyword brain — no model, no network, no cost.
 *
 * Guardians type the way people talk ("hey abi um hows the reseacher doing",
 * "whats stuck waiting on me", "show me recent txns"), and voice dictation
 * adds filler and drops punctuation. The intent rules and tool pickers match
 * on a fairly small vocabulary, so before this module a typo or a casual
 * synonym fell straight through to "I can answer from your own data — try…".
 *
 * normalizeMessage() turns loose phrasing into the vocabulary the rest of the
 * agent already understands:
 *   1. lower-case, expand contractions, drop filler and wake words;
 *   2. map casual synonyms onto canonical terms (bots → agents, txns →
 *      payments, stuck → pending approvals, limits → policy …);
 *   3. correct near-miss spellings against a fixed domain vocabulary plus the
 *      org's own agent names (edit distance ≤1, ≤2 for long words).
 *
 * It also recognises three things the keyword brain could not:
 *   - action requests ("approve it", "send $50 to …", "raise the daily
 *     limit") which the assistant must never perform — it explains instead;
 *   - out-of-scope asks (credit score, loans, stock prices …) where the honest
 *     answer is "ABI doesn't have that", not a survey of unrelated numbers;
 *   - references to an earlier list ("the last one", "the second one", "#3").
 */

/** Words the agent's rules key on. Corrections only ever land on one of these. */
const DOMAIN_VOCAB = [
  "agent",
  "agents",
  "approval",
  "approvals",
  "approve",
  "pending",
  "waiting",
  "policy",
  "policies",
  "budget",
  "budgets",
  "balance",
  "balances",
  "treasury",
  "vault",
  "spend",
  "spent",
  "spending",
  "payment",
  "payments",
  "denied",
  "denial",
  "denials",
  "blocked",
  "vendor",
  "vendors",
  "quiet",
  "hours",
  "guardian",
  "guardians",
  "quorum",
  "remember",
  "summary",
  "overview",
  "status",
  "recommend",
  "notification",
  "notifications",
  "alerts",
  "invoice",
  "invoices",
  "escrow",
  "reconcile",
  "books",
  "runway",
  "burn",
  "compare",
  "explain",
  "stipend",
  "roster",
  "limit",
  "limits",
  "threshold",
  "daily",
  "researcher",
  "writer",
  "recent",
  "decision",
  "decisions",
  "yesterday",
  "today",
  "conversation",
  "governance",
] as const;

/**
 * Ordinary words that look like near-misses of vocab words but must be left
 * alone ("spent"↔"spend" are both vocab; "stats" is not "status"…).
 */
const KEEP = new Set([
  "what",
  "whats",
  "that",
  "this",
  "there",
  "their",
  "them",
  "then",
  "than",
  "they",
  "where",
  "were",
  "about",
  "doing",
  "going",
  "being",
  "agree",
  "pay",
  "paid",
  "pays",
  "spent",
  "sent",
  "send",
  "last",
  "list",
  "lost",
  "best",
  "rest",
  "test",
  "time",
  "times",
  "show",
  "tell",
  "give",
  "have",
  "much",
  "many",
  "money",
  "funds",
  "cash",
  "please",
  "thanks",
  "thank",
  "hello",
  "hours",
  "house",
  "limit",
  "liked",
  "talk",
  "talked",
  "about",
  "would",
  "could",
  "should",
  "write",
  "wrote",
  "wallet",
  "valid",
  "value",
  "spending",
  "pending",
  "sending",
  "ending",
  "denied",
  "denies",
  "agenda",
  "urgent",
  "status",
  "states",
  "statue",
  "budge",
  "nudge",
  "writing",
  "written",
  "writes",
  "rating",
  "paying",
  "saying",
  "staying",
  "setting",
  "settings",
  "approved",
  "approving",
  "approves",
  "denying",
  "recently",
  "balanced",
  "notes",
  "note",
  "need",
  "next",
  "most",
  "your",
  "four",
  "hour",
  "rate",
  "late",
  "date",
  "data",
  "deal",
  "deals",
  "agency",
  "agenda",
]);

/** Contractions and run-together casual spellings. */
const CONTRACTIONS: [RegExp, string][] = [
  [/\bwhat'?s\b/g, "what is"],
  [/\bhow'?s\b/g, "how is"],
  [/\bwho'?s\b/g, "who is"],
  [/\bwhere'?s\b/g, "where is"],
  [/\bthat'?s\b/g, "that is"],
  [/\bit'?s\b/g, "it is"],
  [/\bwho'?d\b/g, "who did"],
  [/\bwhy'?d\b/g, "why did"],
  [/\bi'?m\b/g, "i am"],
  [/\bdidn'?t\b/g, "did not"],
  [/\bdoesn'?t\b/g, "does not"],
  [/\bcan'?t\b/g, "cannot"],
  [/\bwon'?t\b/g, "will not"],
  [/\bwanna\b/g, "want to"],
  [/\bgonna\b/g, "going to"],
  [/\bgimme\b/g, "give me"],
  [/\blemme\b/g, "let me"],
  [/\bu\b/g, "you"],
  [/\bur\b/g, "your"],
  [/\bpls\b|\bplz\b/g, "please"],
  [/\bthx\b|\bty\b/g, "thanks"],
];

/** Filler, wake words and politeness that carry no meaning. */
const FILLER =
  /\b(?:um+|uh+|erm+|hmm+|like,|you know|i mean|basically|actually|just|kinda|sorta|real quick|quickly|ok(?:ay)? so|so yeah|hey abi|hi abi|yo abi|ok(?:ay)? abi|abi,)\b/g;

/** Casual synonym → canonical phrase the intent rules already know. */
const SYNONYMS: [RegExp, string][] = [
  [/\b(?:bots?|workers?)\b/g, "agents"],
  [/\b(?:txns?|txs?|transactions?|transfers?|charges?|purchases?)\b/g, "payments"],
  [
    /\b(?:stuck|on hold|held up|need(?:s|ing)? my (?:ok|okay|sign[- ]?off|approval)|sign[- ]?offs?|to sign off)\b/g,
    "pending approvals",
  ],
  [/\b(?:caps?|spending rules?|guardrails?|rules)\b/g, "policy"],
  [/\blimits?\b/g, "policy limit"],
  [/\b(?:rejected|refused|declined|bounced)\b/g, "denied"],
  [
    /\bwho (?:got|did we|have we|has been) paid\b|\bwho did we pay\b|\bwhere did (?:the |our )?money go\b/g,
    "top vendors",
  ],
  [
    /\b(?:how much (?:money|cash) (?:do we have|is left|left)|money left|cash left|funds left|how much do we have)\b/g,
    "treasury vault balance",
  ],
  [/\b(?:alerts?|pings?|bell|inbox items?)\b/g, "notifications"],
  [
    /\b(?:what(?: is)? (?:going on|up|new|happening)|catch me up|fill me in|sitrep|the rundown|how (?:are )?we doing|how are things)\b/g,
    "status overview",
  ],
  [
    /\b(?:what(?: did| have)? we (?:talk(?:ed)?|chat(?:ted)?|discuss(?:ed)?) about|our (?:last )?(?:chat|conversation)|last time we (?:talked|spoke|chatted)|recap (?:our|the) (?:chat|conversation)|conversation (?:history|recap))\b/g,
    "conversation recap",
  ],
];

function dl(a: string, b: string): number {
  // Optimal-string-alignment distance (Damerau–Levenshtein with adjacent swaps).
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = v;
    }
  }
  return d[m]![n]!;
}

export type Correction = { from: string; to: string };

export type Normalized = {
  /** Canonical text for intent rules / tool pickers. */
  text: string;
  /** Spelling fixes applied (shown back so the guardian can see what was read). */
  corrections: Correction[];
  /** Same text before synonym mapping — verbs intact, for action detection. */
  light: string;
};

/**
 * Closest single vocabulary match for one token, or null. Ties are refused —
 * if two words are equally close, guessing would be inventing intent.
 */
export function correctToken(token: string, vocab: readonly string[]): string | null {
  if (token.length < 4 || /[^a-z]/.test(token)) return null;
  if (KEEP.has(token) || vocab.includes(token)) return null;
  const limit = token.length >= 7 ? 2 : 1;
  let best: string | null = null;
  let bestD = limit + 1;
  let tie = false;
  for (const w of vocab) {
    if (Math.abs(w.length - token.length) > limit) continue;
    const dist = dl(token, w);
    if (dist < bestD) {
      best = w;
      bestD = dist;
      tie = false;
    } else if (dist === bestD && w !== best) {
      // "agent"/"agents" style ties are the same word — keep the first.
      if (!(best && (w.startsWith(best) || best.startsWith(w)))) tie = true;
    }
  }
  if (!best || bestD > limit || tie) return null;
  // Never "correct" into a different first letter for short words — that is
  // how "pay" style words would turn into something else entirely.
  if (token.length < 7 && token[0] !== best[0]) return null;
  return best;
}

/**
 * Normalize a guardian message. `names` are this org's own agent names (and
 * only this org's), so misspelled names still bind without ever matching an
 * agent from another organization.
 */
export function normalizeMessage(raw: string, names: string[] = []): Normalized {
  let q = ` ${raw.toLowerCase().replace(/[’‘]/g, "'")} `;
  for (const [re, to] of CONTRACTIONS) q = q.replace(re, to);
  q = q.replace(FILLER, " ");
  q = q.replace(/[!?,;]+/g, " ").replace(/\s+/g, " ");

  const nameVocab = names
    .flatMap((n) => n.toLowerCase().split(/\s+/))
    .filter((w) => w.length >= 4 && /^[a-z]+$/.test(w));
  const vocab = [...DOMAIN_VOCAB, ...nameVocab];
  const corrections: Correction[] = [];
  q = q
    .split(" ")
    .map((tok) => {
      const fixed = correctToken(tok, vocab);
      if (fixed) {
        corrections.push({ from: tok, to: fixed });
        return fixed;
      }
      return tok;
    })
    .join(" ");

  const light = q.replace(/\s+/g, " ").trim();
  for (const [re, to] of SYNONYMS) q = q.replace(re, to);
  return { text: q.replace(/\s+/g, " ").trim(), corrections, light };
}

export type ActionRequest = {
  kind: "approve" | "deny" | "pay" | "policy" | "freeze" | "agent_admin" | "notifications";
  /** Plain verb phrase for the reply ("approve payments"). */
  what: string;
};

/**
 * Messages that ask the assistant to *do* something with money, approvals,
 * policy or agents. The assistant is read-only; these get an explanation and a
 * pointer to the flow the guardian confirms themselves — never an action.
 */
export function detectActionRequest(text: string): ActionRequest | null {
  const q = text.toLowerCase().trim();
  // Questions about who/why/how are not commands.
  if (/^(?:who|why|how|when|what|which|is|are|does|do|did|was|were)\b/.test(q)) return null;
  if (/\bwho can\b|\bhow do i\b|\bhow can i\b/.test(q)) return null;
  const lead =
    /^(?:(?:please|ok|okay|so|now|then|and|also|yes|yeah|yep|sure|go ahead(?: and)?)\s+)*(?:(?:can|could|would|will) you\s+(?:please\s+)?|i (?:want|need) you to\s+|i(?: would|'d) like you to\s+|(?:go ahead and|just)\s+)?/;
  const body = q.replace(lead, "");
  if (
    /^(?:approve|accept|greenlight|sign off on|let (?:it|that|them) through|allow (?:it|that|this|them|the)\b)/.test(
      body,
    )
  )
    return { kind: "approve", what: "approve payments" };
  if (/^(?:deny|reject|decline|refuse|block|cancel)\b/.test(body))
    return { kind: "deny", what: "deny or cancel payments" };
  if (
    /^(?:send|pay|transfer|move|wire|withdraw|deposit|fund|top up|topup|refund|tip)\b/.test(body) &&
    !/\b(?:history|address|status|how much|list)\b/.test(body)
  )
    return { kind: "pay", what: "move money" };
  if (
    /^(?:raise|increase|lower|decrease|reduce|bump|change|set|update|edit|adjust|loosen|tighten|turn (?:on|off)|enable|disable)\b/.test(
      body,
    ) &&
    /\b(?:policy|limit|band|threshold|ceiling|daily|max|quiet|quorum|ask me|hitl|budget|stipend)\b/.test(
      body,
    )
  )
    return { kind: "policy", what: "change policy or limits" };
  if (/^(?:freeze|unfreeze|thaw|pause|suspend)\b/.test(body))
    return { kind: "freeze", what: "freeze or unfreeze agents" };
  if (
    /^(?:delete|archive|remove|create|add|rename|rotate|revoke)\b/.test(body) &&
    /\b(?:agents?|keys?|api keys?)\b/.test(body)
  )
    return { kind: "agent_admin", what: "create, change or remove agents and keys" };
  if (/^(?:mark|clear|dismiss)\b/.test(body) && /\bnotifications?\b/.test(body))
    return { kind: "notifications", what: "mark notifications as read" };
  return null;
}

/** Topics ABI has no data for. Answering them with org figures would mislead. */
const OUT_OF_SCOPE: [RegExp, string][] = [
  [/\bcredit (?:score|rating|report)\b/, "credit scores"],
  [/\b(?:loan|mortgage|borrow|lend|overdraft|credit line|line of credit)\b/, "loans or credit"],
  [/\binterest rate|\bapy\b|\bapr\b|\byield\b/, "interest or yield"],
  [
    /\b(?:stock|share price|crypto price|bitcoin price|eth price|exchange rate|fx rate|forex)\b/,
    "market prices",
  ],
  [/\b(?:tax(?:es)?|irs|vat return)\b/, "tax"],
  [/\b(?:weather|news|sports|recipe|joke)\b/, "general topics outside your org"],
  [/\b(?:fdic|insured|deposit insurance)\b/, "deposit insurance"],
];

export function outOfScopeTopic(text: string): string | null {
  for (const [re, label] of OUT_OF_SCOPE) if (re.test(text)) return label;
  return null;
}

const ORDINALS: Record<string, number> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
};

/**
 * "the last one" / "the latest payment" / "the second one" / "#3" / "number 2".
 * Returns a 1-based index into the most recent list shown, or "last" meaning
 * the newest item.
 */
export function parseReference(text: string): number | "last" | null {
  const q = ` ${text.toLowerCase()} `;
  const num = q.match(/(?:#|\bnumber |\bno\.? ?|\bitem )(\d{1,2})\b/);
  if (num) return Number(num[1]);
  for (const [word, n] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\bthe ${word}(?: one| payment| decision)?\\b`).test(q)) return n;
  }
  if (
    /\bthe (?:last|latest|newest|most recent|previous) (?:one|payment|decision|denial|thing)\b|\bthat (?:one|payment|decision|denial)\b|\bthe last one\b/.test(
      q,
    )
  )
    return "last";
  return null;
}
