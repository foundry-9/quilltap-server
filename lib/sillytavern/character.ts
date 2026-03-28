/**
 * SillyTavern Character Import/Export
 * Supports SillyTavern V2 character format
 */

import { logger } from '@/lib/logger'

export interface STCharacterV2 {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  creator_notes?: string
  system_prompt?: string
  post_history_instructions?: string
  tags?: string[]
  creator?: string
  character_version?: string
  extensions?: Record<string, any>
  // Additional V2 spec fields
  alternate_greetings?: string[]
  character_book?: any
  title?: string
  [key: string]: any
}

export interface STCharacterCard {
  spec: 'chara_card_v2'
  spec_version: '2.0'
  data: STCharacterV2
}

/**
 * Import SillyTavern character data to internal format
 */
export function importSTCharacter(stData: STCharacterV2 | STCharacterCard) {
  // Handle both direct V2 format and card format
  const data = 'data' in stData ? stData.data : stData

  // mes_example can be an array or string in SillyTavern format
  // Convert to JSON string for storage
  let exampleDialogues = ''
  if (data.mes_example) {
    exampleDialogues = Array.isArray(data.mes_example)
      ? JSON.stringify(data.mes_example)
      : data.mes_example
  }

  // Build systemPrompts array from ST system_prompt if present
  const now = new Date().toISOString()
  const systemPrompts = data.system_prompt
    ? [{
        id: crypto.randomUUID(),
        name: 'Default',
        content: data.system_prompt,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      }]
    : []

  // Build scenarios array from ST scenario string if present
  const scenarios = data.scenario ? [{
    id: crypto.randomUUID(),
    title: 'Default',
    content: data.scenario,
    createdAt: now,
    updatedAt: now,
  }] : []

  return {
    name: data.name,
    title: data.title || null,
    description: data.description,
    personality: data.personality,
    scenarios,
    firstMessage: data.first_mes,
    exampleDialogues,
    systemPrompts,
    sillyTavernData: data, // Store original for full fidelity
  }
}

/**
 * Export internal character to SillyTavern format
 */
export function exportSTCharacter(character: any): STCharacterCard {
  // Get the default system prompt from the systemPrompts array
  let systemPromptContent = ''
  if (character.systemPrompts && character.systemPrompts.length > 0) {
    const defaultPrompt = character.systemPrompts.find((p: { isDefault: boolean }) => p.isDefault)
    systemPromptContent = defaultPrompt?.content || character.systemPrompts[0]?.content || ''
  }

  // Concatenate all scenarios into a single string for ST format
  const scenarioContent = character.scenarios?.length
    ? character.scenarios.length === 1
      ? character.scenarios[0].content
      : character.scenarios.map((s: { title: string; content: string }) => `## ${s.title}\n${s.content}`).join('\n\n')
    : ''

  // If we have original ST data, use it as base to preserve all fields
  const baseData: STCharacterV2 = character.sillyTavernData || {
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: scenarioContent,
    first_mes: character.firstMessage,
    mes_example: character.exampleDialogues || '',
    creator_notes: '',
    tags: [],
    creator: 'Quilltap',
    character_version: '1.0',
    extensions: {},
  }

  // Override with current values
  const data: STCharacterV2 = {
    ...baseData,
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: scenarioContent,
    first_mes: character.firstMessage,
    mes_example: character.exampleDialogues || '',
    system_prompt: systemPromptContent,
    title: character.title || undefined,
  }

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data,
  }
}

/**
 * Parse SillyTavern character from PNG file
 * PNG files embed JSON data in a tEXt chunk
 */
export async function parseSTCharacterPNG(
  buffer: Buffer
): Promise<STCharacterV2 | null> {
  try {
    // Look for PNG tEXt chunk with chara data
    const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const bufferHeader = new Uint8Array(buffer.buffer, buffer.byteOffset, 8)
    if (pngSignature.length !== bufferHeader.length ||
        !pngSignature.every((b, i) => b === bufferHeader[i])) {
      throw new Error('Invalid PNG file')
    }

    let offset = 8
    while (offset < buffer.length) {
      // Read chunk length and type
      const length = buffer.readUInt32BE(offset)
      const type = buffer.toString('ascii', offset + 4, offset + 8)

      if (type === 'tEXt') {
        // Read chunk data
        const chunkData = buffer.slice(offset + 8, offset + 8 + length)

        // Find null terminator to separate keyword from text
        const nullIndex = chunkData.indexOf(0)
        if (nullIndex === -1) continue

        const keyword = chunkData.toString('utf8', 0, nullIndex)

        // Check for character data keywords
        if (keyword === 'chara' || keyword === 'ccv2') {
          const jsonData = chunkData.toString('utf8', nullIndex + 1)
          const parsed = JSON.parse(jsonData)

          // Handle both V2 card format and direct data
          if (parsed.spec === 'chara_card_v2' && parsed.data) {
            return parsed.data
          } else if (parsed.name) {
            return parsed
          }
        }
      }

      // Move to next chunk (length + type + data + CRC)
      offset += 12 + length
    }

    return null
  } catch (error) {
    logger.error('Error parsing ST character PNG', { context: {} }, error instanceof Error ? error : undefined)
    return null
  }
}

