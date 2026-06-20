/**
 * Groups API v1 - Zod Schemas
 *
 * Validation schemas for group route requests
 */

import { z } from 'zod';

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
});

export const addMemberSchema = z.object({
  characterId: z.uuid(),
});

export const removeMemberSchema = z.object({
  characterId: z.uuid(),
});
