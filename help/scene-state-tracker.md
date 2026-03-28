---
url: /settings?tab=chat
---

# Scene State Tracker

The Scene State Tracker is an invisible clerk who follows your conversations with the quiet diligence of a court stenographer, keeping meticulous notes on where everyone is, what they're doing, and whether anyone has changed into something more comfortable since the last act.

## How It Works

After every chat turn (or after a complete chain of responses in multi-character chats), the system dispatches a background task that reads the recent conversation and produces a structured snapshot of the current scene:

- **Location**: Where the scene is taking place
- **Characters**: For each character present:
  - What they are currently doing
  - Their current physical appearance
  - What they are currently wearing

This snapshot is stored on the chat and updated incrementally — each update carries forward unchanged details from the previous state, so characters don't mysteriously lose their clothing between turns (unless the narrative demands it).

## What It Powers

The scene state feeds into several systems:

- **The Lantern** (Story Backgrounds): When a fresh scene state exists, the Lantern uses it directly for scene context and character appearances instead of making separate LLM calls, resulting in faster and more consistent background generation.
- **Image Generation**: Character appearance resolution can skip its own LLM call when scene state already tracked what everyone looks like.
- **LLM Inspector**: Scene state tracking operations appear as `SCENE_STATE_TRACKING` entries, so you can see exactly what the system derived and how many tokens it cost.

## Requirements

- A configured **Cheap LLM** (the scene tracker uses the same lightweight model as memory extraction, title generation, and other background tasks)
- Characters in your chat (the tracker needs someone to track)

## Dangerous Content Handling

For chats classified as dangerous by the Concierge, the scene tracker automatically uses the uncensored LLM provider (if configured) to ensure accurate scene descriptions aren't refused by content filters.

## Performance

- Scene state tracking runs as a low-priority background job and never blocks your conversation
- Jobs are deduplicated: if a tracking job is already pending for a chat, new triggers reuse it rather than creating duplicates
- In multi-character chats, the tracker fires once after the entire response chain completes, not after each individual character's turn

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=chat")`

## Related Topics

- [Story Backgrounds](story-backgrounds.md)
- [Chat Settings](chat-settings.md)
- [Image Generation Profiles](image-generation-profiles.md)
