# Quilltap Changelog

## Recent Changes

### 4.10-dev

#### Message route trail: every model tried, in order, under the avatar

An assistant message now keeps the route trail — every connection profile tried for the turn, in
the order tried, with why each one stepped aside — and renders it as a list under the avatar,
first tried at the top, the one that answered at the bottom. Before this, the badge showed only
the profile that answered, so a turn the primary timed out on, was rate-limited on, or was
refused on looked exactly like a turn that went through on the first ask.

- **Stored** in a new nullable JSON column `routeTrail` on `chat_messages`
  (`add-route-trail-message-column-v1`). Each entry records the profile's id, name, provider and
  model, how it came to be asked (`primary`, `retry`, `concierge`, `understudy`, `tier-pick`),
  what became of it (`answered`, `failed`, `refused`), the fallback engine's trigger class, how a
  refusal was established (`finish-reason` or `inferred`), and a short reason capped at 200
  characters. `provider` and `modelName` stay authoritative for who answered; the trail's last
  entry always agrees with them.
- **NULL when nothing failed**, which is nearly every message. A one-entry trail would say nothing
  the existing columns already say, and assistant rows are the largest table in the instance. There
  is no backfill: an old message has no trail, and its badge renders exactly as before.
- **Shown** as one row per profile. A row that fell over on its own — timeout, network, auth, rate
  limit, missing model, 5xx, an empty body with no stated reason, no usable API key — is struck
  through and marked ❌. A row the provider refused on content grounds is struck through and marked
  🚫. The row that answered has no mark and no strike, so a single-row trail is
  pixel-identical to the old badge. Hovering a row names the profile, the provider and model, how
  it came to be asked, and what happened. Adjacent rows for the same profile collapse into one
  ("answered on the second try").
- **Rides the `.qtap` export** with the message; `qtap-export.schema.json` carries the shape. An
  imported trail's `profileId` is deliberately not remapped — a stale id in a historical record is
  the truth of what happened, and nothing dereferences it.
- **Theme authors:** the list has no `qt-*` hook of its own yet. Target it through
  `[aria-label="Models tried for this reply"]`.

Mobile has no avatar badge, so it has no trail either. Tool-only turns write no provider
attribution today and get none here.

#### Docs: retired twelve shipped feature specs to `features/complete/`

Moved twelve feature documents from `docs/developer/features/` into
`docs/developer/features/complete/` after verifying each against the code: character
progressions, Pascal custom tools, custom-tool enhancements, custom-tool run presets, the tabbed
workspace, archived scenarios and wardrobe items, the character archive spec and its parent
export-fidelity design, the DB size-reduction spec, the four-tier state cascade, Scriptorium
per-document policy frontmatter, and the Z.AI `reasoning_effort` plan. Relative links inside the
moved files were re-anchored one directory deeper, and inbound references were repointed: 29 source
comments plus `API.md` for the tabbed workspace, `CLAUDE.md`, `PROMPT_ARCHITECTURE.md` and the
update-documentation index for progressions, `bugs.md` and bug 52 for the archive spec, the
quantize-embeddings migration for the DB spec, and the Z.AI plugin test. Two stale status lines were
corrected in place: the Scriptorium policy spec still said "not yet implemented", and the character
archive design still said its surfaces and rehydration remained. Three implemented specs were left
in place because their own completion gates ask for manual verification first: composer smart
typography (two manual matrices), the episodic recall overhaul (constant tuning via
`quilltap recall-replay`), and the Commonplace Book relevance fix (empirical tuning).

#### Docs: plan for the Salon chat gallery

