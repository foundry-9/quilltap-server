# Feature: Carina (Inline LLM Queries)

**Status:** Proposal / Not Implemented
**Owner:** Charlie
**Scope:** Allow users and LLM characters to direct quick questions to a designated "answerer" character, receiving a response built from that character's identity and tools but without chat history or memory formation.

## Motivation

In a multi-character Salon chat, users and characters sometimes need a quick factual lookup, a calculation, or a web search without derailing the conversation. Today the only option is to address a character who then responds in full conversational mode — consuming context, forming memories, and appearing in the chat flow as a full participant turn.

Carina provides a lightweight "ask the reference desk" mechanism: designate one or more characters as answerers, then invoke them inline with a compact `@Name:` syntax (or via an `ask_carina` tool call from another LLM). The answerer builds a fresh, minimal LLM call — character identity without chat history — answers the question, and the result is either whispered or posted publicly. No memories are formed. The interaction is fire-and-forget.

## Feature Name

**Carina** — the personified-feature name used in internal code, documentation, and system-sender labeling. Carina never speaks as herself; she always responds as the designated character. The name is for internal reference only, like "Prospero" or "the Librarian."

## Markup Syntax

### Basic form

```
@CharName: What is the capital of France?
```

The `@` prefix, character name, colon, then the rest of the line is the question.

### Whisper form

```
@CharName? What is the capital of France?
```

Question mark instead of colon — the answer is whispered back to the asker only.

### Quoted form (multi-sentence)

```
@CharName: "What was the capital? And who ruled there?"
@CharName? 'What was the capital of the Roman Empire in AD 287? Who was Emperor at that time?'
```

If the first non-whitespace character after the punctuation is a quote (`"`, `'`, `"`, or `'`), consume everything up to the matching close quote. Smart quotes pair with their counterparts (`"…"`, `'…'`). Quoted questions do **not** span multiple lines.

### Unquoted form

Without quotes, the question is everything from after the separator to end of line.

### Parsing regex

```
/^@([\w][\w ]*\w)([?:])\s*(?:(["'"‘])(.*?)\3|(.*))$/
```

Capture groups:
1. Character name (word chars and spaces, must start and end with a word char)
2. Separator — `:` = public, `?` = whisper
3. (optional) Opening quote character
4. (optional) Quoted question content
5. (optional) Unquoted question content (rest of line)

The regex is applied per-line against the raw message content. Only the **first** matching `@` line in a message fires; subsequent matches are ignored (one query per message).

### Where parsing occurs

Detection runs in the message processing pipeline after the message is stored but before responses are generated — the same phase where text-block and simple-json tool calls are detected in `pseudo-tool.service.ts`. Carina queries are extracted from both user messages and LLM assistant messages.

## Database Changes

### `characters` table

Add one column:

```sql
ALTER TABLE "characters" ADD COLUMN "canBeCarina" INTEGER DEFAULT NULL;
```

Semantics: `NULL` or `0` = not a Carina answerer; `1` = eligible to answer `@Name` queries. This is a control flag like `systemTransparency` or `canDressThemselves` — it lives in the DB row, not in the character vault's `properties.json`.

### Migration

New migration: `add-carina-flag-v1`

- `dependsOn: ['sqlite-initial-schema-v1']`
- `shouldRun()`: check `characters` table exists and `canBeCarina` column is absent
- `run()`: single `ALTER TABLE` statement
- Prettify label: `"Preparing the reference desk…"`

### Schema updates

- Add `canBeCarina: z.boolean().nullable().optional().default(false)` to the character Zod schema
- Add the column to DDL.md
- No export schema change (`.qtap` export can include the flag as-is; SillyTavern export ignores it)

## LLM Call Construction

When a Carina query fires, the system builds a **minimal, isolated LLM call** for the target character:

### Context included

1. **System prompt** — built the same way as a normal character turn: identity, description, personality, manifesto (from the character vault via `applyDocumentStoreOverlay`)
2. **Character's scenarios** — if the character has a default scenario, include it
3. **Memory recall (Commonplace Book)** — the answerer's own relevant memories, recalled by semantic search against the question and whispered into the call. *(Added after v1 — see "Memory: revised behavior" below.)*
4. **Previous Carina exchanges in this chat** — only other `@Name` queries and their answers directed at this same character in this same chat session. This gives continuity for follow-up questions ("And what about...?") without pulling in the full chat history
5. **The question** — delivered as a user-role message

### Context excluded

