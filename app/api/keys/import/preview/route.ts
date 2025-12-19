/**
 * API Key Import Preview Route
 *
 * POST /api/keys/import/preview - Preview keys in an import file
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getUserRepositories } from '@/lib/repositories/factory'
import { decryptWithPassphrase, verifySignature, maskApiKey } from '@/lib/encryption'
import { logger } from '@/lib/logger'

const EXPORT_FORMAT = 'quilltap-apikeys'
const SUPPORTED_VERSIONS = [1]

interface ExportPayload {
  keys: Array<{
    provider: string
    label: string
    apiKey: string
  }>
}

interface ImportFile {
  format: string
  version: number
  exportedAt: string
  keyCount: number
  encryption: {
    algorithm: string
    kdf: string
    kdfIterations: number
    salt: string
  }
  payload: {
    ciphertext: string
    iv: string
    authTag: string
  }
  signature: string
}

interface PreviewKey {
  provider: string
  label: string
  keyPreview: string
  isDuplicate: boolean
  existingId?: string
}

interface PreviewResponse {
  valid: boolean
  signatureValid: boolean
  keyCount: number
  keys: PreviewKey[]
  duplicateCount: number
  error?: string
}

/**
 * POST /api/keys/import/preview
 * Preview keys in an import file (validates passphrase)
 *
 * Body: {
 *   file: ImportFile (JSON object)
 *   passphrase: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { file, passphrase } = body

    // Validate inputs
    if (!file || typeof file !== 'object') {
      return NextResponse.json(
        { valid: false, error: 'Import file is required' } as PreviewResponse,
        { status: 400 }
      )
    }

    if (!passphrase || typeof passphrase !== 'string') {
      return NextResponse.json(
        { valid: false, error: 'Passphrase is required' } as PreviewResponse,
        { status: 400 }
      )
    }

    const importFile = file as ImportFile

    // Validate file format
    if (importFile.format !== EXPORT_FORMAT) {
      return NextResponse.json(
        { valid: false, error: 'Invalid file format' } as PreviewResponse,
        { status: 400 }
      )
    }

    if (!SUPPORTED_VERSIONS.includes(importFile.version)) {
      return NextResponse.json(
        { valid: false, error: `Unsupported file version: ${importFile.version}` } as PreviewResponse,
        { status: 400 }
      )
    }

    // Validate required fields
    if (!importFile.encryption?.salt || !importFile.payload?.ciphertext ||
        !importFile.payload?.iv || !importFile.payload?.authTag) {
      return NextResponse.json(
        { valid: false, error: 'Invalid file structure' } as PreviewResponse,
        { status: 400 }
      )
    }

    logger.debug('Starting import preview', {
      context: 'keys-import-preview-POST',
      userId: session.user.id,
      fileKeyCount: importFile.keyCount,
    })

    // Verify signature (warn but don't block if invalid)
    const payloadJson = JSON.stringify({
      ciphertext: importFile.payload.ciphertext,
      iv: importFile.payload.iv,
      authTag: importFile.payload.authTag,
    })
    const signatureValid = verifySignature(
      payloadJson,
      importFile.signature,
      session.user.id
    )

    if (!signatureValid) {
      logger.warn('Import file signature verification failed', {
        context: 'keys-import-preview-POST',
        userId: session.user.id,
      })
    }

    // Attempt to decrypt the payload
    let payload: ExportPayload
    try {
      payload = decryptWithPassphrase<ExportPayload>(
        {
          salt: importFile.encryption.salt,
          iv: importFile.payload.iv,
          ciphertext: importFile.payload.ciphertext,
          authTag: importFile.payload.authTag,
        },
        passphrase
      )
    } catch (error) {
      logger.debug('Failed to decrypt import file', {
        context: 'keys-import-preview-POST',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return NextResponse.json(
        { valid: false, error: 'Invalid passphrase or corrupted file' } as PreviewResponse,
        { status: 400 }
      )
    }

    // Validate payload structure
    if (!payload.keys || !Array.isArray(payload.keys)) {
      return NextResponse.json(
        { valid: false, error: 'Invalid payload structure' } as PreviewResponse,
        { status: 400 }
      )
    }

    // Get existing keys to check for duplicates
    const repos = getUserRepositories(session.user.id)
    const existingKeys = await repos.connections.getAllApiKeys()

    // Build preview response
    const previewKeys: PreviewKey[] = []
    let duplicateCount = 0

    for (const key of payload.keys) {
      // Find duplicate by provider + label
      const existing = existingKeys.find(
        (e) => e.provider === key.provider && e.label === key.label
      )

      if (existing) {
        duplicateCount++
      }

      previewKeys.push({
        provider: key.provider,
        label: key.label,
        keyPreview: maskApiKey(key.apiKey),
        isDuplicate: !!existing,
        existingId: existing?.id,
      })
    }

    logger.info('Import preview completed', {
      context: 'keys-import-preview-POST',
      userId: session.user.id,
      keyCount: previewKeys.length,
      duplicateCount,
      signatureValid,
    })

    const response: PreviewResponse = {
      valid: true,
      signatureValid,
      keyCount: previewKeys.length,
      keys: previewKeys,
      duplicateCount,
    }

    return NextResponse.json(response)
  } catch (error) {
    logger.error('Failed to preview import file', {
      context: 'keys-import-preview-POST',
    }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { valid: false, error: 'Failed to preview import file' } as PreviewResponse,
      { status: 500 }
    )
  }
}
