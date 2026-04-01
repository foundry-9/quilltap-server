# Quilltap Changelog v1.x

## Recent Changes

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
