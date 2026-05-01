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
import { FIELD_SEMANTICS_PREAMBLE } from '@/lib/services/character-field-semantics';
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service';
import { getCharacterVectorStore } from '@/lib/embedding/vector-store';
import { isEmbeddingAvailable } from '@/lib/embedding/embedding-service';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { Character, CharacterScenario, CharacterSystemPrompt, Memory } from '@/lib/schemas/types';

// ============================================================================
// Types
// ============================================================================

export interface OptimizerSuggestion {
  id: string;
  field: 'identity' | 'description' | 'manifesto' | 'personality' | 'scenarios' | 'exampleDialogues' | 'systemPrompt' | 'physicalDescription' | 'clothingRecord' | 'talkativeness';
  subId?: string;
  subName?: string;
  title?: string;
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

export type OptimizerProgressEventType =
  | 'start'
  | 'step_start'
  | 'step_complete'
  | 'substep_start'
  | 'substep_complete'
  | 'suggestions_file_written'
  | 'done'
  | 'error';
export type OptimizerStepName = 'loading' | 'analyzing' | 'generating';

export type OptimizerSubStepKind =
  | 'general'
  | 'scenario'
  | 'systemPrompt'
  | 'newItems';

export interface OptimizerSubStep {
  kind: OptimizerSubStepKind;
  label: string;
  index: number;
  total: number;
}

export type OptimizerOutputMode = 'apply' | 'suggestions-file';

export interface OptimizerProgressEvent {
  type: OptimizerProgressEventType;
  step?: OptimizerStepName;
  subStep?: OptimizerSubStep;
  analysis?: OptimizerAnalysis;
  suggestions?: OptimizerSuggestion[];
  partialSuggestions?: OptimizerSuggestion[];
  suggestionsFilePath?: string;
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
  outputMode?: OptimizerOutputMode;
}

// ============================================================================
// Constants
// ============================================================================

const SYSTEM_MESSAGE = `You are a character analysis assistant for Quilltap, a creative writing and roleplay platform. Your job is to analyze a character's accumulated memories and identify behavioral patterns that should be reflected in their configuration.

Key concepts:
- Characters can have MULTIPLE named scenarios. A scenario is a setting for a chat — it describes the environment, circumstances, and context in which an interaction takes place. Scenarios set the stage but do not fundamentally change the character's personality, voice, or behavior. Think of them as different locations or situations where the character might be encountered.
- Characters can have MULTIPLE named system prompts. Each system prompt provides different instructions for how the AI should roleplay the character, potentially for different contexts or styles of interaction.

Always respond with ONLY valid JSON — no markdown code fences, no explanations, no extra text.`;

const MIN_REINFORCED_MEMORIES = 2;
const MAX_MEMORIES_FOR_ANALYSIS = 30;
const MIN_SIGNIFICANCE_THRESHOLD = 0.3;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Defensively coerce any value into a renderable string. The LLM sometimes
 * "structures" content that contains `{{user}}` / `{{char}}` template
 * placeholders into a JSON object like `{user: "...", char: "..."}` instead
 * of leaving the literal string alone — rendering that object as a React
 * child crashes the modal. Numbers/booleans become their string form,
 * null/undefined become empty string, and anything else is JSON-stringified.
 */
function coerceSuggestionText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Build character context string from character data
 */
export function buildCharacterContext(character: Character): string {
  const parts: string[] = [
    `=== Character: ${character.name} ===`,
    '',
    `Identity:`,
    character.identity || '(empty)',
    '',
    `Description:`,
    character.description || '(empty)',
    '',
    `Manifesto:`,
    character.manifesto || '(empty)',
    '',
    `Personality:`,
    character.personality || '(empty)',
    '',
    `Scenarios:`,
    character.scenarios && character.scenarios.length > 0
      ? character.scenarios.map(s => `  - ${s.title}: ${s.content}`).join('\n')
      : '(empty)',
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
  return `${FIELD_SEMANTICS_PREAMBLE}

Analyze this character's configuration alongside their most-reinforced memories. Identify 3-8 behavioral patterns that are established in the memories but not fully captured in the character's current configuration.

For every pattern you identify, decide which of the three editable fields (IDENTITY, DESCRIPTION, PERSONALITY) it is evidence for, using the vantage-point rule above. Patterns that demonstrate behavior visible to interlocutors → DESCRIPTION. Patterns that reveal the character's self-knowledge or inner drivers → PERSONALITY. Public-knowledge facts strangers could know on sight → IDENTITY. Patterns that don't fit any of these (e.g. environment) belong to scenarios and should still be surfaced.

Look for:
- Speech habits and verbal patterns (DESCRIPTION)
- Emotional tendencies and inner drivers (PERSONALITY)
- Relationship dynamics — outward (DESCRIPTION) vs. inward attitude (PERSONALITY)
- Behavioural quirks or consistent actions (DESCRIPTION)
- Self-knowledge, motivations, beliefs the character privately holds (PERSONALITY)
- Public-facing facts: station, occupation, reputation that strangers know on sight (IDENTITY)
- Recurring settings or environments that might warrant new or updated scenarios (remember: a scenario describes the setting/environment of a chat, not a change in the character's personality)

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

const SUGGESTION_SCHEMA_PREAMBLE = `Each suggestion object in the JSON array must follow this schema:
{
  "field": "description|personality|scenarios|exampleDialogues|systemPrompt|physicalDescription|clothingRecord|talkativeness",
  "subId": "ID of the specific scenario/system prompt/physical description/clothing record (only when updating an existing item)",
  "subName": "Name of the existing sub-item (only when updating an existing item)",
  "title": "Title for a new scenario (only when field is 'scenarios' and no subId is provided)",
  "name": "Name for a new system prompt (only when field is 'systemPrompt' and no subId is provided)",
  "currentValue": "The current text of the field or scenario",
  "proposedValue": "The complete new text for the field or scenario",
  "rationale": "Why this change is suggested, referencing specific behavioral patterns",
  "significance": 0.5,
  "memoryExcerpts": ["Memory excerpt 1", "Memory excerpt 2"]
}

Rules that apply to every suggestion:
- Assign a significance score: 0.3+ = noticeable shift, 0.6+ = fundamental behavioral change.
- Include 1-3 memory excerpts that support the suggestion.
- Only propose changes that are meaningfully different from the current value.
- Preserve the character's existing voice and style while incorporating the behavioral patterns.
- Scenarios describe "where and when" (setting, environment, circumstances). They should not alter the character's personality, voice, or core behavior unless the environment itself demands it.`;

/**
 * Suggestions prompt for the general, character-wide fields: identity,
 * description, personality, exampleDialogues, and talkativeness. Per-item
 * scenario and system-prompt suggestions are produced by their own dedicated
 * passes.
 */
export function getGeneralFieldsSuggestionsPrompt(analysis: OptimizerAnalysis): string {
  return `${FIELD_SEMANTICS_PREAMBLE}

Based on the behavioral analysis below and the character's current configuration, propose targeted modifications to the character's GENERAL fields only:

  - identity (public-knowledge / outside-view facts only — name, station, occupation, reputation)
  - description (behavior, mannerisms, verbal patterns visible to interlocutors)
  - manifesto (the basic tenets, the axiomatic core; not a vantage-point field, it is the load-bearing truth the character is built on)
  - personality (the character's own self-knowledge; inner drivers of speech and behavior)
  - exampleDialogues
  - talkativeness (a number between 0.1 and 1.0)

The vantage-point rule is strict:
- A suggestion for IDENTITY may only contain facts a stranger could plausibly know without having spoken to the character. Never put internal motivation, private mannerisms, or self-knowledge here.
- A suggestion for DESCRIPTION must reflect things someone who has interacted with the character would notice — not the character's own internal monologue, and not surface-level public reputation.
- A suggestion for MANIFESTO should be rare and high-stakes — propose manifesto changes only when the memory contradicts a basic tenet, not for tonal or stylistic improvements. Manifesto edits reverberate across every other field.
- A suggestion for PERSONALITY must reflect the character's own self-knowledge and inner drivers. Never put outward behavior someone else would observe here, and never put public-facing identity facts.
- Do NOT propose the same content under two different fields. Pick the one whose vantage point matches.
- Do NOT suggest edits to title, scenarios, system prompts, physical descriptions, or clothing records in this response — those are out of scope for this pass (scenarios and system prompts are handled by separate passes).

If you see nothing worth changing in the general fields, respond with an empty JSON array.

=== Behavioural Analysis ===
${JSON.stringify(analysis, null, 2)}

${SUGGESTION_SCHEMA_PREAMBLE}

Respond with a JSON array of suggestion objects.`;
}

/**
 * Suggestions prompt scoped to a single scenario. Keeps the rest of the
 * character context available for grounding but asks the model to reason about
 * ONE scenario at a time so patterns particular to that setting don't get
 * averaged out across the character's whole set of scenarios.
 */
export function getScenarioSuggestionPrompt(
  analysis: OptimizerAnalysis,
  scenario: CharacterScenario,
): string {
  return `Focus solely on the following scenario. Decide whether its content should be refined to better reflect the demonstrated behavior below. A scenario describes the environment, circumstances, and context of a chat — it is the stage, not the actor. Refinements should sharpen the setting (place, circumstance, atmosphere, starting situation), not rewrite the character's personality.

=== Scenario Under Review ===
ID: ${scenario.id}
Title: ${scenario.title}
Current content:
${scenario.content || '(empty)'}

=== Behavioural Analysis ===
${JSON.stringify(analysis, null, 2)}

Produce at most ONE suggestion. If the current scenario is already an appropriate setting for the patterns observed, respond with an empty JSON array.

${SUGGESTION_SCHEMA_PREAMBLE}

Additional rules specific to scenario refinement:
- Set field="scenarios" and subId="${scenario.id}".
- currentValue must be the existing scenario content verbatim.
- proposedValue must be a complete replacement for the scenario content.

Respond with a JSON array of at most one suggestion.`;
}

/**
 * Suggestions prompt scoped to a single system prompt. System prompts govern
 * how the AI roleplays the character in a given interaction style; each one
 * gets its own focused pass so suggestions can acknowledge the prompt's
 * intended style rather than being blended across all variants.
 */
export function getSystemPromptSuggestionPrompt(
  analysis: OptimizerAnalysis,
  prompt: CharacterSystemPrompt,
): string {
  return `Focus solely on the following system prompt. Decide whether its text should be refined to better reflect the demonstrated behavior below, while preserving the interaction style the prompt is clearly trying to achieve.

=== System Prompt Under Review ===
ID: ${prompt.id}
Name: ${prompt.name}
Is default variant: ${prompt.isDefault ? 'yes' : 'no'}
Current content:
${prompt.content || '(empty)'}

=== Behavioural Analysis ===
${JSON.stringify(analysis, null, 2)}

Produce at most ONE suggestion. If the current prompt already captures the patterns you would want to reinforce, respond with an empty JSON array.

${SUGGESTION_SCHEMA_PREAMBLE}

Additional rules specific to system-prompt refinement:
- Set field="systemPrompt" and subId="${prompt.id}".
- currentValue must be the existing prompt content verbatim.
- proposedValue must be a complete replacement for the prompt content.
- Do NOT change the prompt's evident interaction style (e.g. a "terse" prompt should stay terse); only sharpen its articulation of the character.

Respond with a JSON array of at most one suggestion.`;
}

/**
 * Suggestions prompt for proposing genuinely new scenarios or system prompts
 * based on patterns the existing items don't already cover.
 */
export function getNewItemsSuggestionPrompt(analysis: OptimizerAnalysis): string {
  return `Review the character's existing scenarios and system prompts (shown in the character context). Propose any NEW scenarios or NEW system prompts that are warranted by the behavioral patterns below but aren't already covered by the existing set. Do NOT propose edits to existing items here — this pass handles additions only. If no new items are warranted, respond with an empty JSON array.

=== Behavioural Analysis ===
${JSON.stringify(analysis, null, 2)}

${SUGGESTION_SCHEMA_PREAMBLE}

Additional rules specific to this pass:
- For a new scenario: field="scenarios", omit subId, include a "title" field with a short descriptive title, and put the complete setting text in proposedValue. currentValue should be the empty string.
- For a new system prompt: field="systemPrompt", omit subId, include a "name" field with a short label, and put the complete prompt text in proposedValue. currentValue should be the empty string.
- Be conservative: only propose a new item if there is a clear pattern that the existing set does not cover.

Respond with a JSON array of suggestion objects (may be empty).`;
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

    // Memory retrieval pipeline: search → date filter → rank → reinforcement filter → limit.
    //
    // The optimizer only learns from memories ABOUT the character (self-references:
    // aboutCharacterId === characterId). Inter-character memories the character holds
    // about other participants would skew behavioral-pattern analysis toward those
    // others' habits. Legacy null-aboutCharacterId rows are excluded by design — the
    // post-attribution-overhaul pipeline collapses self-references to characterId, so
    // the null pile is genuinely unattributed and not a fallback for "self".
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
            const aboutSelf = await repos.memories.findByCharacterAboutCharacter(characterId, characterId);
            candidateMemories = aboutSelf.filter(m => matchedIds.has(m.id));
            usedSemantic = true;
          }
        } catch (err) {
          logger.warn('[CharacterOptimizer] Semantic search failed, falling back to text search', {
            characterId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        if (!usedSemantic) {
          candidateMemories = await repos.memories.searchByContentAboutCharacter(characterId, characterId, searchQuery);
        }
      } else {
        // Text search only
        candidateMemories = await repos.memories.searchByContentAboutCharacter(characterId, characterId, searchQuery);
      }
    } else {
      // No search query — load all about-self memories
      candidateMemories = await repos.memories.findByCharacterAboutCharacter(characterId, characterId);
    }

    // Apply date filters
    if (sinceDate) {
      const sinceTimestamp = new Date(`${sinceDate}T00:00:00.000Z`).getTime();
      candidateMemories = candidateMemories.filter(m => new Date(m.createdAt).getTime() >= sinceTimestamp);
    }
    if (beforeDate) {
      const beforeTimestamp = new Date(`${beforeDate}T00:00:00.000Z`).getTime();
      candidateMemories = candidateMemories.filter(m => new Date(m.createdAt).getTime() < beforeTimestamp);
    }

    // Rank by weight and filter by reinforcement
    const ranked = rankMemoriesByWeight(candidateMemories);
    const reinforced = ranked.filter(({ memory }) => memory.reinforcementCount >= MIN_REINFORCED_MEMORIES);
    const filteredCount = reinforced.length;
    const qualifyingMemories = reinforced.slice(0, maxMemories);


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

    // Step 3: Generate suggestions, one focused pass per sub-step. Each pass
    // runs the same character+memory context through the LLM but with a
    // prompt that constrains it to a single concern (general fields, a
    // specific scenario, a specific system prompt, or proposing new items),
    // so per-item patterns don't get averaged out across siblings.
    onProgress({ type: 'step_start', step: 'generating' });

    const existingScenarios: CharacterScenario[] = character.scenarios ?? [];
    const existingPrompts: CharacterSystemPrompt[] = character.systemPrompts ?? [];

    const subSteps: Array<{ kind: OptimizerSubStepKind; label: string }> = [
      { kind: 'general', label: 'General fields' },
      ...existingScenarios.map((s) => ({
        kind: 'scenario' as OptimizerSubStepKind,
        label: `Scenario: ${s.title}`,
      })),
      ...existingPrompts.map((p) => ({
        kind: 'systemPrompt' as OptimizerSubStepKind,
        label: `System prompt: ${p.name}`,
      })),
      { kind: 'newItems', label: 'Proposed new scenarios & prompts' },
    ];
    const totalSubSteps = subSteps.length;
    let subStepIndex = 0;
    const allSuggestions: OptimizerSuggestion[] = [];

    const runSubStep = async (
      kind: OptimizerSubStepKind,
      label: string,
      instruction: string,
    ): Promise<void> => {
      const index = ++subStepIndex;
      const subStep: OptimizerSubStep = { kind, label, index, total: totalSubSteps };
      onProgress({ type: 'substep_start', step: 'generating', subStep });

      let raw: string;
      try {
        raw = await callOptimizerLLM(
          provider,
          apiKey,
          profile.modelName,
          characterContext,
          memoryContext,
          instruction,
          { temperature: 0.7, maxTokens: 6000 },
        );
      } catch (callError) {
        logger.warn('[CharacterOptimizer] Sub-step LLM call failed; continuing', {
          characterId,
          subStep: label,
          error: callError instanceof Error ? callError.message : String(callError),
        });
        onProgress({ type: 'substep_complete', step: 'generating', subStep, partialSuggestions: [] });
        return;
      }

      let parsed: OptimizerSuggestion[] = [];
      try {
        parsed = parseLLMJson<OptimizerSuggestion[]>(raw);
      } catch (parseError) {
        logger.warn('[CharacterOptimizer] Sub-step produced unparseable JSON; skipping', {
          characterId,
          subStep: label,
          rawTail: raw.slice(-200),
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
        parsed = [];
      }

      const filtered = parsed
        .filter((s) => s && typeof s.significance === 'number' && s.significance >= MIN_SIGNIFICANCE_THRESHOLD)
        .map((s) => ({
          ...s,
          id: crypto.randomUUID(),
          // The LLM occasionally serializes scenario/prompt bodies that contain
          // `{{user}}` / `{{char}}` template placeholders as JSON objects
          // instead of leaving them as literal strings, which then crashes
          // React when SuggestionCard tries to render them as children.
          // Coerce every text-bearing field defensively so a malformed
          // sub-call response can't take down the modal.
          currentValue: coerceSuggestionText(s.currentValue),
          proposedValue: coerceSuggestionText(s.proposedValue),
          rationale: coerceSuggestionText(s.rationale),
          memoryExcerpts: Array.isArray(s.memoryExcerpts)
            ? s.memoryExcerpts.map(coerceSuggestionText)
            : [],
        }));

      allSuggestions.push(...filtered);

      await logLLMCall({
        userId,
        type: 'CHARACTER_OPTIMIZER',
        characterId,
        provider: profile.provider,
        modelName: profile.modelName,
        request: {
          messages: [
            { role: 'system', content: SYSTEM_MESSAGE },
            { role: 'user', content: `[character context + memory context + ${label} instruction]` },
          ],
          temperature: 0.7,
          maxTokens: 6000,
        },
        response: {
          content: raw.substring(0, 500),
          error: undefined,
        },
        durationMs: 0,
      }).catch((err) => {
        logger.warn('[CharacterOptimizer] Failed to log sub-step LLM call', {
          subStep: label,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      onProgress({
        type: 'substep_complete',
        step: 'generating',
        subStep,
        partialSuggestions: filtered,
      });
    };

    await runSubStep(
      'general',
      'General fields',
      getGeneralFieldsSuggestionsPrompt(analysis),
    );

    for (const scenario of existingScenarios) {
      await runSubStep(
        'scenario',
        `Scenario: ${scenario.title}`,
        getScenarioSuggestionPrompt(analysis, scenario),
      );
    }

    for (const prompt of existingPrompts) {
      await runSubStep(
        'systemPrompt',
        `System prompt: ${prompt.name}`,
        getSystemPromptSuggestionPrompt(analysis, prompt),
      );
    }

    await runSubStep(
      'newItems',
      'Proposed new scenarios & prompts',
      getNewItemsSuggestionPrompt(analysis),
    );

    const suggestions = allSuggestions;

    onProgress({
      type: 'step_complete',
      step: 'generating',
      suggestions,
    });

    // Optional: write the aggregated suggestions into the character's vault
    // as a markdown document so the user (or the character, in-chat) can
    // review and discuss them without applying anything to the live config.
    const outputMode: OptimizerOutputMode = options?.outputMode ?? 'apply';
    let suggestionsFilePath: string | undefined;
    if (outputMode === 'suggestions-file') {
      if (!character.characterDocumentMountPointId) {
        throw new Error('Suggestions-file mode requires the character to be linked to a document-store vault.');
      }
      suggestionsFilePath = await writeSuggestionsFileToVault(
        character.characterDocumentMountPointId,
        character,
        analysis,
        suggestions,
        qualifyingMemories.length,
        profile.modelName,
      );
      onProgress({
        type: 'suggestions_file_written',
        suggestionsFilePath,
      });
    }

    // Done
    logger.info('[CharacterOptimizer] Character optimization complete', {
      characterId,
      characterName: character.name,
      patternCount: analysis.behavioralPatterns.length,
      suggestionCount: suggestions.length,
      outputMode,
      suggestionsFilePath,
    });

    onProgress({
      type: 'done',
      analysis,
      suggestions,
      suggestionsFilePath,
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

// ============================================================================
// Suggestions-file writer
// ============================================================================

const SUGGESTIONS_FOLDER = 'Suggestions';

/**
 * Render the optimizer's analysis + suggestions as a human-reviewable markdown
 * document and write it into the character's vault under
 * `Suggestions/refinement-<timestamp>.md`. Each suggestion becomes its own
 * section so a reader can work through them one at a time with the character
 * in-chat before anything is applied.
 */
async function writeSuggestionsFileToVault(
  mountPointId: string,
  character: Character,
  analysis: OptimizerAnalysis,
  suggestions: OptimizerSuggestion[],
  memoryCount: number,
  modelName: string,
): Promise<string> {
  const now = new Date();
  const stampIso = now.toISOString();
  const stampFile = stampIso.replace(/[:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const relativePath = `${SUGGESTIONS_FOLDER}/refinement-${stampFile}.md`;

  const content = renderSuggestionsMarkdown(
    character,
    analysis,
    suggestions,
    memoryCount,
    modelName,
    stampIso,
  );

  await writeDatabaseDocument(mountPointId, relativePath, content);

  logger.info('[CharacterOptimizer] Wrote suggestions file to vault', {
    characterId: character.id,
    mountPointId,
    relativePath,
    suggestionCount: suggestions.length,
  });

  return relativePath;
}

function renderSuggestionsMarkdown(
  character: Character,
  analysis: OptimizerAnalysis,
  suggestions: OptimizerSuggestion[],
  memoryCount: number,
  modelName: string,
  generatedAt: string,
): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('type: character-suggestions');
  lines.push(`generatedAt: ${generatedAt}`);
  lines.push(`characterId: ${character.id}`);
  lines.push(`characterName: ${yamlString(character.name)}`);
  lines.push(`model: ${yamlString(modelName)}`);
  lines.push(`memoryCount: ${memoryCount}`);
  lines.push(`suggestionCount: ${suggestions.length}`);
  lines.push('---');
  lines.push('');
  lines.push(`# Refinement Suggestions — ${generatedAt.slice(0, 10)}`);
  lines.push('');
  lines.push(
    `The automata have consulted ${memoryCount} memoir${memoryCount === 1 ? '' : 's'} from ${character.name}'s Commonplace Book and offer the following proposals for the consideration of author and character alike. Nothing herein has been applied — treat this as an itinerary of possible refinements, to be debated, amended, rejected, or commissioned at your leisure.`,
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(analysis.summary || '_(no summary provided)_');
  lines.push('');

  if (analysis.behavioralPatterns.length > 0) {
    lines.push('## Behavioural Patterns Observed');
    lines.push('');
    for (let i = 0; i < analysis.behavioralPatterns.length; i++) {
      const bp = analysis.behavioralPatterns[i];
      lines.push(`### ${i + 1}. ${bp.pattern}`);
      lines.push('');
      lines.push(`**Evidence:** ${bp.evidence}`);
      lines.push('');
      lines.push(`**Frequency:** ${bp.frequency}`);
      lines.push('');
    }
  }

  lines.push('## Proposed Changes');
  lines.push('');
  if (suggestions.length === 0) {
    lines.push('_No changes of sufficient significance were proposed._');
    lines.push('');
  } else {
    const grouped = groupSuggestionsForReport(suggestions);
    for (const group of grouped) {
      lines.push(`### ${group.heading}`);
      lines.push('');
      for (const s of group.items) {
        lines.push(`#### ${describeSuggestion(s)}`);
        lines.push('');
        lines.push(`- **Significance:** ${(s.significance ?? 0).toFixed(2)}`);
        if (s.rationale) {
          lines.push(`- **Rationale:** ${s.rationale}`);
        }
        lines.push('');
        lines.push('**Current:**');
        lines.push('');
        lines.push(fenceOrEmpty(s.currentValue));
        lines.push('');
        lines.push('**Proposed:**');
        lines.push('');
        lines.push(fenceOrEmpty(s.proposedValue));
        lines.push('');
        if (s.memoryExcerpts && s.memoryExcerpts.length > 0) {
          lines.push('**Supporting memoirs:**');
          lines.push('');
          for (const excerpt of s.memoryExcerpts) {
            lines.push(`> ${excerpt.replace(/\n/g, '\n> ')}`);
            lines.push('');
          }
        }
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(
    '_Generated by Quilltap\'s Character Optimizer in suggestions-file mode. Discuss at leisure; apply only what rings true._',
  );
  lines.push('');

  return lines.join('\n');
}

interface SuggestionGroup {
  heading: string;
  items: OptimizerSuggestion[];
}

function groupSuggestionsForReport(suggestions: OptimizerSuggestion[]): SuggestionGroup[] {
  const general: OptimizerSuggestion[] = [];
  const scenarioUpdates: OptimizerSuggestion[] = [];
  const scenarioNew: OptimizerSuggestion[] = [];
  const promptUpdates: OptimizerSuggestion[] = [];
  const promptNew: OptimizerSuggestion[] = [];
  const other: OptimizerSuggestion[] = [];

  for (const s of suggestions) {
    if (s.field === 'scenarios') {
      (s.subId ? scenarioUpdates : scenarioNew).push(s);
    } else if (s.field === 'systemPrompt') {
      (s.subId ? promptUpdates : promptNew).push(s);
    } else if (
      s.field === 'identity' ||
      s.field === 'description' ||
      s.field === 'manifesto' ||
      s.field === 'personality' ||
      s.field === 'exampleDialogues' ||
      s.field === 'talkativeness'
    ) {
      general.push(s);
    } else {
      other.push(s);
    }
  }

  const groups: SuggestionGroup[] = [];
  if (general.length > 0) groups.push({ heading: 'General Fields', items: general });
  if (scenarioUpdates.length > 0) groups.push({ heading: 'Scenario Refinements', items: scenarioUpdates });
  if (scenarioNew.length > 0) groups.push({ heading: 'Proposed New Scenarios', items: scenarioNew });
  if (promptUpdates.length > 0) groups.push({ heading: 'System Prompt Refinements', items: promptUpdates });
  if (promptNew.length > 0) groups.push({ heading: 'Proposed New System Prompts', items: promptNew });
  if (other.length > 0) groups.push({ heading: 'Other', items: other });
  return groups;
}

function describeSuggestion(s: OptimizerSuggestion): string {
  if (s.field === 'scenarios') {
    if (s.subId) return `Scenario: ${s.subName ?? s.title ?? s.subId}`;
    return `New scenario${s.title ? `: ${s.title}` : ''}`;
  }
  if (s.field === 'systemPrompt') {
    if (s.subId) return `System prompt: ${s.subName ?? s.title ?? s.subId}`;
    // "name" field is allowed on the wire but not on the typed interface; look it up defensively.
    const name = (s as unknown as { name?: string }).name;
    return `New system prompt${name ? `: ${name}` : ''}`;
  }
  switch (s.field) {
    case 'identity':
      return 'Identity';
    case 'description':
      return 'Description';
    case 'manifesto':
      return 'Manifesto';
    case 'personality':
      return 'Personality';
    case 'exampleDialogues':
      return 'Example dialogues';
    case 'talkativeness':
      return 'Talkativeness';
    case 'physicalDescription':
      return `Physical description${s.subName ? `: ${s.subName}` : ''}`;
    case 'clothingRecord':
      return `Clothing record${s.subName ? `: ${s.subName}` : ''}`;
    default:
      return s.field;
  }
}

function fenceOrEmpty(value: string): string {
  if (!value || value.trim() === '') return '_(empty)_';
  return ['```', value, '```'].join('\n');
}

function yamlString(value: string): string {
  // Quote-safe single-line YAML string. Any multi-line input is collapsed
  // (the rendered body contains the full text anyway; this is just the
  // frontmatter summary).
  const single = value.replace(/[\r\n]+/g, ' ').trim();
  return `"${single.replace(/"/g, '\\"')}"`;
}
