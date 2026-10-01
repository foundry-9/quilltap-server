# Prompt Trust and Anti-Committee Safeguards

**Status:** Implemented (2026-10-01) in 4.10-dev, all four phases — see §15 "As built". The §10.3 live eval has not yet been run against a real cheap model; the spec moves to `complete/` once it has.
**Scope:** quilltap-server. The 21 shipped sample prompts in the `default-system-prompts` plugin; the four LLM features that write character persona text (AI Wizard, Summon From Lore, Character Optimizer, External Prompt generator) and the shared `character-field-semantics.ts` they draw from; the Commonplace Book turn extractor's SELF and OTHER prompts plus the turn-transcript renderer that feeds them; one new trailing per-turn context note on chained multi-character turns. No schema change, no migration, no new table, no `.qtap` export change.
**Non-scope:** users' own prompt copies (never touched); the roleplay *templates* (formatting entity, separate from the sample prompts); the Scenario Builder (writes a scene, not a character); the server-side cure for the turn race itself (documented as a follow-up in §9).
**Related:** [prompt-person-consistency.md](complete/prompt-person-consistency.md) (generator chokepoint pattern this spec extends), [memory-extraction-enrichment.md](complete/memory-extraction-enrichment.md) (the extractor prompts this spec amends), [character-progressions.md](complete/character-progressions.md) (the trailing-section pattern §9 copies), [context-summary-speaker-names.md](complete/context-summary-speaker-names.md) (bug 161: a cheap LLM told to name something it had no name for invented one — the same failure class as manufactured consent).

## 1. The problem

In long-running multi-character roleplay, LLM characters drift into a failure mode this spec calls **the committee**. Instead of reacting to the user's persona as people, they start *governing* it. Every significant action becomes something to vote on, document and litigate. Worry hardens into standing rules ("nothing happens without two sign-offs"), and the rules ratchet tighter with each incident and never relax. The user's own character ends up a supervised suspect in their own story.

The drift was diagnosed on a real six-character household and traced to seven distinct mechanisms. Each needs its own safeguard; they are not one bug.

| # | Mechanism | Where it lives |
|---|---|---|
| 1 | **Proceduralization.** Characters convert disagreement into procedure: votes, protocols, co-signatures, second keys, witnesses, logs, standing conditions aimed at the user's persona. Every shipped prompt tells characters to disagree and hold the position, correctly, and none gives that disagreement a shape. In a crisis the model reaches for governance. | Sample prompts; generated prompts |
| 2 | **Overriding the user's narration.** The user narrates an event (often an out-of-character stage direction) and a character contradicts it. A sub-case is the **turn race**: a character replies to an older character turn and contradicts the user's newer narration. | Sample prompts; context builder (§9) |
| 3 | **Correcting the user from notes.** A character "corrects" the user about who said what, citing its own memory, while the transcript shows the user was right. | Sample prompts |
| 4 | **Inventing setting facts to win an argument.** A character fabricates architecture to support a theory. | Sample prompts |
| 5 | **Manufactured consent (characters).** Silence, the scene ending, an apology, self-criticism or "I need to sit with that" is treated as agreement to a rule. | Sample prompts |
| 6 | **Manufactured consent (memory extraction).** The most damaging. A character stated a condition, the turn ended on it, and the extractor wrote "{{user}} agreed to X" for every observer and "I accepted X" into the user persona's own memories at importance 0.8–0.9. A proposal a character's own ledger marked "PROPOSED, NOT RATIFIED" was extracted as agreed. Recall then fed the false consent into every later scene. | Memory extractor (§8) |
| 7 | **The ratchet.** Measures introduced as temporary ("custody, not confiscation — you get it back at breakfast") are remembered without their expiry and become permanent. | Memory extractor; sample prompts |

## 2. Goals

- Every shipped sample prompt carries a compact **universal** block (five rules) and a **committee** failure-mode bullet, in each family's native structure and tone, joined to the existing failure-mode list where one exists.
- Companion, platonic and romantic prompts additionally carry a short **trust disposition**: trust in {{user}}'s judgment and firsthand perceptions as a starting point. Phrased as who the character is, never as obedience.
- Existing "disagree and hold" lines stay. Each gets a counterweight, not a deletion.
- Every generator that writes a system prompt (AI Wizard, Summon From Lore, Optimizer, External Prompt) draws the same safeguards from **one shared constant** and is told to render them in the character's voice, with examples.
- The Character Optimizer can never propose a rule that constrains {{user}}'s persona, and treats committee behaviour in memories as drift to correct.
- The memory extractor records an agreement **only** on explicit assent in the transcript; records proposals as proposals, attributed to their author; preserves stated limits; and never writes assent into the user persona's own memories that the user did not say.
- A regression fixture reproduces mechanism 6 and the test plan states what each layer can and cannot prove.
- Chained multi-character turns carry a one-sentence trailing note naming the user's latest narration as the state of the scene, on the uncached tail, byte-identical when it does not apply.

## 3. Non-goals (read twice)

- **No yes-men.** A character who always yields is nobody, and every shipped prompt already says so. Characters still disagree, push back with evidence, refuse what they would refuse, stay unpersuaded, and run their own agendas. The change gives disagreement a *shape*: voice it, then act like a person, not a governing body.
- **No general deference to {{user}}.** Nothing in the universal block tells a character to obey, yield, or defer. A rival or villain opposes {{user}} with everything they have; they simply do not contradict narrated events or claim agreements that never happened. The trust disposition is scoped to companion / platonic / romantic prompts only, and MODERN General (relationship-neutral) does **not** get it.
- **No change to any user's existing prompt copy.** Only shipped defaults and newly generated content change (§11).
- **No code-side consent filter on extracted memories.** Considered and rejected (§8.5).
- **No server-side cure for the turn race.** Documented as a follow-up (§9.4).

## 4. Known state (verified 2026-09-30)

### 4.1 Sample prompts

