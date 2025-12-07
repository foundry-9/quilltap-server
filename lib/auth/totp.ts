/**
 * TOTP (Time-based One-Time Password) utilities for 2FA
 * Phase 2.1: TOTP Implementation
 * Phase 2.2: Rate limiting and device trust
 */

import speakeasy from 'speakeasy'
import qrcode from 'qrcode'
import { encryptData, decryptData } from '@/lib/encryption'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import crypto from 'crypto'
import type { TrustedDevice } from '@/lib/schemas/types'

// ============================================================================
// RATE LIMITING CONFIGURATION
// ============================================================================

const RATE_LIMIT_THRESHOLDS = [
  { attempts: 3, lockoutSeconds: 30 },
  { attempts: 5, lockoutSeconds: 300 },     // 5 minutes
  { attempts: 10, lockoutSeconds: 1800 },   // 30 minutes
]

// ============================================================================
// DEVICE TRUST CONFIGURATION
// ============================================================================

const DEVICE_TRUST_DAYS = 30
const DEVICE_TOKEN_BYTES = 32

/**
 * Generate a TOTP secret for a user
 */
export async function generateTOTPSecret(userId: string, userEmail: string) {
  const secret = speakeasy.generateSecret({
    name: `Quilltap (${userEmail})`,
    issuer: 'Quilltap',
    length: 32
  })

  // Encrypt the secret
  const encrypted = encryptData(secret.base32, userId)

  // Generate QR code
  const qrCodeDataUrl = await qrcode.toDataURL(secret.otpauth_url!)

  return {
    secret: secret.base32, // Return unencrypted for display during setup
    qrCode: qrCodeDataUrl,
    encrypted: {
      secret: encrypted.encrypted,
      iv: encrypted.iv,
      authTag: encrypted.authTag
    }
  }
}

// ============================================================================
// RATE LIMITING FUNCTIONS
// ============================================================================

/**
 * Check if user is currently locked out from TOTP attempts
 * Returns lockout info if locked, null if not locked
 */
export async function checkTOTPLockout(userId: string): Promise<{ locked: boolean; secondsRemaining?: number }> {
  const repos = getRepositories()
  const user = await repos.users.findById(userId)

  if (!user?.totpAttempts?.lockedUntil) {
    return { locked: false }
  }

  const lockedUntil = new Date(user.totpAttempts.lockedUntil)
  const now = new Date()

  if (now < lockedUntil) {
    const secondsRemaining = Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000)
    logger.debug('TOTP lockout active', {
      context: 'checkTOTPLockout',
      userId,
      secondsRemaining,
    })
    return { locked: true, secondsRemaining }
  }

  return { locked: false }
}

/**
 * Record a failed TOTP attempt and apply lockout if thresholds exceeded
 */
async function recordFailedTOTPAttempt(userId: string): Promise<void> {
  const repos = getRepositories()
  const user = await repos.users.findById(userId)

  const currentCount = (user?.totpAttempts?.count ?? 0) + 1
  const now = new Date().toISOString()

  // Determine if we need to apply a lockout
  let lockedUntil: string | null = null

  // Find the highest threshold we've exceeded
  for (const threshold of RATE_LIMIT_THRESHOLDS) {
    if (currentCount >= threshold.attempts) {
      const lockoutEnd = new Date(Date.now() + threshold.lockoutSeconds * 1000)
      lockedUntil = lockoutEnd.toISOString()
    }
  }

  await repos.users.update(userId, {
    totpAttempts: {
      count: currentCount,
      lastAttempt: now,
      lockedUntil,
    },
  })

  if (lockedUntil) {
    logger.warn('TOTP lockout applied', {
      context: 'recordFailedTOTPAttempt',
      userId,
      attemptCount: currentCount,
      lockedUntil,
    })
  } else {
    logger.debug('Failed TOTP attempt recorded', {
      context: 'recordFailedTOTPAttempt',
      userId,
      attemptCount: currentCount,
    })
  }
}

/**
 * Reset TOTP attempt counter after successful verification
 */
async function resetTOTPAttempts(userId: string): Promise<void> {
  const repos = getRepositories()
  await repos.users.update(userId, {
    totpAttempts: undefined,
  })

  logger.debug('TOTP attempts reset after successful verification', {
    context: 'resetTOTPAttempts',
    userId,
  })
}

