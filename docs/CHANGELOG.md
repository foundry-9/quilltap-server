# Quilltap Changelog

## Recent Changes

### 4.13-dev

#### Feature: Edit any line in the Salon, with warnings about what the edit disturbs

- The pencil now appears on every message row, not only the operator's: character lines, Staff announcements, Carina answers and established facts. `PUT /api/v1/messages/[id]` already accepted any message; the Salon was the gate (`MessageActionBar`).
- Opening the editor calls the new `GET /api/v1/messages/[id]?action=edit-impact`, answered by `assessMessageEditImpact` (`lib/services/chat-message/message-edit-impact.ts`). It reports whether a model has read the line since it landed (chat `llm_logs` rows after `createdAt`, less the line's own `CHAT_MESSAGE` / `TOOL_CONTINUATION` rows, via new `LLMLogsRepository.countForChatSince`; later character lines as the fallback when logging is off) and how many memories the old text formed. The editor (`message-row/MessageEditor.tsx`) shows a warning for the first and, for the second, a "regenerate on save" checkbox that defaults to on.
- `locateMemorySource` maps a line to the path that stamped its memories: a conversation line to its whole extraction turn (turn memories carry the turn's last character line, so a user line's memories sit on another row; autonomous rooms use the speaker anchor span), a Carina answer to `CARINA_MEMORY_EXTRACTION`, a machine established fact to `ESTABLISHED_FACT_MEMORIES`. Other Staff rows have no memory source.
- `PUT` takes `regenerateMemories: true`. After the edit is written, `regenerateEditedMessageMemories` retires the sourced memories through `retireMemories` (new reason `message-edit`; AUTO rows only, except an established fact's MANUAL rows) and enqueues that path's job (a turn job runs with `backfill: true`, so it reads the turn whole past the live cursor). With no profile to extract on, nothing is retired. Response adds `memoriesRetired`, `memoryJobId`, `memoryRegenerateFailed`.
- Editing a row that carries `opaqueContent` clears it, so opaque chats send the edited text instead of the stale persona-free copy.
- The client now drops a saved row's `renderedHtml`, so an edited character line no longer keeps showing its pre-rendered old text until reload.
- `resolveChatExtractionProfileId` (`lib/memory/extraction/context.ts`) replaces the queue-memories action's private resolver; `isAutonomousTurnAnchor` is exported from `turn-transcript.ts`.
- Not covered: tool-result rows (rendered by `ToolMessage`) and the pending Courier placeholder have no pencil. Fold-grain memories sourced inside the edited turn are retired with the turn's and come back only as turn memories.
- New `qt-chat-message-editor*` classes (`_chat.css`) for the editor layout; storybook CSS regenerated, `@quilltap/theme-storybook` 1.0.103.
- Test: `__tests__/unit/lib/services/chat-message/message-edit-impact.test.ts`.

#### Fix: Anthropic plugin no longer caches the turn's whispers instead of its history

- `applyHistoryBreakpoints` (Anthropic plugin `provider.ts`) put the conversation breakpoint on `messages.length - 2`. In a Salon turn that is usually the last of the whispers sent just before the newest user line, not history. Snapshot whispers are swept and replaced on later turns, so the entry was often never read. Friday, `claude-sonnet-4-6`: reads stalled at 60,266 tokens for two turns while the history grew. With a multi-character `[Name]` prefill as the final message, `length - 2` was the newest user line itself.
- Breakpoints now go, in order and within the four-breakpoint budget: the final message in a tool loop (the latest tool results); the previous reply (the message before the run of user messages ending in the newest line); the message just before the newest line when that is a whisper; the stepped mid-history mark. The newest line is the last user message that is not only tool results, wherever it sits. A lone message keeps its breakpoint. Placement is logged at debug. Anthropic plugin 1.0.67.
- Live, V4test, `claude-sonnet-4-6` with a whisper before the newest line: after a cold first turn, the next turn read 19,301 tokens and wrote 78, leaving only the newest line (about 2k tokens) uncached.
- Test: `__tests__/unit/plugins/anthropic-cache-breakpoints.test.ts`.

#### Fix: OpenRouter prompt caching; NanoGPT cache boundaries

- OpenRouter text-only non-streaming sends (most cheap-LLM tasks) went through the SDK's `chat.send()` and read cache hits from a top-level `usage.cachedTokens` the SDK never sets (it is `promptTokensDetails.cachedTokens`), so hits were never reported or excluded from token budgets. Every send now uses the one Chat Completions fetch body (`buildChatCompletionsBody`); the SDK is left for `models.list` and the key check. One usage reader, `readOpenRouterUsage`, serves send and stream and now also reads `prompt_tokens_details.cache_write_tokens` as `cacheCreationInputTokens`. Streams keep OpenRouter's usage object as `rawProviderUsage`.
- The per-character cache key now also goes out as `session_id` (OpenRouter's sticky provider routing starts on the first successful request, not after the first hit) and `prompt_cache_key`, besides `user`. OpenRouter skips stickiness when the profile sets `provider.order`.
- Claude on OpenRouter never cached: nothing sent `cache_control`. In V4test, `anthropic/claude-haiku-4.5` calls of about 18k prompt tokens 0.7 s apart showed no cache usage. New opt-in profile options **Enable Prompt Caching** / **Cache Duration** (`enablePromptCaching`, `cacheTTL`) place explicit breakpoints for `anthropic/*` and `~anthropic/*` models (`cache-breakpoints.ts`), at most four: the first system message; the message before the newest user line (the last `user` message, which a multi-character `[Name]` prefill may follow) and the previous reply before the final run of user messages; the final tool result in a tool loop; the host's summary-head mark; a stepped mid-history mark on long arrays. Every string content is lifted to a text part whenever caching is on, marked or not: OpenRouter merges consecutive same-role messages, and lifting only the marked one changed how its run rendered, which lost every history hit in the first live run. OpenRouter's automatic top-level `cache_control` is not used because it marks the last block, which in the Salon is the turn-variable newest user line. OpenRouter plugin 1.0.72.
- Live, V4test, Haiku 4.5 through OpenRouter (BYOK): before the lift and prefill fixes, every turn read only the 16,286-token tools+system prefix; after, turns read 18,516/18,924, 18,624/19,162 and 18,100/19,146 prompt tokens, and the second step of a tool loop 18,778/19,283.
- NanoGPT's explicit caching helper now sends `cutAfterMessageIndex` = the message before the newest user line (none for a lone message or a tool loop), so its automatic Claude breakpoints cannot land on the turn-variable newest line. The profile help now says explicit caching is billed pay-as-you-go outside a subscription. NanoGPT plugin 1.2.14.
- Audit, Friday: NanoGPT implicit caching is working (e.g. `abliterated-model-large-flash` chat turns 169/197 with cache usage, `deepseek-v4.1-flash` memory extraction 1127/2134).
- Tests: `__tests__/unit/openrouter-text-provider.test.ts`, `__tests__/unit/plugins/nanogpt-reasoning.test.ts`.

#### Fix: Z.AI plugin sends the prompt-cache key as `user_id`

- Z.AI's chat API names its end-user field `user_id` (6–128 characters). The plugin sent OpenAI's `user`, which Z.AI does not list, so the per-character cache key from `buildCharacterCacheKey` never reached it. `zaiUserId` (plugin `provider.ts`) now puts the key in `user_id` on both send and stream, and omits a key outside the documented length rather than risk a 400. Z.AI plugin 1.1.35.
- DeepSeek streams now keep the provider's own usage object (`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`) on the final chunk as `rawProviderUsage`, so the LLM log records DeepSeek's hit/miss split. DeepSeek plugin 1.0.31.
- Audit, Friday instance, same multi-character chat with identical system blocks and tools across turns: DeepSeek `deepseek-v4-flash` hit about 85% of prompt tokens per call; Z.AI `glm-5.3-flash` hit 0 on 13 straight turns with byte-identical message prefixes, and hits on other chats land on fixed sizes (often 32768). The prefix Quilltap sends is stable, so the Z.AI shortfall is on the provider side or in routing. Whether `user_id` improves it still has to be measured.
- Test: `__tests__/unit/plugins/prompt-cache-wire-fields.test.ts`.

#### Security: Docker production image moves from Debian bookworm to Wolfi

- The production stage of `Dockerfile` and `Dockerfile.ci` now starts from `cgr.dev/chainguard/wolfi-base:latest` and installs `nodejs-24`, `libstdc++`, `bash`, `zip` and `unzip` with `apk`. Every finding left in the `node:24-bookworm-slim` image (1 critical, about 10 high: util-linux, zlib, ncurses, systemd libraries, gzip, acl) was a Debian package marked affected, fix-deferred or will-not-fix, so `apt-get upgrade` could not clear them; `node:24-trixie-slim` scanned worse (13 high). Trivy on a local arm64 build: 97 findings (1 critical, 9 high) on the published 4.13.0-dev.29 image, 1 on the Wolfi build (a low in the app's own `katex` dependency, not the OS).
- Only the production stage changed. The build stages stay on `node:24-bookworm-slim`, because Wolfi only packages npm 12 and the lockfile is installed with npm 11 as in CI. node_modules built there (glibc 2.36) load on Wolfi's glibc 2.44; the SQLite driver, sharp and node-pty are all Node-API.
- The base tag is deliberately unpinned. Wolfi rebuilds it daily, and a moving tag is what invalidates the GitHub Actions layer cache so `apk upgrade` actually pulls new fixes.
- The npm/corepack/yarn removal and the forced `perl` purge are gone: npm is a separate Wolfi package that is never installed, and nothing pulls perl in.
- The `nextjs` user and `nodejs` group keep UID/GID 1001 (now created with busybox `addgroup`/`adduser`), so existing volumes stay writable.
- Images that layer extra tools on top must use `apk add` instead of `apt-get`. `docs/DEPLOYMENT.md` and `help/ariel.md` say so.

#### Change: Salon agent-mode turn cap raised to 50

- `AgentModeSettingsSchema.maxTurns` now allows 1–50 (was 1–25); the default stays 10. The Chat settings dropdown adds 30, 40 and 50.

#### Change: Brahma Console turn budget has no upper bound; default 10

- `maxAgentTurns` in `instance_settings['brahmaConsole']` is now any integer ≥ 1 (was 5–200) and defaults to 10 (was 50). The operator's value is the only ceiling on the Console's and one-shot `@Brahma`'s tool-use turns; the duplicate/stale-query guard still stops a looping run.
- The default is one constant, `DEFAULT_BRAHMA_MAX_AGENT_TURNS` in `lib/schemas/settings.types.ts`, used by the schema, `lib/instance-settings`, `turn-budget.ts` and the settings dial. `resolveBrahmaMaxAgentTurns` now logs the resolved budget (debug) and an unreadable setting (warn).
- `BoundedNumberInstanceSetting` takes an optional `max`; with none, the input has no `max` attribute and the hint reads "at least N".
- A stored value is kept as is, including a 50 written by an earlier save of the inline `@Brahma` engine (the PUT merges the whole object). Salon agent mode has its own cap (see above).

#### Feature: Brahma Console SQL cards collapse; thinking interleaves with queries

- Each `run_sql` card in the Brahma Console now starts collapsed to one line: database, a one-line query preview, and the row count or failure. Expanding it shows the Query and Result panes as before New `qt-tool-card-summary` / `qt-tool-card-chevron` / `qt-tool-card-preview` classes style the summary line.
- Thinking is shown where it happened instead of as one block above the answer. The orchestrator stores the reasoning that preceded each tool-call turn on that turn's (content-less) assistant message, and the final answer carries only the reasoning since the last tool call. The transcript renders reasoning-only assistant messages as collapsed Thinking blocks between the SQL cards. Older chats keep the whole chain on the final message and render as before.
- While streaming, the hook records where each tool batch fell in the cumulative reasoning (`streamingToolBatchMarks`); `segmentLiveRun` (`components/brahma-console/brahma-sql-tool-call.ts`) splits the chain around the batches. Only the trailing stretch stays open.
- `ThinkingBlock` gains `align: 'end' | 'start'` (default `end`, unchanged for the Salon). The console uses `start`, backed by the new `qt-chat-thinking-start` class, so thinking sits flush left with the SQL cards instead of jumping right when expanded. `@quilltap/theme-storybook` 1.0.102 with regenerated CSS.

#### Chore: dev-tag cleanup deletes Docker Hub images by digest

- `remove-old-dev-tags` removed old dev images with `regctl tag rm`, which on Docker Hub only drops the tag; the manifests and layers stayed untagged and kept using storage (`foundry9/quilltap` passed 200 GB). Step 7 now deletes each old version's index and its child manifests (both images and both attestations) by digest, skips digests reachable from the kept dev version and `latest`, and stops if the registry token lacks delete scope instead of falling back to tag-only removal. Images already left untagged must still be cleared from Docker Hub's web UI.

#### Fix: character page follow-ups; physical description name and usage context retired

- Header menus (avatar, Generate, ⋯) opened offset down and right. The sticky header's `backdrop-blur` makes it the containing block for `position: fixed`, so the viewport coordinates from `fixedMenuPlacement` were applied relative to the header. `hooks/useFixedMenu.ts` now finds an ancestor that captures fixed positioning (`fixedContainingBlock`: transform, filter, backdrop-filter, perspective, contain, will-change) and places the menu against its box. Applies to every `ItemActionMenu`.
- Header stats add the character's own Inventory shelf: objects, carried by default, archetypes and kits, each opening the Inventory dialog. `?action=stats` returns `stats.inventory`. The header's stats now re-read on `inventory` and `wardrobe` realtime events.
- The header avatar fills the header's height (square, 96–240 px) instead of a fixed 80 px. `ItemActionMenu` gains `containerClassName`.
- Removed the duplicate "Tags" label on Details (the tag editor has its own).
- New Metadata card on Details: lists the `metadata.json` keys and edits them as JSON in a modal. Only JSON objects are accepted; the reserved `progressions` key is excluded from the editor and re-read fresh and carried over on save, since the PUT replaces the whole object.
- The photo album in Appearance is collapsible and starts collapsed, like avatar rolls and wardrobe pictures.
- History's Conversations and Memories cards start collapsed (`SectionCard` gains `collapsible` / `summary`) and page with Previous/Next (`components/ui/ListPager.tsx`) instead of infinite scroll. Deleting a row re-reads the page.
- Stat links open the collapsed card they point at (`hooks/useAnchorReveal.ts`), and now scroll even when the target is in the section already showing.
- A character has one physical description, so its `name` and `usageContext` are removed from `PhysicalDescriptionSchema`, the character POST/PUT schemas, the page, the AI Wizard, AI import and NPC creation. Neither was stored in the vault (reads always produced `name: 'default'`, `usageContext: null`), so nothing is migrated; old payloads and exports carrying them are stripped by the non-strict schemas.
- The identity stack's appearance line is now `This is how you look: …` (no quoted label, no `(best used: …)`). `IDENTITY_STACK_BUILDER_VERSION` is 3; goldens registered.
- Appearance resolution takes one description per character and decides clothing only: `CharacterAppearanceInput.physicalDescription` replaces the `physicalDescriptions` array, `selectedDescriptionId` and `physicalDescriptionName` are removed, and the cheap-LLM prompt no longer asks for a description choice. Prompt expansion drops `usageContext` / `entityName` from description tiers. The optimizer and Rename/Replace no longer read or rewrite the name.

#### Feature: Salon avatars fixed to their moment

- Each Salon bubble now shows its author's avatar as it was when the message was written. A new avatar (from a wardrobe or inventory change, the configuration cache, or set by hand) takes effect when it is bound to the chat; earlier bubbles keep the old one. Previously every bubble showed the character's current avatar.
- New table `chat_avatar_timeline` (migration `add-chat-avatar-timeline-table-v1`, no backfill). Written only by `ChatAvatarTimelineRepository.record`, from `bindAvatarToChat` and the `set-avatar` / `remove-avatar` actions; buffered from the job child and replayed in the parent. The first record for a (chat, character) writes a baseline row with the chat's prior per-chat avatar, so chats that predate the table keep their current look on earlier bubbles.
- `GET /api/v1/chats/[id]?action=avatar-timeline` returns the timeline with images resolved (`loadAvatarTimeline`, `lib/chat/salon-avatar-loader.ts`). `avatarAt` (`lib/chat/salon-avatar.ts`) picks the avatar in force; a row whose image is gone falls back to the latest surviving image for that character in the chat, then the current avatar. A "character's own avatar" row shows the character's default image, not the chat's per-chat avatar.
- `getMessageAvatar` in the Salon uses it for participant, announcer, Carina answerer and fallback branches. New query key `queryKeys.chats.avatarTimeline`, refreshed by the `chats` realtime topic.
- The table is included in backups, restore remapping, `.qtap` export/import (`avatar_timeline` records, `qtap-export.schema.json`) and character cascade delete.
- Tests: `avatarAt` selection and fallback, `record` baseline and no-op rules against real SQLite, and the import remap.

#### Docs: correct two out-of-date help pages

- `help/character-system-transparency.md` said System Transparency is mirrored into the vault's `properties.json`. It is a database column only (see DDL.md); the page now says so and why.
- `help/character-management.md` described a "Partnerships" feature (partner sections, Create Partnership buttons, dissolving partnerships) that does not exist. Replaced it with "Conversation Partners", covering what does exist: the default conversation partner in Chat Defaults, which pre-fills Play As in the New Chat dialog, and multi-character chats. `help/characters.md` updated to match.

#### Feature: one character page in Aurora; Fixes #146

- `/aurora/[id]/view` and `/aurora/[id]/edit` are replaced by one page at `/aurora/[id]` (`app/aurora/[id]/CharacterPage.tsx`) with six sections: Details, Prompts, Appearance, Abilities, Chat Defaults, History. Every control saves itself; only modals have Save buttons. Design of record: `docs/developer/features/complete/aurora-character-page-unification.md`.
- Save model: `lib/autosave/autosave-engine.ts` holds per-field drafts. Prose saves after 1.5 s idle and on blur, short text on blur or Enter, selects/toggles/stars on change. Drafts are coalesced into one partial PUT, one request in flight at a time, and flushed when the workspace tab or document is hidden, on `pagehide` (with `keepalive`) and on unmount. A failed save keeps the text, outlines the field and offers Retry in the header's status chip. An empty name is not sent. `useCharacterAutosave` wires the engine to the PUT and the TanStack cache.
- The page reads the character through TanStack Query (`queryKeys.characters.detail`, shared with progressions and the pronoun filter) and the header stats through the new `queryKeys.characters.stats` key, which the `characters` realtime topic now invalidates. `useCharacterView` / `useCharacterEdit` and the two route trees are deleted.
- Header: avatar menu (choose from photos, upload, generate portrait via the Wardrobe dialog), badges for kind / NPC / user-controlled / Carina / archived, every stat a link, Start Chat, a Generate menu (AI Wizard, Optimizer, Non-Quilltap prompt) and a ⋯ menu (Export, Convert to NPC, Archive, Delete — Delete is new on this page). Carina and user-control moved to Abilities.
- Details: Facts (with Kind and Tags), the Dossier with template tools, Progressions, and a new read-only Vault card. Empty prose fields render with their hint as placeholder. `{{char}}` / `{{user}}` and the names that could become them are tinted inside the editors via the CSS Custom Highlight API (`TemplateTokenHighlightPlugin`; no document changes). `MarkdownLexicalEditor` gains `placeholder` and `templateHighlight`.
- Prompts: the system-prompt star is the only default control; Subprompts and Progressions were lifted out of `SystemPromptsEditor`. Scenarios are a list with a modal, written per row through the scenarios route (the character PUT's scenario schema drops `archived`), with a star for the default scenario. The Default System Prompt and Default Scenario pickers are gone.
- Appearance: Photos, the physical description without its Save button (text autosaves; Humanoid saves on change), depiction guidelines (`AestheticEditorField` gains an `autosave` mode), Wardrobe and a new Inventory entry point.
- Abilities: transparency, Core whisper, Carina, diagrams, the wardrobe and inventory permissions, user-controlled and NPC. Tri-states show what Inherit resolves to.
- History: conversations, memories, Search & Replace and Rename / Replace side by side, LLM logs collapsed.
- `?action=stats` also returns `missingCharacterFiles`, `subprompts`, `mail`, `scenarioFiles` and `vault: { mountPointId, name }`. Deleting a character's default scenario clears `defaultScenarioId`.
- Routing: one workspace tab kind `character` (payload `{ characterId, section? }`) replaces `character-view` / `character-edit`. Saved workspace layouts are upgraded on load (`upgradeLegacyTab`; duplicate view+edit tabs collapse to one). `/aurora/[id]/view`, `/aurora/[id]/edit` and `/characters/[id]{,/view,/edit}` redirect to `/aurora/[id]` with the old `?tab=` mapped to `?section=` (`lib/characters/page-sections.ts`, `lib/navigation/legacy-character-redirect.ts`). `?action=chat` opens the New Chat modal beside the tab instead of living in its payload. The character page is no longer exempt from tab-activation refetch. Every internal link to the old URLs is updated. `EntityTabs` gains a controlled mode and scrolls sideways at narrow widths.
- Help chat: the entity picker accepts `/aurora/:id?section=…` templates, and pattern matching prefers the doc whose query matches the current URL.
- New Character form reuses the page's Facts and Dossier blocks (`components/characters/fields/`) and now saves aliases, pronouns, birthday and kind.
- Fix (#146): the edit form's System Prompt field, the create form's System Prompt and Scenario fields, and the AI Wizard's generated System Prompt were stripped by the character schemas and silently lost. The edit-page field is gone; the create form sends them as a named prompt ("Default") and a scenario ("Opening scene"); the wizard's prompt is saved through `POST /api/v1/characters/[id]/prompts`. The create form's dead Avatar URL field is removed.
- The sticky header used `qt-bg-card/95`, which is not a defined utility, so `npm run lint` failed and the header had no background. It now uses `qt-bg-card/90`.
- Tests: the autosave engine, the section map and redirects, legacy layout upgrade, section rendering on a blank character, the draft-to-PUT builder, and a grep-test that no file under `app/aurora/[id]/` submits a form or shows a Save button outside a modal.

#### Feature: character birthdays, public progressions, and a composed public identity

- Characters have an optional `birthday` (`YYYY-MM-DD`), stored in the vault's `properties.json`. The age is derived from it on the instance calendar and never stored (`lib/characters/birthday.ts`; a leap-day birthday turns over on 1 March in common years). Absent or invalid values read as no birthday, so existing vaults need no migration. PUT `/api/v1/characters/[id]` accepts it (null clears); the export schema documents it.
- Aurora edit page: a native date picker under Pronouns, with a Clear button and the age as of today. The character page header shows the age beside the pronouns.
- Progressions have a `public` flag, default `true`. It is in the progression JSON Schema, Pascal's writable fields (`progress.<id>.public`) and the flattened sheet (`<id>.public`). The editor has a Public checkbox and previews both the line the character reads and the line others see; the Progressions card marks private entries.
- New `lib/characters/public-identity.ts` composes the public identity: age, public progressions, pronouns, then the identity text. Public progressions use fixed third-person wording (`renderPublicProgressionLine`); the description and report template are never used, and a completed `onComplete: 'once'` progression is omitted. Used by the Host's join announcement, the off-scene card (referent ledger, left-behind notice, name-chip popup), Carina's asker card (`buildPublicIdentityCard`), the self_inventory roster and Brahma's `lookup_character` (which also returns `birthday`). The identity stack and other cached prompt blocks are unchanged.
- Fix: the progression editor overlay is portalled to `document.body`, so the LLM Logs panel no longer paints over it. Its preview caption now names the character instead of the progression.

#### Fix: OpenRouter plugin off `callModel()`; streaming tool and image turns send ZDR (#145)

- OpenRouter plugin 1.0.71 streams every turn (plain, tool, image) through the direct Chat Completions fetch. The `callModel()` / `@openrouter/sdk/lib/chat-compat` path, removed upstream in `@openrouter/sdk` 1.5.57, is gone, and the SDK range returns to `^1.5.60`. The SDK is still used for text-only non-streaming sends (`chat.send`), `models.list` and embeddings.
- Both fetch paths now build their request through one `buildChatCompletionsBody`. Before this, streaming tool and image turns did not send ZDR (`provider.data_collection: 'deny'`), any other provider preference, the `user` cache key, `response_format` or the model fallback list (only an undocumented `route: 'fallback'`), and sent web search as a Responses-API `web_search_preview` tool. All of these are now sent; web search is the `web` plugin and `route` is no longer sent.
- A plain streaming turn now has the first-byte request budget the other streaming paths use (it was unbounded by default), and reasoning streams on plain turns instead of arriving after the text. Reasoning reads `delta.reasoning`, falling back to the text of `delta.reasoning_details` entries (encrypted entries skipped). A streamed `delta.refusal` reports `finish_reason: 'refusal'`.
- `npm run build:plugins` now runs `tsc --explainFiles` after each plugin's typecheck and fails when a package the plugin declares in `dependencies` resolved from outside the plugin's own `node_modules` (`scripts/lib/plugin-resolution-guard.ts`). This is what let the removed subpath typecheck locally against the root copy of the SDK.
- The plugin's debug log now records the routing fields of each Chat Completions body (model / fallback list, tool count, provider preferences including ZDR, plugins, response format, reasoning) and, at stream end, which reasoning fields arrived, usage and OpenRouter's reported `cost`. Messages and keys are never logged. Live on V4test, OpenRouter sends both `delta.reasoning` and `delta.reasoning_details`; the plugin reads `reasoning` and does not double-count.
- Tests: streaming, body parity, ZDR, reasoning, refusal and tool-call cases in `openrouter-text-provider.test.ts`; `plugins/openrouter-no-callmodel.test.ts` fails on any mention of the removed API; `scripts/plugin-resolution-guard.test.ts`. The `@openrouter/sdk/lib/chat-compat` mock and its Jest mapping are removed.

#### Docs: spec for moving the OpenRouter plugin off `callModel()` (#145)

- New spec `docs/developer/features/openrouter-plugin-chat-completions-streaming.md`: route the plugin's plain streaming turn through the existing direct Chat Completions fetch, delete `callModel()` / `chat-compat`, and return `@openrouter/sdk` to a caret range. `@openrouter/agent` is rejected (second SDK major plus an MCP client peer dependency).
- Research recorded in the spec: the streaming fetch path, already used for every tool and image turn, does not send ZDR (`provider.data_collection`), provider preferences, the `user` cache key, `response_format` or the model fallback list, and sends web search as a Responses-API tool type. The spec puts both fetch paths on one request-body builder with a parity test, adds a `delta.reasoning_details` fallback, and proposes a build-time guard against a plugin import resolving from the root `node_modules` (what hid the break locally). No code changed.

#### Fix: CI and Release builds failed on the OpenRouter plugin

- `@openrouter/sdk` 1.5.57 (a patch release) removed `callModel()` and `@openrouter/sdk/lib/chat-compat`, which moved to the separate `@openrouter/agent` package. Plugins have no committed lockfile, so CI resolved the plugin's `^1.5.34` range to 1.5.60 and the plugin typecheck failed in `provider.ts`. Locally the typecheck passed because TypeScript fell back to the root `node_modules` copy (1.5.34) for the missing subpath.
- OpenRouter plugin 1.0.70 pins `@openrouter/sdk` to exactly 1.5.56, the last release with those APIs and the version the last green Release built against. Moving the streaming path off `callModel()` is follow-up work.

#### Feature: Green Room wardrobe model; single pieces from outfit sets

- New setting `chatSettings.cheapLLMSettings.outfitSelectionProfileId` (Settings → Providers → Cheap LLM Settings → Green Room Wardrobe Model). Any connection profile; it makes the `llm_choose` opening-outfit pick instead of the cheap LLM. Unset or a deleted profile falls back to the cheap LLM. Resolved by `selectGreenRoomLLM` (`lib/wardrobe/green-room-model.ts`), carried by `buildCheapLLMConfig`. Stored in the existing `cheapLLMSettings` JSON column, so no migration; restore remaps the id.
- The outfit prompt's composite marker now names the set's pieces by title (`[composite — bundles "Linen Blazer", "Linen Trousers", 1 other item]`; pieces not offered are counted), and the prompt says one piece of a set may be picked by its own ID.

#### Fix: Green Room could dress a character in two whole outfits

- The model could list an outfit set under one slot it happens to cover beside a full outfit. On Friday, Amy got "Summer Travel Look — Peacock & Olive Linen" (top, bottom, footwear) plus "Gothic Victorian Enchantress Attire" (top, bottom, accessories, hair) listed only under `hair`. Dissolving and spreading put every piece of both on.
- New `dropOverlappingEnsembles` (`lib/wardrobe/slot-ops.ts`) runs on the green room pick before dissolving. Two picks conflict when both span more than one slot, at least one is a composite, and they share a top or bottom slot. The one listed in more slots is kept (ties go to the first in slot order) and the other is dropped. Single-slot items and two plain multi-slot garments (slip under a dress) are left alone as layering.
- The outfit prompt now says to pick at most one outfit set for top and bottom and not to list a composite under one slot for a single piece of it.

#### Fix: Green Room opening outfits repeat chat after chat

- `llm_choose` picked each opening outfit with no knowledge of earlier ones, at the cheap-LLM default temperature of 0.3, from the same alphabetical item list. On Friday (52 calls since September) Friday, Laura and Abigail opened most clothed chats in one or two outfits across 7–10 different scenarios.
- The outfit prompt now lists the character's last five opening outfits (`loadRecentOpenings`, `lib/wardrobe/recent-openings.ts`, over the new `ChatWardrobeHistoryRepository.findRecentOpenings`: entry 0 of `chat-start` / `participant-added` timelines, never `seeded`, excluding the chat being dressed) and tells the model not to repeat them. Signature pieces (a ring, a pendant) may stay, and the rule does not change whether the character is clothed. Soft-fails to no history.
- The wardrobe list is shuffled on every call.
- `CheapLLMTaskOptions.temperature` lets a task set its own temperature (default `DEFAULT_CHEAP_LLM_TEMPERATURE`, 0.3, unchanged for all other tasks); outfit selection uses 0.8 (`OUTFIT_SELECTION_TEMPERATURE`). It also applies to the fallback stand-ins.

#### Fix: OpenAI prompt-cache hit rate on GPT-5.6 and later

- From gpt-5.6 on, OpenAI reuses a cached prefix only at a cache boundary, not at any matching token. With no explicit breakpoints a request wrote one entry after the leading developer block and one after the latest user message. In the Salon that message carries the turn's trailing sections, so the second entry was never read and the history between them was never cached. On Friday, gpt-6.1-sol read exactly 26,369 tokens (tools plus the three system blocks) on every turn and wrote 14–20k tokens per turn that were never read.
- OpenAI plugin 1.0.70 sends `prompt_cache_options: { mode: 'explicit' }` on gpt-5.6+ and marks every stable boundary (`cache-breakpoints.ts`): the end of the leading developer block and every later user/developer message and `function_call_output`, capped at the latest 48. The latest user message, which carries the turn's trailing sections, is marked only when a tool call follows it. OpenAI looks a prefix up only at boundaries marked in the current request and writes only the latest four, so marking every boundary is what lets each request find the previous one's entry. Developer messages and tool outputs are always sent as `input_text` lists so they render the same marked or not. `prompt_cache_retention`, deprecated for these models, is no longer sent to them; older models keep it.
- In V4test (gpt-6.1-sol) a plain turn read 24,022 of 25,700 input tokens and wrote 30; the remaining 1,648 were the uncached trailing message. In a tool loop each step read exactly what the previous step had cached (14,419, then 17,716).
- A model that rejects any cache control is retried once without all of them (`isPromptCacheControlRejection`, `stripPromptCacheControls`); this replaces the retention-only retry.
- Removed `previous_response_id` chaining. Requests go out with `store: false`, so the chained call always failed with "Previous response … not found" and fell back to the full request, costing a wasted round trip on every OpenAI turn after the first. `findPreviousResponseId` and the `previousResponseId` plumbing through the orchestrator, primary stream and streaming service are gone; the optional field stays in `@quilltap/plugin-types`.

#### Fix: image-arrival check rejected Gemini answers on long prompts

- `verifyImageReachedModel` (bug 116) judged a vision call imageless when its prompt tokens were at or below `text / 2.5`. That slack grows with the prompt: Import from image's ~2,400-character prompt allowed 951 tokens, more than Gemini bills for a whole image (258). On Friday, NanoGPT `gemini-2.5-flash` saw the photograph three times (844 tokens; all three answers described the same garments) and every answer was discarded as "accepted and discarded".
- `textOnlyTokenCeiling` now takes the lower of `text / 2.5` and `text / 4 + 85` (typical text cost plus the cheapest image tier). Short instructions keep the old bound, so bug 116's case is still caught. Affects the describe-fallback too.

#### Feature: choose the vision profile in Import from image

- The Import from image dialog's first screen now has a **Reading the photograph** dropdown listing every profile that can receive an image (model reads images and the plugin transports them, per `profileCanReceiveAttachment`). It is preset to the profile the analysis would have auto-picked; the review screen shows which profile did the reading.
- `GET /api/v1/wardrobe/analyze-image` returns the eligible profiles and the default pick; `POST` accepts an optional `profileId`. A chosen profile that is unknown or cannot receive images is refused (400) rather than replaced by another.
- `listVisionProfiles` and `resolveChosenVisionProfile` in `lib/llm/vision-request.ts`; `resolveVisionProfile` now uses the former.

#### Fix: Character Optimizer prompt caching and usage logging

- Every optimizer pass sent one user message: character context, source context (memories and/or instructions), then that pass's instruction. The passes share everything but the instruction, but with the instruction at the end no pass could reuse another's cache.
- The shared context and the instruction are now separate user messages, so the shared message is byte-identical across a run. With the Anthropic plugin's breakpoint on the message before the final one, the analysis pass writes it and every sub-step reads it. In V4test each sub-step read back the 2,488-token shared context.
- Optimizer log rows recorded no token usage at all. They now carry usage, cache usage and the provider's raw usage.

#### Feature: per-profile tool-result elision window

- Tool results in the history were elided to a one-line stub after 3 assistant messages for every provider. Each elision changes a message partway up the history, which forces Anthropic to re-write its prompt cache from that point; on Friday one Opus chat wrote about 200k cache tokens twice from this alone.
- New `connection_profiles.toolResultVerbatimTurns` (INTEGER DEFAULT 3, migration `add-profile-tool-result-verbatim-turns-v1`), read only through `resolveToolResultVerbatimTurns`. `0` never elides. Existing profiles keep 3.
- `buildConversationMessages` takes the window; the Salon context build passes the responding character's profile and the Brahma Console its own. The stub names the actual window (`>N turns old`).
- Profile editor field under Tool format, create/update route validation (0–1000), restore and `.qtap` import seeding, export schema, DDL and help.

#### Fix: Anthropic prompt-cache hit rate

- The Brahma Console, `@Brahma`, the Scenario Builder (via `runOneShotToolLoop`) and help chat passed `modelParams: {}` to `streamMessage`, so the profile's `enableCacheBreakpoints`, thinking and max-tokens settings never reached the provider. Every Anthropic call on those paths was sent uncached; on Friday that was about 6.5M input tokens over a week. They now pass `profileParams(connectionProfile)`, like the Salon.
- The Anthropic plugin (1.0.66) put the conversation breakpoint on the last user message. In the Salon that message carries the turn's trailing sections, which are gone from the next turn's copy, so each turn wrote a cache entry that was never read and only the system prompt was reused. The breakpoint now goes on the message before the final one. In V4test, consecutive turns now read back the whole previous prefix (17,393 then 18,076 tokens) and write only the new messages.
- In a tool loop the same rule caches each step for the next; previously only the opening user message was cached, because tool results don't count as user messages.
- The plugin now keeps within Anthropic's four-breakpoint limit: tools, system and a summary-head breakpoint come first, and the mid-history breakpoint is skipped when the budget is spent. The mid-history breakpoint is no longer added under the `system_only` strategy.

#### Fix: OpenAI model fetch lists GPT-6 and later

- Fetch Models for OpenAI kept only IDs starting `gpt-4`, `gpt-5`, `o1`, `o3`, `o4`, so the gpt-6.x models never appeared. The reasoning-model and 24h cache-retention checks had the same hard-coded lists, so a hand-entered gpt-6 model would also have been sent `temperature` / `top_p`.
- The OpenAI plugin (1.0.69) now decides by family and version in `model-families.ts`: chat models are gpt-4 and later plus every o-series (gpt-3.5 drops out); reasoning models are gpt-5 and later plus every o-series; 24h retention is gpt-5.1 / 5.2 / 5.5 and every gpt-6+ model except `-chat-latest` aliases.
- Retention for unreleased models is a guess, so a 400 naming `prompt_cache_retention` is retried once without it instead of failing the turn.

#### Feature: Refine from Memories & Instructions

- The Character Optimizer ("Refine from Memories") is now "Refine from Memories & Instructions". The preflight form has an optional instructions textarea (up to 8,000 characters) and a "Consult the Commonplace Book" checkbox. A run can use memories, instructions, or both; it needs at least one.
- Instructions ride in the shared context of every pass (general fields, each scenario, each system prompt, physical description, wardrobe, aliases, new system prompts), so a requested change is applied wherever it applies. They win over conflicting memories, get significance ≥ 0.6, and never override the field vantage-point, form-of-address, trust-safeguard, or committee-drift rules.
- The analysis lists each change the instructions call for ("Author's instruction"). With no memories it is an instructions-only reading of the configuration.
- A run with instructions and too few reinforced memories continues on the instructions alone instead of stopping.
- `?action=optimize-stream` accepts `useMemories` (default true) and `instructions`. The vault suggestions file records the instructions and an `authorInstructions` frontmatter flag.

#### CI: restore the 8 GB heap for the coverage run

- `test:coverage` again passes `--max-old-space-size=8192` to the Jest parent. 4.12.1 added the flag, but the merge back into main dropped it, and every CI test run since hit the default 4 GB heap and aborted (exit 134).

#### Fix: story characters no longer invent where the user is

- In the live evaluation, characters decided the operator's persona had gone to the boathouse and planned around it for several turns.
- Every story sample prompt (plugin 1.1.33) now forbids filling a gap by deciding where the user is or what they did off-screen; characters may wonder aloud, call out, or go and look. MODERN Roleplay states it under "Whose story it is" and names "the invented absence" as a failure mode. MODERN Assistant is unchanged.
- The stakes direction used by the AI Wizard, Summon From Lore, Character Optimizer and External Prompt generator carries the same rule.
- Rerun with fresh characters: no invented errands; characters still sometimes assumed the user was present in the scene. Details in §12 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

#### Docs: live evaluation of the roleplay defaults

- Rebuilt the 2026-11-03 armed-intruder scene in V4test with synthetic characters and ran it with old-style and new prompts on DeepSeek V4 Flash and GLM 5.3 Flash. Results and method are in §12 (phase 6) of `docs/developer/features/character-kind-and-roleplay-defaults.md`, now marked implemented.
- The doorkeeper with an old-style "never tense / hostility makes you calmer" prompt reproduced the incident (offered the gunman a tour of the house); the same character with a new Wizard prompt blocked him and showed fear. A quiet scene stayed quiet.
- Follow-ups noted: characters invented the operator persona's off-screen whereabouts, and new-prompt replies ran about 65% longer.

#### Feature: group scenes need not agree; informs carry feelings

- The group-scene rules every speaker in a multi-character chat receives now say the cast does not have to agree: if the others took the measured view, a character may respond with fear, anger, or action, and should never take a position only because everyone else has.
- The inform header now reads "Things now true in this story and in you, as of this moment — what has happened, what you know, and how you feel or what you have resolved. Where any of it conflicts with an older memory, your records, or your usual temperament, this is the current truth:". Informs like "You are very alarmed" were previously filed as facts and outweighed by the character's usual calm.
- Amendment note added to `docs/developer/features/complete/salon-inform.md`. Phase 5 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

#### Feature: prompt generators follow the character's kind

- The AI Wizard, Summon From Lore, Character Optimizer and External Prompt generator now add a kind-specific direction when they write a system prompt. Roleplay characters get a stakes direction: react to danger, loss or outrage at full size, and never write temperament as an absolute ("never tense", "always calm"). Assistants get a task direction: accuracy, no invented facts, opinions once, no padding.
- Generators read the character's stored kind. A new or summoned character is roleplay. They never guess the kind from source material, since household staff read as assistants to a model.
- The Character Optimizer now treats "flattening" in a roleplay character's memories (meeting danger with small-talk calm) as drift to correct, and proposes replacing absolute temperament rules in the prompt. Assistants are not checked for it.
- Fix: the AI Wizard's system-prompt field now has a 2,500-token completion budget (was 1,000, shared with example dialogues and first message). Reasoning models spent part of the old budget thinking and returned prompts cut off mid-sentence.
- The External Prompt generator's `META_SYSTEM_PROMPT` constant is now `buildMetaSystemPrompt(kind)`; the Wizard's system-prompt meta-prompt is `buildSystemPromptFieldPrompt(kind)`.
- Phase 4 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

#### Feature: roleplay and assistant sample prompts; every story prompt matches the stakes

- New sample prompts in the default-system-prompts plugin (1.1.32): **MODERN Roleplay**, the recommended default for roleplay characters (a person inside a story with stakes; adds sections on reacting to danger and on group scenes, and the "flattening" and "mediator" failure modes), and **MODERN Assistant**, for characters whose job is doing work for the user.
- **MODERN General** is retired. Seeding now deletes built-in prompt rows the plugin no longer ships, but only after a registry seed that returned at least one prompt; user copies are never touched.
- Every companion, romantic and platonic sample gains a short "match the stakes" passage: ordinary days stay ordinary, real danger gets real fear, anger or action, and a character's usual temperament is not a vow.
- DeepSeek's style governors are now "match the stakes". They still limit purple prose and metaphor but no longer tell the character to keep the story small.
- Phase 3 of `docs/developer/features/character-kind-and-roleplay-defaults.md`.

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

### 4.12.2

#### Security: Docker production image moves from Debian bookworm to Wolfi

- The production stage of `Dockerfile` and `Dockerfile.ci` now starts from `cgr.dev/chainguard/wolfi-base:latest` and installs `nodejs-24`, `libstdc++`, `bash`, `zip` and `unzip` with `apk`. Every finding left in the `node:24-bookworm-slim` image (1 critical, about 10 high: util-linux, zlib, ncurses, systemd libraries, gzip, acl) was a Debian package marked affected, fix-deferred or will-not-fix, so `apt-get upgrade` could not clear them; `node:24-trixie-slim` scanned worse (13 high). Trivy on a local arm64 build: 97 findings (1 critical, 9 high) on the published 4.13.0-dev.29 image, 1 on the Wolfi build (a low in the app's own `katex` dependency, not the OS).
- Only the production stage changed. The build stages stay on `node:24-bookworm-slim`, because Wolfi only packages npm 12 and the lockfile is installed with npm 11 as in CI. node_modules built there (glibc 2.36) load on Wolfi's glibc 2.44; the SQLite driver, sharp and node-pty are all Node-API.
- The base tag is deliberately unpinned. Wolfi rebuilds it daily, and a moving tag is what invalidates the GitHub Actions layer cache so `apk upgrade` actually pulls new fixes.
- The npm/corepack/yarn removal and the forced `perl` purge are gone: npm is a separate Wolfi package that is never installed, and nothing pulls perl in.
- The `nextjs` user and `nodejs` group keep UID/GID 1001 (now created with busybox `addgroup`/`adduser`), so existing volumes stay writable.
- Images that layer extra tools on top must use `apk add` instead of `apt-get`. `docs/DEPLOYMENT.md` and `help/ariel.md` say so.

#### Fix: image-arrival check rejected Gemini answers on long prompts

- `verifyImageReachedModel` (bug 116) judged a vision call imageless when its prompt tokens were at or below `text / 2.5`. That slack grows with the prompt: Import from image's ~2,400-character prompt allowed 951 tokens, more than Gemini bills for a whole image (258). On Friday, NanoGPT `gemini-2.5-flash` saw the photograph three times (844 tokens; all three answers described the same garments) and every answer was discarded as "accepted and discarded".
- `textOnlyTokenCeiling` now takes the lower of `text / 2.5` and `text / 4 + 85` (typical text cost plus the cheapest image tier). Short instructions keep the old bound, so bug 116's case is still caught. Affects the describe-fallback too.

#### Fix: Green Room could dress a character in two whole outfits

- The model could list an outfit set under one slot it happens to cover beside a full outfit. On Friday, Amy got "Summer Travel Look — Peacock & Olive Linen" (top, bottom, footwear) plus "Gothic Victorian Enchantress Attire" (top, bottom, accessories, hair) listed only under `hair`. Dissolving and spreading put every piece of both on.
- New `dropOverlappingEnsembles` (`lib/wardrobe/slot-ops.ts`) runs on the green room pick before dissolving. Two picks conflict when both span more than one slot, at least one is a composite, and they share a top or bottom slot. The one listed in more slots is kept (ties go to the first in slot order) and the other is dropped. Single-slot items and two plain multi-slot garments (slip under a dress) are left alone as layering.
- The outfit prompt now says to pick at most one outfit set for top and bottom and not to list a composite under one slot for a single piece of it.

#### Fix: Green Room opening outfits repeat chat after chat

- `llm_choose` picked each opening outfit with no knowledge of earlier ones, at the cheap-LLM default temperature of 0.3, from the same alphabetical item list. On Friday (52 calls since September) Friday, Laura and Abigail opened most clothed chats in one or two outfits across 7–10 different scenarios.
- The outfit prompt now lists the character's last five opening outfits (`loadRecentOpenings`, `lib/wardrobe/recent-openings.ts`, over the new `ChatWardrobeHistoryRepository.findRecentOpenings`: entry 0 of `chat-start` / `participant-added` timelines, never `seeded`, excluding the chat being dressed) and tells the model not to repeat them. Signature pieces (a ring, a pendant) may stay, and the rule does not change whether the character is clothed. Soft-fails to no history.
- The wardrobe list is shuffled on every call.
- `CheapLLMTaskOptions.temperature` lets a task set its own temperature (default `DEFAULT_CHEAP_LLM_TEMPERATURE`, 0.3, unchanged for all other tasks); outfit selection uses 0.8 (`OUTFIT_SELECTION_TEMPERATURE`). It also applies to the fallback stand-ins.

#### Fix: OpenAI prompt-cache hit rate on GPT-5.6 and later

- From gpt-5.6 on, OpenAI reuses a cached prefix only at a cache boundary, not at any matching token. With no explicit breakpoints a request wrote one entry after the leading developer block and one after the latest user message. In the Salon that message carries the turn's trailing sections, so the second entry was never read and the history between them was never cached. On Friday, gpt-6.1-sol read exactly 26,369 tokens (tools plus the three system blocks) on every turn and wrote 14–20k tokens per turn that were never read.
- OpenAI plugin 1.0.70 sends `prompt_cache_options: { mode: 'explicit' }` on gpt-5.6+ and marks every stable boundary (`cache-breakpoints.ts`): the end of the leading developer block and every later user/developer message and `function_call_output`, capped at the latest 48. The latest user message, which carries the turn's trailing sections, is marked only when a tool call follows it. OpenAI looks a prefix up only at boundaries marked in the current request and writes only the latest four, so marking every boundary is what lets each request find the previous one's entry. Developer messages and tool outputs are always sent as `input_text` lists so they render the same marked or not. `prompt_cache_retention`, deprecated for these models, is no longer sent to them; older models keep it.
- In V4test (gpt-6.1-sol) a plain turn read 24,022 of 25,700 input tokens and wrote 30; the remaining 1,648 were the uncached trailing message. In a tool loop each step read exactly what the previous step had cached (14,419, then 17,716).
- A model that rejects any cache control is retried once without all of them (`isPromptCacheControlRejection`, `stripPromptCacheControls`); this replaces the retention-only retry.
- Removed `previous_response_id` chaining. Requests go out with `store: false`, so the chained call always failed with "Previous response … not found" and fell back to the full request, costing a wasted round trip on every OpenAI turn after the first. `findPreviousResponseId` and the `previousResponseId` plumbing through the orchestrator, primary stream and streaming service are gone; the optional field stays in `@quilltap/plugin-types`.

#### Fix: Character Optimizer prompt caching and usage logging

- Every optimizer pass sent one user message: character context, memory context, then that pass's instruction. The passes share everything but the instruction, but with the instruction at the end no pass could reuse another's cache.
- The shared context and the instruction are now separate user messages, so the shared message is byte-identical across a run. With the Anthropic plugin's breakpoint on the message before the final one, the analysis pass writes it and every sub-step reads it. In V4test each sub-step read back the 2,488-token shared context.
- Optimizer log rows recorded no token usage at all. They now carry usage, cache usage and the provider's raw usage.

#### Fix: Anthropic prompt-cache hit rate

- The Brahma Console, `@Brahma`, the Scenario Builder (via `runOneShotToolLoop`) and help chat passed `modelParams: {}` to `streamMessage`, so the profile's `enableCacheBreakpoints`, thinking and max-tokens settings never reached the provider. Every Anthropic call on those paths was sent uncached; on Friday that was about 6.5M input tokens over a week. They now pass `profileParams(connectionProfile)`, like the Salon.
- The Anthropic plugin (1.0.66) put the conversation breakpoint on the last user message. In the Salon that message carries the turn's trailing sections, which are gone from the next turn's copy, so each turn wrote a cache entry that was never read and only the system prompt was reused. The breakpoint now goes on the message before the final one. In V4test, consecutive turns now read back the whole previous prefix (17,393 then 18,076 tokens) and write only the new messages.
- In a tool loop the same rule caches each step for the next; previously only the opening user message was cached, because tool results don't count as user messages.
- The plugin now keeps within Anthropic's four-breakpoint limit: tools, system and a summary-head breakpoint come first, and the mid-history breakpoint is skipped when the budget is spent. The mid-history breakpoint is no longer added under the `system_only` strategy.

#### Fix: OpenRouter plugin off `callModel()`; streaming tool and image turns send ZDR (#145)

- OpenRouter plugin 1.0.71 streams every turn (plain, tool, image) through the direct Chat Completions fetch. The `callModel()` / `@openrouter/sdk/lib/chat-compat` path, removed upstream in `@openrouter/sdk` 1.5.57, is gone, and the SDK range returns to `^1.5.60`. The SDK is still used for text-only non-streaming sends (`chat.send`), `models.list` and embeddings.
- Both fetch paths now build their request through one `buildChatCompletionsBody`. Before this, streaming tool and image turns did not send ZDR (`provider.data_collection: 'deny'`), any other provider preference, the `user` cache key, `response_format` or the model fallback list (only an undocumented `route: 'fallback'`), and sent web search as a Responses-API `web_search_preview` tool. All of these are now sent; web search is the `web` plugin and `route` is no longer sent.
- A plain streaming turn now has the first-byte request budget the other streaming paths use (it was unbounded by default), and reasoning streams on plain turns instead of arriving after the text. Reasoning reads `delta.reasoning`, falling back to the text of `delta.reasoning_details` entries (encrypted entries skipped). A streamed `delta.refusal` reports `finish_reason: 'refusal'`.
- `npm run build:plugins` now runs `tsc --explainFiles` after each plugin's typecheck and fails when a package the plugin declares in `dependencies` resolved from outside the plugin's own `node_modules` (`scripts/lib/plugin-resolution-guard.ts`). This is what let the removed subpath typecheck locally against the root copy of the SDK.
- The plugin's debug log now records the routing fields of each Chat Completions body (model / fallback list, tool count, provider preferences including ZDR, plugins, response format, reasoning) and, at stream end, which reasoning fields arrived, usage and OpenRouter's reported `cost`. Messages and keys are never logged. Live on V4test, OpenRouter sends both `delta.reasoning` and `delta.reasoning_details`; the plugin reads `reasoning` and does not double-count.
- Tests: streaming, body parity, ZDR, reasoning, refusal and tool-call cases in `openrouter-text-provider.test.ts`; `plugins/openrouter-no-callmodel.test.ts` fails on any mention of the removed API; `scripts/plugin-resolution-guard.test.ts`. The `@openrouter/sdk/lib/chat-compat` mock and its Jest mapping are removed.

#### Fix: CI and Release builds failed on the OpenRouter plugin

- `@openrouter/sdk` 1.5.57 (a patch release) removed `callModel()` and `@openrouter/sdk/lib/chat-compat`, which moved to the separate `@openrouter/agent` package. Plugins have no committed lockfile, so CI resolved the plugin's `^1.5.34` range to 1.5.60 and the plugin typecheck failed in `provider.ts`. Locally the typecheck passed because TypeScript fell back to the root `node_modules` copy (1.5.34) for the missing subpath.
- OpenRouter plugin 1.0.70 pins `@openrouter/sdk` to exactly 1.5.56, the last release with those APIs and the version the last green Release built against. Moving the streaming path off `callModel()` is follow-up work.

#### Fix: OpenAI model fetch lists GPT-6 and later

- Fetch Models for OpenAI kept only IDs starting `gpt-4`, `gpt-5`, `o1`, `o3`, `o4`, so the gpt-6.x models never appeared. The reasoning-model and 24h cache-retention checks had the same hard-coded lists, so a hand-entered gpt-6 model would also have been sent `temperature` / `top_p`.
- The OpenAI plugin (1.0.69) now decides by family and version in `model-families.ts`: chat models are gpt-4 and later plus every o-series (gpt-3.5 drops out); reasoning models are gpt-5 and later plus every o-series; 24h retention is gpt-5.1 / 5.2 / 5.5 and every gpt-6+ model except `-chat-latest` aliases.
- Retention for unreleased models is a guess, so a 400 naming `prompt_cache_retention` is retried once without it instead of failing the turn.

### 4.12.1

#### Fixed: dated searches look at the period first, and an empty search says what it means

- A `search` with `since`/`until` (and a retrospective turn's recall) now reads the period's memories by event time in SQL (`MemoriesRepository.findIdsInEventWindow`) and scores them through the same index restricted to those ids (`memoryIndex.search` `includeIds`), so they join the candidate pool before the cut. Previously the window was applied to a pool already chosen from all time, so a dated question about a recurring place returned nothing. New `HitSource` `'window'`; the `gather` trace stage records `window` / `windowAdded`.
- On the tool path, a window of 14 days or less (`TOOL_WINDOW_FLOOR_MAX_DAYS`) is its own relevance filter: in-window memories and conversation chunks skip the cosine floor. Wider windows and the per-turn prompt path keep the floor.
- Conversation search takes `chatIds`; with a window, the tool restricts the chunk search to the period's chats (`findChatsInWindow`, `lib/scriptorium/chat-window.ts`) instead of filtering the all-time top-K afterwards. A chat's span is `createdAt` to `lastMessageAt`, not `updatedAt`. `searchConversationChunks` now honours an explicit `minScore: 0`.
- When `since`/`until` is given and `sources` is omitted, only memories and conversations are searched (conversations alone on the Brahma Console).
- The tool result carries a `windowCensus` (memories dated in the window, the conversations the character took part in during it, the current chat left out). An empty result now says whether nothing matched the words or nothing happened in the period, and names the period's conversations; non-empty dated results gain a footer listing them.
- Standing tool instructions (native and simple-JSON) now tell the character to read a listed conversation before saying it does not recall.
- The retrospective mini-recap lists in-window chats that have no vault summary yet, from the `chats` table. `VaultConversationMatch.relativePath` is now nullable.
- Undated searches and turns without a resolved time window are unchanged. No schema or export change.
- Spec: `docs/developer/features/complete/search-window-first-and-honest-empty.md`.

#### CI: coverage run heap

- CI: the coverage run (`npm run test:coverage`) now gives the Jest parent process an 8 GB heap. With the v8 coverage provider, every worker ships the coverage, original source and transformed source of each module it loaded back to the parent, which holds all of it until the run ends; at ~1,300 test files that passed the default ~4 GB limit and the Test job died with "JavaScript heap out of memory" after the last suite.
