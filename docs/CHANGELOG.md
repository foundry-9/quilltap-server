# Quilltap Changelog

## Recent Changes

### 2.4-dev

- feat: Stop streaming response button
  - Desktop: Stop button appears to the left of the tool palette toggle when streaming
  - Mobile: Stop button appears in the sticky streaming header to the right of the avatar
  - Uses AbortController to cancel the fetch request cleanly
  - In multi-character chats, stopping a response resets to user's turn
  - Displays "Response stopped" toast when content was partially received
- feat: Pseudo-tool support for models without native function calling
  - Auto-detects when model doesn't support native tools (via OpenRouter pricing cache)
  - Injects text-based tool instructions into system prompt using `[TOOL:name]...[/TOOL]` syntax
  - Supported pseudo-tools: memory search, image generation, web search
  - Parses markers from LLM responses and executes through existing tool pipeline
  - Strips markers from displayed/stored response for clean output
  - Continues conversation with tool results for natural flow
  - New files: pseudo-tool-support.ts, pseudo-tool-prompt.ts, pseudo-tool-parser.ts
- feat: OpenRouter custom model ID support
  - Added "Use Custom Model ID" toggle in OpenRouter Options section
  - When enabled, shows text input for arbitrary model IDs not in the fetched list
  - Datalist autocomplete still shows fetched models as suggestions
  - Existing "Test Message" button can be used to verify custom models work
  - Custom model preference is saved with connection profile
- fix: Skip button now properly advances turn in multi-character chats
  - When user skips their turn, the cycle now resets so characters can speak again
  - Added `resetCycleForUserSkip()` function to turn-manager
  - Previously "Skip" would show "All characters have spoken" if cycle was complete
- fix: OpenRouter fallback model limit validation
  - Added max 2 fallback models limit in UI (OpenRouter supports 3 total: 1 primary + 2 fallbacks)
  - Disabled checkboxes when limit reached with amber warning message
  - Updated labels to show limit and count (e.g., "Selected fallbacks (2/2)")
- fix: Duplicate name prefixes in multi-character chat messages
  - Messages were showing repeated `[Name] [Name] [Name]` patterns
  - formatMessagesForProvider now checks if content already has the name prefix before adding it
  - Added debug logging when duplicate prefix is detected and skipped
- fix: Reduced SSE parse error noise in console
  - Better filtering of benign empty SSE data chunks
  - Skip `[DONE]` markers sent by OpenAI-compatible APIs (OpenRouter)
- feat: Unified desktop tool palette matching mobile design
  - Simplified footer to single-line textarea with tool palette button (left) and send (right)
  - New full-width tool palette bar above composer when opened
  - Left section: Attach, Settings, Export, Gallery, Generate Image, Add Character
  - Center section: Roleplay annotation buttons (no "Insert" label)
  - Right section: Re-extract, Delete memories, Preview toggle
  - Removed separate attach file, preview, and continue buttons from footer
  - Continue/skip functionality moved to participant sidebar for user personas
  - User participants now show "Queue" and "Skip" buttons side by side
  - Skip button triggers continue mode (passes turn to next character)
- feat: Mobile-responsive multi-character participant UI
  - Participant avatar buttons integrated into mobile message header row
  - Left side: sticky speaker avatar and name (per message)
  - Right side: compact participant control buttons (32px avatars) + continue button
  - Tap avatar to open dropdown with talkativeness slider, nudge/queue/dequeue, remove
  - Continue button moved from footer to header on mobile (right edge)
  - Green glow indicates active turn, badge shows queue position
  - Desktop ParticipantSidebar hidden on mobile
  - Viewport-aware dropdown positioning (uses right alignment)
- fix: Persona display name disambiguation not working
  - usePersonaDisplayName hook was expecting `data.personas` but API returns array directly
  - Personas with duplicate names now correctly show titles in dropdowns
