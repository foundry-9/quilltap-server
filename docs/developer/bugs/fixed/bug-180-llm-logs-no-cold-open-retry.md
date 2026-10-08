# Bug 180 — the LLM logs database has no cold-open retry, so one flaky read degrades it for the whole process

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-07)** |
| **Found** | 2026-10-07, by the v5 port (P4.159, dogfood #150 — porting v4's degraded sibling open) |
| **Fixed** | 2026-10-07, v4.10-dev |
| **Severity** | Low. Nothing is lost on disk, but every LLM call made until the next restart goes unlogged (each logs `Failed to log LLM call`), the LLM Inspector shows nothing new, and `/api/health` answers `degraded` with `LLM logs database unavailable: LLM logs database is in degraded mode` |
| **Who it bites** | the deployment the mount-index retry ladder was written for: a data directory on a bind-mounted iCloud Drive / VirtioFS volume (Docker), where a cold open can read incomplete page-1 bytes once and succeed a moment later. `quilltap-llm-logs.db` sits in the same `data/` directory as `quilltap-mount-index.db` and is exposed to the same flake |
| **Provenance** | **Faithful.** v5 ports the asymmetry exactly: one attempt and one ERROR for the LLM logs, the four-attempt ladder for the mount index |
| **Defect site** | `lib/database/backends/sqlite/llm-logs-client.ts:49-98` (`getLLMLogsSQLiteClient`: one `new Database` + key + pragmas inside a single `try`; the `catch` logs ERROR `Failed to initialize LLM logs database — entering degraded mode` at `:91` and sets the degraded flag for the life of the process) |
| **Fix site** | new `lib/database/backends/sqlite/cold-open-retry.ts` (`openWithColdOpenRetry`, the one ladder) called by `llm-logs-client.ts` (new `attemptOpenLLMLogs` with the verify probe) and `mount-index-client.ts` |
| **v5 status** | Faithful (P4.159) — v4 now has the ladder; the two v5 pins (`degraded_sibling_open_equivalence`'s `llmLogs/garbage` row and `host_boot_hardness`'s `a_garbage_llm_logs_file_degrades_with_one_error_and_boots`) should trip and converge |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-07).** The ladder moved out of the mount-index client into
`openWithColdOpenRetry(label, path, logger, attempt)` (`cold-open-retry.ts`): four attempts,
`[200, 600, 1500]` ms backoff, a WARN `<label> cold-open failed — retrying {path, attempt,
maxAttempts, backoffMs, error}` per failed attempt, and a result the caller turns into its own
success INFO or degraded-mode ERROR (both now carry `attempts`). The LLM-logs client gained
`attemptOpenLLMLogs` — open, key, text codec, the `SELECT count(*) FROM sqlite_master` verify
probe, pragmas, closing the connection on any failure — and both clients call the shared
ladder, so they cannot drift again. Messages match the mount index's: `LLM logs cold-open
failed — retrying`, then `Failed to initialize LLM logs database — entering degraded mode`
with `attempts: 4`. Pinned by
`__tests__/unit/lib/database/backends/sqlite/cold-open-retry.test.ts`. The two v5 pins named
in the table above (`llmLogs/garbage`, `a_garbage_llm_logs_file_degrades_with_one_error_and_boots`) should
now trip.

## Symptom

On a boot where the first read of `quilltap-llm-logs.db` fails transiently —
the case `mount-index-client.ts:86-94` describes, "a bind-mounted iCloud Drive
returning incomplete page-1 bytes to Docker" — v4 logs one ERROR and enters
degraded mode for the LLM logs until the process restarts:

    ERROR Failed to initialize LLM logs database — entering degraded mode
          {module: database:llm-logs-client, path, error: "file is not a database"}

Every later `llmLogs` read answers empty through its fallbacks, every write
throws through `requireLLMLogsDb` (`Failed to log LLM call` per LLM call), and
since Bug 176's fix the structural pass reports the `llm_logs` repository, so
`/api/health` answers 503 `degraded`. A restart a few seconds later would have
opened the file cleanly.

## Root cause

`getLLMLogsSQLiteClient` makes ONE attempt and has no verify probe; on a bad
page 1 the `journal_mode` pragma is what throws (`llm-logs-client.ts:71-75`).
Its sibling `getMountIndexSQLiteClient` was given a probe (`SELECT count(*)
FROM sqlite_master`, `mount-index-client.ts:63`), a four-attempt ladder with
`[200, 600, 1500]` ms backoff (`:43`, `:113-140`), and a WARN `Mount index
cold-open failed — retrying` per failed attempt. The change that added the
ladder to the mount index did not touch the LLM-logs client, and nothing in
either file marks the omission as deliberate.

## Why it survived

The flake is transient and environmental: a local data directory never shows
it, and on the affected deployment the LLM logs are diagnostic data whose loss
nobody notices until they open the Inspector. Before Bug 176's fix
`/api/health` said nothing about it.

## The fix

Give the LLM-logs open the mount index's structure: an `attemptOpenLLMLogs`
that runs `new Database` → key → `registerTextCodecFunction` → the verify probe
→ the pragmas, closing the connection on any failure; and the same ladder
around it, with a WARN `LLM logs cold-open failed — retrying {path, attempt,
maxAttempts, backoffMs, error}` per failed attempt and the existing ERROR
(gaining `attempts`) when the budget is spent. Better still, one shared
`openWithColdOpenRetry(label, attemptFn)` both clients call, so the two cannot
drift again.

## Verify

Overwrite a COPY's `quilltap-llm-logs.db` with garbage and boot: three WARNs
(`attempt` 1–3, `backoffMs` 200/600/1500) then the ERROR with `attempts: 4`,
the boot taking ~2.3 s longer; then make the file readable between attempts
(e.g. swap a sound copy back in during the backoff) and see `LLM logs database
connection established` with `attempts > 1` and no degraded flag.
