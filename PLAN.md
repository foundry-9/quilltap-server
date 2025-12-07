# Implementation Plan: SillyTavern Multi-Character Chat Import

## Overview

This feature implements a sophisticated import system for SillyTavern multi-character chats with:
1. File parsing to extract unique speakers (characters and personas)
2. A mapping interface to match speakers to existing entities or create new ones
3. Post-import memory creation prompt
4. Automatic title generation via the rename system

## Architecture

### Phase 1: Enhanced Import Dialog Component

**File**: `app/(authenticated)/chats/page.tsx`

Replace the simple import dialog with a multi-step wizard:

1. **Step 1: File Selection** - User selects JSONL/JSON file
2. **Step 2: File Analysis** - Parse file and extract unique speakers
3. **Step 3: Speaker Mapping** - Map each speaker to character/persona (or create new)
4. **Step 4: Connection Profile Selection** - Select profile for AI characters
5. **Step 5: Import Confirmation** - Review and import
6. **Step 6: Post-Import Actions** - Offer memory creation and title generation

### Phase 2: Utility Functions

**New File**: `lib/sillytavern/multi-char-parser.ts`

```typescript
interface ParsedSpeaker {
  name: string
  isUser: boolean  // is_user field from messages
  avatarPath?: string  // force_avatar or original_avatar
  messageCount: number
}

interface ParseResult {
  speakers: ParsedSpeaker[]
  messages: STMessage[]
  metadata: STChatMetadata
}
```

Functions:
- `parseSTFile(content: string): ParseResult` - Parse file and extract speakers
- `extractUniqueSpeakers(messages: STMessage[]): ParsedSpeaker[]` - Get unique speakers

### Phase 3: Speaker Mapping Types

**New Types** in `lib/sillytavern/multi-char-parser.ts`:

```typescript
interface SpeakerMapping {
  speakerName: string
  isUser: boolean
  mappingType: 'existing_character' | 'existing_persona' | 'create_character' | 'create_persona'
  entityId?: string  // For existing entities
  entityName?: string  // For display / new entity creation
  connectionProfileId?: string  // Required for characters
}

interface ImportMapping {
  mappings: SpeakerMapping[]
  defaultConnectionProfileId: string
}
```

### Phase 4: Enhanced Import API

**Modify**: `app/api/chats/import/route.ts`

Accept new payload format:
```typescript
{
  chatData: STChat
  mappings: SpeakerMapping[]
  defaultConnectionProfileId: string
  triggerMemoryCreation?: boolean
  triggerTitleGeneration?: boolean
}
```

New logic:
1. Process mappings - create new characters/personas as needed
2. Build participants array with correct entity IDs
3. Import messages with correct role attribution (based on speaker name)
4. Return created/mapped entities for memory creation

### Phase 5: Quick Create APIs

**New File**: `app/api/characters/quick-create/route.ts`
**New File**: `app/api/personas/quick-create/route.ts`

Minimal create endpoints for import:
- Characters: Just name (can add details later)
- Personas: Name and minimal description

### Phase 6: Post-Import Memory Creation

**New Component**: `components/import/memory-creation-dialog.tsx`

After successful import, offer to create memories:
- Show chat summary (first N messages)
- For each character in the chat, offer to create a memory
- For the persona, offer to create relationship memories

Uses existing memory service:
- `createMemoryWithEmbedding()` from `lib/memory/memory-service.ts`

### Phase 7: Title Generation Integration

After import, if triggerTitleGeneration is true:
- Use `generateContextSummary()` to create summary
- This automatically generates a title via `generateTitleFromSummary()`
- Or call `considerTitleUpdate()` directly

## File Changes Summary

### New Files
1. `lib/sillytavern/multi-char-parser.ts` - Parser utilities
2. `app/api/characters/quick-create/route.ts` - Quick character creation
3. `app/api/personas/quick-create/route.ts` - Quick persona creation
4. `components/import/import-wizard.tsx` - Multi-step import wizard component
5. `components/import/speaker-mapper.tsx` - Speaker mapping UI component
6. `components/import/memory-creation-dialog.tsx` - Post-import memory dialog

### Modified Files
1. `app/(authenticated)/chats/page.tsx` - Integrate new import wizard
2. `app/api/chats/import/route.ts` - Handle multi-character mappings
3. `lib/sillytavern/chat.ts` - Update to handle speaker-to-participant mapping