- feat: Mobile-responsive chat footer with compact tool palette
  - Reduced input textarea to single line initial height on mobile
  - Simplified footer buttons: tool palette toggle (left), send + continue (right)
  - New MobileToolPalette component: full-width drawer above footer
  - Palette sections: Quick Actions (attach file, preview toggle), Chat Tools, Memory, RP Insert
  - Attach file, preview toggle, and desktop tool palette hidden on mobile
  - Roleplay annotation buttons moved into palette on mobile
  - Textarea max height reserves space for palette even when closed
  - Palette closes on toggle button click or tap outside
- feat: Mobile-responsive chat conversation UI
  - On mobile (< 768px), messages display with avatar/name header above message card
  - Character messages: avatar on left, user messages: avatar on right
  - Message cards stretch to 80% of screen width on mobile
  - Replaced hover-based copy/view-source actions with persistent icon bar at bottom of messages
  - Icon bar includes: copy, view source, edit (user only), delete, regenerate (assistant only), swipe controls
  - Timestamp shown in action bar on mobile instead of separate line
  - Desktop layout preserved with side-by-side avatar layout and hover actions
- feat: Mobile-responsive dashboard for phone portrait mode
  - Favorites section: header shows "Favorites" on mobile, compact 2-column horizontal cards
  - Dashboard cards: Characters/Chats shown as compact 2-column grid, Personas hidden on mobile
  - Recent Chats: compact horizontal cards with single avatar, no tags
  - Section headers (Favorites, Recent Chats) right-aligned on mobile
  - Full-page scrolling on mobile (nav/footer fixed, no separate scroll areas)
- feat: Smart persona display name disambiguation
  - New usePersonaDisplayName hook tracks duplicate persona names
  - Persona titles only shown when needed to distinguish between personas with same name
  - Applied across all persona dropdowns and chat displays
- fix: Improved useAvatarDisplay hook error handling
  - Network errors (offline, CORS) now logged at debug level instead of error
  - JSON parse errors handled separately with graceful fallback
  - Update function properly reverts to previous style on error instead of toggling
  - Reduced console noise for expected error scenarios
- fix: User menu mobile responsiveness
  - Sign Out button now uses NavUserMenuItem with icon, shrinks to icon-only on mobile
  - Dropdown auto-sizes to content on mobile instead of fixed 14rem width
  - Header (name/email) truncates with ellipsis on mobile to prevent width overflow
  - Submenus appear below trigger on mobile (< 768px) instead of flying off to the left
  - Submenus align to right edge on mobile to stay within viewport
  - Reduced padding on menu items for mobile
- feat: Navbar restructuring - consolidate controls into User menu
  - Moved Theme selector, Quick-hide, and DevConsole buttons into User menu dropdown as submenu items
  - Theme and Quick-hide show flyout menus to the left with their respective options
  - Added content width toggle button (expand/compress arrows) between search and user menu
  - Content width toggle only visible on viewports >= 1000px, switches between 800px and full-width layouts
  - Content width preference persisted in localStorage
  - New components: NavUserMenu, NavUserMenuItem, NavUserMenuTheme, NavUserMenuQuickHide, NavContentWidthToggle
  - New provider: ContentWidthProvider for managing width state and CSS variable injection
  - Simplified nav.tsx by extracting functionality into dedicated components
- fix: Anthropic provider not detecting tool_use blocks during streaming
  - Tool calls (image generation, memory search, web search) were silently failing with Anthropic models
  - Root cause: streaming code only captured text deltas, ignoring content_block_start events for tool_use
  - Now properly tracks all content blocks including tool_use with input JSON parsing
  - Added debug logging for tool use block start, input deltas, and parsed results
- fix: Roleplay syntax styling now respects active template
  - Standard template: `*actions*`, `"dialogue"`, `((OOC))`
  - Quilltap RP template: `[actions]`, `{thoughts}`, `// OOC`
  - Removed incorrect single-parentheses OOC styling
