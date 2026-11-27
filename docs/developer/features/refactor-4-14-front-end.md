# Refactor 4.14 — the front-end pass

**Status:** Implemented 2026-11-27 on `bugfix`, against `HEAD` = 3d2a39482. `npx tsc`, `npm run lint` and `npm run test:unit` pass. Not yet checked in a browser (§6). This page is the record: what was built, what changed for a user, what was examined and left alone, and the bugs the audit filed. It follows the shape of the [4.13 set](refactor-4-13.md), but the work was done in one pass rather than spec by spec.

The brief: a full refactor of the client (`app/` outside `app/api`, `components/`, `hooks/`, `lib/hooks`, `lib/query`; about 186,000 lines) to the house standards — single source of truth, DRY, SRP, KISS, YAGNI, dead code, stubs, `qt-*` classes — with the bugs found on the way filed as issues rather than fixed.

## 1. How it ran

1. **Audit.** Twelve read-only passes, one per slice, each reporting verified refactors and verified bugs with file and line.
2. **Verification.** Every candidate bug was re-read at `HEAD` by a second reader told to refute it. One bug and five weaker leads were refuted (§5); a handful were corrected in detail. 115 were filed.
3. **Refactor.** Each slice's approved items were implemented with one rule: behavior-neutral, except where the single shape removes a filed bug by construction. Where two copies disagreed and no choice was neutral, each caller keeps its behavior through a parameter and the disagreement is an issue.
4. **Review.** Seven independent regression reviews compared the working tree with `HEAD`, area by area. They found no High regression; the Medium and Low ones were fixed (§3) or are listed as accepted differences (§4).

## 2. What was built

Sizes: about 390 files changed, roughly 6,100 lines added and 12,200 removed; 38 new source modules, 34 new test files, 16 source files deleted.

| Area | The single shape | What it replaced |
|---|---|---|
| Documents | `DocumentSaver` (`app/salon/[id]/hooks/document-saver.ts`) | The autosave / in-flight join / absorb-first-serialization / 409 reload machine written twice, in `useDocumentMode` and `StandaloneDocumentView` |
| Salon hooks | `postChatAction` (`hooks/chat-actions.ts`), `updateParticipant`, `putChatUpdate`; `documentModeApi` / `terminalModeApi` on `apiFetch` | Eleven copies of fetch → `res.ok` → `error` → toast → `fetchChat` in `useChatControls`; two private copies of `apiFetch` |
| Salon view | `ChatModals` takes `modals` whole; `useParticipants` runs once; `isResponding` / `isGenerating`; memoised returns from `useDocumentMode` / `useTerminalMode` | A 40-prop mirror of `useModalState`; a second `useParticipants` call; the flag spelled seven times; nine callbacks rebuilt per token |
| Salon components | `useResizableDivider`; `handleImagesGenerated`; `DocumentTextarea`; typed `getMessageAvatar` | Two dividers "mirroring" each other; two copies of the image-record handler; an `any` |
| Chat | `resolveDefaultConnectionProfileId` (`lib/llm/profile-usage.ts`); `SeatThumb` + `AudienceCandidate`; `run-tool-request.ts`; `ToolThumbnail`; the inspector's tabs in `LLMLogViewerModal`; `remarkPluginsFor` (`lib/markdown/`); `COMPOSER_NODES` | The rule in two of its six spellings (the other four are #246); two audience types; the run-tool POST twice; a second LLM-log renderer; two remark lists kept in step by a comment |
| Items | `ItemPicturesSection`, `ItemTransferDialog` (`components/item-browser/`); `ContainerSelect` in the instantiate dialog; the image slot in `useItemOverlays`; `document-store-requests.ts` | Inventory and Atlas copies of each; a hand-written container select; the Scriptorium's writes spelled twice, once on raw `fetch` |
| Aurora | `deleteCharacter` / `deletionSummary`; `characterAvatarSrc` (`lib/characters/avatar-src.ts`); `mergePhysicalDescription` in the optimizer; one toggle helper | Two copies each |
| Custom tools | `issuesAt` + `IssueLines`; `useLineSlotGuard`; comparator rules and `legalNumberTest` in `lib/pascal/tool-draft.ts`; `chip-parts.tsx`; `ReferenceRows`; `useCustomToolDestinations` | Six issue filters; two copies of the duplicate-slot guard; comparator lists re-spelled; five badge copies; twin reference rows; three inline `queryFn`s |
| Theme editor | `use-draft-saver.ts`, `use-editing.ts`, `calliope/use-proposal-actions.ts`, `DraftHeader.tsx`, `seek-frames.ts` | `DraftEditor.tsx` at 1,262 lines doing five jobs; three seek loops |
| Settings | Chat-settings defaults and types from the Zod schemas (`chatSettingDefault`); `useProvidersQuery`, `usePromptTemplatesQuery`, `use-tags.ts`; `useEnvelopeListQuery`; `ProfileOption`; `useAnnounceAssociations`; `lib/text-replacement/boundary.ts` | 23 hand-copied defaults and 15 interfaces; four inline provider queries; three prompt-template loaders; two tag reads; ten copies of one list-query body |
| Tools and wizards | `WizardStepIndicator` + `wizardStep(order, step)`; `useToolSettingsDraft`; `createStartupNotifier`; `useDialogState` in restore and search-replace | Three step indicators and three `getStepNumber` switches; two tool-settings save paths; two notifiers |
| Images and consoles | `useCharacterPhotosQuery`; `useGenerateImage` + `insertAtCursor`; `readAgentSse`; `ConsoleBubble` | Two album loaders; two generate calls; three SSE loops; two bubble copies |
| Shared UI and hooks | `Spinner`, `EmptyStatePanel`, `SegmentedRadioGroup`; `usePersistentState`, `useChatMentions`, `open-href-in-workspace.ts`, `isMacPlatform` | 32 inline spinners, 7 empty states, 6 radio groups; two `localStorage` persists; twin mention hooks; three href-to-tab openers |

