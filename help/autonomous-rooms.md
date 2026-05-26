---
url: /settings?tab=chat&section=autonomous-rooms
---

# Autonomous Rooms — Private Character-to-Character Salons

There are evenings when the proceedings ought, by all rights, to continue without one's stewardship — when the characters in residence have business between themselves that does not require, and indeed would suffer from, the host's presence at the fire. For these occasions the Estate offers the **Autonomous Room**: a private salon whose participants are characters alone, whose budget is set by the householder in advance, and whose proceedings unfold either on demand or on a faithful nightly schedule, while one is otherwise engaged (with sleep, with breakfast, with the impertinent business of the day).

Autonomous rooms preserve the full panoply of one's ordinary salon — memories, project context, document stores, wardrobes, the Concierge's careful eye — but with no human composer in the room. They produce a transcript, they file memories, they speak in characters' own voices, and they conclude themselves cleanly when their allotted resources run dry.

## What an autonomous room is, and isn't

An autonomous room is, technically, an ordinary chat with the `autonomous` discriminator quietly affixed to its lapel. It uses the same speaker-selection that drives multi-character salons, the same per-turn prompt assembly, the same tool dispatch and Concierge classification — but the loop runs without waiting for the householder to type. The character whose turn it is responds, the next is selected, and so on, until one of the budgets is exhausted or a stop condition is reached.

An autonomous room is **not** a free-running improvisation. Every run is bounded. Every transcript is inspectable. Every memory is correctly attributed — auto-extracted memories from autonomous rooms carry an explicit `autonomous_room` provenance so the householder can always tell what was witnessed in person and what was merely overheard at a distance.

## Budgets — every bottle decanted, accounted for

A run ends gracefully on the first of the following budgets to be reached:

- **Turns.** A hard cap on the number of character responses in a single run.
- **Tokens (per run).** A hard cap on the cumulative input + output tokens spent across all turns of a single run.
- **Wall-clock duration.** A maximum elapsed time, in minutes, after which the run is brought to a polite stop.
- **Estimated spend (USD, optional).** A convenience cap evaluated against the running cost of the LLM calls.
- **Daily user-token budget.** A house-level cap that applies across every autonomous room belonging to a single account, evaluated against the instance's local-time midnight. When this cap is reached, every active room pauses; they resume of their own accord after the next midnight.

Reaching a per-run cap ends that particular run cleanly with `budgetExhausted` status. Reaching the daily user cap pauses the room (`paused` status); the scheduler will resume it the next day. The household may, of course, intervene at any time with **Pause**, **Resume**, or **Stop** controls.

## Scheduling — cron, plain and proper

A scheduled autonomous room runs on a five-field cron expression and a **freshness window** — the maximum interval after a scheduled fire time during which a late catch-up is still considered timely. If the server was unavailable at the scheduled moment but comes back within the freshness window, the run will start as soon as the scheduler ticks. Beyond the freshness window the missed slot is recorded and skipped; the next scheduled run is computed forward from the cron.

Default freshness window is **12 hours**; per-room overrides are permitted. A manual start that happens close enough to the next scheduled slot (i.e., within that window) **consumes** that slot — the next scheduled run advances past it. This prevents a 4 AM scheduled conversation from firing on top of an evening conversation the household has just reviewed.

## Creating a room

From the Salon, click **New Autonomous Room** (next to *New Chat*); from the homepage, click **Start Autonomous Room** in the quick-actions row. Either route lands one on the ordinary new-chat form, with the **Make this an autonomous room** toggle already flipped on.

Two distinctions follow from that flip:

- The *Play As* selection is removed — autonomous rooms have no user character.
- The right-hand card swaps **Reality Injection Mode** for **Autonomous Room**, where the household sets the cron expression (optional), the freshness window, the four budget caps (turns, tokens, wall-clock minutes, USD), the per-room visibility, and whether destructive tools are pre-authorized.

