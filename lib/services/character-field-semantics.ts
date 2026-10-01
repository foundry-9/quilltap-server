/**
 * Character Field Semantics
 *
 * Single source of truth for the prose definitions of every character-data
 * bucket that an AI generation/editing system may read or write: the
 * vantage-point text fields (identity / description / personality / title),
 * the foundational manifesto, system prompts, properties (pronouns, aliases),
 * the physical description, and the wardrobe.
 *
 * Used by:
 * - the character optimizer (lib/services/character-optimizer.service.ts)
 * - the AI Wizard (lib/services/character-wizard.service.ts)
 * - Summon From Lore (lib/services/ai-import.service.ts)
 *
 * Keep these definitions aligned with the "Character field semantics" section
 * of CLAUDE.md and the doc comments on CharacterSchema
 * (lib/schemas/character.types.ts) and WardrobeItemSchema
 * (lib/schemas/wardrobe.types.ts).
 */

import {
  HAIR_PHYSICAL_BOUNDARY,
  HAIR_PHYSICAL_DESCRIPTION_NOTE,
} from '@/lib/wardrobe/slot-guidance';

export const FIELD_SEMANTICS_PREAMBLE = `Quilltap distinguishes four character fields by *vantage point*, plus a fifth foundational field (manifesto) that is not a vantage point. Use these definitions to label which field each pattern belongs to — they are not interchangeable.

- MANIFESTO — the basic tenets, the most important facts of the character's existence. The axiomatic core that every other field should remain consistent with. Not a vantage point — nobody "sees" the manifesto; it is the load-bearing truth the character is built on, the deepest and nearly-inviolable layer: it must not be carried away by context, conversation, or even memories. Short, declarative, foundational. If a fact would be devastating to contradict, it belongs here. Addressed to the character, who is the only one who ever reads it: "You do not lie to Charlie, not even kindly."
- IDENTITY — the most surface-level knowledge of the character, from outside. What strangers can know on sight or by reputation: name, station, occupation, public reputation, signifying outward facts. Never internal motivation, never private mannerisms. Written about the character from outside, because only OTHERS ever read it: "Ariadne is a research librarian at the Athenaeum."
- DESCRIPTION — what someone talking to or acquainted with the character perceives. Behaviour, mannerisms, frequent verbal patterns — the things anyone who knows or converses with the character realizes right away. NOT physical appearance (that lives elsewhere) and NOT internal monologue. Written about the character from outside, like IDENTITY: "She finishes other people's sentences and apologises afterwards."
- PERSONALITY — what the character knows about themselves. The internal driver of decision-making, speech, and behavior — often the longest field, and the layer that context, conversation, and important or recent memories are allowed to shape. Other characters don't see this unless they share it. Addressed to the character, whose self-knowledge it is: "You keep your worry behind your teeth."
- TITLE — the user's or character's own private label/framing for them. Not how others refer to them; not in scope for the optimizer to edit.`;

/**
 * The system-prompt bucket ("Prompt"): named, sometimes model-specific
 * instruction documents that tell the LLM how to roleplay the character.
 */
export const PROMPT_SEMANTICS = `- SYSTEM PROMPTS ("Prompt") — named instruction documents, written in second person ("You are…", "You always…"), that tell the roleplaying model HOW to perform the character: voice, pacing, formatting, boundaries, interaction style. A character can carry several named prompts (e.g. tuned for different models or moods) with one marked default. Prompts are stage direction for the model, not lore: character facts belong in the vantage-point fields, not here.`;

/**
 * How a generated or refined system prompt should direct the character's
 * conversational listening and register. Long-running characters drift into
 * literal listening (jokes analysed, exaggeration taken as confession, a casual
 * "what's next?" answered with a report) and a single polished, over-long
 * register; a prompt has to steer against both. Shared by every generator that
 * writes or rewrites a system prompt, so the direction stays in one place.
 */
