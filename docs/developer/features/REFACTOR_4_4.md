# Refactor 4.4 — Duplicate Function Consolidation

Working document for a multi-phase consolidation of duplicate / near-duplicate functions across the codebase. Findings come from a clustering pass over 5,103 function/method signatures (3,539 backend, 1,564 frontend). Each phase below lists concrete clusters; check them off as you go.

**Supporting data lives in `./REFACTOR_4_4/`:**

- `clusters-api.txt` — every API-side name cluster with file:line for each definition
- `clusters-frontend.txt` — every frontend cluster
- `extract.py` — extractor (run from repo root, emits JSONL of all signatures)
- `cluster.py` — clustering pass (`python3 cluster.py signatures.jsonl api|frontend`)

To refresh the data: `python3 docs/developer/features/REFACTOR_4_4/extract.py . > sigs.jsonl && python3 docs/developer/features/REFACTOR_4_4/cluster.py sigs.jsonl api`

---

## Phase 1 — Trivial lifts (≈ one afternoon total)

Byte-identical or near-identical copies. No logic to reconcile. Pick a home, move, swap imports.

**Status: complete (2026-05-14).** All 10 items shipped; `npx tsc --noEmit` clean. New utilities live at `lib/utils/{regex,sha256,format-bytes,char-count}.ts`, `lib/embedding/float32-conversion.ts`, plus three hooks (`hooks/use{EscapeKey,ModalState,CopyToClipboard}.ts`) and one wardrobe helper (`decorateOutfitItems` exported from `lib/wardrobe/outfit-description.ts`). The byte-formatter pass picked up two extra local copies in `lib/tools/handlers/self-inventory-handler.ts` and `lib/services/chat-message/recovery.service.ts` (now 20 sites total). Two of the eventual `useCopyToClipboard` migration targets — the Blob-copying variants in `ChatGalleryImageViewModal` and `ImageModal` — were intentionally left alone (image data, not text).

- [x] **Byte formatter (18 copies — biggest single win).** Pick the logarithmic implementation from `components/tools/import-export/utils.ts:6`. Drop in `lib/utils/format-bytes.ts`. Replace all sites:
  - Backend: `lib/llm/courier/render-markdown.ts:44`, `lib/services/file-content-extractor.ts:401`, `lib/tools/capabilities-report.ts:1311`
  - Frontend `formatBytes`: `app/prospero/[id]/components/{DocumentStoresCard.tsx:43, FilesCard.tsx:52, FilesTab.tsx:30}`, `app/salon/[id]/components/CourierBubble.tsx:13`, `app/scriptorium/[id]/components/FileTable.tsx:24`, `app/scriptorium/[id]/page.tsx:16`, `app/scriptorium/components/DocumentStoreCard.tsx:71`
  - Frontend `formatFileSize`: `components/chat/FileConflictDialog.tsx:48`, `components/files/types.ts:52`, `components/import/import-wizard.tsx:61`, `components/tools/capabilities-report-card.tsx:121`, `components/tools/import-export/utils.ts:6`
  - Frontend `formatSize`: `app/salon/[id]/components/DocumentPickerModal.tsx:365`, `components/files/OrphanCleanupModal.tsx:12`, `components/settings/ai-import/AIImportWizard.tsx:107`

- [x] **`useEscapeKey` hook.** 7 identical Escape-key dismiss blocks. New file `hooks/useEscapeKey.ts`. Sites:
  - `app/aurora/[id]/view/components/ExternalPromptDialog.tsx:119` (has `!generating` guard — pass as `enabled` arg)
  - `app/aurora/[id]/view/components/ExternalPromptResultDialog.tsx:22`
  - `components/alert-dialog.tsx:15`
  - `components/character-delete-dialog.tsx:42`
  - `components/characters/ai-wizard/AIWizardModal.tsx:62`
  - `components/characters/optimizer/CharacterOptimizerModal.tsx:99`
  - `components/search/search-dialog.tsx:152`

