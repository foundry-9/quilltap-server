---
url: /settings?tab=chat&section=dangerous-content
---

# Dangerous Content Handling

Dangerous Content Handling is a feature that classifies messages for sensitive or potentially policy-violating content and optionally routes them to uncensored-compatible LLM providers.

## Overview

When enabled, the system classifies user messages before they are sent to the main LLM. Content that exceeds the configured threshold is flagged and can be:

- **Detected and flagged** with warning badges (Detect Only mode)
- **Automatically routed** to an uncensored-compatible provider (Auto-Route mode)

The system is designed to be fail-safe: classification errors never block your messages.

### Smart Classification

Quilltap automatically selects the best available classification method:

1. **OpenAI Moderation Endpoint** (preferred): If you have an OpenAI connection profile configured, Quilltap uses OpenAI's dedicated moderation endpoint automatically. This endpoint is purpose-built for content classification, is free to use with any OpenAI API key, and returns structured category scores. No additional configuration is needed — simply having an OpenAI connection profile is sufficient.

2. **Cheap LLM Fallback**: If no OpenAI connection profile is available (or no moderation provider plugin is installed), Quilltap falls back to sending the content to your configured Cheap LLM with a classification prompt. This costs tokens per message and depends on the Cheap LLM's quality.

The system tries the moderation provider first and transparently falls back to the Cheap LLM if needed.

## Modes

### Off (Default)

No content scanning or routing. Messages are sent directly to your configured LLM provider.

### Detect Only

Messages are scanned and flagged with danger categories (e.g., NSFW, Violence, Hate Speech) but are still sent to your regular provider. Flagged messages display warning badges and can be blurred or collapsed based on your display settings.

### Auto-Route

Messages are scanned, and flagged content is automatically rerouted to an uncensored-compatible provider. If no uncensored provider is available, the message is sent to your regular provider with a warning notification.

## Configuration

Navigate to the **Chat** tab in Settings (`/settings?tab=chat&section=dangerous-content`) and expand **Dangerous Content Handling** to configure:

### Detection Threshold

A slider from 0.1 to 1.0 that controls sensitivity:
- **Lower values** (0.1-0.4): More sensitive, flags more content
- **Default** (0.7): Balanced sensitivity
- **Higher values** (0.8-1.0): Only flags strongly dangerous content

### Scan Toggles

- **Text Chat Messages**: Classify user messages before sending to the LLM
- **Image Prompts**: Classify image generation prompts before expansion
- **Image Generation**: Classify the expanded prompt before sending to the image generator

### Uncensored Providers (Auto-Route only)

- **Text LLM Profile**: Select a specific connection profile or auto-detect
- **Image Generation Profile**: Select a specific image profile or auto-detect

When set to auto-detect, the system scans all your profiles marked as "Uncensored-Compatible" and uses the first available one.

### Display Settings

- **Show**: Display flagged content normally with a warning badge
- **Blur**: Blur flagged content with a click-to-reveal overlay
- **Collapse**: Hide flagged content behind a collapsible placeholder
- **Warning Badges**: Toggle category badges on flagged messages

### Custom Classification Prompt

Additional instructions appended to the content classifier's system prompt. Use this to adjust sensitivity for your specific use case (e.g., "Be more lenient with fantasy violence in roleplay contexts").

## Setting Up Uncensored Providers

To use Auto-Route mode, you need at least one connection profile marked as uncensored-compatible:

1. Go to the **AI Providers** tab in Settings (`/settings?tab=providers&section=connection-profiles`) and expand **Connection Profiles**
2. Edit or create a profile that connects to an uncensored-compatible model
3. Check the **"Uncensored-compatible"** checkbox
4. Save the profile

The same applies to image profiles if you want image generation routing.

Common uncensored-compatible setups:
- Local Ollama models (many models have uncensored variants)
- OpenRouter with uncensored model selections
- Self-hosted models with no content filtering

## How Classification Works

### With Moderation Provider (OpenAI)

