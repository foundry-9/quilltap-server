/**
 * @jest-environment node
 *
 * Calliope on the server (Calliope Live, Spec J, Stage 2): proposals judged
 * for a draft and stored on her conversation, the contrast check, her tool
 * slate and permit, her prompt, and her chat type's answers.
 */

import { assessProposal, draftRevisionOf, renderProposalAssessment, type ProposalDraftSource } from '@/lib/themes/assist/proposal'
import { assistDraftFrom, checkDraftContrast, renderContrastCheck } from '@/lib/themes/assist/render'
import { readStoredProposal, storedProposals, viewProposal } from '@/lib/calliope/proposals'
import { buildCalliopeSystemPrompt } from '@/lib/calliope/system-prompt-builder'
import { buildToolsForProvider } from '@/lib/tools/plugin-tool-builder'
import { THEME_ASSIST_TOOL_DEFINITIONS, THEME_ASSIST_TOOL_NAMES } from '@/lib/tools/theme-assist-tools'
import { offeredTools, resolveToolPermit } from '@/lib/tools/effects'
import {
  ChatMetadataBaseSchema,
  isHelpLikeChatType,
  isListedInGlobalSearch,
  isModerationExemptChatType,
} from '@/lib/schemas/chat.types'
import type { ChatEvent } from '@/lib/schemas/types'
import type { ThemeTokensDocument } from '@/lib/themes/engine/client'

const manifest = { format: 'qtap-theme', formatVersion: 2, id: 'muse-test', name: 'Muse Test', version: '1.0.0', author: 'Tester' }
const blankTokens = (): ThemeTokensDocument => ({ primitives: {}, tokens: {}, choices: {} })

function draft(over: Partial<ProposalDraftSource> = {}): ProposalDraftSource {
  return {
    manifest,
    tokens: blankTokens(),
    revision: 'tokens-1',
    styles: null,
    files: [{ path: 'theme.json' }, { path: 'tokens.json' }],
    ...over,
  }
}

const proposal = (operations: unknown[], title = 'Deeper blue') => ({ title, reason: 'Because the author asked.', operations }) as never

// ============================================================================
// Proposals

describe('assessProposal', () => {
  it('offers a clean proposal, with each operation in words and the revision it was judged against', () => {
    const a = assessProposal(draft(), proposal([{ op: 'set-token', token: '--theme-primary', value: '#1d4ed8' }]))
    expect(a.verdict).toBe('offered')
    if (a.verdict !== 'offered') return
    expect(a.draftRevision).toBe('tokens-1+none')
    expect(a.review.lines).toHaveLength(1)
    expect(a.review.warnings).toEqual([])
    expect(renderProposalAssessment('Deeper blue', a)).toMatch(/^"Deeper blue" is before the author[\s\S]*--theme-primary/)
  })

  it('refuses one with an unknown token, naming the operation', () => {
    const a = assessProposal(draft(), proposal([{ op: 'set-token', token: '--theme-nothing-here', value: 'red' }]))
    expect(a).toMatchObject({ verdict: 'refused', reason: expect.stringMatching(/^Operation 1 does not apply/) })
    expect(renderProposalAssessment('x', a)).toMatch(/^Not shown to the author\./)
  })

  it('refuses CSS the scoper refuses, as an error it would bring in', () => {
    const a = assessProposal(draft(), proposal([{ op: 'set-css', css: '.qt-dialog { color: red; }\n@import "x.css";\n' }]))
    expect(a).toMatchObject({ verdict: 'refused', reason: expect.stringMatching(/@import is not allowed[\s\S]*line 2/) })
  })

  it('offers one that fails a contrast pair, and says so to both sides', () => {
    const a = assessProposal(draft(), proposal([{ op: 'set-token', token: '--theme-foreground', value: '#fefefe' }]))
    expect(a.verdict).toBe('offered')
    if (a.verdict !== 'offered') return
    expect(a.review.contrastWorse).toEqual(
      expect.arrayContaining([expect.objectContaining({ foreground: '--theme-foreground', mode: 'light', after: expect.objectContaining({ status: 'fail' }) })])
    )
    expect(renderProposalAssessment('Pale ink', a)).toMatch(/Contrast it breaks/)
  })

  it('refuses one that changes nothing', () => {
    const tokens = blankTokens()
    tokens.tokens['--theme-primary'] = '#1d4ed8'
    expect(assessProposal(draft({ tokens }), proposal([{ op: 'set-token', token: '--theme-primary', value: '#1d4ed8' }]))).toMatchObject({
      verdict: 'refused',
      reason: expect.stringMatching(/changes nothing/),
    })
  })
})

