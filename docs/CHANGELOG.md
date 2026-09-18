# Quilltap Changelog

## Recent Changes

### 4.10-dev

#### Fixed: the star that sets a character's default system prompt did nothing (bug 154)

On **Aurora → Edit character → System Prompts**, pressing the star beside a prompt reported
"Default prompt updated" and left the **Default** badge where it was. The request it sent named an
action the server does not have, fell through to a generic character update that discards the field,
and came back successful. The checkbox in the **Edit Prompt** dialog was unaffected and is what
people have been using instead.

The star now sends the same request that dialog does, and the badge moves on the click rather than
after a refetch.

Underneath, a character's default prompt was recorded in two places — a flag on the prompt and a
column on the character — and each way of changing it updated only one. So a change that appeared to
work could still leave new chats opening with the old prompt. Both are now written together
wherever prompts are added, edited, deleted or promoted, including from the picker on the Details
tab. The order in which the two are consulted is stated in one place instead of five; two of those
five used to seed a chat with no system prompt at all when the two disagreed.

The **Edit Prompt** dialog is also wider. The formatting toolbar no longer runs off its right edge,
where the last several buttons could not be reached.

#### Fixed: document tools listed character vaults they would then refuse to open (bug 153)

A character whose **System Transparency** is off — the default — was shown character vaults by
`doc_list_files` and `doc_grep`, including her own and, with **Shared Vaults** on, her peers'. File
paths and all. Opening any of them was then refused.

System Transparency being off hides every character vault from the document tools, and that was
enforced when a tool opened a path but not when one listed what was available. Two faults in one:
the listing named the vaults the setting exists to hide, and a tool that offers a path and then
denies it looks broken to a model, which retries rather than accepting the boundary.

Listing and opening now consult the same rule. An opaque character sees group, project and general
stores and no vault at all; `mount_point: "self"` returns nothing, as it already did when opening.
Group stores stay reachable (bug 152), and a character with System Transparency on is unaffected.

#### Fixed: characters could not read or write their own group's document stores (bug 152)

A character whose **System Transparency** is off — the default — could not reach any group
document store with the `doc_*` tools. Not the group's official store, not any store linked to a
group she belongs to, by name or by ID. Project-linked stores and Quilltap General worked, which is
why it looked intermittent.

System Transparency being off hides every character vault from the document tools. It did that by
dropping the character's identity from the request, and group membership is derived from exactly
that identity — so hiding her vault also hid every store her groups keep. Only character vaults
were ever meant to be hidden; that is what the help page has always said.

The two are now separated: vaults are hidden by name, and the character's identity stays, so group,
project and global stores resolve as they always should have. The covenant is unchanged — her own
vault, her peers' vaults, and the reserved `self` shorthand all stay closed to an opaque character.

Also fixed: a store that exists but is out of reach from the current conversation now says so,
instead of reporting "not found" as though the name were misspelled. The old wording read to a
model as a typo, so it would retry the same request with different spellings — the reported case
spent eight minutes and ten tool calls guessing at a name it had right on the first attempt.
Character vaults are excluded from the new message, so it cannot disclose a vault the covenant
hides.

#### Fixed: a turn carrying freshly generated images failed with "Request Entity Too Large" (bug 151)

After several avatars or backgrounds were generated, the next turn on a profile with **Supports
image upload** ticked could fail outright with `413 Request Entity Too Large`, stopping the chain.
The error came from the provider's edge, not from its context window: the same turn was logged at
49,652 estimated tokens against a million-token window. Image bytes are not tokens, and nothing was
counting them. Two `gpt-image-2.5` avatars at 1024x1536 were 2.2 MB each of base64 — under the 4 MB
per-image limit, so neither was resized — and 4.52 MB together.

Images sent to a model are now trimmed to what a model needs to read them: capped at 1024 on the
long edge and compressed to a 500 KB ceiling per image, with a 2 MB budget across a single turn.
Measured on a real avatar, that is 2,339 KB of base64 down to 98 KB, with the portrait still fully
legible.

**Stored images are unchanged.** Files on disk keep their full resolution and quality; the gallery,
character albums, exports and backups all still hold the originals. The shrinking happens only on
the copy sent to a model, and is discarded after the request.

#### Fixed: the manual image-generation dialog's Generate button did nothing (bug 150)

The dialog posted to `/api/v1/images/generate`, a path no route serves — it resolved to the item
route with `id = "generate"`, a 404. The generate action actually lives at
`POST /api/v1/images?action=generate`. The dialog's own test suite never caught it because it
asserted against a fetch call the test made itself, never against what the component requests; it
now renders the real component and checks the URL.

#### Added: GPT Image 2.5 (Flare and Sunburst), and the rest of the OpenAI image parameters

Two new OpenAI image models: `gpt-image-2.5-flare` (faster and cheaper, at GPT Image 2 quality)
and `gpt-image-2.5-sunburst` (slower and more expensive, better at detailed editing). Dated
snapshots such as `gpt-image-2.5-flare-2026-09-08` resolve to their family automatically.

With them, four parameters the plugin never sent:

- **Quality** — `auto`/`low`/`medium`/`high` on every GPT Image model, plus `xhigh` and `max` on
  the 2.5 pair. Previously only DALL-E's `standard`/`hd` were offered, and quality was not sent to
  GPT Image models at all.
- **Background** — `transparent` cuts the subject out, which is what avatars want. Asking for
  transparency with a JPEG output format switches the format to PNG rather than flattening it.
- **Output format** and **output compression** — `png`/`jpeg`/`webp`, with compression applied only
  where it means something. The returned image's MIME type now matches the format requested
  instead of always claiming PNG.
- **Moderation** — `auto` or the less restrictive `low`. Not an off switch; OpenAI's usage policies
  still apply.

GPT Image 2 and both 2.5 models also accept arbitrary resolutions: any `WIDTHxHEIGHT` with both
edges divisible by 16, an aspect ratio between 1:3 and 3:1, and up to 3840x2160. Anything above
2560x1440 is experimental.

The OpenAI plugin now implements `getImageProviderOptionsSchema`, so the image-profile editor is
built per selected model instead of using the old hand-written panel — a model is never offered a
knob it would reject. Parameters a model does not accept are dropped with a warning rather than
sent, because the Images API rejects the whole request over one unknown value; an unusable size
falls back to 1024x1024.

Per-family capabilities live in one table (`plugins/dist/qtap-plugin-openai/image-models.ts`) that
the wire logic, the host's model list and the editor schema all read from.

The manual image-generation dialog's OpenAI controls were DALL-E-shaped too — its size list held
no GPT Image size but 1024x1024, and its quality picker offered only Standard/HD, with Standard
sent on every generation. Both lists now span the families, and quality defaults to sending
nothing so the profile's own setting stands.

The `openai` SDK is updated to 7.15.0 in the main app and all six plugins that use it.

`@quilltap/plugin-types` 2.7.0 widens `ImageGenParams.quality` past DALL-E's `standard`/`hd` to
cover the GPT Image tiers. The host stores and forwards the value without interpreting it, so the
union is the sum of what the plugins accept and each plugin validates its own model's subset.
Purely widening — no existing plugin changes behavior. The app now requires `^2.7.0`; the plugins
still build against `^2.6.0`, since none of their own code depends on the wider type.