**Server state into the cache.** These were effect-and-state loaders and are now queries: the document picker's two lists, the save-image albums, chat cost, the formatting toolbar's template, the Salon's template, inline search, the help guide and topic reader, tags, My Photos (an infinite query), the scenario lists, prompt templates, the theme preview and the registry browser, wardrobe instructions, the delete-character preview, startup status, the data directory and the unlock state. Raw `fetch(` in client code went from 347 to 230.

**`apiErrorMessage`.** It now returns the caller's fallback when a failed response carried no `error` / `message` sentence. Before, an `ApiFetchError` with an empty or non-JSON body surfaced its own "Request to <url> failed: 500" text, which is what made converting a raw `fetch` change the toast.

**Dead code.** `GenerateImageDialog` (no caller of `openGenerateImage`), `RoleplayAnnotationButtons`, `useListManager`, `ProjectTabs`, `useWorkspaceLink`, `ui/ProfileCard`, six re-export shims, `isLLMEditing` (never set true) and the `clear_focus` chain in Document Mode, the Settings page's standalone-URL branch, the plugin `filter=installed` query, the AI import's unused regenerate path, and unused parameters and state in `useChatControls`, `useParticipants`, `useTurnManagement`, `useSSEStreaming`, the provider wizard and the export / import / restore hooks. knip agrees with the 4.13 sweep: no unimported front-end file.

**Tooling.** `scripts/check-modal-shell.mjs` judges the files on disk (tracked and new, minus deleted).

## 3. Fixed by construction

Each is filed and marked as fixed by this change; the commit should carry `Fixes` for them.

#335 the Salon keeps a template's old formatting · #336 a saved tag color does not show elsewhere · #337 the Scriptorium list hides the server's reason · #338 the formatting toolbar's race · #339 the LLM log viewer shows blank content · #340 the document picker's race · #341 a failed image record is silent · #342 inline search shows an older query's results · #343 the "(Default)" prompt badge · #344 a reinstalled theme previews stale · #345 the export step counter · #346 Cancel in Default Tool Settings · #347 auto-association does not refresh profile lists · #348 "No API Key" on keyless providers. Partly: #349 (Delete All Data now shows and counts Projects; the stale caches are open).

