/**
 * JWT Session Management
 *
 * Creates and verifies JWT tokens for session management.
 * Uses HMAC-SHA256 with a secret derived from the master pepper.
 */

import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

// Session configuration
const SESSION_EXPIRY_HOURS = 24 * 7; // 7 days
const SESSION_REFRESH_THRESHOLD_HOURS = 24; // Refresh if less than 1 day remaining

// JWT algorithm
const JWT_ALGORITHM = 'HS256';

// Skip validation during build time
const SKIP_ENV_VALIDATION = process.env.SKIP_ENV_VALIDATION === 'true';

// Get master pepper for key derivation
const MASTER_PEPPER = process.env.ENCRYPTION_MASTER_PEPPER || '';

if (!SKIP_ENV_VALIDATION && !MASTER_PEPPER) {
  throw new Error(
    'ENCRYPTION_MASTER_PEPPER environment variable is required for session management'
  );
}

/**
 * Derive JWT signing key from master pepper
 * Uses PBKDF2 with a fixed salt for deterministic key derivation
 */
function getSigningKey(): Uint8Array {
  const key = crypto.pbkdf2Sync(
    'jwt-session-key', // Fixed purpose identifier
    MASTER_PEPPER,
    100000,
    32,
    'sha256'
  );
  return new Uint8Array(key);
}

/**
 * Session payload stored in JWT
 */
export interface SessionPayload {
  userId: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

/**
 * Decoded session with metadata
 */
export interface DecodedSession extends SessionPayload {
  iat: number;
  exp: number;
}

/**
 * Create a signed JWT session token
 *
 * @param user - User data to include in the session
 * @returns Signed JWT string
 */
export async function createSessionToken(user: SessionPayload): Promise<string> {
  if (!user.userId || !user.email) {
    throw new Error('userId and email are required for session token');
  }

  const signingKey = getSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_EXPIRY_HOURS * 60 * 60;

  const token = await new SignJWT({
    userId: user.userId,
    email: user.email,
    name: user.name ?? null,
    image: user.image ?? null,
  })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setSubject(user.userId)
    .sign(signingKey);
  return token;
}

/**
 * Verify and decode a JWT session token
 *
 * @param token - The JWT string to verify
 * @returns Decoded session payload, or null if invalid/expired
 */
export async function verifySessionToken(
  token: string
): Promise<DecodedSession | null> {
  if (!token) {
    return null;
  }

  try {
    const signingKey = getSigningKey();
    const { payload } = await jwtVerify(token, signingKey, {
      algorithms: [JWT_ALGORITHM],
    });

    // Validate required fields
    if (!payload.userId || !payload.email || !payload.sub) {
      return null;
    }

    return {
      userId: payload.userId as string,
      email: payload.email as string,
      name: (payload.name as string | null) ?? null,
      image: (payload.image as string | null) ?? null,
      iat: payload.iat as number,
      exp: payload.exp as number,
    };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
    } else if (error instanceof joseErrors.JWTClaimValidationFailed) {
    } else if (error instanceof joseErrors.JWSSignatureVerificationFailed) {
      logger.warn('Session token signature verification failed', {
        context: 'jwt.verifySessionToken',
      });
    } else {
      logger.error(
        'Session token verification error',
        { context: 'jwt.verifySessionToken' },
        error instanceof Error ? error : undefined
      );
    }
    return null;
  }
}

/**
 * Check if a session token needs refreshing
 *
 * @param session - Decoded session to check
 * @returns true if the token should be refreshed
 */
export function shouldRefreshToken(session: DecodedSession): boolean {
  const now = Math.floor(Date.now() / 1000);
  const timeRemaining = session.exp - now;
  const refreshThreshold = SESSION_REFRESH_THRESHOLD_HOURS * 60 * 60;

  return timeRemaining < refreshThreshold;
}

/**
 * Refresh a session token with a new expiry
 *
 * @param session - The current decoded session
 * @returns New JWT token string
 */
export async function refreshSessionToken(
  session: DecodedSession
): Promise<string> {
  return createSessionToken({
    userId: session.userId,
    email: session.email,
    name: session.name,
    image: session.image,
  });
}

/**
 * Get session expiry configuration
 */
export function getSessionConfig() {
  return {
    expiryHours: SESSION_EXPIRY_HOURS,
    refreshThresholdHours: SESSION_REFRESH_THRESHOLD_HOURS,
  };
}
