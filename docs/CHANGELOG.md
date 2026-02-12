# Quilltap Changelog

## Recent Changes

### 2.11-dev

- Started 2.11 dev branch
- fix: Participants sidebar now always shows in chat conversation page
  - Removed `isMultiChar` gate so sidebar renders even with zero participants
  - Users can now add characters to chats that have no participants
  - Updated empty state message to "Add a character to get started"
- fix: Story background files now correctly stored in `/story-backgrounds/` folder
  - Added `projectId` and `folderPath` to file metadata when saving generated story backgrounds
  - Auto-create `/story-backgrounds/` folder record in database on first background generation per scope
  - Fixed project `list-files` API response missing `folderPath` and other fields needed by FileBrowser UI

### 2.10.2

- feat: User profile setup on first run
  - New `/setup/profile` page with name input and archetype selection (Proprietor, Resident, Author)
  - Creates a user-controlled character so the turn manager correctly yields to the user
  - Automatically sets the new user character as default partner for all existing LLM-controlled characters
  - PepperVaultGate redirects to profile setup when no user character exists
  - All setup page exits (pepper setup, unlock, vault storage) route through profile setup when needed
  - Fallback greeting now uses the user character's name when available
  - Updated startup wizard help documentation

- fix: Guard against missing `capabilities` on search providers in connection profile forms
  - `ProfileForm.tsx` and `ProfileModal.tsx`: `p.capabilities.chat` → `p.capabilities?.chat`

### 2.10.1

- fix: Remove verbose debug logging from pepper vault and web search handler

- feat: Pepper Vault — web-based setup wizard for ENCRYPTION_MASTER_PEPPER
  - Auto-generates encryption pepper on first run, no manual env var needed
  - Web-based setup wizard at `/setup` with optional passphrase protection
  - Stores encrypted pepper in SQLite `pepper_vault` table
  - Three startup modes: auto-resolve (no passphrase), unlock (passphrase), and setup (first run)
  - Env var pepper users prompted to store in vault via dismissible banner
  - API routes at `/api/v1/system/pepper-vault` for status, setup, unlock, and store
  - `PepperVaultGate` client component redirects to setup when needed
  - Pepper state tracked in `startupState` with `isPepperResolved()` gate
  - Authenticated API routes return 503 when pepper is not resolved
  - `lib/encryption.ts` now uses lazy pepper loading (reads from `process.env` on demand)
  - `ENCRYPTION_MASTER_PEPPER` is now optional in env schema
  - Comprehensive unit tests for pepper vault lifecycle

- feat: Pluggable web search provider system
  - New `SEARCH_PROVIDER` plugin type for pluggable web search backends
  - New `SearchProviderPlugin` interface in `@quilltap/plugin-types@1.14.0`
  - New search provider registry (`lib/plugins/search-provider-registry.ts`) for managing search provider plugins
  - Bundled Serper.dev search provider plugin (`qtap-plugin-search-serper`)
  - Web search handler rewritten to use search provider plugins with DB-stored API keys
  - Providers API now returns both LLM and search providers
  - API key test endpoint supports both LLM and search providers
  - `SERPER_API_KEY` env var deprecated in favor of Settings > API Keys
  - Backwards compatible: legacy `SERPER_API_KEY` env var still works as fallback
  - New `docs/SEARCH_PLUGIN_DEVELOPMENT.md` guide for building search provider plugins

### 2.10.0

- refactor: Add type-safe `TypedQueryFilter<T>` to database abstraction layer
  - Introduce `TypedQueryFilter<T>` mapped type that constrains filter fields to `keyof T` at compile time
  - `QueryFilter` becomes a backward-compatible alias (`TypedQueryFilter<Record<string, unknown>>`)
  - Add `$regex?: RegExp | string` to `ComparisonCondition` (already used at runtime, now typed)
  - Update `DatabaseCollection<T>`, `AbstractBaseRepository<T>`, and `SQLiteCollection<T>` method signatures
  - Remove 138 unnecessary `as QueryFilter` casts across 26 repository files (14 remain for untyped message collections)
  - Add 6 compile-time type assertion tests to query-translator test suite
  - Remove unused `FieldFilter` type (subsumed by the mapped type)
  - Zero runtime changes — purely compile-time typing improvement

- refactor: Migrate ~65 component files from raw Tailwind to qt-* theme utility classes
  - Convert hardcoded color/border/shadow classes to semantic equivalents across settings, characters, images, tools, chat, search, layout, and other components
  - Add `qt-shadow-lg` and `hover:qt-bg-primary/10` utility classes to `_utilities.css`
  - **@quilltap/theme-storybook** (1.0.19 → 1.0.20): Add `qt-shadow-lg` and `hover:qt-bg-primary/10` to `qt-components.css`
  - Resolves identified technical debt: ~45 remaining component files with raw Tailwind violations

- refactor: Replace direct SQLite access in `UsersRepository.migrateUserId` with database abstraction layer
  - Use `withTransaction` for atomic all-or-nothing migration across 12 tables
  - Use `collection.updateMany()` instead of raw `(db as any).db` prepared statements
  - Add debug-level per-table logging and structured warn-level error messages

- refactor: Add `safeQuery()` helper to eliminate redundant try-catch boilerplate
  - Create standalone `safeQuery()` function and `extractErrorMessage()` utility in `safe-query.ts`
  - Add `this.safeQuery()` protected method on `AbstractBaseRepository` with auto-injected `collection` context
  - Convert ~315 catch blocks across 29 files (1 base class, 5 ops modules, 23 child repositories)
  - Three failure modes preserved: rethrow (writes), fallback (reads), silent (non-critical)
  - Inner try-catches and synchronous validation preserved as-is
  - Resolves identified technical debt: redundant try-catch wrappers in repository methods

- refactor: Split ChatsRepository into facade + 5 focused operations modules
  - Extract `ChatParticipantsOps` (add/update/remove participant, query helpers)
  - Extract `ChatImpersonationOps` (add/remove impersonation, active typing, LLM pause)
  - Extract `ChatTokenTrackingOps` (increment/reset token aggregates)
  - Extract `ChatMessagesOps` (get/add/update/clear messages, message count)
  - Extract `ChatSearchReplaceOps` (count/find/replace text in messages)
  - Shared dependency injection via `ChatOpsContext` interface — zero changes to callers
  - Resolves identified technical debt: ChatsRepository SRP split (1,115 → 422 lines in facade)

