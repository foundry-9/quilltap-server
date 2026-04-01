/**
 * OAuth State Management
 *
 * Manages PKCE code verifiers and state tokens for OAuth flows.
 * Uses encrypted cookies for secure storage.
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { generateState, generateCodeVerifier } from 'arctic';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

// Cookie names
const OAUTH_STATE_COOKIE = 'qt_oauth_state';
const OAUTH_VERIFIER_COOKIE = 'qt_oauth_verifier';
const OAUTH_CALLBACK_COOKIE = 'qt_oauth_callback';

// Cookie expiry (10 minutes for OAuth flow)
const OAUTH_COOKIE_MAX_AGE = 10 * 60;

// Get master pepper for encryption
const MASTER_PEPPER = process.env.ENCRYPTION_MASTER_PEPPER || '';

/**
 * Generate a simple encryption key from pepper
 */
function getEncryptionKey(): Buffer {
  return crypto.pbkdf2Sync('oauth-state-key', MASTER_PEPPER, 10000, 32, 'sha256');
}

/**
 * Encrypt a value for cookie storage
 */
function encryptValue(value: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', new Uint8Array(key), new Uint8Array(iv));

  let encrypted = cipher.update(value, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Combine iv + authTag + encrypted
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt a value from cookie storage
 */
function decryptValue(encrypted: string): string | null {
  try {
    const parts = encrypted.split(':');
    if (parts.length !== 3) return null;

    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = new Uint8Array(Buffer.from(ivHex, 'hex'));
    const authTag = new Uint8Array(Buffer.from(authTagHex, 'hex'));

    const decipher = crypto.createDecipheriv('aes-256-gcm', new Uint8Array(key), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    logger.warn('Failed to decrypt OAuth state', {
      context: 'state.decryptValue',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Get cookie options for OAuth state cookies
 */
function getCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: OAUTH_COOKIE_MAX_AGE,
  };
}

/**
 * OAuth state data structure
 */
export interface OAuthState {
  state: string;
  codeVerifier: string;
  callbackUrl: string;
}

/**
 * Generate OAuth state and store in cookies
 *
 * @param response - NextResponse to set cookies on
 * @param callbackUrl - URL to redirect to after OAuth
 * @returns Generated state and code verifier
 */
export function generateOAuthState(
  response: NextResponse,
  callbackUrl: string = '/dashboard'
): OAuthState {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();

  const options = getCookieOptions();

  // Encrypt values before storing
  response.cookies.set(OAUTH_STATE_COOKIE, encryptValue(state), options);
  response.cookies.set(OAUTH_VERIFIER_COOKIE, encryptValue(codeVerifier), options);
  response.cookies.set(OAUTH_CALLBACK_COOKIE, encryptValue(callbackUrl), options);

  logger.debug('OAuth state generated', {
    context: 'state.generateOAuthState',
    callbackUrl,
  });

  return { state, codeVerifier, callbackUrl };
}

/**
 * Retrieve and verify OAuth state from cookies
 *
 * @param request - NextRequest to get cookies from
 * @param expectedState - State value from OAuth callback
 * @returns Stored OAuth data if valid, null otherwise
 */
export function retrieveOAuthState(
  request: NextRequest,
  expectedState: string
): { codeVerifier: string; callbackUrl: string } | null {
  const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE);
  const verifierCookie = request.cookies.get(OAUTH_VERIFIER_COOKIE);
  const callbackCookie = request.cookies.get(OAUTH_CALLBACK_COOKIE);

  if (!stateCookie?.value || !verifierCookie?.value) {
    logger.debug('OAuth state cookies not found', {
      context: 'state.retrieveOAuthState',
    });
    return null;
  }

  const storedState = decryptValue(stateCookie.value);
  const codeVerifier = decryptValue(verifierCookie.value);
  const callbackUrl = callbackCookie?.value ? decryptValue(callbackCookie.value) : '/dashboard';

  if (!storedState || !codeVerifier) {
    logger.debug('Failed to decrypt OAuth state', {
      context: 'state.retrieveOAuthState',
    });
    return null;
  }

  // Verify state matches
  if (storedState !== expectedState) {
    logger.warn('OAuth state mismatch', {
      context: 'state.retrieveOAuthState',
    });
    return null;
  }

  logger.debug('OAuth state verified', {
    context: 'state.retrieveOAuthState',
    callbackUrl,
  });

  return { codeVerifier, callbackUrl: callbackUrl || '/dashboard' };
}

/**
 * Clear OAuth state cookies
 *
 * @param response - NextResponse to clear cookies on
 */
export function clearOAuthState(response: NextResponse): void {
  const clearOptions = {
    ...getCookieOptions(),
    maxAge: 0,
  };

  response.cookies.set(OAUTH_STATE_COOKIE, '', clearOptions);
  response.cookies.set(OAUTH_VERIFIER_COOKIE, '', clearOptions);
  response.cookies.set(OAUTH_CALLBACK_COOKIE, '', clearOptions);

  logger.debug('OAuth state cleared', {
    context: 'state.clearOAuthState',
  });
}

/**
 * Clear OAuth state cookies using the cookies() API
 */
export async function clearOAuthStateFromAction(): Promise<void> {
  const cookieStore = await cookies();
  const clearOptions = {
    ...getCookieOptions(),
    maxAge: 0,
  };

  cookieStore.set(OAUTH_STATE_COOKIE, '', clearOptions);
  cookieStore.set(OAUTH_VERIFIER_COOKIE, '', clearOptions);
  cookieStore.set(OAUTH_CALLBACK_COOKIE, '', clearOptions);

  logger.debug('OAuth state cleared from action', {
    context: 'state.clearOAuthStateFromAction',
  });
}
