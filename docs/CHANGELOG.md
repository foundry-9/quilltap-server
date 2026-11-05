# Quilltap Changelog

## Recent Changes

### 4.13-dev

#### Fix: OpenAI model fetch lists GPT-6 and later

- Fetch Models for OpenAI kept only IDs starting `gpt-4`, `gpt-5`, `o1`, `o3`, `o4`, so the gpt-6.x models never appeared. The reasoning-model and 24h cache-retention checks had the same hard-coded lists, so a hand-entered gpt-6 model would also have been sent `temperature` / `top_p`.
- The OpenAI plugin (1.0.69) now decides by family and version in `model-families.ts`: chat models are gpt-4 and later plus every o-series (gpt-3.5 drops out); reasoning models are gpt-5 and later plus every o-series; 24h retention is gpt-5.1 / 5.2 / 5.5 and every gpt-6+ model except `-chat-latest` aliases.
- Retention for unreleased models is a guess, so a 400 naming `prompt_cache_retention` is retried once without it instead of failing the turn.

#### Feature: Refine from Memories & Instructions

- The Character Optimizer ("Refine from Memories") is now "Refine from Memories & Instructions". The preflight form has an optional instructions textarea (up to 8,000 characters) and a "Consult the Commonplace Book" checkbox. A run can use memories, instructions, or both; it needs at least one.
- Instructions ride in the shared context of every pass (general fields, each scenario, each system prompt, physical description, wardrobe, aliases, new system prompts), so a requested change is applied wherever it applies. They win over conflicting memories, get significance ≥ 0.6, and never override the field vantage-point, form-of-address, trust-safeguard, or committee-drift rules.
- The analysis lists each change the instructions call for ("Author's instruction"). With no memories it is an instructions-only reading of the configuration.
- A run with instructions and too few reinforced memories continues on the instructions alone instead of stopping.
- `?action=optimize-stream` accepts `useMemories` (default true) and `instructions`. The vault suggestions file records the instructions and an `authorInstructions` frontmatter flag.

#### CI: restore the 8 GB heap for the coverage run

- `test:coverage` again passes `--max-old-space-size=8192` to the Jest parent. 4.12.1 added the flag, but the merge back into main dropped it, and every CI test run since hit the default 4 GB heap and aborted (exit 134).

#### Fix: story characters no longer invent where the user is

- In the live evaluation, characters decided the operator's persona had gone to the boathouse and planned around it for several turns.
- Every story sample prompt (plugin 1.1.33) now forbids filling a gap by deciding where the user is or what they did off-screen; characters may wonder aloud, call out, or go and look. MODERN Roleplay states it under "Whose story it is" and names "the invented absence" as a failure mode. MODERN Assistant is unchanged.
- The stakes direction used by the AI Wizard, Summon From Lore, Character Optimizer and External Prompt generator carries the same rule.
- Rerun with fresh characters: no invented errands; characters still sometimes assumed the user was present in the scene. Details in §12 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

#### Docs: live evaluation of the roleplay defaults

- Rebuilt the 2026-11-03 armed-intruder scene in V4test with synthetic characters and ran it with old-style and new prompts on DeepSeek V4 Flash and GLM 5.3 Flash. Results and method are in §12 (phase 6) of `docs/developer/features/character-kind-and-roleplay-defaults.md`, now marked implemented.
- The doorkeeper with an old-style "never tense / hostility makes you calmer" prompt reproduced the incident (offered the gunman a tour of the house); the same character with a new Wizard prompt blocked him and showed fear. A quiet scene stayed quiet.
- Follow-ups noted: characters invented the operator persona's off-screen whereabouts, and new-prompt replies ran about 65% longer.

#### Feature: group scenes need not agree; informs carry feelings

- The group-scene rules every speaker in a multi-character chat receives now say the cast does not have to agree: if the others took the measured view, a character may respond with fear, anger, or action, and should never take a position only because everyone else has.
- The inform header now reads "Things now true in this story and in you, as of this moment — what has happened, what you know, and how you feel or what you have resolved. Where any of it conflicts with an older memory, your records, or your usual temperament, this is the current truth:". Informs like "You are very alarmed" were previously filed as facts and outweighed by the character's usual calm.
- Amendment note added to `docs/developer/features/complete/salon-inform.md`. Phase 5 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

#### Feature: prompt generators follow the character's kind

- The AI Wizard, Summon From Lore, Character Optimizer and External Prompt generator now add a kind-specific direction when they write a system prompt. Roleplay characters get a stakes direction: react to danger, loss or outrage at full size, and never write temperament as an absolute ("never tense", "always calm"). Assistants get a task direction: accuracy, no invented facts, opinions once, no padding.
- Generators read the character's stored kind. A new or summoned character is roleplay. They never guess the kind from source material, since household staff read as assistants to a model.
- The Character Optimizer now treats "flattening" in a roleplay character's memories (meeting danger with small-talk calm) as drift to correct, and proposes replacing absolute temperament rules in the prompt. Assistants are not checked for it.
- Fix: the AI Wizard's system-prompt field now has a 2,500-token completion budget (was 1,000, shared with example dialogues and first message). Reasoning models spent part of the old budget thinking and returned prompts cut off mid-sentence.
- The External Prompt generator's `META_SYSTEM_PROMPT` constant is now `buildMetaSystemPrompt(kind)`; the Wizard's system-prompt meta-prompt is `buildSystemPromptFieldPrompt(kind)`.
- Phase 4 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

#### Feature: roleplay and assistant sample prompts; every story prompt matches the stakes