- [x] **`useModalState` hook.** 3+ identical settings-tab modal triplets (`handleOpenModal`/`handleCloseModal`/`handleModalSuccess`). New `hooks/useModalState.ts`. Sites:
  - `components/settings/api-keys-tab.tsx:106-115`
  - `components/settings/embedding-profiles/index.tsx:65-75`
  - `components/settings/image-profiles-tab.tsx:118-128`
  - `components/tools/llm-logs-card.tsx:22` (handleCloseModal only)

- [x] **`useCopyToClipboard` hook.** 6 copies. New `hooks/useCopyToClipboard.ts` returning `{copied, copy}`. Text-only first; keep `…ToClipboard` image-blob variants separate. Sites:
  - `app/aurora/[id]/view/components/ExternalPromptResultDialog.tsx:30`
  - `app/setup/page.tsx:147`
  - `components/alert-dialog.tsx:23`
  - `components/profile/ProfileInfoSection.tsx:76`
  - `components/chat/ChatGalleryImageViewModal.tsx:93` (Blob — keep)
  - `components/chat/ImageModal.tsx:65` (Blob — keep)

- [x] **`escapeRegex` (4 copies).** New `lib/utils/regex.ts`. Sites: `lib/chat/annotations.ts:73`, `lib/chat/context/mentioned-characters.ts:11`, `lib/database/repositories/base.repository.ts:164`, `lib/memory/about-character-resolution.ts:44`.

- [x] **`sha256OfString` / `sha256OfBuffer`.** New `lib/utils/sha256.ts`. Sites: `lib/mount-index/conversion.ts:63,67`, `lib/mount-index/database-store.ts:50`.

- [x] **`blobToFloat32` / `blobToEmbedding`.** Same impl, two names. New `lib/embedding/float32-conversion.ts` exporting both. Sites: `lib/database/backends/sqlite/json-columns.ts:312`, `lib/embedding/reapply-profile.ts:89` (already has `float32ToBlob` — keep alongside).

- [x] **`decorate(items)` (3 copies).** New `lib/wardrobe/decorate-items.ts` (closest to primary user). Sites: `lib/background-jobs/handlers/scene-state-tracking.ts:184`, `lib/chat/context-manager.ts:982`, `lib/wardrobe/avatar-prompt.ts:70`.

- [x] **`charCountClass` (3 copies).** Lift to `lib/utils/char-count.ts` or a UI helpers module. Sites: `components/clothing-records/clothing-record-editor.tsx:70`, `components/physical-descriptions/physical-description-editor.tsx:101`, `components/wardrobe/wardrobe-item-editor.tsx:370`.

- [x] **`resolveScenarioPath` wrappers.** The two `route.ts` wrappers are hard-coded folder constants around `lib/mount-index/scenarios-common.ts:312`. Delete wrappers; inline the call. Sites: `app/api/v1/projects/[id]/scenarios/[scenarioPath]/route.ts:59`, `app/api/v1/scenarios/[scenarioPath]/route.ts:57`.

---

## Phase 2 — Small effort (under 2 hr each)

Mostly straightforward but have real logic differences to reconcile.

**Status: complete (2026-05-14).** All 6 items shipped; lint, `npx tsc --noEmit`, and all 5,908 unit tests pass. New shared modules: `lib/utils/sleep.ts`, `lib/utils/semver.ts`, `lib/chat-utils.ts`, `lib/startup/pepper-crypto.ts`, `lib/api/state-handlers.ts`. `lib/format-time.ts` grew four new exports (`formatDate`, `formatDateTime`, `formatRelativeDate`, `formatChatListDate`). Crypto refactor is the riskiest change — the existing 43-test pepper/dbkey suite still passes against the shared `encrypt/decryptPepperWithParams` core, with `pepper-vault` keeping its 100k-iteration constants and `dbkey` continuing to read params from the on-disk file.

- [x] **`formatDate` family (10 copies).** Three output shapes: date-only, date+time, relative. Use `lib/format-time.ts` as the home. Provide `formatDate` / `formatDateTime` / `formatRelativeDate`. Use the `import-export/utils.ts:17` version with try-catch as the baseline. Sites: `components/characters/LLMLogsSection.tsx:26`, `components/chat/ChatCard.tsx:159` (relative variant), `components/chat/FileConflictDialog.tsx:57` (date+time), `components/memory/memory-card.tsx:52`, `components/profile/ProfileInfoSection.tsx:13`, `components/tools/capabilities-report-card.tsx:129`, `components/tools/import-export/utils.ts:17`, `components/tools/llm-logs-card.tsx:27`, `components/tools/tasks-queue/TaskItem.tsx:31`, `components/tools/tasks-queue/index.tsx:37`. Added a fourth helper, `formatChatListDate`, for ChatCard's bespoke today/yesterday/weekday/date logic.

