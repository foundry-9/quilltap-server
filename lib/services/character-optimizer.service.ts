/**
 * Character Optimizer Service
 *
 * Analyzes a character's reinforced memories to identify behavioral patterns
 * that should be reflected in their configuration. Provides suggestions for
 * updating character fields (description, personality, scenario, etc.) based
 * on demonstrated behavior across interactions.
 *
 * Follows the same LLM orchestration pattern as ai-import.service.ts with
 * streaming progress updates and structured JSON responses.
 */

import { createLLMProvider } from '@/lib/llm';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { logLLMCall } from '@/lib/services/llm-logging.service';
import { logger } from '@/lib/logger';
import { rankMemoriesByWeight } from '@/lib/memory/memory-weighting';
import { parseLLMJson, stripCodeFences } from '@/lib/services/ai-import.service';
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service';
import { getCharacterVectorStore } from '@/lib/embedding/vector-store';
import { isEmbeddingAvailable } from '@/lib/embedding/embedding-service';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { Character, Memory } from '@/lib/schemas/types';

// ============================================================================
// Types
// ============================================================================

export interface OptimizerSuggestion {
  id: string;
  field: 'description' | 'personality' | 'scenario' | 'exampleDialogues' | 'systemPrompt' | 'physicalDescription' | 'clothingRecord' | 'talkativeness';
  subId?: string;
  subName?: string;
  currentValue: string;
  proposedValue: string;
  rationale: string;
  significance: number;
  memoryExcerpts: string[];
}

export interface BehavioralPattern {
  pattern: string;
  evidence: string;
  frequency: string;
}

export interface OptimizerAnalysis {
  behavioralPatterns: BehavioralPattern[];
  summary: string;
}

export type OptimizerProgressEventType = 'start' | 'step_start' | 'step_complete' | 'done' | 'error';
export type OptimizerStepName = 'loading' | 'analyzing' | 'generating';

export interface OptimizerProgressEvent {
  type: OptimizerProgressEventType;
  step?: OptimizerStepName;
  analysis?: OptimizerAnalysis;
  suggestions?: OptimizerSuggestion[];
  error?: string;
  memoryCount?: number;
  filteredCount?: number;
}

export type OptimizerProgressCallback = (event: OptimizerProgressEvent) => void;

export interface OptimizerOptions {
  maxMemories?: number;
  searchQuery?: string;
  useSemanticSearch?: boolean;
  sinceDate?: string | null;
  beforeDate?: string | null;
}

// ============================================================================
// Constants
// ============================================================================

const SYSTEM_MESSAGE = `You are a character analysis assistant for Quilltap, a creative writing and roleplay platform. Your job is to analyze a character's accumulated memories and identify behavioral patterns that should be reflected in their configuration. Always respond with ONLY valid JSON — no markdown code fences, no explanations, no extra text.`;

const MIN_REINFORCED_MEMORIES = 2;
const MAX_MEMORIES_FOR_ANALYSIS = 30;
const MIN_SIGNIFICANCE_THRESHOLD = 0.3;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build character context string from character data
 */
export function buildCharacterContext(character: Character): string {
  const parts: string[] = [
    `=== Character: ${character.name} ===`,
    '',
    `Description:`,
    character.description || '(empty)',
    '',
    `Personality:`,
    character.personality || '(empty)',
    '',
    `Scenario:`,
    character.scenario || '(empty)',
    '',
    `Example Dialogues:`,
    character.exampleDialogues || '(empty)',
    '',
    `Talkativeness: ${character.talkativeness}`,
  ];

  if (character.systemPrompts && character.systemPrompts.length > 0) {
    parts.push('');
    parts.push('=== System Prompts ===');
    for (const sp of character.systemPrompts) {
      parts.push(`[System Prompt: "${sp.name}" (ID: ${sp.id})]`);
      parts.push(sp.content);
      parts.push('');
    }
  }

  if (character.physicalDescriptions && character.physicalDescriptions.length > 0) {
    parts.push('=== Physical Descriptions ===');
    for (const pd of character.physicalDescriptions) {
      parts.push(`[Physical Description: "${pd.name}" (ID: ${pd.id})]`);
      parts.push(`Short: ${pd.shortPrompt || '(empty)'}`);
      parts.push(`Medium: ${pd.mediumPrompt || '(empty)'}`);
      parts.push(`Long: ${pd.longPrompt || '(empty)'}`);
      parts.push(`Complete: ${pd.completePrompt || '(empty)'}`);
      parts.push(`Full: ${pd.fullDescription || '(empty)'}`);
      parts.push('');
    }
  }

  if (character.clothingRecords && character.clothingRecords.length > 0) {
    parts.push('=== Clothing Records ===');
    for (const cr of character.clothingRecords) {
      parts.push(`[Clothing Record: "${cr.name}" (ID: ${cr.id})]`);
      parts.push(cr.description || '(empty)');
      parts.push('');
    }
  }

  return parts.join('\n');
}

