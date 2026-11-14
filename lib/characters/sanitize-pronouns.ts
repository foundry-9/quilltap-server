/**
 * Pronoun sanitization for LLM-generated character data.
 *
 * Shared by Summon From Lore (lib/services/ai-import.service.ts) and the AI
 * Wizard's properties generation (lib/services/character-wizard.service.ts),
 * which both ask an LLM for a `{ subject, object, possessive }` pronouns
 * object and must reject placeholders before character create.
 */

const PRONOUN_PLACEHOLDERS = new Set([
  '', 'unknown', 'n/a', 'na', 'none', 'null', 'undefined', 'not specified', 'not given', 'tbd',
]);

/**
 * Quilltap's `possessive` is the determiner ("her book"), the form every
 * pronoun preset uses. Models asked for "the possessive" often answer with the
 * independent form ("the book is hers"), which matched no preset and left a
 * plain she/her character on Custom. For the standard sets only, the
 * independent form is taken as the determiner it stands for.
 */
const INDEPENDENT_TO_DETERMINER: Record<string, { subject: string; object: string; determiner: string }> = {
  hers: { subject: 'she', object: 'her', determiner: 'her' },
  theirs: { subject: 'they', object: 'them', determiner: 'their' },
};

function normalizePossessive(cleaned: Record<string, string>): string {
  const rule = INDEPENDENT_TO_DETERMINER[cleaned.possessive.toLowerCase()];
  if (
    rule &&
    cleaned.subject.toLowerCase() === rule.subject &&
    cleaned.object.toLowerCase() === rule.object
  ) {
    return rule.determiner;
  }
  return cleaned.possessive;
}

// Validate a parsed pronouns response. Returns the trimmed object if all three
// fields are usable strings; otherwise returns undefined so the assembler stores null.
// PronounsSchema requires non-empty strings ≤20 chars on subject/object/possessive,
// so anything else would explode at character-create time.
// Exported for the AI Wizard's properties generation, which shares the contract.
export function sanitizePronouns(raw: unknown): { subject: string; object: string; possessive: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const fields = ['subject', 'object', 'possessive'] as const;
  const cleaned: Record<string, string> = {};
  for (const f of fields) {
    const v = obj[f];
    if (typeof v !== 'string') return undefined;
    const trimmed = v.trim();
    if (!trimmed || trimmed.length > 20) return undefined;
    if (PRONOUN_PLACEHOLDERS.has(trimmed.toLowerCase())) return undefined;
    cleaned[f] = trimmed;
  }
  cleaned.possessive = normalizePossessive(cleaned);
  return cleaned as { subject: string; object: string; possessive: string };
}
