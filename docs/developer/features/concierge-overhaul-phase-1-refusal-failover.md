# Concierge Overhaul — Phase 1: Refusal-Driven Failover Everywhere

**Status:** Proposed (4.10-dev, 2026-09-25)
**Scope:** quilltap-server backend, six provider plugins, `@quilltap/plugin-types`. No settings UI change, no per-chat state change, no migration. One new optional field on the message route-trail schema.
**Prerequisites:** none. This spec starts from the code as it stands on 2026-09-25 and is complete on its own.
**Part of:** [concierge-overhaul.md](concierge-overhaul.md) (phase 1 of 5).

## Summary

Make "the provider refused, so ask an uncensored one" a single rule applied at every call site, instead of five different approximations. After this phase:

- A content-moderation refusal is recognised by one function, `classifyRefusal`, from a typed error, a provider error code, a finish reason, a message pattern, or (last) an inference — in that order of trust.
- An uncensored understudy is resolved by one function per kind, `resolveUncensoredTextUnderstudy` / `resolveUncensoredImageUnderstudy`, with one order: the explicitly configured profile, then any `isDangerousCompatible` profile, then nothing. Pre-flight and post-hoc no longer disagree.
- Every image call site — the Salon's `generate_image` tool, the Lantern's story backgrounds, Aurora's avatar job, and the legacy image dialog — runs its provider call through one chokepoint, `generateImageWithConciergeFailover`, which retries once on the understudy and records what happened.
- A text turn that throws a content-policy error (today: silently classified as "not a fallback trigger") is treated the same as an empty body with a moderation finish reason: the uncensored understudy is tried before the profile's own chain.
- Nothing about a refusal is silent. Image-bearing messages carry a route trail; the Concierge posts a bubble when a picture was refused and rerouted, or refused with no understudy to ask; the tool result names the model that actually answered.

The global mode (`OFF` / `DETECT_ONLY` / `AUTO_ROUTE`) and the four per-chat states are **not** changed in this phase. Failover fires under `AUTO_ROUTE` exactly as the existing post-hoc reroutes do; it simply fires reliably and everywhere. Phase 4 retires the mode.

## Goals

- The motivating case works: a Monitored chat under `AUTO_ROUTE`, an image prompt the classifier does not flag, an ordinary image provider that rejects it, and an uncensored image profile that is either configured or merely marked compatible — the picture is produced on the second try, and the chat shows that it was.
- One definition of "refused", one definition of "understudy", one image failover path, across the whole codebase.
- No image plugin's refusal is missed because of its wording.
- No text plugin's streaming path loses the finish reason that says a refusal happened.

## Non-goals

- Changing the global mode or the four per-chat states (phases 3 and 4).
- Counting refusals or auto-switching the chat (phase 2).
- Any settings UI (phase 4) or Salon buttons (phase 5).
- Detecting *soft* refusals: a provider that answers with a sanitized image, a revised prompt, or a polite paragraph. Only signals a provider states, or an empty body on content already flagged, count here.
- Retiring the pre-flight classifier. It keeps running where it runs today.

## Known State (verified 2026-09-25)

### Refusal detection is scattered

