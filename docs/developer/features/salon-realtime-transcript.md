# The Salon transcript as a subscribed read — demoting SSE to display-only

> **Status:** Proposed (2026-09-11). Not implemented. Written to be argued with before any code moves.
> **Scope:** How a message — any message — reaches an open Salon tab. Today there is exactly one path, the read loop of the `POST /api/v1/messages` fetch, and it is both the transport *and* the authority. This plan makes the socket-hinted re-read authoritative and demotes the SSE stream to a display-only overlay for the turn currently in flight. The turn manager is untouched: people still take turns, and the server still decides whose turn it is.
> **Prerequisite reading:** [realtime-updates.md](complete/realtime-updates.md) (the design of record for the hint bus — its decisions 1, 4 and 8 are load-bearing here), [tanstack-query-migration.md](complete/tanstack-query-migration.md), and [BACKGROUND_JOBS_CHILD.md](../BACKGROUND_JOBS_CHILD.md).

---

## 1. The feature in one paragraph

The Salon's transcript is the last major read in the application that cannot be told it is stale. Messages live in a plain `useState` array (`app/salon/[id]/hooks/useChatData.ts:15`), filled once at mount from `GET /api/v1/chats/:id` and thereafter mutated only by the SSE read loop of whichever `POST /api/v1/messages` request the tab itself issued. Nothing else can add a message to the display — not a second tab, not a reconnect, not the forked child posting an Aurora wardrobe note or a Lantern backdrop. This plan inverts the authority: a chat-scoped realtime hint (`{topic:'chats', id}` — already published, see §3) triggers a re-read of the transcript through the REST API, and *that* is what the room is. The SSE stream keeps carrying tokens for the turn being generated, but it stops being how anything is *delivered*; it paints a provisional bubble that the authoritative read replaces. A dropped stream then costs a typing animation instead of a turn.

### 1.1 The incident that motivated this

Chat `9be06466…`, 2026-09-11, on a live instance. The operator sent a line through the new "In Their Own Words" review dialog. Server-side everything succeeded: the user message persisted at 12:49:25.818Z (`47a3a91d…`), the orchestrator selected Abigail as next speaker, and her reply persisted at 12:49:59.812Z (`71369b19…`) — a plain `ASSISTANT` row, no `systemSender`, no `targetParticipantIds`, fully renderable. **The reply never appeared in the tab.** It is still in the database, recoverable by reloading the chat.

No error was logged anywhere, and none could be: `safeEnqueue` swallows writes to a closed controller, so a client that has gone away is indistinguishable from one that is listening. The 34-second generation window, following a long human-in-the-loop pause in the review dialog, is precisely when an operator tabs away. Nothing existed to tell the tab to look again.

This is not a bug in the impersonation-voice feature. That path was verified argument-identical to a normal composer submit. It is a structural gap that the feature merely made easy to hit — and the same gap is why, as the operator put it, the incidentals are "very hit-and-miss beside the actual chat messages."

## 2. Design decisions settled (do not re-litigate)

1. **Hints stay hints.** This does not amend decision 1 of the realtime design. The socket carries `{v:1, topic:'chats', id}` and never a message body. There is no second serialization of a message to drift from the REST shape. This plan *extends the coverage* of the existing hint bus to a read that was left out of it; it changes no protocol.
2. **Token streaming stays on SSE.** Per-token deltas cannot ride a 250 ms-coalesced invalidation bus (`lib/realtime/bus.ts:43`) without becoming a refetch per token. SSE keeps carrying tokens, tool batches, `carinaAnswer`, and status events. What it loses is *authority*, not its job.
3. **The re-read is the source of truth; the stream is an overlay.** Rendering is: authoritative rows from the transcript read, plus at most one provisional in-flight bubble. The moment a persisted row for that turn arrives, the provisional bubble is dropped. This is the inversion — everything else here is consequence.
4. **Reuse the `chats` topic, scoped by chat id.** `REPOSITORY_TOPICS` already maps the `chats` repository namespace to the `chats` topic (`lib/realtime/job-topics.ts:106`) and `TOPIC_ID_FIELDS` already extracts the chat id (`:122`). A new `chatMessages` topic would widen the enum to buy nothing, because the client already narrows by id (`hooks/useRealtime.ts:119`). The cost — a Lantern backdrop hint also nudging the transcript — is paid off by decision 5.
5. **The transcript read must be conditional.** A hint-driven unconditional re-read of the whole transcript is the amplification trap: one busy turn fires wardrobe, backdrop, whisper and memory hints against a transcript whose individual Commonplace whispers run to 17 KB. The read answers "nothing changed" cheaply, so a hint storm costs round trips, not payloads.
6. **No new polling site.** Per the standing rule, the fallback is the socket's own reconnect catch-up — `useRealtimeTopic` fires its handler on socket open (`hooks/useRealtime.ts:122`), so a tab that slept re-reads for free. The next mount is the degraded-mode fallback. Do not add an interval.
7. **The turn manager is out of scope.** Speaking order, cycle bookkeeping, skip eligibility and the fairness pause are unchanged. This plan is about delivery, not about whose turn it is.