// ============================================================================
// TOTP VERIFICATION
// ============================================================================

/**
 * Verify a TOTP code with rate limiting
 * Returns: { valid: boolean, locked?: boolean, secondsRemaining?: number }
 */
export async function verifyTOTP(
  userId: string,
  token: string,
  checkBackupCode: boolean = true
): Promise<boolean> {
  const repos = getRepositories()
  const user = await repos.users.findById(userId)

  if (!user || !user.totp?.enabled) {
    return false
  }

  // Check for lockout first
  const lockoutStatus = await checkTOTPLockout(userId)
  if (lockoutStatus.locked) {
    logger.debug('TOTP verification blocked - account locked', {
      context: 'verifyTOTP',
      userId,
      secondsRemaining: lockoutStatus.secondsRemaining,
    })
    return false
  }

  // First try TOTP verification
  if (user.totp?.ciphertext && user.totp?.iv && user.totp?.authTag) {
    try {
      const decryptedSecret = decryptData(
        user.totp.ciphertext,
        user.totp.iv,
        user.totp.authTag,
        userId
      )

      const valid = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token,
        window: 1 // Allow 1 time step before/after for clock drift
      })

      if (valid) {
        await resetTOTPAttempts(userId)
        return true
      }
    } catch (error) {
      logger.error('TOTP verification error', { context: 'verifyTOTP', userId }, error instanceof Error ? error : undefined)
    }
  }

  // If TOTP fails and checkBackupCode is true, try backup codes
  if (checkBackupCode && user.backupCodes?.ciphertext) {
    try {
      const decryptedCodes = decryptData(
        user.backupCodes.ciphertext,
        user.backupCodes.iv,
        user.backupCodes.authTag,
        userId
      )

      const backupCodes = JSON.parse(decryptedCodes) as string[]

      // Check if provided token matches any backup code
      const codeIndex = backupCodes.findIndex(code => code === token)

      if (codeIndex !== -1) {
        // Remove used backup code
        backupCodes.splice(codeIndex, 1)

        // Update user with remaining backup codes
        const encryptedRemainingCodes = encryptData(JSON.stringify(backupCodes), userId)

        await repos.users.update(userId, {
          backupCodes: {
            ciphertext: encryptedRemainingCodes.encrypted,
            iv: encryptedRemainingCodes.iv,
            authTag: encryptedRemainingCodes.authTag,
            createdAt: user.backupCodes?.createdAt || new Date().toISOString(),
          },
        })

        logger.info('Backup code used successfully', {
          context: 'verifyTOTP',
          userId,
          remainingCodes: backupCodes.length,
        })

        await resetTOTPAttempts(userId)
        return true
      }
    } catch (error) {
      logger.error('Backup code verification error', { context: 'verifyTOTP', userId }, error instanceof Error ? error : undefined)
    }
  }

  // Record failed attempt
  await recordFailedTOTPAttempt(userId)
  return false
}

/**
 * Generate backup codes
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = []

  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric codes
    const code = crypto.randomBytes(4).toString('hex').toUpperCase()
    codes.push(code)
  }

  return codes
}

/**
 * Enable TOTP for a user
 */
export async function enableTOTP(
  userId: string,
  encryptedSecret: string,
  encryptedIv: string,
  encryptedAuthTag: string,
  verificationCode: string
): Promise<{ success: boolean; backupCodes?: string[] }> {
  const repos = getRepositories()
  // First verify the code works
  const user = await repos.users.findById(userId)

  if (!user) {
    return { success: false }
  }

  // Decrypt and verify the secret
  try {
    const decryptedSecret = decryptData(
      encryptedSecret,
      encryptedIv,
      encryptedAuthTag,
      userId
    )

    const valid = speakeasy.totp.verify({
      secret: decryptedSecret,
      encoding: 'base32',
      token: verificationCode,
      window: 1
    })

    if (!valid) {
      return { success: false }
    }

    // Generate backup codes
    const backupCodes = generateBackupCodes()

    // Encrypt backup codes for storage
    const encryptedBackupCodes = encryptData(JSON.stringify(backupCodes), userId)
    const now = new Date().toISOString()

    // Save with both TOTP secret and encrypted backup codes
    await repos.users.update(userId, {
      totp: {
        ciphertext: encryptedSecret,
        iv: encryptedIv,
        authTag: encryptedAuthTag,
        enabled: true,
        verifiedAt: now,
      },
      backupCodes: {
        ciphertext: encryptedBackupCodes.encrypted,
        iv: encryptedBackupCodes.iv,
        authTag: encryptedBackupCodes.authTag,
        createdAt: now,
      },
    })

    logger.info('TOTP enabled with backup codes', {
      context: 'enableTOTP',
      userId,
      backupCodeCount: backupCodes.length,
    })

    return { success: true, backupCodes }
  } catch (error) {
    logger.error('Enable TOTP error', { context: 'enableTOTP', userId }, error instanceof Error ? error : undefined)
    return { success: false }
  }
}