- `isImageModerationError` (`lib/services/dangerous-content/provider-routing.service.ts:350-360`) lowercases the message and looks for six substrings: "content moderation", "content_policy", "content policy", "safety system", "rejected by content", "moderation_blocked".
- Of the six image plugins under `plugins/dist/qtap-plugin-*/image-provider.ts`, the substrings match **OpenAI** (DALL-E and gpt-image both happen to say "safety system"; the SDK's `code` of `moderation_blocked` / `content_policy_violation` is *not* in the message), **Grok** ("Generated image rejected by content moderation."), and **Google Imagen**'s own throw at `google/image-provider.ts:250-252`, which was worded to match. They do **not** match Gemini image safety blocks (`google/image-provider.ts:132,158`: `finishReason` and `promptFeedback.blockReason` are never read), NanoGPT's generic 400 (`nanogpt/image-provider.ts:181-197`), OpenRouter's "Model declined to generate an image" (`openrouter/image-provider.ts:163-165,205`), Z.AI's code 1301 errors (`z-ai/image-provider.ts:57`), or Imagen HTTP-level blocks (`google/image-provider.ts:222`).
- Text: `lib/llm/moderation-finish-reason.ts:30-41` lists the finish reasons treated as moderation (`sensitive`, `content_filter`, `content-filter`, `refusal`, `safety`, `prohibited_content`, `blocklist`, `spii`, `image_safety`, `recitation`). `classifyEmptyBody` (`lib/services/chat-message/route-trail.ts:128-160`) turns one into `outcome: 'refused', trigger: 'moderation-refusal'`.
- `classifyFallbackTrigger` (`lib/llm/fallback/engine.ts:99-146`) reads only `error.message`. A thrown "400 … safety system" falls through every pattern to the generic `/\b4\d\d\b/` check at :135 and returns `null`, so `attemptHardErrorFailover` (`provider-failover.service.ts:762-771`) returns `{recovered: false}` and records nothing on the route trail. The `FallbackTrigger` union already contains `'moderation-refusal'` (`lib/llm/fallback/types.ts:24-32`) but nothing thrown ever produces it.
- Text plugins lose finish reasons when streaming: OpenAI's `buildRawResponse` hardcodes `finish_reason: 'tool_calls' | 'stop'` (`plugins/dist/qtap-plugin-openai/provider.ts:254`, used at :577), so `incomplete_details.reason === 'content_filter'` is visible only on the non-streaming path (:268-278); refusal output items (`type: 'refusal'`) are not handled. Grok has the same pattern (:310, :519, `getFinishReason` at :324-335). OpenRouter's streaming raw uses the camelCase key `finishReason` (:688-690, :910-914), which `lib/llm/extract-finish-reason.ts:9-35` does not read. Google reads `candidates[0].finishReason` (:600) but only logs `promptFeedback.blockReason` (:249). Anthropic, DeepSeek, NanoGPT, Z.AI and openai-compatible pass the reason through correctly.

### Understudy resolution has two orders

- Pre-flight: `resolveProviderForDangerousContent` (`provider-routing.service.ts:85-196`) and `resolveImageProviderForDangerousContent` (:208-292) try the explicit id, then scan `isDangerousCompatible` profiles (the text scan orders attachment-capable profiles first, :140-173).
- Post-hoc: `resolveUncensoredImageProfileForReroute` (:388-418) requires the explicit id and refuses to scan (doc comment :382-386). The text empty-response uncensored retry (`provider-failover.service.ts:223-335`) likewise requires `uncensoredTextProfileId`.
- So a user who ticked "Uncensored-compatible" on an image profile but left the Concierge picker on "Auto-detect" gets pre-flight reroutes and **never** a post-hoc one.

### Four image paths, four gates

| Path | Pre-flight scan | Post-hoc reroute | Extra gate |
|---|---|---|---|
| `generate_image` tool (`lib/tools/handlers/image-generation-handler.ts`) | 5b user prompt :797-854, 6b expanded prompt :1071-1119 | :403-405 via `isImageModerationError` | none |
| Lantern (`lib/background-jobs/handlers/story-background.ts`) | none | :694-697 | `isDangerousChat` (bug-133 comment :688-692) |
| Aurora avatar (`lib/background-jobs/handlers/character-avatar.ts`) | :231-288 | :373-445 | none |
| Legacy dialog (`app/api/v1/images/route.ts:198-266`) | :204-244, connection profiles only, resolver called without the chat | none | — |
| Wardrobe preview (`app/api/v1/wardrobe/preview-avatar/route.ts:101-118`) | deliberately none | none | stays out of scope |

The Lantern's candour decision `uncensoredImageTarget = isDangerousChat && hasUncensoredImageProvider` (:217) ignores the mode, so a Flagged chat under `DETECT_ONLY` gets a candid prompt sent to a moderated provider with no reroute possible.

### Nothing tells the user

- All three job paths log the reroute and write an LLM-log line ending "(Concierge reroute)"; none posts anything to the chat. `postLanternImageNotification` (`lib/services/lantern-notifications/writer.ts:88`) has no provider or reroute field.
- The tool result at `image-generation-handler.ts:1270-1277` reports `finalProfile`, which reflects only the pre-flight reroute. After a post-hoc reroute it names the profile that refused.
- `routeTrail` (`lib/schemas/chat.types.ts:198-217`, `MessageEventSchema.routeTrail` :285) is written only by text-chat failover sites; the `RouteTrailBadge` renders wherever a message row carries a non-empty trail (`app/salon/[id]/components/message-row/MessageDesktopAvatar.tsx:36-37`).
- `DangerFlagBadge`'s "Rerouted" chip (`components/chat/DangerFlagBadge.tsx:49-56`) is driven by text `dangerFlags` only.

### Plugin boundary facts that shape the design

- `@quilltap/plugin-types` is at 2.7.1; every plugin depends on `^2.7.0` from npm (no workspace link), and the six image plugins **bundle** plugin-types into their own `index.js` (only `default-system-prompts` and `openai-compatible` list it in esbuild `external`). A class exported from plugin-types is therefore a *different copy* inside each plugin, and `instanceof` in the host will fail. Detection must be by a stable `code` string.
- plugin-types already ships `PluginError` (`code`), `ProviderApiError` (`statusCode`) and friends (`packages/plugin-types/src/common/errors.ts`), which no plugin uses today.

## Design

### 1. One refusal classifier — `lib/services/dangerous-content/refusal.ts`

```ts
export const MODERATION_REJECTION_CODE = 'MODERATION_REJECTED' as const

export type RefusalEvidence =
  | 'typed-error'      // err.code === MODERATION_REJECTION_CODE (plugin said so)
  | 'provider-code'    // a known SDK/provider code on the thrown error
  | 'finish-reason'    // isModerationFinishReason(finishReason)
  | 'message-pattern'  // the legacy substrings, plus a few more
  | 'inferred'         // empty body on content the Concierge had flagged

export interface RefusalVerdict {
  refused: boolean
  evidence?: RefusalEvidence
  /** ≤ 200 chars, never the full error body. */
  detail?: string
}

export function classifyRefusal(input: {
  error?: unknown
  finishReason?: string | null
  emptyBody?: boolean
  contentWasFlagged?: boolean
}): RefusalVerdict
```

Order of checks, first hit wins:

1. `error?.code === MODERATION_REJECTION_CODE` → `typed-error`. Also accept `error?.name === 'ModerationRejectionError'` so an un-bundled plugin copy still qualifies.
2. `error?.code` (or `error?.error?.code`, the OpenAI SDK's nested shape) in `PROVIDER_MODERATION_CODES`: `moderation_blocked`, `content_policy_violation`, `content_filter`, `safety`, `1301` (Z.AI sensitive content) → `provider-code`.
3. `isModerationFinishReason(finishReason)` → `finish-reason`.
4. Lowercased message matches the six legacy substrings **or** "responsible ai", "declined to generate", "blocked by safety", "prompt_blocked", "image_safety" → `message-pattern`. Never a bare "400" or a generic "try a different prompt": those are ambiguous and stay unclassified.
5. `emptyBody && contentWasFlagged` → `inferred`.

`isImageModerationError` becomes a one-line delegate to `classifyRefusal({ error }).refused` and is deleted once no caller remains. `classifyEmptyBody` in `route-trail.ts` delegates its two checks to `classifyRefusal` and keeps its return shape. `classifyFallbackTrigger` gains, as its **first** check, `if (classifyRefusal({ error }).refused) return 'moderation-refusal'`. Nothing else in the engine changes.

Log at `debug` on every classification with the evidence, and at `info` when the verdict is `refused`.

### 2. A typed error plugins can throw — `@quilltap/plugin-types` 2.8.0

Add to `packages/plugin-types/src/common/errors.ts`:

```ts
export class ModerationRejectionError extends ProviderApiError {
  readonly code = 'MODERATION_REJECTED'
  constructor(message: string, statusCode?: number, public readonly providerReason?: string) { … ; this.name = 'ModerationRejectionError' }
}
```

Export it from `src/index.ts` beside the others. Document in `docs/developer/PROVIDER_PLUGIN_DEVELOPMENT.md` that an image or chat provider that can tell a moderation rejection from any other failure **must** throw this (or any error carrying `code: 'MODERATION_REJECTED'`), and that the host detects it by `code`, never by `instanceof`.

**Publish gate.** Bump plugin-types to 2.8.0, then stop and ask the human to `npm publish`. Do not install it into plugins until it is published. The host side (§1, §3, §4, §5) does not depend on the publish: `classifyRefusal` already recognises the code string, so it can land first.

### 3. Plugin changes (after the publish)

Each plugin raises its `@quilltap/plugin-types` range to `^2.8.0`, throws `ModerationRejectionError` where it can recognise a rejection, bumps its patch version in `package.json` **and** `manifest.json`, and is rebuilt with `npm run build:plugins`:

| Plugin | Image side | Text side |
|---|---|---|
| openai | Wrap `client.images.generate` (:311-313): SDK `APIError` with `code` in {`moderation_blocked`, `content_policy_violation`} or message containing "safety system" → throw `ModerationRejectionError(message, status, code)`. | `buildRawResponse` (:254) must carry the real finish reason: `incomplete_details.reason` when the response is incomplete, and `'refusal'` when any output item has `type: 'refusal'`. Non-streaming already does the first (:268-278); add the second there too. |
| google | Imagen: `predictions` empty or filtered (:229-252) → throw typed, `providerReason = filterReason`. Non-2xx whose message contains "Responsible AI" or "safety" (:222) → typed. Gemini image: `finishReason` in {`IMAGE_SAFETY`, `SAFETY`, `PROHIBITED_CONTENT`} or `promptFeedback.blockReason` present with no image parts (:132-160) → typed. | A prompt-level `promptFeedback.blockReason` (:249) sets `finishReason` to the block reason (e.g. `SAFETY`) instead of `STOP`/`null`, on both paths. |
| grok | Wrap the SDK call (:59): message containing "content moderation" or code as for OpenAI → typed. | Same `buildRawResponse` fix as OpenAI (:310, :519). |
| openrouter | `message.refusal`, or text-only content with no images (:163-165, :205) → typed with the summary as `providerReason`. HTTP errors whose body matches the patterns in §1 step 4 → typed. | Streaming raw (:688-690, :910-914) must write `finish_reason` (snake_case) so `extract-finish-reason.ts` can read it. |
| nanogpt | The provider's filtered-prompt 400 is generic (:182-186). If the response body exposes any distinguishing field, map it; otherwise leave as is and document that NanoGPT refusals are only caught when the body text matches §1 step 4. | none |
| z-ai | SDK error with `code === 1301` (or message containing the provider's sensitive-content phrasing) (:57) → typed. | none |

Each plugin's own tests cover the mapping with a recorded provider error body. Provider errors that are *not* moderation must still propagate unchanged: a rate limit or an auth failure must never be classified as a refusal.

### 4. One understudy resolver — `lib/services/dangerous-content/understudy.ts`

```ts
export interface UnderstudyLookup { userId: string; settings: DangerousContentSettings; exclude?: string[] }

export async function resolveUncensoredTextUnderstudy(
  lookup: UnderstudyLookup & { turnAttachmentMimeTypes?: string[] }
): Promise<{ profile: ConnectionProfile; apiKey: string } | null>

export async function resolveUncensoredImageUnderstudy(
  lookup: UnderstudyLookup
): Promise<{ profile: ImageProfile; apiKey: string } | null>
```

One order for both: the explicit id (`uncensoredTextProfileId` / `uncensoredImageProfileId`) if owned by the user, not in `exclude`, and decryptable; else the user's `isDangerousCompatible` profiles not in `exclude` (text: attachment-capable first, as today), first with a usable key; else `null`. Courier-transport connection profiles are skipped. The resolver never looks at `settings.mode`: **the caller decides whether failover is permitted**, the resolver only says who could stand in.

`resolveProviderForDangerousContent` and `resolveImageProviderForDangerousContent` keep their signatures and become thin wrappers: the `mode !== 'AUTO_ROUTE'` early-return stays in the wrapper, then they call the resolver with `exclude: [original.id]`. `resolveUncensoredImageProfileForReroute` is deleted; its two callers move to §5. The empty-response uncensored retry in `provider-failover.service.ts:223-335` calls `resolveUncensoredTextUnderstudy` with `exclude: triedProfileIds` and drops the explicit-id requirement.

### 5. One image failover chokepoint — `lib/services/dangerous-content/image-failover.ts`

```ts
export interface ImageFailoverContext {
  userId: string
  chatId?: string | null          // announcements and the route trail need it; the dialog may have none
  purpose: 'tool' | 'lantern' | 'avatar' | 'dialog'
  settings: DangerousContentSettings   // already resolved WITH the chat where there is one
}

export interface ImageFailoverOutcome<T> {
  result: T
  profile: ImageProfile             // the profile that answered
  apiKey: string
  rerouted: boolean
  trail: RouteAttempt[]             // empty when the primary answered first time
}

export async function generateImageWithConciergeFailover<T>(
  primary: { profile: ImageProfile; apiKey: string },
  attempt: (profile: ImageProfile, apiKey: string) => Promise<T>,
  ctx: ImageFailoverContext,
): Promise<ImageFailoverOutcome<T>>
```

Behaviour, in order:

1. `attempt(primary)`. Success → return `{ rerouted: false, trail: [] }`.
2. On throw, `classifyRefusal({ error })`. Not refused → rethrow untouched (a rate limit is not the Concierge's business).
3. Refused: push a trail entry `{ profileKind: 'image', via: 'primary', outcome: 'refused', trigger: 'moderation-refusal', evidence, detail }`.
4. `settings.mode !== 'AUTO_ROUTE'` → `postConciergeRefusalAnnouncement({ kind: 'refusal-not-permitted' })` when there is a `chatId`, then rethrow the original error with `trail` attached (`error.conciergeTrail`).
5. `resolveUncensoredImageUnderstudy({ ..., exclude: [primary.profile.id] })`. `null` → announce `'refusal-no-understudy'`, rethrow with trail.
6. `attempt(understudy)`. Success → trail entry `{ via: 'concierge', outcome: 'answered' }`, announce `'refusal-rerouted'`, return `{ rerouted: true }`. Failure → trail entry with the understudy's own verdict (refused or failed), rethrow with trail.

The `attempt` closure owns everything profile-specific — `buildImageGenParams` for the new profile, LoRA trigger phrases, the LLM log line — because the four call sites build those differently today. The chokepoint owns detection, resolution, the trail, and the announcement.

**Call sites converted** (each keeps its pre-flight scan exactly as today):

- `image-generation-handler.ts` `generateImagesWithProvider` (:319-503): replace the try/catch reroute at :403-503 with one chokepoint call. The result's `profile` feeds `activeProvider` / `activeModel` **and** the tool's return value (:1270-1277 currently reports `finalProfile`; it must report the answering profile). The TOOL message that carries the images gets the trail (§7).
- `story-background.ts` (:614-770): delete the `isDangerousChat` gate at :695 and the `rerouteAllowed` logic; call the chokepoint. Change `uncensoredImageTarget` (:217) to `isDangerousChat && hasUncensoredImageProvider && dangerSettings.mode === 'AUTO_ROUTE'`, so a candid prompt is never crafted for a route that cannot reroute. The Lantern bubble gets the trail (§7).
- `character-avatar.ts` (:327-445): same replacement. The Aurora bubble gets the trail.
- `app/api/v1/images/route.ts` (:296-306): this route still draws from **connection** profiles. Wrap its `provider.generateImage` in the chokepoint with `purpose: 'dialog'`, resolving settings **with** the chat when `chatId` is supplied (today it resolves without). Because its primary is a connection profile, the understudy lookup for this route uses `resolveUncensoredTextUnderstudy` restricted to profiles whose provider can generate images; if that constraint cannot be expressed cleanly, the route gets detection and the announcement only and the follow-ups section records that it should move to image profiles.

The wardrobe preview route stays out of scope on purpose (an explicit one-shot the user just started).

### 6. Text turns: a thrown refusal reroutes like an empty one

- `classifyFallbackTrigger` returns `'moderation-refusal'` for a thrown refusal (§1).
- Factor the uncensored retry out of `attemptEmptyResponseRecovery` (`provider-failover.service.ts:223-335`) into `attemptUncensoredRetry(opts)` that both the empty-body path and `attemptHardErrorFailover` can call. In `attemptHardErrorFailover`, when the trigger is `'moderation-refusal'`: record the failure on the trail (today nothing is recorded, :762-771), run `attemptUncensoredRetry`, and only if that also fails walk the profile's chain with `dangerous: true`.
- The same-provider retry stays skipped for refusals, as it is for flagged content today.
- Announcements for text: none new. The route-trail badge already shows a rerouted text turn, and the 🚫 placard already shows a failed one. The one text case that gets a bubble is `'refusal-no-understudy'`, because it is the one the user can act on (configure a profile).

### 7. Route trails on image-bearing messages

- `RouteAttemptSchema` (`lib/schemas/chat.types.ts:198-217`) gains `profileKind: z.enum(['connection', 'image']).default('connection')`. The DB JSON shape at `lib/database/repositories/chats-messages.ops.ts:186` and the export schema follow. The parity test between `RouteAttemptSchema.trigger` and `FallbackTrigger` is untouched.
- `postLanternImageNotification` (`lantern-notifications/writer.ts:88`) accepts `routeTrail?: RouteAttempt[] | null` and writes it on the bubble. The tool path writes it on the TOOL message in `lib/services/chat-message/tool-execution.service.ts` beside `attachments` (:203-205); the tool handler returns `trail` in its output for that purpose.
- `RouteTrailBadge` already renders for any row with a non-empty trail. Verify it does so on TOOL rows and staff bubbles (`MessageRow.tsx:243, :289` pass it for the desktop avatar; confirm the mobile layout does too) and extend `lib/chat/route-trail-display.ts` `collapseRouteTrail` to label image profiles by name rather than `provider/model` where `profileKind === 'image'`.
- `lib/chat/transcript-projection.ts:238` projects `routeTrail` already; the SSE `done` field is text-only and unchanged.

### 8. The Concierge speaks — `lib/services/concierge-notifications/writer.ts`

Add `postConciergeRefusalAnnouncement({ chatId, kind, details })` with three kinds, each with in-voice `content` and plain `opaqueContent`, `systemSender: 'concierge'`, `systemKind: 'refusal'` (a new value; `systemKind` is a free string, `chat.types.ts:336`):

| Kind | When | Details |
|---|---|---|
| `refusal-rerouted` | an image was refused and the understudy answered | refusing provider/model, answering profile name, purpose |
| `refusal-no-understudy` | refused, `AUTO_ROUTE`, nobody to ask | refusing provider/model, purpose, and a pointer to Settings |
| `refusal-not-permitted` | refused, mode is `OFF` / `DETECT_ONLY` | refusing provider/model, purpose |

Voice: steampunk/Wodehouse, one or two sentences. Example for `refusal-rerouted`: *"The house's usual painter declined the commission on grounds of propriety; I have taken it across the street to Kestrel Studio, who were happy to oblige. The result is attached above."* `opaqueContent`: *"Image provider X refused this request on content grounds. The Concierge rerouted it to Y."*

No dedupe. A refusal is rare and every one is actionable. `system-message-labels.ts:96-97` maps `concierge` to its existing label; add `refusal` to whatever kind→label table exists there.

## Decisions of record

- **Detect by code, not by class.** Plugins bundle plugin-types; `instanceof` is a trap. `MODERATION_REJECTION_CODE` is the contract, the class is a convenience.
- **A single reroute is not a promotion.** The Lantern's comment (story-background.ts:688-692) argued that letting a provider's refusal trigger a franker prompt lets the provider "promote" the chat. That concern belongs to the *chat switch* (phase 2 counts refusals before switching), not to the retry, which resends the same prompt to a provider that will take it. The gate goes.
- **Failover still obeys `AUTO_ROUTE` in this phase.** `DETECT_ONLY` means "flag, don't reroute" and users chose it. The announcement `refusal-not-permitted` tells them what they are missing. Phase 4 removes the mode.
- **The resolver is not the policy.** `resolveUncensored*Understudy` never reads `mode` or chat state. Every caller states its own gate, in code, where a reader can see it.
- **Soft refusals are out of scope.** A sanitized image with a `revisedPrompt` is a success to every provider and to us. Phase 5's "Try uncensored" button is the honest remedy.
- **The legacy dialog gets detection first, correctness second.** It is a connection-profile path that predates image profiles; it is not worth a redesign in this phase.

## Implementation order

1. `refusal.ts`, `understudy.ts`, `image-failover.ts` with unit tests (no callers yet). `classifyFallbackTrigger` and `classifyEmptyBody` delegate.
2. Convert the four image call sites; route-trail schema field; Lantern writer trail field; tool-execution trail write; announcement writer.
3. Text: `attemptUncensoredRetry` factored; hard-error path handles `moderation-refusal`; empty-body retry uses the resolver.
4. plugin-types 2.8.0 → **stop for `npm publish`**.
5. Plugin changes (§3), each with its own patch bump and tests; `npm run build:plugins`.
6. Docs and housekeeping (below).

Steps 1–3 ship value before step 4: the host recognises OpenAI, Grok and Imagen by code and message today.

## Testing

- **`refusal.test.ts`**: a table of recorded provider errors (OpenAI `APIError` with each code; Google Imagen filter, Gemini `IMAGE_SAFETY`, Responsible AI HTTP message; Grok; OpenRouter refusal; Z.AI 1301; NanoGPT generic 400 → **not** refused; a 429 → not refused; a network error whose message contains "safety" only as a path segment → not refused). Evidence precedence: a typed error with a misleading message is `typed-error`.
- **`understudy.test.ts`**: explicit id beats scan; excluded ids skipped; courier skipped; attachment-capable ordering; `null` when nothing qualifies; never reads `mode`.
- **`image-failover.test.ts`**: primary answers → no trail, no announcement; refused + `DETECT_ONLY` → `refusal-not-permitted`, rethrow with trail; refused + no understudy → `refusal-no-understudy`; refused + understudy answers → `rerouted: true`, two-entry trail, `refusal-rerouted`; refused + understudy refuses → rethrow, three-entry trail; a non-refusal error → rethrown untouched, nothing posted.
- **Regression, the bikini case** (integration-style, mocked providers): Monitored chat, `AUTO_ROUTE`, classifier returns not-dangerous, primary image profile throws a Gemini `IMAGE_SAFETY` rejection, one image profile marked `isDangerousCompatible` with no explicit pick → the tool result names the understudy's model, the TOOL message carries a two-entry trail, one `refusal-rerouted` bubble exists.
- **Lantern**: Flagged chat under `DETECT_ONLY` with an uncensored image profile configured → concealed prompt, no reroute, `refusal-not-permitted` on rejection. Monitored chat under `AUTO_ROUTE` → reroute allowed (the old `isDangerousChat` gate is gone).
- **Text**: a thrown OpenAI `content_policy_violation` → `classifyFallbackTrigger` returns `'moderation-refusal'`; `attemptHardErrorFailover` records the trail entry, tries the understudy, and only then the chain. Existing suites in `__tests__/unit/lib/services/chat-message/` and `__tests__/unit/lib/llm/fallback/` extended, not replaced.
- **Plugins**: each plugin's tests assert the typed throw for its recorded rejection body and an unchanged throw for a non-moderation error. The three streaming finish-reason fixes get a streamed fixture ending in `content_filter` / `refusal` / `SAFETY` and assert `extractFinishReason(raw)` sees it.
- `scripts/concierge-four-state-test.sh` gains a live check that a refused picture on a Monitored chat is rerouted.

## Documentation and housekeeping

- `docs/CHANGELOG.md` (plain voice): what is detected, where failover now happens, the announcement kinds, the plugin-types bump, each plugin bump.
- `help/dangerous-content.md`: rewrite "Provider refusals and the 🚫 placard" and the image sections to describe the one rule; add the three Concierge bubbles; note that an image profile only needs the "Uncensored-compatible" tick to be a candidate.
- `help/story-backgrounds.md:59-61` and `help/image-generation-profiles.md:469`: the Lantern now reroutes on refusal in any state under Auto-Route.
- `docs/developer/PROVIDER_PLUGIN_DEVELOPMENT.md`: the `ModerationRejectionError` contract.
- `docs/developer/features/complete/message-route-trail.md`: `profileKind` and the image writers.
- `docs/developer/DDL.md`: the `routeTrail` column comment gains `profileKind`; `public/schemas/qtap-export.schema.json`: the `RouteAttempt` definition.
- `.claude/commands/update-documentation.md`: catalog rows for this spec and the overview.
- `CLAUDE.md` chokepoints: add one bullet — *An image call that a provider might refuse goes through `generateImageWithConciergeFailover`; refusal is `classifyRefusal`; understudies come from `understudy.ts`. Never string-match a provider error at a call site.*

## Follow-ups (out of scope)

- Move `app/api/v1/images/route.ts` onto image profiles, or retire it in favour of `/image-profiles/[id]?action=generate`.
- NanoGPT: ask the provider for a distinguishing field on filtered prompts.
- OpenAI can return a success with neither `b64_json` nor `url` (`openai/image-provider.ts:323`); guard it as a provider error, separately from this work.
