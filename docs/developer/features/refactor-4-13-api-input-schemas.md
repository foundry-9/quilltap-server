# Refactor 4.13 — API inputs: schemas instead of hand validation, and the remaining standard departures

**Status:** Implemented (2026-11-11) on `claude/laughing-dirac-nvol84`; decisions recorded in §7. Written against `HEAD` = 167d06503. Part of the [4.13 refactor set](refactor-4-13.md). Fixes #165, #166, #167 and #168.

Counts and line numbers are the audit's (a scripted sweep of all 158 `route.ts` files, 27.5k lines, and 108 handler modules) and will drift. Re-run the sweeps before starting.

## 1. The problem

The API standard's main rule holds: no route reads `?action=` by hand, the non-v1 routes are exactly the sanctioned ones, there is no `.partial()` and no synchronous `params`. What departs from the standard is how requests are **validated** and how responses are **built**.

### 1.1 Hand validation that has diverged

| Route family | Lines | What the copies disagree on |
|---|---|---|
| Connection profiles: `connection-profiles/route.ts:150-372` (create), `[id]/route.ts:110-420` (update) | about 530 | Create never type-checks `parameters` (null or a string is stored), `isDefault`, `isCheap`, `sortIndex`; update rejects a non-object `parameters`. Update validates `courierDeltaMode`'s type; create coerces. Create resolves `pseudoToolMode` by allowlist silently; update returns 400. The fallback-profile rules (self-reference, Courier target) are written twice. |
| Image profiles: `image-profiles/route.ts:445-537`, `[id]/route.ts:70-200` | about 220 | Field-by-field `if (x !== undefined) { typeof … }` in both. |
| Embedding profiles: `embedding-profiles/route.ts:253-361`, `[id]/route.ts:60-200` | about 250 | As above; update cannot clear a field the client sends as absent. |
| Chat settings PUT: `settings/chat/route.ts:52-383` | about 330 | A 36-positional-argument function; a hand `ACCEPTED_KEYS` set that must match the destructure and the call; five nested objects hand-checked then stored whole, so an unknown or partial nested object persists as sent; 400 vs 500 chosen by `errorMessage.includes('Invalid')` (#166). |

More hand validation with no twin to diverge from: `api-keys` (five POST actions and PUT), `roleplay-templates` POST/PUT, `system/tools` (delete-data, tasks-queue, export, import-execute, report-delete, ai-import-stream), `system/restore`, `system/jobs` POST (enqueues any job type with an unvalidated payload), `chats/[id]/files` (both POSTs), `plugins/[name]` PUT, `mount-points/[id]` delete-file.

### 1.2 Smaller patterns, each with a filed bug

- **`.parse()` inside a catch-all** returns 500 for a validation failure in four routes, and hides the 503 the middleware would give for an unavailable store (#166).
- **Pagination parsed seven ways**; `llm-logs` slices `offset` from an already-limited page and accepts a negative limit (#167).
- **A failed `safeParse` treated as "field absent"** runs a billable regeneration (#168).
- **Hand-built `Content-Disposition`** at six sites; three fail on a non-Latin-1 name (#165).

### 1.3 Standard departures (conformance table)

38 route files; some appear twice.

| Departure | Count | Files |
|---|---|---|
| Action or verb as a path segment | 11 | `wardrobe/analyze-image`, `wardrobe/preview-avatar`, `atlas/transfers`, `inventory/transfers`, `wardrobe/transfers`, `search-replace`, `system/browse-directory`, `system/plugins/initialize`, `chats/[id]/qtap-target`, `files/proxy/[...key]`, `groups/scenarios` |
| Action discriminator in the body | 4 | `system/tools/route.ts:297` (tasks-queue `{action}`), `chats/[id]` `?action=turn` (`schemas.ts:179-183`), `atlas/transfers`, `inventory/transfers` |
| Verb misuse | 8 | POST `models` (a read that caches); POST `chats/[id]?action=turn` with `query`; POST `system/tools?action=capabilities-report-delete`; DELETE with a JSON body on `projects/[id]/mount-points` and `groups/[id]/mount-points`; DELETE `memories?chatId=`; GET handlers that write (below) |
| GET that writes | 4 | `chats/[id]?action=mailbox` (`ensureCharacterVault`), `settings/chat` GET (creates the default row), `system/jobs` GET (starts the processor), `chats/[id]` default GET (enqueues a re-embed, reconciles terminals, posts mail announcements; documented as deliberate) |
| No `createContextHandler` | 9 | `system/deployment`, `system/migration-warnings`, `system/pepper-vault`, `system/plugins/initialize`, `system/plugins/upgrades`, `system/startup-status`, `system/unlock`, `themes/route.ts`, `themes/[themeId]/route.ts`. The startup and unlock ones must answer before the database opens; the themes routes and the three state-changing POSTs have no such reason. |
| Hand-built `NextResponse.json` where a helper exists | 193 calls in 59 files | Heaviest: `memories/route.ts` (20), `system/tools/route.ts` (17), `api-keys/route.ts` (14), `image-profiles/route.ts` (8), `mount-points/[id]/route.ts` (8); `chats/[id]/actions/*` almost uniformly |

Also: `GET /api/v1/models` reads `hasVision` / `hasStreaming`, echoes them under `filters`, and never applies them; manual memory create (`memories/route.ts`, about `:640-655`) returns 400 after the row is saved when the follow-up keystone mark is refused.

## 2. Goal

- A request body is validated by a Zod schema derived from the entity schema; create and update share it (`patchSchemaOf` for the update).
- A validation failure is a 400 everywhere, by the middleware, with no route-level classification.
- One pagination reader, one `Content-Disposition` builder, the response helpers.
- The conformance table is worked down to the entries the human decides to keep.

## 3. Non-goals

- The Wardrobe / Inventory / Atlas route factories and item-images routes: the 4.12 browser-family spec and the [item-family kernel](refactor-4-13-item-family-kernel.md) own them.
- Origin / CSRF handling in `proxy.ts`: separate, see the [index](refactor-4-13.md).
- URL changes that would break the CLI or the Electron shell without a redirect. Any path that moves keeps the old path answering for one release (decision 1).

## 4. Design

### 4.1 Profile input schemas

`lib/llm/connection-profile-input.ts`: `ConnectionProfileCreateSchema` derived from the entity schema (strict), `ConnectionProfileUpdateSchema = patchSchemaOf(...)`, and the cross-field rules (`fallbackProfileId` self-reference and Courier target, Courier forcing, `pseudoToolMode` allowlist) as one `.superRefine` used by both. Where create and update disagree today, the stricter behaviour wins unless the UI depends on the lenient one; check `components/settings/connection-profiles/ProfileModal.tsx` for what it sends, and keep error strings the UI displays. The same for image and embedding profiles. An update schema must distinguish "absent" from "null" so a field can be cleared.

### 4.2 Chat settings PUT

`patchSchemaOf(ChatSettingsSchema)`, strict, plus the retired-key check. The repository replaces each top-level key wholesale and the clients already send whole nested objects, so nested objects validate against their full sub-schema. The 36-argument function takes the parsed patch. The `includes('Invalid')` branch goes.

### 4.3 Small shared readers

- `readPagination(req, { defaultLimit, maxLimit })` in `lib/api/query-params.ts` beside `readIncludeArchived`: clamps to `[1, maxLimit]`, treats NaN as the default, offset `>= 0`. Seven call sites. The llm-logs repository readers take the offset so paging happens in SQL.
- `buildContentDisposition` (`lib/api/content-disposition.ts`) at the six hand-built sites. While there, escape `"` and `\` in its ASCII `filename="…"` form.
- A rule for `safeParse`: a body that is present and fails the schema is a 400. Sweep for `safeParse(` whose failure branch proceeds.

### 4.4 `system/tools/route.ts` and `tools/route.ts`

- `app/api/v1/system/tools/route.ts` is 1,185 lines holding five unrelated features (delete-all-data, the job queue view and control, export, import, the Almanack reports, AI import), all hand-validated, `context: any` throughout. Move each to a module under `lib/` with a Zod body schema; the route file becomes the dispatch table. Little net deletion (about 150 lines); the value is that most of the unvalidated bodies and hand responses live here.
- `app/api/v1/tools/route.ts` is 890 lines for one GET: about 440 lines of hand tool metadata (`BUILT_IN_TOOLS`), a second hand map (`BUILT_IN_TOOL_SCHEMAS`) and a per-tool availability `switch`. Compared with `lib/tools/effects.ts` it has drifted: `doc_move_folder`, `doc_open_document`, `doc_close_document`, `doc_focus`, the four `doc_*_blob` tools, `terminal_list`, `terminal_read`, `read_conversation`, `upsert_annotation` and `delete_annotation` are declared tools absent from the list, so the operator cannot see or disable them in the tool picker (not traced to the Salon tool builder; confirm which are offered to characters). Put display name, description and category beside each tool's definition and effect in `lib/tools/`, and have the route map over the registry. The snapshot test that already fails on a missing effect entry fails on missing display metadata too. About 500 lines leave the route.

### 4.5 Twin routes

`projects/[id]/mount-points` (144 lines) and `groups/[id]/mount-points` (119) are one route with two owners; they disagree on error handling (#166), the GET payload (`officialMountPointId` only for projects) and logging. A small factory parameterised by owner repository and link repository; about 110 lines removed. Unlink takes `?mountPointId=` instead of a DELETE body.

### 4.6 The conformance table

Work it in this order: GETs that write (move the write to the POST that follows, or to an explicit action); body-discriminator actions to `?action=`; verb misuse; path-segment actions (decision 1); `createContextHandler` for the routes with no startup reason; response helpers last, mechanically, file by file.

`updateChatSchema` (`chats/[id]/schemas.ts:13-37`) accepts `contextSummary` (written straight through at `helpers.ts:519` with no anchor or turn bookkeeping) and `title` with `isManuallyRenamed` as independent fields. Remove `contextSummary` from the schema and have a rename set the flag server-side.

## 5. Phases

1. **The four bugs in place** (#165–#168), each with a failing test; `readPagination`.
2. **Chat settings PUT** on a patch schema.
3. **Profile schemas**: connection, then image, then embedding.
4. **Twin mount-point routes**; the remaining hand validation in §1.1, heaviest first.
5. **`system/tools` split**; **`tools` GET from the registry**.
6. **Conformance table**, in §4.6's order. Update `docs/developer/API.md` as each route moves.

## 6. Tests and gates

- For every schema: the existing happy-path route tests pass unmodified; add one malformed-body test per route asserting 400.
- A sweep test, in the style of the existing chokepoint grep-tests, that fails on `await req.json()` in `app/api/v1/**` not followed by a schema parse in the same handler (with an allowlist that shrinks as phases land).
- Expected size: 1,400–1,700 lines removed (profiles 500–600, chat settings 300, tools GET 500, twins 110, the rest small). Medium risk on the profile routes (error strings, Courier coercions); low elsewhere.
- CHANGELOG cites `#165`–`#168`. `docs/developer/API.md` must stay current.

## 7. Decisions for the human

1. Path-segment actions (the 11 in §1.3): move to `?action=` with the old path redirecting for one release (proposed), or record them as accepted exceptions in API.md?
2. The default chat GET's side effects (re-embed enqueue, terminal reconcile, mail announcements): keep as documented (proposed), or move to a `?action=visit` POST the Salon calls on mount?
3. Stricter profile validation on create: any external client (CLI, scripts) known to send the lenient forms?
4. The tool picker: should every character-offered tool be listed and switchable (proposed), or are some deliberately hidden?

### Decisions taken (2026-11-11)

1. **Moved**, for consistency, with the old paths answering until 4.14 through `deprecatedPath` (`lib/api/deprecated-path.ts`). Exceptions: `files/proxy/[...key]` and `chats/[id]/qtap-target` are byte routes whose page-CSP exemption in `next.config.js` can only match a path (and proxy URLs are stored in content); `search-replace` already dispatched on `?action=`. Body discriminators moved too (`turn-*`, `tasks-queue-start|stop`, `move-to-tier|copy-to-tier`); `turn-query` stays a POST because it stores a redrawn rotation.
2. **Moved**: GETs don't write. The chat GET's housekeeping is `POST ?action=visit`; the mailbox reads the vault pointer; the processor starts at boot rather than on the jobs poll.
3. No external clients known; the stricter validation stands.
4. Every tool a character is offered is listed. `doc_move_folder` and the four `doc_*_blob` tools stay unlisted because no surface offers them.

Not done here: per-job-type payload schemas for `POST /system/jobs`, the §6 `req.json()` sweep test, and the mechanical `createContextHandler` / response-helper sweeps.