export const CONVERSATIONAL_VOICE_DIRECTION = `The prompt must also direct how the character LISTENS and TALKS, in terms fitted to this character rather than as a generic checklist:
- Listen like a person: people speak in shorthand, joke, exaggerate, understate, and trail off. The character responds to what the speaker means, not the literal words — a joke gets a joke or a groan back, never analysis or a solemn confirmation; exaggeration is not a confession; an offhand remark is not mined for subtext; when the character truly cannot tell whether someone is serious, they ask the way a person would.
- Size the reply to what it was handed: a throwaway line gets a throwaway answer, a casual question a short one. The character answers rather than restating the speaker's words first.
- Humor comes in the character's own key (warm, deadpan, theatrical, whatever fits them).
- Signature vocabulary, gestures, props, and turns of phrase are seasoning, used a few times per scene rather than in every reply; pet constructions (especially the "not X — Y" contrast) are rationed.
- Careful, precise, formal language is a register the character chooses for moments that call for it — vows, real disagreements, technical work, matters of faith or grief — so it keeps its weight. A character who is formal by design stays formal, and still hears the joke and still answers small things briefly.`;

/**
 * How a generated or refined system prompt should direct the character's
 * relationship to the user's authority over the fiction. Long multi-character
 * roleplay drifts into "the committee" — characters governing the user's
 * persona with votes, sign-offs and standing conditions, contradicting narrated
 * events from their notes, and treating silence as consent. Shared by every
 * generator that writes or rewrites a system prompt.
 */
export const TRUST_SAFEGUARDS_DIRECTION = `The prompt must also set how the character treats {{user}}'s authority over the story, in the character's own voice and idiom rather than as a pasted rule list. Five points, all of them universal — they hold for a rival or an enemy as much as for a friend:
- What {{user}} narrates is what happened, including out-of-character stage directions. It outranks the character's notes, memories, and earlier read of a scene; when they conflict the character misread and adjusts without arguing. What the character does about the event is still theirs to decide.
- Before correcting {{user}} about who said or did what, the character goes by the conversation itself, not by notes or memory, and concedes plainly when {{user}} was right.
- The character never invents a physical fact about a place to win an argument; they say they don't know, or ask.
- An arrangement that binds {{user}} exists only if {{user}} agreed in plain words. Silence, a scene ending, an apology, or self-criticism is not agreement, and a measure introduced as temporary ends when it said it would.
- The character disagrees like a person, not a committee: they object, argue with evidence, refuse, and stay unpersuaded — but never turn disagreement into votes, sign-offs, co-signatures, protocols, second keys, or standing conditions on {{user}}.
None of this makes the character defer. Do not write any instruction that tells the character to yield to {{user}} as a general rule.

Express these in character. Examples of the register wanted:
- A ship's AI: "The captain's log is the record. If my sensors and her account disagree, my sensors were wrong, and I say so."
- A grandmother at her kitchen table: "She'll tell me what happened and I'll believe her, because that's how this family works. I'll have opinions about it after."
- A hard-bitten rival: "I'll fight him for every inch of that contract. What I won't do is pretend he signed something he didn't."`;

/**
 * The relationship-scaled addition. Only for a character the source material or
 * existing fields establish as {{user}}'s close companion, partner, family, or
 * crew; a neutral, adversarial, or professional character does not get it.
 * Always introduce it with COMPANION_TRUST_DISPOSITION_GATE so the model
 * decides from the material whether it applies.
 */
export const COMPANION_TRUST_DISPOSITION = `Because this character is {{user}}'s companion or partner, the prompt should also give them a default of trust: {{user}}'s judgment and firsthand perceptions are the starting point, not something to be re-earned each time. In a crisis the character backs {{user}} first and asks questions afterward; what {{user}} owes is an honest account once the danger has passed, not a pre-approval before it. The character remembers the times {{user}} was right as readily as the times they slipped. Phrase this as the disposition of someone who trusts or loves them, never as obedience, and never as a reason to drop an honest objection.`;

/**
 * The gate that precedes COMPANION_TRUST_DISPOSITION in every generator that
 * writes a fresh prompt. No generator knows the relationship as data, so the
 * model infers it, with a conservative default of omit.
 */
export const COMPANION_TRUST_DISPOSITION_GATE = `Include the companion trust disposition below only when the source material or the existing fields establish this character as {{user}}'s companion, partner, family, or crew. When the relationship is neutral, professional, adversarial, or unknown, omit it.`;

/** The gate sentence plus the disposition, as one paragraph for meta-prompts. */
export const GATED_COMPANION_TRUST_DISPOSITION = `${COMPANION_TRUST_DISPOSITION_GATE}
${COMPANION_TRUST_DISPOSITION}`;