## 3. Architecture map (where things live today)

Paths repo-relative; line numbers as of the commit this plan was written against.

**The read model — the core problem:**
- `app/salon/[id]/hooks/useChatData.ts:15` — `const [messages, setMessages] = useState<Message[]>([])`. **The transcript is not a TanStack query.** There is nothing to invalidate, which is the whole reason the Salon could not participate in the realtime bus.
- `useChatData.ts:21-70` — `fetchChat`: reads `GET /api/v1/chats/:id` (`:23`), takes `data.chat.messages` (`:28`), collapses swipe groups defaulting to the newest variant (`:46-58`), sorts by `createdAt` (`:61`), then `setMessages` / `setSwipeStates`. The whole transcript arrives embedded in the chat object.
- `useChatData.ts:86-95` — the precedent, and the proof the reasoning is already accepted here: the memory count subscribes via `useRealtimeTopic('memories', …)` with a comment describing this exact class of bug ("without a path by which the server can say 'this changed', the number … stays frozen at whatever was true when the tab opened"). This plan applies that same argument to the transcript.
- `app/api/v1/messages/route.ts:26-54` — `GET /api/v1/messages?chatId=` exists, returns every `type === 'message'` event with no cursor and no conditional. The Salon does not currently use it.
- `lib/query/keys.ts:34-54` — the `chats` namespace. **There is no `messages` key.**

**Delivery today — the single point of failure:**
- `app/salon/[id]/hooks/useSSEStreaming.ts:827` — the one `POST /api/v1/messages?chatId=` fetch; `:845-848` takes the reader and hands it to `readSSEStream`. This read loop is the only way a generated reply reaches the tab.
- `useSSEStreaming.ts:784-806` — the optimistic user bubble (`temp-user-${Date.now()}`), attributed via `findActiveUserParticipant` so the impersonation overlay is honoured (Bug 45). The `temp-` prefix is the dedupe seam §4.3 builds on.
- `lib/services/chat-message/orchestrator.service.ts:359-363` — `turnStart` carries the server's actual responder, correcting the client's `getFirstCharacterParticipant()` guess.

**Subscriptions that exist but do not help:**
- `app/salon/[id]/SalonView.tsx:286` — the Salon's only `useRealtimeTopic('chats', …)`. Its callback does an **avatar check and nothing else**.
- `lib/realtime/topic-map.ts` — `queryKeysForTopic('chats', id)` returns `detail` / `state` / `background` / `gallery`. No transcript key, because none exists.

**The publish side — mostly already done:**
- `lib/database/repositories/chats-messages.ops.ts:309` (`addMessage`) and `:374` (`addMessages`) — the single write funnel for every message in the system, already the chokepoint that maintains `messageCount` and the cycle bookkeeping (`:346-364`). **This is the natural publish site.**
- `lib/realtime/bus.ts:115-116` — `publishRealtime` is `if (IS_JOB_CHILD) return`. A call placed in the funnel is therefore correct in both worlds: it fires in the parent and no-ops in the child, so there is no double-publish to reason about.
- `lib/background-jobs/host/job-dispatcher.ts:529-531` → `topicsForWriteBatch` (`lib/realtime/job-topics.ts:169`) — **child-written messages already publish `{topic:'chats', id: chatId}` after commit.** Every Aurora note, Lantern backdrop and Commonplace whisper written from the forked child is *already announcing itself*. The hint is flying today and nothing is listening for it.

That last point is the good news: the "incidentals are hit-and-miss" half of this problem is a client-side subscription away from being solved.

## 4. The design

### 4.1 Publish

One call in the funnel, covering both `addMessage` and `addMessages`, plus the delete and update paths in the same ops module (a swept whisper and an edited row are transcript changes too):

```ts
publishRealtime('chats', chatId)   // no-op in the job child by construction
```

No change to `REALTIME_TOPICS`, `topic-map.ts`'s topic switch, or the envelope.

### 4.2 The conditional transcript read

Add `queryKeys.chats.messages(id)` and a read the Salon owns, then add that key to `queryKeysForTopic('chats', id)` so the existing hint drives it.

