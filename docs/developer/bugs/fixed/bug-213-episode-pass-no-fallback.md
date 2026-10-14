# Bug 213 — Memory extraction passes are built without the full uncensored fallback

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase D of the [memory system refactor](../../features/complete/memory-system-refactor.md)) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix A) |
| **Fixed** | 2026-10-12 |
| **Severity** | Medium — when the cheap model returns an empty answer on dangerous content, the fold episode pass loses its episodes outright, and in Unmoderated chats every extraction pass skips the uncensored-to-uncensored retry; memories are silently not formed |
| **Who it bites** | chats with Concierge failover allowed (episode pass), and Unmoderated chats routed directly to the uncensored desk (every extraction pass), whenever the cheap model returns an empty response |
| **Provenance** | Original to v4. The episode pass (episodic recall overhaul) was added with only a routed `cheapLLM`; `UncensoredFallbackOptions.isDangerousChat` was added for the chat path and never threaded into the memory paths |
| **Defect site** | `lib/chat/context-summary.ts:554-564` (episode pass call, no fallback); `lib/memory/fold-episode-pass.ts:37-46`, `:100`; `lib/memory/cheap-llm-tasks/memory-tasks.ts:1323-1330`; `isDangerousChat` unset at `lib/memory/memory-processor.ts:416-419`, `lib/memory/fold-other-pass.ts:626`, `lib/chat/context-summary.ts:584-586`; read at `lib/memory/cheap-llm-tasks/core-execution.ts:431`, `:732-735` |
| **Fix site** | `lib/memory/extraction-route.ts` (new: `buildExtractionUncensoredFallback`), `lib/memory/fold-episode-pass.ts`, `lib/memory/cheap-llm-tasks/memory-tasks.ts` (`extractEpisodesFromFold`), `lib/chat/context-summary.ts`, `lib/memory/fold-other-pass.ts` (catch-up), `lib/memory/memory-processor.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Every extraction pass now builds its uncensored fallback with
`isDangerousChat` set from the chat's Concierge state. The flag on `UncensoredFallbackOptions` asks
"is this chat on the uncensored route?", so it is answered by `shouldUseUncensoredRoute(chat)`
(Unmoderated, whoever set it), never by the classifier's `chats.isDangerousChat` telemetry column.
`buildExtractionUncensoredFallback` (new `lib/memory/extraction-route.ts`) builds the options for
the fold passes and the OTHER catch-up; `processTurnForMemory` adds `isDangerousChat` from its
context, which the per-turn and Carina handlers already fill with `shouldUseUncensoredRoute(chat)`.
The episode pass gained an `uncensoredFallback` input, `extractEpisodesFromFold` passes it to
`executeCheapLLMTask`, and `generateContextSummary` resolves the fallback once and hands the same
options to the episode and OTHER passes. An empty answer on the episode pass now retries on the
desk's text profile, and in an Unmoderated chat routed direct every pass retries
uncensored-to-uncensored. Tests: `fold-episode-pass.test.ts` ("uncensored fallback"),
`memory-processor-other-mode.test.ts` ("uncensored fallback"), `fold-other-pass.test.ts`
(catch-up routing).

## Symptom

In a Moderated chat with failover allowed and an uncensored desk configured, a fold covers a
violent scene. The per-turn and fold OTHER passes, when the censored cheap model returns nothing,
retry on the desk's text profile and still form memories. The fold episode pass gets the same empty
answer, logs a failed extraction, and writes no episode for that window.

In an Unmoderated chat routed straight to the uncensored desk, an empty answer from that desk
profile is not retried on the configured desk text profile on any extraction pass.

## Root cause

**The episode pass has no fallback at all.** `RunFoldEpisodePassInput`
(`fold-episode-pass.ts:37-46`) has no `uncensoredFallback` field. `generateContextSummary` calls it
with the routed `cheapLLM` only (`context-summary.ts:556-564`), and `extractEpisodesFromFold`
calls `executeCheapLLMTask` without the `uncensoredFallback` argument
(`memory-tasks.ts:1323-1330`). `shouldAttemptUncensoredFallback` returns null when no options are
passed (`core-execution.ts:416-417`), so an empty response is final. The generic stand-in chain on
a thrown error still runs.

**`isDangerousChat` is never set on extraction paths.** Every other extraction pass builds the
options as `{ conciergePolicy, availableProfiles }`:

- per-turn: `memory-processor.ts:416-419` — although `ctx.isDangerousChat` is in hand a few lines
  earlier and used for routing (`:411`);
- fold OTHER pass: `context-summary.ts:584-586`;
- fold OTHER catch-up: `fold-other-pass.ts:626`.

`core-execution.ts` reads the flag twice:

- `:431` — if the current profile is already dangerous-compatible and `isDangerousChat` is not set,
  no empty-response fallback. In an Unmoderated chat the cheap model has already been routed to the
  desk, so this always applies and the uncensored-to-uncensored retry never runs.
- `:732-735` — the stand-in chain on a thrown error requires dangerous-compatible stand-ins when
  `isDangerousChat` is true **or** the current profile is dangerous-compatible.

**Correction to the spec's wording.** The spec says the unset flag "disables the uncensored retry
chain". That holds for the empty-response retry (`:431`) only. The error stand-in chain (`:732`) is
not disabled: in an Unmoderated chat routed direct, the current profile is the desk's, so the
second condition holds and stand-ins are still restricted to dangerous-compatible profiles. The
flag matters there only when an Unmoderated chat was not routed direct (no desk text profile), a
narrow case.

## Why it survived

Extraction failures are best-effort and quiet: a lost episode is a debug-level warn and an absent
memory. The chat path (`orchestrator.service.ts:1225-1226`) does set `isDangerousChat: true`, so
the fallback was tested where it is visible.

## Fix

Phase D resolves the route once per unit of work in `buildExtractionContext`: `route.cheapLLM` and
`route.uncensoredFallback`, the latter carrying `isDangerousChat` from the chat's Concierge state.
Every pass, the episode pass included, runs through `runPass` with that context, so no pass can be
built without the fallback.

## Verify

Unit (Phase D): the episode pass receives the context's `uncensoredFallback`, and it carries
`isDangerousChat: true` for an Unmoderated chat. With a mocked cheap model returning an empty
string, the episode pass retries on the desk text profile and writes the episode; in an
Unmoderated chat routed direct, every pass retries on the desk text profile.
