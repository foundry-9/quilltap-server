# The Concierge Overhaul — Overview and Phase Index

**Status:** In progress (4.10-dev, 2026-09-25) — phases 1–3 implemented; 4–5 proposed
**Scope:** quilltap-server. Text turns, every cheap-LLM task, every image call site, the per-chat Concierge control, the global Concierge settings, a new Settings tab. Touches `@quilltap/plugin-types` and every provider plugin (publish gates called out per phase). No shell impact.
**Supersedes, when complete:** [concierge-four-state.md](complete/concierge-four-state.md), [concierge-list-marks.md](complete/concierge-list-marks.md), [concierge-default-at-creation.md](complete/concierge-default-at-creation.md), and the routing half of [dangerous.md](complete/dangerous.md). The display half of `dangerous.md` (badges, blur, collapse) survives unchanged.

## Why

The Concierge was built around a pre-flight classifier: a cheap LLM (or the OpenAI moderation endpoint) reads a message or an image prompt and *guesses* whether the ordinary provider will refuse it. The thing the user actually wants — *when a provider refuses, ask an uncensored one* — exists only as an afterthought, bolted on in five different shapes:

| Call site | Refusal detected by | Understudy resolved by | Gated on |
|---|---|---|---|
| Text turn, empty body | finish reason, or "content was flagged" | explicit `uncensoredTextProfileId` only | `mode === 'AUTO_ROUTE'` |
| Text turn, thrown 400 | nothing (`classifyFallbackTrigger` returns `null`) | — | — |
| `generate_image` tool | six substrings in the error message | explicit `uncensoredImageProfileId` only | `AUTO_ROUTE` |
| The Lantern | same six substrings | explicit id only | `AUTO_ROUTE` **and** chat already Flagged |
| Aurora avatar | same six substrings | explicit id only | `AUTO_ROUTE` |
| Legacy image dialog | — | — | — |

The worked failure that motivates this overhaul: a head-and-shoulders portrait of a character in a bikini. The classifier does not flag it, the ordinary image provider rejects it, the rejection text does not match the six substrings (or no explicit uncensored image profile is set, or the chat is not yet Flagged), the tool returns an error to the model, and the model shrugs. Nothing in the Salon says the Concierge looked at it.

## The target model

Three things, in the user's words, and each phase below delivers part of it:

1. **Ready to reroute ad hoc.** Everything the Concierge sends fails over to an uncensored second try when the first one refuses on content grounds. Text turns, cheap-LLM tasks, every image path.
2. **Ready to flip the whole chat.** After a small number of refusals that are clearly moderation, the Concierge switches the chat — all text and all images — to the uncensored desk, and says so.
3. **Manually thrown to Moderated or Unmoderated.** *Moderated* is (1) again: ordinary providers first, uncensored on refusal. *Unmoderated* means do not even try the moderated providers. A third position, *Locked*, keeps today's Vouched Safe for the chat that must never reach an uncensored model.

```
                 ┌─────────────────────────────────────────────────────────┐
                 │  attempt(primary)                                       │
                 │    │                                                    │
                 │    ├─ answered ───────────────────────────────▶ done    │
                 │    └─ refused on moderation grounds (typed signal)      │
                 │         ├─ chat Locked ───▶ surface the refusal, stop   │
                 │         └─ else ─▶ attempt(uncensored understudy)       │
                 │                     record the refusal on the chat      │
                 │                     N refusals ─▶ chat → Unmoderated    │
                 └─────────────────────────────────────────────────────────┘

   State      Text + cheap LLM        Images                 Failover   Auto-switch
   Moderated  ordinary first          ordinary first         yes        after N refusals
   Unmoderated uncensored only,       uncensored only,       n/a        n/a
              candid prompts          candid prompts
   Locked     ordinary only           ordinary only          never      never
```

Provenance (the Concierge switched it, or you did) becomes a note on the badge rather than a separate state. The classifier survives as an optional pre-screen, off by default, for users who would rather not send flagged content to a moderated provider at all.

## Phases

Each phase is a self-contained spec: it restates the code it starts from (verified 2026-09-25), can be handed to a fresh session on its own, and ships value alone. Later phases assume the earlier ones landed and say so in their **Prerequisites** line.

| Phase | Spec | Delivers | Publish gate |
|---|---|---|---|
| 1 | [concierge-overhaul-phase-1-refusal-failover.md](concierge-overhaul-phase-1-refusal-failover.md) | One refusal classifier, one understudy resolver, one image failover chokepoint used by all four image paths, text refusals on thrown errors, image route trails, a Concierge bubble on every image refusal. **Fixes the bikini case.** | `@quilltap/plugin-types` minor + every image plugin patch (host side works before the publish) |
| 2 | [concierge-overhaul-phase-2-refusal-ledger.md](concierge-overhaul-phase-2-refusal-ledger.md) | A per-chat refusal ledger and the auto-switch after N refusals. **Implemented.** | none |
| 3 | [concierge-overhaul-phase-3-three-states.md](concierge-overhaul-phase-3-three-states.md) | Moderated / Unmoderated / Locked with provenance; the four-state control, wire values, list marks, quick-hide and export all migrate. **Implemented.** Two leftovers (drop `conciergeOverride`; remove the orphaned `-info` tone) are carried into phase 4. | none |
| 4 | [concierge-overhaul-phase-4-concierge-tab.md](concierge-overhaul-phase-4-concierge-tab.md) | The Concierge's own Settings tab; every scattered Concierge control moves there; the global mode is retired; the classifier becomes an opt-in pre-screen; help rewritten. Also carries phase 3's two leftovers. | `@quilltap/theme-storybook` patch, only for the `-info` CSS removal |
| 5 | [concierge-overhaul-phase-5-salon-polish.md](concierge-overhaul-phase-5-salon-polish.md) | "Try uncensored" on refused turns and pictures, "Not Dangerous" actually clears blur, the Lantern's refusals appear in the chat, badge noise on Unmoderated chats stops. | none |

Phase 1 alone answers the complaint. Phases 2 and 3 make the Concierge's judgement follow refusals instead of guesses. Phase 4 is the UI consolidation the user asked for. Phase 5 is polish that any of the earlier phases makes possible.

## Standing rules that every phase inherits

- **Derive state, never read columns.** `getConciergeState` and the purpose-named predicates in `lib/services/dangerous-content/chat-override.ts` remain the only readers of the stored pair; `applyConciergeFlip` (`manual-flip.ts`) remains the only transition. Phase 3 changes what they return, not who may call them.
- **Fallback is the engine's.** Text understudies come from `lib/llm/fallback` (`buildFallbackChain` with `dangerous: true`), never a hand-rolled chain. Phase 1 adds the image equivalent as one module and every image call site uses it.
- **No wire value or stored value is ever reused with a new meaning.** Phase 3 introduces new values; it does not repurpose `'flagged'` or `'OFF'`.
- **`docs/CHANGELOG.md`, `help/*.md`, `docs/developer/DDL.md`, `public/schemas/qtap-export.schema.json`, and `.claude/commands/update-documentation.md`** are updated by the phase that changes what they describe.
- **Plugins and packages**: a plugin change bumps its patch version and runs `npm run build:plugins`; a `packages/` change bumps the version and **stops for a manual `npm publish`** before anything installs it.
