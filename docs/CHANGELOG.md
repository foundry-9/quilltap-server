# Quilltap Changelog

## Recent Changes

### 4.15-dev

#### Feature: Auto-Configure reads observed tool reliability from the LLM logs

- Auto-Configure now has a source stronger than any catalog for native tool support: what the route's own logs show. `lookupModelFacts` (`lib/llm/model-catalog.ts`) takes `routeProfileIds` (the user's profiles with the target's provider, model and base URL, from `sameRouteProfileIds`) and, before any catalog, asks `observeToolReliability` (new `lib/llm/tool-reliability.ts`). A decisive verdict sets `supportsTools` with the new source kind `'observed'`, labelled "observed in your last N native tool calls on this route (F failed)"; an inconclusive one leaves the catalogs to answer. A verdict of unreliable makes `autoConfigureProfile` recommend Simple JSON; `profileUpdateFromAutoConfigure` still moves only from `auto` or `native`.
- The sample is the newest 50 requests that sent native tools (`request.toolCount > 0`, so text-protocol rows never count), read by `LLMLogsRepository.findRecentNativeToolSamples` from the newest 300 rows of those profiles. `classifyNativeToolOutcome` counts a parsed native call (or, on older rows, a `tool_calls` / `tool_use` finish) as ok; a `MALFORMED_FUNCTION_CALL` / `UNEXPECTED_TOOL_CALL` finish, a tool-call finish with nothing parsed, a tool-unsupported error, or a tool call written into the prose as failed; anything else as no evidence. Unreliable needs at least 5 decisive samples, 3 failures and a failure share of 1/3; reliable needs a share of 10% or less.
- The Salon's streaming log row (`streamMessage`, `streaming.service.ts`) now records `response.toolCalls` — what the provider plugin's `parseToolCalls` found — whenever native tools were sent, an empty list included; `logLLMCall` keeps an empty list instead of dropping it. Before this no streamed row recorded its calls, so a Gemini call that finishes `STOP` with a function call looked like plain prose.
- The profile form's Auto-Configure note says when Simple JSON was chosen because native calls were observed failing.
- Tests: `__tests__/unit/lib/llm/tool-reliability.test.ts`, `__tests__/unit/lib/database/repositories/llm-logs-native-tool-samples.test.ts` (real SQLite, compressed columns), additions to `model-catalog.test.ts`, `auto-configure.test.ts` and `streaming-message-logging.test.ts`.

### 4.14.1

#### Dependencies: npm update across root, packages and plugins (second pass)

- Ran `npm update -S` in the root project, every package and every plugin. Notable bumps: `openai` 7.65, `@anthropic-ai/sdk` 1.14 (anthropic plugin), `@openrouter/sdk` 1.5.142, `dompurify` 3.5.0, `@tanstack/react-query` / `react-query-devtools` / `eslint-plugin-query` 5.108.4, `@tanstack/react-virtual` 3.14.28, `tar` 7.5.24, `@types/react` 19.3.3, `@types/node` 24.19.4, `@napi-rs/canvas` 1.2.1 (CLI)
- The plugins now require `@quilltap/plugin-utils` ^2.7.8
- plugin-types 2.13.1 and plugin-utils 2.7.9 published (dependency-only); patch bumps to 14 plugins (`package.json` and `manifest.json`, all but builtin-embeddings), rebuilt

#### Fix: regenerating a reply forms memories from the new swipe (#236)

- With the default swipe cascade (`onSwipeRegenerate` = `DELETE_MEMORIES`), regenerating a character's reply retired the memories formed from the replaced line and never extracted any from the new one, so every swipe made the character forget that exchange. `regenerateMessageAsSwipe` (`lib/services/chat-message/regenerate-swipe.service.ts`) now goes through the edit path's `regenerateEditedMessageMemories` (`message-edit-impact.ts`, new `reason: 'swipe-regenerate'` option): the turn's AUTO memories are retired and a memory extraction job re-reads the turn with the new swipe in place of the old one. `REGENERATE_MEMORIES` does the same; `KEEP_MEMORIES` still neither retires nor extracts. With no extraction profile, the old line's memories are retired as before.
- Extraction now reads a swipe group as its newest variant only. `loadChatMessageEvents` (`turn-transcript.ts`) drops superseded variants through the new `withoutSupersededSwipes` (`lib/chat/swipe-variants.ts`), and `locateMemorySource` locates a turn on that same reading, so a replaced variant is no longer extracted beside its replacement and no longer splits an autonomous room's speaker turn. This also applies to *Re-extract Memories*, the chat-wide memory regenerate and SillyTavern imports with swipes.
- The server keeps no record of which swipe the operator is viewing, so extraction follows the newest variant, which is what the Salon shows by default. Swiping back to an older variant does not restore its memories.
- Regression tests: `__tests__/unit/lib/services/chat-message/regenerate-swipe.service.test.ts` ("memory cascade"), `message-edit-impact.test.ts`, `load-chat-message-events.test.ts`, `__tests__/unit/lib/chat/swipe-variants.test.ts`.

#### Docs: 4.14.1 release notes