## UI/UX Design

### Import Wizard Steps

**Step 1: File Selection**
- File input for .json/.jsonl
- "Next" button

**Step 2: Analyzing...**
- Loading spinner while parsing
- Auto-advances to Step 3

**Step 3: Speaker Mapping**
For each speaker found:
```
+----------------------------------------------------------------+
| Speaker: "Charlie" (User - 45 messages)                        |
| +--------------------------------------------------------------+
| | O Map to existing persona: [Dropdown of personas]            |
| | O Create new persona named "Charlie"                         |
| | O Skip this speaker                                          |
| +--------------------------------------------------------------+
+----------------------------------------------------------------+
| Speaker: "Mirel" (AI - 89 messages)                            |
| +--------------------------------------------------------------+
| | O Map to existing character: [Dropdown]                      |
| |   Connection Profile: [Dropdown]                             |
| | O Create new character named "Mirel"                         |
| |   Connection Profile: [Dropdown] (required)                  |
| | O Skip this speaker (messages discarded)                     |
| +--------------------------------------------------------------+
+----------------------------------------------------------------+
```

**Step 4: Review & Import**
- Summary of mappings
- Import button
- Progress indicator

**Step 5: Post-Import**
- Success message with link to chat
- "Create memories from this chat?" button
- Title generated automatically in background

### Memory Creation Dialog
After import:
```
+----------------------------------------------------------------+
| Create Memories from Imported Chat                             |
+----------------------------------------------------------------+
| The chat has been imported. Would you like to create           |
| memories for the characters based on this conversation?        |
|                                                                 |
| Characters in this chat:                                        |
| [x] Mirel - Create memory about relationship with Charlie      |
| [x] Jeff - Create memory about pool party event                |
|                                                                 |
| Persona:                                                        |
| [x] Charlie - Create memory about events in this chat          |
|                                                                 |
| [Skip] [Create Memories]                                        |
+----------------------------------------------------------------+
```

## Implementation Order

1. **multi-char-parser.ts** - Core parsing logic (no UI needed)
2. **quick-create APIs** - Enable creating entities during import
3. **import/route.ts updates** - Handle new mapping format
4. **import-wizard.tsx** - Multi-step wizard component
5. **speaker-mapper.tsx** - Speaker mapping UI
6. **chats/page.tsx updates** - Integrate wizard
7. **memory-creation-dialog.tsx** - Post-import memory UI
8. **Title generation integration** - Hook into context-summary system

## Testing Considerations

- Test with single-character chats (backward compatibility)
- Test with multi-character chats (the sample file)
- Test with missing speakers (skip option)
- Test creating new characters vs mapping to existing
- Test memory creation with embedding service
- Test title generation with cheap LLM

## Logging

All operations should log via `logger`:
- File parsing progress
- Speaker extraction results
- Entity creation/mapping decisions
- Import progress
- Memory creation results
- Title generation results

## Data Flow

```
1. User selects file
   |
   v
2. parseSTFile() extracts speakers and messages
   |
   v
3. User maps speakers -> entities (existing or new)
   |
   v
4. API creates any new entities
   |
   v
5. API builds participants array from mappings
   |
   v
6. API imports messages with speaker->participant attribution
   |
   v
7. Chat created, user prompted for memory creation
   |
   v
8. (Optional) Memory service creates memories
   |
   v
9. Context summary generates title in background
```

## Message Attribution Logic

When importing messages:
1. Build a map of `speakerName -> participantId`
2. For each message:
   - Find the speaker in the map
   - If `is_user: true` -> role = 'USER'
   - If `is_user: false` -> role = 'ASSISTANT'
   - Set the message's participant reference

The existing system already handles `USER` and `ASSISTANT` roles. The multi-character support comes from the participants array having multiple CHARACTER entries.

## Key Insight: Message Role vs Participant

The role field (`USER`/`ASSISTANT`) indicates who generated the message:
- `USER` = human-generated (the persona)
- `ASSISTANT` = AI-generated (a character)

The participant linkage comes from the `participants` array on the chat metadata. Each character and persona in the chat gets a participant entry with their entity ID.

For display purposes, the speaker name from the original message can be preserved in `rawResponse` or a new field.
