/**
 * Mock for jose library
 * Provides mock implementations for JWT operations used in tests
 *
 * This mock creates real-looking JWT tokens (base64-encoded header.payload.signature)
 * so that tests checking JWT format will pass.
 */

import { jest } from '@jest/globals';

// Storage for the last created payload (for verification)
let lastCreatedPayload: Record<string, unknown> | null = null;

// Control variable to simulate verification failures
let shouldVerifyFail = false;
let verifyError: Error | null = null;

/**
 * Create a mock JWT token with proper format
 */
function createMockJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  // Mock signature - just a deterministic hash-like string
  const signature = Buffer.from('mock-signature-' + payload.sub).toString('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Decode a mock JWT token
 */
function decodeMockJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return { header, payload };
  } catch {
    return null;
  }
}

/**
 * SignJWT mock class
 */
export class SignJWT {
  private payload: Record<string, unknown>;
  private header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' };

  constructor(payload: Record<string, unknown>) {
    this.payload = { ...payload };
  }

  setProtectedHeader(header: Record<string, unknown>): this {
    this.header = header;
    return this;
  }

  setIssuedAt(iat?: number): this {
    this.payload.iat = iat ?? Math.floor(Date.now() / 1000);
    return this;
  }

  setExpirationTime(exp: number | string): this {
    if (typeof exp === 'number') {
      this.payload.exp = exp;
    } else {
      // Handle string like '7d'
      this.payload.exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    }
    return this;
  }

  setSubject(sub: string): this {
    this.payload.sub = sub;
    return this;
  }

  async sign(_key: Uint8Array): Promise<string> {
    // Store the payload for verification
    lastCreatedPayload = { ...this.payload };
    return createMockJwt(this.payload);
  }
}

/**
 * jwtVerify mock function
 *
 * Decodes the token and validates expiration, simulating real jose behavior
 */
export const jwtVerify = jest.fn(
  async (
    token: string,
    _key: Uint8Array,
    _options?: { algorithms?: string[] }
  ): Promise<{ payload: Record<string, unknown>; protectedHeader: Record<string, unknown> }> => {
    // Check for forced failures
    if (shouldVerifyFail && verifyError) {
      throw verifyError;
    }

    // Handle empty or invalid token
    if (!token || typeof token !== 'string') {
      throw new JWSSignatureVerificationFailed('signature verification failed');
    }

    // Decode the token
    const decoded = decodeMockJwt(token);
    if (!decoded) {
      throw new JWSSignatureVerificationFailed('signature verification failed');
    }

    const { payload, header } = decoded;

    // Check signature validity by comparing to expected mock signature format
    const parts = token.split('.');
    const expectedSigPrefix = Buffer.from('mock-signature-').toString('base64url');
    if (!parts[2].startsWith(expectedSigPrefix)) {
      throw new JWSSignatureVerificationFailed('signature verification failed');
    }

    // Check expiration
    if (payload.exp && typeof payload.exp === 'number') {
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        throw new JWTExpired('JWT expired');
      }
    }

    return {
      payload,
      protectedHeader: header,
    };
  }
);

/**
 * Error classes matching jose's error types
 */
export class JOSEError extends Error {
  code: string;
  constructor(message: string, code = 'ERR_JOSE_GENERIC') {
    super(message);
    this.name = 'JOSEError';
    this.code = code;
  }
}

export class JWTExpired extends JOSEError {
  claim: string;
  reason: string;
  constructor(message = 'JWT expired') {
    super(message, 'ERR_JWT_EXPIRED');
    this.name = 'JWTExpired';
    this.claim = 'exp';
    this.reason = 'check_failed';
  }
}

export class JWTClaimValidationFailed extends JOSEError {
  claim: string;
  reason: string;
  constructor(message = 'JWT claim validation failed', claim = 'unknown') {
    super(message, 'ERR_JWT_CLAIM_VALIDATION_FAILED');
    this.name = 'JWTClaimValidationFailed';
    this.claim = claim;
    this.reason = 'check_failed';
  }
}

export class JWSSignatureVerificationFailed extends JOSEError {
  constructor(message = 'signature verification failed') {
    super(message, 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED');
    this.name = 'JWSSignatureVerificationFailed';
  }
}

/**
 * errors namespace for backwards compatibility
 */
export const errors = {
  JOSEError,
  JWTExpired,
  JWTClaimValidationFailed,
  JWSSignatureVerificationFailed,
};

/**
 * Test helper functions to control mock behavior
 */
export function __setVerifyToFail(error: Error | null): void {
  shouldVerifyFail = error !== null;
  verifyError = error;
}

export function __resetMocks(): void {
  lastCreatedPayload = null;
  shouldVerifyFail = false;
  verifyError = null;
  (jwtVerify as jest.Mock).mockClear();
}

export function __getLastCreatedPayload(): Record<string, unknown> | null {
  return lastCreatedPayload;
}
