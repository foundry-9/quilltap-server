import { NextRequest, NextResponse } from 'next/server'
import { getRepositories } from '@/lib/repositories/factory'
import { hashPassword, validatePasswordStrength } from '@/lib/auth/password'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const SignupSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username must be at most 50 characters'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { username, password, name } = SignupSchema.parse(body)

    logger.debug('Processing signup request', { context: 'POST /api/auth/signup', username })

    // Validate password strength
    const validation = validatePasswordStrength(password)
    if (!validation.valid) {
      logger.debug('Password validation failed', { context: 'POST /api/auth/signup', errors: validation.errors })
      return NextResponse.json(
        { error: 'Password does not meet requirements', details: validation.errors },
        { status: 400 }
      )
    }

    const repos = getRepositories()

    // Check if user already exists
    const existing = await repos.users.findByUsername(username)

    if (existing) {
      logger.debug('Username already exists', { context: 'POST /api/auth/signup', username })
      return NextResponse.json(
        { error: 'User with this username already exists' },
        { status: 409 }
      )
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Create user
    const user = await repos.users.create({
      username,
      name: name || null,
      passwordHash,
    })

    logger.info('User created successfully', { context: 'POST /api/auth/signup', userId: user.id, username })

    return NextResponse.json({
      message: 'Account created successfully',
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
      }
    }, { status: 201 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Signup error', { context: 'POST /api/auth/signup' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    )
  }
}
