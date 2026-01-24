/**
 * Authentication Type Definitions
 *
 * Contains all authentication-related schemas including user accounts,
 * sessions, TOTP 2FA, trusted devices, and verification tokens.
 *
 * @module schemas/auth.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  EncryptedFieldSchema,
} from './common.types';

// ============================================================================
// TOTP & 2FA
// ============================================================================

export const TOTPSecretSchema = EncryptedFieldSchema.extend({
  enabled: z.boolean().default(false),
  verifiedAt: TimestampSchema.nullable().optional(),
});

export type TOTPSecret = z.infer<typeof TOTPSecretSchema>;

export const BackupCodesSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  authTag: z.string(),
  createdAt: TimestampSchema,
});

export type BackupCodes = z.infer<typeof BackupCodesSchema>;

export const TOTPAttemptsSchema = z.object({
  count: z.number().default(0),
  lastAttempt: TimestampSchema.nullable().optional(),
  lockedUntil: TimestampSchema.nullable().optional(),
});

export type TOTPAttempts = z.infer<typeof TOTPAttemptsSchema>;

export const TrustedDeviceSchema = z.object({
  id: UUIDSchema,
  tokenHash: z.string(),
  name: z.string(),
  createdAt: TimestampSchema,
  lastUsedAt: TimestampSchema,
  expiresAt: TimestampSchema,
});

export type TrustedDevice = z.infer<typeof TrustedDeviceSchema>;

// ============================================================================
// USER
// ============================================================================

export const UserSchema = z.object({
  id: UUIDSchema,
  username: z.string().min(3).max(50),
  email: z.email().nullable().optional(),
  name: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  emailVerified: TimestampSchema.nullable().optional(),

  // Password authentication
  passwordHash: z.string().nullable().optional(),

  // TOTP 2FA
  totp: TOTPSecretSchema.optional(),
  backupCodes: BackupCodesSchema.optional(),
  totpAttempts: TOTPAttemptsSchema.optional(),
  trustedDevices: z.array(TrustedDeviceSchema).optional(),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type User = z.infer<typeof UserSchema>;

// ============================================================================
// ACCOUNT (OAuth/External providers)
// ============================================================================

export const AccountSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  type: z.string(),
  provider: z.string(),
  providerAccountId: z.string(),
  refresh_token: z.string().nullable().optional(),
  access_token: z.string().nullable().optional(),
  expires_at: z.number().nullable().optional(),
  token_type: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  id_token: z.string().nullable().optional(),
  session_state: z.string().nullable().optional(),
});

export type Account = z.infer<typeof AccountSchema>;

// ============================================================================
// SESSION
// ============================================================================

export const SessionSchema = z.object({
  id: UUIDSchema,
  sessionToken: z.string(),
  userId: UUIDSchema,
  expires: TimestampSchema,
});

export type Session = z.infer<typeof SessionSchema>;

// ============================================================================
// VERIFICATION TOKEN
// ============================================================================

export const VerificationTokenSchema = z.object({
  identifier: z.string(),
  token: z.string(),
  expires: TimestampSchema,
});

export type VerificationToken = z.infer<typeof VerificationTokenSchema>;

// ============================================================================
// AUTH ACCOUNTS FILE
// ============================================================================

export const AuthAccountsSchema = z.object({
  version: z.number().default(1),
  accounts: z.array(AccountSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type AuthAccounts = z.infer<typeof AuthAccountsSchema>;
