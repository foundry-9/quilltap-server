/**
 * API Key Export Route
 *
 * POST /api/keys/export - Export all API keys encrypted with passphrase
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getUserRepositories } from '@/lib/repositories/factory'
import {
  decryptApiKey,
  encryptWithPassphrase,
  signData,
} from '@/lib/encryption'
import { logger } from '@/lib/logger'

const EXPORT_FORMAT = 'quilltap-apikeys'
const EXPORT_VERSION = 1
const MIN_PASSPHRASE_LENGTH = 8

interface ExportPayload {
  keys: Array<{
    provider: string
    label: string
    apiKey: string
  }>
}

interface ExportFile {
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

/**
 * POST /api/keys/export
 * Export all API keys encrypted with a user-provided passphrase
 *
 * Body: {
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
    const { passphrase } = body

    // Validate passphrase
    if (!passphrase || typeof passphrase !== 'string') {
      return NextResponse.json(
        { error: 'Passphrase is required' },
        { status: 400 }
      )
    }

    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return NextResponse.json(
        { error: `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters` },
        { status: 400 }
      )
    }

    logger.debug('Starting API key export', {
      context: 'keys-export-POST',
      userId: session.user.id,
    })

    // Get all API keys for the user
    const repos = getUserRepositories(session.user.id)
    const apiKeys = await repos.connections.getAllApiKeys()

    if (apiKeys.length === 0) {
      return NextResponse.json(
        { error: 'No API keys to export' },
        { status: 400 }
      )
    }

    // Decrypt each key and build the payload
    const decryptedKeys: ExportPayload['keys'] = []

    for (const key of apiKeys) {
      try {
        const decryptedApiKey = decryptApiKey(
          key.ciphertext,
          key.iv,
          key.authTag,
          session.user.id
        )

        decryptedKeys.push({
          provider: key.provider,
          label: key.label,
          apiKey: decryptedApiKey,
        })
      } catch (error) {
        logger.error('Failed to decrypt API key during export', {
          context: 'keys-export-POST',
          keyId: key.id,
          provider: key.provider,
        }, error instanceof Error ? error : undefined)
        // Skip keys that fail to decrypt
      }
    }

    if (decryptedKeys.length === 0) {
      return NextResponse.json(
        { error: 'Failed to decrypt any API keys' },
        { status: 500 }
      )
    }

    const payload: ExportPayload = { keys: decryptedKeys }

    // Encrypt the payload with the passphrase
    const encrypted = encryptWithPassphrase(payload, passphrase)

    // Sign the encrypted payload for integrity verification
    const payloadJson = JSON.stringify({
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    })
    const signature = signData(payloadJson, session.user.id)

    // Build the export file
    const exportFile: ExportFile = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      keyCount: decryptedKeys.length,
      encryption: {
        algorithm: 'aes-256-gcm',
        kdf: 'pbkdf2',
        kdfIterations: 100000,
        salt: encrypted.salt,
      },
      payload: {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
      signature,
    }

    logger.info('API keys exported successfully', {
      context: 'keys-export-POST',
      userId: session.user.id,
      keyCount: decryptedKeys.length,
    })

    return NextResponse.json(exportFile)
  } catch (error) {
    logger.error('Failed to export API keys', {
      context: 'keys-export-POST',
    }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to export API keys' },
      { status: 500 }
    )
  }
}
