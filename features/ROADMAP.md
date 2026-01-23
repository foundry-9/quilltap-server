# Quilltap Roadmap

This document tracks planned features and improvements for Quilltap.

## In Progress

### Authentication Enhancements

- [ ] Retain site-installed plugins in `plugins/`, controlled by environment variables
- [ ] Move user-installed plugins to `plugins/users/[login-uuid]/`
- [ ] Add Apple, GitHub OAuth plugins
- [X] Make the signout actually completely wipe the session data from the browser and take you back to the beginning page

### Mobile Responsive

- [ ] Fully mobile-capable media breakpoints
  - [ ] Home
  - [ ] Chat (partially done in v2.4)
  - [ ] Characters
  - [ ] Settings
  - [ ] Tools
  - [ ] About

## Planned Features

### Chat & Conversation

- [ ] Server-side Markdown render of historical chat messages to speed up delivery
- [ ] Character checkpointing (backups of a character at a certain point in time)
- [ ] "Visual Novel" options

### LLM Integration

- [ ] Tool management UI - Settings interface to enable/disable individual tools per profile
- [ ] Finish file read/write tool calling support with permissions

### Content & Worldbuilding

- [ ] Worldbook/Lore system

### External Integrations

- [ ] General SSE-based MCP support improvements
- [ ] Python script support
- [ ] ComfyUI + LORA support for local installations (see [feature request](./comfy_ui_local_image.md))
- [ ] Ability to auto-upgrade plugins

### Themes & UI

- [ ] Arcadia "art deco" theme to show off what the theme system can really do
- [ ] Get theme-storybook to match the app for everything

### Setup & Onboarding

- [ ] Setup wizard
  - [ ] Default assistant, editable
  - [ ] Can be restored quickly to basics
  - [ ] Has intimate knowledge of this application
  - [ ] Works well enough with simple, low-cost or local LLMs (e.g., Mistral or Qwen)

### Platform Expansion

- [ ] Create web-only version that uses IndexedDB for everything

## Completed in v2.7

- [x] Homepage redesign with 3-column responsive layout
- [x] Enhanced global search with theming and improved UX
- [x] Collapsible participant sidebar for multi-character chats
- [x] Quick navigation buttons when sidebar collapsed
- [x] Cache OAuth profile pictures locally
- [x] Display chat title in toolbar header
- [x] Complete removal of DevConsole functionality
- [x] Major API v1 migration (all routes consolidated under `/api/v1/`)
- [x] Complete removal of personas system (replaced by user-controlled characters)
- [x] Migration system moved from plugin to core (runs before server accepts requests)
- [x] Bidirectional sync between Quilltap instances
- [x] Token usage tracking with cost estimation
- [x] Connection profiles now sync between instances
- [x] MCP (Model Context Protocol) Server Connector plugin
- [x] Multi-tool plugin support
- [x] curl tool plugin for HTTP requests
- [x] Plugin configuration UI for per-user settings
- [x] File storage abstraction system with pluggable backends
- [x] First-class folder entities with database persistence
- [x] Projects feature (full implementation)
- [x] File management LLM tool
- [x] Context compression for long conversations
- [x] Async pre-compression for better UX
- [x] `request_full_context` tool for AI to reload full context
- [x] Graceful request limit error recovery
- [x] Enhanced file deletion with association management
- [x] All file types can now be uploaded
- [x] Syntax highlighting for code files
- [x] Markdown rendering in file preview
- [x] PDF.js viewer for PDF files
- [x] Redesigned file browser with thumbnails and preview modal
- [x] Automatic image resizing for provider size limits
- [x] Paste images directly into chat textarea
- [x] File attachment fallback works with S3 storage
- [x] Hot-load LLM provider plugins after installation
- [x] Dynamic API key provider list from registry
- [x] Plugin installation from npm
- [x] 844+ new unit tests (3438 total)

## Completed in v2.6

See [CHANGELOG.md](../docs/CHANGELOG.md) for details on v2.6 and earlier releases.
