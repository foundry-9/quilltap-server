# Concierge Overhaul — Phase 3: Moderated, Unmoderated, Locked

**Status:** Implemented (4.10-dev, 2026-09-25) — see [As built](#as-built) for where the shipped code departs from the plan.
**Scope:** quilltap-server. Three new columns on `chats` and one data migration; the `ConciergeState` union, its predicates and presentation table; the PUT and POST wire contract; the sidebar and New Chat controls; the header pill, list marks and quick-hide; export schema and DDL. No settings change, no plugin or package change.
**Prerequisites:** [Phase 1](concierge-overhaul-phase-1-refusal-failover.md) and [Phase 2](concierge-overhaul-phase-2-refusal-ledger.md) landed. This spec assumes `applyConciergeFlip(chatId, requested, chat, { by, reason })` exists and that refusals are counted. It can be read on its own; every file it touches is cited.
**Supersedes:** [concierge-four-state.md](complete/concierge-four-state.md) §1, §3, §5, §6 and [concierge-list-marks.md](complete/concierge-list-marks.md) §"Design".
**Part of:** [concierge-overhaul.md](concierge-overhaul.md) (phase 3 of 5).

## Summary

Collapse the four per-chat states into the three the user actually reasons about:

| State | Text and cheap LLM | Images | Failover on refusal | Concierge may auto-switch |
|---|---|---|---|---|
| **Moderated** (default) | ordinary provider first | ordinary profile first | yes | yes (to Unmoderated) |
| **Unmoderated** | uncensored desk only, candid prompts | uncensored desk only, candid prompts | n/a | n/a |
| **Locked** | ordinary only | ordinary only | never | never |

Who put the chat in Unmoderated — the Concierge (after refusals, or the classifier) or the operator — is recorded as *provenance* and shown as a note on the badge and in the helper text. It is no longer a separate state, because the two states it used to split (Flagged and Uncensored) differed only by two accidents: Flagged obeyed the global mode and painted red.

## Goals

- One select with three plainly named options and helper text that says what each does to routing.
- `getConciergeState` returns one of three values; the predicates ask the three questions call sites actually have (route? style? may the Concierge act?), plus one new one (may failover run?).
- Every existing chat lands in the state that preserves its behaviour.
- No stored or wire value is reused with a new meaning.

## Non-goals

- The global mode (retired in phase 4). In this phase Unmoderated forces `AUTO_ROUTE` exactly as the old Uncensored did; Moderated obeys the global mode.
- Settings UI (phase 4).
- Removing the old columns. They stop being written; removal is a later housekeeping migration.

## Known State (verified 2026-09-25)

- **Storage**: `chats.isDangerousChat` (label) and `chats.conciergeOverride` (`NULL` | `'OFF'` | `'UNCENSORED'`), `docs/developer/DDL.md:549-554`. Phase 2 added `moderationRefusalCount` and `lastModerationRefusalAt`.
- **Derivation**: `getConciergeState` (`lib/services/dangerous-content/chat-override.ts:70-74`) → `'monitored' | 'flagged' | 'vouched' | 'uncensored'`; predicates `conciergeStateUsesUncensoredRoute` (:86), `shouldUseUncensoredRoute` (:98), `shouldShowDangerStyling` (:110), `isClassifierOnDuty` (:121).
- **Transitions**: `applyConciergeFlip` (`manual-flip.ts:55-130`), announcement kinds `manual-flagged` / `manual-safe` / `manual-resumed` / `manual-vouched` / `manual-uncensored` (`concierge-notifications/writer.ts:171-176`) plus phase 2's `auto-flagged-refusals`.
- **Resolver**: `resolveDangerousContentSettings(global, chat)` (`resolver.service.ts:77-130`): exempt chat types and `'vouched'` → `VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS`; `'uncensored'` → global spread with `mode: 'AUTO_ROUTE'`, scans off; otherwise global.
- **Wire**: `conciergeState: z.enum(['monitored','flagged','vouched','uncensored'])` on PUT `/api/v1/chats/[id]` (`app/api/v1/chats/[id]/schemas.ts:127`, applied at `helpers.ts:602-608`) and on POST `/api/v1/chats` (`route.ts:146`, applied at :1374 via `applyRequestedConciergeState` :374-382). GET returns the raw pair (`handlers/get.ts:394-396`). List payloads carry a derived `conciergeState` and `dangerCategories` (`lib/services/chat-enrichment.service.ts:227,613`, `home-data.service.ts:73`, `projects/[id]/actions/chats.ts:103`, `characters/[id]/handlers/get.ts:220`).
- **Presentation**: `CONCIERGE_STATE_PRESENTATION` (`concierge-state-presentation.ts:51-86`: eye/success, alert-triangle/danger, check-circle/muted, eye-off/info), `conciergeToneSuffix` (:88), `conciergeToneTextClass` (:99), `describeConciergeState` (:127). Importers: `NewChatForm.tsx:14-17`, `ChatSidebar.tsx:30-33`, `ConciergeMark.tsx:22-27`, `SalonView.tsx:23-27`.
- **Controls**: New Chat select `NewChatForm.tsx:688-717` (default `'monitored'` at `hooks/useNewChat.ts:148`, sent only when not Monitored :795-797, seeded from the source chat on continuation :532); sidebar select `ChatSidebar.tsx:1142-1180` with `handleConciergeStateChange` :1087; header pill `SalonView.tsx:1151-1177`, nothing rendered for Monitored.
- **Lists and hiding**: `ConciergeMark` asterisk for every non-Monitored state; `shouldHideChat` (`components/providers/quick-hide-provider.tsx:226-237`) hides the uncensored row via `conciergeStateUsesUncensoredRoute`.
- **CSS**: `.qt-danger-badge` / `-muted` / `-info` (`app/styles/qt-components/_chat.css:2878-2892`), `.qt-concierge-mark` family (:2902-2914), mirrored in `packages/theme-storybook/src/css/qt-components.css:1045-1090`.
- **Classifier and scan gates**: `chat-danger-classification.ts:58-60` and `scheduled-danger-scan.ts:136-145` use `isClassifierOnDuty`; the per-turn trigger `memory-trigger.service.ts:169` too.
- **Greeting at creation**: `app/api/v1/chats/route.ts:826-845` tries the uncensored desk first for Flagged/Uncensored ("Attempt 0"), and falls back to it after a content filter for Monitored (:911-925).
- **Export**: `conciergeOverride` enum `["OFF","UNCENSORED",null]` at `public/schemas/qtap-export.schema.json:659-662`.

## Design

### 1. Storage

Three new columns on `chats`:

| Column | Type | Domain |
|---|---|---|
| `conciergeMode` | `TEXT NOT NULL DEFAULT 'moderated'` | `'moderated'` \| `'unmoderated'` \| `'locked'` |
| `conciergeModeSetBy` | `TEXT NULL` | `'operator'` \| `'concierge'`; `NULL` when `moderated` by default |
| `conciergeModeReason` | `TEXT NULL` | `'manual'` \| `'refusals'` \| `'classifier'` \| `'migration'` |

`conciergeOverride` is **no longer written**. `isDangerousChat`, `dangerScore`, `dangerCategories`, `dangerClassifiedAt`, `dangerClassifiedAtMessageCount` remain the classifier's telemetry and are still written by the classifier job, but **no routing or display decision reads them** after this phase.

Migration `add-chat-concierge-mode-v1`: adds the three columns (`addColumnIfMissing`), then backfills every row in a loop with `reportProgress(i + 1, rows.length, 'chats')`:

| `conciergeOverride` | `isDangerousChat` | → `conciergeMode` | `SetBy` | `Reason` |
|---|---|---|---|---|
| `'UNCENSORED'` | any | `unmoderated` | `operator` | `migration` |
| `'OFF'` | any | `locked` | `operator` | `migration` |
| `NULL` | `true` | `unmoderated` | `concierge` | `classifier` |
| `NULL` | else | `moderated` | `NULL` | `NULL` |

`introducedInVersion: '4.10.0'`, `dependsOn: ['add-chat-refusal-ledger-v1']`. `PRETTY_LABELS`: *"Re-lettering the Concierge's three positions on every chat"*. Register in `migrations/scripts/index.ts` (import, array, named export) and `migrations/README.md`.

Declare the three columns in both `ChatMetadataSchema` and `ChatMetadataBaseSchema` (`lib/schemas/chat.types.ts:742`, :1144). DDL.md and the export schema follow; `conciergeOverride` stays in the export schema marked deprecated, and the importer (`lib/import/quilltap-import/import-entities.ts:373-381`) derives `conciergeMode` from the legacy pair when a bundle predates this phase and carries no `conciergeMode`.

### 2. Derivation — `chat-override.ts`

```ts
export type ConciergeState = 'moderated' | 'unmoderated' | 'locked'
export type ConciergeProvenance = 'operator' | 'concierge' | null

export function getConciergeState(chat): ConciergeState        // chat.conciergeMode ?? 'moderated'
export function getConciergeProvenance(chat): ConciergeProvenance

export function shouldUseUncensoredRoute(chat): boolean         // state === 'unmoderated'
export function conciergeStateUsesUncensoredRoute(state): boolean
export function shouldShowDangerStyling(chat): boolean          // state === 'unmoderated'
export function isClassifierOnDuty(chat): boolean               // state === 'moderated'  (may the Concierge move this chat?)
export function mayFailOver(chat): boolean                      // state === 'moderated'  (new: may a refusal be rerouted?)
```

`isClassifierOnDuty` keeps its name (its callers are the classifier job, the scheduled scan, the per-turn trigger and phase 2's auto-switch) and its meaning narrows to "Moderated". `mayFailOver` is the new question phase 1's chokepoints must ask: `generateImageWithConciergeFailover` step 4 and `attemptUncensoredRetry` check `mayFailOver(chat)` before `settings.mode`, and post `'refusal-not-permitted'` with a `reason: 'locked'` detail when it is false. The module doc comment's 2×2 becomes a 1×3 table with provenance called out as a note.

Danger styling is one tone for Unmoderated regardless of provenance. The provenance goes in the tooltip and helper text, never in colour.

### 3. Resolver — `resolver.service.ts`

```
exempt chat type (help, brahma)   → VOUCHED_SAFE (renamed LOCKED_DANGEROUS_CONTENT_SETTINGS), source 'chat-type-exempt'
'locked'                          → LOCKED_DANGEROUS_CONTENT_SETTINGS, source 'chat-locked'
'unmoderated'                     → { ...global, mode: 'AUTO_ROUTE', threshold: 1.0, all scans false, showWarningBadges: false }, source 'chat-unmoderated'
'moderated'                       → global (or default), source 'global' | 'default'
```

The `'chat-vouched'` and `'chat-uncensored'` source strings are retired. `autoSwitchAfterRefusals` is `0` in the locked constant.

### 4. Transitions — `manual-flip.ts`

`applyConciergeFlip(chatId, requested: ConciergeState, chat, { by = 'operator', reason = 'manual' })`:

| Requested | Writes | Announcement kind |
|---|---|---|
| `moderated` | `conciergeMode: 'moderated', conciergeModeSetBy: null, conciergeModeReason: null`, clears the classifier telemetry (`isDangerousChat: false`, score/categories/classifiedAt/count nulled) and the refusal ledger | `set-moderated` |
| `unmoderated` | `conciergeMode: 'unmoderated', conciergeModeSetBy: by, conciergeModeReason: reason` | `set-unmoderated` when `by === 'operator'`; `auto-unmoderated` when `by === 'concierge'` (details: `reason`, and for `refusals` the count and last provider) |
| `locked` | `conciergeMode: 'locked', conciergeModeSetBy: 'operator', conciergeModeReason: 'manual'` | `set-locked` |

No-op when the state already matches **and** the provenance would not change; an operator confirming an auto-switch (`unmoderated` by `concierge` → `unmoderated` by `operator`) updates `SetBy`/`Reason` without an announcement. Callers that pass the old four values are a type error. Phase 2's auto-switch and the classifier's auto-flip (`chat-danger-classification.ts:207-230`) both call `applyConciergeFlip(chatId, 'unmoderated', chat, { by: 'concierge', reason })` instead of writing `isDangerousChat` themselves; the classifier still writes its telemetry fields first.

The announcement kinds `manual-flagged` / `manual-safe` / `manual-resumed` / `manual-vouched` / `manual-uncensored` / `auto-flagged-refusals` are removed from the union. Old bubbles in transcripts are plain messages and render as before.

### 5. Wire contract

- PUT `/api/v1/chats/[id]` and POST `/api/v1/chats`: `conciergeState: z.enum(['moderated', 'unmoderated', 'locked'])`. The four old values are **rejected with 400**; the only client is the app itself.
- GET `/api/v1/chats/[id]` returns `conciergeState` and `conciergeSetBy` (derived), and stops returning `conciergeOverride`. `isDangerousChat` and `dangerCategories` remain (telemetry, tooltip).
- List payloads (`EnrichedChatSummary`, `RecentChat`, `ChatCardData`) carry `conciergeState`, `conciergeSetBy`, `dangerCategories`.
- `POST /api/v1/chats/[id]?action=reclassify-danger` is unchanged in shape; it clears telemetry only and never moves a chat out of Unmoderated.

### 6. Presentation and controls

`CONCIERGE_STATE_PRESENTATION` becomes three rows:

| State | Label | Icon | Tone | Helper text |
|---|---|---|---|---|
| `moderated` | Moderated | `eye` | `success` | "The Concierge sends everything to the usual providers first, and to the uncensored desk only when one of them refuses. After enough refusals he moves the whole chat himself." |
| `unmoderated` | Unmoderated | `eye-off` | `danger` | operator: "You have opened the uncensored door yourself. Nothing here goes near a moderated provider." — concierge: "The Concierge moved this chat to the uncensored desk after N refusals (or: on reading the conversation). Set it back to Moderated if you disagree." |
| `locked` | Locked | `lock` (add to the icon registry if missing; else `shield`) | `muted` | "Only the usual providers, ever. If one refuses, the refusal stands. For the chat that must never reach an uncensored model." |

`describeConciergeState(state, provenance, dangerCategories?, refusalCount?)` picks the helper variant. The New Chat select (`NewChatForm.tsx:688-717`) and sidebar select (`ChatSidebar.tsx:1142-1180`) drop the optgroups for a flat three-option list, Moderated marked "(default)" on the form. The header pill (`SalonView.tsx:1151-1177`) renders nothing for Moderated, the danger tone for Unmoderated with the provenance in the tooltip, muted for Locked. `ConciergeMark` and `shouldHideChat` follow `conciergeStateUsesUncensoredRoute`, which now means Unmoderated. `useNewChat.ts:148` default becomes `'moderated'`; continuation seeds the source chat's state as before.

CSS: the `-info` variants of `.qt-danger-badge` and `.qt-concierge-mark` lose their only user. Leave the rules in place this phase (a theme may hook them) and note them for the dead-code sweep; the storybook mirror is untouched.

### 7. Greeting at creation

`app/api/v1/chats/route.ts:826-845`: "Attempt 0" (uncensored desk first) runs for Unmoderated; the content-filter fallback (:911-925) runs for Moderated and never for Locked. This is a rename of the conditions, not new behaviour.

## Decisions of record

- **Provenance is a note, not a state.** The Concierge's verdict and the operator's assertion put the chat on the same route; the only thing worth telling the user is who did it, and a tooltip does that.
- **Locked survives.** It is the one state with a real, distinct consequence (never fail over) and a real audience (a shared or family chat). Dropping it would leave that user with no answer.
- **Old columns are orphaned, not repurposed.** `conciergeOverride` keeps its values and stops being written; a later migration may drop it. `isDangerousChat` keeps its meaning as the classifier's label and loses its routing power.
- **Old wire values are rejected, not aliased.** The only client ships with the server.

## Implementation order

1. Migration, schemas, DDL, export schema, importer derivation.
2. `chat-override.ts` union and predicates; fix every call site the compiler flags (the inventory in `concierge-four-state.md` "Known State" is still accurate as a starting list, plus phase 1's chokepoints and phase 2's ledger).
3. Resolver sources; `manual-flip.ts`; announcement kinds; classifier job and phase-2 auto-switch call `applyConciergeFlip`.
4. Wire schemas, GET/list payloads.
5. Presentation table, selects, pill, mark, quick-hide.
6. Docs.

## Testing

- **Migration**: the four-row backfill table above, plus idempotence and `reportProgress` presence (the commit skill checks the latter).
- **`chat-override.test.ts`**: the 3×2 truth table (state × provenance) across all four predicates and `getConciergeProvenance`.
- **`resolver.test.ts`**: three sources; `chat-unmoderated` carries the profile ids and forces `AUTO_ROUTE` under a global `OFF`; locked forces `autoSwitchAfterRefusals: 0`.
- **`manual-flip.test.ts`**: all six ordered transitions plus the provenance-only update; the reset of telemetry and ledger on `moderated`; the classifier and the refusal ledger both reach `unmoderated` through the chokepoint.
- **Wire**: PUT with `'flagged'` → 400; POST with `'locked'` creates a locked chat whose greeting never reroutes.
- **UI**: `concierge-mark.test.tsx`, `NewChatForm.test.tsx`, `useNewChat.request-body.test.tsx`, `route.concierge-state.test.ts` updated to the three values; a Salon header test that an Unmoderated-by-concierge chat's tooltip names the reason.
- **Phase-1 chokepoints**: a Locked chat's refused picture posts `refusal-not-permitted` with `reason: 'locked'` and never resolves an understudy.
- `scripts/concierge-four-state-test.sh` renamed `concierge-three-state-test.sh` and reduced to the three states.

## Documentation and housekeeping

- `docs/CHANGELOG.md`: the three states, the mapping table, the rejected wire values.
- `help/dangerous-content.md`: the "four per-chat states" section becomes three, with provenance explained; `help/quick-hide.md:145-160`; `help/chats.md` and `help/chat-participants.md` wherever Flagged/Vouched/Uncensored are named; `help/autonomous-rooms.md:119-121`.
- `CLAUDE.md` chokepoint bullet: *"A chat's Concierge posture is three states with a provenance note"*, listing the new predicates; `GEMINI.md` mirror.
- `docs/developer/DDL.md`, `public/schemas/qtap-export.schema.json`, `migrations/README.md`, `docs/developer/API.md` (PUT/POST/GET shapes).
- Move `concierge-four-state.md`, `concierge-list-marks.md`, `concierge-default-at-creation.md` to a "Superseded by" note at their top pointing here; update their catalog rows in `.claude/commands/update-documentation.md` and add this spec's.

## As built

Implemented 2026-09-25. Departures from the plan above, each for a stated reason:

- **`conciergeMode` is nullable, and NULL reads as `'moderated'`.** §1 asked for `TEXT NOT NULL
  DEFAULT 'moderated'`. The migration adds `TEXT DEFAULT 'moderated'` (so every existing row gets
  the value), but a fresh database's `chats` table is generated from the Zod schema, where the
  field is `.nullable().optional()` — a `.default()` would have made the field required on the
  `ChatMetadata` type and broken every fixture, and a `NOT NULL` column would reject any create or
  import that carried an explicit `null`. `getConciergeState` treats NULL as Moderated, so the two
  shapes behave identically.
- **The column is inside `ChatMetadataSchema`, so a whole-row `update` can rewind it** — the same
  exposure `conciergeOverride` had, and unlike the refusal ledger, which phase 2 kept outside the
  schema for that reason. Kept inside because it must travel in exports and restores.
- **`mayFailOver` is false only for Locked**, not "`state === 'moderated'`". An Unmoderated chat's
  primary is already the uncensored desk; should that profile still refuse, trying another
  uncensored profile is what the operator (or the Concierge) already chose. The spec's "n/a" for
  Unmoderated is kept in spirit: nothing reaches a *moderated* provider.
- **The Locked icon is `shield`.** The registry has no `lock`, and adding one means a new default
  asset plus a theme-storybook icon story (a package publish); the spec allowed the fallback.
- **List payloads also carry `conciergeReason`**, and GET carries `conciergeReason` and
  `conciergeRefusalCount` (from `getModerationRefusalLedger`). The list mark's tooltip otherwise
  could not tell "after two refusals" from "on reading the conversation".
- **The helpers read a server-derived payload too.** `getConciergeState` / `getConciergeProvenance`
  / `getConciergeReason` read `conciergeMode` first and fall back to `conciergeState` /
  `conciergeSetBy` / `conciergeReason`, so the Salon (which only sees the GET payload) asks the
  same functions as the server.
- **The legacy derivation is one function**, `deriveConciergeModeFromLegacy` (with
  `withConciergeModeFromLegacy` for whole chats), used by the migration, the `.qtap` importer
  (both the duplicate and the ordinary path) and the backup restore — the spec named only the
  importer; a pre-phase-3 backup would otherwise restore every chat as Moderated.
- **The classifier's switch posts the classifier's own announcement.** `applyConciergeFlip` with
  `{ by: 'concierge', reason: 'classifier', classification }` calls
  `postConciergeDangerAnnouncement` (the detailed verdict) instead of an `auto-unmoderated`
  bubble, so the chat gets one announcement, not two.
- **`applyConciergeFlip` refuses a Concierge-initiated move other than Moderated → Unmoderated**,
  and never lets the Concierge re-attribute a state the operator chose. Callers already check
  `isClassifierOnDuty`; the chokepoint now enforces it too.
- **The text chokepoints take a `conciergeState` option.** `attemptEmptyResponseRecovery` and
  `attemptHardErrorFailover` post `refusal-not-permitted` with `reason: 'locked'` for a stated
  refusal on a Locked chat and skip the uncensored retry; the ordinary fallback chain still runs.
  The empty-body path announces only a stated refusal, never a plain empty body.
- **`currentConciergeState` and `ConciergeUIState`** (deprecated aliases in `manual-flip.ts`) and
  `MODERATION_REFUSALS_CATEGORY` were removed: nothing outside tests used them, and the
  auto-switch no longer stamps `dangerCategories`.
- **The new-chat and sidebar selects map over `CONCIERGE_STATES`** (exported from
  `chat-override.ts`) rather than spelling the options by hand.

