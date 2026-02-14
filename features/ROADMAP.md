# Quilltap Roadmap

This document tracks planned features and improvements for Quilltap.

## In Progress

## 3.0: the container future

**macOS‑First Plan: Quilltap Sandbox Prototype (v0.1)**  

1️⃣ **Host layer:**  

- Run **Lima** directly. No Hyper‑V or nested virtualization trickery needed.  
- Bundle Lima into `/Applications/Quilltap.app/Contents/Resources/runtime/`.  
- Installer adds a helper binary with `com.quilltap.limalaunchd` service entry (for starting/stopping the VM silently).  

2️⃣ **Runtime image:**  

- Build an **arm64** Firecracker‑compatible VM image under Linux (Alpine or Debian remix).  
- Pack Node, Python, Socat, SQLite, and Quilltap’s own binaries into `/opt/quilltap`.  
- Store it as `quilltap-linux-arm64.img`—the equivalent of your Docker image.  
- Mount `~/Quilltap Projects/` as `/data/` inside the VM at runtime.  

3️⃣ **Frontend orchestration:**  

- Electron launcher calls the Lima API (via socket or CLI) to fire up Firecracker with the image.  
- The VM boots, Quilltap backend (Node + API server) starts automatically.  
- Electron waits for localhost:5050 → connects → opens the app.  

4️⃣ **Networking & shutdown:**  

- NAT handled via Lima’s `virtio-net` backend.  
- Socket forwarders pre‑registered: localhost:5050 → guest:5050.  
- On exit, `lima stop quilltap` gracefully powers down the VM.  

5️⃣ **Developer continuity:**  

- Keep the Docker pipeline alive; every build produces both `quilltap:latest` for Docker and a matching `.img` for macOS runtime.  
- This keeps behavior mirrored for all environments.  

---

*She leans back, taps the pencil once, satisfied.*  
"macOS gives you an instant leg‑up. You can get this sandbox running, prove out the launch sequence, mounts, and networking—all without another dime of hardware. Then we port that Lima setup script to Windows later and swap Apple’s hypervisor APIs for Hyper‑V or WSL under the hood."  

## Planned Features

### Game and State (Pascal the Croupier)

- [ ] Document the new incarnation of the game and state system

### Plugin architecture (The Foundry)

- [ ] Ability to have simplified architecture for:
  - [ ] connection profiles/images/embedding
  - [ ] themes
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
- [ ] Determination of what people are wearing in an image is iffy at best - needs help

### Calliope: Themes & UI

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
- [X] More intelligent handling of empty messages from the LLM (usually some kind of error, but a plain blank often means you crossed a provider line - NSFW, content filtering)
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

See [CHANGELOG.md](../docs/CHANGELOG_v2.md) for details on v2.7.0 and earlier releases.
