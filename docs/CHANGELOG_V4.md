# Changelog Changelog v4.x

## Historical Changes

### 4.2.0

#### Changed

- **OpenRouter Plugin (1.0.30)**: Added image generation provider enabling image creation through OpenRouter-proxied models (Gemini, GPT-5 Image, etc.) via the chat completions API with `modalities: ["image", "text"]` and `image_config` parameters. Includes dynamic model discovery using `output_modalities` metadata, graceful handling of model refusals, and support for aspect ratio and quality settings. Fixed manifest capabilities to correctly declare `imageGeneration`, `embeddings`, and `webSearch` as enabled (were incorrectly set to `false`). Improved image model discovery in pricing fetcher to check `output_modalities` array (OpenRouter's documented field) in addition to `architecture.outputModality` and `supported_generation_methods`. Updated fallback image model list to include OpenAI models alongside Gemini.

- **@quilltap/plugin-types 2.2.0**: Removed `ROLEPLAY_TEMPLATE` from `PluginCapability` type, deprecated roleplay template type exports from barrel. Types preserved in `./plugins/roleplay-template` for backward compat.
- **@quilltap/plugin-utils 2.2.0**: Removed roleplay template builder utilities (`createRoleplayTemplatePlugin`, `createSingleTemplatePlugin`, `validateTemplateConfig`) from main exports and `./roleplay-templates` export path. Updated `@quilltap/plugin-types` dependency to ^2.2.0.
- **Dependencies**: next 16.2.2→16.2.3, openai 6.33→6.34, react/react-dom 19.2.4→19.2.5, @google/genai 1.48→1.49, storybook 10.3.4→10.3.5, @types/node 22.19.15→22.19.17, dotenv 17.4.0→17.4.1
- **API.md**: Added documentation for wardrobe (archetypes), character wardrobe, outfit presets, character plugin data, chat avatars, chat state, chat wardrobe/outfits, chat tools/automation, and images API routes; updated version reference to v4.2+
- **README.md**: Updated Core Features with wardrobe system, character plugin metadata, native roleplay templates, per-conversation avatar generation, and project default image profiles
- **DEVELOPMENT.md**: Updated roleplayTemplates table description to reflect native template system
- **help/chat-settings.md**: Added Per-Conversation Avatar Generation section
- **4.2.0 Release Notes**: Added manual avatar regeneration, default image generation profile for projects, character plugin data sections, OpenRouter image generation, seed character wardrobe items; corrected plugin package versions to 2.2.1
- **Tool Palette Reorganization**: Moved Roleplay Template dropdown from Chat Settings modal into the Edit Content section of the tool palette for quicker access. Moved State to the Organize section. Merged Memory actions (Re-extract, Delete) into the Edit Content section, removing the separate Memory section.
- Outfit indicator now renders above talkativeness slider for LLM characters in participant sidebar
- Shared/archetype wardrobe items now appear in sidebar outfit dropdowns with "(shared)" label
- System prompt clothing section now shows slot-based outfit state instead of monolithic descriptions (falls back to legacy format when no wardrobe items exist)
- Appearance resolution for image generation prefers equipped wardrobe items over legacy clothing records
- perf: Memories tab on character pages now uses paginated loading with infinite scroll instead of loading all memories at once
- chore: Add `all` mode to remove-old-dev-tags Claude command for removing every dev tag, release, and Docker image
- docs: Add system flowcharts (Mermaid) documenting prompt assembly, memory extraction pipeline, scene tracking, story background generation, and Concierge content routing
- test: Expand unit and regression coverage for wardrobe tools, text-block tool mode, and 4.1 memory repair/timestamp fixes
- test: Add regression coverage for character plugin data APIs, avatar regeneration, wardrobe image analysis, project image profile resolution, and OpenRouter image generation behavior
- Lorian and Riya seed characters now include default wardrobe items matching their physical descriptions; clothing and accessories removed from physical description fields to avoid duplication with the wardrobe system

#### Refactored

- **Roleplay Template System**: Replaced the plugin-based roleplay template architecture with a native JSON-based template system. The `qtap-plugin-template-quilltap-rp` plugin is now a built-in "Quilltap RP" template alongside "Standard". Templates use a new `delimiters` array (replacing `annotationButtons`) with `name`, `buttonName`, `delimiters`, and `style` fields. The `ROLEPLAY_TEMPLATE` plugin capability has been removed entirely. DB migration rewrites all `plugin:quilltap-rp` references to the new built-in template UUID, renames `annotationButtons` column to `delimiters`, and drops the `pluginName` column. Create/edit dialog now includes a full delimiter array editor with add/remove controls. Import handles backward compatibility with old `annotationButtons` format. Rendering patterns are auto-generated from delimiters when not explicitly provided, ensuring custom templates get proper text styling without manual regex configuration.
- **Persona References Removed**: Comprehensive removal of all "persona" and "PERSONA" references from the codebase (except SillyTavern import/export compatibility). User-controlled characters are now the sole concept — no more legacy PERSONA type, no more fallback code paths. Renamed `persona` → `userCharacter` across the entire message pipeline (types, orchestrator, context builder, system prompt builder, template processor), `personaName` → `userCharacterName` in memory extraction, `getFirstPersona` → `getFirstUserCharacter` in salon hooks, `addPersona`/`removePersona` → `addPartnerLink`/`removePartnerLink` in character repository. Removed deprecated `findByPersonaId` from memories repository. CSS badge variables renamed `--qt-badge-persona-*` → `--qt-badge-user-character-*` across all 5 bundled themes, storybook, and create-quilltap-theme template. Updated all help docs, plugin README, and component props. `{{persona}}` template variable retained for SillyTavern template compatibility. DB migration renames `characters.personaLinks` → `partnerLinks` (with inner `personaId` → `partnerId`) and drops `memories.personaId` (data already in `aboutCharacterId`).

#### Fixed

- **User Character Default Outfit on Chat Creation**: When starting a new chat, user-controlled characters (e.g., the player character) now get their default wardrobe items equipped automatically. Previously only LLM-controlled characters received default outfits — user characters were excluded both from the fallback path and when the frontend sent explicit outfit selections for LLM characters only.
- **Narration Delimiters Migration**: Fixed the `narrationDelimiters` column migration not running — the migration was imported and exported but never added to the `migrations` array, causing `no such column: narrationDelimiters` errors on all roleplay template operations
- **Roleplay Template Error Reporting**: Improved error handling in roleplay template save/delete operations — `res.json()` in error paths now handles non-JSON responses gracefully, error messages include HTTP status codes, and console logging shows the actual message instead of an opaque `{}`
- **Document Mode Narration Button**: The formatting toolbar in Document Mode now always shows a "Nar" button derived from the roleplay template's `narrationDelimiters` field, and removes any redundant annotation button whose prefix/suffix matches the narration delimiters
- **Run Tool: Wardrobe Action Notices**: Fixed wardrobe action notices not appearing for user-invoked `update_outfit_item` and `create_wardrobe_item` calls from the Run Tool modal — tool result payloads now preserve their structured metadata so the inline amber summary renders correctly instead of collapsing into raw JSON
- **Memory Cleanup: Accurate Max Memories Label**: Changed "Max Memories" / "Hard cap on total memories" to "Maximum Unprotected Memories" with a list of the protection rules (importance ≥ 70%, reinforced 5+ times, manually created, accessed within 3 months), since the hard cap does not delete protected memories
- **LLM Inspector: Image Generation Logging**: Image generation API calls (character avatars, story backgrounds, in-chat image tool) are now logged in the LLM Inspector with chat/character linkage, provider, model, prompt, duration, and error tracking
- **Outfit Description Consistency**: Centralized all wardrobe outfit descriptions into a single `describeOutfit()` utility with clear rules for null slots (null = empty, not "default"). Replaced 6 scattered implementations that had inconsistent behavior — some assumed defaults for empty slots, others omitted them entirely. Outfit Change Notices now use the same canonical format.
- **Clipboard: Copy Image to Clipboard**: Fixed "Failed to copy image to clipboard" error in browser — the Clipboard API only accepts `image/png`, but images are stored as WebP. Now converts to PNG via canvas before clipboard write. Also fixed CSP violation when using `blob:` URLs by switching to `data:` URLs.
- **Tool Messages: Image Copy + Missing Attachment Cleanup**: Fixed generated-image copy buttons and missing non-generator attachment cleanup in inline tool messages — copy actions now use the normalized file path, and broken thumbnails correctly swap to the deleted-image cleanup placeholder
- **Concierge: Avatar Generation**: Character avatar generation now passes through the Concierge dangerous content system — prompts built from physical descriptions and equipped wardrobe are classified before image generation, with AUTO_ROUTE support for rerouting to uncensored image providers when needed
- **Wardrobe Multi-Type Displacement**: Equipping a wardrobe item now correctly displaces conflicting items from all their type slots — e.g., equipping a new top when a dress (types: top+bottom) is worn will also clear the bottom slot. Unequipping similarly clears all slots the item covers. Applies to sidebar outfit changes, tool use (`update_outfit_item`, `create_wardrobe_item`), and preset application.
- **Backup Coverage**: Wardrobe items and outfit presets are now included in backup/restore, with full UUID remapping for new-account imports
- **Avatar Generation: Solo Portrait Prompt**: Avatar generation prompt now explicitly requests a single person ("Solo portrait of a single person... exactly one figure... only one person in the image") to prevent image generators from producing duplicate/clone figures
- **Avatar Generation: Project-Scoped Storage**: Generated character avatars are now stored in the project's `/character-avatars/` directory when the chat belongs to a project, mirroring story background storage behavior. Previously all avatars went to the general directory regardless of project context.
- **DRY: Avatar Generation**: Consolidated three duplicate implementations of avatar generation triggering (two wardrobe handlers + outfit API) into shared `lib/wardrobe/avatar-generation.ts`
- **DRY: ChevronIcon**: Extracted duplicated ChevronIcon component from 6 files into shared `components/ui/ChevronIcon.tsx`
- **SRP: Image Generation Handler**: Refactored monolithic `executeImageGenerationTool` (438 lines) into 5 focused helper functions with a clear pipeline orchestrator
- **SRP: StandaloneGenerateImageDialog**: Extracted `useEntitySearch` hook and `EntitySearchDropdown` component to reduce dialog complexity (385→290 lines)
- **Dead Code Report**: Updated `docs/developer/DEAD-CODE-REPORT.md` with current knip findings
- **Dead Code Cleanup**: Consolidated duplicate `WardrobeItemType` to schema import, unexported unused `DedupClusterResult`/`CharacterDedupResult`/`DedupResult`/`ValidationResult` types

#### Added

- **Character Plugin Data**: New per-character, per-plugin JSON metadata storage. Plugins can store arbitrary JSON data associated with any character via dedicated REST API endpoints (`/api/v1/characters/[id]/plugin-data`). Data is included in character exports/imports and cleaned up on character deletion. New `character_plugin_data` table with `characterId`+`pluginName` composite unique key.
- **@quilltap/plugin-types 2.2.1**: Added `CharacterPluginDataEntry` and `CharacterPluginDataMap` types for plugin developers
- **@quilltap/plugin-utils 2.2.1**: Re-exported character plugin data types from plugin-types
- **Project Default Image Profile**: Projects can now have their own default image generation profile, set in the "Image Generation" card on the project page. New chats created in that project inherit the project's image profile, overriding both the global default and character-level defaults. The profile resolution chain for story backgrounds also checks the project's profile. New DB column: `projects.defaultImageProfileId`.

- **Character Avatar Regeneration**: Added a small camera button overlay on participant avatars in the chat sidebar that manually triggers avatar regeneration. Only visible when avatar generation is enabled for the chat. After regeneration completes, the avatar auto-refreshes on the page via polling — also applies to avatars generated automatically from outfit changes. New API action: `POST /api/v1/chats/[id]?action=regenerate-avatar`.

- **Wardrobe: Import from Image**: Users can now upload a reference image (photograph, artwork, screenshot) and have a vision-capable LLM analyze it to propose wardrobe items. The flow is: upload image with optional guidance notes → LLM identifies clothing/accessories → review/edit/select proposed items → import selected items to the character's personal wardrobe. Entry point is a camera icon button in the Personal Wardrobe section header. Uses the same vision provider resolution as the image description fallback system (configured Image Description Profile, or any vision-capable provider). Added `SectionHeader` `secondaryAction` prop for icon buttons alongside the primary action. New API endpoint: `POST /api/v1/wardrobe/analyze-image`. New LLM log type: `WARDROBE_IMAGE_ANALYSIS`.
- **AI Wardrobe Generation**: The AI Wizard and Summon from Lore features now generate wardrobe items (top, bottom, footwear, accessories) instead of embedding clothing in physical descriptions. Physical description prompts no longer include clothing details — those are handled by the wardrobe system. The AI Wizard offers "Wardrobe Items" as a selectable generation field, and Summon from Lore includes a dedicated wardrobe generation step that produces items in the import export.

- **Outfit Change Notify Button**: When a character's outfit changes (via Participants Sidebar equip, wardrobe item gift, or LLM tool use), a glowing "Notify 👗" pill button appears above the composer gutter tools. Clicking it inserts the change description at the top of the textarea, wrapped in the current roleplay template's narration delimiters (e.g., `*clothing change: Charlie:\n- **top:** shirt\n...*`). Supports multiple characters and distinguishes "clothing change" (equip) from "wardrobe change" (gift). Notifications persist in localStorage until consumed.

- **Narration Delimiters**: Roleplay templates now require a `narrationDelimiters` field that declares how narration/action text is delimited — either a single character (e.g., `*` for `*narration*`) or an open/close pair (e.g., `[`, `]` for `[narration]`). This enables semantic identification of narration vs. other text, beyond just display styling. The Standard built-in template uses `*`, the Quilltap RP plugin uses `[`/`]`. The create/edit template form includes a narration delimiters picker. Existing templates default to `*` via DB migration and Zod schema default. Updated plugin-types (2.1.0) and plugin-utils (2.1.0) with the new required field.

- **Wardrobe Action Notices**: Wardrobe actions (equip, unequip, create, gift) now display a prominent inline summary in chat messages with a warm amber/gold double-border style, so users can see at a glance what happened without parsing tool JSON. CSS variables (`--qt-chat-wardrobe-*`) are themeable with per-theme overrides for all 5 bundled themes. Also added missing whisper CSS variables and classes to the theme-storybook.
- **Wardrobe Item Gifting**: Characters can now create wardrobe items for other characters in the chat via the `recipient` parameter on `create_wardrobe_item`. Users can gift items via a dedicated button (gift icon) next to the "Outfit" header on each character's participant card in the sidebar. Gifted items are added to the recipient's wardrobe and can optionally be equipped immediately.
- **Wardrobe Tools in Tool Settings**: Wardrobe tools (`list_wardrobe`, `update_outfit_item`, `create_wardrobe_item`) now appear in tool enable/disable settings and the Run Tool modal, with availability gated by character wardrobe flags
- **Run Tool Character Selector**: Run Tool modal now includes a "Run as character" dropdown so users can choose which character context to execute tools in, fixing an issue where manual tool runs always used the first active character participant

- **Library File Attach**: New gutter button (document icon) in chat composer lets you attach existing files from General or any project's library to the current message without re-uploading — two-step picker selects scope then browses files with preview
- **Standalone Image Generation**: New gutter button (camera icon) in chat composer opens a full image generation dialog with profile picker, available in every chat regardless of character image profiles — generated images attach as tool output
- **Chat Composer Gutter 2x2 Layout**: Gutter tools now arranged in a 2x2 grid with the new library and camera buttons above the existing paperclip and dice
- **Link File API**: `POST /api/v1/chats/[id]/files?action=link` endpoint links an existing library file to a chat without re-uploading

- **Project Detail Card Reorganization**: Split the monolithic Project Settings card into focused cards — "Model Behavior" (agent mode, tool settings), "Image Generation" (avatars, story backgrounds), and slimmed-down "Project Settings" (instructions, project state). Moved "Allow Any Character" toggle into the Characters card. Project Settings card now spans two rows for more instruction space.
- **WebP Auto-Conversion**: All images (uploaded, imported, and AI-generated) are now automatically converted to WebP format for consistent, space-efficient storage — SVGs are the sole exception
- **WebP Migration**: Startup migration converts all existing non-WebP, non-SVG images in the instance to WebP, updating database references and deleting originals only after verification
- **Character Header Avatar**: Avatar on the character detail page now fills the full height of the header card, scaling up or down as needed

- **Archetype Library**: Shared wardrobe items (characterId=null) available to all characters — create, browse, and equip directly without copying
- **Outfit Presets**: Save named outfit combinations for quick equipping — save current outfit as preset, apply presets from character wardrobe or outfit selector
- **Wardrobe Archiving**: Soft-delete wardrobe items with archive/unarchive — archived items hidden from lists and tools but stay equipped if currently worn
- **Deletion Cleanup**: Deleting a wardrobe item now cleans up all equipped references across chats and removes the item from outfit presets
- New `outfit_presets` database table with character-scoped and shared preset support
- API routes: `/api/v1/wardrobe` (archetype CRUD) and `/api/v1/characters/[id]/wardrobe/presets` (preset CRUD with apply action)
- Preset mode in outfit selector ("Use Saved Preset") resolves presets client-side as manual slot assignments
- `list_wardrobe` tool now includes presets in response and filters archived items
- `update_outfit_item` tool supports `preset_id` parameter for applying entire outfits at once
- Wardrobe item list shows personal and shared items in separate sections with archive/unarchive actions
- **Per-Conversation Avatars**: Opt-in automatic avatar generation when character outfits change — generates portrait images reflecting current equipped wardrobe items via background jobs, with visual timeline in chat history
- New `CHARACTER_AVATAR_GENERATION` background job type for async portrait generation
- Chat-level `avatarGenerationEnabled` toggle and `characterAvatars` state tracking
- Toggle action: `POST /api/v1/chats/[id]?action=toggle-avatar-generation`
- Avatar generation triggers from wardrobe tool changes and sidebar outfit edits
- Chat enrichment resolves per-chat avatar overrides from generated portraits
- Avatar generation toggle in project settings (`defaultAvatarGenerationEnabled`), all new chat dialogs, and ChatSettingsModal for existing chats
- Generated avatar portraits use 3/4 shot (thighs up) with scenario context and are tagged to the character for gallery display
- **Modular Wardrobe System**: Characters now have composable wardrobes with individual garment items (tops, bottoms, footwear, accessories) that can be mixed and matched
- New `wardrobe_items` database table for granular wardrobe item storage
- Per-chat equipped outfit tracking via `equippedOutfit` field on chats
- Three new LLM tools: `list_wardrobe`, `update_outfit_item`, `create_wardrobe_item` — characters can autonomously browse, change, and create wardrobe items
- Character wardrobe flags: `canDressThemselves` and `canCreateOutfits` (enabled by default)
- Text-block tool support for wardrobe tools (non-tool-using models can use `[[WARDROBE]]`, `[[EQUIP]]`, `[[CREATE_WARDROBE_ITEM]]`)
- Wardrobe-aware system prompts showing "Current Outfit" and "Available Wardrobe" sections
- Image generation uses equipped wardrobe items for accurate visual rendering
- API routes: `/api/v1/characters/[id]/wardrobe` (CRUD) and `/api/v1/chats/[id]?action=outfit|equip`
- Wardrobe management UI on character view and edit pages
- Character settings toggles for `canDressThemselves` and `canCreateOutfits` flags on the Profiles tab
- Outfit selection during new chat creation (default, manual, let character choose, or none) across all three chat creation flows
- "Let Character Choose" outfit mode: uses a cheap LLM to select contextually appropriate outfit based on scenario and character personality, with automatic fallback to defaults on failure
- In-chat outfit indicator on ParticipantCard sidebar showing current equipped items per character with inline slot-change dropdowns — now shown for user-controlled characters too, not just LLM-controlled ones
- Outfit change notifications: when outfits are changed via the sidebar, all characters in the chat are informed on their next turn
- Scene state tracker now uses equipped wardrobe items instead of legacy clothing records

#### Migration

- Existing clothing records are automatically migrated to wardrobe items as full-coverage outfits
- Legacy `clothingRecords` column preserved for backward compatibility

### 4.1.1

- fix: Memory extraction now preserves source message timestamps as the memory's createdAt/updatedAt instead of using the extraction time
- fix: One-time migration backfills existing memories with correct timestamps from their linked source messages
- docs: Add 4.1.1 release notes

### 4.1.0

- feat: Character conversations tab shows memory count badge per chat; clicking it deletes old memories and re-extracts with the new multi-fact system
- feat: Commonplace Book memory extraction now returns multiple discrete facts per message pair instead of a single memory, with dynamic limits based on the cheap LLM profile's max output tokens
- fix: Add startup auto-repair for TEXT embeddings in vector_entries and memories tables that accumulate during dev hot-reloads; converts them to Float32 BLOBs on every server start
- fix: Add warning log in documentToRow when embedding arrays are accidentally stored as JSON text instead of BLOB
- docs: Add 4.1.0 release notes
- chore: Update all GitHub repository references from `foundry-9/quilltap` to `foundry-9/quilltap-server` across docs, package.json files, release notes, plugin manifests, and source code

### 4.0.1

- fix: passphrase change API returned empty object without `success` field, causing frontend to report failure even when the change succeeded

### 4.0.0

- fix: Summon from Lore no longer loses character fields during validation repair — memory assembly set null values for optional UUID fields (`chatId`, `projectId`) causing schema validation failures; the repair process then sent the unrelated **characters** array to the LLM which corrupted description, personality, and system prompt; now omits optional null fields and repair targets only the sections with actual errors
- fix: remove erroneous file write permission check from user-initiated file uploads — the Prospero AI permission gate was blocking document uploads in the AI Wizard and Summon from Lore source file uploads; user-initiated uploads are already authenticated and don't need the AI write permission
- fix: AI Wizard on character edit page no longer loses generated description, personality, and system prompt — `fetchCharacter()` was called after saving scenarios which reset form state to DB values before the user could save; now updates scenarios in form state directly
- docs: update 4.0.0 release notes with post-draft changes — shell version gating, granular status events, reasoning model handling, character defaults fix, provider recommendations, semantic theme classes, chat orchestrator decomposition, centralized API error handling
- feat: version guard now writes `minServerVersion` into `.dbkey` files on every startup, allowing the Electron shell to reject incompatible server versions before opening the database
- fix: add granular status events throughout chat message orchestrator — replaces stale "Calculating context budget..." indicator with accurate phase-by-phase progress (initializing, resolving, loading tools, gathering, generating recap, preparing, validating, sending); add per-tool status updates inside `processToolCalls` and streaming status in the tool loop; prevents status messages from lingering through long operations
- fix: cheap LLM tasks on reasoning models (OpenAI gpt-5-nano, Google Gemini 3.x) now use `strictMaxTokens` flag via `LLMParams` to prevent providers from inflating output token limits — OpenAI uses `reasoning: { effort: 'low' }`, Google reduces thinking budget to 1024; fixes 32-second memory recap calls and empty responses caused by reasoning tokens consuming the entire output budget
- fix: replace native `confirm()`/`alert()` with `showConfirmation()`/`showErrorToast()` on character conversations tab delete action — matches the modal pattern used elsewhere in the app
- docs: add provider recommendations help page with guidance on which AI providers to use for chat, background tasks, image generation, embeddings, and moderation; recommends OpenRouter as a first-class chat and cheap LLM option
- fix: new chat page (`/salon/new`) now applies character defaults for Play As, Scenario, and Timestamp Injection Mode — characters list API was missing `defaultPartnerId`, `defaultTimestampConfig`, `defaultScenarioId`, `defaultSystemPromptId`, and `defaultImageProfileId` fields
- fix: update qtap-plugin-openrouter for @openrouter/sdk v0.11.2 breaking changes — fix removed `fromChatMessages` re-export (use deep import from `lib/chat-compat`), rename `chatGenerationParams` to `chatRequest` for `chat.send()`, update type imports (`ChatMessages`, `OpenResponsesResult`); bump plugin to 1.0.28
- chore: update npm dependencies across root, packages, and plugins — @jest/globals 30.3.0, @openrouter/sdk 0.11.2, @anthropic-ai/sdk 0.82.0, tailwindcss 4.2.2, esbuild 0.28.0; remove deprecated @types/sharp and @types/tar stub packages; fix OpenRouter SDK xTitle→appTitle rename; bump qtap-plugin-openrouter to 1.0.27
- chore: update npm dependencies across root, packages, and plugins — next 16.2.2, esbuild 0.27.7, @playwright/test 1.59.1, dotenv 17.4.0, yauzl 3.3.0, @google/genai 1.48.0, @modelcontextprotocol/sdk 1.29.0, storybook 10.3.4; fix format-time tests for @sinonjs/fake-timers 15.3.0 instanceof Date regression
- refactor: restructure chat-message extracted services — introduce `StreamingState` mutable context bag (eliminates 9-field destructure/reassign), decompose `FinalizeMessageResponseOptions` into `StreamingState`/`CompressionContext`/`TriggerContext` sub-objects, fix `as any` cast in danger-orchestrator with proper `CheapLLMSelection` type, consolidate scene-state tracking into single orchestrator call site, trim barrel over-exports to public API only; add `.next` to tsconfig exclude
- refactor: continue decomposing `lib/services/chat-message/orchestrator.service.ts` by extracting empty-response retry and uncensored failover handling into `provider-failover.service.ts`, with focused coverage for same-provider retries, Auto-Route fallback, and final empty-response messaging
- refactor: continue decomposing `lib/services/chat-message/orchestrator.service.ts` by extracting Concierge classification and uncensored provider-routing preflight into `danger-orchestrator.service.ts`, with focused coverage for mode handling, reroutes, and fail-open behavior
- refactor: continue decomposing `lib/services/chat-message/orchestrator.service.ts` by extracting assistant response persistence, completion events, token tracking, RNG follow-up, and memory/summary triggers into `message-finalizer.service.ts`, with targeted coverage for the new finalization flow
- refactor: begin decomposing `lib/services/chat-message/orchestrator.service.ts` by extracting multi-character turn chaining into `turn-orchestrator.service.ts`, adding targeted chain execution tests while preserving the existing message streaming API
- refactor: split `lib/memory/cheap-llm-tasks` into domain-focused modules for shared execution, memory work, chat summarization/titles, image/scene handling, and compression while preserving the original import path as a compatibility entrypoint
- refactor: move ZodError and unhandled error catching into API middleware; remove ~97 try-catch blocks from 60 route files (~1,084 lines of boilerplate eliminated)
- style: convert 1,314 raw Tailwind visual classes to `qt-*` semantic theme classes across 234 files — backgrounds, text colors, border colors, and shadows now use theme-overridable CSS variables
- refactor: remove vestigial `userId` ownership checks from 45 API route files (single-user app); flatten `app/(authenticated)/` route group into `app/` to eliminate shell-escaping issues with parenthesized directory names
- docs: add 4.0.0 release notes
- docs: update README with Desktop App–first installation, model classes, auto-configure, budget compression, Non-Quilltap Prompt generator; update API.md to v4.0-dev with 20 new route groups; remove stale S3/mount points from DEVELOPMENT.md
- fix: add missing `scenarioText`, `modelClass`, `maxContext`, `maxTokens` fields to `.qtap` export schema; bump `@quilltap/theme-storybook` to 1.0.28 for chat message width variable update
- chore: remove 8 development `logger.debug` calls from 4 files (chats route, characters repository, prompt-templates repository, auto-configure service)
- refactor: remove dead code (`lib/image-gen/base.ts`, `@quilltap/theme-storybook` dependency), replace raw `NextResponse.json()` with response helpers in 9 API routes for conformance
- test: add unit and regression tests for 4.0-dev features — model classes, system prompt registry, memory recap, external prompt generator, auto-configure service, scenario persistence, orphaned file cleanup safety, Character Optimizer JSON repair and frequency guards, greeting content filter detection, Concierge DETECT_ONLY empty response handling, and gatekeeper category mapping/caching (~189 new tests)
- ci: release workflow puts Desktop App first in installation section and pins link to the quilltap-shell release that was current at build time
- ci: release workflow now includes release notes from `docs/releases/{version}.md` in GitHub releases; production releases from the release branch require this file to exist
- fix: `--qt-*` CSS variable defaults now apply to all themes via `[data-theme]` selector instead of `[data-theme="default"]` — fixes missing textarea padding, button styles, and other tokens on non-default themes after redundant declarations were stripped from bundled themes
- refactor: strip redundant `--qt-*` CSS variables from all bundled themes — variables matching `_variables.css` defaults are removed so themes only declare overrides; reduces theme file sizes 6-34%; update `create-quilltap-theme` bundle template with complete variable reference (all ~250 `--qt-*` vars commented out with defaults)
- style: widen chat message row default from 800px to 900px and increase row width from 90% to 95% for more readable message widths closer to modern chat UIs; fix code blocks inside list items not wrapping text by adding explicit wrap rules in `_chat.css`
- feat: auto-configure connection profiles — new button on profile cards and in the edit/create modal that performs web searches for model specifications and recommended settings, sends results to the default LLM for structured analysis, and applies optimal maxContext, maxTokens, temperature, topP, modelClass, and isDangerousCompatible settings; falls back to cheap LLM for JSON cleanup if needed
- fix: Concierge DETECT_ONLY mode now shows a moderation-aware message when the provider returns an empty response for flagged content, instead of a generic "empty response" error; suggests enabling Auto-Route mode
- refactor: unify all LLM provider interfaces into four canonical shapes — TextProvider (text→text), ImageProvider (text→image), EmbeddingProvider (text→vector), ScoringProvider (text+candidates→scores); move canonical definitions to `@quilltap/plugin-types` providers/ directory; remove `generateImage()` from text provider interface; generalize moderation into ScoringProvider with documented reranking/classification support; update all plugins and lib/ to use new names with backward-compatible aliases
- chore: reduce Commonplace Book memory recap limits from 50/20/10 to 20/10/5 (high/medium/low importance tiers)
- chore: tag-for-release command now uses linear strategy exclusively — removed merge-back strategy and all strategy selection logic
- chore: add `--linear` strategy option to tag-for-release command — tree-copy approach that keeps main linear by skipping merge-back from release; default behavior unchanged
- fix: character optimizer "Refine from Memories" UI — frequency badges in behavioral tendencies now wrap instead of overflowing the dialog; textarea in edit mode is taller and resizable, filling available space
- feat: budget-driven context compression — replace count-based compression trigger with token-budget-aware system; compute `max_available = maxContext - 2 * maxTokens` from connection profile, compress conversation history (Phase 1) when it exceeds 50% of budget and recalled memories (Phase 2) when they exceed 20%; add `maxTokens` field to connection profiles with migration; new `compressMemories()` cheap LLM task; status events for each compression phase shown above ChatComposer
- feat: add model classes (Compact/Standard/Extended/Deep) as capability tier definitions for connection profiles, with optional `maxContext` override for context window size; new `GET /api/v1/model-classes` endpoint, migration adds `modelClass` and `maxContext` columns
- chore: update remove-old-dev-tags command to also delete GitHub releases before tags, filter release list to prereleases/drafts only, and remove csebold/quilltap Docker registry references
- fix: image "copy to clipboard" button in Electron now works via IPC bridge instead of unsupported `navigator.clipboard.write()` API; browser fallback unchanged
- fix: scenario selection ignored when starting chats — selected scenario was not persisted on the chat, so the runtime system prompt builder always used the first scenario in the array; now stores resolved scenario text (`scenarioText`) on the chat at creation and uses it for all subsequent messages; also fixes UI useEffect that reset scenario selection when changing connection profiles or system prompts
- fix: remove proxy rate limiter that caused 429 errors during app startup
- feat: detect quilltap-shell via `QUILLTAP_SHELL` env var (version string) and `QUILLTAP_SHELL_CAPABILITIES` (comma-delimited capability flags); exposed in `/api/v1/system/data-dir` response and capabilities report. Env vars pass through in all modes (direct, Docker `-e`, Lima/WSL2 inherited env).
- feat: footer now shows shell version and composite backend mode (Electron, Electron+Docker, Electron+VM) when running under quilltap-shell
- ci: restore rootfs tarball builds (quilltap-linux-arm64.tar.gz, quilltap-linux-amd64.tar.gz) for Lima/WSL2 VM modes
- ci: restore wsl2 Docker target in Dockerfile.ci and build-rootfs.ts script
- refactor: remove Electron build infrastructure, Lima/WSL VM management from this repository
- refactor: Electron desktop app moved to separate repository (quilltap-shell)
- ci: remove csebold/quilltap Docker registry; only foundry9/quilltap is published
- ci: simplify release workflow to produce standalone tarball, Docker images, rootfs tarballs, and npm package
- ci: make Windows Electron build optional in release workflow
- fix: standalone tarball now includes sharp JS wrapper and @img/colour (only native binaries are stripped)
- chore: update npm dependencies across root, packages, and plugins
