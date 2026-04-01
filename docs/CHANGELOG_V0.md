# Quilltap Pre-1.0 Release Notes

These are the release notes for Quilltap's pre-1.0 development period (November 17-19, 2025). During this stretch, the project went from an empty repository to a fully functional AI chat platform with multi-provider LLM support and SillyTavern compatibility in three rapid releases.

At this point, Quilltap was a Docker-hosted Next.js application backed by PostgreSQL via Prisma, authenticated through Google OAuth. It would look very different by v1.0 and beyond, but the bones were already there.

---

## v0.5 — Foundation (November 18, 2025)

**The one where everything started.**

Quilltap v0.5 was the initial working release: a Next.js 14 application with a PostgreSQL database, Google OAuth sign-in, and the basic infrastructure for an AI chat platform. The goal was to prove out the core architecture and get a single LLM provider (OpenAI) working end-to-end.

### What shipped

- **Authentication**: Google OAuth via NextAuth.js v5 with JWT sessions. Users could sign in and land on a dashboard.
- **Encrypted API key management**: API keys stored with AES-256-GCM envelope encryption, using a master pepper for key derivation. This was important from day one — no plaintext secrets in the database, ever.
- **Connection profiles**: A system for configuring how to talk to LLM providers — which API key to use, which model, what base URL. This abstraction would prove essential as more providers were added.
- **Characters and chats**: Basic character creation and a chat interface with real-time streaming responses from OpenAI.
- **LLM abstraction layer**: A provider base class and factory pattern that made it straightforward to add new providers later.
- **Docker Compose environment**: PostgreSQL + the app, ready to `docker-compose up`.
- **CI pipeline**: GitHub Actions running lint, type-check, and unit tests.
- **Test suite**: Unit tests covering API keys, chat initialization, encryption, LLM factory, OpenAI provider, and Prisma operations — about 2,300 lines of test code from the start.
- **Pre-commit hooks**: A `.githooks/pre-commit` script that ran lint and tests before allowing commits, establishing a quality gate that persists to this day.

### Tech stack at this point

Next.js 14, React 19, TypeScript, PostgreSQL 16, Prisma ORM, NextAuth.js, Tailwind CSS, Docker Compose, OpenAI SDK, Anthropic SDK (added as dependency but not yet wired up), Zod for validation.

---

## v0.7 — Multi-Provider LLM Support (November 18, 2025)

**The one where Quilltap learned to talk to everyone.**

Released the same day as v0.5, this version expanded LLM support from just OpenAI to five providers. The LLM abstraction layer designed in v0.5 paid off immediately.

### What shipped

- **Anthropic provider**: Full Claude support with streaming, using the Anthropic SDK directly rather than going through an OpenAI-compatible shim.
- **Ollama provider**: Local model support via Ollama's HTTP API. Configurable base URL for pointing at any Ollama instance.
- **OpenRouter provider**: Access to dozens of models through a single API key, with OpenRouter-specific headers and model listing.
- **OpenAI-compatible provider**: A generic provider for any service that implements the OpenAI API spec (LM Studio, text-generation-webui, vLLM, etc.). Configurable base URL.
- **Connection testing**: A "Test Connection" flow in the settings UI that validates API keys and sends a test message through the configured provider, so users could verify their setup without starting a chat.
- **Model listing**: Dynamic model listing from each provider's API, so the model selector showed what was actually available rather than a hardcoded list.
- **LLM error handling**: A structured error system (`lib/llm/errors.ts`) that normalized provider-specific errors into consistent types — authentication failures, rate limits, model not found, context length exceeded, etc.
- **Expanded test suite**: ~3,500 new lines of tests covering every provider, connection testing, and error handling.

---

## v0.9 — SillyTavern Compatibility (November 19, 2025)

**The one where Quilltap became a place you could actually move into.**

The final pre-1.0 release focused on data portability. SillyTavern is the most widely-used open-source AI chat frontend, and full import/export compatibility meant that users could bring their existing characters, personas, and chat histories with them.

### What shipped

- **Character import/export**: Import SillyTavern character cards in both PNG format (with embedded JSON metadata) and standalone JSON. Export characters back to JSON. Full support for the SillyTavern V2 character spec, preserving all original metadata through round-trips.
- **Persona system**: User personas for roleplay — a way to define who *you* are in a conversation, not just who the AI character is. Create, edit, import, and export personas.
- **Character-persona linking**: Associate specific personas with specific characters, so the right persona is automatically active when chatting with a given character.
- **Chat import/export**: Import and export chat histories in SillyTavern's JSONL format, preserving message metadata, timestamps, and swipe history.
- **Message editing and swipes**: Edit sent messages and generate alternative AI responses ("swipes"), with full history preserved. This was a core SillyTavern workflow that needed to work from the start.
- **Personas UI**: A full management interface under the dashboard — list, create, edit, import, export, and link personas to characters.
- **Integration tests**: Playwright-based integration tests for the chat flow, verifying the full stack from UI to database.
- **SillyTavern compatibility tests**: A dedicated test suite (~320 lines) validating import/export round-trips for characters, personas, and chats.

### The SillyTavern compatibility library

The `lib/sillytavern/` module implemented three converters:

- **`character.ts`**: Bidirectional conversion between Quilltap's character model and SillyTavern V2 character cards, including PNG metadata extraction via the `png-chunk-text` and `png-chunks-extract` packages.
- **`persona.ts`**: Persona format conversion with SillyTavern's simpler persona structure.
- **`chat.ts`**: JSONL chat log parsing and generation, mapping between the two systems' message formats while preserving swipe arrays and metadata.

---

## What came next

Version 1.0 (released November 19, 2025 — yes, the same day as 0.9) marked the transition from "proof of concept" to "real application." The entire pre-1.0 arc took roughly 48 hours of development time across three tagged releases, establishing the foundation that every subsequent version would build on.

The PostgreSQL + Prisma stack would eventually be replaced by SQLite with direct `better-sqlite3` access. Google OAuth would give way to a simpler local auth model. The SillyTavern compatibility layer would be joined by native Quilltap export/import formats. But the core ideas — encrypted credential management, multi-provider LLM abstraction, character-driven chat with full history — were all there from the beginning.
