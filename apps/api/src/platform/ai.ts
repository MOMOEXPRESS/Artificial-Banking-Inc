/**
 * AI answer layer — facts stay deterministic; an optional rephraser may polish
 * language later without ever interpreting money intents.
 */
export interface FactAnswer {
  answer: string;
  sources?: string[];
}

export interface FactRephraser {
  readonly name: string;
  rewrite(input: { question: string; facts: string }): Promise<string>;
}

/**
 * Builds a rephraser for one org, or returns null when that org has not agreed
 * to send its data to a model provider. Registered at boot; kept as a factory
 * rather than a single instance because credentials are per-organization.
 */
export type RephraserFactory = (orgId: string) => FactRephraser | null;

let factory: RephraserFactory | null = null;

export function setFactRephraser(next: RephraserFactory | null): void {
  factory = next;
}

export function getFactRephraser(orgId: string): FactRephraser | null {
  return factory ? factory(orgId) : null;
}

/**
 * Polish an answer for one organization.
 *
 * Takes orgId because polishing means sending that org's balances and spend
 * figures to a third party. Without the org there is nothing to check consent
 * against, and this call was previously ungated for exactly that reason.
 */
export async function presentAnswer(
  orgId: string,
  question: string,
  facts: string,
): Promise<string> {
  const rephraser = factory?.(orgId);
  if (!rephraser) return facts;
  try {
    return await rephraser.rewrite({ question, facts });
  } catch (e) {
    console.error("fact rephraser failed:", e);
    return facts;
  }
}
