/**
 * Text-Block Prompt Builder Tests
 */

import { buildTextBlockInstructions, type TextBlockPromptOptions } from '../text-block-prompt'

// Mock logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('buildTextBlockInstructions', () => {
  it('returns empty string when all tools explicitly disabled', () => {
    const result = buildTextBlockInstructions({ memorySearch: false })
    expect(result).toBe('')
  })

  it('includes whisper docs when enabled', () => {
    const result = buildTextBlockInstructions({ whisper: true })
    expect(result).toContain('Whisper')
    expect(result).toContain('[[WHISPER')
    expect(result).toContain('to="')
  })

  it('includes memory search by default (unless explicitly false)', () => {
    // memorySearch !== false means it's included by default (same as pseudo-tool pattern)
    const result = buildTextBlockInstructions({})
    expect(result).toContain('Memory Search')
    expect(result).toContain('[[SEARCH_MEMORIES')

    // Explicitly disabled
    const result2 = buildTextBlockInstructions({ memorySearch: false })
    expect(result2).toBe('')
  })

  it('includes image generation docs when enabled', () => {
    const result = buildTextBlockInstructions({ imageGeneration: true })
    expect(result).toContain('Image Generation')
    expect(result).toContain('[[GENERATE_IMAGE')
  })

  it('includes web search docs when enabled', () => {
    const result = buildTextBlockInstructions({ webSearch: true })
    expect(result).toContain('Web Search')
    expect(result).toContain('[[SEARCH_WEB')
  })

  it('includes state docs when enabled', () => {
    const result = buildTextBlockInstructions({ state: true })
    expect(result).toContain('State Management')
    expect(result).toContain('[[STATE')
    expect(result).toContain('operation=')
  })

  it('includes RNG docs when enabled', () => {
    const result = buildTextBlockInstructions({ rng: true })
    expect(result).toContain('Dice')
    expect(result).toContain('[[RNG')
  })

  it('includes file management docs when enabled', () => {
    const result = buildTextBlockInstructions({ fileManagement: true })
    expect(result).toContain('File Management')
    expect(result).toContain('[[FILE_MANAGEMENT')
  })

  it('includes project info docs when enabled', () => {
    const result = buildTextBlockInstructions({ projectInfo: true })
    expect(result).toContain('Project Info')
    expect(result).toContain('[[PROJECT_INFO')
  })

  it('includes help search docs when enabled', () => {
    const result = buildTextBlockInstructions({ helpSearch: true })
    expect(result).toContain('Help Search')
    expect(result).toContain('[[HELP_SEARCH')
  })

  it('includes format instructions header', () => {
    const result = buildTextBlockInstructions({ whisper: true, memorySearch: true })
    expect(result).toContain('Available Tools')
    expect(result).toContain('Marker Format')
    expect(result).toContain('Self-closing')
    expect(result).toContain('Tool Usage Instructions')
  })

  it('includes all enabled tools in one output', () => {
    const options: TextBlockPromptOptions = {
      whisper: true,
      memorySearch: true,
      imageGeneration: true,
      webSearch: true,
      state: true,
      rng: true,
    }
    const result = buildTextBlockInstructions(options)

    expect(result).toContain('Whisper')
    expect(result).toContain('Memory Search')
    expect(result).toContain('Image Generation')
    expect(result).toContain('Web Search')
    expect(result).toContain('State Management')
    expect(result).toContain('Dice')
  })
})
