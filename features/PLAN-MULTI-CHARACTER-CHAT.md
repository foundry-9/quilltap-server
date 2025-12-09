# Implementation Plan: Multi-Character Chat System

This plan covers the implementation of full multi-character chat support for Quilltap, enabling multiple AI characters to participate in conversations with turn-based dialogue management.

## Status Overview

| Component | Status |
|-----------|--------|
| Participants Array in Chat Schema | ✅ COMPLETE |
| Message participantId Field | ✅ COMPLETE (Phase 1) |
| Character talkativeness Field | ✅ COMPLETE (Phase 1) |
| Turn Selection Algorithm | ✅ COMPLETE (Phase 2) |
| Turn API Endpoint | ✅ COMPLETE (Phase 2) |
| Connection Profile Resolver | ✅ COMPLETE (Phase 1) |
| Participant Sidebar UI | ✅ COMPLETE (Phase 4) |
| Nudge/Queue System | ✅ COMPLETE (Phase 5) |
| EphemeralMessage Component | ✅ COMPLETE (Phase 5) |
| Continue Mode API | ✅ COMPLETE (Phase 5) |
| Add Character Dialog | ✅ COMPLETE (Phase 6) |
| Multi-Character Context Building | ✅ COMPLETE (Phase 3) |

---

## Overview of Changes

1. **Data Model Updates** - Add `participantId` to messages, `talkativeness` to characters
2. **Turn Management System** - Algorithm to determine who speaks next
3. **Participant Sidebar** - Right-side panel showing all participants with controls
4. **Nudge/Queue System** - Override turn order manually
5. **Add/Remove Characters** - Dialog to manage chat participants mid-chat
6. **Context Building** - Multi-character aware prompt construction
7. **Character LLM Fallback** - Use character's default LLM, with chat-level fallback

---

## Part 1: Data Model Updates

### 1.1 Add `participantId` to MessageEvent Schema

**File:** `lib/schemas/types.ts`

Update `MessageEventSchema` to include:

```typescript
participantId: UUIDSchema.nullable().optional(), // Which participant sent this message
```

- Required for ASSISTANT messages (which character spoke)
- Required for USER messages (which persona sent it)
- Null for SYSTEM and TOOL messages

### 1.2 Add `talkativeness` to Character Schema

**File:** `lib/schemas/types.ts`

Update `CharacterSchema` to include:

```typescript
talkativeness: z.number().min(0.1).max(1.0).default(0.5),
```

- Range: 0.1 to 1.0 in 0.1 increments
- Default: 0.5
- Higher values = more likely to speak when given the chance

### 1.3 Database Migration

**File:** `lib/mongodb/migrations/add-multi-character-fields.ts`

Migration steps:

1. Add `talkativeness: 0.5` to all existing characters that don't have it
2. Backfill `participantId` on existing messages:
   - For ASSISTANT messages: Set to the first CHARACTER participant's ID
   - For USER messages: Set to the first PERSONA participant's ID (if exists)
3. Verify all chats have a `participants` array (should already exist)

### 1.4 Make `connectionProfileId` Optional on ChatParticipant

**File:** `lib/schemas/types.ts`

Update `ChatParticipantSchema`:

- Remove the refinement requiring `connectionProfileId` for CHARACTER types
- Add logic to fall back to `character.defaultConnectionProfileId` at runtime

---

## Part 2: Turn Management System

### 2.1 Turn State Tracking

**File:** `lib/chat/turn-manager.ts` (new)

```typescript
interface TurnState {
  // Participants who have spoken since the user last spoke
  spokenSinceUserTurn: Set<string> // participantId[]

  // The participant whose turn it is (null = user's turn)
  currentTurnParticipantId: string | null

  // Manually queued participants (in order)
  queue: string[] // participantId[]

  // Last speaker (cannot speak again unless nudged/queued)
  lastSpeakerId: string | null
}
```

### 2.2 Turn Selection Algorithm

**File:** `lib/chat/turn-manager.ts`

```typescript
function selectNextSpeaker(
  participants: ChatParticipant[],
  characters: Map<string, Character>,
  turnState: TurnState,
  userParticipantId: string
): string | null
```

Algorithm:

1. If queue is not empty, pop and return first queued participant
2. If user hasn't spoken since all characters got a turn, return `null` (user's turn)
3. Filter out:
   - The last speaker (unless they're the only character)
   - Participants who have spoken since user's last turn
   - Inactive participants
4. If no eligible speakers remain, return `null` (user's turn, cycle complete)
5. For eligible speakers, calculate weighted random selection:
   - Base weight: `talkativeness` value (0.1 to 1.0)
   - Characters with talkativeness > 0.5 get proportionally higher weight
   - Characters with talkativeness < 0.5 get proportionally lower weight
6. Return the selected participant ID

### 2.3 Turn State Persistence

Turn state is **session-only** (not persisted to database):

- Stored in React state on the frontend
- Reset when user leaves/reloads the chat
- On reload, calculate initial state from recent message history

---

## Part 3: Participant Sidebar UI

### 3.1 Sidebar Component

**File:** `components/chat/ParticipantSidebar.tsx` (new)

Layout:

- Fixed position on right side of chat
- Width: ~280px
- Only visible when chat has 2+ participants (including user persona)
- Hidden when debug tools panel is open, reappears when closed
- Scrollable if many participants

### 3.2 Participant Card Component

**File:** `components/chat/ParticipantCard.tsx` (new)

For each participant, display:

- Avatar (40x40)
- Name
- Turn indicator icon (highlighted when it's their turn)
- **For Characters:**
  - Talkativeness slider (0.1-1.0, editable)
  - LLM backend dropdown (editable, shows character default if not overridden)
  - Nudge/Queue button (context-dependent label)
  - Remove button (with confirmation)
- **For User Persona:**
  - Talkativeness slider (greyed out, not applicable)
  - No LLM dropdown (personas don't use LLMs)
  - Queue button (to ensure user gets next turn)
  - No remove button (can't remove yourself)

### 3.3 Turn Indicator

Visual indicator showing whose turn it is:

- Glowing border or icon next to the active participant
- For user's turn: highlight the persona card + focus chat input

### 3.4 Queue Indicator

When participants are queued:

- Show queue position badge (1, 2, 3...) on their card
- Click queue button again to dequeue

---

## Part 4: Nudge/Queue System

### 4.1 Nudge Action

When a character is nudged (and it's not currently generating):

1. Display ephemeral system message: "*[Character Name] was asked to speak*" (styled, italic, gray)
2. Set that character as next speaker
3. Immediately trigger their response generation
4. Ephemeral message is not saved to database (disappears on reload)

### 4.2 Queue Action

When a character is queued (while another is generating or it's not their turn):

1. Add to the queue array in turn state
2. Show queue position on their participant card
3. When current speaker finishes, pop queue and that participant goes next

### 4.3 Dequeue Action

Click queue button on already-queued participant:

1. Remove from queue array
2. Remove queue position badge
3. They return to normal turn selection pool

### 4.4 Ephemeral System Messages

**File:** `components/chat/EphemeralMessage.tsx` (new)

- Styled differently from normal messages (gray, italic, smaller)
- Stored in React state only, not sent to API
- Types:
  - Nudge notification: "*[Name] was asked to speak*"
  - Join notification (optional): "*[Name] has joined the conversation*"

---

## Part 5: Add/Remove Character Dialog

### 5.1 Add Character Dialog

**File:** `components/chat/AddCharacterDialog.tsx` (new)

Triggered from: Participant sidebar "+" button

Dialog contents:

- Character picker (searchable list of user's characters)
- Checkbox: "Include chat history in context" (default: unchecked)
- Optional text field: "How did they join?" (scenario snippet)
  - Placeholder: "e.g., They walked up and joined the group..."
  - This gets prepended to the character's context for this chat
- Confirm/Cancel buttons

On confirm:

1. Create new `ChatParticipant` entry
2. Store `hasHistoryAccess: boolean` on participant
3. Store `joinScenario: string | null` on participant
4. Add to chat's participants array
5. Optionally show ephemeral join message

### 5.2 Schema Updates for New Fields

**File:** `lib/schemas/types.ts`

Update `ChatParticipantSchema`:

```typescript
hasHistoryAccess: z.boolean().default(false),
joinScenario: z.string().nullable().optional(),
```

### 5.3 Remove Character

From participant card "Remove" button:

1. Show confirmation dialog
2. On confirm, set `isActive: false` on participant (soft delete)
3. Remove from sidebar display
4. Their past messages remain in history (attributed to them)

---

## Part 6: Multi-Character Context Building

### 6.1 Update Context Manager

**File:** `lib/chat/context-manager.ts`

Update `buildContext()` to handle multiple characters:

```typescript
interface BuildContextOptions {
  // ... existing fields ...
  respondingParticipant: ChatParticipant  // Who is about to speak
  allParticipants: ChatParticipant[]       // All active participants
  participantCharacters: Map<string, Character>  // Character data by participant ID
  participantPersonas: Map<string, Persona>      // Persona data by participant ID
}
```

### 6.2 Message Attribution in Context

When building message history for Character A:

1. **Messages from Character A** → role: `assistant`
2. **Messages from other characters** → role: `user`, with `name` field if provider supports it
3. **Messages from user/persona** → role: `user`, with `name` field if provider supports it
4. **System/Tool messages** → role: `system` or `tool` as appropriate

Example context for Luna responding:

```text
system: You are Luna, a cheerful elf...
user (name: "Max"): *walks into the tavern* Hey Luna!
assistant: *waves excitedly* Max! Over here!
user (name: "Zara"): *slides onto the barstool* Room for one more?
```

### 6.3 Provider Name Field Support

**File:** `lib/llm/message-formatter.ts` (new or update existing)

- Check if provider supports `name` field on messages
- OpenAI: Yes (on user/assistant messages)
- Anthropic: Yes (on user messages)
- Others: Check and implement accordingly
- Fallback: Prefix message content with `[Name]:`

### 6.4 History Access Filtering

When building context for a participant with `hasHistoryAccess: false`:

1. Find their `createdAt` timestamp (when they joined)
2. Only include messages after that timestamp
3. Prepend their `joinScenario` if provided

---

## Part 7: Character LLM Fallback Logic

### 7.1 Connection Profile Resolution

**File:** `lib/chat/connection-resolver.ts` (new)

```typescript
function resolveConnectionProfile(
  participant: ChatParticipant,
  character: Character,
  chatDefaultProfileId?: string
): string
```

Resolution order:

1. `participant.connectionProfileId` (per-chat override)
2. `character.defaultConnectionProfileId` (character's default)
3. `chatDefaultProfileId` (chat-level fallback, if we add this)
4. Error if none found

### 7.2 Update Message Route

**File:** `app/api/chats/[id]/messages/route.ts`

- Use `resolveConnectionProfile()` instead of requiring `connectionProfileId` on participant
- Load the resolved connection profile for the responding character

---

## Part 8: API Updates

### 8.1 New Endpoints

**File:** `app/api/chats/[id]/participants/route.ts` (new)

- `GET` - List participants with character/persona details
- `POST` - Add participant to chat
- `PATCH` - Update participant (talkativeness override, connection profile, etc.)
- `DELETE` - Remove participant (soft delete via `isActive: false`)

**File:** `app/api/chats/[id]/turn/route.ts` (new)

- `GET` - Get current turn state (who should speak next)
- `POST` - Trigger next speaker (for auto-continue after message)

### 8.2 Update Existing Endpoints

**File:** `app/api/chats/[id]/messages/route.ts`

- Accept optional `participantId` in request to specify who is sending (for user messages)
- Return `participantId` in message response
- After saving assistant message, calculate and return next speaker info

---

## Part 9: Frontend Updates

### 9.1 Chat Page Updates

**File:** `app/(authenticated)/chats/[id]/page.tsx`

- Add `TurnState` to page state
- Integrate `ParticipantSidebar` component
- Handle turn transitions after messages
- Show/hide sidebar based on participant count and debug panel state

### 9.2 Message Display Updates

**File:** `components/chat/ChatMessage.tsx` (or equivalent)

- Look up participant by `participantId` on message
- Display correct avatar per message (not just first character)
- Handle messages from characters who were later removed (show name, generic avatar)

### 9.3 Chat Input Updates

**File:** `components/chat/ChatInput.tsx` (or equivalent)

- Show "Continue" button when it's user's turn but they want to pass
- Auto-focus when it becomes user's turn
- Disable during character response generation

### 9.4 New Chat Flow Updates

**File:** `app/(authenticated)/chats/new/page.tsx` (or equivalent)

- Allow selecting multiple characters when creating chat
- Option to set which character speaks first (or let system decide)
- Each selected character shown with their default LLM

---

## Implementation Order

### Phase 1: Data Foundation

1. Add `talkativeness` to Character schema + migration
2. Add `participantId` to MessageEvent schema + backfill migration
3. Add `hasHistoryAccess` and `joinScenario` to ChatParticipant schema
4. Make `connectionProfileId` optional on ChatParticipant
5. Create connection profile resolver

### Phase 2: Turn Management Core

6. Create turn manager module with selection algorithm
7. Create turn state types and utilities
8. Update message API route to track turns and calculate next speaker

### Phase 3: Context Building

9. Update context manager for multi-character support
10. Implement provider-aware name field support
11. Implement history access filtering

### Phase 4: Basic UI

12. Create ParticipantSidebar component
13. Create ParticipantCard component
14. Add turn indicator visuals
15. Update message display to use participantId for avatars

### Phase 5: Nudge/Queue System

16. Implement nudge action (immediate speak)
17. Implement queue system (ordered next speakers)
18. Create EphemeralMessage component
19. Add queue position indicators

### Phase 6: Add/Remove Characters

20. Create AddCharacterDialog component
21. Create participants API endpoints
22. Implement remove character flow

### Phase 7: Polish & Integration

23. Update new chat flow for multi-character selection
24. Add "Continue" button for passing turns
25. Handle edge cases (all characters removed, etc.)
26. Add debug logging throughout

---

## Testing Strategy

### Unit Tests

- [ ] Turn selection algorithm (various talkativeness combinations)
- [ ] Queue management (add, remove, order)
- [ ] Connection profile resolution (fallback chain)
- [ ] History access filtering
- [ ] Message attribution in context building

### Integration Tests

- [ ] Adding character to existing chat
- [ ] Removing character from chat
- [ ] Turn progression through multiple characters
- [ ] Nudge/queue overriding normal turn order
- [ ] LLM context includes correct message attribution

### E2E Tests

- [ ] Create multi-character chat from start
- [ ] Full conversation with turn-taking
- [ ] Mid-chat character addition with/without history
- [ ] Participant sidebar interactions
- [ ] Reload preserves messages but resets turn state

---

## Files to Create

- `lib/chat/turn-manager.ts`
- `lib/chat/connection-resolver.ts`
- `lib/llm/message-formatter.ts` (or update existing)
- `lib/mongodb/migrations/add-multi-character-fields.ts`
- `components/chat/ParticipantSidebar.tsx`
- `components/chat/ParticipantCard.tsx`
- `components/chat/AddCharacterDialog.tsx`
- `components/chat/EphemeralMessage.tsx`
- `app/api/chats/[id]/participants/route.ts`
- `app/api/chats/[id]/turn/route.ts`

## Files to Modify

- `lib/schemas/types.ts` (MessageEvent, Character, ChatParticipant)
- `lib/chat/context-manager.ts`
- `app/api/chats/[id]/messages/route.ts`
- `app/(authenticated)/chats/[id]/page.tsx`
- `components/chat/ChatMessage.tsx`
- `components/chat/ChatInput.tsx`
- `components/chat/ToolPalette.tsx` (may integrate with sidebar)
- `app/(authenticated)/chats/new/page.tsx`

---

## Risk Assessment

### High Risk

- **Context building changes**: Could break existing single-character chats
  - Mitigation: Extensive testing, backward compatibility for chats without participantId
- **Migration backfill**: Incorrect participantId assignment on old messages
  - Mitigation: Careful logic, verify first participant exists before assigning

### Medium Risk

- **Turn algorithm fairness**: May feel unfair if talkativeness weights are off
  - Mitigation: Tunable weights, user can adjust per-character
- **Provider name field support**: Not all providers may handle it well
  - Mitigation: Fallback to prefix format, test with each provider

### Low Risk

- **Participant sidebar**: Additive UI, doesn't break existing functionality
- **Ephemeral messages**: Client-only, no database impact

---

## Success Criteria

1. **Multi-character support works**: Can add 2+ characters to a chat and they take turns responding
2. **Turn fairness**: Characters speak roughly according to their talkativeness settings
3. **Manual override works**: Nudge/queue allows forcing specific speaking order
4. **Context is correct**: Each character sees appropriate message attribution in their context
5. **History access works**: New characters can join without seeing prior conversation
6. **No regression**: Single-character chats continue to work exactly as before
7. **Performance**: No noticeable slowdown with multiple participants

---

## Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Should messages have participantId? | Yes |
| Should nudge messages persist? | No, ephemeral only |
| When does turn calculation happen? | After each message |
| Can characters speak twice in a row? | Only if nudged/queued |
| Default talkativeness for existing? | 0.5 |
| New character history access? | Configurable, default no |
| How to show other characters in context? | User role with name field (or prefix fallback) |
| Nudge vs Queue distinction? | Same button, context-dependent |

---

## Notes

- The participant sidebar replaces some functionality that might have been in ToolPalette - consider whether to keep both or merge
- Ephemeral messages are a new pattern in the app - document the approach for future use
- The turn manager is stateless on the server; all state lives in the client and is recalculated from message history on load