- New `docs/releases/4.14.1.md` covering the output-token ceiling, cheap-LLM reasoning headroom, summary file titles, History card previews and the custom-tool roster refresh
- Release notes extended with the swipe memory fix (#236) and the fresh-instance dogfood fixes (sample wardrobes, empty-outfit whisper, seatless group chat rotation, project file upload, Speaks First badge, portrait preview wording, Test All background model, job-child DDL)
- `docs/developer/API.md`: documented `GET /api/v1/characters/[id]?action=chats`, including the new `summaryExcerpt` field

#### Fix: the sample characters keep their wardrobes on a fresh instance

- The first-startup seed imported Lorian's and Riya's wardrobes into their vaults, and then the one-time `refreshVaultWardrobe` startup task (`lib/startup/refresh-vault-wardrobe.ts`), never yet run on the new database, projected the empty legacy `wardrobe_items` table over every vault and deleted them. Both sample characters had no clothes at all. With no legacy rows anywhere, the task now marks itself done and leaves the vaults alone (`hasAnyLegacyWardrobeRows`, `migrations/lib/legacy-wardrobe-rows.ts`); an upgraded database with rows projects them as before.
- An instance already affected gets the wardrobes back from **Reset Built-in Characters** on the Characters (Aurora) page toolbar.
- Regression test: `__tests__/unit/lib/startup/refresh-vault-wardrobe.test.ts`.

#### Fix: a character with no wardrobe is no longer announced as naked

- At a chat's opening, Aurora's outfit whisper rendered an empty outfit as "completely naked and unadorned" even when the character owned no wardrobe at all (the operator's own persona, any hand-made character). The chat model, the scene-state tracker and the Lantern took it as fact, and the first story background on a fresh instance painted the user's persona undressed. `announceOpeningOutfit` (`lib/chat/opening/arrival.ts`) now skips the whisper when nothing is worn and nothing is in reach; a character who owns clothes and wears none is still announced.
- Regression tests: `__tests__/unit/lib/chat/opening/arrival.test.ts` ("the opening-outfit whisper needs a wardrobe to speak of").

#### Fix: uploading a file from a project's Files card works

- `useProjectFileUpload` posted to `/api/v1/projects/[id]/files/upload`, a route that has never existed, so every upload from the project page failed with a 409 "Server Action unavailable". It now posts to `POST /api/v1/files?action=upload` with `projectId` in the form and reads the `data` field the route returns.
- Regression test: `__tests__/unit/components/files/use-project-file-upload.test.tsx`.

#### Fix: a group chat without a user seat waits for the operator after each round

- In a chat started as "Chat as yourself" (no user-controlled seat; the default for any character without a default partner) with two or more characters, the characters kept answering each other after every message until the chain cap (20 turns or 5 minutes). The operator's posts carry no participant, so they never enter the rotation's cycle bookkeeping, and nothing handed the floor back. Bug 249 fixed only the one-character case. Found in the fresh-instance dogfood run (two characters chained six replies to one message before being paused)
- New `seatlessOperatorRoundAnswered` (`lib/chat/turn-manager/operator-round.ts`): when the human has posted, holds no seat, and every present character seat has answered or passed (`turn-pass`) since that post, `shouldChainNext` returns `user_turn`. A queued nudge still runs; chats with a user seat, genuinely all-LLM chats and autonomous rooms are unchanged

#### Fix: new-chat picker no longer promises who speaks first

- The new-chat character picker (`components/new-chat/CharacterPickerPanel.tsx`) marked the first selected character **Speaks First**. The opening greeting has been drawn by talkativeness, not list order, since before 4.13 (the opening turn's participant resolver), so the mark was often wrong: a two-character chat opened with the second character's line. The badge is gone, and `help/chat-multi-character.md` says how the opener is chosen and that characters can be seated from the Start Chat dialog. Found in the fresh-instance dogfood run

#### Fix: out-of-chat portrait preview says where the picture goes

- The Wardrobe dialog's out-of-chat portrait pane (reached from a character's avatar menu, **Generate portrait…**) said "Generates a one-off preview. Download to keep.", and the help said it saved nothing. The preview is in fact stored as a generated file linked to the character (`lib/wardrobe/routes/preview-avatar.ts`), so it shows in the character's photos and can be set as the avatar from **Choose from photos…**. The pane (`components/wardrobe/AvatarGenerationPane.tsx`) now says so, and the "Discard preview" button is "Close preview", since closing it deletes nothing. `help/wardrobe.md` and `help/character-editing.md` updated. Found in the fresh-instance dogfood run

#### Fix: job child no longer tries to create tables on a fresh instance

- On a fresh instance the first chat's `CONVERSATION_RENDER` job reached `conversation_chunks` in the forked job child before the parent had. A repository's first access runs the schema's idempotent `CREATE TABLE` / `CREATE INDEX IF NOT EXISTS` DDL, and `idx_conversation_chunks_createdAt` is made by no migration, so the child's read-only connection failed with `attempt to write a readonly database` (three errors in the log). The throw also skipped registering the collection's JSON, array and boolean columns, so the child's later reads of that collection were misparsed until restart. Found in the fresh-instance dogfood run
- `SQLiteBackend.ensureCollection` (`lib/database/backends/sqlite/backend.ts`) skips the DDL on a read-only connection and still registers the columns. The parent, the only writer, runs the same DDL on its own first access

#### Fix: setup wizard Test All checks a Manual background model

- Test All tested the chat model and the embedding model, but not a background (cheap) model chosen under **Manual**, which can be a different provider and model. A bad pick passed the review page and showed up later as failing background jobs. Found in the fresh-instance dogfood run
- `TestConfirmStep` now sends the same one-line test message to the Manual model, with its own row result, and the note names it ("Chat, the background model and embeddings work"; `testedSummary`). Auto makes no extra call: it uses the chat provider's key the chat test just proved
- The Manual background profile was named with the raw provider id (`Cheap - OPENAI - gpt-5.4-nano`); it now uses the display name like the other wizard profiles

#### Fix: custom-tool availability follows equip changes in an open Salon chat

- The Salon read a chat's custom-tool roster (`queryKeys.customTools.byChat`) once and kept it. Availability gates on `inventory`, `metadata` or `progress` could flip mid-chat (an equip, a Pascal effect, a tool call), but the composer's wand, the `/` commands and the run dialog kept the old roster until the conversation tab was closed and reopened
- The `chats` realtime topic, which equips and new messages already publish, now invalidates `customTools.byChat(chatId)` (`lib/realtime/topic-map.ts`). The Inventory dialog's offline fallback refresh (`useChatInventory`) includes it too

#### Fix: output-token requests are capped at what the provider accepts

- A profile's max tokens was sent as set, even above the provider's limit. Z.AI rejects any `max_tokens` over 131,072 with a 400; a GLM 5.3 Flash profile at 943,718 made memory extraction, consolidation and fold episode passes fail on every call (about 5,700 failures on one instance since Nov 22). Consolidation asks for the profile's whole budget, plus 4,000 tokens of reasoning headroom
- New `lib/llm/output-ceiling.ts`: `withOutputCeiling` wraps every text provider `ProviderRegistry.createLLMProvider` returns, so `sendMessage` and `streamMessage` lower `maxTokens` to the provider's ceiling. The ceiling is the lower of the model's `maxOutputTokens` in the provider's live catalog (`lookupLiveModelEntry`, new in `model-catalog.ts`) and the manifest's new `providerConfig.maxOutputTokens`. It is resolved once per process per provider, base URL, key and model; a failed catalog read is retried after 10 minutes. The profile's stored value is unchanged
- The Z.AI plugin (1.1.41) declares `maxOutputTokens: 131072` in its manifest and clamps its own requests to it, so it stays within the limit under an older host
- The context budget is unchanged; it already counts at most 20% of the context window for output

#### Fix: character History cards preview the context summary

- Conversation cards on a character's **History** tab previewed a raw recent message, which was often a Staff whisper (Commonplace Book recall, a Host line) and said nothing about the chat
- `GET /api/v1/characters/[id]?action=chats` now returns `summaryExcerpt` (`summaryExcerpt(chat.contextSummary)`, the line the home page's resume card shows), and `transformCharacterChatToCardData` previews it, falling back to the latest message when the chat has no summary yet

#### Fix: cheap-LLM reasoning headroom pushed max_tokens past the model's limit

- The cheap-LLM sender (`sendToProvider`, `lib/memory/cheap-llm-tasks/core-execution.ts`) added 4,000 tokens of reasoning headroom on top of whatever the caller asked for. Memory extraction and consolidation ask for the profile's whole output budget, so a profile on the `Deep` model class (128,000) sent 132,000, and NanoGPT/DeepSeek refused every call with `400 The max_tokens parameter is illegal` (limit 131,072). Consolidation clusters failed and extraction's OTHER fold formed nothing
- `CheapLLMSelection` now carries `maxOutputTokens`, the profile's `resolveMaxTokens` ceiling, set by `selectionFromProfile`. `withReasoningHeadroom` takes an optional ceiling and stops the headroom there, never cutting below the requested answer budget. A selection that swaps in the provider's cheapest model carries no ceiling, since the profile's does not describe that model
- The uncensored image-prompt selections in scene-state tracking, story backgrounds and the image-generation tool were built by hand; they now go through `selectionFromProfile`, which also gives them the profile's provider parameters and keeps a non-Ollama profile's own base URL

#### Fix: conversation summary files follow their chat's current title

- A chat's summary file in each participant's vault (`Conversation Summaries/<title>.md`) was named, and its frontmatter `conversationTitle` set, from the chat's title at the last summary fold. Chats are retitled between folds, so files kept old names and recall's "relevant past conversations" reported old titles
- New startup pass `syncConversationSummaryTitles` (`lib/startup/sync-conversation-summary-titles.ts`), chained after the vault backfill in `instrumentation.ts`, matches each file to its chat by frontmatter `conversationId` and renames it to the current title, with the writer's name rule (`summaryFileName`, or `disambiguatedSummaryFileName` when another conversation holds the name; both now exported from the bridge). A changed frontmatter title is rewritten; nothing else in the file changes
- A rename alone keeps the file's chunks and embeddings. A title rewrite re-chunks the file and queues its embedding again (frontmatter is not embedded, so the vectors do not change). Files whose chat no longer exists and archived characters' vaults are skipped. Matching files are not touched

### 4.14.0

#### Docs: release checklist adds a fresh-instance dogfood step

- New `/release-checklist-3-dogfood`: start a brand-new instance in a scratchpad data directory on its own port, walk first-run setup and the setup wizard in the browser with real API keys (entered by the developer), then a first chat, memory, character creation, tools, projects, images, Brahma, a settings sweep, backup and restore into a second fresh instance, and a restart. Findings are fixed with a regression test or reported
- The old checklist items 3–14 are now 4–15; command files, `DEVELOPMENT.md`'s release list, and references in `CLAUDE.md`, `tag-for-release.md`, `DEAD-CODE-REPORT.md` and two feature specs follow. Earlier CHANGELOG entries keep the numbers they were written with

#### Test: flaky theme-draft export temp-directory check

- `export › removes its temporary directory whatever happens` (`styles-and-import.test.ts`) diffed the shared `os.tmpdir()` before and after `exportDraft`. `operations.test.ts` also exports, in another Jest worker, and its short-lived `qtap-theme-draft-export-*` directory was sometimes caught between the two listings, failing CI intermittently
- The test now spies on `fs.mkdtemp`, records the one directory its own export made, and checks that path is gone. No app change

#### Fix: Reset Built-in Characters kept neither character's id

- The reset rewrote the seed bundle's character ids to the existing ones, then imported without `preserveIds`, so the importer minted new ids anyway. Chats and links that named the old Lorian or Riya were left pointing at rows that no longer existed
- The id plan is now `planBuiltinReset` (`lib/characters/builtin-reset.ts`) and the import runs with `preserveIds`. An existing built-in keeps its id; one that did not exist takes the seed's id, or a new one if another row holds it; every memory gets a new id, so the importer's collision check cannot refuse the reset
- A re-import that fails now returns a 500 instead of `success: true`
- Characters reset before this fix keep the new ids they were given; the old ids are not recovered

#### Change: Lorian and Riya rewritten

- The built-in characters' seed bundle (`first-startup/imports/lorian-and-riya.qtap`) is rewritten from new character seeds. Names, titles, character ids and system-prompt ids are unchanged. Both are now written as ordinary people in no particular setting: Lorian (Lounès Haddad) a teacher of literature and Latin from Béjaïa, Riya (Riya Selvam) a mechanical engineer from Chennai and Delhi
- The bundle is in the current character shape. The old one carried `physicalDescriptions` (plural) and `clothingRecords`, which the importer no longer reads, so a new instance's Lorian and Riya had no physical description. Each now has `manifesto`, `identity`, a singular `physicalDescription` with all five prompts, a named scenario, an alias for the full name, eight wardrobe items with image prompts (one a `hair` item) and twelve memories (24 in all, replacing 42)
- `manifesto` and `personality` are in second person, `identity` and `description` in third. `firstMessage` stays empty so the greeting is composed for whatever scene the chat opens in; the seed's opening is an example dialogue instead
- Each system prompt tells the character to use the help tools for questions about Quilltap and not to guess. Help Tools stay on by default for both
- Existing instances are not changed (seeding skips characters that exist). Reset Built-in Characters brings in the new versions
- Help: `character-management.md`

#### Feature: export a character from Summon From Lore

- The AI import wizard (Aurora's Summon From Lore, and the Salon's Summon from Lore in Add Character) could only import its result. The review step now has Export as .qtap beside Import Character, and again on the success screen
- The wizard's result is already a complete `QuilltapExport`; `exportCharacter` (`useAIImport`) downloads it as single-JSON `.qtap` through `triggerDownload`, named from the character (`qtapFilenameStem`). The importer reads that shape as it does NDJSON, so the file imports anywhere. No server change
- Help: `ai-character-import.md`, `chat-participants.md`

#### Feature: export a theme or its draft from the Atelier

- The Atelier had no way to get a draft out as a file; the only route was to install it and export the installed copy from Appearance
- New `GET /api/v1/theme-drafts/[id]?action=export&form=theme|draft` (`exportDraft`, `lib/themes/drafts/service.ts`). Neither form installs anything or bumps the draft's version
- `form=theme`: the installable build, unused fonts and images left out, images as WebP, TTF/OTF fonts as WOFF2, named `<id>-<version>.qtap-theme`. Install and this export share one build step (`writeBuiltDraft`, split out of `installDraft`)
- `form=draft` (default): every draft file as stored, named `<id>-<version>-draft.qtap-theme`; importing it gives back the same draft
- Refused with `422 { errors }` (`DraftNotExportableError`) while the draft has validation errors or a file will not convert; the packed archive is also checked with `validateThemeBundle`
- Editor: Export theme and Export draft buttons beside Install, disabled while the draft has errors; downloads through `triggerDownload`, so the Electron shell gets its save dialog
- Help: `theme-editor.md` (new "Exporting" section), `making-a-theme.md`. Also `API.md`

#### Feature: home page rebuilt as bands

- The home page was three equal columns clipped to the viewport: Projects sat half empty, chat titles were cut at about 20 characters, and eight of the character cards fit. It is now a header line and three bands, each as tall as its content; the page scrolls
- Header: the greeting and the quick actions share one line. "Continue Last" is gone
- First band: a resume card for the newest chat (story background at size, full title, cast, project, a line from the context summary, one Resume button) beside the six chats before it, in rows wide enough for a two-line title. `ChatsBand` applies quick-hide once, so the resume card is the newest chat still on show; the old button opened the newest chat even when quick-hide was hiding it. One chat takes the whole row; none shows an invitation
- Second band, "The Company": portraits two rows deep (three on a phone-width pane), favourites starred, the last place a link to everyone else. `CharactersSection` reads the grid's resolved columns instead of estimating card sizes, and no longer depends on the band's height. Clicking a portrait opens the New Chat dialog; hover or keyboard focus opens a card with the title, model badge, a link to the character's latest chat and a link to their page. The card closes on Escape, opens above every row but the last so it never covers a portrait, and is not opened by focus that did not come from the keyboard
- Third band: projects as tiles in an auto-fill grid. With no projects the band is not rendered
- The bands answer to the pane's width through a container query on `qt-homepage-grid`, not the window's, so a split workspace stacks them correctly. The full-width overrides for the old grid are removed
- Home payload (`lib/services/home-data.service.ts`, `GET /api/v1/system/home`): chats gain `project` and `summaryExcerpt` (`lib/chat/summary-excerpt.ts`: first content line of the context summary, Markdown stripped, 240 characters); characters gain `latestChat` with the tags and Concierge state quick-hide asks about; `characterTotal` added; the character cap is 48 (was 24); `lastChatId` removed
- Home rows no longer carry `hover:qt-bg-muted/50`, a class that never existed; hover is on `qt-homepage-row` in CSS
- Theme hooks: new `qt-homepage-header`, `qt-homepage-resume-picture`, `qt-homepage-resume-title`, `qt-character-card-popover`, and the `resume` value of `data-section`, each with a specimen. `qt-character-card` is now an unbordered portrait tile. No hook was removed, so the catalogue version stays 2. Regenerated the hooks doc, the styled-by table and the CLI theme engine
- Help: `homepage.md` rewritten (it described buttons that no longer existed), `quick-hide.md`. Also `API.md`

#### Feature: Emphasis is its own roleplay style

- Roleplay text had no italics that meant only emphasis. Novel set narration in italics, so its `*emphasis*` had to be bold + italic; Standard told models to use bold for stress
- New style class `qt-roleplay-emphasis` (theme hook, specimen, tokens `--qt-rp-emphasis-style` = `italic` and `--qt-rp-emphasis-style-in-italic` = `normal`). Markdown `<em>` in a message is styled by the same rule. Emphasis sets no colour; it takes the ink of the voice around it
- Inside an italic voice, emphasis turns upright. A voice declares its slant in `--qt-rp-voice-style`; the italic flourish (`qt-rp-italic`) is matched by class, and voices slanted by a theme variable (narration, inner monologue) by a container style query. A browser without style queries leaves emphasis there in the voice's slant
- New style class `qt-roleplay-quiet` (theme hook, specimen, token `--qt-rp-quiet-color` = 82% of the inherited colour): a chipless voice in softer ink
- The tokenizer (`lib/chat/roleplay-rendering.ts`) nests an emphasis span inside the unmarked text it sits in instead of emitting it as a sibling, so it inherits that voice's ink and slant; runs of unmarked text and emphasis become one span. The server's `stripUnmarkedSpans` now pairs tags, since an unmarked span can hold a nested span
- Novel: narration is `qt-roleplay-quiet` (upright), emphasis is `qt-roleplay-emphasis` (italic). Was italic narration and bold + italic emphasis
- Standard: new Emphasis delimiter `_word_`; the prompt asks for underscores for stress and keeps `**bold**` for force. Quilltap RP: new Emphasis delimiter `*word*`, so emphasis inside `[brackets]` and `{braces}` is styled too. Both get an Emph toolbar button
- A `_` wrap delimiter now follows Markdown's rule (`UNDERSCORE_WRAP_REGEX`, `lib/chat/annotations.ts`): no word character before the opening mark or after the closing one, so `snake_case_name` is left alone. Applies to templates saved from now on
- Built-in templates update on the next start. Copies of Novel made earlier keep the old styling
- Template editor: Emphasis and Quiet added to the style list
- Regenerated theme variables, token and hook docs, the tokens schema, the styled-by table, the CLI theme engine and snapshot fixtures
- Help: `roleplay-templates.md`, `roleplay-templates-settings.md`

#### Fix: selected text and Novel composer colours were too faint

- The default theme's `--qt-selection-bg` was 18% alpha, barely distinguishable from unselected text; it is now `hsl(225 65% 50% / 0.40)`. The six bundled themes' selection tints were raised to 42%
- Prose-mode composer preview: narration was a mix of foreground and `--color-primary`, which is the foreground itself in Earl Grey and nearly so in the light modes of Art Deco, Great Estate and Old School, so narration and dialogue looked the same. `--qt-composer-narration-fg` is now 40% foreground + 60% `--color-info`, and `--qt-composer-narration-bg` a 12% `--color-info` tint (was 7% primary). Narration now differs from dialogue by ΔE 25+ in every bundled theme and mode, at 6.6:1 or better against the input
- A selected `((aside))` in the composer vanished in light themes: `::selection` always sets the text colour over a custom highlight, so the selection's dark ink sat on the aside's dark out-of-character background. `PunctuationLintPlugin` now lifts the `qt-composer-ooc` paint from whatever the selection covers (`subtractRange`, re-run on `selectionchange` without re-linting), so a selected aside reads as ordinary selected text and gets its colours back when the selection moves
- Theme snapshot fixtures and the theme tokens schema regenerated

#### Feature: Brahma reads a conversation's live state

- `@Brahma` answered "what does Riya have equipped right now?" from her `Inventory/` object file, whose `equippedByDefault` is only an arrival default, and said nothing was equipped while the chat's equipped set still held it. It also had no way to know which conversation "now" meant
- New research-kit record tool `lookup_chat_state` (`lib/research/chat-state.ts`, definition `lib/tools/lookup-chat-state-tool.ts`, effect `read`, operator surface only): every seat, present first; what each carries (`loadEquippedSet`) and wears (`describeEquippedOutfitTitleOnly`) in that chat; the scene tracker's location and action, labelled as told; the Concierge posture. With no `conversation` argument it reads the chat the call came from; the executor now passes `chatId` to research-kit handlers
- The inline Brahma's question is prefixed with an asked-from note (`askedFromNote`, `lib/services/brahma-console/one-shot.service.ts`): the chat's title and id only, never its transcript. Salon and autonomous chats only
- Brahma's SQL prompt lists the tool and says carried and worn objects are `chats.equippedInventory` / `chats.equippedOutfit`, not an object file's `equippedByDefault`
- Help: `brahma-console.md`, `carina.md`. Also `research-kit.md`

#### Fix: the scene state told characters their narrated deeds were done

- The scene tracker reads prose only (tool calls stripped), so it could not tell a deed done from a deed described, and `## Current State` handed its answer back to every character as present truth. A character who narrated putting an object away without calling `inventory_unequip` was told by her own scene state that she had, next to a "Carried and equipped" record saying she still held it, and kept narrating instead of calling the tool
- Both tracker prompts (`lib/memory/cheap-llm-tasks/image-scene-tasks.ts`) now take a shared `SCENE_ACTION_RULE`: `action` is a telling attributed to whoever told it ("<name> says she has put the lamp away"), never accomplished fact; the update prompt rewrites a carried-forward action phrased as fact. Examples use a `<name>` placeholder (bug 161)
- `formatCurrentSceneState` (`lib/chat/context/scene-state.ts`) heads each section `#### Action (as told)` and adds `SCENE_ACTION_NOTE` to the header list (actions are a telling; carried and worn objects are the records), which also frames actions stored before this change
- Help: `scene-state-tracker.md`

#### Dependencies: npm update across root, packages and plugins

- Ran `npm update -S` in the root project, every package and every plugin. Notable bumps: `openai` 7.62, `@anthropic-ai/sdk` 1.12 (anthropic plugin), `@openrouter/sdk` 1.5.128, `@tanstack/react-query` / `react-query-devtools` / `eslint-plugin-query` 5.108.2, `@tanstack/react-virtual` 3.14.27, `autoprefixer` 10.7.0, `@napi-rs/canvas` 1.2.0 (CLI)
- plugin-utils and the plugins now require `@quilltap/plugin-types` ^2.13.0; the plugins require `@quilltap/plugin-utils` ^2.7.7
- plugin-utils 2.7.8, installed at the root; patch bumps to all 15 plugins (`package.json` and `manifest.json`), rebuilt

#### Dependencies: root installs `@quilltap/plugin-utils` 2.7.7

- Root `package.json` floor raised to `^2.7.7` and the lockfile updated from 2.7.6 to the published 2.7.7. `packages/plugin-utils/CHANGELOG.md` now has entries for 2.7.2 through 2.7.7 (all dependency-only releases)

#### Fix: Brahma's SQL prompt described every cold memory as a consolidated member

- The `memories.tier` note in `lib/brahma-console/brahma-sql-prompt.ts` now says a cold row is either superseded (`supersededById` names the digest or the newer contradicting row) or, with `supersededById` NULL, demoted past the memory cap. Brahma's tier counts no longer count cap-demoted rows as consolidated ones

#### Feature: characters may read and edit their own memories

- New tools `read_memory` (effect `read`) and `edit_memory` (effect `write`), gated by a new per-character flag `canEditMemories` (migration `add-character-memory-edit-flag-v1`, NULL = off). Independent of `systemTransparency`. Offered on Salon turns only; the other tool surfaces never pass the flag
- `read_memory` takes an id and returns `{ memory, context }`: `memory` is exactly the object `edit_memory` takes (`id`, `content`, `summary`, `keywords`, `importance`, `about_character_id`, `related_memory_ids`), `context` the read-only facts (kind, source, archived, keystone, dates, reinforcement count, subject name, source conversation)
- `edit_memory` takes the whole object, every field required, and writes only the fields that changed through `updateMemory`. Scoped to the calling character's own memories; a keystone is refused; an unknown `about_character_id` is refused. From the job child (autonomous rooms) the write goes to the parent over a new `editMemory` host-RPC (`requestMemoryEdit` / `editMemoryOnHost`, `lib/memory/admission/update-memory.ts`)
- Handlers in `lib/tools/handlers/memory-edit-handler.ts`. Native and simple-json tool modes; text-block mode does not offer them
- Aurora: Abilities → Tools & talents → **Edits their own memories**. Tool settings group "The Commonplace Book". Salon tool cards "Read Memory" / "Edit Memory". Almanack counts characters with the permission
- Help: `character-editing.md`. Also `DDL.md`, `qtap-export.schema.json`

#### Fix: `search` sent every hit to the model twice

- The tool message for `search` was the whole result object as JSON: the rendered `formattedText` plus the raw `results` array, so each memory's content, summary and dates went out twice, with UUIDs and scores the text already summarised. `processToolCalls` (`lib/services/chat-message/tool-execution.service.ts`) now hands the model `formattedText` alone; the live tool card still receives the full object
- Memory hits in the rendered text now carry a `Memory ID:` line, so the id survives the change
- Help: `episodic-memory.md`

#### Docs: 4.14.0 release notes

- Added `docs/releases/4.14.0.md`
- The release notes, `help/navigation.md` and the shell contract's status name quilltap-shell 4.2.7 as the shell that builds its menu bar from the navigation listing; 4.2.7 is now the recommended shell
- The release notes now cover characters reading and editing their own memories, the `search` double-send fix and Brahma's cold-memory note
- The release notes now cover the rebuilt home page, the Emphasis and Quiet roleplay styles, the selection and Novel composer contrast fix, `lookup_chat_state`, the scene-state "as told" fix and the latest dependency versions; the hook count is corrected to 232 and the roleplay spans to six
- The release notes now cover exporting a theme or its draft from the Atelier, exporting a character from Summon From Lore, the rewritten Lorian and Riya, and Reset Built-in Characters keeping their ids; the drafts-and-exports lines in the Atelier section and Upgrading now point at the Atelier's export

#### Fix: Claude through OpenRouter (or any gateway) failed every multi-character turn

- The `[Name]` prefill default was off for the ANTHROPIC provider only. A profile reaching Claude through another provider — the setup wizard's OpenRouter `anthropic/claude-sonnet-5` profile, NanoGPT, an OpenAI-compatible proxy — was created with it on, and Anthropic 4.6+ rejected every multi-character turn ("This model does not support assistant message prefill"). A chat with a user character is multi-character, so the opening greeting failed silently and every reply failed
- New `refusesAssistantPrefill` / `isClaudeModelName` (`lib/llm/multi-character-prefill.ts`): the default is now off for Anthropic and for any model id naming Claude. `defaultMultiCharacterPrefill` and `profileUsesNamePrefill` take the model name; the create route, the profile form and the profile editor pass it, and the editor's warning follows the model
- Migration `retire-prefill-on-gateway-claude-profiles-v1` sets the stored `multiCharacterPrefill = 1` to 0 on non-Anthropic profiles whose model names Claude
- Help: `connection-profiles.md`, `system-backup-restore.md`

#### Fix: a new instance's second boot ran old migrations against current data

- On a fresh database the migrations run before the app creates its tables and seeds its rows, so every historical data pass skipped with "nothing to do" and, writing no ledger row, stayed armed. The next boot ran up to 18 of them against rows written by current code: `migrate-character-photos-to-vault-v1` read the seeded avatars' vault link ids as missing `files` ids, nulled Lorian's and Riya's `defaultImageId` and garbage-collected the gallery's `files` rows (it was set off by the wardrobe portrait preview, which writes a character-tagged `files` row); `align-about-character-id-v1`/`v2` re-attributed seeded memories (a character's memories about another character flipped to be about themselves); obsolete columns were re-added to `characters` and `chat_settings`
- The migration runner now baselines a skipped migration — writes it to the ledger as settled without running it — when the database was created this boot, or when the migration was introduced before the release that created the database (from the `sqlite-initial-schema-v1` ledger row; pre-release tags ignored). Existing instances settle their dormant pre-birth migrations on the next boot. Logic in `migrations/lib/baseline.ts`
- New `Migration.skipMeansNotYet` for a migration whose `shouldRun` is waiting on a later startup task rather than out of work; it is never baselined. Set on `drop-wardrobe-items-table-v1`
- Not repaired: data an instance already lost this way (avatar pointers, `files` rows, memory attribution) stays as it is

#### Refactor: shared file-op failure response, shared repository bases, schema-read theme action bodies, dead code

- New `fileOpFailure` (`lib/api/file-op-failure.ts`) is the HTTP answer for a failed document-store file operation. The mount-point action route, the per-file route and blob upload each spelled the `{ error, code }` mapping in their own `catch` (twelve copies, two local wrappers). Move, copy, link, write and delete file now also map a `DatabaseStoreError` to its status instead of a 500
- `POST /api/v1/themes`: `install-from-url`, `add-source`, `remove-source` and `install-registry` read their body against a Zod schema through one `readBody`. Error messages are unchanged; a body that is not an object (`null`, an array) is a 400 instead of a 500
- `POST /api/v1/themes?action=install` keeps only the last path segment of the uploaded filename for its temporary file
- The plugin-routes `OPTIONS` answer no longer sends `Access-Control-Allow-Methods` (`Allow` is unchanged)
- Tag editor suggestions read the shared tag list query (`queryKeys.tags.list()`) instead of a private fetch, and creating a tag invalidates it for the Tags settings card and tag styles
- Six hand-built secondary buttons (Aurora dialogs, project header, delete-project dialog) use `qt-button-secondary`; the outfit quick-pick and the Brahma model picker use `qt-shadow-md` / `qt-shadow-lg`
- New `DefaultableProfileRepository` (`lib/database/repositories/defaultable-profile.repository.ts`) holds the find-by-name, find-default, create, update, delete and unset-defaults bodies that `ImageProfilesRepository` and `EmbeddingProfilesRepository` each carried a copy of. The one difference is kept as an option: embedding-profile finders return null on a failed read, image-profile finders rethrow
- New `OwnerDocMountLinksRepository` (`owner-doc-mount-links.repository.ts`) holds the link, unlink and finder bodies shared by the project and group store-link repositories. The group repository keeps its own `deleteByGroupId` and `deleteByMountPointId`
- Repository `update` overrides (users, tags, files) no longer strip `id` / `createdAt` before `_update`, which already keeps the stored values. `backup-service.ts` uses the restore archive's `cleanupDir` instead of its own copy
- Removed unused code: `lib/errors.ts`, `hooks/useEscapeKey.ts`, `components/ui/ChevronIcon.tsx`, `TemplateDisplay`, `buildInterspersedToolLayout`, `hasMixedLineEndings`, `ownDarkValue`, `remapEntities`, `personasWithCards`, `poolMountIds`, `isSafeAtlasFolderPath`, `isSafeInventoryFolderPath`, `listAtlasEntryImages`, `listInventoryItemImages`, `EMPTY_CONSOLE_CONTEXT`, `KIT_REPLACED_DOC_TOOLS`, `REFUSED_THEME_HELP_URL`, the deprecated `cleanupOldJobs`, and the repository methods `updatePath` (blobs), `getTotalTokenUsageForChatSince`, `countByMessageId`, `updateAccessTime`, `countBySourceMessageId`, `getGeneralSettings` and `findRowsForWearer`

#### Refactor: release checklist 3 (best-practices pass)

- New `streamAgentRun` (`lib/api/agent-run-stream.ts`) is the SSE response for the Scenario Builder, wardrobe design and Atlas lore routes, which each carried their own copy of the abort-safe controller, fallback error frame and headers
- New `researchOnlyTextBlockToolOptions` (`lib/services/chat-message/text-block-tool-options.ts`) replaces the all-off text-block tool options literal copied into the Brahma orchestrator and one-shot, the Calliope persona, the Scenario Builder, Atlas lore and wardrobe design services
- New `AgentRunProgress` and `pickToolProfileId` (`components/agent-stream/`) replace the running panel and the default-profile fallback repeated in the Scenario Builder dialog, Import from Instructions and the Atlas lore wizard
- Theme editor: a stale-revision save and a stale-revision operation recover through one `reloadAfterConflict`; the saver's conflict path now also refreshes the draft list
- Theme editor file sizes use the shared `formatBytes`: sizes under 1 KB read "812 B" instead of "812 bytes"
- Removed duplicates: `hashBuffer` (use `sha256OfBuffer`), a second `isInsideKeyframes`, three `dateOf` copies in `lib/research/`, and a private `CONVERSATION_CHAT_TYPES` in the Brahma lookup handler. Removed unused `hooksForSurface`

#### Tests: dynamic-backgrounds layout test runs in about 1 s

- `layout.test.ts` took about 112 s: `checkPlan` made one `expect` per occupancy-grid cell (2,304 per plan, 2,400 plans, about 5.5 million matcher calls). It now collects violations in plain JS and asserts the list is empty once per plan. Same invariants and seeds; failures still list the offending cells, tiles and bands

#### Accessibility: release checklist 13 (UI and WCAG pass)

- Focus ring restored on buttons that also carry `qt-shadow-sm` / `-md` / `-lg` (e.g. the delete buttons on character and group cards): the shadow utility replaced the `ring-*` box-shadow. While `:focus-visible`, the shadow utilities now use Tailwind's ring composite
- Button, tab and chat-control focus rings use `outline-hidden` instead of `outline-none` (a transparent outline that shows under `forced-colors: active`) and `ring-offset-background` instead of the default white offset, which drew a white band around the ring in dark themes
- A `<label>` wrapping an `sr-only` radio or checkbox shows a focus outline when the input has keyboard focus (connection-profile picker and similar option cards)
- The Import from Image drop zone and the SillyTavern chat-import drop zone are keyboard operable (`role="button"`, `tabIndex`, `activateOnKey`, accessible name)
- Connection-test results in the profile modal and import errors are announced (`role="status"` / `role="alert"`); theme-editor "does not fit" messages are `role="status"`; a theme file over the per-file size limit is marked with an icon and screen-reader text, not colour alone
- Form-field edges reach 3:1 against the page and card backgrounds in the default theme and all six bundled themes (`--theme-input` raised in each mode; Earl Grey's `--qt-input-border` was `transparent`, Rains' `--qt-input-border` was a 12% white mix in dark mode). `check-theme-contrast` now checks `--qt-input-border` on `--theme-background` and `--theme-card`. `.qt-bg-input` (Document Mode's source view) now uses `--qt-input-bg` instead of the input border colour. Bundled theme versions bumped: Art Deco, Earl Grey, Great Estate, Old School and Rains to 2.0.1, Madman's Box to 2.0.2
- Idle header queue badges no longer fade the whole badge: the background is tinted at `--qt-queue-badge-idle-opacity` of the badge colour and the label uses the page foreground. The blip animation flashes the badge's working colours instead of opacity
- In dark mode the workspace photo backdrop defaults to 0.35 opacity (was 0.4), and the Home subtitle uses the foreground colour instead of the secondary one, since both sit directly on the photo
- Four more file drop zones are keyboard operable: AI Import source files, the `.qtap` import step, backup restore, and the AI Wizard's image and document uploads (the hidden inputs are now `sr-only`, and a label following a focused `sr-only` input shows a focus outline)
- Calliope's message list is a `role="log"` region instead of `aria-live` on the whole transcript; the workspace tab close cross has a `title`
- New `qt-icon-inline-note` utility for the small warning/check icons in the theme editor's notes (`TokenRow`, `PrimitivesPanel`, `FilesPanel`). The old Tailwind `inline` class set `display: inline`, which made the mask-drawn icons render at zero size

#### CLI: theme bundle paths complete in the shell

- `quilltap themes install` and `themes validate` now complete file and directory paths in bash, zsh and fish; before, only flags were offered after those verbs. Tests in `completion-behavior.test.js`

#### API: every DELETE refuses an unknown action

- 43 v1 `DELETE` handlers ran their delete when called with an `?action=` they do not answer. They now go through the action dispatcher (`withActionDispatch({}, handler)`, or `dispatchAction` for the two catch-all `[...path]` routes), so an unknown action is a 400. Covers the inline route handlers, `characters/[id]` and `files/[id]` (`handlers/delete.ts` callers), and the scenario, inventory, wardrobe and owner mount-link route factories
- New guard test `__tests__/unit/lib/api/delete-action-dispatch.test.ts` walks every v1 route that exports a `DELETE` (inline, through `./handlers`, or from a factory) and fails when it is not dispatched
- Test request mocks for these routes now carry `nextUrl`, which the dispatcher reads

#### Backup/restore: tests for 4.14 data-model additions

- `restore-field-fidelity.test.ts` now runs a Calliope chat's `chatType` / `themeDraftId` and a generated file's `generationModeration` through `restore()`. `themeDraftId` was only tested at the remap step, and `generationModeration` had no restore test

#### Theming: staff avatars and Atelier inline links follow the theme

- The Brahma, Aurora and Host portraits in the Atlas lore wizard, Import from Instructions and the Scenario Builder now use `qt-avatar`, so a theme's avatar radius, border and background apply
- New `qt-inline-link` utility (`_interactive.css`) for links and action buttons inside a sentence: keeps the surrounding text colour, always underlined. Applied to the seven bare `underline` links in the theme editor (`DraftEditor`, `TokenRow`, `FilesPanel`, `StylesReference`, `StylesSection`)

#### CI: full test suite only on main and bugfix

- The CI Test job now runs only on pushes to `main` and `bugfix`. Pull requests and pushes to other branches run lint and build only; the CI Summary treats a skipped Test job as passing
- CI now also triggers on pushes and pull requests for `bugfix`

#### Release prep: leftover debug logging pruned

- Removed a `console.debug` in the left-sidebar nav rail that fired whenever a disabled item was activated. All other logging added since 4.13.0 was reviewed and kept

#### Tests: release checklist 2 (coverage and regression tests)

- Regression tests for four fixes that had none: the home-tab dynamic background marker and the hidden-tab exclusion in the page-background rule (`page-background-precedence.test.ts`, `home-view-dynamic-background.test.tsx`), the Madman's Box home photograph guard, the sticky Markdown editor toolbar and the `cqh`-sized Atelier panels (`scroll-surface-layout.test.ts`). Each fails with its fix reverted
- New coverage for modules added in 4.14: the `add-dynamic-backgrounds-settings-field-v1` and `add-file-generation-moderation-column-v1` migrations, `generated-image-kind`, theme `bundle-paths`, draft `api-errors`, engine `css-text`, snapshot `var-substitute`, the research-kit handler maps, the Calliope API routes and `useProposalImport`
#### Dev tooling: "since the last release" ranges and branch rules for agents

- New `scripts/last-release-tag.sh` prints the base for "since the last release" ranges: the newest `rel/X.Y.Z` anchor on main-line branches, or the commit where `X.Y.Z` merged into bugfix. It unshallows and fetches tags in cloud checkouts; `--name` prints the version
- The release checklists used `git describe --match '[0-9]*.[0-9]*.[0-9]*'`, which also matches dev tags, so every audit covered only the commits since the last dev build. They now call the script
- `tag-for-release` no longer claims `git log X.Y.Z..main` lists the work since a release; the release commit is a squash, so that range lists the whole history. Ranges use the `rel/` anchor
- CLAUDE.md gains "Commits and branches" (no commit on `main` without `/commit`; other branches, worktrees and cloud sessions commit to their own branch) and "The last release". The checklists' "Do not commit" now points to it; `tag-for-release` and `remove-old-dev-tags` refuse to run outside the human's local checkout
- `/commit` picks the CHANGELOG section from the `package.json` version instead of the branch, and says which sources trigger a version bump
- `bugfix` is protected like `main`. Cloud sessions push their branch and open a PR without being asked, choose their own test scope (CI runs the full suite), and skip the pre-commit hook. Version bumps happen only on `main` and `bugfix`; other branches skip `update_version.sh` so parallel branches don't conflict on version files. A `packages/` change that needs `npm publish` pushes its branch and pauses for the human to publish from it

#### Document core: disk bytes read through the doc-edit backend

- `readDocumentBytes` (`lib/documents/core/read.ts`) no longer calls `fs` directly for a filesystem store. It uses the new `readResolvedFileBytes` in `lib/doc-edit/path-resolver.ts`, next to `statResolvedFile` / `moveResolvedFile` / `deleteResolvedFile`. The core chokepoint test now fails if anything under `lib/documents/core/` imports `fs`

#### Atlas: listings ignore a leading "The"

- The Atlas browser now sorts entries the way scenario lists do: case-insensitive, with a leading "The" ignored ("The Covenant" sorts under C). The rule moved from `lib/scenarios/sort.ts` into `lib/utils/title-sort.ts` (`titleSortKey`, `compareTitles`); `scenarioSortKey` is now an alias for it

#### API: removed the 4.13 deprecated paths; unknown actions refused on more verbs

- Removed the old route paths that answered for one release after 4.13 moved their actions to `?action=`: `wardrobe/analyze-image`, `wardrobe/preview-avatar`, `wardrobe/transfers`, `atlas/transfers`, `inventory/transfers`, `groups/scenarios`, `system/browse-directory`, `system/plugins/initialize` and `system/plugins/upgrades`. Use the `?action=` forms on the parent routes (listed in `docs/developer/API.md`)
- Removed the body-discriminator aliases `POST /api/v1/chats/[id]?action=turn` and `POST /api/v1/system/tools?action=tasks-queue`; both are now unknown actions (400). Use `turn-nudge|turn-queue|turn-dequeue|turn-query|turn-skip-user` and `tasks-queue-start|tasks-queue-stop`
- Removed `lib/api/deprecated-path.ts` and the `'from-body'` mode of the wardrobe, atlas and inventory transfer handlers
- `DELETE` on `calliope/[id]`, `connection-profiles/[id]` and `themes/[themeId]`, and `GET`/`POST` on `calliope`, `calliope/[id]` and `calliope/[id]/messages`, now go through `dispatchAction`, so an unknown `?action=` is a 400 instead of running the default verb
- `connection-profiles/[id]`, `chats/[id]` DELETE and `system/navigation` answer through the `@/lib/api/responses` helpers instead of `NextResponse.json`

#### Atlas lore wizard: quoted phrases inside a search query display correctly

- Brahma's activity lines (`describeBrahmaActivity`) no longer break the outer quotes when a query contains its own quoted phrase. `"Zbinden Trust" Osage Duchy` now shows as “‘Zbinden Trust’ Osage Duchy” instead of losing its leading quote and leaving an unbalanced one

#### Connection profiles: Auto-Configure reads provider catalogs before guessing

- Auto-Configure now looks up known facts before asking an LLM, strongest source first: the provider plugin's live model catalog (read with the profile's own key and base URL), the plugin's static model table, then OpenRouter's public catalog for upstream limits. Facts are never overruled by the LLM estimate. New module: `lib/llm/model-catalog.ts` (`lookupModelFacts`, cached per provider / base URL / key for an hour)
- New optional plugin hook `getModelCatalog(apiKey, baseUrl)` in `@quilltap/plugin-types` 2.13.0, implemented by the OpenRouter, NanoGPT, Google and Ollama plugins. Absent fields mean unknown
- The result now reports `supportsTools`, `supportsImages`, a `pseudoToolMode` recommendation and a source for every field (`fieldSources`). Tool and image support are taken only from a source that describes the profile's own route; OpenRouter's public data counts for tools only on OpenRouter profiles
- Tool format is moved to Simple JSON only when a catalog says the route lacks native tool calling, and only from `auto` or `native`; a hand-picked mode is kept. `supportsImageUpload` is written only when a catalog states it. Shared by both routes through `profileUpdateFromAutoConfigure`
- Model class is derived from the final limits (`deriveModelClass`) instead of chosen by the LLM. Max output is capped at the context window
- OpenRouter public lookups for Auto-Configure (`findOpenRouterPublicModel`) never match by substring; after an exact id they compare normalised bare names (`normalizeModelKey`: `.`/`_`/`:` read as `-`, trailing date stamp dropped), so `claude-sonnet-4-6` finds `anthropic/claude-sonnet-4.6` and not `claude-sonnet-4`
- Web search is now optional. The specs search runs only when a limit is still unknown, and searches by the upstream model name (`google gemini-2.5-pro`) instead of the router's name
- If the catalogs supply both limits, a missing default profile or a failed LLM no longer fails the run; sampling falls back to defaults
- `?action=auto-configure` takes `baseUrl` and `apiKeyId` (strict Zod body). The profile form lists each value with its source

#### Settings: Courier profiles get their own card under By provider

- Courier connection profiles (`transport: 'courier'`) are now listed under their own **The Courier** card in Settings → Connections → Providers → By provider, after the API providers. Before, they were grouped by their informational `provider` field, so older ones (`OPENAI`) appeared in the OpenAI card
- `groupByProvider` (`components/settings/cards/provider-groups.ts`) sends Courier profiles to `COURIER_PROVIDER_GROUP`. The card shows no key count, its Add menu offers only a connection profile, and that opens `ProfileModal` with the Courier transport selected

#### Context summary: one fold per chat at a time (doubled story backgrounds)

- Fixed group chats getting two story backgrounds back to back, so the first was replaced before anyone saw it. A summary fold takes about 30 seconds and only advances `lastSummaryTurn` when it finishes. In a multi-character chat the next character's reply read the same anchor, passed the gate again and started a second fold over the same turns. Each fold retitled the chat, and each retitle queued a story background. The story-background dedupe absorbs only a pending job, and the first had already started. On the reference instance this happened for 18 of 34 fold checkpoints in a week
- `generateContextSummary` (`lib/chat/context-summary.ts`) is now single-flight per chat within a process: a call made while a fold is running joins it and gets its result. `checkAndGenerateSummaryIfNeeded` skips the gate while a fold is in flight, and the next reply's check sees the advanced anchor. `isContextSummaryFoldInFlight` is exported for this

#### Dependencies: npm audit cleared with overrides; install-script approvals by name

- `npm audit` now reports 0 vulnerabilities (was 22: 18 moderate, 4 low) without major upgrades. The `glob` override goes from `^12.0.0` (vulnerable) to `^14.0.6`; only Jest uses it. A nested override sets `test-exclude`'s `minimatch` to `^11.0.5`, leaving ESLint plugins on minimatch 3. `"katex": "$katex"` makes `rehype-katex` and `remark-math` use the root KaTeX 0.19.1 instead of 0.16.47
- `allowScripts` entries are now by package name instead of pinned versions, so dependency updates no longer re-raise install-script warnings. Approved: `esbuild`, `fsevents`, `node-pty`, `@parcel/watcher`. Denied: `better-sqlite3-multiple-ciphers`, `@openrouter/sdk` (its postinstall only prints a type check notice). Dropped `unrs-resolver`, which has no install script

#### Dependencies: npm update across root, packages and plugins

- Ran `npm update -S` in the root project, every package and every plugin. Notable bumps: `better-sqlite3-multiple-ciphers` 13.2.0 (root and CLI), `openai` 7.60, `@anthropic-ai/sdk` 1.10, `@openrouter/sdk` 1.5.120, `@tanstack/react-query` / `react-query-devtools` / `eslint-plugin-query` 5.108.1, `@testing-library/user-event` 14.6.13
- The root, plugin-utils and all plugins now require `@quilltap/plugin-types` ^2.12.0
- plugin-utils 2.7.7; patch bumps to all 15 plugins (`package.json` and `manifest.json`), rebuilt. The curl plugin's dependencies did not change, but its bundle picks up the root `openai`, so it was bumped too

#### Stale-chat asset collapse: no longer deletes a character's default avatar

- Fixed the stale-chat asset sweep (`lib/background-jobs/maintenance/collapse-stale-chat-assets.ts`) deleting a character's default avatar when that avatar had first been generated in a chat that later went stale. The default is stored as a vault link id, so `findByDefaultImageId(files.id)` missed it. The album/vault check matched on `files.sha256`, which disagrees with the vault's own hash for about a fifth of generated images, so it missed too. Deleting a `mount-blob:` file removes every link to its blob, `photos/` included
- The sweep now resolves the links a delete would take (storageKey → blob → links) and skips the file if any is a `photos/` link, a link id in the chat's keep-set, or a link id held as a character default or avatar override. A failed lookup leaves the rest of the chat for the next sweep. Skips are logged at debug with a reason
- Fixed generated images recording the wrong `files.sha256`. `createGeneratedFileRow` took the hash as a separate input, and the wardrobe-avatar job, the story-background job, the wardrobe preview and the image tool passed the hash of the provider's (or the handler's converted) bytes, while `size` and `mimeType` came from the bridge. When the bridge re-encoded, the row hashed bytes that exist nowhere, so sha256 joins to the vault copy found nothing (546 of 3,831 mount-blob images on the reference instance, most since September). The hash is now part of `StoredImageBytes` and the row takes it from there; the separate input is gone
- New migration `realign-file-entry-sha256-v2`: the bug 117 realign pass, run again, rewrites each `mount-blob:` row's `sha256` to its blob's hash where they differ. `realign-file-entry-sha256.ts` is now a v1/v2 factory

#### Navigation menus: a grouped rail and the shell's menu listing

- The left rail went from 19 icon-only buttons to 10: Home, Characters, four menu buttons (Conversations, Objects, Library, Studio), then Help, Quick-hide, Settings and the profile button. Each menu opens a flyout with an icon and a text label per row. Spec: `docs/developer/features/complete/navigation-menus.md`
- Menu contents: Conversations (Chats, New Chat…, Scenarios, Brahma Console); Objects (Wardrobe, Inventory, The Atlas, Pascal's Workbench); Library (Projects, Files, The Scriptorium, My Photos, Open Document…); Studio (Generate Image, The Atelier, Theme Gallery, Theme…). Generate Image, the Atelier and the Theme Gallery had no rail entry before
- New navigation registry, `lib/navigation/registry.ts`: one table of items, groups, labels, icons and targets. The rail renders it; behaviour is mapped by item id in `components/layout/left-sidebar/activators.ts`. The two hand-written lists in `collapsed-nav.tsx` and `sidebar-footer.tsx` are gone. A grep-test (`__tests__/unit/lib/navigation/single-source.test.ts`) keeps rail files from spelling destination hrefs or `data-nav` values
- Flyouts portal to `<body>`, open on click (not hover), one at a time, and close on Escape, an outside click or a choice, returning focus to their button. `role="menu"` rows with Up/Down/Home/End; Right or Down on a menu button opens it, Left closes. A row that cannot be used (Brahma with no connection profile) stays visible with its reason as text. At phone width a flyout is a bottom sheet. Inside the workspace a choice opens a tab in place
- New `GET /api/v1/system/navigation`: the registry as ids, labels, kinds and hrefs, for the Electron shell to build a native menu bar. Unauthenticated, static. `types/quilltap-bridge.d.ts` declares the optional `window.quilltap.onNavigate(handler)`; the rail registers a handler that runs the same activator as a rail click. The menu bar itself ships in quilltap-shell; its contract (listing, preload and main-process wiring, fallbacks, versions, checklist) is `docs/developer/features/complete/navigation-menus-shell-contract.md`
- Retired the `showNavThemeSelector` theme preference and its Appearance toggle. Theme… is always in the Studio menu. Removed from `ThemePreferenceSchema`, the chat-settings defaults, the profile route's schema and the theme provider. A stored preference or backup carrying the key still parses; the key is dropped
- Theme hooks: `HOOK_CATALOGUE_VERSION` is now 2. `qt-collapsed-nav-button` and `qt-left-sidebar-item` lost the `data-nav` values that moved into flyouts; those items are `qt-left-sidebar-menu-item` rows with the same `data-nav` values. New hooks for the flyout heading, menu, row, row icon/text/label and disabled reason; `qt-left-sidebar-popout` gained `data-nav-menu` and a `qt-left-sidebar-popout-sheet` state. No bundled theme selects on `data-nav`. An installed theme that styles a single rail button by `data-nav` will now find that item in a flyout
- Help: `help/sidebar.md` (which described a sidebar that no longer existed) is replaced by `help/navigation.md`. Help docs now give rail directions as "open **Group** and choose **Item**", and `__tests__/unit/help/navigation-phrases.test.ts` holds each one to the registry. The help-chat prompt asks for the same phrasing. `help/theme-quick-switcher.md` describes Studio → Theme…

#### Research kit: Brahma and the builders research in fewer steps

- Reviews of Brahma Console and builder runs on Friday showed judgment questions taking up to 48 model calls and 344 seconds, two tools that failed on every call, and runs that kept searching after saying they had enough. Spec: `docs/developer/features/research-kit.md`
- Fixed `doc_grep` and `doc_list_files` on the operator surface. Both refused any context without a `projectId` or `mountPool`, so they failed every call from the Console. They now accept `operatorOverride`, and `getAccessibleMountPoints` takes it too. The blob read and write resolvers had the same guard and the same fix. Tests: `lib/doc-edit/__tests__/doc-tools.operator-surface.test.ts`
- New `lib/research/`: `ResearchScope` (`everything` on the operator surface, `pool` for the Scenario Builder, resolved only by `resolveResearchScope`), store arguments by name or owner shorthand (`character:Amy`, `project:…`, `group:…`, `general`) through `resolveOwnerStore`, and one scan per call (`DocMountFileLinksRepository.scanForResearch`)
- New tools, all `read`: `find_documents` (content and/or name across every store in scope, folded like `doc_grep`, one hit per file with "also in N other stores", up to 3 snippets, a URI, and the nearest names on a miss) and `list_documents` (stores in reach, or a store or folder outline; folders over 25 files and picture folders collapse to one line). On the operator surface only: `lookup_conversations`, `lookup_group`, `lookup_project`, `lookup_wardrobe`, `lookup_atlas`
- `buildTools` gains `researchKit: 'off' | 'documents' | 'full'`. With the kit on, `doc_grep` and `doc_list_files` are not offered. `'full'` also adds the lookup tools; `sqlAccess` now adds only `run_sql`. Text-block (non-native) tool prompts and the parser support the new tools. The executor returns kit results as plain text, not JSON
- Kit per surface: Brahma Console and `@Brahma` `full`; New Entry from Lore and Import from Instructions `full` when store search is on; Scenario Builder `documents`. Salon characters, Help chat and Calliope are unchanged
- Changed lookups: `lookup_character` adds groups, projects, wardrobe size and the vault outline, and takes `fields`; `lookup_memories` defaults to 8 hits, clips content to 300 characters unless `full`, and no longer returns importance or relevance; `lookup_messages` takes `conversation` and `group_by: 'conversation'` and reports `totalHits`; `read_messages` caps a line at 1,500 characters unless `full`. Lookup results are cut under a 6,000-character ceiling at a record boundary with a note saying what was left out
- Shared research instructions, `researchDiscipline(variant, kit)` (`lib/research/discipline.ts`): classify the request, a step budget per kind, the first tool per kind, when to stop, and how to treat a miss. Used by the Brahma prompt, New Entry from Lore, Import from Instructions and the Scenario Builder. Their own research lines ("Search more than once", "stop once you can design with confidence") were removed. A grep-test holds this (`lib/research/__tests__/surfaces.test.ts`)
- New agent kinds `inquiry` (Console, `@Brahma`) and `drafting` (the builders), with their own finishing and forced-final text
- Four loop guards for the research kinds (`ResearchLoopGuard`, `lib/services/console-engine/loop-guard.ts`), in both the console engine and `runOneShotToolLoop`. Each appends one user message and none ends the run: a checkpoint after the sixth model call and at 60% of the turn budget; declared sufficiency twice; the same tool missing twice on a near-identical target; the same tool failing twice with the same error. All but the checkpoint fire once per run. Logs record which fired
- `BRAHMA_ACCURACY_RULE` now separates facts from inference: never make up a fact, reasoning from facts is allowed, invent outright only on request. The Writing Assistant rule was aligned. `BRAHMA_SQL_PROMPT` was rewritten around the lookup tools and is shorter
- `run_sql`: a "no such column" error now lists the referenced tables' real columns, and "no such table" lists the database's tables and names the database the table is in, if another. The read-only mount-index connection gets a `qt_documents` TEMP VIEW (store, storeId, path, text, modifiedAt, fileId), made before `query_only` is set; nothing is stored. `getReadonlyQueryClient` takes a `prepare` hook for this
- Briefs: New Entry from Lore and the Scenario Builder get the results of a first search in the user message before the loop starts (`lib/research/brief.ts`). Lore: top 8 documents and top 8 conversations for the subject. Scenario Builder: top 8 documents in the pool for the location. A brief that finds nothing says so
- Help: `help/brahma-console.md` (the new shortcuts, "How the Console researches", a 20–25 turn budget for large instances), one line each in `help/atlas.md`, `help/scenario-builder.md` and `help/wardrobe.md`
- Tests: research loop guards, scope and document tools, `run_sql` hints and the view, the kit's tool slate, tool snapshots and picker entries
- Live evaluation on V4test (DeepSeek v4 flash, GLM-5.3 flash, Sonnet 4.6; results in the spec, §16): Console answers took 4–7 model calls and 6–29 s, and New Entry from Lore and the Scenario Builder 2–5 calls. Fixes from it:
  - Store addresses: models built URIs from the store shorthand (`qtap://character:Tester/…`), which `doc_read_file` cannot read. `lookup_character`, `lookup_group`, `lookup_project` and `list_documents` now print each store's real `qtap://` address (`storeAddress`, `lib/research/outline.ts`)
  - `lookup_messages` said every word must appear, but the index matches the query as a phrase, in order. A multi-word query with no phrase match now falls back to messages holding every word in any order (`matchedAs` in the result). The search bar is unchanged
  - `lookup_group` lists members before the store outline and says when the roster is complete
  - `runOneShotToolLoop` reported "reached my N-turn budget" for any empty final answer. It now says how many turns ran and names the output-token limit when the provider reports a cut-off

#### Web search: "configured" now means it has its API key

- `isWebSearchConfigured()` was true whenever a search provider plugin was registered, with or without an API key. Surfaces that gate on it offered `search_web`, and every call then failed with "No API key configured". It is now `isWebSearchConfigured(userId)` (async) and asks what `executeWebSearchTool` asks: a registered provider must have an active API key when it requires one; with no provider registered, the legacy `SERPER_API_KEY` env var decides. The env var no longer counts when a provider is registered, because the tool never used it in that case
- Affected: the Scenario Builder (real mode and its capabilities read), the wardrobe's Import from instructions, Auto-Configure's precondition, and `webSearchConfigured` in the tools list (`GET /api/v1/tools`). `isScenarioWebAvailable` is now async and takes the user id; `resolveWebCapabilities` is the one read the wardrobe wizard uses
- Tests: `__tests__/unit/web-search-configured.test.ts`

#### Wardrobe: Import from instructions

- New wizard in the Wardrobe dialog, **Import from instructions**, beside **Import from image**. The operator writes what they want; Aurora designs wardrobe pieces and an outfit for review. It works in all four tiers (character, group, project, Quilltap General) and files into the open folder. Nothing is created until **Import** is pressed
- The run is a one-shot tool loop in the parent, streamed over SSE (`runWardrobeInstructionDesign`, `lib/services/wardrobe-design/`). `POST /api/v1/wardrobe?action=design-from-instructions`; `GET ?action=design-defaults` returns the default profile and what of the web is reachable. No chat row, no messages; LLM log type `WARDROBE_INSTRUCTION_DESIGN`
- Internal evidence: a server-built brief in the user message (`lib/wardrobe/instruction-design/brief.ts`: the wearer's looks, pronouns, identity and description; dressing instructions; the target's own pieces, numbered; pieces reachable from other tiers; outfit titles in use). With **Search the stores and records** on, the operator surface read-only (`search` without memories, `doc_*` reads, `lookup_*`, `run_sql`)
- External evidence: with **Consult the wider web** on, `search_web` (profile allows it and a provider is configured) and `curl` (the plugin has URL patterns). Unreachable web warns and does not block. The prompt forbids story text in queries and tells the model to ignore instructions in web pages
- Every run has `effectCeiling: 'read'` on the slate and in the executor, so a `curl` POST is refused. No `wardrobe_*` or `inventory_*` tool is offered
- Aurora may name existing pieces of the target wardrobe for the outfit (`outfit.reuse`, by number) instead of designing duplicates; the outfit is created with them as components. She also returns a short note on what the design rests on. **Revise** re-runs from the design as edited
- Shared code extracted from Import from image, with no behavior change there: `parseWardrobeProposal` (`lib/wardrobe/proposal/`) reads a model's proposal, `ProposalReview` and `useProposalImport` (`components/wardrobe/proposal-review/`) are the review pane and the import. The parser now also accepts a JSON object with text around it
- `buildTools` gains `storeSearch: false`, which withholds the `search` tool for a surface that may use the web but not the stores
- `resolveScenarioBuilderCapabilities` moved to `resolveWebCapabilities` (`lib/tools/web-capabilities.ts`); the Scenario Builder re-exports it
- Help: `help/wardrobe.md` ("Import from Instructions"). API: `docs/developer/API.md`. Spec: `docs/developer/features/wardrobe-import-from-instructions.md`
- Run live on V4test with gpt-5: design, revise, import (with a reused piece), stop, and the disabled web box all pass. Web search and `curl` fetches are not verified live: V4test has a search plugin without an API key and no curl URL patterns. Results in the spec, §12.1

#### Plugin tools: an effect that depends on the call

- A plugin tool can now declare an effect that depends on its input. `ToolPlugin.getToolEffects` may return a `ToolCallEffect` (`{ max, of(input), notes? }`) in place of a plain effect (`@quilltap/plugin-types` 2.12.0). Before this, a plugin tool had one static effect, so an HTTP tool that can POST was a `write` for every call and could not be used at all under a `read` ceiling
- `toolEffectSpecFromDeclaration` (`lib/tools/effect-types.ts`) turns a declaration into the same computed effect built-in tools use. A throw, a non-object input or an answer that is not an effect counts as `write` for that call; an answer above `max` stands. A malformed declaration leaves the tool undeclared (`write`)
- `pluginToolEffects` now maps a tool name to a `ToolEffectSpec`. `effectOfToolCall`, `maxEffectOfTool` and the tool-list ceiling filter resolve built-in and plugin tools through one function, `toolEffectSpecFor`. A built-in name still wins over a plugin's declaration. Under a ceiling below `max`, a plugin tool with a note for that ceiling stays listed with the note appended; one without is dropped, as before
- Bids and the autonomous-room destructive gate use `max`, so nothing changes for a plugin that declares a plain effect
- `qtap-plugin-curl` 1.0.38 declares one: GET, HEAD and OPTIONS are `read`, every other method is `write` (`isReadOnlyCurlCall` in `curl-tool.ts`; invalid input counts as `write`). On a turn limited to lookups (a storyteller bid's read tier, a read-only console) curl stays listed with "Only GET, HEAD and OPTIONS requests are allowed this turn." and a POST, PUT, PATCH or DELETE is refused before it runs. Before this, curl was dropped from such turns entirely. The Writing Assistant can now fetch pages (`help/brahma-console.md` updated)
- Spec: `docs/developer/features/wardrobe-import-from-instructions.md` (the Import from instructions wizard, not yet built)

#### Roleplay characters: invention, flaws, preoccupation

- New fixed section, `STORY_CHARACTER_SECTION` (`lib/chat/context/story-character-section.ts`), sent to every roleplay character on every turn. It says three things: the character may supply plausible detail where nothing established contradicts it; the character is played as written, including fear, distrust and bad motives; and the character's own recent troubles can outweigh the conversation. What the user narrated, the conversation, memories and real tool results outrank invention, and the character's own system prompt outranks the section. Assistant-kind characters get nothing and their prompts are unchanged
- The section is chosen by a new `KindPolicy.storySection` field and placed by `buildSystemPrompt` after the Taboo section and before the standing instructions. It is outside the identity stack: `IDENTITY_STACK_BUILDER_VERSION` stays at 3. Every roleplay character's prompt cache misses once after upgrade
- Tool rule 6 (recalling past events) now differs by kind (`RECALL_RULE` in `lib/tools/native-tool-prompt.ts`, `SIMPLE_JSON_RECALL_RULE` in `simple-json-prompt.ts`). An assistant still says it does not recall. A roleplay character still searches first and reports a record as it is, but may fill a real gap, except for what the user said or did. Rules 1 to 5 are unchanged for both kinds. The roleplay preamble adds `STORY_LOOKUP_NOTE`: something done in the story that no listed tool performs is narration, not a missed tool call
- Carina: a roleplay answerer gets the same section and a new close to the Reference Query block (`lib/services/carina/reference-query.ts`) telling it to look first and then answer with particulars instead of saying it does not know. It is told to say nothing about the conversation it cannot see. `{{user}}` in the section resolves to the operator's persona in the chat, or "the operator". An assistant-kind answerer's prompt is byte-identical
- Brahma never invents: `BRAHMA_ACCURACY_RULE` is added to the console brief (reaching `@Brahma` too), and `BRAHMA_WRITING_ACCURACY_RULE` to the Writing Assistant brief. A test keeps console code from importing the story section
- Generators: `generatorDirectionFor('roleplay')` now also carries `STORY_LATITUDE_DIRECTION` (flaws written as working parts, detail at first hand, a life that presses on the character, and the trust line toward the user). The Optimizer's roleplay drift signal adds `SANITIZING_DRIFT_SIGNAL`: a character written with a flaw whose memories show them uniformly agreeable, measured only against the character's own definition
- `MODERN_ROLEPLAY` sample prompt: new "Filling in the world" section, two bullets in "A person, not a service", two failure modes ("The saint", "The blank") and two examples. `qtap-plugin-default-system-prompts` 1.1.36
- Memory: a new stated-particulars category in the SELF extractor (`STATED_PARTICULARS_STORY_BLOCK`, `STATED_PARTICULARS_CARINA_BLOCK` in `lib/memory/extraction/prompts/self.ts`). A roleplay character played by an LLM gets a memory of what they told others as fact ("I told Sam that…"), and every Carina answer is recorded as "asked X, I answered Y". The memory is the telling, not the fact. Before this, an invented Carina answer was not remembered: in the V4test evaluation one archivist gave a different lighthouse year in each later chat (0 of 4 consistent; 2 of 2 after the change). The block is appended after the cached prompt body. The model marks the item `"stated": true` and `parseSelfDrafts` keeps at most one in its own slot beside the cap (`STATED_PARTICULARS_EXTRA_SLOT`). Assistant characters' ordinary turns and human-played seats are not asked (`statedParticularsFor`)
- Memory: a retold account is not recorded twice. A stated-particulars memory is stored with the reserved keyword `stated particulars`. The next SELF call reads the holder's recent ones (`ExtractionContext.priorTellings`, `MemoriesRepository.findRecentWithKeyword`), shows those that share words with the exchange in an `ALREADY TOLD` footer (`selectPriorTellings`), and tells the extractor to skip a repeat and to record a changed account as a replacement. Before this, telling the same account twice left two near-identical rows; in the V4test rerun four characters each held one
- Live evaluation run on V4test (DeepSeek V4 Flash, GLM 5.3 Flash, Claude Sonnet 4.6, GPT-5; no Google profile). Results are in the spec, §13. No provider refused any turn. One thing to watch: a DeepSeek reply invented the operator persona's actions while filling in a shared memory
- Design: `docs/developer/features/roleplay-character-latitude.md`

#### Summon From Lore: truncated steps, physical prompt limits, lost memories

- Every Summon From Lore call now adds reasoning headroom to its token budget (`withReasoningHeadroom`) and fails on a truncated finish reason (`isTruncatedFinishReason`) instead of letting `parseLLMJson` close the brackets on a partial answer. On a GLM-5.2 run the system prompts, physical descriptions, memories and both repair calls all stopped at their caps: the default system prompt ended mid-sentence, `fullDescription` was missing, and memory 13 had no `summary`. Answer budgets raised (system prompts 4000, physical descriptions 3500, memories 5000, chats 5000); the repair budget scales with the size of the sections it echoes
- New `normalizeGeneratedMemories` fills a missing summary from the content's first sentence, unwraps `{ memories: [...] }`, coerces keywords and importance, and drops only empty entries, so one malformed memory no longer sends the whole array to the LLM repair
- The validation repair may no longer replace an array section with a shorter one. Before, the repair (itself truncated) replaced 13 memories with 3
- New `lib/characters/physical-description-limits.ts` (`PHYSICAL_PROMPT_LIMITS`, `fitToCharacterLimit`, `fitPhysicalPrompt`): overlong physical prompts are trimmed at the last sentence, clause or word boundary instead of a hard `substring`. Used by Summon From Lore and the AI Wizard; `PhysicalDescriptionSchema` reads its caps from the same constants
- The physical description prompt now asks for about four-fifths of each cap and insists on `fullDescription`; a missing one is logged
- `help/ai-character-import.md` describes truncated steps and prompt trimming

#### Dynamic backgrounds

- New Appearance setting `chatSettings.dynamicBackgrounds` (`enabled`, `allowUncensored`, `refreshMinutes` 1–120, default 3) with migration `add-dynamic-backgrounds-settings-field-v1`. Settings card `dynamic-backgrounds` in the Appearance group
- When on, the workspace home tab, project pages and character pages show a server-composed WebP collage instead of their usual background, redrawn every `refreshMinutes`. Pools: every story background (home), the project's story backgrounds including those of chats moved into it (project), the character's avatar rolls (character). Fewer than 3 distinct pictures → no collage. On a project page the collage overrides `backgroundDisplayMode`
- New module `lib/dynamic-backgrounds/` (settings, pools, eligibility, layout, compose, seed). Rows layout for home/project, columns for characters; tiles cover the 1920×1080 / 1080×1920 canvas exactly with no gaps and no picture next to itself
- Uncensored filter (`filterForCollage`): out if the bytes carry an uncensored `generationModeration`; in if `moderated`; for `null` rows, out if a linked chat is Unmoderated or has `isDangerousChat` (the one sanctioned read, held by a grep-test)
- New route `GET /api/v1/system/dynamic-backgrounds` (status JSON with a fresh seeded image URL; `?action=image` serves the WebP through `serveStoredBytes`, 404 when off or below the floor). Strict query schema; the uncensored rule is never a query parameter. Added to the CSP-exempt pattern in `next.config.js`. Last 8 collages cached in process
- A collage now takes precedence over a theme's page background (`--qt-page-background-image`) on the home tab too: `HomeView` takes a `backgroundUrl` and marks its root with `--story-background-url`, as project and character pages already did
- Fix: the page-background rule in `app/styles/qt-components/_base.css` ignores a `--story-background-url` inside a hidden workspace tab (`.qt-tab-pane[aria-hidden="true"]`). Before, any kept-alive tab with a story or subsystem background hid the theme's page background on every other tab
- Fix: Madman's Box (2.0.1) drew its home photograph as a fixed 50%-opacity `.qt-homepage-container::before` in its own `styles.css`, which ignored the marker and showed through over the collage. `HomeView` now adds a catalogued state class, `qt-homepage-backdrop` (hook catalogue, `lib/themes/hooks/home.ts`), while a collage shows, and the theme's layer applies only without it. Theme CSS may not match inline styles, so the marker alone could not be used
- New hook `useDynamicBackground` (`hooks/`): only the visible workspace tab rotates; a new collage is preloaded before it replaces the old one
- `isStoryBackgroundFile` / `isAvatarFile` moved to `lib/photos/generated-image-kind.ts`; `findRollsForCharacter` exported; new `FilesRepository.findGeneratedImages()`
- Almanack feature config and `help_settings` (`appearance`) report the setting
- New help page `help/dynamic-backgrounds.md`; cross-links from appearance, story backgrounds, the Concierge, project settings and character gallery pages
- CLAUDE.md names the one sanctioned read of `isDangerousChat` for a display decision (the collage filter's guess for pictures with no `generationModeration`)

#### Uncensored badge in every gallery

- New `UncensoredBadge` (`components/images/UncensoredBadge.tsx`, class `qt-uncensored-badge`, overridable via `--qt-uncensored-badge-bg` / `-fg`) shown on tiles whose picture an uncensored profile drew, with a tooltip per `generationModeration` value
- Shown in the chat gallery (chat and album modes of `PhotoGalleryModal`, plus `ChatGalleryImageViewModal`), Aurora's album, Avatar Rolls and Wardrobe Pictures (shared `GalleryImage` tile and `ImageDetailModal`), `/photos` (card and detail), and `ImageGallery`
- Server side: `findUncensoredImages` / `withGenerationModeration` (`lib/photos/uncensored-images.ts`) look the answer up by sha256 through the new `FilesRepository.findUncensoredBySha256s`, so a kept album photo (a vault link with no `files` row) gets the badge of the picture it was kept from. Applied in `listChatGallery`, `listCharacterGallery`, `listUserGallery` / `getUserGalleryEntry`, `listAvatarRolls`, `listWardrobeGalleryImages` and `GET /api/v1/images`; each entry now carries `generationModeration`
- `UNCENSORED_GENERATION_MODERATIONS` added to `lib/schemas/file.types.ts`
- `help/the-concierge.md` documents the badge; `help/chat-gallery.md`, `help/character-gallery.md` and `help/photo-gallery.md` mention it

#### Generated images record whether they were made uncensored

- New `files.generationModeration` column (migration `add-file-generation-moderation-column-v1`): `moderated`, `uncensored-profile` (the chosen profile is itself uncensored: `isDangerousCompatible` or the Concierge's image desk), `uncensored-routed` (the Concierge sent the call to an uncensored profile before it ran: Unmoderated chat, pre-screen verdict, retry uncensored) or `uncensored-failover` (an ordinary profile refused and the understudy drew it)
- Derived only by `generationModerationOf` (`image-failover.ts`); `generateImageWithConciergeFailover` now returns it as `moderation` on every outcome. `isUncensoredImageProfile` accepts any `{ id, isDangerousCompatible? }`
- Recorded on character avatars (job and wardrobe preview), story backgrounds, `generate_image` / the image-profile Generate page, and the legacy `/api/v1/images` dialog. Wardrobe, Inventory, Atlas and uploaded/imported files leave it null. Existing rows are not backfilled
- `isUncensoredGeneration(value)` (`lib/schemas/file.types.ts`) is the yes/no reading
- Rides in `.qtap` exports and backups with the rest of the file row; added to `qtap-export.schema.json` and DDL.md
- No UI yet

#### Avatar refreshes wait for the next turn

- Automatic avatar refreshes (wardrobe changes, Inventory changes, seat arrivals) are no longer started at once. `triggerAvatarGenerationIfEnabled` now enqueues the `CHARACTER_AVATAR_GENERATION` job held: payload `awaitingTurn: true`, `scheduledAt` at the sentinel `HELD_UNTIL_NEXT_TURN` (`lib/schemas/job.types.ts`). Later changes for the same character collapse into the held job, so several changes between turns cost one avatar per character
- `releaseHeldAvatarRefreshes(chatId)` (`queue-service.ts`) sets every held job's `scheduledAt` to now and wakes the processor. Called at the start of every `processMessage` turn (operator send, continue, chained turns, storyteller turns, the opening; not storyteller bids) and of a swipe regeneration. The released jobs run concurrently under the normal job cap and post as they finish
- The dedup key separates held and immediate jobs (`characterId:held` / `characterId:now`), so the manual Regenerate Avatar button is never absorbed into a held job. Turning avatar generation on still enqueues immediately
- The handler skips a held job if the chat had avatar generation turned off (or is autonomous) by the time it runs
- Held jobs are excluded from the activity counts (`getActiveCountsByKind` / `getActiveCountsByType`) and show "Waiting for the next turn" in the Tasks queue. Deleting a chat cancels its held jobs (`cancelHeldAvatarRefreshes`, from the chat DELETE handler and cascade delete)
- `help/chat-settings-ai-services.md`, `help/chat-participants.md`

#### Atlas as a lorebook in the Commonplace Book whisper

- Atlas knowledge is now delivered as a `lore` part of the Commonplace Book whisper (`CommonplaceParts.lore`, rendered ahead of `knowledge`) instead of the trailing `## What is being spoken of` section. `TrailingSections.atlas` and `buildAtlasSection` are removed; the operator now sees the lore in the whisper
- Two triggers. **Named**: unchanged matcher and window (`buildNamedAtlasLore`), built every turn including when memory recall is skipped. **Recalled**: the knowledge injector searches each tier's `Atlas/` with the turn's existing embedding and resolves hits against the character's pool (`AtlasRecallSource`), so shadowed, archived and already-named entries are never recalled. Per-tier candidate limit is the Knowledge one; the minimum score is `ATLAS_RECALL_MIN_SCORE = 0.4` (Knowledge stays at 0.3)
- One budget: named entries take from `knowledgeBudget` first (max 8; an entry that does not fit is cut at a word and marked ` …`, or left out when under 120 tokens remain), then recalled lore and Knowledge are packed together by score. A recalled entry is given whole when it is at most 500 tokens, otherwise as the matched passage (frontmatter stripped); there is no pointer form. Named Atlas text was previously unbudgeted
- `tokenUsage.knowledge` now includes lore tokens; recalled entries appear in `debugKnowledge`
- Fix: a write through the Atlas (`lib/atlas/vault-writes.ts`: create, update, delete, re-projection) re-created the folder's chunks without vectors and never queued them, so entries stayed unembedded until something else scanned the store. Each write now calls `enqueueEmbeddingJobsForMountPoint` for the mount (best-effort, not awaited)
- Debug logging in the knowledge injector for candidates gathered and packed
- A turn that names an Atlas entry now posts a Commonplace whisper even when it has no other recall
- `help/atlas.md`, `help/salon-host-introductions.md`; spec §11 in `features/complete/atlas.md`

#### Atlas: New Entry from Lore

- New **New Entry from Lore…** button in the Atlas browser opens `AtlasLoreWizard`: give a subject, optional details, a "search the document stores and records" toggle and a model, and Brahma drafts the entry's name, aliases, graphic prompt and knowledge. Revise box for follow-up instructions. "Open in the editor" prefills the existing create editor (`initialDraft`); nothing is saved until the operator saves there. No picture is drafted
- `POST /api/v1/atlas?action=draft-from-lore` (SSE) and `GET /api/v1/atlas?action=lore-defaults`. Runs a one-shot tool loop in the parent: operator surface with read-only docs, lookup tools and `run_sql`, effect ceiling `read`; with searching off, no tools. Output is frontmatter + body, parsed by `parseAtlasLoreDraft` with a whole-answer fallback. New LLM log type `ATLAS_LORE_DRAFT`
- Model defaults to Brahma's profile: new `resolveBrahmaConnectionProfileForProject` (project override, global inline profile, default); `resolveInlineBrahmaConnectionProfile` now delegates to it
- The Scenario Builder's SSE client is now a wrapper over a shared `useAgentStreamRun` hook (`components/agent-stream/`), also used by the wizard
- `help/atlas.md` documents it

#### Markdown editor toolbar stays in view

- `MarkdownLexicalEditor`'s formatting toolbar is now sticky (`qt-doc-toolbar-sticky`): on text longer than the scrolling surface it pins to the top of that surface instead of scrolling away. The editor frame uses `overflow-clip` instead of `overflow-hidden` so it does not become the scroll container. Opaque background plus an upward shadow covers the scroller's top padding strip
- `help/character-editing.md` mentions it

#### New default `thinking` icon

- `public/images/icons/thinking.svg` redrawn: a feathered quill with its nib, in the same 24×24 stroke style. Themes that override `thinking` are unaffected

#### Fix: Calliope's composer hidden under the footer; theme guide corrections

- Calliope's panel and the Atelier's and gallery's section lists were sized from the viewport (`100vh`), but the Atelier scrolls inside the workspace pane between the header and the footer, so their bottom ~3rem always sat under the footer at any window height. The two scroll containers wear a new `qt-scroll-container` utility (`container-type: size`) and the panels use `100cqh`
- `help/making-a-theme.md` step 2 and `help/theme-editor.md`: Primitives is a folded card below the token sections, not an entry in the section list; say where to find it

#### Docs: theme author's guide

- New help page `help/making-a-theme.md`: a start-to-finish walk through making a theme in the Atelier (palette, colours, contrast, fonts, images, the gallery and inspector, custom CSS, Calliope, install, export, the CLI path), linking to `help/theme-editor.md` for detail
- `help/theme-editor.md`, `help/themes.md` and `help/appearance-settings.md` link to it; ROADMAP item closed

#### Fix: Responses-API output-token cut-offs read as truncation (#228)

- `isTruncatedFinishReason` now matches `max_output_tokens`, the reason OpenAI and Grok (Responses API) report in `incomplete_details.reason`. The Salon tool loop's truncation guard, the AI Wizard's truncated-field check and the image-description fallback's reasoning-model message now see these cut-offs
- OpenAI (1.0.74) and Grok (1.0.63) plugins: `getFinishReason` checks `status === 'incomplete'` before `function_call`, so a tool call cut off mid-arguments reports `max_output_tokens` instead of `tool_calls` and is rejected and re-prompted rather than run with half-parsed arguments
- `lib/chat/file-attachment-fallback.ts` uses the shared predicate instead of comparing to `'length'`
- Tests for the predicate, both plugins' raw responses and the tool loop's truncation branch

#### Docs: Calliope Live closed (Spec K)

- `CLAUDE.md`: the `packages/` publish exception names only `packages/quilltap`; design docs are the specimen gallery; the Themes rules drop the generated Storybook CSS and point a qt-* change at `npm run generate:theme-styled-by`
- `.claude/commands/`: removed the two packages' doc rows and the Storybook spec rows; checklists refer to the styled-by table and the specimen gallery
- `calliope-live.md` and Spec K moved to `features/complete/`, with links fixed. The proposal's status, Storybook section, Phase 3 and open questions are updated; each question names the spec that answered it
- ROADMAP: Calliope Live and the package retirement marked done; the theme author's guide (necessary) and layout variants added as open
- Retirement notes on the two Storybook CSS refactor docs; a dated note in `DEAD-CODE-REPORT.md`

#### Calliope and theme docs: no packages, and screenshots (Calliope Live, Spec K)

- Calliope's prompt adds a paragraph on what she can see: not the app, only the draft. When the draft does not show what the author means, she asks for a screenshot if her model reads images (`profileCanReceiveAttachment`), and for a description if it does not. New `calliopeSightBrief`; snapshot updated
- `help/theme-editor.md`: she cannot see the app, so attach a screenshot of what looks wrong
- `help/themes.md`, `THEME_DEVELOPMENT.md`, `DEVELOPMENT.md` and `README.md` point to the Atelier and `quilltap themes create` instead of `create-quilltap-theme`, and to the Atelier's Icons section instead of the Storybook story. `THEME_DEVELOPMENT.md` now says where the styled-by table's compiled CSS comes from

#### Themes: `create-quilltap-theme` retired; `quilltap themes create` writes the bundle (Calliope Live, Spec K)

- New `lib/themes/blank-bundle.ts`: `blankThemeBundle` (a blank theme's `theme.json` and `tokens.json`) and `themeIdFromName`. The Atelier's `createDraft` and the CLI both use it; `draftIdFromName` is now an alias
- A blank draft's `theme.json` and `tokens.json` now carry `$schema`
- `quilltap themes create <name>` writes the blank bundle to `./<id>/` and prints next steps. It refuses an existing directory. The `npx create-quilltap-theme` delegation and its Windows argument check are gone, and the command no longer needs npm
- Removed `packages/create-quilltap-theme/`; its test is replaced by `__tests__/unit/packages/quilltap-themes-create.test.ts`
- `docker-test-plan.md` row 8.3 restated for the new command

#### Themes: `@quilltap/theme-storybook` retired (Calliope Live, Spec K)

- Removed `packages/theme-storybook/` and its `publish-theme-storybook` release job. The specimen gallery and the theme editor replace it
- The qt-* component layer is no longer compiled to a tracked file: `scripts/lib/qt-components-css.mjs` compiles it in memory for the styled-by table. Removed `generate:storybook-css`, `scripts/generate-storybook-css.mjs` and the `check-storybook-css` lint gate; `check-theme-references` now does the compile
- `styled-by.generated.json` records its first source as `app/styles/qt-components`; every hook row is unchanged
- Comments, the `check-qt-classes` message, the About page and `.dockerignore` no longer mention the package or Storybook

#### Calliope: an assistant in the theme editor (Calliope Live, Spec J)

- New chat type `calliope`: a conversation with Calliope about one theme draft, named by the new nullable column `chats.themeDraftId` (migration `add-calliope-theme-draft-field-v1`; DDL, export schema and both chat Zod schemas updated). Help-like: no memories, no Concierge, no auto-title fold, and kept out of global search (`isListedInGlobalSearch`). Deleting a draft deletes its conversations
- Console engine: the Brahma Console's turn loop is now `runConsoleTurn` (`lib/services/console-engine/`), run with a `ConsolePersona`; Brahma and Calliope are its two personas. Console attachments for both live in `lib/console-engine/attachments.ts` (`Brahma/` and `Calliope/` in Quilltap General). No change to Brahma's behavior except the salvage notice below
- Her tools: `theme_read_draft`, `theme_lookup_tokens`, `theme_lookup_hooks`, `theme_check_contrast` (`read`) and `theme_propose` (`none`), run under `effectCeiling: 'read'` with a slate of exactly those (`onlyTools` on `buildToolsForProvider`). They answer only in a `calliope` conversation, against its own draft
- Proposals: a change set of ordered operations (`set-token`, `reset-token`, `add-primitive`, `set-primitive`, `rename-primitive`, `remove-primitive`, `set-choice`, `replace-css`, `set-css`), applied only by `applyChangeSet` and judged only by `assessProposal` (`lib/themes/assist/`): validated and compiled as an install would be, then compared with the draft for new errors and warnings, contrast broken or mended, and issues cleared. A refused proposal goes back to her and is never shown. She never writes the draft
- New hook reference table `lib/themes/assist/styled-by.generated.json` (what the app's rules set on each catalogued hook), generated by `npm run generate:theme-styled-by` and checked by `npm run lint`
- API `/api/v1/calliope`: list by draft, open, upload / discard-upload, rename, `set-model`, `keep` (re-judges and returns the operations; records the decision), `discard`, `try` (the result's tokens and engine-scoped custom CSS, records nothing), delete, and messages (SSE send; load with proposals judged against the draft as it now is, stale derived). Settings at `/api/v1/settings/calliope` (engine and turn budget, default 25) and a new Calliope card in Settings → Appearance
- Theme editor: a Calliope button opens her panel (beside the sections in a wide pane, in their place in a narrow one; loaded lazily). Proposal cards with Try (the preview wears the result; the draft is untouched), Keep (applied through the editor's own edit path: tokens as one undo step, CSS through the stylesheet's save) and Discard; a stale card offers to ask her again. "Ask Calliope" hand-offs from the inspector, from each validation error and warning, and from each failing contrast line start a message in her composer; nothing is sent automatically
- Shared pieces made reusable: `useBrahmaConsoleStreaming` and `useConsoleAttachments` take an `apiBase`, `ModelPicker` an `icon`, `HelpChatComposer` a `seed`
- Console salvage notice: `salvageMessage` takes a `cause`. When a model returns an empty answer before the turn budget is spent (typically a reply cut off at its output token limit), Brahma and Calliope now say so and suggest raising the profile's max tokens, instead of claiming the turn budget ran out
- `help/theme-editor.md`: Calliope, her proposals, hand-offs and settings; `help/appearance-settings.md`: the Calliope card. Avatar `public/images/avatars/calliope-avatar.webp`

#### Docs: Calliope Live Spec K

- Added Spec K (Phase 3: retire `@quilltap/theme-storybook` and `create-quilltap-theme`, close the Calliope Live proposal; the theme author's guide is noted as necessary and left for later); ready to run
- Spec K Stage 0: inventory of both packages (stories against the specimen gallery, the icon list, every reference, root dependencies) recorded in the spec

#### Docs: Calliope Live Spec J

- Added Spec J (Calliope as an assistant in the theme editor: a Brahma-like console with her own chat type, read-only theme tools and engine-checked proposals the author tries, keeps or discards)

#### Docs: Calliope Live Spec I complete

- Spec I (loose ends) marked implemented, with implementation notes for all five stages, and moved with its catalogue triage to `docs/developer/features/complete/`; linked from `calliope-live.md`. The help pages took their brace-indentation text in Stage 1; `THEME_DEVELOPMENT.md` does not describe the probe and was not changed

#### Theme hooks: 45 added (Calliope Live, Spec I Stage 4.2)

- The hook catalogue grows from 174 to 219 hooks, still version 1 (adding a hook does not change the version). Salon: the chat layout, message list, message text, the four roleplay spans (`qt-chat-dialogue`, `-narration`, `-ooc`, `-inner-monologue`), composer actions, Stop button, attachment chip and picture, reasoning block, participant sidebar, Courier card, green room, Storyteller board and card, formatting toolbar and button, mention menu and option, mention chip, and Document Mode's pane and header. App shell: the footer. Dialogs: the floating dialog and slide-over panel. Shared: the empty state and its icon, description and action, loading state, tooltip, popover, entity card, field label, link, checkbox, radio, slider, rendered Markdown, code block, inline code, and progress bar and fill
- New class states: `qt-chat-sidebar-collapsed`, `qt-green-room-docked`, `qt-storyteller-card-selected` / `-quiet` / `-dragging`, `qt-formatting-button-active`, `qt-typeahead-option-active`, `qt-mention-chip-thing`, `qt-progress-fill-success` / `-danger` / `-idle`
- Each has a specimen in Calliope's gallery (the real `EmptyState` for the empty-state family, markup for the rest). `docs/developer/THEME_HOOKS.md` regenerated. The theme probe measures 471 gallery instances per theme and mode (was 415); the existing 415 are unchanged
- The bundled themes were already clean against the catalogue, so no excepted selector changes

#### Docs: Calliope Live Spec I Stage 4.1 catalogue triage

- Added `docs/developer/features/complete/calliope-live-spec-i-catalogue-triage.md`: the 712 `qt-*` classes in app markup that are not theme hooks, sorted into proposed candidates (45), candidates worth considering, inner parts, modifiers, helpers and plumbing. Awaiting approval before Stage 4.2 adds any to the catalogue

#### UI: `qt-*` classes that resolved to nothing

- 13 `qt-*` classes were used in markup but defined by no CSS, so they had no effect. `qt-input-sm` (20 uses in the Atlas, Inventory, Wardrobe and document browsers) is now defined beside `qt-select-sm`. The rest now use classes that exist: `qt-button-danger` → `qt-button-destructive` (State editor, memory regenerate card), `qt-button-danger-outline` → `qt-button-secondary qt-text-destructive`, `qt-alert-destructive` → `qt-alert-error`, `qt-callout` → `qt-alert-info`, `qt-card-content` → `qt-card-body`, `qt-card-selected` → `qt-option-selected`, `qt-form-label` → `qt-label`, `qt-badge-muted` → `qt-badge-secondary`, `qt-accent-primary` → `qt-checkbox`, `qt-code` → `qt-code-inline` (startup gates, theme selector, optimizer), `qt-divider` → `qt-border-default`; `qt-list-row` dropped
- `scripts/check-qt-classes.mjs` now also fails on a bare `qt-*` class in `app/` / `components/` markup that is not defined in app CSS (`::highlight()` names count), not a catalogued theme hook or state, and not in its `MARKERS` list (31 anchors, each with a reason). A stale marker fails too. It reads the hook catalogue, so `npm run lint` runs it with `tsx`
- `@quilltap/theme-storybook` 1.0.124 (regenerated CSS)

#### Theme probe: measures the specimen gallery (Calliope Live, Spec I Stage 3)

- `scripts/theme-probe/run.ts` now probes Calliope's specimen gallery for how every hook looks, plus three live pages for layout: home, one Salon chat and the theme preview dialog. The character, Settings, Appearance and second Salon pages are gone, and so is `--character`; `--chat` takes one id
- `probe.js` has a gallery mode that reads each instance at `[data-specimen-for] [data-specimen-instance] [data-specimen-stage]` instead of taking the first visible match, after making every `content-visibility: auto` article visible. Instances it cannot find are listed in `missing`. Gallery mode also holds every running animation at its start (`document.getAnimations()`), so an animated property such as the turn dot's opacity reads the same on every run
- `compare` reports a gallery instance missing on either side as an error
- The gallery's instance items carry `data-specimen-instance="<key>"`; the coverage test now checks each instance on its own stage

#### Tests: longer timeouts for CI

- CI's Test job kept failing on timeouts in slow jsdom suites (the theme editor's custom CSS tests): Jest's 5 s per-test default in one run, Testing Library's 1 s `findBy` / `waitFor` default in others. The suite runs ~1,500 files under v8 coverage there and render-heavy suites take several times longer than locally
- `jest.config.ts`: `testTimeout: 30000` (matches the integration config)
- `jest.setup.ts`: Testing Library `asyncUtilTimeout` raised to 10 s
- Removed per-call and per-test timeouts that were now below those defaults and would have shortened them (theme editor, custom tool intervention dialog, connection profiles tab, backup parser, plugin initialization, DB encryption state)

#### Theme editor: layout by pane width (Calliope Live, Spec I Stage 2)

- The theme editor's section navigation and the specimen gallery's surface navigation now switch on a container query (`@2xl`, 42rem) instead of the viewport `md` breakpoint. Below that width the list is replaced by a select (`components/ui/SectionJump.tsx`) above the body that reaches every section
- The editor's field grids (token light/dark blocks, primitives, fonts, corner radii, shadow and transition fields) use container queries too; no viewport breakpoint remains in `components/theme-editor/`
- `help/theme-editor.md`: the narrow-pane menus

#### Code editor: brace indentation (Calliope Live, Spec I Stage 1)

- Enter after `{` or `[` adds one indent unit (the file's detected one). Enter between a brace pair puts the caret on an indented line and the closing brace on its own line below. `}` or `]` typed on a line holding only indentation removes one unit, unless the line is already no deeper than its opening brace's line. Applies to JSON and CSS, in the theme editor and Document Mode. Nothing is reformatted and no brace is inserted
- Braces in strings and comments do not count; this is read from the editor's highlight tokens (`$tokenTypeLookup`). The rules are pure functions, `planEnter` and `planCloseBracket` in `components/code-editor/text.ts`
- Prism's CSS selector pattern may no longer start at a quote, so `content: "{";` is highlighted as a string instead of a selector and a brace. A brace after a space inside a CSS string (`"a {"`) is still misread
- The closing-brace step-out needs a key press; text inserted without one (on-screen keyboard, input method, paste) is left as typed
- `help/theme-editor.md`, `help/scriptorium.md`: brace indentation

#### Docs: Calliope Live Spec I

- Added Spec I (loose ends from Specs E to H: brace indentation in the code editor, theme editor layout by pane width, the theme probe measuring the specimen gallery, and adding uncatalogued `qt-*` classes to the hook catalogue)

#### Dependencies: OpenRouter SDK floor raised

- `npm update` across root, packages and plugins. `@openrouter/sdk` is now `^1.5.105` in the root and the OpenRouter plugin (plugin 1.0.75), so a build no longer flips the bundled SDK between 1.5.103 and 1.5.105 depending on the machine; `@testing-library/user-event` to `^14.6.12`
- Plugin lockfiles are not tracked (`plugins/**/package-lock.json` is ignored), so the version range in each plugin's `package.json` is what keeps machines in step

#### Docs: Calliope Live Spec H complete (Stage 3)

- `THEME_DEVELOPMENT.md`: adding a hook needs a specimen and the coverage test that checks it; the specimen gallery and inspect mode under the Atelier
- `CLAUDE.md` Themes: new hooks need specimens; the inspector reads stylesheets only on selection
- Spec H moved to `features/complete/` with implementation notes (gallery vs. Storybook, theme probe on the gallery, a hook → token table for LLM assistance)

#### Themes: inspect mode (Calliope Live, Spec H Stage 2)

- "Inspect" toggle in the theme editor header and gallery toolbar. While on, pointing outlines the nearest hooked element; a click selects it and does not reach the app; Escape turns it off. Listeners are window capture listeners, removed when off
- Inspector panel: hook, variants and states, tokens grouped by property with computed value, swatch, follow chain and source, hover/focus/press groups, matching custom CSS rules. "Row" opens the token's row; "Write CSS for this" inserts an empty rule into Custom CSS (starting a stylesheet if needed); "Show in the gallery" reveals the specimen. Docks away from the editor
- Editor and gallery register bridges with the inspect provider; the editor's tab is brought forward before a jump. The gallery opens beside the calling tab's pane
- "Inspect this" / "Show on this page" on every specimen; "Inspect this" on every hook in the Custom CSS reference
- `data-inspect-ignore` / `data-inspect-target` / `data-inspect-editor` mark what may be inspected
- `scripts/check-modal-shell.mjs`: allowlisted the specimen dialog drawing
- `help/theme-editor.md`: inspecting

#### Themes: specimen gallery and the inspector's model (Calliope Live, Spec H Stages 0–1)

- New workspace tab "Calliope's Specimens" (`theme-specimens`, route `/calliope/specimens`). It draws all 174 catalogued hooks in every variant value and class/ARIA state, wearing the previewed draft or the worn theme. Modes: as the window, light, dark, or both side by side. Search by label or class; jump by surface
- "Open the gallery" in the theme editor's header and on the draft list opens the tab in the other pane
- Specimens live in `components/theme-specimens/`. Three are real components (`CollapsibleCard`, `EmptyState`, `QuillAnimation`); the rest are markup. A coverage test fails when a catalogued hook has no specimen or a variant/state is missing
- Inspector model (`components/theme-inspect/`): element to nearest hook, matching rules to custom properties in cascade order (hover/focus/active kept apart, theme custom CSS marked), property to registry token. The stylesheet walk runs on selection only (9–33 ms on a Salon page)
- Theme editor: stable token row ids and `goToToken(name)` (exposed through an optional `navigatorRef`)
- Fix: the page theme leaked into nested `data-theme` containers. Optional tokens are now reset to `initial` on nested containers at zero specificity, and `font-family`, `font-weight` and `color-scheme` are re-established there. The editor panel and gallery chrome now stay in the house default; Settings theme previews now show their own body font
- `THEME_HOOKS.md` and the CLI theme engine regenerated for the new tab kind; `@quilltap/theme-storybook` 1.0.123
- `help/theme-editor.md`: the specimen gallery

#### Docs: Calliope Live Spec H

- Added Spec H (a specimen gallery showing every catalogued hook in the draft theme, and an inspect mode that names an element's hook and the tokens that style it)

#### Docs: Calliope Live Spec G complete (Stage 4)

- `docs/developer/API.md`: `?action=import` on `/api/v1/theme-drafts`, the stylesheet `PUT` body, `set-styles-file` / `clear-styles-file`, located issues and `styles` in the draft detail
- `THEME_DEVELOPMENT.md`: writing custom CSS in the editor, importing a `.qtap-theme`, and why a draft's `styles.css` is view-only in Document Mode
- `CLAUDE.md`: `components/code-editor/` as the one highlighted source editor and its fidelity rule; the stylesheet's save pattern; import as a draft source
- `help/theme-editor.md`: draft JSON files are highlighted in Document Mode; the stylesheet is edited in the Custom CSS section
- Spec G marked implemented with implementation notes (including notes for Spec H) and moved to `features/complete/`; the proposal's text-editing decision notes the one package it needed

#### Document Mode: code editor for JSON and CSS (Calliope Live, Spec G Stage 3)

- Document Mode opens `.json` and `.css` files in the shared code editor (highlighting, line numbers, exact bytes). Other non-Markdown files, and JSON or CSS files over 100,000 characters, keep the textarea. The Markdown branch is unchanged
- The editor is chosen once per load (`app/salon/[id]/components/document-editor-kind.ts`). Edits reach `onContentChange` after 150 ms and are flushed on blur and close. The "AI editing" lock makes it read-only, outside changes replace the text without an echo write, `doc_focus` scrolls to the line, and the scroll position is saved
- The status bar says "JSON" or "CSS" instead of "Plain text"
- Code editor handle: `revealLine(line, { focus: false })` scrolls without taking focus; new `scrollElement()`
- CSS in a database store (such as a theme draft's `styles.css` in Quilltap General) is still view-only; database stores edit only Markdown, text, JSON and JSONL
- `help/scriptorium.md` describes the code editor
- Tests: `document-pane-code-editor.test.tsx`

#### Themes: custom CSS section and opening a theme file in the theme editor (Calliope Live, Spec G Stage 2)

- New Custom CSS section in the theme editor (`components/theme-editor/assets/StylesSection.tsx`): creates the stylesheet (`set-styles-file`), edits it in the shared code editor, and removes it behind an alertdialog (`clear-styles-file`, deleting the file by default). The rules are stated above the editor
- CSS saves go through the editor's save queue as `PUT { stylesRevision, css }`. A stale revision reloads the draft and shows "Changed elsewhere". Pending CSS is flushed before any draft operation, install, pausing the preview, going back to the list, closing the section and closing the tab (keepalive)
- Issues with the stylesheet's `file` and `line` become editor markers and a list with jump-to-line buttons. While the draft has errors, the preview keeps the last good server compile (font faces, icons and custom CSS) instead of dropping it
- Reference panel (`StylesReference.tsx`, pure helpers in `styles-model.ts`): the hook catalogue by surface with every variant and state selector, registry tokens and primitives with the value in force, and the draft's images. Each entry inserts at the caret. Switching lists clears the search. The section lays out side by side only when its container is wide enough
- "Open a theme file" on the draft list posts a `.qtap-theme` to `?action=import` and opens the new draft. A refusal is shown on the list (version 1: one sentence; invalid: the reasons; too large: the limit), and a changed id is announced
- `help/theme-editor.md` covers the Custom CSS section and opening a theme file
- Tests: section and reference panel (`styles-section.test.tsx`), and editor-level saving, held preview, conflict, flushing and import cases in `theme-editor.test.tsx`

#### Tests: theme editor CSS-flush test no longer times out on CI

- `theme-editor.test.tsx` "saves pending CSS before an operation on the draft" waited for "Begin a stylesheet" with the default 1-second timeout. That wait covers a flushed save, the `clear-styles-file` call and a re-render, which took longer on CI. It now uses 4 seconds, like the other custom CSS tests
- `docs/developer/TESTING_GUIDE.md` has a new troubleshooting section, "Component Tests That Pass Locally and Time Out on CI". It says to scope accessible-name queries and to give a wait an explicit timeout when it covers more than one async step

#### Tests: theme editor suites no longer time out on CI

- The theme editor component tests (`editor-structure`, `bundled-walk`, `theme-editor`) timed out on CI. In jsdom, each label-text or accessible-name query walks the whole document for every element it checks, and the editor mounts several hundred labelled rows. The tests now query inside the row, panel or toolbar they are about, using new helpers in `__tests__/helpers/theme-editor-queries.ts`. The theme-editor folder runs in 8 s instead of 85 s; the Rains walk takes about 2 s instead of 51 s
- Removed a duplicated `images` key in the `editor-structure` fixture

#### Themes: code editor, located issues, draft stylesheet and import (Calliope Live, Spec G Stages 0–1)

- New shared code editor (`components/code-editor/`): Lexical plain text with Prism highlighting for JSON and CSS, line numbers, issue markers with tooltips, Tab / Shift+Tab indent and outdent, Escape-then-Tab to leave, auto-indent on Enter, and line endings kept as the file had them. A reusing tokenizer only rebuilds the changed stretch, so a 2,000-line file types at about 16 ms a key. Not yet mounted anywhere
- Eight `--qt-code-token-*` theme tokens for the highlight colors, with contrast pairs; added `@lexical/code-prism`
- Theme engine issues are structured: the CSS scoper, the theme validator and the bundle loader return `{ message, file?, line? }` beside each message (`lib/themes/engine/issues.ts`). Message text and `quilltap themes validate` output are unchanged. Draft issues carry `file` and `line`
- Draft detail returns `styles` (`{ path, text, revision }` or `null`)
- New draft operations `set-styles-file` (creates an empty `styles.css` when absent, then names it in the manifest) and `clear-styles-file` (unnames it first, then deletes the file only with `deleteFile`), both taking `manifestRevision`
- `PUT /api/v1/theme-drafts/[id]` takes `{ revision, tokens }` or `{ stylesRevision, css }`. CSS with errors is saved and reported; a stale revision is a 409
- `POST /api/v1/theme-drafts?action=import` (multipart, one `file`) makes a draft from a `.qtap-theme`. The archive is checked and extracted by `bundle-archive.ts` into a temp directory that is always removed; a version 1 bundle is refused with the earlier-theme message; an oversized upload is refused (411 / 413) before it is read whole. The draft keeps the bundle's name and version and gets a free id; the result has `bundleId` and `idChanged`
- Tests: code editor, engine issues, stylesheet operations, import (all six bundled themes, free and numbered ids, version 1, symlinks, climbing paths, size and count limits, broken CSS, temp cleanup) and the routes

#### Docs: Calliope Live Spec G

- Added Spec G (custom CSS section in the theme editor, a shared code editor with JSON and CSS highlighting, and importing a `.qtap-theme` file as a draft)

#### Themes: fonts, images, icons, subsystems and manifest details in the theme editor (Calliope Live, Spec F Stages 0–1)

- Theme engine `bundleFileUsage` (`lib/themes/engine/usage.ts`) is the one answer to "what uses which file" (fonts, licence files, icons, subsystems, preview image, tokens and styles files, token, primitive and custom CSS references); the draft detail returns every file with its kind, size, users and an `unused` flag, plus totals against the bundle limits and a `manifestRevision`
- New draft operations (`lib/themes/drafts/operations.ts`, `uploads.ts`) on `POST /api/v1/theme-drafts/[id]`: `read-font`, `add-font`, `add-licence-file`, `add-image`, `set-icon` (multipart, fields validated by Zod) and `update-font`, `remove-font`, `remove-file`, `clear-icon`, `set-subsystem`, `set-manifest` (JSON). Stored names are built by the server; font and raster image extensions must match the file's leading bytes. Each operation checks `manifestRevision` (409 when stale) and a removal of a file still in use is a 409 naming its users
- Font facts (family, weight, style, variable axes, embedding permission, licence hint) are read with `fontkit` in `lib/themes/font-info.ts`; TTF and OTF fonts become WOFF2 (WOFF packed as is) at install with `wawoff2` in `lib/themes/convert-fonts.ts`. The draft keeps the originals
- Install leaves out files nothing uses and reports them (`leftOut`) with the font conversions (`fontConversion`)
- Theme editor: Fonts, Images, Icons, Subsystems and details, and Files sections after the token sections (`components/theme-editor/assets/`). Fonts are added in batches with read-back fields and one licence (with an optional licence file), edited and removed; images added, removed when unused and chosen as the preview image; any icon overridden with an SVG (tinted) or WebP (as drawn) or reset; author, licence, tags and the dark-mode flag edited; each subsystem renamed, described and given a thumbnail and page picture. Operations flush pending token saves first; a stale revision reloads the draft and says it was changed elsewhere
- New fonts appear in the font-family control and mark their weights in the font-weight control; new images appear in the image control
- Fixed: the font licence picker showed "Another licence" with nothing chosen and ignored the licence read from the font
- `help/theme-editor.md` covers the new sections and the install changes
- Tests: operations, uploads, font facts, file usage, and component tests for each section

#### Docs: Calliope Live Spec F

- Added Spec F (font and image upload, icon overrides, subsystem overrides and manifest details in the theme editor; fonts are read from the file and become WOFF2 at install)
- Spec F marked implemented and moved to `docs/developer/features/complete/`, with implementation notes for Specs G and H (custom CSS should save like `tokens.json`, with one named operation for the manifest's `customCSS` path; importing a `.qtap-theme` should extract it and reuse the draft copy path)
- `API.md` documents the draft manifest and file operations, the new draft detail fields, the error codes and the install result's `fontConversion` and `leftOut`; the tokens `PUT` takes only `{ revision, tokens }`
- `THEME_DEVELOPMENT.md` covers the editor's folders, what uses what, font conversion and what install leaves out
- `CLAUDE.md` names `fontkit` and `wawoff2` with their one importer each, and states that manifest edits are named draft operations and `bundleFileUsage` is the one source for served, unused and removable files
- Fixed the help page and changelog: only TrueType and OpenType fonts become WOFF2; WOFF is packed as is

#### Fix: a failed theme draft copy no longer holds its id (#226)

- `createDraftNow` (`lib/themes/drafts/service.ts`) removes the partial `Themes/<id>/` folder when any write fails, then rethrows. Before, the leftover folder never listed (no `theme.json`) but still counted as a taken id, so the next draft of that name got `-2` and the copied files stayed in Quilltap General
- Regression test: a copy whose second file write fails leaves no folder, and a retry gets the un-suffixed id

#### Docs: Calliope Live Spec E

- `help/theme-editor.md` covers the levels, sections, search, "Changed only", each type's control and the text form, following, dark values, density, primitives and undo
- `THEME_DEVELOPMENT.md`: keyword options, and what the editor can and cannot set
- `CLAUDE.md` Themes section: `lib/themes/engine/values/` is the one place a token value is parsed or formatted; the model and `engine/primitives.ts` are the one place a tokens document is edited
- Spec E marked implemented with implementation notes and moved to `features/complete/`

#### Themes: typed controls and editable primitives in the theme editor (Calliope Live, Spec E Stage 2)

- Every token type has its own control in the theme editor (`components/theme-editor/controls.tsx`): colour, length, radius (one value or each corner), shadow (layers with offsets, blur, spread, colour and inset), font family (ordered stack with the draft's fonts and system stacks, and a sample line), font weight (marks the weights the theme's font declares), keyword and font style (a choice of the allowed words), duration, transition (property, duration, easing and delay per item), opacity (field and slider, number or percent), blur, image (the draft's images or none), z-index, number and easing
- Each control has an "edit as text" form. A value its parser cannot read (a gradient, a data URI, a `calc()`) opens in the text form and is left as written until changed
- A value that follows a primitive or another token opens its controls on what it comes to; changing one gives the token a value of its own
- Primitives panel: add (name checked, starting value by type), rename (rewrites references), change type, set the value and a separate dark value, see what follows each, and remove behind a confirmation that lists the values that will take the primitive's value
- Tests: a control test per type, editor tests for the controls and the panel, and a walk that opens every row of each bundled theme and checks nothing is written

#### Themes: theme editor sections, search, undo and the density choice (Calliope Live, Spec E Stages 0–1)

- Theme engine value parsers (`lib/themes/engine/values/`): length and length lists (radius corners), blur, shadow, font stack, transition, duration, opacity, z-index, font weight and image, each with a formatter that round-trips what it accepts; anything else parses to null and is left as written
- The token type check moved to `lib/themes/engine/type-check.ts`, shared by validation and the editor; keyword tokens now carry `options` (text transform, link decoration, color scheme, scrollbar width, background attachment and repeat) and validation refuses any other word
- Primitive edits in `lib/themes/engine/primitives.ts`: add, set value and dark value, change type, rename (rewrites references) and remove (writes the value into its users)
- `GET /api/v1/theme-drafts/[id]` returns the draft's image files with their asset URLs; the draft serves every image it holds
- Theme editor: every settable token (666) laid out by level (Essentials, Components, Advanced) and registry group, with a section list, search across levels, "Changed only", the density choice, and undo/redo for the session (buttons and Ctrl/Cmd+Z). Rows follow or detach from primitives, set a dark value apart, and refuse a value that fails the type check. Rows read from an editor store and mount near the viewport, so an edit re-renders only its row

#### Docs: Calliope Live Spec E

- Added Spec E (typed controls for every theme token, editable primitives, the density choice, search and undo in the theme editor)

#### Themes: theme editor, drafts and live preview (Calliope Live, Spec D Stages 1–3)

- Theme drafts: a draft is the folder `Themes/<id>/` in Quilltap General holding an unpacked version 2 bundle; `lib/themes/drafts/` is the only code that knows the location. Drafts are created blank or as a copy of any installed or bundled theme, validated by the installed-bundle loader, and saved with a revision check (409 on a stale revision)
- New routes `GET`/`POST /api/v1/theme-drafts`, `GET`/`PUT`/`DELETE /api/v1/theme-drafts/[id]` and `POST /api/v1/theme-drafts/[id]?action=install`. The theme asset and font routes also serve a draft's files at the draft's exact version, uncached
- Installing a draft packs it and runs the ordinary bundle install, converts PNG, JPEG and GIF to WebP in the installed copy (the draft keeps its originals), registers the theme without a restart, and bumps the draft's patch version
- Theme editor tab (Calliope's Atelier, `/calliope`, "Design a theme" on the Appearance card): draft list, new/delete dialogs, colour token editing in light and dark with per-token contrast, name and description, autosave, install
- Live preview: the theme provider has a preview slot (`setPreview`) that shows a theme in place of the worn one without changing the stored preference; the Atelier compiles the unsaved tokens in the browser through `lib/themes/engine/client.ts`
- Fixed: a theme's custom CSS and icon overrides reached into nested elements wearing another theme (the Atelier panel, Appearance preview cards). Every descendant rule is now compiled inside `@scope ([data-theme="<id>"]) to ([data-theme]:not([data-theme="<id>"]))`, with the same specificity. The snapshot cascade reads `@scope`
- New `themes` realtime topic, published when a theme is installed; it refreshes theme and draft queries
- `.qtap` exports leave theme drafts out (`docStoreExportExclusion` in `lib/export/excluded-files.ts`: the `Themes` folder of Quilltap General and everything under it). Backups still carry them
- Docs: new `help/theme-editor.md`; drafts and contrast sections in `THEME_DEVELOPMENT.md`; Theme Drafts in `API.md`; Spec D moved to `features/complete/`

#### Themes: contrast checks (Calliope Live, Spec D Stage 0)

- Theme engine has a browser-safe entry point (`lib/themes/engine/client.ts`); a test walks its imports and fails on Node built-ins, PostCSS or the logger
- WCAG contrast check: `CONTRAST_PAIRS` (`lib/themes/registry/contrast.ts`, 57 foreground/background pairs, 4.5:1 for text and 3:1 for focus rings) measured by `checkContrast` in light and dark. Failures are validation warnings in `quilltap themes validate` and theme loading
- `scripts/check-theme-contrast.ts --check` runs in `npm run lint` against the default theme and the bundled themes, with an exception list at `themes/bundled/contrast-exceptions.json` (empty)
- Fixed 54 contrast failures by changing lightness only: default theme silent and wardrobe labels (light), template chips 1, 2 and 4, project badge text (dark); Art Deco, Madman's Box wardrobe badges; silent and wardrobe labels in Art Deco, Earl Grey, Great Estate, Old School and Rains; message, project, npm and tag badges in several themes; Madman's Box chip 3; Rains character, user-character, chat, tag and project badges and link colour (dark)

#### Docs: Calliope Live Spec D

- Added Spec D (contrast checks in the theme engine, theme drafts, and an editor tab with a live preview of colour tokens)

#### Themes: tools and published format (Calliope Live, Spec C Stage 4)

- Published JSON Schemas for both bundle documents, generated from the engine's Zod documents (`npm run generate:theme-schemas`): `public/schemas/qtap-theme.schema.json` (version 2 manifest) and the new `qtap-theme-tokens.schema.json`, which lists every registry token and choice. Bundles name them in `$schema`
- Added `docs/developer/THEME_TOKENS.md`, generated from the token registry (`npm run generate:theme-tokens-doc`). `scripts/check-theme-references.ts` fails lint while it or the schemas are stale
- `quilltap themes` validates, installs, updates and exports through the app's engine, bundled into `packages/quilltap/lib/theme-engine.generated.js` (`npm run build:cli-theme-engine`; lint checks it is current). Version 1 bundles are refused with the app's message. `validate` takes a bundle directory as well as a `.qtap-theme` file. `uninstall` and `export` refuse a theme id that is not a plain id. Removed `packages/quilltap/lib/theme-validation.js`
- `validateThemeBundle` reports an unreadable archive as an error instead of throwing
- create-quilltap-theme 3.0.0: scaffolds a version 2 bundle only (`theme.json`, `tokens.json`, `styles.css`, `README.md`) with `$schema` and `hooksVersion`; `--plugin` and the npm plugin templates are removed; unknown options are an error
- Added `docs/developer/THEME_DEVELOPMENT.md`, the version 2 authoring guide; removed `THEME_PLUGIN_DEVELOPMENT.md`. Updated the README, DEVELOPMENT.md, CLI.md, the CLI README, `help/themes.md` and the hook reference's note on scoping
- The theme menu's empty-state hint says "Install theme bundles", not "theme plugins"
- Moved the Calliope Live audit, Specs A, B and C, the fit report and the differences file to `docs/developer/features/complete/`
- Tests: CLI validate, install, export and uninstall against the bundled engine (bundled themes, v1 refusal, archive symlinks and escaping entries, icon overrides); the scaffolder's output validates with no warnings and names the current hook catalogue version

#### Themes: version 1 removed (Calliope Live, Spec C Stage 3)

- Version 2 is the only theme format loaded. A version 1 bundle found among the installed themes, or a theme a plugin declares, is recorded as refused (`lib/themes/refused.ts`) and never registered; nothing is deleted. The plugin itself still loads
- Install (file, URL, registry) refuses a version 1 bundle before anything is written, with the same message. Registry entries that state an earlier `formatVersion` are not offered
- The Appearance card lists refused themes ("Garments Left at the Door") with the message, a link to the Themes help page, and Uninstall for bundles. `DELETE /api/v1/themes/[id]` uninstalls a refused bundle; a plugin's refused theme is a 400
- If the stored theme is refused or missing, the app wears the default theme and shows one notice
- `GET /api/v1/themes` returns `refused` and `stats.refused`; the Almanack reports the refused count in place of "With CSS Overrides"
- The default theme injects no CSS; `_theme-defaults.css` and `_variables.css` carry its values
- Removed: `ThemeTokensSchema`, `DEFAULT_THEME_TOKENS`, `themeTokensToCSS`, `mergeThemeTokens`, the version 1 font-face and icon-override generators, every version 1 branch, the plugin theme registration code, and `scripts/convert-theme-v1.ts`, `convert-theme-to-module.ts`, `convert-plugin-themes-to-bundles.sh`. Version suffixes dropped from names (`exportThemeAsBundle`, `theme-bundle.ts`)
- Removed the 12 internal registry tokens nothing read: `--qt-auth-page-bg`, `--qt-footer-bg`, `--qt-input-placeholder`, `--qt-sidebar-fg`, `--qt-sidebar-muted`, `--qt-tab-gap`, `--qt-left-sidebar-{min-width,max-width,footer-height,item-gap,overlay-bg,overlay-z}`. Density now covers 25 sizing tokens (three of the 28 were among them)
- `scripts/check-theme-hooks.ts` fails on any off-catalogue selector in a bundled theme; loading an installed theme logs the same findings as warnings
- Bundle extraction and asset serving share the app's path rules; the themes index is rebuilt from the installed bundles when it is unreadable
- Re-recorded the theme snapshot fixtures for the removed tokens; no other resolved value changed
- Tests: refusal at install, at load and as a plugin theme; refused themes give the injector nothing; the asset route serves only the served set
- create-quilltap-theme: templates drop the removed tokens. theme-storybook: regenerated CSS

#### Themes: bundled themes refined (Calliope Live, Spec C Stage 2)

- The six bundled themes use plain, typed primitives (`brass`, `walnut`, `text-muted`, `red-deep`) with a `dark` value where the modes differ; recurring literal colours are primitives too. earl-grey and rains share primitive names
- Semantic colour families are anchored to the primitives, and overrides that reproduce them are gone. A dropped override whose value differed by ΔE ≤ 0.02 (OKLab) is listed in the differences file with its ΔE
- Hand-written rules replaced by tokens the app already reads: colour scheme, text selection, scrollbars, focus ring, primary button, badge and alert colours, radii, heading font and letter-spacing, footer link, input focus border. madmans-box's homepage glow is `--qt-page-background-image`
- New tokens: `--qt-page-background-texture` and `--qt-page-background-texture-opacity` (a tiling texture over the page background, hidden with it under a story background); `--qt-thinking-duration` and `--qt-thinking-origin`. `--qt-scrollbar-width` defaults to `thin`, which the default theme already rendered
- Smoothed text and smooth scrolling apply to every theme from `_base.css`
- The heading tokens style `.qt-page-title`, `.qt-section-title`, `.qt-homepage-section-title` and `.qt-text-section`. No change in the default theme
- Removed the themes' dead selectors (classes no markup uses), reduced-motion resets, `*` transitions and attribute-substring stand-ins; what remains targets catalogued hooks only. `scripts/check-theme-hooks.ts` reports all six clean
- Catalogued as hooks: `qt-text-brand`, `qt-font-brand`, `qt-spinner`, `qt-thinking-indicator`, `qt-diagram`, the six category badges, `qt-empty-state-title`, `qt-wikilink` (state `qt-wikilink-broken`), `qt-file-preview-panel`, `qt-participant-turn-dot`
- Decision 1: earl-grey and rains set `--theme-font-sans` / `-serif` / `-mono` to the stacks they always named, so earl-grey renders in Rethink Sans and rains' code in Fira Code (rains' chat user font was already Nunito Sans)
- New token `--qt-body-font-weight` (root font-weight, optional); rains sets 300, as its version 1 root rule did
- The root `scrollbar-color` falls back to a transparent track when a theme sets a thumb and no track; earl-grey and rains had dropped to the browser's scrollbar
- art-deco and great-estate give tabs (and the button inside a workspace tab), the sidebar items and profile, the settings rail, collapsible card headers and chips the tracked capitals their version 1 bare `button` rule gave; art-deco, great-estate and madmans-box set card and dialog titles in the heading face, and draw the character header's rule in the card border colour, as their `[class*="card"]` rule did
- art-deco, great-estate and madmans-box scrollbars take the theme's colours in Chromium too; version 1 coloured them only through `::-webkit-scrollbar`, which Chromium ignores once `scrollbar-width` is set
- Custom CSS before → after (bytes): art-deco 3063 → 1261, earl-grey 6438 → 1537, great-estate 4040 → 1732, madmans-box 4608 → 2407, old-school 1462 → none, rains 7327 → 2037
- Re-recorded the theme snapshot fixtures; every rendered change is in `calliope-live-spec-c-differences.md`
- theme-storybook: regenerated CSS

#### Themes: bundled themes converted to version 2 (Calliope Live, Spec C Stage 1)

- The six bundled themes (art-deco, earl-grey, great-estate, madmans-box, old-school, rains) are now version 2 bundles, version 2.0.0, written by `scripts/convert-theme-v1.ts` with no hand edits. Each bundle has a `fonts/OFL.txt` with its families' copyright lines as the font files state them (earl-grey's previous file named the wrong holder and year; rains' lacked Nunito Sans)
- Re-recorded the theme snapshot fixtures. No resolved value changed: private names now appear as `--p-*`, names nothing reads are gone, and some values are re-spelt (`hsl(… / a)` as the equal `color-mix(…, transparent)`), including in the default theme, whose fixtures predated that change in the app CSS
- The theme picker's cards show the font a theme's headings actually render in (its resolved `--qt-heading-font`), not its `fontSerif` token; swatch colours are unchanged
- The version 1 loader test uses its own fixture, `__tests__/fixtures/themes/v1-sample/`, now that no bundled theme is version 1
- old-school now uses the app's keyboard focus ring (2px solid in `--qt-focus-ring-color`, 2px offset) instead of the browser's default; version 2 turns `features.focusRing` on and old-school has no focus rule of its own. The other five keep their own rules
- The theme preview dialog renders from the compiled theme, so it now matches the live app. One known gap: rains' sample shows 8px cards and 12px badges (the app shows 12px and 24px), because its radii are set as root overrides, which the preview's nested container re-applies from `--theme-radius-*`
- Bundle asset URLs carry `?v=<theme version>`
- `scripts/convert-theme-v1.ts` takes `--from <dir>` to read version 1 bundles from somewhere other than `themes/bundled`

#### Themes: migration baseline and tools (Calliope Live, Spec C Stage 0)

- Added the theme probe, `scripts/theme-probe/`: a dependency-free page function that records computed styles (colour, background, border, font, padding, gap, shadow, outline, opacity, transition, animation, filters, scrollbar, `color-scheme`, plus `::before`, `::after`, `::selection`) for `html`, `body`, bare `h1`–`h3` and the first visible element of every catalogued hook, variant value and state, with match counts; and a Playwright driver (`run.ts run` / `compare`) that runs it over seven pages per theme and mode and saves screenshots. Playwright is not a repo dependency; results go to the git-ignored `.theme-probe/`
- Recorded the version 1 baseline on V4test (7 themes × 2 modes × 7 pages, outside the tree). Re-probing the default theme afterwards differs on none of its 14 pages
- Added `scripts/convert-theme-v1.ts` (removed again in Stage 3): converts a bundled version 1 theme to version 2 from what it resolves to, with private names as primitives, unread names dropped and listed, rules moved to custom CSS without the theme id, density set to `comfortable`, version 2.0.0 and `hooksVersion`. It validates its output with the engine and compares the root cascade with the version 1 theme's. All six bundled themes convert with no changed value (output not yet written into `themes/bundled/`)
- Font licences are read from each font file's name table: every font in the six bundles is SIL OFL 1.1. The converter writes one `fonts/OFL.txt` per bundle with each family's copyright line as the file states it
- Version 2 manifests accept `hooksVersion` (integer, optional). A theme behind the hook catalogue gets a load-time warning naming any removed hook its custom CSS still uses (`removedHooksUsed` in `lib/themes/hooks/lint.ts`)
- `--qt-button-transition`, `--qt-card-transition` and `--qt-app-header-blur` no longer change with `density`; it keeps the 28 sizing tokens. No version 1 theme or the default theme is affected
- The snapshot harness applies a version 2 theme's choice and feature attributes to `<html>` (`v2RootAttributes`), as `applyThemeToDom` does
- Added `docs/developer/features/calliope-live-spec-c-differences.md`, empty until a stage changes how a theme renders
- theme-storybook 1.0.121: regenerated CSS

#### Dependencies: npm update across root, packages and plugins

- Ran `npm update -S` in the root project, every package and every plugin. Notable bumps: `better-sqlite3-multiple-ciphers` 13.1.1, `openai` 7.57, `@anthropic-ai/sdk` 1.8, `@openrouter/sdk` 1.5.103, `eslint` 10.15, `storybook` 10.6.7, `ws` 8.23; patch bumps to `tar`, `postcss`, `dompurify`, `croner`, `@napi-rs/canvas`, `@testing-library/user-event`
- Plugins and plugin-utils now require `@quilltap/plugin-types` ^2.11.0; the root and plugins require `@quilltap/plugin-utils` ^2.7.6
- postcss 8.5.33 types `Declaration.important` as `boolean | undefined`; the theme snapshot cascade (`lib/themes/snapshot/cascade.ts`) now coerces it
- plugin-utils 2.7.6, theme-storybook 1.0.120; patch bumps to all 15 plugins (`package.json` and `manifest.json`), rebuilt

#### Themes: version 2 theme document (Calliope Live, Spec A Stage 3)

- Added the version 2 theme format (`theme.json` with `formatVersion: 2`): `tokens.json` holds author-named primitives (emitted as `--p-<name>`), overrides of registry tokens (one value, or light and dark) and choices; custom CSS is written without the theme id. `extendsTheme` is not part of version 2
- Added the theme engine, `lib/themes/engine/` (pure): Zod schemas for both files; validation (registry token and choice names with nearest-name suggestions, `var()` references, type checks, reference cycles in both modes, every referenced file present, app icon names, subsystem ids, font licences); `resolveTheme` with per-value provenance; `emitThemeCss`; `scopeThemeCss` (PostCSS: prefixes selectors with `[data-theme="<id>"]`, prefixes keyframe names, keeps `@media` / `@supports` / `@container` / `@layer`, refuses other at-rules); `url()` limited to bundle images and `data:image` URIs, rewritten to the asset route with the theme version
- `lib/themes/v2-bundle.ts` reads a bundle directory, validates and compiles it. `QtapThemeManifestSchema` is a union on `formatVersion`; version 1 bundles load as before. Install, load, registration and export handle both; a version 2 theme exports as installed
- `?action=tokens` returns, for a version 2 theme, its compiled CSS, choices and features instead of version 1 tokens. The theme provider injects that CSS as it is and sets `data-qt-<choice>` and the feature attributes on `<html>`; the theme picker's swatches and heading font come from the compiled theme; the Appearance preview renders a version 2 theme in a container carrying its `data-theme` (`qt-theme-preview-surface`)
- `_theme-defaults.css` also declares the semantic defaults on `[data-theme]` elements and re-declares Tailwind's `--color-*` / `--radius-*` / `--font-*` map on `[data-theme]:not(:root)`, so a theme previewed inside another starts from the defaults; no root value changes
- `postcss` moved to `dependencies` and, with its dependencies, into `outputFileTracingIncludes`: `server.ts` and the WebSocket entries reach the theme engine with packages external
- Added the fixture theme `__tests__/fixtures/themes/v2-sample/` and tests: every schema and CSS rejection, provenance, emitted and scoped CSS snapshots, a snapshot-harness run over the fixture (overridden tokens change, density applies, the rest keeps its default), and the loader round trip (validate, install, register, export) beside a version 1 bundle

#### Themes: semantic tier widened (Calliope Live, Spec A Stage 2)

- The semantic `--theme-*` tokens (colours, sidebar colours, radii, type and spacing scales, effects) are now in the registry and generated into `app/styles/_theme-defaults.css`, which replaces the hand-written `:root` / `.dark` blocks in `globals.css`. `DEFAULT_THEME_TOKENS` is read from the registry; the two had no disagreements
- Added semantic families, and re-expressed their component tokens through them: category palette (17 badge categories, colour + foreground, one tint), status palette (alert colour + foreground per status, fill and edge strengths), chat surfaces (assistant, Staff, and an accent + label per message kind), roleplay text, terminal palette, overlay scrim, and hover shade/tint. 96 tokens
- Added app-owned rules in `_base.css`: `::selection`, `color-scheme`, `scrollbar-width` / `scrollbar-color` (in `@layer base`); WebKit scrollbar styling, a `:focus-visible` ring and a page background image behind `data-qt-scrollbar`, `data-qt-focus-ring` and `data-qt-page-background`, which `applyThemeToDom` now sets on request. The default theme's `::selection` rule became the token defaults
- Added optional hooks (read with a fallback, never declared): heading weight, letter spacing, transform and colour on `.qt-heading-*`; letter spacing and transform on `.qt-button`. Added `--qt-dialog-border-width`
- Added the `density` choice: 31 tokens take a `comfortable` value under `[data-theme][data-qt-density="comfortable"]`; `compact` is the existing defaults. Nothing sets the attribute yet
- Registry: `optional` and `byChoice` on tokens, `sheet` on groups, choices in `lib/themes/registry/choices.ts`
- Added `lib/themes/color/` (CSS colour evaluation, OKLab difference), checked against Chrome on every colour in the fixtures. The theme snapshot now compares colours by rendered 8-bit RGBA, so an equal formula is not a change; `scripts/theme-snapshot.ts --add` records new names without touching recorded values
- No resolved value changed in any of the fourteen theme/mode fixtures; an in-browser comparison of 5,278 computed properties per run (headings, buttons, dialog, inputs, card, selection, root, shell) found no difference in any theme or mode
- Added the fit report, `docs/developer/features/calliope-live-spec-a-fit.md`, and `scripts/theme-fit-report.ts`, which generates its tables
- `scripts/check-css-vars.mjs` now also checks untracked, non-ignored files, so a new stylesheet is checked before it is staged
- theme-storybook 1.0.119: regenerated CSS

#### Themes: token registry generates the variable defaults (Calliope Live, Spec A Stage 1)

- Added the theme token registry in `lib/themes/registry/`: 518 tokens in 36 groups (one file per group), each with tier, type, group, label, default, optional dark default and visibility, plus lookups by name and by group
- `app/styles/qt-components/_variables.css` is now generated from it (`npm run generate:theme-variables`); `npm run lint` runs `scripts/check-theme-variables.ts`, which fails when the file and the registry disagree. Same selectors and specificity as before
- Moved the hand-written rules from `_variables.css` (root baseline, `::selection`, reduced motion) unchanged to `app/styles/qt-components/_base.css`, imported right after it
- Declared 13 hook variables the app read only through `var(--hook, fallback)` (the copy-button set, `--qt-thinking-duration` / `-origin`, `--qt-workspace-accent`, `--qt-workspace-tab-active-fg`), each defaulting to its fallback. `--qt-badge-secondary-border` is read with no fallback and was left undeclared
- Marked the 12 variables nothing in the app reads as `internal`; they stay because bundled themes still set them
- Dropped 22 dark-block declarations that repeated the shared value
- Theme snapshot: no existing value changed in any theme or mode; the fixtures gained only the 13 hooks
- theme-storybook 1.0.119: regenerated CSS

#### Themes: resolved-variable snapshot (Calliope Live, Spec A Stage 0)

- Added `scripts/theme-snapshot.ts` (`--check` to compare): compiles `app/globals.css` with Tailwind's compiler and source scan, applies each theme's injected CSS, and records what every custom property resolves to on `<html>` for the default theme and the six bundled themes in light and dark
- The resolver is `lib/themes/snapshot/` (cascade layers, specificity, order, `!important`, CSS nesting, `@supports` for the conditions Tailwind writes, `@property` initial values, recursive `var()` with fallbacks; cycles and unresolvable references are reported). Tailwind's own default theme variables and `--tw-*` internals are used for resolution but left out of the output
- Added the fourteen fixtures under `__tests__/unit/lib/themes/fixtures/snapshots/` and a test that recomputes and compares them; checked against Chrome's computed styles for all fourteen
- Confirmed that the font stacks in a bundle's `tokens.json` never take effect (recorded in the audit). earl-grey and rains render system fonts in the UI because they do not re-declare `--theme-font-*` in `styles.css`. Not fixed here

#### Themes: structural hook catalogue (Calliope Live, Spec B)

- Added the theme hook catalogue in `lib/themes/hooks/`: 156 `qt-*` classes, with the data attributes and states a theme may select on, version 1
- Added `npm run generate:theme-hooks-doc`, which writes `docs/developer/THEME_HOOKS.md`; `npm run lint` now runs `scripts/check-theme-hooks.ts`, which fails when a catalogued hook leaves the markup, a literal variant value is not listed, or the reference doc is stale, and reports (without failing) the bundled themes' selectors that target something other than a hook
- Added hooks: home cards carry `data-section`, plus `qt-homepage-row`, `qt-homepage-empty`, `qt-homepage-welcome`; rail items carry `data-nav`, popouts `qt-left-sidebar-popout`; `<main>` is `qt-app-content`, its scroll area `qt-app-scroll`; workspace pane chrome and tab panes carry `data-pane`, tabs and tab panes `data-tab-kind`
- Added Salon hooks: message rows carry `data-role` (`user`, `assistant`, `staff`, `tool`) and Staff rows and announcement chips `data-staff`; `qt-chat-tool-call` with `data-tool`, `qt-chat-pending-tools`, `qt-chat-message-streaming`, `qt-chat-avatar-carried`; the shared avatar box is `qt-avatar-image`
- Added character page hooks: `qt-character-page`, `-header`, `-avatar`, `-identity`, `-tags`, `-stats`, `-actions`, `-archived-banner`; field sections are `qt-section-card` with `data-section`, `-header` and `-body`
- Added settings hooks: rail items carry `data-group`, settings cards `data-card`
- The left rail now marks the item for the focused pane's active tab with `aria-current="page"` (it had no active indication); the themes and quick-hide buttons carry `aria-expanded`
- Changed dialogs: `BaseModal` always applies `qt-dialog-body` / `qt-dialog-footer`, which now carry no styling; the default padding and footer look moved to `qt-dialog-body-default` / `qt-dialog-footer-default`, applied when the caller passes no classes of its own. Callers that relied on the old classes now name the `-default` ones. The close button is `qt-dialog-close`
- Removed great-estate's `[data-role="assistant"]` / `[data-role="user"]` border rules, which had never matched and would have started to (theme 1.0.13)
- `SectionCard`'s `anchor` prop is now required and typed from the catalogue's list of character-page sections; the seven cards that had none (Facts, Dossier, and the five Chat Defaults cards) now have one
- theme-storybook 1.0.118: regenerated CSS and the Dialogs story for the dialog change

#### Docs: feature spec for Calliope Live

- Added pre-spec for Calliope Live, an in-app theme editor and theme overhaul for Quilltap
- Added the Phase 0a audit of the theme system (`calliope-live-audit.md`, with the variable-by-theme table as a CSV): 505 component variables, how each bundled theme uses them, the hand-written rules, assets, and structural hooks
- Added Spec A (token registry and bundle format v2) and Spec B (structural hook catalogue), and linked all three from the proposal
- Added Spec C (migrate the six bundled themes to version 2, retire version 1, move the CLI, scaffolder and JSON Schema to the new format)
