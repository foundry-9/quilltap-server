# Refactor 4.13 — Dead code knip cannot see, legacy shims, and the last raw token colours

**Status:** Proposed (2026-11-10), written against `HEAD` = 167d06503. Part of the [4.13 refactor set](refactor-4-13.md). Behaviour-neutral throughout; a good warm-up. Fixes #179 and #180 in passing (both are one-line fixes with no better home).

Every "unused" claim below was checked by whole-word `rg` across tracked files, but not for symbols reached through string-built dynamic imports, registries or plugins. **Re-check each one immediately before deleting it** and leave anything with a live reference.

## 1. What the last sweep could not see

The release-checklist dead-code sweep (#161, `docs/developer/DEAD-CODE-REPORT.md`) ran knip. knip reports 0 unused files and 0 unused dependencies, and its 1,506 unused exports match the report's kept list. Two blind spots remain: knip treats test files as entry points, and `knip.json` ignores `migrations/lib/**`.

### 1.1 A dead tree under `migrations/lib`

`migrations/lib/json-store/**` and `migrations/lib/file-manager.ts`: about 5,100 lines of TypeScript with no importer outside themselves (verified: the only references are within the pair and `migrations/README.md:47-50`). The files `migrations/lib` still needs are `legacy-wardrobe-rows.ts`, `secrets.ts`, `logger.ts`, `progress.ts`, `database-utils.ts` and `mount-index-schema.ts`.

Delete the tree, update the README, and narrow `knip.json`'s `migrations/lib/**` ignore so this cannot recur. While in `knip.json`: drop the stale `tar` (ignoreDependencies), `du` (ignoreBinaries) and the `lib/chat/context/index.ts` entry pattern, all of which knip itself flags.

### 1.2 Exports kept alive only by their own tests

Production code never calls these; delete each with its test, unless the re-check finds a caller:

- `lib/api/responses.ts`: `deprecatedRedirect`, `withDeprecationHeaders`, `buildRedirectUrl`
- `lib/atlas/item-mutations.ts`: `setAtlasEntryArchived`; `lib/atlas/match.ts`: `firstAtlasMention`
- `lib/chat/turn-control.ts`: `hasActiveTurn`
- `lib/embedding/embedding-service.ts`: `prepareForSearch`, `getUserEmbeddingProfiles`; `float32-conversion.ts`: `float32ToBlobRaw`; `vector-store.ts`: `getCharacterVectorStore`
- `lib/help/help-doc-chunking.ts`: `HELP_SECTION_EMBEDDING_MAX_TOKENS`
- `lib/llm/cheap-llm.ts`: `RECOMMENDED_CHEAP_MODELS`
- `lib/memory/policy-protection.ts`: `partitionByPolicyProtection`
- `lib/mount-index/tiered-mount-pool.ts`: `classifyMountTier`; `lib/scenarios/location.ts`: `classifyScenarioMount` (CLAUDE.md names `classifyMount` in `reach.ts` as the reverse classifier; these two look superseded)
- `lib/navigation/route-flags.ts`: `getRouteFlags`
- `lib/pascal/tool-vocabulary.ts`: `isEmptyVocabulary`
- `lib/photos/photo-link-summary.ts`: `getPhotoLinkSummaryByFileId`
- `lib/repositories/dry-scope.ts`: `dryScopeDiscardedWrites`
- `lib/services/host-notifications/writer.ts`: `postHostNoUserCharacterAnnouncement`
- `lib/services/llm-logging.service.ts`: `messageHasLogs`, `getLogsForUser`, `deleteAllLogsForUser` (also mocked in `jest.setup.ts`; but see the [import/restore spec](refactor-4-13-import-restore-insert-and-remap.md) §4.2, where "delete all my data" should be calling a full log delete — check before removing)
- `lib/settings/registry.ts`: `topLevelCardsOf`
- `lib/startup/db-encryption-state.ts`: `isDatabaseEncrypted`
- `lib/terminal/clean-output.ts`: `cleanTerminalOutput`
- `lib/themes/utils.ts`: `themeColorsToCSS`, `themeTokensToStyleObject`, `mergeWithDefaultTheme`, `themeTokensEqual`, `getThemeDifferences`; `default-tokens.ts`: the five `getDefault*` getters
- `lib/tools/effects.ts`: `highestToolEffect`
- `lib/wardrobe/folders.ts`: `normalizeWardrobeFolderName`, `wardrobeFolderStorePath`; `history/describe-entry.ts`: `staleItemsOf`; `wardrobe-container.ts`: `sameWardrobeContainer`
- `lib/memory/cheap-llm-tasks/chat-tasks.ts`: `summarizeChat`, `updateContextSummary` (re-exported from the index, no other caller; about 90 lines with their prompts)
- `components/chat/lexical/typeahead/useTypeaheadShell.tsx:90`: `$insertWithTrailingSpace`; `components/settings/embedding-profiles/types.ts:89`: `PROVIDER_COLORS` (and its README line)

Leave what the report deliberately keeps: the plugin registry accessors (registry symmetry), `lib/themes/crypto.ts`'s signing and verification API (and see the index's note on signature verification before touching it), `pepper-vault.ts`'s legacy unlock path, `invalidateAllFrozenArchives`, the `__reset*ForTests` helpers, and the reserved `ErrorCode` members.

