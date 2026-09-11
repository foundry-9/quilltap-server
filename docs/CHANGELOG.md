# Quilltap Changelog

## Recent Changes

### 4.10-dev

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
