# Quilltap Changelog

## Recent Changes

### 2.10-dev

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

### 2.9.0

- docs: Comprehensive documentation updates for accuracy and completeness (2026-02-03)
  - Updated About page to match README: new tagline, expanded description, reorganized features list
  - Removed authentication references from About page (OAuth, TOTP 2FA removed)
  - Added quilltap.ai link to About page
  - Changed file storage description from "S3-compatible" to "Local filesystem" (default)
  - Updated API.md version from v2.8 to v2.9
  - Added 6 new API documentation sections: Chat Settings, Models, Files (v1), System Backup & Restore, System Data Directory, System Mount Points
  - Marked legacy endpoints (Files & Images, Tools & Backup) in Table of Contents
  - Updated DEVELOPMENT.md: MinIO now optional, local filesystem is default
  - Clarified auth as "single-user mode" in DEVELOPMENT.md project structure
  - Updated plugin types list in DEVELOPMENT.md (removed Auth Providers, added Storage Backends, Roleplay Templates, Tool Providers)
- fix: Complete relationship remapping in native import/export system (2026-02-03)
  - Character fields now remapped: `defaultConnectionProfileId`, `defaultImageProfileId`, `defaultRoleplayTemplateId`
  - Chat participant `roleplayTemplateId` now remapped (preserves plugin template references)
  - Profile tags now reconciled: connection profiles, image profiles, embedding profiles
  - Roleplay template tags now reconciled on import
  - Memory fields now remapped: `projectId`, `tags`
  - Added comprehensive test coverage for all new remapping functionality
- refactor: Remove S3/cloud backup functionality from backup system (2026-02-03)
  - Backup system now only supports local file download
  - Removed S3 destination option from backup dialog
  - Removed cloud backups list and selection from restore dialog
  - Removed `downloadBackupFromS3`, `saveBackupToS3`, `listS3Backups`, `deleteBackupFromS3` functions
  - Simplified restore API to only accept file uploads (no S3 key)
  - Updated BACKUP-RESTORE.md documentation to reflect changes
  - Users who need cloud backups can use external backup scripts with the downloaded ZIP
- fix: Temporary backup download failing due to HMR invalidating in-memory storage (2026-02-03)
  - Moved temporary backup storage to a dedicated module using globalThis
  - Storage now survives Next.js hot module reloading in development
  - Created `lib/backup/temporary-storage.ts` with singleton pattern
- feat: Complete backup system now includes plugin configs and npm plugins (2026-02-03)
  - Backup now includes plugin configurations from `plugin_configs` table
  - Backup now includes npm-installed plugins from `plugins/npm/` directory
  - Restore recreates plugin configs and extracts npm plugins
  - Manifest counts now include `pluginConfigs` and `npmPlugins`
  - Restore summary shows plugin restoration counts
  - This enables full system recreation from a single backup file
- feat: Add data directory section to profile page (2026-02-03)
  - Shows data directory location, configuration source, and platform
  - "Open in File Browser" button opens the directory in the native file explorer (macOS/Windows/Linux)
  - Copy button to copy the path to clipboard
  - Docker environments show helpful message about accessing data via host volume mounts
  - New API endpoint: GET/POST /api/v1/system/data-dir
- fix: Docker build failures from npm lockfile issues (2026-02-03)
  - Upgrade npm in Docker base image to fix "Invalid Version" bug in npm 10.x
  - Change @quilltap/plugin-types dependency from file: reference to npm package
  - Regenerate package-lock.json in Linux container to fix malformed platform-specific entries
  - Update deprecated --only=production to --omit=dev syntax
- test: Update e2e tests for single-user mode and stability (2026-02-02)
  - Use production build for more stable e2e test runs
  - Create fresh temp data directory for each test run
  - Remove authentication code (single-user mode)
  - Update API routes to /api/v1/ prefix
  - Remove deprecated persona tests
  - Add retry logic for flaky page loads
  - Use Ollama with llama3.2 as default test provider
