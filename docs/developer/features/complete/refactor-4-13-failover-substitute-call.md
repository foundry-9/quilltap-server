# Refactor 4.13 — One substitute call in provider failover

**Status:** Implemented (2026-11-11). Proposed 2026-11-10, written against `HEAD` = 167d06503. Part of the [4.13 refactor set](../refactor-4-13.md). Fixes #181 and #182 by construction and closes three further defects traced in the audit (§4.2).

Line numbers are from the audit and will drift. Re-locate each site by name before editing.

## 1. The problem

`lib/services/chat-message/provider-failover.service.ts` (1,143 lines) calls a stand-in profile from three places: the same-provider retry (about `:250-273`), the Concierge's uncensored retry (`:508-558`) and the fallback chain walk (`:848-901`). Each site resets the streaming buffers, calls `restreamInto`, and decides for itself whether the stand-in answered. All three thread one bag of values that was built for the **primary** profile: `formattedMessages`, `modelParams`, `actualTools`, `useNativeWebSearch` and the rest.

That bag is the defect. A substitute is a different profile, often on a different provider, and four things in the bag are only correct for the profile they were built for:

| Value | Built for | What goes wrong on a substitute |
|---|---|---|
| `actualTools` | the primary's provider, by `buildToolsForProvider(connectionProfile.provider)` (`streaming.service.ts:382`, reached from `turn-tools.service.ts:144-168`) | #181: a provider in another tool-shape family throws or returns 400; the chain exhausts |
| "did it answer" | n/a | #182: decided by `state.fullResponse.trim().length` alone at all three sites, so a tool-call-only answer is recorded as `empty-response` |
| the budgeted message array | the substitute, but held in a local | the tool loops afterwards read the slate's primary-budgeted array (§4.2, A15) |
| `controller.enqueue` | n/a | `restreamInto` writes content with a raw `controller.enqueue` (about `:698`) while its status frame uses `safeEnqueue`; a client disconnect is caught as a provider failure (§4.2, A16) |

CLAUDE.md already says "provider fallback is the engine's to build, not a call site's" and that image transport is decided "for the profile about to be called". The chain is built by the engine; the call is not.

## 2. Goal

One function, `callSubstitute(candidate, turn)`, owns everything that depends on which profile is being called. The three sites become callers that differ only in how they pick the candidate and how they record the attempt.

## 3. Non-goals

- `lib/llm/fallback` (the engine: `classifyFallbackTrigger`, `buildFallbackChain`, `recordAttempt`, `summarizeFallbackAttempts`). Its rules do not change.
- The Concierge's decisions (`mayFailOver`, `shouldUseUncensoredRoute`, the refusal ledger). Only how the retry is called changes.
- The primary call path in `streaming.service.ts`, except that the universal tool list must stay available to failover (§5.1).
- Text-block (pseudo-tool) mode semantics. A substitute whose resolved tool mode differs from the primary's is handled in §5.1, not redesigned.

## 4. Known state

### 4.1 Verified by reading (2026-11-10)

- `restreamInto` (`provider-failover.service.ts`, about `:668-700`) passes `opts.actualTools` unchanged to `streamMessage` for `opts.connectionProfile`.
- `streamMessage` hands `tools` straight to `provider.streamMessage` (`streaming.service.ts:595-607`); no layer re-formats.
- `turn-tools.service.ts:144-168` builds once for `profile` and sets `actualTools = useTextBlockTools ? [] : built.tools`.
- The chain's empty check is `state.fullResponse.trim().length === 0` (about `:886`).

### 4.2 Traced by the audit, not independently re-verified

Treat each as a hypothesis to confirm with a failing test before fixing.

- **A15.** After a swap, `runNativeToolLoop` / `runTurnTextToolPasses` use `slate.actualTools` and the primary's un-rebudgeted message array on the swapped profile (`orchestrator.service.ts` about `:1084-1108`, `native-tool-loop.service.ts:127`, `text-tool-loop.service.ts:393`). With images in the turn and a substitute that has a lower image cap or no vision, iteration 2 can carry bytes the substitute's budget would have dropped.
- **A16.** A closed SSE controller during a failover stream throws from the raw `controller.enqueue` and is caught as a provider failure at the three sites; in the same-provider retry a one-chunk message can be finalised as complete.
- **A3.** `makePreservePartialOnError` (`primary-stream.service.ts:94`) returns early unless `streaming.hasStartedStreaming`. The native tool loop's continuations never set that flag, and the preserver is created before `toolMessages` exists and saves `[]` for tool messages. So when the first response was a silent tool call, a stall in the continuation loses the prose already shown and leaves no TOOL rows for tools that took effect. The gate and the `[]` arguments are verified; the continuation flag is the audit's trace.

## 5. Design

### 5.1 The turn keeps the universal tool list

`buildTools` returns provider-formatted tools. Split it (or add a second return) so the turn slate holds:

- `universalTools`: the provider-neutral definitions and the options they were built from, and
- `formatToolsFor(profile)`: formats for one profile and resolves that profile's tool mode (`checkResolvedToolMode`), returning `{ tools, useTextBlockTools, toolInstructions }`.

The primary path calls `formatToolsFor(primary)` and behaves as today. If `buildToolsForProvider` cannot cheaply format from an already-built universal list, call it again per candidate with the same options; correctness first, and there are at most two substitutes per turn.

A substitute whose tool mode differs from the primary's (native vs text-block) needs the text-block instructions in its system prompt, which `formattedMessages` was built without. Decision for the human in §8; the conservative rule is to skip a candidate whose resolved tool mode differs and record the attempt as such, so nothing silently changes shape mid-turn.

### 5.2 `callSubstitute`

