# Quilltap Changelog

## Recent Changes

### 4.11-dev

#### Fix: restore and import keep chat outfits (bug 252)

- New `lib/chat/character-keyed-fields.ts`: `remapCharacterKeyedChatFields` re-keys every chat column keyed by character id (`equippedOutfit`, `characterAvatars`, `courierCheckpoints`, `pendingOutfitNotifications`) and moves the ids inside them: outfit slot item ids through the wardrobe item remap, outfit-avatar `imageId` through the file remap, Courier `lastResolvedMessageId` through the message remap. Outfits come back as full five-slot bags, matching the outfit-history remap. A column stored as a JSON string is parsed; an unreadable one is left alone and logged at `warn`.
- New-account restore (`remapBackupData`) and `.qtap` import (`reconcileRelationships`, which now takes the imported wardrobe item map) both call it. Restore drops an entry for a character the backup does not carry instead of minting an id for it. Before this, those columns kept the old character ids, so no character was wearing anything in a restored chat, outfit avatars were gone, and Courier checkpoints were lost.
- Tests: `__tests__/unit/lib/chat/character-keyed-fields.test.ts`, `__tests__/unit/lib/backup/uuid-remapper.test.ts`, `__tests__/unit/lib/import/quilltap-import/reconcile-character-keyed-fields.test.ts`.

#### Docs: Inventory design specs

- New `docs/developer/features/inventory.md`: the design of record for the Inventory (per-tier `Inventory/` JSON objects with archetypes, instances, kits, two descriptions and per-chat equipped state). Pascal the Croupier owns it. Decisions settled; nothing built yet. Roadmap row added.
- New `docs/developer/features/inventory-tools-and-pascal.md`: the follow-up design for the `inventory_*` tool family (gated by a new `canManageInventory` flag), the `inventory` / `inventoryCount` `when` and gate subjects, `{{inventory.*}}` placeholders, the `$inventory` operand and the `inventory` effect, plus the Workbench and Proving Bench changes. Depends on the Inventory spec; nothing built yet.

#### Feature: wardrobe pictures in the Aurora gallery

- The character gallery tab has a third, collapsible section, **Wardrobe Pictures**, below Avatar Rolls: every GENERATED image of every wardrobe item in the character's wearable pool (own vault, group stores, Quilltap General; no project tier, since there is no chat). Archived items included. Each tile carries a caption overlay with the item title and its tier ("Own wardrobe", "Group · X", "Shared · Quilltap General"). Read-only: download on hover, detail modal on click.
- New `GET /api/v1/characters/[id]/wardrobe-images`, backed by `listWardrobeGalleryImages` (`lib/wardrobe/gallery-images.ts`), which loads the pool through `loadWearablePool` and reads the items' files in one `FilesRepository.findByLinkedToAny` lookup (new). Archived characters return an empty list. Query key `characters.wardrobeImages(id)`.
- `GalleryGrid` / `GalleryImage`: `onSetAvatar` and `onDeleteImage` are optional (buttons hidden when omitted); new `captionFor` / `caption` prop renders the overlay and moves hover actions to the top corner. New `qt-gallery-caption`, `qt-gallery-caption-title`, `qt-gallery-caption-detail` classes, mirrored into theme-storybook (1.0.74).
- Tests: `lib/wardrobe/__tests__/gallery-images.test.ts`. Docs: `help/character-gallery.md`, `API.md`.

#### Feature: wardrobe outfit history