Added `docs/developer/features/salon-chat-gallery.md`, a plan for a Gallery in the Salon sidebar's
Organize drawer that lists every image in a conversation — uploads, tool-generated images,
dialog-generated images, story backgrounds, Aurora avatar repaints, the cast's portraits, images
re-shown from an album, and images referenced in message text — with Save (through the same album
picker the message toolbar's bookmark uses) and Download on each. Covers a single server-side
enumerator, a `?action=gallery` read, a chat-scoped `?action=save-image` twin of the message-scoped
one, `?download=1` on the image routes, a realtime-gated query key, the UI, tests, and help. Records
two defects found while mapping: the sidebar's existing Gallery button never appears because its
count reads a `?action=files` action that does not exist, and images generated from the Generate
Image dialogs are never linked to their chat. Bug 128's step 5 is marked superseded by this plan.
Not yet implemented.

#### Docs: filed bug 128 — the Salon's memory count goes stale and disarms its own delete button

The sidebar's `Delete Memories (n)` count is read once, when the chat mounts, and nothing refreshes
it. Memories are written afterwards by background extraction jobs, so a chat opened before its first
memory exists — which is every new chat — reads `(0)` for as long as the tab stays open. The tabbed
workspace hides an inactive pane with CSS instead of unmounting it, which is what lets a streaming
Salon survive a tab switch and also removes the reload that used to correct the number by accident.
The delete handler then returns early on a count of zero and the button carries no disabled state,
so clicking it does nothing at all: no confirmation, no toast, no log line. Measured on a chat
holding 59 memories that the sidebar reported as none. The filed plan adds a `memories` realtime
topic published from the memory job types, subscribes the sidebar to it, and disables the button at
zero rather than letting it absorb the click. Not yet implemented.

#### Docs: plan for the message route trail

Added `docs/developer/features/message-route-trail.md`, a plan for recording every connection
profile tried for an assistant reply and showing the list under the avatar in the Salon: first
tried at the top, failures struck through and marked with an X emoji when the provider fell over
on its own or with a no-entry emoji when it refused on content grounds, and the answering model
last. Covers the nullable `routeTrail` JSON column on `chat_messages` (NULL when nothing failed),
the single recording chokepoint at the existing failover and Concierge reroute sites, the SSE
`done` payload, rendering, export schema, migration, tests, and help. Not yet implemented.

#### Fixed: a hostname change no longer makes the app shut its own database down (bug 126)

The instance lock's heartbeat checked every 60 seconds whether it still owned the lock by comparing
the recorded hostname against a freshly read `os.hostname()`. On macOS that value is not stable: when
`scutil --get HostName` is unset, which is the default, the system derives the name dynamically and
reports something like `MacBook-Pro.local` at one moment and `Mac` at the next, switching on Wi-Fi
reconnects, sleep/wake, VPN changes and DHCP lease renewals. The heartbeat read the change as another
process taking the database, closed its connections and exited. Under the Electron shell the server
is not restarted, so the window stayed open over a dead backend: the home dashboard rendered nothing
while an already-open Salon tab kept drawing from its cache, which made it look like a UI problem.
Every recorded occurrence logged an identical PID with only the hostname differing.

- Lock ownership is now a snapshot taken when the lock is written — PID plus the acquisition
  timestamp — and the heartbeat compares against that. Both fields are overwritten by any process
  that takes the lock, so a real takeover is still detected immediately. Hostname is a label only.
- Acquisition no longer claims a lock just because the recorded hostname differs. A differing name
  cannot distinguish another machine from this one after a rename, so the decision is made on
  heartbeat freshness for every environment rather than only for Docker. This closes a case where
  two processes on one machine could both open the same database.
- A process whose machine was renamed now releases its own lock on exit instead of leaving a stale
  file behind, and a lock taken by manual override starts a heartbeat.
- The lock-loss shutdown now runs the same ordered teardown as SIGTERM and SIGINT, registered by
  the SQLite client. It previously used a dynamic `require` that did not resolve in the bundled
  standalone server, so it threw instead of closing anything and the WAL was left unmerged.
- `quilltap db --lock-status` no longer reports a running app as `STALE (different host)`, and
  `--lock-clean` refuses to delete a lock whose heartbeat is still being refreshed.

#### Added: character progressions

Characters can now carry progressions: named spans of time with a start, an end, and rules for how
often to report on them. A pregnancy that began on 1 August and is due 1 May; a cannon that takes
ten minutes to recharge; a fermentation that finishes in three weeks. On every prompted turn
Quilltap computes elapsed time, remaining time and percentage from the wall clock and appends a
second-person report to the character's prompt, so the model never has to do the arithmetic or
remember that time has passed.

- Stored under one reserved `progressions` key in the character vault's `metadata.json`. Every
  other key stays freeform. Validated at the point of use rather than at hydration: a malformed
  entry is dropped alone with a warning and the rest survive. Published JSON schema at
  `public/schemas/qtap-progression.schema.json`; no migration.
- Each entry declares the unit its report speaks in (`second` through `year`) and a cadence: every
  turn, whenever the whole-unit count ticks over, or at most once per wall-clock period (`1h`,
  `30s`, `2d`). An entry the user or a tool has just changed reports on the next turn regardless,
  as does one that has just started or finished.
- Spans render as whole units plus a remainder in the next finer unit ("20 weeks, 3 days"). Months
  and years are fixed-length (30.436875 and 365.2425 days), so the arithmetic is deterministic and
  calendar-free.
- Optional per-entry description, quantity (`0.3/1.0 MJ`), and report template with placeholders
  (`{{elapsed}}`, `{{remaining}}`, `{{percent}}`, `{{quantity}}`, and others). An unknown
  placeholder renders as written.
- The report is a trailing per-turn section, after Suparṇā's mail and before the turn-skip note.
  It never enters the cached system block, so prompt caching is unaffected and no builder version
  is bumped. It is not persisted as a message. The greeting builder and Carina both append a forced
  report; continue turns skip it.
- Cadence is derived from the character's own last turn in the chat rather than stored, so the
  prompt path performs no writes. A character who is prompted but does not speak can hear a
  period-cadence entry once more inside the same period; this is documented.
- Pascal custom tools gain a `progress` read subject (`when.progress`, availability gates) keyed
  `"<id>.<field>"`, `{{progress.<id>.<field>}}` and `{{now}}` placeholders, and
  `progress.<id>.<field>` effect targets. A tool can be withheld until a recharge completes and
  re-arm it on a successful roll with `{{now}}` and `{{now}} + 600000`. Writing to an unknown id
  creates the progression; `remove` deletes one. Progress writes fold into the existing single
  character metadata write. A result the schema refuses is rolled back and the roll still stands.
- `metadata.progressions` and `metadata.progressions.*` are refused as effect
  targets when a tool file loads. An effect writes a primitive, so the former
  would replace the whole reserved object with a string, bypassing the
  progressions validation and rollback; the latter would write a literal key
  named `progressions.cannon` and touch no progression.
- The model cannot set its own progression: there is no LLM tool for it, and the `state` tool has
  no access. Only the user and Pascal's server-side effects write them.
- New Progressions card on the Aurora character edit page (System Prompts tab) with an editor for
  each entry and a live preview of the line the character will read. Archived characters are
  read-only.
- Pascal's Workbench gains the `progress` condition subject, the `progress.` effect-target prefix,
  the `{{now}}` and `{{progress.…}}` insert options, and a live list of what a hand-typed fact
  sheet's progressions derive to.

#### Docs: plan for character progressions

Added `docs/developer/features/character-progressions.md`: a plan for timed, in-progress
character properties (a pregnancy with a due date, a weapon recharging over ten minutes). Each one
is stored under a reserved `progressions` key in the vault's `metadata.json` with a published JSON
schema, and on every prompted turn the character is told elapsed time, remaining time and percent
complete, deterministically, in the unit and at the cadence the entry declares. The report lives in
the uncached per-turn tail of the prompt, never in the cached system block. Pascal custom tools gain
a `progress.<id>.<field>` read subject and gate, a `{{now}}` reference, and `progress.*` effect
targets so a roll can re-arm a countdown. Includes an Aurora editor card and a phased task list.
No code changes yet.

#### Added: character subprompts

Characters can now carry subprompts: short, optional instructions stored as Markdown files in
the vault's root-level `Subprompts/` folder (frontmatter `title`, body = the instruction, written
in the second person like a system prompt). The folder is created on the first write; a missing
folder lists as empty.

