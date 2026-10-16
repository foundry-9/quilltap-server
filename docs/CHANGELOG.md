# Quilltap Changelog

## Recent Changes

### 4.11-dev

#### Fix: a composer typeahead menu could be left open at the top-left (bug 250)

- Undo that brought back a `@`, `:` or `/` trigger, followed at once by clearing the composer, could leave the menu rendered at the window's top-left until the next keystroke. Lexical 0.52's `LexicalTypeaheadMenuPlugin` opens its menu in a React transition, and its `closeTypeahead` skips the close while the captured resolution is still null, so a clear that lands before the open commits is lost.
- New `GuardedTypeaheadMenuPlugin` (`components/chat/lexical/typeahead/GuardedTypeaheadMenuPlugin.tsx`) wraps the plugin. After each open commits it re-runs the consumer's `triggerFn` against the live editor and, when the trigger is gone, calls `onClose` and remounts the plugin. `MentionTypeaheadPlugin`, `CharTypeaheadPlugin` and `SlashCommandPlugin` now render through it.
- New test in `__tests__/unit/components/chat/lexical/plugins/MentionTypeaheadPlugin.test.tsx` reproduces the race by seeding and clearing inside one `act()`.

#### Fix: a `when` phrase naming "constructor" as its month failed the extraction job (bug 247)

- `MONTH_NAMES`, `WORD_NUMBERS` and `UNIT_DAYS` in `lib/memory/time/clock.ts` are now read through `lookupWord`, which answers own keys only. `constructor 5` and similar phrases resolve to no event time instead of throwing `RangeError: Invalid time value`.
- `resolveEpisodicAnchors` (`lib/memory/time/anchors.ts`) now catches a parser error and keeps the fallback `occurredAt`, so one bad `when` costs that draft its event time and never fails the job.
- New test rows in `lib/memory/time/__tests__/rule-table.test.ts` and `anchors.test.ts`. The v5 harness pin `PROTOTYPE_KEY_MONTH_THROWS` can be retired.

#### Fix: Enter on a code block's blank trailing line sent the message (bug 251)

- In the Salon composer, Shift+Enter then Enter at the end of a code block was meant to leave the block. In chat mode it sent the message; in composition mode it added another line. After Shift+Enter, Lexical leaves the caret as an element point on the `CodeNode`, and `KeyboardPlugin`'s check only looked for a caret inside the block's last child. Present on Lexical 0.43 as well.
- New `$codeBlockToEscape` (`components/chat/lexical/plugins/KeyboardPlugin.tsx`) accepts both caret shapes. The exit now removes only the trailing blank line instead of rebuilding the block as one highlight node.
- New test `__tests__/unit/components/chat/lexical/plugins/KeyboardPlugin.test.tsx` (real editor; the plugin had none). Help: code-block paragraph in `help/chats.md`. Filed and fixed as bug 251.

#### Chore: Lexical 0.52

- `lexical` and the eight `@lexical/*` packages moved from 0.43.0 to 0.52.0 in lockstep; one copy installed. This ends the 0.43 pin.
- `TABLE_TRANSFORMER` (`components/chat/lexical/transformers/table-transformer.ts`) now has a bare, non-optional `regExpEnd`, which keeps it out of `@lexical/markdown`'s live shortcut runner. Tables are still built on import and paste through `handleImportAfterStartMatch`; typing a `|…|` line stays a paragraph. New test `__tests__/unit/components/chat/lexical/transformers/table-transformer.test.tsx` covers both paths.
- Lexical is ESM-only from 0.51. `jest.config.ts` now exempts `lexical`, `@lexical/*` and `@preact/signals-core` from the transform ignore list, including in the node_modules pattern `next/jest` prepends. `next.config.js` is unchanged.
- Type fixes for 0.52's stricter command typing: `KEY_DOWN_COMMAND` handlers in `CharTypeaheadPlugin` and `MentionTypeaheadPlugin` take a non-null `KeyboardEvent`; `ImagePastePlugin` accepts the full `PasteCommandType` and reads `clipboardData` only when present.
- `list-indentation.ts` stays. The 0.52 importer resolves nesting by column, but export still writes four-space indents, so the document's own indent unit still has to be restored on export.
- Known issue, filed as bug 250 (`docs/developer/bugs/bug-250-typeahead-menu-orphaned.md`): a composer typeahead menu reopened by undo and then cleared immediately stays open at the top-left until the next keystroke. Upstream `LexicalTypeaheadMenuPlugin` race, new in 0.52.
- Spec moved to `docs/developer/features/complete/lexical-0.52-upgrade.md` with an As-built section.

