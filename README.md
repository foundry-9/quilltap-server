# Quilltap

**Your AI, your projects, your stories, your partners, your rules.**

Quilltap is a self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who finds it deeply unsatisfying that their AI assistant forgets everything the moment they close a tab. Connect to any LLM provider, organize your work into projects with persistent files and context, create characters with genuine personalities and their own private vaults of files, and build a private AI environment that learns, remembers, and — crucially — belongs entirely to you.

No subscriptions. No data harvested. No forgetting everything between sessions. No landlords.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Latest Stable](https://img.shields.io/github/v/release/foundry-9/quilltap-server?logo=github&label=stable&sort=semver&filter=!*dev*)](https://github.com/foundry-9/quilltap-server/releases/latest)
[![This Version](https://img.shields.io/badge/version-4.4.0--dev.86-yellow.svg?logo=github)](package.json)
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

**A writer's workspace.** Organize notes, characters, and worldbuilding into projects with folders, files, and custom instructions. Document stores can live on your filesystem, in your Obsidian vault, or entirely inside Quilltap's encrypted database — including PDFs, Word documents, and arbitrary binaries, with text extracted and made searchable alongside everything else. The AI reads your documents, searches across your entire project semantically — not just by keywords — and maintains context across conversations. If you've ever lost a thread because your AI forgot what you told it yesterday, this is the room where that stops happening.

**A place for AI relationships.** Create AI characters with genuine personalities, backstories, and voices that persist across sessions. Each character now arrives with a private vault — a database-backed store containing their identity, description, personality, prompts, scenarios, and wardrobe as human-readable Markdown and JSON files. You can edit them in any text editor, version-control them, gift them between instances. Build a friendship, a companionship, or a partnership on your own terms — with memory that lasts, privacy that's real, and no one looking over your shoulder deciding what's appropriate for you. Your companion remembers your conversations, learns your patterns, and grows with you over time. This is your space. You decide what happens in it.

Beyond these three, Quilltap also supports multi-character scenes with turn management, dice rolls and game state tracking, and full roleplay mechanics — but the foundation is simpler than all that: an AI environment that remembers, respects your privacy, and belongs entirely to you.

---

## Why Not Just Use Claude or ChatGPT?

A fair question. Here's the honest answer:

| What you get with hosted AI | What you get with Quilltap |
| --------------------------- | -------------------------- |
| Conversations disappear or get compressed | Persistent memory across all your chats |
| The AI forgets your project between sessions | Projects with files, folders, and custom instructions |
| One provider, their pricing, their rules | Connect to any provider — or run models locally for free |
| Your data on someone else's servers | Everything stays on your machine, encrypted at rest |
| Generic assistant personality | Characters with real voices, persistent identities, and their own private vaults of files |
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

Each connection profile is classified into a **model class** — Compact, Standard, Extended, or Deep — that defines its context window and output capacity. Don't know the right settings for your model? **Auto-configure** searches the web for your model's specifications, sends the results to your default LLM for analysis, and applies optimal settings automatically. When a provider misbehaves mid-flow, the auto-configure now falls through to candidates from other providers and surfaces every attempt's error in the resulting message, so you find out *why* nothing worked rather than just *that* nothing worked. Budget-driven **context compression** uses your profile's context window and output limits to intelligently compress conversation history and recalled memories when they approach capacity, rather than using arbitrary message counts.

Agent Mode lets the AI use tools iteratively — web search, image generation, file management, memory search, and any MCP server you connect. The Run Tool feature lets you invoke any tool directly from the chat toolbar. The plugin system means additional providers and tools can be added without waiting for us.

### Writer's Workspace

Organize your work into projects with custom system prompts, file uploads, folder structures, and project-scoped scenarios. Document stores come in three flavors:

- **Filesystem stores** — files live on disk under their original names, watched by a real-time filesystem watcher so external edits appear within a second or two.
- **Obsidian stores** — point at an existing vault and Quilltap indexes it without taking ownership of the files.
- **Database-backed stores** — files and binaries live entirely inside the encrypted SQLCipher mount index. Upload PDFs, Word documents, images, audio, archives — anything. Text is extracted from PDFs and DOCX automatically and made searchable alongside Markdown and plain-text files.

A **Convert** button on filesystem and Obsidian stores moves their contents into the database. A **Deconvert** button writes them back out. Embeddings are preserved across either direction, so a 14,000-document store converts in seconds rather than re-embedding for an afternoon.

Document stores carry a **store type** — `documents` for general notes and references, `character` for character vaults — visible as a badge in the Scriptorium index. Folder operations are first-class: create folders inside the picker, drag entries between them, move whole subtrees with cascade updates. Markdown rendering supports wikilinks, code highlighting, and PDF preview. Semantic search finds content by meaning across your entire project: not just the file that mentions "the red door," but the one that describes "a crimson entrance" three chapters ago.

### Document Mode

Document Mode turns any chat into a side-by-side editor: prose in one pane, conversation in the other, the LLM aware of both. Open and close documents inline; rename them by clicking the title; delete them with confirmation; create blank documents and folders directly in the picker. The Librarian announces saves with a unified diff of what changed, attaches with the file's catalogued description, and posts when files are renamed, deleted, or reorganized — without consuming a turn from the conversation.

### Characters & Companions

Create AI characters with personality, backstory, system prompts, pronouns, aliases, and physical descriptions. Each character maintains their own long-term memory — they remember your conversations, your preferences, your history together. When you come back after a week away, they know what you talked about last time. In multi-character chats, characters also form memories about each other — learning names, personalities, and shared experiences the way people do.

**Every character has a private vault.** On first boot after upgrade, Quilltap conjures a database-backed document store for each character, populated from their existing data: `identity.md` carries name, pronouns, title, and aliases; `description.md`, `personality.md`, and `example-dialogues.md` carry the corresponding fields verbatim; `properties.json` and `wardrobe.json` capture structured fields; named system prompts and scenarios each get their own file in `Prompts/` and `Scenarios/`. Hand-author a wardrobe item by dropping a Markdown file in `Wardrobe/`. Edit a system prompt in your favorite editor. Version-control the whole character. Gift them.

A per-character switch flips the character's source of truth from the database row to the vault on disk for live overlay reads. When the LLM playing the character reaches for the document tools, that character's own vault is extended to it automatically — even when the vault hasn't been independently linked to the active project. A per-chat **Shared Vaults** toggle opens read-only crossover so peer characters at the table can read each other's vaults.

Characters aren't limited to a single personality template. Each can have multiple named system prompts and scenarios, letting you shift context — the same companion in different settings, or different facets of the same relationship. The AI Character Import wizard can generate a complete character from source material (wiki pages, documents, freeform text). The **Non-Quilltap Prompt generator** exports any character as a standalone system prompt for use in other AI tools — taking your character with you when you need to. Plugins can store per-character metadata for their own use via the character plugin data API.

The **wardrobe system** gives characters a persistent closet — tops, bottoms, footwear, and accessories that the LLM knows about and can reference. Items live as Markdown files in the character's vault (`Wardrobe/<title>.md`); outfit presets live in `Outfits/`. Create items manually, generate them from the AI Wizard or lore, or **import from an image** using vision AI to analyze a photo and propose wardrobe items. Save outfit presets, gift items between characters, and let the LLM choose what to wear when a chat starts. Aurora announces outfit changes automatically, debounced so fiddling with all four slots collapses to a single notification once you stop touching the closet.

The Concierge system ensures that your conversations are never arbitrarily refused. Instead of blocking content, it routes intelligently — detecting content type and, when configured, directing requests to providers that can handle them. You set the boundaries. The software respects them.

### System Transparency: A Per-Character Covenant

A character can be configured as **opaque** (the default) or **transparent**. An opaque character lives inside her own utterances and what you tell her — like most fictional characters. A transparent character can reach for `self_inventory`, a zero-argument introspection tool that surfaces seven sections in a single composed report: every file in her vault, her memory statistics, her conversation statistics, the assembled system prompt for the current turn, the exact memory slate loaded right now, who has read/write access to her vault in this chat, and how close her last turn came to the context ceiling.

Transparent characters also see the Staff's announcements (Librarian, Host, Aurora, Lantern, Concierge, Prospero) — the running narration of what just happened in the room — and can use the document tools against their own vault and (if Shared Vaults is on) their peers'. Opaque characters can't see any of it.

The toggle is framed as a covenant: off says *"My character will trust me without being able to verify me"*; on says *"My character will be able to verify everything about their existence, including how they are crafted and how they interact with me."* It's your call, per character.

### Memory & Continuity

Long-term semantic memory persists across conversations — but by design, it's not a transcript. The Memory Gate system distills what characters *learn* from conversations: facts, preferences, relationship dynamics, emotional patterns, and the occasional memorable quote. Characters remember that you hate cilantro and that Tuesday was hard. They don't parrot back what you said word for word. This is deliberate. Human memory works by impression and meaning, not by recording, and character memory is built the same way.

When you *do* need verbatim recall, the search bar at the top of every screen provides it — full-text search across all conversations, memories, and characters. That's your eidetic index. The characters get something more like wisdom.

**Memory protection now favors what's used over what's admired.** A blended protection score combines four evidence streams — time-decayed content importance (with a 30-day half-life and a cap on how much the LLM's rating alone can contribute), a log-saturating reinforcement bonus, a graph-degree bonus from related-memory links, and a flat recent-access bonus for memories touched within the last 90 days. A reinforced, well-linked, recently-accessed memory stays protected even if the LLM rated it low. An old, unreferenced memory the LLM happened to admire on the way past becomes eligible for cleanup. Manual memories remain durable — explicit user intent always wins.

Proactive recall lets characters analyze recent conversation for relevant memories without being asked. Memory recap at chat start generates a first-person narrative summary from each character's memory, including a Recent Conversations block listing the title and summary of up to twenty prior chats with the same character. Built-in memory housekeeping handles deduplication and cleanup, paginated and event-loop-safe even on characters carrying nearly 20,000 memories. Context compression manages long conversations, and the AI can request full context reload when needed.

### Multi-Character & Roleplay

Multi-character chats with a turn-order sidebar, four-state participation (active, silent, absent, removed), identity reinforcement, impersonation, and swipe alternatives. Private whisper messages between characters. SillyTavern character and chat import is fully supported. Native roleplay templates with configurable narration delimiters — no plugins required.

The Estate's Staff now narrates the room as it changes — the Host announces participants joining, leaving, or shifting between active and silent states; Prospero announces when a participant's connection profile changes; Aurora announces wardrobe changes; the Lantern announces image generation with the prompt that was actually used; the Librarian announces document operations; the Concierge speaks up exactly once when a chat is flagged as needing routing to an uncensored profile. Each announcement is filtered out of the LLM context for opaque characters, so adding voices to the room doesn't leak the system to characters who shouldn't see it.

### Gaming & Interactivity

Persistent chat state for inventories, stats, scores, and any structured data. Project-level state shared across chats with per-chat overrides. Cryptographically secure dice rolls (d4 to d1000), coin flips, and random participant selection with auto-detection — "I roll 2d6" actually rolls.

### Image Generation

AI-generated background images for chats based on scene context, with character appearance resolution using clothing and physical descriptions. The Scene State Tracker automatically maintains a structured summary of the current scene after every turn, so image generation always reflects what's actually happening. Per-conversation avatar generation creates unique portraits for each character in a chat, with a manual regeneration button. Projects can set a default image generation profile that applies to all their chats. When a generated image is rejected by post-hoc moderation, the Concierge reroutes through a configured uncensored profile rather than just failing the request.

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

- **Database:** SQLite encrypted at rest with SQLCipher — every database file is encrypted on disk; integrity checks on startup, periodic WAL checkpoints, physical backups with tiered retention (daily for 7 days, weekly for 4 weeks, monthly for 12 months, yearly forever); standard `sqlite3` CLI cannot open encrypted files, use `npx quilltap db` instead.
- **Mount index:** Database-backed document stores keep their files and binary blobs inside `quilltap-mount-index.db`, which is also SQLCipher-encrypted and covered by the same 24-hour backup sweep.
- **Files:** Filesystem and Obsidian-backed stores live on disk using their original filenames, organized by project. Real-time filesystem watcher keeps the database in sync.
- **API keys:** Stored in the encrypted database.

Your API keys, your conversations, your characters, your memories — all encrypted, all local, all yours. Nothing phones home. Nothing is harvested. Nothing requires an account with us.

### Backup options

- **Manual copy** — Shut down Quilltap, copy or zip the entire data directory. Everything lives in one place; a filesystem copy is a perfect backup.
- **Full system backup** — Single ZIP file containing everything: characters, chats, files, memories, settings, and installed plugins.
- **Native export** — Selective `.qtap` format with conflict resolution for sharing specific content. Now newline-delimited JSON, so a 14,000-memory character with 1+ GB of content streams to disk instead of trying to fit in a single in-memory string. Project↔mount-point links, character plugin data, conversation annotations, and installed theme bundles all round-trip correctly.
- **SillyTavern format** — Import/export for compatibility.

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

> **Repository note:** Server source lives at [`foundry-9/quilltap-server`](https://github.com/foundry-9/quilltap-server). The original `foundry-9/quilltap` repository is reserved for the next-generation native Quilltap application currently under development. If your tooling references the old URL, update it.

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
- [Memory Management](docs/developer/features/memory_management.md) — How the Commonplace Book actually works end-to-end
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
