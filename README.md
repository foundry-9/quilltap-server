# Quilltap

**Your AI, your projects, your stories, your partners, your rules.**

Quilltap is a self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who wants an AI assistant that actually knows what they're working on. Connect to any LLM provider, organize your work into projects with persistent files and context, create characters with real personalities, and build a private AI environment that learns and remembers.

No subscriptions. No data harvested. No forgetting everything between sessions.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.10.0--dev.8-yellow.svg)](package.json)

<p align="center">
  <img src="./website/images/welcome-to-quilltap-2-8.png" alt="Welcome to Quilltap" />
</p>

---

## What Quilltap Does

**For fiction writers and worldbuilders:** Organize your notes, characters, and lore into projects. The AI can read your files, search semantically across your worldbuilding, and actually understand the context of what you're creating—not just the last few messages.

**For roleplayers and gamers:** Create detailed AI characters with personalities, backstories, and voices. Run multi-character scenes. Roll dice and flip coins with built-in RNG. Track inventories, stats, and game state that persists across sessions. Import your SillyTavern characters and chats.

**For everyone else:** Use it as a private AI desktop. Connect to Claude, GPT, Gemini, Grok, or local models through Ollama. Your conversations stay on your machine. The AI builds long-term memory across sessions. You control everything.

---

## Why Not Just Use Claude or ChatGPT?

| What you get with hosted AI | What you get with Quilltap |
| --------------------------- | -------------------------- |
| Conversations disappear or get compressed | Persistent memory across all your chats |
| The AI forgets your project between sessions | Projects with files, folders, and custom instructions |
| One provider, their pricing, their rules | Connect to any provider—or run models locally |
| Your data on someone else's servers | Everything stays on your infrastructure |
| Generic assistant personality | Characters with real voices and personalities |
| No game mechanics or state tracking | Built-in dice rolls, inventories, and persistent game state |

---

## Why Not SillyTavern?

SillyTavern is excellent for maximally customized character chat. Quilltap started from a similar place but grew in a different direction:

- **Project-based organization** — files, folders, semantic search, not just chat logs
- **LLM file access** — the AI can read and write your project files with permission
- **Long-term memory** — semantic recall across conversations, not just within them
- **Game mechanics** — persistent state for inventories, stats, and game tracking
- **Built-in RNG** — dice rolls and coin flips that execute automatically when mentioned
- **Easier configuration** — more safeguards to keep things working

If you're coming from SillyTavern, Quilltap imports your characters and chats directly.

---

## Quick Start

### Prerequisites

- **Docker and Docker Compose** (recommended), or
- **Node.js 22+** (for local development)

### With Docker (Recommended)

#### Use Docker production image

