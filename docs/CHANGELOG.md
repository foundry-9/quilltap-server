# Quilltap Changelog

## Recent Changes

### 4.13-dev

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
