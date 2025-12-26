/**
 * API Key Import Route
 *
 * POST /api/keys/import - Import API keys from export file
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getUserRepositories } from '@/lib/repositories/factory'
import { decryptWithPassphrase, encryptApiKey } from '@/lib/encryption'
import { Provider } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'
import { autoAssociateApiKeys, type ProfileAssociation } from '@/lib/api-keys/auto-associate'

const EXPORT_FORMAT = 'quilltap-apikeys'
const SUPPORTED_VERSIONS = [1]

type DuplicateHandling = 'skip' | 'replace' | 'rename'

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

interface ImportResult {
  imported: number
  skipped: number
  replaced: number
  errors: string[]
  associations: ProfileAssociation[]
}

/**
 * POST /api/keys/import
 * Import API keys from export file
 *
 * Body: {
 *   file: ImportFile (JSON object)
 *   passphrase: string
 *   duplicateHandling: 'skip' | 'replace' | 'rename'
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { file, passphrase, duplicateHandling = 'skip' } = body

    // Validate inputs
    if (!file || typeof file !== 'object') {
      return NextResponse.json(
        { error: 'Import file is required' },
        { status: 400 }
      )
    }

    if (!passphrase || typeof passphrase !== 'string') {
      return NextResponse.json(
        { error: 'Passphrase is required' },
        { status: 400 }
      )
    }

    if (!['skip', 'replace', 'rename'].includes(duplicateHandling)) {
      return NextResponse.json(
        { error: 'Invalid duplicate handling option' },
        { status: 400 }
      )
    }

    const importFile = file as ImportFile
    const handling = duplicateHandling as DuplicateHandling

    // Validate file format
    if (importFile.format !== EXPORT_FORMAT) {
      return NextResponse.json(
        { error: 'Invalid file format' },
        { status: 400 }
      )
    }

    if (!SUPPORTED_VERSIONS.includes(importFile.version)) {
      return NextResponse.json(
        { error: `Unsupported file version: ${importFile.version}` },
        { status: 400 }
      )
    }

    logger.debug('Starting API key import', {
      context: 'keys-import-POST',
      userId: session.user.id,
      duplicateHandling: handling,
    })

    // Decrypt the payload
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
        context: 'keys-import-POST',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return NextResponse.json(
        { error: 'Invalid passphrase or corrupted file' },
        { status: 400 }
      )
    }

    // Validate payload
    if (!payload.keys || !Array.isArray(payload.keys)) {
      return NextResponse.json(
        { error: 'Invalid payload structure' },
        { status: 400 }
      )
    }

    const repos = getUserRepositories(session.user.id)
    const existingKeys = await repos.connections.getAllApiKeys()

    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      replaced: 0,
      errors: [],
      associations: [],
    }

    // Track IDs of newly imported/replaced keys for auto-association
    const newKeyIds: string[] = []

    for (const key of payload.keys) {
      try {
        // Validate key data
        if (!key.provider || !key.label || !key.apiKey) {
          result.errors.push(`Invalid key data: missing required fields`)
          continue
        }

        // Find duplicate by provider + label
        const existing = existingKeys.find(
          (e) => e.provider === key.provider && e.label === key.label
        )

        if (existing) {
          if (handling === 'skip') {
            result.skipped++
            continue
          } else if (handling === 'replace') {
            // Update existing key
            const encrypted = encryptApiKey(key.apiKey, session.user.id)
            await repos.connections.updateApiKey(existing.id, {
              ciphertext: encrypted.encrypted,
              iv: encrypted.iv,
              authTag: encrypted.authTag,
            })
            // Track replaced key ID for auto-association
            newKeyIds.push(existing.id)
            result.replaced++
            continue
          }
          // For 'rename', fall through to create with modified label
        }

        // Encrypt the key with user's encryption
        const encrypted = encryptApiKey(key.apiKey, session.user.id)

        // Determine label (may be modified for rename)
        let label = key.label
        if (existing && handling === 'rename') {
          // Find a unique label
          let counter = 1
          let newLabel = `${key.label} (imported)`
          while (existingKeys.some((e) => e.label === newLabel) ||
                 payload.keys.some((k) => k !== key && k.label === newLabel)) {
            counter++
            newLabel = `${key.label} (imported ${counter})`
          }
          label = newLabel
        }

        // Create the new key
        const newKey = await repos.connections.createApiKey({
          provider: key.provider as Provider,
          label,
          ciphertext: encrypted.encrypted,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          isActive: true,
        })

        // Track new key ID for auto-association
        newKeyIds.push(newKey.id)
        result.imported++
      } catch (error) {
        logger.error('Failed to import key', {
          context: 'keys-import-POST',
          provider: key.provider,
          label: key.label,
        }, error instanceof Error ? error : undefined)
        result.errors.push(`Failed to import key "${key.label}": ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Auto-associate new keys with profiles that need them
    if (newKeyIds.length > 0) {
      logger.debug('Running auto-association for imported keys', {
        context: 'keys-import-POST',
        keyCount: newKeyIds.length,
      })

      const associationResult = await autoAssociateApiKeys(session.user.id, newKeyIds)
      result.associations = associationResult.associations

      // Add any association errors to the result
      if (associationResult.errors.length > 0) {
        result.errors.push(...associationResult.errors)
      }
    }

    logger.info('API key import completed', {
      context: 'keys-import-POST',
      userId: session.user.id,
      imported: result.imported,
      skipped: result.skipped,
      replaced: result.replaced,
      associations: result.associations.length,
      errors: result.errors.length,
    })

    return NextResponse.json(result)
  } catch (error) {
    logger.error('Failed to import API keys', {
      context: 'keys-import-POST',
    }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to import API keys' },
      { status: 500 }
    )
  }
}
