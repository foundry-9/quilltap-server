# Quilltap Changelog

## Recent Changes

### 4.12-dev

#### Refactor: one document core for Document Mode and the `doc_*` tools (Refactor 4.12, spec 2)

- Fix (#133): a Document Mode save or rename into a store now re-indexes whenever the path lands in a store (`mountPointId`), not only in `document_store` scope. A `project`-scope save into a project's official store used to skip the chunk/embed pass until the next periodic scan. Operator saves now also re-index hard-link siblings, as tool writes do.
- Fix (#134): Document Mode and `doc_read_file` read an uploaded blob through one reader, `readDatabaseBlobForDocument` (`lib/mount-index/database-store.ts`): a native-text upload (.md, .txt, .json, .jsonl) is read as its own bytes, any other kind as its converted extracted text. `doc_read_file` used to return the extracted text for an uploaded `.md` while the editor showed the bytes.
- New `lib/documents/core/`: `readDocument` (the one blob fallback), `writeDocument` / `afterDocumentWrite` (the one refresh, gated on `mountPointId`, link siblings included), `ensureDocument` (creates through the writer), `renameDocument` + `computeRenameTarget`, `sweepChatDocumentsAfterMove`, `deleteDocument`, `statDocument` / `documentExists`, `viewTargetFor`, and the three document errors. `operator-doc-actions.ts` keeps access contexts, operator path resolution, blank-document naming, the open and editor-write compositions, qtap target classification and store listing (668 → 388 lines).
- `operator-doc-http.ts` gains `resolveDocumentForRoute`, `openDocumentResponse` / `openedDocumentPayload` and `recentDocumentsResponse`; `operator-doc-actions.ts` gains `storeOptionFor`, which the chat route's `accessible-stores` default branch now uses. Rename and delete take the path the route already resolved instead of resolving it twice. Response shapes are unchanged, except that a Document Mode rename of a file that is no longer there is now a 404 (was a 500), and the editor allows a case-only rename on disk.

#### Fix: theme-storybook stories use only real `qt-*` classes

Several stories used classes the app never defined, so those elements rendered unstyled. The stories now copy the app components' class names and markup. No CSS changed.

- Badges / ThemeComparison: dropped `qt-badge-default`, `qt-badge-outline-{primary,success,warning,destructive}`, `qt-badge-provider-{anthropic,google}`; added `qt-badge-info`; provider badges are the five embedding providers, standing alone as in `ProviderBadge`.
- Chat: announcement-bar chevrons are SVG glyphs as in `AnnouncementChip`; `qt-typing-indicator` is replaced by the `qt-thinking-indicator` quill from `QuillAnimation` / `StreamingMessage`; confirmation badges match `ConfirmationBadge`. `qt-chat-system-bar-chevron-down` and `qt-confirmation-badge-label` stay, because the app uses them as unstyled hooks.
- Tabs: the Navigation Bar demo uses `qt-navbar` > `qt-navbar-container` > `qt-navbar-section` with `qt-navbar-toggle` buttons, plus a scoped base-layer reset standing in for Tailwind preflight. Links no longer underline and the action buttons no longer wrap below the links.
- theme-storybook 1.0.100. The "Pre-existing gaps" note in `docs/developer/features/refactor-4-12/storybook-css-diff.md` is marked resolved.

#### Build: theme-storybook CSS is generated (Refactor 4.12, spec 1)

`packages/theme-storybook/src/css/qt-components.css` is now build output instead of a hand-written copy of the app's `qt-*` CSS. The copy was missing 334 of 893 classes and carried 7 the app had deleted.

- `npm run generate:storybook-css` (`scripts/generate-storybook-css.mjs`, core in `scripts/lib/storybook-css.mjs`) compiles `app/styles/qt-components/` with Tailwind's `compile` against the app's token map, expands every `@apply`, autoprefixes, and keeps statement-level comments. Output is deterministic.
- `npm run lint` runs a fifth gate, `scripts/check-storybook-css.mjs`, which fails when the committed file differs from a fresh generation.
- The `@theme inline` token map and the class-based `dark` variant moved from `app/globals.css` to `app/styles/theme-tokens.css`, imported by both. The app's compiled CSS is byte-identical.
- theme-storybook 1.0.99: the generated file (hover now inside `@media (hover: hover)`, `--qt-*` defaults on `[data-theme]` as in the app); `ThemeDecorator` always sets `data-theme`, a `light`/`dark` class and `data-color-mode`; the Tabs story no longer uses the deleted `qt-tab-content`; `quilltap-defaults.css` re-declares the `--color-*` aliases on the story container, so dark mode actually applies in Storybook (it never did: the aliases resolved once on `:root`).
- theme-storybook publishes at release: new `publish-theme-storybook` job in `release.yml`, skipped when the version is already on npm. CLAUDE.md's per-change mirror and publish rule is replaced by "run the generator, bump the patch version".
- Diff report: `docs/developer/features/refactor-4-12/storybook-css-diff.md`. Test: `__tests__/unit/scripts/generate-storybook-css.test.ts`.

#### Docs: Refactor 4.12 specs

Seven proposed deep-refactor specs for code the 4.12-dev cycle touched, with an index that ranks them and lists what was examined and left alone. No code changes.

- `docs/developer/features/refactor-4-12.md` (index) and one spec each for: generating the theme-storybook `qt-components.css` from the app CSS instead of mirroring it by hand; one document core behind the operator's Document Mode routes and the `doc_*` tools; one image transport budget on the way to a provider; one tier walk with the reach rules settled; the Salon's SSE protocol as a tagged union; the remaining Wardrobe / Inventory browser pairs and the `FileBrowser` retirement decisions; one recursive watcher core under both filesystem watchers.
- Each spec names the bugs it would file first and the decisions it needs. `ROADMAP.md` gains a "Refactor programmes" section; the documentation index lists the new files.

#### UI: WCAG 2.2 AA pass (release checklist 13)

Contrast table, axe sweep of every bundled theme in light and dark, and a component audit of this cycle's UI changes.

- Accent hovers: `.qt-settings-toggle-row`, `.qt-storyteller-mode-option`, `.qt-floating-dialog-close` and `.qt-intervene-toggle` now set `--color-accent-foreground` on hover. They kept the resting text colour on the accent fill, which dropped to about 1.4:1 on Art Deco dark, Great Estate dark and Madman's Box.
- Ten raw `hover:bg-accent/50` call sites (memory cascade dialog, prompt/subprompt/progression cards, library file picker, connection-profile drag handle) now use `hover:qt-bg-surface-hover`.
- Alerts: `qt-text-small` / `-muted` / `-secondary` / `-xs` inside a `qt-alert*` inherit the alert foreground; links inside alerts inherit it too and are underlined (1.4.1). `qt-link`'s muted grey was 3.6-4.1:1 on the warning tint.
- `.qt-footer-path` and `.qt-chat-system-bar-time` no longer use opacity (2.9:1 and 3.0:1).
- Settings-page tabs over a story background: inactive tint 85/15 to 90/10 (muted label was 4.3:1).
- Earl Grey `--text-400` 45.5% to 43% (light) and 59% to 61% (dark); Rains dark `--text-400` 59% to 61%.
- Art Deco light: `--qt-brand-fg` gold to `--deco-bronze` (the brand word was 1.1:1 on parchment), link and footer hover to the primary navy; dark keeps the gold. Great Estate light: brand and the same hovers to `hsl(43 70% 28%)` (was 1.7:1); dark keeps the gold.
- Earl Grey and Rains: the `.qt-alert-*` overrides coloured text with `--X-100` in both modes (warning was 2.4:1 on white); they now use the per-mode `--qt-alert-*-fg` tokens.
- Light-mode alert text darkened to clear 4.5:1 on the alert tint: success in Art Deco, Earl Grey, Great Estate, Old School and Rains (were 3.9-4.5:1); Earl Grey info; Great Estate warning.
- Theme versions: Art Deco 1.0.14, Earl Grey 1.3.11, Great Estate 1.0.11, Old School 1.0.15, Rains 1.3.15.
- `SlideOverPanel` is `inert` while closed. It stays mounted off-screen for the slide, and its controls (the LLM Inspector's filter, refresh, close and log rows) were in the Tab order beyond the viewport edge, where the focus trap held keyboard users. Test: `__tests__/unit/components/ui/SlideOverPanel-inert.test.tsx`.
- `.qt-chat-system-bar`, `.qt-chat-announcement-chip` and `.qt-mention-chip` get a 2px ring on `:focus-visible`; focus was shown only by a faint tint.
- Workspace tab strip (`components/workspace/TabStrip.tsx`): tabs were `div role="tab"` with no tabindex, so they could not be reached by keyboard, and nested the close button. Each tab is now a `button role="tab"` with roving tabindex; arrows / Home / End move and select, Delete closes. The close cross is `aria-hidden`, `tabIndex={-1}`. New `.qt-tab-select`; focus ring drawn on the tab. Close cross opacity 0.55 to 0.8. Test: `__tests__/unit/components/workspace/tab-strip-keyboard.test.tsx`.
- Names and states: Markdown toolbar buttons get `aria-label` (were named "B", "I", "H1"; the glyph is kept where the words lack it, e.g. "Heading 4 (H4)"); code-block button `aria-pressed`; `aria-pressed` on search type chips, wardrobe slot filters, wardrobe dialog view switch, announcement character picker, setup role picker, and the Aurora favorite / Carina / user-control toggles; `aria-expanded` on the RNG custom-roll and Prospero files card toggles; emoji-only file-browser buttons get labels with the glyph `aria-hidden`; search "(3/10)" button gets a label.
- Staff announcement bars dropped an `aria-label` that replaced their visible text (2.5.3); collapsed-sidebar avatar label includes the visible queue number.
- Aurora favorite star: 24px minimum target (was 14x17).
- theme-storybook 1.0.98: mirrors the above and ports the alert, footer, settings-shell and settings-background families.

#### UI: undefined CSS custom properties repointed at real tokens

Release-checklist item 13. About 105 declarations in `app/styles/qt-components/` read custom properties the app never defines (`--primary`, `--muted`, `--border`, `--foreground`, `--card`, `--accent`, `--destructive`, `--background`, `--input`, `--qt-primary`, `--qt-border`, `--qt-text-primary`, `--qt-text-secondary`, `--qt-text-muted`). Each such declaration was invalid at computed-value time, so the rule fell back to inherited or initial values on every theme.

- Affected: the help dialog (composer, nav buttons, suggested links, entity picker, guide search/topics/reader, welcome card), Document Mode chrome (dividers, header, title input, toolbar, status bar, URI bar), Lexical checkboxes and links, links in Salon messages, emoji picker and typeahead secondary text, the chat sidebar resizer, the memory-source highlight, and the formatting-button and NanoGPT badge hovers.
- `hsl(var(--X))` → `var(--color-X)`; `hsl(var(--X) / N)` → `color-mix(in srgb, var(--color-X) N%, transparent)`; `--qt-primary` → `--color-primary`; `--qt-border` → `--color-border`; `--qt-text-primary` → `--color-foreground`; `--qt-text-secondary` / `--qt-text-muted` → `--color-muted-foreground`. Per-theme hook variables are kept as the first `var()` argument; only fallbacks changed. Hooks with no default (`--qt-content-bg-hover`, `--qt-badge-primary-border`) now fall back to `--color-muted` / `--color-primary`; `--qt-primary-fg` falls back to `--color-primary-foreground` instead of `#fff`.
- The Document Mode title input and the help entity-picker filter regain a visible focus indicator (WCAG 2.4.7).
- New lint gate `scripts/check-css-vars.mjs` (in `npm run lint`): fails on any `var()` in `app/**/*.css` whose property is not declared in app or bundled-theme CSS or set from TypeScript, unless it has a fallback that itself resolves. Fallbacks are checked even when the property is defined. Also rejects `hsl()` around `--color-*` / `--theme-*`. Escape hatch: `css-var-exception` on the line.
- `@quilltap/theme-storybook` mirrors the fixes and gains the help dialog, Document Mode, sidebar resizer, memory-highlight and message-link families it was missing.

#### Docs: draft 4.12.0 release notes

- New `docs/releases/4.12.0.md` (`draft: true`), covering the cycle since 4.11.0.

#### CLI: README native-module note corrected

Release-checklist item 12. No CLI commands, flags or completions changed since 4.11.0; the completion coverage tests pass.

- `packages/quilltap/README.md` said no native module is ever compiled. Corrected: the SQLCipher driver and `sharp` are prebuilt and the driver is never rebuilt; `node-pty` compiles on Linux, and `sharp` / `node-pty` are rebuilt automatically after a Node.js upgrade.

#### Tests: backup/restore coverage for 4.12 columns

Release-checklist item 10. Both new 4.12 columns (`chat_messages.isEstablishedFact`, `connection_profiles.maxImagesPerRequest`) were already in backup, restore, `.qtap` export/import, the export schema and DDL. `maxImagesPerRequest` had no restore test.

- `__tests__/unit/lib/backup/restore-field-fidelity.test.ts`: a stored cap restores unchanged, and an archive older than the column restores with the default of 4.

#### Tests: release-checklist coverage pass

Release-checklist item 2. Tests for 4.12 modules that had none; committed in 4310d435f with the file-provider change.

- `__tests__/unit/migrations/reindex-chat-message-fts-character-only.test.ts`: rebuilds a pre-#121 index (old insert trigger, Staff rows indexed), confirms search returns them, then checks the migration replaces the trigger and drops Staff and announcement rows.
- `__tests__/unit/migrations/add-profile-max-images-per-request.test.ts`: column added, existing profiles backfilled to 4, user-set caps kept on rerun.
- `__tests__/unit/lib/mount-index/item-folder-routes.test.ts`: only create-folder provisions a store; unresolved locations and refusals answer through the caller's responses.
- `__tests__/unit/hooks/useFixedMenu.test.ts`: up/down placement; closes on resize and on scroll outside its container.
- `__tests__/unit/lib/hooks/use-container-catalogue.test.tsx`: sorting, unnamed-row placeholders, characters read settles on failure.
- `__tests__/unit/components/item-browser/useFolderBrowserState.test.tsx`: per-container and per-view state reset, folder create/rename/delete handlers.

#### Document Mode: no direct filesystem access in the operator actions

Release-checklist file-provider audit. `lib/documents/operator-doc-actions.ts` imported `fs/promises` directly; it no longer does.

- New `statResolvedFile`, `moveResolvedFile` and `deleteResolvedFile` (`lib/doc-edit/path-resolver.ts`, exported from `lib/doc-edit`) sit beside `readFileWithMtime` / `writeFileWithMtimeCheck`. `documentViewTargetFor`, `renameDocumentFile`, `deleteDocumentFile` and `resolvedPathExists` use them.
- `statResolvedFile` returns null only for a missing path (ENOENT / ENOTDIR); other errors such as permission failures now throw. Previously delete reported any stat error as not-found, and rename treated any access error as a free destination.
- Test: `lib/doc-edit/__tests__/resolved-file-ops.test.ts`.

#### Salon avatars: full-size view and carried items

- Clicking the picture in a message row's desktop avatar opens it in the Salon image viewer (`ImageModal`), the same one Aurora's announcement thumbnails use. `Avatar` takes a new `onImageClick` prop that wraps only the picture, not the name/title.
- Below the name and title, above the provider/route badge, the avatar now lists every inventory item the character has equipped in the chat, by glyph (SVG, else emoji, else a two-letter abbreviation), each with a `Tooltip` showing the full name and description.
- New `useChatCarriedItems(chatId, characterId)` (`lib/hooks/use-inventory.ts`) shares the `?action=inventory` query and cache entry with `useChatInventory`, so the column costs one request per chat and refetches on the `chats` realtime topic.
- `InventoryGlyph` takes `fallback: 'abbreviation'` (`inventoryAbbreviation`); the emoji glyph no longer sets a native `title`.
- `getMessageAvatar` (`SalonView.tsx`) now returns `characterId`; `MessageRow`'s memo compares it.

#### Green Room: multi-slot picks fill every slot they cover

When a character dressed themselves at chat start (`llm_choose`), the cheap LLM often listed a multi-slot garment (a dress covering top and bottom) under only one slot. The parser kept it only there, so the other slot stayed empty. Composites were already spread by `dissolveCompositesInSlots`; plain multi-slot items were not.

- New `spreadAcrossCoveredSlots` (`lib/wardrobe/slot-ops.ts`): puts every item in a snapshot into every slot its `types` declare, appended as the outermost layer.
- `applyOutfitSelections` runs it on the LLM's pick after dissolving composites.
- The outfit-selection prompt now says a multi-slot item is worn in all the slots it covers.
- The wardrobe dialog's single-slot `add_to_slot` is unchanged.
- Help: `help/wardrobe.md`.

#### Connection profiles: most images per request

Some vision models reject a request that carries more than four images. A Salon turn could send more than that (this turn's uploads, uploads the character had not seen, and every Lantern image since the character last spoke), and the whole turn failed.

- New `connection_profiles.maxImagesPerRequest` (INTEGER, default 4; migration `add-profile-max-images-per-request-v1`). Read only through `resolveMaxImagesPerRequest()` in `lib/llm/connection-profile-utils.ts`; request bodies validate through `parseMaxImagesPerRequest()` (1–50).
- `adaptMessagesForProfile` (`lib/chat/message-attachment-adapter.ts`) enforces the cap: images past it are replaced by their descriptions. The newest messages' images are kept first. `findImagesOverCap` picks the overflow.
- Salon context build (`context-builder.service.ts`): the Lantern walk spends the cap newest-first after uploads and re-sent uploads, and describes older images instead of sending them. The adapter then runs on the final array to catch uploads over the cap.
- Fallback chain (`provider-failover.service.ts`): each understudy gets the array re-adapted for its own cap.
- Profile editor: "Most images per request" field under the vision checkbox. Create/update routes accept the field.
- Restore and `.qtap` import seed the default for older archives (`seedLegacyConnectionProfileFields`). Export schema and DDL updated.
- Help: `help/connection-profiles.md`.

#### Prompt trust, part two: "the probation"

Long-running companion characters kept the user's persona on probation. They tallied the persona's slips, attached terms to their own yes, corrected small things, told the user what they "really" meant, and never finished forgiving. Design: `docs/developer/features/prompt-trust-the-probation.md`.

- Generators (`lib/services/character-field-semantics.ts`):
  - `COMPANION_TRUST_DISPOSITION` no longer says the character "remembers the times {{user}} was right as readily as the times they slipped." Models read that as an instruction to keep a ledger.
  - It now adds: no ledger, and forgiveness given is finished; ordinary requests get a yes; wants are stated without conditions; compliments and stories stand; disagreement is for things that matter.
  - `TRUST_SAFEGUARDS_DIRECTION` has a sixth universal rule: never tell {{user}} what they really meant or felt; ask.
  - `EXAMPLE_DIALOGUE_COVERAGE` asks for a plain yes.
  - `COMMITTEE_DRIFT_GUARDRAIL` treats probation behavior as drift, and forbids codifying agreement or warmth as a drift risk.
- Sample prompts (`qtap-plugin-default-system-prompts` 1.1.30):
  - The ledger line is replaced in the 18 prompts that had it.
  - All 21 carry the no-mind-reading rule.
  - Every relationship prompt has an "ordinary time" default yes. MODERN_PLATONIC gets a softer version; MODERN_GENERAL gets none.
  - Each pushback or "saint" line gets a counterweight about frequency.
- `GROUP_SCENE_DISCIPLINE` now aims the anti-chorus rules at characters echoing each other. A plain yes to the user, doing what was asked, or a laugh counts as a complete turn, and "warmth" is listed as a reason to speak. Multi-character chats take one prompt-cache miss on their next turn.
- Memory extraction:
  - New `REPAIRS_INSTRUCTION_BLOCK` in SELF and OTHER. An accepted apology, forgiveness or amends is recorded as a resolution that names what it resolves, scored no lower than the offense, and only on the forgiving party's own words.
  - The importance anchors list repairs at the 0.85 tier.
  - OTHER records kept promises and "turned out to be right" at 0.40–0.55 instead of skipping them as generic warmth.
  - The episode pass notes a repair that ended an episode.
- Consolidation:
  - The binder folds an offense and its later repair into one digest that leads with the resolution.
  - The binder returns `resolvedIds`. The plan's new `resolvedMarks` add the free keyword `resolved` to those rows. The rows are kept and nothing is re-embedded.
  - Recall ranks `resolved` rows at ×0.6 (`RECALL_MULTIPLIERS.resolved`, `resolvedMultiplier`). Retention is unchanged.
- Existing characters and users' prompt copies are not changed. The Character Optimizer's refine pass picks up the new drift guardrail.
- Help: `help/character-optimizer.md`, `help/prompts.md`, `help/memory-playing-a-character.md`, `help/memory-maintenance.md`.
- Tests:
  - `character-field-semantics-probation.test.ts` (new)
  - `multi-character-turn-anchor.test.ts`
  - `default-system-prompts-content.test.ts`
  - `repairs-prompt.test.ts` (new)
  - `consolidation-tasks.test.ts`
  - `consolidation-plan.test.ts`
  - `recall-tags.test.ts`

#### Folder-browser follow-ups: picker libraries, uploaded text, outside edits

- `FileBrowser` no longer has a mount mode. Every place that browsed a store with it now uses the Scriptorium's folder browser:
  - The project page's Files card ("Browse All Files") uses the new `ProjectStoreBrowser` (`components/document-browser/ProjectStoreBrowser.tsx`), which opens the project's own store. `GET /api/v1/projects/[id]/mount-points` now returns `officialMountPointId` for it.
  - The attachment picker's project and document-store steps use the folder browser in pick mode. Its General source still uses `FileBrowser` over the `files` table.
  - `useMountPointBlobUpload` had no callers left and was deleted.
- Document Mode's picker no longer uses `FileBrowser`:
  - "Project library" opens the project's own store, and is hidden when the project has none (the old fallback to the legacy `project` scope is gone).
  - Fixed: "General library" listed the legacy general files, then opened a pick from `files/_general/`. That folder no longer exists, so every pick failed. The button now opens Quilltap General.
  - `accessible-stores` on the chat and standalone routes returns Quilltap General as `generalLibrary` and holds it out of `stores`. The new `resolveGeneralLibrary` and `LibraryTarget` live in `lib/documents/operator-doc-actions.ts`.
- Fixed: a Markdown, text or JSON file uploaded into a database store (stored as a blob, as chat uploads are) could not be opened in Document Mode's editor.
  - `open-document` and `read-document` now read it through `readEditableDocument`, which falls back to the new `readDatabaseBlobAsDocument` (`lib/mount-index/database-store.ts`).
  - The first save writes a document at the same path and the blob is collected.
  - The `doc_*` tools are unchanged.
- Changed: in a database store, only text the store can save (`.md`, `.txt`, `.json`, `.jsonl`) opens in the editor. Other text kinds there (`.yaml`, `.html`, …) open read-only instead of failing on save. Filesystem stores are unchanged.
- Fixed: a change made to a filesystem store outside Quilltap did not refresh an open browser. The mount watcher now publishes `publishMountChange` (debounced 250 ms per store) when it indexes or drops a file, or when a folder arrives or leaves.
- Help: `help/scriptorium.md` and `help/mount-points.md`. Docs: `API.md` and the folder-browser spec.
- Tests:
  - `operator-doc-view-targets.test.ts`: the blob fallback and read-only `.yaml` in a database store.
  - `watcher-native.test.ts`: the realtime hint.
  - `documents/route.test.ts`: `generalLibrary`.

#### Folder-browser docs close-out (folder-browser Phase 6)

- `docs/developer/features/folder-browser.md` is complete and moved to `features/complete/`, with a "Phase 6 as built" section listing what was left for later.
- The SVAR implementation plan and adapter contract moved to `features/complete/`, marked superseded.
- `API.md` documents the Document Mode `viewer` target and the read-only `write-document` refusal on both routes.
- Fixed stale references:
  - README: the SVAR credit.
  - FEATURES.md: claimed drag-and-drop, which does not exist; it now describes the folder browser and viewers.
  - The dead-code report's kept SVAR pair.
  - The custom-tool spec's FileTable pointer.
- The documentation index (`.claude/commands/update-documentation.md`) is updated.

#### Document Mode: folder browser in the picker, read-only viewers (folder-browser Phase 5)

- The Open Document picker browses a store with `DocumentStoreBrowser` in pick mode, replacing its own tree, breadcrumb and new-folder form. Opening a file opens it in Document Mode, and the ⋮ menus stay. "New document here" moved into the browser's footer through the new `footerActions` prop. "Go there" switches to another store when the chat can reach it.
- Store files that are not text (images, PDFs, `.docx`, other binaries) now open in Document Mode read-only:
  - `documentViewTargetFor` (`lib/documents/operator-doc-actions.ts`) decides which files those are: any store file that is not a text file. `open-document` and `read-document`, on both the chat route and the standalone route, return a `viewer` target and empty content for them, and never read their bytes as text. `write-document` refuses them with a 400 (`DocumentReadOnlyError`).
  - New `DocumentViewerPane` shows them with the Scriptorium's `DocumentViewer`, under a read-only ribbon with Download and Close. `DocumentPaneBinding` and `StandaloneDocumentView` pick it when the document has a `viewer`. The post-turn refetch skips these documents.
  - The Librarian's open announcement is unchanged and carries no file contents.
- Fixed: a `BaseModal` beneath another dialog closed with it. A click inside a dialog layered over it, Escape pressed there, or Escape with a confirmation open now reach only the dialog on top. `useClickOutside` now passes the event to its callbacks.
- Help: `help/scriptorium.md` describes the picker's browser and the read-only viewers.
- Tests: `operator-doc-view-targets.test.ts`, `BaseModal-layered.test.tsx`, and a pick-mode case in `document-store-browser.test.tsx`.

#### Scriptorium folder browser (folder-browser Phase 4)

- A store's detail page now browses its files with the shared folder browser: breadcrumb, folder rows (empty ones included), file rows, search across the whole store, select mode, and a ⋮ menu on every file and folder. It replaces `FileTable`.
- New `components/document-browser/`:
  - `useDocumentStoreSource`: the store's record and listing as TanStack queries under `mountPoints.store(id)`, so realtime events refresh it. Each write calls an existing mount-point verb and then invalidates every store it touched.
  - `DocumentStoreBrowser` and `DocumentRow`. File menu: Open, Rename (in place), Move to…, Copy to…, Hard link to…, Where else this appears…, Unlink, Edit description…, Open in Pascal's Workbench, Download, Delete. Folder menu: Rename, Move to…, Copy to…, Delete (recursive, with a confirmation that says so). Batch Move, Copy and Delete in select mode. Upload goes into the current folder, on any writable store.
  - `DocumentDestinationDialog`: a store select over the shared folder picker. Hard links are offered only where `linkFile` can succeed: database ↔ database, or within one filesystem store.
  - `DocumentViewer` / `DocumentViewerModal`: read-only image, PDF, Markdown, text and `.docx` viewers. The new `FilePreviewDocx` sanitises the server's HTML with DOMPurify. The PDF and Markdown viewers load on demand.
- Shared pieces:
  - `lib/folder-browser/preview-kind.ts`: `previewKindOf` (`image | pdf | docx | markdown | text | unsupported`) and `mimeTypeForName`. `getPreviewType` now calls it.
  - `lib/folder-browser/document-actions.ts`: the `BrowserAction` vocabulary, `documentFileActions` / `documentFolderActions` (gated by the store's capabilities), and `canLinkBetween`.
  - `ItemFolderPickerDialog` is now `DestinationPickerDialog`. It adds a `link` mode and an optional container chooser; the Wardrobe and Inventory pickers use it unchanged.
  - `FolderBrowserShell` takes `manageFolders`, so a read-only store hides its folder controls.
  - New `buildMountFileRawUrl`, and query keys `mountPoints.content` and `mountPoints.rendered`.
- `useDocumentStoreDetail` now reads the store through the shared TanStack query. The page's counts follow live updates, and the file list moved into the browser.
- Fixed: `ItemActionMenu` focuses its entries with `preventScroll`. Focusing the first entry could scroll an enclosing workspace pane, and that scroll closed the menu as soon as it opened.
- Fixed: on a filesystem store, moving a folder now moves its `doc_mount_folders` rows with it, and deleting a folder removes its row. Before, the old path stayed in the store's listing.
- Removed the SVAR file-manager beta: `components/files/svar/`, its tests, the `@svar-ui/react-filemanager` dependency and its About-page credits. Also removed the unused `DocumentStoreFile` and `DocumentStoreBlob` types.
- Help: `help/mount-points.md` gains "Browsing a Store", and its upload and hard-link text is updated.
- Tests: `document-actions.test.ts`, `document-store-browser.test.tsx`, `folder-ops-fs-move.test.ts`.

#### Document-store API for the folder browser (folder-browser Phase 3)

- `GET /api/v1/mount-points/[id]/files` now returns `DocMountBrowserEntry` rows from the new `DocMountFileLinksRepository.listForBrowser`. `extractedText` is dropped (no UI read it from the listing). Each row gains `linkGroupId` and `linkCount` (links in any store sharing its content row).
- Per-file `GET …/files/<path>` gains two `dispatchAction` verbs:
  - `?action=links`: every place the file's content appears, with hard-link group members marked.
  - `?action=render-html`: a `.docx` rendered to HTML with mammoth (`lib/mount-index/converters/docx-html.ts`). Link targets other than http(s), mailto and in-page anchors are replaced with `#`.
- New `POST …?action=unlink-file`, backed by `DocMountFileLinksRepository.clearLinkGroup`: takes a file out of its hard-link group. It keeps its content and forks on its next write; a group of one dissolves.
- Folder operations (`lib/mount-index/folder-ops.ts`):
  - New `copy-folder`.
  - `move-folder` takes an optional `destMountPointId` to move into another store.
  - `delete-folder` takes `recursive: true`.
  - All three walk the folder and use the existing per-file `copyFile` / `moveFile` / `deleteFile`. A copy or cross-store move that fails partway is undone. Recursive delete refuses a filesystem folder that holds files the store doesn't index.
- Live updates for document stores:
  - New `publishMountChange` (`lib/mount-index/realtime.ts`), called from the database-store change events, every `file-ops` entry point, the folder operations and folder create.
  - `mountPoints` events are now scoped by store id.
  - New query keys `mountPoints.store(id)`, `detail`, `files`, `links` and `lists`. `topic-map.ts` invalidates the store's keys plus the store lists.
- No schema changes. API.md updated. Tests: `folder-ops-walks.test.ts`, `docx-html.test.ts`, browser listing and `clearLinkGroup` cases in `doc-mount-link-groups.integration.test.ts`, and a scoped-topic case in `topic-map.test.ts`.

#### Shared server folder layer for the Wardrobe and the Inventory (folder-browser Phase 2)

- New `lib/mount-index/item-folder-location.ts`:
  - `ItemFolderLocation` is the folder half of a tier location; `WardrobeLocation` and `InventoryLocation` now extend it.
  - `locationKey` is defined once here and re-exported by both location modules.
  - Generic `createItemFolder`, `renameItemFolder`, `deleteItemFolder` and `moveItemsToFolderIn` take an `ItemFolderKind` (the kind's rules plus its path error). `lib/wardrobe/folder-mutations.ts`, `moveItemsToFolder` and the Inventory's folder and move functions are now one-line delegates (`WARDROBE_FOLDER_KIND`, `INVENTORY_FOLDER_KIND`).
- New `lib/mount-index/item-folder-routes.ts`: `itemFolderActionHandlers` supplies `create-folder`, `rename-folder` and `delete-folder` to both route factories, each mapping errors through its own handler. Inventory folder actions now log at info level, as the Wardrobe's already did. `copy-items` stays per kind, and so does `move-items`, since the Wardrobe's moves can carry an outfit's components.
- `createWardrobeFolderSchema` and `deleteWardrobeFolderSchema` merged into `wardrobeFolderPathSchema`.
- The Wardrobe's cross-tier transfer logic moved out of `app/api/v1/wardrobe/transfers/route.ts` into `transferWardrobeItem` (`lib/wardrobe/transfers.ts`), with typed refusals (`WardrobeTransferSourceNotFoundError` → 404, `WardrobeTransferRefusedError` → 400). The route only parses the request and maps errors. Same rules and same responses.
- Removed `GET /api/v1/wardrobe/transfers` (destination options); it had no callers after Phase 1. API.md updated.
- Tests: `__tests__/unit/lib/mount-index/item-folder-location.test.ts`. The transfer route's GET test was removed.

#### Shared folder browser for the Wardrobe and the Inventory (folder-browser Phase 1)

- First phase of `docs/developer/features/folder-browser.md`, which replaces the SVAR plan: one folder-and-item browser library that the Wardrobe, the Inventory and (in later phases) the Scriptorium and Document Mode share.
- `lib/folder-browser/view.ts`: the pure view rules (`childFolderRows`, `tierRows`, `tierLabel`, `OWN_TIER`), moved out of `lib/wardrobe/folder-view.ts`, which now re-exports them and keeps only `viewTierOf`.
- `components/item-browser/`:
  - `useFolderBrowserState` (where the browser is, select mode and selection, the new-folder draft, and the derived rows) and `useItemFolderHandlers` (New folder / Rename / Delete over an `ItemFolderOps` port, with caller wording). These replace about 150 near-identical lines in each browser.
  - `FolderBrowserShell`: the shared layout. `WardrobeBrowser` and `InventoryBrowser` now supply only their filters, rows, select-bar buttons, footer and wording.
  - `ItemActionMenu`: one ⋮ menu for item and folder rows, declared as `MenuEntry[]` (falsy entries dropped). It is a WAI-ARIA menu button: focus moves into the menu on open; arrow keys, Home and End move between entries; Escape returns focus to the button and does not close an enclosing dialog; Tab or an outside click closes it. Folder rows used to close their menu only on mouse-leave. A row with no actions now shows no ⋮ instead of an empty menu.
  - `ContainerSelect` and `lib/hooks/use-container-catalogue.ts` replace four hand-written container `<select>`s (Wardrobe and Inventory control dialogs, both transfer dialogs) and two copies of the catalogue hook.
  - `ItemFolderField`: the editor's folder picker, shared by both editors.
- Inventory gains **Copy to folder…** (row menu, for copyable objects, and the select bar); the server already supported `copy-items`. Its item editor's Folder field is now a folder picker instead of a text box.
- `WardrobeTransferDialog` reads destinations from the shared catalogue and posts through a TanStack mutation instead of raw `fetch`. The destination group "Users" is now "Characters". `GET /api/v1/wardrobe/transfers` no longer has a UI caller.
- Inventory tier-row counts now count every item in the tier, as the Wardrobe's did, not just the ones passing the current filters.
- Tests: `__tests__/unit/components/item-browser/item-action-menu.test.tsx`, `__tests__/unit/lib/folder-browser/view.test.ts`, and a Copy to folder case in `inventory-ui.test.tsx`. `help/wardrobe.md` and `help/inventory.md` updated.

#### Raised-hand status chip above the Salon composer

- Raising a hand (soft interrupt) gave no feedback beyond the button's pulse, and a decline was reported only by a short toast. A new `RaisedHandChip` (`app/salon/[id]/components/RaisedHandChip.tsx`) sits in the composer's chip row beside the pending Informs and shows each step: raised, being weighed by a named speaker, then yielded / carried on / nobody asked (the stream ended with the hand still up). The outcome stays until dismissed or the operator sends or nudges. Announced via `aria-live="polite"`.
- New SSE event `handAsked` (`encodeHandAskedEvent`, `streaming.service.ts`), sent by `processMessage` when `takeRaisedHand()` hands the question to a speaker.
- `useSSEStreaming` replaces the `handRaised` boolean with `handStatus: RaisedHandStatus | null` (`handRaised` is now derived) and adds `dismissHandStatus`. Hand events are handled before the Storyteller concurrent branch, which used to swallow `handAnswered` for concurrent turns. The raise-hand POST reply no longer overwrites a `handAsked` that arrived first. The decline toast is gone; the chip says it.
- `help/interrupting.md` updated.

#### Fix: a gesture-only answer to a raised hand counted as carrying on

- Models asked to yield often hand over the floor with a stage direction (`*(a tilt of the head — go on, then)*`) and leave out `[YIELD]`. `detectYieldSentinel` read that as a decline: no Host announcement, and the Salon reported "carried on".
- New `isGestureOnlyReply` (`lib/chat/turn-manager/yield-signal.ts`): a reply of at most 280 characters that is one stage direction wrapped whole in `*…*`, `_…_` or `(…)` (layering allowed), on a single paragraph, with no quotation marks. When a yield was offered and no sentinel is found, such a reply is a yield (`inferred: true`), and the gesture is kept as the reply. Only applies when the hand was offered; nothing changes for ordinary turns.
- The Turn note now tells the model that a gesture-only reply counts as yielding. `[TurnYield]` logs carry `inferredFromGesture`.
- Tests in `yield-signal.test.ts` and `turn-outcome.test.ts`; `help/interrupting.md` updated.

#### Custom-tool presets follow the tool walk

- Run presets (`Tools/{tool}.{preset}.settings.json`) were read from and saved to the running character's vault only. They are now found where definitions are: character vault, group stores, project stores, Quilltap General, nearest first. A nearer preset of a name shadows a farther one.
- New `resolveToolPresetPool` (`lib/pascal/tool-preset-pool.ts`) and `GET /api/v1/chats/[id]/custom-tools?action=presets&tool=…&asCharacterId=…`. It returns the winning presets (with the stores each one shadows), every enabled store on the walk as a save destination, and any store whose `Tools/` folder would not list.
- `lib/pascal/custom-tools.ts`: the `Tools/` folder listing is now one exported helper, `listToolsFolderFiles`, shared by definition discovery and the preset walk. `orderedMounts` is exported so both walks use the same precedence.
- Run dialog: the preset dropdown labels each preset with its store and names shadowed copies on hover. A new **Save into** selector picks the destination store, defaulting to the character's vault (or the nearest store when there is no vault). Loading a preset reads it from its own store and does not change the destination. The section now shows for any row that names a character, vault or not.
- `queryKeys.customTools.presets` is now keyed by `(chatId, asCharacterId, toolName)`.
- Docs: `help/custom-tools.md`, API.md, and `features/complete/custom-tool-presets.md` updated. New unit tests in `__tests__/unit/lib/pascal/tool-preset-pool.test.ts`.

#### Deus Ex Machina toggle on the composer portrait; composer tooltips

- New `deus-ex-machina` icon in the icon registry: a game-master's screen by default, an eye in a triangle in the Madman's Box override (bundle 1.1.10). It replaces `zap` on the `/deus` menu entry and on the armed chip.
- `SpeakingAsAvatar` takes an optional `establishedFact` prop (`{ armed, onToggle, disabled }`) and renders a small toggle in the portrait's bottom-left corner that arms and disarms Deus Ex Machina through the same `toggleEstablishedFact` handler `/deus` uses. The toggle sits outside the dimmed portrait layer, so it stays usable while a reply streams, reports its state with `aria-pressed`, and keeps editor focus on click. The armed chip and the tinted editor frame are unchanged. New class `qt-chat-established-fact-toggle` (armed state reuses the composer frame's ring and info tint); mirrored in `@quilltap/theme-storybook` 1.0.96.
- Every native `title` tooltip in the composer is now a Quilltap `Tooltip`: the composer's toolbar, Send / raise-hand / Stop, attachment and tool-result chips and their remove buttons, the speaking-as portrait, the gutter tools (`ComposerGutterTools`, `CustomToolsButton`, `RngDropdown`), `PendingInformChips` and `FormattingToolbar`. Native tooltips did not fire reliably under the Electron shell. Icon-only buttons that relied on `title` for a name now carry `aria-label`.

#### Deus Ex Machina: established facts in the Salon

- The operator can post something as **established fact**: true in the story, known to everyone, needing no verification. Two kinds. A **seat line**: the operator's own USER row with the new `chat_messages.isEstablishedFact` flag (migration `add-established-fact-field-v1`). A **machine fact**: a public, persona-free Host row with `systemKind: 'established-fact'` and no participant. "Deus Ex Machina" is the UI name only; no model-facing text contains it, and a test enforces that.
- One module, `lib/chat/established-fact.ts`, holds the predicate, the frames, the reminder header and the transcript rule. Frames are applied at read time and never stored. A seat line gets a seat frame. A machine fact gets "The Host makes it known…" on a fully transparent roster and a plain, speakerless frame when any LLM seat is opaque (same rule as the Staff body swap).
- Delivery to models: `buildMessageContext` frames fact rows (`frameEstablishedFacts`) before `normalizeWhisperRoles`. Fact rows bypass the history-access cut (`filterMessagesByHistoryAccess`) and the presence-window filter, so absent seats and late joiners know them. The in-scene rehearsal keeps them. `extractVisibleConversation`, the summary fold, the memory-extraction transcripts and the Courier delta frame them in the plain voice. The fold keeps a machine fact as its own turn labelled `Established fact`; the fold prompt and the SELF/OTHER/episode extraction prompts gained a rule to carry facts forward as settled truth.
- New trailing section `establishedFacts` (`buildEstablishedFactReminder`, `lib/chat/context/established-fact-reminder.ts`), right after the inform block: every fact posted since the seat last spoke, oldest first, seat lines name-prefixed, capped at 8,000 characters (oldest dropped). Reads only; a swipe measures "last spoke" on the history the original saw. Empty when there are no facts, so turns without facts are byte-identical. A failed chat read drops the section instead of failing the turn. Carina does not get it.
- Send path: `sendMessageSchema` accepts `isEstablishedFact`; it is a 400 with whisper targets or empty content. It flows through `buildSendMessageOptions` → `SendMessageOptions` → both `recordOperatorPost` callers (the orchestrator and the fair-rotation pause). The new user message is framed for the current turn.
- `?action=announcement` accepts `sender: { kind: 'fact' }`, written by `postEstablishedFact` (`lib/services/announcer/writer.ts`); a fact sender with `targetParticipantIds` is a 400. The post enqueues the new `ESTABLISHED_FACT_MEMORIES` job, which admits the fact verbatim as a MANUAL memory (`pass: 'established-fact'`, importance 0.8, present / wide / information) for every non-removed LLM seat, absent and silent included. One seat's failure does not stop the others; an enqueue failure does not undo the post. Completion publishes the `memories` topic.
- Composer: `/deus` (new `deus` composer action, `zap` icon) arms the composer for one line: a chip above the composer (`aria-live="polite"`, × to disarm), a tinted editor frame (`qt-chat-composer-established-fact`) and a Send button labelled "Send as established fact". It disarms after a send, on chat switch and on reload, and cannot be armed with only attachments. ⌘/Ctrl + Shift + Enter sends one line as fact without arming, in chat and composition mode. An established line skips the In Their Own Words rehearsal (`shouldRehearseImpersonatedLine`).
- Insert Announcement dialog: a fourth tab, **Deus Ex Machina**, hides the speaker, profile and audience pickers and posts with an **Establish** button.
- Salon rendering: a seat line shows a "Deus Ex Machina" ribbon (`qt-chat-message-established-fact`, in the bubble's own text colour so it holds contrast on every theme's bubble). A machine fact renders as a full-width band with no avatar (`qt-chat-established-fact-row` / `-band`), is never packed into a chip run nor drawn as a collapsed chip by the message list, has the chip label "Deus Ex Machina", a high-importance dot, and the `qt-chat-established-fact` bar accent (`getAnnouncementAccentClasses` is now per-kind). `@quilltap/theme-storybook` 1.0.95 mirrors the new classes.
- Export schema, DDL.md, API.md, PROMPT_ARCHITECTURE.md and SYSTEM_FLOWCHARTS.md §9 updated. `.qtap` import and backup restore carry the flag and the Host row unchanged (round-trip tests added).
- Docs: new `help/deus-ex-machina.md`; cross-links in `help/insert-announcement.md` and `help/inform.md`. `help/character-system-transparency.md` corrected: Staff messages are not stripped for opaque characters (they get the persona-free body, chat-wide), and there is no chat/project setting that disables Staff messages. Stale comments about a per-character presence-window summary removed from `lib/schemas/chat.types.ts` and `lib/services/librarian-notifications/writer.ts`.

#### Fix: mail deliveries and Pascal roll outcomes drew as collapsed chips in the Salon

- `buildRenderItems` kept Suparṇā mail deliveries and Pascal `custom-tool-result` rows out of chip groups, but `VirtualizedMessageList` computed `isSystemMessageCollapsed` with its own check that exempted only Carina and established facts. `MessageRow` then drew its collapsed-chip fallback for those rows anyway.
- The rule now lives in one exported predicate, `isAlwaysExpandedAnnouncement` (`app/salon/[id]/announcement-render-items.ts`), used by `isCollapsedAnnouncement` (now exported). The message list passes `isCollapsedAnnouncement(...)` to `MessageRow`, so the grouping and the row flag cannot disagree. Tests cover all four always-expanded kinds.

#### Fix: global search returned Staff messages (#121)

- The message search index decided eligibility by role only. Staff messages (Commonplace Book recall whispers, Host/Prospero/Librarian announcements, other `systemSender` rows) are written with role `ASSISTANT`, so they were indexed and returned as character lines, including whispers addressed to other participants. Announcement bubbles (`customAnnouncer`) had the same problem.
- `chatMessageFtsEligibilitySql` (`lib/database/backends/sqlite/chat-message-fts.ts`) now also requires `systemSender IS NULL AND customAnnouncer IS NULL`, matching `isCharacterAuthoredMessage`. The insert trigger is built from the same fragment. The FTS query path re-applies the filter to the joined row, and the non-SQLite path uses `isCharacterAuthoredMessage`.
- `ensureChatMessageFtsSchema` now replaces any trigger whose stored SQL differs from the module's DDL (`staleChatMessageFtsTriggers`); `IF NOT EXISTS` alone never updated one.
- New migration `reindex-chat-message-fts-character-only-v1` replaces the old insert trigger and rebuilds the index. `create-chat-message-fts-v1` now depends on `add-system-sender-field-v1` and `add-custom-announcer-field-v1`, since its trigger reads those columns.

#### Search bar searches the open Salon chat first

- With a Salon chat focused, the header search bar shows a "This conversation" group above the global results (now headed "Everywhere"). It lists messages and announcements in the visible transcript that contain the query, newest first, with speaker, time, excerpt and occurrence count. The full search dialog has a "This conversation" chip for the same group (up to 50 matches; the inline dropdown shows 5).
- Matching is done client-side on the messages the Salon already has (whisper filtering and the current swipe applied, TOOL rows skipped), case-insensitive substring on markdown-stripped text. Matcher: `findConversationMatches` (`lib/chat/conversation-search.ts`).
- Choosing a match scrolls the virtualized list so the top of the message is at the top of the transcript and flashes it. A match in a collapsed announcement chip expands it first. This uses the virtualizer, so off-screen messages work.
- While the query is in the search bar, every occurrence in the rendered transcript is highlighted with the CSS Custom Highlight API (`useSearchHighlight`, `::highlight(quilltap-conversation-search)` in `app/globals.css`). No markup is added to message DOM; a MutationObserver repaints as rows mount or stream.
- The query stays after choosing a match. Escape closes the dropdown, a second Escape clears the query and highlight; the input also has a clear button.
- The Salon publishes a `ConversationSearchSource` through the page toolbar context (`conversationSearch` / `setConversationSearch`). In the workspace it is a per-tab slot that `WorkspaceToolbarBridge` forwards for the focused tab, like the left/right toolbar content. Not published while quick-hide covers the chat.
- Fix: a Message result in global search (`/salon/<id>?msg=<messageId>`) now opens the chat scrolled to that message and flashes it. Nothing used to read `msg`. Every way into such a link goes through `requestMessageReveal(chatId, messageId)` (`lib/chat/message-navigation.ts`): the workspace link interceptor and `useWorkspaceNavigate` (via `revealRequestFromSalonHref`), `WorkspaceIntent` for the old-route redirect (which now forwards `msg`), and the legacy route's new `revealMessageId` prop on `SalonView`. The request is stored in sessionStorage under the chat id and announced with a `quilltap:reveal-message` window event, so a Salon that is still mounting takes it once loaded and a kept-alive tab takes it at once; only the named chat takes it.
- The Salon reveals only after the initial scroll to the newest message has finished (new `isInitialScrollDone` from `useAutoScroll`; that scroll keeps nudging for 300 ms after `isSettled`). A tab still hidden when the request arrives waits until it is shown.
- If the target isn't shown in this view (a whisper to another participant, another variant of a reply), the Salon shows a toast saying so instead of doing nothing. Before #121 was fixed, most global Message hits in V4test were Commonplace Book whispers addressed to characters, which the Salon hides by default.
- Removed the unscoped `navigateToMessage` / `getPendingMessageNavigation` handoff (no remaining callers; any Salon would take its request).

#### Salon header compacts a crowded cast

- The Salon's toolbar breadcrumb (project, characters, story background, Concierge badge, title) is now `ChatHeaderBreadcrumb` (`components/chat/ChatHeaderBreadcrumb.tsx`). When the row doesn't fit, the project and character links step down from full name to an abbreviation (`abbreviateName`: first three letters of one word, initials of several) to avatar only. Compact links get a Quilltap tooltip with the full name and "Click to open character" / "Click to open project". The density is chosen by measuring invisible copies of each density, so it doesn't depend on the row's own width.
- The story-background thumbnail and the title always show. The thumbnail's tooltip reads "Click to display background"; the title has a minimum width and truncates, and the cast clips before it does.
- `.qt-page-toolbar-left` now takes the space the search bar and right section leave (`flex: 1 1 0%`; `flex: 0 1 auto` when empty, so pages without left content lay out as before). `.qt-page-toolbar-center` has a fixed `32rem` basis and `.qt-page-toolbar-right` no longer shrinks, so a long breadcrumb can't squeeze either. `@quilltap/theme-storybook` 1.0.94 mirrors the change.

#### Fix: see-through dropdowns and menus that let clicks fall through

- The header search dropdown, the search dialog, the Generate Image and entity-search pickers, the Brahma model picker and the wardrobe, inventory and folder menus used page-background colors (`bg-background`, `qt-bg-default`, `qt-bg-surface`). Art Deco, Great Estate and Madman's Box set `.bg-background` to transparent so their backdrop shows, which made those panels see-through. They now use a new `qt-bg-popover` utility (`--qt-popover-bg`). The two roleplay-template editor dialogs and the task-details dialog use `qt-dialog` for the same reason.
- `qt-card-interactive:hover` lifts the card with `translate`, which makes the card a stacking context. An open ⋮ menu was trapped inside its row, so later rows' buttons drew on top of it and took its clicks. A `qt-card` or `qt-card-interactive` that contains an open popup (`[aria-haspopup][aria-expanded="true"]`) now gets `position: relative; z-index: 20; translate: none`. Only `translate` is cleared: the CSS build merges `transform: none` with it into `translate3d(0,0,0)`, which would trap fixed menus.
- Menus inside scrolling lists were clipped by the list and drawn under the wardrobe dialog's footer. The inventory row's viewport-fixed placement (opens upward when there's no room below, closes on outside scroll or resize) is now the shared `useFixedMenu` hook (`hooks/useFixedMenu.ts`), used by the inventory and wardrobe item rows (⋮ menu and slot picker), the item-browser folder row and the scenario row.
- The wardrobe slot picker's button now has `aria-haspopup` / `aria-expanded`, and the picker has `role="menu"` / `menuitem`.
- `@quilltap/theme-storybook` 1.0.93 mirrors `qt-bg-popover` and the open-popup card rule.

#### Anthropic: move to API version 2026-10-21; drop temperature and top_p

- The Anthropic plugin (1.0.64) no longer pins `anthropic-version: 2023-06-01`. It now uses the SDK's default, `2026-10-21`.
- That version returns 400 for `temperature`, `top_p` or `top_k` on every model, so the plugin no longer sends them on any request. It used to send them to pre-4.7 models and default `temperature` to 1.0. Those models now sample at the API defaults.
- That version also returns 400 for a `document` block placed directly in an assistant message. `formatMessagesWithAttachments` now moves an assistant turn's documents (PDF, text) into a user turn just before it. Images stay in place. An assistant turn left with no content after the move is dropped.
- Thinking is unchanged: adaptive on Sonnet 5 / Opus 4.7+ / Fable / Mythos, fixed `budget_tokens` on older models. The model-prefix list is renamed `BUDGET_THINKING_REJECTED_MODELS`, since sampling no longer depends on it.
- New provider capability `samplingParameters?: boolean` in `@quilltap/plugin-types` 2.10.0 (omitted means `true`). The Anthropic plugin declares `false`.
- Connection-profile editor: for a provider declaring `samplingParameters: false`, the Temperature and Top P sliders are hidden and not sent on save or test-message. The profile card shows only Max Tokens for those profiles.
- `ConnectionProfilesRepository.create` / `update` strip `temperature`, `top_p`, `topP`, `top_k` and `topK` from `parameters` when the profile's provider declares `samplingParameters: false`. This covers the editor, auto-configure, import and restore. It also re-checks the stored blob when only `provider` changes. Helpers: `withoutSamplingParameters` (`lib/llm/sampling-params.ts`) and `acceptsSamplingParameters` (`lib/plugins/provider-validation.ts`). An unknown provider is treated as accepting them, so nothing is stripped before the registry loads.
- Migration `strip-anthropic-sampling-parameters-v1` removes the same keys from existing `ANTHROPIC` profiles. `max_tokens` and provider options are kept. The provider list is a frozen copy, like `retire-prefill-on-thinking-profiles-v1`.

#### Deps: Packages and plugins brought up to the root's dependency levels

- `npm update -S` in the root, every `packages/*` and every `plugins/dist/*`. Main movements: `@quilltap/plugin-types` ^2.9.1 and `@quilltap/plugin-utils` ^2.7.2 everywhere (root included), `openai` ^7.45.1, `@openrouter/sdk` ^1.5.21, `@modelcontextprotocol/sdk` ^1.32.2, `sharp` ^0.35.5 in `packages/quilltap`, Storybook ^10.6.5 and `react` ^19.3.1 in `theme-storybook`, `@types/node` ^24.19.2 in `create-quilltap-theme` and `plugin-types`.
- Major bumps:
  - `@google/genai` 1.52 → 2.32 (google plugin). 2.0's breaking changes are confined to the Interactions API, which the plugin doesn't use. Two default changes do reach it. The SDK no longer applies Undici's 300 s timeouts when `httpOptions.timeout` is unset, so a call with no `requestTimeoutMs` now runs until the server's limit (10 min unary, 20 min streaming). Automatic continuation is on, so a long decode that checkpoints is resumed by the SDK within one call, and summed `usageMetadata` can then count the prompt more than once.
  - `zod` ^3.25.76 → ^4.6.7 (mcp plugin). The plugin doesn't import zod. It's external in the bundle, so the plugin already ran against the app's zod 4 at runtime, and `@modelcontextprotocol/sdk` accepts `^3.25 || ^4.0`.
  - `html-to-text` 9 → 10 (curl plugin). A maintenance release (htmlparser2 10, selderee 0.12, Node ≥ 20.19); the plugin's options are unchanged and produce the same output. `@types/html-to-text` stays at 9.0.4, the latest.
  - `@anthropic-ai/sdk` 0.115 → 1.3 (anthropic plugin). SDK 1.0 defaults to `anthropic-version: 2026-10-21`, which returns 400 for any request carrying `temperature`, `top_p` or `top_k`, or a `document` block in an assistant message. The plugin sends sampling parameters on every non-thinking request to models that still accept them. It now pins `anthropic-version: 2023-06-01` through `defaultHeaders` on all four clients (`clientHeaders()` in `provider.ts`), which overrides the SDK's value, so requests go out as before. One visible difference: the SDK now sends the API key as `Authorization: Bearer` instead of `X-Api-Key`. The API accepts either, but a proxy that reads `X-Api-Key` would need changing.
- TypeScript 7, `@types/node` 26 and `emojibase-data` 18 remain held back, as in the root.
- Removed `fsevents@2.3.2` from the root `allowScripts`. That version is no longer installed; `fsevents@2.3.3` stays.
- Patch bumps: `@quilltap/plugin-types` 2.9.2, `@quilltap/plugin-utils` 2.7.3, `@quilltap/theme-storybook` 1.0.92, `create-quilltap-theme` 2.0.23, and every plugin in `plugins/dist/`.

#### Deps: TypeScript 6

- `typescript` 5.9.3 → 6.0.3 in the root project, `packages/plugin-utils`, `packages/plugin-types`, `packages/theme-storybook`, `packages/create-quilltap-theme` and `qtap-plugin-default-system-prompts`. The root project and all plugins type-check under 6 with no source or tsconfig changes, and `npm run lint` and the unit suite are unchanged.
- TypeScript 7 (the native Go compiler) also type-checks the root project cleanly, but it can't be adopted yet: `typescript-eslint` 8.x caps its `typescript` peer at `<6.1.0` and needs the JavaScript compiler API, which `typescript@7` no longer ships. Next 16.4 already handles 7. Revisit once `typescript-eslint` supports 7.
- `tsup` 8.5.1 → 9.0.0 in `plugin-utils`, `plugin-types` and `theme-storybook`. tsup 8 forces `baseUrl` into its declaration build, and TypeScript 6 rejects that with TS5101 (deprecated, removed in 7). tsup 9 no longer does. Published `dist/` contents are the same apart from hashed chunk filenames.
- `theme-storybook`: TypeScript 6 turns on `noUncheckedSideEffectImports` by default, so `src/preview.tsx`'s side-effect `.css` imports failed type-checking. Added `src/css-modules.d.ts` declaring `*.css` modules.
- Patch bumps: `@quilltap/plugin-utils` 2.7.2, `@quilltap/plugin-types` 2.9.1, `@quilltap/theme-storybook` 1.0.91, `create-quilltap-theme` 2.0.22, `qtap-plugin-default-system-prompts` 1.1.28.

#### Deps: ESLint 10

- `eslint` 9.39.5 → 10.13.0. `eslint.config.mjs` was already flat config and needs no changes. `npm run lint` reports the same results as on 9 (zero findings across 4,290 files), and a probe file with deliberate violations tripped the same rules under both versions.
- `eslint-plugin-react` 7.37.5, `eslint-plugin-jsx-a11y` 6.10.2 and `eslint-plugin-import` 2.32.0 (all pulled in by `eslint-config-next`) still cap their `eslint` peer range at `^9`, and none has released since ESLint 10 shipped. `package.json` `overrides` now point their `eslint` peer at the root version (`$eslint`). Remove those overrides once the plugins publish `^10` ranges. Until then `npm install` will not flag an incompatibility; a breakage would show up as a crash in `npm run lint`.

#### Deps: Lexical 0.53

- `lexical` and all `@lexical/*` packages 0.52.0 → 0.53.0. No code changes. 0.53's breaking changes (removed `*ImportExtension`s, removed unchecked type arguments on `getParent<T>()` / `$getNodeByKey<T>()` and similar, `@lexical/mdast` table alignment) touch no Quilltap code; `npx tsc` is clean and the composer and Lexical test suites pass.
- Fixes relevant to the Salon composer: IME and dead-key composition into a `TextNode` subclass keeps its type; Chromium keeps spellcheck underlines when a text node is rewritten; Markdown export escapes literal brackets, `<` and `&`; links opened in a new tab no longer get `window.opener`; a read-only `ContentEditable` no longer renders an unnamed `role="textbox"`.

#### Deps: croner 11, jest-fetch-mock 4.2

- `croner` 10.0.1 → 11.0.0. Quilltap only calls `new Cron(expr).nextRun(date)` (autonomous-room schedules and the room card's next-run preview), so none of 11's `startAt` / `dayOffset` / `previousRun()` changes apply. DST behavior changed: a fixed-time schedule that falls in a spring-forward gap now runs at the first valid time after the gap (3:00, not 3:30), and interval schedules run through both copies of the repeated fall-back hour. 11 also fixes `?` behaving like `*` in day fields and stack overflows on patterns that never match.
- `jest-fetch-mock` 3.2.0 → 4.2.0. All 3.x APIs are unchanged; `jest.setup.ts` still calls `enableMocks()`. Under jsdom it still fills missing fetch globals from cross-fetch. Under `@jest-environment node` mocked responses are now native `Response` objects.
- `jest-fetch-mock` and `@types/yauzl` moved from `dependencies` to `devDependencies`. Neither is used at runtime; production installs (`npm ci --omit=dev` in the Docker images) no longer pull them or `cross-fetch`.
- `emojibase-data` stays at 17: version 18 changes the emoji characters themselves, which requires a new `emoji-index.v2.json` under the dataset's versioning contract.

#### Deps: chokidar removed; the files-directory watcher uses `fs.watch`

- `lib/file-storage/watcher.ts` (the instance `files/` watcher) now uses Node's recursive `fs.watch`, like the mount watcher. `handleNativeEvent` resolves each debounced event against the disk: an existing file goes through `handleFileChange` (which adds a record when there is none), a missing path is defer-deleted, a folder that leaves by rename defer-deletes every record beneath it, and a folder that arrives by rename is recorded with its contents (`scanDirectory`). Symlinks are skipped, matching the startup scan. Event paths are normalized to `/`-separated storage keys.
- If `fs.watch` cannot start (missing directory, no recursive notifications), the watcher logs a warning and stays off; startup reconciliation and Sync Now still work.
- A file move matched through `findBySha256` now cancels any deferred delete still pending for the same record. Before, the old path's delete could fire after the move and remove the moved record.
- The mount watcher's `QUILLTAP_WATCHER_POLLING=1` mode (and its fallback when `fs.watch` refuses a recursive watch) no longer uses chokidar. It walks the store every 2 seconds, stats each indexable file, and diffs mtime and size against the previous walk. The first walk is the baseline. No descriptors are held between walks.
- `chokidar` is removed from `package.json`. New `__tests__/unit/lib/file-storage/watcher-native.test.ts`; the bug 69 digest test and the mount watcher polling tests now drive `fs.watch` and the walker instead of a chokidar mock.

#### Fix: Filesystem store watcher held one file descriptor per watched file

- The mount watcher ran chokidar 5, which has no FSEvents backend and opens a kqueue descriptor for every file and folder it watches on macOS. A store on a 24,000-file `~/Documents` reached 15,770 open descriptors; Next.js then failed every request that needed a compile with `spawn EBADF`.
- Filesystem stores now watch with Node's recursive `fs.watch` (FSEvents on macOS, ReadDirectoryChangesW on Windows, inotify on Linux). A 20,000-file test store added no descriptors. `handleNativeEvent` resolves each debounced event against the disk: an existing file is indexed, a missing path is dropped, a folder that arrives by rename has its files indexed (`walkDirectory`, now exported from `scanner.ts`), and a folder that leaves by rename has everything indexed beneath it removed. Symlinks are skipped, as before. An event with no filename (Linux queue overflow) is logged and left to the next startup scan.
- `QUILLTAP_WATCHER_POLLING=1` still polls, and the watcher falls back to polling when `fs.watch` refuses a recursive watch. Polling ignores files the scanner would never index.
- New `watcher-native.test.ts` covers event resolution, the polling path and the fallback.

#### Fix: Filesystem store scans no longer fault in iCloud files or hold the startup screen

- The document-store scanner hashed every file under a filesystem store's base path, which made iCloud Drive download each evicted placeholder. A V4test store pointed at an iCloud-synced `~/Documents` (23,615 of 24,153 files evicted) indexed about 90 files every five minutes, and the startup screen sat on "At your service" until its five-minute settle cap released it.
- `processMountFile` now stats the file before hashing it and returns `in-cloud` for a fully evicted placeholder (`size > 0`, `blocks === 0`, macOS and Windows only). The scan counts these as `filesInCloud`, keeps their existing index rows, and logs one summary line per store. The watcher ignores the change event an eviction fires; the download that brings a file back fires another and indexes it.
- The detection rules live in new `lib/files/cloud-placeholder.ts`. `isNotFullyMaterialized` (moved from `materialize-cloud-files.ts`, unchanged) is the broad rule for faulting database files in at boot. `isEvictedCloudPlaceholder` is the narrow rule for skipping: it ignores partially downloaded files and never fires on Linux, where compressing filesystems (ZFS, btrfs) report fewer blocks than bytes.
- The boot scan runs in two passes. `scanAllMountPoints({ only: 'database' })` stays inside the startup gate's `backgroundSettled` wait. Filesystem stores scan afterwards with `{ only: 'filesystem', reportStartupProgress: false }`, outside the gate. `ScanResult` gains `filesInCloud`, and `emptyScanResult()` builds the zeroed result the runner used to spell out by hand.

#### Deps: SQLCipher driver to better-sqlite3-multiple-ciphers 13

- `better-sqlite3-multiple-ciphers` 12.11.1 → 13.0.3, in the root `better-sqlite3` alias and in `packages/quilltap`. v13 is a Node-API addon with one prebuilt binary per platform in the npm package (darwin, linux, linuxmusl, win32 × x64, arm64). Nothing compiles on install, and one binary serves every Node ≥ 22 and Electron ≥ 35. SQLite 3.53.4, SQLite3MultipleCiphers 2.4.0. `prebuild-install` and `bindings` left the tree.
- No data migration. Databases written by either version open in the other. A 4.2.x Electron shell, which injects its own v12 build, keeps working; there is no shell/server compatibility gate. Server code must not call v13-only driver API (`db.explain()`, `Statement.prototype.toString()`) until the shell ships v13.
- The CLI no longer rebuilds the driver. `ensureDatabaseNativeModule()` loads the prebuild the driver would pick and, when it won't load, prints why (no prebuild for this platform, glibc older than 2.35, or the loader's error) and what to do. `readCompiledAbi`, `betterSqlite3NeedsRebuild`, `findBinFor` and `rebuildNativePackage` are gone, as is the matching heal in `jest.global-setup.js` and its test; new `native-driver-check.test.js` covers the load check.
- Linux hosts running `npx quilltap` now need glibc 2.35 or newer (Ubuntu 22.04, Debian 12, RHEL 9). Older hosts should use the Docker image.
- The Docker production image keeps only its own architecture's driver prebuild and drops the driver's compile-time sources (`deps/`, `src/`, `binding.gyp`); the build fails if the prebuild is missing. Build tools stay in the build stages for node-pty. `scripts/build-push-docker.ts` no longer runs `npm rebuild better-sqlite3` afterwards.
- The server logs the driver and SQLite versions at info level when it opens the main database (`SQLCipher driver loaded`), so a support thread can tell which binary the shell injected.
- `@types/better-sqlite3` stays: v13's `exports` map has no `types` entry, so TypeScript cannot see the package's own `index.d.ts`.
- `allowScripts` denies `better-sqlite3-multiple-ciphers` (version-less). The package still ships `binding.gyp`, so npm treats it as having a `node-gyp rebuild` install script; the deny stops a pointless node-gyp run in Docker's `npm rebuild`.