// ============================================================================
// Stored proposals

function toolRow(id: string, content: Record<string, unknown>): ChatEvent {
  return { id, type: 'message', role: 'TOOL', content: JSON.stringify(content), createdAt: '2026-11-16T00:00:00.000Z', attachments: [] } as unknown as ChatEvent
}

const offeredRow = (id: string, operations: unknown[], extra: Record<string, unknown> = {}) =>
  toolRow(id, {
    toolName: 'theme_propose',
    success: true,
    arguments: { title: 'Card light', reason: 'Softer card.', operations },
    result: JSON.stringify({ formattedText: '…', proposal: { draftId: 'muse-test', draftRevision: 'tokens-1+styles-1' } }),
    ...extra,
  })

describe('stored proposals', () => {
  const css = '.qt-dialog { color: red; }\n'
  const current = draft({ styles: { text: css, revision: 'styles-1' }, files: [{ path: 'theme.json' }, { path: 'tokens.json' }, { path: 'styles.css' }], manifest: { ...manifest, stylesPath: 'styles.css' } })

  it('lists only successful theme_propose rows, with the author\'s decision', () => {
    const events = [
      offeredRow('p1', [{ op: 'set-token', token: '--theme-card', value: '#fafafa' }]),
      toolRow('refused', { toolName: 'theme_propose', success: false, arguments: {}, result: 'Error: …' }),
      toolRow('other', { toolName: 'theme_read_draft', success: true, arguments: {}, result: '…' }),
      offeredRow('p2', [{ op: 'set-token', token: '--theme-card', value: '#f0f0f0' }], { proposalState: 'discarded' }),
    ]
    const stored = storedProposals(events)
    expect(stored.map((p) => [p.id, p.decision, p.draftRevision])).toEqual([
      ['p1', null, 'tokens-1+styles-1'],
      ['p2', 'discarded', 'tokens-1+styles-1'],
    ])
  })

  it('an offered proposal is judged against the draft as it is now', () => {
    const view = viewProposal(readStoredProposal(offeredRow('p1', [{ op: 'set-token', token: '--theme-card', value: '#fafafa' }]))!, current)
    expect(view).toMatchObject({ state: 'offered', draftChanged: false, staleReason: null })
    expect(view.review?.lines).toHaveLength(1)
  })

  it('is stale once the draft has changed so it no longer applies', () => {
    const stored = readStoredProposal(offeredRow('p1', [{ op: 'replace-css', find: 'color: red;', replace: 'color: blue;' }]))!
    expect(viewProposal(stored, current).state).toBe('offered')
    const moved = { ...current, styles: { text: '.qt-dialog { color: green; }\n', revision: 'styles-2' } }
    expect(viewProposal(stored, moved)).toMatchObject({ state: 'stale', draftChanged: true, review: null, staleReason: expect.stringMatching(/does not apply/) })
  })

  it('a decided proposal keeps its decision and is not re-judged', () => {
    const stored = readStoredProposal(offeredRow('p1', [{ op: 'set-token', token: '--theme-card', value: '#fafafa' }], { proposalState: 'kept' }))!
    expect(viewProposal(stored, current)).toMatchObject({ state: 'kept', review: null })
  })

  it('the revision is the tokens and stylesheet hashes', () => {
    expect(draftRevisionOf(current)).toBe('tokens-1+styles-1')
  })
})

// ============================================================================
// Contrast