### 1.3 API actions with no caller found

Verify against the CLI (`packages/quilltap`), the Electron shell and the help docs before removing; template-literal `?action=${verb}` callers hide from a grep.

- `POST /api/v1/files?action=cleanup-stale`
- `POST /api/v1/chats/[id]?action=active-document` (API.md calls it "legacy single-pane")
- `POST /api/v1/mount-points/[id]?action=embed`

## 2. Legacy shims

| Shim | State | Action |
|---|---|---|
| `lib/background-jobs/processor.ts` `processNextJob` / `processJobs` | Return false / zeros and log a deprecation warning; only re-exported (`index.ts:39-40`) and mocked by tests | Delete; update the tests that mock the names |
| `components/providers/sidebar-provider.tsx` | Every callback is a no-op and `isCollapsed` is always true; one consumer left (`components/layout/left-sidebar/profile-menu.tsx:20`) | Delete the provider; the consumer uses the constant |
| `components/providers/chat-context.tsx` | `ChatProvider` is never mounted, so `useChatContext()` (used in `SalonView.tsx`) always returns its empty fallback | **Done** in the [Salon stream-lifecycles spec](refactor-4-13-salon-stream-lifecycles.md) §9: repurposed as `ChatActionsProvider` and mounted by `SalonView` |
| `NEXT_PUBLIC_WORKSPACE_TABS` (`lib/config/feature-flags.ts:22`) | On unless set to `'0'`; nothing sets it; two readers | Decision 1 |
| `app/salon/[id]/hooks/useFileAttachments.ts:51` `fileInputRef` | Never attached to an element; the real input's ref is in `ChatComposer` and is never reset (#179) | Fix #179 by resetting `e.currentTarget.value` in `handleFileSelect`; delete the orphan ref |

Seven Mongo-era migrations with "no-op for SQLite" bodies stay: they keep migration history consistent.

## 3. Leftovers

- **Client `console.debug`**: about 20 in non-test client source (`useCharacterAutosave.ts:199, 221`, `NewCharacterView.tsx:194`, `auto-lock-provider.tsx:56`, `realtime-provider.tsx:41`, the diagram and Lexical plugins, `BoundedNumberInstanceSetting.tsx:100`, `BrahmaConsoleSettings.tsx:44`) and five in `lib/download-utils.ts`. #156 pruned client debug traces; these are what it missed. Remove, or keep the few that report a real failure as `console.warn`.
- **`eslint-disable` justifications that cite SWR**: 19 comments explain themselves by a library that is gone (`HelpChatDialog.tsx:166, 174`, `tag-style-provider.tsx:40`, `AutoLockSettingsCard.tsx:42, 49`, `useFilePreview.ts:91`, …). 45 of the 148 disables have no `--` justification at all. For each: remove the disable if the rule now passes, otherwise write the true reason.
- **`as any` hiding a type hole** outside the repositories (those are in the [queue and translator spec](refactor-4-13-queue-and-query-translator.md)): `lib/background-jobs/handlers/scene-state-tracking.ts` (about 10 casts of an LLM result that should be a Zod schema); `(global as any).__quilltapDbKeyState` in `instrumentation.ts` and `system/unlock/route.ts` (a typed `globalThis` declaration); `getRepositories() as any` at the terminal sites; `(chat as any).chatType` in the help-chat routes; `useSSEStreaming.ts:556` `frame.result as any`, which contradicts the `StreamFrame` rule.
- **#180**: `components/memory/memory-editor.tsx:53`, `||` → `??`.
- **Undocumented environment variables**: `SQLITE_CACHE_SIZE`, `SQLITE_FOREIGN_KEYS`, `QUILLTAP_SKIP_CLOUD_MATERIALIZE`, `QUILLTAP_CLOUD_MATERIALIZE_STALL_MS`, `ELECTRON_DEV`, the two names for the official registry key. Document them where the others are documented, or remove the reads.

## 4. Raw token colours and repeated clusters