#### Fixed: the new quality tiers were rejected by the HTTP generate routes

Caught in review. The GPT Image tiers reached the `generate_image` tool schema, but
`POST /api/v1/images?action=generate` and `POST /api/v1/image-profiles/[id]?action=generate` each
spelled the union out for themselves and still read `standard`/`hd` — so a profile could store
`max` and those routes would reject it before the provider was ever called. All three now share
one `imageQualitySchema` (`lib/image-gen/quality.ts`), pinned to `ImageGenParams['quality']` by
compile-time assertions in both directions: adding a tier to one without the other is now a build
error rather than a silent rejection. Image profile *saving* was never affected — `parameters` is
stored as an open bag.

#### Fixed: `generate_image`'s `size` parameter has never done anything (bug 149)

The params builder lets orientation outrank a raw `size`, deliberately — a caller asking for a
shape means the shape. But the handler passed `orientation: toolInput.orientation ?? 'square'`,
so the builder was told a shape had been requested on every call, and square's 1024x1024 landed on
top of whatever size the merge produced. No input survived it. The default is now injected only
when the model named no size of its own; an explicit orientation still wins over an explicit size.
The same line was also discarding the profile's configured default size.

#### Fixed: image profile size, quality and style were ignored in chat (bug 148)

The `generate_image` tool's schema declared `size`, `quality` and `style` with Zod `.default(...)`.
Zod applies those defaults when the key is absent, and the tool's parsed output is handed to the
params builder as *overrides* — which outrank the profile's stored settings by design. So every
image a character generated carried `standard`/`1024x1024`/`vivid` regardless of what the profile
said. The defaults are removed; an omitted field now leaves the profile's value in place. `count`
keeps its default of 1 deliberately.

#### Fixed: the Salon no longer guesses whose turn it is (bug 147)

The turn rotation for a cycle is drawn once and stored on the chat, so that every reader agrees
about who follows whom. The Salon recomputes "whose turn is it" in the browser from that stored
rotation plus the message history — but `GET /api/v1/chats/[id]` was not sending the two columns
it reads. Both arrived as `undefined`, which reads as an empty rotation and an empty
spoken-this-cycle set: exactly what a brand-new chat looks like.

So the browser never followed the rotation. It fell back to a fresh weighted-random pick on every
recompute, contradicting the decision the server had already made and saved. Two things showed it:

- The turn banner named the wrong character, and its **Skip** passed the wrong turn — recording
  "X declining the floor" for a character who had just spoken, and leaving the real turn
  outstanding so you were prompted twice. Worst in rooms where you drive two characters, where the
  server hands the floor from one of yours to the other.
- The participant sidebar's predicted order was a talkativeness guess rather than the real
  rotation, and no character was ever marked as having already spoken this cycle.

Both columns are now sent, as the JSON strings the turn code already parses, defaulting to `[]`
for rows that predate them. The turn API's response also carries the rotation, and the client no
longer discards it. A test now asserts directly that the browser and the server pick the same
speaker from the same inputs, rather than assuming it.

This supersedes the previous entry's diagnosis: bug 146's fix was necessary but not sufficient —
it keyed the banner to the browser's answer, which was itself wrong.

Files: `app/api/v1/chats/[id]/handlers/get.ts`, `app/salon/[id]/hooks/useTurnManagement.ts`,
`__tests__/unit/app/api/v1/chats/[id]/handlers/get.test.ts`,
`__tests__/unit/lib/chat/turn-manager/client-server-agreement.test.ts`,
`help/chat-turn-manager.md`.

#### Fixed: Skip now passes the turn that is actually outstanding (bug 146)

When you drive two characters in one room — your own plus a guest whose pen you have taken up —
a message from one of them hands the floor to the other rather than making an LLM answer. That
part was right. What was wrong is that the banner above the composer named the character you had
*last written as*, not the one whose turn it was, and its **Skip** button passed that character's
turn.

So a post as the guest was followed by a prompt that looked like a second turn for the same guest.
Pressing Skip recorded "the guest declining the floor" — a turn the guest had never held, since
they had just spoken — left the real turn where it was, and prompted you again. Two passes for one
turn, and a false line in the transcript that the models then read.

The banner now speaks for whoever holds the floor. When the turn is one of yours, it names that
character and Skip passes that turn; when the composer is pointed at a different character of
yours, it says so instead of inviting words in the wrong voice. Between turns — when an LLM is up
next — it still offers to decline early for the character you are holding, as before.

Files: `lib/chat/turn-manager/utils.ts`, `lib/chat/turn-manager/index.ts`,
`app/salon/[id]/SalonView.tsx`, `__tests__/unit/lib/chat/turn-manager/floor-seat.test.ts`,
`help/chat-turn-manager.md`.

#### Fixed: collapsing a duplicate avatar roll no longer deletes the photo you kept from it (bug 145)

Copying an avatar roll into a character's photo album does not make a second copy of the image — it
makes a second reference to the same stored bytes. The migration that collapses duplicate rolls
deleted those bytes by file, taking *every* reference with them. So collapsing a duplicate removed
the album photo too, and removed it precisely because you had kept it: keeping is what put the
second reference there.

Nothing recorded the album photo outside the document index, so the loss left nothing behind to
notice — no broken link, no missing-image placeholder, no row pointing at nothing.

The migration now deletes only the roll's own reference, and releases the bytes only if that was
the last one. A roll you had kept loses its entry in the avatar cache and keeps its photo. It uses
the same rule the Photo Gallery's own delete has always used, reached through the same shared
code, so the two can no longer disagree.

This has not shipped: 4.10.0 has never been released, so the only instances that ran the old
version are development ones. No repair is possible where it did run — the bytes are gone — and
none is needed anywhere else.

On the development instance it was found on, 199 of 1066 surviving avatar rolls (19%) shared their
bytes with a kept photo. Each was one collapse away from losing it.

Files: `migrations/scripts/collapse-duplicate-avatar-rolls-v1.ts`,
`__tests__/unit/migrations/collapse-duplicate-avatar-rolls.test.ts`.

#### Fixed: `--lock-clean` no longer says a stopped instance is still running (bug 144)

Stopping an instance and immediately running `quilltap db --lock-clean` printed:

> Lock is still being refreshed (heartbeat 82s ago) — its holder is alive. Cannot clean.
> Stop the running instance first, or use `--lock-override` to force.

Both sentences were wrong. The holder was not alive, and there was no instance to stop — this
branch is only reached after the process check has already come back dead. A lock stays claimed
until its heartbeat is five minutes old whether or not its process is still there, which is
deliberate: on systems where process checks are unreliable, that window is what stops a running
instance from having its lock cleaned out from under it.

The refusal was right; only what it said was wrong. It now reads:

> Lock heartbeat is still fresh (82s ago). Cannot clean.
> A lock counts as held until its heartbeat is 5 minutes stale, even if its process has gone. Wait
> it out, or use `--lock-override` to force.

