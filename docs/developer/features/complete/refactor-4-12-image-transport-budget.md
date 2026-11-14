# Refactor 4.12 — One image transport budget on the way to a provider

**Status:** Done (2026-11-03), Phases 0–2 landed together; see §9 for what was decided and where the build departs from this text. Proposed 2026-11-02. Part of the [4.12 refactor set](../refactor-4-12.md). Extends the CLAUDE.md rule "What an image costs a model is not what it costs the gallery" from *per image* to *per request*.

## 1. The problem

Five places decide which images a Salon turn sends to a provider, and they grew one bug at a time (151: 4.52 MB on the wire; 106; 259: no size cap on re-sent uploads; and this cycle's `maxImagesPerRequest`). Each is locally sensible. Together they are uneven:

| # | Site | What it enforces | Knows | Blind to |
|---|---|---|---|---|
| 1 | `loadChatFilesForLLM` → `shrinkImageForLlmTransport` (`lib/chat-files-v2.ts:490-503, 626-637`; `lib/files/llm-image-budget.ts:105-191`) | Per-image bytes: long edge 1024, WebP quality ladder, ceiling `min(500 KB, providerMax)` | The raw buffer, the provider's per-image ceiling | Count, total, a later profile swap |
| 2 | `loadAndProcessFiles` (`context-builder.service.ts:191-260`) | Capability: describe an image for a non-vision profile (`processFileAttachmentFallback`) | This turn's uploads | Count, bytes |
| 3 | `rehydrateUserAttachments` (`:433-518`) | Capability only; comment at `:489-492`: "No size cap (bug 259)" | Uploads the character has not seen | Count, bytes |
| 4 | The Lantern walk (`:1225-1339`) | Count cap (`imageSlotsLeft`, `:1255-1259`, newest first, overflow *described*) **and** a byte budget (`LANTERN_IMAGE_BASE64_BUDGET` 2 MB, `:1300-1304`, overflow *silently dropped*) **and** capability | Which images are generated (cheap to describe) and their age | Uploads' bytes; the budget covers Lantern images only |
| 5 | `adaptMessagesForProfile` / `findImagesOverCap` (`lib/chat/message-attachment-adapter.ts:104-123, 139-243`), run on the final array (`:1381-1390`) and again per understudy (`provider-failover.service.ts:507-509, 848-850`) | Count cap and capability | The profile actually being called | Bytes; provenance; age (inside the single anchor message it walks uploads, then rehydrated, then Lantern **oldest first**, the reverse of site 4) |

Consequences, each verifiable today:

- **The byte budget covers one of three image sources.** Four uploads at ~500 KB each plus 2 MB of Lantern images is ~4 MB: bug 151 territory, under a budget that was meant to prevent it.
- **The cap is enforced twice with opposite tie-breaks**, and works only because site 4 usually leaves nothing for site 5 to catch.
- **Over-count is described; over-budget vanishes.** An image past `maxImagesPerRequest` becomes a description; an image past 2 MB is `droppedForBudget++; continue` with no text and no log line a user could find.
- **Understudies get the count re-checked, never the bytes.** The failover chain re-runs site 5 only.
- **The capability filter is written three times** (`:248`, `:485`, `:1286`), each calling the same `processFileAttachmentFallback`.
- A naming collision waits for the next reader: `maxImagesPerRequest` in `ImageProviderConstraints` (`packages/plugin-types/src/plugins/provider.ts:394`) is the number of *generated* images per call and has nothing to do with `connection_profiles.maxImagesPerRequest`.

## 2. Goal

One pass, `applyImageTransportBudget(messages, profile, policy)`, over the final message array, that enforces count, bytes and capability for whatever profile is about to be called, ranks by provenance and age rather than array position, and either describes or drops *with a trace*. It runs wherever `adaptMessagesForProfile` runs today, so understudies get the full policy for free. The Lantern walk stops counting and budgeting and goes back to collecting candidates.

## 3. Non-goals

- **Moving the per-image shrink.** Site 1 stays at load time: it needs the raw buffer, and the 500 KB target binds for every provider (the smallest plugin ceiling is 4 MB). The pass may re-shrink only if a substitute's ceiling is ever lower than the primary's, which no shipped plugin has.
- **Changing what the gallery stores.** Unchanged, as the CLAUDE.md rule requires.
- **Changing the cap's default or range** (4, 1–50) or its UI.
- **The vision-request paths outside the Salon turn** (`lib/llm/vision-request.ts:278`, image description itself). They shrink per image and send one; no budget question arises.

## 4. Known state (verified 2026-11-02)

- Order for one Salon turn: uploads (site 2, from `orchestrator.service.ts:626`) → rehydrated uploads (site 3) → Lantern walk (site 4) → all attachments placed on one anchor message in that order (`:1343-1375`) → `adaptMessagesForProfile` (site 5, `:1381-1390`) → `needsVision` from the final array (`orchestrator.service.ts:1029`; non-vision understudies kept out of the chain by `lib/llm/fallback/engine.ts:160` and `understudy.ts:109`) → per-substitute re-adapt (`provider-failover.service.ts:507, 848`) → `streaming.service.ts:507-517` copies `attachments` onto `LLMMessage`.
- `adaptMessagesForProfile` returns the same array reference when nothing changes; callers rely on that for a cheap identity check.
- `generateImageDescription` (`lib/chat/file-attachment-fallback.ts:408+`) first reuses `generationRevisedPrompt` / `generationPrompt` / `description` via `repos.files.findById(file.id)`. The Lantern walk's comment (`:1253-1254`) says describing a generated image past the cap "is free" for that reason. Vault-stored avatars come back from `loadMountFileAsAttachment` with a mount-link id, which may miss that lookup and cost a real vision call. **Unverified; check in Phase 0.**
- A small gate inconsistency: the legacy load path shrinks whenever `provider` is passed (`:704`), the mount path only when `autoResize && provider` (`:626`).
- `FileAttachment` carries no provenance or timestamp. The pass needs both.

## 5. Design

### 5.1 Provenance on the attachment

`FileAttachment` gains an optional `transport?: { origin: 'upload' | 'rehydrated' | 'lantern'; createdAt: number; describable: boolean }`. Sites 2–4 set it when they build the attachment (`describable` is true when a stored prompt or description exists, so the pass knows which overflow is cheap to describe). Nothing else reads it; it is stripped before persistence, like the other transport-only fields.

### 5.2 The pass

`lib/chat/image-transport-budget.ts`:

```ts
export interface ImageTransportPolicy {
  maxImages: number;           // resolveMaxImagesPerRequest(profile)
  maxTotalBase64: number;      // LLM_TRANSPORT_TOTAL_BASE64 (new; see §8), default 4 MB
  canReceive: (mime) => boolean; // profileCanReceiveAttachment(profile, …)
}
export async function applyImageTransportBudget(messages, policy, deps): Promise<{ messages; report: TransportReport }>
```

Ranking, highest kept first: this turn's uploads newest first; then rehydrated uploads newest first; then Lantern images newest first; anything without `transport` metadata ranks after all of them in array order (so a caller that forgets to tag loses only priority, never correctness). Images the profile cannot receive are described regardless of rank (the capability rule, written once). Then the count cap, then the byte budget, both spent down the ranked list. Overflow is *described* when `describable` or when a describer profile is configured, otherwise *dropped with a note* (`[image omitted: over the request budget]` in place of the attachment, so the model and the LLM-logs reader both see that something was there). Returns the same array reference when nothing changed. `report` lists kept / described / dropped with reasons, logged once at debug and attached to the route trail's telemetry.

### 5.3 Callers

- `context-builder.service.ts`: sites 2 and 3 drop their capability filtering (they only tag). The Lantern walk (site 4) drops `imageSlotsLeft`, the 2 MB budget and its capability call; it collects every candidate in its lookback, tagged `lantern` with the file's timestamp, and lets the pass decide. `adaptMessagesForProfile` at `:1381` becomes `applyImageTransportBudget`.
- `provider-failover.service.ts:507, 848`: same substitution; understudies now get bytes and capability re-applied, not just count.
- `adaptMessagesForProfile` itself becomes the pass (keep the name as an alias for one cycle, or rename and fix the ~6 call sites; recommendation: rename).

### 5.4 What gets smaller

`context-builder.service.ts` loses about 65 lines of cap/budget logic from the walk and two copies of the capability filter; `message-attachment-adapter.ts` loses `findImagesOverCap`'s position-based ordering in favour of the ranked list. The new module is about 150 lines including the report. Net is roughly neutral in lines; the simplification is one policy, one place, applied to every image from every source for every profile tried.

## 6. Tests

- Unit (`image-transport-budget.test.ts`): ranking by origin and age; count cap then bytes; describe vs drop; capability; same-reference on no-op; untagged attachments rank last.
- Replace the cap tests in `message-attachment-adapter.test.ts` and the walk tests in the context-builder suite with calls through the pass; keep the assertions.
- Failover: an understudy whose profile has a lower `maxImagesPerRequest` receives fewer images; one without vision receives descriptions (extend `provider-failover` tests).
- Regression for bug 151: four 500 KB uploads plus six Lantern images under a 4 MB total ends under 4 MB on the wire, with the newest kept.

## 7. Phases

0. **Verify the avatar-description cost** (§4) on V4test with the LLM logs; if it is a real vision call, make `describable` false for mount-link ids until a lookup by link id exists.
1. **Tag and pass, behaviour-preserving.** Add `transport`, build the pass, call it from `:1381` and the two failover sites, but with `maxTotalBase64` covering Lantern only and the walk's own cap left in place. Snapshot test that the kept set is identical to today on the recorded fixtures.
2. **Remove the walk's cap and budget**; extend the byte budget to all sources; rename the adapter. This is the behaviour change, and it is the whole point.

## 8. Decisions needed from the human

1. **The per-request total.** 4 MB base64 (about 3 MB of image) is proposed, as the budget bug 151 implied. The Lantern-only 2 MB constant is retired into it.
2. **Drop-with-note wording** reaches the model. Plain and short; proposed above. Confirm it may say "image omitted".

## 9. As built (2026-11-03)

- **Decisions taken (§8):** the per-request total is **4 MB of base64** (`LLM_TRANSPORT_TOTAL_BASE64`, `lib/files/llm-image-budget.ts`), and `LANTERN_IMAGE_BASE64_BUDGET` is gone. The note is `[image omitted: over the request budget]` (`IMAGE_OMITTED_NOTE`). Both were the proposals here; either is a one-line change.
- **Phase 0, by reading rather than on V4test:** `loadMountFileAsAttachment` (`lib/chat-files-v2.ts`) returns `id: mountLink.id`, and `runGenerateImageDescription` looks the id up in `repos.files` only, so a vault-stored image never finds a persisted prompt and describing it is a real vision call. The LLM-log check on a live instance was not run from this session.
- **`describable`** is the switch for that cost: overflow is described when `describable`, otherwise omitted with the note (as is a describe that fails). Uploads (this turn's and re-hydrated) are always describable — the operator's own picture is worth a describer call, as it was under the old cap. A Lantern image is describable when its `files` row carries `generationRevisedPrompt` / `generationPrompt` / `description` (`hasPersistedImageDescription` in the context builder); a mount-link id never is. So the "or when a describer profile is configured" clause of §5.2 applies to uploads only: spending a vision call on every old vault portrait on every turn was the cost Phase 0 was asked to rule out.
- **Capability is moved for images only.** Sites 2 and 3 still run `processFileAttachmentFallback` for non-image files (a text file is inlined into the message that carried it, which bug 121 depends on); images are tagged and passed whole. The pass still runs the capability fallback for *any* attachment a profile cannot receive, as `adaptMessagesForProfile` did, so a substitute that cannot read a PDF still gets it handled. A consequence: for a non-vision primary, a re-hydrated image's description now sits on the anchor message instead of the message that carried it.
- **The tag lives on the Quilltap side.** `FileAttachment` is in `@quilltap/plugin-types`; rather than bump and publish it, the tag is an extra field on the loaded attachment (`tagForTransport`) and `streamMessage` strips it (`stripTransportTags`) before a plugin or the LLM log sees the message.
- **Rename, no alias.** `lib/chat/message-attachment-adapter.ts` is deleted; `collectAttachmentMimeTypes` moved into the new module with its callers.
- **Not done:** the report is logged (info when anything overflowed, debug always) but not attached to the route trail, which is a persisted column; that would be a schema change for telemetry alone. Phase 1's "kept set identical on recorded fixtures" snapshot was skipped because Phases 1 and 2 landed together; the unit suite pins the new ranking instead.
- **Tests:** `__tests__/unit/lib/chat/image-transport-budget.test.ts` (replaces the adapter suite, keeps its assertions; ranking, count then bytes, describe vs omit, tag stripping, the bug-151 regression), a lower-cap substitute in `provider-failover.service.test.ts`, and the re-hydration hand-back in `context-builder.service.test.ts`.
