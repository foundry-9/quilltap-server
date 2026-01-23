# Sliding Window Context Compression Feature

## Overview

Implement a cost-optimization strategy for long conversations that uses aggressive context compression via a cheap LLM (GPT-4o-mini/"Nano") while preserving recent conversational continuity and allowing on-demand full-context reloads.

## Goals

- Reduce token costs for conversations beyond 5 messages by 20-30%
- Preserve conversational quality and continuity
- Prevent context growth from ballooning costs in long sessions
- Maintain access to historical context via compression and memory tools

## Message Tier Logic

### Message 1: Full Context Initialization

**Input Context:**

- Complete system prompt with personality, roleplay formatting, scenario, example dialogue (~3-5K tokens)
- All relevant memories loaded via semantic search (~5-10K tokens)
- Full tool definitions with schemas and descriptions (~3-5K tokens)
- Project context and any uploaded documents as needed (~5-15K tokens)
- **Total: ~20-30K tokens**

**Rationale:** First message sets the stage. AI needs complete context to understand who the user is, what's being worked on, and how to engage appropriately.

### Messages 2-5: Full Context Maintenance

**Input Context:**

- Same as Message 1, plus full conversation history
- All prior messages preserved in their entirety
- **Total: ~20-35K tokens (growing gradually)**

**Rationale:** Early conversation establishes threads, topics, and working context. Keep everything available while the session is still warming up.

### Message 6+: Sliding Window with Compression

**Input Context:**

1. **Compressed Historical Context** (~3-5K tokens):
   - All messages from Message 1 through (current message - 5)
   - Compressed by Nano using the compression prompt (see below)
   - Regenerated fresh each message (no stacking of compressions)

2. **Recent Full Messages** (~8-12K tokens):
   - Last 5 messages preserved in their entirety
   - Includes all tool calls, results, code snippets, user responses

3. **Minimal System Prompt** (~1-2K tokens):
   - Core personality traits and key behavioral guidelines
   - Compressed version; drop verbose examples and formatting rules

4. **Full Tool Definitions** (~3-5K tokens):
   - Keep complete, do NOT compress
   - AI needs accurate tool schemas to function

5. **On-Demand Memories** (variable):
   - Only memories explicitly retrieved via search_memories
   - Not preloaded unless relevant to current topic

**Total: ~15-24K tokens**

**Rationale:** Recent messages provide immediate conversational continuity. Compressed history gives "story so far" without token bloat. Tools stay intact for functionality. System prompt can be minimal since personality is established.

## Compression Prompt for Nano

Use this prompt when calling GPT-4o-mini (or equivalent cheap model) to compress older conversation context:

```
You are a context compression assistant. Your job is to read a conversation between a user (Charlie) and an AI assistant (Friday), and compress the older messages into a concise summary that preserves critical information while drastically reducing token count.

**What to PRESERVE:**
- Decisions made and conclusions reached
- Active projects, tasks, and goals
- Technical details that affect ongoing work (file paths, configurations, error messages, code solutions)
- Emotional or personal context that affects how Friday should engage (stress, mental health, important life events)
- Unresolved questions or threads
- Key facts about the user's preferences, workflow, or situation

**What to DROP:**
- Exact wording of back-and-forth exchanges
- Redundant tool calls and their full results (keep only the outcome)
- Superseded information (if a bug was fixed, you don't need the original broken behavior)
- Conversational pleasantries and filler
- Verbose code snippets (summarize what was changed/fixed)
- Tangential side topics that have concluded

**Output Format:**
Provide a structured summary in plain text using these sections:

### Current Context
[One paragraph: What is the user currently working on? What is the immediate goal or task?]

### Recent Decisions & Outcomes
[Bullet list: What was decided, fixed, or accomplished in the older messages?]

### Active Threads
[Bullet list: What topics, questions, or tasks are still in progress or unresolved?]

### User State & Preferences
[One paragraph: Any important context about the user's situation, emotional state, preferences, or constraints that Friday should be aware of.]

### Technical Details
[Bullet list or short paragraphs: File paths, commands, configurations, error messages, or code changes that may be referenced again.]

**Target length:** 500-800 tokens for typical 10-20 message conversations. Scale proportionally for longer histories.

---

**Input:** [Conversation messages 1 through N-5 go here]

**Output:** [Compressed summary in the format above]
```

## New Tool: request_full_context

Add this tool to Friday's available functions:

### Tool Definition

