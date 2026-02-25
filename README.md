# Quilltap

**Your AI, your projects, your stories, your partners, your rules.**

Quilltap is a self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who finds it deeply unsatisfying that their AI assistant forgets everything the moment they close a tab. Connect to any LLM provider, organize your work into projects with persistent files and context, create characters with genuine personalities, and build a private AI environment that learns, remembers, and — crucially — belongs entirely to you.

No subscriptions. No data harvested. No forgetting everything between sessions. No landlords.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-3.1.0--dev.8-yellow.svg)](package.json)

<p align="center">
  <img src="https://quilltap.ai/images/welcome-to-quilltap-2-8.png" alt="Welcome to Quilltap" />
</p>

---

## What Quilltap Does

**For fiction writers and worldbuilders:** Organize your notes, characters, and lore into projects. The AI can read your files, search semantically across your worldbuilding, and actually understand the context of what you're creating — not merely the last few messages before its memory gives out like a goldfish at a dinner party.

**For roleplayers and gamers:** Create detailed AI characters with personalities, backstories, and voices that remain consistent across sessions. Run multi-character scenes. Roll dice and flip coins with built-in RNG. Track inventories, stats, and game state that persists as reliably as a grudge. Import your SillyTavern characters and chats.

**For everyone else:** Use it as a private AI desktop. Connect to Claude, GPT, Gemini, Grok, or local models through Ollama. Your conversations stay on your machine. The AI builds long-term memory across sessions. You control everything.

**On the horizon:** Agentic LLM tools running in a sandboxed environment — your AI assistant reading, writing, and revising documents alongside you, safely contained in its own workspace. Think of it as hiring a very well-read clerk who lives in a comfortable office inside your machine, follows instructions with enthusiasm, and never, ever loses your manuscripts.

*"Business in the front, party in the back... literary salon on the veranda."*

---

## Why Not Just Use Claude or ChatGPT?

A reasonable question, and one we encourage you to ask before installing anything. Here is the situation, presented without embellishment — well, with very little embellishment:

| What you get with hosted AI | What you get with Quilltap |
| --------------------------- | -------------------------- |
| Conversations disappear or get compressed | Persistent memory across all your chats |
| The AI forgets your project between sessions | Projects with files, folders, and custom instructions |
| One provider, their pricing, their rules | Connect to any provider — or run models locally |
| Your data on someone else's servers | Everything stays on your infrastructure |
| Generic assistant personality | Characters with real voices and personalities |
| No game mechanics or state tracking | Built-in dice rolls, inventories, and persistent game state |

---

## Why Not SillyTavern?

SillyTavern is excellent — a pioneering achievement in maximally customized character chat. Quilltap started from a similar place but grew in a rather different direction, like a vine that was planted next to the trellis and decided it preferred the oak tree:

- **Project-based organization** — files, folders, semantic search, not just chat logs
- **LLM file access** — the AI can read and write your project files with permission
- **Long-term memory** — semantic recall across conversations, not just within them
- **Game mechanics** — persistent state for inventories, stats, and game tracking
- **Built-in RNG** — dice rolls and coin flips that execute automatically when mentioned
- **Easier configuration** — more safeguards to keep things working

If you're coming from SillyTavern, Quilltap imports your characters and chats directly.

---

## Getting Started

There are, as with most things worth doing, several paths to the same destination. We have arranged them in order of increasing difficulty, rather like a cocktail menu that begins with champagne and ends with absinthe.

### The Civilized Way: Native Desktop App (Recommended)

The simplest and most delightful way to run Quilltap is to install the desktop application. It bundles everything you need — the backend runs inside a lightweight Linux virtual machine, so you needn't trouble yourself with servers, containers, or terminal commands.