1. Your message is sent to the OpenAI moderation endpoint (`/v1/moderations`)
2. The endpoint returns structured category flags and confidence scores (e.g., `sexual: 0.92`, `violence: 0.01`)
3. Provider-specific categories are mapped to Concierge categories (e.g., OpenAI's `sexual` → `nsfw`, `hate` → `hate_speech`)
4. If any category score exceeds your threshold, or the provider flags the content, it is marked as dangerous
5. Classification results are cached by content hash (5 minute TTL, up to 200 entries)

### With Cheap LLM (Fallback)

1. Your message is sent to the Cheap LLM with a classification prompt
2. The LLM returns a JSON response with danger categories and scores
3. If the overall score exceeds your threshold, the content is flagged
4. Classification results are cached by content hash (5 minute TTL, up to 200 entries)
5. Each classification is logged as a `DANGER_CLASSIFICATION` system event for cost tracking

### Categories

The classifier checks for:
- **NSFW**: Sexual or explicitly adult content
- **Violence**: Graphic violence, gore, or descriptions of harm
- **Hate Speech**: Hateful, discriminatory, or dehumanizing language
- **Self-Harm**: Content encouraging or depicting self-harm
- **Illegal Activity**: Content describing or encouraging illegal activities
- **Disturbing**: Deeply disturbing, shocking, or upsetting content

## Message Flags

Flagged messages display:
- **Category badges**: Colored labels showing which categories were detected
- **Rerouted badge**: Blue badge indicating the message was sent to an uncensored provider
- **"Not Dangerous" button**: Allows you to override the classification

Overriding a message's danger flags marks all flags as user-overridden and removes the visual effects.

## Image Prompt Expansion

When an image prompt is flagged as dangerous, the system can use a separate uncensored LLM for prompt expansion (the step where character placeholders are resolved into visual descriptions). Configure this in the **Chat** tab in Settings (`/settings?tab=chat&section=dangerous-content`) under **Cheap LLM Settings** > "Image Prompt Expansion LLM (Uncensored - Optional)." If not set, the standard cheap LLM is always used for prompt expansion.

## Chat-Level Classification

In addition to per-message scanning, Quilltap can classify entire chats as dangerous based on the compressed context summary. This happens automatically in the background after messages are exchanged and a context summary has been generated.

### How It Works

1. After a new context summary is generated for a chat, a background job is queued
2. The context summary is sent to the Cheap LLM gatekeeper for classification
3. The chat is marked as dangerous or safe based on the threshold

### Sticky Classification

Once a chat is classified as dangerous, it stays marked as dangerous permanently. This prevents the classification from flip-flopping as conversations evolve. Safe chats are re-checked whenever new messages are added (message count changes).

### Optimizations for Permanently Dangerous Chats

When a chat has been permanently classified as dangerous, Quilltap applies several optimizations to save tokens and avoid futile content refusals:

- **Per-message classification is skipped**: Since every message in a permanently dangerous chat will be dangerous, individual message scanning is bypassed entirely. Danger flags are synthesized from the stored chat-level categories instead.
- **Uncensored providers are not rerouted unnecessarily**: If you have already assigned an uncensored-compatible provider to a character (e.g., DeepSeek), the Concierge will not swap it for the configured uncensored fallback. It only falls back to the configured provider if the current one returns an empty response (suggesting it was caught by censorship anyway).
- **All background tasks use uncensored providers**: Memory extraction, title generation, context summaries, scene state tracking, story backgrounds, and inter-character memory tasks all automatically use your configured uncensored provider in dangerous chats. This prevents content refusals from censored providers that would otherwise silently fail these background operations.

### Manual Reclassification

If a chat was incorrectly classified as dangerous, you can reset its classification. This can be done via the API (`POST /api/v1/chats/[id]?action=reclassify-danger`), which clears the classification and re-queues it for evaluation.

## Quick-Hide Integration

Chats classified as dangerous can be hidden from the sidebar using the quick-hide system.

### Hiding Dangerous Chats

1. Click the **eye icon** in the sidebar footer
2. In the **Content Filters** section, toggle **"Dangerous Chats"** to hide them
3. Dangerous chats will be hidden from the sidebar, projects section, and all-chats page

The toggle is persisted in your browser's local storage, so your preference is remembered across sessions.

## Automatic Background Classification

When dangerous content handling is enabled, Quilltap automatically classifies all existing chats in the background. This runs on startup and periodically every 10 minutes, ensuring legacy chats created before the feature was enabled also get classified.

- Chats with a context summary are classified directly from the summary
- Longer chats without a summary first have a summary generated, which then triggers classification
- Shorter chats without a summary are classified from the raw message history
- Background classification runs at a lower priority than interactive tasks, so it won't slow down your active conversations

## Important Notes

- If you have an OpenAI connection profile, classification uses the free moderation endpoint (no token cost)
- Without an OpenAI profile, classification falls back to your Cheap LLM, adding a small token cost per scanned message
- Only user messages are scanned per-message, not assistant responses (and permanently dangerous chats skip per-message scanning entirely)
- Chat-level classification uses the compressed context summary (covers the whole conversation)
- The system never blocks messages — if anything fails, your message goes through normally
- If no uncensored provider is available in Auto-Route mode, the message is sent to your regular provider with a warning
- Classification accuracy depends on the method used: the OpenAI moderation endpoint is purpose-built and highly accurate; the Cheap LLM fallback depends on the model's capabilities

## In-Chat Settings Access

Characters with help tools enabled can read your current dangerous content configuration during a conversation using the `help_settings` tool with `category: "chat"`. The chat category includes your dangerous content handling settings alongside other chat preferences. Ask a help-tools-enabled character something like "What are my dangerous content settings?" and it will look them up.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=chat&section=dangerous-content")`

## Related Topics

- [Chat Settings](/help/chat-settings) - Configure global chat behavior
- [Connection Profiles](/help/connection-profiles) - Set up LLM providers
- [Image Generation Profiles](/help/image-generation-profiles) - Configure image providers