- fix: Sync qt-* theme utility classes across npm packages for theme developers
  - **@quilltap/theme-storybook** (1.0.18 → 1.0.19):
    - Add ~120 missing CSS variables to `qt-components.css` (navbar, sidebar, content, typography, panel, popover, chat composer/toolbar/attachment/sidebar, response status, participant, roleplay, queue badges, entity card, code, link, footer, brand, auth, page layout, tab extras)
    - Add ~15 missing class definitions (`.qt-bg-surface`, `.qt-bg-surface-alt`, `.qt-bg-primary/*`, `.qt-border-default`, `.qt-shadow-sm`, `.qt-shadow-md`, `.qt-tab-group`, `.qt-tab-divider`, `.qt-dialog-overlay`, `.qt-navbar`, `.qt-navbar-link`, `.qt-navbar-link-active`)
    - Rename `.qt-tabs` → `.qt-tab-group` to match app
    - Add sidebar variables to `quilltap-defaults.css`
    - Fix phantom class names in story components: `qt-chat-bubble*` → `qt-chat-message*`, `qt-chat-name` → `qt-chat-message-author`, `qt-chat-input*` → `qt-chat-composer*`, `qt-dialog-content` → `qt-dialog-body`, `qt-dialog-sm` removed, `qt-dialog-lg` → `qt-dialog-wide`, `qt-tab-panel` → `qt-tab-content`, `qt-nav-link*` → `qt-navbar-link*`
    - Remove phantom Pill Tabs, Vertical Tabs, Chat List sections from stories
    - Remove phantom `qt-avatar-xs` and Avatar with Status sections
  - **create-quilltap-theme** (1.0.5 → 1.0.6):
    - Fix `qt-chat-bubble-*` → `qt-chat-message-*` in `styles.css.template`
    - Fix Available Component Classes table and Component Variable Reference in docs template

- refactor: Comprehensive codebase audit and cleanup
  - **Dead code removal**: Delete unused `useSidebarResize` hook, `SidebarWidthControl` component, MongoDB `mongodb-utils.ts` stub, `DatabaseMigrationService` stub class and barrel file, and associated test file; remove stale webpack warning suppressions from `next.config.js`
  - **API conformance**: Refactor `/api/v1/session` and `/api/v1/system/data-dir` routes to use standard `createContextHandler` middleware, `withCollectionActionDispatch`, and response helpers from `@/lib/api/responses`
  - **Security**: Fix ReDoS vulnerability in spin-bottle regex by bounding `.*` to `.{0,50}`; add 1000-character max query length validation in `MemoriesRepository.searchByContent()`, `countMemoriesWithText()`, `findMemoriesWithText()` and `ChatsRepository.countMessagesWithText()`, `findMessagesWithText()`
  - **DRY improvements**: Extract `escapeRegex()` and `createNullableFilter()` helper methods to `AbstractBaseRepository`; refactor `FilesRepository`, `MemoriesRepository`, `FoldersRepository` to use shared helpers instead of duplicated inline logic
  - **Theme compliance**: Add `qt-shadow-sm` and `qt-shadow-md` utility classes to `_utilities.css`; convert raw Tailwind violations to qt-* classes in `ChatCard.tsx`, `Avatar.tsx`, `SettingsCard.tsx`, `tags-tab.tsx`
  - **Test coverage**: Add 22 tests for RNG pattern detector (including ReDoS resistance); add 17 tests for base repository `escapeRegex`/`createNullableFilter` helpers; update session API test for middleware conformance
  - **Documentation**: Update `DEAD-CODE-REPORT.md`, `migrations/README.md` (remove stale MongoDB examples, update to SQLite patterns), `components/settings/appearance/README.md`

- **Known Technical Debt** (identified in audit, deferred):
  - ~~`ChatsRepository` SRP split~~ (resolved — see refactor above)
  - ~~Redundant try-catch wrappers in 50+ repository methods that could use a `safeQuery()` helper in `AbstractBaseRepository`~~ (resolved — see refactor above)
  - ~~`UsersRepository.migrateUserId` bypasses database abstraction with direct `(db as any).db` SQLite access~~
  - ~~\~45 remaining component files with 1-8 raw Tailwind violations each (colors, shadows, typography)~~ (resolved — see refactor above)
  - ~~`QueryFilter` is loosely typed across all repositories — a typed query builder would prevent runtime errors~~
  - Inconsistent error handling: some repositories throw, some return null, some return empty arrays
  - Duplicated search/replace logic between `MemoriesRepository` and `ChatsRepository` (could share a `SearchableRepository` mixin)

- refactor: Codebase cleanup and technical debt reduction
  - **Security**: Replace `exec()` with `execFile()` in data-dir route to eliminate command injection vulnerability; Linux fallback uses sequential `execFile` calls instead of shell chaining
  - **Deprecated code removal**: Remove deprecated tool-registry backwards-compatibility wrappers (`hasTool`, `hasMultiToolPlugins`, `getMultiToolPluginNames`, `registerTool`, `getTool`, `getAllTools`, `getToolNames`, `getToolMetadata`, `getAllToolMetadata`, `getToolDefinitions`, `unregisterToolsByPrefix`, `getPluginNameForTool`, `isMultiToolPlugin`); update `tool-executor.ts` to use non-deprecated `hasPlugin`, `getAllPlugins`, `getPluginNames`; rename convenience function exports to match
  - **Theme compliance**: Replace raw Tailwind classes with qt-* theme utility classes across settings components — `bg-black/50` → `qt-dialog-overlay` in 5 modal overlays; hardcoded red/yellow/blue/green alert colors → `qt-alert-error`/`qt-alert-warning`/`qt-alert-info`/`qt-alert-success` in 5 components; toggle knob `bg-white` → `bg-background`; checkbox `border-gray-300` → `border-input` in 6 chat-settings files; provider buttons → `qt-button-success`/`qt-button-primary` in ProfileForm
  - **Dead code**: Rewrite vector-store test file with 35 real tests for `CharacterVectorStore` and `VectorStoreManager` against SQLite backend, replacing skipped MongoDB placeholder tests
  - **Input validation**: Add range checking for `parseInt`/`parseFloat` query params in memories housekeeping endpoint (`maxMemories` 1-100000, `maxAgeMonths` 1-1200, `minImportance` 0-1)
  - **Code cleanup**: Inline `CHEAPEST_MODEL_MAP` reference to use `LEGACY_CHEAPEST_MODEL_MAP` directly in `cheap-llm.ts`

