# Bug 241 — A send that fails before the user message is saved loses the text silently

| | |
|---|---|
| **Status** | Fixed 2026-10-13 |
| **Found** | 2026-10-13, live on `V4test` (a connection profile with no API key) while dogfooding the memory refactor |
| **Fixed** | 2026-10-13 |
| **Severity** | Medium — the operator's message disappears with no visible error; the composer, the saved draft and any attachments are cleared and never restored |
| **Who it bites** | anyone whose turn fails before the orchestrator saves the user message: a missing API key, a provider/profile resolution error, an HTTP refusal, or a dropped connection |
| **Provenance** | Original to v4 |
| **Defect site** | `app/salon/[id]/hooks/useSSEStreaming.ts` (`sendMessage` cleared input, draft, attachments and pending tool results before the fetch and never restored them; the catch assumed "the backend already saved it"; `readSSEStream` split chunks without a carry-over buffer, so a frame split across reads was dropped, and treated EOF without a terminal event as success); `lib/services/chat-message/orchestrator.service.ts` (`processMessage` throws at the API-key check before the user message is saved; the error frame did not say whether it had been) |
| **Fix site** | `lib/services/chat-message/streaming.service.ts` (`encodeErrorEvent` extras); `lib/services/chat-message/orchestrator.service.ts` (`SubmissionLedger`, `handleStreamError`); `app/salon/[id]/hooks/useSSEStreaming.ts` (`splitSseBuffer` reader, `StreamClosedEarlyError`, `SalonSendError`, `restoreUnpersistedSubmission`); `useImpersonationVoice.ts`, `SalonView.tsx` (`persistDraft` threaded through) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-13).** The orchestrator keeps a per-request ledger of whether the user
message and the staged tool results were saved, and the error frame carries both flags
(`userMessagePersisted`, `pendingToolResultsPersisted`; older clients ignore them). The client
reads the stream with `splitSseBuffer` (decoder in stream mode, leftover flushed at EOF), so a split
frame is no longer lost, and a stream that ends with no `done` / `chainComplete` throws
`StreamClosedEarlyError` instead of passing for success. On a failed send it restores whatever was
not saved — composer text (into the Lexical editor as well as state), the draft, attachments and
staged tool results — judged by the frame's flags, or, when the frame never arrived, by whether the
temporary bubble survived the post-failure transcript read. It never overwrites text the operator
has typed since. The error toast lasts eight seconds and says when the message is back in the
composer. Tests: `__tests__/unit/hooks/useSSEStreaming-send-failure.test.tsx`,
`__tests__/unit/lib/services/chat-message/streaming.service.test.ts`.

## Symptom

The operator pressed Send; the composer cleared, nothing appeared in the transcript, no error was
shown, and the text was gone. The server logged `Streaming error … No API key configured for this
connection profile`; `POST /api/v1/messages` answered 200 (an SSE stream).

## Root cause

`processMessage` throws at the API-key check (before the user message is built and saved), and
`handleStreamError` writes an error frame. The client had already cleared the composer, draft,
attachments and staged tool results; its catch only toasted (if the frame parsed) and its finally
removed the temporary bubble. A frame split across two network reads failed to parse and was
dropped, and the stream's close then counted as success — no toast at all.

## Why it survived

Failures in testing usually happen after the user message is saved (a provider error mid-stream),
where the transcript keeps the message; no test covered a pre-persist failure or a split frame.

## Fix

As above.

## Verify

Remove a profile's API key and send: an error toast, and the message back in the composer.
