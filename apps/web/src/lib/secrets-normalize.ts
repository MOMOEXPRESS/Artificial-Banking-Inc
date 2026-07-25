/** Normalize pasted guardian / agent secrets before auth headers. */
export function normalizeSecret(raw: string): string {
  let s = raw.trim();
  // Strip zero-width / BOM characters common in copy-paste from docs/Notes.
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Optional Bearer prefix (user pasted the whole header value).
  if (/^bearer\s+/i.test(s)) s = s.replace(/^bearer\s+/i, "").trim();
  // Surrounding quotes or backticks from markdown.
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("`") && s.endsWith("`"))
  ) {
    s = s.slice(1, -1).trim();
  }
  // Collapse internal whitespace/newlines from wrapped pastes.
  s = s.replace(/\s+/g, "");
  return s;
}

export function isGuardianKey(raw: string): boolean {
  return /^pv_guardian_[a-zA-Z0-9]+$/.test(normalizeSecret(raw));
}