#### Chore: dependency safe batch

- In-range updates: `next` / `eslint-config-next` 16.4.2, `react` / `react-dom` 19.3.1, `@tanstack/react-query` / `-devtools` / `eslint-plugin-query` 5.104.3, `@tanstack/react-virtual` 3.14.20, `@playwright/test` 1.64.1, `@testing-library/user-event` 14.6.8, `openai` 7.34.0, `zod` 4.6.7, `postcss` 8.5.30, `react-syntax-highlighter` 16.1.2, `@types/node` 24.19.2.
- Range bumps: `katex` ^0.19.0, `@types/better-sqlite3` ^9.6.0, `@types/yauzl` ^3.4.0, `@testing-library/jest-dom` ^7.0.1, `dotenv` ^18.0.8. The rendered KaTeX HTML still comes from the 0.16 copy nested under `rehype-katex`; only the CSS and symbol table moved to 0.19.
- Removed the unused `@vitest/mocker` dev dependency and its `knip.json` ignore.
- Rebuilt the eight plugins that bundle the `openai` SDK and bumped their patch versions: anthropic 1.0.62, curl 1.0.31, default-system-prompts 1.1.26, google 1.1.56, mcp 1.1.44, ollama 1.0.53, openrouter 1.0.67, search-serper 1.0.26.
- Held (reasons in `docs/developer/features/complete/dependency-upgrade-safe-batch.md`): TypeScript 7, ESLint 10, `@types/node` 26, `pdfjs-dist` 6, `jest-fetch-mock` 4, `better-sqlite3-multiple-ciphers` 13, and Lexical 0.52 (own spec).

#### Docs: dependency upgrade specs

- Added `docs/developer/features/dependency-upgrade-safe-batch.md` (in-range updates, KaTeX 0.19, `@types/*` bumps, `@vitest/mocker` removal, and the recorded holds on TypeScript 7, ESLint 10, `pdfjs-dist` 6 and `better-sqlite3-multiple-ciphers` 13) and `docs/developer/features/lexical-0.52-upgrade.md` (lockstep bump, table-transformer `regExpEnd` fix, Jest ESM exemption, behaviour-change checklist, manual smoke test). No code changes.

#### Feature: slash commands in the Salon composer

