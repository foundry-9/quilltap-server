# Quilltap Changelog

## Recent Changes

### 4.8-dev

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