Waiting is a remedy the old message did not mention at all. The five-minute figure is taken from
the setting the check itself uses, so the message cannot fall out of step with the behaviour. The
separate message for a lock genuinely held by a running instance is unchanged, because there
"stop the running instance first" is the right instruction.

Nothing else changes: the command still refuses, and still leaves the lock alone.

Files: `packages/quilltap/bin/quilltap.js`, `__tests__/unit/cli/lock-clean-refusal.test.ts` (new).

#### Changed: the avatar-roll migration now reports what it kept, not only what it collapsed (bug 143)

The migration's summary counted the rolls it collapsed and said nothing about the ones it
deliberately kept — a roll still serving as a character's portrait is kept and shares its
configuration's cache entry, on purpose. With that number missing from the record, ten such rolls
on a development instance were later mistaken for damage, and it took a database forensics session
to establish that all ten were correct.

The summary now ends with "kept N rolls still serving as character portraits". The migration also
checks its own work before finishing, and reports any duplicate it did not deliberately create.

That check runs *during* the migration rather than afterwards, which matters: a character's
portrait can be changed at any time, so asking later whether a roll was kept for a good reason
answers a different question. Two of the ten had had their portraits changed hours before the
inspection that flagged them, and a third character had been deleted outright.

Files: `migrations/scripts/collapse-duplicate-avatar-rolls-v1.ts`,
`__tests__/unit/migrations/collapse-duplicate-avatar-rolls.test.ts`.

#### Fixed: deleting a message that is not there no longer counts as a deletion (bug 142)

`deleteMessagesByIds` reported the number of message IDs it was *asked* about, not the number of
rows it actually deleted. Asked to delete one ID that did not exist, it reported deleting one.

Nothing was lost or corrupted — the chat's message count and last-message time are recomputed from
the messages that survive, so they landed on the right values either way. Two things were wrong:

- Every caller that logs the result was logging a number that could not be false. The Commonplace
  Book's whisper sweep reported "swept N" whether or not it swept anything.
- Since the transcript counter was added, a delete that removed nothing still bumped it and told
  every open Salon tab on that chat that its transcript had changed. Each tab re-read the
  transcript and was handed the one it already had.

The cause was a check for return values the database layer cannot produce. The code tested whether
the delete returned a number, then fell back to testing whether it was truthy — but a delete always
returns a `{ deletedCount, acknowledged }` record, and a miss returns that record with a count of
zero. An object is truthy, so a miss was counted as a deletion, and the total could only ever equal
the number of IDs requested. Six of the seven callers of this database method already read
`deletedCount` directly; this was the only one that did not.

A delete that removes nothing now returns zero, logs nothing, leaves the transcript counter alone,
and tells no one. A batch that removes some of what it was asked about reports only what it
removed, and still announces the change — because it did change the transcript.

The reason this survived is worth recording: the test suite's stand-in for the database returned a
plain `0` or `1`, which took the one branch where the arithmetic was correct. The test named *says
nothing when nothing was removed* had been passing against a database that does not exist. That
stand-in was corrected first, which made the test fail on its own before anything else changed. The
lasting guard is a new suite that runs the real code against a real database instead of a stand-in,
and separately pins what the database layer actually returns.

Files: `lib/database/repositories/chats-messages.ops.ts`,
`__tests__/unit/lib/database/repositories/chats-messages-transcript-version.test.ts`,
`__tests__/unit/lib/database/repositories/chats-messages-delete-count.integration.test.ts` (new).

#### Fixed: a migration test was passing over a helper that did not exist

`add-profile-multi-character-prefill-field.integration.test.ts` replaced the migration's database
helpers with a stand-in that was missing two of them — `sqliteColumnExists` and
`addColumnIfMissing`, both of which the migration calls. Six of its seven tests failed with
`sqliteColumnExists is not a function`, so the migration's column-add and its Anthropic backfill
were not being exercised at all. Only the test double was wrong; the helpers exist and the
migration itself is fine.

Files: `__tests__/unit/lib/database/migration/add-profile-multi-character-prefill-field.integration.test.ts`.

#### Fixed: the native-binding ABI heal now actually rebuilds

After a Node.js upgrade, the SQLCipher native addon is compiled against the old ABI and throws
`NODE_MODULE_VERSION` on load, turning every real-binding test suite red. Both the jest globalSetup
heal and the CLI's `ensureDatabaseNativeModule()` were supposed to fix that automatically. Neither
did.

Both shelled out to `npm rebuild <name>`, which fails two different ways:

- **`npm rebuild better-sqlite3`** (the alias the root install uses) is refused with
  `EALLOWSCRIPTS`. npm no longer runs install scripts for a package that is not listed in the root
  `package.json` `allowScripts` map, which is keyed `name@version` — the alias is not a key there.
- **`npm rebuild better-sqlite3-multiple-ciphers`** at the repo root *is* allowed, reports `rebuilt
  dependencies successfully`, and rebuilds a phantom directory. The stale binary is untouched. A
  false success is worse than an error: the heal reported it had worked and the suites stayed red.

Rebuilds are now addressed by **directory** rather than by npm package name, and run the package's
own build chain in place — `prebuild-install`, falling back to `node-gyp rebuild --release`, which
is exactly what its `install` script does. No name resolution, no npm script policy.

The new helper also **verifies the result instead of trusting the exit code**: it re-reads the
compiled-for ABI out of the binary afterwards and only reports success once it matches the running
Node. A tool that exits 0 without changing anything is now reported as the failure it is, naming
every attempt and what the binding still says.

Files: `packages/quilltap/lib/native-modules.js` (new `findBinFor`, `rebuildNativePackage`;
`ensureDatabaseNativeModule` rewired), `jest.global-setup.js`,
`__tests__/unit/packages/quilltap/native-rebuild.test.js` (new).

#### Fixed: a silent provider no longer freezes chat creation (bug 141)

Creating a chat could hang forever at *Setting the opening scene…*, with the Green Room dialog stuck
open. That dialog cannot be dismissed while creation runs, so the only way out was reloading the
window.

The cause was a provider that accepted the streaming request, sent response headers, and then never
sent a chunk. Nothing caught it. Provider SDK timeouts stop at the response headers — which is what
makes them safe to use on a streaming path, and useless once the headers arrive — so a response body
that never starts was outside every timeout in the app. The chat itself was already fully built by
that point; only the opening line, and the HTTP response, were missing.

Provider streams are now watched for silence. A stream gets a generous budget for its first chunk
(four minutes, since a long prompt with extended thinking legitimately takes minutes to start) and a
tighter one between chunks (two minutes). The opening greeting gets tighter budgets still — 90
seconds and 60 seconds — because it is short and runs behind the blocking dialog.

What happens when a stream goes silent:

- **In a chat**, the turn fails over to the connection profile's understudy, the same as any other
  network failure.
- **During chat creation**, the greeting stops retrying that profile. The remaining attempts go
  back to the same silent provider, so the chat opens with its scripted greeting instead. A silence
  at the Concierge's uncensored profile is the exception: that is a different provider, so the
  character's own profile is still tried.
- **In the log**, `[LLMStream] Abandoned a stalled provider stream` names the provider, the model,
  the budget, and how many chunks had arrived.

