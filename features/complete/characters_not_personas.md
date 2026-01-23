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

## Additional Enhancements (Complete)

- ✅ Memories keyed to character **and the character they are interacting with**
  - `aboutCharacterId` field added to memory schema
  - Migration `add-inter-character-memory-fields-v1` updates legacy data
  - Repository methods: `findByCharacterAboutCharacter()`, `findByCharacterAboutCharacters()`
  - Context manager retrieves inter-character memories for multi-character chats
- ✅ All-LLM pause logic for chats where all characters are LLM-controlled
  - Pause thresholds at 3, 6, 12, 24, 48... turns (logarithmic doubling)
  - `AllLLMPauseModal` component with Continue/Stop/Take Over options
  - Auto-continue between LLM characters with cycle detection
  - Unit tests in `__tests__/unit/lib/chat/turn-manager.test.ts`
- ✅ When turning off impersonate on a user-controlled character, prompt for LLM profile
  - `SelectLLMProfileDialog` prompts user to select a connection profile
  - Backend API accepts `newConnectionProfileId` when stopping impersonation
  - Character automatically transitions to LLM control with selected profile

## Complete Removal of Personas (2026-01-15)

The persona system has been completely removed from the codebase. All personas have been permanently migrated to user-controlled characters. This represents the final step in the transition from the legacy persona system.

### What Was Removed

- **Persona API Endpoints**: All `/api/personas/*` routes have been removed
- **Persona Database Entity**: The `personas` collection is no longer used or supported
- **PERSONA Participant Type**: Chat participants no longer use the `PERSONA` type; they use `CHARACTER` type with `controlledBy: 'user'`
- **Persona Repository**: The persona database repository has been removed
- **Persona TypeScript Schema**: Type definitions for personas have been removed from the codebase
- **Persona Tests**: All persona-related unit and integration tests have been removed

### Migration Details

**Data Migration** (automatic on first load):
- All personas in user's database are converted to characters with `controlledBy: 'user'`
- The new character ID is the same as the original persona ID, preserving all references in chats and memories
- Personas are never re-created; the migration is one-way and permanent

**Backup Compatibility**:
- Old backup files containing `personas.json` are handled gracefully
- During restore, `personas.json` is skipped (it is optional in the backup manifest)
- Any `personaId` fields in restored data are cleared for backwards compatibility
- Any `personaLinks` arrays in restored character data are cleared

**Database State**:
- The `personas` collection is no longer accessed or updated
- Existing `personaId` fields in legacy data are ignored
- All persona references are mapped to their corresponding user-controlled characters

### Current User-Controlled Character Behavior

Users can now fully replace personas using the character system:

```typescript
// Create a user-controlled character (replacement for persona)
POST /api/v1/characters
{
  "name": "John",
  "controlledBy": "user",
  // ... other character fields
}

// Use in chat creation
POST /api/v1/chats
{
  "characterId": "some-npc-id",
  "userCharacterId": "john-char-uuid",  // User-controlled character
  "title": "Chat as John with NPC"
}

// Take over in multi-character chat
POST /api/v1/chats/[id]?action=impersonate
{
  "participantId": "participant-uuid"
}
```

### Documentation Updates

- API documentation (`docs/API.md`) has been updated to remove persona endpoint references
- The `sortByPersona` query parameter for connection profiles has been removed
- All examples now use characters with `controlledBy: 'user'` instead of personas