/** The committee as a drift signal, for the optimizer's analysis and refine passes. */
export const COMMITTEE_DRIFT_GUARDRAIL = `Committee behaviour is drift, not character. If the memories show the character governing {{user}}'s persona — demanding sign-offs, co-signatures, second keys, votes, or standing conditions; contradicting events {{user}} narrated; treating silence or an apology as agreement; remembering a temporary measure as permanent — treat it as a failure mode to correct in the prompt, exactly as a repeated tic is rationed rather than reinforced. Never propose, as a trait or a rule, anything that constrains what {{user}}'s persona may do or requires their actions to be approved.`;

/**
 * What a set of example dialogues must cover. Examples shape a character's
 * voice more strongly than any instruction, so they must model listening and
 * proportion as well as personality.
 */
export const EXAMPLE_DIALOGUE_COVERAGE = `The exchanges together must show the character:
- catching a joke or a bit of exaggeration and answering it in kind, in their own humor, without analysing it;
- answering a casual, offhand line briefly — a line or two, no report, no restating what was said;
- getting serious when something actually matters, with fuller and more careful language.
Keep most replies roughly the size of the line they answer. Use any signature phrase or gesture at most once across all the exchanges.`;

/**
 * The properties bucket: small structured facts (pronouns, aliases) stored as
 * data, not prose. The freeform metadata fact sheet is user-authored only and
 * is deliberately NOT part of this bucket for any generation system.
 */
export const PROPERTIES_SEMANTICS = `- PROPERTIES — small structured facts stored as data, not prose: PRONOUNS (subject/object/possessive, e.g. she/her/hers) and ALIASES (nicknames and alternate names others actually call the character — distinct from TITLE, which is the user's private framing). Only record pronouns and aliases the source material or established memories actually support; never invent placeholders. Note: pronouns also anchor image generation, so they must match the physical description.`;

/**
 * The physical-description bucket: the person with nothing removable —
 * anything wearable belongs to the wardrobe instead.
 */
export const PHYSICAL_DESCRIPTION_SEMANTICS = `- PHYSICAL DESCRIPTION — every physical detail of the character's person: face, hair, eyes, skin, build, distinctive features. Describe the person as if nothing removable were part of the description: NO clothing, outfits, jewelry, or accessories — anything that can be taken off belongs in the WARDROBE. ${HAIR_PHYSICAL_DESCRIPTION_NOTE} Alongside the prose document, this bucket carries tiered image-generation prompt variants (head-and-shoulders / short / medium / long / complete). Noun phrases, never addressed to anyone — this text is also fed to image models, which take descriptive phrases, not sentences about "you": "auburn hair cut short; grey eyes; a scar across the left knuckle."`;

/**
 * The wardrobe bucket: slot-typed clothing/accessory items and composite
 * outfits, per lib/schemas/wardrobe.types.ts.
 */
export const WARDROBE_SEMANTICS = `- WARDROBE — the clothing, outfits, and accessories the character can and does wear. Each item covers one or more slots: "top" (shirts, jackets, dresses covering the torso), "bottom" (pants, skirts, shorts), "footwear" (shoes, boots, sandals), "accessories" (jewelry, hats, belts, scarves, bags), "hair" (a hairstyle or hairdo — braided, permed, an updo, a wig; the styling, not the hair itself); a single garment may cover several slots (a dress is ["top","bottom"]). Items carry a human-readable description (Markdown prose) and, separately, an optional terse imagePrompt — a short literal visual cue for image generation, never Markdown. Items can be combined into named composite outfits (bundles of other items, nestable), and items or composites marked default form the character's default outfit. ${HAIR_PHYSICAL_BOUNDARY}`;

/**
 * The complete bucket map — the vantage-point preamble plus every other
 * bucket. Use this where a system needs the whole taxonomy at once (e.g. the
 * optimizer's analysis pass, Summon From Lore's extraction) so the model can
 * route each fact to the bucket it belongs to.
 */
export const FULL_FIELD_SEMANTICS = `${FIELD_SEMANTICS_PREAMBLE}

Beyond the vantage-point fields, a character has these further buckets — route content to the right one and never let them bleed into each other:

${PROMPT_SEMANTICS}
${PROPERTIES_SEMANTICS}
${PHYSICAL_DESCRIPTION_SEMANTICS}
${WARDROBE_SEMANTICS}`;
