/**
 * The route trail rides the `.qtap` export with the message it explains.
 *
 * Two gates have to agree: the published JSON Schema (what a third party
 * validates a bundle against) and `MessageEventSchema` (what `addMessage`
 * actually parses on the way back in). A bundle written before the field
 * existed simply has none, and must import as NULL rather than being rejected.
 */

import { describe, it, expect } from '@jest/globals'
import fs from 'fs'
import path from 'path'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'

import { MessageEventSchema } from '@/lib/schemas/chat.types'

const schema = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'public/schemas/qtap-export.schema.json'), 'utf8'),
)

const ajv = new Ajv2020({ strict: false, allErrors: true })
addFormats(ajv)
ajv.addSchema(schema)
const validateMessage = ajv.compile({ $ref: `${schema.$id}#/$defs/MessageEvent` })

const MESSAGE_ID = '00000000-0000-4000-8000-000000000001'
const PRIMARY_PROFILE = '00000000-0000-4000-8000-00000000000a'
const UNDERSTUDY_PROFILE = '00000000-0000-4000-8000-00000000000b'

function message(extra: Record<string, unknown> = {}) {
  return {
    type: 'message',
    id: MESSAGE_ID,
    role: 'ASSISTANT',
    content: 'A reply, at length.',
    createdAt: '2026-09-09T00:00:00.000Z',
    provider: 'anthropic',
    modelName: 'claude-sonnet-5',
    ...extra,
  }
}

const TRAIL = [
  {
    profileId: PRIMARY_PROFILE,
    profileName: 'OpenAI gpt-5',
    provider: 'openai',
    modelName: 'gpt-5',
    via: 'primary',
    outcome: 'failed',
    trigger: 'network',
    detail: 'Connection error.',
  },
  {
    profileId: UNDERSTUDY_PROFILE,
    profileName: 'Anthropic Sonnet',
    provider: 'anthropic',
    modelName: 'claude-sonnet-5',
    via: 'understudy',
    outcome: 'answered',
  },
]

describe('qtap-export.schema.json — routeTrail', () => {
  it('accepts a message carrying a full trail', () => {
    expect(validateMessage(message({ routeTrail: TRAIL }))).toBe(true)
  })

  it('accepts an explicit null, and a message with no field at all', () => {
    expect(validateMessage(message({ routeTrail: null }))).toBe(true)
    expect(validateMessage(message())).toBe(true)
  })

  it('accepts a refusal carrying its evidence', () => {
    const refused = [{
      ...TRAIL[0],
      outcome: 'refused',
      trigger: 'moderation-refusal',
      evidence: 'finish-reason',
      detail: 'finish_reason: content_filter',
    }, TRAIL[1]]
    expect(validateMessage(message({ routeTrail: refused }))).toBe(true)
  })

  it('rejects an entry missing the fields a reader needs', () => {
    expect(validateMessage(message({ routeTrail: [{ profileId: PRIMARY_PROFILE }] }))).toBe(false)
  })

  it('rejects an outcome or a via the reader has no rendering for', () => {
    expect(validateMessage(message({ routeTrail: [{ ...TRAIL[0], outcome: 'shrugged' }] }))).toBe(false)
    expect(validateMessage(message({ routeTrail: [{ ...TRAIL[0], via: 'telepathy' }] }))).toBe(false)
  })
})

describe('the import gate (MessageEventSchema) — routeTrail', () => {
  it('lets a trail through unchanged', () => {
    const parsed = MessageEventSchema.parse(message({ routeTrail: TRAIL, attachments: [] }))
    expect(parsed.routeTrail).toEqual(TRAIL)
  })

  it('imports a bundle written before the field existed with no trail at all', () => {
    const parsed = MessageEventSchema.parse(message({ attachments: [] }))
    expect(parsed.routeTrail ?? null).toBeNull()
  })

  it('keeps a stale profileId rather than rejecting it — the trail is a historical record', () => {
    const stale = [{ ...TRAIL[0], profileId: '00000000-0000-4000-8000-0000000000ff' }, TRAIL[1]]
    const parsed = MessageEventSchema.parse(message({ routeTrail: stale, attachments: [] }))
    expect(parsed.routeTrail![0].profileId).toBe('00000000-0000-4000-8000-0000000000ff')
  })

  it('refuses a detail longer than the cap, so no full error body rides an export', () => {
    const shouty = [{ ...TRAIL[0], detail: 'x'.repeat(201) }, TRAIL[1]]
    expect(MessageEventSchema.safeParse(message({ routeTrail: shouty, attachments: [] })).success).toBe(false)
  })
})