[csebold/quilltap](https://hub.docker.com/repository/docker/csebold/quilltap/general)

#### For local development

```bash
# Clone the repository
git clone https://github.com/foundry-9/quilltap.git
cd quilltap

# Configure environment
cp .env.example .env.local

# Generate your secrets
openssl rand -base64 32  # Use this for JWT_SECRET
openssl rand -base64 32  # Use this for ENCRYPTION_MASTER_PEPPER

# Edit .env.local with your values, then:
docker-compose up
```

Open `http://localhost:3000` and you're running.

### Essential Configuration

Your `.env.local` needs at minimum:

```env
BASE_URL="http://localhost:3000"
ENCRYPTION_MASTER_PEPPER="your-generated-pepper-here"
```

**Important:** Back up your `ENCRYPTION_MASTER_PEPPER`. If you lose it, all your encrypted API keys become unrecoverable.

For production deployment with SSL, see the [Deployment Guide](docs/DEPLOYMENT.md).

---

## Core Features

### Projects & Files

Organize your work the way your brain works:

- **Project instructions** — Custom system prompts that apply to every chat in a project
- **File management** — Upload documents, organize into folders, let the AI read them
- **LLM file access** — AI can list, read, and write files with your permission
- **Semantic search** — Find things by meaning, not just keywords
- **Markdown rendering** — Full GitHub-flavored Markdown with wikilink support
- **Code highlighting** — Syntax highlighting for code files
- **PDF viewer** — Built-in PDF.js for document preview

### Characters & Roleplay

Create AI personalities that feel like collaborators:

- **AI characters** — Detailed profiles with personality, backstory, and system prompts
- **User characters** — Represent yourself however you want
- **Multi-character chats** — Multiple AI characters in one conversation with turn management
- **Impersonation** — Take control of any character mid-scene
- **Swipes** — Generate alternative responses when one doesn't land
- **AI Wizard** — Generate character details automatically, with streaming progress and document upload support
- **SillyTavern import** — Bring your existing characters and chats

### Memory & Context

An AI that actually remembers:

- **Long-term memory** — Important details persist across conversations
- **Semantic recall** — Find memories by meaning, not exact keywords
- **Context compression** — Automatic summarization for long conversations
- **Full context reload** — AI can request complete context when needed

Quilltap uses a three-model architecture for optimal cost and performance:

1. **Chat model** — Your primary AI for conversations (Claude, GPT-4, Gemini, etc.)
2. **Cheap model** — Handles background tasks like memory extraction, titling, and image descriptions
3. **Embedding model** — Powers semantic search for memories and files

### Gaming & Interactivity

Built-in mechanics for tabletop gaming, RPGs, and interactive fiction:

- **Chat State** — Persistent JSON storage for inventories, stats, scores, and any structured data
- **State inheritance** — Project-level state shared across chats, with per-chat overrides
- **Protected keys** — Underscore-prefixed keys (`_notes`) can't be modified by AI
- **Random Number Generator** — Dice rolls (d4 to d1000), coin flips, and random participant selection
- **Auto-detection** — Dice notation in messages executes automatically ("I roll 2d6" actually rolls)
- **Cryptographically secure** — Fair, unpredictable random results

### LLM Tools

Your AI can do more than talk:

- **Web search** — Current information via Serper API
- **Memory search** — Query past conversations
- **Image generation** — Create images mid-conversation (OpenAI, Google Imagen, Grok)
- **File management** — Read/write project files
- **Help search** — AI can search Quilltap's documentation to help you use features
- **MCP connector** — Connect to Model Context Protocol servers
- **Custom tools** — Extend with plugins

---

## Supported Providers

Connect to the AI services you prefer:

| Provider | Models | Notes |
| ---------- | -------- | ------- |
| **Anthropic** | Claude 4/4.5 (Opus, Sonnet, Haiku) | Image understanding, tool use |
| **OpenAI** | GPT-5/5.1, GPT-4o series | Tool calling, GPT-Image/DALL-E |
| **Google** | Gemini 3/2.5 Flash/Pro | Multimodal, Imagen 4 (Nano Banana), tool use |
| **xAI** | Grok 4/4.1, Grok 3 | Native image generation |
| **Ollama** | Llama, Phi, Mistral, etc. | Fully local, offline capable |
| **OpenRouter** | 200+ models | Unified API, automatic pricing |
| **OpenAI-Compatible** | LM Studio, vLLM, etc. | Any compatible endpoint |

For best results we recommend Ollama or OpenAI for embedding, a "nano" or "lite" model for the cheap LLM, and Claude, ChatGPT, Gemini, GLM, or DeepSeek for the primary model. OpenRouter can get you access to all of these for good rates—pay one provider and get a lot—but you'll probably want to use Ollama as a local embedder if you do that.

---

## Customization

### Themes

Quilltap includes three themes (Ocean, Earl Grey, Rains) and supports custom theme plugins. Switch themes live without reloading.

### Plugins

Extend Quilltap with npm packages:

- **LLM Providers** — Add new AI services, including chat and image generation
- **Themes** — Custom visual styles
- **Templates** — Roleplay formatting templates
- **Tools** — Custom LLM capabilities
- **Storage** — Alternative file backends

See the plugin development guides:

- [Theme Development](docs/THEME_PLUGIN_DEVELOPMENT.md)
- [Template Development](docs/TEMPLATE_PLUGIN_DEVELOPMENT.md)
- [Tool Development](docs/TOOL_PLUGIN_DEVELOPMENT.md)
- [Provider Development](docs/PROVIDER_PLUGIN_DEVELOPMENT.md)

---

## Data & Backup

### Data directory location

All Quilltap data (database, files, logs) is stored in a single directory:

| Environment | Default Location                                   | Override Variable         |
| ----------- | -------------------------------------------------- | ------------------------- |
| **Linux**   | `~/.quilltap`                                      | `QUILLTAP_DATA_DIR`       |
| **macOS**   | `~/Library/Application Support/Quilltap`           | `QUILLTAP_DATA_DIR`       |
| **Windows** | `%APPDATA%\Quilltap`                               | `QUILLTAP_DATA_DIR`       |
| **Docker**  | Host: `~/.quilltap` → Container: `/app/quilltap`   | `QUILLTAP_HOST_DATA_DIR`  |

**Docker users:** Set `QUILLTAP_HOST_DATA_DIR` to change where data is stored on your host machine:

```bash
QUILLTAP_HOST_DATA_DIR=/mnt/data/quilltap docker-compose up
```

**Non-Docker users:** Set `QUILLTAP_DATA_DIR` to override the default:

```bash
QUILLTAP_DATA_DIR=/custom/path npm run dev
```

At startup, Quilltap logs which directory it's using and where that configuration came from.

### What's stored where

- **Database:** SQLite file (no external database needed)
- **Files:** Local filesystem or S3-compatible storage
- **API keys:** AES-256-GCM encrypted

### Backup options

- **Full system backup** — Single ZIP file containing everything: characters, chats, files, memories, profiles, plugin configs, and installed npm plugins
- **Native export** — Selective .qtap format with conflict resolution for sharing specific content
- **SillyTavern format** — Import/export for compatibility

See [Backup & Restore](docs/BACKUP-RESTORE.md) for details.

---

## Documentation

- [Deployment Guide](docs/DEPLOYMENT.md) — Production setup with SSL
- [API Reference](docs/API.md) — REST endpoints
- [Image Generation](docs/IMAGE_GENERATION.md) — Provider configuration
- [File LLM Access](docs/FILE_LLM_ACCESS.md) — How AI reads your files
- [Development Guide](DEVELOPMENT.md) — Contributing and local dev
- [Changelog](docs/CHANGELOG.md) — Release history
- [Roadmap](features/ROADMAP.md) — What's coming

---

## Troubleshooting

**Application won't start:**

- Docker: Check `docker ps` and `docker-compose logs -f app`
- Verify port 3000 isn't in use
- Confirm `BASE_URL` matches your actual URL

**Files not displaying (S3/MinIO):**

- Verify S3 credentials in `.env.local`
- Check MinIO console at `localhost:9001` if using embedded MinIO

More help: [GitHub Issues](https://github.com/foundry-9/quilltap/issues)

---

## Tech Stack

Next.js 16 (App Router) • React 19 • TypeScript 5.6 • SQLite • Tailwind CSS 4.1 • Docker

3,400+ tests with Jest and Playwright.

---

## Contributing

Contributions welcome. Please open an issue to discuss major changes before submitting a PR.

---

## License

MIT License — see [LICENSE](LICENSE)

Copyright © 2025, 2026 Foundry-9 LLC

---

## Support

- **Issues:** [GitHub Issues](https://github.com/foundry-9/quilltap/issues)
- **Author:** Charles Sebold
- **Email:** <charles.sebold@foundry-9.com>
- **Website:** [foundry-9.com](https://foundry-9.com)

---

<details>
<summary>**Acknowledgments**</summary>

Built with these excellent open source projects:

**Core:** React, Next.js, TypeScript, better-sqlite3

**AI/LLM:** OpenAI SDK, Anthropic SDK, Google Generative AI SDK, OpenRouter SDK, Model Context Protocol SDK

**UI:** Tailwind CSS, React Markdown, React Syntax Highlighter, PDF.js, sharp

**Infrastructure:** Docker, Nginx, MinIO, AWS SDK

**Testing:** Jest, Playwright, Storybook, Testing Library

Special thanks to [SillyTavern](https://github.com/SillyTavern/SillyTavern) for pioneering this space and inspiring character format compatibility.

</details>
