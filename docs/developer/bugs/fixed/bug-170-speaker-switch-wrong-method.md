# Bug 170 — switching the Salon's "speaking as" seat sends the wrong HTTP method

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-24)** |
| **Found** | 2026-09-24, live on `Friday`: impersonating Laura, then choosing her in the speaker selector, raised an "Unknown action" error toast |
| **Fixed** | 2026-09-24, v4.10-dev |
| **Severity** | Medium. Since `ad1c4c37f` the speaker switch fails with an error toast. Before that it failed silently: the composer showed the new seat, but the server never recorded it |
| **Who it bites** | anyone impersonating a character who switches seats in the Salon's speaker selector |
| **Provenance** | Original to v4. The hook has sent PUT since it was extracted (`ef088a9b3`). `ad1c4c37f` (#68, one `?action=` dispatcher) did not cause it, but turned the silent no-op into a visible 400 |
| **Defect site** | `app/salon/[id]/hooks/useImpersonation.ts:153` (`handleSetActiveSpeaker`) |
| **Fix site** | same line: `method: 'PUT'` → `method: 'POST'` |
| **v5 status** | Unchecked. The v5 client should be checked for the same method on `set-active-speaker` |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-24).** `handleSetActiveSpeaker` now sends POST, the only verb the chat
route serves `set-active-speaker` on. Pinned by
`__tests__/unit/app/salon/hooks/useImpersonation.set-active-speaker.test.tsx`, which asserts the
method, URL and body, and fails when the method is reverted to PUT.

## Symptom

In a Salon chat, impersonate a character, then pick that character in the speaker selector. An
error toast appears, carrying the server's 400 "Unknown action" message. The server log shows, once per attempt:

```
warn  Unknown action requested  action=set-active-speaker  availableActions=["set-state"]  method=PUT
      path=/api/v1/chats/<chatId>
```

## Root cause

`handleSetActiveSpeaker` sent `PUT /api/v1/chats/[id]?action=set-active-speaker`. The chat route
serves that action only on POST (`app/api/v1/chats/[id]/handlers/post.ts:83`, which calls
`handleSetActiveSpeaker` in `actions/participants.ts`). PUT knows only `set-state`.

## Why it survived

Until `ad1c4c37f`, `handlePut` read `?action=` by hand. It handled `set-state` and sent anything
else to the plain chat update. That update parsed `{ participantId }` through
`chatUpdateRequestSchema`, which strips the unknown key, and returned 200. The hook then set
`activeTypingParticipantId` locally, so the composer looked right. But the server-side write
(`setActiveTypingParticipant`, and the auto-add of a user-controlled seat to
`impersonatingParticipantIds`) never ran.

`ad1c4c37f` routed every verb through `dispatchAction`, so an unknown action returns 400. That
exposed the old mismatch. No test covered the client's choice of method.

## Fix

Send POST. The POST handler's response carries `impersonatingParticipantIds`, the field the hook
already reads, so nothing else changed.

## How to verify

1. Impersonate a character in a Salon chat.
2. Choose that character in the speaker selector. No toast appears.
3. The log shows `[Chats v1] Active speaker set` for the chat.
4. `npx jest __tests__/unit/app/salon/hooks/useImpersonation.set-active-speaker.test.tsx`
