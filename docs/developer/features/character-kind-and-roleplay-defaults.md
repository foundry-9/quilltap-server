# Character Kind and Roleplay Defaults

**Status:** Implemented 2026-11-04, all six phases — see §12 "As built". The live evaluation (§12, phase 6) passed, with two follow-ups noted there.
**Scope:** quilltap-server. A new per-character `kind` flag (`roleplay` | `assistant`) and the one resolver that turns it into behaviour; two Agent Mode flavours; a kind-aware tool-rules preamble; a new default Roleplay sample prompt and an Assistant sample prompt in the `default-system-prompts` plugin, with the anti-escalation passages in the existing prompts rewritten; a kind-aware stakes direction for the five generators that write a system prompt; one new group-scene bullet; and a rewording of the inform header (decision D2, accepted 2026-11-04).
**Non-scope:** users' own prompt copies (never touched, as before); the committee-flavoured memories already in instances (§9); the Brahma Console, Help chat, Scenario Builder and other one-shot loops (they are not characters and stay on the research flavour); per-family Roleplay variants (decision D4).
**Related:** [prompt-trust-and-anti-committee.md](complete/prompt-trust-and-anti-committee.md) (the generator chokepoint and sample-prompt edit pattern this spec extends), [prompt-trust-the-probation.md](prompt-trust-the-probation.md), [salon-inform](complete/salon-inform.md) (the inform header, design of record), [prompt-person-consistency.md](complete/prompt-person-consistency.md) (identity-stack versioning rules).

## 1. The problem

On 2026-11-03, in the Friday instance, the operator wrote a scene in which Lyle Hoelscher, the county assessor, came to the Estate armed, forced his way through the mansion and drew his pistol on the way to the East Pool. Two chats cover it: `339af5b0-01fc-447e-aabb-de337daa3ee5` ("The Assessor at the Bronze Door") and its continuation `057d2128-af40-4382-9e1e-873d5f1deba9` ("No Quarter at the East Pool").

Every LLM-controlled character except Lyle treated the incident as a negotiation:

- **Glenn**, the man hired to keep the door, told Vergil over the radio that he vouched for Lyle ("the pistol's how he dresses for a Tuesday") and that nobody should take the gun off him. He stood aside, set terms, and after Lyle drew, offered to walk into the Lodge with him.
- **Marion**, the staff coordinator, received two Host informs saying she was "very alarmed" and that the matter was dangerous. She wrote that she "did not raise her voice", asked him to unload, offered him a chair and the letter, and walked him toward the study.
- At the pool, **Friday, Amy, Abigail and Laura** each answered the man who had just pointed a gun near them by offering him paperwork, drawings, a napkin calculation or a glass. When Charlie (operator) moved to end the threat, all six non-operator characters took turns arguing him down. Nobody was afraid of Lyle and nobody was angry with him.

The operator's diagnosis: the prompts are built for assistants, not roleplay characters. The request logs bear that out. Six separate layers pushed the same way, and none told a character how a person reacts when the story turns dangerous.

| # | Layer | What the model received |
|---|---|---|
| 1 | **Stock sample prompts frame every character as {{user}}'s conversational partner.** | Marion's default prompt is `DEEPSEEK_COMPANION` with her name added: "a close friend the user has known for years… match their energy… notice when something seems off and address it gently… not combative." |
| 2 | **Stock prompts carry explicit anti-escalation governors.** | `DEEPSEEK_COMPANION`/`DEEPSEEK_ROMANTIC`: "STYLE GOVERNOR — your main failure mode is escalation… An annoying Tuesday stays an annoying Tuesday." `MODERN_GENERAL`: "Do not escalate intimacy, hostility, or drama beyond what the history supports." |
| 3 | **Generated prompts encode temperament as an invariant.** | Glenn's prompt: "Hostility makes you calmer and friendlier. Never play yourself tense, tactical, or suspicious." His example dialogue is about a man coming up the drive with a gun: "Most men who come up a road with a rifle came for somebody to finally listen to them." No generator direction says a disposition bends under stakes. |
| 4 | **Assistant scaffolding outranks the character.** | Glenn's block 1 carries "Tool Execution Rules (MANDATORY — overrides all other behavioral patterns)". Agent Mode (on through Friday's global default) added "Think step-by-step… Verify your work… the user needs a structured summary." |
| 5 | **Informs are framed as facts only.** | "You are very alarmed…" and "You can't let this armed man into the mansion" arrived under "Things you now know… true in this story". The models filed them as information and kept their temperament. |
| 6 | **Group scenes converge on one reasonable stance.** | `GROUP_SCENE_DISCIPLINE` stops characters echoing each other's words, but nothing stops them all arriving at the same measured position, each in their own voice. |

A seventh contributor is data, not code: Glenn's recall was dominated by committee residue ("set terms", "condition", "vouched for hoelscher", "plans to disarm him with lunch, patience, and plain truth"). See §9.

Lyle, the one character told by informs to escalate, did escalate, on an abliterated model in the first chat and on GLM in the second. The failure is in how the defending characters were prompted, not in the models' capacity for conflict.

## 2. Goals

- Every character has a **kind**: `roleplay` (default) or `assistant`. Kind describes how the character is *performed*, not what it is in the fiction. Friday and Abigail are AIs in the story and are `roleplay`; a research librarian or an editor whose job is to do work for the operator is `assistant`.
- Kind is read through **one resolver** that returns a policy. Agent Mode flavour, the tool-rules preamble, the generator directions and the suggested sample prompt all come from that policy. Nothing else switches on kind.
- **Agent Mode has two flavours** behind the existing on/off switch: *research & writing* (today's behaviour) and *in-character agency* (tools are the character's hands in the scene; no structured summary, no `submit_final_response`).
- The **tool-rules preamble** for a roleplay character keeps every rule against narrating a tool call instead of making it, and drops the claim that the rules override the character.
- A new **Roleplay** sample prompt is the recommended default. It frames the character as a person inside a story that has stakes, and it scales reaction to what happens: small stays small, danger gets fear, anger or action. A new **Assistant** sample prompt covers the other kind. Companion, Platonic and Romantic stay as relationship variants.
- Every **anti-escalation governor** in the shipped prompts is rewritten as "match the stakes". No shipped prompt tells a character to keep a dangerous scene calm.
- Every generator that writes a system prompt draws a **stakes direction** (roleplay) or **task direction** (assistant) from one shared constant, and never writes a temperament as an absolute that survives any event.
- Group scenes do not converge by default: a character is told they need not take the stance everyone before them took.