- refactor: Embedding service now uses plugin architecture (2026-02-02)
  - Embedding providers now delegate to plugins via `createEmbeddingProvider()` factory method
  - Added `EmbeddingProvider` interface support to `LLMProviderPlugin`
  - Created `OpenAIEmbeddingProvider` class in qtap-plugin-openai
  - Created `OllamaEmbeddingProvider` class in qtap-plugin-ollama
  - OpenRouter already had `OpenRouterEmbeddingProvider`, verified working
  - Built-in TF-IDF provider already implemented as `LocalEmbeddingProvider`
  - Registry now has `createEmbeddingProvider()` method matching `createImageProvider()` pattern
  - Plugin factory exports `createEmbeddingProvider()` and `getAllAvailableEmbeddingProviders()`
  - Removed hardcoded provider handlers from embedding-service.ts
  - Updated plugin versions: openai 1.0.16, ollama 1.0.10
- feat: Grok plugin migrated to xAI Responses API (2026-02-02)
  - Migrated from deprecated Chat Completions API to Responses API (`/v1/responses`)
  - Uses direct HTTP (fetch) instead of OpenAI SDK for chat (SDK doesn't support Responses API)
  - Added new models: grok-4, grok-4-1-fast (2M context), grok-3, grok-3-mini, grok-2-1212, grok-code-fast-1
  - Web search now uses server-side tools (web_search, x_search) instead of deprecated Live Search API
  - Image format changed from `image_url` to `input_image` for Responses API compatibility
  - Always uses `store: false` for stateless operation (Quilltap manages history locally)
  - Updated cheapModels to use grok-3-mini as default
  - Image generation model updated to grok-2-image
  - Plugin version bumped to 1.0.14
- refactor: Dead code removal and qt-* theme class standardization (2026-02-02)
  - Removed unused functions from lib/avatar-styles.ts: getAvatarAspectRatioStyle, getAvatarMarginClass
  - Removed unused function from lib/chat/connection-resolver.ts: hasResolvableConnectionProfile
  - Removed unused exports from lib/chat-files-v2.ts: deleteChatFileById, getChatFileById, readChatFileBuffer, getSupportedMimeTypes
  - Documented that formatToolResult() in tool-executor.ts is unused (actual formatting in context-builder.service.ts)
  - Converted hard-coded Tailwind colors to qt-* utility classes in roleplay-templates, housekeeping-dialog, AvatarStack, tags-tab
  - Added qt-border-*\/30 opacity variants for status colors (success, warning, destructive, info)
  - Added hover:qt-bg-*\/10 variants for status colors
  - Theme plugins now properly control all status colors via CSS variables
- fix: Compression cache invalidated incorrectly in multi-character chats (2026-02-02)
  - Cache validation was comparing filtered message count (only `type === 'message'`) against raw event count (includes tool results, system events)
  - This caused cache to appear "too stale" with 100+ message difference when there were only a few new messages
  - Now uses consistent message counting (filtered to `type === 'message'`) for both persisting and validating cache
  - Multi-turn conversations with tool calls (RNG, state, MCP) now properly benefit from compression caching
- perf: Compression cache fallback for faster responses when async not ready (2026-02-02)
  - When async pre-compression isn't ready, falls back to previous cache instead of waiting
  - Dynamic window calculation ensures no messages are lost when using older cache
  - Trade-off: slightly more tokens (larger window) for faster response time
  - New `CachedCompressionResponse` type with metadata for fallback detection
  - Returns `cachedMessageCount` and `isFallback` for debugging and dynamic window sizing
  - Context manager calculates effective window size when cache is behind current message count
- feat: Chat response status indicator showing processing stages (2026-02-02)
  - Visual indicator in chat composer shows current stage during AI response generation
  - Stages: compressing (blue), gathering (purple), building (amber), sending (blue), streaming (green), tool_executing (purple)
  - Uses QuillAnimation component for streaming stage, pulsing icon for other stages
  - Stage-specific colors for light and dark modes via CSS custom properties
  - Accessible with role="status" and aria-live="polite" for screen readers
  - Respects prefers-reduced-motion for users who prefer less animation
  - Status clears automatically on completion, error, or abort
- perf: Fix compression cache timing issue causing slow message responses (2026-02-02)
  - Pre-compression now triggers immediately after assistant message is saved, not after all async work
  - Previously, pre-compression started after memory extraction and context summary checks (68+ seconds delay)
  - Now runs in parallel with memory extraction, giving maximum time to complete before next message
  - Added system prompt hash validation to cache retrieval for better cache validity checks
  - Added debug logging for cache hit/miss reasons (message count mismatch, hash mismatch)
  - Compression cache now persists to database, surviving server restarts
  - New `compressionCache` column added to chats table via migration
  - Cache lookup order: in-memory (fastest) -> database (survives restarts) -> sync compression (fallback)
  - Relaxed cache validation: allows up to 50 new messages (was strict count match)
  - Chats with many tool calls (RNG, state) now benefit from caching between turns
- style: Add more spacing above user messages in chat (2026-02-02)
  - User message rows now have 1.5rem top margin for better visual separation from previous messages
- feat: Chat State for persistent JSON storage (2026-02-02)
  - New `state` field on chats and projects for storing persistent JSON data
  - Database migration adds state column to chats and projects tables
  - New built-in LLM tool `state` for fetch/set/delete operations
  - Path syntax supports dot notation and array indexing (e.g., "player.health", "inventory[0].name")
  - Inheritance model: chat state overrides project state for chats in projects
  - Underscore-prefixed keys (e.g., `_notes`) are protected from AI modification
  - New StateEditorModal component for viewing/editing state in UI
  - State button added to chat ToolPalette (database icon)
  - Project State section added to project settings card
  - API endpoints: GET/PUT/DELETE ?action=get-state/set-state/reset-state for both chats and projects
  - Added help documentation (help/chat-state.md)
- feat: Auto-detect RNG patterns in user and assistant messages (2026-02-02)
  - Dice notation (e.g., "2d6", "d20", "3d10") is detected and executed automatically
  - Coin flip phrases (e.g., "flip a coin") trigger automatic coin flips
  - "Spin the bottle" phrases randomly select a chat participant
  - Works on both user messages (results appear before message) and assistant responses (results appear after)
  - When a character says "I roll 2d6", the dice actually get rolled
  - New `autoDetectRng` chat setting (default: true) in Settings > Chat Settings > Automation
  - Can be disabled for users who prefer manual tool invocation
  - Updated help documentation for RNG tool and chat settings
- fix: User-initiated tool results not sent to LLM (2026-02-02)
  - Tool results from RNG and other user-run tools were saved to DB but not included in LLM context
  - Root cause 1: Field name mismatch - user tools stored `tool` but context builder read `toolName`
  - Root cause 2: `existingMessages` was loaded before tool results were saved, so they weren't included
  - Fix: Context builder now checks both `toolName` and `tool` fields
  - Fix: Orchestrator now adds saved tool messages to `existingMessages` array
  - Added debug logging for tool result handling in context builder and chat page
- fix: Virtualizer positioning bug when messages are replaced (2026-02-02)
  - Messages would appear in wrong positions (overlapping) after sending
  - Root cause: virtualizer used indices as keys, so measurement cache became stale when `fetchChat()` replaced the messages array
  - Fix: Added `getItemKey` to virtualizer to use message IDs instead of indices
  - Now measurements properly track items across array replacements
- fix: Pending tool results not persisting to database (2026-02-02)
  - Tool messages shown in composer would disappear after chat refresh
  - Root cause: API route parsed `pendingToolResults` but didn't pass it to orchestrator
  - Fix: Added missing `pendingToolResults` parameter in messages API route
- feat: Pending tool results shown in composer before sending (2026-02-02)
  - User-initiated tool calls (like RNG) now show results as chips in the composer
  - Results can be removed before sending using the X button
  - Full result details shown in tooltip on hover
  - RNG API updated with `preview` mode to return results without creating messages
  - Tool messages are created when the user sends their message
  - Distinct visual styling for tool result chips vs file attachment chips
- style: Tool message spacing and styling (2026-02-02)
  - Added `qt-chat-message-row-tool` CSS class for tool messages
  - Tool messages now have vertical margin (1rem top and bottom) for visual separation
- feat: RNG (Random Number Generator) tool for dice rolls, coin flips, and spin the bottle (2026-02-02)
  - New built-in LLM tool `rng` for generating random results in chats
  - Supports dice rolls with any number of sides (2-1000), coin flips, and random participant selection
  - Results are permanent chat messages visible to all characters
  - Manual invocation via RngDropdown in ToolPalette with quick options (d6, d20, 2d6, coin, bottle)
  - Custom roll interface for arbitrary dice configurations
  - Uses cryptographically secure random numbers
  - Added help documentation (help/rng-tool.md)
  - Added POST /api/v1/chats/[id]?action=rng API endpoint
- refactor: Tools are now sent with every LLM prompt (2026-02-02)
  - Removed periodic tool re-injection logic that only sent tools every N messages
  - Tools are now always included in every LLM request for consistent availability
  - `forceToolsOnNextMessage` flag is retained only to trigger tool change notifications
- feat: Image provider prompting guidance and style trigger phrases (2026-02-01)
  - Added `promptingGuidance` field to `ImageProviderConstraints` for provider-specific prompting tips
  - Added `styleInfo` field with `ImageStyleInfo` interface for style/LoRA details and trigger phrases
  - Chat LLM now receives provider-specific guidance in the image generation tool description
  - Cheap LLM prompt crafting now incorporates style trigger phrases when generating expanded prompts
  - Updated `@quilltap/plugin-types` to v1.12.0 with new interfaces
  - Removed React peer dependency from plugin-types (deprecated `renderIcon` now returns `unknown`)
  - Updated PROVIDER_PLUGIN_DEVELOPMENT.md with documentation for new features
- chore: Update plugin dependencies (2026-02-01)
  - Updated @anthropic-ai/sdk to ^0.72.1
  - Rebuilt bundled plugins with latest dependencies
- chore: Add ESLint rule to catch "Quilttap" misspellings (2026-02-01)
  - Custom ESLint rule flags "Quilttap" (with double-t) as an error
  - Helps prevent common misspelling of project name throughout codebase
  - Rule checks string literals and template strings across all source and markdown files
- refactor: Plugin icon system redesigned to remove React dependency (2026-02-01)
  - Plugins now provide SVG data via `icon` property instead of React components via `renderIcon`
  - Added `PluginIconData` interface to `@quilltap/plugin-types` v1.10.0
  - `renderIcon` is now optional and deprecated (kept for backwards compatibility)
  - Removed `react` peer dependency from all bundled provider plugins
  - ProviderIcon component renders SVG data from plugins with fallback to abbreviation
  - External plugins no longer need React just for icons
- fix: "Import from Template" modal now shows templates correctly (2026-02-01)
  - Fixed prompt-templates response handling to extract `.templates` array
  - Added `?all=true` parameter to sample-prompts API for flattened prompt list
  - Sample prompts now return correct structure (content, modelHint, category, filename)
- fix: Normalize LLM responses wrapped in content block format (2026-02-01)
  - Some LLM providers return responses wrapped in `[{'type': 'text', 'text': "..."}]` format
  - Added `normalizeContentBlockFormat()` utility to extract the actual text content
  - Applied normalization in streaming service and orchestrator
  - Handles both Python-style single quotes and JSON double quotes
- feat: AI Wizard shows real-time generation progress (2026-02-01)
  - Each field now shows a checkmark and snippet as it completes
  - Progress updates stream in real-time via Server-Sent Events
  - Shows current field being generated with spinner
  - Displays error messages inline for failed fields
  - Added `POST /api/v1/characters?action=ai-wizard-stream` streaming endpoint
- feat: AI Wizard can upload documents as character source (2026-02-01)
  - New "Upload a document" option in Physical Description Source step
  - Supports text (.txt), Markdown (.md), and PDF files
  - Document content is extracted and used as context for character generation
  - Uses existing file-content-extractor service for text/PDF parsing
  - Added `/api/v1/files?action=upload` endpoint for multipart file uploads
  - Updated help documentation with new option
- feat: AI Wizard can now generate character names (2026-02-01)
  - AI Wizard button on character creation page no longer requires a name first
  - Added "Name" as a generatable field in the AI Wizard (appears at top of field list)
  - Enables creating completely random characters with AI-generated names
  - Name is generated first and used as context for subsequent field generation
  - Updated help documentation for character creation wizard workflow
- fix: Include help-bundle.msgpack.gz in repository for CI tests (2026-02-01)
  - Removed from .gitignore so the pre-built bundle is available in GitHub Actions
  - Fixes test failures in help-search-handler.test.ts that depend on the bundle file
- feat: Built-in search_help LLM tool (2026-01-31)
  - New tool allows LLMs to search Quilltap help documentation during conversations
  - Uses semantic search when OPENAI_API_KEY is available, keyword fallback otherwise
  - Always enabled by default - helps users understand Quilltap features
  - Loads pre-computed embeddings from help-bundle.msgpack.gz
  - Added to BUILT_IN_TOOLS in tool-executor.ts, plugin-utils, and tools API route
  - Visible in chat tool settings UI under "Built-in" category
- docs: Comprehensive startup wizard guide (2026-01-31)
  - Complete rewrite of `help/startup-wizard.md` with step-by-step setup instructions
  - Covers choosing AI providers: Ollama, OpenRouter, OpenAI, Anthropic, and OpenAI-compatible
  - Step-by-step instructions for getting API keys from each provider
  - Guide to adding API keys and creating connection profiles
  - Embedding setup: built-in TF-IDF vs external providers
  - Cheap LLM configuration for background tasks
  - First chat walkthrough with troubleshooting section
  - Quick reference table with direct links to all settings pages
- docs: Add page links to all help files (2026-01-31)
  - Every help file now includes a prominent link to the corresponding app page
  - Format: `> **[Open this page in Quilltap](/path)**` after the main heading
  - Settings pages include `?tab=` parameter to navigate directly to the correct tab
  - Tab mappings: keys, profiles, chat, appearance, image-profiles, embedding-profiles, plugins, storage, tags, templates, prompts
- docs: Comprehensive projects functionality user documentation (2026-01-31)
  - Added `help/projects.md` - Main projects overview with creation, organization, and best practices
  - Added `help/project-files.md` - File management, supported types, AI access, and organization
  - Added `help/project-chats.md` - Chat association, context injection, and project tools
  - Added `help/project-characters.md` - Character roster, access modes, and cast management
  - Added `help/project-settings.md` - Instructions, storage, tools, and configuration options
  - Covers project instructions, file semantic search, roster mode, and mount point configuration
- docs: Comprehensive chat functionality user documentation (2026-01-31)
  - Added `help/chats.md` - Main chat overview with basic operations and navigation
  - Added `help/chat-multi-character.md` - Multi-character chat setup and management
  - Added `help/chat-turn-manager.md` - Turn system, speaker selection, and queue management
  - Added `help/chat-participants.md` - Participants sidebar controls and features
  - Added `help/chat-message-actions.md` - Message editing, swipes, deletion, and bulk actions
  - Covers impersonation, talkativeness, nudge/queue, all-LLM auto-pause, and memory cascade
- refactor: Replace JSON help embeddings with gzipped MessagePack bundle (2026-01-31)
  - New build script `npm run build:help` generates `public/help-bundle.msgpack.gz`
  - Bundle uses whole-document embeddings (1 per file) instead of heading-based chunks
  - Reduced bundle size from ~24MB JSON to ~3-4MB compressed MessagePack
  - Added `lib/help-search.ts` runtime loader with semantic search via cosine similarity
  - Removed old `scripts/embed_help_files.ts` script
- refactor: Rename auth middleware to context middleware (2026-01-30)
  - Renamed `createAuthenticatedHandler` → `createContextHandler`
  - Renamed `createAuthenticatedParamsHandler` → `createContextParamsHandler`
  - Renamed `AuthenticatedContext` → `RequestContext`
  - Renamed `withAuth` → `withContext`, `withAuthParams` → `withContextParams`
  - Replaced `checkOwnership` with simpler `exists` type guard (ownership check meaningless in single-user mode)
  - Legacy aliases maintained for backward compatibility
  - Updated tests and documentation
