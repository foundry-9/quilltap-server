# Quilltap Changelog

## Recent Changes

### 4.2-dev

#### Added

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

- Outfit indicator now renders above talkativeness slider for LLM characters in participant sidebar
- Shared/archetype wardrobe items now appear in sidebar outfit dropdowns with "(shared)" label
- System prompt clothing section now shows slot-based outfit state instead of monolithic descriptions (falls back to legacy format when no wardrobe items exist)
- Appearance resolution for image generation prefers equipped wardrobe items over legacy clothing records

#### Migration

- Existing clothing records are automatically migrated to wardrobe items as full-coverage outfits
- Legacy `clothingRecords` column preserved for backward compatibility

- perf: Memories tab on character pages now uses paginated loading with infinite scroll instead of loading all memories at once
- chore: Add `all` mode to remove-old-dev-tags Claude command for removing every dev tag, release, and Docker image
- docs: Add system flowcharts (Mermaid) documenting prompt assembly, memory extraction pipeline, scene tracking, story background generation, and Concierge content routing
- test: Expand unit and regression coverage for wardrobe tools, text-block tool mode, and 4.1 memory repair/timestamp fixes

### 4.1.1

- fix: Memory extraction now preserves source message timestamps as the memory's createdAt/updatedAt instead of using the extraction time
- fix: One-time migration backfills existing memories with correct timestamps from their linked source messages
- docs: Add 4.1.1 release notes