- fix: ToolPalette viewport overflow - palette now detects viewport boundaries and adjusts position to stay on screen
- fix: Pass cache usage stats from Anthropic to client in SSE response
  - Added `cacheUsage` field to final streaming response with `cacheCreationInputTokens` and `cacheReadInputTokens`
  - Now you can verify prompt caching is working by checking for these fields in the response
- fix: Chat debug panel contrast issues in dark mode
  - Added dark mode variants for role badges (system/user/assistant)
  - Added dark mode variants for all colored debug badges
  - Added dark mode variants for nested content containers
  - Fixed inline style backgrounds that didn't respect dark mode
  - Memory extraction logs now readable in all themes
- feat: Enhanced Anthropic prompt caching with comprehensive support
  - Added tool caching (cache_control on last tool in the tools array)
  - Implemented `system_and_long_context` strategy for conversation history caching
  - Added TTL configuration (5 minutes default, 1 hour optional) in UI
  - Updated default cache strategy to `system_and_long_context` for better cost savings
  - Cache reads cost 10% of base input tokens, potentially saving up to 90% on repeated context
- feat: Add About page with project info, links, and tech stack; simplify footer to version and copyright
- fix: Robust error extraction in useAvatarDisplay hook - handles unusual error types and logs error type for debugging
- feat: Responsive navbar with dynamic collapse - menu items collapse into logo dropdown when space is limited
- New development checkpoint

### 2.3

