---
url: /settings/wizard
---

# AI Stack Setup Wizard

> **[Open the Setup Wizard](/settings/wizard)**

## The Grand Tour of Your AI Establishment

Rather like having a particularly competent concierge walk you through every room of a newly-acquired hotel, the AI Stack Setup Wizard handles the entire business of connecting Quilltap to your preferred AI services in one brisk, guided expedition. No need to rummage through separate settings tabs like a guest searching for the linen closet.

## When You'll Encounter It

The wizard appears in two circumstances:

**First Run** — After you've set up your encryption and created your profile, the wizard materialises automatically at `/setup/providers`. It shan't let you pass without at least one working chat connection, which is really quite reasonable of it.

**Return Visit** — Should you wish to add new providers, adjust your AI stack, or simply revisit your arrangements, you'll find a link to the wizard at the top of [The Forge](/settings). It pre-fills your existing configuration so you needn't start from scratch, which would be tedious beyond endurance.

## The Six Steps

### Step 1: Choose Your Providers

A gallery of available AI providers, each displayed with its particular capabilities. Select one or several — Quilltap is perfectly happy to maintain relationships with multiple providers simultaneously. At minimum, you must select one provider capable of chat, as an AI workspace without conversation would be rather like a library without books.

Each provider card shows capability badges:
- **Chat** — Can hold conversations (required)
- **Embeddings** — Can power the Commonplace Book memory system
- **Images** — Can generate images for The Lantern
- **Web Search** — Can search the internet during conversations

### Step 2: Present Your Credentials

For each selected provider that requires an API key, you'll enter your key and the wizard will validate it against the provider's servers. A green checkmark confirms all is in order; a red notice means something's amiss — usually a miscopied key or insufficient credits.

Providers like Ollama, which run locally and don't require credentials, need only a base URL (typically `http://localhost:11434`).

### Step 3: Select Your Models

With credentials verified, the wizard fetches available models from each provider and presents them for your selection:

- **Primary Chat Model** — Your main conversationalist, the model that will power most interactions
- **Cheap LLM Strategy** — For background tasks like memory extraction and title generation. "Auto" (recommended) lets Quilltap pick the most economical option; "Manual" lets you choose a specific model

### Step 4: The Memory Engine (Optional)

If any of your selected providers support embeddings, you may configure an embedding profile here. Embeddings power the Commonplace Book — your characters' long-term memory system. You can skip this step and configure it later, or use the built-in TF-IDF system which requires no external service.

### Step 5: The Lantern (Optional)

Similarly optional, this step lets you configure image generation if your providers support it. Image generation powers The Lantern background system, which can provide atmospheric visual accompaniments to your stories and conversations.

### Step 6: Review & Confirm

A summary of everything you've configured, with the opportunity to test your connections before committing. The "Test All" button sends a brief message to verify your chat model responds properly. When satisfied, "Save & Complete" creates all necessary profiles in one decisive stroke.

## Multi-Provider Stacking

The wizard excels at configuring mixed provider stacks. For instance:
- Chat via Anthropic (Claude for creative writing)
- Embeddings via OpenAI (reliable, cost-effective)
- Images via Google (Imagen)
- Cheap LLM via Ollama (free, local)

Each service connects through its own API key, and the wizard ensures all the plumbing is properly arranged.

## Troubleshooting

**"No chat-capable provider selected"** — You must select at least one provider with the Chat capability badge before proceeding past Step 1.

**API key validation fails** — Double-check you've copied the entire key. Verify your account has credits. For Ollama, ensure the service is running locally.

**No models appear** — The provider may be temporarily unavailable, or your API key may lack the necessary permissions. Try the "Refresh" button or check your provider's status page.

**For Ollama, only downloaded models appear** — The wizard shows models already available on your system. To add more, run `ollama pull <model-name>` in your terminal before returning to the wizard.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings/wizard")`

## See Also

- [Getting Started with Quilltap](startup-wizard.md) — The complete first-run guide
- [API Keys Settings](api-keys-settings.md) — Managing API keys in detail
- [Connection Profiles](connection-profiles.md) — Advanced connection profile configuration
- [Embedding Profiles](embedding-profiles.md) — Embedding configuration details
- [Image Generation Profiles](image-generation-profiles.md) — Image provider setup
