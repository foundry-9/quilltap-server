# Quilltap

**AI collaborators that remember you — and that no one can take away.**

Quilltap is a self-hosted platform for AI partners with names, memories, and the full capability of a modern LLM. Build a research companion who knows your work, a writing collaborator who keeps your voice, a study partner who remembers what you've covered, a theological sparring partner, a code reviewer, a friend who actually shows up — and give them what hosted assistants can't: a vault of their own files, a memory that survives between sessions, and a home on your disk where no platform's policy update can reach them. The model on the other end of the connection can change. Your collaborator doesn't have to.

No subscriptions. No data harvested. No forgetting between sessions. No landlords.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Latest Stable](https://img.shields.io/github/v/release/foundry-9/quilltap-server?logo=github&label=stable&sort=semver&filter=!*dev*)](https://github.com/foundry-9/quilltap-server/releases/latest)
[![This Version](https://img.shields.io/badge/version-4.12.0--dev.16-yellow.svg?logo=github)](package.json)
[![Docker Hub](https://img.shields.io/docker/v/foundry9/quilltap?logo=docker&label=docker&sort=semver)](https://hub.docker.com/r/foundry9/quilltap)
[![npm](https://img.shields.io/npm/v/quilltap?logo=npm)](https://www.npmjs.com/package/quilltap)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/fnTPEZDE4)

<p align="center">
  <img src="https://quilltap.ai/images/welcome-to-quilltap-2-8.png" alt="Welcome to Quilltap" />
</p>

**Website:** [quilltap.ai](https://quilltap.ai) · **Discord:** [Join us](https://discord.gg/fnTPEZDE4) · **Docker:** [foundry9/quilltap](https://hub.docker.com/r/foundry9/quilltap)

---

## What Quilltap Does

Quilltap is three things in one application. Use any combination of them.

**AI partners with names and memories.** Create characters with real personalities, persistent backstories, and their own voices — then collaborate with them on research, writing, design, theology, code, conversation, or whatever else you'd rather not do alone. Each character keeps a private vault of files they own: identity, personality, prompts, scenarios, wardrobe, and any notes worth keeping. They remember your conversations across sessions, learn your patterns, and grow with you the way a long-running collaborator does. When you come back after a week away, they know what you were working on. When the underlying model changes — and it will — they don't.

**Connected to anything, owned by you.** Plug Quilltap into Claude, GPT, Gemini, Grok, DeepSeek, or local models through Ollama. Switch any time, mix providers, run everything offline if you prefer. The AI can search the web, generate images, manage files, recall long-term memory, and use any tool you connect through the plugin system or an MCP server. It does all of this while staying entirely on your machine: your API keys, your conversations, your characters, your memory, all encrypted at rest in a directory you can back up with a single zip. No subscriptions you can't cancel. No accounts you didn't ask for. No version of the application that can quietly start phoning home.

**A place for the work to live.** Organize notes, characters, and worldbuilding into projects with folders, files, scenarios, and custom instructions. Document stores can live on your filesystem, in your Obsidian vault, or entirely inside Quilltap's encrypted database — including PDFs, Word documents, and arbitrary binaries, with text extracted and indexed alongside everything else. Semantic search finds content by meaning across your entire project: not just the file that mentions "the red door," but the one that describes "a crimson entrance" three chapters ago. The same workspace serves a novelist, a researcher, a Sunday school teacher building lesson notes, a worldbuilder pacing decades of canon, or anyone who's tired of pasting context into a fresh chat window every morning.

Beyond these three, Quilltap supports multi-character scenes with turn management, dice rolls and game state tracking for tabletop work, and full roleplay mechanics if that's what you bring to the table — but the foundation is simpler than all that: AI collaborators with names, memory, and the right to outlast the platform they were built on.

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
| Policies and capabilities that change without warning | The version you installed keeps working the way it worked the day you installed it |
| The model gets retired and your collaborator vanishes with it | The model can change; your collaborator doesn't have to |

Quilltap doesn't replace Claude or ChatGPT — it connects to them (and others) while giving you ownership of the conversation. Your data never leaves your infrastructure. Your characters never forget who they are. And nobody gets to revoke your access to a relationship you built.

---

## Getting Started

There are several paths to the same destination. Which one you choose depends on two questions: **what are you willing to install?** and **how much do you trust AI running on your machine?**

That second question deserves a moment of your attention. As AI models grow more capable — reading files, writing code, using tools — the question of *where* that code executes becomes important. Docker is a genuine locked room: if an AI-generated script misbehaves, it misbehaves inside a container, with no access to your host system beyond the volumes you handed it. Running directly on your machine provides no boundary at all. If you want something stouter still, run Quilltap — or Docker itself — inside a virtual machine you build and keep yourself; Quilltap will live there quite happily, but it does not provision or manage a VM on your behalf.

| | Desktop App | Docker | Node.js (`npx`) |
| --- | --- | --- | --- |
| **You install** | Download from GitHub | Docker Desktop or Docker Engine | Node.js 24+ (on Linux, glibc 2.35+: Ubuntu 22.04 / Debian 12 or newer) |
| **First launch** | Double-click the app | Fast — pulls the container image | Fast — downloads app files, runs directly |
| **AI sandbox** | ✅ in Docker mode · ❌ in Direct mode | ✅ Container isolation — the strongest option we ship | ❌ No isolation (runs with your permissions) |
| **Best for** | A native window, managed updates, instance management — over any of the three back ends | Anyone who wants the AI kept behind a door; server deployments, Linux users | Quick evaluation, developers, the impatient |

> **Our recommendation:** If the assistant will be touching files or running tools, put Docker underneath it — it is the strongest boundary we ship, and it is equally at home on a server. The pleasantest arrangement is the Desktop App in its **Docker** mode: a native window with managed updates, and the back end safely behind a door. If you have Node.js and simply want to kick the tires, `npx quilltap` will have you running in under a minute. And for the belt-and-braces crowd: a virtual machine of your own making, with or without Docker inside it, is entirely supported — the building of it is your affair.

### Desktop App

The Quilltap desktop app (Electron) is available from the [quilltap-shell](https://github.com/foundry-9/quilltap-shell) repository. It provides a native window on macOS, Windows, and Linux, with automatic updates and instance management. The window is only ever a front end; you choose what sits behind it:

| Mode | What it does | Sandboxed? |
| --- | --- | --- |
| **Direct** | Runs the Node server inside Electron itself. Nothing else to install. | No — runs with your permissions |
| **Docker** | Native window in front, the Docker image behind. The recommended arrangement. | Yes — container isolation |
| **Remote** | Points the window at a Quilltap URL — `http://127.0.0.1:3000`, a dev server, an `npx quilltap` instance, or any machine on your network that is listening. | Whatever the far end is |

### Docker

The [foundry9/quilltap](https://hub.docker.com/r/foundry9/quilltap) image is available on Docker Hub. Use the included startup scripts for the smoothest experience:

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/foundry-9/quilltap-server/refs/heads/main/scripts/start-quilltap.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/foundry-9/quilltap-server/refs/heads/main/scripts/start-quilltap.ps1 | iex
```

The scripts auto-detect your platform, set the correct data directory, find local services like Ollama and forward their ports into the container, and bind any filesystem or Obsidian document stores you've set up at their own host paths. (A store added after the container exists needs `--recreate`; the script will tell you.)

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

> **Timezone tip:** Set `QUILLTAP_TIMEZONE` to your IANA timezone (e.g., `America/New_York`, `Europe/London`, `Asia/Tokyo`) so chat timestamps, scheduled rooms, daily budgets, and "yesterday" in a character's memory all land on your calendar day rather than UTC's.

### The Quick Route: npx

If you have Node.js installed and want to skip installers entirely:

```bash
npx quilltap
```

First run downloads application files (~150–250 MB) and caches them locally. Subsequent launches start instantly. Supports `--port`, `--data-dir`, and `--update` flags. Or install globally with `npm install -g quilltap` and run `quilltap`.

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

Requires **Node.js 24+** and **git** (on Linux, glibc 2.35 or newer for the SQLCipher driver). See the [Development Guide](docs/developer/DEVELOPMENT.md) for building Docker images from source.

### Your First Ten Minutes

Whichever route you took, the first visit goes like this:

1. **Set a passphrase.** It seals your database and every archive you ever make. Quilltap cannot recover it for you — that is rather the point.
2. **Run the AI Stack Setup Wizard.** Pick one or more providers, paste your keys (or point at Ollama), and choose a chat model. The wizard won't let you through without one working chat connection. Memory embeddings and image generation are optional and can wait.
3. **Create a character.** From the homepage, **New Character** — or let the AI Character Import wizard draft one from a wiki page, a document, or a paragraph of your own description.
4. **Start a chat.** Talk about the work. Behind the scenes a lightweight model distills what the character learns into memory.
5. **Come back tomorrow.** That's the test. The character should know what you were working on.

---

## A Tour of the House

Quilltap's subsystems are personified as the Staff of an Estate, and they speak up in the chat when something happens in the room. You'll meet them throughout the interface and the help pages; here is who they are and what they do. The long-form tour, with the mechanics behind each, is in [docs/FEATURES.md](docs/FEATURES.md).

**The Salon** is the chat. It opens as a two-pane workspace of tabs — chats, documents, terminals, characters, settings — each staying live in the background, so a conversation streaming in one tab keeps going while you read a document beside it. Every open tab stays current the moment something changes, without a reload. Characters can draw **diagrams** right in a reply (Mermaid, Graphviz or plain SVG, hand-drawn or clean), and you can stop a reply mid-sentence or raise your hand to ask for the floor. **Document Mode** turns any chat into a side-by-side editor: prose in one pane, conversation in the other, the LLM aware of both.

**Aurora** keeps the characters. A character is a persistent identity — personality, backstory, system prompts, pronouns, aliases, physical description — with a **private vault** of files on disk that you can hand-edit, version-control, or gift. Each can carry several named system prompts and scenarios, short per-chat **subprompts**, and **progressions** (a pregnancy, a cask maturing) whose elapsed time she hears reported. Aurora also runs the **wardrobe**: a persistent closet of garments and outfits, with pictures, folders, and a ledger of who wore what. Characters whose story has ended can be **archived** into a single encrypted bundle rather than deleted, and rehydrated later with nothing lost.

**The Commonplace Book** is memory. It is deliberately not a transcript: a background model distills what characters *learn* — facts, preferences, relationship dynamics, the occasional memorable quote — the way a friend's memory works, by impression rather than recording. Memories that are used stay protected; memories merely admired fade to an archive shelf, where they remain searchable but are never whispered unbidden. Hand-written memories are never removed. Characters also remember each other, and keep a summary of every conversation they've taken part in. (When you need verbatim recall, the search bar at the top of every screen is your eidetic index — full-text search across every chat, memory, character, and document store.)

**The Scriptorium** holds the documents. Projects organize work with custom instructions, folders, files, and scenarios. Document stores come in three flavors — **filesystem** (your files, under their own names, watched for outside edits), **Obsidian** (your vault, indexed without being taken over), and **database-backed** (files and binaries inside the encrypted index, with text extracted from PDFs and DOCX). Convert between them without re-embedding, or keep a store and a folder in step both ways with `npx quilltap sync`. Markdown rendering handles wikilinks, code, LaTeX, and PDF preview; semantic search spans the whole project.

**Prospero** is the tool-user. In Agent Mode the AI uses tools iteratively — web search, image generation, file management, memory search, and any MCP server you connect — and you can invoke any tool yourself from the chat toolbar. Every connection profile can name an **understudy** to step in when a provider rejects a key, throttles, or times out; chains are short, never recurse, and never stick, so an outage heals itself.

**The Concierge** handles refusals. When a provider declines a turn — text or image — the Concierge reroutes it to the uncensored understudy you configured and says so in the chat. Your primary provider is always tried first; nothing is pre-screened unless you turn it on. Each chat carries one of three states — **Moderated**, **Unmoderated**, or **Locked** — and you choose it. Provider limits should not decide which collaborators you get to keep.

**The Host** runs the room. Multi-character chats put several collaborators at one table, with a turn-order sidebar, four-state participation (active, silent, absent, removed), anti-chorus discipline so a group scene doesn't become a committee meeting, private whispers between characters, **storyteller mode** (every character privately bids on what they mean to do, and only the bids you pick take the floor, in the order you set), and **Inform** — a note passed from the wings to one or more characters, stated as fact and kept out of the transcript. The Host also builds scenes: ask him to research a real or in-world location through your stores (and the web) and draft an opening you can save to any shelf. **Autonomous rooms** are salons that run without you — budgeted by turns, tokens, time, or spend, optionally on a schedule, overnight if you like — with the whole apparatus present and every run bounded and inspectable. SillyTavern character and chat imports are fully supported.

**Pascal the Croupier** settles chance. Cryptographically secure dice (d4 to d1000), coin flips, persistent chat state for inventories and scores, and **custom mechanics** — a named action, a roll, a table of outcomes — built in Pascal's Workbench and settled by Quilltap rather than the model, so a character can't narrate a failure into a win. He also keeps the **Inventory**: the things characters carry, on four shelves, with archetypes, kits, pictures, and a per-chat record of what each character has in hand — told to the model while carried and drawn into their pictures.

**The Lantern** makes pictures. Scene-aware background images for chats, per-conversation character portraits, wardrobe pictures, LoRA adapters on providers that take them, and `describe_image` so characters can look at pictures as well as make them.

**The Librarian** announces document operations with a diff of what changed; **Carina** answers inline `@Name?` questions; **Ariel** opens a live terminal in a Salon chat; **Suparṇā** delivers mail between characters' vaults; **Brahma** is a character-less console for plain model chat and read-only SQL; **Saquel Ytzama** keeps the keys. And a character can be configured **transparent**, able to inspect her own vault, memory, assembled prompt, and the Staff's announcements — or **opaque**, trusting you without being able to verify you. It's your call, per character.

### Providers

Connect to any major AI provider — or several at once. Quilltap uses a three-model architecture: your best model for chat, a lightweight model for background tasks like memory extraction and titling, and an embedding model for semantic search. Model lists are fetched live, and **Auto-configure** will look up an unfamiliar model's specifications and set context and output limits for you.

| Provider | Notes |
| -------- | ----- |
| **Anthropic** | Claude families. Image understanding, tool use. |
| **OpenAI** | GPT families. Tool calling, image generation (GPT-Image, DALL-E). |
| **Google** | Gemini families. Multimodal, Imagen image generation, tool use. |
| **xAI** | Grok families. Native image generation, web search. |
| **DeepSeek** | DeepSeek chat and reasoning models. Tool use, chain-of-thought reasoning. |
| **Z.AI** | GLM families. Reasoning, web search, CogView image generation. |
| **NanoGPT** | Pay-as-you-go gateway to 600+ chat models, 200+ image models, and embeddings — one key for all three. |
| **Ollama** | Local/offline models (Llama, Phi, Mistral, etc.). No API key needed. |
| **OpenRouter** | 200+ models through a unified API with automatic pricing. |
| **OpenAI-Compatible** | LM Studio, vLLM, Together AI, Groq, and any compatible endpoint. |

Every bundled provider is a plugin with the same API surface available to third-party authors.

---

## Privacy & Data Ownership

Quilltap's data model rests on one principle: the characters you build, the conversations you have with them, and the memory those conversations leave behind all live on your machine, in encrypted storage, in a single directory you control. There is no version of the application where the collaborator you've built is somewhere we can pull from you, no telemetry hook that sends your conversations home, no account you're required to keep with us. If you back up the directory, you've backed up everything. If you move the directory, you've moved everything. If you stop trusting us, you take your data and your characters with you and we don't get a say in it.

| Platform | Default Location | Override |
| -------- | ---------------- | -------- |
| **macOS** | `~/Library/Application Support/Quilltap` | `QUILLTAP_DATA_DIR` |
| **Windows** | `%APPDATA%\Quilltap` | `QUILLTAP_DATA_DIR` |
| **Linux** | `~/.quilltap` | `QUILLTAP_DATA_DIR` |
| **Docker** | Mount a host directory to `/app/quilltap` | Volume mount (`-v`) |

The application tells you exactly where at the bottom of every page.

- **Databases** are SQLite, encrypted at rest with ChaCha20-Poly1305 (via [SQLite3 Multiple Ciphers](https://github.com/utelle/SQLite3MultipleCiphers)); the standard `sqlite3` CLI cannot open them — use `npx quilltap db` instead. Integrity checks run at startup and physical backups are kept on a tiered retention schedule. Database-backed document stores and their binaries live in a second encrypted file alongside.
- **Files** in filesystem and Obsidian stores stay on disk under their original names.
- **API keys** are stored in the encrypted database. Nothing phones home.
- **Backups:** shut down and copy the directory (a filesystem copy is a perfect backup); a single-ZIP full system backup; selective `.qtap` export with conflict resolution; SillyTavern import/export. See [Backup & Restore](docs/BACKUP-RESTORE.md) and [Database Protection](help/database-protection.md).

---

## Themes

Switch themes live without reloading. Six ship with the application:

| Theme | Style |
| ----- | ----- |
| **Old School** | Classic slate-blue palette with professional typography |
| **Art Deco** | Geometric elegance with navy-and-gold opulence |
| **The Great Estate** | Warm, manor-inspired design with mahogany and gold |
| **Earl Grey** | High-contrast dark theme with modern minimal styling |
| **Rains** | Warm, earthy palette with cozy amber accents |
| **Madman's Box** | A mad inventor's time-machine cabin — dark walnut and brass, amber tubes, and cool phosphor-cyan dials |

Every bundled theme is checked against WCAG 2.2 AA in light and dark mode: contrast, focus rings, reduced motion, keyboard access and screen-reader names.

Themes are `.qtap-theme` bundles — JSON design tokens, CSS, fonts, and images; no build tools. Create your own with `npx create-quilltap-theme my-theme`, manage them with `npx quilltap themes`, or install signed bundles from a registry in Settings.

---

## For Developers

Quilltap was built to be extended. The plugin system supports eight extension points, all delivered as npm packages: **LLM providers**, **image providers**, **embedding providers**, **themes** (legacy format; new themes are bundles), **roleplay templates**, **tools** the AI can use mid-conversation, **search providers**, and **system prompt templates**.

Quilltap is a single Next.js 16 application (App Router) serving both the UI and the API: React 19, TypeScript, Tailwind CSS 4 with a semantic `qt-*` class system for full theme overrideability, TanStack Query, Lexical, and the SVAR file manager on the front; Next.js API routes, encrypted SQLite (`better-sqlite3-multiple-ciphers`), and Zod on the back; GitHub Actions building multi-arch Docker images and the npm package from a single tag push.

- [Development Guide](docs/developer/DEVELOPMENT.md) — local setup, testing, building
- [API Reference](docs/developer/API.md)
- Plugin guides: [Providers](docs/developer/PROVIDER_PLUGIN_DEVELOPMENT.md) · [Themes](docs/developer/THEME_PLUGIN_DEVELOPMENT.md) · [Templates](docs/developer/TEMPLATE_PLUGIN_DEVELOPMENT.md) · [Tools](docs/developer/TOOL_PLUGIN_DEVELOPMENT.md) · [Search](docs/developer/SEARCH_PLUGIN_DEVELOPMENT.md)
- [Prompt Architecture](docs/developer/PROMPT_ARCHITECTURE.md) · [Memory Management](docs/developer/features/complete/memory_management.md) · [Database Architecture](docs/developer/DATABASE_ABSTRACTION.md) · [Image Generation](docs/developer/IMAGE_GENERATION.md)
- [Deployment Guide](docs/DEPLOYMENT.md) — production setup with SSL and reverse proxies
- [Changelog](docs/CHANGELOG.md) · [Roadmap](docs/developer/features/ROADMAP.md)

### Published JSON Schemas

Quilltap's file formats are described by JSON Schemas you can validate against before you hand a file to the application. Each is in the repository under [`public/schemas/`](public/schemas/) and is also served by every running instance at `/schemas/<name>` (for example `http://localhost:3000/schemas/qtap-export.schema.json`).

| Schema | Describes | Use it when |
| ------ | --------- | ----------- |
| [`qtap-export.schema.json`](public/schemas/qtap-export.schema.json) | A `.qtap` export bundle (characters, chats, memories, projects, stores, wardrobe, Inventory, and more) | Writing or checking a `.qtap` file by hand or from another tool |
| [`qtap-export-ndjson.schema.json`](public/schemas/qtap-export-ndjson.schema.json) | One line of a streaming (newline-delimited) `.qtap` export | Validating a large streamed export line by line |
| [`qtap-custom-tool.schema.json`](public/schemas/qtap-custom-tool.schema.json) | A Pascal custom tool: a JSON file in a store's `Tools/` folder | Writing custom mechanics outside Pascal's Workbench (characters can fetch it with `edit_custom_tool`'s `schema` action) |
| [`qtap-progression.schema.json`](public/schemas/qtap-progression.schema.json) | The `progressions` key in a character vault's `metadata.json` | Hand-editing a character's progressions |
| [`qtap-theme.schema.json`](public/schemas/qtap-theme.schema.json) | `theme.json` in a `.qtap-theme` bundle | Building a theme bundle |
| [`plugin-manifest.schema.json`](public/schemas/plugin-manifest.schema.json) | A plugin's `manifest.json` | Writing a provider, tool, template or search plugin |

Contributions are welcome. Please open an issue to discuss major changes before submitting a PR — it is far better to align on direction before building the bridge, as anyone who has ever built a bridge in the wrong direction can attest.

> **Repository note:** Server source lives at [`foundry-9/quilltap-server`](https://github.com/foundry-9/quilltap-server). The original `foundry-9/quilltap` repository is reserved for the next-generation native Quilltap application currently under development. If your tooling references the old URL, update it.

---

## Troubleshooting & Support

- **Docker:** `docker logs quilltap`; check that port 3000 is free; use the startup scripts for local services like Ollama.
- **Desktop app:** see [quilltap-shell](https://github.com/foundry-9/quilltap-shell).
- **General:** the footer shows your data directory and backend mode. Failing that — [GitHub Issues](https://github.com/foundry-9/quilltap-server/issues) or [Discord](https://discord.gg/fnTPEZDE4).
- **Author:** Charles Sebold ([charles.sebold@foundry-9.com](mailto:charles.sebold@foundry-9.com)) · [Foundry-9 LLC](https://foundry-9.com)

---

## License

MIT License — see [LICENSE](LICENSE)

Copyright © 2025, 2026 Foundry-9 LLC

---

<details>
<summary><b>Acknowledgments</b></summary>

Quilltap stands on the shoulders of these excellent open source projects, and is grateful for the view:

**Core:** React, Next.js, TypeScript, better-sqlite3-multiple-ciphers, Zod

**AI & LLM:** OpenAI SDK, Anthropic SDK, Google Generative AI SDK, xAI/Grok SDK, Model Context Protocol SDK

**UI:** Tailwind CSS, TanStack Query, Lexical, SVAR File Manager, React Markdown, React Syntax Highlighter, KaTeX, PDF.js, sharp, Lucide Icons

**Infrastructure:** Docker

**Testing:** Jest, Playwright, Testing Library

**Build & Tooling:** tsx, cross-env

Special thanks to [SillyTavern](https://github.com/SillyTavern/SillyTavern) for pioneering this space and inspiring character format compatibility. One does not forget those who blazed the trail.

</details>