- New sample prompts in the default-system-prompts plugin (1.1.32): **MODERN Roleplay**, the recommended default for roleplay characters (a person inside a story with stakes; adds sections on reacting to danger and on group scenes, and the "flattening" and "mediator" failure modes), and **MODERN Assistant**, for characters whose job is doing work for the user.
- **MODERN General** is retired. Seeding now deletes built-in prompt rows the plugin no longer ships, but only after a registry seed that returned at least one prompt; user copies are never touched.
- Every companion, romantic and platonic sample gains a short "match the stakes" passage: ordinary days stay ordinary, real danger gets real fear, anger or action, and a character's usual temperament is not a vow.
- DeepSeek's style governors are now "match the stakes". They still limit purple prose and metaphor but no longer tell the character to keep the story small.
- Phase 3 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

#### Feature: Agent Mode and tool rules follow the character's kind

- Agent Mode now has two flavors, chosen by the responding character's kind; the settings cascade still decides only whether it is on.
  - Roleplay characters get "in-character" Agent Mode: tools are things they do in the scene, the turn is still written in character as prose, and they are never offered `submit_final_response`. At the step limit they are told to stop using tools and write the turn.
  - Assistant characters get the existing research loop, unchanged.
- The native tool-rules preamble follows the kind too. Roleplay characters get "## Using tools", which no longer claims to override the character; assistants keep "Tool Execution Rules (MANDATORY — overrides all other behavioral patterns)". The six rules are identical in both.
- The Brahma Console, Help chat and one-shot loops always use the research flavor and the assistant preamble.
- Text-block and simple-JSON tool instructions are unchanged.
- Phase 2 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

#### Feature: character kind (roleplay or assistant)

- Every character now has a kind: `roleplay` (default) or `assistant`. Stored as `kind` in the character vault's `properties.json`; an absent or unrecognized value reads as `roleplay`, so existing characters need no migration.
- Set on a new "Kind of character" card on the Details tab of the character view and edit pages, saved on change. Accepted by `PUT /api/v1/characters/[id]` and returned by `GET /api/v1/characters`. Documented in `qtap-export.schema.json`; export and import carry it with the character.
- Read only through `lib/characters/kind.ts`; a grep-test fails on hand comparisons against a kind literal elsewhere.
- Phase 1 of `docs/developer/features/character-kind-and-roleplay-defaults.md`; the spec now stores kind in the vault instead of the DB column it first proposed.

#### Docs: design spec for character kind and roleplay defaults

- New `docs/developer/features/character-kind-and-roleplay-defaults.md`. Proposed, not implemented.
- Diagnosis: in two Friday chats (2026-11-03) every LLM character met an armed intruder with calm negotiation. Request logs trace it to companion-framed stock prompts, anti-escalation governors in the DeepSeek and MODERN General prompts, absolute temperament rules in generated prompts, assistant-style Agent Mode and tool-rule text, a fact-only inform header, and group scenes converging on one stance.
- Plan: a per-character `kind` (`roleplay` default, or `assistant`) read through one resolver; two Agent Mode flavours (research, in-character); a kind-aware tool-rules preamble; new MODERN Roleplay and MODERN Assistant sample prompts; a stakes direction for every prompt generator; a group-scene bullet against converging on one stance.
- Decisions recorded: the inform header is reworded to cover feeling and resolve (D2), and MODERN General is retired with a guarded prune of built-in prompt rows that are no longer shipped (D1).

### 4.12.1

#### Fixed: dated searches look at the period first, and an empty search says what it means

- A `search` with `since`/`until` (and a retrospective turn's recall) now reads the period's memories by event time in SQL (`MemoriesRepository.findIdsInEventWindow`) and scores them through the same index restricted to those ids (`memoryIndex.search` `includeIds`), so they join the candidate pool before the cut. Previously the window was applied to a pool already chosen from all time, so a dated question about a recurring place returned nothing. New `HitSource` `'window'`; the `gather` trace stage records `window` / `windowAdded`.
- On the tool path, a window of 14 days or less (`TOOL_WINDOW_FLOOR_MAX_DAYS`) is its own relevance filter: in-window memories and conversation chunks skip the cosine floor. Wider windows and the per-turn prompt path keep the floor.
- Conversation search takes `chatIds`; with a window, the tool restricts the chunk search to the period's chats (`findChatsInWindow`, `lib/scriptorium/chat-window.ts`) instead of filtering the all-time top-K afterwards. A chat's span is `createdAt` to `lastMessageAt`, not `updatedAt`. `searchConversationChunks` now honours an explicit `minScore: 0`.
- When `since`/`until` is given and `sources` is omitted, only memories and conversations are searched (conversations alone on the Brahma Console).
- The tool result carries a `windowCensus` (memories dated in the window, the conversations the character took part in during it, the current chat left out). An empty result now says whether nothing matched the words or nothing happened in the period, and names the period's conversations; non-empty dated results gain a footer listing them.
- Standing tool instructions (native and simple-JSON) now tell the character to read a listed conversation before saying it does not recall.
- The retrospective mini-recap lists in-window chats that have no vault summary yet, from the `chats` table. `VaultConversationMatch.relativePath` is now nullable.
- Undated searches and turns without a resolved time window are unchanged. No schema or export change.
- Spec: `docs/developer/features/complete/search-window-first-and-honest-empty.md`.

#### CI: coverage run heap

- CI: the coverage run (`npm run test:coverage`) now gives the Jest parent process an 8 GB heap. With the v8 coverage provider, every worker ships the coverage, original source and transformed source of each module it loaded back to the parent, which holds all of it until the run ends; at ~1,300 test files that passed the default ~4 GB limit and the Test job died with "JavaScript heap out of memory" after the last suite.
