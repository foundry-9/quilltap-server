# Concierge Overhaul — Phase 5: Salon Polish

**Status:** Proposed (4.10-dev, 2026-09-25)
**Scope:** quilltap-server Salon UI and two chat actions. No migration, no settings change, no plugin or package change.
**Prerequisites:** [Phase 1](concierge-overhaul-phase-1-refusal-failover.md) landed (`generateImageWithConciergeFailover`, `resolveUncensored*Understudy`, image route trails, the refusal announcements). Phases 2–4 are **not** required; where this spec names a three-state value it also gives the four-state equivalent so it can ship before phase 3.
**Part of:** [concierge-overhaul.md](concierge-overhaul.md) (phase 5 of 5).

## Summary

Four small things the user meets in the Salon that the backend phases make possible but do not deliver:

1. **"Try uncensored"** on a refused text turn and on a refused picture: one click sends the same request straight to the uncensored desk, without changing the chat's state. This is also the honest remedy for *soft* refusals (a sanitized image, a polite paragraph) that no detector can see.
2. **"Not Dangerous" clears the blur.** The help promises it; the code only strikes through the chips.
3. **The Lantern's refusals reach the chat.** A failed story background today fails in the tasks queue; the operator sees a stale backdrop and nothing else.
4. **Unmoderated chats stop wearing flag badges on every message.** Branch 1 of the danger orchestrator synthesises `dangerFlags` for every user message on an uncensored-route chat, and the message row reads the *global* badge setting rather than the resolved one.

## Goals

- A refusal is never a dead end: the placard or the failed picture offers the next step.
- The message row honours what the resolver decided about badges and blur.
- A Lantern refusal produces a Concierge bubble the operator can act on.

## Non-goals

- New settings.
- Changing what counts as a refusal (phase 1) or when the chat switches (phase 2).
- Reworking `DangerContentWrapper`'s reveal state (still local, still per render).

## Known State (verified 2026-09-25)

- **Refused text turn**: `getEmptyResponseReason` (`lib/services/chat-message/provider-failover.service.ts:385-443`) writes the 🚫 placard text; when the content was flagged it suggests enabling Auto-Route (:434-436). The assistant row carries `routeTrail` with the refused attempts (`RouteTrailBadge`, `components/ui/RouteTrailBadge.tsx`). Regeneration is a swipe: the client calls the regenerate action with the target message id (see `app/salon/[id]/hooks/useChatControls.ts` regenerate handler); the server rebuilds the turn with `regenerationOfMessageIds`.
- **Refused picture**: after phase 1 the TOOL message carries a trail with `profileKind: 'image'` and the Concierge posts `refusal-rerouted` / `refusal-no-understudy` / `refusal-not-permitted`. The tool call's arguments live on the preceding assistant message's `toolCalls`; `runImageGenerationTool` (`lib/tools/handlers/image-generation-handler.ts:1170`) is the entry point and `validateAndLoadProfile` (:718) picks the chat's image profile.
- **"Not Dangerous"**: `POST /api/v1/chats/[id]/messages/[messageId]?action=override-danger-flag` (`route.ts:39-90`) sets `userOverridden: true` on every flag. `MessageRow.tsx:206-210` computes `hasDangerFlags = dangerFlags?.length > 0` and picks BLUR/COLLAPSE from that plus the global `displayMode`, ignoring `userOverridden`; `DangerFlagBadge.tsx:39-41` strikes through overridden chips and hides the button once all are overridden (:59). `help/dangerous-content.md:132` says the override "removes the visual effects".
- **Lantern failure**: `story-background.ts` throws after the (phase 1) chokepoint rethrows; the job fails; no bubble is posted. Success posts `postLanternImageNotification({ kind: 'background' })` (`lantern-notifications/writer.ts:88`). The manual trigger is `POST /api/v1/chats/[id]?action=story-background` (`app/api/v1/chats/[id]/actions/story-background.ts:88`).
- **Synthesised flags**: `danger-orchestrator.service.ts:65-76` builds flags from `chat.dangerCategories` (or `['unspecified']`, score 1.0) for every user message on a Flagged/Uncensored (three-state: Unmoderated) chat. `VirtualizedMessageList.tsx:322` passes the global `showWarningBadges` to the row; the resolver returns `showWarningBadges: false` for the operator's uncensored state, but nothing on the client reads the resolved value.

