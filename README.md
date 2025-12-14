# Quilltap

AI-powered roleplay chat platform with a pluggable provider system, deep SillyTavern compatibility, and a theming engine built for immersive storytelling.

<p align="center">
  <img src="./website/images/welcome-to-quilltap.png" alt="Welcome to Quilltap" />
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.3.0--dev.29-yellow.svg)](package.json)

## What is Quilltap?

[Quilltap](https://github.com/foundry-9/quilltap) is a modern, self-hosted chat platform for AI-powered roleplay. It combines a Next.js 16 application with a plugin architecture so you can mix-and-match LLM providers, theme packs, and authentication methods while keeping your data under your control. The platform ships with a multi-character chat system, a Tools workspace for backups and restores, and a ThemeProvider runtime that lets you swap entire visual palettes at runtime.

**Key Features:**

- 🤖 Multi-provider plugins (OpenAI, Anthropic, Google Gemini, Grok, Gab AI, Ollama, OpenRouter, OpenAI-compatible APIs) with per-provider API key storage and connection profiles.
- 🧠 Cheap LLM + embedding automation for memories, summaries, rename/replace flows, and semantic search that prefers embeddings when available.
- 👥 Multi-character SillyTavern import wizard plus an in-app turn system with nudge/queue controls, inter-character memory sharing, and streaming avatars.
- 🧰 Tools workspace with backup/restore flows (local download or S3), cloud backup previews, and a delete-all-data card; DevConsole (development builds) surfaces server logs, browser consoles, and chat traces.
- 🎨 Theme plugin system powered by qt-* semantic utility classes so you can ship new theme packs (Ocean, Rains, Earl Grey are included) and give users an Appearance settings tab + nav toggle for quick swaps.
- 🖼️ Integrated image generation profiles (Google Gemini/Imagen 4, Grok, OpenAI, OpenRouter) plus an asset gallery with tagging, avatar overrides, and secure per-user storage.
- 🔐 Google OAuth plugin, optional no-auth mode, local username/password login, and TOTP MFA backed by AES-256-GCM encrypted API keys and per-user encryption keys.
- 🐳 Docker-first deployment targeting MongoDB + S3-compatible storage with embedded MinIO and Mongo Express for local development.

## What Can It Do?

### Character Management

- Create richly detailed characters with personalities, physical descriptions (short/medium/long/complete tiers), memories, attachments, and example dialogues.
- Use the rename/replace + template conversion interface to mass-update prompts, placeholder syntax, and SillyTavern templates across characters.
- Favorite characters, sort lists by favorites/chat counts/name, and use quick-create APIs when migrating large libraries.
- Import and export characters via SillyTavern’s JSON format (PNG card embedding is not supported) with automatic avatar hookup and tagging.
- Link personas and tag sets directly to characters so downstream chats inherit the right identity and metadata.

### Persona System

- Define multiple user personas with display names, backstories, and avatar images so you can swap perspectives per chat.
- Link personas to characters for consistent interactions, shared tags, and context injection.
- Import/export personas in SillyTavern JSON, including bundled persona sets for quick onboarding.
- Customize persona defaults such as preferred connection profiles, default tone, or chat presets.

### Advanced Chat & Multi-Character Play

- Real-time streaming responses with swipes, message editing/deletion, and complete chat history retention.
- Native multi-character chats: add/remove participants mid conversation, manage turn queues, nudge idle speakers, and render streaming avatars in real time.
- Inter-character memory sharing plus auto-tagging and placeholder generation so scene descriptions stay consistent.
- Multi-character SillyTavern import wizard with speaker mapping, persona assignment, and optional memory creation for each participant.
- Development builds expose a DevConsole so engineers can read server logs, browser consoles, and chat traces without leaving the UI.

- Import/export entire conversations from SillyTavern and branch them inside Quilltap with swipe histories.

### Image & Avatar Management

- Upload art via file or URL, automatically store it in S3/MinIO, and tag assets for quick reuse.
- Curate a gallery that powers character avatars, persona avatars, chat message attachments, and reference boards.
- Assign chat-specific avatar overrides or persona-specific avatars without losing the base asset.
- Images live inside per-user S3 folders, scoped by user ID, so exports and deletes are isolated per account.

### Image Generation

- Create reusable image generation profiles for Google Gemini (Imagen 4, Gemini image models), Grok, OpenAI, and OpenRouter-backed models (Gemini 2.0/2.5/3.0 via OpenRouter).
- Launch the generator directly from any chat, iterate on prompts, and send results back into the conversation without leaving the modal.
- Automatically collect generated output in the gallery so you can reuse it for avatars, personas, or attachments.
- Configure provider-specific controls (quality, style, safety settings, aspect ratios) and set global defaults in Settings.
- Let the cheap LLM pipeline expand prompts using character + persona descriptions (`{{Character}}`, `{{me}}`, etc.) before submitting to the provider.

### Memory, Embeddings & Automation

- Configure Cheap LLM strategies (user-defined profile, cheapest provider, or local-first via Ollama) to power summarization, housekeeping, and prompt expansion jobs.
- Manage dedicated embedding profiles (OpenAI `text-embedding-3`, OpenRouter embeddings, Ollama/local vectors) and decide which profile each feature should use.
- Memory search automatically prefers embeddings and gracefully falls back to keyword heuristics if none are configured.
- Use the memory editor and housekeeping dialog to audit, merge, or regenerate summaries, tags, and placeholders with a couple of clicks.

- Flag any connection profile as “cheap,” set a global default, or let Quilltap auto-pick the cheapest provider using real pricing fetched from OpenRouter.

### Multi-Provider Support

Configure dedicated connection profiles for each provider you want to use:

| Provider | Capabilities |
|----------|--------------|
| **OpenAI** | GPT-5/5.1 families, GPT-4o/4o-mini, GPT-4.1/4.1-mini/4.1-nano, GPT-3.5 legacy models, tool/function calling, file attachments, and image generation. |
| **Anthropic** | Claude 4/4.5 families (Opus, Sonnet, Haiku) and Claude 3 models with streaming, image understanding, and tool/JSON output control. |
| **Google Gemini** | Gemini 2.5 Flash/Pro with multimodal inputs, web search, plus Imagen 4 image generation through Google Generative AI. |
| **Grok (xAI)** | Grok 4/4.1 and Grok 3 families via the OpenAI-compatible xAI endpoint with multimodal attachments, web search, and native image generation. |
| **Gab AI** | Access to multiple model families (Claude, GPT, Gemini, DeepSeek, Qwen, and more) through a unified OpenAI-compatible chat API. |
| **Ollama** | Local/offline models (Llama, Phi, etc.) reachable at `http://localhost:11434` with embedding support, perfect for the Local First cheap-LLM strategy. |
| **OpenRouter** | Access 200+ hosted models through the OpenRouter SDK with streaming, embeddings, pricing sync, web search, and image generation (model-dependent). |
| **OpenAI-Compatible** | Generic connector for LM Studio, vLLM, Text Generation Web UI, and any other OpenAI-format API you want to self-host. |

### Security & Privacy

- AES-256-GCM encryption protects every API key using per-user keys derived from the user ID plus a master pepper you control.
- NextAuth powers authentication with plugin-based OAuth providers (Google today, more to come), local username/password login, optional TOTP 2FA, and even a no-auth flag for local/private deployments.
- Strict rate limiting, secure headers, and server-side validation guard every route; the Tools workspace can purge all user data (and cloud backups) with a single action.
- All primary data lives in MongoDB collections while files, avatars, backups, and generated art are stored in per-user prefixes inside S3-compatible storage.

## How It Works

Quilltap is built on a modern, plugin-friendly stack:

- **Frontend & Backend**: Next.js 16 (App Router) with React 19 and TypeScript 5.6 serves both the UI and API routes.
- **Plugin Runtime**: Providers, auth connectors, themes, upgrade scripts, and dev tooling are delivered as site plugins in `plugins/dist`, loaded according to `SITE_PLUGINS_ENABLED`.
- **Data Store**: MongoDB 7+ holds users, chats, characters, personas, memories, embeddings, and provider metadata.
- **File Storage**: S3-compatible storage (embedded MinIO for dev or any external S3/MinIO) stores uploads, gallery assets, and user backups under `users/{userId}/`.
- **Authentication**: NextAuth.js 4.24 handles Google OAuth, local accounts, optional TOTP, and the AUTH_DISABLED “no-auth” mode.
- **Styling**: Tailwind CSS 4 + the qt-* semantic component class system ensures theme plugins can override every UI surface.
- **Deployment**: Docker + Docker Compose orchestrate the Next.js app, MongoDB, MinIO, Mongo Express, and Let’s Encrypt-enabled Nginx proxies.
- **Encryption**: User-specific AES-256-GCM keys plus a master pepper secure API keys and sensitive connection metadata at rest.

The entire architecture is a single Next.js application that renders the web UI, exposes REST/Next API routes for providers, and streams chat responses over HTTP. Plugins register providers/themes/auth flows, and environment flags control which plugins are allowed to load so you can ship trimmed builds for offline environments.

Your API keys are decrypted only when the authenticated user requests them, the DevConsole is disabled outside of development, and every provider call flows through the plugin registry so network endpoints are centralized and auditable.

## Getting Started

### Prerequisites

- **Docker and Docker Compose** (recommended)
- **Node.js 20+** (for local development)
- **MongoDB** (local or MongoDB Atlas)
- **S3-compatible storage** (embedded MinIO for development, or external S3/MinIO for production)
- **Google OAuth credentials** (optional, for OAuth login - [Get them here](https://console.cloud.google.com/))

### Quick Start with Docker

This is the recommended approach for most users.

#### 1. Clone the repository

```bash
git clone https://github.com/foundry-9/quilltap.git
cd quilltap
```

#### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and set your values:

```env
# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-nextauth-secret-here"

# Authentication options
AUTH_DISABLED="false"                # Enable only for local/offline installs
AUTH_ANONYMOUS_USER_NAME="Anonymous User"

# Google OAuth (optional - get from https://console.cloud.google.com/)
# If not configured, only email/password login will be available
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Plugin loader (controls which providers/themes are available)
SITE_PLUGINS_ENABLED="all"           # or comma-separated plugin IDs
# SITE_PLUGINS_DISABLED="qtap-plugin-gab-ai,qtap-plugin-ollama"

# Encryption
ENCRYPTION_MASTER_PEPPER="your-encryption-pepper-here"

# MongoDB (required)
MONGODB_URI="mongodb://localhost:27017"
MONGODB_DATABASE="quilltap"

# S3 Storage (embedded MinIO is default for development)
S3_MODE="embedded"
# S3_ENDPOINT="http://localhost:9000"  # Required when S3_MODE=external
# S3_ACCESS_KEY="minioadmin"
# S3_SECRET_KEY="minioadmin"
# S3_BUCKET="quilltap-files"
```

**Notes:**

- OAuth plugins are optional. When no OAuth provider is configured, the sign-in page warns users and only local email/password login is available.
- `SITE_PLUGINS_ENABLED="all"` loads every plugin in `plugins/dist`. Restrict the list (or use `SITE_PLUGINS_DISABLED`) if you don't want Quilltap to contact certain providers.
- MongoDB and S3-compatible storage are required. The development docker-compose file spins up MongoDB, MinIO, Mongo Express, and an auto bucket-creation helper for you.

#### 3. Generate secrets

```bash
# Generate NEXTAUTH_SECRET
openssl rand -base64 32

# Generate ENCRYPTION_MASTER_PEPPER
openssl rand -base64 32
```

Add these values to your `.env.local` file.

#### 4. Set up Google OAuth (Optional)

If you want to enable "Sign in with Google":

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
6. Copy the Client ID and Client Secret to your `.env.local`

**Skip this step** if you only want to use email/password authentication.

#### 5. Start the application

For development with MongoDB and MinIO services:

```bash
# Start with MongoDB and MinIO (recommended for development)
docker-compose -f docker-compose.dev-mongo.yml up

# Or run in background
docker-compose -f docker-compose.dev-mongo.yml up -d

# View logs
docker-compose -f docker-compose.dev-mongo.yml logs -f app

# Stop services
docker-compose -f docker-compose.dev-mongo.yml down
```

This starts:

- **Quilltap app** on `https://localhost:3000`
- **MongoDB** on `localhost:27017`
- **MinIO** (S3-compatible storage) on `localhost:9000` (API) and `localhost:9001` (console)
- **Mongo Express** (MongoDB admin UI) on `localhost:8081`

The dev container generates and uses a self-signed certificate stored in `certs/`, so your browser will prompt you to trust it the first time you connect.

Services exposed by `docker-compose.dev-mongo.yml`:

- **Quilltap app**: `https://localhost:3000` (Next.js dev server via `npm run devssl`)
- **MongoDB**: `localhost:27017`
- **MinIO API**: `localhost:9000` (credentials: `minioadmin/minioadmin`)
- **MinIO Console**: `localhost:9001`
- **Mongo Express**: `http://localhost:8081`

### Local Development

For local development without Docker, you need Node.js plus MongoDB and MinIO running locally:

#### 1. Install dependencies

```bash
npm install
```

#### 2. Start MongoDB and MinIO

You can either:

- **Use Docker for services only**: `docker-compose -f docker-compose.dev-mongo.yml up -d mongo minio createbuckets`
- **Install MongoDB locally**: Follow [MongoDB installation guide](https://www.mongodb.com/docs/manual/installation/)
- **Install MinIO locally**: Follow [MinIO installation guide](https://min.io/docs/minio/linux/index.html)

#### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` with your values (see Quick Start section above). Make sure MongoDB and S3 settings are configured.

#### 4. Start the development server

```bash
# HTTPS dev server (matches Docker behavior)
npm run devssl

# or run plain HTTP if certificates aren't needed
npm run dev
```

The application will be available at [https://localhost:3000](https://localhost:3000)

## Production Deployment

For production deployment with Docker, Nginx, and SSL:

### Hosting Prerequisites

- A domain name pointed to your server
- Port 80 and 443 open on your firewall

### Quick Production Setup

```bash
# 1. Clone and configure
git clone https://github.com/foundry-9/quilltap.git
cd quilltap
cp .env.example .env.production

# 2. Edit .env.production with your production values
# Make sure to set:
# - NEXTAUTH_URL=https://yourdomain.com
# - Google OAuth redirect URI: https://yourdomain.com/api/auth/callback/google
# - All encryption and auth secrets
# - MongoDB connection (MONGODB_URI, MONGODB_DATABASE)
# - S3 configuration (S3_MODE=external, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_REGION/S3_FORCE_PATH_STYLE)
# - SITE_PLUGINS_ENABLED / SITE_PLUGINS_DISABLED for the providers and themes you want available

# 3. Initialize SSL certificates
chmod +x docker/init-letsencrypt.sh
./docker/init-letsencrypt.sh yourdomain.com admin@yourdomain.com

# 4. Start production services
docker-compose -f docker-compose.prod.yml up -d

# 5. Check logs
docker-compose -f docker-compose.prod.yml logs -f
```

Your application will be available at `https://yourdomain.com` with automatic SSL certificate renewal.

For cloud production deployment that targets managed MongoDB Atlas + AWS S3, use `docker-compose.prod-cloud.yml`. It swaps the embedded databases for minimal app containers so you can point at external services. Detailed examples (systemd units, cron-based backups, log rotation, etc.) are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Data Management

Quilltap stores all data in MongoDB and S3-compatible storage. Backups, exports, and the delete-data card all operate on the same datasets you see below.

### MongoDB Collections

- **users** - User accounts and authentication data
- **api_keys** - Provider API keys encrypted per user
- **characters** - Character definitions and metadata
- **personas** - User persona definitions
- **chats** - Chat metadata and message history
- **files** - File metadata (actual files stored in S3)
- **tags** - Tag definitions
- **memories** - Character memory data
- **connectionProfiles** - LLM connection configurations
- **embeddingProfiles** - Embedding provider configurations
- **imageProfiles** - Image generation configurations
- **sessions/verification tokens** - Managed by NextAuth for OAuth + local login flows

### S3 Storage

All files (images, attachments, avatars) are stored in S3-compatible storage with the following structure:

- `users/{userId}/files/` - User-uploaded files
- `users/{userId}/images/` - Generated and uploaded images
- `users/{userId}/backups/` - Full-account backups created from the Tools workspace

When `S3_MODE="embedded"` the Docker stack provisions a MinIO instance plus a `quilltap-files` bucket. For production you can point the same keys at AWS S3, MinIO, Cloudflare R2, or any other S3-compatible service.

### Backup & Restore

Quilltap includes a built-in backup and restore system accessible from the **Tools** page (`/tools`):

- **Create Backup**: Export all your data as a ZIP file (download or save to cloud)
- **Restore from Backup**: Import from a local file or from any S3 backup stored under `users/{userId}/backups/`
- **Cloud Backups**: List, preview metadata, and restore S3 backups without leaving the modal
- **Delete All Data**: Permanently wipe characters, personas, chats, API keys, files, and backups for the current user (after a confirmation step)

The Tools workspace orchestrates MongoDB + S3 backups per user, so multi-tenant deployments can let users export their own data without sharing secrets. For admin-focused CLI procedures (cron-based `mongodump`, S3 sync, retention policies), see [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md).

## Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXTAUTH_URL` | Your app's URL | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | Secret for NextAuth.js | Generate with `openssl rand -base64 32` |
| `ENCRYPTION_MASTER_PEPPER` | Master encryption key | Generate with `openssl rand -base64 32` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017` |
| `MONGODB_DATABASE` | MongoDB database name | `quilltap` |

S3 storage configuration:

| Variable | Description | Default |
|----------|-------------|---------|
| `S3_MODE` | Storage mode (`embedded` or `external`) | `embedded` |
| `S3_ENDPOINT` | S3 endpoint URL (for external mode) | - |
| `S3_ACCESS_KEY` | S3 access key | - |
| `S3_SECRET_KEY` | S3 secret key | - |
| `S3_BUCKET` | S3 bucket name | `quilltap-files` |
| `S3_REGION` | S3 region (when required by provider) | `us-east-1` |
| `S3_FORCE_PATH_STYLE` | Set to `true` for MinIO/compatibility endpoints | `true` (recommended for MinIO) |
| `S3_PATH_PREFIX` | Optional key prefix (e.g., `prod/`) | *(empty)* |
| `S3_PUBLIC_URL` | Optional CDN/public URL override | *(empty)* |

Optional environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials for the auth plugin | - |
| `AUTH_DISABLED` | Disables auth and auto-creates an anonymous user (local-only) | `false` |
| `AUTH_ANONYMOUS_USER_NAME` | Display name when `AUTH_DISABLED=true` | `Anonymous User` |
| `SITE_PLUGINS_ENABLED` | Comma-separated plugin IDs or `all` | `all` |
| `SITE_PLUGINS_DISABLED` | Comma-separated plugins to remove even if enabled | *(empty)* |
| `LOG_LEVEL` | Logging level (`error`, `warn`, `info`, `debug`) | `info` |
| `LOG_OUTPUT` | `console`, `file`, or `both` | `console` |
| `LOG_FILE_PATH` | Directory for log files when `LOG_OUTPUT` includes `file` | `./logs` |
| `LOG_FILE_MAX_SIZE` / `LOG_FILE_MAX_FILES` | Rotation controls for file logging | `10MB / 5` |
| `MONGODB_CONNECTION_TIMEOUT_MS` / `MONGODB_MAX_POOL_SIZE` | Optional Mongo tuning | - |

**Important**: Back up your `ENCRYPTION_MASTER_PEPPER` securely. If lost, all encrypted API keys become unrecoverable. Also ensure MongoDB and S3 data are backed up regularly.

### Connection Profiles

Once logged in, you'll need to:

1. **Add API Keys**: Settings → API Keys for each provider you plan to use
2. **Create LLM Connection Profiles**: Configure provider, model, temperature, and mark any profile as the default or "cheap"
3. **Configure Image Profiles (optional)**: Settings → Image Profiles for OpenAI, Google Imagen, Grok, or OpenRouter image generation
4. **Configure Embeddings & Cheap LLM settings (optional)**: Settings → Embedding Profiles and Chat Settings to pick embedding providers and Cheap LLM strategy
5. **Create Characters**: Set up characters/personas for roleplay
6. **Start Chatting**: Launch a new chat with a character and selected connection profile

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5.6
- **Data Storage**: MongoDB
- **File Storage**: S3-compatible (embedded MinIO or external S3)
- **Authentication**: NextAuth.js 4.24 with Google OAuth, email/password login, and TOTP 2FA
- **Encryption**: AES-256-GCM for sensitive data
- **Styling**: Tailwind CSS 4.1
- **Container**: Docker + Docker Compose
- **Reverse Proxy**: Nginx (production)
- **SSL**: Let's Encrypt (production)

## Documentation

- [API Documentation](docs/API.md) – REST endpoints, auth details, and provider hooks.
- [Deployment Guide](docs/DEPLOYMENT.md) – Production patterns, TLS setup, cron backups, and monitoring tips.
- [Backup & Restore Guide](docs/BACKUP-RESTORE.md) – CLI workflows for MongoDB + S3 plus retention strategies.
- [Image Generation Guide](docs/IMAGE_GENERATION.md) – Provider-specific parameters and prompt expansion behavior.
- [Development Notes](DEVELOPMENT.md) – Local dev scripts, testing commands, and repo layout.
- [Theme Utility Classes](features/complete/theme-utility-classes.md) – Status of the qt-* semantic migration.
- [Local User Authentication](features/complete/LOCAL_USER_AUTH.md) – Email/password and TOTP implementation details.
- [Plugin Developer Guide](plugins/README.md) – How site plugins are structured and distributed.
- [LLM Provider Guide](plugins/LLM-PROVIDER-GUIDE.md) – Creating new provider plugins.
- [Auth Provider Guide](plugins/AUTH-PROVIDER-GUIDE.md) – Building OAuth/no-auth plugins.

## Troubleshooting

### Application won't start

- Check that Docker is running: `docker ps`
- Check logs: `docker-compose logs -f`
- Ensure port 3000 isn't in use
- Verify MongoDB is accessible: `mongosh --eval "db.runCommand('ping')"`
- Verify S3/MinIO is accessible

### Data not persisting

- Check MongoDB connection: verify `MONGODB_URI` is correct
- Check S3 configuration: verify S3 credentials and bucket exist
- Check application logs for connection errors
- For MinIO, verify the bucket was created: access MinIO console at `localhost:9001`

### Authentication issues

- Verify Google OAuth credentials are correct
- Check that redirect URI matches exactly in Google Cloud Console
- Ensure `NEXTAUTH_URL` matches your actual URL
- Verify `NEXTAUTH_SECRET` is set

### Import/Export not working

- Ensure files are valid SillyTavern format (V2 spec, JSON only)
- PNG character card format is not supported - use JSON format for character import/export
- Note: Avatar images work fine - the limitation is only the PNG card format (JSON embedded in PNG)
- Check file size limits
- Verify you're logged in

For more help, please [open an issue](https://github.com/foundry-9/quilltap/issues).

## Contributing

Contributions are welcome! Please:

1. Open an issue first to discuss major changes
2. Fork the repository
3. Create a feature branch
4. Make your changes
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

Copyright (c) 2025 Foundry-9

## Support

- **Issues**: [GitHub Issues](https://github.com/foundry-9/quilltap/issues)
- **Author**: Charles Sebold
- **Email**: <charles@sebold.tech>
- **Website**: <https://foundry-9.com>

## Release History

See details in [CHANGELOG](./docs/CHANGELOG.md).

## Roadmap

- [ ] Finish authentication changes
  - [X] Convert Google OAuth to plugin (`qtap-plugin-auth-google`)
  - [X] Create auth provider plugin interface and registry
  - [X] Implement lazy initialization pattern for NextAuth
  - [X] Centralize session handling in `lib/auth/session.ts`
  - [X] Make a default no-auth option (`AUTH_DISABLED=true` env var)
  - [ ] Retain site-installed plugins in `plugins/`, controlled by environment variables
  - [ ] Move user-installed plugins to `plugins/users/[login-uuid]/`
  - [ ] Add Apple, GitHub OAuth plugins
- [X] Enhanced roleplay options using more complex templates (v2.3)
- [ ] "Visual Novel" options?
- [ ] Worldbook/Lore
- [ ] General SSE-based MCP support
- [ ] Python script support
- [ ] ComfyUI + LORA support for local installations (see [feature request](./features/comfy_ui_local_image.md))
- [ ] Arcadia "art deco" theme to show off what the theme system can really do
- [ ] Fully mobile-capable media breakpoints
- [ ] Character checkpointing (backups of a character at a certain point in time)
- [ ] Setup wizard
  - [ ] Default assistant, editable
  - [ ] Can be restored quickly to basics
  - [ ] Has intimate knowledge of this application
  - [ ] Works well enough with simple, low-cost or local LLMs (e.g., Mistral or Qwen)
- [ ] Character build-out wizard
  - Uses LLM of choice to fill out gaps in character fields or physical descriptions

## Acknowledgments

Built with these excellent open source projects:

- [Next.js](https://nextjs.org/) - React framework
- [NextAuth.js](https://next-auth.js.org/) - Authentication
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Zod](https://zod.dev/) - TypeScript-first schema validation
- [Docker](https://www.docker.com/) - Containerization

Special thanks to the [SillyTavern](https://github.com/SillyTavern/SillyTavern) project for pioneering this space and inspiring the character format and import/export compatibility.
