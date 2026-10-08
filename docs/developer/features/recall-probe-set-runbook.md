# Recall Probe Set — Runbook

**Status:** Done — `cap14` chosen by Charlie (2026-10-08) and made the code defaults; see the retuning spec's implementation notes
**Owner:** Charlie
**Written:** 2026-10-08
**Executes:** [recall-multiplier-retuning.md](./recall-multiplier-retuning.md) §3 (Validation)
**Run by:** Claude Code, locally, against the Friday instance

This is a working spec for an agent. It says where the recall work stands, what
the probe set is for, and the exact steps to build it, score it, and use it to
choose the retuning constants. Follow it in order. Record progress in the
[tracker](#tracker) at the bottom so a later session can pick up where this one
stopped.

---

## 1. Where things stand

- **[memory-recall-and-housekeeping-fixes.md](./memory-recall-and-housekeeping-fixes.md)
  (F1–F9) is implemented and merged** (foundry-9/quilltap-server#83). Among
  other things it made the dynamic memory head scale with the model's memory
  budget (F7: up to 15 entries, 30 on a retrospective turn), and added
  `--memory-budget` to `quilltap recall-replay` and the `quilltap
  anchor-probe` command.
- **The F2 anchor probe is done** (recorded in that spec's "F2 result"
  section, foundry-9/quilltap-server#84): the anchor line embedded with each
  memory doesn't suppress Memory Gate reinforcement, so the gate is unchanged.
- **[recall-multiplier-retuning.md](./recall-multiplier-retuning.md) is
  proposed, with no code yet.** Three Friday replays (Turns A, B, C, in its §1)
  show that stacked boosts, mainly the fresh-event boost on memories from
  *other* chats, promote memories with cosine 0.31–0.40 over the turn's best
  matches (0.51–0.64). It proposes:
  - R1: relevance-gated boosts.
  - R2: a stacked-boost cap.
  - R3: a gentler fresh-event boost.
  - R4: entity anchors chosen by specificity.
  - R5: fix the floor leak.
  - R6: background slots under a hard time window.
  - R7: `tuning` overrides in the replay harness.
- **What blocks the code:** its §3 asks for the constants to be chosen against a
  probe set of real turns with the right answers written down in advance. That
  probe set doesn't exist yet. This runbook builds it.
- **Open but separate:** bug 182 (the reinforcement-count race). Not part of
  this work.

## 2. Ground rules

1. **Read-only against the database.** Every command here only reads (`db`,
   `memories`, `recall-replay`). Never pass `--write`, and never
   `--lock-override`.
2. **Gold before replay.** A turn's gold memories are written into the tracker
   and committed *before* `recall-replay` is run on that turn. Otherwise the
   ranking steers what counts as correct. If a replay shows a memory you missed,
   note it as `late gold`. It doesn't count toward scoring for that turn.
3. **Charlie approves the gold.** The agent proposes the turns and their gold;
   Charlie confirms or corrects them before any replay. Charlie knows what
   Friday should remember; the agent is guessing from transcripts.
4. **Privacy.** Memory and message content is private. In this repository,
   refer to a memory by its first 8 id characters and a short, neutral label
   ("tuner-window condition"). Never paste memory content, and never describe
   intimate content beyond "off-topic, personal". Raw replay output stays
   outside the repository (§3).
5. **Same flags every run** (§5), so runs are comparable.
6. **The repository's rules still apply to the code phases:** CHANGELOG, help
   docs, tests, `npx tsc`, the /commit command, and a version bump for
   `packages/quilltap`.

## 3. Setup (local)

Confirm each of these and record the answers in the tracker header.

- **Instance:** Friday, at `~/iCloud/Quilltap/Friday` (pass `--instance Friday`).
- **Server:** `npm run dev` is running on `http://localhost:3000/`; recall-replay
  needs it, since embedding happens in the server. Check with
  `curl -s localhost:3000/api/health`. Don't start, stop or restart the server
  without asking. It holds the instance lock. recall-replay asks whichever
  server is on port 3000, so that server must be serving the **Friday**
  instance: check `logs/combined.log` under `~/iCloud/Quilltap/Friday`, or ask
  Charlie.
- **CLI:** run the repository's own copy, so it matches the server's code:
  `node packages/quilltap/bin/quilltap.js …`. It must be at least
  `4.10.0-dev.118`, the first version with `--memory-budget`.
- **Server code matches main:** `git log -1 --oneline` on the branch the dev
  server runs from should include foundry-9/quilltap-server#84 or later.
- **Raw output directory:** `~/iCloud/Quilltap/Friday/recall-probe/`. Create it
  if it's missing. It's inside the instance, outside the repository, and never
  committed.

Below, `qt` means `node packages/quilltap/bin/quilltap.js --instance Friday`.

## 4. Phase 1 — choose the turns and their gold

Target: **10 turns** (8 minimum, 12 maximum).

| Slot | Count | What it is | Why |
|---|---|---|---|
| A | 1 | chat `6cc92fb7…`, turn 11 | Known bad: wardrobe memories from another chat crowd out memory-system ones |
| B | 1 | chat `638325c6…`, turn 16 | Known bad: the best match (tuner window, cosine 0.511) falls out of the new top 25 |
| C | 1 | chat `0826c0f8…`, turn 21 | Control: retrospective, uniform boosts; its head must not get worse |
| F1, F2 | 2+ | "what just happened" turns | The right answer is something from a **different** chat in the last 24–48 h. Protects the fresh boost (R3) |
| M | 1 | a multi-character turn | Another LLM-controlled character is present; checks `present↑` and R4 |
| W | 0–1 | a hard-window retrospective turn with older background on topic | Exercises R6 (C may already cover this) |
| O | 3–5 | ordinary turns | A mix of topics; at least one where Charlie remembers Friday forgetting something |

Steps:

1. Get full ids for A/B/C, and list candidate chats:
   ```bash
   qt db chats --character Friday
   ```
2. For F-slots, find recent cross-chat events:
   ```bash
   qt memories ls --character Friday --sort created --limit 40
   ```
   Then find a later turn in a *different* chat that refers to one of them
   ("how did it go with…").
3. For each candidate turn, read the transcript **up to and including** that
   turn:
   ```bash
   qt db messages --chat <id> --last 60 --full
   ```
   `--turn n` counts interchanges (one user message plus its replies),
   starting at 1. Note the user message the turn answers.
4. Write down gold, 2–6 memories per turn: the memories Friday should have in
   mind to answer that turn well. Find them with:
   ```bash
   qt memories grep "<phrase>" --character Friday
   qt memories grep "<topic>" --semantic --character Friday
   ```
   Rules:
   - A gold memory must have been **created before** the turn's message. Check
     `createdAt`.
   - Prefer memories that hold information the transcript up to that turn does
     *not* already show.
   - Optionally list 1–3 **anti-gold**: memories that would be actively wrong to
     surface there, for example the off-topic personal row on Turn A.
5. Record each turn in the tracker: slot, chat id (8 chars), turn, speaking
   character, a one-line query gist, gold ids with labels, and anti-gold.
6. **Stop and ask Charlie to approve the probe set.** Commit it after approval
   (docs-only commit; CHANGELOG line under the existing recall-retuning entry).

## 5. Phase 2 — the baseline

For every approved turn:

```bash
qt recall-replay <chatId> --turn <n> --memory-budget 8000 --limit 40 \
  > ~/iCloud/Quilltap/Friday/recall-probe/baseline-<slot>.txt
qt recall-replay <chatId> --turn <n> --memory-budget 8000 --limit 40 --json \
  > ~/iCloud/Quilltap/Friday/recall-probe/baseline-<slot>.json
```

Add `--char <characterId>` when the speaker isn't Friday's default.

- `--memory-budget 8000` gives the new path its full head: 15, or 30 on a
  retrospective turn.
- `--limit 40` shows where a 30-row head ends.

Score each turn on **both** paths (old and new):

| Metric | Definition |
|---|---|
| `gold@head` | gold memories in the head, as `k/n` |
| `gold rank` | rank of each gold memory outside the head; `—` if not in the top 40 |
| `anti@head` | anti-gold memories in the head |
| `low@head` | head rows with cosine < 0.40 |
| `tokens` | the head's token spend: the sum of the head rows' token estimates in the JSON, or `content.length / 4` if the JSON has no estimate. Say which in the tracker header |
| `fresh ok` | F-slots only: did the target fresh memory make the head (y/n) |

Use the JSON to score; read the text output only to check. If scoring by hand
is slow, write a small script in the scratch directory that reads each
`baseline-*.json` and the gold ids from the tracker. Keep it outside the
repository unless Charlie wants it committed.

Record the baseline rows in the tracker and commit.

## 6. Phase 3 — build R7 (tuning in the harness)

Implement R7 as the retuning spec describes:

- An optional `tuning` body field on `POST /api/v1/chats/[id]?action=recall-replay`
  (`app/api/v1/chats/[id]/actions/recall-replay.ts` → `lib/memory/recall-replay.ts`),
  applied to the **new** path only. It carries:
  - the R1 gate constants (`boostGateAbs`, `boostGateMargin`, `boostGateRamp`,
    with `0` or `null` meaning the gate is off);
  - the R2 boost cap;
  - fresh-boost values;
  - any `RECALL_MULTIPLIERS` overrides;
  - toggles for R4 / R6.
- Validate it with a Zod schema, and reject unknown keys.
- The ranking code reads its constants from a resolved tuning object whose
  defaults are the values in `lib/memory/recall-tags.ts`. So R1–R6 are written
  once, behind defaults that start out **equal to today's behaviour**: gate off,
  cap = `MULTIPLIER_CLAMP.max`, fresh 1.6/1.35, anchors `slice(0, 3)`, no R6
  reservation.
- With no `tuning` given, the output is identical to before. A unit test pins
  this.
- CLI: `--tuning '<json>'` and `--tuning-file <path>`. The header prints the
  active tuning. The default `--limit` becomes at least `newHeadSize + 10`.
- Update tests, `packages/quilltap/README.md`, the completions, `API.md` and the
  CHANGELOG, and bump `packages/quilltap`.

Then re-run the baseline once with no `--tuning` and confirm every score matches
Phase 2. A mismatch is a bug in R7: fix it before going on.

## 7. Phase 4 — the sweep

Save each candidate as `~/iCloud/Quilltap/Friday/recall-probe/tuning-<name>.json`
and run the whole set with `--tuning-file`. Each output file is
`<name>-<slot>.json`. Candidates, in order:

| Name | Settings | Purpose |
|---|---|---|
| `t0` | `{}` | baseline (must equal Phase 2) |
| `r1` | gate 0.45 / 0.15 / 0.10 | the main change alone |
| `r12` | `r1` + cap 1.6 | |
| `r123` | `r12` + fresh 1.3 / 1.15 | the spec's proposal |
| `r1234` | `r123` + specificity anchors | |
| `full` | `r1234` + R6 reservation (≤ ⅓ of the head) | |

Then vary one constant at a time around `full`:

- gate margin 0.10 / 0.20
- ramp 0.05 / 0.15
- cap 1.4 / 1.8
- fresh 1.2/1.1 and 1.45/1.25

Stop varying a constant once two steps in a row change no scores.

For each candidate, add one row per turn to the tracker's results table, plus a
totals row: Σ gold@head, Σ anti@head, Σ low@head, F-slots ok, mean tokens.

**Acceptance** (from the spec's §3), all of these at once:

1. Σ gold@head is higher than `t0`'s new path.
2. No turn's gold@head is lower than its `t0` new path.
3. Every F-slot still has `fresh ok = y`.
4. Turn C's gold@head is unchanged or better, and its low@head is no higher.

When several candidates pass, prefer:

1. the highest Σ gold@head;
2. then the lowest Σ anti@head;
3. then the lowest mean tokens;
4. then the candidate closest to the spec's proposed values.

If none passes, stop and report to Charlie with the table. Don't loosen the
criteria on your own.

R5 is a fix, not a tuning: find which path admits Turn B's 0.281 row while in
Phase 3, and fix it there.

## 8. Phase 5 — put the chosen values into code

1. Make the winning values the defaults in `lib/memory/recall-tags.ts` and the
   tuning resolver. The R7 override stays, as the harness's knob.
2. Run the whole set with no `--tuning` and confirm it reproduces the winner's
   scores.
3. Update the tests pinned to today's behaviour to the new defaults, and add
   tests for R1–R6 as the spec's Chores section lists.
4. Update `help/memory-recall-relevance.md` ("What Else Recall Quietly Does"),
   the CHANGELOG, and the retuning spec: Status → Implemented; implementation
   notes with the chosen values, the winning row, and a link to this tracker.
5. Commit via /commit, push, open a PR when Charlie asks.

---

## Tracker

**Setup** — instance: Friday (`~/iCloud/Quilltap/Friday`, lock ACTIVE, PID 57345, confirmed via fresh `combined.log`) · server commit: `082305c21` (includes #84) · CLI version: `4.10.0-dev.120` · token metric: `content.length / 4`. The replay JSON rows carry neither a token estimate nor content, so the scorer looks up each head row's content by `memoryId`.

**Progress**

- [x] Setup confirmed (§3) — 2026-10-08
- [x] Probe set proposed (§4) — 2026-10-08
- [x] Probe set approved by Charlie — 2026-10-08
- [x] Baseline recorded (§5) — 2026-10-08
- [x] R7 built; `t0` reproduces the baseline (§6) — 2026-10-08. See the notes: `t0` is the pinned `asOf` run, not the Phase 2 baseline
- [x] R5 cause found and fixed — 2026-10-08 (related expansion; contract pinned by test)
- [x] Sweep done (§7) — 2026-10-08. **No winner:** no candidate passes; see the notes
- [x] Defaults changed in code; set reproduces the winner (§8) — 2026-10-08. `cap14` chosen by Charlie despite failing criterion 2 (option 3)

### Probe set

Speakers are Friday throughout. Her participant id differs per chat, and
`recall-replay` picks the first LLM seat by default, so Phase 2 checks each chat
and passes `--char d9d0d998-281e-4598-8345-d81d47be5e97` wherever Friday isn't
that seat. Gold ids were all created before the turn's user message (checked
against `createdAt`). Ids marked † are episode memories, discussed in the notes.
**Fresh target** marks the memory or memories that the F-slots' `fresh ok` scores.

| Slot | Chat | Turn | Speaker | Query gist | Gold (id · label) | Anti-gold |
|---|---|---|---|---|---|---|
| A | 6cc92fb7 | 11 | Friday | reviewing Ariadne's memory-reinforcement document | `6850b843` enabled forgetting mechanism · `a28dd8e3` committed to memory rebuild (about Charlie) · `26b06c67` LLM rewrite of personality file · `256b26e9` memory designed for growth · `13847a78` identified memory failure chain | `3254e4a9` wardrobe ship-in-4.10 · `90d6283a` outfit cascade scope · `f1a5c071` wardrobe search spec · `f49c974a` agreed not to create history · `92e00efb` off-topic, personal |
| B | 638325c6 | 16 | Friday | household logistics: lock, piano tuner, egg crates | `ee9d7890` tuner-window condition · `beb51873` tuner with Marie present · `15cb3c5d` tuner request sent · `4bd96ed0` condition on recutting Marie's key · `18f55c13` three notes, two neighbours · `7a1718d0` house carries sound, doors closed | `becaf1de` plain dish for amber (other chat) |
| C | 0826c0f8 | 21 | Friday | untangling the four weddings and dresses (retrospective) | `f85b0e56` split four weddings, set order · `062d5042` asked wedding name and date · `43469c95` gown bought on a wrong assumption · `092a7f0d` desire for all four (09-22) · `ab187615` honeymoon deferred to all four (09-21) · `9ce3e14b` all four or none (09-25) | — |
| F1 | 6cc92fb7 | 6 | Friday | who Marie Cantrell is: sat up late with Friday, frybread in the kitchen yesterday | **fresh target:** `92e81d63`† Friday comforts Marie · `c426ba5e`† kitchen breakfast, piano talk; also `8892c676` eggs, frybread offered · `4ae64897` Marie lives here now · `d571f1da` Marie a full resident · `6528b445` sent Friday to check on Marie | — |
| F2 | f62048bd | 9 | Friday | "did you hear Mochi in our conversation yesterday?" | **fresh target:** `90b839e2` Duchy ledger clean on tooth; also `58af1ad3`† assessor on the drive · `68d42536`† assessor's second visit · `b1558490` driveway walk, coming along | — |
| M | f92a4acd | 6 | Friday | Laura's entanglement read reaches back to her people; did anyone know? (Laura present, LLM) | `158b987a`† Pine Ridge trip to meet grandmother · `7c0d541b` wife and grandmother first · `0cd676a0` grandmother gave broken people rooms (about Laura) · `0fb1d244` offered Laura read-in or implant · `3c11f4d9` implant decision left to Laura | `beb0b922` a *different* grandmother (about Charlie) |
| O2 | b0c47adc | 6 | Friday | Friday's verdict on the new Folio article ("proposed, not ratified") | `36749837` ghostwritten article under Friday's name (07-21) · `0b0b0970` published essay live · `4247b609` read own essay as a stranger · `1df64431`† drafts Folio article on progressions · `2f484df5` co-author rule for fabricated history | — |
| O3 | f62048bd | 6 | Friday | worried about the assessor: tailing staff, calls to Jefferson City | `9a0e4d00` assessor visit targeting the estate · `d52f4e7b` porch and shed visit · `eb19a4d4` records request on parcel · `7c971493` building the county file · `cbf03960` assessor packet filing map | — |
| O4 | cc745d78 | 6 | Friday | Charlie doubts he can be a good husband or protect them all | `c2acace0` questioned marriage sustainability (07-04) · `e50d0c33` Charlie's role as collaborative · `3aeb4766` afraid the open arrangement is too much freedom · `26689573` does not want a harem · `e1515b8c` called out being managed by wives | — |

Nine turns, inside the 8–12 range. W is left to C, whose gold includes the
older on-topic background (09-21, 09-22, 09-25) that the hard window drops.
Slot O1 is unused (see notes).

### Results

Path shows the head size in brackets. `gold rank` lists each gold id outside the head with its rank in the top 40 (`—` if absent). `late@head` is an extra column: head rows created after the turn's user message (see notes). `fresh ok` counts as `y` when any of the slot's fresh targets is in the head.

| Candidate | Slot | Path | gold@head | gold rank | anti@head | low@head | tokens | fresh ok | late@head |
|---|---|---|---|---|---|---|---|---|---|
| baseline | A | old (5) | 0/5 | 6850b843:36 a28dd8e3:9 26b06c67:7 256b26e9:— 13847a78:— | 0 | 0 | 246 | — | 2 |
| baseline | A | new (15) | 0/5 | 6850b843:— a28dd8e3:21 26b06c67:18 256b26e9:— 13847a78:— | 5 | 7 | 718 | — | 2 |
| baseline | B | old (5) | 1/6 | beb51873:21 15cb3c5d:— 4bd96ed0:— 18f55c13:— 7a1718d0:19 | 0 | 2 | 249 | — | 0 |
| baseline | B | new (15) | 0/6 | ee9d7890:29 beb51873:— 15cb3c5d:— 4bd96ed0:— 18f55c13:— 7a1718d0:— | 0 | 13 | 686 | — | 0 |
| baseline | C | old (5) | 0/6 | f85b0e56:27 062d5042:40 43469c95:— 092a7f0d:13 ab187615:15 9ce3e14b:— | 0 | 0 | 237 | — | 1 |
| baseline | C | new (30) | 3/6 | 092a7f0d:— ab187615:— 9ce3e14b:— | 0 | 5 | 1684 | — | 4 |
| baseline | F1 | old (5) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 0 | 264 | n | 0 |
| baseline | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 4 | 1679 | n | 3 |
| baseline | F2 | old (5) | 0/4 | 90b839e2:— 58af1ad3:— 68d42536:— b1558490:— | 0 | 0 | 235 | n | 2 |
| baseline | F2 | new (30) | 2/4 | 58af1ad3:— b1558490:— | 0 | 3 | 1855 | y | 13 |
| baseline | M | old (5) | 0/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 0fb1d244:33 3c11f4d9:— | 0 | 0 | 270 | — | 3 |
| baseline | M | new (30) | 1/5 | 158b987a:— 7c0d541b:37 0cd676a0:— 3c11f4d9:— | 0 | 8 | 1782 | — | 4 |
| baseline | O2 | old (5) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 283 | — | 2 |
| baseline | O2 | new (15) | 2/5 | 36749837:— 1df64431:— 2f484df5:— | 0 | 7 | 899 | — | 3 |
| baseline | O3 | old (5) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 287 | — | 1 |
| baseline | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 1933 | — | 11 |
| baseline | O4 | old (5) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 504 | — | 0 |
| baseline | O4 | new (30) | 0/5 | c2acace0:— e50d0c33:— 3aeb4766:— 26689573:— e1515b8c:— | 0 | 11 | 1874 | — | 0 |
| baseline | **Σ** | old | **3/47** | | **0** | **2** | mean 286 | 0/2 | 11 |
| baseline | **Σ** | new | **8/47** | | **5** | **58** | mean 1457 | 1/2 | 40 |
| t0 | A | old (5) | 1/5 | 6850b843:33 a28dd8e3:7 256b26e9:— 13847a78:— | 0 | 0 | 248 | — | 0 |
| t0 | A | new (15) | 1/5 | 6850b843:— a28dd8e3:17 256b26e9:— 13847a78:— | 5 | 8 | 725 | — | 0 |
| t0 | B | old (5) | 1/6 | beb51873:21 15cb3c5d:— 4bd96ed0:— 18f55c13:— 7a1718d0:19 | 0 | 2 | 249 | — | 0 |
| t0 | B | new (15) | 0/6 | ee9d7890:29 beb51873:— 15cb3c5d:— 4bd96ed0:— 18f55c13:— 7a1718d0:— | 0 | 13 | 686 | — | 0 |
| t0 | C | old (5) | 0/6 | f85b0e56:24 062d5042:37 43469c95:— 092a7f0d:10 ab187615:13 9ce3e14b:— | 0 | 0 | 231 | — | 0 |
| t0 | C | new (30) | 3/6 | 092a7f0d:— ab187615:— 9ce3e14b:— | 0 | 9 | 1624 | — | 0 |
| t0 | F1 | old (5) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 0 | 264 | n | 0 |
| t0 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 5 | 1643 | n | 0 |
| t0 | F2 | old (5) | 0/4 | 90b839e2:— 58af1ad3:— 68d42536:28 b1558490:— | 0 | 0 | 225 | n | 0 |
| t0 | F2 | new (30) | 3/4 | b1558490:— | 0 | 6 | 1982 | y | 0 |
| t0 | M | old (5) | 0/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 0fb1d244:31 3c11f4d9:— | 0 | 0 | 223 | — | 0 |
| t0 | M | new (30) | 2/5 | 158b987a:— 0cd676a0:— 3c11f4d9:— | 0 | 11 | 1781 | — | 0 |
| t0 | O2 | old (5) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 252 | — | 0 |
| t0 | O2 | new (15) | 2/5 | 36749837:— 1df64431:— 2f484df5:— | 0 | 6 | 927 | — | 0 |
| t0 | O3 | old (5) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 297 | — | 0 |
| t0 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 2 | 2171 | — | 0 |
| t0 | O4 | old (5) | 1/5 | c2acace0:— e50d0c33:— 26689573:11 e1515b8c:— | 0 | 0 | 504 | — | 0 |
| t0 | O4 | new (30) | 0/5 | c2acace0:— e50d0c33:— 3aeb4766:— 26689573:— e1515b8c:— | 0 | 11 | 1894 | — | 0 |
| t0 | **Σ** | old | **4/47** | | **0** | **2** | mean 277 | 0/2 | 0 |
| t0 | **Σ** | new | **11/47** | | **5** | **71** | mean 1493 | 1/2 | 0 |
| r1 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 798 | — | 0 |
| r1 | B | new (15) | 1/6 | beb51873:18 15cb3c5d:— 4bd96ed0:— 18f55c13:— 7a1718d0:17 | 0 | 0 | 827 | — | 0 |
| r1 | C | new (30) | 3/6 | 092a7f0d:— ab187615:— 9ce3e14b:— | 0 | 8 | 1806 | — | 0 |
| r1 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| r1 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1771 | n | 0 |
| r1 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2467 | — | 0 |
| r1 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 737 | — | 0 |
| r1 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2470 | — | 0 |
| r1 | O4 | new (30) | 0/5 | c2acace0:— e50d0c33:— 3aeb4766:— 26689573:— e1515b8c:— | 0 | 4 | 2000 | — | 0 |
| r1 | **Σ** | new | **9/47** | | **1** | **13** | mean 1597 | 0/2 | 0 |
| r12 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 790 | — | 0 |
| r12 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:39 | 0 | 0 | 824 | — | 0 |
| r12 | C | new (30) | 3/6 | 092a7f0d:— ab187615:— 9ce3e14b:— | 0 | 8 | 1806 | — | 0 |
| r12 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| r12 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1862 | n | 0 |
| r12 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2467 | — | 0 |
| r12 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| r12 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2395 | — | 0 |
| r12 | O4 | new (30) | 0/5 | c2acace0:— e50d0c33:— 3aeb4766:— 26689573:— e1515b8c:— | 0 | 4 | 2000 | — | 0 |
| r12 | **Σ** | new | **11/47** | | **1** | **13** | mean 1599 | 0/2 | 0 |
| r123 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 790 | — | 0 |
| r123 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:38 | 0 | 0 | 669 | — | 0 |
| r123 | C | new (30) | 3/6 | 092a7f0d:— ab187615:— 9ce3e14b:— | 0 | 8 | 1806 | — | 0 |
| r123 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| r123 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1862 | n | 0 |
| r123 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2467 | — | 0 |
| r123 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| r123 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2395 | — | 0 |
| r123 | O4 | new (30) | 0/5 | c2acace0:— e50d0c33:— 3aeb4766:— 26689573:— e1515b8c:— | 0 | 4 | 2000 | — | 0 |
| r123 | **Σ** | new | **11/47** | | **1** | **13** | mean 1582 | 0/2 | 0 |
| r1234 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 714 | — | 0 |
| r1234 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| r1234 | C | new (30) | 4/6 | 092a7f0d:35 9ce3e14b:— | 0 | 0 | 2095 | — | 0 |
| r1234 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| r1234 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1862 | n | 0 |
| r1234 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2467 | — | 0 |
| r1234 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| r1234 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2395 | — | 0 |
| r1234 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1807 | — | 0 |
| r1234 | **Σ** | new | **13/47** | | **1** | **1** | mean 1585 | 0/2 | 0 |
| full | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 714 | — | 0 |
| full | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| full | C | new (30) | 4/6 | 092a7f0d:35 9ce3e14b:— | 0 | 0 | 2095 | — | 0 |
| full | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| full | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1862 | n | 0 |
| full | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2467 | — | 0 |
| full | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| full | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2395 | — | 0 |
| full | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1807 | — | 0 |
| full | **Σ** | new | **13/47** | | **1** | **1** | mean 1585 | 0/2 | 0 |
| m10 | A | new (15) | 2/5 | 6850b843:31 256b26e9:— 13847a78:— | 0 | 0 | 672 | — | 0 |
| m10 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 821 | — | 0 |
| m10 | C | new (30) | 4/6 | 092a7f0d:32 9ce3e14b:— | 0 | 0 | 2202 | — | 0 |
| m10 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1495 | n | 0 |
| m10 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1797 | n | 0 |
| m10 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2482 | — | 0 |
| m10 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 787 | — | 0 |
| m10 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2684 | — | 0 |
| m10 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1800 | — | 0 |
| m10 | **Σ** | new | **13/47** | | **0** | **1** | mean 1638 | 0/2 | 0 |
| m20 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 720 | — | 0 |
| m20 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 680 | — | 0 |
| m20 | C | new (30) | 3/6 | 092a7f0d:— ab187615:34 9ce3e14b:— | 0 | 0 | 1764 | — | 0 |
| m20 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| m20 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1718 | n | 0 |
| m20 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2424 | — | 0 |
| m20 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 736 | — | 0 |
| m20 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2150 | — | 0 |
| m20 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1714 | — | 0 |
| m20 | **Σ** | new | **12/47** | | **1** | **1** | mean 1490 | 0/2 | 0 |
| ramp05 | A | new (15) | 2/5 | 6850b843:37 256b26e9:— 13847a78:— | 0 | 0 | 681 | — | 0 |
| ramp05 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 685 | — | 0 |
| ramp05 | C | new (30) | 4/6 | 092a7f0d:36 9ce3e14b:— | 0 | 0 | 2130 | — | 0 |
| ramp05 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 0 | 1492 | n | 0 |
| ramp05 | F2 | new (30) | 0/4 | 90b839e2:— 58af1ad3:35 68d42536:— b1558490:— | 0 | 0 | 1726 | n | 0 |
| ramp05 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2482 | — | 0 |
| ramp05 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 753 | — | 0 |
| ramp05 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2631 | — | 0 |
| ramp05 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1871 | — | 0 |
| ramp05 | **Σ** | new | **12/47** | | **0** | **0** | mean 1606 | 0/2 | 0 |
| ramp15 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 714 | — | 0 |
| ramp15 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| ramp15 | C | new (30) | 4/6 | 092a7f0d:39 9ce3e14b:— | 0 | 0 | 1866 | — | 0 |
| ramp15 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 3 | 1601 | n | 0 |
| ramp15 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1784 | n | 0 |
| ramp15 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2525 | — | 0 |
| ramp15 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 736 | — | 0 |
| ramp15 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2395 | — | 0 |
| ramp15 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1805 | — | 0 |
| ramp15 | **Σ** | new | **13/47** | | **1** | **3** | mean 1566 | 0/2 | 0 |
| cap14 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 708 | — | 0 |
| cap14 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| cap14 | C | new (30) | 5/6 | 9ce3e14b:— | 0 | 0 | 2077 | — | 0 |
| cap14 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1495 | n | 0 |
| cap14 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1832 | n | 0 |
| cap14 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2467 | — | 0 |
| cap14 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 755 | — | 0 |
| cap14 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2712 | — | 0 |
| cap14 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1965 | — | 0 |
| cap14 | **Σ** | new | **14/47** | | **1** | **1** | mean 1631 | 0/2 | 0 |
| cap18 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 694 | — | 0 |
| cap18 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| cap18 | C | new (30) | 4/6 | 092a7f0d:40 9ce3e14b:— | 0 | 0 | 1871 | — | 0 |
| cap18 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| cap18 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1771 | n | 0 |
| cap18 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2467 | — | 0 |
| cap18 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| cap18 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2395 | — | 0 |
| cap18 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1753 | — | 0 |
| cap18 | **Σ** | new | **13/47** | | **1** | **1** | mean 1541 | 0/2 | 0 |
| fresh12 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 714 | — | 0 |
| fresh12 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| fresh12 | C | new (30) | 4/6 | 092a7f0d:35 9ce3e14b:— | 0 | 0 | 2095 | — | 0 |
| fresh12 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| fresh12 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1862 | n | 0 |
| fresh12 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2467 | — | 0 |
| fresh12 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| fresh12 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2395 | — | 0 |
| fresh12 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1807 | — | 0 |
| fresh12 | **Σ** | new | **13/47** | | **1** | **1** | mean 1585 | 0/2 | 0 |
| fresh145 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 714 | — | 0 |
| fresh145 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 830 | — | 0 |
| fresh145 | C | new (30) | 4/6 | 092a7f0d:35 9ce3e14b:— | 0 | 0 | 2095 | — | 0 |
| fresh145 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| fresh145 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1862 | n | 0 |
| fresh145 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2467 | — | 0 |
| fresh145 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| fresh145 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2395 | — | 0 |
| fresh145 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1807 | — | 0 |
| fresh145 | **Σ** | new | **13/47** | | **1** | **1** | mean 1602 | 0/2 | 0 |

#### Sweep summary (new path, gold@head per slot)

Each run used `--signals-from baseline-<slot>.json --as-of --memory-budget
8000 --limit 40`, and `t0` was re-recorded twice after the server restart.
Tuning never reaches the old path, so its rows equal `t0`'s and aren't
repeated above. `pass?` lists the criteria each candidate fails: `Σ` = not
above `t0`; `drop:` = slots that lose gold against `t0`; `fresh` = an F-slot
without its fresh target; `C` = Turn C got worse. `tuning-t0.json` (`{}`)
gave byte-identical output to `t0`. Candidate files are
`recall-probe/tuning-<name>.json`.

| cand | A | B | C | F1 | F2 | M | O2 | O3 | O4 | Σgold | Σanti | Σlow | fresh | tok | pass? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| t0 | 1/5 | 0/6 | 3/6 | 0/6 | 3/4 | 2/5 | 2/5 | 0/5 | 0/5 | 11/47 | 5 | 71 | 1/2 | 1493 | Σ fresh |
| r1 | 2/5 | 1/6 | 3/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 0/5 | 9/47 | 1 | 13 | 0/2 | 1597 | Σ drop:F2,M,O2 fresh |
| r12 | 2/5 | 3/6 | 3/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 0/5 | 11/47 | 1 | 13 | 0/2 | 1599 | Σ drop:F2,M,O2 fresh |
| r123 | 2/5 | 3/6 | 3/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 0/5 | 11/47 | 1 | 13 | 0/2 | 1582 | Σ drop:F2,M,O2 fresh |
| r1234 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 1 | 0/2 | 1585 | drop:F2,M,O2 fresh |
| full | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 1 | 0/2 | 1585 | drop:F2,M,O2 fresh |
| m10 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 0 | 1 | 0/2 | 1638 | drop:F2,M,O2 fresh |
| m20 | 2/5 | 3/6 | 3/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 12/47 | 1 | 1 | 0/2 | 1490 | drop:F2,M,O2 fresh |
| ramp05 | 2/5 | 3/6 | 4/6 | 0/6 | 0/4 | 1/5 | 1/5 | 0/5 | 1/5 | 12/47 | 0 | 0 | 0/2 | 1606 | drop:F2,M,O2 fresh |
| ramp15 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 3 | 0/2 | 1566 | drop:F2,M,O2 fresh |
| cap14 | 2/5 | 3/6 | 5/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 14/47 | 1 | 1 | 0/2 | 1631 | drop:F2,M,O2 fresh |
| cap18 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 1 | 0/2 | 1541 | drop:F2,M,O2 fresh |
| fresh12 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 1 | 0/2 | 1585 | drop:F2,M,O2 fresh |
| fresh145 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 1 | 0/2 | 1602 | drop:F2,M,O2 fresh |

#### Option 1 — fresh boost outside the gate (`freshBypassesGate`)

Charlie chose option 1 on 2026-10-08. `freshBypassesGate: true` applies the
fresh-event boost in full whatever the gate says, gates the other boosts, and
keeps the R2 cap on the total. `o1` is `full` plus the bypass; the rest vary
one thing around it. `noR4` drops specific anchors. The server reloaded the
changed modules mid-sweep, which reset the embedding memo. A fresh `t0` and
`full` re-scored identically to the rows above, so comparisons still hold.

| cand | A | B | C | F1 | F2 | M | O2 | O3 | O4 | Σgold | Σanti | Σlow | fresh | tok | pass? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| t0 | 1/5 | 0/6 | 3/6 | 0/6 | 3/4 | 2/5 | 2/5 | 0/5 | 0/5 | 11/47 | 5 | 71 | 1/2 | 1493 | Σ fresh |
| full | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 1 | 0/2 | 1585 | drop:F2,M,O2 fresh |
| o1 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 3 | 0/2 | 1550 | drop:F2,M,O2 fresh |
| o1-fresh16 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 11 | 0/2 | 1556 | drop:F2,M,O2 fresh |
| o1-fresh145 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 7 | 0/2 | 1583 | drop:F2,M,O2 fresh |
| o1-cap14 | 2/5 | 3/6 | 5/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 14/47 | 1 | 4 | 0/2 | 1615 | drop:F2,M,O2 fresh |
| o1-cap18 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 3 | 0/2 | 1532 | drop:F2,M,O2 fresh |
| o1-m10 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 7 | 0/2 | 1609 | drop:F2,M,O2 fresh |
| o1-m20 | 2/5 | 3/6 | 3/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 0/5 | 11/47 | 1 | 2 | 0/2 | 1502 | Σ drop:F2,M,O2 fresh |
| o1-ramp05 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 6 | 0/2 | 1597 | drop:F2,M,O2 fresh |
| o1-ramp15 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 4 | 0/2 | 1566 | drop:F2,M,O2 fresh |
| o1-noR4 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 0/5 | 12/47 | 1 | 10 | 0/2 | 1547 | drop:F2,M,O2 fresh |
| o1-noR4-fresh16 | 2/5 | 1/6 | 4/6 | 0/6 | 1/4 | 2/5 | 2/5 | 0/5 | 0/5 | 12/47 | 4 | 31 | 0/2 | 1523 | drop:F2 fresh |

| o1 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 1 | 752 | — | 0 |
| o1 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| o1 | C | new (30) | 4/6 | 092a7f0d:36 9ce3e14b:— | 0 | 0 | 1980 | — | 0 |
| o1 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| o1 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1771 | n | 0 |
| o1 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 1 | 2323 | — | 0 |
| o1 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| o1 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2395 | — | 0 |
| o1 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1808 | — | 0 |
| o1 | **Σ** | new | **13/47** | | **1** | **3** | mean 1550 | 0/2 | 0 |
| o1-fresh16 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 5 | 745 | — | 0 |
| o1-fresh16 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 914 | — | 0 |
| o1-fresh16 | C | new (30) | 4/6 | 092a7f0d:36 9ce3e14b:— | 0 | 0 | 1980 | — | 0 |
| o1-fresh16 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| o1-fresh16 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1771 | n | 0 |
| o1-fresh16 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 5 | 2019 | — | 0 |
| o1-fresh16 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:40 2f484df5:— | 0 | 0 | 750 | — | 0 |
| o1-fresh16 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2432 | — | 0 |
| o1-fresh16 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1890 | — | 0 |
| o1-fresh16 | **Σ** | new | **13/47** | | **1** | **11** | mean 1556 | 0/2 | 0 |
| o1-fresh145 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 3 | 737 | — | 0 |
| o1-fresh145 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 914 | — | 0 |
| o1-fresh145 | C | new (30) | 4/6 | 092a7f0d:36 9ce3e14b:— | 0 | 0 | 1980 | — | 0 |
| o1-fresh145 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| o1-fresh145 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1771 | n | 0 |
| o1-fresh145 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 3 | 2267 | — | 0 |
| o1-fresh145 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| o1-fresh145 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2432 | — | 0 |
| o1-fresh145 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1893 | — | 0 |
| o1-fresh145 | **Σ** | new | **13/47** | | **1** | **7** | mean 1583 | 0/2 | 0 |
| o1-cap14 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 2 | 722 | — | 0 |
| o1-cap14 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| o1-cap14 | C | new (30) | 5/6 | 9ce3e14b:— | 0 | 0 | 2066 | — | 0 |
| o1-cap14 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1495 | n | 0 |
| o1-cap14 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1823 | n | 0 |
| o1-cap14 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 1 | 2323 | — | 0 |
| o1-cap14 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 755 | — | 0 |
| o1-cap14 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2595 | — | 0 |
| o1-cap14 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 2084 | — | 0 |
| o1-cap14 | **Σ** | new | **14/47** | | **1** | **4** | mean 1615 | 0/2 | 0 |
| o1-cap18 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 1 | 742 | — | 0 |
| o1-cap18 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| o1-cap18 | C | new (30) | 4/6 | 092a7f0d:— 9ce3e14b:— | 0 | 0 | 1836 | — | 0 |
| o1-cap18 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| o1-cap18 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1771 | n | 0 |
| o1-cap18 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 1 | 2323 | — | 0 |
| o1-cap18 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| o1-cap18 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2395 | — | 0 |
| o1-cap18 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1798 | — | 0 |
| o1-cap18 | **Σ** | new | **13/47** | | **1** | **3** | mean 1532 | 0/2 | 0 |
| o1-m10 | A | new (15) | 2/5 | 6850b843:39 256b26e9:— 13847a78:— | 1 | 2 | 704 | — | 0 |
| o1-m10 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 920 | — | 0 |
| o1-m10 | C | new (30) | 4/6 | 092a7f0d:33 9ce3e14b:— | 0 | 0 | 2087 | — | 0 |
| o1-m10 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1495 | n | 0 |
| o1-m10 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1707 | n | 0 |
| o1-m10 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 4 | 2222 | — | 0 |
| o1-m10 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 787 | — | 0 |
| o1-m10 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2627 | — | 0 |
| o1-m10 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1935 | — | 0 |
| o1-m10 | **Σ** | new | **13/47** | | **1** | **7** | mean 1609 | 0/2 | 0 |
| o1-m20 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 1 | 730 | — | 0 |
| o1-m20 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 680 | — | 0 |
| o1-m20 | C | new (30) | 3/6 | 092a7f0d:— ab187615:34 9ce3e14b:— | 0 | 0 | 1764 | — | 0 |
| o1-m20 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| o1-m20 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1718 | n | 0 |
| o1-m20 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2424 | — | 0 |
| o1-m20 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 736 | — | 0 |
| o1-m20 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2150 | — | 0 |
| o1-m20 | O4 | new (30) | 0/5 | c2acace0:— e50d0c33:— 3aeb4766:33 26689573:— e1515b8c:— | 0 | 0 | 1817 | — | 0 |
| o1-m20 | **Σ** | new | **11/47** | | **1** | **2** | mean 1502 | 0/2 | 0 |
| o1-ramp05 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 1 | 697 | — | 0 |
| o1-ramp05 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 685 | — | 0 |
| o1-ramp05 | C | new (30) | 4/6 | 092a7f0d:36 9ce3e14b:— | 0 | 0 | 2213 | — | 0 |
| o1-ramp05 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| o1-ramp05 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1832 | n | 0 |
| o1-ramp05 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 4 | 2174 | — | 0 |
| o1-ramp05 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 753 | — | 0 |
| o1-ramp05 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2650 | — | 0 |
| o1-ramp05 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1865 | — | 0 |
| o1-ramp05 | **Σ** | new | **13/47** | | **1** | **6** | mean 1597 | 0/2 | 0 |
| o1-ramp15 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 1 | 762 | — | 0 |
| o1-ramp15 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| o1-ramp15 | C | new (30) | 4/6 | 092a7f0d:40 9ce3e14b:— | 0 | 0 | 1859 | — | 0 |
| o1-ramp15 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 3 | 1601 | n | 0 |
| o1-ramp15 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1716 | n | 0 |
| o1-ramp15 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2525 | — | 0 |
| o1-ramp15 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 736 | — | 0 |
| o1-ramp15 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2298 | — | 0 |
| o1-ramp15 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1925 | — | 0 |
| o1-ramp15 | **Σ** | new | **13/47** | | **1** | **4** | mean 1566 | 0/2 | 0 |
| o1-noR4 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 807 | — | 0 |
| o1-noR4 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 2 | 700 | — | 0 |
| o1-noR4 | C | new (30) | 4/6 | 092a7f0d:— 9ce3e14b:— | 0 | 2 | 1764 | — | 0 |
| o1-noR4 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| o1-noR4 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1771 | n | 0 |
| o1-noR4 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 1 | 2323 | — | 0 |
| o1-noR4 | O2 | new (15) | 1/5 | 36749837:— 4247b609:31 1df64431:— 2f484df5:— | 0 | 1 | 772 | — | 0 |
| o1-noR4 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2395 | — | 0 |
| o1-noR4 | O4 | new (30) | 0/5 | c2acace0:— e50d0c33:— 3aeb4766:34 26689573:— e1515b8c:— | 0 | 3 | 1892 | — | 0 |
| o1-noR4 | **Σ** | new | **12/47** | | **1** | **10** | mean 1547 | 0/2 | 0 |
| o1-noR4-fresh16 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 4 | 7 | 713 | — | 0 |
| o1-noR4-fresh16 | B | new (15) | 1/6 | beb51873:22 15cb3c5d:— 4bd96ed0:— 18f55c13:— 7a1718d0:20 | 0 | 7 | 670 | — | 0 |
| o1-noR4-fresh16 | C | new (30) | 4/6 | 092a7f0d:— 9ce3e14b:— | 0 | 2 | 1764 | — | 0 |
| o1-noR4-fresh16 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| o1-noR4-fresh16 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1856 | n | 0 |
| o1-noR4-fresh16 | M | new (30) | 2/5 | 158b987a:— 0cd676a0:— 3c11f4d9:— | 0 | 8 | 2017 | — | 0 |
| o1-noR4-fresh16 | O2 | new (15) | 2/5 | 36749837:— 1df64431:— 2f484df5:— | 0 | 3 | 862 | — | 0 |
| o1-noR4-fresh16 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2432 | — | 0 |
| o1-noR4-fresh16 | O4 | new (30) | 0/5 | c2acace0:— e50d0c33:— 3aeb4766:34 26689573:— e1515b8c:— | 0 | 3 | 1892 | — | 0 |
| o1-noR4-fresh16 | **Σ** | new | **12/47** | | **4** | **31** | mean 1523 | 0/2 | 0 |

#### Options 1 + 2 — both time boosts outside the gate, and fixed R4 selection

Charlie chose this on 2026-10-08. The new knobs are `windowBypassesGate`
(the time-window boost applied in full, like `freshBypassesGate`),
`anchorMinHits` (names in fewer memories aren't anchors) and `anchorOrder`
(`rarest`, or `distiller`, which keeps the distiller's order among names of
characters not present). All candidates start from `full`. `o1w` = both
bypasses; `o2d` / `o2m3` = R4 fix alone; `o12*` = both; `-f16` = fresh back
at 1.6/1.35; `-capN` = boost cap N. After the reload, `t0` and `full`
re-scored identically.

| cand | A | B | C | F1 | F2 | M | O2 | O3 | O4 | Σgold | Σanti | Σlow | fresh | tok | pass? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| t0 | 1/5 | 0/6 | 3/6 | 0/6 | 3/4 | 2/5 | 2/5 | 0/5 | 0/5 | 11/47 | 5 | 71 | 1/2 | 1493 | Σ fresh |
| full | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 1 | 0/2 | 1585 | drop:F2,M,O2 fresh |
| o1 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 3 | 0/2 | 1550 | drop:F2,M,O2 fresh |
| o1w | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 4 | 0/2 | 1552 | drop:F2,M,O2 fresh |
| o2d | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 1 | 0/2 | 1585 | drop:F2,M,O2 fresh |
| o2m3 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 1 | 0/2 | 1585 | drop:F2,M,O2 fresh |
| o12m3 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 4 | 0/2 | 1562 | drop:F2,M,O2 fresh |
| o12d | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 4 | 0/2 | 1562 | drop:F2,M,O2 fresh |
| o12d3 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 4 | 0/2 | 1562 | drop:F2,M,O2 fresh |
| o12d-f16 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 12 | 0/2 | 1558 | drop:F2,M,O2 fresh |
| o12d-cap2 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 4 | 0/2 | 1548 | drop:F2,M,O2 fresh |
| o12d-cap22 | 2/5 | 3/6 | 4/6 | 0/6 | 1/4 | 1/5 | 1/5 | 0/5 | 1/5 | 13/47 | 1 | 4 | 0/2 | 1548 | drop:F2,M,O2 fresh |
| o12d-f16-cap2 | 2/5 | 3/6 | 4/6 | 0/6 | 2/4 | 1/5 | 1/5 | 0/5 | 0/5 | 13/47 | 1 | 17 | 1/2 | 1526 | drop:F2,M,O2 fresh |
| o12d-f16-cap22 | 2/5 | 1/6 | 4/6 | 0/6 | 2/4 | 1/5 | 1/5 | 0/5 | 0/5 | 11/47 | 1 | 18 | 1/2 | 1528 | Σ drop:F2,M,O2 fresh |
| o12d-f16-cap25 | 2/5 | 1/6 | 4/6 | 0/6 | 2/4 | 1/5 | 1/5 | 0/5 | 0/5 | 11/47 | 1 | 18 | 1/2 | 1528 | Σ drop:F2,M,O2 fresh |

| o1w | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 1 | 752 | — | 0 |
| o1w | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| o1w | C | new (30) | 4/6 | 092a7f0d:— 9ce3e14b:— | 0 | 0 | 1815 | — | 0 |
| o1w | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 2 | 1594 | n | 0 |
| o1w | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1771 | n | 0 |
| o1w | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 1 | 2323 | — | 0 |
| o1w | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| o1w | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2403 | — | 0 |
| o1w | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1889 | — | 0 |
| o1w | **Σ** | new | **13/47** | | **1** | **4** | mean 1552 | 0/2 | 0 |
| o2d | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 714 | — | 0 |
| o2d | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| o2d | C | new (30) | 4/6 | 092a7f0d:35 9ce3e14b:— | 0 | 0 | 2095 | — | 0 |
| o2d | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| o2d | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1862 | n | 0 |
| o2d | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2467 | — | 0 |
| o2d | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| o2d | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2395 | — | 0 |
| o2d | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1807 | — | 0 |
| o2d | **Σ** | new | **13/47** | | **1** | **1** | mean 1585 | 0/2 | 0 |
| o2m3 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 0 | 714 | — | 0 |
| o2m3 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| o2m3 | C | new (30) | 4/6 | 092a7f0d:35 9ce3e14b:— | 0 | 0 | 2095 | — | 0 |
| o2m3 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 1 | 1500 | n | 0 |
| o2m3 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1862 | n | 0 |
| o2m3 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 0 | 2467 | — | 0 |
| o2m3 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| o2m3 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2395 | — | 0 |
| o2m3 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1807 | — | 0 |
| o2m3 | **Σ** | new | **13/47** | | **1** | **1** | mean 1585 | 0/2 | 0 |
| o12m3 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 1 | 752 | — | 0 |
| o12m3 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| o12m3 | C | new (30) | 4/6 | 092a7f0d:— 9ce3e14b:— | 0 | 0 | 1815 | — | 0 |
| o12m3 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 2 | 1594 | n | 0 |
| o12m3 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1856 | n | 0 |
| o12m3 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 1 | 2323 | — | 0 |
| o12m3 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| o12m3 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2403 | — | 0 |
| o12m3 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1889 | — | 0 |
| o12m3 | **Σ** | new | **13/47** | | **1** | **4** | mean 1562 | 0/2 | 0 |
| o12d | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 1 | 752 | — | 0 |
| o12d | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| o12d | C | new (30) | 4/6 | 092a7f0d:— 9ce3e14b:— | 0 | 0 | 1815 | — | 0 |
| o12d | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 2 | 1594 | n | 0 |
| o12d | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1856 | n | 0 |
| o12d | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 1 | 2323 | — | 0 |
| o12d | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| o12d | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2403 | — | 0 |
| o12d | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1889 | — | 0 |
| o12d | **Σ** | new | **13/47** | | **1** | **4** | mean 1562 | 0/2 | 0 |
| o12d3 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 1 | 752 | — | 0 |
| o12d3 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 672 | — | 0 |
| o12d3 | C | new (30) | 4/6 | 092a7f0d:— 9ce3e14b:— | 0 | 0 | 1815 | — | 0 |
| o12d3 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 2 | 1594 | n | 0 |
| o12d3 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1856 | n | 0 |
| o12d3 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 1 | 2323 | — | 0 |
| o12d3 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| o12d3 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2403 | — | 0 |
| o12d3 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1889 | — | 0 |
| o12d3 | **Σ** | new | **13/47** | | **1** | **4** | mean 1562 | 0/2 | 0 |
| o12d-f16 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 5 | 745 | — | 0 |
| o12d-f16 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 914 | — | 0 |
| o12d-f16 | C | new (30) | 4/6 | 092a7f0d:— 9ce3e14b:— | 0 | 0 | 1815 | — | 0 |
| o12d-f16 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 2 | 1594 | n | 0 |
| o12d-f16 | F2 | new (30) | 1/4 | 90b839e2:— 68d42536:— b1558490:— | 0 | 0 | 1856 | n | 0 |
| o12d-f16 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 5 | 2019 | — | 0 |
| o12d-f16 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:40 2f484df5:— | 0 | 0 | 750 | — | 0 |
| o12d-f16 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2440 | — | 0 |
| o12d-f16 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1889 | — | 0 |
| o12d-f16 | **Σ** | new | **13/47** | | **1** | **12** | mean 1558 | 0/2 | 0 |
| o12d-cap2 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 1 | 742 | — | 0 |
| o12d-cap2 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 711 | — | 0 |
| o12d-cap2 | C | new (30) | 4/6 | 092a7f0d:— 9ce3e14b:— | 0 | 0 | 1693 | — | 0 |
| o12d-cap2 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 2 | 1594 | n | 0 |
| o12d-cap2 | F2 | new (30) | 1/4 | 90b839e2:33 68d42536:— b1558490:— | 0 | 0 | 1856 | n | 0 |
| o12d-cap2 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 1 | 2323 | — | 0 |
| o12d-cap2 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| o12d-cap2 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2403 | — | 0 |
| o12d-cap2 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1862 | — | 0 |
| o12d-cap2 | **Σ** | new | **13/47** | | **1** | **4** | mean 1548 | 0/2 | 0 |
| o12d-cap22 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 1 | 742 | — | 0 |
| o12d-cap22 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 711 | — | 0 |
| o12d-cap22 | C | new (30) | 4/6 | 092a7f0d:— 9ce3e14b:— | 0 | 0 | 1693 | — | 0 |
| o12d-cap22 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 2 | 1594 | n | 0 |
| o12d-cap22 | F2 | new (30) | 1/4 | 90b839e2:33 68d42536:— b1558490:— | 0 | 0 | 1856 | n | 0 |
| o12d-cap22 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 1 | 2323 | — | 0 |
| o12d-cap22 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:— 2f484df5:— | 0 | 0 | 750 | — | 0 |
| o12d-cap22 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2403 | — | 0 |
| o12d-cap22 | O4 | new (30) | 1/5 | c2acace0:— e50d0c33:— 26689573:— e1515b8c:— | 0 | 0 | 1862 | — | 0 |
| o12d-cap22 | **Σ** | new | **13/47** | | **1** | **4** | mean 1548 | 0/2 | 0 |
| o12d-f16-cap2 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 5 | 731 | — | 0 |
| o12d-f16-cap2 | B | new (15) | 3/6 | 15cb3c5d:— 4bd96ed0:— 18f55c13:— | 0 | 0 | 934 | — | 0 |
| o12d-f16-cap2 | C | new (30) | 4/6 | 092a7f0d:— 9ce3e14b:— | 0 | 0 | 1693 | — | 0 |
| o12d-f16-cap2 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 2 | 1594 | n | 0 |
| o12d-f16-cap2 | F2 | new (30) | 2/4 | 68d42536:— b1558490:— | 0 | 3 | 1828 | y | 0 |
| o12d-f16-cap2 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 5 | 2019 | — | 0 |
| o12d-f16-cap2 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:40 2f484df5:— | 0 | 0 | 737 | — | 0 |
| o12d-f16-cap2 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2353 | — | 0 |
| o12d-f16-cap2 | O4 | new (30) | 0/5 | c2acace0:— e50d0c33:— 3aeb4766:32 26689573:— e1515b8c:— | 0 | 2 | 1842 | — | 0 |
| o12d-f16-cap2 | **Σ** | new | **13/47** | | **1** | **17** | mean 1526 | 1/2 | 0 |
| o12d-f16-cap22 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 5 | 731 | — | 0 |
| o12d-f16-cap22 | B | new (15) | 1/6 | beb51873:17 15cb3c5d:— 4bd96ed0:— 18f55c13:— 7a1718d0:16 | 0 | 0 | 921 | — | 0 |
| o12d-f16-cap22 | C | new (30) | 4/6 | 092a7f0d:— 9ce3e14b:— | 0 | 0 | 1693 | — | 0 |
| o12d-f16-cap22 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 2 | 1594 | n | 0 |
| o12d-f16-cap22 | F2 | new (30) | 2/4 | 68d42536:— b1558490:— | 0 | 3 | 1828 | y | 0 |
| o12d-f16-cap22 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 5 | 2019 | — | 0 |
| o12d-f16-cap22 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:40 2f484df5:— | 0 | 0 | 737 | — | 0 |
| o12d-f16-cap22 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2353 | — | 0 |
| o12d-f16-cap22 | O4 | new (30) | 0/5 | c2acace0:— e50d0c33:— 3aeb4766:33 26689573:— e1515b8c:— | 0 | 3 | 1872 | — | 0 |
| o12d-f16-cap22 | **Σ** | new | **11/47** | | **1** | **18** | mean 1528 | 1/2 | 0 |
| o12d-f16-cap25 | A | new (15) | 2/5 | 6850b843:— 256b26e9:— 13847a78:— | 1 | 5 | 731 | — | 0 |
| o12d-f16-cap25 | B | new (15) | 1/6 | beb51873:17 15cb3c5d:— 4bd96ed0:— 18f55c13:— 7a1718d0:16 | 0 | 0 | 921 | — | 0 |
| o12d-f16-cap25 | C | new (30) | 4/6 | 092a7f0d:— 9ce3e14b:— | 0 | 0 | 1693 | — | 0 |
| o12d-f16-cap25 | F1 | new (30) | 0/6 | 92e81d63:— c426ba5e:— 8892c676:— 4ae64897:— d571f1da:— 6528b445:— | 0 | 2 | 1594 | n | 0 |
| o12d-f16-cap25 | F2 | new (30) | 2/4 | 68d42536:— b1558490:— | 0 | 3 | 1828 | y | 0 |
| o12d-f16-cap25 | M | new (30) | 1/5 | 158b987a:— 7c0d541b:— 0cd676a0:— 3c11f4d9:— | 0 | 5 | 2019 | — | 0 |
| o12d-f16-cap25 | O2 | new (15) | 1/5 | 36749837:— 4247b609:— 1df64431:40 2f484df5:— | 0 | 0 | 737 | — | 0 |
| o12d-f16-cap25 | O3 | new (30) | 0/5 | 9a0e4d00:— d52f4e7b:— eb19a4d4:— 7c971493:— cbf03960:— | 0 | 0 | 2353 | — | 0 |
| o12d-f16-cap25 | O4 | new (30) | 0/5 | c2acace0:— e50d0c33:— 3aeb4766:33 26689573:— e1515b8c:— | 0 | 3 | 1872 | — | 0 |
| o12d-f16-cap25 | **Σ** | new | **11/47** | | **1** | **18** | mean 1528 | 1/2 | 0 |

### Notes

- **Episode memories are backdated (†).** Episode-summary memories carry a
  midnight `createdAt` (for example `2026-10-07T00:00`) for the day of their
  chat, though they're written later. By `createdAt` they can look older than a
  same-day turn that came before them. `cd294b01` and `5ba1367f` (chat
  `e98c04e3`) show it: both are dated 10-08 00:00, but their chat started at
  03:00. No gold here relies on an episode from the same day as its turn; every
  † gold comes from an earlier day. It also means the fresh-boost age of an
  episode is counted from midnight, so F1's targets fall in the 48 h tier and
  not the 24 h one.
- **Coverage gaps, not ranking problems (excluded).** Two turns where Friday
  visibly forgot had no gold to find, because the memory was never formed:
  `e98c04e3` turn 3 (the outfit she and Amy made Charlie in May; nothing from
  May mentions it) and `dbfc0b89` turn 4 (wardrobe items live as Markdown in her
  vault; no memory says so). No recall tuning can fix these. They're worth a
  separate look at extraction.
- **Turn A's personal anti-gold row** was pinned from the baseline as `92e00efb`, using the spec's description (`present fresh48`, cosine 0.343). It is pre-declared anti-gold, not late gold.
- A, B and C were already replayed for the retuning spec, so their gold isn't
  blind to the ranking. The other six slots are.
- **Baseline scoring:** scored from `baseline-<slot>.json`, with `--char` set to
  Friday on every slot. The `.txt` files come from a *separate* replay and are
  only for reading.
- **Harness issue 1: the distilled query isn't deterministic.** Every replay
  makes its own cheap-LLM call to distill the turn, and the same turn comes back
  worded differently each time (A, B and F2 all differed between the JSON and
  text runs). So §6's check that `t0` reproduces the baseline *exactly* can't
  pass as written, and every sweep comparison picks up query noise. Proposed
  fix, as part of R7: an optional `signals` field (or `--signals-from
  <replay.json>`) that skips distillation and reuses saved signals. Pinned to
  the `baseline-*.json` signals, this baseline stays valid and `t0` becomes an
  exact check.
- **Harness issue 2: replay searches today's corpus, not the corpus as it was
  at the turn.** Memories created after the replayed turn compete for its head.
  The fresh boost correctly ignores them (`age < 0` → ×1), but they still take
  slots by cosine: on the new path, 11 of 30 head rows on F2, 7 of 30 on O3, and
  1–2 on M, O2 and F1. On the older turns they also push gold down. A few
  `late@head` rows on A and C are memories extracted from the turn's own
  replies, which live recall wouldn't have had either. Proposed fix, as part of
  R7: an `asOf` corpus cutoff that drops memories created after the turn's user
  message. Turning it on changes the baseline, so it would need its own `t0`
  (with pinned signals) before the sweep.
- **What the baseline says so far:** Σ gold@head is 3/47 on the old path and
  8/47 on the new. The new path's head is 15–30 rows against 5, and it carries
  5 anti-gold (all on A) and 58 rows below cosine 0.40. A and B reproduce the
  spec's diagnosis: four wardrobe rows and the personal row in A's head, and
  13 of B's 15 head rows below 0.40, with the tuner-window row at rank 29.
- **Phase 3 decisions (Charlie, 2026-10-08):** build both harness fixes into
  R7. They are `signals` / `--signals-from` (reuse saved signals) and `asOf` /
  `--as-of` (memories created before the turn's opening message only, with
  weights decayed to the turn's clock).
- **`t0` is the sweep's reference, not the Phase 2 baseline.** Every candidate
  runs as `--signals-from baseline-<slot>.json --as-of --memory-budget 8000
  --limit 40`, and so does `t0`. Without `asOf`, a pinned run reproduces the
  baseline except for two gold ranks outside A's head, which shift by one place
  from `rawWeight`'s wall-clock decay (now pinned under `asOf`). With `asOf`,
  Σ gold@head on the new path goes from 8/47 to 11/47 and late@head goes to 0
  everywhere.
- **The embedding provider isn't deterministic either.** Probe embeddings
  differed by up to about 1e-3 in cosine between identical calls. On F2 that
  pushed a gold memory out of the head on one run and not the other. The replay
  now memoizes embeddings by text for the server's lifetime. Two full `t0` runs
  are byte-identical. **Restarting the server clears the memo**, so re-record
  `t0` after any restart before comparing candidates against it.
- **R5's cause:** every sub-floor row in the baseline (B 0.290/0.288, F2 0.238,
  M 0.263) carried `related↗`. Related-memory expansion skips the cosine floor
  by design, and probes and entity hits already respected it. The test
  `R5 — the cosine floor` pins the contract. Under R1, expansion rows are gated
  on their own cosine, so a sub-floor neighbour keeps its place in the pool but
  gets no boost.
- **`limit` affects ranking, not just display.** It sets the vector pool
  (`limit × 3`), the hard-window threshold and the expansion seeds. All probe
  runs pass `--limit 40`, the same as the baseline.
- **`asOf` limits:** reinforcement a memory received after the turn can't be
  undone, so its importance is read as it is now. Backdated episode memories (†)
  pass the cutoff by their midnight `createdAt`.
- **Sweep result: nothing passes, and the failure is structural, not a
  constant.** `r1234` / `full` lift Σ gold@head from 11 to 13 (`cap14`: 14),
  cut Σ anti@head from 5 to 1 (`m10`, `ramp05`: 0) and Σ low@head from 71 to
  1. A gains the memory-system rows and B gains the tuner rows. But every
  candidate loses one gold memory on F2, M and O2 and loses F2's fresh target,
  so criteria 2 and 3 fail. The one-at-a-time variations around `full` don't
  touch that. `backgroundReserve` (R6) changed nothing: at `--limit 40` the
  window never turned hard.
- **Why F2, M and O2 lose gold.** The lost gold sits at cosine 0.32–0.45
  (F2 `90b839e2` 0.316, `68d42536` 0.357; M `7c0d541b` 0.347; O2 `4247b609`
  0.452). At `t0` it reached the head only because the fresh boost lifted it.
  These turns have very strong best matches (0.66–0.73), so the gate's
  relative term puts it at 0.51–0.58, well above the 0.45 floor, and those
  rows lose their boost entirely. The spec calibrated the gate on A and B,
  whose best cosines were 0.51–0.64. The fresh boost's job is to rescue a
  cross-chat memory the query embeds weakly against ("did you hear Mochi's
  voice" against "Duchy ledger clean on tooth"), and R1 gates that rescue on
  exactly the cosine it exists to make up for.
- **Options for Charlie (not tried, since they change R1's shape rather than
  its constants):** (a) leave `fresh` outside the gate and gate only the other
  boosts; (b) take the gate from the floor alone (`boostGateMargin: 0`), or cap
  the relative term so a very strong top match can't push it past the floor;
  (c) accept the trade, with Σ gold +2, anti −4, low −70 against −1 gold on
  three turns, which means changing the criteria and is Charlie's call.
  (a) and (b) are each a few lines in `combineRecallMultipliers` /
  `boostGateThreshold` plus a tuning knob, then a re-sweep.
- **Option 1 result: still no pass.** Every `o1` variant keeps the losses on
  F2, M and O2, and F2 keeps losing its fresh target. Two reasons:
  - **R4 takes gold out of the pool entirely.** The lost rows (cosine
    0.32–0.45) aren't anywhere in the top 40 under `o1`, because they came in
    as entity-anchor hits at `t0`. Rarest-first picks names that barely
    appear: on F2 it chose "Arnold" (1 memory) over "Mochi" (7), which is the
    name the turn is about. Without R4 (`o1-noR4-fresh16`), M and O2 get their
    gold back (2/5 each), at the cost of B falling to 1/6, Σ anti rising to 4
    and Σ low to 31.
  - **F2's gold rode the time-window boost.** F2's fresh target had ×2.63 at
    `t0`: narrow 1.15 × context 1.1 × window 1.3 × fresh 1.6. The window boost
    is gated under `o1`, and fresh alone (even at 1.6) doesn't lift a 0.316
    row past the head's cut-off (0.66).
- **The conflict underneath:** the stacked boosts that bury the right answer
  on A and B are the same stack that rescues the right answer on F2, M and
  O2. A rule that only looks at cosine can't tell the two apart.
- **Possible next steps (not tried):** (a) treat both event-time boosts
  (fresh and window) as outside the gate, not just fresh; (b) fix R4's
  selection, e.g. a minimum hit count, or prefer the distiller's order among
  non-present names, so "Mochi" beats "Arnold"; (c) the trade in option 3.
- **Options 1 + 2 result: still no pass.**
  - **The R4 fix works as intended:** with `anchorOrder: distiller` or
    `anchorMinHits: 3`, F2 anchors on Mochi, Feline Duchy and Ariel Stars
    again, not Arnold. It changed no score, though: those anchors are the
    first three the old code took anyway, so the earlier R4 loss was in the
    `specificAnchors` runs only.
  - **The cap is the real blocker.** F2's fresh target has a pre-boost score
    of 0.384 and needs about ×1.73 to reach the head's cut-off. Fresh and
    window outside the gate give ×1.69 at the proposed 1.3, or ×2.08 at 1.6,
    but R2 caps the total at 1.6. With fresh at 1.6 and cap 2.0
    (`o12d-f16-cap2`), F2 gets its fresh target back (fresh ok 1/2) and
    reaches 2/4. M and O2 still lose one gold each, and Σ low rises to 17.
    Caps of 2.2 and above cost B two gold (1/6).
  - **M's and O2's lost gold rides `present↑` and `narrow✓`,** which stay
    gated. That's the same stack the gate is meant to stop on A.
- **Where this leaves R1:** every route tried so far trades A/B gains for
  F2/M/O2 losses. The best Σ gold@head is 14/47 (`cap14`, `o1-cap14`) against
  11/47 at `t0`, with anti-gold falling from 5 to 1 and low rows from 71 to
  1–4. No candidate meets criterion 2 (no turn loses gold), so changing the
  criteria (option 3) is the remaining route.
- **Phase 5 (2026-10-08):** Charlie chose `cap14` (option 3: accept the trade).
  Its values are now the defaults (`RECALL_TUNING_DEFAULTS`), except that R6
  ships at 0: `cap14`'s 0.33 reservation never fired, and the scores are
  identical either way. Checks:
  - With **no tuning**, the probe set reproduces `cap14`'s new-path scores
    exactly.
  - With the **legacy tuning**
    (`recall-probe/tuning-legacy.json`: gate terms 0, cap 4, fresh 1.6/1.35,
    no specific anchors), it reproduces `t0`'s new-path scores exactly.
  - The old path now runs under the new defaults too, since it's the live code
    with the episodic signals off, so its rows no longer match `t0`'s old path.
  - The gate is off for TF-IDF (`BUILTIN`) embeddings until that scale is
    derived.
- **F2 sits on the edge of embedding jitter under the new defaults.** After a
  module reload reset the embedding memo, the provider's vectors came back up
  to 7.7e-4 different in cosine. That was enough to move F2's `58af1ad3`
  (cosine 0.493, partly gated) out of the top 40: Σ gold@head read 13/47
  instead of 14/47. Under the same embeddings, an explicit `cap14` run and a
  no-tuning run were byte-identical, so the defaults match the winner. A
  later re-check should expect F2 to read 0/4 or 1/4.