- Typing `/` at the start of a word in the Salon composer opens a command menu: composer actions (`/attach`, `/library`, `/image`, `/announce`, `/mail`, `/inform`, `/tool`, `/pascal`, `/roll`, `/d6`, `/d20`, `/coin`, `/bottle`), every available user-invocable built-in tool under its id, and every Pascal custom tool in the chat under its name. Unavailable built-ins are left out. Matching is exact, then command prefix, then word prefix of the command, label or keywords (`_` and `-` split words); never mid-word.
- A tool that declares no parameters runs at once (public, or the custom tool's default visibility) with a toast; one with any parameter opens its existing dialog on its form. Picking a command removes the typed `/query` as one undo step. `/d6` and friends produce the same pending-result chip as the dice button.
- The trigger uses `findTrigger`'s opener rule plus a letter-first query, so `and/or`, `10/15`, `http://`, paths and code never open it. No arguments; a space closes the menu. Not mounted in Document Mode.
- New pure tier `lib/slash-commands/` (trigger, ranking, registry), under the same ESLint import restriction as `lib/char-insert/`. Adapter `SlashCommandPlugin`; immediate runs in `useSlashCommandRunner`; tool and custom-tool lists fetched only while the menu is open (`queryKeys.tools.byChat` added).
- `RunToolModal` and `CustomToolRunDialog` take an `initialTool` pre-selection (re-applied per nonce). `CustomToolRunDialog` moved from `CustomToolsButton` into `ChatModals` so the gutter wand and the slash menu share one instance; `CustomToolsButton` is now a plain button. `useModalState.openRunTool(toolId?)` and new `openCustomTool(initial?)`.
- The dice button's request moved to `components/chat/rng-request.ts`, shared with the slash quick rolls.
- New chat setting `composerSlashCommands` (Settings → Chat → Slash Commands), default on; gutter buttons and the sidebar are not gated. Migration `add-composer-slash-commands-field-v1` adds the `chat_settings` column.
- Help: `chat-settings-composer.md` (new Slash Commands section; page URL now `section=composer-slash-commands`), `run-tool.md`, `custom-tools.md`, `rng-tool.md`. Spec moved to `docs/developer/features/complete/composer-slash-commands.md` with an As-built section; Phase 4 of `composer-typeahead.md` marked superseded.

#### Fix: one-character chat chained the character to the depth cap (bug 249)

- In a Salon chat with one LLM character and no persona seat, every operator message made the character reply about 20 times in a row, until the chain hit `maxChainDepth`. Since `83f4368a8` the turn selector returns a lone character unconditionally, and `shouldChainNext` treated that as a reason to continue; the all-LLM pause did not apply because the operator was present.
- `shouldChainNext` (`lib/services/chat-message/turn-orchestrator.service.ts`) now returns `user_turn` when the selector picks the only character, that character spoke last, and a human is present. Genuinely all-LLM chats and autonomous rooms keep the monologue; a queued or nudged turn still runs. The selector is unchanged.
- Filed and fixed as bug 249 (`docs/developer/bugs/fixed/bug-249-lone-character-chain-runaway.md`).

#### Feature: Pascal wardrobe effects

- A custom-tool effect may now be a wardrobe gesture instead of a write: `{ "wardrobe": { "action": "wear" | "take_off" | "clear_slot", "items"?, "mode"?, "slot"? } }`. An effect is either `target` + `value` or `wardrobe`, never both. Per-action rules are checked at load (`wardrobeGestureProblems` in `lib/pascal/custom-tool.types.ts`); the published JSON Schema checks shapes only and states the per-action rules in prose.
- Item references are templates (rendered with the outcome message's placeholders, then trimmed) resolved by id, then case-insensitive title, in the rolling character's wearable pool. Up to 8 items per gesture, 200 characters each. A gesture whose items all render empty is skipped.
- New applier `lib/pascal/wardrobe-effects.ts`: runs after the value writes commit, one gesture at a time through `wearItem` / `takeOffWearable` / `applyDisplacement` with source `'tool'`, then calls `notifyWardrobeChanged` once if anything changed. Unresolvable, archived (for wear) or slot-mismatched items are skipped per item; a run with no rolling character changes nothing. Each change is recorded in `pascalMeta.effects` with target `wardrobe.wear`, `wardrobe.take_off` or `wardrobe.clear_slot`; no schema or migration change.
- `applyCustomToolEffects` takes `userId` and an optional `pendingWardrobeAnnouncements`; `run_custom` passes the turn's set so a tool's wardrobe change and the model's own wardrobe calls produce one Aurora announcement.
- Fix: `wardrobe_take_off` `remove` on a composite outfit removed nothing, because worn composites are stored as their leaves. It now removes every equipped leaf of the composite (`takeOffWearable` in `lib/wardrobe/wear-ops.ts`), shared with the Pascal applier.
- `run_custom` description: the preamble mentions outfits, and the per-tool `Side effects:` line lists `wears …`, `takes off …`, `clears <slot>`. Tool vocabulary gains `wears`, `takesOff`, `clearsSlots`, shown in the run dialog's reference panel.
- Pascal's Workbench: each side-effect row has a Kind select (write a value / change the outfit) with action, items, mode and slot fields; draft round-trip, validation and parameter rename cover wardrobe items. The Proving Bench lists gestures as "would attempt".
- Help: `custom-tools.md` (new "Dressing and undressing" section), `wardrobe.md`, `pascals-workbench.md`. Specimen `CUSTOM_TOOL_SPEC.json` gains a `take_off` effect. Spec moved to `docs/developer/features/complete/pascal-wardrobe-effects.md`.

#### Feature: Pascal trigger phrases

- Custom tools may declare `triggers`: up to 8 phrases (3–80 characters, no leading/trailing whitespace, unique ignoring case). Matching is a case-insensitive substring test with no word boundaries.
- New chat setting `customToolTriggers` (Settings → Chat → Automation, "Auto-Run Custom Tools on Trigger Phrases"), default off and ignored while `customTools` is off. Migration `add-custom-tool-triggers-field-v1` adds the `chat_settings` column.
- With the setting on, the operator's message (after it is saved) and each character's reply (after it is saved) are scanned; each matching tool runs once with every parameter at its default, from the speaker's perspective (their roster, fact sheet and groups; the bare operator rolls as nobody). Carina query lines are not scanned, nor are Pascal, Carina or staff messages, and swipes fire nothing. At most 4 tools fire per message; the rest are logged. A private (whisper-default) tool whispers to the speaker. Failures post the Prospero error bubble.
- `pascalMeta.invokedBy` gains `'trigger'`, with the phrase in `pascalMeta.triggerPhrase`. Export schema updated. An export containing a triggered run fails `pascalMeta` validation on builds older than 4.11 for that message.
- Extracted `runCustomTool` (`lib/pascal/run-service.ts`): the cascade → execute → effects → post sequence the `run_custom` handler and the manual run route each carried a copy of. Both entrances and the trigger runner now call it. A manual run request that omits `private` now follows the tool's `defaultVisibility` (the run dialog always sends it, so dialog runs are unchanged).
- Pascal's Workbench: a trigger-phrase chip input in the builder form, draft round-trip and validation, a warning when an outcome message, chip label or oracle prompt quotes one of the tool's own phrases, and a "✦ N phrases" badge in the library.
- Migration registry test now fails on a dependency cycle (including a migration that names itself in `dependsOn`), which would otherwise stop the server at boot.
- The Almanack and the `help_settings` tool report the new setting. Help: `custom-tools.md`, `chat-settings.md`, `rng-tool.md`, `pascals-workbench.md`. Spec moved to `docs/developer/features/complete/pascal-trigger-phrases.md`.

#### Docs: three Pascal and composer feature specs

- Added `docs/developer/features/pascal-wardrobe-effects.md`: a `wardrobe` side effect on custom tools (wear, take off, clear a slot) applied to the rolling character through the existing wardrobe chokepoints.
- Added `docs/developer/features/pascal-trigger-phrases.md`: a `triggers` key on custom tools plus an off-by-default chat setting that runs the tool when anyone in the chat says one of its phrases; includes the extraction of one shared run service out of the two existing entrances.
- Added `docs/developer/features/composer-slash-commands.md`: `/` commands in the Salon composer for composer actions, built-in tools, and Pascal's tools, running at once when there is nothing to fill in and opening the existing dialog otherwise. Supersedes Phase 4 of `composer-typeahead.md`.
- Catalogued all three in `.claude/commands/update-documentation.md`. No code changes.

#### Fix: styled hair slot read as contradicting the physical description

- `describeOutfit` now appends a note to the hair line (`HAIR_STYLING_PRECEDENCE_NOTE` in `lib/wardrobe/slot-guidance.ts`) saying the hairdo is the current styling and overrides the natural hair's texture and style in the physical description.
- Image prompts put the physical description ("perfectly straight hair") before the outfit list ("hair: Voluminous Emerald Curls") with nothing saying which applied. A kept photo's catalogue entry quotes that prompt, so a character reading it described the natural hair instead of the hairdo in the picture. The note reaches every caller of `describeOutfit`: avatar and Lantern prompts, wardrobe tool output, and Aurora announcements.