/**
 * Disable TOTP for a user
 * Also clears backup codes
 */
export async function disableTOTP(userId: string): Promise<boolean> {
  try {
    const repos = getRepositories()
    await repos.users.update(userId, {
      totp: undefined,
      backupCodes: undefined,
    })

    logger.info('TOTP disabled', { context: 'disableTOTP', userId })

    return true
  } catch (error) {
    logger.error('Disable TOTP error', { context: 'disableTOTP', userId }, error instanceof Error ? error : undefined)
    return false
  }
}

/**
 * Regenerate backup codes for a user
 * Used when user has lost their backup codes or wants new ones
 */
export async function regenerateBackupCodes(userId: string): Promise<{ success: boolean; backupCodes?: string[] }> {
  try {
    const repos = getRepositories()
    const user = await repos.users.findById(userId)

    if (!user?.totp?.enabled) {
      logger.warn('Cannot regenerate backup codes - TOTP not enabled', { context: 'regenerateBackupCodes', userId })
      return { success: false }
    }

    // Generate new backup codes
    const backupCodes = generateBackupCodes()

    // Encrypt and store
    const encryptedBackupCodes = encryptData(JSON.stringify(backupCodes), userId)
    const now = new Date().toISOString()

    await repos.users.update(userId, {
      backupCodes: {
        ciphertext: encryptedBackupCodes.encrypted,
        iv: encryptedBackupCodes.iv,
        authTag: encryptedBackupCodes.authTag,
        createdAt: now,
      },
    })

    logger.info('Backup codes regenerated', {
      context: 'regenerateBackupCodes',
      userId,
      backupCodeCount: backupCodes.length,
    })

    return { success: true, backupCodes }
  } catch (error) {
    logger.error('Regenerate backup codes error', { context: 'regenerateBackupCodes', userId }, error instanceof Error ? error : undefined)
    return { success: false }
  }
}

// ============================================================================
// DEVICE TRUST FUNCTIONS
// ============================================================================

/**
 * Parse user agent string into a friendly device name
 */
function parseUserAgent(userAgent: string): string {
  // Simple parsing - can be enhanced with a library like ua-parser-js
  let browser = 'Unknown Browser'
  let os = 'Unknown OS'

  // Detect browser
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
    browser = 'Chrome'
  } else if (userAgent.includes('Firefox')) {
    browser = 'Firefox'
  } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
    browser = 'Safari'
  } else if (userAgent.includes('Edg')) {
    browser = 'Edge'
  }

  // Detect OS
  if (userAgent.includes('Windows')) {
    os = 'Windows'
  } else if (userAgent.includes('Mac OS')) {
    os = 'macOS'
  } else if (userAgent.includes('Linux')) {
    os = 'Linux'
  } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    os = 'iOS'
  } else if (userAgent.includes('Android')) {
    os = 'Android'
  }

  return `${browser} on ${os}`
}

/**
 * Hash a device token for storage
 */
function hashDeviceToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Create a trusted device for a user
 * Returns the raw token to be stored in a cookie
 */
