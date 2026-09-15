# Bug 144 — `--lock-clean` tells you the lock's holder is alive when it has just died

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-09-15 (v5 dogfood walk, close-out row I3 — by the plainest gesture there is: stop the server, then clean the lock) |
| **Severity** | **Low** — wording only, on a recovery path. The refusal it accompanies is correct; the lock is reclaimed automatically on the next boot regardless |
| **Who it bites** | an operator who has just stopped an instance and reaches for `--lock-clean` within five minutes. They are told a process is alive and instructed to stop it; there is nothing to stop |
| **Provenance** | Faithful — v5 reproduces this byte for byte and **stays** reproducing it; see *v5 coordination* |
| **Defect site** | `packages/quilltap/bin/quilltap.js:630-634` (the `--lock-clean` `heartbeatFresh` arm) |
| **v5 status** | Faithful and **pinned in both directions** — `crates/quilltap-cli/src/db_cmd.rs`, `lock_clean_refusal_lines()` + `a_fresh_heartbeat_keeps_v4s_false_liveness_claim` |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

```console
$ # server stopped seconds ago; its PID is reaped
$ quilltap db --lock-clean
Lock is still being refreshed (heartbeat 82s ago) — its holder is alive. Cannot clean.
Stop the running instance first, or use --lock-override to force.
$ pgrep -x quilltap-web
$                       # nothing. There is no instance to stop.
```

Both lines are wrong about the world: the holder is not alive, and there is no
running instance to stop. The **refusal** is right — see below — so the only
defect is what it says.

## Root cause

`--lock-clean` branches in this order (`bin/quilltap.js:626-644`):

```js
if (alive && isNode) { … }            // a confirmed Quilltap process
else if (heartbeatFresh) {            // ← this arm
  console.log(`Lock is still being refreshed (heartbeat ${ageStr} ago) — its holder is alive. Cannot clean.`);
  console.log('Stop the running instance first, or use --lock-override to force.');
```

The second arm fires on heartbeat freshness **alone**. That is deliberate and
good: bug 126 made freshness the fallback for every environment precisely so a
container whose PID checks are unreliable is not cleaned out from under itself,
and a five-minute window is a sensible conservatism. The arm is reached exactly
when `alive` is **false** — the first branch already claimed every live case —
so by construction it announces liveness in the one situation where the script
has just computed the opposite:

```js
const alive = Number.isFinite(pid) && isPidAlive(pid);   // false, moments earlier
```

Worse, the **boot path reaches the opposite conclusion about the same lock**: a
startup within that window reclaims it and records
`stale-detected … — PID <n> is no longer running`. So the two halves of the
product disagree in writing about one lock file, and the CLI is the half that is
wrong.

## Why it survived

Nobody kills a server and immediately cleans its lock except during an incident,
and during an incident the message is skimmed. The arm has no test of its own
that reads the sentence — the suites cover *whether* it refuses, which is
correct — and the wording has been true-looking since it was written, because
the reader supplies the assumption that a refreshing lock implies a living
process.

## The fix

Say what the check actually tested, and offer the remedies that exist:

```js
} else if (heartbeatFresh) {
  console.log(`Lock heartbeat is still fresh (${ageStr} ago). Cannot clean.`);
  console.log('A lock counts as held until its heartbeat is 5 minutes stale, even if its process has gone. Wait it out, or use --lock-override to force.');
```

Two details worth keeping: derive the stated window from the freshness constant
so the sentence cannot drift from the check, and leave the first arm
(`alive && isNode`) alone — "held by a live Quilltap process" is true there, and
"stop the running instance" is the right instruction.

## Verification

Stop an instance, then within five minutes:

```bash
quilltap db --lock-clean     # must not assert that anything is alive
pgrep -x quilltap-web        # empty — that is the point
```

Then wait out the window and re-run: the lock cleans, which is the behaviour
this bug does **not** change.

## v5 coordination

⚠ **v5 is faithful and must stay that way until v4 lands this.** The v5 port
reproduces both lines byte for byte, and the 2026-09-15 walk that found this
briefly "fixed" them in v5 on the mistaken belief that `--lock-clean` had no v4
counterpart. The CLI differential (Tier R, which drives v4's **real** launcher)
failed **5 of 223 cases** on the divergence — `lock clean suspect but fresh
heartbeat refuses`, `lock clean docker fresh refuses`, `lock clean retired lima
env`, `lock clean foreign fresh local refuses`, and one more — and the change
was reverted.

v5 now pins the sentence deliberately, in
`crates/quilltap-cli/src/db_cmd.rs`: the refusal lines come from a pure
`lock_clean_refusal_lines()` whose doc comment records that the text is wrong
and why it stays, and the test `a_fresh_heartbeat_keeps_v4s_false_liveness_claim`
asserts `first.contains("its holder is alive")` **on purpose**. When v4 fixes
this, that assertion fails — by design — and the port converges in the next
drift catch-up.