- [x] **`transformChatToCardData` + `deleteChat` pair (2 copies).** Salon version fills `participants`; character-conversations version leaves them empty and adds `scriptoriumStatus`. Lift to `lib/chat-utils.ts` with a `context` parameter or two named exports. Sites: `app/salon/page.tsx:64,151`, `components/character/character-conversations-tab.tsx:77,194`. Shipped as two named exports (`transformSalonChatToCardData` + `transformCharacterChatToCardData`) plus a shared `confirmAndDeleteChat` returning a boolean so each caller owns its list-refresh strategy.

- [x] **`sleep` / `sleepSync`.** Two identical `sleepSync` (busy-wait) + one async `sleep`. New `lib/utils/sleep.ts` exporting both. Sites: `lib/database/backends/sqlite/mount-index-client.ts:85`, `lib/file-storage/backends/local/retry.ts:73`, `lib/startup/db-encryption-state.ts:44`.

- [x] **`parseVersion` (3 copies).** Two identical object-return versions; `manifest-loader` returns number-array with `[0,0,0]` fallback. Unify on object return; adapt `manifest-loader` call site. Sites: `lib/plugins/manifest-loader.ts:517`, `lib/plugins/version-checker.ts:53`, `lib/themes/registry-client.ts:67`. `registry-client` re-exports `parseVersion` for the existing test that imports from there.

- [x] **`decryptPepper` / `decryptPepperFromFile`.** Same algorithm; one reads params from file, the other from module constants. Refactor `pepper-vault` to call shared core that takes params. **Crypto path — test carefully.** Sites: `lib/startup/dbkey.ts:209`, `lib/startup/pepper-vault.ts:118`. Shared core lives in `lib/startup/pepper-crypto.ts` (`hashPepper` + `encryptPepperWithParams` + `decryptPepperWithParams`); both callers wrap the bundle with their own metadata.

- [x] **`handleGetState`/`handleSetState`/`handleResetState` factory.** Templatize `createStateHandler({entityType, repoMethod})`. **Risk:** chats' `handleGetState` does project-state merging — preserve. Sites: `app/api/v1/chats/[id]/actions/state.ts`, `app/api/v1/projects/[id]/actions/state.ts`. `lib/api/state-handlers.ts` exposes `createSetStateHandler` and `createResetStateHandler`; `handleGetState` stays bespoke in both routes (chats merges project state, projects uses `checkOwnership`).

---

## Phase 3 — Medium (2–8 hr) / flag before doing

- [ ] **File-storage `BaseStorageBridge`.** Four bridges follow the same template with identical `sanitizeLeafName` + `resolveUniqueRelativePath`. The right move is an abstract base, not just two extracted functions. Sites: `lib/file-storage/{character-vault-bridge,lantern-store-bridge,project-store-bridge,user-uploads-bridge}.ts`.

- [ ] **Registry base completion.** `AbstractMapRegistry` already covers three of five registries. Move `SystemPromptRegistry` and `ThemeRegistry` onto it. They have non-standard error shapes that need reconciling. Sites: `lib/plugins/system-prompt-registry.ts`, `lib/themes/theme-registry.ts`.

- [ ] **`getApiKey*` variants (5 places).** The two `getApiKeyForSelection` are duplicates. Consolidate to one `getApiKeyForConnectionProfile(profileId, userId)` in a new `lib/services/api-key.service.ts`; leave `getApiKeyForProvider` specialized (returns envelope with baseUrl). Sites: `lib/embedding/embedding-service.ts:117`, `lib/llm/pricing-fetcher.ts:305`, `lib/memory/cheap-llm-tasks/core-execution.ts:66`, `lib/services/auto-configure.service.ts:121`, `lib/services/dangerous-content/gatekeeper.service.ts:111`.

