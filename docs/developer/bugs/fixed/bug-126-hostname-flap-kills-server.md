# Bug 126 — a macOS hostname change makes the app kill its own database a minute after launch

| | |
|---|---|
| **Status** | Fixed in v4 (2026-09-08). Filed from the live Friday instance under the Electron shell; diagnosed from `logs/embedded-server.log` and `data/quilltap.lock`, both of which record the false takeover verbatim |
| **Found** | 2026-09-08 |
| **Fixed** | 2026-09-08 |
| **Severity** | **Critical** (the embedded server calls `process.exit(1)` ~60 s after startup and the Electron shell does not restart it. The window stays open over a dead backend, so it reads as a rendering bug rather than a crash. The database is left un-checkpointed on the way out — the exact WAL exposure the instance lock exists to prevent) |
| **Who it bites** | any macOS instance where `scutil --get HostName` is unset — the default. `gethostname()` is then derived dynamically, so the machine reports e.g. `MacBook-Pro.local` and `Mac` at different times, flipping on Wi-Fi reconnect, sleep/wake, VPN and DHCP lease renewal. Electron is hit hardest because the shell supervises the server only until its health check passes |
| **Provenance** | Live in Friday, 2026-09-08. Reported as *"I'd ask Brahma Console questions, then the home page wouldn't render any more."* Brahma is incidental — it is a slow agentic loop the user runs right after launch, which is exactly the first-heartbeat window. Four occurrences in the log (2026-08-23, 2026-08-28, and twice on 2026-09-08), **every one of them with an identical PID and only the hostname differing**, flipping in both directions |
| **Defect site** | `lib/database/backends/sqlite/instance-lock.ts:140` — the heartbeat's ownership test, `content.pid !== process.pid \|\| content.hostname !== os.hostname()`, re-read `os.hostname()` every 60 s and treated any change as another process taking the database. Three further sites shared the assumption: `:559` (acquisition claimed any non-docker foreign-hostname lock outright — fail-open), `:617` (release refused, leaving a stale lock), and `packages/quilltap/bin/quilltap.js:520`/`:602` (`--lock-status` reported a live app as `STALE (different host)`; `--lock-clean` would delete its lock). Compounding it, the shutdown path's `require('./client')` at `:156` does not survive bundling into the standalone server, so the close threw `b is not a function` and nothing was actually closed |
| **Fix site** | `lib/database/backends/sqlite/instance-lock.ts` — ownership is now a snapshot (PID + `startedAt`) captured when we write the lock, compared by `isStillOurLock`; hostname is a label only. Cross-host liveness is heartbeat freshness for every environment, not a docker special case. `client.ts` registers its ordered teardown via `registerInstanceLockShutdownHandler` instead of being dynamically required back. `packages/quilltap/bin/quilltap.js` gains a shared `assessLock` used by both `--lock-status` and `--lock-clean` |
| **v5 status** | **Not yet assessed.** The port carries its own lock implementation; if it compares a freshly-read hostname anywhere, it inherits this defect. The lesson to carry over is the invariant, not the code: *a hostname is a label, not an identity.* |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-08).** The heartbeat no longer asks "does the OS still
call me what it called me a minute ago?" Every path that writes this process
into the lock file now records a `LockOwnership` snapshot — PID plus the
acquisition timestamp — and `isStillOurLock` compares the on-disk record
against that snapshot. Both fields are overwritten by any process that takes
the lock, so a genuine takeover is still caught immediately, while a hostname
change is invisible to the test. The heartbeat additionally rewrites the
recorded hostname each tick, so the file keeps a useful label instead of a
stale one.

Acquisition's foreign-hostname branch no longer claims the lock on the strength
of the name. Since a differing name cannot distinguish "another machine" from
"this machine, renamed", it decides on the heartbeat alone: fresh (under
`HEARTBEAT_FRESH_MS`) means someone live holds it and we refuse — with an error
that names the hostname change as a likely cause and says how long until the
lock goes stale — and stale or missing means we claim it. That closes a
fail-open hole in which two processes on one machine could both open the
database because the OS had renamed one of them. `overrideInstanceLock` now
starts a heartbeat, without which an overridden lock read as abandoned to every
other host.

