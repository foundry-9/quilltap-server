# Dangerous Content Handling

Dangerous Content Handling is a feature that classifies messages for sensitive or potentially policy-violating content and optionally routes them to uncensored-compatible LLM providers.

## Overview

When enabled, the system uses your configured Cheap LLM to analyze user messages before they are sent to the main LLM. Content that exceeds the configured threshold is flagged and can be:

- **Detected and flagged** with warning badges (Detect Only mode)
- **Automatically routed** to an uncensored-compatible provider (Auto-Route mode)

The system is designed to be fail-safe: classification errors never block your messages.

## Modes

### Off (Default)

No content scanning or routing. Messages are sent directly to your configured LLM provider.

### Detect Only

Messages are scanned and flagged with danger categories (e.g., NSFW, Violence, Hate Speech) but are still sent to your regular provider. Flagged messages display warning badges and can be blurred or collapsed based on your display settings.

### Auto-Route

Messages are scanned, and flagged content is automatically rerouted to an uncensored-compatible provider. If no uncensored provider is available, the message is sent to your regular provider with a warning notification.

## Configuration

Navigate to **Settings > Chat Settings > Dangerous Content Handling** to configure:

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

1. Go to **Settings > Connection Profiles**
2. Edit or create a profile that connects to an uncensored-compatible model
3. Check the **"Uncensored-compatible"** checkbox
4. Save the profile

The same applies to image profiles if you want image generation routing.

Common uncensored-compatible setups:
- Local Ollama models (many models have uncensored variants)
- OpenRouter with uncensored model selections
- Self-hosted models with no content filtering

## How Classification Works

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

When an image prompt is flagged as dangerous, the system can use a separate uncensored LLM for prompt expansion (the step where character placeholders are resolved into visual descriptions). Configure this in **Settings > Chat Settings > Cheap LLM Settings** under "Image Prompt Expansion LLM (Uncensored - Optional)." If not set, the standard cheap LLM is always used for prompt expansion.

## Important Notes

- Classification uses your Cheap LLM, adding a small token cost per scanned message
- Only user messages are scanned, not assistant responses
- The system never blocks messages - if anything fails, your message goes through normally
- If no uncensored provider is available in Auto-Route mode, the message is sent to your regular provider with a warning
- Classification accuracy depends on the Cheap LLM model's capabilities

## Related Topics

- [Chat Settings](/help/chat-settings) - Configure global chat behavior
- [Connection Profiles](/help/connection-profiles) - Set up LLM providers
- [Image Generation Profiles](/help/image-generation-profiles) - Configure image providers
