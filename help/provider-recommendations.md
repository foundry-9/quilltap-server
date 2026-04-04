---
url: /settings?tab=providers
tags: [providers, recommendations, models, setup, openai, anthropic, google, grok, openrouter]
---

# Provider Recommendations

> **[Open Providers Settings](/settings?tab=providers)**

## Choosing Your AI Providers

Quilltap uses AI models for several different jobs, and no single provider is the best at all of them. Think of it like staffing a house --- you want the right person in each role. Here's our guidance on which providers work best where.

## What Quilltap Uses AI For

| Role | What It Does | Where to Set It Up |
|------|-------------|-------------------|
| **Chat** | Your characters' conversations, personalities, and responses | [Connection Profiles](/settings?tab=providers&section=connection-profiles) |
| **Background Tasks** | Memory extraction, summarisation, scene tracking, titles | [Chat Settings > Cheap LLM](/settings?tab=chat&section=cheap-llm) |
| **Image Generation** | Character portraits, scene illustrations, story backgrounds | [Image Profiles](/settings?tab=images) |
| **Embeddings** | Semantic search for the Commonplace Book memory system | [Embedding Profiles](/settings?tab=providers&section=embedding-profiles) |
| **Moderation** | Content classification for the Concierge | [Chat Settings > Cheap LLM](/settings?tab=chat&section=cheap-llm) |

## Our Recommendations

### Chat (Your Main Models)

This is where quality matters most. Your characters' personalities, emotional depth, and storytelling all depend on the chat model.

**Best for tool use and agent mode:**
- **Anthropic Claude** (Sonnet or Opus) --- Excellent at following instructions and using tools reliably. Great for Prospero's agent mode.
- **xAI Grok** --- Strong reasoning and tool use. The `-reasoning` variants handle complex tasks well.
- **OpenAI GPT-4o** --- Solid and well-tested. (Note: GPT-5 tends to over-narrate, which can feel less natural for character chat.)
- **OpenRouter** --- Access to all of the above and hundreds more through a single API key. Highly recommended if you're still finding the right model for your characters --- you can try them all without juggling separate accounts.

**Best for emotional and creative writing:**
- **Anthropic Claude** --- Nuanced emotions and strong character consistency across long conversations.
- **Google Gemini** --- Impressive emotional range and vivid creative expression.
- **xAI Grok** --- Natural conversational tone with good emotional awareness.
- **OpenRouter** --- Try any of these (and many more) through one key to find what clicks with your style.

**Best for uncensored content (via the Concierge):**
- **xAI Grok** --- The easiest option for mature or unrestricted content. When the Concierge detects that a safety-filtered model might refuse a response, it can reroute to Grok automatically.

### Background Tasks (The Cheap LLM)

These run constantly behind the scenes --- extracting memories, generating chat titles, compressing context, tracking scenes. Cost matters here more than brilliance.

**We strongly recommend: OpenAI or OpenRouter**

- **OpenAI gpt-5-nano** or **gpt-4.1-nano** --- Purpose-built for this kind of work. Fast, cheap, and capable. Quilltap automatically optimises its requests for these models.
- **OpenRouter** --- Also gives you access to cheap models from multiple providers, including OpenAI's nano models. A good option if you're already using OpenRouter for chat.

If you use the Concierge's uncensored routing, you can also set up a Grok profile as your uncensored fallback. The Concierge will use it automatically when the primary cheap LLM declines a request.

### Image Generation

- **Google Gemini** (Imagen) --- High quality with good style variety.
- **OpenAI** (gpt-image / DALL-E) --- Reliable and versatile, good at interpreting character descriptions.
- **xAI Grok** (Imagine) --- Strong results with a distinctive look.

All three are solid. We recommend trying each to see which style you prefer.

### Embeddings

**We strongly recommend: OpenAI**

- **text-embedding-3-small** or **text-embedding-3-large** --- These power the Commonplace Book's memory search, matching what a character remembers to what's being discussed. Fast, affordable, and nothing else matches them at this price.

### Moderation

**We strongly recommend: OpenAI**

OpenAI's moderation endpoint is what the Concierge uses to classify content. It's free, fast, and just requires an OpenAI API key. No other provider offers a comparable service.

## The Simplest Setup

If you want to keep things straightforward, here's the minimum that covers everything:

1. **An OpenAI API key** --- For embeddings, moderation, and optionally background tasks and images
2. **One chat provider** --- Pick any one: Anthropic, Grok, Google, OpenAI, or OpenRouter

That's two API keys for the full Quilltap experience. If you choose **OpenRouter** for chat, it can also handle your background tasks --- giving you access to hundreds of models while only needing OpenAI for embeddings and moderation.

Add a Grok key if you want uncensored routing through the Concierge.

## About OpenRouter

[OpenRouter](https://openrouter.ai) gives you access to hundreds of models from dozens of providers --- all through a single API key and account. It's an excellent choice for both chat and background tasks, and we especially recommend it if you're still experimenting to find the right models for your characters and workflow. Instead of signing up for separate accounts with Anthropic, Google, and xAI, you can try them all from one place.

The main thing OpenRouter doesn't cover is **embeddings** and **moderation** --- you'll still need a direct OpenAI key for those.

## In-Chat Navigation

To navigate to the providers settings page from within a chat, you may use the help tool:

```
help_navigate(url: "/settings?tab=providers")
```

## Related Topics

- [Connection Profiles](connection-profiles.md) --- Creating and managing your AI connections
- [AI Stack Setup Wizard](setup-wizard.md) --- Guided first-time setup
- [Chat Settings](chat-settings.md) --- Configuring the cheap LLM and other options
- [Image Generation Profiles](image-generation-profiles.md) --- Setting up image generation
- [Embedding Profiles](embedding-profiles.md) --- Configuring semantic memory search
- [The Concierge](dangerous-content.md) --- Content routing and uncensored fallback
