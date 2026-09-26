---
url: /settings?tab=chat
---

# Chat Settings

> **[Open this page in Quilltap](/settings?tab=chat)**

Chat Settings control global behavior for all your chats in Quilltap, including how conversations look, how they're stored, and which services are used for special features.

The page is a long gallery of cards, and its guidebook has been bound in three volumes so that no single one grows too heavy to carry:

- **This volume** — getting there, what "global" means, and the house-wide odds and ends: avatars, automation, timestamps, data retention, and the Taboo list
- **[The Composer and Your Typing](chat-settings-composer.md)** — composition mode, the composer's emoji and symbol shortcuts, impersonated lines, auto-scroll, text replacement, and smart typography
- **[The Staff Behind the Scenes](chat-settings-ai-services.md)** — the cheap LLM, image description, memory cascade, context compression, token display, LLM logging, story backgrounds, and per-conversation avatars

## Accessing Chat Settings

1. Click **Settings** (gear icon) in the left sidebar
2. Click the **Chat Settings** tab
3. You'll see multiple setting cards for different aspects of chat behavior

## Global vs. Per-Chat

The Chat Settings page is where you set *defaults* — the standing instructions that apply to every chat unless one of them politely asks to do otherwise. The per-chat overrides (Image Provider, Announce Generated Images, Auto-generate Avatars, Roleplay Template, Project, Agent Mode, and the like) used to live in a Chat Settings modal, but now hold court in the **Chat** drawer of the right-hand **Chat Sidebar** inside any open conversation. See [Chat Sidebar](chat-participants.md) for the full tour of that cabinet.

## Understanding Chat Settings Sections

The composer's cards are described in [The Composer and Your Typing](chat-settings-composer.md), and the cards that engage a model or keep the books are in [The Staff Behind the Scenes](chat-settings-ai-services.md). The remainder follow.

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
- When you prefer to use the manual RNG tool via **Run Tool…** in the Chat Sidebar's Chat drawer
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
- **Every X Minutes** — The Host announces the time only when at least the configured number of minutes (defaulting to fifteen, like a stationmaster glancing at his pocket watch each quarter-hour) have elapsed since the last announcement. The first message of a conversation always receives an announcement.

**Timestamp Format:**

- **Friendly** — Human-readable (e.g., "February 22, 2026 at 2:30 PM")
- **ISO 8601** — Machine-readable with timezone offset (e.g., "2026-02-22T14:30:00-05:00")
- **Date Only** — Just the date, no time
- **Time Only** — Just the time, no date
- **Custom** — Use your own format string with date-fns tokens

**Timezone:**

By default, Quilltap shows timestamps in the server's timezone — which, if you're running in Docker, is quite likely to be UTC. This is rather like a clock permanently set to Greenwich Mean Time while you're sipping cocktails in New York.

To remedy this situation:

1. **Automatic detection (Electron app):** The desktop app detects your operating system's timezone and passes it through to the server automatically. No action required on your part.
2. **Per-chat override:** In the timestamp configuration for any chat, set a specific timezone from the searchable list.
3. **Salon-level default:** In Chat Settings, set a default timezone that applies to all timestamp formatting.
4. **Docker users:** Set the `QUILLTAP_TIMEZONE` environment variable when starting the container:
   ```
   docker run -e QUILLTAP_TIMEZONE=America/New_York ...
   ```
   The container obligingly winds its own clock to match, so the one variable settles the whole household.

The timezone resolution follows a courteous chain of precedence: per-chat setting wins, then the Salon default, then the `QUILLTAP_TIMEZONE` environment variable, and finally the server's system timezone.

A word on why the container's own clock matters, and not merely the formatting: some of the establishment's business consults the wall clock directly rather than asking how to phrase things. Rooms that wake on a schedule, the daily token allowance that turns over at midnight, and the Commonplace Book's notion of what counts as "today" all take their cue from the server's hour. Set the timezone in the Salon alone and your timestamps will read handsomely while a room scheduled for seven in the morning rings at two — a discrepancy that has ruined many a well-planned breakfast. The environment variable sets both at once and spares you the arithmetic.