- Full chat history (the answerer doesn't see the conversation)
- Other characters' messages
- Project context
- Core whispers

### Memory: revised behavior

> **Note:** The original spec (below the line) called for *no* memory recall and *no* memory formation. Both were reversed in a later change. Carina answerers now:
>
> - **Receive recall.** `runCarinaQuery` runs `searchMemoriesSemantic(answererId, question, …)` over the answerer's whole memory store and injects the formatted result (via `buildCommonplaceLLMContext`) into the isolated call's system prompt. It is recall only — still no live conversation, project, or core context.
> - **Form memories.** After the answer posts, `runCarinaQuery` enqueues a `CARINA_MEMORY_EXTRACTION` job. Its handler (`lib/background-jobs/handlers/carina-memory-extraction.ts`) loads the posted carina message, builds a one-slice `TurnTranscript` (the question as the opener, the answer as the answerer's sole contribution, **no** user-controlled character → OTHER pass self-skips), and runs `processTurnForMemory` — yielding SELF-only memories for the answerer. Public and whispered exchanges alike form memories. Behavior is global (every `canBeCarina` answerer); no per-character flag.
>
> The `systemSender: 'carina'` tag still keeps the answer out of the *normal* per-turn extractor (`buildTurnTranscript` skips every systemSender message); the dedicated job is what forms Carina's memories instead.

#### (Original spec — superseded)

No memories are created from Carina interactions. The memory-formation pipeline must be explicitly skipped for messages tagged as Carina responses. The Carina response message should carry a marker (e.g., `systemKind: 'carina-response'`) that the memory system checks and short-circuits on.

## Connection Profile Resolution

The answerer character needs an LLM to call. Resolution order:

1. **Character's default connection profile** (`character.defaultConnectionProfileId`)
2. **Instance default connection profile** (`connectionProfiles.findDefault(userId)`)
3. **First available profile with native web search** — query all connection profiles for the user, find the first where the provider supports `webSearch`
4. **Error** — if none found, Prospero reports the error (see Error Handling below)

This is intentionally different from the standard `resolveConnectionProfile()` chain, which uses participant/chat fallbacks. Carina calls are not participant-scoped — the character may not even be a participant in the current chat.

## Tool Access

The Carina answerer has access to **every tool that is available in the current chat**. This is resolved the same way tools are resolved for a normal participant turn — the union of tools enabled for the chat, filtered by the answerer character's connection profile capabilities.

This means if the chat has web search, image generation, document tools, etc. enabled, the Carina answerer can use them. Tool calls within a Carina response go through the normal tool-call loop (detect → execute → re-stream with result).

## The `ask_carina` Tool

An LLM tool that lets characters programmatically invoke Carina, producing the same effect as the `@Name` markup.

### Definition

```typescript
export const askCarinaToolInputSchema = z.object({
  character: z.string().describe('The name of the character to ask. Must be a character with Carina answerer capability enabled.'),
  question: z.string().describe('The question to ask.'),
  whisper: z.boolean().default(false).describe('If true, the answer is whispered back to the caller only. If false, the answer appears in the chat publicly.'),
});
```

### Behavior

- Resolves the character name against characters with `canBeCarina === true`
- Fires the same Carina LLM call as the markup path
- Returns the answer as a tool result to the calling LLM
- The answer is also posted into the chat as a message (whispered or public per the `whisper` flag)
- The calling character receives the answer content as the tool result so it can incorporate it into its own response

### Registration

Registered in the tool registry alongside existing tools. Available to all characters in chats where at least one `canBeCarina` character exists (whether or not that character is a participant — Carina answerers do not need to be in the chat).

## Response Delivery

### Public response (`@Name:` or `ask_carina` with `whisper: false`)

- Posted as an `ASSISTANT` message
- `participantId`: the Carina character's participant ID if they're in the chat, otherwise `null`
- `systemSender: 'carina'`
- `systemKind: 'carina-response'`
- Attributed to the answerer character by name in the message
- **Counts toward the chat's message total** — stored and counted like any other message

### Whispered response (`@Name?` or `ask_carina` with `whisper: true`)

- Posted as an `ASSISTANT` message with `targetParticipantIds` set to the asker only
- Same `systemSender`, `systemKind`, and non-counting behavior
- Only the asker sees it

### Streaming

Carina responses stream to the UI like any other LLM turn. This keeps the implementation consistent with the existing streaming infrastructure and avoids problems with tool-call loops (agent-style multi-step responses) that would be awkward to buffer.

### Display

The Carina response should be visually distinct in the Salon UI — a compact card or indented block rather than a full chat bubble, to signal "this is a quick reference answer, not a conversational turn." Specific UI treatment is deferred to implementation, but the `systemSender: 'carina'` / `systemKind: 'carina-response'` tags give the frontend the hook it needs.

## Error Handling

Errors are reported by **Prospero** (not Carina — Carina has no voice of her own).

### Error conditions

1. **Character not found or not `canBeCarina`**: "No answerer by that name is on duty."
2. **No connection profile resolvable**: "The answerer has no connection to an LLM provider."
3. **LLM call fails** (network, rate limit, etc.): "The answerer was unable to respond — [error summary]."

### Delivery

- If the original query was public (`:`) — Prospero posts the error publicly with `systemSender: 'prospero'`, `systemKind: 'carina-error'`
- If the original query was whispered (`?`) — Prospero whispers the error to the asker only
- Both `content` and `opaqueContent` are provided (the opaque version strips the personified framing for characters with `systemTransparency: false`)

### Opaque content examples

| content (transparent) | opaqueContent (opaque) |
|---|---|
| "Prospero regrets to inform you that no answerer by that name is currently on duty." | "System: The requested Carina character was not found or is not enabled as an answerer." |
| "Prospero notes that the answerer lacks a connection to any LLM provider." | "System: No connection profile available for the requested answerer character." |

## Personified Feature Registration

### System sender enum

Add `'carina'` to the `systemSender` enum in:
- `lib/schemas/chat.types.ts` (MessageEventSchema)
- `public/schemas/qtap-export.schema.json`

### Avatar

- File: `public/images/avatars/carina-avatar.webp`
- WebP format, created per avatar conventions in CLAUDE.md
- Referenced in `getMessageAvatar` keyed off `systemSender === 'carina'`

Note: Carina's avatar only appears on system-level messages (errors routed through Prospero with `systemKind: 'carina-error'`, or when the answerer character is not a chat participant and the message needs attribution). When the answerer *is* a participant, their own avatar is used.

### CLAUDE.md updates

Add to the Feature Names section:
- **Carina** — the inline LLM query system; lets users and characters ask quick questions of a designated answerer character via `@Name:` markup or the `ask_carina` tool — settings flag `canBeCarina` on characters; no dedicated settings tab

Add to the `systemSender` enum documentation:
- `carina` — Carina query responses (quick-reference answers from a designated answerer character); fires when the answerer is not a chat participant or for system-level Carina messages

## Settings UI

No dedicated settings page. The `canBeCarina` toggle appears on the character edit page alongside other control flags (`systemTransparency`, `canDressThemselves`, `canCreateOutfits`, etc.).

Label: **"Can answer @-queries (Carina)"**
Help text: *"When enabled, this character can be invoked with @Name in any chat to answer quick questions using their personality and available tools, without joining the conversation."*

## Engineering Tasks

### Backend

1. **Migration**: `add-carina-flag-v1` — add `canBeCarina` column to `characters`
2. **Schema**: Update character Zod schema, DDL.md
3. **Parser**: `lib/chat/carina-parser.ts` — regex extraction of `@Name` queries from message content
4. **Service**: `lib/services/carina/carina.service.ts` — orchestrates the Carina call:
   - Resolve character by name + `canBeCarina` check
   - Resolve connection profile (custom chain)
   - Build minimal context (character identity only + prior Carina exchanges)
   - Execute LLM call with available chat tools
   - Handle tool-call loop within the Carina response
   - Post result as message (public or whispered)
   - Skip memory formation
5. **Tool definition**: `lib/tools/ask-carina-tool.ts` + `lib/tools/handlers/ask-carina-handler.ts`
6. **Tool registration**: Add to `lib/tools/index.ts` exports and tool registry
7. **Pipeline integration**: Hook Carina parsing into `pseudo-tool.service.ts` or `orchestrator.service.ts`
8. **Prospero error messages**: Add Carina error templates to `lib/services/prospero-notifications/`
9. **System sender**: Add `'carina'` to enum, add `getMessageAvatar` branch
10. **Memory suppression**: Add `systemKind: 'carina-response'` check to memory formation pipeline

### Frontend

1. **Character edit page**: Add `canBeCarina` toggle to control flags section
2. **Salon rendering**: Detect `systemSender: 'carina'` / `systemKind: 'carina-response'` and render as compact reference card
3. **Avatar**: Add `carina-avatar.webp` and wire into `getMessageAvatar`

### Documentation

1. **Help file**: `help/carina.md` — user-facing docs on `@Name` syntax
2. **CLAUDE.md**: Feature name entry, system sender entry
3. **DDL.md**: New column
4. **Changelog**: Entry for the feature

### Testing

1. **Parser unit tests**: Regex coverage — names with spaces, quoted/unquoted, smart quotes, whisper vs public, multiple queries in one message, edge cases (no match, partial match, `@` in middle of line)
2. **Service unit tests**: Connection profile resolution chain, memory suppression, tool access, error handling
3. **Tool definition snapshot**: Add `ask_carina` to `tool-definitions-snapshot.test.ts`
4. **Integration test**: End-to-end message → parse → LLM call → response delivery

## Design Decisions (Resolved)

1. **Carina responses count toward the chat's message total.** Even though they're invoked via tool-like syntax, they are real messages — at least as much as system announcements from Prospero, the Host, etc. They are stored as normal messages and counted normally.
2. **Rate limiting: one Carina query per message.** If a message contains multiple `@Name` lines, only the first fires. This prevents spam without requiring time-based throttling infrastructure. The `ask_carina` tool call is naturally limited to one per tool-call turn by the existing tool-call loop.
3. **Declining to answer is a prompt-engineering concern, not an architectural one.** The character's manifesto, personality, and system prompt govern whether and how it responds. A character could be prompted to lie, refuse, or filter by asker — that's by design. The Carina system makes the call unconditionally; the LLM decides what to say.
4. **No separate token budget.** Carina calls use the same token limits as any other LLM call for that connection profile. If the user wants short answers, that's a prompt concern.
5. **Carina responses stream.** The response streams to the UI like any other LLM turn. This keeps the implementation consistent with the existing streaming infrastructure and avoids problems with tool-call loops (agent-style multi-step responses) that would be awkward to buffer and deliver as a single block.
