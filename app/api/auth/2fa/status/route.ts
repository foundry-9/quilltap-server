import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'

/**
 * GET /api/auth/2fa/status
 * Returns the user's 2FA status (enabled or not)
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const repos = getRepositories()
    const user = await repos.users.findById(session.user.id)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const totpEnabled = user.totp?.enabled ?? false
    const hasBackupCodes = !!user.backupCodes?.ciphertext

    logger.debug('2FA status checked', {
      context: 'GET /api/auth/2fa/status',
      userId: session.user.id,
      totpEnabled,
      hasBackupCodes,
    })

    return NextResponse.json({
      totpEnabled,
      hasBackupCodes,
      enabledAt: user.totp?.verifiedAt ?? null,
    })
  } catch (error) {
    logger.error('2FA status check error', { context: 'GET /api/auth/2fa/status' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to check 2FA status' },
      { status: 500 }
    )
  }
}
