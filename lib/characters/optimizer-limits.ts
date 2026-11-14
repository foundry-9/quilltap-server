/**
 * Limits shared by the Character Optimizer's request schema (server) and its
 * preflight form (client). Client-safe: no server imports.
 */

/** Longest author's-instructions text a refinement run accepts. */
export const OPTIMIZER_INSTRUCTIONS_MAX_LENGTH = 8000;