The lock-loss shutdown goes through a handler `client.ts` registers with this
module (`registerInstanceLockShutdownHandler`), which is the same ordered
teardown `SIGTERM` and `SIGINT` use. The previous dynamic
`require('./client')` existed to dodge the `client.ts` → `instance-lock.ts`
import cycle, but the relative require does not resolve inside the bundled
standalone server: it threw `b is not a function`, the `catch` logged it, and
`process.exit(1)` ran with the WAL unmerged. Registering inward removes the
cycle rather than working around it.

The CLI's `--lock-status` and `--lock-clean` now share one `assessLock` helper
that checks PID liveness regardless of the recorded name and falls back to
heartbeat freshness for any environment. `--lock-status` reports a live app as
`ACTIVE` instead of `STALE (different host)`, and `--lock-clean` refuses to
delete a lock whose heartbeat is still being refreshed.

Pinned by three cases in `__tests__/unit/lib/database/instance-lock.test.ts`
(`heartbeat ownership`): a hostname change alone must not exit and must keep
heartbeating; a genuine PID/`startedAt` change must exit 1; and the registered
handler must be what closes the database. Two acquisition cases assert the
new refuse/claim split across all three environments, and a release case
asserts that a renamed machine still releases its own lock.

---

### Symptom

Launch Quilltap from the Electron shell. It starts normally and is usable for
about a minute. Then, with no user action and no visible error, the backend
dies: the home dashboard renders nothing, and anything that needs the server
fails. A Salon tab already on screen keeps looking fine, because it is painting
from its TanStack Query cache — which is why the report was "the home page
won't render" rather than "the app crashed".

`logs/embedded-server.log`:

```
14:48:07  Instance lock acquired (re-entrant, PID 86649)
14:48:41  Built universal tools (Brahma Console)
14:48:51  Search scriptorium completed
14:49:03  Entity created — llm_logs
14:49:07  error  Instance lock lost — another process has taken over the database. Shutting down.
                 lockPid 86649  ourPid 86649
                 lockHostname "Mac"  ourHostname "MacBook-Pro.local"
14:49:07  error  Error closing database during lock-loss shutdown — "b is not a function"
```

The PID is *the same PID*. Only the hostname moved. The exit lands exactly
60,000 ms after the heartbeat started — the very first tick — in all four
recorded occurrences.

### Root cause

`instance-lock.ts:140`:

```ts
if (content.pid !== process.pid || content.hostname !== os.hostname()) {
```

`os.hostname()` is not stable over a process's lifetime on macOS. When
`scutil --get HostName` is unset — the out-of-the-box state — `gethostname()`
returns a dynamically derived name: usually the mDNS `<LocalHostName>.local`,
but the DHCP-supplied name in other network states. On the reporting machine:

```
$ scutil --get HostName
HostName: not set
```

so the same Mac answers `MacBook-Pro.local` and `Mac` at different moments. The
lock file's own history caught the whole cycle in one record:

```
14:44:19  acquired        PID 86464  MacBook-Pro.local   Clean acquisition
14:44:20  acquired        PID 86464  MacBook-Pro.local   Re-entrant
          → 14:45:20 first heartbeat: name now "Mac", declared lost, exit(1)
14:48:06  stale-detected  PID 86649  Mac   Different hostname (lock: MacBook-Pro.local, current: Mac)
14:48:06  stale-claimed   PID 86649  Mac
14:48:07  acquired        PID 86649  Mac   Re-entrant
          → 14:49:07 first heartbeat: name back to "MacBook-Pro.local", exit(1)
```

`lastHeartbeat` in that file never advanced past the acquisition timestamp: the
heartbeat has *never once* completed successfully on this machine when the name
had flipped. It kills the process on its first tick instead.

The same assumption produced three more defects, in both directions:

- **Fail-open on acquisition** (`:559`). A non-docker lock with a foreign
  hostname was claimed unconditionally. Two processes on one machine could
  therefore both hold the database open — the corruption this module exists to
  prevent — purely because the OS renamed one of them.