export async function createTrustedDevice(
  userId: string,
  userAgent: string
): Promise<{ token: string; deviceId: string }> {
  const repos = getRepositories()
  const user = await repos.users.findById(userId)

  if (!user) {
    throw new Error('User not found')
  }

  // Generate a cryptographically secure token
  const token = crypto.randomBytes(DEVICE_TOKEN_BYTES).toString('hex')
  const tokenHash = hashDeviceToken(token)
  const deviceId = crypto.randomUUID()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000)

  const newDevice: TrustedDevice = {
    id: deviceId,
    tokenHash,
    name: parseUserAgent(userAgent),
    createdAt: now.toISOString(),
    lastUsedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }

  // Add to existing devices (or create array)
  const existingDevices = user.trustedDevices ?? []
  const updatedDevices = [...existingDevices, newDevice]

  await repos.users.update(userId, {
    trustedDevices: updatedDevices,
  })

  logger.info('Trusted device created', {
    context: 'createTrustedDevice',
    userId,
    deviceId,
    deviceName: newDevice.name,
    expiresAt: expiresAt.toISOString(),
  })

  return { token, deviceId }
}

/**
 * Verify a trusted device token
 * Returns true if valid and not expired, updates lastUsedAt
 */
export async function verifyTrustedDevice(
  userId: string,
  token: string
): Promise<boolean> {
  const repos = getRepositories()
  const user = await repos.users.findById(userId)

  if (!user?.trustedDevices?.length) {
    return false
  }

  const tokenHash = hashDeviceToken(token)
  const now = new Date()

  // Find matching device
  const deviceIndex = user.trustedDevices.findIndex(
    (d) => d.tokenHash === tokenHash
  )

  if (deviceIndex === -1) {
    logger.debug('Trusted device token not found', {
      context: 'verifyTrustedDevice',
      userId,
    })
    return false
  }

  const device = user.trustedDevices[deviceIndex]

  // Check expiration
  if (new Date(device.expiresAt) < now) {
    logger.debug('Trusted device expired', {
      context: 'verifyTrustedDevice',
      userId,
      deviceId: device.id,
      expiredAt: device.expiresAt,
    })
    // Remove expired device
    const updatedDevices = user.trustedDevices.filter((_, i) => i !== deviceIndex)
    await repos.users.update(userId, { trustedDevices: updatedDevices })
    return false
  }

  // Update lastUsedAt
  const updatedDevices = [...user.trustedDevices]
  updatedDevices[deviceIndex] = {
    ...device,
    lastUsedAt: now.toISOString(),
  }

  await repos.users.update(userId, { trustedDevices: updatedDevices })

  logger.debug('Trusted device verified', {
    context: 'verifyTrustedDevice',
    userId,
    deviceId: device.id,
    deviceName: device.name,
  })

  return true
}

/**
 * List trusted devices for a user (without sensitive token hash)
 */
export async function listTrustedDevices(userId: string): Promise<Omit<TrustedDevice, 'tokenHash'>[]> {
  const repos = getRepositories()
  const user = await repos.users.findById(userId)

  if (!user?.trustedDevices) {
    return []
  }

  // Filter out expired devices and remove tokenHash from response
  const now = new Date()
  return user.trustedDevices
    .filter((d) => new Date(d.expiresAt) > now)
    .map(({ tokenHash: _tokenHash, ...rest }) => rest)
}

/**
 * Revoke a specific trusted device
 */
export async function revokeTrustedDevice(
  userId: string,
  deviceId: string
): Promise<boolean> {
  const repos = getRepositories()
  const user = await repos.users.findById(userId)

  if (!user?.trustedDevices) {
    return false
  }

  const initialLength = user.trustedDevices.length
  const updatedDevices = user.trustedDevices.filter((d) => d.id !== deviceId)

  if (updatedDevices.length === initialLength) {
    logger.debug('Device not found for revocation', {
      context: 'revokeTrustedDevice',
      userId,
      deviceId,
    })
    return false
  }

  await repos.users.update(userId, {
    trustedDevices: updatedDevices.length > 0 ? updatedDevices : undefined,
  })

  logger.info('Trusted device revoked', {
    context: 'revokeTrustedDevice',
    userId,
    deviceId,
  })

  return true
}

/**
 * Revoke all trusted devices for a user
 */
export async function revokeAllTrustedDevices(userId: string): Promise<number> {
  const repos = getRepositories()
  const user = await repos.users.findById(userId)

  const count = user?.trustedDevices?.length ?? 0

  if (count === 0) {
    return 0
  }

  await repos.users.update(userId, {
    trustedDevices: undefined,
  })

  logger.info('All trusted devices revoked', {
    context: 'revokeAllTrustedDevices',
    userId,
    revokedCount: count,
  })

  return count
}