- feat: Add job-level controls to Tasks Queue - pause/resume, delete, and view buttons for each job with detail dialog
- feat: Tasks Queue auto-start/stop - processor starts automatically when jobs are enqueued and stops when queue empties
- fix: Improve error handling in useAvatarDisplay hook - 401 responses now logged as debug instead of error
- feat: Add Start Queue and Stop Queue buttons to Tasks Queue card for controlling background job processor
- fix: Docker build failure from esbuild platform mismatch (exclude plugin node_modules, fix ENV format)
- fix: CI build now runs `npm run build` instead of `npx next build` to include plugin builds
- fix: integration test failure attempt to fix for Github Actions
- feat: Increase max_tokens limit and add dynamic model-based constraints
  - Increased default max_tokens from 1000 to 4096 for longer LLM responses
  - UI max limit increased from 4000 to 128000 (or model's maxOutputTokens if known)
  - Added maxOutputTokens and contextWindow fields to ModelMetadata interface
  - API now returns model token limits from plugin getModelInfo() for dynamic UI constraints
  - Connection profile form shows model's max output token limit when available
- refactor: Decouple tests from LLM SDK dependencies
  - Added Jest mocks for openai, @anthropic-ai/sdk, @google/generative-ai SDKs
  - Updated jest.config.ts and jest.integration.config.ts with moduleNameMapper entries
  - Removed unused legacy lib/image-gen/openai.ts (OpenAI image generation now handled by plugin)
  - Refactored lib/llm/pricing-fetcher.ts to use dynamic import for @openrouter/sdk
  - Removed @anthropic-ai/sdk, @google/generative-ai, and openai from top-level devDependencies
  - Kept @openrouter/sdk for embedding service types (used via dynamic import at runtime)
- refactor: Migrate plugins to self-contained builds with per-plugin `npm run build`
  - Each plugin now has its own esbuild.config.mjs and package.json with build script
  - Removed centralized plugin-transpiler.ts in favor of per-plugin builds
  - SDK dependencies (anthropic, openai, google, openrouter) moved from main app to individual plugins
  - Updated `npm run build:plugins` to iterate through plugins and run their build scripts
  - Plugins must be pre-built before starting the app (no runtime transpilation)
- feat: Add Tasks Queue tool card to view background job queue status, pending jobs, and estimated token usage
- style: Add vertical scrolling to cloud backups and capabilities reports lists when more than 2 items
- feat: Add delete button for cloud backups on Tools page with confirmation dialog
- refactor: Bundle LLM SDK dependencies into plugin output files for Docker standalone compatibility
  - Plugins are now self-contained (~200-400KB each with bundled SDKs)
  - Removed SDK packages from EXTERNAL_PACKAGES in plugin-transpiler.ts
  - Simplified next.config.js outputFileTracingIncludes (only main app deps)
  - Changed plugin package.json peerDependencies to devDependencies
- fix: Docker production build now pre-compiles plugins and includes SDK dependencies for LLM providers
- feat: add background job queue for memory extraction on import
- doc: usage tracking feature request
- Fix for pre-commit when starting a new major/minor/release
- feat: add chat memory management tools to ToolPalette
- fix: update OpenAI and Grok plugins for API compatibility
- feat: reload recent chats when quick-hide state changes
- fix: prevent double scrollbars on chat page
- fix: add cursor:pointer to qt-button and qt-*-button classes
- feat: add qt-devconsole CSS component system for DevConsole styling
- feat: integrate Chat Debug tab into DevConsole with qt-debug CSS system
- Updated Docker compose files
- test: add quick hide provider coverage
- doc: distant future plan to separate API
- chore: upgrade for security fix
- feat: Add AWS ECS deployment support with IAM role auth
- Updated deployment script for Docker and included plugins in Docker output
- feat: Add roleplay templates feature with per-chat settings
- feat: Add roleplay annotation buttons and syntax highlighting
- style: Add roleplay annotation CSS variables to all themes (Ocean, Rains, Earl Grey) with consistent OOC terminal styling

### 2.2 - Tools, Global Search, Character Management, Multi-Character Chat, Dev Console, Themes, OpenRouter Updates

- Plugin-driven theming architecture with ThemeProvider runtime, persistence, Appearance settings, and qt-* semantic classes so admins install/switch rich Tailwind v4-compatible theme plugins (Ocean, Rains, Earl Grey) with bundled fonts, previews, and nav selector.
- Multi-character chat suite completed: turn/state management, context building, nudge/queue UI, participant add/remove, auto-triggered turns, streaming fixes, inter-character memory sharing, tag syncing, and regression coverage.
- Provider/tooling expansion: OpenRouter SDK 0.2.9 + embeddings, Anthropic cache controls, Google Gemini and OpenRouter image flows, improved cheap-LLM prompts, multi-person image placeholders, and collapsible tool message readability upgrades.
- Navigation/UX refinements: file-tag inheritance, dashboard tweaks, participant-tag filters, favorites/chat-count sorting, enhanced quick-hide/theme controls, nav actions dropdown, scaled avatars, branding refresh (new quill icon, EB Garamond, splash graphic).
- New Capabilities Report tool on Tools page generates, stores, and downloads comprehensive diagnostics covering environment, plugins, providers, and storage stats.
- UI polish and theme coherence: Export Chat moved to ToolPalette, button/badge semantics standardized, Ocean/Rains/Earl Grey typography and palettes aligned, text-shadow fixes, QuickHideProvider render bug resolved.
- Quality safeguards: pre-commit hooks and Jest setup rebuilt for quieter, more reliable local runs; documentation moved for v2.2 planning/testing; GitHub Actions stabilized via shared jest setup adjustments.

### 2.1 - Multi-character ST import support, backup/restore, global search

- Multi-character SillyTavern chat import with wizard to assign users, persona
- Cloud or local backup/restore system
- "Delete all user data" functionality
- Removed duplicated memories editing section from character edit page
- Added global search
- Rename character + search/replace in templates and throughout records
- Console and other logs can be seen in the front-end while not in production mode
- Finish local username/password and TOTP/MFA login

### 2.0 - Pluggable Authentication, no-auth, MongoDB/S3 migration complete

- Fix quick-hide persistence and update issue
- Convert Google OAuth to plugin (`qtap-plugin-auth-google`)
- Create auth provider plugin interface and registry
- Implement lazy initialization pattern for NextAuth
- Centralize session handling in `lib/auth/session.ts`
- Make a default no-auth option (`AUTH_DISABLED=true` env var)
- Show tool calls collapsed in chat UI before character response
- Only show "generating image" alert for generate_image tool (not all tools)
- Fix {{me}} placeholder to resolve to character (not persona) when character calls image generation tool
- Attach generated images to LLM response and tag for chat/character
- Use file-manager (addFileLink/addFileTag) instead of deprecated repos.images
- Enable Ollama plugin by default
- Add tool call capture and normalization in Ollama provider
- Add /api/providers endpoint for dynamic provider configurations
- Update connection profiles UI to fetch provider requirements dynamically
- Versioning change (dev commits no longer bump release versions)
- **MongoDB now required** - removed JSON file storage backend
- **S3 now required** - removed local filesystem storage for files
- Migration plugin (`qtap-plugin-upgrade`) available for migrating existing JSON/local data
- Fix S3-served avatar and image display across dashboard, chats, personas, and characters
- Switch from Next.js Image to native img tags for API-served images (compatibility with dynamic routes)
- Fix URL construction bugs (double-slash issues) in avatar/image paths
- Add graceful handling of orphaned file metadata entries
- Auto-cleanup orphaned file references (avatars, defaultImageId)
- Fix deduplication to verify file existence in S3/local storage
- Proxy files through API for HTTP S3 endpoints to avoid mixed content SSL errors
- Add MongoDB repositories for migrations and vector indices
- Update test mocks to use new repository factory pattern
- Add utility scripts: debug-files, fix-file-userids, fix-sha256-in-mongodb, reset-file-tags
- Improve S3 migration error handling (warnings vs blocking errors)
- Enhanced auth adapter with improved MongoDB integration
- Replace email with username for local authentication
- Add user-scoped repositories for data isolation between users
- Add migration to ensure all users have usernames
- Use session.user.id instead of email for user lookups
- Add model warnings system and fix Gemini thinking model issues
- Sort settings lists (API keys, profiles, etc.) alphabetically by name
- Clear error state on successful data fetch in settings tabs
- Hide navigation on auth pages and reduce MongoDB connection logging verbosity
- CI/build improvements: skip env validation during CI build, add MONGODB_URI test default

### 1.7 - Plugin support: basics, routes, LLM providers

- Quick-hide for sensitive tags, hit one button and watch everything tagged that way disappear, toggle it back and it reappears
- Logging to stdout or file (see [ENV file](./.env.example) for configuration)
- Web search support (internal for providers that support it)
- Cascading deletion for characters (deletes memories and optionally images and chats associated with the character)
- Cleanup and better UI for chat cards
- Plugin support
  - New routes
  - Moved LLM providers to plugins
- Moved images to the file handling system so that they are no longer a separately maintained thing

### 1.6 - Physical descriptions, JSON store polish, and attachment fallbacks

- JSON data store finalized with atomic writes, advisory file locking, schema versioning, and full CLI/docs to migrate/validate Prisma exports into the JSON repositories.
- Centralized file manager moves every upload into `data/files`, serves them via `/api/files/[id]`, and ships migration/cleanup scripts plus UI fixes so galleries and avatars consistently load from `/data/files/storage/*`.
- Attachment UX now shows each provider's supported file types in connection profiles and adds a cheap-LLM-powered fallback that inlines text files, generates descriptions for images, and streams status events when providers lack native support.
- Cheap LLM + embedding controls let you mark profiles as "cheap," pick provider strategies or user-defined defaults, manage dedicated OpenAI/Ollama embedding profiles, and fall back to keyword heuristics when embeddings are unavailable while powering summaries/memories.
- Characters and personas gain tabbed detail/edit pages plus a physical description editor with short/medium/long/complete tiers that feed galleries, chat context, and other tooling.
- Image generation prompt expansion now understands `{{Character}}`/`{{me}}` placeholders, pulls those physical description tiers, and has the cheap LLM craft provider-sized prompts before handing them to Grok, Imagen, DALL·E, etc.

#### 1.5 - Memory System

- Character memory management
- Editable via a rich UI for browsing
- Cheap LLM setup for memory summarization
- Semantic embeddings and search
- Improved chat composer with Markdown preview, auto-sizing
- Default theme font improvements
- Improved diagnostics include memory system

### 1.4 - Improved provider support + tags

- Add separate Chat and View buttons on Characters page
- Migrate OpenRouter to native SDK with auto-conversion
- Add searchable model selector for 10+ models
- Enhance tag appearance settings with layout and styling options
- Add customizable tag styling
- Consolidate Google Imagen profiles and enable image generation tool for Google Gemini
- Add Google provider support to connection profile testing endpoints
- Add Google to API key provider dropdown in UI

### 1.3 - JSON no Postgres

- Moved from Postgres to JSON stores in files

### 1.2 - Image Support

- Local User Authentication - Complete email/password auth implementation with signup/signin pages
- Two-Factor Authentication (2FA) - TOTP-based 2FA setup and management
- Image Generation System - Multi-provider support (OpenAI, Google Imagen, Grok) with:
- Image generation dialog and UI components
- Image profile management system
- Chat integration for generated images
- Image galleries and modals
- Chat File Management - Support for file attachments in chats
- Tool System - Tool executor framework with image generation tool support
- Database Schema Enhancements - Added fields for:
- Character titles and avatar display styles
- Image profiles and generation settings
- User passwords, TOTP secrets, 2FA status (still in progress)

### 1.1 - Quality of Life and Features

- UI/UX Enhancements
  - Toast notification system for user feedback
  - Styled dialog boxes replacing JavaScript alerts
  - Message timestamps display
  - Auto-scroll and highlight animation for new messages
  - Dark mode support across persona pages and dialogs
  - Dashboard updates with live counts and recent chats
  - Footer placement improvements
  - Two-mode toggle for tag management
- Character & Persona Features
  - Favorite characters functionality
  - Character view page enhancements
  - Character edit page with persona linking
  - Avatar photos and photo management
  - Image gallery system with tagging
  - Persona display name/title support
  - Multi-persona import format support
- Chat Features
  - Multiple chat imports support
  - SillyTavern chat import with sorting
  - Markdown rendering in chat and character views
  - Tags and persona display in chat lists
  - Improved modal dialogs
  - SillyTavern-compatible story string template support
- Tag System
  - Comprehensive tag system implementation
  - Tag display in chat lists
- Provider Support
  - Gab AI added as first-class provider
  - Grok added as first-class provider
  - Multi-provider support (Phase 0.7)
  - Connection testing functionality for profiles
  - Fetch Models and Test Message for OPENAI_COMPATIBLE and ANTHROPIC providers
  - Anthropic model list updated with Claude 4/4.5 models
  - Models sorted alphabetically in UI dropdowns
- Testing & Development
  - Comprehensive unit tests for avatar display and layout
  - Unit tests for image utilities and alert dialog
  - Unit tests for Phase 0.7 multi-provider support
  - Comprehensive front-end and back-end test suite
  - Playwright test configuration
  - GitHub Actions CI/CD with Jest
  - Pre-commit hooks with lint and test checks
- Infrastructure
  - SSL configuration
  - Security improvements to maskApiKey (fixed-length masking)
  - Package overrides for npm audit vulnerabilities

### 1.0 - Production Ready

- Complete tag system implementation across all entities
- Full image management capabilities
- Production deployment infrastructure (Docker, Nginx, SSL)
- Two new LLM providers (Grok, Gab AI)
- Comprehensive logging, rate limiting, and environment utilities
- Extensive test coverage (1000+ new test lines)
- Detailed API and deployment documentation
- Reorganized routes with proper authentication layer
- Enhanced UI components for settings and dashboard
