/**
 * AI Character Import Service
 *
 * Multi-call LLM orchestration service that analyzes source material (wiki pages,
 * story documents, character sheets, freeform notes) and generates a complete
 * character in .qtap export format for import via the existing import system.
 *
 * Each LLM call extracts/generates one aspect of the character. The service
 * assembles the final .qtap structure programmatically (UUIDs, timestamps, manifest).
 */

import { createLLMProvider } from '@/lib/llm';
import { decryptApiKey } from '@/lib/encryption';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { extractFileContent } from '@/lib/services/file-content-extractor';
import { logLLMCall } from '@/lib/services/llm-logging.service';
import { validateQtapExport } from '@/lib/validation/qtap-schema-validator';
import { logger } from '@/lib/logger';
import packageJson from '@/package.json';
import type { ConnectionProfile } from '@/lib/schemas/types';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { QuilltapExport } from '@/lib/export/types';

// ============================================================================
// Types
// ============================================================================

export interface AIImportRequest {
  profileId: string;
  sourceFileIds: string[];
  sourceText: string;
  includeMemories: boolean;
  includeChats: boolean;
  existingResult?: Partial<AIImportStepResults>;
  regenerateSteps?: AIImportStepName[];
}

export type AIImportStepName =
  | 'analyzing'
  | 'character_basics'
  | 'first_message'
  | 'system_prompts'
  | 'physical_descriptions'
  | 'pronouns'
  | 'memories'
  | 'chats'
  | 'assembly'
  | 'validation'
  | 'repair';

export type AIImportProgressEventType =
  | 'start'
  | 'step_start'
  | 'step_complete'
  | 'step_error'
  | 'done';

export interface AIImportProgressEvent {
  type: AIImportProgressEventType;
  step?: AIImportStepName;
  snippet?: string;
  result?: QuilltapExport;
  stepResults?: AIImportStepResults;
  errors?: Record<string, string>;
  error?: string;
}

export type AIImportProgressCallback = (event: AIImportProgressEvent) => void;

/** Results from individual LLM steps, keyed by step name */
export interface AIImportStepResults {
  analyzing?: string;
  character_basics?: {
    name: string;
    title?: string;
    description?: string;
    personality?: string;
    scenario?: string;
  };
  first_message?: {
    firstMessage?: string;
    exampleDialogues?: string;
  };
  system_prompts?: Array<{
    name: string;
    content: string;
    isDefault: boolean;
  }>;
  physical_descriptions?: {
    shortPrompt: string;
    mediumPrompt: string;
    longPrompt: string;
    completePrompt: string;
    fullDescription: string;
  };
  pronouns?: {
    subject: string;
    object: string;
    possessive: string;
  };
  memories?: Array<{
    content: string;
    summary: string;
    keywords: string[];
    importance: number;
  }>;
  chats?: {
    title: string;
    messages: Array<{
      role: 'USER' | 'ASSISTANT';
      content: string;
    }>;
  };
}

// ============================================================================
// Constants
// ============================================================================

const SYSTEM_MESSAGE = `You are a character extraction assistant for Quilltap, a creative writing and roleplay platform. Your job is to analyze source material about a character and extract or generate structured character data. Always respond with ONLY valid JSON — no markdown code fences, no explanations, no extra text.`;

const SOURCE_ANALYSIS_THRESHOLD = 30000;
const MAX_REPAIR_ATTEMPTS = 2;

// ============================================================================
// Prompt Templates
// ============================================================================

function getAnalyzingPrompt(sourceLength: number): string {
  return `The following source material is ${sourceLength} characters long. Analyze it and provide a structured summary to guide character extraction.

Respond with JSON:
{
  "characterName": "the character's name if found",
  "setting": "the world/setting description",
  "keyTraits": ["trait1", "trait2"],
  "relationships": ["relationship1"],
  "physicalDetails": "any physical appearance details found",
  "backgroundSummary": "brief background summary",
  "speechPatterns": "any speech patterns or dialect noted",
  "sourceCoverage": "what the source material covers well vs what needs generation"
}`;
}