- **Stale locks on release** (`:617`). `releaseInstanceLock` refused to release
  a lock whose recorded hostname differed, so a clean quit after a rename left
  the file behind for the next launch to stale-claim.
- **The CLI lied** (`quilltap.js:520`, `:602`). `--lock-status` gated PID
  liveness on `sameHost`, so a running app reported
  `STALE (different host) — will be auto-claimed on next startup`, and
  `--lock-clean` would delete a live instance's lock with
  `Lock was held by a different host. Removing stale lock.`

Finally, the shutdown path never worked in a shipped build. `client.ts` imports
`releaseActiveInstanceLock` from `instance-lock.ts`, so `instance-lock.ts` used
a dynamic `require('./client')` to avoid the cycle. That require does not
resolve inside the standalone bundle; it threw `b is not a function`, was
swallowed by the surrounding `catch`, and the process exited without a
checkpoint. So the false positive did not merely kill the app — it killed it in
precisely the unclean way the lock was written to avoid.

### Why it survived

Nothing about it looks like a database bug from the outside. The log line says
*"another process has taken over the database"* in the confident voice of a
guard working correctly, and the operator's first instinct is to believe it and
go looking for a second instance. The two identical PIDs in that same line are
the tell, and they sit at the end of a long context object.

The trigger is also environmental and intermittent. It fires only when the OS
name changes between one heartbeat and the next, so it can be quiet for days
and then bite twice in five minutes when the network is unsettled. The `Mac`
value never appears in any Quilltap configuration — it arrives from DHCP — so
there is nothing in the instance to grep for. And because the Electron shell
supervises the server only until its health check passes, the process death
leaves a live window over a dead backend, which presents as a UI fault.

Unit tests did not catch it because the suite mocks `os` with a constant
(`hostname: () => 'test-host'`), so the one value that varies in production was
the one value held fixed in test. Two tests actively asserted the buggy
behaviour: `should claim lock for non-VM different hostname` pinned the
fail-open path, and `should skip release when owned by different hostname`
pinned the stale-lock path.

### The fix

1. **Ownership is a snapshot, not a re-derivation.** `rememberLockOwner` records
   `{ pid, hostname, startedAt }` at every point we write ourselves into the
   lock (clean acquire, re-entrant acquire, stale claim, override, heartbeat).
   `isStillOurLock` compares the on-disk record's `pid` and `startedAt` against
   it and ignores hostname.
2. **Cross-host liveness is the heartbeat, for every environment.** The docker
   special case is gone; a fresh heartbeat means live and we refuse, a stale one
   means gone and we claim. `overrideInstanceLock` starts a heartbeat so an
   overridden lock does not read as abandoned.
3. **The shutdown handler is registered inward.** `client.ts` calls
   `registerInstanceLockShutdownHandler(handleShutdown)`, so the lock-loss path
   runs the same ordered teardown as the signal handlers, with no dynamic
   require and no cycle.
4. **The CLI shares one assessment.** `assessLock` checks PID liveness
   regardless of the recorded name, then heartbeat freshness for any
   environment.

### How to verify

Automated — the three `heartbeat ownership` cases are the direct regression:

```bash
npx jest __tests__/unit/lib/database/instance-lock.test.ts
```

By hand, on a machine with `scutil --get HostName` unset:

1. Launch the app and note the PID in `<dataDir>/data/quilltap.lock`.
2. Change the name the OS reports — `sudo scutil --set HostName something-else`,
   or join/leave a Wi-Fi network — and wait past one heartbeat interval (60 s).
3. Before the fix: `embedded-server.log` shows `Instance lock lost` with equal
   `lockPid`/`ourPid`, and the server is gone. After: no such line, and
   `lastHeartbeat` in the lock file advances every 60 s.
4. `node packages/quilltap/bin/quilltap.js db --instance <name> --lock-status`
   reports `ACTIVE` throughout, not `STALE (different host)`.

Note that pinning the hostname (`sudo scutil --set HostName <name>`) is a valid
workaround for the original symptom, but the fix must not depend on it: an
unset `HostName` is the macOS default.
