# Quilltap Roadmap

This document tracks planned features and improvements for Quilltap.

## In Progress

## 3.0: the container future

### Architecture Overview

Quilltap 3.0 runs inside a lightweight Linux VM on the host OS. The architecture has three layers:

1. **Guest image** (shared across all platforms) -- a Linux rootfs with Node, SQLite, and Quilltap pre-installed
2. **Orchestration layer** (shared) -- Electron launcher that manages VM lifecycle, health checks, and connects to the backend
3. **VM backend** (platform-specific, thin) -- talks to the host hypervisor to create/start/stop the VM

The platform-specific code is minimal (~200-300 lines per backend), while the guest image, build pipeline, and frontend orchestration are 100% shared.

### VM Backend Strategy

| Platform | Backend | Hypervisor | File Sharing | Status |
| ---------- | --------- | ------------ | ------------- | -------- |
| macOS | Lima + VZ driver | Apple Virtualization.framework | VirtioFS | Primary target |
| Windows | Lima + WSL2 driver (or direct `wsl.exe`) | Hyper-V (via WSL2) | Plan 9 / auto-mount | Future |
| Linux/Docker | Direct container | N/A | Bind mounts | Existing |

**Why not Firecracker?** Firecracker requires KVM (Linux-only). It cannot run natively on macOS or Windows. Lima with the VZ driver provides lightweight VMs natively on macOS without needing QEMU, and Lima's WSL2 driver (used by AWS Finch) provides the same interface on Windows.

**Precedent:** Rancher Desktop, AWS Finch, and Docker Desktop all use this exact pattern -- Lima/VZ on macOS, WSL2 on Windows, unified interface above.

### Phase 1: macOS Prototype

**1.1 Host layer:**

- Run **Lima** with the **VZ** (Virtualization.framework) driver -- no QEMU needed
- Bundle Lima into `/Applications/Quilltap.app/Contents/Resources/runtime/`:

  ```text
  runtime/
    bin/limactl                              # ~36 MB (includes guest agent)
    share/lima/templates/quilltap.yaml       # VM configuration
    libexec/lima/lima-guestagent.Linux-aarch64
  ```

- Installer adds launchd plist at `~/Library/LaunchAgents/com.quilltap.limalaunchd.plist`
- Lima invoked via environment variables (standard practice, used by Colima/Finch/Rancher):
  - `LIMACTL` -- path to bundled binary
  - `LIMA_HOME` -- `~/.qtlima` (must be short -- macOS 104-char socket path limit)
  - `LIMA_TEMPLATES_PATH` -- bundled templates directory

**1.2 Runtime image:**

- Build a Linux rootfs (Alpine or Debian, arm64) from the existing Dockerfile pipeline
- Pack Node, Python, Socat, SQLite, and Quilltap into `/opt/quilltap`
- Store as `quilltap-linux-arm64.tar.gz` (rootfs tarball, importable by both Lima and WSL2)
- Mount `~/Quilltap Projects/` as `/data/` inside the VM via VirtioFS

**1.3 Frontend orchestration:**

- Electron launcher calls `limactl start quilltap` (via the bundled binary)
- VM boots, Quilltap backend starts automatically
- Electron polls `localhost:5050` for health, connects, opens the app

**1.4 Networking & shutdown:**

- Lima's VZ driver handles NAT via `virtio-net`
- Port forwarding configured in `quilltap.yaml`: `localhost:5050` to `guest:5050`
- On exit: `limactl stop quilltap` gracefully powers down the VM

### Phase 2: Windows Support

- Use Lima's WSL2 driver (`vmType: wsl2`) or direct `wsl.exe` calls
- Same guest rootfs tarball imported via `wsl --import quilltap <path> quilltap-linux-arm64.tar.gz --version 2`
- Same orchestration layer -- Electron calls Lima or `wsl.exe` depending on platform
- Port forwarding via WSL2's automatic localhost forwarding or `netsh interface portproxy`
- File mounting: Windows drives auto-available at `/mnt/c/`, or bind-mount specific folders

### Phase 3: Developer Continuity

- Keep the Docker pipeline alive; every build produces:
  - `quilltap:latest` -- Docker image (existing)
  - `quilltap-linux-arm64.tar.gz` -- rootfs for Lima/WSL2 (new)
- Both derived from the same Dockerfile, keeping behavior identical
- `npm run dev` continues to work for local development without any VM

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