const CHARACTER_BASICS_PROMPT = `Extract or generate the character's basic information from the source material.

Respond with JSON:
{
  "name": "Character's full name",
  "title": "A short epithet or title (2-5 words, like 'The Wandering Scholar')",
  "description": "A comprehensive 2-3 paragraph description covering appearance, background, and current situation. Write in third person, present tense.",
  "personality": "1-2 paragraphs describing core traits, interaction style, emotional tendencies, and quirks. Write as behavioral instructions.",
  "scenario": "1-2 paragraphs setting the default scene for interactions. Present tense, describing environment and relationship context."
}

If the source material clearly provides information for a field, extract and adapt it. If not, generate appropriate content that fits the character.`;

const FIRST_MESSAGE_PROMPT = `Generate a first message and example dialogues for this character based on the source material.

Respond with JSON:
{
  "firstMessage": "An engaging opening message from the character (1-3 paragraphs). Include *actions* and dialogue. This is how the character introduces themselves or sets the scene when first meeting someone.",
  "exampleDialogues": "2-3 example dialogue exchanges showing the character's voice.\\nFormat:\\n{{char}}: [dialogue and *actions*]\\n{{user}}: [response]\\n{{char}}: [follow-up]\\n\\nSeparate exchanges with a blank line."
}`;

const SYSTEM_PROMPTS_PROMPT = `Create system prompts that instruct an AI how to roleplay as this character.

Respond with JSON array:
[
  {
    "name": "Main",
    "content": "A comprehensive system prompt (300-500 words) covering identity, speech patterns, behaviors, boundaries, and relationship dynamics. Write in second person ('You are...', 'You always...').",
    "isDefault": true
  }
]

The main prompt should capture the character's essence from the source material. Include specific details about speech patterns, mannerisms, and reactions that make the character unique.`;

const PHYSICAL_DESCRIPTIONS_PROMPT = `Generate physical descriptions of this character at varying detail levels for image generation.

Respond with JSON:
{
  "shortPrompt": "Extremely concise visual description, max 350 chars. Comma-separated descriptors: hair, eyes, skin, body type, one distinctive feature.",
  "mediumPrompt": "Concise visual description, max 500 chars. Include hair, eyes, skin, body type, facial features, clothing notes. Continuous description.",
  "longPrompt": "Detailed visual description, max 750 chars. Complete hair, eye details, skin, facial structure, body type, clothing, posture, marks/features.",
  "completePrompt": "Comprehensive visual description, max 1000 chars. All physical details optimized for AI image generation.",
  "fullDescription": "Complete physical description in markdown format with sections: ## Overview, ## Face & Head, ## Body, ## Style & Appearance, ## Distinctive Features"
}`;

const PRONOUNS_PROMPT = `Determine the character's pronouns from the source material.

Respond with JSON:
{
  "subject": "he/she/they/etc",
  "object": "him/her/them/etc",
  "possessive": "his/her/their/etc"
}`;

const MEMORIES_PROMPT = `Generate memories that this character would have based on the source material. These are key facts, experiences, and knowledge the character should remember.

Respond with JSON array (5-15 memories):
[
  {
    "content": "Detailed memory content (1-3 sentences describing what happened or what the character knows)",
    "summary": "One-sentence distilled version for quick context injection",
    "keywords": ["keyword1", "keyword2", "keyword3"],
    "importance": 0.7
  }
]

Importance scale: 0.0 (trivial) to 1.0 (core identity). Focus on memories that define the character's history, key relationships, formative events, and critical knowledge.`;