/**
 * Build memory context string from ranked memories
 */
export function buildMemoryContext(memories: Array<{ memory: Memory }>): string {
  const parts: string[] = [
    `=== Reinforced Memories (top ${memories.length}) ===`,
  ];

  for (let i = 0; i < memories.length; i++) {
    const { memory } = memories[i];
    parts.push(`[Memory #${i + 1}] (reinforced ${memory.reinforcementCount} times): ${memory.content}`);
  }

  return parts.join('\n');
}

/**
 * Get analysis prompt
 */
export function getAnalysisPrompt(): string {
  return `Analyze this character's configuration alongside their most-reinforced memories. Identify 3-8 behavioral patterns that are established in the memories but not fully captured in the character's current configuration.

Focus on HOW the character acts, speaks, and relates to others — not just facts about them. Look for:
- Speech habits and verbal patterns
- Emotional tendencies and reactions
- Relationship dynamics
- Behavioral quirks or consistent actions
- Attitudes and worldview that emerge through interactions

Respond with JSON:
{
  "behavioralPatterns": [
    {
      "pattern": "Brief description of the behavioral pattern",
      "evidence": "Specific examples from the memories that demonstrate this pattern",
      "frequency": "How often this appears across the memories"
    }
  ],
  "summary": "A 2-3 sentence overview of how the character has evolved through their interactions, highlighting the gap between their current configuration and their demonstrated behavior."
}`;
}

/**
 * Get suggestions prompt
 */
export function getSuggestionsPrompt(analysis: OptimizerAnalysis): string {
  return `Based on the behavioral analysis below and the character's current configuration, propose specific modifications to the character's fields that would better reflect their demonstrated behavior.

=== Behavioral Analysis ===
${JSON.stringify(analysis, null, 2)}

For each suggestion, specify exactly which field to modify and provide the complete new value for that field. Preserve the character's existing voice and style while incorporating the behavioral patterns.

Rules:
- For system prompts, modify existing ones rather than proposing entirely new content
- For text fields (description, personality, scenario, exampleDialogues), provide the complete new text
- For talkativeness, provide a number between 0.1 and 1.0
- Assign a significance score: 0.3+ = noticeable shift, 0.6+ = fundamental behavioral change
- Include 1-3 memory excerpts that support each suggestion
- Only suggest changes that are meaningfully different from current values

Respond with JSON array:
[
  {
    "field": "description|personality|scenario|exampleDialogues|systemPrompt|physicalDescription|clothingRecord|talkativeness",
    "subId": "ID of the specific system prompt/physical description/clothing record (only for those field types)",
    "subName": "Name of the sub-item (only for those field types)",
    "currentValue": "The current text of the field",
    "proposedValue": "The complete new text for the field",
    "rationale": "Why this change is suggested, referencing specific behavioral patterns",
    "significance": 0.5,
    "memoryExcerpts": ["Memory excerpt 1", "Memory excerpt 2"]
  }
]`;
}

type LLMProvider = Awaited<ReturnType<typeof createLLMProvider>>;

/**
 * Make an LLM call for the optimizer
 */
async function callOptimizerLLM(
  provider: LLMProvider,
  apiKey: string,
  modelName: string,
  characterContext: string,
  memoryContext: string,
  instruction: string,
  options: {
    temperature: number;
    maxTokens: number;
  }
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_MESSAGE },
    { role: 'user' as const, content: `${characterContext}\n\n---\n\n${memoryContext}\n\n---\n\n${instruction}` },
  ];

  const startTime = Date.now();

  const response = await provider.sendMessage(
    {
      model: modelName,
      messages,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    },
    apiKey
  );

  const durationMs = Date.now() - startTime;

  if (!response?.content) {
    throw new Error('No response from model');
  }

  return response.content.trim();
}

// ============================================================================
// Main Service Function
// ============================================================================

/**
 * Run the character optimizer with streaming progress updates.
 * Analyzes a character's reinforced memories to identify behavioral patterns
 * and suggests configuration updates.
 */