- Which subprompts are in play is stored per seat on the chat (`participants[].selectedSubpromptIds`).
  Pick them from a Subprompts dropdown under each character's system-prompt selector in the New Chat
  dialog, and from the same dropdown on the participant card in the Salon's Participants drawer.
  Every dropdown offers "New subprompt…", which opens the Lexical editor in place and ticks the new
  one on.
- Manage them on the Aurora System Prompts tab, beneath the primary prompts. The AI Wizard and
  Character Optimizer leave subprompts alone.
- Selected subprompts render in the compiled identity stack directly after the system prompt as an
  `## Additional Instructions` block, and in the greeting. Changing the selection recompiles the
  seat's cached stack; editing a subprompt recompiles every chat carrying it; deleting one strips it
  from those seats first. A seat with none selected produces a byte-identical prompt, so no builder
  version bump.
- A character dressing themselves in the green room sees the selected subprompts alongside their
  dressing instructions.
- New routes: `GET/POST /api/v1/characters/[id]/subprompts`,
  `GET/PUT/DELETE /api/v1/characters/[id]/subprompts/[subpromptId]`.

### 4.9.2

#### Fixed: a help chat's tool results now reach the model on every provider (bug 124)

Asking the Help dialog something the character had to look up ("Where do I change the theme? Take me
there.") produced nothing on OpenAI, Anthropic, OpenRouter, Grok, Ollama, DeepSeek, NanoGPT and Z.AI
seats. The help chat's own agent loop sent tool results back as `tool` messages with no call id and
an assistant turn with no tool calls attached. Every provider plugin except Google drops a tool row
it cannot pair, so the model never saw its search results, searched again, and the repeated-call
guard ended the turn with an empty reply. Google seats answered because that plugin keeps an
unpaired row.

- The help loop now builds its assistant turn and tool rows through the same threading helpers the
  Salon and the Brahma Console use. A result with a provider call id is paired to its call; one
  without (the text-block tool path) is framed as `[Tool Result: <name>]` user text.
- The stuck-loop reminder now uses the last result directly instead of searching the message list
  by role.
- Two regression tests drive one native tool turn through the help loop and check the messages
  the follow-up request receives.

#### Fixed: Google no longer rejects a tool-enabled turn whose tool slate includes the wardrobe tools (bug 125)

A Gemini profile with tool use on, in a help chat or in any chat whose character has a wardrobe,
failed every turn with `Invalid JSON payload received. Unknown name "additionalProperties" at
'...parameters.properties[0].value.items'`. The Google plugin strips JSON Schema fields Google's
function-calling API does not accept, but `additionalProperties` was not on the list. The top-level
one never reached the wire, while the one under the wardrobe tools' `operations` array items did.

- `additionalProperties` is now stripped at every depth. Google plugin 1.1.51.
- A regression test runs the real `wardrobe_wear` and `wardrobe_take_off` schemas through the
  sanitizer. Loading the plugin under Jest needed a manual mock for the ESM-only `@google/genai` SDK.

### 4.9.1

#### Fixed: a paused chat no longer goes quiet without saying so, and Skip is always offered (bug 123)

When a chained character turn failed (a provider error that exhausted the fallback chain), the server
paused the chat as a safety stop. The Salon learned of the first pause and showed Resume, but not of a
second one a few minutes later: the client only re-read the pause flag when the fetched value changed,
and pressing Resume had changed the local flag without updating the fetched copy. The fetched value went
from paused to paused, nothing fired, and the client believed the chat was live while the server held it
paused. Every message then drew exactly one reply, nudges worked but chained nowhere, and the sidebar
read "Pause" throughout. A reload was the only fix.

- The client now reconciles its pause flag with the server's on every fetch, and Pause/Resume update
  the fetched chat object too.
- A turn chain that stops because the chat is paused now emits a `paused` chain-complete event and
  logs, instead of returning silently. Every chain-complete carries a `paused` flag; the chain-error
  safety stop sets it, an empty-response stop does not.
- The Salon shows a toast when a chain stops on a pause the user did not cause, with specific wording
  when a character's turn failed. All-LLM rooms keep their existing pause dialog instead.
- The Skip button is offered whenever the composer will accept a message as a character you control,
  your own or one you are impersonating, not only when the rotation has formally landed on that seat.
  The banner wording says whose turn it is. Skipping an impersonated seat now works from the client
  (the server already allowed it), and skipping lifts a pause first, as nudging does. The must-speak
  guard is unchanged.