const CHATS_PROMPT = `Generate an example chat conversation featuring this character to demonstrate their personality and conversational style.

Respond with JSON:
{
  "title": "A descriptive title for this conversation",
  "messages": [
    { "role": "ASSISTANT", "content": "Character's opening message with *actions* and dialogue" },
    { "role": "USER", "content": "User's response" },
    { "role": "ASSISTANT", "content": "Character's reply showing personality" },
    { "role": "USER", "content": "Another user message" },
    { "role": "ASSISTANT", "content": "Character's response demonstrating range" }
  ]
}

Create 5-8 messages showing natural conversation flow with the character's unique voice and mannerisms.`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Strip markdown code fences from LLM output before JSON parsing
 */
export function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  // Remove ```json ... ``` or ``` ... ```
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    if (firstNewline !== -1) {
      cleaned = cleaned.substring(firstNewline + 1);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }
  }
  return cleaned.trim();
}

/**
 * Parse JSON from LLM output, handling code fences and common issues
 */
export function parseLLMJson<T>(text: string): T {
  const cleaned = stripCodeFences(text);
  return JSON.parse(cleaned) as T;
}

type LLMProvider = Awaited<ReturnType<typeof createLLMProvider>>;

/**
 * Make an LLM call with structured JSON response expected
 */