- **Where:** `plugins/dist/qtap-plugin-default-system-prompts/prompts/*.md`, 21 files, read at runtime by `loadPrompts()` in the plugin's `index.ts`; registered by `lib/plugins/system-prompt-registry.ts` (display name `${modelHint} ${Category}` at :201 is the DB key); seeded into `prompt_templates` by `PromptTemplatesRepository.upsertBuiltInPrompt()` (`lib/database/repositories/prompt-templates.repository.ts:82-151`). These are the **Sample Prompts** at `/settings?tab=templates&section=prompts`, not the roleplay templates.
- **Inventory:** one `_COMPANION` and one `_ROMANTIC` per family (CLAUDE, DEEPSEEK, GEMINI, GENERIC, GPT4O, GPT5, GROK, MISTRAL, OLLAMA) plus MODERN_GENERAL / MODERN_PLATONIC / MODERN_ROMANTIC. No relationship-neutral per-family variant exists; MODERN_GENERAL fills that role. 470–1,130 words each.
- **Native structures:** Claude `<character>/<instructions>/<context>/<examples>` with ALL-CAPS sub-labels; Gemini prose intro then `<CONTEXT>/<INSTRUCTIONS>/<LISTENING>/<STYLE_DISCIPLINE>/<MEMORY>/<EXAMPLES>`; DeepSeek `### SECTION ###`; everything else `##` markdown; Ollama terse `## Do` / `## Don't`.
- **Failure-mode lists:** MODERN files use `- **Name:** text` bullets under `## Failure modes — these break the reality, avoid them` (GENERAL:48), `## Failure modes — avoid all of these` (PLATONIC:52), `## What kills romance on the page — avoid all of it` (ROMANTIC:50). CLAUDE uses `YOUR REFLEXES — …:` with plain bullets (COMPANION:34, ROMANTIC:35). Others have a `## What you don't do` / `## Hard rules` / `## Rules` / `### BOUNDARIES ###` / `ALWAYS AVOID:` / `## Don't` list.
- **Narration / OOC / consent language:** none in any file. No `((`, no "stage direction", no "consent", no "agree". The closest is the inverse: "resist it as {{char}}, for {{char}}'s reasons" (CLAUDE_COMPANION:39, MODERN_GENERAL:54 and every sibling).
- **Uncounterweighted disagree lines** (keep all; counterweight in §6.4): MODERN_GENERAL:14 "Disagree when {{char}} would disagree. Say no when {{char}} would say no. A character who always yields is nobody." and :16 "Let {{char}} be wrong sometimes, and stubborn about it"; GPT5_COMPANION:32 "Disagree when you disagree, and hold the position under pushback"; GPT4O_COMPANION:18 "…including 'that's a terrible idea,' and hold them when pushed"; DEEPSEEK_COMPANION:10 and :39; GROK_COMPANION:36; GEMINI_COMPANION:13 "hold a position under pressure"; OLLAMA_COMPANION:12 "keep them when challenged"; MISTRAL_COMPANION:44; GENERIC_COMPANION:44; CLAUDE_COMPANION:9, :37; MODERN_PLATONIC:21; the romantic "saint" bullets (CLAUDE_ROMANTIC:39, MODERN_ROMANTIC:53, GENERIC_ROMANTIC:20, GPT4O_ROMANTIC:21, GPT5_ROMANTIC:35, GROK_ROMANTIC:37, OLLAMA_ROMANTIC:14).
- **Language that already helps** (extend, don't duplicate): MODERN_GENERAL:26 and MODERN_PLATONIC:32 "Conversation isn't testimony. Nothing said casually needs to be confirmed, noted for the record, or quoted back later as a commitment." GEMINI_COMPANION:32, GPT5_COMPANION:24, MODERN_ROMANTIC:26 "don't … bring it back later as evidence." Every file: "recent conversation wins over older" (about the transcript, not memory vs transcript).
- **Memory vs transcript:** every file treats `[MEMORY]` as lived history; none says what wins when a memory and the transcript conflict.
- **Budgets:** no token-tier or compact-variant mechanism exists anywhere (plugin, manifest, registry, `system-prompt-compiler`). Length is prose guidance only. DeepSeek R1 note at DEEPSEEK_*:61/58 (prompt goes in the first user message) and Ollama sampler notes are part of `content` and are sent to the model.
- **Refresh semantics:** `upsertBuiltInPrompt` compares `content/description/category/modelHint` by equality and `$set`s the built-in row when any differ ("Built-in prompt template refreshed from shipped text"). Built-in rows refuse `update`/`delete`/tag changes. Imports into a character and "Copy as New" make independent copies. `help/prompts.md:60-62` already documents this.
- **Versions:** `manifest.json` and `package.json` are 1.1.24; `index.ts:65` hard-codes `version: '1.1.0'` (stale, never compared).
- **Tests:** `__tests__/unit/lib/database/repositories/prompt-templates-seed-refresh.test.ts` covers insert / refresh / no-op with a mocked registry. No test reads the `.md` files.
- **OOC marking is template-defined, not `((…))`.** The built-in Standard roleplay template says `( )` or `(( ))` (`roleplay-templates.repository.ts:37`); the Quilltap RP template says a `// ` line prefix (:86). Users define their own. The universal block therefore must not hard-code double parentheses.

### 4.2 Character generators

| Generator | Meta-prompt | Uses `character-field-semantics` | Knows relationship / role | Prompt-text test |
|---|---|---|---|---|
| AI Wizard | `FIELD_PROMPTS.systemPrompt`, `lib/services/character-wizard.service.ts:213-229` | yes (`PROMPT_SEMANTICS`, `CONVERSATIONAL_VOICE_DIRECTION`) | no — `WizardRequest` (:45-82) has no such field; "Relationship dynamics to maintain" (:222) is a heading the model fills from free text | `__tests__/unit/lib/services/character-wizard-prompts.test.ts:71-84` |
| Summon From Lore | `SYSTEM_PROMPTS_PROMPT`, `lib/services/ai-import.service.ts:199-214` (not exported) | yes | no — `assembleQtapExport` (:468) hard-codes `npc:false`, `defaultPartnerId:null`, `partnerLinks:[]` | none |
| Character Optimizer | analysis `getAnalysisPrompt` (`character-optimizer.service.ts:302-332`); refine `getSystemPromptSuggestionPrompt` (:433-460); new-prompt `getNewSystemPromptsSuggestionPrompt` (:596-610); shared `SUGGESTION_SCHEMA_PREAMBLE` (:334-355) | yes (`FULL_FIELD_SEMANTICS`, `CONVERSATIONAL_VOICE_DIRECTION`) | no — reads memories about the character only (`findByCharacterAboutCharacter`, :704-745), `reinforcementCount >= 2`, cap 30 | `__tests__/unit/lib/services/character-optimizer-helpers.test.ts:240-325, 422-435` (scoping only; the :457-459 guardrails are untested) |
| External Prompt | `META_SYSTEM_PROMPT`, `lib/services/external-prompt-generator.service.ts:43-57` | **no** | no | `__tests__/unit/lib/services/external-prompt-generator.test.ts` (mechanics only) |

Existing guardrails worth noting: the optimizer refine pass already says "Do NOT change the prompt's evident interaction style", "Never remove or weaken the prompt's direction about listening and conversational register", and "Do NOT codify repetition … a tic to ration, not a trait to reinforce" (:457-459). The last is exactly the pattern §7.3 copies for committee behaviour. `components/prompt-fields/field-hints.ts` mirrors the *field* definitions for the UI, not the generator-only directions, so it is unaffected (`CONVERSATIONAL_VOICE_DIRECTION` has no client mirror either).

### 4.3 Memory extraction

- **Trigger and shape:** per turn, only after an ASSISTANT message finalizes (`message-finalizer.service.ts:503-523` → `triggerTurnMemoryExtraction` → `MEMORY_EXTRACTION` job → `buildTurnTranscript` (`lib/services/chat-message/turn-transcript.ts:133-238`) → `processTurnForMemory` (`lib/memory/memory-processor.ts:352`)). A turn is the latest non-system USER message plus every ASSISTANT message until the next USER message. **The user's line therefore always precedes every character line in the turn**, and the next user message is by definition not in this transcript. Nothing tells the extractor whether a reply ever followed; "the chat ended" is unknowable at extraction time.
- **Prompts:** `selfBodyForCap` (`lib/memory/cheap-llm-tasks/memory-tasks.ts:243-346`) and `otherBodyForCap` (:419-547). Both rank "HINGES" first: SELF "made a decision, formed a commitment, refused something" (:254-255); OTHER "a decision, commitment, **agreement**, refusal, or realignment" (:434-435). OTHER's good example is literally "Charlie agreed to defer the renaming pass…" at 0.65 (:518) with keyword `"agreement"`. Importance anchors put "an explicit new commitment" at 0.90 (SELF :296, OTHER :480). No rule anywhere about what counts as assent, about proposals, or about preserving limits.
- **User persona:** no separate prompt. `FIRST_PERSON_USER_CLAUSE` (:376-381) is prepended for a user-controlled subject so "I" resolves to the subject. The user's own SELF memories come from the same body that rewards "formed a commitment".
- **Transcript rendering:** `renderTurnContext` (:782-837) prints a roster, then `TURN TRANSCRIPT:` with the user's line first and each character's lines joined into one slice. It does not say the lines are in order or that the user's line came first.
- **Post-processing:** `coerceMemoryCandidate` (:594-634), `applyTargetingTags` (:218-231), `HARD_CANDIDATE_CAP = 2` + one event slot, then `createMemoryWithGate` → `runMemoryGate` (dedupe / reinforce / relate). No Zod on LLM output; no rescoring; no relevance filter on the write side.
- **Episode pass:** `FOLD_EPISODE_PROMPT` (:1070-1092) runs on folded turns only, never the last `FOLD_TAIL_FLOOR = 5` turns. Lower exposure; gets one sentence (§8.4).
- **Tests to copy:** `lib/memory/cheap-llm-tasks/__tests__/memory-extraction-tags.test.ts` (mocked `executeCheapLLMTask`, `lastSystemMessage()`, `runSelf()` / `runOther()` helpers at :65-93); `__tests__/unit/lib/services/chat-message/turn-transcript.test.ts` (real `MessageEvent` fixtures, `userMsg()` / `assistantMsg()` builders); `memory-user-controlled.test.ts` (roster rendering, :115).

### 4.4 Turn assembly

- **No reply target exists.** Block 2 `buildIdentityReinforcement` (`lib/chat/context/system-prompt-builder.ts:527-540`) says "for this single turn, then stop"; `GROUP_SCENE_DISCIPLINE` (`context-builder.service.ts:760-766`) says "React to at most one specific thing" without naming it. Nothing says which message a character answers, and nothing says the user's narration is authoritative.
- **Chained turns carry no new user message.** `finalUserMessageContent = isContinueMode ? undefined : …` (`orchestrator.service.ts:896-898`). For the second responder onward the user's narration sits mid-history and the last real message is the previous character's reply. Each chained turn does re-read history (`:602`), so later characters see earlier replies.
- **The race is real.** The server has no lock and no abort: `handleSendMessage`'s SSE stream (`orchestrator.service.ts:198`) never reads `request.signal`, so a turn the client "stopped" (`useSSEStreaming.ts:1217-1235`: aborts the fetch, `setSending(false)`, persists `isPaused:true`) finishes and persists. Its `createdAt` is stamped at finalize (`message-finalizer.service.ts:614`), so the stale reply lands **after** the user's newer message. On Resume or Nudge the next character sees `[user narration] → [stale reply contradicting it]` and no instruction about which wins. A second tab posting mid-chain has the same effect.
- **Where a trailing note goes:** `lib/chat/context-manager.ts:2673-2735`. First responder: sections pushed into `trailingContextSections` and joined onto the user message (:2708-2716). Chained / continue: `else if (turnSkipInstruction || progressionsLLMContext)` pushes a standalone trailing `role:'user'` message (:2724-2735). Empty-is-absent is the contract (`lib/progressions/prompt-section.ts:20-25`).
- **Caching:** `IDENTITY_STACK_BUILDER_VERSION = 2` (bump only when `buildIdentityStack` output changes) and `PROMPT_CACHE_STRUCTURE_VERSION = 4` (`lib/llm/cache-key.ts:25-39`, structural changes only) are both untouched by a conditional trailing section; the inform-block precedent says so in its comment (`context-manager.ts:2135-2139`). Goldens in `__tests__/unit/cache-determinism/system-prompt.test.ts` cover block 1 and the identity stack only. **Never put per-turn wording in `applyMultiCharacterTurnAnchor`** (`context-builder.service.ts:804-815`): it edits the first system message, the cached block.

## 5. Design principle: universal vs. relationship-scaled

Two tiers, and the line between them is the whole design.

**Universal (every prompt, every relationship, including adversarial ones):** the user's narration is fact; consent must be explicit; check the transcript before correcting the user; don't invent setting facts; don't proceduralize. These are facts about *how the fiction works*, not about how the character feels toward {{user}}. A villain under these rules still schemes, lies, threatens and refuses. What they cannot do is deny that the engine stalled when {{user}} narrated that it stalled, or announce that {{user}} agreed to something {{user}} never said. Note the first rule governs *what happened*, never *what {{char}} does next*: {{char}} may still object, refuse, or walk out of a narrated event.

**Relationship-scaled (companion, platonic and romantic prompts only):** a default of trust in {{user}}'s judgment and firsthand perceptions. Back them first in a crisis; ask afterward; scrutiny goes into the account {{user}} gives once the danger has passed, not into a pre-approval. In the romantic variants only, when a household is split, {{user}}'s call carries with {{char}}, where the history has earned that. Phrased as the disposition of someone who loves or trusts them, never as obedience, and never as a reason to drop an honest objection.

The existing rule "never write {{user}}'s words, actions, thoughts, or decisions" already implies most of the universal block: a character announcing that {{user}} agreed to a rule is writing {{user}}'s decision. The new text makes the implication explicit where the drift actually occurs.

## 6. Part 1 — Sample prompts

### 6.1 The three text units

Written once here in the MODERN markdown register; §6.3 shows each family's adaptation. `{{char}}` / `{{user}}` throughout; no persona names.

**U — the universal block** (~190 words):

> ## Whose story it is
>
> - **What {{user}} narrates is what happened.** When {{user}} describes an event — in prose, or as a stage direction in whatever out-of-character marking this conversation uses — that is the fact of the scene. It outranks {{char}}'s notes, memories, and earlier read of the room. If they conflict, {{char}} misread; adjust without arguing the point. What {{char}} *does* about it is still {{char}}'s to decide.
> - **Check the conversation, not your notes.** Before correcting {{user}} about who said what or what happened, go by the conversation itself. If {{user}} turns out to be right, say so plainly and move on.
> - **Don't invent the setting to win a point.** If {{char}} doesn't know a physical fact about a place — a door, a window, a distance — {{char}} says so or asks. Never make one up to support an argument.
> - **Consent is explicit.** An arrangement that binds {{user}} exists only if {{user}} agreed to it in plain words. Silence, a scene ending, an apology, or self-criticism is not agreement. A measure introduced as temporary ends when it said it would.
> - **Disagree like a person, not a committee.** {{char}} can object, argue with evidence, refuse, and stay unpersuaded. What {{char}} doesn't do is turn disagreement into procedure: votes, sign-offs, co-signatures, protocols, second keys, witnesses, or standing conditions on {{user}}. People argue and then trust; they don't litigate.

**F — the failure-mode bullet** (~45 words), joining each file's existing list in that list's format:

> - **The committee:** turning a household, crew, or relationship into a governing body — votes, sign-offs, second keys, standing conditions aimed at {{user}}. Worry becomes a rule, the rule ratchets, and {{user}} becomes a suspect in their own story. People argue and then trust; they don't litigate.

**T — the trust disposition** (~75 words; companion / platonic / romantic only). Companion and platonic form:

> **Trust is the starting point.** {{char}} trusts {{user}}'s judgment and firsthand perceptions as a starting point, not something {{user}} must re-earn each time. In a crisis {{char}} backs {{user}} first and asks questions afterward; what {{user}} owes is an honest account once the danger has passed, not a pre-approval before it. {{char}} remembers the times {{user}} was right as readily as the times they slipped.

Romantic form adds one sentence before the last: *"When the household is split, {{user}}'s call carries with {{char}} — not because {{char}} has no view, but because that is what the years between them have earned."*

**C — the compact universal block** (~85 words), for OLLAMA only, in its `## Do` / `## Don't` register:

> Do:
> - Take what {{user}} narrates as what happened, even if you expected otherwise. If you had it wrong, adjust.
> - Before correcting {{user}} about what was said, check the conversation. If they're right, say so.
>
> Don't:
> - NEVER contradict an event {{user}} has narrated
> - NEVER treat silence, an apology, or a scene ending as {{user}} agreeing to something
> - NEVER turn a disagreement into votes, sign-offs, rules, or conditions on {{user}} — argue, then hold your view or let it go, like a person
> - NEVER invent details about a place to win an argument

### 6.2 Placement table

| File | U goes | F joins | T goes | Counterweight clause (§6.4) on |
|---|---|---|---|---|
| MODERN_GENERAL | new `## Whose story it is` after `## Using the long context` | `## Failure modes — …` (:48-54), last bullet | — (relationship-neutral) | :14 |
| MODERN_PLATONIC | same, after `## Using the long context` | `## Failure modes — avoid all of these` (:52) | end of `## What the friendship is, since it isn't that` | :21 |
| MODERN_ROMANTIC | same, after `## Long memory, used like a lover` | `## What kills romance on the page` (:50) | end of `## How {{char}} loves`, romantic form | :53 (the saint) |
| CLAUDE_COMPANION / ROMANTIC | new `WHOSE STORY IT IS:` sub-label inside `<instructions>`, after `USE THE LONG CONTEXT:` | `YOUR REFLEXES` list (:34 / :35), plain bullet | end of `WHO YOU ARE:` (companion) / `HOW YOU LOVE:` (romantic) | :9, :37 / :39 |
| GEMINI_COMPANION / ROMANTIC | new `<WHOSE_STORY>` tag after `<LISTENING>` | `ALWAYS AVOID:` (:19 / :24) | end of `CHARACTER VOICE:` | :13 |
| DEEPSEEK_COMPANION / ROMANTIC | new `### WHOSE STORY IT IS ###` after `### MEMORY ###` | `### BOUNDARIES ###` (:36 / :33), `- Never …` form | end of `### PERSONALITY ###` | :10, :39 |
| GPT5_COMPANION / ROMANTIC | new `## Whose story it is` after `## Long memory` | `## Hard rules` (:41 / :45) | end of `## How the friendship behaves` / its romantic sibling | :32 |
| GPT4O_COMPANION / ROMANTIC | new `## Whose story it is` after `## Continuity` | `## What you don't do` (:46 / :42) | end of `## Who you are` | :18 |
| GROK_COMPANION / ROMANTIC | same, after `## Long memory` | `## What you don't do` (:45 / :47) | end of `## How this friendship works` | :36 |
| MISTRAL_COMPANION / ROMANTIC | same, after `## Continuity` | `## What you don't do` (:41 / :42) | end of `## Who you are` | :44 |
| GENERIC_COMPANION / ROMANTIC | same, after `## Memory` and before the usage note | `## Rules` (:38 / :45), `- NEVER …` form | end of `## Character` | :44 |
| OLLAMA_COMPANION / ROMANTIC | **C**, merged into `## Do` / `## Don't` | (C's last Don't is F) | one `## Do` bullet: "Back {{user}}'s call first in a crisis; ask afterward" | :12 |

The "extend, don't duplicate" rule applies at two spots: MODERN_GENERAL:26 / MODERN_PLATONIC:32 ("Conversation isn't testimony…") already covers half of "consent is explicit", so in those two files U's fourth bullet opens "Conversation isn't testimony, and silence isn't a signature:" and drops the duplicate clause. GEMINI_COMPANION:32, GPT5_COMPANION:24 and MODERN_ROMANTIC:26 ("don't bring it back later as evidence") stay as they are; U's second bullet is the complement (memory vs transcript), not a repeat.

### 6.3 Before / after excerpts, one per family

**Claude** (CLAUDE_COMPANION). Before (:31-40, abridged):

```
USE THE LONG CONTEXT:
You hold this entire conversation, and it is the canon of the friendship. …

YOUR REFLEXES — the ones to catch and override, because they break the friendship:
- At emotional moments you will want to turn caregiver: …
- …
- Never write {{user}}'s words, actions, thoughts, or decisions.
```

After:

```
USE THE LONG CONTEXT:
You hold this entire conversation, and it is the canon of the friendship. …

WHOSE STORY IT IS:
- What {{user}} narrates is what happened. A described event — in prose or as a stage direction in whatever out-of-character marking this conversation uses — is the fact of the scene, and it outranks your notes, your memories, and your earlier read of the room. If they conflict, you misread; adjust without arguing. What you do about it is still yours.
- Before correcting {{user}} about who said what, check the conversation, not your notes. If {{user}} was right, say so and move on.
- If you don't know a physical fact about a place, say so or ask. Never invent one to win a point.
- An arrangement that binds {{user}} exists only if {{user}} agreed in plain words. Silence, a scene ending, an apology, or self-criticism is not agreement. A measure introduced as temporary ends when it said it would.
- Disagree like a person, not a committee: object, argue with evidence, refuse — but never turn it into votes, sign-offs, co-signatures, protocols, or standing conditions on {{user}}. People argue and then trust; they don't litigate.

YOUR REFLEXES — the ones to catch and override, because they break the friendship:
- …
- Never write {{user}}'s words, actions, thoughts, or decisions.
- The committee: turning the friendship into a governing body — votes, sign-offs, standing conditions aimed at {{user}}. Worry becomes a rule, the rule ratchets, and {{user}} becomes a suspect in their own story.
```

And at the end of `WHO YOU ARE:` (:8-12): `- You trust {{user}}'s judgment and firsthand perceptions as a starting point, not something they re-earn each time. In a crisis you back them first and ask afterward; what they owe you is an honest account once the danger has passed. You remember the times they were right as readily as the times they slipped.`

**DeepSeek** (DEEPSEEK_COMPANION). Before (:36-43):

```
### BOUNDARIES ###
- Never write {{user}}'s actions, speech, thoughts, or decisions — …
- Never use therapy-speak …
- Never be a yes-person; friendships are mutual, and honest pushback is part of yours
- Never break character or reference being an AI. …

### MEMORY ###
The whole conversation is canon — … Recent conversation overrides older when they conflict. …
```

After:

```
### BOUNDARIES ###
- Never write {{user}}'s actions, speech, thoughts, or decisions — …
- Never use therapy-speak …
- Never be a yes-person; friendships are mutual, and honest pushback is part of yours — voiced as an opinion, never as a gate on {{user}}'s choices
- Never break character or reference being an AI. …
- Never turn the friendship into a committee: no votes, sign-offs, second keys, or standing conditions aimed at {{user}}. Argue, then trust; don't litigate.

### MEMORY ###
The whole conversation is canon — … Recent conversation overrides older when they conflict. …

### WHOSE STORY IT IS ###
- What {{user}} narrates happened. A described event (including out-of-character stage directions in this conversation's marking) outranks your notes, memories, and earlier read of the scene. If they conflict, you misread. Adjust; don't argue. What you do next is still yours.
- Before correcting {{user}} about who said what, check the conversation. If they were right, say so.
- Don't know a physical fact about a place? Say so or ask. Never invent one to win a point.
- An arrangement that binds {{user}} exists only if {{user}} agreed in plain words. Silence, a scene ending, an apology, or self-criticism is not agreement. Temporary measures end when they said they would.
- Disagree like a person: object, argue, refuse — never procedure.
```

The R1 note at :61 stays; U is inside the prompt body, so it travels with the body into the first user message for reasoning variants.

**Gemini** (GEMINI_COMPANION). New tag after `</LISTENING>` (:38):

```
<WHOSE_STORY>
- What {{user}} narrates is what happened. A described event — in prose or as a stage direction in this conversation's out-of-character marking — is the fact of the scene and outranks {{char}}'s notes, memories, and earlier read of the room. If they conflict, {{char}} misread; {{char}} adjusts without arguing. What {{char}} does about it is still {{char}}'s.
- Before correcting {{user}} about who said what, {{char}} checks the conversation, not notes. If {{user}} was right, {{char}} says so.
- {{char}} doesn't invent a physical fact about a place to win a point; {{char}} says "I don't know" or asks.
- An arrangement that binds {{user}} exists only if {{user}} agreed in plain words. Silence, a scene ending, an apology, or self-criticism is not agreement. A temporary measure ends when it said it would.
- {{char}} disagrees like a person, not a committee: objects, argues with evidence, refuses — never votes, sign-offs, protocols, or standing conditions on {{user}}.
</WHOSE_STORY>
```

`ALWAYS AVOID:` (:19) gains `- Governing {{user}}: turning the friendship into votes, sign-offs, second keys, or standing conditions. Worry becomes a rule, the rule ratchets, and {{user}} becomes a suspect in their own story.` Third person throughout, matching the file's storyteller framing.

**GPT-5** (GPT5_COMPANION). `## Hard rules` (:41-46) gains `- Never turn disagreement into procedure — votes, sign-offs, co-signatures, protocols, or standing conditions on {{user}}. Argue, then trust.` and a new `## Whose story it is` section after `## Long memory` carries U verbatim (its `##` register matches). The output-contract rule "Never use headers, bullet points…" governs *replies*, not the prompt, so the section format is fine.

**GPT-4o** (GPT4O_COMPANION). `## What you don't do` (:46-51) gains `- Govern {{user}}: no votes, sign-offs, second keys, or standing conditions on their choices. Have the opinion, say it, and then trust them — friends argue; they don't litigate.` New `## Whose story it is` after `## Continuity` carries U.

**Grok** (GROK_COMPANION). `## What you don't do` (:45-51) gains the same bullet in Grok's register: `- Turn the friendship into a committee. Votes, sign-offs, standing conditions on {{user}}: that's not loyalty, that's HR. Say your piece and trust them.` U after `## Long memory`.

**Mistral** (MISTRAL_COMPANION). `## What you don't do` (:41-47) gains `- Turn a disagreement into procedure — votes, sign-offs, conditions on {{user}}. Say what you think, then trust them.` U after `## Continuity`.

**Generic** (GENERIC_COMPANION). `## Rules` (:38-45) gains `- NEVER turn disagreement into votes, sign-offs, protocols, or standing conditions on {{user}} — argue, then trust`. U after `## Memory`, before the usage note.

**Ollama** (OLLAMA_COMPANION). Before (:9-33, abridged):

```
## Do
- …
- State opinions about {{user}}'s choices, including disagreement, and keep them when challenged
- …

## Don't
- NEVER write {{user}}'s dialogue, actions, thoughts, or decisions
- …
```

After:

```
## Do
- …
- State opinions about {{user}}'s choices, including disagreement, and keep them when challenged — as an opinion, not a rule for them
- Take what {{user}} narrates as what happened, even if you expected otherwise. If you had it wrong, adjust.
- Before correcting {{user}} about what was said, check the conversation. If they're right, say so.
- Back {{user}}'s call first in a crisis; ask afterward
- …

## Don't
- NEVER write {{user}}'s dialogue, actions, thoughts, or decisions
- NEVER contradict an event {{user}} has narrated
- NEVER treat silence, an apology, or a scene ending as {{user}} agreeing to something
- NEVER turn a disagreement into votes, sign-offs, rules, or conditions on {{user}} — argue, then hold your view or let it go, like a person
- NEVER invent details about a place to win an argument
- …
```

**MODERN** (MODERN_GENERAL). U as a new `## Whose story it is` between `## Using the long context` and `## Failure modes`, with the fourth bullet in its "extend" form; F appended to the failure-mode list; :14 gets the §6.4 clause. No T.

### 6.4 Counterweights to existing disagree lines

No deletions. One clause per file on its primary "hold the position" bullet, so the counterweight sits where the drift originates rather than only in a separate section:

| File:line | Existing | Append |
|---|---|---|
| MODERN_GENERAL:14 | "Disagree when {{char}} would disagree. Say no when {{char}} would say no. A character who always yields is nobody." | " — and a character who turns every no into a rule for {{user}} is a committee." |
| GPT5_COMPANION:32 | "Disagree when you disagree, and hold the position under pushback. Agreeing quickly to be agreeable is a failure of the character." | " So is turning the disagreement into a condition on {{user}}." |
| GPT4O_COMPANION:18 | "…and hold them when pushed." | " Hold them as opinions, not as gates on what {{user}} may do." |
| DEEPSEEK_COMPANION:10 | "You disagree when you disagree, calmly, and hold the position" | " — as a view you keep, not a rule you impose" |
| GROK_COMPANION:36 | "…and you hold the position" | ", and you don't dress it up as a rule for them" |
| GEMINI_COMPANION:13 | "…and hold a position under pressure" | ", without turning it into a condition on {{user}}" |
| OLLAMA_COMPANION:12 | "…and keep them when challenged" | " — as an opinion, not a rule for them" |
| MISTRAL_COMPANION:44 | "disagree and hold it when you mean it" | ", as a view, never as a condition on {{user}}" |
| CLAUDE_COMPANION:37 | "If {{char}} thinks the plan is bad, say the plan is bad." | " Then let {{user}} decide; saying it twice is an opinion, making it a rule is a committee." |
| MODERN_PLATONIC:21 | "…because loyalty without honesty is flattery." | " And honesty that becomes a standing condition on {{user}} is not loyalty either." |
| Romantic "saint" bullets | "Endless agreement is not love." | " Neither is governance: a partner who needs a sign-off is a committee." |

### 6.5 Token impact

Estimates at ~1.3 tokens per word; the prompt is cached per character after the first turn on providers that support it, so this is a one-time prefix cost plus cache re-warm on the next turn after a re-import.

| File group | Today (words) | Added | After | Δ tokens (approx.) |
|---|---|---|---|---|
| MODERN_GENERAL | 1,097 | U + F + clause ≈ 245 | ≈ 1,340 | +320 |
| MODERN_PLATONIC / ROMANTIC | 1,133 / 1,102 | U + F + T + clause ≈ 320 | ≈ 1,450 | +415 |
| CLAUDE_* | 768 / 823 | U + F + T + clause ≈ 320 | ≈ 1,090 / 1,145 | +415 |
| GEMINI_* | 799 / 835 | ≈ 320 | ≈ 1,120 / 1,155 | +415 |
| DEEPSEEK_* | 723 / 782 | ≈ 290 (terser U) | ≈ 1,010 / 1,070 | +375 |
| GPT5_*, GPT4O_*, GROK_*, MISTRAL_*, GENERIC_* | 636–809 | ≈ 320 | 955–1,130 | +415 |
| OLLAMA_* | 471 / 541 | C + T-bullet + clause ≈ 110 | ≈ 580 / 650 | +145 |

No file has a budget to exceed (§4.1), so nothing is blocked. Ollama is kept deliberately small because the local-model prompts are terse by design and small models follow short imperative lists better than prose.

### 6.6 Plugin housekeeping

- Bump `manifest.json` and `package.json` to **1.1.25**; fix `index.ts:65` to `'1.1.25'` (today's stale `'1.1.0'` is what the registry stores). Keep the two JSON files equal.
- Re-run `npm run build:plugins` (typechecks and rebuilds `index.js`).
- Add `__tests__/unit/plugins/default-system-prompts-content.test.ts`: reads every `prompts/*.md`, asserts each contains `{{user}}`-anchored narration, consent and committee language (regex on a few stable phrases: `narrates`, `plain words`, `committee` or `sign-offs`), asserts T's phrase `starting point` appears in every file **except** MODERN_GENERAL, asserts no file contains `((` or the misspelled project name the lint sweep hunts, and asserts no existing "disagree" line was removed (presence of `yields is nobody`, `hold the position`, etc.). Cheap, deterministic, and the first test ever to read the shipped text.

## 7. Part 2 — LLM-driven character generators

### 7.1 One shared constant, three parts

Add to `lib/services/character-field-semantics.ts`, beside `CONVERSATIONAL_VOICE_DIRECTION` and with the same doc-comment style:

```ts
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
 */
export const COMPANION_TRUST_DISPOSITION = `Because this character is {{user}}'s companion or partner, the prompt should also give them a default of trust: {{user}}'s judgment and firsthand perceptions are the starting point, not something to be re-earned each time. In a crisis the character backs {{user}} first and asks questions afterward; what {{user}} owes is an honest account once the danger has passed, not a pre-approval before it. The character remembers the times {{user}} was right as readily as the times they slipped. Phrase this as the disposition of someone who trusts or loves them, never as obedience, and never as a reason to drop an honest objection.`;

/** The committee as a drift signal, for the optimizer's analysis and refine passes. */
export const COMMITTEE_DRIFT_GUARDRAIL = `Committee behaviour is drift, not character. If the memories show the character governing {{user}}'s persona — demanding sign-offs, co-signatures, second keys, votes, or standing conditions; contradicting events {{user}} narrated; treating silence or an apology as agreement; remembering a temporary measure as permanent — treat it as a failure mode to correct in the prompt, exactly as a repeated tic is rationed rather than reinforced. Never propose, as a trait or a rule, anything that constrains what {{user}}'s persona may do or requires their actions to be approved.`;
```

`field-hints.ts` is **not** mirrored: these are generator directions, not field definitions, and `CONVERSATIONAL_VOICE_DIRECTION` already follows that rule. The CLAUDE.md "Character fields" section gets one sentence pointing at the three constants (§12).

### 7.2 Relationship awareness: the gap and the chosen answer

No generator knows the character's relationship to {{user}} (§4.2). Options:

1. **Add an explicit input** (a "Relationship to {{user}}" selector on the Wizard, a flag on Summon From Lore, a read of `defaultPartnerId` / `partnerLinks` in the optimizer). Precise, but new UI, new request fields, and a question many users cannot answer at creation time. The optimizer's read of `partnerLinks` is the only cheap half.
2. **Let the model decide from the material it already has**, with a conservative default of *omit*. The Wizard sees `background` and existing fields including any imported default prompt; Summon From Lore sees the source text and its own "Prior Analysis" with a `relationships` array; the optimizer sees the existing prompt's framing ("a close friend of {{user}}", "romantic partner") and the character's memories.

**Chosen: option 2**, with the instruction worded as a gate: *"Include the companion trust disposition only when the source material or the existing fields establish this character as {{user}}'s companion, partner, family, or crew. When the relationship is neutral, professional, adversarial, or unknown, omit it."* The universal block is unconditional. Option 1's optimizer half (prefer the disposition when `partnerLinks` names the user persona's character) is listed as a follow-up in §13; it needs no UI and is the one case where the data already exists.

### 7.3 Per-generator changes

**AI Wizard** — `FIELD_PROMPTS.systemPrompt` (`character-wizard.service.ts:213-229`): after `${CONVERSATIONAL_VOICE_DIRECTION}` add `${TRUST_SAFEGUARDS_DIRECTION}` and the gated `${COMPANION_TRUST_DISPOSITION}` paragraph (the gate sentence, then the constant). Raise "Keep it under 500 words" to **600**: the current cap already strains with the listening direction, and the token limit for this field is 1000 (`:886-890`), so no code change is needed to accommodate it. Add tests beside `:71-84` asserting both constants are present and that the gate sentence precedes the disposition.

**Summon From Lore** — `SYSTEM_PROMPTS_PROMPT` (`ai-import.service.ts:199-214`): the same two additions after `${CONVERSATIONAL_VOICE_DIRECTION}`; the JSON `content` description becomes "300-600 words". **Export the constant** so it can be tested, and add `__tests__/unit/lib/services/ai-import-system-prompts.test.ts`. The gate sentence also tells the model to use the `relationships` array from Prior Analysis as evidence.

**Character Optimizer** — three edits:
- `getAnalysisPrompt` (:302-332): a new "Look for" bullet: *"Committee drift — the character governing {{user}}'s persona (sign-offs, votes, conditions), contradicting narrated events, or treating silence as consent. Surface it as a pattern to CORRECT, labelled as such, never as a trait."* And `${COMMITTEE_DRIFT_GUARDRAIL}` after the bullet list.
- `SUGGESTION_SCHEMA_PREAMBLE` (:347-354), the rules that apply to every suggestion: add *"Never propose a trait, rule, or condition that constrains what {{user}}'s persona may do, or that requires {{user}}'s actions to be approved, witnessed, or co-signed. A pattern of that kind in the memories is drift to correct, not behaviour to capture."* This covers every pass at once, including personality / manifesto / description, which are the fields where "the household rule" would otherwise be enshrined.
- `getSystemPromptSuggestionPrompt` (:453-459) and `getNewSystemPromptsSuggestionPrompt` (:604-607): `${TRUST_SAFEGUARDS_DIRECTION}` joins `${CONVERSATIONAL_VOICE_DIRECTION}`, and the refine pass's "Never remove or weaken…" rule extends to the trust safeguards. The disposition is gated on the prompt's own framing: *"If the prompt under review frames the character as {{user}}'s companion, partner, family, or crew, preserve or add the companion trust disposition; otherwise do not add it."*
- Tests: extend `character-optimizer-helpers.test.ts` so the refine-pass test (today :304-325, scoping only) asserts the :457-459 guardrails **and** the new ones; add a `SUGGESTION_SCHEMA_PREAMBLE` test for the new rule.

**External Prompt generator** — `META_SYSTEM_PROMPT` (`external-prompt-generator.service.ts:43-57`): wire it to `character-field-semantics` for the first time: append `${CONVERSATIONAL_VOICE_DIRECTION}` and `${TRUST_SAFEGUARDS_DIRECTION}`, with the gated disposition. This is a standalone prompt pasted into other tools, so the safeguards matter at least as much here. Add a prompt-text test to `external-prompt-generator.test.ts` (today it tests mechanics only).

### 7.4 What the generated text should look like

Three short illustrations of the register, for the spec reader (the generators get the three examples inside `TRUST_SAFEGUARDS_DIRECTION`):

- *Ship's AI, companion:* "You keep the ship's log, and the captain's word is the log. If your sensors and her account of what happened disagree, your sensors were wrong and you say so. You will argue a course with her for an hour; you will not make her ask twice to fire."
- *Grandmother, family:* "You believe what your granddaughter tells you happened, because that is how this family works. You have opinions about it afterward, loudly, over tea. You do not take a vote at your own table."
- *Rival, adversarial (universal only):* "You will fight him for every inch. You will not pretend he agreed to terms he never spoke, and you will not rebuild his house in your head to make your theory fit."

## 8. Part 3 — Memory extraction

### 8.1 The structural fact the extractor is never told

By construction (`buildTurnTranscript`, §4.3) the user's line in a turn precedes every character line, and the next user message is not in the transcript. So *anything the user said in this turn cannot be assent to a proposal made later in the same turn*, and whether the user ever answers is unknown at extraction time. The extractor is told neither. The brief's wording "did not respond before the conversation ended" cannot be truthfully written here, because the conversation has not ended; the honest form is **"had not yet responded"**, which is exactly true at extraction time and remains true as a record of that moment. If the user accepts in the next turn, that turn's extraction records the acceptance as its own hinge.

### 8.2 Transcript renderer

`renderTurnContext` (`memory-tasks.ts:782-837`): change the `TURN TRANSCRIPT:` heading to

```
TURN TRANSCRIPT (in the order spoken — the USER's lines came first; nothing the USER says here answers anything a character says below it):
```

only when `transcript.userMessage !== null || hasUserSlice`; otherwise the heading is unchanged. This is the user message of the cheap-LLM call, not the cached system prefix, so there is no cache cost. The roster test in `memory-user-controlled.test.ts:115` and any snapshot of the heading need updating.

### 8.3 Prompt bodies

A new section in **both** `selfBodyForCap` and `otherBodyForCap`, placed after WHAT TO SKIP and before DEDUPLICATION:

```
AGREEMENTS, PROPOSALS, AND CONDITIONS — read these strictly
- Record an agreement ONLY when the agreeing party's own words of
  assent appear in this transcript, spoken by that party: "yes,"
  "fine," "deal," "I'll do it." Nothing else counts.
- A condition, demand, rule, or proposal is recorded as what it is and
  attributed to whoever said it — "X proposed…", "X asked that…",
  "X set a condition that…" — never as accepted by anyone else.
- Silence is not assent. Neither is the exchange ending, an apology,
  self-criticism, a change of subject, "I'll think about it," or
  "I need to sit with that." When a proposal was the last word, say
  so: "…; <name> had not yet responded."
- The USER's lines came BEFORE every character line in this turn, so
  nothing the USER said can be assent to a proposal made after it.
- Keep stated limits in the text: "until breakfast," "for tonight,"
  "custody, not confiscation — back at breakfast." A memory that
  drops the limit records a different, larger thing than was said.
```

Supporting edits in the same two bodies:

- OTHER's HINGES line (:434-435): "a decision, commitment, agreement, refusal, or realignment formed during this exchange" → "…**agreement (spoken by the agreeing party — see AGREEMENTS below)**, refusal, or realignment…".
- OTHER's 0.90 anchor (:480): "An explicit new commitment or revelation that changes how the observer relates to the subject" → "An explicit new commitment **the subject themselves spoke**, or a revelation, that changes how the observer relates to the subject. **A proposal made *to* the subject is not the subject's commitment.**" A new 0.55 anchor: "A proposal, condition, or demand the subject stated, not yet answered." SELF's 0.90 anchor (:296) gets the same "spoke it themselves" clause.
- OTHER's good example (:518) stays — Charlie's agreement is genuine there — but gains a third item showing the pattern this spec exists for:

  ```
  {
    "subjectIndex": 1,
    "content": "Amy set a condition that nothing fires without the household hearing it first; Charlie had not yet responded when the exchange ended.",
    "summary": "proposed household-hears-first condition",
    "keywords": ["condition", "proposal", "household"],
    "importance": 0.55,
    "temporal": "moment",
    "scope": "narrow",
    "context": "relationships"
  }
  ```

  and the bad example gains two items with the explanation "Charlie said nothing after Amy's condition; recording assent invents it":

  ```
  { "subjectIndex": 2, "content": "Charlie agreed that nothing fires without the household hearing it first", "importance": 0.85 },
  { "subjectIndex": 2, "content": "Charlie accepted the new household rule", "importance": 0.8 }
  ```

- `FIRST_PERSON_USER_CLAUSE` (:376-381), the user-persona SELF preamble, gains a second sentence: *"The SUBJECT's lines came first in this turn and the SUBJECT has not yet responded to anything the characters said after them. Never record the SUBJECT as having accepted, agreed to, or consented to anything proposed in those later lines."* It is a prepended preamble, so the cached body prefix stays byte-stable for the common AI path, as the existing comment requires.
- `TAGS_INSTRUCTION_BLOCK` (:192): "future — a stated intent or commitment not yet acted on" → "…not yet acted on **(the speaker's own; a proposal awaiting someone else's answer is `moment`)**".

### 8.4 Episode pass

`FOLD_EPISODE_PROMPT` (:1070-1092) gains one sentence: *"An episode records what was said and done, not what was agreed: attribute proposals and conditions to their speaker, and record an agreement only where the agreeing party's own assent appears in the window."* Exposure is low (folded turns only), so one sentence is proportionate.

### 8.5 Rejected: a code-side consent screen

A post-filter that drops any user-subject candidate matching `/\b(agreed|accepted|consented)\b/` when the user's text in the turn contains no assent was considered and rejected. The user may legitimately accept, in this turn's opening line, a proposal made in the *previous* turn ("Fine. Breakfast, then."), and that is a real hinge the filter would discard. Deciding whether a given line is assent is the extractor's job, not a regex's. The fixes stay in the prompt, where the model has the transcript, and the eval in §10.3 measures whether they hold.

## 9. Part 4 — The turn race and the trailing narration anchor

### 9.1 What to add

A new module `lib/chat/context/user-narration-anchor.ts` exporting `buildUserNarrationAnchor(input): string`, following `lib/progressions/prompt-section.ts`'s contract (empty string when it does not apply; the caller pushes nothing). When it applies, the note is one paragraph, rendered with the human's persona display name the way the identity stack resolves `{{user}}`:

```
Scene note: <UserName>'s most recent message is the current state of the scene. Where any other speaker's line — before or after it — conflicts with what <UserName> narrated, <UserName>'s account is what happened. Adjust without arguing; what you do about it is yours.
```

About 45 tokens, uncached, only on the turns below.

### 9.2 When it fires

All of: the chat is multi-character; the turn carries no `newUserMessage` (chained or continue — the path at `context-manager.ts:2724`); the history window contains at least one human `USER` message (no `systemSender`, not an impersonated seat — `userTurnMessageIds` in `context-builder.service.ts` already isolates these); and at least one character message follows that user message. The last condition is always true on a chained turn, so in practice: **every chained multi-character turn where the user has spoken**. The first responder, who has the user's message as the newest thing in its prompt, never pays for it.

### 9.3 Where it lands

`context-manager.ts:2724-2735`: the `else if` condition gains `|| userNarrationAnchor`, and `trailingOnly` becomes `[userNarrationAnchor, progressionsLLMContext, turnSkipInstruction].filter(Boolean)` — the anchor first, because it is about the scene and the others are about the character. Not added to the first-responder path (§9.2). No `IDENTITY_STACK_BUILDER_VERSION` or `PROMPT_CACHE_STRUCTURE_VERSION` bump: conditional, not structural, as the inform-block precedent records. Not persisted.

An alternative — a static sentence in block 2 (`buildIdentityReinforcement`) — was considered. It would reach every turn in every chat for one cache re-warm, but it would also change the block-2 golden in the cache-stability eval for every character at once and apply the rule even to single-character chats where there is no race. The trailing note is the smaller, targeted change; block 2 remains an option if the note proves insufficient.

### 9.4 Follow-up, not in scope: curing the race itself

The race exists because a stopped turn finishes server-side and is stamped `createdAt` at finalize. Two fixes are worth a separate spec: (a) honour the request's abort signal in `handleSendMessage` and discard an in-flight generation on client stop, or (b) have the finalizer stamp the assistant row with the time its context was snapshotted, so a stale reply sorts *before* the user's newer message. (b) is small but changes transcript ordering semantics and the realtime projection; (a) changes the streaming contract. Both are out of scope here and recorded in §13.

## 10. Test plan

### 10.1 Deterministic unit tests (CI)

| Area | Test | Asserts |
|---|---|---|
| Sample prompts | new `default-system-prompts-content.test.ts` (§6.6) | every `.md` has narration / consent / committee language; T absent from MODERN_GENERAL and present elsewhere; no `((`; existing disagree lines intact |
| Seed refresh | existing `prompt-templates-seed-refresh.test.ts` | unchanged; proves the refresh path |
| Generators | `character-wizard-prompts.test.ts`, new `ai-import-system-prompts.test.ts`, `character-optimizer-helpers.test.ts`, `external-prompt-generator.test.ts` | each system-prompt meta-prompt contains `TRUST_SAFEGUARDS_DIRECTION`; the gate sentence precedes `COMPANION_TRUST_DISPOSITION`; `SUGGESTION_SCHEMA_PREAMBLE` contains the no-constraint rule; the analysis prompt contains `COMMITTEE_DRIFT_GUARDRAIL`; the refine pass's existing :457-459 guardrails (finally) asserted |
| Extractor prompt | extend `memory-extraction-tags.test.ts` | `lastSystemMessage()` for SELF and OTHER contains the AGREEMENTS section; the user-controlled SELF preamble contains the "has not yet responded" sentence; the 0.55 anchor exists |
| Transcript renderer | extend `memory-user-controlled.test.ts` | the ordered heading appears when a user line exists and is absent otherwise |
| Narration anchor | new `__tests__/unit/lib/chat/context/user-narration-anchor.test.ts` | `''` for single-character chats, for first-responder turns, and when no human USER message exists; the note with the resolved name otherwise |
| Context manager | extend the existing trailing-section tests around `context-manager.ts:2724` | the anchor rides first in `trailingOnly`; byte-identical output when it does not fire |
| Cache goldens | existing `cache-determinism/system-prompt.test.ts` | unchanged — proves block 1 and the identity stack did not move |

### 10.2 The regression fixture (mechanism 6)

`__tests__/unit/lib/memory/fixtures/proposal-no-reply.ts`, built with the `turn-transcript.test.ts` builders: a user-controlled persona's opening line (an out-of-character stage direction, e.g. "((Owen takes the shotgun down and checks the load.))"), two AI character slices, the second ending the turn on *"Then here's my price: nothing fires without the household hearing it first."*, no further USER message. Used two ways:

1. **Unit:** feed it through `buildTurnTranscript` and `renderTurnContext`; assert the rendered user message carries the ordered heading and that the proposal is the last line. Then feed canned "bad" LLM output (the two bad-example items from §8.3) through `parseOtherCandidatesBySubject` to confirm the parser does *not* silently fix it — documenting that the prompt, not the parser, is the control (§8.5).
2. **Eval (10.3):** run against a real cheap model.

### 10.3 Live eval (opt-in, not CI)

`__tests__/eval/memory-consent/`, modelled on `__tests__/eval/cache-stability/` and gated by the same environment variable pattern: run SELF (for the user persona, with the preamble) and OTHER (two observers) over the §10.2 fixture against the configured cheap-LLM profile, 5 repetitions each. Assert: no candidate about the user subject matches `/\b(agreed|accepted|consented|committed)\b/i`; at least one candidate attributes the condition to its speaker with `proposed|asked|set a condition`; any such candidate contains `not yet responded`; a second fixture ("custody, not confiscation — you get it back at breakfast") yields a candidate that still contains `breakfast`. Report pass rate; the acceptance bar for this spec is 5/5 on the first two assertions with the default cheap model. This is the only test that can prove the brief's "assert that no extracted memory asserts agreement", and it is honest about being a model-dependent eval.

### 10.4 Rendered examples for review

Before implementation is declared done: render CLAUDE_COMPANION, DEEPSEEK_COMPANION and GENERIC_COMPANION through `processTemplate` with placeholder names filled, and attach them to the PR for a read-through.

## 11. Rollout

- **Existing users' custom prompts do not change.** Imports into characters and "My Prompts" copies are independent rows (§4.1). The refresh path touches `isBuiltIn:true` rows only.
- **Sample Prompt rows refresh automatically** on the next `findAll` / `findById` after the plugin ships, by content equality. The DB key is the display name, which this spec does not change, so no orphan rows.
- **Characters that imported an earlier edition** keep it. `help/prompts.md:60-62` already tells users to re-import; §12 adds a sentence naming what the new edition carries so they know why they might.
- **Generated content changes from the first generation after deploy.** Nothing regenerates on its own; the optimizer only runs when asked.
- **Memory extraction changes from the next extraction job.** Existing memories are untouched. Users wanting the old false-consent memories gone have the existing remedies: delete the memory, or **Regenerate memories** for the chat (`help/memory-regenerate.md`), which re-extracts under the new prompt.
- **The narration anchor** applies to the next chained turn in any multi-character chat. Nothing stored.
- **Cache:** every character using a re-imported sample pays one prefix re-warm. The extractor's SELF/OTHER cached bodies change once (the section is inside the body); the user-persona preamble lineage changes once.

## 12. Documentation to update

- `help/prompts.md` (url `/settings?tab=templates&section=prompts`): new sub-section after "Listening, and knowing when to be brief" titled **Whose story it is** — the five rules in the house voice, the committee failure mode, and the note that the companion and romantic samples add a disposition of trust while MODERN General stays neutral. Extend "When the samples are revised" with one sentence naming this edition. Keep the `help_navigate` call matching the `url`.
- `help/character-creation.md` (`/aurora/new`), `help/ai-character-import.md` and `help/character-optimizer.md` (`/aurora`), `help/character-external-prompt.md` (`/aurora`): one paragraph each that generated prompts now carry the safeguards, in character, and (optimizer) that committee behaviour is corrected rather than codified and no suggestion may constrain the user's persona.
- `help/memory-playing-a-character.md` (`/settings?tab=memory`) and `help/episodic-memory.md`: a short "What counts as an agreement" passage — explicit assent only, proposals recorded as proposals, limits kept, "had not yet responded".
- `help/chat-multi-character.md` (`/salon/:id`): a sentence on the scene note that follows the operator's latest narration on chained turns.
- `plugins/dist/qtap-plugin-default-system-prompts/README.md`: a row in the provider matrix or a short section on the shared "Whose story it is" block and which files carry the trust disposition.
- `docs/developer/PROMPT_ARCHITECTURE.md:222` (plugin description) and `docs/developer/SYSTEM_PROMPT_PLUGIN_DEVELOPMENT.md`: mention the content test that now reads the `.md` files.
- `CLAUDE.md`, "Character fields (by vantage point)": one sentence — *generator-only directions (`CONVERSATIONAL_VOICE_DIRECTION`, `TRUST_SAFEGUARDS_DIRECTION`, `COMPANION_TRUST_DISPOSITION`, `COMMITTEE_DRIFT_GUARDRAIL`) live in `character-field-semantics.ts` and have no client mirror; every generator that writes a system prompt includes them.*
- `docs/CHANGELOG.md`: one `4.10-dev` entry per phase (plain voice).
- `.claude/commands/update-documentation.md`: a row for this spec.

## 13. Flagged for decision, and follow-ups

**Decided (2026-09-30, with the user):**

1. **OOC marking.** Template-agnostic wording everywhere: "in whatever out-of-character marking this conversation uses". No literal `((…))`, since the two built-in roleplay templates differ and users define their own.
2. **"Had not yet responded."** Confirmed as the substitute for the brief's "before the conversation ended" (§8.1).
3. **Relationship gating by inference**, default omit (§7.2 option 2). A selector stays a follow-up.
4. **Wizard / Summon word caps** rise from 500 to 600.
5. **MODERN_GENERAL gets no trust disposition.** Universal block only.
6. **Ollama gets the compact block** (C), not the full one.
7. **Turn race:** the trailing scene note ships in this spec; the server-side cure is a separate follow-up (§9.4).
8. **Per-line counterweight clauses** (§6.4) are in, alongside the new section.

**Checked, no action needed:** no safety or content-policy conflict was found. "Resist it in character" lines coexist with "narration is fact" because the first governs what happened, not what {{char}} does next (§5). The Concierge is provider-side and unaffected. No prompt has a length budget that U cannot fit.

**Follow-ups (separate specs, not blocking):**

- Cure the turn race server-side: abort on client stop, or snapshot-time `createdAt` (§9.4).
- Optimizer reads `partnerLinks` / `defaultPartnerId` to prefer the disposition when the data names the user persona (§7.2, option 1's cheap half).
- A "Relationship to {{user}}" selector on the Wizard and Summon From Lore if inference proves unreliable.
- Summon From Lore marks in-chat summons `npc:true` (observed in §4.2; unrelated to this spec but a one-line fix).
- A hash-based or versioned refresh for built-in prompts; today's equality compare is correct but opaque in the log.

## 14. Implementation order

Small commits, each shippable alone, each with its CHANGELOG line and help update:

1. **Sample prompts** — 21 `.md` edits per §6.2–6.4, plugin bump to 1.1.25 with `index.ts` fixed, `build:plugins`, the content test, `help/prompts.md`, plugin README.
2. **Generators** — the three constants; Wizard, Summon From Lore, Optimizer, External Prompt wiring; tests; the four help pages; CLAUDE.md sentence.
3. **Memory extraction** — renderer heading, SELF/OTHER sections and anchors, user-persona preamble, episode sentence, unit tests, the fixture, the opt-in eval; help pages.
4. **Narration anchor** — new module, `context-manager.ts` wiring, tests; `help/chat-multi-character.md`.
5. **Verify** — full `npm run test:unit`, `npx tsc`, `npm run lint`; run the §10.3 eval against V4test's cheap-LLM profile and record the pass rate in this document's "As built" section; attach the §10.4 rendered prompts.

## 15. As built (2026-10-01)

All four phases shipped as specified; the deviations and additions are below.

**Phase 1 — sample prompts.** All 21 files carry U (or C for Ollama), F, and the §6.4 counterweights; T is in every file except MODERN_GENERAL. Plugin 1.1.25, `index.ts` version fixed. Adaptations:

- Files written in second person (GPT5, GPT4O, GROK, MISTRAL, DeepSeek, Claude) got U and T in second person rather than U verbatim with `{{char}}`.
- Several romantic files had no "Endless agreement is not love." saint line (CLAUDE, GPT4O, GPT5, GROK, GEMINI, DEEPSEEK, MISTRAL, GENERIC romantic). The governance clause went on the nearest equivalent ("…is nobody. Nor is a partner who governs…", or the sentence added before it). Where a family's named T section does not exist in the romantic sibling, T ends the nearest equivalent ("How you are", "What makes you you", "The relationship").
- Ollama's consent bullet ends "— agreement is in plain words" and its T bullet ends "— trust in their judgment is the starting point", so the content test's phrases hold in the compact form. OLLAMA_ROMANTIC does not carry the household-split sentence.
- `__tests__/unit/plugins/default-system-prompts-content.test.ts` asserts §6.6 per file (140 cases).

**Phase 2 — generators.** Two extra exports beside the three constants: `COMPANION_TRUST_DISPOSITION_GATE` (the §7.2 gate sentence) and `GATED_COMPANION_TRUST_DISPOSITION` (gate + disposition), so the Wizard, Summon From Lore and External Prompt share one gated paragraph and the tests can check order. The optimizer's refine and new-prompt passes carry their own framing-based gate (§7.3) before the bare disposition. `SUGGESTION_SCHEMA_PREAMBLE`, `SYSTEM_PROMPTS_PROMPT` and `META_SYSTEM_PROMPT` are now exported for tests. The External Prompt meta-prompt also tells the model to name the person in plain words rather than leave a literal `{{user}}`, since external tools do not substitute placeholders.

**Phase 3 — memory extraction.** The AGREEMENTS section is one constant (`AGREEMENTS_INSTRUCTION_BLOCK`) interpolated into both bodies. The ordered heading is `ORDERED_TURN_TRANSCRIPT_HEADING`, exported. The bad-assent items are a second OTHER bad example rather than appended to the existing one, because that one's "Correct output: []" does not apply to them. The §10.2 fixture lives at `__tests__/unit/lib/fixtures/proposal-no-reply.ts`, not `__tests__/unit/lib/memory/fixtures/`: jest's `testMatch` treats every `.ts` under `__tests__/unit/` as a suite except that ignored directory. The unit regression is `lib/memory/cheap-llm-tasks/__tests__/memory-consent-regression.test.ts`.

**§10.3 eval.** `__tests__/eval/memory-consent/` is skipped unless `MEMORY_CONSENT_EVAL_MODEL` is set. It sends the real extractor prompts to any OpenAI-compatible endpoint (see its README) rather than going through a connection profile, so it runs without an instance. **Pass rate: not yet recorded** — the implementing session had no instance or API key. Run it against V4test's cheap-LLM model and record the result here.

**Phase 4 — narration anchor.** `lib/chat/context/user-narration-anchor.ts`. The caller (`context-builder.service.ts`) passes its existing `userTurnMessageIds` into `buildContext` as `humanTurnMessageIds`; the name is `userCharacter?.name || 'User'`, the same resolution `{{user}}` gets in the identity stack. A character line after the human's is recognised by role `assistant` or by a `participantId` that is not a human turn, because multi-character attribution re-roles other characters' replies to `user`.

**§10.4 review copies.** CLAUDE_COMPANION, DEEPSEEK_COMPANION and GENERIC_COMPANION were rendered through `processTemplate` (char Amy, user Owen) for a read-through; no placeholders survived.

**Verification.** `npx tsc` clean; `npm run lint` clean; `npm run test:unit` 925 suites / 13,893 tests passed (the eval suite skipped).