export async function runCharacterOptimizer(
  characterId: string,
  connectionProfileId: string,
  userId: string,
  repos: RepositoryContainer,
  onProgress: OptimizerProgressCallback,
  options?: OptimizerOptions
): Promise<void> {
  const maxMemories = options?.maxMemories ?? MAX_MEMORIES_FOR_ANALYSIS;
  const searchQuery = options?.searchQuery?.trim() ?? '';
  const useSemanticSearch = options?.useSemanticSearch ?? true;
  const sinceDate = options?.sinceDate ?? null;
  const beforeDate = options?.beforeDate ?? null;

  logger.info('[CharacterOptimizer] Starting character optimization', {
    userId,
    characterId,
    connectionProfileId,
    maxMemories,
    searchQuery: searchQuery || '(none)',
    useSemanticSearch,
    sinceDate,
    beforeDate,
  });

  onProgress({ type: 'start' });

  try {
    // Step 1: Load character and memories
    onProgress({ type: 'step_start', step: 'loading' });

    const character = await repos.characters.findById(characterId);
    if (!character || character.userId !== userId) {
      throw new Error('Character not found');
    }

    // Memory retrieval pipeline: search → date filter → rank → reinforcement filter → limit
    let candidateMemories: Memory[] = [];

    if (searchQuery) {
      if (useSemanticSearch) {
        // Try semantic search first, fall back to text search
        let usedSemantic = false;
        try {
          const embeddingAvailable = await isEmbeddingAvailable(userId);
          if (embeddingAvailable) {
            const embeddingResult = await generateEmbeddingForUser(searchQuery, userId);
            const vectorStore = await getCharacterVectorStore(characterId);
            const results = vectorStore.search(embeddingResult.embedding, 500);
            const matchedIds = new Set(results.map(r => r.id));
            const allMemories = await repos.memories.findByCharacterId(characterId);
            candidateMemories = allMemories.filter(m => matchedIds.has(m.id));
            usedSemantic = true;
            logger.debug('[CharacterOptimizer] Semantic search completed', {
              characterId,
              query: searchQuery,
              vectorResults: results.length,
              matchedMemories: candidateMemories.length,
            });
          }
        } catch (err) {
          logger.warn('[CharacterOptimizer] Semantic search failed, falling back to text search', {
            characterId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        if (!usedSemantic) {
          candidateMemories = await repos.memories.searchByContent(characterId, searchQuery);
          logger.debug('[CharacterOptimizer] Text search fallback completed', {
            characterId,
            query: searchQuery,
            results: candidateMemories.length,
          });
        }
      } else {
        // Text search only
        candidateMemories = await repos.memories.searchByContent(characterId, searchQuery);
        logger.debug('[CharacterOptimizer] Text search completed', {
          characterId,
          query: searchQuery,
          results: candidateMemories.length,
        });
      }
    } else {
      // No search query — load all memories (current behavior)
      candidateMemories = await repos.memories.findByCharacterId(characterId);
      logger.debug('[CharacterOptimizer] Loaded all memories', {
        characterId,
        memoryCount: candidateMemories.length,
      });
    }

    // Apply date filters
    if (sinceDate) {
      const sinceTimestamp = new Date(`${sinceDate}T00:00:00.000Z`).getTime();
      candidateMemories = candidateMemories.filter(m => new Date(m.createdAt).getTime() >= sinceTimestamp);
      logger.debug('[CharacterOptimizer] Applied sinceDate filter', {
        sinceDate,
        remaining: candidateMemories.length,
      });
    }
    if (beforeDate) {
      const beforeTimestamp = new Date(`${beforeDate}T00:00:00.000Z`).getTime();
      candidateMemories = candidateMemories.filter(m => new Date(m.createdAt).getTime() < beforeTimestamp);
      logger.debug('[CharacterOptimizer] Applied beforeDate filter', {
        beforeDate,
        remaining: candidateMemories.length,
      });
    }

    // Rank by weight and filter by reinforcement
    const ranked = rankMemoriesByWeight(candidateMemories);
    const reinforced = ranked.filter(({ memory }) => memory.reinforcementCount >= MIN_REINFORCED_MEMORIES);
    const filteredCount = reinforced.length;
    const qualifyingMemories = reinforced.slice(0, maxMemories);

    logger.debug('[CharacterOptimizer] Memory pipeline complete', {
      characterId,
      candidateCount: candidateMemories.length,
      reinforcedCount: filteredCount,
      selectedCount: qualifyingMemories.length,
      maxMemories,
    });

    onProgress({
      type: 'step_complete',
      step: 'loading',
      memoryCount: qualifyingMemories.length,
      filteredCount,
    });

    // Check if we have enough memories
    if (qualifyingMemories.length < MIN_REINFORCED_MEMORIES) {
      logger.info('[CharacterOptimizer] Not enough reinforced memories for analysis', {
        characterId,
        found: qualifyingMemories.length,
        required: MIN_REINFORCED_MEMORIES,
      });

      onProgress({
        type: 'done',
        analysis: {
          behavioralPatterns: [],
          summary: 'Not enough reinforced memories to analyze.',
        },
        suggestions: [],
      });
      return;
    }

    // Step 2: Perform analysis
    onProgress({ type: 'step_start', step: 'analyzing' });

    const profile = await repos.connections.findById(connectionProfileId);
    if (!profile || profile.userId !== userId) {
      throw new Error('Connection profile not found');
    }

    // Get API key
    let apiKey = '';
    if (profile.apiKeyId) {
      const keyRecord = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId);
      if (keyRecord) {
        apiKey = keyRecord.key_value;
      }
    }

    // Ensure plugin system is initialized
    if (!isPluginSystemInitialized() || !providerRegistry.isInitialized()) {
      const initResult = await initializePlugins();
      if (!initResult.success) {
        throw new Error('Plugin system initialization failed');
      }
    }

    // Create LLM provider
    const provider = await createLLMProvider(profile.provider, profile.baseUrl || undefined);

    // Build context strings
    const characterContext = buildCharacterContext(character);
    const memoryContext = buildMemoryContext(qualifyingMemories);

    // Call LLM for analysis
    const analysisRaw = await callOptimizerLLM(
      provider,
      apiKey,
      profile.modelName,
      characterContext,
      memoryContext,
      getAnalysisPrompt(),
      { temperature: 0.5, maxTokens: 8000 }
    );

    let analysis: OptimizerAnalysis;
    try {
      analysis = parseLLMJson<OptimizerAnalysis>(analysisRaw);
    } catch (parseError) {
      logger.error('[CharacterOptimizer] Failed to parse analysis JSON', {
        characterId,
        rawLength: analysisRaw.length,
        rawTail: analysisRaw.slice(-200),
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw parseError;
    }
    logger.debug('[CharacterOptimizer] Analysis complete', {
      characterId,
      patternCount: analysis.behavioralPatterns.length,
    });

    // Log the LLM call
    await logLLMCall({
      userId,
      type: 'CHARACTER_OPTIMIZER',
      characterId,
      provider: profile.provider,
      modelName: profile.modelName,
      request: {
        messages: [
          { role: 'system', content: SYSTEM_MESSAGE },
          { role: 'user', content: `[character context + memory context + analysis instruction]` },
        ],
        temperature: 0.5,
        maxTokens: 8000,
      },
      response: {
        content: analysisRaw.substring(0, 500),
        error: undefined,
      },
      durationMs: 0,
    }).catch(err => {
      logger.warn('[CharacterOptimizer] Failed to log analysis LLM call', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    onProgress({
      type: 'step_complete',
      step: 'analyzing',
      analysis,
    });

    // Step 3: Generate suggestions
    onProgress({ type: 'step_start', step: 'generating' });

    const suggestionsRaw = await callOptimizerLLM(
      provider,
      apiKey,
      profile.modelName,
      characterContext,
      memoryContext,
      getSuggestionsPrompt(analysis),
      { temperature: 0.7, maxTokens: 16000 }
    );

    let suggestions: OptimizerSuggestion[];
    try {
      suggestions = parseLLMJson<OptimizerSuggestion[]>(suggestionsRaw);
    } catch (parseError) {
      logger.error('[CharacterOptimizer] Failed to parse suggestions JSON', {
        characterId,
        rawLength: suggestionsRaw.length,
        rawTail: suggestionsRaw.slice(-200),
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw parseError;
    }

    // Filter by significance threshold and add IDs
    suggestions = suggestions
      .filter(s => s.significance >= MIN_SIGNIFICANCE_THRESHOLD)
      .map(s => ({
        ...s,
        id: crypto.randomUUID(),
      }));

    logger.debug('[CharacterOptimizer] Suggestions generated', {
      characterId,
      suggestionCount: suggestions.length,
    });

    // Log the LLM call
    await logLLMCall({
      userId,
      type: 'CHARACTER_OPTIMIZER',
      characterId,
      provider: profile.provider,
      modelName: profile.modelName,
      request: {
        messages: [
          { role: 'system', content: SYSTEM_MESSAGE },
          { role: 'user', content: `[character context + memory context + suggestions instruction]` },
        ],
        temperature: 0.7,
        maxTokens: 16000,
      },
      response: {
        content: suggestionsRaw.substring(0, 500),
        error: undefined,
      },
      durationMs: 0,
    }).catch(err => {
      logger.warn('[CharacterOptimizer] Failed to log suggestions LLM call', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    onProgress({
      type: 'step_complete',
      step: 'generating',
      suggestions,
    });

    // Done
    logger.info('[CharacterOptimizer] Character optimization complete', {
      characterId,
      characterName: character.name,
      patternCount: analysis.behavioralPatterns.length,
      suggestionCount: suggestions.length,
    });

    onProgress({
      type: 'done',
      analysis,
      suggestions,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Character optimization failed';
    logger.error('[CharacterOptimizer] Optimization failed', {
      characterId,
      userId,
      error: errorMessage,
    });

    onProgress({
      type: 'error',
      error: errorMessage,
    });
  }
}