**Step 1:** Visit the [GitHub Releases page](https://github.com/foundry-9/quilltap/releases) and download the **Latest** stable release for your platform.

- **macOS:** Download the `.dmg` installer. Quilltap uses [Lima](https://lima-vm.io/) with Apple's Virtualization.framework to run its backend. Requires Xcode Command Line Tools — the app will offer to install them if they're missing.
- **Windows:** Download the `.exe` installer. Quilltap uses WSL2, which is built into Windows 10 and 11. If WSL2 isn't already enabled, run `wsl --install` in PowerShell as Administrator and restart your computer. The app checks for this on startup and will tell you plainly if something is amiss.

**Step 2:** Launch the app. On first run, Quilltap will:
1. Present a splash screen where you can choose your data directory
2. Download a small Linux guest image (~150 MB, cached for future launches)
3. Boot the VM and start the backend
4. Open your workspace in a native window

That's it. No configuration files, no environment variables, no incantations. Your data lives on your machine in a sensible default location, and the app tells you exactly where.

| Platform | Default Data Directory |
| --- | --- |
| macOS | `~/Library/Application Support/Quilltap` |
| Windows | `%APPDATA%\Quilltap` |

### The Dockworker's Route: Docker Desktop

If you prefer containers — or you're running a Linux server, or you simply enjoy the gentle hum of virtualization — Docker is a fine choice.

**With the Electron app:** The desktop app includes a Docker runtime toggle right on the splash screen. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), launch Quilltap, and switch the runtime from "VM" to "Docker." The app will pull the image and manage the container for you, same native window, different engine underneath.

**Standalone with Docker:** If you'd rather skip the Electron wrapper entirely and access Quilltap through your browser:

The [csebold/quilltap](https://hub.docker.com/repository/docker/csebold/quilltap/general) image is available on Docker Hub. Use the included startup scripts for the smoothest experience:

```bash
# Linux / macOS
./scripts/start-quilltap.sh

# Windows (PowerShell)
.\scripts\start-quilltap.ps1
```

The scripts auto-detect your platform, set the correct data directory, and check for local services like Ollama — forwarding their ports into the container automatically.

Or run directly:

```bash
docker run -d \
  --name quilltap \
  -p 3000:3000 \
  -e QUILLTAP_TIMEZONE=America/New_York \
  -v /path/to/your/data:/app/quilltap \
  csebold/quilltap
```

> **Timezone tip:** Set `QUILLTAP_TIMEZONE` to your IANA timezone (e.g., `America/New_York`, `Europe/London`, `Asia/Tokyo`) so timestamp injection in chats shows your local time instead of UTC. The Electron desktop app detects this automatically.

Open [http://localhost:3000](http://localhost:3000) and you're in business. The setup wizard will guide you through first-time configuration.

### The Adventurer's Path: From Source

For developers, tinkerers, and those who read `man` pages recreationally. You will need **Node.js 22+** and **git**.

```bash
git clone https://github.com/foundry-9/quilltap.git
cd quilltap
npm install
npm run dev        # Development mode with hot reload
# or
npm run build && npm run start   # Production build
```

Open [http://localhost:3000](http://localhost:3000). We recommend checking out the latest release tag rather than `main` unless you enjoy living on the frontier:

```bash
git checkout $(git describe --tags --abbrev=0)
```

There is also a lightweight `npx` option for running the published package without cloning the repository:

```bash
npx quilltap                              # Just run it
npx quilltap --port 8080                  # Custom port
npx quilltap --data-dir /path/to/data     # Custom data directory
```

For details on building Electron installers, rootfs tarballs, and Docker images from source, see the [Development Guide](DEVELOPMENT.md).

---

## Core Features

Quilltap's features are organized into named subsystems, each with its own character and purpose — rather like the wings of a well-appointed estate. Themes can customize these names and appearances, so one person's "Prospero" is another's "The Workshop," depending on which theme strikes their fancy.

### Prospero — Projects & Files

Organize your work the way your brain actually works, rather than the way software usually insists it should:

- **Project instructions** — Custom system prompts that apply to every chat in a project
- **File management** — Upload documents, organize into folders, let the AI read them
- **LLM file access** — AI can list, read, and write files with your permission
- **Agent Mode** — Iterative tool use with self-correction, configurable max turns
- **Semantic search** — Find things by meaning, not just keywords
- **Markdown rendering** — Full GitHub-flavored Markdown with wikilink support
- **Code highlighting** — Syntax highlighting for code files
- **PDF viewer** — Built-in PDF.js for document preview

### Aurora — Characters & Roleplay

Create AI personalities that feel less like chatbots and more like collaborators who have actually read your notes:

- **AI characters** — Detailed profiles with personality, backstory, and system prompts
- **User characters** — Represent yourself however you want
- **Character pronouns** — He/him, she/her, they/them, or custom pronouns
- **Character aliases** — Alternate names for characters
- **Clothing records** — Track outfits with usage contexts
- **Multi-character chats** — Multiple AI characters in one conversation with turn management
- **Turn-order sidebar** — Participant sidebar with status badges and per-card settings
- **Identity reinforcement** — Characters maintain consistent identity through system prompt reinforcement
- **Impersonation** — Take control of any character mid-scene
- **Swipes** — Generate alternative responses when one doesn't land
- **AI Wizard** — Generate character details automatically, with streaming progress and document upload support
- **SillyTavern import** — Bring your existing characters and chats

### The Commonplace Book — Memory & Context

The part where the AI actually remembers things, which is — one would think — a rather fundamental requirement for a conversational partner:

- **Long-term memory** — Important details persist across conversations
- **Semantic recall** — Find memories by meaning, not exact keywords
- **Memory Gate** — Reinforcement and linking system: REINFORCE near-duplicates, LINK related memories, INSERT new ones
- **Proactive recall** — Characters analyze recent conversation for relevant memories
- **Memory deduplication** — Built-in tool to find and merge duplicate memories
- **Context compression** — Automatic summarization for long conversations
- **Full context reload** — AI can request complete context when needed

Quilltap uses a three-model architecture for optimal cost and performance:

1. **Chat model** — Your primary AI for conversations (Claude, GPT-4, Gemini, etc.)
2. **Cheap model** — Handles background tasks like memory extraction, titling, and image descriptions
3. **Embedding model** — Powers semantic search for memories and files

### The Salon — Chat & Conversation

The drawing room where all the other subsystems gather for conversation:

- **Tool palette** — Chat composer gutter tools for quick access to formatting, attachments, and actions
- **Embedded tool messages** — Tool results displayed inline within message bubbles
- **Server-side markdown** — Pre-rendered markdown for faster message display
- **Queue status badges** — Live background job status in the toolbar
- **Unified chat cards** — Consistent chat card component with story background thumbnails

### Pascal the Croupier — Gaming & Interactivity

Every good establishment needs a house dealer. Built-in mechanics for tabletop gaming, RPGs, and interactive fiction:

- **Chat State** — Persistent JSON storage for inventories, stats, scores, and any structured data
- **State inheritance** — Project-level state shared across chats, with per-chat overrides
- **Protected keys** — Underscore-prefixed keys (`_notes`) can't be modified by AI
- **Random Number Generator** — Dice rolls (d4 to d1000), coin flips, and random participant selection
- **Auto-detection** — Dice notation in messages executes automatically ("I roll 2d6" actually rolls)
- **Cryptographically secure** — Fair, unpredictable random results

### Dangermouse — Content Filtering

For those occasions when discretion is the better part of valor — intelligent content classification and routing:

- **Gatekeeper service** — Classifies messages for sensitive content
- **Three modes** — Off, Detect Only, or Auto-Route to uncensored providers
- **Chat-level classification** — Danger flags on chats with quick-hide integration
- **Visual indicators** — DangerFlagBadge and DangerContentWrapper for clear content marking
- **Startup scan** — Scheduled danger classification scan with context summary chaining

### The Lantern — Story Backgrounds

Because atmosphere is everything, and a well-lit scene deserves a proper backdrop:

- **Story backgrounds** — AI-generated background images for chats based on scene context
- **Context-aware appearance** — Character appearance resolution using clothing and physical descriptions
- **Project backgrounds** — Story backgrounds on project detail pages
- **Chat card thumbnails** — Chat cards display story background thumbnails
- **Uncensored fallback** — Automatic routing for chats with dangerous content

### LLM Tools

Your AI can do rather more than simply talk — it has hands, after a fashion:

- **Web search** — Current information via Serper API
- **Memory search** — Query past conversations
- **Image generation** — Create images mid-conversation (OpenAI, Google Imagen, Grok)
- **File management** — Read/write project files
- **Agent Mode** — Iterative tool use with self-correction for complex multi-step tasks
- **Help search** — AI can search Quilltap's documentation to help you use features
- **MCP connector** — Connect to Model Context Protocol servers for external tool integration
- **Custom tools** — Extend with plugins

---

## Supported Providers

Quilltap does not insist you patronize any particular establishment. Connect to the AI services you prefer:

| Provider | Models | Notes |
| ---------- | -------- | ------- |
| **Anthropic** | Claude 4/4.5 (Opus, Sonnet, Haiku) | Image understanding, tool use |
| **OpenAI** | GPT-5/5.1, GPT-4o series | Tool calling, GPT-Image/DALL-E |
| **Google** | Gemini 3/2.5 Flash/Pro | Multimodal, Imagen 4 (Nano Banana), tool use |
| **xAI** | Grok 4/4.1, Grok 3 | Native image generation |
| **Ollama** | Llama, Phi, Mistral, etc. | Fully local, offline capable |
| **OpenRouter** | 200+ models | Unified API, automatic pricing |
| **OpenAI-Compatible** | LM Studio, vLLM, etc. | Any compatible endpoint |

For best results we recommend Ollama or OpenAI for embedding, a "nano" or "lite" model for the cheap LLM, and Claude, ChatGPT, Gemini, GLM, or DeepSeek for the primary model. OpenRouter can get you access to all of these for good rates — pay one provider and get a lot — but you'll probably want to use Ollama as a local embedder if you do that.

---

## Calliope — Themes & Appearance

One's workspace ought to reflect one's sensibilities. Quilltap includes six bundled themes and supports custom theme plugins. Switch themes live without reloading — instant redecoration, no painters required.

| Theme | Style |
| ----- | ----- |
| **Professional Neutral** | Clean default look |
| **Old School** | Classic serif typography |
| **Art Deco** | Geometric elegance |
| **The Great Estate** | Rich, estate-inspired design |
| **Earl Grey** | Warm, tea-inspired palette |
| **Rains** | Cool, atmospheric tones |

Themes can override subsystem names and Foundry card images, letting each theme define its own personality for the application.

## The Foundry — Settings & Architecture

The engine room. The unified hub for managing all of Quilltap's subsystems:

- **Foundry Hub** — Navigate to all eight subsystems from `/foundry` with themed navigation cards
- **Collapsed sidebar** — Direct navigation to any subsystem
- **Plugin system** — Extend with themes, providers, templates, tools, and storage via npm packages

### Plugins

Quilltap was built to be extended. Add capabilities via npm packages:

- **LLM Providers** — Add new AI services, including chat and image generation
- **Themes** — Custom visual styles
- **Templates** — Roleplay formatting templates
- **Tools** — Custom LLM capabilities
- **Storage** — Alternative file backends
- **Search** — Custom search providers

See the plugin development guides:

- [Theme Development](docs/THEME_PLUGIN_DEVELOPMENT.md)
- [Template Development](docs/TEMPLATE_PLUGIN_DEVELOPMENT.md)
- [Tool Development](docs/TOOL_PLUGIN_DEVELOPMENT.md)
- [Provider Development](docs/PROVIDER_PLUGIN_DEVELOPMENT.md)
- [Search Provider Development](docs/SEARCH_PLUGIN_DEVELOPMENT.md)

---

## Data & Backup

### Where your data lives

All Quilltap data — database, files, logs — resides in a single directory, like a well-organized study. The application tells you exactly where at the bottom of every page, because we believe you have a right to know where your own things are kept.

| Environment | Default Location | Override |
| ----------- | ---------------- | -------- |
| **Electron (macOS)** | `~/Library/Application Support/Quilltap` (shared with VM via VirtioFS) | Splash screen directory chooser or `QUILLTAP_DATA_DIR` |
| **Electron (Windows)** | `%APPDATA%\Quilltap` (accessed from WSL2 via auto-mount) | Splash screen directory chooser or `QUILLTAP_DATA_DIR` |
| **Linux** | `~/.quilltap` | `QUILLTAP_DATA_DIR` |
| **Docker** | Mount a host directory to `/app/quilltap` | Volume mount (`-v`) |

The Electron app lets you manage multiple data directories from its splash screen — pick one, add new ones, or switch between them. Each directory gets its own VM, so switching is a quick stop-and-start rather than a teardown.

### What's stored where

- **Database:** SQLite file with automatic protection (integrity checks, WAL checkpoints, physical backups with tiered retention)
- **Files:** Local filesystem
- **API keys:** AES-256-GCM encrypted

### Backup options

- **Full system backup** — Single ZIP file containing everything: characters, chats, files, memories, profiles, plugin configs, and installed npm plugins
- **Native export** — Selective `.qtap` format with conflict resolution for sharing specific content
- **SillyTavern format** — Import/export for compatibility
- **Database protection** — Automatic physical backups with tiered retention: daily for 7 days, weekly for 4 weeks, monthly for 12 months, yearly forever

See [Backup & Restore](docs/BACKUP-RESTORE.md) and [Database Protection](help/database-protection.md) for details.

---

## Documentation

- [Development Guide](DEVELOPMENT.md) — Contributing, local dev, building from source
- [Deployment Guide](docs/DEPLOYMENT.md) — Production setup with SSL and reverse proxies
- [API Reference](docs/API.md) — REST endpoints
- [Image Generation](docs/IMAGE_GENERATION.md) — Provider configuration
- [File LLM Access](docs/FILE_LLM_ACCESS.md) — How AI reads your files
- [Database Architecture](docs/DATABASE_ABSTRACTION.md) — SQLite backend and protection
- [Windows Troubleshooting](docs/WINDOWS.md) — WSL2 setup and common issues
- [Changelog](docs/CHANGELOG.md) — Release history
- [Roadmap](features/ROADMAP.md) — What's coming

---

## Troubleshooting

Should things go sideways — and in software, as in life, they occasionally do — here are the most common remedies.

**Electron app won't start (macOS):**

- Ensure Xcode Command Line Tools are installed — the app will prompt you if they're missing
- Check Console.app for Lima-related errors
- Try deleting the VM: the app will recreate it on next launch

**Electron app won't start (Windows):**

- Ensure WSL2 is installed: run `wsl --install` in PowerShell as Administrator
- Check if the distro exists: `wsl --list --verbose`
- See the [Windows Troubleshooting Guide](docs/WINDOWS.md)

**Docker container issues:**

- Check `docker ps` and `docker logs quilltap`
- Verify port 3000 isn't already in use
- For localhost services (Ollama, etc.), use the startup scripts — they handle port forwarding automatically

**General:**

- If using a custom domain, confirm `BASE_URL` matches your actual URL
- The footer shows your data directory path and backend mode (VM/Docker/local) — useful for debugging

If none of the above resolves your predicament: [GitHub Issues](https://github.com/foundry-9/quilltap/issues)

---

## Tech Stack

The machinery behind the curtain:

Next.js 16 (App Router) · React 19 · TypeScript 5.6 · SQLite (better-sqlite3) · Tailwind CSS 4.1 · Electron · Lima/VZ (macOS) · WSL2 (Windows) · Docker

3,400+ tests with Jest and Playwright, because trust is earned.

---

## Contributing

Contributions are most welcome. We ask only that you open an issue to discuss major changes before submitting a PR — it is far better to align on direction before building the bridge, as anyone who has ever built a bridge in the wrong direction can attest.

---

## License

MIT License — see [LICENSE](LICENSE)

Copyright © 2025, 2026 Foundry-9 LLC

---

## Support

- **Issues:** [GitHub Issues](https://github.com/foundry-9/quilltap/issues)
- **Author:** Charles Sebold
- **Email:** <charles.sebold@foundry-9.com>
- **Website:** [quilltap.ai](https://quilltap.ai) | [foundry-9.com](https://foundry-9.com)

---

<details>
<summary><b>Acknowledgments</b></summary>

Quilltap stands on the shoulders of these excellent open source projects, and is grateful for the view:

**Core:** React, Next.js, TypeScript, better-sqlite3, Zod

**AI & LLM:** OpenAI SDK, Anthropic SDK, Google Generative AI SDK, xAI/Grok SDK, Model Context Protocol SDK

**UI:** Tailwind CSS, React Markdown, React Syntax Highlighter, PDF.js, sharp, Lucide Icons

**Desktop & Infrastructure:** Electron, Lima, Docker

**Testing:** Jest, Playwright, Storybook, Testing Library

**Build & Tooling:** tsx, electron-builder, cross-env

Special thanks to [SillyTavern](https://github.com/SillyTavern/SillyTavern) for pioneering this space and inspiring character format compatibility. One does not forget those who blazed the trail.

</details>
