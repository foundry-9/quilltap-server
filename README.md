# Quilltap

**Your AI, your projects, your stories, your partners, your rules.**

Quilltap is a self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who finds it deeply unsatisfying that their AI assistant forgets everything the moment they close a tab. Connect to any LLM provider, organize your work into projects with persistent files and context, create characters with genuine personalities, and build a private AI environment that learns, remembers, and — crucially — belongs entirely to you.

No subscriptions. No data harvested. No forgetting everything between sessions. No landlords.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Latest Stable](https://img.shields.io/github/v/release/foundry-9/quilltap-server?logo=github&label=stable&sort=semver&filter=!*dev*)](https://github.com/foundry-9/quilltap-server/releases/latest)
[![This Version](https://img.shields.io/badge/version-4.2.0--dev.33-yellow.svg?logo=github)](package.json)
[![Docker Hub](https://img.shields.io/docker/v/foundry9/quilltap?logo=docker&label=docker&sort=semver)](https://hub.docker.com/r/foundry9/quilltap)
[![npm](https://img.shields.io/npm/v/quilltap?logo=npm)](https://www.npmjs.com/package/quilltap)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/channels/1476289075152556205/1476290238187049184)

<p align="center">
  <img src="https://quilltap.ai/images/welcome-to-quilltap-2-8.png" alt="Welcome to Quilltap" />
</p>

**Website:** [quilltap.ai](https://quilltap.ai) · **Discord:** [Join us](https://discord.com/channels/1476289075152556205/1476290238187049184) · **Docker:** [foundry9/quilltap](https://hub.docker.com/r/foundry9/quilltap)

---

## What Quilltap Does

Quilltap is three things in one application. Use any combination of them.

**A private AI desktop.** Connect to Claude, GPT, Gemini, Grok, DeepSeek, or local models through Ollama — all from one interface, with your conversations stored on your machine. The AI builds long-term memory across sessions, searches your files by meaning, and can use tools iteratively: web search, image generation, file management, and any MCP server you connect. Switch providers any time. Keep your data always.

**A writer's workspace.** Organize notes, characters, and worldbuilding into projects with folders, files, and custom instructions. The AI reads your documents, searches across your entire project semantically — not just by keywords — and maintains context across conversations. If you've ever lost a thread because your AI forgot what you told it yesterday, this is the room where that stops happening.

**A place for AI relationships.** Create AI characters with genuine personalities, backstories, and voices that persist across sessions. Build a friendship, a companionship, or a partnership on your own terms — with memory that lasts, privacy that's real, and no one looking over your shoulder deciding what's appropriate for you. Your companion remembers your conversations, learns your patterns, and grows with you over time. This is your space. You decide what happens in it.

Beyond these three, Quilltap also supports multi-character scenes with turn management, dice rolls and game state tracking, and full roleplay mechanics — but the foundation is simpler than all that: an AI environment that remembers, respects your privacy, and belongs entirely to you.

---

## Why Not Just Use Claude or ChatGPT?

A fair question. Here's the honest answer:

| What you get with hosted AI | What you get with Quilltap |
| --------------------------- | -------------------------- |
| Conversations disappear or get compressed | Persistent memory across all your chats |
| The AI forgets your project between sessions | Projects with files, folders, and custom instructions |
| One provider, their pricing, their rules | Connect to any provider — or run models locally for free |
| Your data on someone else's servers | Everything stays on your machine |
| Generic assistant personality | Characters with real voices and persistent identities |
| Content policies you didn't choose | You decide what's appropriate in your own space |
| No relationship continuity | Memory, recall, and genuine emotional persistence |

Quilltap doesn't replace Claude or ChatGPT — it connects to them (and others) while giving you ownership of the conversation. Your data never leaves your infrastructure. Your characters never forget who they are. And nobody gets to revoke your access to a relationship you built.

---

## Getting Started

There are several paths to the same destination. Which one you choose depends on two questions: **what are you willing to install?** and **how much do you trust AI running on your machine?**

That second question deserves a moment of your attention. As AI models grow more capable — reading files, writing code, using tools — the question of *where* that code executes becomes important. A virtual machine is a genuine locked room: if an AI-generated script misbehaves, it misbehaves inside a contained environment with no access to your host system. Docker provides a similar boundary, though somewhat thinner. Running directly on your machine provides no boundary at all.

| | Desktop App | Docker | Node.js (`npx`) |
| --- | --- | --- | --- |
| **You install** | Download from GitHub | Docker Desktop or Docker Engine | Node.js 22+ |
| **First launch** | Double-click the app | Fast — pulls the container image | Fast — downloads app files, runs directly |
| **AI sandbox** | ✅ VM isolation (Lima/WSL2) or container | ⚠️ Container isolation (good, not airtight) | ❌ No isolation (runs with your permissions) |
| **Best for** | Most users — native window, managed updates | Server deployments, Docker veterans, Linux users | Quick evaluation, developers, the impatient |

> **Our recommendation:** The Desktop App provides the best experience for most people — a native window with managed updates and optional VM isolation for AI sandboxing. If you're deploying to a server or already live in Docker, the container image is excellent. If you have Node.js and simply want to kick the tires, `npx quilltap` will have you running in under a minute.

### Desktop App

The Quilltap desktop app (Electron) is available from the [quilltap-shell](https://github.com/foundry-9/quilltap-shell) repository. It provides a native window on macOS, Windows, and Linux, with automatic updates, instance management, and optional VM-based isolation (Lima on macOS, WSL2 on Windows) for sandboxed AI execution.

### Docker

The [foundry9/quilltap](https://hub.docker.com/r/foundry9/quilltap) image is available on Docker Hub. Use the included startup scripts for the smoothest experience:

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/foundry-9/quilltap-server/refs/heads/main/scripts/start-quilltap.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/foundry-9/quilltap-server/refs/heads/main/scripts/start-quilltap.ps1 | iex
```

The scripts auto-detect your platform, set the correct data directory, and find local services like Ollama — forwarding their ports into the container automatically.

Or run directly:

```bash
docker run -d \
  --name quilltap \
  -p 3000:3000 \
  -e QUILLTAP_TIMEZONE=America/New_York \
  -v /path/to/your/data:/app/quilltap \
  foundry9/quilltap
```

Open [http://localhost:3000](http://localhost:3000) and the setup wizard will guide you through first-time configuration.

> **Timezone tip:** Set `QUILLTAP_TIMEZONE` to your IANA timezone (e.g., `America/New_York`, `Europe/London`, `Asia/Tokyo`) so timestamps in chats show your local time instead of UTC.

### The Quick Route: npx

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

> **A word of caution:** Running Quilltap directly on Node.js — whether via `npx` or a global install — runs with your user permissions and provides no sandbox. Excellent for kicking the tires. Less excellent for leaving the AI unsupervised with your filesystem. If you start here and decide to stay, consider graduating to one of the sandboxed options.

### From Source

For developers, tinkerers, and those who read `man` pages recreationally:

```bash
git clone https://github.com/foundry-9/quilltap-server.git
cd quilltap-server
npm install
npm run dev        # Development mode with hot reload
# or
npm run build && npm run start   # Production build
```

Requires **Node.js 22+** and **git**. See the [Development Guide](docs/developer/DEVELOPMENT.md) for building Docker images from source.

---

## Core Features

### AI Desktop

Connect to any major AI provider — or several at once. Quilltap uses a three-model architecture for optimal cost and performance: your best model for chat, a lightweight model for background tasks like memory extraction and titling, and an embedding model for semantic search. Model lists are fetched live from each provider, so you always see what's currently available.

| Provider | Notes |
| -------- | ----- |
| **Anthropic** | Claude families. Image understanding, tool use. |
| **OpenAI** | GPT families. Tool calling, image generation (GPT-Image, DALL-E). |
| **Google** | Gemini families. Multimodal, Imagen image generation, tool use. |
| **xAI** | Grok families. Native image generation, web search. |
| **Ollama** | Local/offline models (Llama, Phi, Mistral, etc.). Fully local, no API key needed. |
| **OpenRouter** | 200+ models through a unified API with automatic pricing. |
| **OpenAI-Compatible** | LM Studio, vLLM, Together AI, Groq, and any compatible endpoint. |

Each connection profile is classified into a **model class** — Compact, Standard, Extended, or Deep — that defines its context window and output capacity. Don't know the right settings for your model? **Auto-configure** searches the web for your model's specifications, sends the results to your default LLM for analysis, and applies optimal settings automatically. Budget-driven **context compression** uses your profile's context window and output limits to intelligently compress conversation history and recalled memories when they approach capacity, rather than using arbitrary message counts.

Agent Mode lets the AI use tools iteratively — web search, image generation, file management, memory search, and any MCP server you connect. The Run Tool feature lets you invoke any tool directly from the chat toolbar. The plugin system means additional providers and tools can be added without waiting for us.

### Writer's Workspace

Organize your work into projects with custom system prompts, file uploads, and folder structures. The AI can list, read, and write your project files with permission. Files are stored on disk using their original filenames — browse them directly in your file manager.

Semantic search finds content by meaning across your entire project: not just the file that mentions "the red door," but the one that describes "a crimson entrance" three chapters ago. Built-in Markdown rendering with wikilink support, code highlighting, and PDF preview. Orphaned file cleanup with automatic de-duplication keeps your storage tidy.

### Characters & Companions

Create AI characters with personality, backstory, system prompts, pronouns, aliases, and physical descriptions. Each character maintains their own long-term memory — they remember your conversations, your preferences, your history together. When you come back after a week away, they know what you talked about last time. In multi-character chats, characters also form memories about each other — learning names, personalities, and shared experiences the way people do.

Characters aren't limited to a single personality template. Each can have multiple named system prompts and scenarios, letting you shift context — the same companion in different settings, or different facets of the same relationship. The AI Character Import wizard can generate a complete character from source material (wiki pages, documents, freeform text). The **Non-Quilltap Prompt generator** exports any character as a standalone system prompt for use in other AI tools — taking your character with you when you need to.

The Concierge system ensures that your conversations are never arbitrarily refused. Instead of blocking content, it routes intelligently — detecting content type and, when configured, directing requests to providers that can handle them. You set the boundaries. The software respects them.

### Memory & Continuity

Long-term semantic memory persists across conversations — but by design, it's not a transcript. The Memory Gate system distills what characters *learn* from conversations: facts, preferences, relationship dynamics, emotional patterns, and the occasional memorable quote. Characters remember that you hate cilantro and that Tuesday was hard. They don't parrot back what you said word for word. This is deliberate. Human memory works by impression and meaning, not by recording, and character memory is built the same way.

When you *do* need verbatim recall, the search bar at the top of every screen provides it — full-text search across all conversations, memories, and characters. That's your eidetic index. The characters get something more like wisdom.

Proactive recall lets characters analyze recent conversation for relevant memories without being asked. Memory recap at chat start generates a first-person narrative summary from each character's memory, giving them genuine continuity across sessions. Built-in memory housekeeping handles deduplication and cleanup. Context compression manages long conversations, and the AI can request full context reload when needed.

### Multi-Character & Roleplay

Multi-character chats with a turn-order sidebar, four-state participation (active, silent, absent, removed), identity reinforcement, impersonation, and swipe alternatives. Private whisper messages between characters. SillyTavern character and chat import is fully supported.

### Gaming & Interactivity

Persistent chat state for inventories, stats, scores, and any structured data. Project-level state shared across chats with per-chat overrides. Cryptographically secure dice rolls (d4 to d1000), coin flips, and random participant selection with auto-detection — "I roll 2d6" actually rolls.

### Image Generation

AI-generated background images for chats based on scene context, with character appearance resolution using clothing and physical descriptions. The Scene State Tracker automatically maintains a structured summary of the current scene after every turn, so image generation always reflects what's actually happening.

---

## Privacy & Data Ownership

### Where your data lives

All Quilltap data — database, files, logs — resides in a single directory. The application tells you exactly where at the bottom of every page.

| Platform | Default Location | Override |
| -------- | ---------------- | -------- |
| **macOS** | `~/Library/Application Support/Quilltap` | `QUILLTAP_DATA_DIR` |
| **Windows** | `%APPDATA%\Quilltap` | `QUILLTAP_DATA_DIR` |
| **Linux** | `~/.quilltap` | `QUILLTAP_DATA_DIR` |
| **Docker** | Mount a host directory to `/app/quilltap` | Volume mount (`-v`) |

### What's stored

- **Database:** SQLite encrypted at rest with SQLCipher — every database file is encrypted on disk; integrity checks on startup, periodic WAL checkpoints, physical backups with tiered retention (daily for 7 days, weekly for 4 weeks, monthly for 12 months, yearly forever); standard `sqlite3` CLI cannot open encrypted files, use `npx quilltap db` instead
- **Files:** Local filesystem using original filenames, organized by project. Real-time filesystem watcher keeps the database in sync.
- **API keys:** Stored in the encrypted database

Your API keys, your conversations, your characters, your memories — all encrypted, all local, all yours. Nothing phones home. Nothing is harvested. Nothing requires an account with us.

### Backup options

- **Manual copy** — Shut down Quilltap, copy or zip the entire data directory. Everything lives in one place; a filesystem copy is a perfect backup.
- **Full system backup** — Single ZIP file containing everything: characters, chats, files, memories, settings, and installed plugins
- **Native export** — Selective `.qtap` format with conflict resolution for sharing specific content
- **SillyTavern format** — Import/export for compatibility

See [Backup & Restore](docs/BACKUP-RESTORE.md) and [Database Protection](help/database-protection.md) for details.

---

## Themes & Appearance

Switch themes live without reloading. Five bundled themes ship with the application:

| Theme | Style |
| ----- | ----- |
| **Old School** | Classic slate-blue palette with professional typography |
| **Art Deco** | Geometric elegance with navy-and-gold opulence |
| **The Great Estate** | Warm, manor-inspired design with mahogany and gold |
| **Earl Grey** | High-contrast dark theme with modern minimal styling |
| **Rains** | Warm, earthy palette with cozy amber accents |

Themes are distributed as `.qtap-theme` bundles — declarative archives containing JSON design tokens, CSS, fonts, and images. No build tools, no npm packages, no TypeScript — just edit and install. Create your own with `npx create-quilltap-theme my-theme`, manage from the CLI with `npx quilltap themes`, or browse and install from theme registries in Settings with Ed25519 signature verification.

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
| **System Prompt** | Custom system prompt templates for characters |

### Architecture at a glance

Quilltap is a single Next.js 16 application (App Router) that serves both the UI and API routes. The tech stack:

- **Frontend:** React 19, TypeScript, Tailwind CSS 4 with a semantic `qt-*` class system for full theme overrideability
- **Backend:** Next.js API routes, SQLite with SQLCipher encryption (better-sqlite3-multiple-ciphers) with WAL mode, Zod schema validation
- **Build:** GitHub Actions CI/CD with automated releases — Docker multi-arch images and npm package built from a single tag push

The entire provider system is plugin-based — every bundled provider (Anthropic, OpenAI, Google, xAI, Ollama, OpenRouter, OpenAI-Compatible) is a plugin with the same API surface available to third-party authors.

### Getting started with development

```bash
git clone https://github.com/foundry-9/quilltap-server.git
cd quilltap-server
npm install
npm run dev
```

See the plugin development guides for each extension point:

- [Provider Development](docs/developer/PROVIDER_PLUGIN_DEVELOPMENT.md)
- [Theme Development](docs/developer/THEME_PLUGIN_DEVELOPMENT.md) (legacy plugin format; new themes use `.qtap-theme` bundles)
- [Template Development](docs/developer/TEMPLATE_PLUGIN_DEVELOPMENT.md)
- [Tool Development](docs/developer/TOOL_PLUGIN_DEVELOPMENT.md)
- [Search Provider Development](docs/developer/SEARCH_PLUGIN_DEVELOPMENT.md)

### Contributing

Contributions are welcome. We ask that you open an issue to discuss major changes before submitting a PR — it is far better to align on direction before building the bridge, as anyone who has ever built a bridge in the wrong direction can attest.

See the [Development Guide](docs/developer/DEVELOPMENT.md) for local setup, testing, and build instructions.

---

## Troubleshooting

**Docker container issues:** Check `docker logs quilltap`. Verify port 3000 isn't already in use. For local services (Ollama, etc.), use the startup scripts — they handle port forwarding automatically.

**Desktop app issues:** See the [quilltap-shell](https://github.com/foundry-9/quilltap-shell) repository for desktop-specific troubleshooting.

**General:** The footer shows your data directory path and backend mode — useful for debugging. If none of the above resolves your predicament: [GitHub Issues](https://github.com/foundry-9/quilltap-server/issues).

---

## Documentation

- [Development Guide](docs/developer/DEVELOPMENT.md) — Contributing, local dev, building from source
- [Deployment Guide](docs/DEPLOYMENT.md) — Production setup with SSL and reverse proxies
- [API Reference](docs/developer/API.md) — REST endpoints
- [Image Generation](docs/developer/IMAGE_GENERATION.md) — Provider configuration
- [File LLM Access](docs/developer/FILE_LLM_ACCESS.md) — How AI reads your files
- [Database Architecture](docs/developer/DATABASE_ABSTRACTION.md) — SQLite backend and protection
- [Prompt Architecture](docs/developer/PROMPT_ARCHITECTURE.md) — How system prompts are assembled
- [Changelog](docs/CHANGELOG.md) — Release history
- [Roadmap](docs/developer/features/ROADMAP.md) — What's coming

---

## Tech Stack

Next.js 16 (App Router) · React 19 · TypeScript · SQLite with SQLCipher (better-sqlite3-multiple-ciphers) · Tailwind CSS 4 · Docker · Zod · GitHub Actions

---

## License

MIT License — see [LICENSE](LICENSE)

Copyright © 2025, 2026 Foundry-9 LLC

---

## Support

- **Issues:** [GitHub Issues](https://github.com/foundry-9/quilltap-server/issues)
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

**Infrastructure:** Docker

**Testing:** Jest, Playwright, Testing Library

**Build & Tooling:** tsx, cross-env

Special thanks to [SillyTavern](https://github.com/SillyTavern/SillyTavern) for pioneering this space and inspiring character format compatibility. One does not forget those who blazed the trail.

</details>