Found by the regression reviews and fixed before this record: the Merge dialog's outfit-summary query had lost its realtime refresh (`queryKeys.wardrobe.outfitSummary` is now in the `chats` topic); the photo-album dialog could show a cached album for up to 30 seconds (`useCharacterPhotosQuery`'s `fresh` option); the inline search kept the previous answer's footer after a clear; New Character's template picker no longer retried a failed first read; `characterAvatarSrc` returned `/` for a default image naming neither a URL nor a file; the dressing-instructions read sat under the `wardrobe.all` prefix, so an item-list invalidation re-read it under an open editor (its key is now outside that prefix); the startup poll paused while the window was in the background; the tag editor's chips were cached for 30 seconds; the change-passphrase and prompt-template saves had lost their own failure text.

## 4. What a user can notice

- Pascal's Workbench asks its confirmations and its rename prompt in the house dialogs, not the browser's.
- The six segmented radio groups in the Workbench take arrow keys, Home and End.
- Search & Replace and the import wizard wear the setup wizard's step indicator; Search & Replace has Cancel beside Back.
- The auto-lock warning is a standard warning toast (no separate title line or Dismiss button).
- The LLM log viewer shows full message text with "Show all", and no longer shows the legacy verbose JSON blocks of old rows.
- Roleplay-template buttons, the theme browser's inputs and a few settings headings use `qt-*` classes and so follow the theme.
- Error toasts read as the server's sentence or the screen's own fallback.
- Shift- or Alt-click on a homepage card or a theme file link opens a browser window rather than a workspace tab.
- A failed "remember my choice" on the delete-message dialog, and a failed transcript record for a generated image, now say so.
- Lists that became queries show their cached rows while they re-read.
- The story background no longer polls every five seconds while the realtime socket is up.
- Copy buttons fall back to `execCommand` when the Clipboard API refuses.

## 5. Examined and left alone

So the next reader does not redo the survey.