describe('the contrast check', () => {
  const assist = assistDraftFrom({ id: 'muse-test', manifest, tokens: null, styles: null, images: [], issues: [] })

  it('measures a registry pair by id in light and dark', () => {
    const check = checkDraftContrast(assist, { pair: 'theme-foreground/theme-background' })
    expect(check).toMatchObject({ ok: true, registered: true })
    if (check.ok) expect(check.findings.map((f) => f.mode)).toEqual(['light', 'dark'])
  })

  it('measures two literals, and a token against a literal', () => {
    const literal = checkDraftContrast(assist, { foreground: '#ffffff', background: '#000000' })
    expect(literal.ok && literal.findings.every((f) => f.status === 'pass' && f.ratio === 21)).toBe(true)
    const text = renderContrastCheck({ foreground: '#777777', background: '#888888' }, checkDraftContrast(assist, { foreground: '#777777', background: '#888888' }))
    expect(text).toMatch(/^#777777 on #888888 \(text, needs 4\.5:1\):\nlight: [\d.]+:1, FAILS/)
    const mixed = checkDraftContrast(assist, { foreground: '--theme-foreground', background: '#ffffff' })
    expect(mixed.ok).toBe(true)
  })

  it('refuses an unknown pair', () => {
    expect(checkDraftContrast(assist, { pair: 'nothing/here' })).toMatchObject({ ok: false, reason: expect.stringMatching(/No registry contrast pair/) })
  })
})

// ============================================================================
// Her slate and permit

describe('her tools', () => {
  it('are exactly the five theme tools and agent mode\'s closing call — no search, documents, SQL or Carina', async () => {
    const tools = (await buildToolsForProvider('OPENAI', { onlyTools: THEME_ASSIST_TOOL_DEFINITIONS, agentMode: true, docToolsMode: 'full', sqlAccess: true, askCarina: true })) as Array<{ function?: { name: string } }>
    expect(tools.map((t) => t.function?.name).sort()).toEqual([...THEME_ASSIST_TOOL_NAMES, 'submit_final_response'].sort())
  })

  it('run under the read ceiling: her tools pass, a write tool is refused even when offered', () => {
    const offer = offeredTools([...THEME_ASSIST_TOOL_NAMES, 'doc_write_file'])
    for (const name of THEME_ASSIST_TOOL_NAMES) {
      expect(resolveToolPermit(name, {}, { offer, effectCeiling: 'read' }).permitted).toBe(true)
    }
    expect(resolveToolPermit('doc_write_file', {}, { offer, effectCeiling: 'read' })).toMatchObject({ permitted: false, refusal: 'above-ceiling' })
  })

  it('are refused where they were not offered', () => {
    expect(resolveToolPermit('theme_propose', {}, { offer: offeredTools(['search']) })).toMatchObject({ permitted: false, refusal: 'not-offered' })
  })
})

// ============================================================================
// Her prompt

describe('her prompt', () => {
  const prompt = buildCalliopeSystemPrompt({ draft: { id: 'rains', name: 'Rains\n"after dark"' }, toolInstructions: 'TOOL INSTRUCTIONS' })

  it('is stable', () => {
    expect(prompt).toMatchSnapshot()
  })

  it('names the draft on one line, ends with the engine\'s instructions, and never names a product or the implementation', () => {
    expect(prompt).toContain('the theme draft "Rains \'after dark\'" (id `rains`)')
    expect(prompt.endsWith('TOOL INSTRUCTIONS')).toBe(true)
    expect(prompt).not.toMatch(/\bAI\b|assistant product|language model|LLM|Claude|GPT|OpenAI|Anthropic|PostCSS|zod|JSON Schema/i)
    expect(prompt).toMatch(/semantic token before a component token/i)
  })

  it('asks for a screenshot only when her model reads images, and otherwise for a description', () => {
    const seeing = buildCalliopeSystemPrompt({ draft: { id: 'rains', name: 'Rains' }, readsImages: true })
    expect(seeing).toMatch(/do not see the app itself/)
    expect(seeing).toMatch(/ask them for a screenshot/)
    expect(prompt).toMatch(/do not see the app itself/)
    expect(prompt).not.toMatch(/screenshot/)
    expect(prompt).toMatch(/ask them to describe it/)
  })
})

// ============================================================================
// Her chat type

describe('the calliope chat type', () => {
  it('is help-like (no memory extraction, no titling), moderation-exempt, and not in global search', () => {
    expect(isHelpLikeChatType('calliope')).toBe(true)
    expect(isModerationExemptChatType('calliope')).toBe(true)
    expect(isListedInGlobalSearch('calliope')).toBe(false)
    expect(isListedInGlobalSearch('salon')).toBe(true)
    expect(isListedInGlobalSearch('brahma')).toBe(true)
  })

  it('records its draft by id, and refuses an id no draft could have', () => {
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      participants: [],
      title: 'A Word with the Muse',
      createdAt: '2026-11-16T00:00:00.000Z',
      updatedAt: '2026-11-16T00:00:00.000Z',
      chatType: 'calliope',
    }
    expect(ChatMetadataBaseSchema.safeParse({ ...base, themeDraftId: 'rains' }).success).toBe(true)
    expect(ChatMetadataBaseSchema.safeParse({ ...base, themeDraftId: '../etc' }).success).toBe(false)
  })
})
