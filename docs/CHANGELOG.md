# Quilltap Changelog

## Recent Changes

### 4.2-dev

#### Refactored

- **Persona References Removed**: Comprehensive removal of all "persona" and "PERSONA" references from the codebase (except SillyTavern import/export compatibility). User-controlled characters are now the sole concept — no more legacy PERSONA type, no more fallback code paths. Renamed `persona` → `userCharacter` across the entire message pipeline (types, orchestrator, context builder, system prompt builder, template processor), `personaName` → `userCharacterName` in memory extraction, `getFirstPersona` → `getFirstUserCharacter` in salon hooks, `addPersona`/`removePersona` → `addPartnerLink`/`removePartnerLink` in character repository. Removed deprecated `findByPersonaId` from memories repository. CSS badge variables renamed `--qt-badge-persona-*` → `--qt-badge-user-character-*` across all 5 bundled themes, storybook, and create-quilltap-theme template. Updated all help docs, plugin README, and component props. `{{persona}}` template variable retained for SillyTavern template compatibility. DB migration renames `characters.personaLinks` → `partnerLinks` (with inner `personaId` → `partnerId`) and drops `memories.personaId` (data already in `aboutCharacterId`).

#### Fixed

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
- **DRY: Avatar Generation**: Consolidated three duplicate implementations of avatar generation triggering (two wardrobe handlers + outfit API) into shared `lib/wardrobe/avatar-generation.ts`
- **DRY: ChevronIcon**: Extracted duplicated ChevronIcon component from 6 files into shared `components/ui/ChevronIcon.tsx`
- **SRP: Image Generation Handler**: Refactored monolithic `executeImageGenerationTool` (438 lines) into 5 focused helper functions with a clear pipeline orchestrator
- **SRP: StandaloneGenerateImageDialog**: Extracted `useEntitySearch` hook and `EntitySearchDropdown` component to reduce dialog complexity (385→290 lines)
- **Dead Code Report**: Updated `docs/developer/DEAD-CODE-REPORT.md` with current knip findings
- **Dead Code Cleanup**: Consolidated duplicate `WardrobeItemType` to schema import, unexported unused `DedupClusterResult`/`CharacterDedupResult`/`DedupResult`/`ValidationResult` types

#### Added

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

#### Changed

- **Tool Palette Reorganization**: Moved Roleplay Template dropdown from Chat Settings modal into the Edit Content section of the tool palette for quicker access. Moved State to the Organize section. Merged Memory actions (Re-extract, Delete) into the Edit Content section, removing the separate Memory section.
- Outfit indicator now renders above talkativeness slider for LLM characters in participant sidebar
- Shared/archetype wardrobe items now appear in sidebar outfit dropdowns with "(shared)" label
- System prompt clothing section now shows slot-based outfit state instead of monolithic descriptions (falls back to legacy format when no wardrobe items exist)
- Appearance resolution for image generation prefers equipped wardrobe items over legacy clothing records
- perf: Memories tab on character pages now uses paginated loading with infinite scroll instead of loading all memories at once
- chore: Add `all` mode to remove-old-dev-tags Claude command for removing every dev tag, release, and Docker image
- docs: Add system flowcharts (Mermaid) documenting prompt assembly, memory extraction pipeline, scene tracking, story background generation, and Concierge content routing
- test: Expand unit and regression coverage for wardrobe tools, text-block tool mode, and 4.1 memory repair/timestamp fixes

#### Migration

- Existing clothing records are automatically migrated to wardrobe items as full-coverage outfits
- Legacy `clothingRecords` column preserved for backward compatibility

### 4.1.1

- fix: Memory extraction now preserves source message timestamps as the memory's createdAt/updatedAt instead of using the extraction time
- fix: One-time migration backfills existing memories with correct timestamps from their linked source messages
- docs: Add 4.1.1 release notes