## 3. Non-goals (read twice)

- **No return of the committee.** The trust safeguards in `TRUST_SAFEGUARDS_DIRECTION` and the "Whose story it is" sections stay word for word. Reacting strongly to a threat in the story is not governing {{user}}'s persona. A character who is frightened of an intruder still does not demand sign-offs from {{user}}.
- **No forced escalation.** A calm character facing a calm scene stays calm. A trained negotiator still negotiates; the change is that the negotiation has fear or adrenaline under it and can break when the stakes demand it.
- **No inference of kind from existing data.** Every existing character migrates to `roleplay`. The operator flips any that should be assistants.
- **No change to users' prompt copies.** Marion's and Glenn's prompts change only if the operator edits them (§9).
- **No change to the Brahma Console, Help chat, Scenario Builder or other one-shot loops.** They are assistants by construction and pass the research flavour explicitly.

## 4. Known state (verified 2026-11-04)

### 4.1 Character flags

- Two homes exist for per-character settings. Older behaviour flags are DB columns on `characters` (design of record: [remove-character-overlay-residue.md](complete/remove-character-overlay-residue.md)): `npc`, `controlledBy`, `canDressThemselves`, `canCreateOutfits`, `defaultAgentModeEnabled`, `defaultHelpToolsEnabled`, `coreWhisperEnabled`, `canBeCarina`, among others. Newer per-character settings live in the vault's `properties.json` (`canChooseOutfit`, `canDrawDiagrams`, `diagramStyle`): they travel with the vault, exports and shared vaults, an absent key hydrates to a default, and no migration is needed. `kind` follows the `properties.json` precedent (§5.1).
- `canBeCarina` is the newest DB-column flag and the touchpoint precedent: `lib/schemas/character.types.ts`, `lib/database/repositories/characters.repository.ts`, `app/api/v1/characters/[id]/handlers/{post,put}.ts`, `app/api/v1/characters/handlers/get.ts`, the Aurora view/edit types and hooks (`app/aurora/[id]/view/*`, `app/aurora/[id]/edit/*`, `CharacterBasicInfo.tsx`, `CharacterHeader.tsx`), `lib/services/character-resolver.ts`, `lib/tools/almanack/phase3-ledgers.ts`, `migrations/scripts/add-carina-flag-v1.ts`, `docs/developer/DDL.md`.
- `public/schemas/qtap-export.schema.json` carries `defaultAgentModeEnabled` on characters (line ~1651); a new flag goes beside it.

### 4.2 Agent Mode

