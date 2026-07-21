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

let rephraser: FactRephraser | null = null;

export function setFactRephraser(next: FactRephraser | null): void {
  rephraser = next;
}

export function getFactRephraser(): FactRephraser | null {
  return rephraser;
}

/** Apply rephraser when registered; otherwise return facts unchanged. */
export async function presentAnswer(question: string, facts: string): Promise<string> {
  if (!rephraser) return facts;
  try {
    return await rephraser.rewrite({ question, facts });
  } catch (e) {
    console.error("fact rephraser failed:", e);
    return facts;
  }
}
