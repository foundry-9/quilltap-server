---
url: /settings?tab=chat
---

# Chat Settings

> **[Open this page in Quilltap](/settings?tab=chat)**

Chat Settings control global behavior for all your chats in Quilltap, including how conversations look, how they're stored, and which services are used for special features.

## Accessing Chat Settings

1. Click **Settings** (gear icon) in the left sidebar
2. Click the **Chat Settings** tab
3. You'll see multiple setting cards for different aspects of chat behavior

## Understanding Chat Settings Sections

### Avatar Settings

Controls how your user avatar appears in chats.

**Setting Options:**

- **Avatar Mode** — Choose how to display your avatar:
  - **Initials** — Show your initials (e.g., "JD" for John Doe)
  - **Image** — Use an image from your image library
  - **Emoji** — Use a single emoji character

- **Display Style** — Customize appearance:
  - **Circle** — Round avatar
  - **Square** — Square with rounded corners
  - **Rounded Square** — Square with more rounded corners
  - **Full Square** — Sharp square corners

- **Background Color** — Pick a background color for the avatar

**How to change:**

1. Choose your preferred mode and style
2. Changes apply immediately to all chats
3. If using image mode, select which image to display

### Cheap LLM Configuration

Configure a fallback LLM for lower-cost operations. Quilltap can use a cheaper model for certain operations, reserving your main profile for complex tasks.

**Setting Options:**

- **Enable Cheap LLM** — Toggle this feature on/off
- **Cheap LLM Profile** — Select which connection profile to use for cheaper operations
- **Operations** — Controls which operations use the cheap profile:
  - Image descriptions
  - Summary generation
  - Memory indexing
  - Title generation for chats
  - Other low-complexity tasks

**How to configure:**

1. Click **Enable Cheap LLM**
2. Choose a connection profile from the dropdown (must be created in Connection Profiles tab)
3. The selected profile is used for cost-saving operations
4. Your main profile is used for actual chat interactions

**Benefits:**

- Save on API costs
- Use fast models for background operations
- Reserve expensive models for direct chat

**Prerequisites:**

- At least two connection profiles must exist
- Must have an API key for the cheap provider

### Image Description Settings

Configure which service generates automatic descriptions for images in chats.

**Setting Options:**

- **Image Description Provider** — Select which profile to use:
  - Choose from available connection profiles
  - Or disable image descriptions entirely
  - Profiles may require specific provider support

**How to configure:**

1. Select a connection profile that supports vision/image analysis
2. This profile is used whenever an image needs a description
3. Descriptions appear automatically when images are shared

**What happens:**

- When an image is attached to a chat message, Quilltap automatically generates a description
- The description helps the AI understand the image context
- Descriptions are cached to save on API usage

**Prerequisites:**

- Connection profile must support image/vision capabilities
- Not all models support vision — check your profile settings

### Memory Cascade Settings

Controls how chat memory is managed, summarized, and stored over time.

**Setting Options:**

- **Memory Mode** — Choose how memory is handled:
  - **Full History** — Keep all messages in memory
  - **Sliding Window** — Keep only recent messages
  - **Summarization** — Summarize old messages to preserve context
  - **Hybrid** — Combination of summarization and recent messages

- **Retention Settings:**
  - **Keep Recent Messages** — How many recent messages to always remember
  - **Summarization Threshold** — When to start summarizing old messages
  - **Summary Length** — How detailed summaries should be

- **Cascade Behavior:**
  - **Character Memory** — How memory affects character knowledge
  - **Chat Memory** — How memory affects individual chat history
  - **Search Behavior** — How memory affects semantic search

**How to configure:**

1. Select a memory mode based on your needs
2. Adjust thresholds for when summarization occurs
3. Settings apply to all new chats created after changing

**When to use each mode:**

- **Full History** — Short, focused conversations
- **Sliding Window** — Medium-length chats with varied topics
- **Summarization** — Long-running, complex conversations
- **Hybrid** — Best for most use cases

**Prerequisites:**

- Embedding profiles may be required for semantic memory operations
- Memory cascade requires embedding search to be functional

### Context Compression Settings

Optimizes how conversation context is managed for efficiency.

**Setting Options:**

- **Enable Compression** — Toggle context compression on/off
- **Compression Method:**
  - **Simple** — Basic token counting
  - **Intelligent** — Learns which parts of context matter
  - **Aggressive** — Removes more context for cost savings

- **Compression Threshold** — When to start compressing context:
  - Token limit before compression starts
  - Prevents token limit overages
  - Helps manage API costs