```ts
interface SubstituteResult {
  answered: boolean            // prose OR tool calls
  outcome: 'answered' | 'empty' | 'error' | 'client-gone'
  error?: unknown
}
async function callSubstitute(candidate: SubstituteCandidate, turn: FailoverTurn): Promise<SubstituteResult>
```

It, and only it:

1. resets the streaming buffers for a swap (`resetStreamingBuffersForSwap`);
2. formats tools for `candidate.profile` (§5.1);
3. runs `applyImageTransportBudget` on the final message array for `candidate.profile`;
4. resolves model params for `candidate.profile`;
5. streams through `restreamInto`, which uses `safeEnqueue` for every frame and reports a closed controller as `client-gone` rather than throwing;
6. decides `answered` with one predicate: non-empty `fullResponse`, or `detectToolCallsInResponse(state.rawResponse, provider).length > 0`;
7. on `answered`, writes `effectiveProfile`, `effectiveTools`, `effectiveToolMode` and `effectiveMessages` onto `StreamingState`.

`client-gone` stops the walk: no further candidates are called, nothing is recorded as a provider failure.

### 5.3 The tool loops read the effective values

`runNativeToolLoop` and `runTurnTextToolPasses` take tools and the base message array from `StreamingState`'s effective fields, falling back to the slate when no swap happened. Each continuation runs the image budget for the effective profile (or reuses the already-budgeted `effectiveMessages` as its base).

### 5.4 Partial preservation

`preservePartialOnError` gates on `streaming.fullResponse.length > 0` alone, and receives the live `toolMessages` and `generatedImagePaths` through a getter so a continuation failure saves the TOOL rows of tools that ran. Confirm A3 with a test first.

## 6. Phases

1. **Tests that fail today.** A failover test with a real tool array, primary `ANTHROPIC` and understudy `OPENAI`: assert the understudy's `streamMessage` receives OpenAI-shaped tools (#181). An understudy stream with a tool call and no content is accepted (#182). Add the A15, A16 and A3 tests; if one passes on `HEAD`, drop that item and say so in the spec.
2. **`formatToolsFor`** on the slate; the primary path uses it; no behaviour change.
3. **`callSubstitute`**; move the three sites onto it one at a time, keeping each site's attempt recording.
4. **Effective values in the tool loops**; partial preservation.
5. **Live check on V4test** (never Friday): force a primary failure with a cross-provider understudy and tools on; then a Concierge reroute of a refused turn to an OpenAI-compatible uncensored profile.

## 7. Tests and gates

- The three existing failover suites pin behaviour but pass `actualTools: []`; give them real arrays.
- `npx tsc`, `npm run test:unit`, `npm run lint`.
- Expected size: 150–250 lines removed from the failover service; medium risk, because this is the turn path.
- CHANGELOG entries cite `#181` and `#182`. No help-doc change unless §8's decision changes what a user sees.

## 8. Decisions for the human

1. A substitute whose tool mode differs from the primary's: skip it (proposed), or rebuild the system prompt for it?
2. When the client has gone away mid-substitute: stop the walk and save the partial (proposed), or let the substitute finish server-side as an ordinary turn would?

## 9. Outcome (2026-11-11)

**Decisions taken.** Both §8 proposals: (1) a substitute whose resolved tool mode differs from the turn's is skipped and recorded on the route trail as `failed` / `provider-error`; (2) when the client goes away mid-substitute the walk stops, nothing is recorded against the substitute, and whatever arrived stays in the buffers for the partial preserver.

**Phase 1.** Every item reproduced: the new tests fail on the pre-refactor code and pass after. None was struck.

- #181, #182: `__tests__/unit/lib/services/chat-message/failover-substitute-call.test.ts` (chain, uncensored reroute, same-profile retry).
- A15: `native-tool-loop.service.test.ts` ("after a failover swap").
- A16: `failover-substitute-call.test.ts` (a closed controller).
- A3: `primary-stream.service.test.ts` (the two `A3:` cases). The continuation flag was confirmed by reading: `runNativeToolLoop`'s continuation never sets `hasStartedStreaming`.

**What landed.**

- `TurnToolSlate.formatToolsFor(profile)` (`turn-tools.service.ts`). The primary returns its own format; any other profile calls `buildTools` again with the turn's options (the fallback §5.1 allowed — there is no cheap reformat from a provider-shaped list), resolves its tool mode, and keeps only the tool names the primary was offered, since the executor's permit is the primary's. `TurnToolSlate` now extends `ProfileToolFormat` (`types.ts`).
- `callSubstitute(candidate, turn)` with `SubstituteResult.outcome` of `answered | empty | error | skipped | client-gone` (`skipped` is the §8.1 case). `responseAnswered` is the one predicate. On an answer it sets `effectiveProfile`, `effectiveApiKey` and `effectiveCall` — the four separate `effective*` fields of §5.2 became one `EffectiveCall` object (messages, tools, tool mode, native web search, params, stop sequences); the tool mode is always the turn's, since mismatches are skipped.
- `restreamInto` is private, writes every frame through `safeEnqueue`, and returns `{ clientGone }`.
- The tool loops read `streaming.effectiveCall` first (`effectiveToolLoopCall`, `native-tool-loop.service.ts`; `runTurnTextToolPasses` uses it too).
- `EmptyResponseRecoveryFlags.recovered`: the orchestrator runs the tool loops again after a recovery that answered, which is what executes a tool-only answer from the empty path (the loops had already run for the primary).
- `makePreservePartialOnError` gates on prose alone and takes `getToolArtifacts`.

**Size.** The failover service did not shrink: it is about 180 lines longer, most of it the new call's contract and comments. The three sites lost their own buffer resets, budget calls and try/catch blocks; the substance moved into `callSubstitute` rather than disappearing.

**Not done here.** Phase 5's live check on V4test needs a running instance with two providers' keys; it is left for the release checklist.