- feat: Theme-overridable subsystem names and Foundry card images
  - Centralized all 9 subsystem definitions (name, description, thumbnail, background) in `lib/foundry/subsystem-defaults.ts`
  - Added `SubsystemOverrides` interface and optional `subsystems` field to `ThemePlugin` in `@quilltap/plugin-types` (1.13.0)
  - Theme plugins can now override display names, descriptions, thumbnail images, and background images for any Foundry subsystem
  - Added `SubsystemOverridesSchema` to plugin manifest validation
  - Theme registry resolves relative image paths to theme asset URLs automatically
  - API `/api/v1/themes/:id?action=tokens` now returns `subsystems` overrides
  - Created `useSubsystemInfo()` and `useAllSubsystemInfo()` hooks in theme provider
  - Refactored Foundry hub page and all 8 subsystem pages to use hooks instead of hardcoded strings
  - Sidebar footer Foundry link title is now theme-overridable
  - Foundry card CSS classes (`qt-foundry-card`, `qt-foundry-card-image`, `qt-foundry-card-content`) remain fully customizable via theme `cssOverrides`
  - Themes can set `thumbnail` or `backgroundImage` to `"none"` to suppress default images
  - Subsystem pages conditionally apply `--story-background-url` only when a background image is provided
  - Foundry hub cards conditionally render the image container only when a thumbnail is provided

- feat: Old School theme — plain-English subsystem names and text-focused Foundry cards
  - Subsystem names overridden: Settings, Prompts, Data, Chat Behavior, RAG/Memories, LLM Usage, Content Filters, Appearance, Images/Backgrounds
  - Foundry cards redesigned with CSS grid: icon + title centered on left (40%), description on right (60%), gentle gradient background
  - Background images and thumbnails suppressed via `"none"` overrides
  - Old School bumped to 1.0.6

- chore: Remove all debug log statements from application source code
  - Removed ~160 `logger.debug()` and `console.debug()` call sites across 53 files
  - Covers API routes, background jobs, services, database repositories, chat/memory/tools subsystems, image generation, and plugins
  - Cleaned up orphaned logger imports left behind after removal
  - Logger infrastructure and `.debug()` method remain available for development use

- chore: Remove Ocean theme plugin
  - Deleted `plugins/dist/qtap-plugin-theme-ocean/` directory and all contents
  - Removed Ocean from Storybook theme selector, help docs, tests, and code comments

- fix: Add missing Old School default qt-* variables to Rains and Earl Grey themes
  - Both themes previously inherited ~120 unset qt-* CSS variables from Old School
    when it was the default theme; after the default changed to Professional Neutral,
    those variables picked up different values and broke the intended look
  - Copied all Old School values for missing variables into both themes so they are
    fully self-contained (alerts, badges, buttons, cards, inputs, left sidebar,
    response status, queue badges, filter chips, tabs, and more)
  - Rains bumped to 1.3.5, Earl Grey bumped to 1.3.3/1.3.2

- fix: Improve Art Deco assistant message readability with heavier font weight
  - Add `--qt-chat-assistant-font-weight` variable to qt-* component system (default: inherit)
  - Art Deco theme sets Cormorant Garamond to weight 500 (Medium) for chat messages

- feat: Replace default theme with Professional Neutral design
  - Color palette shifted from warm slate-blue (hue 220) to cool blue-gray (hue 225)
  - System font stack throughout — dropped Inter and EB Garamond in favor of OS defaults
  - Lower saturation across the board — color is for meaning, not decoration
  - Tighter, fixed border radii (0.25/0.375/0.5rem) instead of calc-based values
  - Restrained shadows and compact UI (3.5rem header/sidebar vs 4rem)
  - Sans-serif assistant chat messages (was serif)
  - Qt-* variables now scoped to `[data-theme="default"]` selector
  - Updated globals.css, default-tokens.ts, and @quilltap/theme-storybook to match

- feat: Add "The Great Estate" theme plugin with warm gold-and-mahogany palette
  - Manor house library aesthetic — mahogany (hue 20) and gold (hue 43) palette
  - Full-page background image with carbon-fibre texture overlay for tactile depth
  - Playfair Display serif headings with Inter sans-serif body text
  - Gold left border on assistant messages, brown right border on user messages
  - Black input backgrounds in dark mode, gold focus glow, uppercase buttons
  - Full light/dark mode support
  - Distributed with the app in `plugins/dist/qtap-plugin-theme-great-estate/`

- fix: Overhaul Art Deco theme — darker palette, background images, sidebar fix
  - Darken light mode palette (background 99% → 78%, cards → 75%, muted → 72%)
  - Add background images: ivory-and-gold arches (light), geometric gold-on-navy (dark)
  - Dark mode background dimmed via CSS gradient overlay for readability
  - Left sidebar uses warm ivory in light mode (was dark navy — icons were invisible)
  - Sidebar hover/active colors adjusted per mode for proper contrast

- fix: Theme background images yield to story backgrounds (Ocean, Great Estate, Art Deco)
  - When a story background (`--story-background-url`) is active, the theme's body
    background image is hidden and solid theme colors are restored on containers
  - Uses CSS `:has()` selector to detect story background presence
  - Great Estate also hides its carbon-fibre texture overlay when story bg is active

- feat: Add "Old School" theme plugin preserving the original default appearance
  - Captures the warm slate-blue (hue 220) color palette for light and dark modes
  - Bundles Inter (400/600/700) and EB Garamond (400/600/700) fonts
  - Includes all default qt-* component variable definitions
  - Distributed with the app in `plugins/dist/qtap-plugin-theme-old-school/`

