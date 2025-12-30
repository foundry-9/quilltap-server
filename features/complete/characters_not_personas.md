# Feature request: convert personas into characters

Personas have some of the characteristics/attributes of characters. Let's combine them. Then a user can become any character at the start of a chat.

## Status: COMPLETE

This feature has been fully implemented across the codebase.

## Things that were done

- ✅ An auto-migration when this is fired up for the first time for each user, to take their personas and turn them into characters
  - Implemented in `plugins/dist/qtap-plugin-upgrade/migrations/migrate-personas-to-characters.ts`
  - The new character ID is the persona ID (preserves references)
- ✅ Starting up a chat, a user can automatically be any character they choose
  - Chat creation UI (`/chats/new`) shows "Play As" selector for user-controlled characters
  - Characters with `controlledBy: 'user'` replace the old PERSONA type
- ✅ Character Profiles tab has "User Acts As Character" option
  - Selecting this sets `controlledBy: 'user'` on the character
  - User-controlled characters don't need a connection profile
- ✅ A default connection profile for any character can be "User Acts As Character"
  - Added `controlledBy: 'llm' | 'user'` field to character schema
  - Characters can have `defaultPartnerId` pointing to a user-controlled character
- ✅ Chat creation and context building now use user-controlled characters instead of personas
  - `buildChatContext` in `lib/chat/initialize.ts` uses user character data
  - Template processing uses user character name for `{{user}}` variable
  - Context manager attributes messages to user-controlled characters
- ✅ Impersonation feature for multi-character chats
  - Already implemented via `impersonatingParticipantIds` on chat metadata
- ✅ Backwards compatibility maintained
  - PERSONA participant type kept for existing chats
  - API endpoints accept both old and new formats

## Remaining Future Enhancements (not blocking)

- Memories keyed to character **and the character they are interacting with**
  - Currently still tied to "User" for legacy data
- All-LLM pause logic for chats where all characters are LLM-controlled
  - Tracked via `allLLMPauseTurnCount` field (infrastructure exists)
- When turning off impersonate on a user-controlled character, prompt for LLM profile
  - Currently requires manual profile assignment
