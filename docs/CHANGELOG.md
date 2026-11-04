# Quilltap Changelog

## Recent Changes

### 4.13-dev

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