Release checklist 7 (#158) moved every Tailwind **palette** colour to `qt-*`. What remains are the shadcn-style **token** colour utilities: 689 occurrences in 232 files.

| Raw utility | Occurrences | Becomes |
|---|---|---|
| `text-foreground` (+ `hover:` forms) | 334 + 56, in 166 files | `qt-text` (and the hand-written, escaped `hover:qt-text` state form in `_utilities.css`) |
| `text-primary` (+ hover forms) | 121 + 14, in 66 files | `qt-text-brand` |
| `focus:ring-ring` / `focus:ring-primary` / `focus-visible:ring-ring` | 43–51, in 25 files | a new `qt-focus-ring` utility (none exists) |
| `bg-background` | 31 | `qt-bg-default` |
| `border-input` | 19 | `qt-border-default` or `qt-input` |
| long tail (`text-muted-foreground`, `ring-primary`, `bg-accent`, `bg-popover`, `divide-border`) | about 26 | their `qt-*` equivalents |
| arbitrary-value colours (`bg-[#…]`, `text-[var(…)]`) | 13 | a token or a `qt-*` utility |

Confirm each mapping against `app/styles/qt-components/_utilities.css` before a bulk replace; do not invent a class. Remember the rule CLAUDE.md states: a `qt-*` token with a Tailwind variant prefix resolves to nothing unless its state form is written out by hand, escaped, in `_utilities.css`. `npm run lint` checks it; `lint:fix` does not.

Component classes that already exist and are not being used:

| Hand-spelled cluster | Where | Use |
|---|---|---|
| `block text-sm qt-text-primary mb-2` | 18 files / 53 uses | `qt-label` (185 uses already) |
| `h-4 w-4 mt-1 rounded border-input text-primary focus:ring-primary` | 5 files, settings | `qt-checkbox` (112 uses) |
| `w-full px-3 py-2 border …` without `qt-input` | 16 files / 22 uses | `qt-input` (267 uses) |
| `flex items-center justify-center py-8` / `py-12` | 29 files / 33 uses | `qt-empty-state` (exists, 2 uses) or a new `qt-loading-state` |

Candidates for a new class, in order of value: `qt-option-card` (`flex items-start gap-3 p-4 border rounded cursor-pointer qt-border-default qt-hover-accent`; the four-class subset is in 28 files), `qt-panel` (`border qt-border-default rounded-lg p-4`; 31 files), `qt-page-center` (5 files / 11 uses). Thirteen expandable cards under `app/prospero/[id]/components/` and `app/aurora/groups/components/` hand-copy one header (`w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors`); eleven of them omit `aria-expanded`. `components/ui/CollapsibleCard.tsx` already supports controlled mode and sets it; move the thirteen onto it rather than adding a class (150–190 lines, and it closes a WCAG 4.1.2 gap).

Layout-only clusters (`flex items-center gap-2 flex-wrap`, `flex items-center justify-between gap-2`) are not worth a class.

After any change under `app/styles/qt-components/`: `npm run generate:storybook-css`, bump `packages/theme-storybook`'s patch version (it publishes at release; no manual `npm publish`), and consider the bundled themes and `create-quilltap-theme`.

Twelve settings links are hand-spelled strings instead of `lib/settings/hrefs.ts` builders (`embedding-profiles/ProfileList.tsx:189, 209, 229`, `concierge-settings/UncensoredDeskCard.tsx:109, 111`, `new-chat/NewChatForm.tsx:464`, `useNewChat.ts:632`, `chat/ConciergeOffDutyHint.tsx:12`, …). All resolve in the registry today; move them to the builders so they keep resolving.

## 5. Phases

1. `migrations/lib/json-store` and `file-manager.ts`; `knip.json`.
2. Test-only exports (§1.2), in batches by directory, re-checking each.
3. Shims (§2); #179, #180.
4. Leftovers (§3).
5. Token colours, one family per change (`text-foreground` first), then the existing component classes, then `CollapsibleCard` for the thirteen cards, then any new class with the storybook regeneration.

## 6. Gates

`npx tsc`, `npm run test:unit`, `npm run lint` (all four gates) after each batch. Update `docs/developer/DEAD-CODE-REPORT.md` with what was removed and what was re-checked and kept. Expected size: about 5,100 lines from `migrations/lib`, 600–900 from test-only exports and their tests, the rest small. Low risk; the token-colour phase needs a look at each bundled theme in light and dark (`/release-checklist-13-ui`).

## 7. Decisions for the human

1. `NEXT_PUBLIC_WORKSPACE_TABS`: remove the flag and the legacy per-surface branch, or keep it as a rollback path?
2. `migrations/lib/json-store`: delete (proposed), or does anything outside this repo still run the Mongo-era migrations?
3. The three caller-less API actions: remove, or keep for the CLI?