- feat: Foundry Hub restructure — unified settings and tools into `/foundry`
  - New `/foundry` landing page with 8 subsystem navigation cards (Aurora, The Forge, The Salon, The Commonplace Book, Prospero, Dangermouse, Calliope, The Lantern)
  - 8 new sub-routes (`/foundry/aurora`, `/foundry/forge`, `/foundry/salon`, `/foundry/commonplace-book`, `/foundry/prospero`, `/foundry/dangermouse`, `/foundry/calliope`, `/foundry/lantern`)
  - New `CollapsibleCard` component with `qt-collapsible-card-*` CSS classes for all subsystem pages
  - Standalone wrappers for `DangerousContentSettings` and `StoryBackgroundsSettings` (self-contained with `useChatSettings()`)
  - Sidebar permanently collapsed: removed expand/collapse toggle, resize handle, and width persistence
  - Sidebar nav items now use direct `<Link>` navigation instead of button + expand pattern
  - Sidebar footer: merged Settings + Tools into single "Foundry" link
  - `/settings` now redirects to `/foundry` for backward compatibility
  - Removed `SidebarWidthControl` from Appearance settings
  - Updated all `/settings` and `/tools` references in character edit, profiles, and salon pages
  - Updated all help documentation to reference new Foundry routes

- feat: Memory Deduplication tool in Foundry
  - New tool card on `/foundry` page for finding and merging duplicate memories across all characters
  - Uses cosine similarity with configurable threshold (0.70–0.95, default 0.80) to cluster duplicates
  - Union-Find clustering identifies transitive duplicate groups
  - Best survivor selected by importance, content length, and specificity scoring
  - Novel details from discarded memories preserved as `[+]` footnotes in survivors (matching memory-gate format)
  - Groups memories by embedding dimension to handle mixed-dimension vectors safely
  - Preview mode shows per-character analysis before any changes
  - Cleans up vector store entries for removed memories
  - API: `GET /api/v1/system/tools?action=memory-dedup-preview`, `POST /api/v1/system/tools?action=memory-dedup`

- feat: Memory Gate — pre-write similarity check replaces binary duplicate detection
  - Three-tier decision at write time: REINFORCE near-duplicates (>= 0.80 similarity), LINK related-but-distinct memories (0.70–0.80), or INSERT genuinely new ones
  - Reinforced memories track observation count (`reinforcementCount`), last reinforcement time, and boosted importance (`reinforcedImportance = min(1.0, importance + log2(count+1) * 0.05)`)
  - Related memories are bidirectionally linked via `relatedMemoryIds` for thematic graph discovery
  - Novel detail extraction appends new facts as `[+]` footnotes when reinforcing existing memories
  - Housekeeping now uses `reinforcedImportance` for protection/scoring, with memories reinforced 5+ times always protected
  - Hard-cap scoring rebalanced: importance 0.4, recency 0.2, access 0.2, reinforcement 0.2
  - API supports `skipGate` option for force-insert and `relatedMemoryIds` for manual link management
  - Falls back to keyword-based gate when embeddings unavailable
  - Database migration adds 4 columns to memories table with automatic backfill

- fix: Chat messageCount now only counts visible message bubbles (USER/ASSISTANT)
  - System events, SYSTEM role messages, TOOL role messages, and context summaries no longer inflate the count
  - Added `countVisibleMessages()` helper in chats repository
  - Fixed characters API endpoint to use the same visible-only filter
  - Migration recalculates all existing chat message counts

- fix: Extract visible conversation only for all cheap LLM content-judging tasks
  - New `extractVisibleConversation()` utility filters to USER/ASSISTANT messages and strips tool artifacts (JSON, `[Tool call made]`, `[Tool Result: ...]` markers)
  - Applied to title generation, context summaries, story backgrounds, context compression, and proactive memory keyword extraction
  - Prevents tool call artifacts (vault folder listings, JSON tool results) from influencing titles, summaries, and backgrounds
  - Title generation (`titleChat`) now uses up to 100 messages weighted toward the end of the conversation instead of just the first 6, producing titles that reflect where the discussion went rather than just how it started

- feat: Uncensored fallback for empty LLM responses across all cheap LLM subsystems
  - When an LLM silently refuses content (returns empty), retries with uncensored provider in AUTO_ROUTE mode
  - Covers memory extraction (user, character, inter-character), context compression, and chat streaming
  - Extracted `sendToProvider()` in cheap-llm-tasks.ts, eliminating triple code duplication
  - New `UncensoredFallbackOptions` type and `shouldAttemptUncensoredFallback()` helper
  - Chat streaming: re-streams with uncensored provider and shows "Retrying with uncensored provider..." status
  - Empty response error message is now context-aware (distinguishes single vs double-empty failures)

- fix: Route appearance resolution through uncensored provider for dangerous chats
  - When a chat is already flagged dangerous, appearance resolution now goes directly to the uncensored cheap LLM, avoiding content refusals from safe providers
  - When the safe provider returns empty (content refusal), retries with the uncensored image prompt profile as fallback
  - `resolveCharacterAppearances()` now returns `AppearanceResolutionResult` with `llmResolved` flag to indicate whether the LLM succeeded or fell back to defaults
  - Uncensored LLM selection built once upfront in story background handler and reused for both appearance resolution and prompt crafting retries

- feat: Context-aware character appearance resolution for image generation
  - New `resolveCharacterAppearances()` cheap LLM task analyzes chat context to determine what each character currently looks like
  - Clothing priority: narrative context (highest) > image prompt > stored records by usageContext > default
  - Physical descriptions selected by best-matching usageContext for current scene
  - Dangermouse integration: appearance text classified and sanitized when no uncensored provider available
  - Chat image generation (`generate_image` tool) now fetches recent messages and resolves context-aware appearances
  - Story background generation runs scene context derivation and appearance resolution in parallel
  - Front page image generator now has Dangermouse prompt classification and AUTO_ROUTE provider rerouting
  - New `APPEARANCE_RESOLUTION` LLM log type for tracking appearance resolution LLM calls
  - Skip optimization: bypasses LLM call when characters have trivial data and no chat context
  - Fail-safe: all resolution and sanitization errors fall back gracefully to existing behavior

- feat: Add clothing records to characters
  - New `clothingRecords` embedded JSON array on characters (name, usageContext, markdown description)
  - Full CRUD API at `/api/v1/characters/[id]/clothing` and `/api/v1/characters/[id]/clothing/[recordId]`
  - New UI components: expandable card, modal editor with markdown preview, list with empty state
  - "Physical Descriptions" tab renamed to "Appearance" and now shows both physical descriptions and clothing records
  - Clothing records injected into system prompts as `## Clothing / Outfits` block after physical appearance
  - Clothing data included in image generation prompt expansion context for scene-appropriate outfit selection
  - Story background generation includes primary outfit in character descriptions
  - Backup/restore handles UUID remapping for clothing records
  - Migration adds `clothingRecords` column to existing databases

