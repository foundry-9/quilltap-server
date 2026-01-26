/**
 * User Type Definitions (Single-User Mode)
 *
 * Contains the user schema for single-user mode.
 * Authentication-related schemas (TOTP, OAuth, sessions) have been removed.
 *
 * @module schemas/auth.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
} from './common.types';

// ============================================================================
// USER
// ============================================================================

export const UserSchema = z.object({
  id: UUIDSchema,
  username: z.string().min(3).max(50),
  email: z.email().nullable().optional(),
  name: z.string().nullable().optional(),
  image: z.string().nullable().optional(),

  // Legacy fields - kept for backwards compatibility with existing data
  // but no longer used in single-user mode
  emailVerified: TimestampSchema.nullable().optional(),
  passwordHash: z.string().nullable().optional(),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type User = z.infer<typeof UserSchema>;
