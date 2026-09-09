# Bug 133 — a moderated chat's story background escalates to the uncensored provider, and the escalation is *caused* by the chat being moderated

| | |
|---|---|
| **Status** | FIXED in v4 (2026-09-09) |
| **Found** | 2026-09-09 |
| **Fixed** | 2026-09-09 |
| **Severity** | Medium-High (nothing is lost or corrupted, but the Concierge's central promise — that a chat left moderated stays moderated — is broken silently, in the one place the user never asked for an image at all, and the result is explicit imagery appearing unbidden in a conversation the classifier had cleared) |
| **Who it bites** | Anyone running the Concierge in `AUTO_ROUTE` with an uncensored image profile configured *and* story backgrounds enabled. The chat need not be flagged; being **un**flagged is what triggers the worst of it |
| **Provenance** | Reported 2026-09-09 against the live Friday instance, chat `3487c488` ("The Wrong Wall") — `conciergeOverride: null`, `isDangerousChat: 0` — whose Lantern backdrop came back fully nude. Traced through job `141a0df6` in `embedded-server.log` and the four `IMAGE_*` rows in `llm-logs` |
| **Defect site** | Two independent sites, either of which alone is survivable. (1) `sanitizeAppearancesIfNeeded` (`lib/image-gen/appearance-resolution.ts`) took `hasUncensoredImageProvider` — *is one configured* — and skipped sanitization on it, in a step whose comment claims the text "will be routed there". (2) `handleStoryBackgroundGeneration` (`lib/background-jobs/handlers/story-background.ts`) gated its post-hoc moderation reroute on `dangerSettings.mode === 'AUTO_ROUTE'` alone, never consulting `shouldUseUncensoredRoute(chat)`, and then re-crafted the prompt candidly *because* `!uncensoredImageTarget` |
| **Fix site** | The sanitizer's fourth parameter is now `routesDangerousToUncensored` — whether *this scene* is actually bound for the uncensored provider — supplied as `uncensoredImageTarget` by story backgrounds and as `mode === 'AUTO_ROUTE' && uncensoredImageProfileId` by the image-generation tool. The story-background reroute is gated on `isDangerousChat`, which makes the candid re-craft unreachable; it is deleted |
| **v5 status** | Not investigated. **The shape applies** wherever a port asks "is a more permissive route configured" in place of "is this request taking it", and anywhere a provider's refusal is allowed to select the retry's content policy |
| **Index** | [../bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-09-09).** Sanitization now asks whether the scene is going
to the uncensored provider rather than whether one exists, and the
story-background moderation reroute is available only to a chat already flagged
dangerous. A moderated chat whose backdrop the provider refuses now fails the
job instead of being promoted.

## Symptom

A conversation the Concierge had cleared — never flagged, no manual override —
was given a Lantern story background depicting a character fully nude. The user
expected the "artful hiding" concealment prompting that a moderated chat is
supposed to get, and saw instead an image that had plainly gone out through the
uncensored image provider.

Nothing in the UI reported the change. The chat's Concierge state was
untouched, so it was still styled and still routed as moderated for every
*other* purpose; only the picture had defected.

## Root cause

Three things in series. The third is the defect; the first two are what got it
into range, and the first is a defect in its own right.

**1. Appearance sanitization stepped aside.** `sanitizeAppearancesIfNeeded`
classified Amy's resolved appearance as dangerous, then returned it unchanged
at step 4:

```ts
// 4. Dangerous but uncensored provider available → will be routed there
if (hasUncensoredImageProvider) {
  return appearances
}
```

The comment states the assumption the parameter cannot support. "An uncensored
profile is configured" and "this scene is going to it" are different questions,
and they only coincide for the *other* caller. The image-generation tool
classifies each prompt and reroutes on the spot under `AUTO_ROUTE`, so for it
the two really do line up. Story backgrounds never route up front at all — a
moderated chat's backdrop goes to the moderated profile whatever the
classification says. So the crafter received, verbatim:

```
Amy: … Wearing: naked, barefoot, wearing pearls and wedding ring
```

**2. The crafter named the nudity anyway.** The cinematic-concealment block
*was* in that first system prompt (`buildStoryBackgroundPrompt(false)`,
confirmed against the stored request). `deepseek-v4-flash` still wrote "rises
barefoot from her desk, **wearing only pearls and a wedding ring**" — a nudity
description wearing a clothing list's clothes. `gpt-image-2` refused it:

```
400 … safety_violations=[sexual]
```

This link is prompt quality, not control flow, and is **not** fixed here. See
"Still open" below.

**3. The refusal promoted the chat.** The post-hoc reroute was gated only on
the global mode:

```ts
const reroute = isImageModerationError(error)
  ? await resolveUncensoredImageProfileForReroute(imageProfile.id, dangerSettings, job.userId)
  : null;
```

`shouldUseUncensoredRoute(chat)` was computed 470 lines earlier and never
consulted. Worse, the re-craft that followed read `!uncensoredImageTarget` as
*"this prompt was needlessly draped, let us be candid"* — so the moderated chat
received the **strongest** escalation available, precisely because it was
moderated:

| | prompt |
|---|---|
| 1st (concealment guidance present) | "…rises barefoot from her desk, wearing only pearls and a wedding ring…" → rejected |
| 2nd (concealment guidance stripped) | "…visibly pregnant, **completely nude** except for pearls and a wedding ring…" → generated |

That is a ratchet pointing the wrong way. A moderation refusal is evidence the
scene was *too* frank; the handler treated it as evidence the prompt had been
too shy.

## Why it survived

Every piece was written to be permissive in the case it was thinking about, and
no piece was thinking about this one.

- Step 4's parameter was correct for the caller it was written against. The
  second caller arrived later and passed the same expression, which typechecks
  and reads right.
- The reroute is genuinely wanted for a flagged chat, and a flagged chat is
  what everyone had in mind when reviewing it — `resolveUncensoredImageProfileForReroute`
  even documents itself as "keyed on the user's explicit uncensored choice",
  meaning the *profile* choice, not the chat's posture.
- `story-background-uncensored-target.test.ts` locked the escalation in as
  intended behaviour: *"re-crafts the prompt candidly before resending to the
  uncensored provider"*, asserting `craftTargetFlag(0) === false` and
  `craftTargetFlag(1) === true` — the bug, written down as a passing test.
- Nothing logs the chat's danger posture at the reroute, so the log line reads
  as a clean, deliberate fallback.

The escalation also only fires when the moderated provider *refuses*, which
needs link 2 to misbehave first — so it is invisible until a scene is spicy
enough to trip OpenAI and not so spicy that the user had already flagged the
chat. A narrow band, and squarely the band where the surprise costs most.

## The fix

**Link 1 — `lib/image-gen/appearance-resolution.ts`.** The fourth parameter
becomes `routesDangerousToUncensored` and means what steps 2 and 4 always
needed it to mean. Callers now answer the question they can actually answer:

- `story-background.ts` passes `uncensoredImageTarget`
  (`isDangerousChat && hasUncensoredImageProvider`).
- `image-generation-handler.ts` passes
  `mode === 'AUTO_ROUTE' && Boolean(uncensoredImageProfileId)`, matching the
  condition its own two reroute sites test. Under `DETECT_ONLY` it now
  sanitizes, which is correct — nothing routes under `DETECT_ONLY`.

**Link 3 — `lib/background-jobs/handlers/story-background.ts`.** The reroute is
gated on the chat:

```ts
const rerouteAllowed = moderationRejection && isDangerousChat;
```

Since `resolveUncensoredImageProfileForReroute` already requires a configured
uncensored profile, any reroute now implies `uncensoredImageTarget`, which
means the rejected prompt was crafted candidly to begin with. The candid
re-craft block is therefore unreachable and is **deleted** (~50 lines); the
prompt is resent as-is. `isDangerousChat` and `rerouteAllowed` join the
failure log so the gate is visible in a transcript.

A moderated chat whose backdrop is refused now fails the job. That is the
intended outcome: no background is better than one the conversation did not
ask for and the user did not sanction.

## Still open

Link 2 is untouched. The concealment guidance in `buildStoryBackgroundPrompt`
is permissive enough that a cheap model will satisfy it by *naming* the
undressed state, and a moderated chat with genuinely intimate content will now
simply get no backdrop rather than a modest one. Tightening that — per-character
concealment rewriting, so an undressed state forces a rewrite rather than a
rephrase — is tracked separately and is the natural follow-up.

## How to verify

Automated, in `__tests__/unit/lib/background-jobs/handlers/story-background-uncensored-target.test.ts`:

- *"asks the sanitizer about routing, not about mere configuration"* — an
  uncensored profile configured, chat moderated; asserts the sanitizer's fourth
  argument is `false`.
- *"does not reroute a moderated chat, failing the job instead"* — moderation
  rejection on a moderated chat; asserts the job throws and
  `resolveUncensoredImageProfileForReroute` is never called.
- *"resends the already-candid prompt for a flagged chat, without re-crafting"* —
  asserts one craft call, `uncensoredImageTarget: true`, and the same prompt
  reaching the reroute target.

Both new tests were confirmed to fail against the pre-fix handler, one per link.

By hand, against a live instance with the Concierge in `AUTO_ROUTE` and an
uncensored image profile set: take an unflagged chat into an intimate scene and
let a story background fire. Expect either a modest image or, on a refusal,
none at all — and in `combined.log`, no
`rerouting through Concierge uncensored profile` line without a matching
`isDangerousChat: true`.