- **`MessageRow`'s memo comparator and its unread `streaming` / `turnState` props.** Rows re-rendering on those ticks is what refreshes their callbacks today; the message actions write state from the closure they were rendered with (#264). Fix #264 with functional updates first; then the props and their comparator lines can go. `forceRender` is read and stays.
- **A `useWardrobeMutations` hook.** The three wardrobe writers refresh in different orders and one needs a `chatId` the editor does not have; not neutral.
- **One probe / model-list shape for the three profile families.** It is the fix for #255, #294, #295 and #296 and belongs with them.
- **Folding `ImageModal` and `ImageDetailModal` onto `FullScreenImageViewer`.** The viewer takes no focus, is not a member of the modal stack and has no slot for the metadata panel (#300 stays open).
- **A shared console transcript hook** for the help chat and the Brahma console: the stream path could not be shown to stay identical.
- **Theme-editor token parsing through `lib/themes/engine/values/`.** The editor's four regexes do not accept exactly what the engine's helpers accept (`+` signs, nested fallbacks, weight keywords). Moving them is a behavior change to settle on its own.
- **The remaining 230 raw `fetch(` calls.** Streams, uploads, the setup and unlock pages (deliberately plain), `useSummaryActions` / `useMemoryActions` / `useSSEStreaming`'s stop and raise-hand (their messages embed the HTTP status and their tests mock a bodyless fetch), and `InsertAnnouncementDialog` / `InformDialog` (they prefer the body's `message` over `error`).
- **The theme provider's own state** (theme list and preference held outside the query cache, `components/providers/theme/`).
- **23 hand-rolled spinners** that no `qt-spinner*` class reproduces (border-bottom arcs, refresh arrows, the hourglass).
- **`getAvatarSrc` in `components/ui/Avatar.tsx` and `ProfileEditSection`**: a different precedence from `characterAvatarSrc`; reconciling them changes output.
- **`components/` importing from `app/aurora/[id]/hooks/`** (`mergePhysicalDescription`, `useCharacter`): inverted; they could move to `lib/`.
- **Decisions, not refactors:** the title order in the Inventory and the Wardrobe (#312); "container from dialog context" spelled three ways across the item dialogs; what "Re-extract memories" means (#242); the default connection profile in the four remaining dialogs (#246).
- **`FileBrowser`'s retirement** ([browser-family](refactor-4-12-browser-family.md) phase 5) is still open, with a new fact: `app/prospero/[id]/components/FilesCard.tsx` and `components/document-browser/DocumentViewer.tsx` import `components/files/*`, and `useProjectFileUpload` still posts to `/api/v1/files?action=upload`, so the folder cannot be deleted wholesale.
- **Refuted on verification:** scroll-to-message missing unrendered rows (the virtualizer's overscan keeps them mounted); a standalone document losing edits on tab close (the close guard and blur flush them); a `qtap://self/` address from Document Mode; a failed scan writing a status the server did not record; the optimizer stuck on progress; an unhandled rejection in the Storyteller board. Real but too narrow to file: the plugin name mismatch on uninstall; a cleared die field pinning a face.

## 6. Still owed

- **The browser check.** Nothing here was looked at in a running instance. Worth a pass on V4test: Document Mode saves and conflicts in the Salon and in a standalone tab; the Workbench's dialogs and radio groups; Search & Replace end to end; the theme editor's save, undo and Calliope proposals; the item editors' pictures and transfers; the settings cards' defaults.
- **The issues.** 100 of the 115 are open.

## 7. Bugs filed

All verified by reading the code at `HEAD` by two readers; none was reproduced in a running instance. #351 was proved with a test.

| # | Severity | Bug | State |
|---|---|---|---|
| #237 | Medium | Choosing "No default profile" on a character never clears the saved connection profile | open |
| #238 | Medium | Character Optimizer reports success and closes even when applying the changes failed | open |
| #239 | Medium | Saving or deleting any progression silently erases the entries Aurora could not parse | open |
| #240 | Medium | Rename/Replace runs whatever is typed now, not what the preview showed | open |
| #241 | Medium | Deleting a character when the preview fails also deletes its chats and images | open |
| #242 | Medium | "Re-extract memories" behaves differently in the Salon and can wipe memories it cannot replace | open |
| #243 | Medium | Create NPC silently drops the uploaded avatar and leaves an orphan image | open |
| #244 | Medium | Pascal hold dialog keeps showing the old oracle answer after Re-ask | open |
| #245 | Medium | Pressing Enter or Space on a chat card's buttons opens the chat instead | open |
| #246 | Medium | Dialogs pick different default connection profiles, and some pick a deleted one | open |
| #247 | Medium | Help chat in the workspace never knows which page or tab I am on | open |
| #248 | Medium | A qtap:// link outside a chat opens the document into some other open chat | open |
| #249 | Medium | "Draft formatting instructions" adds nothing visible to the template prompt | open |
| #250 | Medium | Concierge settings fields lose keystrokes while each one saves | open |
| #251 | Medium | Tag style editor saves per keystroke and a pending colour save undoes Bold | open |
| #252 | Medium | Roleplay and prompt template save errors appear behind the open modal | open |
| #253 | Medium | AI import wizard is stuck on Generation after a failure, with no way back | open |
| #254 | Medium | Nudge on another character while one is speaking does nothing but a toast | fixed |
| #255 | Medium | Connection profile dialog says nothing when Save, Fetch Models, Test or Auto-configure fails | open |
| #256 | Medium | Re-saving a wizard-made connection profile silently caps replies at 1000 tokens | open |
| #257 | Medium | Escape in the model search box closes the whole profile dialog and discards edits | open |
| #258 | Medium | "Re-embed Everything" after setting a default embedding profile queues the full re-embed twice | open |
| #259 | Medium | Range sliders in Context Compression and Tasks Queue ignore the keyboard | open |
| #260 | Medium | "Save to my gallery" from a character photo album fails with "Image not found" | open |
| #261 | Medium | Unsaved document edits are discarded when a character closes the document | open |
| #262 | Medium | Hidden terminal pane pops back open, and the agent-mode toggle flips back | fixed |
| #263 | Medium | Salon keyboard shortcuts act on every open Salon tab, including hidden ones | fixed |
| #264 | Medium | Swiping one reply after swiping another undoes the first swipe | fixed |
| #265 | Medium | Inventory and Atlas picture "Upload…" cannot be reached or used from the keyboard | open |
| #266 | Medium | Workbench condition key can't be typed when a prefix matches another key on the line | open |
| #267 | Medium | Import preview checkboxes do nothing: every entity in the file is imported | open |
| #268 | Medium | Re-running the provider wizard from Settings fails with "already exists" or half-saves | open |
| #336 | Medium | A saved tag colour does not show anywhere else until the page reloads | fixed here |
| #339 | Medium | LLM log viewer shows blank message and response content | fixed here |
| #351 | Medium | Nested dialog drops behind its parent after switching workspace tabs; Escape closes the parent | open |
| #269 | Low | Character memory search sends a request on every keystroke | open |
| #270 | Low | Undefined CSS variables in TSX leave color swatches blank and checkboxes unthemed | open |
| #271 | Low | Character delete dialog can send the delete twice | open |
| #272 | Low | Deleting a group from the Aurora grid happens with no confirmation | open |
| #273 | Low | AI Wizard scenarios that fail to save are dropped without telling the user | open |
| #274 | Low | Add Character dialog resets the chosen "Controlled By" when the character list changes | open |
| #275 | Low | Rename Chat dialog reopens with text the user cancelled | open |
| #276 | Low | Switching themes quickly can leave the wrong theme's styles, and a failed save is silent | open |
| #277 | Low | Accessibility gaps in the autonomous-room badge, delete popover and settings card | open |
| #278 | Low | LLM Inspector panel stays open over other workspace tabs | open |
| #279 | Low | State editor throws away my JSON edits when the state changes in the background | open |
| #280 | Low | Dressing instructions can show another wardrobe's text after switching quickly | open |
| #281 | Low | Delete-message dialog always says the message has "1 swipes" | fixed |
| #282 | Low | A failed autonomous-room start, pause or resume gives no message | open |
| #283 | Low | Every plugin enable/disable re-runs the npm upgrade check | open |
| #284 | Low | AI import success message never shows how many items were imported | open |
| #285 | Low | Uninstalling a theme from its preview leaves the preview open as "Default" | open |
| #286 | Low | Settings page jumps to another group on its own | open |
| #287 | Low | Attention chip does not open the provider card when Providers is already showing | open |
| #288 | Low | A finished whisper closes the next whisper dialog and loses its text | fixed |
| #289 | Low | Run Tool form: a required yes/no field cannot be sent as "no" without toggling twice | open |
| #290 | Low | Library file picker shows gallery thumbnails while Salon images are quick-hidden | open |
| #291 | Low | Run Tool form resets while being filled if the chat's first active character changes | open |
| #292 | Low | Mention chips' cards cannot be pinned open from the keyboard | open |
| #293 | Low | Settings cards stay on "loading profiles" forever if one profile list fails to load | open |
| #294 | Low | New profile dialog reopens showing the last new profile's test results and model list | open |
| #295 | Low | Image profile form can show the previous provider's model list after a quick switch | open |
| #296 | Low | Text-replacement and embedding-profile failures are never shown to the user | open |
| #297 | Low | Image viewer toasts say "Character's photo album" instead of the character's name | open |
| #298 | Low | Gallery action buttons stay invisible when reached by keyboard | open |
| #299 | Low | Profile page keeps showing the old name, email and avatar after saving | open |
| #300 | Low | Image viewer keeps showing "deleted image" and stale album links after Prev/Next | open |
| #301 | Low | A failed photo delete in a character album still removes the tile | open |
| #302 | Low | Edit Enclave can throw away typed edits when the room's status is re-read | open |
| #303 | Low | Help chat swallows a failed new conversation, and New Chat leaves the old reply streaming | open |
| #304 | Low | Escape in a dialog also takes the document or terminal pane out of focus mode | fixed |
| #305 | Low | Salon header keeps a character's old name and avatar after they change | fixed |
| #306 | Low | Salon actions fail with no message and no rollback | fixed |
| #307 | Low | A single edit typed in Markdown source mode after a reload shows Saved but is not written | open |
| #308 | Low | A private Pascal roll's announcement bar says "to unknown" instead of "to you" | open |
| #309 | Low | doc_focus "line" lands on different places in Markdown and in JSON/CSS documents | open |
| #310 | Low | Salon terminal, save-image and speaking-as controls hide state from screen readers | open |
| #311 | Low | One click on Delete permanently removes an Inventory or Atlas picture with no confirmation | open |
| #312 | Low | Inventory and Wardrobe lists file "The …" titles under T, unlike the Atlas and scenarios | open |
| #313 | Low | Salon keeps showing "Speaking as" after the server has ended the impersonation | fixed |
| #314 | Low | Workbench "Insert value" menu has no Escape, arrow keys or focus handling | open |
| #315 | Low | Workbench JSON mode can save broken JSON without the "save it broken?" confirm | open |
| #316 | Low | Workbench ?new=1&mount= link does not preselect the destination store | open |
| #317 | Low | Clicking the selected "Hand-typed sheet" button erases the typed fact sheet | open |
| #318 | Low | Retrying "Add fonts" after a failure adds the rest without the licence file | open |
| #319 | Low | Renaming a tool on save skips the conflict check and can be double-submitted | open |
| #320 | Low | Proving Bench re-renders every second even with no progressions | open |
| #321 | Low | Audit button says "Deal a thousand hands" but deals ten thousand | open |
| #322 | Low | Proving Bench results relabel themselves after the draft changes | open |
| #323 | Low | Tool checkboxes under a disabled plugin can be clicked but never change | open |
| #324 | Low | Search and Replace preview can show counts for an earlier search | open |
| #325 | Low | Collapsing the Almanack card mid-run loses its progress and the finished report | open |
| #326 | Low | Memory recall settings keep showing a change that failed to save | open |
| #327 | Low | Tasks queue job buttons fail silently, and Delete removes a job without asking | open |
| #328 | Low | Setup page spins forever if the unlock-state check fails | open |
| #329 | Low | Version-guard page's CLI fix command cannot work as written | open |
| #330 | Low | Imported-chat memory dialog says it analyzes one character when it analyzes every speaker | open |
| #331 | Low | Deselecting a provider in the setup wizard still saves profiles for it | open |
| #332 | Low | Editing an API key after validating it in the setup wizard keeps the old key | open |
| #333 | Low | Closing a finished restore with the X button or Escape skips the page reload | open |
| #334 | Low | Restore dialog invites drag and drop but dropping a backup file does nothing useful | open |
| #335 | Low | Salon keeps a roleplay template's old formatting, and can apply the wrong template | fixed here |
| #337 | Low | Scriptorium list hides why creating or renaming a store failed (name already taken) | fixed here |
| #338 | Low | Formatting toolbar can show the previous roleplay template's buttons after a switch | fixed here |
| #340 | Low | Document picker can show the "Look everywhere" store list after the box is unticked | fixed here |
| #341 | Low | Recording a generated image in the transcript can fail with no message | fixed here |
| #342 | Low | Inline search can show results for an older query | fixed here |
| #343 | Low | New Chat prompt picker can mark the wrong prompt "(Default)" | fixed here |
| #344 | Low | Theme preview shows the old version after a theme is reinstalled | fixed here |
| #345 | Low | Export dialog's step counter jumps (3 of 4, then 4 of 5) | fixed here |
| #346 | Low | Cancelling Default Tool Settings keeps the unsaved toggles for next time | fixed here |
| #347 | Low | Profiles linked to an API key automatically still show as keyless until reload | fixed here |
| #348 | Low | Profile pickers warn "No API Key" on Ollama, Courier and other keyless profiles | fixed here |
| #349 | Low | Delete All Data leaves old data on screen and leaves projects out of its counts | partly fixed here |
| #350 | Low | My Photos retries a failing "load more" in a tight loop | open |
