/**
 * Roleplay template create and update share one input object
 * (`lib/roleplay-templates/template-input.ts`).
 */

import { RoleplayTemplateCreateSchema, RoleplayTemplateUpdateSchema } from '@/lib/roleplay-templates/template-input'

const minimal = { name: ' Noir ', systemPrompt: ' Stay hard-boiled. ', narrationDelimiters: '*' }
const firstMessage = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message

describe('RoleplayTemplateCreateSchema', () => {
  it('trims and turns a blank description into none', () => {
    expect(RoleplayTemplateCreateSchema.parse({ ...minimal, description: '   ' })).toEqual({
      name: 'Noir', systemPrompt: 'Stay hard-boiled.', narrationDelimiters: '*', description: null,
    })
  })

  it('takes null narration delimiters as unmarked prose, and requires the key', () => {
    expect(RoleplayTemplateCreateSchema.parse({ ...minimal, narrationDelimiters: null }).narrationDelimiters).toBeNull()
    const { narrationDelimiters: _omit, ...without } = minimal
    expect(firstMessage(RoleplayTemplateCreateSchema.safeParse(without))).toBe(
      'Narration delimiters are required (null for unmarked prose)',
    )
  })

  it.each([
    [{ name: 'x'.repeat(101) }, 'Name must be 100 characters or less'],
    [{ systemPrompt: '' }, 'System prompt is required'],
    [{ description: 'd'.repeat(501) }, 'Description must be 500 characters or less'],
  ])('refuses %#: %s', (extra, message) => {
    expect(firstMessage(RoleplayTemplateCreateSchema.safeParse({ ...minimal, ...extra }))).toBe(message)
  })

  it.each([
    [{ narrationDelimiters: ['*'] }],
    [{ narrationDelimiters: '' }],
    [{ markdownAsterisks: 'yes' }],
    [{ delimiters: 'bold' }],
    [{ tags: [] }],
  ])('refuses %j', (extra) => {
    expect(RoleplayTemplateCreateSchema.safeParse({ ...minimal, ...extra }).success).toBe(false)
  })
})

describe('RoleplayTemplateUpdateSchema', () => {
  it('takes any subset and nothing else', () => {
    expect(RoleplayTemplateUpdateSchema.parse({ markdownAsterisks: false })).toEqual({ markdownAsterisks: false })
    expect(RoleplayTemplateUpdateSchema.parse({ narrationDelimiters: null })).toEqual({ narrationDelimiters: null })
    expect(RoleplayTemplateUpdateSchema.safeParse({ isBuiltIn: true }).success).toBe(false)
  })
})