- feat: Add `usageContext` field to physical descriptions
  - New optional free-text field (up to 200 chars) describes when each appearance is most appropriate
  - Physical descriptions are now injected into chat system prompts (previously only used for image generation)
  - Usage context passed through to image generation prompt expansion for scene-appropriate appearance selection
  - Updated editor form with character counter and helper text
  - Updated card display to show usage context inline

- feat: Rename UI routes to align with internal feature naming conventions
  - `/characters` → `/aurora` (Aurora - the character model system)
  - `/chats` → `/salon` (Salon - the chat interface)
  - `/projects` → `/prospero` (Prospero - the agentic and tool-using systems)
  - `/tools` → `/foundry` (The Foundry - architecture, plugins, and services)
  - Old routes redirect to new ones to preserve bookmarks
  - API routes (`/api/v1/*`) remain unchanged
  - Updated all internal navigation, tests, help files, and documentation

- feat: Character identity reinforcement reminder appended to end of system prompt
  - Adds a short `## Identity Reminder` block as the very last content before conversation messages
  - Reminds the LLM which character it is and who it must not write for
  - Multi-character variant explicitly names all other participants
  - Placed after memories and summaries for maximum compliance near the generation boundary

- feat: Turn-order-based participant sidebar with stop button and active toggle
  - Participant sidebar now sorts participants by predicted turn order instead of static display order
  - Numbered position badges on all participants show who's speaking (#1), who's next (#2), and predicted order
  - Badge colors indicate status: green pulsing (generating), green (next), blue (queued), neutral (eligible), amber (user turn), dimmed (spoken)
  - Inactive participants now shown at the bottom of the sidebar with dimmed/greyed appearance instead of being hidden
  - Stop/interrupt button on the generating character's card replaces the composer stop button in multi-character chats
  - Active/inactive toggle pulled from hidden settings into a visible eye icon button on each card
  - Settings gear now only controls system prompt override
  - Collapsed sidebar avatars sorted by turn order with color-coded position badges
  - New `computePredictedTurnOrder` display-only utility (no turn algorithm changes)

- feat: Simplify chat settings modal and add connection profile dropdown to participant cards
  - Chat settings modal now only contains roleplay template and image generation settings
  - Per-participant settings (connection profile, system prompt override, active toggle) moved to participant sidebar cards
  - Each character card in the sidebar now has a connection profile dropdown for instant model switching
  - "User (you type)" option in dropdown allows switching characters to user control without a separate dialog
  - Gear icon on each card reveals expandable settings: system prompt override textarea and active toggle
  - System prompt override auto-saves with debounce; active toggle saves immediately
  - Connection profiles fetched once on page load for sidebar dropdowns

- fix: Update SelectLLMProfileDialog to use v1 API endpoint
  - Changed `/api/settings/connection-profiles` to `/api/v1/connection-profiles`

- feat: Proactive memory recall for chat responses
  - Characters now analyze recent conversation to recall relevant memories before responding
  - New cheap LLM task extracts search keywords from messages since the character last spoke
  - Keywords are used to search the character's memory store for contextually relevant memories
  - Pre-searched memories are passed to context builder, skipping the default single-message search
  - Works naturally in multi-character chats: each character recalls based on their own conversation gap
  - Runs in parallel with the compression cache check to minimize added latency
  - Status indicators shown in chat UI: "Analyzing recent conversation..." and "Searching {name}'s memories..."
  - Graceful fallback to existing behavior when cheap LLM is unavailable or keyword extraction fails

- refactor: Lift cheap LLM selection out of compression guard
  - Cheap LLM provider resolution now happens unconditionally instead of only when compression is enabled
  - Fixes implicit dependency where danger classification required compression to be enabled for cheap LLM access

- feat: Character pronouns
  - Characters can now have pronouns (subject/object/possessive) like he/him/his or they/them/their
  - Dropdown selector with common presets (He/Him/His, She/Her/Her, They/Them/Their, It/It/Its) plus custom option
  - Pronouns included in character's own system prompt so the LLM uses them correctly
  - Other participants' pronouns shown in multi-character chat context
  - User-controlled characters' pronouns included in "You are talking to..." line
  - Pronouns displayed inline on character view page next to name and aliases
  - New database migration adds `pronouns` column to characters table

- feat: Character aliases
  - Characters can now have alternate names (aliases) like "Liz" for "Elizabeth"
  - Aliases are included in the character's own system prompt so the LLM knows about them
  - Other participants' aliases are included when telling the LLM who else is in the chat
  - Image prompt placeholders (e.g., `{{Liz}}`) resolve aliases to the correct character
  - Alias-based name prefixes are stripped from LLM responses
  - Chip-style editor in the character edit form for managing aliases
  - Aliases displayed inline on character view page next to the name
  - New database migration adds `aliases` column to characters table

- fix: Retry story background prompt crafting with uncensored provider on empty response
  - Detect when the cheap LLM returns an empty result (silent content safety refusal) during story background prompt crafting
  - Retry with the uncensored `imagePromptProfileId` provider if configured, matching the existing pattern in image generation
  - If no uncensored profile is configured, behavior is unchanged (warn and return)

- fix: BaseModal z-index stacking issue on project pages
  - Modal dialogs (e.g., "Browse All Files") could appear behind chat cards
  - Root cause: `qt-page-container > *` creates stacking contexts that trapped modals
  - Fix: BaseModal now uses React portal to render at document body level

- chore: Upgrade @openrouter/sdk from 0.5.1 to 0.8.0
  - Wrap `chat.send()` calls with `{ chatGenerationParams: ... }` (breaking change in SDK)
  - Wrap `embeddings.generate()` calls with `{ requestBody: ... }` (breaking change in SDK)
  - Bump qtap-plugin-openrouter to 1.0.16

- security: Remove allowDangerousHtml from markdown renderer
  - Raw HTML in messages (e.g. `<script>`, `<img onerror="">`) is now escaped as literal text
  - Prevents XSS from imported chats containing malicious HTML
  - Roleplay pattern processing (post-pipeline) is unaffected

- refactor: Replace 19 empty if/else blocks across 10 repository files with debug logging
  - Adds `logger.debug()` calls for find/update/delete operations in: image-profiles, chat-settings, llm-logs, plugin-config, files, prompt-templates, vector-indices, memories, characters, connection-profiles, and roleplay-templates repositories

- fix: Standardize EmbeddingProfilesRepository.unsetAllDefaults return type
  - Changed from `Promise<boolean>` (with confusing logic) to `Promise<number>` matching ImageProfilesRepository
  - No callers used the return value; the enrichment middleware types it as `Promise<void>`

- test: Add unit tests for markdown renderer canPreRenderMessage function
  - 13 test cases covering USER, ASSISTANT, TOOL, SYSTEM roles and edge cases
  - Added Jest mock configuration for ESM-only unified/remark/rehype libraries

- fix: Story background images now pin to top of viewport instead of centering
  - Prevents faces and heads from being cropped above the header on square images
  - Applies to both chat layouts and project page containers

- fix: Danger classification re-queuing all chats on every server restart
  - System event created during classification incremented `messageCount`, but `dangerClassifiedAtMessageCount` was stored before the event — causing a permanent off-by-one that triggered re-classification of every chat on every startup
  - Reordered handler to create the system event first, then re-read the updated `messageCount` before storing the classification result

- fix: Make safe danger classification sticky unless new messages are added
  - Previously only dangerous classifications were sticky; safe chats were re-checked on every scan
  - Now safe chats skip re-classification unless `messageCount` has increased since last classification
  - Defense-in-depth: guards added in scheduled scan filter, memory trigger, and job handler

- feat: Queue status badges in page toolbar
  - Compact badge group shows active job counts for memory, summarization, danger classification, and story background queues
  - Color-coded: blue (memory), green (summary), red (danger), dark gray (story background)
  - Fully themeable via `qt-queue-badge-*` CSS variables
  - Event-driven polling: starts on route change or job enqueue, stops when all counts reach zero
  - New `activeByType` field in GET /api/v1/system/jobs response

- feat: Tag deletion in Settings
  - New "Tag Management" section in Settings > Tags tab lists all tags with usage counts
  - Delete button with confirmation popover shows how many entities will be affected
  - Deleting a tag cascades removal across all entity types

- fix: Tag deletion cascade now covers all 6 entity types
  - Previously only cascaded to characters, chats, and connection profiles
  - Now also cascades to image profiles, embedding profiles, and files
  - Added debug logging for each entity cleaned during cascade

- fix: Tag usage counts now include all entity types
  - GET endpoints for tags now count image profiles, embedding profiles, and files
  - Added `totalUsage` computed field summing all 6 entity type counts

- fix: Quick-hide dangerous chats toggle now works across entire app
  - Homepage Recent Chats, Character Conversations tab, and Project Chats sections now respect the toggle
  - Sidebar quick-hide button now appears when dangerous chats exist (previously required the toggle to already be on)

- feat: Danger indicator on all chat listings
  - Subtle destructive-colored asterisk (*) shown next to message count on dangerous chats
  - Displayed on ChatCard (chats page, project pages, character conversations), homepage recent chats, and both sidebar sections
  - `isDangerousChat` field added to all chat list API responses (chats, project chats, character chats)
  - Added to enrichment service, homepage types, and all transform functions

- fix: Danger classification not processing chats with deleted connection profiles
  - Scheduled scan now validates participant connection profile IDs against existing profiles
  - Classification handler falls back to first available profile instead of silently skipping
  - Safe chats are now re-checked when message count increases since last classification

- fix: Danger classification scoring ignoring per-category scores
  - Parser now uses the maximum of overall score and highest per-category score
  - Also respects the LLM's explicit `isDangerous: true` response
  - Any single category meeting the threshold is enough to flag the chat

- fix: Project chats sorted by metadata activity instead of last message
  - Project chats API now sorts by `lastMessageAt` instead of `updatedAt`
  - Project chats API now returns `lastMessageAt` for correct date display on ChatCard

- fix: Job queue processor can get permanently stuck on hanging LLM calls
  - Per-job execution timeout (3 minutes) via Promise.race prevents indefinite hangs
  - Periodic stuck job recovery runs every 5 minutes (previously only on startup)

- fix: Chat timestamps now always reflect the last actual message sent or received
  - `addMessage()` and `addMessages()` no longer update `lastMessageAt` or `updatedAt` for system events
  - Base repository `_update()` respects explicit `updatedAt` from callers instead of always auto-setting
  - Chats repository preserves existing `updatedAt` unless caller explicitly provides it
  - Migration `fix-chat-updated-at-timestamps-v2` resets both `updatedAt` and `lastMessageAt` on all chats to the last actual message timestamp

- feat: Startup danger classification scan and context summary chaining
  - Scheduled danger scan runs on startup and every 10 minutes to classify legacy/unclassified chats
  - Context summary → danger classification chaining: completing a summary automatically triggers classification
  - Raw message fallback: chats without a context summary are classified using concatenated messages (truncated to 4000 chars)
  - Decision tree: chats with summary → classify directly; long chats (>50 messages) without summary → generate summary first; short chats → classify from raw messages
  - Batch jobs use priority -2 (lower than interactive priority -1)
  - Background schedulers (cleanup + danger scan) wired into startup sequence
  - Graceful error handling: scan failures never block startup or other processing

- feat: Chat-level danger classification with quick-hide integration
  - Background job classifies entire chats as dangerous using compressed context summary
  - Uses existing Cheap LLM gatekeeper service for classification
  - Sticky behavior: once classified as dangerous, stays dangerous (never re-checks)
  - Re-checks when new messages are added (message count changes)
  - New database fields: `isDangerousChat`, `dangerScore`, `dangerCategories`, `dangerClassifiedAt`, `dangerClassifiedAtMessageCount`
  - Database migration: `add-chat-danger-classification-fields-v1`
  - Quick-hide sidebar integration: "Content Filters" section with "Dangerous Chats" toggle
  - Sidebar API exposes `isDangerous` on chat objects
  - Sidebar and all-chats page filter dangerous chats when toggle is active
  - `POST /api/v1/chats/[id]?action=reclassify-danger` endpoint to reset and re-queue classification
  - DANGER_CLASSIFICATION system event for token tracking
  - Automatically triggered after context summary generation in message orchestrator

- fix: Plugin loading fails in Turbopack production builds ("dynamic usage of require is not supported")
  - Replace `__non_webpack_require__` / bare `require` fallback with `createRequire` from `node:module` for Turbopack compatibility
  - Keep `__non_webpack_require__` as primary path for webpack (dev mode), `createRequire` as fallback for Turbopack/plain Node.js
  - Add `node:module` to webpack server externals and suppress `createRequire` parse warnings in `next.config.js`
  - Fixes: `plugin-initialization.ts`, `provider-registry.ts`, `next.config.js`
  
- fix: Dangerous content settings not persisting (PUT route handler missing `dangerousContentSettings` field)

- fix: Image description fallback crash (`repos.users.getChatSettings` → `repos.chatSettings.findByUserId`)

- refactor: Move "Image Prompt Expansion LLM" setting from Cheap LLM card to Dangerous Content Handling card

- feat: Dangerous content handling system
  - Gatekeeper service classifies user messages for sensitive content using the Cheap LLM
  - Three modes: Off (default), Detect Only (flag content), Auto-Route (reroute to uncensored providers)
  - Provider routing service resolves uncensored-compatible profiles for flagged content
  - Settings resolver follows existing cascade pattern (global only for v1)
  - Orchestrator integration with streaming status events (classifying, rerouting)
  - Settings UI with mode selector, threshold slider, scan toggles, profile dropdowns, display options
  - Connection profiles and image profiles gain "Uncensored-Compatible" checkbox
  - Message display with DangerFlagBadge (category badges, rerouted indicator, override button)
  - DangerContentWrapper with Show/Blur/Collapse display modes
  - Override API endpoint to mark danger flags as user-overridden
  - Database migration adds `dangerousContentSettings` to chat_settings, `isDangerousCompatible` to profiles
  - Image generation handler integration: classifies user image prompts and expanded prompts, reroutes to uncensored image providers
  - DANGER_CLASSIFICATION system event type for LLM log tracking
  - Fail-safe design: classification errors never block messages
  - Content hash caching for classification deduplication (200 entries, 5min TTL)

- fix: Story backgrounds not generated on inline title updates
  - Title updates triggered via `context-summary.ts` (the inline path after message exchanges) never queued story background generation
  - Only the unused background job handler path had the `queueStoryBackgroundIfEnabled` call
  - Exported `queueStoryBackgroundIfEnabled` from the title-update handler and call it from the inline title update path

- fix: Agent mode toggle showing "off" after navigating back to chat
  - GET `/api/v1/chats/[id]` was not returning `agentModeEnabled` in the response object
  - Frontend sync effect always received `undefined`, defaulting to `false` in the tool palette
  - Added `agentModeEnabled` to the chat GET response

- feat: Native tool execution rules injected into system prompt
  - Models with native function calling now receive explicit instructions to invoke tools via tool_use blocks rather than narrating tool actions in prose
  - Added character-voiced reinforcement after personality/scenario sections using template variables
  - Renamed `pseudoToolInstructions` → `toolInstructions` throughout the pipeline since the parameter now carries either native or pseudo-tool instructions
  - New `lib/tools/native-tool-prompt.ts` with `buildNativeToolInstructions()` function

- fix: Story backgrounds settings race condition causing data loss
  - When quickly changing multiple story backgrounds settings (enable + profile), updates could overwrite each other
  - Added useRef to track latest settings state during concurrent API calls
  - Added debug logging to chat settings repository to help diagnose future persistence issues

- fix: Markdown elements missing spacing in server-rendered chat messages
  - Headings, lists, blockquotes, and horizontal rules had no vertical spacing
  - Tailwind Typography plugin (`prose` classes) was not installed in v4
  - Added comprehensive CSS rules for all markdown elements in `.qt-chat-message-content`
  - Now both server-rendered HTML and client-rendered ReactMarkdown have consistent spacing

- fix: Server-rendered code blocks overlapping and corrupted in chat messages
  - Roleplay patterns (dialogue detection) were being applied inside code blocks, corrupting JSON strings
  - Added code block depth tracking to skip pattern application inside `<code>` and `<pre>` elements
  - Fixed missing `white-space: pre-wrap` and `line-height` on `.hljs` styled code blocks
  - Added explicit styling for `pre:has(> code.hljs)` to properly style server-rendered code
  - Removed redundant `overflow: hidden` that was clipping code block content

- fix: Story backgrounds now respect chat-specific image profile settings
  - Changed priority order: Chat profile > Story backgrounds default > User default
  - Previously, global story backgrounds default always took precedence over chat-specific settings
  - Now, if a chat has an image profile configured, it will be used for that chat's backgrounds

- fix: Chat image profile setting not loading in Chat Settings modal
  - GET /api/v1/chats/[id] was not returning imageProfileId in the response
  - Added imageProfileId to the chat response object

- fix: Failed background jobs blocking new job creation for the same chat
  - `findPendingForChat` no longer includes FAILED jobs in the "pending" check
  - Users can now trigger new jobs after fixing underlying issues (e.g., changing provider)
  - Improved logging to distinguish between new jobs and reused existing jobs
  - `enqueueStoryBackgroundGeneration` now returns `{ jobId, isNew }` for better caller feedback

- fix: Thumbnail cache misses logging as errors
  - Changed thumbnail handler to use `fileExists` check before attempting download
  - Prevents noisy error logs when thumbnails haven't been generated yet
  - Thumbnails are still generated on-demand and cached for future requests

- feat: Story backgrounds now derive scene context from chat history
  - Added `deriveSceneContext` cheap LLM task that analyzes recent messages
  - Generates imaginative scene descriptions based on conversation content
  - If discussing a book or story, characters may be depicted as observers to that world
  - Falls back to chat title if context derivation fails or no messages exist
  - Logs derived context for debugging in background job handler

- fix: Search and Replace now searches all memory fields (content, summary, keywords)
  - Memory search previously only searched content and summary fields
  - Now also searches and replaces text within the keywords array
  - Added `jsonArrayContainsLike` utility for SQLite LIKE queries on JSON arrays
  - Fixed RegExp to LIKE pattern conversion in SQLite query translator

- feat: Search and Replace now refreshes data after completing
  - Character view page refreshes Conversations and Memories tabs when changes are made
  - Chat page refreshes messages when search-replace updates them
  - Added `onComplete` callback to SearchReplaceModal
  - Added `refreshKey` prop to MemoryList and CharacterConversationsTab components

- feat: Unified ChatCard component for consistent chat list display
  - Created reusable ChatCard component used across /chats, /projects/[id], and /characters/[id]/view
  - Configurable via props: showAvatars, showProject, showPreview, useRelativeDates, actionType
  - Supports both delete (permanent) and remove (unlink from project) actions
  - Includes highlight animation for newly imported chats
  - Chat cards now display story background thumbnails instead of avatar stacks when available
  - Story background thumbnails stretch to fill card height with cover fit

- feat: Story background support on project detail pages
  - Project pages now display story backgrounds based on backgroundDisplayMode setting
  - Uses useStoryBackground hook to fetch and render background via CSS variable
  - Added story background support to qt-page-container CSS class
  - Background renders as semi-transparent fixed layer behind page content

- feat: Story background thumbnails in chat enrichment
  - Added storyBackground field to EnrichedChatSummary in chat enrichment service
  - Project chats API now returns storyBackground for each chat
  - Character chats API now returns storyBackground for each chat

- fix: Race condition in plugin initialization causing "Provider not found" errors in Docker
  - Moved `initialized = true` flag to after all registries (provider, theme, tool) are initialized
  - Previously, the flag was set too early, causing concurrent calls to `initializePlugins()` to return before provider registry was ready
  - Fixes story background generation failing with "Provider 'OPENROUTER' not found in registry" in production

- refactor: Image profile moved from per-participant to per-chat level
  - Each chat now has a single image profile (or none) shared by all participants
  - Image profile selector moved to Chat Settings (below Roleplay Template)
  - Removed per-character image profile selector from participant settings
  - New chat creation page now has a single image profile dropdown
  - Migration automatically populates chat's imageProfileId from first participant
  - Story backgrounds now use chat-level image profile
  - API: `imageProfileId` field added to chat create/update requests

- feat: Story Backgrounds - AI-generated atmospheric background images for chats
  - When enabled, generates landscape scene images featuring characters after chat title updates
  - Background images use 45% opacity behind chat content for atmosphere
  - Configure in Settings > Chat Settings > Story Backgrounds
  - Select image profile for generation (defaults to user's default profile)
  - API endpoints: `GET /api/v1/chats/[id]?action=get-background`, `GET /api/v1/projects/[id]?action=get-background`
  - Projects support multiple display modes: theme, static, project, or latest chat background
  - New database fields: `storyBackgroundImageId`, `lastBackgroundGeneratedAt` on chats
  - New CSS: Story background ::before layer on `.qt-chat-layout`, semi-transparent content overlay
  - Manual regeneration via "Regenerate Background" button in chat tool palette
  - Background auto-updates after generation completes (polling mechanism)
  - Chat header shows clickable thumbnail of story background (opens full-screen modal)
  - Duplicate job prevention: skips if background generation already pending for chat
  - Uses Image Prompt Expansion LLM setting for prompt crafting

- fix: ImageModal now renders via React Portal to resolve z-index stacking context issues
  - Modal buttons (download, tag, delete) now always visible above page header/sidebar
  - Uses `createPortal` to render at document body level

- fix: SQLite backend improvements for background job processing
  - Added `$expr` operator support for field-to-field comparisons in query translator
  - Fixed `findOneAndUpdate` to correctly return updated document by ID
  - Resolves issues with job queue claiming and processing

- perf: Server-side markdown pre-rendering for chat messages
  - Simple messages (no tools, no attachments) are now pre-rendered to HTML on the server
  - Pre-rendered HTML is returned in the API response and rendered directly without client-side processing
  - Significantly reduces CPU load when scrolling through long chats
  - Complex messages with embedded tools or attachments fall back to client-side rendering
  - Roleplay patterns (dialogue, narration, OOC) are applied server-side for pre-rendered messages
  - Added `renderedHtml` field to message schema for pre-rendered content
  - New markdown renderer service using unified/remark/rehype pipeline
  - Added highlight.js CSS styling for server-rendered code blocks

- feat: Chat composer tool palette revamp
  - Reorganized hamburger menu into four labeled sections: Chat, Organize, Edit Content, Memory
  - Added composer gutter tools: Attach, Generate Image, and RNG now accessible as icon buttons
  - RNG icon changed from abstract cube to recognizable dice face with pips
  - Preview toggle moved to formatting toolbar (document editing mode)
  - New horizontal toolbar layout with gutter tools on left, hamburger/doc-mode buttons closer to textarea
  - Tool palette popover now aligns with hamburger button, not gutter tools
  - Full-width mode now properly expands composer textarea to fill available space
  - New CSS classes: `.qt-composer-gutter-tools`, `.qt-composer-gutter-button`, `.qt-tool-palette-popover`, `.qt-tool-palette-section-header`, `.qt-tool-palette-section-content`
  - RngDropdown component now supports `variant` prop for palette vs gutter styling

- feat: RNG dropdown improvements
  - Dice roll options (d6, d20) now have up/down spinner buttons to adjust count
  - Removed redundant "Roll 2d6" option since count is now adjustable
  - Dice counts persist within the dropdown session

- feat: Tool message UI improvements
  - Tool messages now embedded inside message bubbles (assistant or user)
  - User-initiated tools (RNG, etc.) embed in user messages, not assistant messages
  - Character-initiated tools embed in assistant messages
  - Collapsed state shows truncated preview text for request/response
  - Text content now wraps properly instead of horizontal scrolling
  - Copy buttons added for tool request and response sections
  - Image copy to clipboard button for generated images
  - Compact embedded layout for better visual integration
  - Consistent vertical spacing between all messages

- feat: Agent Mode per-chat toggle in Tool Palette
  - Agent Mode button now connected and fully functional in chat tool palette
  - Clicking Agent button toggles agent mode on/off for the current chat
  - Toggle status persists in database and is reflected across UI
  - API endpoint: `POST /api/v1/chats/[id]?action=toggle-agent-mode`
  - Logging for all agent mode toggle operations at info level
  - State management synced from chat data when page loads

- feat: Agent Mode - iterative tool use with self-correction
  - LLMs can now use tools iteratively, verify results, and self-correct before delivering final response
  - New `submit_final_response` tool signals completion of agent work
  - Configurable max turns (1-25, default 10) with force-final safety limit
  - Settings cascade: Global > Character > Project > Chat (each level can override)
  - Global settings in Settings > Chat: default enabled toggle and max turns
  - Per-chat toggle in tool palette (Agent button)
  - New SSE events: `agent_iteration`, `agent_completed`, `agent_force_final`
  - New help documentation: `/help/agent-mode`
  - Migration automatically adds required database columns
