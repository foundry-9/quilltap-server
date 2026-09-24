---
url: /settings?tab=chat&section=context-compression
---

# Chat Settings — The Staff Behind the Scenes

> **[Open this page in Quilltap](/settings?tab=chat&section=context-compression)**

A good house runs on staff one seldom sees. These are the Chat Settings that govern them: the thrifty understudy who handles the errands, the describer who looks at your pictures, the archivist who minds the memories when a message is struck out, the clerk who trims a long conversation down to size, and the bookkeepers who count tokens and keep the logs. The rest of the page is described in [Chat Settings](chat-settings.md) and [The Composer and Your Typing](chat-settings-composer.md).

## Cheap LLM Configuration

Configure a fallback LLM for lower-cost operations. Quilltap can use a cheaper model for certain operations, reserving your main profile for complex tasks.

**Setting Options:**

- **Enable Cheap LLM** — Toggle this feature on/off
- **Cheap LLM Profile** — Select which connection profile to use for cheaper operations
- **Operations** — Controls which operations use the cheap profile:
  - Summary generation
  - Memory indexing
  - Title generation for chats
  - Other low-complexity tasks

Image description is *not* among them, though it is thrifty by disposition: it never consults this setting, and instead prefers a profile marked **Cheap** when it has to choose a describer for itself. Name a profile in [Image Description Settings](#image-description-settings) and that choice governs, cheap or dear.

**How to configure:**

1. Click **Enable Cheap LLM**
2. Choose a connection profile from the dropdown (must be created in Connection Profiles tab)
3. The selected profile is used for cost-saving operations
4. Your main profile is used for actual chat interactions

**Allow a Similar-Tier Stand-In**

Background work goes wrong quietly. A cheap route that stops answering takes your
chat titles, memory extraction and summaries down with it, and says nothing about
it in the Salon.

When a cheap task runs through a connection profile, that profile's own
**Fallback** arrangement applies — see
[Connection Profiles](connection-profiles.md#the-understudies-fallback). But
some cheap routes have no profile behind them at all: a local model picked up
directly, or a cheapest-available route Quilltap assembled on the spot. There is
nothing there to hang an understudy on.

Tick **Allow a Similar-Tier Stand-In** and those routes may have one drafted
from your profiles marked *Cheap*. One attempt, and one only. Off by default,
since a drafted stand-in may spend money where a local model spent none.

**Benefits:**

- Save on API costs
- Use fast models for background operations
- Reserve expensive models for direct chat

**Prerequisites:**

- At least two connection profiles must exist
- Must have an API key for the cheap provider

## Image Description Settings

Not every model has eyes. When you attach a photograph to a conversation whose model cannot see — an Ollama text model, an OpenRouter profile pointed at something wordy but sightless — Quilltap does not simply shrug and drop the picture on the floor. It engages a second model, one that *can* see, to **describe** the image in prose, and hands that description to your correspondent in the picture's place. The conversation proceeds as though you had described the thing yourself, at length, without once being asked to.

These settings govern which model is called upon to do the describing.

**When this happens at all:** only when the profile answering the message has its **Supports image attachments (vision input)** checkbox *unticked* (see [Connection Profiles](connection-profiles.md)). A profile with the box ticked receives the image itself and no describer is troubled. That checkbox — not the provider's name on the door — is the whole of how Quilltap decides who can see.

**Setting Options:**

- **Primary image description profile** — the model that describes your images. Only profiles with the vision checkbox ticked appear in the list. Leaving it on **Auto-select vision-capable profile** does *not* disable descriptions; it lets Quilltap choose for you, preferring a profile you have marked **Cheap** and otherwise taking the first sighted profile it finds. Since the choice is then somewhat arbitrary, naming one explicitly is the wiser course.
- **Uncensored fallback profile** — optional, and consulted only when the primary refuses the commission or returns something unusable. A more permissive model is the usual choice: a local Ollama LLaVA variant, an uncensored model by way of OpenRouter. Left blank, there is no second attempt, and a refusal stands as a refusal. Unlike the primary, this one is **never** auto-selected; if you have not named it, it does not exist.

**How to configure:**

1. Tick **Supports image attachments (vision input)** on at least one connection profile whose model can actually read pictures — otherwise both dropdowns will be empty.
2. Select that profile as your **primary**. Small, quick, inexpensive models do this job admirably: `gpt-4o-mini`, `claude-haiku-4-5`, `gemini-2.0-flash`. Reasoning models are a poor fit — slow, dear, and inclined to spend their whole allowance thinking rather than answering.
3. Optionally name an **uncensored fallback**, if your chats venture where a well-mannered describer will decline to follow.

**What happens:**

- For portraits and scenes conjured by the establishment's own hand — a character's avatar, a story backdrop, an image summoned by the tools — no describer is troubled at all: the very prompt that painted the picture is kept on file and read back verbatim, instantly and without charge. The same courtesy extends to any uploaded image that already carries a description on its file record.
- Failing that, the primary profile is sent the image with an instruction to describe it in thorough detail — every visible element, colour, composition, mood, and scrap of text.
- The resulting description is inserted into the message as plain words, plainly labelled as an AI's description of an attachment. Your correspondent reads about the picture; it does not see it.
- Should the primary refuse — or return an empty answer, or something so terse and hedged that it reads as a refusal ("I cannot…", "unable to…") — the uncensored fallback, if you have named one, is given its turn. If both decline, the message explains as much rather than pretending the attachment never arrived.
- Every consultation is entered in the LLM logs as an **IMAGE_DESCRIPTION** call, so its cost, its latency, and its refusals are all a matter of record.
- Should a describer prove sluggish, the consultation is abandoned after a minute so a single slow portrait can never hold your correspondent's reply hostage.
- **The describer's word is checked before it is believed.** A gateway that fronts hundreds of models — NanoGPT, OpenRouter and their kind — may accept your picture with every appearance of politeness and route it to a model that quietly disregards it. The model, asked to describe an image it was never shown, will describe *an* image: fluently, at length, in tidy sections, and entirely out of its own head. Quilltap now examines the bill. A consultation charged for the instruction alone did not look at your picture, whatever prose came back, and the answer is discarded unread rather than filed. So too when the provider itself reports the attachment as never sent. In either case the failure names the offending profile and the fallbacks take their turn as they would after any other refusal.

**Elsewhere in the house:** the primary profile is also the model consulted by the wardrobe's image analyser (see [Wardrobe](wardrobe.md)) and Aurora's *Describe from image* step. Those features prefer a *more* capable model when left to choose for themselves, on the reasoning that reading a garment's cut from a photograph is finer work than summarising a snapshot.

**Prerequisites:**

- At least one connection profile with **Supports image attachments (vision input)** ticked, and a working API key for it
- The describing model must genuinely accept images. Ticking the box on a model that cannot see is now caught rather than believed — the consultation fails by name and passes to the fallbacks — but it still costs you a wasted call, so tick it only where it is true

## Memory Cascade Settings

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

## Context Compression Settings

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

**How it works:**

Context compression applies only to **conversation history** — the message log that accumulates as you chat. Each character's system prompt (their identity, personality, and instructions) is never compressed, ensuring characters always maintain their distinct voice and personality.

In multi-character chats, each character maintains their own compression cache. This is necessary because different characters may have different views of the conversation — a character who joined late only sees messages after their arrival, whispers are filtered per-recipient, and absent characters don't see messages that occurred while they were away.

**Two clocks, and why:**

Compression is ordinarily done in the quiet after a turn has already been delivered, so that a tidy history is waiting when you next press send. Nobody is standing about while that happens, and it is allowed a generous interval to finish in — long conversations make for long prompts, and a compression that runs slowly is not a compression that has gone wrong.

Occasionally there is no result waiting: you have sent two messages in quick succession, or the conversation has grown since the last pass. Quilltap then compresses on the spot, and here you *are* standing about, so the interval is deliberately the shorter one. If it runs out, the turn simply goes out with its history uncompressed and a note to that effect in the warnings — which costs tokens, but costs them promptly.

The same principle governs everything the cheap LLM is asked to do: the interval follows whoever is waiting on it. Work done in the quiet after a turn — memory extraction, the scene tracker, titling — is given a long rope, since a slow pass there costs nobody anything and a short rope turns it into a lost one. Work done while a turn is assembling, such as the memory recap and its compressions, keeps the shorter interval, and forgoes the second attempt a background pass would be granted. The background intervals were widened considerably after it emerged that they had been set inside the range of ordinary healthy work.

**How to configure:**

1. Enable compression if dealing with long conversations
2. Choose compression method (Intelligent is usually best)
3. Set threshold based on your model's token limits
4. Monitor token usage to optimize

## Token Display Settings

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

## LLM Logging Settings

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

## Story Backgrounds Settings

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

## Per-Conversation Avatar Generation

Controls whether Quilltap generates unique AI portraits for each character in a chat. When enabled, character avatars are created automatically based on their physical descriptions and current outfits, giving each conversation its own visual identity — rather like commissioning a portrait painter for every new gathering.

**Setting Options:**

- **Enable Avatar Generation** — Toggle per-conversation avatar generation on or off. Available both when creating a new chat and (as **Auto-generate Character Avatars**) in the Chat Sidebar's **Chat** drawer during active conversations.
- **Regenerate Avatar** — In the Chat Sidebar's **Participants** drawer, click the refresh button on any character's portrait to commission a fresh sitting when the muse has failed to capture the right likeness. The new picture *replaces* the one filed for the ensemble the character is presently wearing, and it is the one brought out whenever they wear those clothes again; the last drawn is the one that stands. The character's own standing portrait, worn everywhere outside this conversation, is a separate commission and is not disturbed.

**How it works:**

1. When enabled on chat creation, avatars are generated for all LLM-controlled characters as soon as the chat begins
2. When toggled on during an active chat, generation is queued for all LLM characters
3. Avatars update automatically when outfit changes occur (if enabled)
4. Each portrait is filed against the exact ensemble that occasioned it. Should the character wear that same costume again — five minutes later or five weeks — the picture already taken is brought out of the cabinet rather than a fresh plate exposed, which costs you no time and not a farthing of your image budget. Alter so much as a scarf and that is a new ensemble, deserving of a new sitting
5. Generated avatars appear in the Chat Sidebar's **Participants** drawer and are specific to that conversation

**Prerequisites:**

- At least one image generation profile configured
- Characters with physical descriptions produce significantly better results
- The wardrobe system enhances avatar accuracy — equipped outfits are included in the generation prompt

## Troubleshooting

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

### Image descriptions missing, refused, or wrong

**Solution:**

- Confirm at least one connection profile has **Supports image attachments (vision input)** ticked — with none, the describer dropdowns are empty and no description can be produced
- Confirm that profile's model can genuinely read images; a ticked box on a sightless model yields an empty answer, which Quilltap reports rather than passes off as a description
- If the description reads like a polite refusal, name an **uncensored fallback profile** — without one, a refusal is final
- If descriptions appear for uploads but a Quilltap-generated image seems described oddly, remember that generated images are described by the prompt that painted them rather than by any describer
- If nothing appears and no error does either, check the LLM logs for an **IMAGE_DESCRIPTION** entry: a minute-long call that ends in a timeout means the describing model is too slow for inline duty
- Reasoning models (`o1`, `o3`, `gpt-5`, and kin) make poor describers — they spend their tokens thinking. Prefer `gpt-4o-mini`, `claude-haiku-4-5`, or `gemini-2.0-flash`

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=chat&section=context-compression")`

## Related Settings

- [Chat Settings](chat-settings.md) — The rest of the chat-wide defaults
- [The Composer and Your Typing](chat-settings-composer.md) — Composer shortcuts, text replacement, and smart typography
- [Connection Profiles](connection-profiles.md) — The profiles the cheap LLM and the describer are chosen from
- [Embedding Profiles](embedding-profiles.md) — Required for memory cascade and semantic search
- [Image Generation Profiles](image-generation-profiles.md) — Configure image generation (separate from descriptions)
- [Story Backgrounds](story-backgrounds.md) — AI-generated atmospheric backgrounds for chats
