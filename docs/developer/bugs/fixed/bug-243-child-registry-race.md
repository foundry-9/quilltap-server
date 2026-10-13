# Bug 243 — The job child runs jobs before its provider registry has loaded

| | |
|---|---|
| **Status** | Fixed 2026-10-13 |
| **Found** | 2026-10-13, in `V4test` logs (`[EmbeddingGenerate] Help doc section embedding failed — skipping section`, "Provider 'BUILTIN' not found in registry", every boot since 2026-10-09) during the TF-IDF memory tuning work |
| **Fixed** | 2026-10-13 |
| **Severity** | Medium — on a Built-in (TF-IDF) instance help search has no or partial vectors; on any instance the first jobs after the child forks can fail and retry |
| **Who it bites** | every instance at boot; visibly, BUILTIN instances, whose first child jobs are the help-doc sync's `EMBEDDING_GENERATE` |
| **Provenance** | Original to v4 (the child's asynchronous plugin load, background-jobs child process) |
| **Defect site** | `lib/background-jobs/child/child-entry.ts` — `initializePlugins()` was started in a fire-and-forget IIFE, and `runJob` never waited for it; the comment accepted that "any job that requires a registered provider before init completes will fail and retry" |
| **Fix site** | `lib/background-jobs/child/plugin-readiness.ts` (`startPluginInitialization`, `whenPluginsReady`); `child-entry.ts` (`runJob` awaits `whenPluginsReady()` before the handler) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-13).** Each job now waits for the child's plugin load to settle (success
or failure, capped at 60 s so a hung load cannot stall the queue) before its handler runs. Test:
`__tests__/unit/lib/background-jobs/child-plugin-readiness.test.ts`.

## Symptom

`combined.log` on `V4test` shows, at each boot, a run of
`[EmbeddingGenerate] Help doc section embedding failed — skipping section` warnings with
`Provider 'BUILTIN' not found in registry`. Help search on that instance found little or nothing
by vector.

## Root cause

The parent forks the job child lazily, on the first job, and sends that job at once. The child
started `initializePlugins()` asynchronously so it could answer IPC immediately, and `runJob`
dispatched handlers without waiting for it. Until the load finished, `providerRegistry` was empty,
so `generateBuiltinEmbedding` → `providerRegistry.createEmbeddingProvider('BUILTIN')` threw.

At boot the first child jobs are the help-doc sync's `EMBEDDING_GENERATE` rows. The help-doc
handler catches a failure per section, logs it and skips the section; a document whose sections
all failed was retried, but one whose load finished part-way through was marked embedded with the
early sections left null until the next content change or full reindex. Memory embeds throw, retry
and recover, which is why the race looked confined to help docs.

## Why it survived

The race was deliberate and documented ("will fail and retry on the dispatcher's normal
backoff"), which is true for handlers that throw. The help-doc path's per-section tolerance,
which came with the section split for oversize documents (bug 168), turned a retried failure into a silent partial success.
Neural instances embed through the same registry, but an API call's latency usually let the load
finish first.

## Fix

`plugin-readiness.ts` owns the load's promise. `child-entry.ts` starts it through
`startPluginInitialization` and `runJob` awaits `whenPluginsReady()` before entering the job
scope. A failed load still releases jobs (the handlers then fail as before, with the existing
error log); a load that hangs releases them after 60 s with a warning, and the timeout is latched so later jobs do not wait again.

## Verify

Restart a BUILTIN instance and watch `combined.log`: the child logs
`Plugin registry initialized in child` before its first `Running job in child`, and no
`not found in registry` warnings follow. `help_search` returns vector hits once the help-doc
jobs drain.