## Design

### 1. "Try uncensored"

**Text.** New action `POST /api/v1/chats/[id]/messages/[messageId]?action=retry-uncensored`, registered beside `override-danger-flag` in `app/api/v1/chats/[id]/messages/[messageId]/route.ts`. It is a regenerate of the target assistant message (same `regenerationOfMessageIds` semantics, so the result is a new swipe and inform rows are not consumed) with one extra orchestrator option, `forceUncensoredRoute: true`, which makes the orchestrator resolve the effective profile through `resolveUncensoredTextUnderstudy` (phase 1, `exclude: [primary.id]`) before the primary stream and sets `routeVia = 'concierge'`. If no understudy exists the action returns 409 with `{ error: 'no-understudy' }` and the client toasts a pointer to Settings. The chat's state is not changed.

**Picture.** New action `POST /api/v1/chats/[id]?action=retry-image-uncensored` with body `{ toolMessageId }`. The handler finds the assistant message whose `toolCalls` produced that TOOL message, re-runs `runImageGenerationTool` with the same arguments and a new option `forceUncensoredImageProfile: true`, which makes `validateAndLoadProfile` return `resolveUncensoredImageUnderstudy(...)` (409 `no-understudy` when null). The result posts through the ordinary path (a new TOOL message with attachments and trail via `'concierge'`), and the Concierge posts `refusal-rerouted` with `purpose: 'tool'`. For a Lantern picture the body is `{ kind: 'background' }` and the handler enqueues the story-background job with `payload.forceUncensored: true`, which the job honours by resolving the understudy as its primary profile.

