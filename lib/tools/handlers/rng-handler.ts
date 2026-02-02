/**
 * RNG (Random Number Generator) Tool Handler
 *
 * Executes random number generation for dice rolls, coin flips,
 * and spin the bottle (random participant selection).
 *
 * Uses crypto.randomBytes() for cryptographically secure random numbers.
 */

import { randomBytes } from 'crypto';
import {
  RngToolInput,
  RngToolOutput,
  RngResult,
  RngType,
  validateRngInput,
} from '../rng-tool';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';

/**
 * Context required for RNG tool execution
 */
export interface RngToolContext {
  /** User ID for authentication and logging */
  userId: string;
  /** Chat ID for spin_the_bottle participant lookup */
  chatId: string;
}

/**
 * Error thrown during RNG execution
 */
export class RngError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'EXECUTION_ERROR' | 'NO_PARTICIPANTS'
  ) {
    super(message);
    this.name = 'RngError';
  }
}

/**
 * Generate a cryptographically secure random integer in range [1, max]
 * Uses rejection sampling to avoid modulo bias
 */
function secureRandomInt(max: number): number {
  if (max < 1) return 1;

  // Calculate how many bytes we need
  const bytesNeeded = Math.ceil(Math.log2(max + 1) / 8) || 1;
  const maxValue = 256 ** bytesNeeded;
  const limit = maxValue - (maxValue % max);

  let value: number;
  do {
    const bytes = randomBytes(bytesNeeded);
    value = bytes.reduce((acc, byte, i) => acc + byte * (256 ** i), 0);
  } while (value >= limit);

  return (value % max) + 1;
}

/**
 * Execute a dice roll
 */
function rollDice(sides: number, count: number): { results: number[]; sum: number } {
  const results: number[] = [];
  let sum = 0;

  for (let i = 0; i < count; i++) {
    const roll = secureRandomInt(sides);
    results.push(roll);
    sum += roll;
  }

  return { results, sum };
}

/**
 * Execute a coin flip
 */
function flipCoin(count: number): RngResult[] {
  const results: RngResult[] = [];

  for (let i = 0; i < count; i++) {
    const flip = secureRandomInt(2);
    results.push(flip === 1 ? 'heads' : 'tails');
  }

  return results;
}

/**
 * Get all active participants from a chat for spin the bottle
 * Includes both AI-controlled and user-controlled characters
 */
async function getChatParticipants(chatId: string, userId: string): Promise<string[]> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(chatId);

  if (!chat || chat.userId !== userId) {
    return [];
  }

  const participants: string[] = [];

  for (const p of chat.participants) {
    if (!p.isActive) continue;

    // All participants are type 'CHARACTER' - look up character name
    if (p.characterId) {
      const character = await repos.characters.findById(p.characterId);
      if (character) {
        participants.push(character.name);
      }
    }
  }

  return participants;
}

/**
 * Execute spin the bottle - randomly select a participant
 */
async function spinTheBottle(
  count: number,
  chatId: string,
  userId: string
): Promise<{ results: string[]; error?: string }> {
  const participants = await getChatParticipants(chatId, userId);

  if (participants.length === 0) {
    return { results: [], error: 'No active participants found in chat' };
  }

  if (participants.length === 1) {
    // Only one participant - just return them for each spin
    return { results: Array(count).fill(participants[0]) };
  }

  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    const index = secureRandomInt(participants.length) - 1;
    results.push(participants[index]);
  }

  return { results };
}

/**
 * Execute the RNG tool
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID and chat ID
 * @returns Tool output with random results
 */
export async function executeRngTool(
  input: unknown,
  context: RngToolContext
): Promise<RngToolOutput> {
  try {
    // Validate input
    if (!validateRngInput(input)) {
      logger.warn('RNG validation failed', { userId: context.userId, input });
      return {
        success: false,
        type: typeof input === 'object' && input !== null && 'type' in input
          ? (input as Record<string, unknown>).type as RngType
          : 6,
        rollCount: 0,
        results: [],
        error: 'Invalid input: type must be a number (2-1000 for dice sides) or "flip_coin" or "spin_the_bottle"',
      };
    }

    const { type, rolls = 1 } = input;

    logger.debug('Executing RNG tool', {
      userId: context.userId,
      chatId: context.chatId,
      type,
      rolls,
    });

    // Handle dice roll
    if (typeof type === 'number') {
      const { results, sum } = rollDice(type, rolls);

      logger.info('RNG dice roll completed', {
        userId: context.userId,
        chatId: context.chatId,
        sides: type,
        rolls,
        results,
        sum,
      });

      return {
        success: true,
        type,
        rollCount: rolls,
        results,
        sum,
      };
    }

    // Handle coin flip
    if (type === 'flip_coin') {
      const results = flipCoin(rolls);

      logger.info('RNG coin flip completed', {
        userId: context.userId,
        chatId: context.chatId,
        rolls,
        results,
      });

      return {
        success: true,
        type,
        rollCount: rolls,
        results,
      };
    }

    // Handle spin the bottle
    if (type === 'spin_the_bottle') {
      const { results, error } = await spinTheBottle(rolls, context.chatId, context.userId);

      if (error) {
        logger.warn('RNG spin the bottle failed', {
          userId: context.userId,
          chatId: context.chatId,
          error,
        });

        return {
          success: false,
          type,
          rollCount: 0,
          results: [],
          error,
        };
      }

      logger.info('RNG spin the bottle completed', {
        userId: context.userId,
        chatId: context.chatId,
        rolls,
        results,
      });

      return {
        success: true,
        type,
        rollCount: rolls,
        results,
      };
    }

    // Should not reach here due to validation
    return {
      success: false,
      type,
      rollCount: 0,
      results: [],
      error: 'Unknown RNG type',
    };
  } catch (error) {
    logger.error('RNG tool execution failed', { userId: context.userId, chatId: context.chatId }, error instanceof Error ? error : undefined);
    return {
      success: false,
      type: typeof input === 'object' && input !== null && 'type' in input
        ? (input as Record<string, unknown>).type as RngType
        : 6,
      rollCount: 0,
      results: [],
      error: error instanceof Error ? error.message : 'Unknown error during RNG execution',
    };
  }
}

/**
 * Format RNG results for inclusion in conversation context
 *
 * @param output - RNG tool output to format
 * @returns Formatted string suitable for LLM context and display
 */
export function formatRngResults(output: RngToolOutput): string {
  if (!output.success) {
    return `RNG Error: ${output.error || 'Unknown error'}`;
  }

  const { type, results, rollCount, sum } = output;

  // Format dice roll
  if (typeof type === 'number') {
    if (rollCount === 1) {
      return `Rolled a d${type}: **${results[0]}**`;
    }
    return `Rolled ${rollCount}d${type}: [${results.join(', ')}] = **${sum}** total`;
  }

  // Format coin flip
  if (type === 'flip_coin') {
    if (rollCount === 1) {
      return `Coin flip result: **${results[0]}**`;
    }
    const headsCount = results.filter(r => r === 'heads').length;
    const tailsCount = results.filter(r => r === 'tails').length;
    return `Flipped ${rollCount} coins: [${results.join(', ')}] (${headsCount} heads, ${tailsCount} tails)`;
  }

  // Format spin the bottle
  if (type === 'spin_the_bottle') {
    if (rollCount === 1) {
      return `The bottle points to: **${results[0]}**`;
    }
    return `Spun the bottle ${rollCount} times: [${results.join(', ')}]`;
  }

  return `RNG result: ${results.join(', ')}`;
}