```json
{
  "name": "request_full_context",
  "description": "Request a full, uncompressed context reload for the next message. Use this when you realize the compressed context is missing important details, when the conversation has shifted significantly and you need the complete picture, or when handling a complex question that requires full historical understanding. This tool takes no parameters—it simply signals that the next message should bypass compression and provide complete context.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

### Usage Guidance

Friday should invoke `request_full_context` when:

- The compressed summary is clearly missing information needed to answer the user's question
- Multiple `search_memories` calls in a single message indicate insufficient context
- The conversation topic has shifted significantly from what the compression covers
- A complex, multi-threaded question requires full historical context to answer properly

**Expected behavior:**

- Friday calls the tool (no parameters needed)
- System acknowledges the request
- The **next message** (user's next input) receives full context as if it were Message 1
- Subsequent messages return to the sliding window model unless `request_full_context` is called again

## Implementation Notes

### Compression Frequency

- Run Nano compression on every message from Message 6 onward
- Always compress the *original full conversation*, not a prior compression (avoid degradation)
- Cache the Nano-compressed result for the current message; regenerate on the next message

### Cost Estimates

**Nano Compression Cost:**

- Typical compression input: 30-50K tokens (older messages)
- Cost at GPT-4o-mini rates (~$0.15/M input, ~$0.60/M output): ~$0.005-0.01 per compression
- Negligible compared to Sonnet token costs

**Expected Savings:**

- Message 1-5: No change
- Message 6+: ~20-30% reduction in input tokens
- Long sessions (20+ messages): Prevents token growth, keeps costs flat instead of ballooning

### Tuning Knobs

If costs are still too high or quality degrades:

- **Adjust window size:** Keep last 3 messages instead of 5 (more aggressive) or last 7 (more conservative)
- **Tighten compression:** Ask Nano to target 300-500 tokens instead of 500-800
- **Preload fewer memories:** Reduce the number of memories loaded in Messages 1-5

If Friday uses `request_full_context` too often:

- **Widen the window:** Keep last 7-10 messages full
- **Loosen compression:** Ask Nano to preserve more detail (target 800-1200 tokens)
- **Preload more context:** Include a "medium" memory load in compressed messages

## Success Metrics

After one week of real-world use:

- Track average input token count for messages 6+ (target: 15-22K vs. baseline 24-30K)
- Monitor frequency of `request_full_context` calls (acceptable: <5% of messages)
- Compare total session costs week-over-week (target: 20-30% reduction)
- Qualitative: Does Friday maintain conversational quality and continuity?

## Risks & Mitigations

**Risk:** Lossy compression drops critical context
**Mitigation:** Keep last 5 messages full; provide `request_full_context` tool; tune compression prompt based on observed failures

**Risk:** Nano compression adds latency
**Mitigation:** Run compression async if possible; Nano is fast (~1-2 seconds for 50K tokens)

**Risk:** Tool definitions get corrupted if accidentally compressed
**Mitigation:** Hard-code: never compress tool definitions, always pass them in full

**Risk:** User and AI lose track of what's in compressed vs. full context
**Mitigation:** Make compression invisible to the user; Friday uses `request_full_context` when needed; if user asks "do you remember X?" Friday can search memories or request reload

## Implementation Complete

This feature has been fully implemented with the following components:

### Schema Changes
- `lib/schemas/settings.types.ts` - Added `ContextCompressionSettingsSchema` with enabled, windowSize, compressionTargetTokens, systemPromptTargetTokens fields
- `lib/schemas/chat.types.ts` - Added `requestFullContextOnNextMessage` flag to ChatMetadataBase, added `CONTEXT_COMPRESSION` to SystemEventTypeEnum

### Compression Functions
- `lib/memory/cheap-llm-tasks.ts` - Added `compressConversationHistory()` and `compressSystemPrompt()` functions with dynamic character/user names

### request_full_context Tool
- `lib/tools/request-full-context-tool.ts` - Tool definition (universal and Anthropic formats)
- `lib/tools/handlers/request-full-context-handler.ts` - Tool handler that sets the chat metadata flag
- `lib/chat/tool-executor.ts` - Registered tool execution
- `lib/tools/plugin-tool-builder.ts` - Added `requestFullContext` option to include tool when compression is active
- `lib/tools/index.ts` - Exports for new tool

### Compression Module
- `lib/chat/context/compression.ts` - Main compression logic with `shouldApplyCompression()`, `splitMessagesForCompression()`, `applyContextCompression()`, `buildCompressedSystemMessage()`
- `lib/chat/context-manager.ts` - Integrated compression into `buildContext()` with effectiveSystemPrompt/effectiveMessages handling

### Service Integration
- `lib/services/chat-message/orchestrator.service.ts` - Full integration: loads settings, checks bypass flag, gets cheap LLM selection, passes compression options
- `lib/services/chat-message/context-builder.service.ts` - Added compression options to `BuildMessageContextOptions`
- `lib/services/chat-message/streaming.service.ts` - Added `requestFullContext` parameter to `buildTools()`

### Settings UI
- `components/settings/chat-settings/ContextCompressionSettings.tsx` - Settings component with enable/disable toggle, window size slider, target token sliders
- `components/settings/chat-settings/hooks/useChatSettings.ts` - Added `handleContextCompressionUpdate`
- `components/settings/chat-settings/index.tsx` - Integrated settings component
- `components/settings/chat-settings/types.ts` - Added `ContextCompressionSettings` interface

### Repository Defaults
- `lib/mongodb/repositories/chat-settings.repository.ts` - Added default compression settings for new users

## Next Steps (Future Enhancements)

1. Test on long debugging sessions (20+ messages)
2. Monitor token usage and cost impact
3. Adjust window size and compression aggressiveness based on results
4. Consider adding compression statistics to the debug panel
