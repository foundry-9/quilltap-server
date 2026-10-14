# Bug 239 — `anchor-probe` and `recall-replay` reject the universal `--instance` flag

| | |
|---|---|
| **Status** | Fixed 2026-10-13 |
| **Found** | 2026-10-13, on `V4test` while dogfooding the memory refactor |
| **Fixed** | 2026-10-13 |
| **Severity** | Low — the CLI's help promises universal flags work with every subcommand; these died with `Unknown option: --instance`, and none of the three HTTP tools could find a server on a non-default port without `--port` |
| **Who it bites** | anyone running the memory developer tools against a named instance |
| **Provenance** | Original to v4 — the two tools have their own argument parsers that never learnt the universal flags |
| **Defect site** | `packages/quilltap/lib/anchor-probe-command.js`, `packages/quilltap/lib/recall-replay-command.js` (parsers); the instance lock recorded no port |
| **Fix site** | `lib/database/backends/sqlite/instance-lock.ts` (lock records `port`); `packages/quilltap/lib/lock-helpers.js` (`resolveServerPort`); the three tools' parsers and help; `quilltap db --lock-status`; README, DDL.md, bash completion |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-13).** The server writes the port it listens on into `quilltap.lock`
(`port`, from `PORT`, default 3000; absent when unknowable, e.g. the CLI's own `--write` claims).
`anchor-probe`, `recall-replay` and `memory-diff` accept `-i/--instance`, `-d/--data-dir` and
`--passphrase` anywhere; their port is an explicit `--port`, else the named instance's live lock's
`port`, else 3000 (the connection-failure hint says why). `--instance` with `--data-dir` is an
error, as elsewhere. `quilltap db --lock-status` shows the port. Tests:
`packages/quilltap/lib/__tests__/server-port-resolution.test.js`,
`__tests__/unit/lib/database/instance-lock.test.ts`.

## Symptom

`quilltap --instance V4test anchor-probe <id>` → `Unknown option: --instance`.

## Root cause

The two parsers' `default:` branch rejected any flag they did not list, and the universal flags are
passed through to every subcommand.

## Why it survived

The tools were always run from a repo checkout against the default port.

## Fix

As above.

## Verify

With the dev server running on 3005 against an instance, `quilltap --instance <name> recall-replay
<chatId>` connects to 3005 and says so.
