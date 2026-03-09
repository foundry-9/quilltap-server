# Bug: Wrong participantId Saved on Chained Multi-Character Turns

## Status: Open

## Summary

In multi-character chats, messages are sometimes saved with the wrong `participantId`. The content is clearly from one character (e.g., Riya), but the database stores it under another character's participant ID (e.g., Lorian). The UI then correctly displays the wrong avatar/name because the stored data is wrong.

This may be a regression or incomplete fix from commit `69a9bcf6` ("fix: multi-char chat streaming shows wrong character avatar during chained turns").

## Evidence

### Chat Details
- Chat: most recent multi-character chat (4 participants: Friday, Lorian, Riya, Charlie)
- Observed: 2026-03-09

### Participant Mapping
| Participant ID | Character ID | Character Name | Provider |
|---|---|---|---|
| `c5e85874-1af0-4d51-a643-e22f5a90ba44` | `d9d0d998-...` | Friday | Gemini |
| `6ac13c67-979a-45ee-a0ba-f3ce1337a7e3` | `a42c02d7-...` | Lorian | OpenRouter (qwen3-235b) |
| `ef102cc1-c7fd-4d06-bfe7-6b5fcfcd5517` | `f11db2bc-...` | Riya | Grok |
| `14c7c9cd-26cf-44a1-b66b-1cb80313d7c2` | `57ecc095-...` | Charlie | User-controlled |

### Misattributed Messages
Two consecutive messages (rows 2 and 3 in recent history) are stored with **Lorian's** participantId (`6ac13c67-979a-45ee-a0ba-f3ce1337a7e3`) but contain **Riya's** content:

1. `44b60e9b-...` — "*Riya lets out a breathy laugh, fingers drumming a rapid rhythm on the desk as h...*" — saved as Lorian
2. `93a45587-...` — "*I blink once, slowly, as the error registers—the thread frayed mid-weave—and of...*" — saved as Lorian

The UI displayed Lorian's avatar and name over Riya's words, which is correct behavior given the bad data — the bug is in how the participantId was assigned at save time.

### Context
This happened during a chained turn sequence. It's possible that:
- The turn manager correctly selected Riya to speak
- The orchestrator streamed Riya's response
- But when saving, the `participantId` variable still held Lorian's ID from the previous turn

## Where to Investigate

1. **Orchestrator message save path** — `lib/services/chat-message/orchestrator.service.ts`: How does `participantId` get set for the saved message? Is it captured at turn-selection time or at save time?
2. **Turn manager** — `lib/chat/turn-manager.ts`: Does `selectNextSpeaker` correctly update the participant reference that the orchestrator uses?
3. **Chained turn flow** — When multiple characters speak in sequence (auto-trigger), does the participant ID get updated between iterations of the chain loop?
4. **Previous fix** — Commit `69a9bcf6`: What exactly did it fix, and does this represent a different code path?

## Related
- Commit `69a9bcf6`: "fix: multi-char chat streaming shows wrong character avatar during chained turns"
- Commit `d0390558`: "feat: server-side turn management for multi-character chats"
- Also observed in the same session: Friday (Gemini) emitting `submit_final_response` tool call as raw JSON in the UI instead of being processed — separate issue related to native tool call result surfacing
