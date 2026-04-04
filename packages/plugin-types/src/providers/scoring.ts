/**
 * Scoring Provider — Shape 4: Text + Candidates -> Scores
 *
 * Send content (and optionally candidates or labels) to a scoring model,
 * receive scored categories or ranked results. This generalizes content
 * moderation, reranking, and classification into a single interface shape.
 *
 * ## Supported Tasks
 *
 * ### Moderation (implemented)
 * Score content against safety categories. The provider returns per-category
 * flagged/score pairs (e.g., "violence": 0.95, "hate": 0.02).
 *
 * ```typescript
 * const result = await provider.score({
 *   content: 'some user message',
 *   task: 'moderation',
 * }, apiKey);
 * // result.flagged = true, result.categories = [{ category: 'violence', flagged: true, score: 0.95 }, ...]
 * ```
 *
 * ### Reranking (future)
 * Given a query and candidate passages, score each passage by relevance.
 * Uses `candidates` field to pass the passages to rank.
 *
 * ```typescript
 * const result = await provider.score({
 *   content: 'What is the capital of France?',
 *   task: 'reranking',
 *   candidates: ['Paris is the capital of France.', 'London is in England.', ...],
 * }, apiKey);
 * // result.categories = [{ category: '0', score: 0.98 }, { category: '1', score: 0.12 }, ...]
 * ```
 *
 * ### Classification (future)
 * Classify content into one or more predefined labels.
 * Uses `labels` field to define the classification categories.
 *
 * ```typescript
 * const result = await provider.score({
 *   content: 'I love this product!',
 *   task: 'classification',
 *   labels: ['positive', 'negative', 'neutral'],
 * }, apiKey);
 * // result.categories = [{ category: 'positive', flagged: true, score: 0.92 }, ...]
 * ```
 *
 * @module @quilltap/plugin-types/providers/scoring
 */

/**
 * The type of scoring task to perform
 */
export type ScoringTask = 'moderation' | 'reranking' | 'classification';

/**
 * Input for a scoring operation
 */
export interface ScoringInput {
  /** The primary text to score */
  content: string;
  /** The scoring task type */
  task: ScoringTask;
  /**
   * Candidate passages for reranking.
   * Each candidate is scored against the content (used as query).
   */
  candidates?: string[];
  /**
   * Label set for classification.
   * Content is classified into these categories.
   */
  labels?: string[];
  /** Task-specific options */
  options?: Record<string, unknown>;
}

/**
 * A single category/label score
 */
export interface CategoryScore {
  /** Category or label name (e.g., 'violence', 'positive', or candidate index) */
  category: string;
  /** Whether this category was triggered/flagged */
  flagged: boolean;
  /** Confidence score (0-1) */
  score: number;
}

/**
 * Result from a scoring operation
 */
export interface ScoringResult {
  /** Overall flagged status (for moderation) or top match (for classification) */
  flagged: boolean;
  /** Per-category/label breakdown with scores */
  categories: CategoryScore[];
  /** Which task produced this result */
  task: ScoringTask;
}

/**
 * Scoring provider interface — Shape 4: Text + Candidates -> Scores
 *
 * Sends content to a scoring model and receives scored categories,
 * ranked results, or classification labels. Generalizes moderation,
 * reranking, and classification into a single provider shape.
 */
export interface ScoringProvider {
  /**
   * Score content according to the specified task
   *
   * @param input The scoring input with content, task type, and optional candidates/labels
   * @param apiKey The API key for authentication
   * @param baseUrl Optional base URL for the scoring API
   * @returns Scored results with per-category breakdown
   */
  score(input: ScoringInput, apiKey: string, baseUrl?: string): Promise<ScoringResult>;

  /**
   * Get the scoring tasks this provider supports
   *
   * @returns Array of supported task types
   */
  getSupportedTasks(): ScoringTask[];

  /**
   * Validate an API key for this provider (optional)
   *
   * @param apiKey The API key to validate
   * @param baseUrl Optional base URL
   * @returns True if valid
   */
  validateApiKey?(apiKey: string, baseUrl?: string): Promise<boolean>;
}
