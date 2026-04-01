/**
 * RNG (Random Number Generator) Tool Definition
 *
 * Provides a tool interface for LLMs to generate random results:
 * - Dice rolls (any number of sides)
 * - Coin flips
 * - Spin the bottle (random participant selection)
 *
 * Results are permanent chat messages visible to all characters.
 */

/**
 * Type of random generation to perform
 * - number: dice roll with that many sides (e.g., 6 for d6, 20 for d20)
 * - 'flip_coin': coin flip returning heads or tails
 * - 'spin_the_bottle': random selection from chat participants
 */
export type RngType = number | 'flip_coin' | 'spin_the_bottle';

/**
 * Input parameters for the RNG tool
 */
export interface RngToolInput {
  /** Type of random generation - dice sides (number) or special type */
  type: RngType;
  /** Number of times to execute (default: 1, max: 100) */
  rolls?: number;
}

/**
 * Single result from RNG execution
 * - number: for dice rolls
 * - 'heads' | 'tails': for coin flips
 * - string: participant name for spin the bottle
 */
export type RngResult = number | 'heads' | 'tails' | string;

/**
 * Output from the RNG tool
 */
export interface RngToolOutput {
  success: boolean;
  type: RngType;
  rollCount: number;
  results: RngResult[];
  /** Sum of all results (only for numeric dice rolls) */
  sum?: number;
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const rngToolDefinition = {
  type: 'function',
  function: {
    name: 'rng',
    description:
      'Generate random results for games and roleplay. Use for dice rolls, coin flips, or randomly selecting a participant. Results become permanent messages in the chat visible to all characters. Examples: roll a d20, flip a coin, spin the bottle to pick who goes next.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          oneOf: [
            {
              type: 'integer',
              minimum: 2,
              maximum: 1000,
              description: 'Number of sides on the die (e.g., 6 for d6, 20 for d20)',
            },
            {
              type: 'string',
              enum: ['flip_coin', 'spin_the_bottle'],
              description: 'Special random type: flip_coin for heads/tails, spin_the_bottle to select a random participant',
            },
          ],
          description:
            'Type of random generation. Use a number for dice (e.g., 6 for d6, 20 for d20), "flip_coin" for heads/tails, or "spin_the_bottle" to randomly select a chat participant.',
        },
        rolls: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Number of times to roll/flip (default: 1). For dice, this is like rolling multiple dice (e.g., 3 rolls of d6 = 3d6).',
          default: 1,
        },
      },
      required: ['type'],
    },
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateRngInput(input: unknown): input is RngToolInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // type is required
  if (obj.type === undefined) {
    return false;
  }

  // Validate type: must be a positive integer >= 2 or one of the special strings
  if (typeof obj.type === 'number') {
    if (!Number.isInteger(obj.type) || obj.type < 2 || obj.type > 1000) {
      return false;
    }
  } else if (typeof obj.type === 'string') {
    if (obj.type !== 'flip_coin' && obj.type !== 'spin_the_bottle') {
      return false;
    }
  } else {
    return false;
  }

  // Optional rolls parameter
  if (obj.rolls !== undefined) {
    const rolls = Number(obj.rolls);
    if (!Number.isInteger(rolls) || rolls < 1 || rolls > 100) {
      return false;
    }
  }

  return true;
}
