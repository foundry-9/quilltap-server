# Quilltap Roadmap

This document tracks planned features and improvements for Quilltap.

## Release Checklist

### 3.3.0

- [X] Fix direct Node.js/Electron-hosted installation
- [X] ~~Optional (opt-out)~~ reporting to providers about app/version (tell OpenRouter that it's Quilltap/3.3.0 calling)
- [ ] Start a "recommendation" JSON file on [Quilltap website](https://quilltap.ai)
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
    - Best settings for purpose (temperature, top_p)
- [X] Context help documentation with LLM (lock down theme)
- [X] Browseable Help Guide tab (see `help_guide.md`)
- [X] Turn off story backgrounds for help chats
- [X] Better "chat" look-and-feel for help
- [X] Unit test coverage
- [X] Standard refactor pass
- [X] Organize documentation (dev docs, help docs, README)
- [X] Database locking
- [X] Database version locking

## Planned Features

### Pascal the Croupier — the Inventory

- [ ] The Inventory — objects a character carries, in four tiers, with archetypes, kits and per-chat equipped state (design: [inventory.md](inventory.md))
- [ ] Inventory tools and Pascal support — the `inventory_*` family, the `inventory` / `inventoryCount` subjects, `$inventory` operand, placeholders and the `inventory` effect (design: [inventory-tools-and-pascal.md](inventory-tools-and-pascal.md); depends on the Inventory)

### Game and State (Pascal the Croupier)

- [ ] Document the new incarnation of the game and state system
- [x] Workbench wardrobe picker — choose garments and outfits for a `wardrobe` side effect from a browsable list showing where each lives, its slots and its picture (design: [complete/pascal-wardrobe-effect-picker.md](complete/pascal-wardrobe-effect-picker.md))

### Plugin architecture (The Foundry)

- [ ] Ability to have simplified architecture for:
  - [ ] connection profiles/images/embedding
  - [X] themes — `.qtap-theme` bundle format (Phases 1-3 complete: bundle loader, CLI, bundled themes, registry with Ed25519 signatures)
  - [ ] API

### Chat & Conversation (The Salon)

- [ ] Character checkpointing (backups of a character at a certain point in time)
- [ ] "Visual Novel" options
- [X] In Their Own Words — restate impersonated lines in the character's voice before posting (design: [complete/impersonation-voice-rewrite.md](complete/impersonation-voice-rewrite.md))
- [X] Four-state character participation system (active/silent/absent/removed) with status change notifications
- [X] Memory recap at chat start — characters receive first-person narrative summaries from their Commonplace Book when joining a chat
- [X] Image generation can not only select characters but also different physical descriptions if they have them
- [X] Almost everything needs a way to handle "dangerous" (largely uncensored) content
  - [X] Gatekeeper needs to determine if content is dangerous
  - [X] Needs to be LLM paths for dangerous content after the determination is made
  - [X] Some way of flagging such content needs to be surfaced in the system
  - [X] Based on flags, things are either not allowed, not displayed, or allowed and displayed
  - [X] Implies a new quick-hide just for dangerous content
  - [x] Concierge overhaul: refusal-driven failover, refusal ledger, three states, own Settings tab — see [concierge-overhaul.md](complete/concierge-overhaul.md)
  - [ ] Further: user-determined danger paths (e.g., this talks about politics, I don't want to talk about politics) in addition to the general "most providers won't handle this" rails
  - [X] Testing
- [X] Better selectable saved scenarios and prompts per chat
- [x] Scenarios from anywhere — browse every character, project, group and General scenario from either picker; a chat keeps a source pointer; one `resolveScenarioLocation` (design: [complete/scenarios-from-anywhere.md](complete/scenarios-from-anywhere.md))
- [X] Wardrobe folders — user-defined folders under each tier's `Wardrobe/`, breadcrumb browser, move-to-folder and bulk move; the path is the truth (design: [complete/wardrobe-folders.md](complete/wardrobe-folders.md))
- [x] Wardrobe outfit history — a per-character, per-chat numbered record of every change of clothes (one entry per Aurora announcement), `wardrobe_rollback` / `wardrobe_history` tools, a cursor that moves back and forward without renumbering, and a History tab with **Wear again** in the Wardrobe dialog (design: [complete/wardrobe-outfit-history.md](complete/wardrobe-outfit-history.md))
- [X] Scenario Builder — The Host researches (web for a real place, the chat's visible stores for an in-world one) and drafts a cast-agnostic starting scene, editable and revisable, usable at once or saved to General, a project, a group, or a character's scenarios (design: [scenario-builder.md](complete/scenario-builder.md))

### LLM Integration (The Foundry)

- [ ] Tool management UI - Settings interface to enable/disable individual tools
  - [ ] per connection profile
  - [X] per project
  - [X] per chat
- [X] Finish file read/write tool calling support with permissions
- [X] Fully agentic capabilities (limits on how many turns it takes, trading information back and forth, etc.)
- [ ] Add Google embeddings
- [ ] Add prompt guidelines for all image generators that have them
- [X] Update image generators

### Content & Worldbuilding (The Commonplace Book)

- [x] Memory system refactor — one candidate shape, one extraction context, parent-side admission, three named scores, one clock, one recall pipeline with delivery, one maintenance job, one deletion chokepoint; `vector_entries` retired for memories (design: [memory-system-refactor.md](complete/memory-system-refactor.md))
- [ ] Worldbook/Lore system
- [X] Complete embedding of files
  - [X] Text files
  - [X] Files whose text can be extracted
  - [X] All images should have database metadata with a description
  - [X] Any images generated by Lantern should have the original prompt
  - [X] search_files tool
    - context (all, general, context (general + project + chat), project + chat only)
    - file type (if known) - document, image, any

### Characters (Aurora)

- [X] AI direct character edit
  - [X] Give the AI instructions, it proposes edits to the character
  - [ ] Optionally can adjust or delete memories

### External Integrations

#### Prospero

- [ ] General SSE-based MCP support improvements
- [ ] Python script support

#### The Lantern

- [ ] ComfyUI + LORA support for local installations (see [feature request](./comfy_ui_local_image.md))
- [X] Determination of what people are wearing in an image is iffy at best - needs help

### Calliope: Themes & UI

- [X] Orphaned file cleanup with de-duplication in file browser (broom icon, relocate/delete modal)
- [X] Copy-to-clipboard button on full-screen image viewers
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