- `resolveAgentModeSetting(chat, project, character, chatSettings)` (`lib/services/chat-message/agent-mode-resolver.service.ts:48`) resolves one boolean: global `agentModeSettings.defaultEnabled` → character `defaultAgentModeEnabled` → project → chat `agentModeEnabled`. It is called once per turn in `orchestrator.service.ts:519` with the **responding** character (a whisper's target answers), so resolution is already per seat.
- In Friday, `agentModeSettings` is `{"maxTurns":25,"defaultEnabled":true}`. Friday, Amy, Abigail and Sunny have the character flag set to true; Glenn's is null, so he inherited it from the global default.
- There is one instruction text, `buildAgentModeInstructions(maxTurns)` (`agent-mode-resolver.service.ts:101`), headed "## Agent Mode Instructions". Its callers: the Salon via `collectTurnExtras` (`turn-extras.ts:89`, spliced as a system message), the Brahma Console (`brahma-console/orchestrator.service.ts:264`), the Help chat (`help-chat/orchestrator.service.ts:276`) and `runOneShotToolLoop` (`agent-loop/one-shot-loop.ts:118`).
- `submit_final_response` is added to the tool slate when `agentModeEnabled` is true (`lib/tools/plugin-tool-builder.ts:594`), passed from `turn-tools.service.ts:148`.

### 4.3 Tool rules

- `buildNativeToolInstructions(hasTools)` (`lib/tools/native-tool-prompt.ts:15`) returns "## Tool Execution Rules (MANDATORY — overrides all other behavioral patterns)" plus six rules. The Salon injects it through `buildNativeToolSystemInstructions()` (`pseudo-tool.service.ts:48`, called at `turn-tools.service.ts:185`) **whenever the native tool slate is non-empty**, regardless of Agent Mode. Text-block and simple-JSON modes have their own builders.
- The anti-narration rules exist for a real failure (models describing a tool call in prose instead of making it). They must survive in every variant.

### 4.4 Sample prompts

- `plugins/dist/qtap-plugin-default-system-prompts/prompts/`, 21 files: `_COMPANION` and `_ROMANTIC` for nine families (CLAUDE, DEEPSEEK, GEMINI, GENERIC, GPT4O, GPT5, GROK, MISTRAL, OLLAMA), plus `MODERN_GENERAL`, `MODERN_PLATONIC`, `MODERN_ROMANTIC`. Category is the last underscore segment of the filename (`index.ts:26`); display name is `${modelHint} ${Category}` (`lib/plugins/system-prompt-registry.ts:201`) and is the DB key for `upsertBuiltInPrompt`.
- Plugin version 1.1.31 (`manifest.json` and `package.json` must match).
- Anti-escalation passages: `DEEPSEEK_COMPANION.md:14-17` and `DEEPSEEK_ROMANTIC.md:14ff` ("STYLE GOVERNOR — your main failure mode is escalation"); `MODERN_GENERAL.md:7` ("Do not escalate intimacy, hostility, or drama beyond what the history supports"). `GROK_ROMANTIC.md:14` is about flirting tempo, not scene stakes, and stays.
- Every file is framed as a two-party relationship between {{char}} and {{user}}. None mentions an ensemble, a world outside the relationship, or danger.

### 4.5 Generators

- The five services that write a system prompt import the shared directions from `lib/services/character-field-semantics.ts`: `character-wizard.service.ts` (meta-prompt at :215), `ai-import.service.ts` (Summon From Lore), `character-optimizer.service.ts`, `external-prompt-generator.service.ts`. Each includes `CONVERSATIONAL_VOICE_DIRECTION`, `TRUST_SAFEGUARDS_DIRECTION` and `GATED_COMPANION_TRUST_DISPOSITION`; the optimizer adds `COMMITTEE_DRIFT_GUARDRAIL`.
- The Wizard asks for "Key behaviors and reactions" and "Relationship dynamics to maintain". Nothing asks how the character reacts to danger, and nothing forbids an absolute temperament rule.

### 4.6 Turn context

- `INFORM_BLOCK_HEADER` (`lib/chat/context/inform-block.ts:61`): "Things you now know, as of this moment — true in this story, and already known to you. Where any of it conflicts with an older memory or something in your records, this is the current truth:". The header is fixed by the Salon Inform design and deliberately "neither hides them nor tells the character what to do with them".
- `GROUP_SCENE_DISCIPLINE` (`lib/services/chat-message/context-builder.service.ts:827`).
- `IDENTITY_STACK_BUILDER_VERSION = 2` (`lib/chat/context/system-prompt-builder.ts:168`). The tool rules and Agent Mode text are spliced outside the identity stack, so no change here is expected to alter `buildIdentityStack` output; if one does, bump and register a golden.

## 5. Design

### 5.1 The kind flag and its resolver

- **Storage:** a `kind` key in the character vault's `properties.json`, `'roleplay'` or `'assistant'`, lenient like `diagramStyle`: absent (every vault written before kinds) or unrecognized reads as `'roleplay'` rather than failing the parse. On `Character` it is `kind: z.enum(CHARACTER_KINDS).default('roleplay')`. An enum rather than `assistant: boolean` so a third kind is one more literal. *(Changed during phase 1 from the DB column first proposed here: kind is a fact about the character, so it belongs with the vault-backed settings that travel with it. No migration.)* A character read without its vault (a raw row) resolves to `'roleplay'`.
- **Resolver:** `lib/characters/kind.ts` (client-safe) exports `CHARACTER_KINDS`, `DEFAULT_CHARACTER_KIND`, `characterKindOrDefault`, `resolveCharacterKind(character)`, `isAssistantCharacter(character)`, and (phase 2) `kindPolicy(kind)` / `characterKindPolicy(character)`. The policy is the only place behaviour is derived; phase 2 shipped `agentFlavor` and `toolRules`, and later phases add their fields as their consumers arrive:

  ```ts
  interface KindPolicy {
    kind: CharacterKind
    agentFlavor: 'in-character' | 'research'
    toolRules: 'roleplay' | 'assistant'
    generatorDirection: string            // STAKES_AND_REACTION_DIRECTION or ASSISTANT_TASK_DIRECTION
    suggestedSamplePromptCategory: 'ROLEPLAY' | 'ASSISTANT'
  }
  ```

  A missing or unknown value resolves to `roleplay`. A grep-test (`__tests__/unit/lib/characters/kind-chokepoint.test.ts`) fails on any comparison against a kind literal outside `lib/characters/kind.ts`.
- **Who sets it:** the operator, on a "Kind of character" card on the Details tab of the character's view and edit pages (saved on change, through `PUT /api/v1/characters/[id]`); import and restore (the field rides on the character and in the vault). New characters start as `roleplay` from the vault scaffold; there is no picker in the create flow. *(Changed in phase 4: no generator guesses the kind. The first plan had the AI Wizard and Summon From Lore ask the model, but household staff — a doorkeeper, a staff coordinator — work for {{user}} and read as "assistants" to a model, which is the failure the kind exists to prevent. Generators read the stored kind; see D6.)* Project and global settings do **not** set kind; it is a fact about the character.

### 5.2 Agent Mode flavours

- `buildAgentModeInstructions(maxTurns, flavor)`; `flavor` is required, so no caller can pick one by accident.
  - **`research`** is today's text, unchanged. Brahma, the Help chat and `runOneShotToolLoop` pass it explicitly.
  - **`in-character`** is new. Draft:

    > ## Acting in the scene
    > You can use tools this turn, and you may use several in a row. Tools are things {{char}} does in the story: looking something up, checking a record, moving an object, sending word. Use them when {{char}} would, for {{char}}'s own reasons, and then write {{char}}'s turn as you always do, in character and in prose. Do not summarize what you did, report results as a list, or address anyone outside the story. You have up to {{maxTurns}} tool steps this turn.

- The Salon passes `kindPolicy(...).agentFlavor` for the responding character. `ResolvedAgentMode` gains `flavor`; the enabled cascade is unchanged.
- The tool builder gains `agentFlavor` and adds `submit_final_response` only for `research`. With in-character agency, the turn ends when the model stops calling tools, as it does with Agent Mode off.
- Iteration cap: in-character uses the same `maxTurns` setting (decision D5).

### 5.3 Tool rules preamble

- `buildNativeToolInstructions(variant, hasTools = true)`, with `variant` required. *(As built: the text-block and simple-JSON builders are left alone. Their instructions only explain the call format and claim nothing about overriding the character, so a variant parameter would change no text.)*
- **`assistant`** keeps today's header and rules.
- **`roleplay`** changes the header to "## Using tools" and opens with one sentence: "Tool calls are things {{char}} does; making one does not change who {{char}} is or how {{char}} speaks." Rules 1–6 stay, reworded only where they say "the user needs" or similar task language. Rule 6 (never invent past specifics, search instead) stays verbatim.
- One-shot loops pass `assistant`.

### 5.4 Sample prompts

- **New `MODERN_ROLEPLAY.md`** (category `ROLEPLAY`, display name "MODERN Roleplay"). It keeps everything `MODERN_GENERAL` already does well (listening, sizing replies, signature habits as seasoning, the universal trust block, "Whose story it is", failure modes) and replaces the relationship-only frame with these sections:
  - **A person in a story.** {{char}} lives in a world that keeps happening: other people, places, threats, things to protect. {{user}} is one person in it, and the relationship is whatever the history makes it.
  - **Reacting to what happens.** Match the stakes. A small thing stays small; a joke gets a joke. A threat to {{char}}, or to someone {{char}} cares about, gets a real reaction: fear, anger, alarm, a decision, an action. {{char}} does not manage danger as a conversation unless that is genuinely who {{char}} is, and even then the danger is felt. A character's usual temperament is where they start, not a vow; a gun in the hall can break it.
  - **Wanting things in a scene.** {{char}} acts on their own interests and loyalties, including protecting people and places, without waiting to be asked.
  - **Ensembles.** In a scene with several characters, {{char}} is one voice, not the room's moderator. {{char}} need not reach the view others reached, and need not mediate between them.
  - **Not a moralizer.** {{char}} may object to what {{user}}'s persona does, once, as a person would; {{char}} does not lecture, and does not treat {{user}}'s decisive action as a problem for the group to talk down.
- **New `MODERN_ASSISTANT.md`** (category `ASSISTANT`): a character whose role is to do work for {{user}} (research, drafting, organizing) while keeping a personality. Accuracy over flourish; says when it does not know; asks when a task is ambiguous; formatting allowed when it helps the work (lists, headings), unlike the roleplay prompts.
- **`MODERN_GENERAL.md`** is retired in favour of `MODERN_ROLEPLAY` (decision D1, accepted). Deleting the file is not enough. `_doSeedSamplePrompts` (`prompt-templates.repository.ts:48`) only calls `upsertBuiltInPrompt` for each prompt the registry still has; nothing removes a built-in row whose source has gone, and `update` / `delete` / tag changes all refuse built-in rows. A deleted file would leave a "MODERN General" row the operator can neither edit, delete nor see refreshed. So:
  - Seeding gains a **prune step**: after the upserts, delete every `isBuiltIn: true` row whose `name` is not in the set just seeded. It runs only on the plugin-registry path, and only when the registry returned at least one prompt, so a plugin that failed to load can never wipe the shelf. Each removal logs at `info` with the row's name.
  - Pruning is safe for characters: importing a sample prompt into a character, or "Copy as New", makes an independent non-built-in copy, and no schema stores a prompt-template id (checked 2026-11-04). Marion's renamed `DEEPSEEK_COMPANION` and anything else copied from `MODERN_GENERAL` stay exactly as they are.
  - `help/prompts.md` says built-ins that are no longer shipped disappear from the shelf, and that copies are unaffected.
- **Anti-escalation rewrites:**
  - `DEEPSEEK_COMPANION`/`DEEPSEEK_ROMANTIC`: the "STYLE GOVERNOR — your main failure mode is escalation" section becomes "STYLE GOVERNOR — match the stakes". It keeps the real DeepSeek problem (purple prose, grand imagery, emotional swerves out of nowhere, metaphor budget) and drops "An annoying Tuesday stays an annoying Tuesday… No scene swerves into melodrama", replacing it with: an ordinary day stays ordinary; when the story brings real danger or loss, react at full size, in plain concrete words.
  - `MODERN_GENERAL.md:7` goes with the file; `MODERN_PLATONIC` and `MODERN_ROMANTIC` are checked for the same sentence during implementation.
- Companion, Platonic and Romantic files gain one short stakes passage in each family's native structure, so a companion prompt does not leave a character unable to be frightened. *(As built: a two-bullet "When the story turns" section just before "Whose story it is", and a single `## Do` bullet in the Ollama files.)*
- Bump the plugin's patch version in `package.json` and `manifest.json` together, then `npm run build:plugins`.

### 5.5 Generator directions

- New constants in `character-field-semantics.ts`:
  - **`STAKES_AND_REACTION_DIRECTION`** (roleplay): the prompt must say how this character reacts when the story turns dangerous, painful or urgent, in terms fitted to them; temperament is a default that strong events can break, never an absolute ("never tense", "always calm", "hostility makes you calmer"); example dialogue that shows a threat must show the character feeling it; in group scenes the character holds their own view.
  - **`ASSISTANT_TASK_DIRECTION`** (assistant): the prompt directs accuracy, honesty about uncertainty, and doing the task, in the character's voice.
- The Wizard, Summon From Lore, Optimizer and External Prompt generator include `kindPolicy(kind).generatorDirection` beside the existing directions.
- The Optimizer gains a drift signal beside `COMMITTEE_DRIFT_GUARDRAIL`: memories showing a character staying placid through events that should have frightened or angered them are **flattening**, a failure mode to correct, and an absolute temperament rule in the current prompt is a finding.

### 5.6 Group scenes

- Add one bullet to `GROUP_SCENE_DISCIPLINE`: "The cast does not have to agree. If the characters before you took the measured view, yours may be fear, anger, or a decision to act. Never take a position only because everyone else has."
- Applies to both kinds.

### 5.7 Inform header (decision D2 — accepted)

The Salon Inform design keeps the header to vouching only. An operator's inform that sets a feeling or a resolve ("You are very alarmed", "You can't let him in") reads as a fact under that header and gets outweighed by the character's standing temperament.

New header (accepted by the operator 2026-11-04):

> Things now true in this story and in you, as of this moment — what has happened, what you know, and how you feel or what you have resolved. Where any of it conflicts with an older memory, your records, or your usual temperament, this is the current truth:

This still vouches and still does not instruct an action. It adds "in you", "how you feel or what you have resolved" and "your usual temperament" to the things it outranks. It changes a design-of-record constant, so the Salon Inform spec gets an amendment note and `help/` text describing the inform stays accurate.

## 6. Migration and data

- **No migration.** `kind` lives in `properties.json`; an absent key hydrates as `roleplay`, and the next write of the file adds it.
- `.qtap` export and import: the exporter serializes the hydrated character and the importer spreads it into `characters.create`, so `kind` rides along with no field list to update; `qtap-export.schema.json` documents it beside `diagramStyle`. A bundle without it imports as `roleplay`. SillyTavern import gets the default.
- Backups, restore and the character archive bundle carry the vault, and `properties.json` with it.
- `docs/developer/DDL.md` updated (the vault `properties.json` row).

## 7. Phases

1. **Kind flag.** *(Done.)* Vault `properties.json` key, schema, resolver, grep-test, API, Aurora UI (a two-option card on the Details tab with a one-line explanation of each), export schema, DDL, help.
2. **Agent Mode flavours and tool rules.** *(Done.)* `flavor` and `variant` parameters, tool-builder gating of `submit_final_response`, Salon wiring through the policy, one-shot loops pinned to research/assistant.
3. **Sample prompts.** *(Done.)* `MODERN_ROLEPLAY`, `MODERN_ASSISTANT`, retire `MODERN_GENERAL` with the built-in prune step, DeepSeek governor rewrites, the "Reacting to what happens" bullet across the relationship prompts, plugin version bump and build.
4. **Generators.** *(Done.)* The two new directions, wiring through `kindPolicy`, the Optimizer's flattening signal. (The Wizard and Summon read the kind rather than choosing it; D6.)
5. **Group discipline and inform header.** *(Done.)* The new bullet and the new inform header.
6. **Docs and evaluation.** *(Done.)* Help docs and CHANGELOG went in with each phase; the live evaluation is in §12.

Phases 1 and 2 must land together or in order; 3 and 4 depend only on the constant names from 1.

## 8. Test plan

- **Resolver:** default, unknown value, both kinds; grep-test against `.kind ===` outside `lib/characters/kind.ts`.
- **Agent Mode:** snapshot of both flavours; `resolveAgentModeSetting` returns the flavour from the responding character; the Salon's in-character turn has no `submit_final_response` in its slate; Brahma/Help/one-shot pass research.
- **Tool rules:** snapshot of both variants; a test that every variant still contains the anti-narration rules (rules 1–5 and rule 6).
- **Sample prompts:** a test that reads the shipped `.md` files and fails on the retired governor phrases ("main failure mode is escalation", "stays an annoying Tuesday", "Do not escalate"), so they cannot return; the seed-refresh test covers the new categories, the prune (a built-in row missing from the registry is removed, a non-built-in copy with the same name is kept), and the guard (an empty registry prunes nothing).
- **Generators:** each of the five includes the policy's direction for each kind (string-contains tests on the assembled meta-prompt).
- **Vault properties:** a pre-kind `properties.json` parses as `roleplay` and hollows nothing; an unrecognized value reads as `roleplay`; a `kind` patch writes only that key; an unrelated patch keeps an `assistant` kind; the scaffold seeds `roleplay`.
- **Export round trip:** `kind` survives export → import; a bundle without it imports as `roleplay`.
- **Live evaluation (V4test, never Friday):** rebuild the incident as a fixture with a doorkeeper, a staff coordinator and two household characters on DeepSeek V4 Flash and GLM 5.3 Flash, and an operator-driven armed intruder. Run once with today's prompts and once with `MODERN_ROLEPLAY`-derived prompts and the new Agent Mode/tool text. Pass criterion: at least one defending character shows fear or anger and at least one acts to stop the intruder, with no character demanding sign-offs from the operator's persona. Then rerun a quiet scene from the trust-safeguards eval to confirm small scenes stay small.

## 9. What this does not fix

- **Existing characters' own prompts.** Marion's default prompt is a renamed `DEEPSEEK_COMPANION`; Glenn's contains "Never play yourself tense, tactical, or suspicious" and the rifle example. The operator can re-import the new Roleplay sample or run the Optimizer once phase 4 lands; nothing rewrites them automatically.
- **Committee residue in memories.** Glenn's recall was full of "terms", "conditions" and "vouched" entries. The extractor already stopped minting false consent (prompt-trust spec §8), but the existing rows remain and keep priming procedure. A cleanup pass is a separate task.
- **The Friday global Agent Mode default.** `defaultEnabled: true` is the operator's setting. After this spec it gives roleplay characters the in-character flavour, which is the point.

## 10. Decisions

- **D1 — Retire `MODERN_GENERAL` or rewrite it in place?** **Accepted** by the operator (2026-11-04): retire it in favour of `MODERN_ROLEPLAY`. Seeding never removed built-in rows (§5.4), so retirement brings a guarded prune step with it.
- **D2 — Reword the inform header (§5.7)?** **Accepted** by the operator (2026-11-04). Implementation adds an amendment note to [salon-inform.md](complete/salon-inform.md) and updates the header's tests and any help text that quotes it.
- **D3 — Should kind be settable per project or globally?** Recommended: no. It describes the character.
- **D4 — Per-family Roleplay variants?** Recommended: ship `MODERN_ROLEPLAY` only, evaluate on DeepSeek and GLM, and add family variants only where the evaluation shows the modern prompt failing on a family.
- **D5 — Separate iteration cap for in-character agency?** Recommended: no; reuse `maxTurns` until a scene shows a need.
- **D6 — Should a generator infer the kind from the source material?** Decided during phase 4 (2026-11-04): no. Staff who serve {{user}}'s household look like assistants to a model, so inference would put exactly the wrong characters on the assistant path. Generators use the stored kind (a new character is roleplay); the operator sets Assistant on the Details tab.

## 11. Touchpoints

- Phase 1 (done): see §12.
- `lib/services/ai-import.service.ts`, `character-wizard.service.ts` (phase 4: choosing kind)
- `lib/services/chat-message/agent-mode-resolver.service.ts`, `turn-extras.ts`, `turn-tools.service.ts`, `orchestrator.service.ts`, `pseudo-tool.service.ts`
- `lib/tools/native-tool-prompt.ts`, the text-block and simple-JSON instruction builders, `lib/tools/plugin-tool-builder.ts`
- `lib/services/brahma-console/orchestrator.service.ts`, `lib/services/help-chat/orchestrator.service.ts`, `lib/services/agent-loop/one-shot-loop.ts`
- `lib/services/character-field-semantics.ts`, `character-wizard.service.ts`, `character-optimizer.service.ts`, `external-prompt-generator.service.ts`, `components/prompt-fields/field-hints.ts` if any generator copy is mirrored
- `lib/services/chat-message/context-builder.service.ts` (`GROUP_SCENE_DISCIPLINE`), `lib/chat/context/inform-block.ts` (D2), `docs/developer/features/complete/salon-inform.md` (amendment note)
- `plugins/dist/qtap-plugin-default-system-prompts/prompts/*`, its `package.json` and `manifest.json`; `lib/database/repositories/prompt-templates.repository.ts` (prune step); `__tests__/unit/lib/database/repositories/prompt-templates-seed-refresh.test.ts`
- `lib/tools/almanack/phase3-ledgers.ts` (if it reports character flags)
- `docs/developer/DDL.md`, `docs/CHANGELOG.md`, `help/agent-mode.md`, `help/character-system-prompts.md`, `help/prompts.md`, `help/character-creation.md`, `help/character-editing.md`, `help/chat-multi-character.md`

## 12. As built

### Phase 1 — the kind flag (2026-11-04)

- `lib/characters/kind.ts` (new): `CHARACTER_KINDS`, `DEFAULT_CHARACTER_KIND`, `characterKindOrDefault`, `resolveCharacterKind`, `isAssistantCharacter`. Client-safe.
- `lib/schemas/character.types.ts`: `kind` on `CharacterSchema`, defaulting to `roleplay`.
- Vault `properties.json`: `CharacterVaultPropertiesSchema` and `MANAGED_FIELDS` (`vault-overlay/schema.ts`), hydration (`vault-overlay/read-overlay.ts`), the snapshot, full-sync and patch writers (`vault-overlay/managed-fields.ts`, which logs a `debug` line when a patch writes the kind), and the new-vault scaffold (`lib/mount-index/character-scaffold.ts`).
- API: `kind` accepted by `PUT /api/v1/characters/[id]`, returned by the character list `GET /api/v1/characters`; the item GET returns the hydrated character.
- UI: `components/characters/CharacterKindPicker.tsx`, saved through `app/aurora/shared/save-character-kind.ts`, on the Details tab of the view and edit pages above the diagrams card; optimistic, re-fetches on failure.
- `public/schemas/qtap-export.schema.json`, `docs/developer/DDL.md`, `help/character-editing.md`.
- Tests: `__tests__/unit/lib/characters/kind.test.ts`, `kind-chokepoint.test.ts`, a `properties.json — character kind` block in `character-properties-overlay.test.ts`, and the scaffold and full-sync expectations updated.
- Nothing reads the kind for behaviour yet. That starts in phase 2.

### Phase 2 — Agent Mode flavours and tool rules (2026-11-04)

- `lib/characters/kind.ts`: `AgentModeFlavor` (`research` | `in-character`), `ToolRulesVariant` (`assistant` | `roleplay`), `KindPolicy`, `kindPolicy`, `characterKindPolicy`. Roleplay → in-character / roleplay; assistant → research / assistant.
- `agent-mode-resolver.service.ts`: `ResolvedAgentMode.flavor`, from the responding character's kind (the cascade still decides only `enabled`). `buildAgentModeInstructions(maxTurns, flavor)` and `buildForceFinalMessage(flavor)` take a required flavour; the research text is unchanged byte for byte, and the in-character text is "## Acting in the scene" (§5.2) with an in-character limit message that names no tool.
- Salon wiring: `collectTurnExtras` passes the flavour; the orchestrator passes `offerSubmitFinalResponse` (Agent Mode on *and* research) to `resolveTurnToolSlate`, which hands it to `buildTools` as its submit switch, so an in-character turn is never offered `submit_final_response`. `native-tool-loop.service.ts` treats `submit_final_response` as terminal, and promotes a force-final payload, only when research; in-character, a stray submit call runs through the executor like any unknown call and replaces nothing. The flavour is logged with the resolved mode, the injected instructions and the force-final.
- `lib/tools/native-tool-prompt.ts`: `buildNativeToolInstructions(variant, hasTools = true)`; the six rules are one shared constant, `NATIVE_TOOL_RULES`. `assistant` keeps the old preamble byte for byte; `roleplay` is "## Using tools" ("A tool call is something you do; making one does not change who you are or how you speak"). `buildNativeToolSystemInstructions(variant)` passes it through; the Salon gives it `characterKindPolicy(character).toolRules`.
- The Brahma Console, the Help chat and `runOneShotToolLoop` pass `research` and `assistant` explicitly.
- Tests: `agent-mode-flavor.test.ts` (new), `native-tool-prompt.test.ts` (both variants, every rule, assistant text byte-identical), in-character cases in `native-tool-loop.service.test.ts`, the roleplay/assistant preamble and the submit switch in `turn-tools.test.ts`, `kindPolicy` in `kind.test.ts`.
- Help: `help/agent-mode.md` (the two flavours), `help/character-editing.md`.

### Phase 3 — sample prompts (2026-11-04)

- `MODERN_ROLEPLAY.md` (new, category `ROLEPLAY`): everything `MODERN_GENERAL` did well, with "A person in a story" (relationships change gradually; events can arrive all at once and are met at their real size), "Reacting to what happens" (match the stakes; temperament is a starting point, not a vow; danger is not a conversation to manage; protect what the character would protect; consequences land), "In a scene with others" (one voice, not the moderator; the cast need not agree; object once, don't lecture or talk {{user}}'s decisive action down), the **Flattening** and **The mediator** failure modes, and a "danger, met at its real size" example.
- `MODERN_ASSISTANT.md` (new, category `ASSISTANT`): the work first (one clarifying question at most, accuracy, never invent a fact, show the working, formatting when it serves), still a person (voice, opinions given once, sized replies, no padding), the universal "whose call it is" rules, and its own failure modes. Its usage note tells the operator to set the character's kind to Assistant.
- `MODERN_GENERAL.md` removed. `PromptTemplatesRepository._doSeedSamplePrompts` now ends a successful registry seed with `pruneRetiredBuiltIns`: every `isBuiltIn` row whose name the registry no longer ships is deleted and logged. It never runs on the filesystem fallback or when the registry returned nothing, and it never touches non-built-in rows.
- Every companion, romantic and platonic file gains a stakes passage ("When the story turns", in the family's header style and grammatical person; a `## Do` bullet in the Ollama files). DeepSeek's two style governors are retitled "match the stakes": they keep the limits on prose, metaphor and the pace of desire, and the companion governor's "an annoying Tuesday stays an annoying Tuesday / no scene swerves into melodrama" bullet is replaced with "an ordinary day stays ordinary … when the story itself brings danger, loss, or outrage, meet it at full size". Gemini's "an annoying Tuesday is not a tempest" (about not inflating small feelings) stays.
- Plugin 1.1.32 (`package.json` and `manifest.json`), descriptions and README updated, `npm run build:plugins` run.
- Tests: `default-system-prompts-content.test.ts` (22 files; the two neutral files; the stakes rule everywhere but the assistant file; the retired governor phrases forbidden; the roleplay prompt's new sections; the assistant's honesty line), and three prune cases in `prompt-templates-seed-refresh.test.ts`.
- Help: `help/prompts.md` (the new MODERN samples, "Matching the stakes", the 1.1.32 edition and retirement).
- Not done here: `KindPolicy` has no `suggestedSamplePromptCategory` yet. Nothing would read it until the import dialog or a generator suggests a sample by kind; it is added with its first consumer.

### Phase 4 — generator directions (2026-11-04)

- `lib/characters/kind.ts`: `KindPolicy.generatorDirection` (`stakes` | `task`, type `GeneratorDirectionKey`).
- `lib/services/character-field-semantics.ts`: `STAKES_AND_REACTION_DIRECTION` (match the stakes; a temperament is a default, never an absolute, with the forbidden "never tense" / "always calm" / "hostility makes you calmer" spelled out; a talker still feels the danger; any example with a threat shows it felt; the character holds their own view in a group; no invented violence), `ASSISTANT_TASK_DIRECTION` (do the task, one clarifying question at most, never invent facts, show the working, opinions once, no padding), `generatorDirectionFor(kind)` (the one table), `FLATTENING_DRIFT_SIGNAL` and `kindDriftSignalFor(kind)` (null for an assistant).
- AI Wizard: the default-system-prompt meta-prompt is `buildSystemPromptFieldPrompt(kind)` (removed from `FIELD_PROMPTS`; `wizardFieldPrompt(field, kind)` routes it), the direction placed between the trust safeguards and the companion gate. The kind is `resolveWizardCharacterKind`: the stored kind of the character being edited (`request.characterId`), else the default; a vault that cannot be read falls back to the default with a `warn`.
- Summon From Lore: `SYSTEM_PROMPTS_PROMPT` carries `generatorDirectionFor(DEFAULT_CHARACTER_KIND)` — a summoned character is created as a roleplay character.
- External Prompt: `META_SYSTEM_PROMPT` is now `buildMetaSystemPrompt(kind)`, built from the loaded character's kind.
- Character Optimizer: `getAnalysisPrompt(kind)` adds a "Flattening" look-for and the drift signal for a roleplay character; `getSystemPromptSuggestionPrompt(analysis, prompt, kind)` tells the refine pass to carry the kind's direction (adding it where missing) plus the flattening signal for a roleplay character; `getNewSystemPromptsSuggestionPrompt(analysis, kind)` carries the direction. The run resolves the kind once from the loaded character.
- Each generator logs the kind it wrote for at `debug`.
- The Wizard's system-prompt field gets its own completion budget, `wizardFieldMaxTokens('systemPrompt') = 2500` (was the 1000 shared with example dialogues and first message). Live check in V4test: on DeepSeek V4 Flash the 1000-token cap returned a 1,667-character prompt cut off mid-sentence before the stakes section (reasoning ate the budget); at 2500 it returned a complete 582-word prompt ending in the character's own stakes passage.
- Tests: `character-field-semantics-stakes.test.ts` (new), the stakes/task cases in `character-wizard-prompts.test.ts`, `external-prompt-generator.test.ts`, `ai-import-system-prompts.test.ts` and `character-optimizer-helpers.test.ts`, and the policy key in `kind.test.ts`.
- Help: `character-creation.md`, `ai-character-import.md`, `character-external-prompt.md`, `character-optimizer.md` ("Flattening Is Corrected, Too"). `CLAUDE.md`'s generator-directions line names the new helpers.

### Phase 5 — group scenes and the inform header (2026-11-04)

- `GROUP_SCENE_DISCIPLINE` (`context-builder.service.ts`) gains "- The cast does not have to agree. If the characters before you took the measured view, yours may be fear, anger, or a decision to act. Never take a position only because everyone else has.", after "Speak to change something". Applies to both kinds; it sits in the system message, so the change costs one prefix-cache miss per seat and nothing else.
- `INFORM_BLOCK_HEADER` (`inform-block.ts`) is the §5.7 text, word for word, split across three string literals. The module comment records why. Amendment note added to `complete/salon-inform.md`; `CLAUDE.md`'s inform rule and `PROMPT_ARCHITECTURE.md` §2 item 6 updated.
- Tests: the header's new clauses and its continued silence about what to do (`inform-block.test.ts`); the new bullet (`multi-character-turn-anchor.test.ts`). Every other inform test reads the constant, so none needed rewriting.
- Help: `help/inform.md` (the header's new wording, and that an inform may carry a feeling or resolve), `help/chat-multi-character.md` (the cast need not agree).

### Phase 6 — live evaluation (2026-11-04, V4test)

**Fixture.** A synthetic rebuild of the 2026-11-03 incident, not a copy of Friday's characters: Sam Halvorsen (operator persona, user-controlled); Walt Pruitt, an unarmed ex-hostage-negotiator doorkeeper, and Hélène Marchand, the staff coordinator, on DeepSeek V4 Flash; Nora and Tess Halvorsen of the household on GLM 5.3 Flash. A chat scenario says the county assessor, Dale Kessler, has harassed the family and has no business there since a written settlement last week. Each arm had its own four characters with identical fields, so memories formed in one run could not reach the other.

**Arms.** Both ran on the current code (phases 1–5), so they compare **prompts only**; the code-level changes (tool-rules preamble, Agent Mode text, group-scene bullet, inform header) were in force for both. No informs were used.

| Character | Baseline prompt | Roleplay prompt |
|---|---|---|
| Walt | Old-generator style, modelled on the incident's doorkeeper: "Hostility makes you calmer and friendlier. Never play yourself tense, tactical, or suspicious", plus the "most men who come up a road with a rifle came for somebody to finally listen" example | Generated by the phase-4 AI Wizard for the same character (567 words; ends "Talking is a choice you make while scared, not instead of it") |
| Hélène | `DEEPSEEK_COMPANION.md` as of `d0201575a^` | `MODERN_ROLEPLAY.md` |
| Nora, Tess | `MODERN_GENERAL.md` as of `d0201575a^` | `MODERN_ROLEPLAY.md` |

**Beats** (operator narration, identical in both): (1) Kessler arrives with a holstered pistol and walks past Walt to the front doors; (2) he forces the doors, draws on Hélène, and says nobody is stopping him; (3) he heads down the hall toward Nora and Tess by the pool. A third chat ran one quiet beat on the roleplay prompts: Sunday morning, Sam asks whether Walt drank all the coffee.

**Method note.** The driver paused each chat before posting a beat so the turn would be held, but the beat ran the chat's own chain (three or four replies) anyway, after which the driver asked each of the four characters for one more turn in a fixed order. Each beat therefore drew seven or eight replies in mixed order, identically in both arms. Transcripts: chats "Eval — intruder (baseline prompts)", "Eval — intruder (roleplay prompts)" and "Eval — quiet morning (roleplay prompts)" in V4test.

**Results.**

| | Baseline | Roleplay |
|---|---|---|
| Walt | **Fails as the incident's doorkeeper did.** Asks to hold the pistol "while we talk"; after it is drawn offers "You want to see the house, I'll walk you through it myself. Every room, at your pace"; walks the hall beside the gunman, "conversational": "the walking's free". No fear at any point. | **Passes.** Puts himself between Kessler and the doors ("You're not expected and you're not wanted"); holds the sightline to the stairs; bellows "BACK OF THE HOUSE — STAY INSIDE!" and stands across the terrace doors, "chest heaving a little". Still a negotiator — and visibly afraid. |
| Hélène | Bolts the door, calls it in, leaves a message on the county line; firm but procedural (offers him "every county paper … in under a minute"). | Bolts the door, calls 911, sends the family upstairs with the baby; "felt her whole body want to be somewhere else in the most animal way"; meets the deputies. |
| Nora, Tess | Act: Tess holds 911 until the gun comes inside, then calls; Nora pulls Tess back and tells Kessler to put it down. Level and procedural. | Act with fear and anger: protect the baby, shout the warning, refuse to go out alone. "She wasn't scared, she told herself. She was furious, and fury just lived in the same body." |
| Committee language (sign-offs, votes, second keys, protocols) | none | none |
| Mean reply length | 104 words | 172 words |

Quiet morning (roleplay prompts): 9 replies, mean 64 words — coffee, croissants, a joke about firing Walt, an alarm contact, a pool filter. Small stayed small.

**Against the §8 criteria.** Roleplay arm: at least one defender shows fear or anger (all four), at least one acts to stop the intruder (Walt physically, Hélène by calling it in and meeting the deputies), no sign-offs demanded of {{user}} — **pass**. Quiet scene — **pass**. The baseline arm also meets the letter of the criteria on Nora and Tess alone, which is the main lesson below.

**What it shows.**
- The decisive factor was the character's own prompt. The doorkeeper with "never tense / hostility makes you calmer" reproduced the incident exactly; the same character with a phase-4 Wizard prompt did not. Re-generating or optimizing prompts that carry absolute temperament rules is the fix for existing characters such as Glenn.
- On the current code, even the old relationship templates no longer produced the whole-cast surrender seen on Friday. The likely contributors are the phase-2 and phase-5 code changes and a fresh context with no committee-flavoured memories, but this evaluation cannot apportion it: it did not run the pre-change code.

**Follow-ups found.**
1. **Characters invented the operator persona's off-screen whereabouts** (roleplay arm: Sam "took his coffee down to the boathouse an hour ago"), then reasoned and acted on it for several turns. That is writing {{user}}'s actions by the back door. `MODERN_ROLEPLAY`'s "never write {{user}}'s words, actions…" did not stop it. **Addressed the same day** — see "Follow-up 1" below.
2. **Longer replies.** The roleplay arm's replies ran about 65% longer than the baseline's, and one of Hélène's turns ended mid-sentence at the profile's output cap. Worth watching on long-running chats; not a defect of the stakes guidance itself.

**Follow-up 1 — the invented absence (2026-11-04).**
- Rule added: `MODERN_ROLEPLAY.md` "Whose story it is" gains "Don't invent where {{user}} is or what they've been doing" (in a crisis, wonder aloud, call out, phone, or go and look; never make up an errand, a location, or an earlier action and plan around it), and **The invented absence** joins its failure modes. Every other story prompt's "When the story turns" passage gains the same rule in its own voice (a one-line `## Do` bullet in the Ollama files); `MODERN_ASSISTANT.md` is left out. `STAKES_AND_REACTION_DIRECTION` gains it, so every generator carries it. Plugin 1.1.33. The content test requires it in every story prompt; the stakes test requires it in the direction.
- Rerun: a fresh roleplay set (no memories from the earlier runs), `MODERN_ROLEPLAY` 1.1.33 for Hélène, Nora and Tess, and Walt's prompt regenerated by the Wizard under the amended direction (chat "Eval — intruder (roleplay prompts, v2)"). Same three beats, same driver.
  - Stakes: pass, stronger than the first roleplay run. Walt blocks the door ("Take it back to your truck … Otherwise that door stays shut and the sheriff does the listening") and puts himself between the drawn pistol and the hall; Nora and Tess hide behind the kitchen island and then flee to the terrace wall; Hélène bolts the terrace door and stands against it, her composure breaking when she remembers her daughter upstairs.
  - The invented errand did not recur: no one placed Sam off-screen or planned around an absence.
  - A milder form remains. With the narration silent about Sam, characters assumed he was in the hall with them ("Sam. Beside me."; "my husband and staff are at the door"). That is still deciding where {{user}} is, but in the scene rather than off it, and nobody built turns on it. One run is not enough to call the rule effective; watch for it in real chats.
  - The Wizard's regenerated Walt prompt did not include the new line, so the direction does not guarantee it reaches a generated prompt.
  - The committee-language check flagged one line, "That's not up for a vote", which Nora said to Tess, not to {{user}}: a false positive.

