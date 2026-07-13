# Quilltap Changelog

## Recent Changes

### 4.8-dev

#### Change: nudging a character is now a persisted Host announcement

Nudging a character to speak previously showed a client-only "_Name_ was asked to speak" note that lived in React state and vanished on reload. It is now a real Host announcement (`systemSender: 'host'`, `systemKind: 'nudge'`, `hostEvent.participantId`) posted server-side when the summoned turn begins and surfaced live over SSE, so the invitation is a permanent part of the transcript and the characters see it in context.

- The Host posts "The Host turns to _Name_ … and invites them to take the floor"; an opaque-room variant carries persona-free steering so the summoned voice knows the floor is theirs.
- The announcement renders as an amber (`medium`) announcement chip labeled "invited to speak", with content-inference fallback for any row missing the `systemKind` column.
- Removed the now-orphaned ephemeral-message subsystem — the nudge was its only remaining user. Deleted `EphemeralMessage`/`EphemeralMessages` and their state plumbing across the Salon view, streaming, and turn-management hooks.

#### Fix: answer-confirmation amendments now stay in the current conversation

When the answer-confirmation check flagged a character's reply and the character's own model was asked to correct it, the correction pass received only the draft reply plus the reference material (recalled memories and lookup results). It had no view of the actual conversation. When the reference material quoted an older conversation the character had read via `read_conversation`, the model would treat that old exchange as the live scene and rewrite its reply into it — producing an amendment that answered the wrong conversation.

The re-affirmation pass is now given a compact transcript of the recent live conversation (`buildRecentConversationContext` in `answer-confirmation.service.ts`) plus the character's name, and the prompt is rewritten to require a minimal, in-scene correction: same addressee, same moment, same tone, changing only the details that conflict with the facts. The reference block is now explicitly labeled background knowledge rather than the conversation. The transcript filters out Staff/system-sender whispers, tool bubbles, and silent messages, and the pass degrades gracefully when there is no prior dialogue.

#### Feature: characters can pass a turn when they have nothing to add

In group chats, every LLM character is now given a per-turn option to pass instead of being forced to reply with filler. On any turn except the very first character turn of the chat, a character may respond with the single line `[NOTHING TO ADD]`; the Host then posts a short "nothing to add" note and the rotation moves on to the next speaker. If a character has been addressed or mentioned since it last spoke, its turn note warns it to answer rather than pass.

- Scope: the feature applies only to genuine group scenes — chats with more than two active character participants, or with at least two LLM-driven characters. A one-on-one (a lone human plus a single character) is excluded entirely.
- New per-chat toggle **Turn Skipping** in the Chat Sidebar's Visibility drawer (shown only in qualifying group chats). Default is on; `turnSkippingEnabled` is a nullable chat column where NULL/true = on.
- A pass is recorded as a Host message (`systemKind: 'turn-pass'`, `hostEvent.participantId`) — no new message-sender or state columns. Turn-state, the stall guard, and the client all recompute passes from history.
- Stall guard: when every other active character has passed since the last substantive message, the next speaker is forced to speak (the skip option is withheld). The same rule powers the human case — the Salon **Skip** button now posts a Host "nothing to add" note, and is hidden (and refused server-side with a 400) when everyone else has already passed.
- Nudged or queued characters are never offered the skip option (they were explicitly summoned); the Continue button's algorithm-picked speaker is.
- Applies to autonomous rooms: a pass consumes a turn from the run budget (already the case — every job counts as a turn), and the stall guard bounds all-skip loops.
- New migration `add-turn-skipping-field-v1`. `.qtap` export/import round-trips `turnSkippingEnabled` and the turn-pass Host messages.

#### Feature: copy a conversation's UUID from the header or the Organize drawer

The header of a Salon chat now has a small copy button just after the conversation title that puts the chat's UUID on the clipboard, and the title itself is now a direct link to the conversation's Salon URL. The Chat Sidebar's Organize drawer has the same copy button at the top, before Rename. Both buttons flash a check-mark for a moment after copying. New shared component `components/chat/CopyChatIdButton.tsx` (inline icon variant for the header, full palette-button variant for the sidebar), built on the existing `useCopyToClipboard` hook.

#### Feature: a status dialog while a new conversation is assembled ("The Green Room")

Starting a fresh conversation — or continuing one elsewhere — fires a single blocking `POST /api/v1/chats` and then navigates into the Salon. That request quietly does a lot of slow work before it returns: resolving the cast, running a per-character LLM "choose what to wear" step, compiling identity stacks, backfilling continuation history, and seeding the opening scene. The wardrobe step is usually the longest part (one cheap-LLM call per character set to "have them choose"), and until now none of it was visible — the app just sat there.

A blocking, non-dismissable status dialog now appears the moment creation begins. It shows a live status line, and for each character choosing an outfit via LLM it shows a "consulting the wardrobe for _Name_" panel that resolves into the decided four-slot outfit (top / bottom / footwear / accessories). A scrolling activity log runs beneath. The dialog can't be dismissed while creation runs; it closes on its own once the conversation is ready for input. Only on failure does it offer a Close button.

- Progress travels on a side-channel so the create request keeps returning JSON as before. The client sends a correlation id (`progressId`) with the POST; the handler publishes milestones and wardrobe results to an in-memory bus (`lib/chat/creation-progress.ts`) keyed by that id; the dialog subscribes over SSE at `GET /api/v1/chats/creation-progress?id=…`. The bus buffers events per id and replays them on connect, so a subscriber that attaches a beat late loses nothing. Fully backward compatible: with no `progressId`, creation behaves exactly as before.
- Scope: fresh starts and "Continue Elsewhere" only (both go through the create endpoint). Autonomous-room creation and per-message turns are unaffected — the per-turn window already narrates itself inline in the composer.

#### Fix: character replies no longer block for minutes describing a generated image

When a character responds on a non-vision model (e.g. DeepSeek) and a recently generated image is in context — a fresh avatar, a story background, or a `generate_image` result — the orchestrator has to turn that image into text the model can read. It did this by sending the image to the configured vision profile on every turn, inline, with no caching. On the first turn after an avatar was generated this added minutes of latency: in one observed case a `glm-4.6v-flashx` description call blocked a reply for nearly three minutes while the actual response model needed only eleven seconds.

Images Quilltap generated already carry the exact prompt that produced them (`FileEntry.generationPrompt` / `generationRevisedPrompt`), which is the most faithful description available. The fallback now reuses that persisted text (and a stored `description` for already-described uploads) and skips the vision call entirely. The vision model is only invoked for genuinely unknown images — user uploads that haven't been described yet. This takes the whole vision round-trip off the reply path for self-generated images.

