# Quilltap

**Your AI, your projects, your stories, your partners, your rules.**

Quilltap is a self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who finds it deeply unsatisfying that their AI assistant forgets everything the moment they close a tab. Connect to any LLM provider, organize your work into projects with persistent files and context, create characters with genuine personalities, and build a private AI environment that learns, remembers, and — crucially — belongs entirely to you.

No subscriptions. No data harvested. No forgetting everything between sessions. No landlords.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Latest Stable](https://img.shields.io/github/v/release/foundry-9/quilltap?logo=github&label=stable&sort=semver&filter=!*dev*)](https://github.com/foundry-9/quilltap/releases/latest)
[![This Version](https://img.shields.io/badge/version-3.3.0--dev.25-yellow.svg?logo=github)](package.json)
[![Docker Hub](https://img.shields.io/docker/v/csebold/quilltap?logo=docker&label=docker&sort=semver)](https://hub.docker.com/r/csebold/quilltap)
[![npm](https://img.shields.io/npm/v/quilltap?logo=npm)](https://www.npmjs.com/package/quilltap)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/channels/1476289075152556205/1476290238187049184)

<p align="center">
  <img src="https://quilltap.ai/images/welcome-to-quilltap-2-8.png" alt="Welcome to Quilltap" />
</p>

**Website:** [quilltap.ai](https://quilltap.ai) · **Discord:** [Join us](https://discord.com/channels/1476289075152556205/1476290238187049184) · **Docker:** [csebold/quilltap](https://hub.docker.com/r/csebold/quilltap)

---

## What Quilltap Does

Quilltap is three things in one application, and you can use any combination of them.

**A private AI desktop.** Connect to Claude, GPT, Gemini, Grok, DeepSeek, or local models through Ollama. Your conversations stay on your machine. The AI builds long-term memory across sessions and can search your project files semantically. Agent Mode lets the AI use tools iteratively — web search, image generation, file management, and any MCP server you connect.

**A writer's workspace.** Organize notes, characters, and lore into projects with folders and files. The AI reads your documents, searches across your worldbuilding by meaning (not just keywords), and maintains context across conversations. Import your SillyTavern characters and chats directly.

**A character platform.** Create AI characters with detailed personalities, backstories, and voices that stay consistent across sessions. Run multi-character scenes with turn management. Roll dice, flip coins, track inventories and game state — all persistent and all built in.

*"Business in the front, party in the back... literary salon on the veranda."*

---

## Why Not Just Use Claude or ChatGPT?

A reasonable question. Here is the situation, presented without embellishment — well, with very little embellishment:

| What you get with hosted AI | What you get with Quilltap |
| --------------------------- | -------------------------- |
| Conversations disappear or get compressed | Persistent memory across all your chats |
| The AI forgets your project between sessions | Projects with files, folders, and custom instructions |
| One provider, their pricing, their rules | Connect to any provider — or run models locally |
| Your data on someone else's servers | Everything stays on your infrastructure |
| Generic assistant personality | Characters with real voices and personalities |
| No game mechanics or state tracking | Built-in dice rolls, inventories, and persistent game state |

---

## Getting Started

There are several paths to the same destination. Which one you choose depends on two questions: **what are you willing to install?** and **how much do you trust AI running on your machine?**

That second question deserves a moment of your attention. As AI models grow more capable — reading files, writing code, using tools — the question of *where* that code executes becomes important. A virtual machine is a genuine locked room: if an AI-generated script misbehaves, it misbehaves inside a contained environment with no access to your host system. Docker provides a similar boundary, though somewhat thinner. Running directly on your machine provides no boundary at all.

| | Desktop App (VM) | Docker | Node.js (`npx`) |
| --- | --- | --- | --- |
| **You install** | macOS: Xcode CLI Tools · Windows: WSL2 · Linux: Docker Engine | Docker Desktop or Docker Engine | Node.js 24+ |
| **First launch** | Slowest — downloads a VM image (~150 MB), boots a Linux guest | Fast — pulls the container image | Fastest — downloads app files, runs directly |
| **AI sandbox** | ✅ Full VM isolation | ⚠️ Container isolation (good, not airtight) | ❌ No isolation (runs with your permissions) |
| **Native window** | Yes (Electron) | Yes (Electron) or browser | Yes (Electron) or browser |
| **Best for** | Most users — best balance of safety and convenience | Server deployments, Docker veterans, Linux users | Quick evaluation, developers, the impatient |

> **Our recommendation:** The desktop application with its VM backend is what we suggest for most people. It is the slowest to start and the most demanding in its prerequisites, but it is the only path that gives you a genuine sandbox around your AI. If you already have Docker, the Electron app lets you switch between VM and Docker runtimes from its splash screen — no commitment required.

### The Civilized Way: Desktop App (Recommended)

Download the latest release from the [Releases page](https://github.com/foundry-9/quilltap/releases) for your platform:

- **macOS:** `.dmg` installer. Uses [Lima](https://lima-vm.io/) with Apple's Virtualization.framework. Requires Xcode Command Line Tools — the app will offer to install them.
- **Windows:** `.exe` installer. Uses WSL2, built into Windows 10 and 11. If WSL2 isn't enabled, run `wsl --install` in PowerShell as Administrator and restart.
- **Linux:** `.AppImage` (make executable and run) or `.deb` package. Requires [Docker Engine](https://docs.docker.com/engine/install/) — Linux uses Docker directly as its runtime backend.

Launch the app. It presents a splash screen where you choose your data directory, downloads a small Linux guest image (~150 MB, cached), boots the backend, and opens your workspace. The setup wizard handles the rest.

The desktop app manages multiple data directories from its splash screen — one for work, one for fiction, one for experiments. Each gets its own VM, so switching is a quick stop-and-start.

### The Dockworker's Route: Docker

**With the Electron app:** The desktop app includes a Docker runtime toggle right on the splash screen. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), launch Quilltap, and switch the runtime from "VM" to "Docker." Same native window, different engine underneath.

**Standalone with Docker:** The [csebold/quilltap](https://hub.docker.com/r/csebold/quilltap) image is available on Docker Hub. Use the included startup scripts for the smoothest experience:

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/foundry-9/quilltap/refs/heads/main/scripts/start-quilltap.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/foundry-9/quilltap/refs/heads/main/scripts/start-quilltap.ps1 | iex
```

The scripts auto-detect your platform, set the correct data directory, and find local services like Ollama — forwarding their ports into the container automatically.

Or run directly:

```bash
docker run -d \
  --name quilltap \
  -p 3000:3000 \
  -e QUILLTAP_TIMEZONE=America/New_York \
  -v /path/to/your/data:/app/quilltap \
  csebold/quilltap
```

Open [http://localhost:3000](http://localhost:3000) and the setup wizard will guide you through first-time configuration.

> **Timezone tip:** Set `QUILLTAP_TIMEZONE` to your IANA timezone (e.g., `America/New_York`, `Europe/London`, `Asia/Tokyo`) so timestamps in chats show your local time instead of UTC. The Electron desktop app detects this automatically.

### The Shortcut: npx

If you have Node.js installed and want to skip installers entirely:

```bash
npx quilltap
```

First run downloads application files (~150–250 MB) and caches them locally. Subsequent launches start instantly. Supports `--port`, `--data-dir`, and `--update` flags.

Or install globally:

```bash
npm install -g quilltap
quilltap
```

> **A word of caution:** The npx path runs with your user permissions and provides no sandbox. Excellent for kicking the tires. Less excellent for leaving the AI unsupervised with your filesystem. If you start here and decide to stay, consider graduating to one of the sandboxed options.

### From Source

For developers, tinkerers, and those who read `man` pages recreationally:

```bash
git clone https://github.com/foundry-9/quilltap.git
cd quilltap
npm install
npm run dev        # Development mode with hot reload
# or
npm run build && npm run start   # Production build
```

Requires **Node.js 24+** and **git**. See the [Development Guide](DEVELOPMENT.md) for building Electron installers, rootfs tarballs, and Docker images from source.

---

## Core Features

### Projects & Files

Organize your work into projects with custom system prompts, file uploads, and folder structures. The AI can list, read, and write your project files with permission. Files are stored on disk using their original filenames — you can browse them directly in your file manager. Semantic search finds things by meaning across your entire project. Built-in Markdown rendering with wikilink support, code highlighting, and PDF preview.

### Characters & Roleplay

Create AI characters with personality, backstory, system prompts, pronouns, aliases, and clothing records. Multi-character chats with a turn-order sidebar, identity reinforcement, impersonation, and swipe alternatives. The AI Character Import wizard generates complete characters from source material (wiki pages, documents, freeform text) using focused LLM calls. SillyTavern character and chat import is fully supported.

### Memory & Context

Long-term semantic memory that persists across conversations. The Memory Gate system reinforces near-duplicates, links related memories, and inserts new ones automatically. Proactive recall lets characters analyze recent conversation for relevant memories. Built-in memory housekeeping for deduplication and cleanup. Context compression handles long conversations, and the AI can request full context reload when needed.

Quilltap uses a three-model architecture for optimal cost and performance: your best model for chat, a cheap model for background tasks like memory extraction and titling, and an embedding model for semantic search.

### Agent Mode & Tools

Iterative tool use with self-correction for multi-step tasks. Built-in tools include web search (via Serper API), memory search, image generation, file management, and help search. The Run Tool feature lets you invoke any tool directly from the chat toolbar. Connect external tools through Model Context Protocol (MCP) servers, or write custom tool plugins.

### Alternative Content Provision and Routing — The Concierge

Intelligent content classification and routing with three modes: off, detect-only, or auto-route to uncensored providers. Uses OpenAI's free moderation endpoint when available, falling back to LLM-based classification. Chat-level danger flags with visual indicators and quick-hide integration.

### Gaming & Interactivity — Pascal the Croupier

Persistent chat state (JSON) for inventories, stats, scores, and any structured data. Project-level state shared across chats with per-chat overrides. Protected keys (underscore-prefixed) that the AI can't modify. Cryptographically secure dice rolls (d4 to d1000), coin flips, and random participant selection with auto-detection — "I roll 2d6" actually rolls.

### Story Backgrounds — The Lantern

AI-generated background images for chats based on scene context, with character appearance resolution using clothing and physical descriptions. Project backgrounds and chat card thumbnails. Automatic uncensored fallback routing for chats with flagged content.

---

## Supported Providers

Quilltap does not insist you patronize any particular establishment. Model lists are fetched at runtime from each provider's API, so you always see what's currently available.

| Provider | Notes |
| -------- | ----- |
| **Anthropic** | Claude families. Image understanding, tool use. |
| **OpenAI** | GPT families. Tool calling, image generation (GPT-Image, DALL-E). |
| **Google** | Gemini families. Multimodal, Imagen image generation, tool use. |
| **xAI** | Grok families. Native image generation, web search. |
| **Ollama** | Local/offline models (Llama, Phi, Mistral, etc.). Fully local, no API key needed. |
| **OpenRouter** | 200+ models through a unified API with automatic pricing. |
| **OpenAI-Compatible** | LM Studio, vLLM, Together AI, Groq, and any compatible endpoint. |

For best results we recommend Ollama or OpenAI for embedding, a lightweight model for the cheap LLM, and whichever primary model suits your taste and budget. OpenRouter can get you access to many providers through a single API key. Additional providers (such as Gab AI) are available as third-party plugins.

---

## Themes & Appearance

Switch themes live without reloading — instant redecoration, no painters required. Five bundled themes ship with the application:

| Theme | Style |
| ----- | ----- |
| **Old School** | Classic slate-blue palette with professional typography |
| **Art Deco** | Geometric elegance with navy-and-gold opulence |
| **The Great Estate** | Warm, manor-inspired design with mahogany and gold |
| **Earl Grey** | High-contrast dark theme with modern minimal styling |
| **Rains** | Warm, earthy palette with cozy amber accents |

Themes are distributed as `.qtap-theme` bundles — declarative archives containing JSON design tokens, CSS, fonts, and images. No build tools, no npm packages, no TypeScript — just edit and install. Create your own with `npx create-quilltap-theme my-theme`, manage from the CLI with `npx quilltap themes`, or browse and install from theme registries in Settings with Ed25519 signature verification.

Themes can override subsystem names and images, letting each theme define its own personality for the application.

---

## Data & Backup

### Where your data lives

All Quilltap data — database, files, logs — resides in a single directory. The application tells you exactly where at the bottom of every page.

| Platform | Default Location | Override |
| -------- | ---------------- | -------- |
| **macOS (Electron)** | `~/Library/Application Support/Quilltap` | Splash screen directory chooser or `QUILLTAP_DATA_DIR` |
| **Windows (Electron)** | `%APPDATA%\Quilltap` | Splash screen directory chooser or `QUILLTAP_DATA_DIR` |
| **Linux** | `~/.quilltap` | `QUILLTAP_DATA_DIR` |
| **Docker** | Mount a host directory to `/app/quilltap` | Volume mount (`-v`) |

### What's stored

- **Database:** SQLite encrypted at rest with SQLCipher — every database file is encrypted on disk; integrity checks on startup, periodic WAL checkpoints, physical backups with tiered retention (daily for 7 days, weekly for 4 weeks, monthly for 12 months, yearly forever); standard `sqlite3` CLI cannot open encrypted files, use `npx quilltap db` instead
- **Files:** Local filesystem using original filenames, organized by project. Real-time filesystem watcher keeps the database in sync.
- **API keys:** Stored in the encrypted database (whole-database SQLCipher encryption replaces the former field-level AES-256-GCM encryption)

### Backup options

- **Full system backup** — Single ZIP file containing everything: characters, chats, files, memories, settings, and installed plugins
- **Native export** — Selective `.qtap` format with conflict resolution for sharing specific content
- **SillyTavern format** — Import/export for compatibility

See [Backup & Restore](docs/BACKUP-RESTORE.md) and [Database Protection](help/database-protection.md) for details.

---

## For Developers

Quilltap was built to be extended. The plugin system supports seven extension points, all delivered as npm packages:

| Plugin Type | What It Does |
| ----------- | ------------ |
| **LLM Provider** | Add new AI chat services with tool use, streaming, and multimodal support |
| **Image Provider** | Image generation backends (bundled: OpenAI/DALL-E, Google Imagen, xAI/Grok) |
| **Embedding Provider** | Semantic search and memory embedding (bundled: OpenAI, Ollama, built-in) |
| **Theme** | Custom visual styles via `.qtap-theme` bundles or legacy npm plugins |
| **Template** | Roleplay formatting templates for different prompt styles |
| **Tool** | Custom LLM capabilities (the AI can use your tool mid-conversation) |
| **Search Provider** | Alternative web search backends (ships with Serper.dev; swap in your own) |

### Architecture at a glance

Quilltap is a single Next.js 16 application (App Router) that serves both the UI and API routes. The tech stack:

- **Frontend:** React 19, TypeScript, Tailwind CSS 4 with a semantic `qt-*` class system for full theme overrideability
- **Backend:** Next.js API routes, SQLite with SQLCipher encryption (better-sqlite3-multiple-ciphers) with WAL mode, Zod schema validation
- **Desktop:** Electron shell with platform-specific VM backends (Lima/VZ on macOS, WSL2 on Windows, Docker on Linux)
- **Build:** GitHub Actions CI/CD with automated releases — rootfs tarballs, Electron installers (macOS DMG, Windows NSIS, Linux AppImage/deb), Docker multi-arch images, and npm package all built from a single tag push

The entire provider system is plugin-based — every bundled provider (Anthropic, OpenAI, Google, xAI, Ollama, OpenRouter, OpenAI-Compatible) is a plugin with the same API surface available to third-party authors.

### Getting started with development

```bash
git clone https://github.com/foundry-9/quilltap.git
cd quilltap
npm install
npm run dev
```

See the plugin development guides for each extension point:

- [Provider Development](docs/PROVIDER_PLUGIN_DEVELOPMENT.md)
- [Theme Development](docs/THEME_PLUGIN_DEVELOPMENT.md) (legacy plugin format; new themes use `.qtap-theme` bundles)
- [Template Development](docs/TEMPLATE_PLUGIN_DEVELOPMENT.md)
- [Tool Development](docs/TOOL_PLUGIN_DEVELOPMENT.md)
- [Search Provider Development](docs/SEARCH_PLUGIN_DEVELOPMENT.md)

### Contributing

Contributions are welcome. We ask that you open an issue to discuss major changes before submitting a PR — it is far better to align on direction before building the bridge, as anyone who has ever built a bridge in the wrong direction can attest.

See the [Development Guide](DEVELOPMENT.md) for local setup, testing, and build instructions.

---

## Troubleshooting

**Desktop app won't start (macOS):** Ensure Xcode Command Line Tools are installed — the app will prompt you if they're missing. Check Console.app for Lima-related errors. Try deleting the VM; the app will recreate it on next launch.

**Desktop app won't start (Windows):** Ensure WSL2 is installed: run `wsl --install` in PowerShell as Administrator. Check if the distro exists: `wsl --list --verbose`. See the [Windows Troubleshooting Guide](docs/WINDOWS.md).

**Docker container issues:** Check `docker logs quilltap`. Verify port 3000 isn't already in use. For local services (Ollama, etc.), use the startup scripts — they handle port forwarding automatically.

**General:** The footer shows your data directory path and backend mode (VM/Docker/local) — useful for debugging. If none of the above resolves your predicament: [GitHub Issues](https://github.com/foundry-9/quilltap/issues).

---

## Documentation

- [Development Guide](DEVELOPMENT.md) — Contributing, local dev, building from source
- [Deployment Guide](docs/DEPLOYMENT.md) — Production setup with SSL and reverse proxies
- [API Reference](docs/API.md) — REST endpoints
- [Image Generation](docs/IMAGE_GENERATION.md) — Provider configuration
- [File LLM Access](docs/FILE_LLM_ACCESS.md) — How AI reads your files
- [Database Architecture](docs/DATABASE_ABSTRACTION.md) — SQLite backend and protection
- [Prompt Architecture](docs/PROMPT_ARCHITECTURE.md) — How system prompts are assembled
- [Windows Troubleshooting](docs/WINDOWS.md) — WSL2 setup and common issues
- [Changelog](docs/CHANGELOG.md) — Release history
- [Roadmap](features/ROADMAP.md) — What's coming

---

## Tech Stack

Next.js 16 (App Router) · React 19 · TypeScript · SQLite with SQLCipher (better-sqlite3-multiple-ciphers) · Tailwind CSS 4 · Electron · Lima/VZ (macOS) · WSL2 (Windows) · Docker (Linux) · Zod · GitHub Actions

---

## License

MIT License — see [LICENSE](LICENSE)

Copyright © 2025, 2026 Foundry-9 LLC

---

## Support

- **Issues:** [GitHub Issues](https://github.com/foundry-9/quilltap/issues)
- **Discord:** [Join us](https://discord.com/channels/1476289075152556205/1476290238187049184)
- **Website:** [quilltap.ai](https://quilltap.ai)
- **Author:** Charles Sebold ([charles.sebold@foundry-9.com](mailto:charles.sebold@foundry-9.com))
- **Company:** [Foundry-9 LLC](https://foundry-9.com)

---

<details>
<summary><b>Acknowledgments</b></summary>

Quilltap stands on the shoulders of these excellent open source projects, and is grateful for the view:

**Core:** React, Next.js, TypeScript, better-sqlite3-multiple-ciphers (SQLCipher), Zod

**AI & LLM:** OpenAI SDK, Anthropic SDK, Google Generative AI SDK, xAI/Grok SDK, Model Context Protocol SDK

**UI:** Tailwind CSS, React Markdown, React Syntax Highlighter, PDF.js, sharp, Lucide Icons

**Desktop & Infrastructure:** Electron, Lima, Docker

**Testing:** Jest, Playwright, Storybook, Testing Library

**Build & Tooling:** tsx, electron-builder, cross-env

Special thanks to [SillyTavern](https://github.com/SillyTavern/SillyTavern) for pioneering this space and inspiring character format compatibility. One does not forget those who blazed the trail.

</details>