**Fictional Time:**

For those engaged in period dramas or interstellar adventures, toggle "Use fictional time" to inject a made-up timestamp that advances in real time from a base you specify. The timezone setting still applies to how the fictional time is formatted.

The base timestamp is read as a clock face in the chat's own timezone — set 10:15 for a tale in Constantinople and your characters will be told it is a quarter past ten there, regardless of what hour it happens to be in the room where the server sits. From that moment the fictional clock keeps step with the real one, minute for minute: an hour of your conversation is an hour of theirs. The clock is wound when the chat is created, so a chat begun this morning and resumed this evening will find that the afternoon has passed in the story as surely as it did outside your window.

A caution for the impatient: because the fictional clock is anchored at the chat's creation, it cannot be re-wound afterwards. Should you wish to begin a tale at a different hour, begin a new chat.

### Data Retention

Sets how many days a chat may sit with nobody actually speaking in it (Staff announcements don't count) before Quilltap's nightly housekeeping tidies away its regenerable working data — compression caches, pre-rendered pages, model scratch-work, and superseded generated images. The conversation itself is never touched, and semantic-search embeddings are always kept warm regardless of this window.

- **Keep inactive chats' working data for N days** — 1 to 3650; the default is 30. Global only — no per-chat dial.

Full particulars, including what precisely is and isn't tidied: [Data Retention](data-retention.md).

### Taboo

A standing list of phrases nobody in the house is to utter — the stock verbal tics of the age, the borrowed cleverness that arrives already exhausted. Every character receives the list as part of their standing instructions, with orders to avoid each entry not merely word for word but in all its inflections, rewordings, and near-variants, and to say the plain thing instead. They are likewise forbidden to mention the list, which spares you characters remarking archly upon what they've been told not to say.

- **Add a phrase** — one at a time; commas belong inside a phrase, so they cannot serve as separators
- **Remove a phrase** — the small × beside it
- Up to 500 phrases, each up to 200 characters. Duplicates are quietly discarded regardless of capitalisation; your ordering is left exactly as you arranged it

The list is instance-wide — one register for the whole establishment, no per-character or per-chat exceptions. An empty list adds nothing whatever to any prompt.

Full particulars: [Taboo](taboo.md).

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

Trouble with the cheap LLM, memory cascade, token counts, or image descriptions is taken up in [The Staff Behind the Scenes](chat-settings-ai-services.md#troubleshooting).

## In-Chat Settings Access

Characters with help tools enabled can read your current chat settings during a conversation using the `help_settings` tool with `category: "chat"`. This returns your token display, context compression, memory cascade, timestamp, agent mode, automation, and LLM logging settings. The Concierge's settings have a category of their own, `category: "concierge"` --- see [The Concierge](the-concierge.md). Simply ask a help-tools-enabled character something like "What are my chat settings?" and it will look them up for you.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=chat")`

## Related Settings

- [The Composer and Your Typing](chat-settings-composer.md) — Composer shortcuts, text replacement, and smart typography
- [The Staff Behind the Scenes](chat-settings-ai-services.md) — Cheap LLM, image description, memory, compression, and logging
- [Connection Profiles](connection-profiles.md) — Choose which LLM to use
- [API Keys](api-keys-settings.md) — Store credentials for providers
- [Image Generation Profiles](image-generation-profiles.md) — Configure image generation (separate from descriptions)
- [Embedding Profiles](embedding-profiles.md) — Required for memory cascade and semantic search
- [Appearance Settings](appearance-settings.md) — Control chat UI appearance (separate from behavior)
- [Story Backgrounds](story-backgrounds.md) — AI-generated atmospheric backgrounds for chats
