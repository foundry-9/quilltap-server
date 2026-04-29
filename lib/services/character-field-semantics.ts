/**
 * Character Field Semantics
 *
 * Single source of truth for the vantage-point definitions that distinguish
 * a character's identity / description / personality / title fields.
 *
 * Used by:
 * - the character optimizer (lib/services/character-optimizer.service.ts)
 * - the AI Wizard (lib/services/character-wizard.service.ts)
 * - Summon From Lore (lib/services/ai-import.service.ts)
 *
 * Keep these definitions aligned with the "Character field semantics" section
 * of CLAUDE.md.
 */

export const FIELD_SEMANTICS_PREAMBLE = `Quilltap distinguishes four character fields by *vantage point*. Use these definitions to label which field each pattern belongs to — they are not interchangeable.

- IDENTITY — the most surface-level knowledge of the character, from outside. What strangers can know on sight or by reputation: name, station, occupation, public reputation, signifying outward facts. Never internal motivation, never private mannerisms.
- DESCRIPTION — what someone talking to or acquainted with the character perceives. Behaviour, mannerisms, frequent verbal patterns. NOT physical appearance (that lives elsewhere) and NOT internal monologue.
- PERSONALITY — what the character knows about themselves. The internal driver of speech and behavior. Other characters don't see this unless she shares it.
- TITLE — the user's or character's own private label/framing for them. Not how others refer to them; not in scope for the optimizer to edit.`;
