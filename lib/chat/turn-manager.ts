/**
 * Turn Manager Module
 * Multi-Character Chat System - Phase 2
 *
 * Provides turn-based dialogue management for multi-character chats.
 * Handles turn selection algorithm, queue management, and turn state tracking.
 *
 * This file re-exports all functionality from the decomposed turn-manager modules
 * for backwards compatibility. New code should import directly from the specific
 * modules when possible:
 *
 * @example
 * // Preferred: Import from specific modules
 * import { selectNextSpeaker } from '@/lib/chat/turn-manager/selection';
 * import { createInitialTurnState } from '@/lib/chat/turn-manager/state';
 *
 * // Also supported: Import from barrel
 * import { selectNextSpeaker, createInitialTurnState } from '@/lib/chat/turn-manager';
 *
 * @module lib/chat/turn-manager
 */

export * from './turn-manager/index';