A stalled request is abandoned, not cancelled — the provider plugin owns its connection. Killing the
socket needs a change to the plugin interface and is not in this release.

Not affected: slow streams that keep producing. The budget applies to each gap between chunks, not
to the total, so a long answer is never cut off for being long. Thinking models emit reasoning
chunks while they think, and those count.

Files: `lib/llm/stream-watchdog.ts` (new), `lib/services/chat-message/streaming.service.ts`,
`lib/chat/initial-greeting.ts`, `app/api/v1/chats/route.ts`, `lib/llm/fallback/engine.ts`,
`docs/developer/bugs/fixed/bug-141-stalled-stream-wedges-chat-creation.md` (new),
`__tests__/unit/lib/llm/stream-watchdog.test.ts` (new),
`__tests__/unit/app/api/v1/chats/route.greeting-stall.test.ts` (new),
`__tests__/unit/lib/llm/fallback/engine.test.ts`.

#### Changed: a paused chat no longer generates anything on its own (bug 137)

**Pause** in the participants sidebar stopped the turn chain, not the chat. Every message you sent
still drew exactly one reply, and **Nudge** and **Skip** silently cleared the pause before running,
so one nudge put the chat back in the normal rotation.

A paused chat now only advances when you ask it to, one turn at a time:

- **Sending a message** saves it in full — attachments, staged tool results, auto-detected dice
  rolls, inline `@Name:` queries — and generates no reply. The chat stays paused. The first message
  sent during each pause shows a notice explaining this, so the silence isn't mistaken for a failed
  send.
- **Nudge** and **Skip** run exactly one turn and stop. Neither clears the pause.
- **Resume** returns the chat to the normal rotation.

Two related fixes. The `nudge` flag was dropped by a wrapper between the sidebar button and the
server; it is what withholds the "nothing to add" skip option, so a nudged character could pass the
turn — in a paused chat, that means no turn at all (bug 138). And **Continue** in the all-LLM pause
dialog now works: it cleared no pause and requested no turn, so the button meant to restart a
runaway chat only closed the dialog (bug 139).

Also removed: the `isPaused` / `onTogglePause` props passed from the Salon through the message list
to every message row. Neither was rendered, and the memo comparison on `isPaused` re-rendered the
whole viewport on each pause toggle (bug 140). The sidebar Pause button is unaffected.

Not affected: autonomous rooms, which use `runState` and never read this flag; the Courier, which
uses the same flag to hold a chat while waiting for a pasted reply; and the all-LLM turn thresholds
that trigger the dialog.

Files: `lib/services/chat-message/orchestrator.service.ts`,
`lib/services/chat-message/paused-hold.ts` (new), `lib/services/chat-message/streaming.service.ts`,
`app/salon/[id]/SalonView.tsx`, `app/salon/[id]/hooks/useSSEStreaming.ts`,
`app/salon/[id]/hooks/useTurnManagement.ts`, `app/salon/[id]/hooks/useChatControls.ts`,
`app/salon/[id]/components/MessageRow.tsx`,
`app/salon/[id]/components/VirtualizedMessageList.tsx`, `help/chat-multi-character.md`, `help/chat-participants.md`, `help/chat-turn-manager.md`,
`docs/developer/bugs/` (bugs 137–140),
`__tests__/unit/lib/services/chat-message/paused-hold.test.ts` (new),
`__tests__/unit/hooks/useSSEStreaming-send-guard.test.tsx`,
`__tests__/unit/app/chats/[id]/hooks/useTurnManagement.test.ts`.

#### Fixed: a send refused while a reply is still streaming now says so (bug 136)

Pressing Enter in the Salon while a reply was still generating did nothing at all — no notice, no
flash, no log line. The line stayed in the composer and a second press after the turn landed worked,
but in the moment there was no way to tell "I declined to send that" from "something went wrong",
which is the same silence a genuinely broken send produces.

One `return` in `sendMessage` covered two quite different cases. The empty-composer half is correct
and wants no feedback. The `sending` half is a real request refused, and now answers: **One moment —
the room is still speaking. Your remark waits in the composer.** The **Nudge**, **Continue** and
**Skip** controls get the same notice when they are refused for the same reason, being clicks on
explicit controls. A paused chat still declines silently, the sidebar having already said so, and an
empty composer still says nothing.

Files: `app/salon/[id]/hooks/useSSEStreaming.ts`,
`__tests__/unit/hooks/useSSEStreaming-send-guard.test.tsx` (new).

#### Removed: a Stop/Pause flag that was written four times and read nowhere (bug 135)

`userStoppedStreamRef` looked like the latch the SSE read loop consults before acting on an event
that arrives after a Stop. It consulted nothing: the ref had four writers and no readers anywhere in
the checkout. Stopping a turn works, and always worked, because `stopStreaming` aborts the
`AbortController` and the fetch dies.

No behaviour changes. The ref, its writes, the parameter it occupied in `sendMessage` and in the In
Their Own Words dialog's `SendMessageArgs`, and both pass-throughs in `SalonView` are deleted;
`sendMessage` takes seven arguments instead of eight. No race was demonstrated, so the flag went
rather than gaining a reader — a write-only ref type-checks and lints clean, so the next person to
reach for it would have wired a stop-sensitive branch to a guard that is never consulted.

Files: `app/salon/[id]/hooks/useChatControls.ts`, `app/salon/[id]/hooks/useSSEStreaming.ts`,
`app/salon/[id]/hooks/useImpersonationVoice.ts`, `app/salon/[id]/SalonView.tsx`,
`__tests__/unit/hooks/useSSEStreaming-route-trail.test.tsx`.

#### Avatar Rolls section in a character's Photo Gallery

The Photo Gallery tab on a character's Aurora page has a new collapsible section below the album:
**Avatar Rolls**. It lists every portrait the avatar configuration cache holds for that character —
one image per configuration of outfit, image provider, profile and model — with the same actions the
album offers, plus one of its own:

- **Set as avatar** — saves the roll into the album (if it isn't there yet) and points the
  character's portrait at the resulting album link.
- **Keep in the photo album** — hard-links the roll into the character's `photos/` folder. Idempotent;
  a roll already kept shows a filled bookmark and the button is disabled.
- **Download**, **view** (with the generation prompt), and **Save to my gallery** from the enlarged
  view, as in the album.
- **Delete** (two clicks to confirm) — clears every pointer at the roll first (`chats.characterAvatars`,
  `avatarOverrides`, and a legacy `defaultImageId`), then drops the roll's own mount link. **A copy
  you had kept in the album is not deleted.** The cache treats the missing configuration as a miss,
  so the next time the character wears that outfit a new portrait is generated.

Membership is `files.generationKey IS NOT NULL` plus the character's id in `files.tags`, so it covers
rolls stored under `character-avatars/` (before avatars moved into the vault), `images/history/`
(since), and rolls already copied into `photos/`.

New endpoints: `GET /api/v1/characters/[id]/avatar-rolls`,
`POST /api/v1/characters/[id]/avatar-rolls/[fileId]?action=save-to-album|set-avatar`,
`DELETE /api/v1/characters/[id]/avatar-rolls/[fileId]`.

**Behavior change:** the character photo album no longer lists images under `images/history/`. Those
are avatar rolls and now appear only in the new section; previously each one showed in both places on
the same page. `images/avatar.webp` still appears in the album.

#### Wardrobe dialog: "Show shared"

The Wardrobe dialog's item list has a second tickbox beside **Show archived**: **Show shared**, on by
default. Unticking it hides the rows merged in from a shared tier (group, project, Quilltap General)
— the ones badged `· shared` — leaving only garments the character owns, which makes dressing a
character or composing an outfit out of her own clothes a good deal easier.

Unlike **Show archived**, which re-fetches every tier with `?includeArchived=true`, this is a
client-side filter: ownership is a property of the merge, not something the fetch can ask for. It
uses the same `canManage` predicate that badges the row, so the badge and the filter can't disagree.
The tickbox is hidden when browsing a shared container directly, where every row belongs to the
container on display.

#### Character avatars are cached per configuration

A character wearing the same outfit no longer costs a fresh image every time. The avatar prompt is
built from deterministic inputs only, so the prompt plus the built image-generation parameters
(provider, profile, model, LoRAs, options, size) hash to a `generationKey` stored on the `files`
row. Before generating, the avatar job looks that key up; if a matching image is found and its bytes
still exist, it is reused and the job stops there — skipping the Concierge classification call, the
image call, the WebP conversion and the file write. Put the coat back on later and the same portrait
comes back.

The **Regenerate Avatar** button now behaves as a reroll. It sets `force`, which bypasses the lookup,
generates a new image, and rebinds the key to it, so the new portrait becomes the one that outfit
returns from then on. It affects that character in that outfit only — the character's own default
portrait is a separate image and is not touched.

Generated avatars are now always stored in the character's vault, whether or not the chat belongs to
a project. Project-context avatars no longer show up in that project's file tree; existing files keep
their storage location and still display. One consequence: a character whose vault is missing or
broken now gets no avatar at all, where before a project chat could still produce one.

A cache hit posts no Lantern announcement, since nothing was generated. The avatar still updates in
the Salon as usual.

#### Migration: duplicate avatar rolls are collapsed

`collapse-duplicate-avatar-rolls-v1` brings existing avatars into the cache. Avatar rows are grouped
by prompt and model; the newest row in each group survives and receives the cache key, and the rest
are deleted — the `files` row plus the stored image, chunks and links. Every reference to a deleted
row is repointed to the survivor: `chats.characterAvatars`, `characters.avatarOverrides`, and
chat message attachments, including the file uuid the Lantern quotes inline in its announcement text.

This is destructive and visible. The duplicates were not redundant copies of the same image; they
were separate generations of the same prompt. Chats that displayed one of the deleted rolls now
display the surviving one instead, and this cannot be undone. On the instance it was measured
against, 1786 avatar rows collapsed to 889, freeing about 141 MB. Rows with no generation prompt are
skipped, and a group with only one row keeps it and gains a key.

`add-file-generation-key-column-v1` runs first and adds the nullable `files.generationKey` column and
its index.

#### The Salon transcript is now a subscribed read

A message written into a chat now reaches every open tab on that chat, whether or not the tab was
the one that asked for it. Until now there was exactly one path: the read loop of the
`POST /api/v1/messages` fetch the tab itself issued. If that stream was gone — the operator tabbed
away during a long generation, the machine slept, the connection dropped — the reply was persisted
correctly and never appeared, and no error was logged anywhere, because a write to a closed
controller is swallowed and a client that has gone away is indistinguishable from one that is
listening. The same gap is why staff messages written from the forked job child (Aurora wardrobe
notes, Lantern backdrops, Commonplace whispers, Suparṇā's mail announcements) showed up only if
they happened to be enqueued into an open stream at the right moment.

The message write funnel (`ChatMessagesOps`) now publishes `{topic:'chats', id}` on every add,
add-batch, edit, delete and clear, and `useChatData` listens for it and re-reads the transcript.
The re-read is the authority; SSE keeps carrying tokens for the turn being generated but no longer
decides what the room contains. A dropped stream costs a typing animation instead of a turn.

The re-read is conditional, which is what makes subscribing affordable. A new `transcriptVersion`
counter on the chat row is bumped in the same update as the publish, and
`GET /api/v1/messages?chatId=&action=transcript&knownVersion=N` answers `{unchanged: true}` when the
counter still agrees. One busy turn fires wardrobe, backdrop, whisper and memory hints at the same
topic; they now cost round trips, not re-serialized transcripts.

Two pieces of state a mid-conversation refetch used to trample are now preserved. Swipe selection
is carried across by the selected variant's id rather than its index, so a regenerate that appends
a variant no longer yanks the view onto a different reply. Rows that did not change keep their
object identity, and a read that changed nothing returns the very array it was given, so the
virtualizer does not remeasure and the scroll position holds.

An optimistic bubble is now a true overlay: it is dropped the moment the authoritative read carries
a row for it, matched on role and text first and on "a new row of the same role, no older than the
bubble" second (an attachment send stores different text than it displays). A send that never
persisted at all is swept at the turn boundary instead of sitting in the transcript forever.

The counter is a `chats` column but deliberately not a field on the chat entity. Every repository
update rewrites the whole validated row from a snapshot it read moments earlier, so a counter inside
the schema could be rewound by any concurrent chat-row write — two messages landing together would
leave it where a tab that read in between already thinks it is, and that tab would never be shown
the second one. Zod strips what it does not declare, so no `update()` can touch the column and
`SET v = v + 1` is its only writer. Being outside the entity also keeps it out of `.qtap` exports
and backups without any special-casing, and an import starts at zero because it simply isn't in the
bundle.

Search-and-replace announces too. `replaceInMessages` rewrites message rows directly, outside the
add/update/delete funnel; without an announcement an open Salon would go on being told "unchanged"
while every line it displayed had its text rewritten underneath it.

Also in this change: the transcript projection — attachments, pre-rendered HTML, off-scene author
cards — moved out of the chat GET handler into `lib/chat/transcript-projection.ts`, so the mount
read and the conditional re-read cannot drift apart. Both readers take the counter before projecting,
so the version handed to a tab is never newer than the rows beside it. The transcript endpoints now
verify chat ownership, matching the per-message endpoints. The terminal's `chat-update` and
`terminal-exited` browser events now use the cheap transcript read instead of refetching the whole
chat.

Filed while implementing, not fixed here: bug 135 (`userStoppedStreamRef` is written four times and
read nowhere, so Stop and Pause gate nothing) and bug 136 (a send refused because one is already in
flight returns silently, which is indistinguishable from a send that failed).

#### Docs: plan for the Salon transcript as a subscribed read

Added `docs/developer/features/salon-realtime-transcript.md`, a plan to stop the SSE stream being
the only way a message reaches an open Salon tab. The transcript is a plain `useState` array filled
once at mount, so nothing can tell it it is stale: an interrupted stream loses the turn it was
carrying, and staff messages written by the forked child — Aurora wardrobe notes, Lantern backdrops,
Commonplace whispers — show up only if they happened to be enqueued into an open stream at the right
moment. The plan has a chat-scoped realtime hint drive a re-read of the transcript and demotes the
stream to a display-only overlay for the turn in flight, leaving token streaming and the turn
manager alone. Records that child-written messages already publish `{topic:'chats', id}` through the
job dispatcher's post-commit hook, so the publish half is largely built and nothing is listening.
Covers the publish site at the message write funnel, a conditional read so a hint storm costs round
trips instead of payloads, the reconciliation rule between the streaming bubble and the
authoritative rows, and the swipe-selection and scroll-anchor state a mid-turn refetch would
otherwise disturb. Also records two defects found while diagnosing the incident behind it:
`userStoppedStreamRef` is written in three places and never read, so Stop and pause gate nothing,
and the Salon's send returns silently when a send is already in flight.

#### Fixed: a chat setting changed while a Salon tab was open never reached it (bug 134)

Flipping a Settings → Chat dial — auto-scroll, thinking display, token display, the LLM inspector
button, story backgrounds — did not affect a chat already open in another workspace tab. The chat
kept the old value until it was reloaded or closed and reopened. The setting itself saved
correctly; a newly opened chat honoured it.

`SalonView` read its settings from `useChatData`, which fetched `/api/v1/settings/chat` once from
the mount effect into `useState`. That was fine when a Salon was a page and navigating to Settings
unmounted it. The tabbed workspace renders every tab at once and hides the inactive ones with
`display: none`, so a backgrounded Salon never unmounts and never re-runs the effect — the value
was a snapshot of whenever the tab was opened.

Every settings read in the Salon now goes through `useChatSettingsQuery`, the same shared query the
composer plugins already used. Saving a dial invalidates that key, which TanStack delivers to every
mounted observer including a hidden tab, so an open chat follows the change without remounting (and
without interrupting a stream). `fetchChatSettings` and the `chatSettings` state are gone from
`useChatData`. The Salon's own duplicate `ChatSettings` interface, plus the four sub-shapes it
referenced, are now re-exports of `components/settings/chat-settings/types` — one declaration of the
row instead of two. The memory-cascade "remember my choice" write also invalidates the key, which
it never did.

Files: `app/salon/[id]/SalonView.tsx`, `app/salon/[id]/hooks/useChatData.ts`,
`app/salon/[id]/types.ts`, `app/salon/[id]/hooks/useMessageActions.ts`,
`app/salon/[id]/components/VirtualizedMessageList.tsx`,
`app/salon/[id]/hooks/__tests__/useImpersonationVoice.test.ts`.

#### Fixed: both voice rehearsals were logged as chat summaries

`mapTaskTypeToLogType` is a closed allowlist, and an unmapped task type falls through to
`SUMMARIZATION` rather than failing. Neither `announcement-rewrite` (the Insert Announcement
rehearsal, since 4.4) nor the new `impersonation-voice-rewrite` was mapped, so both filed
themselves as chat summaries — indistinguishable from real summarization in the Almanack's Wire
Records and in the LLM inspector's filter groups. Added an `LLMLogType` of `VOICE_REWRITE` and
mapped both to it. `llm_logs.type` is plain `TEXT` with no constraint, so no migration is needed;
existing rows keep whatever they were written with. The mapping now has a test, since the failure
mode is silent.

Files: `lib/schemas/llm-log.types.ts`, `lib/memory/cheap-llm-tasks/core-execution.ts`,
`components/tools/llm-logs-card.tsx`, `components/chat/LLMInspectorEntry.tsx`,
`components/chat/LLMInspectorPanel.tsx`.

#### Added: impersonated lines can be restated in the character's own voice before posting

New instance setting, Settings → Chat → Composer, default off. With it on, a line typed while
impersonating a character (the Impersonate button) opens a review dialog instead of posting: the
seat's own model restates the draft in that character's voice, and the operator can send the
restatement (edited or not), regenerate it, go back to the composer and rewrite, or send the
original as written. Nothing reaches the chat until they choose.

The rewrite reuses the Insert Announcement rehearsal's core but frames the character as *in* the
scene rather than outside it: the seat's own connection profile and system prompt, the chat's
roleplay template, Taboo phrases, standing instructions, the last 12 played messages shaped as that
seat would see them (whispers it isn't party to excluded, `[Name]` attribution in a
multi-character room), and a Commonplace Book recall against the draft. No tool instructions. A
chat the Concierge has flagged follows its turns onto the uncensored route; a refusal surfaces as
an ordinary preview failure and never escalates on its own.

The Salon reads the setting through the TanStack query rather than the Salon's mount-only settings
fetch, so flipping the toggle takes effect on a chat that is already open — a workspace tab keeps a
Salon mounted indefinitely, so a mount-only read would never have seen it. Eight other Salon
settings reads still have that staleness; filed as bug 134.

The gate never fires for a `controlledBy: 'user'` seat (owner persona, or a seat flipped to user
control), for an attachment-only or tool-result-only send, or for a Carina address — `@Name:` is
machinery and must survive verbatim. Document Mode edits don't pass through the send path and are
unaffected. "Send as written" and "Edit original" stay available after a failed preview, so a dead
provider can't trap a draft.

Nothing extra is persisted. The posted message is an ordinary user-authored message attributed to
the impersonated seat, exactly as before; the rewrite's audit trail is its `llm_logs` row, filed
under the new `VOICE_REWRITE` type (see the entry above).

Files: `lib/schemas/settings.types.ts`, `migrations/scripts/add-impersonation-voice-rewrite-field.ts`,
`lib/startup/prettify.ts`, `lib/database/repositories/chat-settings.repository.ts`,
`app/api/v1/settings/chat/route.ts`, `lib/services/announcer/voice-rewrite-core.ts`,
`lib/services/announcer/character-voiced.ts`, `lib/services/announcer/in-scene-voiced.ts`,
`app/api/v1/chats/[id]/actions/impersonation-voice-preview.ts`,
`app/api/v1/chats/[id]/{schemas.ts,actions/index.ts,handlers/post.ts}`,
`app/salon/[id]/hooks/useImpersonationVoice.ts`, `app/salon/[id]/hooks/useSSEStreaming.ts`,
`app/salon/[id]/SalonView.tsx`, `app/salon/[id]/components/{ChatModals,ChatComposer,SpeakingAsAvatar}.tsx`,
`components/chat/{ImpersonationVoiceDialog,VoiceRewriteReviewPanel,InsertAnnouncementDialog}.tsx`,
`components/settings/chat-settings/ImpersonationVoiceSettings.tsx`,
`components/settings/tabs/ChatTabContent.tsx`, `lib/tools/almanack/{types,phase3-ledgers,render}.ts`,
`help/impersonation-voice.md`, `docs/developer/{API.md,DDL.md}`.

#### Fixed: a moderated chat's story background could escalate to the uncensored image provider

A chat the Concierge had never flagged — no override, `isDangerousChat` false — could receive a
story background generated by the uncensored image provider, from a prompt written to be explicit.
Bug 133.

Two defects in series:

- `sanitizeAppearancesIfNeeded` skipped sanitizing appearance text it had just classified as
  dangerous whenever an uncensored image profile was configured anywhere in settings, on the
  assumption that such text is routed there. That holds for the image-generation tool, which
  classifies each prompt and reroutes on the spot under `AUTO_ROUTE`. It does not hold for story
  backgrounds, which never route up front — a moderated chat's backdrop goes to the moderated
  provider whatever the classification says. Raw "naked, barefoot" appearance text therefore
  reached the prompt crafter, and the moderated provider refused what came back. The parameter is
  now `routesDangerousToUncensored` and callers answer for the scene in hand: story backgrounds
  pass `uncensoredImageTarget`, the image tool passes `AUTO_ROUTE && uncensoredImageProfileId`
  (so it sanitizes under `DETECT_ONLY`, where nothing reroutes).
- The story-background job's post-hoc reroute — its retry on the uncensored profile after a
  provider rejects an image for content — was gated on the global `AUTO_ROUTE` setting alone and
  never on the chat's own Concierge state. It then re-crafted the prompt candidly *because* the
  chat was moderated, on the reasoning that a prompt written for a moderated provider must be
  needlessly coy. A moderated chat got the strongest escalation available, triggered by the
  refusal that should have stopped it. The reroute now also requires `isDangerousChat`. That makes
  the re-craft unreachable — any reroute is now a chat whose prompt was already candid — so it is
  deleted and the prompt is resent as-is.

A moderated chat whose story background is refused now fails the job and produces no image, which
is the intended outcome. The concealment prompting itself is unchanged and remains permissive
enough that a cheap model may satisfy it by naming an undressed state rather than concealing it;
that is tracked separately.

Files: `lib/image-gen/appearance-resolution.ts`,
`lib/background-jobs/handlers/story-background.ts`,
`lib/tools/handlers/image-generation-handler.ts`, `help/dangerous-content.md`.

#### Fixed: `describe_image` on a generated picture returned its label, not a description

The story-background job stored `Story background for: <scene or chat title>` and the
wardrobe-portrait job stored `<Name> — wardrobe portrait` in the `description` column of every
image they produced, on both the `files` row and its Scriptorium link. `describe_image` served
whatever sat in that column before it would read the generation prompt or spend a vision call, so
a character asking what a backdrop showed was told the chat title. Bug 132.

Three changes:

- Neither job writes the label any more. `description` is left null; the generation prompt and
  revised prompt were already stored beside it and are the account of record.
- `describe_image` now prefers the generation prompt over a stored description, the same order
  `runGenerateImageDescription` (the blind-model attachment fallback) has always used. When both
  exist the stored description is returned too, as `stored_description` and an `On file:` line in
  the formatted text, so a human-written or vision-written description is never hidden behind the
  prompt. This also covers a `.qtap` import from an older export that still carries a label.
- A new migration, `clear-generated-image-placeholder-descriptions-v1`, clears the two label
  shapes already on disk: `files.description` to NULL on `source = 'GENERATED'` rows, and
  `doc_mount_file_links.description` to its `''` default on image links. Real descriptions,
  uploads, and non-image links are untouched. An unreadable mount index degrades the link sweep
  to a warning rather than failing the migration.

Files: `lib/tools/handlers/doc-edit/photo-handlers.ts`, `lib/tools/describe-image-tool.ts`,
`lib/background-jobs/handlers/story-background.ts`,
`lib/background-jobs/handlers/character-avatar.ts`,
`migrations/scripts/clear-generated-image-placeholder-descriptions.ts`, `help/keep-image-tools.md`.

#### Fixed: a user-controlled character's talkativeness now counts in the speaking order

Talkativeness on a character you drive yourself had no effect on the rotation. The six server paths
that pick a speaker each built their own `characterId -> Character` map first, and four of them
built it from `getActiveCharacterParticipants`, which returns LLM-controlled seats only. A seat you
control was therefore missing from the map, so the draw fell back to the 0.5 default for it unless
the seat carried a per-chat talkativeness override, and an archived character on such a seat was
never filtered out of the rotation. The help text has always said talkativeness applies to user
characters; now it does. This predates the cycle-order change — the old one-at-a-time pick had the
same blind spot — but it matters more now that the whole rotation is drawn from those weights at
once.

The six hand-rolled loops are replaced by one helper, `loadRoomCharacters`
(`lib/chat/turn-manager/room-characters.ts`), which builds the map over `getPresentCharacterSeats`
— every present character seat, whoever drives it. `loadAllParticipantData`, which builds the same
map for prompt construction rather than for selection, now uses it too.

It is also fewer queries. The loops called `repos.characters.findById` per seat, and each of those
overlays one character's vault with eleven queries plus the row read; the helper calls `findByIds`
once, which overlays the whole room in a single batch whatever the seat count. A four-seat room
goes from roughly 48 queries per selection to 12.

Failure handling changes with it. `findById` throws `CharacterVaultUnavailableError` when a
character's vault is unreadable, which used to throw straight out of speaker selection and take the
turn — and the read-only `?action=turn` request behind the participant sidebar — with it. The
batched read logs and drops such a character instead, which is what the consumers were already
written for: a seat whose character is missing from the map stays in the rotation at the default
weight rather than silently vanishing from the room. On the prompt path the same change means a
shelved vault costs the prompt that character's contribution rather than failing the whole reply,
which is the policy `findNamesByIds` already applied there.

`GET /api/v1/chats/[id]?action=turn` also stops reporting a user-driven seat as `nextSpeakerName:
null` and `participant.name: "Unknown"`, since that seat's character is now in the map it reads
names from. Filed as bug 131.

#### Changed: a multi-character chat draws its speaking order once per cycle

The rotation for a cycle is now decided up front and kept. When a cycle begins, the turn manager
draws the whole order — a talkativeness-weighted permutation of the present character seats,
sampled without replacement — stores it on the chat, and follows it seat by seat until the cycle
wraps, at which point it draws a new one. Previously each turn made its own weighted pick from
whoever had not yet spoken, so the order could not be known before it happened.

The distribution of rotations is unchanged: drawing the permutation up front and drawing it one
element at a time are the same successive-sampling procedure. What changes is that the order is
knowable in advance, so the sidebar's Participants list shows the real sequence instead of the
talkativeness-sorted guess it used to display below the queue. Position 3 now means third.

Stored as `chats.cycleOrderParticipantIds` (added by `add-cycle-order-column-v1`): the participants
who have yet to speak this cycle, in order. It is consumed at the same write chokepoints that
advance `spokenThisCycleParticipantIds` — a message landing, a skipped user turn, an LLM's "nothing
to add" pass — and drawn by `resolveCycleOrder` (`lib/chat/turn-manager/cycle-order.ts`), the single
writer, which every server path that asks "who is next" now calls first: the chain loop, the
first-responder resolver, the message finalizer, `?action=turn`, and the autonomous-room handler.
The client reads the stored order and never draws one.

Mid-cycle cast changes are repaired rather than redrawn: a departed seat or archived character is
skipped when the order is read, and a character who joins mid-cycle is appended to the back and
dealt in properly at the next draw. A one-character chat stores no rotation. Selection keeps the old
one-at-a-time weighted pick as its fallback for any chat with no rotation on file yet, so existing
conversations carry on without a migration of their turn state. The manual queue still jumps the
line, and a summoned character is struck from the remaining order so they do not speak twice.

#### Added: the Salon chat gallery

The **Gallery** button in a chat's Organize drawer now opens a grid of every image in the
conversation, whatever produced it: uploads and library links, `generate_image` output, images from
either Generate Image entry point, story backgrounds the Lantern painted (including superseded
ones), Aurora avatar repaints (likewise), pictures re-shown from a photo album, files the Librarian
attached from a document store, the cast's standing portraits, and images referenced only by a
Markdown link in message prose. Previously the listing covered the first six and the button never
appeared at all (bug 129).

One server-side enumerator, `lib/photos/chat-gallery.ts`, is the single place that knows all nine
sources; the `/chats/[id]/files` listing now shares its message-attachment walk rather than keeping
a second copy. It answers on `GET /api/v1/chats/[id]?action=gallery` with entries, per-source
counts, and a total. Each entry carries whether its id is a `files.id` or a
`doc_mount_file_links.id`, which source it came from, whether it is the background the chat is
currently showing or the avatar a character is currently wearing, and whether the chat owns the
record well enough to delete it. Entries are deduped by content hash and sorted newest first, with
standing portraits at the end.

The grid has a filter chip per source with its count (chips for empty sources are hidden, and the
row disappears entirely when everything came from one place), a `current` badge on the background
and avatars presently in play, and Save / Download / Delete on hover. Delete appears only where the
chat minted the record — never a portrait, a kept album image, an inline reference, or the
background and avatar currently on display. The modal now renders through a portal to the document
body, so it is not trapped under the toolbar inside the tabbed workspace.

Save opens the same album dialog the message toolbar's bookmark opens — the full album list, the
caption field, the duplicate notice. Because half the gallery has no message to be attached to, it
posts to a new chat-scoped `POST /api/v1/chats/[id]?action=save-image` whose guard is gallery
membership rather than message attachment; both routes share one Zod body schema, one attribution
resolver (`lib/photos/save-attribution.ts`), and one album service. The message route's behaviour is
unchanged except that `ALREADY_SAVED` now reads as a duplicate notice in the dialog. The detail
view's two hard-wired "first character" album buttons are removed in favour of that dialog, and it
gains a provenance line and a Jump-to-message link.

The sidebar's `Gallery (N)` count and the grid are now one TanStack Query read
(`queryKeys.chats.gallery`), which rides the existing `chats` realtime topic — so a Lantern backdrop
or an Aurora repaint landing from a background job updates the number with no poll. `chatPhotoCount`
and `fetchChatPhotoCount` are gone from `useChatData`.

New help page `help/chat-gallery.md`; `chat-participants.md`, `chat-message-actions.md` and
`photo-gallery.md` updated to point at it.

#### Changed: image routes accept `?download=1`

`GET /api/v1/files/[id]`, `GET /api/v1/files/proxy/[...key]` and
`GET /api/v1/mount-points/[id]/blobs/[...path]` now honour `?download=1` (or `download=true`) by
serving `Content-Disposition: attachment` instead of `inline`. Nothing else about the response
changes — content type, length, cache headers and `X-Blob-Sha256` are all as before, and a
non-ASCII filename still carries its RFC 5987 `filename*`.

The client helpers `downloadImageUrl` / `downloadGalleryEntry` in `lib/download-utils.ts` append the
flag and hand the URL to `triggerUrlDownload` rather than fetching the bytes into a Blob first. In
the Electron shell that streams a 4K story background straight to disk through `will-download`
instead of through renderer memory. `ImageModal` and the gallery's detail view both use it;
`downloadFetchedFile` remains for the copy-to-clipboard path, which genuinely needs the bytes.

#### Fixed: the Salon sidebar's Gallery button appears (bug 129)

It never had. `fetchChatPhotoCount` fetched `/api/v1/chats/{id}?action=files`, and the chat GET does
not dispatch a `files` action — an unrecognised action is not rejected, it falls through to the
whole-chat payload, so the request answered `200`, `data.files` was `undefined`, and the count that
gated the button was zero on every read. The working listing was one path segment away at
`/api/v1/chats/[id]/files`, which the gallery modal itself called correctly once something managed
to open it. The counter is deleted rather than repaired: the number now comes from the chat-gallery
query, and the button has no gate at all. This supersedes step 5 of bug 128, which would have
re-read the same dead action.

#### Fixed: `POST /api/v1/images?action=generate` can be told which chat asked (bug 130)

The route built `linkedTo` from tags alone and had no `chatId` in its schema, so an image made
through it was linked to its tags and to no conversation, and invisible to every
`files.findByLinkedTo(chatId)` read. It now accepts an optional `chatId` and folds it into `linkedTo`
beside the tag ids, deduped so a caller passing both a `CHAT` tag and `chatId` does not link it
twice. Latent rather than live: the Salon's Generate Image dialogs post to
`/api/v1/image-profiles/[id]?action=generate`, which has always passed the chat through, and no
caller in the app used the collection route.
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

#### Fixed bug 128: the Salon's memory count went stale and disarmed its own delete button

The sidebar's Delete Memories count was read once, by a mount-only effect, and nothing ever read it
again. Memories are written afterwards by background jobs in the forked child, turn after turn, and
the tabbed workspace keeps a hidden Salon pane mounted for the life of the session — so a chat opened
before its first memory landed read `Delete Memories (0)` indefinitely, over a chat holding dozens.
`handleDeleteChatMemories` then early-returned on that false zero, absorbing the click with no
confirmation, no toast and no log line.

Added a `memories` realtime topic: declared in `realtime.types.ts`, keyed by
`queryKeys.memories.chatCount(chatId)`, mapped in `topic-map.ts` and added to
`ALL_REALTIME_PREFIXES`, and published from `topicsForCompletedJob` for the five memory job types
plus `publishRealtime` at the `memory-gate` deletion chokepoint, which every delete path runs
through. It is the first topic whose `id` is not the changed row's own primary key — it is scoped by `chatId` — which is why `memories` is deliberately
absent from `REPOSITORY_TOPICS`: `firstIdArg` would publish a memory id under a chat-scoped topic and
every subscriber would filter it out.

The subscription lives in `useChatData`, the hook that owns the count, rather than at the Salon call
site, so a future consumer cannot forget it; `useRealtimeTopic` also fires on socket open, so a
reconnect re-reads for free and no poll is added. The count fetch gained `cache: 'no-store'`, matching
its siblings. The button is now `disabled` at zero, and the confirmation re-reads the count from the
server immediately before it opens, so the dialog can never quote a stale number and a socket that was
down does not cost the user the action. Step 5 of the bug's plan (the identical `chatPhotoCount`
shape) stays superseded by the Salon chat gallery plan.

#### Fixed bug 127: the progressions card printed raw markup when two entries were unreadable

`ProgressionsSection` built its list of unreadable progression ids by joining them with a literal
`</code>, <code>` inside a JSX expression. The join produces a string, React escapes it, and the
sentence telling a user their vault is damaged handed them raw markup instead. One bad entry rendered
perfectly — the join had nothing to join — which is why the suite never saw it. The ids are now
rendered as elements, the same map-with-separator shape `CustomToolRunDialog` already uses. Output for
a single id is unchanged character for character.

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