**How to configure:**

1. Enable compression if dealing with long conversations
2. Choose compression method (Intelligent is usually best)
3. Set threshold based on your model's token limits
4. Monitor token usage to optimize

### Token Display Settings

Controls whether token counts are shown in the UI.

**Setting Options:**

- **Show Token Counts** — Toggle token display on/off
- **Show in Messages** — Display tokens per message
- **Show Totals** — Display total tokens for entire chat
- **Detailed Breakdown** — Show input/output token split

**How to configure:**

1. Enable token display to see usage
2. Choose what level of detail to show
3. Helpful for monitoring API costs
4. Can be toggled per chat if enabled globally

**When useful:**

- Monitoring API usage and costs
- Debugging token limit issues
- Optimizing prompts for efficiency

### LLM Logging Settings

Controls whether interactions with AI providers are logged and stored.

**Setting Options:**

- **Enable LLM Logging** — Toggle logging on/off
- **Log Level:**
  - **Full** — Log complete interactions
  - **Summary** — Log only key information
  - **Minimal** — Log only errors and usage stats

- **Retention:**
  - **Keep logs for** — How long logs are stored (7 days, 30 days, forever)
  - **Auto-cleanup** — Automatically delete old logs

**How to configure:**

1. Enable logging to track all LLM interactions
2. Choose log level based on your needs
3. Set retention policy for storage

**When useful:**

- Debugging conversation issues
- Auditing AI behavior
- Analyzing token usage patterns
- Troubleshooting provider problems

**Privacy Note:** Logs contain your chat content. Keep retention period reasonable if privacy is a concern.

### Story Backgrounds Settings

Configure AI-generated atmospheric background images for your chats.

**Setting Options:**

- **Enable Story Backgrounds** — Toggle automatic background generation on/off
- **Image Generation Profile** — Select which image profile to use for generating backgrounds:
  - Choose from available image generation profiles
  - If not set, uses the character's image profile or your default profile

**How it works:**

1. When enabled, Quilltap generates a landscape scene image after each chat title update
2. The scene features your characters based on their physical descriptions
3. The chat title provides context for the scene (e.g., "Sunset conversation on the beach")
4. Generated images appear as subtle backgrounds (30% opacity) behind chat content

**Benefits:**

- Creates immersive visual context for roleplay and storytelling
- Backgrounds automatically update as the story progresses
- Preserves readability with semi-transparent overlay

**Prerequisites:**

- At least one image generation profile configured
- Valid API key for your image provider
- Characters with physical descriptions produce better results

**Learn more:** See [Story Backgrounds](story-backgrounds.md) for detailed information.

### Automation Settings

Controls automatic behavior during chat interactions.

**Setting Options:**

- **Auto-Detect RNG Calls** — Automatically detect and execute dice rolls, coin flips, and "spin the bottle" commands in both your messages and character responses:
  - **Dice notation**: Patterns like "2d6", "d20", "3d10" are detected and rolled automatically
  - **Coin flips**: Phrases like "flip a coin" trigger automatic coin flips
  - **Spin the bottle**: Phrases like "spin the bottle" randomly select a chat participant

**How it works:**

1. When enabled (default), Quilltap scans both your messages and character responses for RNG patterns
2. For your messages: patterns are executed before sending, results appear before your message
3. For character responses: patterns are executed after the response, results appear after
4. Results appear as tool messages in the chat, visible to all participants

**Why this is useful:**

- When a character says "I roll a d20 to attack", the dice actually get rolled
- Creates immersive tabletop RPG experiences where dice mentions become real rolls
- Both you and the AI can trigger random events naturally through conversation

**When to disable:**

- When discussing dice or probability without wanting actual rolls
- When you prefer to use the manual RNG tool in the tool palette
- When writing content that mentions dice notation without wanting it executed

**Example patterns detected:**

- "I roll 2d6 for damage" → Executes 2d6 roll
- "Let's flip a coin" → Executes coin flip
- "Spin the bottle to see who goes next" → Randomly selects a participant
- Character: *"I roll a d20"* → Executes d20 roll after the response

### Timestamp Injection & Timezone

Controls whether Quilltap injects the current date and time into the system prompt sent to the LLM, so the character knows what time it is — rather like winding a pocket watch before a conversation.

**Timestamp Mode:**

- **Disabled** — No timestamp is injected
- **Conversation Start** — Include the time only in the initial system prompt
- **Every Message** — Update the timestamp with each message sent

**Timestamp Format:**