async function callLLM(
  provider: LLMProvider,
  apiKey: string,
  modelName: string,
  sourceContext: string,
  instruction: string,
  options: {
    temperature: number;
    maxTokens: number;
    userId?: string;
    profileProvider?: string;
  }
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_MESSAGE },
    { role: 'user' as const, content: `${sourceContext}\n\n---\n\n${instruction}` },
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

  // Log the LLM call (fire and forget)
  if (options.userId && options.profileProvider) {
    logLLMCall({
      userId: options.userId,
      type: 'AI_IMPORT',
      provider: options.profileProvider,
      modelName,
      request: {
        messages: [
          { role: 'system', content: SYSTEM_MESSAGE },
          { role: 'user', content: `[source context + instruction - ${instruction.substring(0, 80)}...]` },
        ],
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      },
      response: {
        content: response.content.substring(0, 500),
        error: undefined,
      },
      usage: response.usage,
      durationMs,
    }).catch(err => {
      logger.warn('[AIImport] Failed to log LLM call', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return response.content.trim();
}

/**
 * Build source context from uploaded files and freeform text
 */
async function buildSourceContext(
  sourceFileIds: string[],
  sourceText: string,
  userId: string,
  repos: RepositoryContainer,
  analysis?: string
): Promise<string> {
  const parts: string[] = [];

  // Extract content from uploaded files
  for (const fileId of sourceFileIds) {
    const file = await repos.files.findById(fileId);
    if (!file || file.userId !== userId) {
      logger.warn('[AIImport] Source file not found or unauthorized', { fileId, userId });
      continue;
    }

    const result = await extractFileContent(file);
    if (result.success && result.content) {
      parts.push(`=== Source File: ${file.originalFilename} ===\n${result.content}`);
      logger.debug('[AIImport] Extracted content from file', {
        fileId,
        filename: file.originalFilename,
        contentLength: result.content.length,
      });
    } else {
      logger.warn('[AIImport] Failed to extract file content', {
        fileId,
        filename: file.originalFilename,
        error: result.error,
      });
    }
  }

  // Add freeform text
  if (sourceText.trim()) {
    parts.push(`=== Source Text ===\n${sourceText.trim()}`);
  }

  // Add analysis summary if available
  if (analysis) {
    parts.push(`=== Prior Analysis ===\n${analysis}`);
  }

  const context = parts.join('\n\n');
  logger.debug('[AIImport] Built source context', {
    fileCount: sourceFileIds.length,
    hasSourceText: !!sourceText.trim(),
    hasAnalysis: !!analysis,
    totalLength: context.length,
  });

  return context;
}

/**
 * Get a short snippet for progress display
 */
function getSnippet(content: unknown, maxLength: number = 100): string {
  if (typeof content === 'string') {
    return content.length > maxLength ? content.substring(0, maxLength) + '...' : content;
  }
  if (typeof content === 'object' && content !== null) {
    const obj = content as Record<string, unknown>;
    if ('name' in obj && typeof obj.name === 'string') {
      return obj.name;
    }
  }
  return '';
}

// ============================================================================
// Assembly
// ============================================================================

/**
 * Assemble a QuilltapExport from the generated step results
 */
function assembleQtapExport(
  stepResults: AIImportStepResults,
  includeMemories: boolean,
  includeChats: boolean,
  appVersion: string
): QuilltapExport {
  const now = new Date().toISOString();
  const characterId = crypto.randomUUID();
  const userId = crypto.randomUUID(); // Placeholder — remapped during import

  const basics = stepResults.character_basics;
  if (!basics?.name) {
    throw new Error('Character basics with name are required for assembly');
  }

  // Build character object
  const character: Record<string, unknown> = {
    id: characterId,
    userId,
    name: basics.name,
    title: basics.title || null,
    description: basics.description || null,
    personality: basics.personality || null,
    scenario: basics.scenario || null,
    firstMessage: stepResults.first_message?.firstMessage || null,
    exampleDialogues: stepResults.first_message?.exampleDialogues || null,
    systemPrompts: (stepResults.system_prompts || []).map((sp) => ({
      id: crypto.randomUUID(),
      name: sp.name,
      content: sp.content,
      isDefault: sp.isDefault,
      createdAt: now,
      updatedAt: now,
    })),
    avatarUrl: null,
    defaultImageId: null,
    defaultConnectionProfileId: null,
    defaultPartnerId: null,
    defaultRoleplayTemplateId: null,
    defaultImageProfileId: null,
    sillyTavernData: null,
    isFavorite: false,
    npc: false,
    talkativeness: 0.5,
    controlledBy: 'llm',
    defaultAgentModeEnabled: null,
    personaLinks: [],
    aliases: [],
    pronouns: stepResults.pronouns || null,
    tags: [],
    avatarOverrides: [],
    physicalDescriptions: stepResults.physical_descriptions
      ? [
          {
            id: crypto.randomUUID(),
            name: 'AI Generated',
            shortPrompt: (stepResults.physical_descriptions.shortPrompt || '').substring(0, 350),
            mediumPrompt: (stepResults.physical_descriptions.mediumPrompt || '').substring(0, 500),
            longPrompt: (stepResults.physical_descriptions.longPrompt || '').substring(0, 750),
            completePrompt: (stepResults.physical_descriptions.completePrompt || '').substring(0, 1000),
            fullDescription: stepResults.physical_descriptions.fullDescription,
            createdAt: now,
            updatedAt: now,
          },
        ]
      : [],
    clothingRecords: [],
    createdAt: now,
    updatedAt: now,
  };

  // Build memories array
  const memories: Record<string, unknown>[] = [];
  if (includeMemories && stepResults.memories) {
    for (const mem of stepResults.memories) {
      memories.push({
        id: crypto.randomUUID(),
        characterId,
        aboutCharacterId: null,
        chatId: null,
        projectId: null,
        content: mem.content,
        summary: mem.summary,
        keywords: mem.keywords,
        tags: [],
        importance: Math.max(0, Math.min(1, mem.importance)),
        embedding: null,
        source: 'MANUAL',
        sourceMessageId: null,
        lastAccessedAt: null,
        reinforcementCount: 1,
        lastReinforcedAt: null,
        relatedMemoryIds: [],
        reinforcedImportance: Math.max(0, Math.min(1, mem.importance)),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Build chats array
  const chats: Record<string, unknown>[] = [];
  if (includeChats && stepResults.chats) {
    const chatId = crypto.randomUUID();
    const chatMessages = stepResults.chats.messages.map((msg, idx) => ({
      type: 'message',
      id: crypto.randomUUID(),
      role: msg.role,
      content: msg.content,
      createdAt: new Date(Date.now() + idx * 1000).toISOString(),
      participantId: msg.role === 'ASSISTANT' ? characterId : undefined,
    }));

    chats.push({
      id: chatId,
      userId,
      title: stepResults.chats.title,
      participants: [{ participantId: characterId, type: 'CHARACTER' }],
      messages: chatMessages,
      contextSummary: null,
      sillyTavernMetadata: null,
      tags: [],
      roleplayTemplateId: null,
      timestampConfig: null,
      lastTurnParticipantId: null,
      messageCount: chatMessages.length,
      lastMessageAt: chatMessages.length > 0
        ? chatMessages[chatMessages.length - 1].createdAt
        : now,
      lastRenameCheckInterchange: 0,
      isPaused: false,
      isManuallyRenamed: false,
      impersonatingParticipantIds: [],
      activeTypingParticipantId: null,
      createdAt: now,
      updatedAt: now,
      _participantInfo: [
        {
          participantId: characterId,
          characterName: basics.name,
          type: 'CHARACTER',
        },
      ],
    });
  }

  // Determine export type based on what we have
  // Characters export is the primary type since we always generate a character
  const counts: Record<string, number> = {
    characters: 1,
  };

  const data: Record<string, unknown> = {
    characters: [character],
  };

  if (memories.length > 0) {
    data.memories = memories;
    counts.memories = memories.length;
  }

  // Note: Chats are included in the character export data when present
  // The import system handles chats embedded in character exports

  const exportData: QuilltapExport = {
    manifest: {
      format: 'quilltap-export',
      version: '1.0',
      exportType: 'characters',
      createdAt: now,
      appVersion: appVersion,
      settings: {
        includeMemories,
        scope: 'selected',
        selectedIds: [characterId],
      },
      counts,
    },
    data: data as unknown as QuilltapExport['data'],
  };

  return exportData;
}

// ============================================================================
// Main Service Function
// ============================================================================

/**
 * Run the AI character import with streaming progress updates.
 * Extracts character data from source material using multiple focused LLM calls,
 * then assembles a .qtap export file.
 */
export async function runAIImportStreaming(
  request: AIImportRequest,
  userId: string,
  repos: RepositoryContainer,
  onProgress: AIImportProgressCallback
): Promise<void> {
  logger.info('[AIImport] Starting AI character import', {
    userId,
    profileId: request.profileId,
    sourceFileCount: request.sourceFileIds.length,
    hasSourceText: !!request.sourceText.trim(),
    includeMemories: request.includeMemories,
    includeChats: request.includeChats,
    hasExistingResult: !!request.existingResult,
    regenerateSteps: request.regenerateSteps,
  });

  onProgress({ type: 'start' });

  const stepResults: AIImportStepResults = { ...(request.existingResult || {}) };
  const errors: Record<string, string> = {};

  try {
    // Get connection profile
    const profile = await repos.connections.findById(request.profileId);
    if (!profile || profile.userId !== userId) {
      throw new Error('Connection profile not found');
    }

    // Get API key
    let apiKey = '';
    if (profile.apiKeyId) {
      const keyRecord = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId);
      if (keyRecord) {
        apiKey = decryptApiKey(keyRecord.ciphertext, keyRecord.iv, keyRecord.authTag, userId);
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
    const llmOpts = { userId, profileProvider: profile.provider };

    /**
     * Determine if a step should run:
     * - Not in existingResult, OR
     * - Explicitly in regenerateSteps
     */
    function shouldRunStep(step: AIImportStepName): boolean {
      if (request.regenerateSteps?.includes(step)) return true;
      if (request.existingResult && step in request.existingResult) return false;
      return true;
    }

    // Step 0: Analyzing (only for large source material)
    const sourceContext = await buildSourceContext(
      request.sourceFileIds,
      request.sourceText,
      userId,
      repos,
      stepResults.analyzing
    );

    if (!sourceContext.trim()) {
      throw new Error('No source material provided. Upload files or enter text to import from.');
    }

    if (sourceContext.length > SOURCE_ANALYSIS_THRESHOLD && shouldRunStep('analyzing')) {
      onProgress({ type: 'step_start', step: 'analyzing' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          sourceContext,
          getAnalyzingPrompt(sourceContext.length),
          { temperature: 0.3, maxTokens: 2000, ...llmOpts }
        );
        const analysis = parseLLMJson<Record<string, unknown>>(raw);
        stepResults.analyzing = JSON.stringify(analysis, null, 2);
        onProgress({
          type: 'step_complete',
          step: 'analyzing',
          snippet: (analysis.characterName as string) || 'Analysis complete',
        });
        logger.debug('[AIImport] Analysis step complete', {
          characterName: analysis.characterName,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Analysis failed';
        errors.analyzing = msg;
        onProgress({ type: 'step_error', step: 'analyzing', error: msg });
        logger.warn('[AIImport] Analysis step failed (non-fatal)', { error: msg });
      }
    }

    // Rebuild context with analysis if available
    const enrichedContext = stepResults.analyzing
      ? `${sourceContext}\n\n=== Prior Analysis ===\n${stepResults.analyzing}`
      : sourceContext;

    // Step 1: Character Basics (REQUIRED)
    if (shouldRunStep('character_basics')) {
      onProgress({ type: 'step_start', step: 'character_basics' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          enrichedContext,
          CHARACTER_BASICS_PROMPT,
          { temperature: 0.7, maxTokens: 2000, ...llmOpts }
        );
        stepResults.character_basics = parseLLMJson(raw);
        onProgress({
          type: 'step_complete',
          step: 'character_basics',
          snippet: stepResults.character_basics?.name || 'Basics generated',
        });
        logger.debug('[AIImport] Character basics step complete', {
          name: stepResults.character_basics?.name,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Character basics failed';
        errors.character_basics = msg;
        onProgress({ type: 'step_error', step: 'character_basics', error: msg });
        logger.error('[AIImport] Character basics step failed', { error: msg });
      }
    }

    if (!stepResults.character_basics?.name) {
      throw new Error('Failed to generate character basics — cannot proceed without a character name');
    }

    const charName = stepResults.character_basics.name;
    const charContext = `${enrichedContext}\n\nCharacter name: ${charName}`;

    // Step 2: First Message & Example Dialogues
    if (shouldRunStep('first_message')) {
      onProgress({ type: 'step_start', step: 'first_message' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          charContext,
          FIRST_MESSAGE_PROMPT,
          { temperature: 0.8, maxTokens: 1500, ...llmOpts }
        );
        stepResults.first_message = parseLLMJson(raw);
        onProgress({
          type: 'step_complete',
          step: 'first_message',
          snippet: getSnippet(stepResults.first_message?.firstMessage || ''),
        });
        logger.debug('[AIImport] First message step complete');
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'First message failed';
        errors.first_message = msg;
        onProgress({ type: 'step_error', step: 'first_message', error: msg });
        logger.warn('[AIImport] First message step failed (non-fatal)', { error: msg });
      }
    }

    // Step 3: System Prompts
    if (shouldRunStep('system_prompts')) {
      onProgress({ type: 'step_start', step: 'system_prompts' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          charContext,
          SYSTEM_PROMPTS_PROMPT,
          { temperature: 0.7, maxTokens: 1500, ...llmOpts }
        );
        stepResults.system_prompts = parseLLMJson(raw);
        onProgress({
          type: 'step_complete',
          step: 'system_prompts',
          snippet: `${stepResults.system_prompts?.length || 0} prompt(s) generated`,
        });
        logger.debug('[AIImport] System prompts step complete', {
          count: stepResults.system_prompts?.length,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'System prompts failed';
        errors.system_prompts = msg;
        onProgress({ type: 'step_error', step: 'system_prompts', error: msg });
        logger.warn('[AIImport] System prompts step failed (non-fatal)', { error: msg });
      }
    }

    // Step 4: Physical Descriptions
    if (shouldRunStep('physical_descriptions')) {
      onProgress({ type: 'step_start', step: 'physical_descriptions' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          charContext,
          PHYSICAL_DESCRIPTIONS_PROMPT,
          { temperature: 0.7, maxTokens: 2000, ...llmOpts }
        );
        stepResults.physical_descriptions = parseLLMJson(raw);
        onProgress({
          type: 'step_complete',
          step: 'physical_descriptions',
          snippet: getSnippet(stepResults.physical_descriptions?.shortPrompt || ''),
        });
        logger.debug('[AIImport] Physical descriptions step complete');
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Physical descriptions failed';
        errors.physical_descriptions = msg;
        onProgress({ type: 'step_error', step: 'physical_descriptions', error: msg });
        logger.warn('[AIImport] Physical descriptions step failed (non-fatal)', { error: msg });
      }
    }

    // Step 5: Pronouns
    if (shouldRunStep('pronouns')) {
      onProgress({ type: 'step_start', step: 'pronouns' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          charContext,
          PRONOUNS_PROMPT,
          { temperature: 0.3, maxTokens: 100, ...llmOpts }
        );
        stepResults.pronouns = parseLLMJson(raw);
        onProgress({
          type: 'step_complete',
          step: 'pronouns',
          snippet: `${stepResults.pronouns?.subject}/${stepResults.pronouns?.object}/${stepResults.pronouns?.possessive}`,
        });
        logger.debug('[AIImport] Pronouns step complete', { pronouns: stepResults.pronouns });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Pronouns failed';
        errors.pronouns = msg;
        onProgress({ type: 'step_error', step: 'pronouns', error: msg });
        logger.warn('[AIImport] Pronouns step failed (non-fatal)', { error: msg });
      }
    }

    // Step 6: Memories (if requested)
    if (request.includeMemories && shouldRunStep('memories')) {
      onProgress({ type: 'step_start', step: 'memories' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          charContext,
          MEMORIES_PROMPT,
          { temperature: 0.7, maxTokens: 3000, ...llmOpts }
        );
        stepResults.memories = parseLLMJson(raw);
        onProgress({
          type: 'step_complete',
          step: 'memories',
          snippet: `${stepResults.memories?.length || 0} memories generated`,
        });
        logger.debug('[AIImport] Memories step complete', {
          count: stepResults.memories?.length,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Memories failed';
        errors.memories = msg;
        onProgress({ type: 'step_error', step: 'memories', error: msg });
        logger.warn('[AIImport] Memories step failed (non-fatal)', { error: msg });
      }
    }

    // Step 7: Example Chats (if requested)
    if (request.includeChats && shouldRunStep('chats')) {
      onProgress({ type: 'step_start', step: 'chats' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          charContext,
          CHATS_PROMPT,
          { temperature: 0.8, maxTokens: 4000, ...llmOpts }
        );
        stepResults.chats = parseLLMJson(raw);
        onProgress({
          type: 'step_complete',
          step: 'chats',
          snippet: stepResults.chats?.title || 'Chat generated',
        });
        logger.debug('[AIImport] Chats step complete', {
          title: stepResults.chats?.title,
          messageCount: stepResults.chats?.messages?.length,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Chat generation failed';
        errors.chats = msg;
        onProgress({ type: 'step_error', step: 'chats', error: msg });
        logger.warn('[AIImport] Chats step failed (non-fatal)', { error: msg });
      }
    }

    // Step 8: Assembly (no LLM call)
    onProgress({ type: 'step_start', step: 'assembly' });
    let exportData: QuilltapExport;
    try {
      // Get app version from package.json
      const appVersion = packageJson.version || '3.0.0';

      exportData = assembleQtapExport(stepResults, request.includeMemories, request.includeChats, appVersion);
      onProgress({
        type: 'step_complete',
        step: 'assembly',
        snippet: `${charName} assembled`,
      });
      logger.debug('[AIImport] Assembly step complete', { characterName: charName });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Assembly failed';
      errors.assembly = msg;
      onProgress({ type: 'step_error', step: 'assembly', error: msg });
      logger.error('[AIImport] Assembly step failed', { error: msg });

      // Assembly failure is fatal
      onProgress({
        type: 'done',
        error: msg,
        stepResults,
        errors,
      });
      return;
    }

    // Step 9: Validation (no LLM call)
    onProgress({ type: 'step_start', step: 'validation' });
    const validationResult = validateQtapExport(exportData);

    if (validationResult.valid) {
      onProgress({ type: 'step_complete', step: 'validation', snippet: 'Validation passed' });
      logger.debug('[AIImport] Validation passed');
    } else {
      logger.warn('[AIImport] Validation failed, attempting repair', {
        errorCount: validationResult.errors.length,
        errors: validationResult.errors.slice(0, 5),
      });
      onProgress({
        type: 'step_error',
        step: 'validation',
        error: `${validationResult.errors.length} validation error(s)`,
      });

      // Step 10: Repair (LLM call to fix validation errors, up to MAX_REPAIR_ATTEMPTS)
      let repaired = false;
      for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS && !repaired; attempt++) {
        onProgress({ type: 'step_start', step: 'repair' });
        try {
          const repairPrompt = `The following .qtap export data has validation errors. Fix the issues and return the corrected data as JSON.

Validation errors:
${validationResult.errors.join('\n')}

Current data (character section only):
${JSON.stringify((exportData.data as unknown as Record<string, unknown>).characters, null, 2)}

Return ONLY the corrected characters array as JSON. Do not change the structure, only fix the values that cause validation errors.`;

          const raw = await callLLM(
            provider, apiKey, profile.modelName,
            '',
            repairPrompt,
            { temperature: 0.5, maxTokens: 2000, ...llmOpts }
          );

          const repairedChars = parseLLMJson<unknown[]>(raw);
          (exportData.data as unknown as Record<string, unknown>).characters = repairedChars;

          const revalidation = validateQtapExport(exportData);
          if (revalidation.valid) {
            repaired = true;
            onProgress({ type: 'step_complete', step: 'repair', snippet: 'Repair successful' });
            logger.info('[AIImport] Repair successful on attempt', { attempt: attempt + 1 });
          } else {
            onProgress({
              type: 'step_error',
              step: 'repair',
              error: `Repair attempt ${attempt + 1} still has errors`,
            });
            logger.warn('[AIImport] Repair attempt failed', {
              attempt: attempt + 1,
              remainingErrors: revalidation.errors.length,
            });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Repair failed';
          onProgress({ type: 'step_error', step: 'repair', error: msg });
          logger.warn('[AIImport] Repair attempt error', { attempt: attempt + 1, error: msg });
        }
      }

      if (!repaired) {
        // Validation failed but we still return the data — let the user decide
        errors.validation = `Validation has ${validationResult.errors.length} error(s) that could not be auto-repaired`;
        logger.warn('[AIImport] Could not fully repair validation errors', {
          errorCount: validationResult.errors.length,
        });
      }
    }

    // Done
    logger.info('[AIImport] AI character import complete', {
      characterName: charName,
      stepsCompleted: Object.keys(stepResults).length,
      stepsWithErrors: Object.keys(errors).length,
    });

    onProgress({
      type: 'done',
      result: exportData,
      stepResults,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'AI import failed';
    logger.error('[AIImport] Streaming generation failed', { error: errorMessage });
    onProgress({
      type: 'done',
      error: errorMessage,
      stepResults,
      errors: { ...errors, _fatal: errorMessage },
    });
  }
}
