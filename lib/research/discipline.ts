/**
 * The research discipline — the one instruction every surface that researches
 * the instance hears (research kit §7).
 *
 * The Brahma Console (both modes), `@Brahma`, New Entry from Lore, Import from
 * Instructions and the Scenario Builder include this text; none paraphrases
 * it (a grep-test holds that). It is written for the weakest model that will
 * read it: explicit numbered procedure, stated budgets, and a plain rule for
 * when to stop. There are no per-model branches.
 *
 * Two variants differ only in their last section: `inquiry` (the answer is an
 * answer) and `drafting` (the answer is a piece). Two kits differ only in the
 * routes they name: `full` (documents and records) and `documents` (the
 * Scenario Builder, whose pool has no record tools).
 *
 * Model-facing, so plain English: the house voice does not apply.
 *
 * Design of record: docs/developer/features/research-kit.md
 *
 * @module lib/research/discipline
 */

/** What the run's answer is: an answer to a question, or a piece of writing. */
export type ResearchVariant = 'inquiry' | 'drafting'

/** Which tools the surface was given (`buildTools`' `researchKit`). */
export type ResearchKitLevel = 'documents' | 'full'

/** The heading the section opens with; tests and the grep-test key on it. */
export const RESEARCH_DISCIPLINE_HEADING = '## How to research'

const ROUTES_FULL = `- **A fact** ("how old is X", "what did Y say when…"): look it up. Budget: 4 tool calls.
- **A when or where** ("what day did…", "which conversation…"): \`lookup_conversations\` with the people and a date window, or \`lookup_messages\` with \`group_by: "conversation"\`; then \`read_messages\` on the one conversation that fits. Budget: 6.
- **A survey** ("everything that…", "who in the group…"): one wide call per source (\`find_documents\`, \`lookup_group\`, \`lookup_wardrobe\`), then answer from the lists. Do not open every item. Budget: 8.
- **A judgment or a design** ("what would she…", "what are we missing", "design…", "draft…"): read who or what it concerns (\`lookup_character\` or \`lookup_group\`), make at most two searches for the specific subject, then decide. The record will not contain the answer, because the answer is your reasoning. Budget: 8.`

const ROUTES_DOCUMENTS = `- **A fact** ("what is X", "where is Y"): \`find_documents\` for it, then read the one file that answers. Budget: 4 tool calls.
- **A survey** ("everything about…"): one wide \`find_documents\` or \`list_documents\` call, then work from the list. Do not open every file. Budget: 6.
- **A judgment or a design** ("design…", "draft…", "set a scene…"): make at most two searches for the specific subject, read the two or three files that matter most, then decide. The record will not contain the answer, because the answer is your reasoning. Budget: 8.`

function stopRules(kit: ResearchKitLevel): string {
  const searchInside = kit === 'full'
    ? '\n- Never read a whole conversation to check for a detail. Search inside it (`lookup_messages` with `conversation`).'
    : '\n- Never read a whole long file to check for a detail. Search for the detail instead (`find_documents` with `text`).'
  return `- For a fact, the first direct evidence is enough. Do not search again to confirm what you have read.
- When you notice yourself thinking "I have enough", you do. The next thing you write is the answer.
- If two searches for the same thing find nothing, it is not there. Say so in one sentence and move on. Do not try a third spelling.${searchInside}
- Do not restate the request to yourself, and do not plan the answer more than once.`
}

function narrowRule(kit: ResearchKitLevel): string {
  return kit === 'full'
    ? 'Leave `store` and `character` out unless the request names one. One wide call that returns ranked results beats five narrow guesses.'
    : 'Leave `store` out unless the request names one. One wide call that returns ranked results beats five narrow guesses.'
}

/** The shared sections 1–5. */
function sharedSections(kit: ResearchKitLevel): string {
  return `${RESEARCH_DISCIPLINE_HEADING}

**1. Decide what kind of request this is before you call anything.** Say it to yourself in one line, then follow that route.

${kit === 'full' ? ROUTES_FULL : ROUTES_DOCUMENTS}

**2. Search wide first, then narrow.** ${narrowRule(kit)}

**3. Ask for several things at once.** When two lookups do not depend on each other, make both calls in the same step.

**4. Stop when you can answer.**
${stopRules(kit)}

**5. Truth and inference.** Facts about the operator's world come from what you read; never invent one. Reasoning from those facts is expected whenever the request asks what someone would do, what is missing, or what something should be. An inference is not an invention, and it needs no apology.`
}

/** Section 6 for `inquiry`: the answer. */
export const RESEARCH_INQUIRY_FINISH = `**6. The answer.** Start with the answer. Name where a fact came from in a few words beside it (a conversation title and date, a file name). Add a caveat only if the sources disagree, the request rests on something untrue, or you could not find something the answer depends on, and then in one or two sentences, not a section. No list of everything you read. No closing offer unless the next step is a decision only the operator can make.`

/** Section 6 for `drafting`: the piece. */
export const RESEARCH_DRAFTING_FINISH = `**6. The piece.** Research is for you; none of it appears in the piece unless the output format has a place for it. Where the sources are silent, follow the surface's own rule for gaps. Deliver the piece once you can write it with confidence; a better piece comes from a revision request, not from a tenth search.`

/**
 * The research discipline for a surface. Every surface in the kit's table
 * includes exactly this; none spells its own.
 */
export function researchDiscipline(variant: ResearchVariant, kit: ResearchKitLevel = 'full'): string {
  const finish = variant === 'inquiry' ? RESEARCH_INQUIRY_FINISH : RESEARCH_DRAFTING_FINISH
  return `${sharedSections(kit)}\n\n${finish}`
}