- [ ] **Per-entity repository pass-through overrides.** 30+ repos. Some override `findById`/`findAll` for real reasons (e.g. `characters.repository.ts` applies document-store overlay; `memories.repository.ts` registers BLOB columns). Others are pure pass-throughs. Audit each; delete the no-ops; document the load-bearing ones in `base.repository.ts`. **Use `git blame` on each before deleting** — some may be deliberately stubbed for future hooks. List in `clusters-api.txt` under `findById` / `findAll`.

- [ ] **`user-scoped.ts` pure-delegation wrappers.** `UserScopedRepository<T,R>` base already covers CRUD. Tags, ImageProfiles, EmbeddingProfiles subclasses look like pure delegation. Delete the redundant subclasses. Test the user-scoping behavior survives.

---

## Phase 4 — Investigate first

- [ ] **`fetchProfiles` / `fetchProviders` / `fetchModels` reimplemented despite hooks existing.** Canonical: `hooks/useConnectionProfiles.ts:15`, `hooks/useProviders.ts:18` (both with caching + dedup). Reimplemented across 8+ components. **Before touching:** find out *why*. Circular import? Render-order? Or just discovery failure? Sites: `app/aurora/new/page.tsx:103`, `components/characters/ai-wizard/hooks/useAIWizard.ts:74`, `components/chat/SelectLLMProfileDialog.tsx:60`, `components/image-profiles/{ImageProfilePicker.tsx:43, ImageProfileForm.tsx:97,131}`, `components/settings/api-keys/ApiKeyModal.tsx:54`, `components/settings/ai-import/hooks/useAIImport.ts:74`, `components/settings/connection-profiles/ProfileModal.tsx:72` (`fetchModelsForEdit`), `components/setup-wizard/wizard-api.ts:15,76`.

---

## Phase 5 — Big mechanical refactor (do when touching adjacent code)

- [ ] **Shared icon module.** 20+ inline SVG duplicates: `FolderIcon` × 7, `CloseIcon` × 4, `ImageIcon` × 4, `TrashIcon` × 3, `CheckIcon` × 3, `ChatIcon` × 3, plus `DatabaseIcon`/`PencilIcon`/`RefreshIcon`/`ChevronUpIcon` × 2. No shared icon module exists (only `components/ui/ChevronIcon.tsx`). Build `components/ui/icons/`. **High UI-regression surface** — a few `FolderIcon`s differ in `fill` defaults (`'none'` vs `'currentColor'`). Do it when there's an icon-touching reason; visually QA each site.

---

## Skip (not actually duplicates)

| What | Why |
| --- | --- |
| Chat-messages 3-layer (`chats-messages.ops.ts` → `chats.repository.ts` → `user-scoped.ts`) | Storage / composition / security-boundary split. Intentional. |
| `handleGet` / `handleDelete` route handlers (5–6 files each) | Same signature, very different bodies. Templating would force a lowest-common-denominator. |
| `getModelPricing` tiers | `pricing-fetcher` (async, cache-aware) / `pricing.ts` (sync, fallback wrapper) / `provider-registry` (raw plugin). Three legit layers — document with JSDoc instead. |
| `estimateTokens` variants | `tokens/token-counter.ts` provider-aware with safety buffer; `chunker.ts` deliberately cheap `text.length/4`; `tools/route.ts` job-specific. |
| `mimeForDocument` vs `mimeForMountFile` | Different input types, different MIME strategies. |
| `getAvatarSrc` (6 places) | One canonical in `components/ui/Avatar.tsx:72`; the others are legitimate closures over component state plus one cache-busting variant. |
| `handleSubmit`/`handleSave`/`handleDelete`/`handleClose` huge clusters | Component-local idiom, not duplicate work. |
| Per-entity typed repository CRUD (`findById`/`findAll`/`update`/`create`/`delete` × 30+) | Typed wrappers over `base.repository.ts`. Pass-through audit is in Phase 3; the wrapper layer itself is intentional. |

---

## How to pick this back up

Pick a phase. Pick a checkbox. The file:line lists are exhaustive — every site is named. If you want to re-discover or look for new clusters, re-run `extract.py` + `cluster.py`; the `.txt` outputs in `REFACTOR_4_4/` are the last full pass.