- New table `chat_wardrobe_history`: per (chat, character) a numbered timeline of outfits from 0 (what they arrived in), with an `isCurrent` cursor. Two unique indexes keep indices unique per timeline and allow one current row. DDL lives only in `lib/database/backends/sqlite/chat-wardrobe-history-ddl.ts`; types in `lib/schemas/chat-wardrobe-history.types.ts`.
- New `ChatWardrobeHistoryRepository` (`repos.wardrobeHistory`). `settle(chatId, characterId, intent)` is the only runtime writer: an `append` intent reads the chat's live slots and adds entry `max + 1` unless they hash equal to the current entry; a `cursor` intent moves the cursor without appending. A first touch with no rows records the arrival outfit as 0, or, for a seat that predates the history, an empty seeded 0 before the change. `settle` never throws. `upsertRows` is for restore and import; `deleteByCharacter` runs from character delete.
- `wardrobeHistory.settle` is a buffered write in the job child (`METHOD_OVERRIDES`), replayed in the parent after the turn's `commitEquippedOutfit`.
- Migrations `add-chat-wardrobe-history-table-v1` (the table) and `seed-chat-wardrobe-history-v1` (one current entry 0 per character in each chat's `equippedOutfit`, dated by the chat's `updatedAt`).
- Tests: `chat-wardrobe-history.repository.test.ts`, `migrations/chat-wardrobe-history.test.ts`, `outfit-history-fence.test.ts`, `child-proxy-wardrobe-wear.test.ts`, `cascade-delete.test.ts`.
- Recording: `OutfitChangeContext` gains a required `provenance` (`operator`, `character` with the calling character, `pascal` with the rolling character) and an optional `historyIntent` (rollback's cursor move). `notifyWardrobeChanged` settles the history beside each announcement: at once outside a model turn, or into the turn's new `pendingWardrobeHistory` map (last intent per character wins), drained with the announcement set by `flushPendingWardrobeAnnouncements`. So one tool call, dialog Done, Pascal run or model turn records one entry.
- New `lib/wardrobe/turn-containers.ts`: `newWardrobeTurnContainers()` creates the announcement set and history map together; `turnContainersOf()` threads them. `createToolContext` and both Brahma surfaces use the factory; a grep-test forbids a hand-made set. `WardrobeToolContext` is now `OutfitChangeContext` minus `historyIntent`.
- `applyOutfitSelections` settles each character after a successful commit with its `chat-start` / `participant-added` / `merge` source, so arrivals record entry 0 (or `max + 1` for a returning seat).
- New `rollbackWardrobe` (`lib/wardrobe/history/rollback.ts`), the one rollback: resolves the target (default: one before the cursor; refuses `no_history`, `at_first`, `out_of_range`, `already_current`), leaves off items that are archived or gone unless an archived one is already worn in that slot, commits once through `commitEquippedOutfit` with no bundles, then fires `notifyWardrobeChanged` with a cursor intent so Aurora announces and the history cursor moves without appending.
- New tools `wardrobe_rollback` (optional `index`) and `wardrobe_history` (optional `limit`, default 20, max 100; the current entry is kept when it falls before the window). Both are gated by `canDressThemselves` and registered everywhere `wardrobe_take_off` is: tool index, plugin tool builder, executor name list and table (nine tools now), tools API, simple-JSON prompt and parser (aliases `rollback_outfit`, `undo_outfit`, `outfit_history`), legacy text-block prompt and parser (`[[ROLLBACK_OUTFIT]]`, `[[OUTFIT_HISTORY]]`), pseudo-tool and streaming options, and the Salon tool bubble ("Returned to outfit N."). Brahma and the Scenario Builder set both off. Shared rendering in `lib/wardrobe/history/describe-entry.ts`.
- Tests: `lib/wardrobe/__tests__/rollback.test.ts`, `wardrobe-history-rollback-handlers.test.ts`, `wardrobe-tool-table.test.ts`, tool-definition snapshots.
- API: `GET /api/v1/chats/[id]?action=wardrobe-history&characterId=…` (entries with resolved slots, stale ids marked `archived` / `missing`, a `changedBy` label) and `POST ?action=wardrobe-rollback` (`{ characterId, index }`; an operator change through `rollbackWardrobe`; refusals are 400). Documented in `API.md`.
- Query keys `wardrobe.histories(chatId)` / `wardrobe.history(chatId, characterId)`; the `chats` realtime topic now refetches `wardrobe.histories(id)`, so no polling.
- Wardrobe dialog: a **History** tab beside Live outfit and Outfit Builder (chat only; `components/wardrobe/outfit-history-tab.tsx`). Newest first, with index, relative time, who changed it, a summary and per-slot badges (archived or gone items shown with a secondary badge); the current entry is marked "Wearing now". **Wear again** posts the rollback and toasts the result, naming any garments left off; the button's tooltip warns ahead of time. If the Live tab holds staged edits for that character, the operator confirms, the staging is discarded first, and the Live tab re-seeds after the refetch, so Done cannot flush it over the rollback. `useStagedLiveOutfits` gains `isDirty` and `discard`.
- Tests: `wardrobe-history.test.ts` (route), `outfit-history-tab.test.tsx`, `use-staged-live-outfits-discard.test.tsx`, `outfit.test.ts` (operator provenance).
- Export: chat exports stream each chat's history as `wardrobe_history` records (count `wardrobeHistory`, `data.wardrobeHistory`; `QtapWardrobeHistoryRecord`; `WardrobeHistory` in `qtap-export.schema.json`). Import (`lib/import/quilltap-import/import-wardrobe-history.ts`, step 7f) mints new ids, remaps `chatId`, `characterId`, `actorCharacterId` and slot item ids that imported with new ids, keeps indices, cursor and dates, and never merges into a timeline already live on the instance. An older bundle's chats seed entry 0 on the first change.
- Backup: `data/wardrobe-history.json` (whole table, manifest count `wardrobeHistory`); restore writes it back through `upsertRows` after the chats (step 22n-ter), with the same id and item remaps as the wear ledger in new-account mode. Replace mode clears `chat_wardrobe_history` first.
- Tests: `export/wardrobe-history-roundtrip.test.ts` (five-entry timeline, cursor at 2), `backup/wardrobe-wear-backup.test.ts`, `backup/uuid-remapper.test.ts`.
- The History tab's and `wardrobe_history`'s one-line summary is plain text now (`describeOutfit`'s Markdown list flattened); it showed raw `**` and `- ` in the dialog. Test: `lib/wardrobe/history/__tests__/describe-entry.test.ts`.
- Docs: `help/wardrobe.md` gains "Looking Back --- the Outfit Record" and lists the two tools (nine `wardrobe_*` tools); `BACKGROUND_JOBS_CHILD.md` notes the `settle` write override; CLAUDE.md gains a chokepoint bullet. The spec moved to `docs/developer/features/complete/wardrobe-outfit-history.md` with an As-built section; ROADMAP ticked.
- Outfit history records who dressed the character. Operator changes (`?action=equip`, `?action=wardrobe-rollback`) store the user's current Speaking As character (impersonation included) in `actorCharacterId`, via the new `operatorWardrobeProvenance` (`lib/wardrobe/history/operator-provenance.ts`). Custom-tool changes store the tool's name in a new nullable column `actorToolName` (written only for `source = 'pascal'`). Migration `add-chat-wardrobe-history-tool-name-v1` adds the column; the seed migration now depends on it. `changedByLabel` reads "the operator, as Bertie" and "Pascal's dress_for_dinner (rolled by Jeeves)"; the history GET returns `actorToolName`. Export schema, DDL.md, help and the spec updated. Tests: repository, migration, `describe-entry`, `outfit.test.ts`, `pascal/wardrobe-effects.test.ts`.
- Verified live: both migrations on a copy of V4test seeded 32 current entry-0 rows for 32 (chat, character) pairs; on V4test a `wardrobe_wear` call appended entry 1, `wardrobe_history` listed it, `wardrobe_rollback` returned to 0 with Aurora announcing, and the History tab's Wear again moved the cursor back to 1.

#### Spec: wardrobe outfit history and rollback

- New design doc `docs/developer/features/wardrobe-outfit-history.md`: a per-character, per-chat record of every outfit change (one entry per Aurora announcement), `wardrobe_rollback` and `wardrobe_history` tools, a cursor that moves back and forward without renumbering, and a History tab with "Wear again" in the Wardrobe dialog. Spec only; no code yet. Indexed in `ROADMAP.md` and `update-documentation.md`.

#### Feature: `{{character}}` placeholder and character-announced custom tools

- New `{{character}}` placeholder: the rolling character's name. It works in outcome messages, the chip label, the consult prompt, effect expressions and wardrobe item references. A run with no character leaves it as written. `classifyPlaceholder` gains a `character` kind; `executeCustomTool` takes `character` in its overrides. `runCustomTool` takes an optional `characterName` (the trigger runner supplies it) and otherwise reads it with `characters.findByIdRaw`. The proving bench renders it when a character is seated.
- New custom-tool field `announceAsCharacter` (boolean, default false). When true and the run has a rolling character, `postPascalResult` sets `customAnnouncer: { kind: 'character', characterId }` on the outcome message. The message keeps `systemSender: 'pascal'` and `pascalMeta`. The Salon, the LLM context's speaker tag, the Courier transcript and the Markdown export already honor `customAnnouncer`. A run with no character is still announced by Pascal.
- Salon: the Staff bar and collapsed chip name a `customAnnouncer` in place of the Staff member (`getAnnouncementSenderName` in `system-message-labels.ts`, fed a character-id name map threaded from `SalonView` as `announcerNames`). Without it a character-announced outcome showed the character's avatar under a "Pascal" bar.
- Workbench: "The character announces it" checkbox in the builder; "Character name" in the outcome message's Insert value menu; the run dialog's reference panel lists `{{character}}`; the tool vocabulary reports it.
- JSON Schema (`public/schemas/qtap-custom-tool.schema.json`) documents both. Help: `help/custom-tools.md`, `help/pascals-workbench.md`.
- Tests: `custom-tools-execution.test.ts`, `run-service.test.ts`, `tool-vocabulary.test.ts`, `tool-draft.test.ts`, `services/pascal/writer.test.ts`, `system-message-labels.test.ts`.

#### Feature: wardrobe picker in Pascal's Workbench

- A *Change the outfit* side effect's items now have a **Choose…** picker (`components/wardrobe/wardrobe-reference-picker.tsx`): outfits and garments by slot, with thumbnail, slot badges, origin chip, a reach note (`wardrobeReachLabel` in `lib/wardrobe/wardrobe-container.ts`), search, a slot filter and an archived filter (on by default for `take_off`, off for `wear`). It fills the reference by title, or by id on request.
- A filled reference renders as a chip with the same particulars and a title/id toggle. A templated reference keeps its text box ("chosen at run time"). A reference the vantage cannot find shows an advisory, not a draft error. With `add_to_slot` or a slot-restricted `take_off`, slots none of the chosen items cover are marked "(not covered)", with a one-line advisory per mismatching item.
- The Workbench browses from a `WardrobeVantage` (`lib/pascal/tool-draft.ts`): a character or a shared wardrobe, defaulted from the file's store by `defaultWardrobeVantage`, chosen with `WardrobeVantageSelect`, shared with the proving bench's *Pick a character* mode. Editor state only; never serialized. Reads go through `useWardrobeVantageItems` over the existing wardrobe hooks; no new route or query key.
- New `lib/wardrobe/wearable-ref.ts` holds the reference lookup rule (`resolveWearableRef`, `matchWearableTitle`, `isTemplatedWearableRef`). `WearablePool.findByTitle` now delegates to `matchWearableTitle`, so the server and the Workbench resolve titles the same way.
- `POST /api/v1/custom-tools?action=preview` returns `wardrobeResolution` when the fact sheet names a character: per wardrobe gesture, each item found (id, title, types, origin, image) or skipped with `resolveWearable`'s reason. A read through `loadWearablePool` / `findInPool` / `resolveWearable` (`lib/pascal/bench-wardrobe.ts`); nothing is worn. The bench's dry-run line now says "would apply" or "would skip" per item when a character is seated.
- Tests: `wearable-ref.test.ts`, `wearable-ref-delegation.test.ts`, `wardrobe-vantage.test.ts`, `wardrobe-container.test.ts` (reach label), `route-preview-wardrobe.test.ts`, `wardrobe-reference-picker.test.tsx`. Help: `help/pascals-workbench.md`, `help/custom-tools.md`, `help/wardrobe.md`.

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