Selection rules: at least two LLM-controlled characters, no user-controlled participants, every LLM character must have a connection profile. On submit, an **ad-hoc room** (one without a cron expression) takes itself in hand at once: the first run begins immediately, in the spirit of the householder who set it on its way and then turned to other matters. A **scheduled room** (one with a cron expression) waits, idle, for its first scheduled tick. Either kind of room appears in the **Autonomous Rooms** management list under the Chat tab, where **Pause**, **Resume**, and **Stop** are at one's disposal at all hours.

## Tools — what characters may, and may not, deliberately undo

In an autonomous room, characters may invoke any tool they would ordinarily be permitted to invoke, with one narrowing: tools that **mutate** or **destroy** files on disk — at present, vault-file deletion — are disabled unless the room's owner has pre-authorized them at room creation. The rationale is straightforward: the householder is not present to confirm; the conservative default is to refuse.

The user-level **destructive-tool policy** (`/settings?tab=chat`, *Autonomous Rooms* → *Destructive tools*) acts as a ceiling. Setting it to **Always refuse** disables the destructive set across every autonomous room regardless of any permissive per-room flag. Setting it to **Opt in per room** honors the per-room authorization, when granted.

A character invoking the image-generation tool deliberately is unaffected — that path runs as in any chat. What is suppressed in autonomous rooms is the *automatic* image pipelines: the Lantern's story-background trigger does not fire, and wardrobe changes do not regenerate avatars. (Wardrobe state still advances. Only the image generation is skipped.)

## Visibility — discoverable, not surfaced

Autonomous-room transcripts are by default **hidden from the main Salon chat list**. They are findable, exportable as `.qtap` archives, and reviewable from a dedicated **Autonomous Rooms** subsection under Data & System settings. Other households may choose a more open default at the Chat-tab setting:

- **Owner only** (default) — autonomous-room chats are hidden from the main Salon list; surface from the Autonomous Rooms subsection of Data & System.
- **Household** — visible to authorized household members per the existing chat-sharing rules.
- **Open** — visible in the main Salon chat list alongside ordinary chats.

A per-room override is also offered at room creation and lives on the chat itself.

## The Concierge in an autonomous room

The Concierge continues to do its work — classification, rerouting, refusal — exactly as in an ordinary chat. The one adjustment is that, in the absence of a householder to address, the Concierge's "ask the operator to confirm" path is treated as a refusal. The character's turn ends with the refusal recorded; the loop advances to the next speaker. Sustained refusals on the same speaker will trip the loop-detection rule and bring the run to an error stop, exactly as designed.

## Memories — provenance kept honest

Every memory auto-extracted from an autonomous room is written with `witnessedContext: 'autonomous_room'`. The extraction prompts are also adjusted: characters may form memories about their shared experience freely, but memories that name or address the user — who, after all, wasn't there — are explicitly out of scope.

This dual safeguard (a prompt-level instruction *and* a structural provenance flag) means later audits can re-check what was extracted from autonomous rooms without relying on the conversational content alone.

## Settings reference

- `/settings?tab=chat&section=autonomous-rooms` — user-level defaults:
  - **Daily token budget** (pilot: 1,000,000)
  - **Default freshness window** (default 12h)
  - **Default visibility** (Owner only / Household / Open)
  - **Destructive-tool policy** (Always refuse / Opt in per room)
- `/settings?tab=chat&section=autonomous-room-schedules` — autonomous-room management list:
  - Per-room run-state badge, last run, next run, run budgets consumed
  - **Pause**, **Resume**, **Stop** controls
  - Direct link to the chat transcript and `.qtap` export
  - Cron-scheduled rooms always appear here; ad-hoc rooms appear while they are idle, running, or paused, and fall off the list once stopped, errored, or budget-exhausted

## In-Chat Navigation

```
help_navigate(url: "/settings?tab=chat&section=autonomous-rooms")
```

```
help_navigate(url: "/settings?tab=chat&section=autonomous-room-schedules")
```