/**
 * Generate a simple colored PNG placeholder with the character's initial
 * Creates a 256x256 PNG with a colored background and white initial
 */
function generatePlaceholderPNG(characterName: string): Buffer {
  // Simple colors based on character name hash
  const colors = [
    [74, 144, 226],   // Blue
    [80, 200, 120],   // Green
    [255, 149, 0],    // Orange
    [175, 82, 222],   // Purple
    [255, 59, 48],    // Red
    [90, 200, 250],   // Teal
    [255, 204, 0],    // Yellow
    [88, 86, 214],    // Indigo
  ]

  // Hash the name to get a consistent color
  let hash = 0
  for (let i = 0; i < characterName.length; i++) {
    hash = ((hash << 5) - hash) + characterName.charCodeAt(i)
    hash = hash & hash
  }
  const colorIndex = Math.abs(hash) % colors.length
  const [r, g, b] = colors[colorIndex]

  // Create a 256x256 PNG with colored background
  const width = 256
  const height = 256

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR chunk (image header)
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData.writeUInt8(8, 8)   // Bit depth
  ihdrData.writeUInt8(2, 9)   // Color type (RGB)
  ihdrData.writeUInt8(0, 10)  // Compression
  ihdrData.writeUInt8(0, 11)  // Filter
  ihdrData.writeUInt8(0, 12)  // Interlace
  const ihdrChunk = createPNGChunk('IHDR', ihdrData)

  // IDAT chunk (image data)
  // Create raw pixel data (filter byte + RGB for each row)
  const rawData = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 3)
    rawData[rowOffset] = 0 // No filter
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 3
      rawData[pixelOffset] = r
      rawData[pixelOffset + 1] = g
      rawData[pixelOffset + 2] = b
    }
  }

  // Compress with zlib (deflate)
  const zlib = require('zlib')
  const compressedData = zlib.deflateSync(rawData)
  const idatChunk = createPNGChunk('IDAT', compressedData)

  // IEND chunk (image end)
  const iendChunk = createPNGChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([
    new Uint8Array(signature),
    new Uint8Array(ihdrChunk),
    new Uint8Array(idatChunk),
    new Uint8Array(iendChunk),
  ])
}

/**
 * Create a PNG chunk with proper length, type, data, and CRC
 */
function createPNGChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)

  const typeBuffer = Buffer.from(type, 'ascii')
  const crcInput = Buffer.concat([new Uint8Array(typeBuffer), new Uint8Array(data)])
  const crc = calculateCRC32(crcInput)
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc)

  return Buffer.concat([
    new Uint8Array(length),
    new Uint8Array(typeBuffer),
    new Uint8Array(data),
    new Uint8Array(crcBuffer),
  ])
}

/**
 * Create SillyTavern character PNG with embedded JSON
 */
export async function createSTCharacterPNG(
  character: any,
  avatarBuffer?: Buffer
): Promise<Buffer> {
  const stCard = exportSTCharacter(character)
  const jsonData = JSON.stringify(stCard)

  // If no avatar provided, generate a colored placeholder
  if (!avatarBuffer) {
    avatarBuffer = generatePlaceholderPNG(character.name || 'Character')
  }

  // Create tEXt chunk for embedding character data
  const keyword = 'chara'
  const keywordBuffer = Buffer.from(keyword, 'utf8')
  const nullByte = Buffer.from([0])
  const dataBuffer = Buffer.from(jsonData, 'utf8')

  const chunkData = Buffer.concat([new Uint8Array(keywordBuffer), new Uint8Array(nullByte), new Uint8Array(dataBuffer)])
  const chunkLength = Buffer.alloc(4)
  chunkLength.writeUInt32BE(chunkData.length)

  const chunkType = Buffer.from('tEXt', 'ascii')

  // Calculate CRC32 for chunk (type + data)
  const crc = calculateCRC32(Buffer.concat([new Uint8Array(chunkType), new Uint8Array(chunkData)]))
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc)

  const textChunk = Buffer.concat([new Uint8Array(chunkLength), new Uint8Array(chunkType), new Uint8Array(chunkData), new Uint8Array(crcBuffer)])

  // Insert chunk after PNG header and IHDR chunk
  // Find the IHDR chunk end
  let insertOffset = 8 // After PNG signature
  const ihdrLength = avatarBuffer.readUInt32BE(insertOffset)
  insertOffset += 12 + ihdrLength // Skip length, type, data, and CRC

  // Construct new PNG with tEXt chunk inserted
  const result = Buffer.concat([
    new Uint8Array(avatarBuffer.subarray(0, insertOffset)),
    new Uint8Array(textChunk),
    new Uint8Array(avatarBuffer.subarray(insertOffset)),
  ])

  return result
}

/**
 * Calculate CRC32 checksum (PNG spec)
 */
function calculateCRC32(buffer: Buffer): number {
  let crc = 0xffffffff

  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i]
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }

  return (crc ^ 0xffffffff) >>> 0
}