**Placement.**
- On the 🚫 placard of a refused assistant row (the row whose last trail entry has `outcome: 'refused'`, or whose content is the empty-response placard): a small `qt-btn-secondary` "Try uncensored" beside the existing regenerate control.
- On a TOOL row whose trail ends in `refused` (phase 1), and on the Concierge's `refusal-no-understudy` / `refusal-not-permitted` bubbles: the same button, wired to the picture action with the bubble's `toolMessageId` (carried in the bubble's `pascalMeta`-style metadata field; add `conciergeMeta: { toolMessageId?, kind? }` to the bubble writer).
- Hidden on Locked chats (four-state: Vouched Safe), where the operator has said never.

Voice on the button is plain ("Try uncensored"); the toast on 409 is in voice: *"There is no uncensored desk to send this to — appoint one under Settings → The Concierge."*

### 2. "Not Dangerous" clears the blur

`MessageRow.tsx:206-210`: `hasDangerFlags = dangerFlags?.some(f => !f.userOverridden)`. BLUR/COLLAPSE and the badge row follow that. The struck-through chips remain visible for the record (they are the only trace that a message was once flagged), so `DangerFlagBadge` keeps rendering when any flag exists, with the "Not Dangerous" button hidden once all are overridden as today. `help/dangerous-content.md:132` (or `the-concierge.md` after phase 4) becomes true.

### 3. The Lantern's refusals reach the chat

In `story-background.ts`, when the phase 1 chokepoint rethrows with a refusal trail and no understudy answered, post a Lantern bubble of a new kind `{ kind: 'background-refused', provider, modelName }` (`LanternNotificationKind` at `writer.ts:31-34`), `systemSender: 'lantern'`, no attachment, `conciergeMeta: { kind: 'background' }` so §1's button can retry it. Voice: *"The Lantern's usual painter would not take the scene — Gemini called it improper and downed brushes. The backdrop stays as it was."* Opaque: *"Story background refused by Gemini on content grounds; the previous backdrop is unchanged."* The job then completes (not fails): a refusal is an outcome, and the operator has been told. The Concierge's own `refusal-*` bubble (phase 1) is **not** posted in addition; one bubble per refusal, and for the Lantern it is the Lantern's, because it carries the retry.

### 4. Badges on Unmoderated chats

Two changes:

- **Server**: the danger orchestrator's branch 1 (`danger-orchestrator.service.ts:65-76`) stops synthesising `dangerFlags`. The chat's route is already decided by state; per-message flags on such a chat say nothing a badge can add. The reroute bookkeeping in that branch (`markFlagsAsRerouted`) is replaced by `setRouteVia(state, 'concierge')`, which the route trail already understands. Consequence: on an uncensored-route chat, user messages no longer show category chips or the "Rerouted" chip; the header pill and the assistant row's route-trail badge carry that information.
- **Client**: the transcript GET already returns the chat; add `resolvedDisplay: { mode, showWarningBadges }` to `GET /api/v1/chats/[id]` computed by the resolver with the chat, and have `VirtualizedMessageList.tsx:322` and `MessageRow.tsx:206-210` read it instead of the global settings. Until phase 4, the resolver value comes from `resolveDangerousContentSettings(global, chat).settings`; after phase 4, from `resolveConciergeSettings(...).display`.

## Decisions of record

- **Retry never changes state.** "Try uncensored" is a per-request escape hatch; switching the chat is the sidebar's job (or the Concierge's after N refusals).
- **One bubble per refusal.** Where a staff member (the Lantern) owns the retry, that staff member's bubble is the one that appears.
- **Struck-through chips stay.** The record of a flag is worth more than a cleaner row.
- **Synthesised flags go.** They existed to make the "Rerouted" chip appear; the route trail now does that job with better information.

## Implementation order

1. §2 (one line and a help sentence).
2. §4 server change, `resolvedDisplay` on GET, client reads.
3. §1 text action and placard button.
4. §3 Lantern refusal bubble, then §1 picture action and the buttons on TOOL rows and bubbles.

## Testing

- **`MessageRow` tests**: all flags overridden → no blur, no collapse, chips still rendered struck through; one flag not overridden → blur.
- **`danger-orchestrator.service.test.ts`**: uncensored-route chat → no `dangerFlags` on the user message, `routeVia` is `'concierge'` when rerouted.
- **Route tests**: `retry-uncensored` on a chat with no understudy → 409; with one → a new swipe whose trail says `via: 'concierge'`; the chat's state unchanged before and after. `retry-image-uncensored` → a new TOOL message with attachments and a `'concierge'` trail entry; unknown `toolMessageId` → 404.
- **Lantern**: a refused background with no understudy completes the job, posts one `background-refused` bubble, and posts no Concierge bubble.
- **UI**: the button is absent on Locked (Vouched Safe) chats; present on a refused assistant row and a refused TOOL row; the 409 toast text.
- **Regression**: a Moderated chat with a configured uncensored desk still shows the "Rerouted" information through the route-trail badge after the synthesised flags are removed.

## Documentation and housekeeping

- `docs/CHANGELOG.md`: the two actions, the blur fix, the Lantern bubble, the removed synthesised flags and the `resolvedDisplay` field.
- `help/dangerous-content.md` (or `the-concierge.md`): "Try uncensored" on turns and pictures; the corrected "Not Dangerous" paragraph; the Lantern's refusal bubble. `help/story-backgrounds.md`: what happens when the painter refuses.
- `docs/developer/API.md`: both actions and `resolvedDisplay`.
- `lib/chat/staff-display-names.ts`: no new sender; `system-message-labels.ts`: label for `background-refused`.
- `.claude/commands/update-documentation.md`: catalog row.
