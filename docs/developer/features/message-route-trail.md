# Feature: Message route trail — every model tried, in order, under the avatar

**Status:** Planned (2026-09-08). Not started.
**Owner subsystems:** the Salon's message row (`app/salon/[id]/components/message-row/`), the chat-message services (`lib/services/chat-message/`), the provider fallback engine (`lib/llm/fallback/`, read-only here), and the Concierge's empty-response reroute (`provider-failover.service.ts`).
**Implementation note:** This spec is written to be executed by Claude Code with minimal further design input. Where a choice existed, it has been made — see [Design decisions](#design-decisions-resolved). Follow CLAUDE.md standing rules throughout (changelog, help docs, debug logging on every touched backend path, export round-tripping, `npx tsc`, `npm run lint`). Plan in the most capable model; Phases 0, 2, 3 and 4 are each written so a cheaper agent can take them with this document as the whole brief. Phase 1 touches the failover seam and should stay with the planning model.

## Motivation

Today an assistant message shows one provider/model badge under the avatar: the profile that *answered*. When that answer came from an understudy — because the primary timed out, hit a rate limit, returned an empty body, or was refused on content grounds and the Concierge sent the turn to an uncensored profile — the badge shows only the last name on the call sheet. The user cannot tell from the transcript that their configured model was ever asked, why it stepped aside, or how many stand-ins were consulted before one answered. The only records are a transient warning toast, the server log, and (when the whole chain fails) the error text.

This feature keeps the **route trail** — every connection profile tried for the turn, in the order tried, with why each one stepped aside — on the saved message, and renders it as a vertical list under the avatar: first tried at the top, the one that answered at the bottom, the failures struck through and marked.

## What the user sees

Under the avatar, in place of the single badge, a list with one row per profile tried, top to bottom in the order tried:

```
❌ ~~openai · gpt-5~~                 ← primary; connection refused
🚫 ~~anthropic · claude-sonnet-5~~    ← understudy; refused on content grounds
   deepseek · deepseek-v4-pro         ← tier pick; answered
```

- **The row that answered** looks exactly like today's badge (provider icon + model name, 60 % opacity). No glyph. A message with no failures renders one row and is pixel-identical to the current UI.
- **A row that fell over on its own** — timeout, network, auth, rate limit, missing model, 5xx, empty body with no stated reason, no usable API key — is struck through and prefixed with ❌.
- **A row that refused on its own safeguards** — the provider reported a moderation finish reason, or returned nothing on a turn the Concierge had flagged — is struck through and prefixed with 🚫.
- **Hover** on any row gives the profile *name* (users name profiles themselves; three OpenAI profiles need telling apart), the provider and model, how it came to be asked (primary / same-profile retry / the Concierge's uncensored reroute / named understudy / tier pick), and the reason it stepped aside, e.g. `Dead Endpoint (failover test) · openai-compatible: gpt-5 — failed: network (Connection error.)` or `Anthropic Sonnet · anthropic: claude-sonnet-5 — refused on content grounds (finish_reason: refusal)`.
- **Adjacent rows for the same profile collapse** into one. The same-profile retry after an empty body is the common case: the storage records two attempts, the display shows one row (answered, if the retry worked) whose tooltip says "answered on the second try".

Glyphs are plain emoji, per the request. They are defined once (`ROUTE_OUTCOME_GLYPH`, below) so a later switch to the themeable `<Icon>` registry (`ban`, `close`, `alert-triangle` exist already) is a one-line change.

## Vocabulary

- **Route trail** (`routeTrail`) — the ordered list of attempts made for one assistant message.
- **Attempt** — one call (or one skipped-before-calling candidate) against one connection profile.
- **Outcome** — `answered`, `failed` (fell over on its own) or `refused` (declined on content grounds).
- **Via** — how the profile came to be asked: `primary`, `retry`, `concierge`, `understudy`, `tier-pick`.

## Storage — a JSON column on `chat_messages`

New nullable JSON column **`routeTrail`** on `chat_messages`, alongside `provider` / `modelName`. It is an ordered array of attempts:

```json
[
  { "profileId": "…", "profileName": "OpenAI gpt-5", "provider": "openai", "modelName": "gpt-5",
    "via": "primary", "outcome": "failed", "trigger": "network", "detail": "Connection error." },
  { "profileId": "…", "profileName": "Anthropic Sonnet", "provider": "anthropic", "modelName": "claude-sonnet-5",
    "via": "understudy", "outcome": "refused", "trigger": "moderation-refusal", "evidence": "finish-reason", "detail": "finish_reason: refusal" },
  { "profileId": "…", "profileName": "DeepSeek", "provider": "deepseek", "modelName": "deepseek-v4-pro",
    "via": "tier-pick", "outcome": "answered" }
]
```

**NULL on every message whose turn had no failure.** A trail of length one says nothing the `provider`/`modelName` columns don't already say, and assistant messages are the largest table in the instance. The renderer treats NULL as "render the badge exactly as today." This is also why there is no backfill: an old message has no trail because nothing was recorded, and the display for it is unchanged.

`provider` and `modelName` stay authoritative for *who answered* — every existing reader (cost tracking, the badge on old rows, exports, the markdown transcript) keeps working. The trail's last entry always agrees with them; a test asserts this.

The column is **ASSISTANT rows only.** Tool-only turns (`saveToolMessages`, `lib/services/chat-message/tool-execution.service.ts:185`) write TOOL rows that carry no provider attribution today, and they get none here.

**Why a column rather than a `system` event or the LLM log.** The trail belongs to the message it explains; it must ride the `.qtap` export with the message, survive a swipe regenerate as that swipe's own record, and render without a second fetch. The LLM-call log (`logLLMCall`) already records every individual call and is the place to look for request bodies — the trail does not duplicate that, it is the *ordering and verdict* the log doesn't give at a glance.

## The schema

**Zod is the single source of truth**, in `lib/schemas/chat.types.ts` (client-safe, already imported by the Salon):

```ts
export const RouteAttemptViaEnum = z.enum(['primary', 'retry', 'concierge', 'understudy', 'tier-pick'])
export const RouteAttemptOutcomeEnum = z.enum(['answered', 'failed', 'refused'])

export const RouteAttemptSchema = z.object({
  profileId: UUIDSchema,
  profileName: z.string(),
  provider: z.string(),
  modelName: z.string(),
  via: RouteAttemptViaEnum,
  outcome: RouteAttemptOutcomeEnum,
  /** The engine's trigger class for a failure or refusal; absent when answered. */
  trigger: z.enum(['auth', 'rate-limit', 'network', 'model-missing', 'provider-error', 'empty-response', 'moderation-refusal']).optional(),
  /** How a refusal was established: the provider said so, or it was inferred from an empty body on a Concierge-flagged turn. */
  evidence: z.enum(['finish-reason', 'inferred']).optional(),
  /** Short human-readable reason, ≤ 200 chars (the error message truncated, or the finish reason). Never the full error body. */
  detail: z.string().max(200).optional(),
})
export type RouteAttempt = z.infer<typeof RouteAttemptSchema>
```

- Add `routeTrail: RouteAttemptSchema.array().nullable().optional()` to `MessageEventSchema` next to `provider` / `modelName` (~line 220), with a doc comment saying it is NULL unless the turn had at least one failure and that the last entry always matches `provider`/`modelName`.
- The `trigger` enum duplicates `FallbackTrigger` from `lib/llm/fallback/types.ts` by value because the schema module must stay client-safe and the engine's module is not imported by the client. Add a type-level assertion in the engine's test (`__tests__/unit/lib/llm/fallback/engine.test.ts`) that the two string unions are identical, so a new trigger cannot be added to one without the other.
- Mirror the shape into `ChatMessageRowSchema` in `lib/database/repositories/chats-messages.ops.ts` (after `pascalMeta`), with the same lockstep comment `pascalMeta` carries. The schema translator (`lib/database/schema-translator.ts`) sees a `ZodArray` and treats the column as JSON — no serializer code to write.
- Add `routeTrail?: RouteAttempt[] | null` to the client `Message` interface in `app/salon/[id]/types.ts` (~line 29, beside `provider`/`modelName`).

## Migration

`migrations/scripts/add-route-trail-message-column-v1.ts`, cloned from `add-pascal-message-meta-v1.ts`: `addColumnIfMissing('chat_messages', 'routeTrail', 'TEXT DEFAULT NULL')`, `sqliteColumnExists` guard, no collection loop (so no `reportProgress`). Register it in `migrations/scripts/index.ts` **everywhere `addPascalMessageMetaMigration` appears** (three places today: the import, and two lists). Pretty label in `lib/startup/prettify.ts`, Quilltap voice, present-continuous, about the user's data — something in the spirit of *"Pinning the call sheet to every reply…"*.

Update `docs/developer/DDL.md`'s `chat_messages` block with the column and a trailing comment in the style of `pascalMeta`'s.

## Export / import / backup

- **`.qtap` export:** messages ride whole-row; add `routeTrail` to the message properties in `public/schemas/qtap-export.schema.json` (beside `pascalMeta`, ~line 882) with the full nested shape and enums. Run the export-schema tests.
- **Import:** `addMessage` parses against `ChatEventSchema`, so the field on `MessageEventSchema` is what lets it through. A bundle from an older version simply has no field → NULL. `profileId` in an imported trail may point at a profile that does not exist in the importing instance; that is fine — the trail is display-only and the renderer never dereferences it. **Do not add `routeTrail.*.profileId` to the reconcile remapper** (`lib/import/quilltap-import/reconcile.ts`); a stale id in a historical record is the truth of what happened.
- **Backup/restore:** generic row copy; nothing to do. Verify by restoring a backup that contains a trailed message in the test.
- **SillyTavern export:** not applicable; the format has no slot for it.
- **Markdown transcript** (`lib/export/markdown-transcript.ts`): out of scope. Optional follow-up: a one-line "(answered by X after Y, Z stepped aside)" note.

## Recording — one chokepoint on `StreamingState`

New module **`lib/services/chat-message/route-trail.ts`** (server side; fires debug logs). It is the only writer of the trail.

```ts
/** Append a failed or refused attempt. */
export function recordRouteFailure(state: StreamingState, profile: ConnectionProfile, via: RouteAttemptVia,
  outcome: 'failed' | 'refused', trigger: FallbackTrigger, detail?: string, evidence?: 'finish-reason' | 'inferred'): void

/** Tag how the current `state.effectiveProfile` came to hold the turn. */
export function setRouteVia(state: StreamingState, via: RouteAttemptVia): void

/** Classify an empty body: a moderation finish reason is a refusal; an empty body on a
 *  Concierge-flagged turn is an inferred refusal; anything else is a plain empty response. */
export function classifyEmptyBody(state: StreamingState, contentWasFlaggedDangerous: boolean):
  { outcome: 'failed' | 'refused'; trigger: 'empty-response' | 'moderation-refusal'; evidence?: 'finish-reason' | 'inferred'; detail?: string }

/** The persisted value: NULL when nothing failed, else the failures followed by the answering
 *  profile (`state.effectiveProfile`, `state.routeVia`, outcome 'answered'). */
export function buildRouteTrail(state: StreamingState): RouteAttempt[] | null
```

`StreamingState` (`lib/services/chat-message/types.ts:330`) gains two fields:

```ts
/** Every attempt that did not answer, in order. Written only by route-trail.ts. */
routeFailures: RouteAttempt[]
/** How `effectiveProfile` came to hold the turn. Set beside every effectiveProfile swap. */
routeVia: RouteAttemptVia   // initialised 'primary'
```

Initialise both wherever `StreamingState` is constructed (grep `hasStartedStreaming: false` — the orchestrator and any test factories).

`classifyEmptyBody` reads `extractFinishReason(state.rawResponse)` through `isModerationFinishReason` (`lib/llm/moderation-finish-reason.ts`). **It must be called before `resetStreamingBuffersForSwap`**, which clears `rawResponse`; every site below already checks the body before it swaps, so the ordering is natural — but say so in a comment at each site.

`detail` is the error message truncated to 200 characters; for a refusal it is `finish_reason: <reason>`; for a key-less understudy it is the key-resolution reason. Never store the full error body — it can be long and can carry request fragments.

### Recording sites

All in `lib/services/chat-message/provider-failover.service.ts` unless noted. Each is one or two lines at a point that already logs.

| Site | What to record |
|---|---|
| `attemptHardErrorFailover` — after the `trigger` is known and the chain is going to be walked | `recordRouteFailure(state, state.effectiveProfile, state.routeVia, 'failed', trigger, message)`. The primary's failure is what opens the chain; `via` is whatever the effective profile already was (it is `concierge` when the Concierge's *pre-call* reroute had swapped it). |
| `walkFallbackChain` — key-less candidate (`!keyResolution.ok`) | `recordRouteFailure(state, understudy, viaOf(candidate.kind), 'failed', 'auth', keyResolution.reason)` |
| `walkFallbackChain` — `catch (understudyError)` | `recordRouteFailure(state, understudy, viaOf(candidate.kind), 'failed', understudyTrigger, message)` |
| `walkFallbackChain` — understudy came back empty | `const verdict = classifyEmptyBody(state, context.dangerous)` **before** the next iteration's reset; `recordRouteFailure(state, understudy, viaOf(candidate.kind), verdict.outcome, verdict.trigger, verdict.detail, verdict.evidence)` |
| `walkFallbackChain` — success (`state.effectiveProfile = understudy`) | `setRouteVia(state, viaOf(candidate.kind))` |
| `attemptEmptyResponseRecovery` — top, once, when the body is empty and no tools ran | `const verdict = classifyEmptyBody(state, contentWasFlaggedDangerous)`; `recordRouteFailure(state, state.effectiveProfile, state.routeVia, verdict…)` |
| `attemptEmptyResponseRecovery` — same-profile retry: `catch`, or still empty afterwards | `recordRouteFailure(state, state.effectiveProfile, 'retry', …)` (classify the second empty body the same way) |
| `attemptEmptyResponseRecovery` — same-profile retry succeeded | `setRouteVia(state, 'retry')` |
| `attemptEmptyResponseRecovery` — uncensored reroute: `catch`, or still empty | `recordRouteFailure(state, routeResult.connectionProfile, 'concierge', …)`. Note the existing code does **not** swap `effectiveProfile` when the uncensored profile comes back empty, so this profile is otherwise absent from every record — this row is the one the user asked for. |
| `attemptEmptyResponseRecovery` — uncensored reroute succeeded (`state.effectiveProfile = routeResult.connectionProfile`) | `setRouteVia(state, 'concierge')` |
| `attemptEmptyResponseChainFallback` | Nothing extra: its opening failure is already recorded by the site above it, and the walk records its own. |

`viaOf(kind: FallbackCandidateKind)` maps `configured → 'understudy'`, `tier-pick → 'tier-pick'`, `primary → 'primary'` (unreachable in a walk — the primary is always in `alreadyTried` — but total).

**Do not** refactor `FallbackChainResult.attempts` / `summarizeFallbackAttempts` / `getEmptyResponseReason` to read from the trail. They are the per-walk transient that feeds the error text; the trail is the per-message persisted record. They overlap and that is accepted — the alternative is threading `StreamingState` into the engine, which is provider-layer code that must stay ignorant of chat state.

**The Concierge's pre-call reroute** (`danger-orchestrator.service.ts`, both `resolveProviderForDangerousContent` calls) swaps the profile *before any call is made*. The original profile was never tried, so it gets **no row** — the request is "every model that was tried." The existing `DangerFlagBadge` already says "rerouted to X" for that case. Set `streamingState.routeVia = 'concierge'` when the pre-call reroute happened (the orchestrator constructs `StreamingState` after `resolveDangerousContent` returns; it knows `effectiveProfile !== connectionProfile`), so that if the *uncensored* profile then fails and its understudy answers, the trail's first row is honestly labelled. See [Design decisions](#design-decisions-resolved) for the "stood aside" row that was considered and dropped.

### Persisting and streaming it

- `saveAssistantMessage` (`message-finalizer.service.ts:544`) gains a `routeTrail?: RouteAttempt[] | null` parameter, written as `routeTrail: routeTrail ?? null` on the message object. `finalizeMessageResponse` passes `buildRouteTrail(streaming)`. Grep every other `saveAssistantMessage` caller (recovery, text/native tool loops, regenerate-swipe) and pass the trail from whatever `StreamingState` they hold; the token/content-limit recovery path (`recovery.service.ts`) runs on the same profile and will build NULL, which is correct.
- `encodeDoneEvent` (`streaming.service.ts:620`) gains `routeTrail?: RouteAttempt[] | null`; `finalizeMessageResponse` sends it beside `provider` / `modelName` so the client's optimistic message carries it without waiting for `fetchChat`. The tool-save `done` (`orchestrator.service.ts` ~1700) and the empty-response `done` (~1745) do not need it: the former saves no assistant row, the latter saves nothing (the attempt roll is already in `emptyResponseReason`).
- Log at `debug` in `buildRouteTrail` when the trail is non-null: chatId, message id when known, and `trail.map(a => ({ profileName, via, outcome, trigger }))`.

**Forked job child (autonomous rooms):** `handleSendMessage` runs in the child for autonomous turns and the message write is buffered and shipped over IPC. The trail is plain JSON and rides the same `addMessage` payload; nothing to do. Confirm in the Phase 3 test that a trailed message written through the child proxy round-trips (there is an existing autonomous-turn test to extend).

**Realtime:** no new polling site, no new topic. The message arrives via the existing `done` event and `fetchChat`.

## Rendering

New client-safe helper **`lib/chat/route-trail-display.ts`** (no logging, no server imports; the Salon and tests import it):

```ts
export const ROUTE_OUTCOME_GLYPH = { failed: '❌', refused: '🚫' } as const
/** Adjacent entries for the same profileId collapse into one row carrying `attempts` and the last outcome. */
export function collapseRouteTrail(trail: RouteAttempt[]): RouteTrailRow[]
/** Tooltip text: "<profileName> · <provider>: <model> — <how it was asked>; <what happened>". */
export function describeRouteAttempt(row: RouteTrailRow): string
/** Accessible label for the glyph: "failed" / "refused on content grounds". */
export function routeOutcomeLabel(outcome: RouteAttemptOutcome): string
```

`describeRouteAttempt` wording is user-facing and therefore in the Quilltap voice, briefly: *"stood in as the understudy"*, *"drafted from the company by tier"*, *"sent by the Concierge"*, *"answered on the second try"*, *"refused on content grounds (finish_reason: content_filter)"*, *"fell over: rate-limit (429 Too Many Requests)"*.

New component **`components/ui/RouteTrailBadge.tsx`**:

- Props `{ routeTrail: RouteAttempt[]; size?: 'xs' | 'sm' }`. Renders `collapseRouteTrail(routeTrail)` as a `<ul>` with `aria-label="Models tried for this reply"`, one `<li>` per row, first tried at the top.
- Each row reuses `ProviderModelBadge` for the icon + model text (pass `title={describeRouteAttempt(row)}` so the existing tooltip slot carries the explanation). A failed/refused row wraps it in `<s>` and prefixes `<span role="img" aria-label={routeOutcomeLabel(outcome)}>{glyph}</span>`. The answered row has no glyph and no strike.
- Styling uses only Tailwind utilities already present in the app (`ProviderModelBadge` sets the precedent — verify with grep before adding any class not already in use; `line-through` and the opacity steps are). **No new `qt-*` classes** — a new `qt-*` class triggers the theme-storybook mirror and its `npm publish` gate, which is not worth it for a strikethrough. Record in the changelog that theme authors can target the list through `[aria-label="Models tried for this reply"]` for now, and open a follow-up if a `qt-chat-route-trail` hook is wanted.

`MessageDesktopAvatar` (`app/salon/[id]/components/message-row/MessageDesktopAvatar.tsx`): the `badge` prop gains `routeTrail?: RouteAttempt[] | null`. When it is a non-empty array render `<RouteTrailBadge>`; otherwise render `<ProviderModelBadge>` exactly as today. `MessageRow.tsx` passes `routeTrail: message.routeTrail` at both call sites (~lines 235 and 281; the Courier bubble path included). The avatar column is `w-32`; rows truncate the model name the way the badge already does, and the list grows downward — check it against a three-row trail in the desktop layout and that the row's min-height does not push the next message.

`useSSEStreaming.ts`: both optimistic assistant-message pushes (~lines 881 and 920) copy `routeTrail: data.routeTrail ?? null` from the `done` event.

**Mobile:** there is no avatar badge on the mobile layout today, so there is no trail there either. Not in scope.

**Memo guard:** `MessageRow` is memoised with a custom comparator; a message's `routeTrail` is set once at save and never mutated, so no comparator change is needed. Note this in the comparator's comment so the next person does not add a deep compare.

## Design decisions (resolved)

- **Failures are recorded at the failure sites; the answer is composed at finalization.** Considered having every success site push an `answered` entry. Rejected: the common turn has no failures and must write nothing, and the primary's "success" is only known after the empty-body check runs, which would have put the push in a different function from the call. `routeVia` + `buildRouteTrail` keeps one composer.
- **NULL, not a one-entry trail, when nothing failed.** Zero growth on the common path; the badge already carries the answer.
- **The Concierge's pre-call reroute gets no row.** The original profile was never asked. A "stood aside" row (a third glyph, "the Concierge did not put the question to it") was considered; it would be the only row describing a call that never happened and the `DangerFlagBadge` already shows the reroute. If wanted later it is one extra `outcome` value and one glyph.
- **Inferred refusals wear the same glyph as stated ones.** An empty body on a turn the Concierge flagged is treated as a refusal (that is the existing code's own reading — it skips the same-profile retry on that basis). The tooltip says "inferred" so the user knows which kind of evidence it is.
- **Adjacent same-profile rows collapse in the renderer, not in storage.** Storage is the faithful audit; the collapse is presentation.
- **Emoji, not the icon registry.** As requested. Defined in one constant so the swap is trivial.
- **No new `qt-*` classes.** See Rendering.
- **The tool-continuation calls inside a tool loop are not in the trail.** The trail covers the opening call(s) that produced the message. A continuation call that hard-fails today has no chain either; when it gets one, its attempts should be recorded through the same `recordRouteFailure` — the seam is ready.
- **`profileId` is stored but never dereferenced by the UI.** A deleted profile leaves its name and model in the historical record; nothing links out.

## Phases

### Phase 0 — schema and storage (delegable)

- [ ] `RouteAttemptSchema` + `routeTrail` on `MessageEventSchema` (`lib/schemas/chat.types.ts`).
- [ ] Row schema entry in `chats-messages.ops.ts`; `Message.routeTrail` in `app/salon/[id]/types.ts`.
- [ ] Migration `add-route-trail-message-column-v1` + three registrations in `index.ts` + pretty label in `prettify.ts`.
- [ ] `DDL.md` chat_messages block; `qtap-export.schema.json` message properties.
- [ ] `npx tsc` clean; `npm run lint` clean (the spelling sweep covers the migration label).

### Phase 1 — recording (planning model)

- [ ] `StreamingState.routeFailures` / `routeVia`, initialised at every construction site.
- [ ] `lib/services/chat-message/route-trail.ts` with the four functions above, debug logs on each.
- [ ] Every recording site in the table, each with the "before reset" comment where it applies.
- [ ] `routeVia = 'concierge'` after a pre-call reroute in the orchestrator.
- [ ] `saveAssistantMessage` parameter threaded from every caller; `encodeDoneEvent` field; `finalizeMessageResponse` passes both.
- [ ] Trigger-union parity assertion in `engine.test.ts`.

### Phase 2 — rendering (delegable)

- [ ] `lib/chat/route-trail-display.ts` (client-safe) with glyphs, collapse, tooltip text.
- [ ] `components/ui/RouteTrailBadge.tsx`; `MessageDesktopAvatar` branch; `MessageRow` prop pass-through; `useSSEStreaming` copies from `done`.
- [ ] Check the three-row case visually on V4test (below) in light and dark and in the Madman's Box theme.

### Phase 3 — tests (delegable)

Follow the Jest mock conventions (global `jest`, subject-imports-first, bare factories).

- [ ] `__tests__/unit/lib/services/chat-message/provider-failover-chain.test.ts` — trail contents for: hard error → understudy answers (`[primary failed/network, understudy answered]`); hard error → understudy fails → tier pick answers; key-less understudy skipped (`failed/auth`, detail = reason); understudy empty with `finish_reason: content_filter` → `refused`, `evidence: finish-reason`; chain exhausted → `buildRouteTrail` still lists every failure (used only by the log).
- [ ] `provider-failover.service.test.ts` — empty → retry answers (`[primary failed/empty-response, …]` and `routeVia === 'retry'`); empty on a flagged turn → uncensored answers (`[primary refused/inferred, uncensored answered via concierge]`); uncensored also empty then understudy answers (three rows, the uncensored one present); no failure → `buildRouteTrail` returns null.
- [ ] `message-finalizer.service.test.ts` — `saveAssistantMessage` persists `routeTrail`; `done` event carries it; last entry's provider/model equal the message's `provider`/`modelName`.
- [ ] `lib/chat/__tests__/route-trail-display.test.ts` — collapse of adjacent same-profile rows keeps order and last outcome; non-adjacent same-profile rows do not collapse; tooltip strings for each `via` × `outcome`.
- [ ] `RouteTrailBadge` render test — order top-down, `<s>` only on failed/refused, glyph per outcome, `aria-label`s, single-row trail renders one un-struck row.
- [ ] `useSSEStreaming` — `done` with `routeTrail` lands on the optimistic message (extend one of the existing `useSSEStreaming-*.test.ts` files).
- [ ] Export-schema fixture: a message with a trail validates against `qtap-export.schema.json`; a bundle without the field imports as NULL.
- [ ] Autonomous-turn test: a trailed message written through the child proxy round-trips.

### Phase 4 — docs (delegable)

- [ ] `docs/CHANGELOG.md` under the current dev version, plain American English: what is stored, what is shown, the two glyphs, NULL when nothing failed, the theme-hook note.
- [ ] `help/chats.md` (url `/salon`): a section on the list under the avatar — what the strike and the two marks mean, that hovering names the profile and the reason, and that a reply with no list had no trouble. Quilltap voice; the "call sheet" image fits. Keep its `help_navigate` call matching its `url`.
- [ ] `help/connection-profiles.md`, "The Understudies: Fallback": one paragraph saying the transcript now shows who was asked before the understudy answered.
- [ ] `help/dangerous-content.md`: one paragraph beside the provider-refusal section saying a refusal now leaves a 🚫 mark on the reply the uncensored profile eventually gave.
- [ ] `docs/developer/features/complete/provider-fallback.md`: a "See also" line pointing here; move this file to `complete/` with an "As built" section when done.
- [ ] `docs/developer/API.md` if it lists message fields.
- [ ] Bug 93's write-up (`docs/developer/bugs/fixed/`) gains a pointer: the refusal is now visible on the message, not only in the error text.

### Verification on V4test

`~/iCloud/Quilltap/V4test` is the try-it-out instance (never Friday). The provider-fallback feature was verified with a profile pointed at `http://127.0.0.1:9/v1`; reuse that:

1. Primary = dead endpoint, understudy = a live profile → reply shows `❌ ~~dead~~` over the live model.
2. Primary = dead, understudy = second dead endpoint, `allowTierFallback` on → three rows, two struck.
3. Concierge in Auto-Route with a mainstream primary and a refusal-prone prompt → `🚫` on the primary over the uncensored model; check the tooltip says whether it was stated or inferred.
4. Any normal reply → badge unchanged, `routeTrail` NULL (confirm with `npx quilltap` against the instance, read-only).
5. Export the chat to `.qtap`, import into a fresh instance, confirm the trail renders there.
6. Swipe-regenerate on a trailed message → the new swipe has its own trail (or NULL), the old one keeps its own.

## Risks and traps (read before implementing)

- **`resetStreamingBuffersForSwap` clears `rawResponse`.** Every empty-body classification must run before it. The sites in the table are already ordered that way; keep them so.
- **The uncensored profile that comes back empty is not `effectiveProfile`.** Record it from `routeResult.connectionProfile`, not from `state`.
- **Three registration points for the migration.** `index.ts` lists migrations in more than one place; grep the Pascal one and mirror every hit.
- **`Message` on the client is hand-maintained** (`app/salon/[id]/types.ts`), separate from the Zod type. Add the field there or the optimistic push will not type-check.
- **Do not deep-compare in the `MessageRow` memo.** The trail is immutable after save.
- **Do not remap `profileId` on import.** It is a historical reference, not a live one.
- **Keep `provider` / `modelName` as the answer of record.** Nothing new should read the trail to find who answered.
- **The trigger enum is duplicated on purpose** (client-safe schema vs. server engine). The parity test is what keeps them honest; write it.