- **Friendly** — Human-readable (e.g., "February 22, 2026 at 2:30 PM")
- **ISO 8601** — Machine-readable with timezone offset (e.g., "2026-02-22T14:30:00-05:00")
- **Date Only** — Just the date, no time
- **Time Only** — Just the time, no date
- **Custom** — Use your own format string with date-fns tokens

**Timezone:**

By default, Quilltap shows timestamps in the server's timezone — which, if you're running in Docker, Lima, or WSL2, is quite likely to be UTC. This is rather like a clock permanently set to Greenwich Mean Time while you're sipping cocktails in New York.

To remedy this situation:

1. **Automatic detection (Electron app):** The desktop app detects your operating system's timezone and passes it through to the server automatically. No action required on your part.
2. **Per-chat override:** In the timestamp configuration for any chat, set a specific timezone from the searchable list.
3. **Salon-level default:** In Chat Settings, set a default timezone that applies to all timestamp formatting.
4. **Docker users:** Set the `QUILLTAP_TIMEZONE` environment variable when starting the container:
   ```
   docker run -e QUILLTAP_TIMEZONE=America/New_York ...
   ```

The timezone resolution follows a courteous chain of precedence: per-chat setting wins, then the Salon default, then the `QUILLTAP_TIMEZONE` environment variable, and finally the server's system timezone.

**Fictional Time:**

For those engaged in period dramas or interstellar adventures, toggle "Use fictional time" to inject a made-up timestamp that advances in real time from a base you specify. The timezone setting still applies to how the fictional time is formatted.

## Saving Chat Settings

Most settings save automatically as you make changes. You'll see:

- **Checkmark icon** — Setting was saved
- **Loading spinner** — Setting is being saved
- **Error message** — Setting failed to save (try again)

## Common Chat Setting Workflows

### Optimizing for Cost

1. **Enable Cheap LLM** — Use a cheaper model for background work
2. **Set Context Compression** — Reduce token usage
3. **Enable Token Display** — Monitor your usage
4. **Review LLM Logs** — See where tokens are being used

### Optimizing for Quality

1. **Disable Memory Summarization** — Keep full conversation history
2. **Disable Context Compression** — Don't remove context
3. **Use high-quality profile** — In Connection Profiles
4. **Increase token limits** — Allow longer responses

### Long-Running Character Development

1. **Enable Memory Cascade** — Preserve context over time
2. **Set Summarization** — Summarize old memories
3. **Configure Cheap LLM** — For memory operations
4. **Enable LLM Logging** — Track development progress

### Privacy-Focused Setup

1. **Disable LLM Logging** — Or set minimal retention
2. **Use local LLM** — If using Ollama (no cloud)
3. **Manage Memory Cascade** — Control what's stored
4. **Review API provider** — Choose privacy-respecting options

## Troubleshooting Chat Settings

### Settings won't save

**Solution:**

- Check your internet connection
- Try refreshing the page
- Look for error message explaining the issue
- Contact support if problem persists

### Token counts seem wrong

**Solution:**

- Token counting varies by model
- Some providers round differently
- This is normal and expected
- Check provider's documentation for exact counting method

### Memory cascade isn't working

**Solution:**

- Verify embedding profiles are configured
- Check that memory cascade is enabled
- Ensure sufficient embeddings vocabulary
- May require restart of chat

### Cheap LLM not being used

**Solution:**

- Verify cheap LLM is enabled
- Check that profile exists and is valid
- Only certain operations use cheap profile
- Chat messages always use main profile

### Image descriptions missing

**Solution:**

- Verify image description provider is configured
- Check that profile supports vision/images
- Some providers don't support vision
- Try updating to a newer model that supports vision

## In-Chat Settings Access

Characters with help tools enabled can read your current chat settings during a conversation using the `help_settings` tool with `category: "chat"`. This returns your token display, context compression, memory cascade, timestamp, agent mode, dangerous content, automation, and LLM logging settings. Simply ask a help-tools-enabled character something like "What are my chat settings?" and it will look them up for you.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=chat")`

## Related Settings

- [Connection Profiles](connection-profiles.md) — Choose which LLM to use
- [API Keys](api-keys-settings.md) — Store credentials for providers
- [Image Generation Profiles](image-generation-profiles.md) — Configure image generation (separate from descriptions)
- [Embedding Profiles](embedding-profiles.md) — Required for memory cascade and semantic search
- [Appearance Settings](appearance-settings.md) — Control chat UI appearance (separate from behavior)
- [Story Backgrounds](story-backgrounds.md) — AI-generated atmospheric backgrounds for chats