The open question worth deciding before implementation is **how the read answers "unchanged" cheaply**. The recommendation is a `transcriptVersion` integer on the chat row, bumped at the same funnel that publishes, with `GET /api/v1/messages?chatId=&knownVersion=N` returning either `{unchanged: true}` or `{version, messages}`. It is exact under appends, edits *and* deletions — which a naive `since=<timestamp>` cursor is not, and this transcript genuinely deletes rows (the Commonplace whisper sweep) and mutates them (swipes, regenerate, `dangerFlags`). Timestamps also tie in practice: this chat has message pairs 41 ms and 5 ms apart.

The cost is a column, which per the standing conventions means a migration (with its pretty-label and progress reporting), a [DDL.md](../DDL.md) update, and a decision about whether it belongs in `.qtap` export (it should not — it is derived bookkeeping, and import should simply start it at zero).

Keyset pagination (`since=(createdAt, id)`) is deliberately **not** in v1. With a conditional read the common case is already cheap, and paginating a transcript that must also reflect deletions is a materially harder problem. Revisit only if measurement demands it.

### 4.3 Reconciling the stream with the read

The provisional bubble stops living in the authoritative array:

- Streaming content for the turn in flight is held in its own slot, keyed by the turn, not spliced into `messages`.
- Render = authoritative rows + at most one provisional bubble.
- The provisional bubble is dropped as soon as the authoritative read contains a row for that turn. The existing `temp-` id prefix and the `turnStart` participant id give the seam to match on.
- A refetch landing mid-stream must therefore be *safe*, which is the property the whole plan is buying.

Two pieces of state need explicit care, because today they are recomputed wholesale by `fetchChat` and would be yanked out from under the operator by a mid-turn refetch:

- **Swipe selection.** `fetchChat` resets every swipe group to the newest variant (`useChatData.ts:46-58`). A refetch must preserve the operator's current selection.
- **Scroll anchor.** Replacing the array must not jump the viewport.

### 4.4 What this fixes beyond the reported bug

- An interrupted or dropped stream no longer loses a turn — the reply lands on the next hint.
- Incidentals appear when they land, rather than only if they happened to be enqueued into an open stream at the right moment.
- The workspace's hidden, kept-alive Salon tab stays current instead of freezing at mount state.
- Reconnect after sleep re-reads for free (`useRealtime.ts:122`).

## 5. Phases

**Phase 0 — the safety net (fixes the reported bug on its own).** Publish at the funnel (§4.1); subscribe in `useChatData` with `useRealtimeTopic('chats', fetchChat, chatId)`. Two small changes, end-to-end correctness restored. Accepts an unconditional whole-chat refetch per hint as a known, temporary cost — and must ship §4.3's swipe and scroll preservation, because `fetchChat` now runs while the operator is mid-conversation rather than only at mount.

**Phase 1 — the conditional read (§4.2).** Retires Phase 0's amplification: `transcriptVersion`, the versioned endpoint, `queryKeys.chats.messages`, the `topic-map` row.

**Phase 2 — demote the stream (§4.3).** Move streaming content out of the authoritative array; make the provisional bubble a true overlay. This is the phase that actually delivers decision 3, and the one to take slowly.

**Phase 3 — cleanups this work exposes.** Two latent defects found while diagnosing the incident, both worth their own bug entries rather than being smuggled in here:
- `userStoppedStreamRef` is written in three places (`useChatControls.ts:171`, `:224`, `useSSEStreaming.ts:739`) and **never read anywhere**. Stop/pause is not gating stream processing at all.
- `useSSEStreaming.ts:735` silently `return`s when `sending` is true, with no feedback. A send swallowed by that guard is indistinguishable to the operator from one that failed.

## 6. Risks

- **Refetch amplification** — the reason §4.2 exists; Phase 0 knowingly carries it in the interim.
- **Mid-turn state churn** — swipe selection and scroll anchor (§4.3). The most likely source of a bad first impression.
- **Provisional/authoritative flicker** — the Bug 45 failure mode (bubble briefly attributed to the wrong author). Attribution on the optimistic bubble already goes through `findActiveUserParticipant`; the reconciliation must not regress it.
- **Ordering** — the authoritative read sorts by `createdAt`, and near-simultaneous staff messages tie. Whatever ordering the read settles on should be the one the client trusts, rather than a second client-side sort that can disagree with it.

## 7. Verification

- Unit: the funnel publishes for add/update/delete; no publish from the child (assert the `IS_JOB_CHILD` no-op holds).
- Integration: a hint for chat A does not refetch chat B; an unchanged transcript answers `unchanged`.
- **The regression test that matters, and the one to write first:** post a turn, sever the SSE stream mid-generation, and assert the reply still reaches the display. That is the incident in §1.1, and today it fails.

## 8. Deviations from this plan

To be filled in as it is implemented, per house practice.