- The image-description fallback call is now recorded in `llm_logs` as an `IMAGE_DESCRIPTION` entry (it was previously invisible, so its latency and token use couldn't be diagnosed), runs under a 60-second hard timeout (a slow or degraded describer can no longer wedge a reply), and downsizes the image to the description provider's size limit before sending. All logging is best-effort and never blocks description generation.

#### Fix: bare-topped character avatars crop at the collarbone instead of tripping image moderation

A character with a bare upper body (e.g. an "Active Nudist" wardrobe) could not get an avatar generated on a SFW image provider: the head-and-shoulders prompt emitted "topless" wardrobe wording and cropped low enough to put a bare chest in frame, so the provider rejected it on content moderation. Avatar prompts for a bare-topped character now crop tighter — a close-up headshot at the collarbone with bare shoulders, chest and torso out of frame — and omit the "topless"/"naked" wording entirely (the same way lower-body slots are already omitted for portraits). Bare shoulders and neck are unremarkable to image providers; a bare chest is what gets refused, and the tighter framing keeps it out of the picture. Above-the-collar accessories are still described; clothed characters are unaffected.

#### Improvement: Document Mode change diffs are now real, minimal unified diffs

The diff shown when a Document Mode file is edited (the Librarian's save announcement in chat, and the diffs the `doc_*` edit tools attach to their notes) is now a proper git-style unified diff instead of a homegrown approximation. The old algorithm walked both versions with a fixed 3-line lookahead window, so any change that shifted or re-aligned content further than three lines apart was reported as a wholesale block of removals followed by a block of additions, and hunks carried no surrounding context — the result read nothing like an actual `diff`.

The Myers shortest-edit-script diff now lives in a shared `lib/doc-edit/line-diff.ts` primitive. `generateUnifiedDiff` in `lib/doc-edit/unified-diff.ts` builds on it, grouping the edits into hunks with up to three lines of unchanged context on each side, coalescing nearby edits into one hunk and splitting distant ones apart — exactly as `git diff` does. Unchanged lines stay as ` ` context, only genuinely changed lines get `-`/`+`, hunk headers report correct `@@ -start,count +start,count @@` ranges, and truly-empty content is treated as zero lines (so creating or emptying a file no longer churns a phantom blank line). A safety fallback emits a coarse whole-file hunk for pathologically large, wholly-dissimilar inputs. The exported function signatures and output contract are unchanged, so callers and the autosave notification format are unaffected.

The in-editor change gutter (the thin bars beside edited blocks in Document Mode) now shares the same treatment. It previously compared blocks by position — baseline block *N* against current block *N* — so inserting or deleting a paragraph near the top shifted every block below it and lit the entire remainder of the document as "changed." It now derives the marked blocks from the shared line diff (via `changedBlockIndices`), so only blocks that are genuinely new or modified are flagged; blocks that merely shifted position stay unmarked, and a deletion marks nothing (it has no counterpart block to sit on, just like a unified diff's `-` line).

#### Fix: stale-chat image cleanup now ignores Staff announcements

The daily maintenance sweep that collapses a stale chat's superseded story-background and avatar images decided "stale" from the chat's `lastMessageAt` (falling back to `updatedAt`). But personified-feature / Staff messages (Lantern, Aurora, Host, Prospero, Carina, Concierge, Commonplace Book, Ariel, Suparṇā, Librarian) persist as `type: 'message'` rows and also bump `lastMessageAt`, so a whisper into an otherwise-quiet chat (e.g. a Suparṇā mail-delivery announcement) reset the 30-day staleness clock and kept dead images around indefinitely. Staleness is now keyed off the last *played* message — one authored by a participant character or the human user — via the new `chats.getLastPlayedMessageAt(chatId)`, which excludes any message carrying a `systemSender`. It falls back to `updatedAt` only when a chat has no played messages at all. No backfill needed: the sweep recomputes staleness from live data on each run.

- New repository method `getLastPlayedMessageAt` does an indexed single-row lookup (`type = 'message' AND systemSender IS NULL`, newest first) so the daily sweep doesn't load and validate every chat's full transcript.

#### Fix: renaming a Document Mode file now updates the recent-documents list

Renaming a file while editing it in Document Mode now keeps the recent-documents history in sync in both entry points. Previously, standalone Document Mode (opened from the left sidebar, no chat) renamed the file on disk but left its `chat_documents` tracking row pointing at the old path, so the renamed file showed the old name in the Open Document picker's recents and 404'd when reopened. The standalone rename handler now updates the tracking row. The Salon rename path, which already updated its own chat's row, additionally sweeps any other chats' (or the standalone) rows that still reference the old path, so the shared recent list stays consistent everywhere.

- Both paths reuse `chatDocuments.renameFilePathInStore(scope, mountPoint, oldPath, newPath, newDisplayTitle)` — the same chokepoint the `doc_move_file` tool uses. Updates are best-effort: the rename has already succeeded on disk, so a tracking failure is logged and never fails the request.

#### Fix: run_sql handler tests no longer pick up the Jest SQLite mock in CI

The `run-sql-handler` unit suite (a real-binding suite) broke in CI after `better-sqlite3-multiple-ciphers` was added to the unit Jest `moduleNameMapper`: its driver loader's bare `require('better-sqlite3-multiple-ciphers')` fallback started silently returning the mock, whose statements never report `readonly: true`, so the handler's fail-closed guard rejected every query (16 failures). The loader now prefers path-based requires (which bypass `moduleNameMapper`), probes each candidate with a prepared `SELECT 1` to confirm it is a real binding, and throws a clear error instead of silently running against the mock.

Documents opened from the left sidebar's Document Mode (no chat) are now tracked in the recent-documents history, so they appear in the Open Document picker's recents like chat-opened documents do. Previously these opens recorded nothing, so they never showed up as recent.

- Standalone opens now write a `chat_documents` row under a reserved sentinel `chatId` (`STANDALONE_CHAT_ID`), which the cross-chat recents query already reads. Reopening the same file reactivates and bumps its existing row. Tracking failures are logged and do not block the open.

#### Feature: standalone Document Mode from the left sidebar

The left sidebar now has a Document Mode button (file-plus icon, above Settings) that opens the Open Document dialog without a chat. Selected documents open as standalone workspace tabs with the full Document Mode editor — no Librarian announcements and no conversation is notified of edits. (Opens are recorded in recent-documents history under a sentinel chatId; see the 4.8-dev fix above.)

- The picker in chat-less mode always "looks everywhere" (every enabled store; the toggle is hidden), hides the project-library shortcut, and lists recent documents across all chats (project-scoped recents are omitted since there is no project context to resolve them).
- New `document-standalone` workspace tab kind. Reopening the same file focuses its existing tab; tabs persist across reloads and reopen their file. Blank documents update their tab payload once the server names them so reloads don't mint duplicates.
- Outside the workspace, the button funnels through `/workspace?open=document-standalone&…`.
- New chat-less API route `/api/v1/documents` with actions: `accessible-stores` (GET), `recent-documents`, `open-document`, `read-document`, `write-document`, `rename-document`, `delete-document`.
- Refactor: extracted the chat-agnostic document mechanics (operator path resolution, existence probe, untitled-name picking, mtime-checked read/write, rename/delete file moves, store listing) from the chat document actions into `lib/documents/operator-doc-actions.ts`; the chat route now delegates to it and keeps only chat-specific concerns (chat_documents rows, documentMode flag, Librarian announcements).

#### Docs: new GEMINI.md for AI agent context

Added `GEMINI.md` to the project root. This file provides a comprehensive overview of the project's architecture, key conventions, and terminology, tailored for use by AI developer assistants. It is generated by analyzing the codebase and incorporates key details from `README.md` and `CLAUDE.md` to provide deep, actionable context.

#### Fix: surfaced `qtap://` URLs now open reliably across chat content and announcements

`qtap://` links are now clickable and interactive wherever chat markdown/text surfaces them, including staff announcements (Librarian, Lantern, Aurora, etc.).

- Added shared `qtap://` link handling that resolves target type and opens text documents in Document Mode, images in the fullscreen image viewer, and shows a warning toast for unsupported file types.
- Added linkification of bare `qtap://` literals in chat-rendered markdown/text (not only pre-marked markdown links), with inline/fenced code excluded.
- Fixed a no-op click path where `open-document` returned `200` server-side but the UI did not surface/focus the opened document; the client now reconciles and focuses the opened document row/tab immediately.
- Replaced the qtap link emoji prefix with the built-in themeable icon system (`Icon name="file"`).

#### Fix: unit tests no longer load native SQLite bindings

Stabilized the Jest split between unit and integration coverage so native SQLite/SQLCipher bindings are only loaded by integration tests.

- Unit Jest now mocks both module specifiers: `better-sqlite3` and `better-sqlite3-multiple-ciphers`.
- Native-binding suites were reclassified to `*.integration.test.*` and excluded from unit discovery.
- Integration Jest now includes those reclassified suites explicitly.

#### Feature: Document Mode now shows and copies each document's qtap URL

In Salon Document Mode, the header area now includes a short URL line between the title/actions row and the editor toolbar. It shows the current `qtap://` URI for the open document and updates automatically when the document is renamed.

- Added a compact `qtap://` URL row under the document header controls.
- Added a copy icon button that writes the current URL to the clipboard.
- Added a green success toast when URL copy succeeds.

#### Feature: Document Mode rich Markdown now shows YAML frontmatter as metadata

In Salon Document Mode, Markdown files with YAML frontmatter now render that frontmatter as a read-only "Document Info" key/value table in rich mode instead of showing raw `---` delimiters and YAML lines inside the editor surface.

- Rich mode now edits only the Markdown body content.
- Source mode still shows and edits the full raw document bytes, including frontmatter.
- Array-like frontmatter values render as individual chips for clearer scanning.
- Frontmatter values render as plain text in the table (no Markdown formatting inside metadata values).

#### Fix: Lexical editors now render with solid (non-transparent) backgrounds

Applied an explicit opaque background to shared Lexical editing surfaces so editor panes no longer show transparency in any theme.

- Chat composer Lexical contenteditable now paints an explicit base background.
- Document Mode's Lexical editor area now paints an explicit base background.
- Source-mode textareas used alongside Lexical editors (Document Mode and reusable markdown Lexical editor) now use the same opaque base background.

#### Fix: non-Salon footer now uses the header background and stays opaque on Home

Updated the shared app footer styling so non-Salon pages render the footer with the same background treatment as the page toolbar/header, and pinned its stacking context above fixed homepage background overlays. This prevents the Home page background image layer from visually bleeding through the footer in themes that use transparent main containers.

#### Feature: wardrobe item move/copy across General, projects, groups, and users

Added `Move` and `Copy` actions to the wardrobe row menu in the Wardrobe dialog.

- `Move` and `Copy` now open a destination picker with General, all projects, all groups, and all users (character wardrobes).
- `Copy` always generates a new wardrobe item UUID in the destination.
- `Move` preserves the existing item UUID and removes the source item after a successful write.
- Added a new transfer API at `/api/v1/wardrobe/transfers` for destination discovery and move/copy execution.
- Fixed a 400 regression where project/group destinations were incorrectly rejected as `Invalid destination`.

#### Fix: character wardrobe item deletion always failed with "not found"

The character-scoped wardrobe DELETE route still checked item existence against the `wardrobe_items` SQL table, which was emptied when wardrobe storage moved to the vault. Every delete attempt failed with "Wardrobe item not found" even though the item was still listed (list/GET/PUT already read the vault correctly). The existence check now uses the same vault-aware lookup as GET/PUT.

#### Fix: Lexical markdown editors no longer auto-escape markdown punctuation on export/save

Lexical markdown export paths were writing escaped punctuation (for example `\*`, `\_`, `\~`, and `\``) even when the author intended normal markdown delimiters. This changed bytes in saved drafts/documents and in imperative markdown reads.

- The shared Lexical markdown bridge now strips those export-time escapes by default.
- Applies to asterisks, underscores, backticks, and tildes.
- Covers Document Mode, markdown-form editors that use the shared bridge, and chat-composer markdown export paths (including draft persistence and imperative `getMarkdown()` reads).

#### Fix: forward profile provider parameters (e.g. DeepSeek thinking mode) uniformly

Extended the previous fix so *every* text-LLM call in `lib/` — cheap-LLM and direct — forwards its selected profile's provider parameters on `sendMessage` / `streamMessage`. Previously, several utility flows built minimal requests and silently dropped `thinking` / `reasoning_effort` from the chosen profile, causing reasoning models to burn their token budget on hidden reasoning and return empty content.

- `profileParams(profile)` is now a shared exported helper in `lib/llm/cheap-llm.ts`.
- Fixed direct-call paths: Concierge gatekeeper (danger classification), image-description fallback, wardrobe image analysis, character-voiced announcer, auto-configure (both the analysis call and its cheap-LLM JSON cleanup), character wizard (all field generation + physical descriptions + wardrobe items + vision), character optimizer, AI import, external-prompt generator, initial greeting.
- Outfit-appropriateness chooser (`chooseLLMOutfit`) was already routed through the shared harness and picks up the fix automatically.
- Main chat / regenerate / swipe path was already forwarding these — unchanged.

#### Fix: cheap-LLM tasks now forward provider parameters (e.g. DeepSeek thinking mode)

Cheap-LLM tasks (memory extraction, summaries, titles, answer confirmation, etc.) built a minimal request in `sendToProvider` and never forwarded the selected profile's provider-specific parameters. So a profile set to DeepSeek **Thinking Mode = Disabled** still reasoned: DeepSeek fell back to its model default (reasoning on for `deepseek-v4-flash`), which spent the whole completion budget thinking and returned empty content — surfacing as failed/blank cheap-LLM results (e.g. answer-confirmation checks resolving to "Unvetted").

- `CheapLLMSelection` now carries `profileParameters`, populated from the chosen profile at every selection site (user-defined, global default, cheap-flagged, Ollama, and the uncensored/re-affirmation paths).
- `sendToProvider` forwards `profileParameters` on every `provider.sendMessage` call, so `thinking` / `reasoning_effort` (and other allowlisted provider extras) take effect. The task pipeline still controls temperature and max-tokens at the top level; providers only apply their allowlisted extras, so this doesn't override the cheap-task sampling settings.

#### Feature: answer confirmation (Salon consistency check + re-affirmation)

Before a character's tool-using Salon reply is saved, an optional cheap-LLM consistency check compares the reply against what the character was told this turn (its last Commonplace Book whisper) and what it looked up (in-scope read-tool results: `search`, `read_conversation`, and the `doc_*` content-read family). The check only runs when there is something to check — a whisper and/or an in-scope read-tool result.

- Consistent → the reply is saved with `confirmed: true`.
- Inconsistent → the character's own model is shown the discrepancies and asked to stand by the reply (`confirmed: false`) or rewrite it. A rewrite is saved as the shown reply (`confirmed: true`, `confirmationRevised: true`); the original text is kept in `confirmationOriginalContent` for the logs.
- Check errored/timed out, or the turn was user-driven (impersonation) → `confirmed: null` (could-not-verify).
- Feature off / nothing to check → no confirmation fields written.

The Salon status bar shows `Confirming…` during the check and `Requesting affirmation of questionable results…` during the re-affirmation. Each checked message carries a small badge (Vouched / Amended / Stood by / Unvetted) that reveals the discrepancy notes on hover. The first reply streams live and is replaced in place if the re-affirmation rewrites it (a deliberate, visible transparency swap).

- Gate: global default OFF, with per-project and per-chat overrides. A project set to ON enables its chats automatically; a chat's own override always wins. Global toggle in Settings → Chat; per-project toggle in the Prospero project's Model Behavior card; per-chat toggle in the Salon sidebar's Visibility section.
- New columns: `chat_messages.{confirmed, confirmationChecked, confirmationRevised, confirmationNotes, confirmationOriginalContent}`, `chats.answerConfirmationOverride`, `chat_settings.answerConfirmationSettings` (migration `add-answer-confirmation-columns-v2`). Per-project override rides in the project's `properties.json`. All fields ride in `.qtap` exports.
- Scope: normal Salon chats only — not help chats, the Brahma Console, or Carina calls. Silent turns are skipped. The re-affirmation runs at most once (no loop). The regenerate/swipe path is not yet covered.

#### Fix: the workspace header now tracks the active (focused) tab

The contextual header (Salon project link, character avatars, chat title, cost summary) did not update when switching tabs: with several chat tabs kept alive at once, all of them wrote to the single global header and the last one to mount won, so the header showed stale content and never changed on tab activation. Switching to a non-Salon tab left the previous Salon header in place.

- Each tab's injected toolbar content is now isolated in a per-tab registry (`TabToolbarProvider` wraps every mounted tab view), so kept-alive tabs no longer clobber each other.
- A new `WorkspaceToolbarBridge` surfaces the *focused* pane's active tab's content into the single global header. Activating a different tab regenerates the header; a tab that injects nothing (e.g. Home) clears it; in a split, the header follows whichever pane has focus.
- Removed the never-wired per-pane `PaneToolbar` (and its dead `.qt-pane-toolbar` styles) that this replaces.

#### Fix: an unknown tab kind no longer discards the entire saved workspace layout

The persisted workspace validator rejected the whole saved state if any single tab had a `kind` not in its allow-list, silently wiping the user's tab layout on reload. The allow-list was also missing several real tab kinds (`profile`, `about`, `generate-image`, `character-new`, `character-edit`, `settings-wizard`), so having any of those open at reload triggered the wipe.

- The allow-list (`TAB_KINDS` in `lib/workspace/workspace-persistence.ts`) now covers every `TabKind`, guarded by a compile-time exhaustiveness check so a future kind can't be forgotten.
- Deserialization is now resilient: a malformed or unknown-kind tab drops only itself (dangling pane references are cleaned up by the existing prune step) instead of failing the whole parse. Layouts from a newer/older build survive a reload with just the unrecognized tabs removed.

#### Fix: clicking a character name in the Salon header now opens a workspace tab

Clicking a character's name in the Salon conversation header navigated the whole browser to the full-page character view, tearing down the workspace (and any streaming conversation) instead of opening the detail view as a tab.

- `/aurora/<id>/view` (and legacy `/characters/<id>/view`) now maps to a new `character-view` workspace tab kind, so the workspace link interceptor opens it in place rather than routing away. The tab is keyed by character id (each character gets its own detail tab) and persists across reloads. Its "back" action closes the tab.
- `CharacterDetailView` accepts an `initialTab` so the header's `?tab=conversations` deep-link still selects the Conversations sub-tab when opened as a tab (where the URL param isn't available).

#### Fix: thinking output silently empty on claude-sonnet-5 (and Opus 4.7+/Fable/Mythos)

After fixing the two 400 errors below, extended thinking on Sonnet 5 stopped showing up in the Salon at all — no error, just nothing. Adaptive thinking on this model family defaults `thinking.display` to `"omitted"`: the response still includes thinking blocks, but their text comes back empty unless the request explicitly asks for `display: "summarized"`.

- `qtap-plugin-anthropic` now sends `thinking: {type: 'adaptive', display: 'summarized'}` for the new-generation model family, in both `sendMessage` and `streamMessage`, so `reasoningContent` capture works again. Older models (fixed-budget thinking) are unaffected.

#### Fix: claude-sonnet-5 (and Opus 4.7+/Fable/Mythos) chats failed with two separate 400s

Selecting `claude-sonnet-5` as a chat's model failed every message with a 400 from Anthropic. Two breaking API changes on the new model generation, both unhandled by the provider plugin:

- `` `temperature` is deprecated for this model `` — the plugin always sent a `temperature` (or `top_p`) value unless extended thinking was enabled, but Sonnet 5, Opus 4.7+, and Fable/Mythos reject sampling parameters (`temperature`/`top_p`/`top_k`) outright, independent of thinking.
- `` "thinking.type.enabled" is not supported for this model `` (hit after turning on extended thinking) — the plugin always sent fixed-budget thinking (`{type: 'enabled', budget_tokens}`), but the same model family removed it; they require `{type: 'adaptive'}` instead, which has no token budget to set.

`qtap-plugin-anthropic` now detects the new-generation model family (Sonnet 5, Opus 4.7, Opus 4.8, Fable 5, Mythos 5, Mythos Preview) by ID prefix and, for those models, omits `temperature`/`top_p` entirely and switches extended thinking to `{type: 'adaptive'}` — in both `sendMessage` and `streamMessage`. Bumped `qtap-plugin-anthropic` to 1.0.45 and rebuilt.

#### Fix: token-budgeted autonomous rooms now pace their run across turns

A `chatType: 'autonomous'` room with a per-run token budget (`budgetMaxTokens`) used to spend most of that budget on a single turn. Context compaction sized each turn against the *model's* context window (often very large), so one turn could carry ~200k+ tokens of history — nearly the whole run budget — and the run exhausted after a turn or two. The per-run budget was resetting to zero correctly at run start; the problem was that nothing connected that budget to how much context each turn was allowed to build.

- The autonomous turn handler now derives a per-turn context cap from the run budget — `remaining_run_budget / turns_left` — and passes it down through the message pipeline. The context manager clamps its model-derived `maxAvailable` to that cap before computing the history and memory fold targets, so the whole context budget shrinks proportionally and the run spreads across multiple turns.
- `turns_left` reuses `budgetMaxTurns` when the room also sets a turn budget (the two budgets cooperate); otherwise it targets a default of 6 turns per run. The cap is floored at 16k tokens so a nearly-spent run still ships a usable final turn instead of a starved one.
- No effect on regular Salon chats, regenerate/swipe, or autonomous rooms without a token budget — the cap is only set for token-budgeted autonomous turns.
- New helper `computeAutonomousContextCap` (`lib/background-jobs/handlers/autonomous-room-turn.ts`), threaded via `SendMessageOptions.autonomousContextCap` → `buildMessageContext` → `buildContext`. Covered by new unit tests.

#### Fix: tag-prefix / line-prefix roleplay chips no longer collapse paragraphs

A roleplay template whose lines are tagged with a speaker prefix (e.g. `[WIFE] …`, the "Covenant RP" template) rendered every paragraph as one continuous run with no blank-line separation. The line-scoped `tagPrefix`/`linePrefix` rules apply a roleplay chip class (`qt-roleplay-1`, `qt-chat-ooc`, etc.) directly to the block element (`<p>`/`<li>`/heading) by design, but the shared chip geometry forced `display: inline` — written assuming those classes only ever land on inline narration spans. On a block that collapsed all the paragraphs into a single inline run, erasing the paragraph breaks.

- Block-level elements carrying a roleplay chip class now keep normal block flow (`display: block`; list items keep `display: list-item`), so paragraph breaks survive. Inline narration/dialogue/monologue spans are unchanged.
- Fixed in both chip families: `qt-roleplay-1..4` / semantic chips (`app/styles/qt-components/_roleplay.css`) and the legacy `qt-chat-narration` / `qt-chat-ooc` / `qt-chat-inner-monologue` classes (`app/styles/qt-components/_chat.css`).
- CSS-only; affects both the client renderer (`MessageContent.tsx`) and the server pre-renderer (`markdown-renderer.service.ts`) uniformly, since both land the line class on the block element.

#### Dev: export autonomous-room budget functions for the Rust port harness

Exported `checkBudget`, `computeBudgetProgress`, and their result/binding types (`BudgetCheckResult`, `BudgetVerdict`, `BudgetExhausted`, `MilestoneBinding`) from `lib/background-jobs/handlers/autonomous-room-turn.ts`. The quilltap-v5 differential port harness imports the real budget-math functions to check the Rust port for equivalence. The exports carry `@port-oracle-export` comments so a dead-code or unused-export sweep won't strip them — they have no importer within this repo. No behavior change.

#### Fix: editing/deleting a message no longer scans the whole account

The per-message endpoints (`PUT`/`DELETE`/`POST ?action=reattribute` on `/api/v1/messages/[id]`) located a message by loading and re-validating **every message in every chat** the user owns, then saved by deleting all of the target chat's messages and re-inserting them one at a time. On a large instance (hundreds of chats, tens of thousands of messages) backed by a slow or network-mounted database, a single edit could take many seconds, time out, or fail with a bare "Failed to update message" and nothing useful logged.

- Messages are now located with a single indexed lookup on the message id (`chats.findChatIdForMessage`) plus an ownership check, instead of an account-wide scan.
- Edit and re-attribute now update the one affected row via `updateMessage`; delete removes only the targeted ids via `deleteMessagesByIds`.
- This also fixes a latent data-loss bug: the old clear-and-rewrite path rebuilt the chat from the *validated* message set, so editing or deleting any message in a chat that contained a separately-corrupted message would silently drop the corrupted row.
- Salon UI: after a successful edit the message now shows the new text immediately. The save handler read `content` off the top level of the `{ message: … }` response (always `undefined`), so the edited bubble blanked until a full reload; it now reads `message.content` (falling back to the submitted text) and maps over the current message list instead of a stale closure.

#### Docs: refresh BACKGROUND_JOBS_CHILD.md to match current handlers

Brought `docs/developer/BACKGROUND_JOBS_CHILD.md` back in line with the code after the 4.6 autonomous-room work and the configurable-concurrency change. Handler count corrected from 18 to 24; added audit rows for `autonomous-room-turn`, `autonomous-run-start`, `autonomous-room-schedule-tick`, `autonomous-room-announce`, and `regenerate-conversation-summaries`; renamed the `wardrobe-announcement` row. Documented the `shutdown-ack` IPC message and the three added host-RPC methods (`writeConversationSummaryToVaults`, `removeConversationSummariesFromVaults`, `startScheduledAutonomousRun`). Corrected the concurrency section: the global cap is read live from the `maxConcurrentJobs` instance setting (4 is only the fallback default), not a fixed value. Docs only — no code change.

#### Z.AI plugin: Reasoning Effort option, glm-5.2 defaults to `high`

Added a **Reasoning Effort** connection-profile option to the Z.AI (GLM) plugin, mapping to Z.AI's `reasoning_effort` request parameter. It only takes effect on glm-5.2 (and newer generations — glm-5.3, glm-6, revisioned ids like `glm-5.2-0626`); it is never sent to glm-5.1, glm-5, glm-5-turbo, the 4.x line, or vision models.

- The editor exposes only the distinct levels — `(model default)`, Minimal, High, Max — because Z.AI's scale is coarse (low/medium fold up to high; xhigh folds to max).
- **glm-5.2 now defaults to `high` effort instead of the API default `max`.** GLM-5.2 thinks compulsorily (thinking defaults to enabled server-side), so a profile left at "(model default)" was previously burning output tokens at the most expensive `max` setting. The plugin now sends `reasoning_effort: 'high'` whenever thinking is not explicitly disabled and no explicit effort is set, curbing runaway thinking-token usage out of the box. Choosing Disabled thinking, or an explicit effort, overrides the default.
- Note: effort is not a hard token cap — reasoning still counts against `max_tokens`, and hitting the ceiling yields `finish_reason: "length"`. Pair a lower effort with a sane `max_tokens` for the robust fix.
- Plugin `qtap-plugin-z-ai` bumped to 1.1.14.

#### Any participant can be switched between user-typed and an LLM

The connection-profile dropdown now appears on every participant card in the Salon sidebar, including the seat you are currently typing as ("You"). Previously the active user seat showed only a "You" badge with no control, so you couldn't hand it off to an LLM without first switching your "Speaking As" selection to another character. The dropdown's "User (you type)" option still reclaims any LLM-driven character for manual control. Switching your only user-controlled seat to an LLM leaves an all-LLM chat (still supported; you can rejoin by impersonating). No data-model change — this was a UI gate; the `controlledBy` field and all turn/impersonation logic already supported the transition.

#### Consistent message-send options across both send endpoints

The two POST endpoints that drive the Salon — `/api/v1/messages?chatId=` (main composer) and `/api/v1/chats/[id]/messages` (whisper dialog) — now build their `handleSendMessage` options from one shared helper, so the forwarded payload fields can't drift apart.

- `/api/v1/messages?chatId=` previously dropped `targetParticipantIds` (whisper targeting) and the scrubbed browser `User-Agent` (used by character tools like curl). Both are now forwarded, matching the other endpoint.
- `speakingAsParticipantId` now reaches the orchestrator uniformly from both routes in both send and continue mode (previously the whisper route omitted it in continue mode).
- Option-building and the SSE response wrapper are centralized in `lib/services/chat-message/request-helpers.ts`; future fields added to `sendMessageSchema` only need wiring in one place.

#### Regenerate now replaces in place and keeps the right character

Reworked message Regenerate (swipe), which was a legacy path that bypassed the chat engine and broke in multi-character scenes.

- The regenerated response is now attributed to the **same character** whose message you regenerated. Previously the new variant was saved with no participant, so it showed the wrong character's name and avatar (and in a chat with multiple user-controlled characters, often the first one).
- Regenerate now runs through the same context engine as a normal turn, so the new response gets the character's real system prompt, multi-character attribution, and memory — instead of a stripped-down raw prompt.
- The new version replaces the old one **in place** as a swipe variant, with the original kept one swipe away. Previously the original's swipe grouping was never saved, so the regeneration showed up as a separate, stray message rather than an alternative.
- A swipe group now shows its newest variant by default (the original stays accessible via the swipe arrows).
- Regenerate is correctly limited to character messages — Staff/system announcements (the Host, Prospero, the Lantern, etc.) can no longer be "regenerated."

#### "Speaking As" is now honored when you have two user-controlled characters

Fixed a multi-character attribution bug: when a chat had more than one user-controlled character, a message you typed was always attributed to the *first* user-controlled participant, ignoring the "Speaking As" selector. The wrong character's name and avatar showed on the message, and the responding AI was told the wrong character had spoken.

- The send path now resolves the human speaker from the active "Speaking As" selection (with the first user-controlled participant as the fallback), instead of always taking the first one. This is applied consistently across message attribution (who the message is saved as), the responder's system-prompt identity (who it thinks it's talking to), and the new-message label in the AI's context.
- The composer now sends the active speaker explicitly with each message and regenerate, so attribution no longer depends on a separately-persisted chat field landing first.
- The optimistic message bubble is attributed to the selected speaker immediately, so it renders with the right name and avatar before the server round-trip.
- Private whispers now honor "Speaking As" too — a whisper sent while playing a second user-controlled character is attributed to that character, not the first one.
- New shared helper `findActiveUserParticipant` replaces ad-hoc "first user-controlled participant" lookups in the three server resolvers; the deprecated `findUserParticipant` is no longer used on the send path.

#### Commonplace Book recall is more on-topic

Reworked the ranking math behind the per-turn "relevant memories" whisper so recall actually tracks what the scene is about, instead of resurfacing the same few high-importance memories every turn.

- Relevance now leads the ranking. Candidates are scored `0.75·cosine + 0.25·rawWeight` (was `0.4·cosine + 0.6·effectiveWeight`), and the importance/recency term decays with age instead of being pinned to a permanent 70% floor. A stale "important" memory no longer outranks a genuinely on-topic one. The blend coefficients are centralized in `lib/memory/memory-weighting.ts` (`computeRankingBlend`) so all four ranking sites stay in sync. The 70% floor still governs housekeeping/protection — only retrieval ranking changed.
- Added a real relevance floor. When nothing in memory clears a minimum cosine, the whisper now says nothing rather than emitting filler. The floor is provider-aware: a lower default for the local TF-IDF profile, a higher one for neural embedding profiles.
- The per-turn search query is now sentence-shaped: a short recent-conversation window instead of a single one-line message, and when cheap-LLM distillation is on, a natural-language paraphrase of the moment instead of a bare keyword bag.
- Added light anti-repetition: a memory whispered in the last few turns takes a bounded penalty so the same entry doesn't read as a stuck record. Tracked per chat in a new `chats.commonplaceRecallHistory` column (ephemeral; not exported).
- A dimension-mismatch between the search profile and a character's stored index — which silently degrades recall to keyword text search — now logs a one-time actionable warning instead of failing over silently.

#### Merge a conversation into another

The Salon's Organize sidebar has a new "Merge In…" button — the inverse of "Continue Elsewhere." It folds another conversation's characters and summary into the current chat at the latest point, instead of forking forward into a new one.

- Pick a recent conversation from a list showing who was involved and when it was last active (the latest user/character message time). Autonomous rooms and the current chat are excluded; the button is hidden inside autonomous rooms.
- A confirm dialog lists the incoming characters with a per-character "Who joins" checkbox (all on by default) so you can gate exactly who comes across — not just rely on de-duplication — plus the same starting-outfit options as the new-chat/continuation flow (defaulting to "Same as last conversation"). Characters already present in the current chat are excluded automatically.
- On merge, each incoming character joins as an LLM-driven participant (the source's user-controlled character is brought in as LLM-driven; the current chat keeps its own user character). The Host posts a recap at the latest point linking back to the source chat and carrying its summary, plus a back-link bubble in the source chat. Existing turns are not replayed.
- New API action: `POST /api/v1/chats/[id]?action=merge-conversation` with `{ sourceChatId, characterIds?, outfitSelections }` (`characterIds` is the optional allowlist of who to bring across).

#### Multiple open documents in Document Mode

In the tabbed workspace, a chat can now keep several documents open at once, each in its own tab.

- The composer's "Open Document" button no longer disappears once a document is open — use it to open additional documents. Each open document gets its own workspace tab (a child of the Salon tab), tracks its own unsaved changes, and autosaves independently.
- Reopening a chat restores every document that was open (skipping any whose file was deleted). The set of open documents is tracked server-side in `chat_documents` (multiple `isActive` rows per chat are now allowed; previously only one).
- The split/focus "maximize" toggle is hidden inside the workspace (a document is already its own maximizable tab); it remains on the legacy `/salon/[id]` route.
- LLM document tools target a specific open document: `doc_focus` and `doc_close_document` take an optional `path` (with `scope`/`mount_point`) to name which document to act on, defaulting to the most recently opened. `doc_focus` results carry the target document's identity so the correct pane scrolls.
- The legacy single-pane `/salon/[id]` route still shows one document (the focused one).

#### Groundwork: Tabbed workspace (Phase 0 scaffold)

Started the tabbed workspace feature (a two-pane shell of kept-alive tabs; see `docs/developer/features/tabbed-workspace.md`). These early phases add no user-visible behavior.

- **Phase 0 (state scaffold).** Introduced the client state model and store: a pure reducer (`lib/workspace/`) for the open-tab set, pane assignment, active tab per pane, focused pane, and split ratio; localStorage persistence with shape validation and dead-tab pruning on hydrate; a `WorkspaceProvider`/`useWorkspace` store; and a development-only `/workspace` route that renders a single home tab. Gated behind a `WORKSPACE_TABS_ENABLED` flag (off by default) so nothing else in the app changes yet. Covered by 38 reducer/persistence unit tests.
- **Phase 1 (view extraction).** Extracted each primary surface's page body into a reusable, props-driven view component (`HomeView`, `SalonView`, `AuroraView`, `ProsperoView`, `ScriptoriumView`, `SettingsView`, `FilesView`, `PhotosView`, `ScenariosView`, `SalonListView`) so the workspace can render them as kept-alive tabs. The existing routes now render these views through thin wrappers, so navigation and behavior are unchanged. The Salon's SSE streaming hooks and virtualized message list were not touched — only the component's entry signature (`chatId` prop instead of route params).
- **Phase 2 (per-tab toolbar).** The previously global page toolbar can now be scoped per tab: a workspace-level registry tracks each tab's injected toolbar content, a `TabToolbarProvider` supplies the same context per mounted tab (so `usePageToolbar()` call sites are unchanged), and each pane renders its active tab's toolbar. The legacy global toolbar is untouched for the old routes.
- **Phase 3 (two-pane host).** The `/workspace` route now renders the real two-pane tab host: every open tab is rendered at once as a flat, always-mounted list positioned by CSS grid column and hidden (never unmounted) when inactive — so a streaming Salon survives tab switches and the split untouched. Tabs can be selected, closed (closing the last resets to a single home tab), reordered, dragged between panes, and dropped onto a center zone to split; a draggable, keyboard-nudgeable divider resizes the panes. Added the `qt-workspace`/`qt-tab-strip`/`qt-workspace-divider` style family, a `/api/v1/system/home` endpoint (backed by a shared `home-data` service so the home tab and the `/` route compute identical data), and a keep-alive integration test that asserts no view remounts across tab switches or a split.
- **Phase 4 (Terminal & Document tabs).** In the workspace, a conversation's Terminal Mode (Ariel) and Document Mode (the Librarian) open as their own tabs linked to the parent Salon tab, instead of splitting inside the chat. The live PTY and editor stay mounted inside the kept-alive Salon view and are portaled into their tabs, so they survive tab switches and can sit in the other pane beside the chat. Opening a mode spawns its tab; turning it off closes the tab; closing the tab turns the mode off; closing the Salon tab closes both children. The old in-chat `SplitLayout` is unchanged and still used by the legacy `/salon/[id]` route.
- **Phase 5 (Brahma + Wardrobe tabs).** The Brahma Console and the Wardrobe can now open as workspace tabs, reusing their existing dialog bodies (an `asTab` rendering mode), so the logic isn't duplicated. The Wardrobe tab is the left-rail, browse/edit path (no "wearing now"); the chat-scoped Wardrobe keeps its dialog so it can still change what a character is actively wearing. Help stays a modal. (The narrow-pane Chat Sidebar auto-collapse is deferred to the polish phase.)
- **Phase 6 (old-route redirects + app-level store, flag-gated).** When the workspace is enabled, it is the post-login landing surface and the workspace store lives in the root layout (which never unmounts across navigation). In-app navigation — the left rail and home-page recent-chat links — opens or focuses a tab in place rather than navigating, so the workspace and its live tabs are never torn down. Deep links and bookmarks to the legacy routes (`/`, `/aurora`, `/prospero`, `/scriptorium`, `/settings` with its `?tab=`/`&section=`, `/files`, `/photos`, `/scenarios`, `/salon/[id]`) still work: they redirect into `/workspace` with a transient `?open=` intent that the workspace applies after hydrating its saved layout (so the restored layout never clobbers the requested tab) and then strips. While the `WORKSPACE_TABS_ENABLED` flag is off (the default), everything renders exactly as before, so making the workspace the primary shell is a single flag flip once it has been reviewed.
- **Workspace chrome + backgrounds.** Styled the workspace surfaces with the `qt-tab*`/`qt-workspace-*` class families using each theme's `--color-*` tokens, so the strip, divider, drop-zones, and panes read correctly across all themes; the active tab carries an accent border and top bar. Replaced the per-pane story/subsystem background layers (which, being viewport-fixed, overlapped in a split) with a single arbitrated workspace backdrop: a conversation with a background fills the screen; otherwise the active tab's background does; in a split, each pane's background dominates its side and crossfades across the divider. The Salon keeps its own original background treatment on its side. Help docs and the in-flight `WorkspaceProvider`/backdrop registries are covered; a reporter-loop regression test guards the backdrop registry.
- **Phase 7 (theming pass).** Reworked the workspace accent so every accented surface (active tab, pane divider, split drop-zone) derives from one master token, `--qt-workspace-accent` (it falls back to `--color-primary`). Each of the six bundled themes now sets that single token to its own signature color — Madman's Box cyan, Art Deco and Great Estate gold, Earl Grey and Rains blue, Old School slate — and the previously hard-coded Madman's Box teal override was removed from app CSS in favor of the theme bundle. Added a Workspace story (and supporting CSS) to `@quilltap/theme-storybook` and documented the new hook in the `create-quilltap-theme` bundle template, so theme authors can preview and customize the workspace. Bumped the six bundled theme versions plus the two author-tooling packages.
- **Phase 8 (polish).** Added keyboard shortcuts for the workspace, all namespaced under Ctrl/Cmd+Alt and inert while typing: next/previous tab (arrows, wrapping), jump to the nth tab (1–9), close the active tab (W), and toggle split (\\). The tab strip now scrolls the active tab into view when many tabs overflow a narrow pane, and a defensive empty-pane affordance covers any state where a pane has no resolvable view.
- **Chat Sidebar narrow-pane overlay.** In a narrow split pane the Salon's chat sidebar no longer squeezes the conversation: it measures its container and, below a width threshold, defaults to the mini-avatar strip and expands as a click-away overlay (dismissed by an outside click or Escape) instead of an inline panel. Wide/full panes (and the legacy route) behave exactly as before. Completes the deferred Phase 5 item.
- **Keep-alive navigation fixes.** Opening a tab from inside the workspace no longer reloads the whole workspace and interrupts a streaming Salon. Previously only the left rail and home recent-chat links opened tabs in place; every other in-app link to a tab-equivalent surface (the Settings button in the sidebar footer, autonomous-room badges, "continue last," chat cards, in-help links, etc.) hard-navigated to the old route, which redirected back and remounted everything. Added a single document-level link interceptor (`WorkspaceLinkInterceptor`) that catches any anchor whose href maps to a tab and opens it in place; it bails when a link already handled its own click, so the rail/recent-chat paths are unaffected. Added a `useWorkspaceNavigate` hook for programmatic navigations and used it for chat cards (which used `router.push`). The sidebar footer's Brahma Console and Wardrobe buttons now open their workspace tabs instead of dialogs when in the workspace (the in-chat Wardrobe stays a dialog).
- **Detail-in-view drill-down.** Inside the Aurora, Prospero, and Scriptorium tabs, opening a character, project, document store, or character group now renders its detail in place (state-driven) instead of navigating to the detail route, so the workspace and a streaming Salon in the other pane stay mounted. Each detail page body was extracted into a shared, props-driven view (`CharacterDetailView`, `ProjectDetailView`, `DocumentStoreDetailView`, `GroupDetailView`) that the route still renders (with a router-based back) and the list view renders in place (with a state-based back); the detail views are lazy-loaded so the list bundles stay lean. The legacy routes are unchanged.
- **New-chat opens a tab.** Creating a chat from within the workspace (a character's Chat button, the Aurora character chat action, continuation/change-of-venue) now opens the new conversation as a tab in place rather than navigating to it, so another pane's stream survives. The `useNewChat` post-create navigation routes through `useWorkspaceNavigate`.
- **In-workspace new-chat modal.** The generic "Start a chat" / "New chat" entry points (home quick actions, project headers, empty states) no longer navigate to the full-page `/salon/new` form, which would leave the workspace. A new app-level `NewChatProvider` (mounted inside the workspace providers so its create flow opens a tab) renders the new-chat experience as a modal, and the link interceptor opens it for any `/salon/new` link in place. Autonomous-room creation still routes (no modal flow for it yet).
- **Dialogs hover over the whole workspace (stacking fix).** A `fixed` dialog opened from inside a split pane (e.g. the Salon's "Continue Elsewhere" / New Chat modal) was trapped in that pane's stacking context, so the other pane painted over its far half. The content pane no longer establishes a stacking context (it keeps `position: relative` but drops its `z-index`), so such overlays escape to the workspace root and cover the entire viewport, as dialogs should — this fixes every dialog rendered inside a tab, not just new-chat. The New Chat modal is additionally portaled to the document root as belt-and-suspenders.
- **Tabbed workspace is now the default (Phase 6 cutover).** The `WORKSPACE_TABS_ENABLED` flag now defaults on: the workspace is the post-login landing surface, its store lives app-level, and the legacy per-surface routes redirect into it carrying a `?open=` intent. Added redirects for the newer tab-equivalent routes (character edit/new, image generation, Profile, About, the provider wizard) and taught the intent handler to open those kinds (the character editor with its character id and sub-tab), so deep links and bookmarks land on the right tab. Bare detail URLs still render standalone (they have no tab kind and drill down in place). Set `NEXT_PUBLIC_WORKSPACE_TABS=0` to opt back out — everything then renders via the old per-surface routes, exactly as before.
- **Remaining keep-alive navigation holes closed.** Several surfaces still hard-navigated out of the workspace — remounting it and interrupting a streaming Salon. Added workspace tab kinds for the character editor, the create-character form, the standalone image generator, the Profile and About pages, and the provider setup wizard, and mapped their routes (including the legacy `/characters/[id]/edit`) so the existing link interceptor opens them in place. A bare character-detail URL intentionally stays uninterceptable — it renders in place inside the Aurora tab. Made the remaining programmatic navigations keep-alive-aware too: the sidebar Profile/About menu, the in-app Help links (Guide and Ask), and the inline terminal's "pop out" button (now opens a Terminal tab parented to its conversation). Editor/creator tabs de-dupe per character, and finishing one (the character editor's Save/Cancel, the new-character form, the wizard) closes its own tab and returns focus to the kept-alive tab it was opened from — typically the Aurora grid or the character detail, still showing exactly where you left it. Autonomous-room creation now opens the new-chat modal in autonomous mode (≥2 LLM cast, no user character) instead of routing to the full-page form. The legacy routes are unchanged.

