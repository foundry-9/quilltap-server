# Quilltap Roadmap

This document tracks planned features and improvements for Quilltap.

## Release Checklist

### 3.3.0

- [ ] Fix direct Node.js/Electron-hosted installation
- [X] ~~Optional (opt-out)~~ reporting to providers about app/version (tell OpenRouter that it's Quilltap/3.3.0 calling)
- [ ] Start a "recommendation" JSON file on https://quilltap.ai
  - [ ] Parser built-in on website
  - [ ] Downloadable information tracking:
    - Available providers
    - Available models
    - Censorship status
    - Cost
    - Capabilities
    - Tool-use success
    - Help LLM success
    - Adaptability (can they be serious? Can they roleplay?)
    - Thinking ability
- [ ] Context help documentation with LLM (lock down theme)
- [X] Turn off story backgrounds for help chats
- [X] Better "chat" look-and-feel for help
- [X] Unit test coverage
- [ ] Standard refactor pass
- [X] Organize documentation (dev docs, help docs, README)
- [X] Database locking
- [ ] Database version locking

## Planned Features

### Game and State (Pascal the Croupier)

- [ ] Document the new incarnation of the game and state system

### Plugin architecture (The Foundry)

- [ ] Ability to have simplified architecture for:
  - [ ] connection profiles/images/embedding
  - [X] themes — `.qtap-theme` bundle format (Phases 1-3 complete: bundle loader, CLI, bundled themes, registry with Ed25519 signatures)
  - [ ] API

### Chat & Conversation (The Salon)

- [ ] Character checkpointing (backups of a character at a certain point in time)
- [ ] "Visual Novel" options
- [X] Image generation can not only select characters but also different physical descriptions if they have them
- [X] Almost everything needs a way to handle "dangerous" (largely uncensored) content
  - [X] Gatekeeper needs to determine if content is dangerous
  - [X] Needs to be LLM paths for dangerous content after the determination is made
  - [X] Some way of flagging such content needs to be surfaced in the system
  - [X] Based on flags, things are either not allowed, not displayed, or allowed and displayed
  - [X] Implies a new quick-hide just for dangerous content
  - [ ] Further: user-determined danger paths (e.g., this talks about politics, I don't want to talk about politics) in addition to the general "most providers won't handle this" rails
  - [X] Testing

### LLM Integration (The Foundry)

- [ ] Tool management UI - Settings interface to enable/disable individual tools
  - [ ] per connection profile
  - [X] per project
  - [X] per chat
- [ ] Finish file read/write tool calling support with permissions
- [X] Fully agentic capabilities (limits on how many turns it takes, trading information back and forth, etc.)
- [ ] Add Google embeddings
- [ ] Add prompt guidelines for all image generators that have them
- [ ] Update image generators
- [ ] Add ability to use Eternal AI LoRAs

### Content & Worldbuilding (The Commonplace Book)

- [ ] Worldbook/Lore system

### External Integrations

#### Prospero

- [ ] General SSE-based MCP support improvements
- [ ] Python script support

#### The Lantern

- [ ] ComfyUI + LORA support for local installations (see [feature request](./comfy_ui_local_image.md))
- [X] Determination of what people are wearing in an image is iffy at best - needs help

### Calliope: Themes & UI

- [X] `.qtap-theme` bundle format for theme distribution (no npm/build tools required)
- [X] CLI theme management (`quilltap themes list/install/uninstall/validate/export/create`)
- [X] Theme registry system with Ed25519 signatures and browser UI
- [X] All bundled themes converted from npm plugins to `.qtap-theme` bundles
- [X] Deprecated and removed npm theme plugin directories
- [X] Get theme-storybook to match the app for everything

### Virgil: Setup & Onboarding

- [X] Setup wizard
  - [X] Default assistant, editable
  - [X] Can be restored quickly to basics
  - [X] Has intimate knowledge of this application
  - [ ] Works well enough with simple, low-cost or local LLMs (e.g., Mistral or Qwen)
- [ ] Application web page and useful help and videos hosted there
- [X] Built-in help able to be toggled so it works with every LLM with or without tools (a "help" conversation will be different, it will always search for what you say or what the conversation has been about recently and provide that data as part of the context for every message to the LLM)

## Completed in v2.10.0 and earlier

See [CHANGELOG.md](../docs/CHANGELOG_V2.md) for details on v2.7.0 and earlier releases.
