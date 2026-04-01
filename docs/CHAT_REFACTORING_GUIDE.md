# Chat Page Refactoring Guide

## Architecture Overview

The refactoring follows a "hooks + types + components" architecture pattern:

```
app/(authenticated)/chats/[id]/
├── types.ts                    # Shared type definitions
├── hooks/
│   ├── useChatData.ts         # Data fetching & management
│   ├── useTurnManagement.ts   # Multi-char turn logic
│   ├── useMessageStreaming.ts # Streaming control
│   ├── useMessageActions.ts   # Message editing
│   ├── useFileAttachments.ts  # File handling
│   └── index.ts               # Barrel exports
├── components/
│   ├── StreamingMessage.tsx   # Streaming display
│   └── index.ts               # Barrel exports
├── page-refactored.tsx        # Main orchestrator (in progress)
├── page.tsx.backup            # Original monolithic version
└── page.tsx                   # Current production version
```

## Hook Dependencies

### useChatData Hook

**Responsibilities:**
- Fetch chat data from `/api/chats/{id}`
- Organize messages and swipe groups
- Fetch chat settings, photo count, memory count
- Persist turn state for multi-character chat restoration

**Returns:**
```typescript
{
  chat: Chat | null
  setChat: (chat: Chat | null) => void
  messages: Message[]
  setMessages: (messages: Message[]) => void
  loading: boolean
  error: string | null
  chatSettings: ChatSettings | null
  setChatSettings: (settings: ChatSettings | null) => void
  swipeStates: Record<string, SwipeState>
  setSwipeStates: (states: Record<string, SwipeState>) => void
  chatPhotoCount: number
  setChatPhotoCount: (count: number) => void
  chatMemoryCount: number
  setChatMemoryCount: (count: number) => void
  fetchChat: () => Promise<void>
  fetchChatSettings: () => Promise<void>
  fetchChatPhotoCount: () => Promise<void>
  fetchChatMemoryCount: () => Promise<void>
  persistTurnState: (participantId: string | null) => Promise<void>
}
```

**Usage Example:**
```typescript
const chatData = useChatData(chatId)
const { chat, messages } = chatData
const { fetchChat } = chatData
```

### useTurnManagement Hook

**Responsibilities:**
- Nudge (force) a participant to speak
- Queue participants for their turn
- Dequeue participants
- Calculate next speaker (user's turn or character's)
- Dismiss ephemeral (temporary) notifications

**Dependencies:**
- `participantsAsBase`: ChatParticipantBase[]
- `charactersMap`: Map<string, Character>
- `turnState`: TurnState
- `userParticipantId`: string | null
- `participantData`: ParticipantData[]
- `ephemeralMessages`: EphemeralMessageData[]
- `triggerContinueMode`: (participantId: string) => Promise<void>

**Returns:**
```typescript
{
  handleNudge: (participantId: string) => void
  handleQueue: (participantId: string) => void
  handleDequeue: (participantId: string) => void
  handleContinue: () => void
  handleDismissEphemeral: (ephemeralId: string) => void
  hasActiveCharacters: boolean
}
```

**Usage Example:**
```typescript
const turnMgmt = useTurnManagement(
  participantsAsBase,
  charactersMap,
  turnState,
  userParticipantId,
  participantData,
  ephemeralMessages,
  setTurnState,
  setTurnSelectionResult,
  setEphemeralMessages,
  triggerContinueMode
)

// Use actions
turnMgmt.handleNudge(participantId)
turnMgmt.handleQueue(participantId)
```

## Migration Checklist

- [ ] Review all extracted hooks
- [ ] Test hooks independently
- [ ] Replace `page.tsx` with `page-refactored.tsx`
- [ ] Run e2e tests
- [ ] Check logging in browser console
- [ ] Test multi-character chat features
- [ ] Test streaming responses
- [ ] Test message editing
- [ ] Test file attachments
- [ ] Monitor performance metrics

## Known Limitations

1. **`sendMessage()` remains in page.tsx** - Too many dependencies on debug integration
2. **JSX rendering not extracted** - Message rows are complex with many interactive elements
3. **Modal management in page.tsx** - Modals tightly coupled with state and callbacks

These can be addressed in Phase 2 of the refactoring.
