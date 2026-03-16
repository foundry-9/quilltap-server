# Quilltap Roadmap

This document tracks planned features and improvements for Quilltap.

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
- [ ] Image generation can not only select characters but also different physical descriptions if they have them
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
- [ ] Get theme-storybook to match the app for everything

### Virgil: Setup & Onboarding

- [ ] Setup wizard
  - [ ] Default assistant, editable
  - [ ] Can be restored quickly to basics
  - [ ] Has intimate knowledge of this application
  - [ ] Works well enough with simple, low-cost or local LLMs (e.g., Mistral or Qwen)
- [ ] Application web page and useful help and videos hosted there
- [ ] Built-in help able to be toggled so it works with every LLM with or without tools (a "help" conversation will be different, it will always search for what you say or what the conversation has been about recently and provide that data as part of the context for every message to the LLM)

## Completed in v2.10

- [X] Title generation needs better guidelines (every NSFW option shouldn't preach about consent and boundaries, for example)
- [X] More intelligent handling of empty messages from the LLM (usually some kind of error, but a plain blank often means you crossed a provider line - NSFW, alternative content provision and routing)
  - [X] Image prompt generation
  - [X] Memory generation
  - [X] Context compression
  - [X] LLM chat message generation
- [X] Arcadia "art deco" theme to show off what the theme system can really do
- [X] Pull chat settings into the participants sidebar, make it the chat sidebar
  - [X] Every participant should be able to be taken over ad-hoc
  - [X] Every participant should be able to be silenced or phased out of the current conversation
  - [X] Every participant should be able to be either pulled in immediately, interrupt, or queue up
  - [X] Every participant should have an option to be switched to a different LLM provider
- [X] Server-side Markdown render of historical chat messages to speed up delivery
- [X] The Lantern (story backgrounds)
  - [X] Story background generation
  - [X] The thing that provides the context should not be the title of the chat
- [X] Memory search every time
  - [X] The cheap/fast LLM should take whatever has happened since the last time they spoke
  - [X] Reduce that to keywords
  - [X] Search the memories for those keywords
  - [X] Preload the prompt with things that spring to mind because of the keywords

## Completed in v2.7.0 and earlier

See [CHANGELOG.md](../docs/CHANGELOG_V2.md) for details on v2.7.0 and earlier releases.
