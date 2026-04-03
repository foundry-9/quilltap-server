/**
 * Memories API v1 - Collection Endpoint
 *
 * Consolidated REST API for memory operations.
 *
 * GET /api/v1/memories - List memories (requires characterId, chatId, or messageId query param)
 * POST /api/v1/memories - Create memory (characterId in body) OR actions via ?action=
 * DELETE /api/v1/memories - Delete memories by filter (e.g., ?chatId= for bulk delete)
 *
 * Actions (via ?action= query parameter):
 * - POST ?action=search - Semantic/keyword search (characterId in body)
 * - POST ?action=housekeep - Run memory cleanup (characterId in body)
 * - POST ?action=embeddings - Generate missing embeddings (characterId in body)
 * - PUT ?action=embeddings - Rebuild vector index (characterId in body)
 * - GET ?action=housekeep&characterId= - Get housekeeping preview
 * - GET ?action=embeddings&characterId= - Get embedding status
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createAuthenticatedHandler,
  getActionParam,
} from '@/lib/api/middleware';
import { createMemoryWithEmbedding, searchMemoriesSemantic, generateMissingEmbeddings, rebuildVectorIndex } from '@/lib/memory/memory-service';
import { runHousekeeping, getHousekeepingPreview, HousekeepingOptions } from '@/lib/memory/housekeeping';
import { getCharacterVectorStore } from '@/lib/embedding/vector-store';
import { scheduleRefit } from '@/lib/embedding/embedding-job-scheduler';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses';
import type { ChatEvent, MessageEvent, ChatMetadata } from '@/lib/schemas/types';

// =============================================================================
// Validation Schemas
// =============================================================================

const createMemorySchema = z.object({
  characterId: z.uuid('Character ID is required'),
  content: z.string().min(1, 'Memory content is required'),
  summary: z.string().min(1, 'Memory summary is required'),
  keywords: z.array(z.string()).prefault([]),
  tags: z.array(z.uuid()).prefault([]),
  importance: z.number().min(0).max(1).prefault(0.5),
  aboutCharacterId: z.uuid().nullable().optional(),
  personaId: z.uuid().nullable().optional(), // Legacy support
  chatId: z.uuid().nullable().optional(),
  source: z.enum(['AUTO', 'MANUAL']).prefault('MANUAL'),
  sourceMessageId: z.uuid().nullable().optional(),
  skipGate: z.boolean().optional(),
});

const searchMemorySchema = z.object({
  characterId: z.uuid('Character ID is required'),
  query: z.string().min(1, 'Search query is required'),
  limit: z.number().min(1).max(100).prefault(20),
  minImportance: z.number().min(0).max(1).optional(),
  minScore: z.number().min(0).max(1).optional(),
  source: z.enum(['AUTO', 'MANUAL']).optional(),
});

const housekeepingOptionsSchema = z.object({
  characterId: z.uuid('Character ID is required'),
  maxMemories: z.number().min(10).max(10000).optional(),
  maxAgeMonths: z.number().min(1).max(120).optional(),
  maxInactiveMonths: z.number().min(1).max(120).optional(),
  minImportance: z.number().min(0).max(1).optional(),
  mergeSimilar: z.boolean().optional(),
  mergeThreshold: z.number().min(0.8).max(1).optional(),
  dryRun: z.boolean().optional(),
});

const generateEmbeddingsSchema = z.object({
  characterId: z.uuid('Character ID is required'),
  batchSize: z.number().min(1).max(50).prefault(10),
});

const rebuildIndexSchema = z.object({
  characterId: z.uuid('Character ID is required'),
  confirm: z.literal(true, {
    error: () => 'Must confirm rebuild with confirm: true',
  }),
});

// =============================================================================
// GET /api/v1/memories - List memories
// =============================================================================

export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {
  const action = getActionParam(req);
  const { searchParams } = req.nextUrl;
  const characterId = searchParams.get('characterId');
  const chatId = searchParams.get('chatId');
  const messageId = searchParams.get('messageId');

  // Handle action-based GET requests
  if (action === 'housekeep') {
    return handleHousekeepPreview(req, { user, repos }, characterId);
  }

  if (action === 'embeddings') {
    return handleEmbeddingStatus(req, { user, repos }, characterId);
  }

  // Standard list operations - require a filter
  if (!characterId && !chatId && !messageId) {
    return badRequest('Query parameter required: characterId, chatId, or messageId');
  }

  try {
    // List by character
    if (characterId) {
      return listMemoriesByCharacter(req, { user, repos }, characterId);
    }

    // Count by chat
    if (chatId) {
      return countMemoriesByChat(req, { user, repos }, chatId);
    }

    // Get by message
    if (messageId) {
      return getMemoriesByMessage(req, { user, repos }, messageId);
    }

    return badRequest('Invalid query parameters');
  } catch (error) {
    logger.error('[Memories API] Error listing memories', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to list memories');
  }
});

// =============================================================================
// POST /api/v1/memories - Create memory or perform action
// =============================================================================

export const POST = createAuthenticatedHandler(async (req, { user, repos }) => {
  const action = getActionParam(req);

  // Action-based operations
  if (action === 'search') {
    return handleSearch(req, { user, repos });
  }

  if (action === 'housekeep') {
    return handleHousekeep(req, { user, repos });
  }

  if (action === 'embeddings') {
    return handleGenerateEmbeddings(req, { user, repos });
  }

  // Default: Create memory
  return handleCreateMemory(req, { user, repos });
});

// =============================================================================
// PUT /api/v1/memories - Bulk operations (action-based only)
// =============================================================================

export const PUT = createAuthenticatedHandler(async (req, { user, repos }) => {
  const action = getActionParam(req);

  if (action === 'embeddings') {
    return handleRebuildIndex(req, { user, repos });
  }

  return badRequest('PUT requires ?action=embeddings parameter');
});

// =============================================================================
// DELETE /api/v1/memories - Delete memories by filter
// =============================================================================

export const DELETE = createAuthenticatedHandler(async (req, { user, repos }) => {
  const chatId = req.nextUrl.searchParams.get('chatId');

  if (!chatId) {
    return badRequest('Query parameter required: chatId');
  }

  return handleDeleteByChatId(req, { user, repos }, chatId);
});

// =============================================================================
// Handler Implementations
// =============================================================================

async function listMemoriesByCharacter(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  characterId: string
) {
  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Get query params for filtering
  const { searchParams } = req.nextUrl;
  const search = searchParams.get('search');
  const minImportance = searchParams.get('minImportance');
  const source = searchParams.get('source');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  // Get memories
  let memories = await repos.memories.findByCharacterId(characterId);

  // Apply filters
  if (search) {
    const searchLower = search.toLowerCase();
    memories = memories.filter((memory: any) =>
      memory.content.toLowerCase().includes(searchLower) ||
      memory.summary.toLowerCase().includes(searchLower) ||
      memory.keywords.some((k: string) => k.toLowerCase().includes(searchLower))
    );
  }

  if (minImportance) {
    const minImp = parseFloat(minImportance);
    if (!isNaN(minImp)) {
      memories = memories.filter((m: any) => m.importance >= minImp);
    }
  }

  if (source && (source === 'AUTO' || source === 'MANUAL')) {
    memories = memories.filter((m: any) => m.source === source);
  }

  // Sort
  memories.sort((a: any, b: any) => {
    let comparison = 0;
    switch (sortBy) {
      case 'importance':
        comparison = a.importance - b.importance;
        break;
      case 'updatedAt':
        comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
      case 'createdAt':
      default:
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
    }
    return sortOrder === 'desc' ? -comparison : comparison;
  });

  // Enrich with tag names
  const allTags = await repos.tags.findAll();
  const tagMap = new Map(allTags.map((t: any) => [t.id, t]));

  const memoriesWithTags = memories.map((memory: any) => ({
    ...memory,
    tagDetails: memory.tags.map((tagId: string) => tagMap.get(tagId)).filter(Boolean),
  }));

  return NextResponse.json({
    memories: memoriesWithTags,
    count: memoriesWithTags.length,
  });
}

async function countMemoriesByChat(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  chatId: string
) {
  // Verify chat ownership
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  const count = await repos.memories.countByChatId(chatId);

  return NextResponse.json({
    chatId,
    memoryCount: count,
  });
}

async function getMemoriesByMessage(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  messageId: string
) {
  // Find the message across user's chats
  const userChats = await repos.chats.findByUserId(user.id);
  let foundChat: ChatMetadata | null = null;
  let foundMessage: MessageEvent | null = null;
  let allMessages: ChatEvent[] = [];

  for (const chat of userChats) {
    const messages = await repos.chats.getMessages(chat.id);
    const message = messages.find(
      (m: ChatEvent): m is MessageEvent => m.type === 'message' && m.id === messageId
    );
    if (message) {
      foundChat = chat;
      foundMessage = message;
      allMessages = messages;
      break;
    }
  }

  if (!foundMessage || !foundChat) {
    return notFound('Message');
  }

  // Get all message IDs in swipe group if applicable
  let messageIds: string[] = [messageId];
  if (foundMessage.swipeGroupId) {
    messageIds = allMessages
      .filter(
        (m): m is MessageEvent =>
          m.type === 'message' && m.swipeGroupId === foundMessage!.swipeGroupId
      )
      .map((m) => m.id);
  }

  // Get memory count and details
  const memoryCount = await repos.memories.countBySourceMessageIds(messageIds);
  let memories: Array<{
    id: string;
    summary: string;
    characterId: string;
    importance: number;
  }> = [];

  if (memoryCount > 0) {
    const memoryResults = await Promise.all(
      messageIds.map((mid) => repos.memories.findBySourceMessageId(mid))
    );
    memories = memoryResults.flat().map((m: any) => ({
      id: m.id,
      summary: m.summary,
      characterId: m.characterId,
      importance: m.importance,
    }));
  }

  return NextResponse.json({
    memoryCount,
    isSwipeGroup: !!foundMessage.swipeGroupId,
    swipeCount: messageIds.length,
    memories,
  });
}

async function handleCreateMemory(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json();
  const validatedData = createMemorySchema.parse(body);

  // Verify character ownership
  const character = await repos.characters.findById(validatedData.characterId);
  if (!character) {
    return notFound('Character');
  }

  // Create memory with embedding generation
  const memory = await createMemoryWithEmbedding(
    {
      characterId: validatedData.characterId,
      content: validatedData.content,
      summary: validatedData.summary,
      keywords: validatedData.keywords,
      tags: validatedData.tags,
      importance: validatedData.importance,
      aboutCharacterId: validatedData.aboutCharacterId,
      personaId: validatedData.personaId,
      chatId: validatedData.chatId,
      source: validatedData.source,
      sourceMessageId: validatedData.sourceMessageId,
    },
    { userId: user.id, skipGate: validatedData.skipGate }
  );

  // Schedule vocabulary refit for BUILTIN profiles (debounced)
  // This runs in the background and doesn't block the response
  scheduleRefit(user.id).catch((error) => {
    logger.warn('[Memories API] Failed to schedule refit', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return NextResponse.json({ memory }, { status: 201 });
}

async function handleSearch(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json();
  const { characterId, query, limit, minImportance, minScore, source } = searchMemorySchema.parse(body);

  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Semantic search
  const searchResults = await searchMemoriesSemantic(characterId, query, {
    userId: user.id,
    limit,
    minScore,
    minImportance,
    source,
  });

  // Enrich with tag names
  const allTags = await repos.tags.findAll();
  const tagMap = new Map(allTags.map((t: any) => [t.id, t]));

  const memoriesWithTags = searchResults.map((result: any) => ({
    ...result.memory,
    score: result.score,
    usedEmbedding: result.usedEmbedding,
    tagDetails: result.memory.tags.map((tagId: string) => tagMap.get(tagId)).filter(Boolean),
  }));

  // Update access times (fire and forget)
  Promise.all(
    searchResults.map((r: any) => repos.memories.updateAccessTime(characterId, r.memory.id))
  ).catch((err) =>
    logger.warn('[Memories API] Failed to update access times after search', {
      characterId,
      error: err instanceof Error ? err.message : String(err),
    })
  );

  return NextResponse.json({
    memories: memoriesWithTags,
    count: memoriesWithTags.length,
    query,
    usedEmbedding: searchResults.length > 0 ? searchResults[0].usedEmbedding : false,
  });
}

async function handleHousekeep(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json().catch(() => ({}));
  const optionsResult = housekeepingOptionsSchema.safeParse(body);

  if (!optionsResult.success) {
    return validationError(optionsResult.error);
  }

  const { characterId, ...optionData } = optionsResult.data;

  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  const options: HousekeepingOptions = {
    ...optionData,
    userId: user.id,
  };

  // Get embedding profile from chat settings
  const chatSettings = await repos.chatSettings.findByUserId(user.id);
  if (chatSettings?.cheapLLMSettings?.embeddingProfileId) {
    options.embeddingProfileId = chatSettings.cheapLLMSettings.embeddingProfileId;
  }

  // Run housekeeping (or preview if dryRun)
  const result = options.dryRun
    ? await getHousekeepingPreview(characterId, options)
    : await runHousekeeping(characterId, options);

  return NextResponse.json({
    success: true,
    dryRun: !!options.dryRun,
    result: {
      deleted: result.deleted,
      merged: result.merged,
      kept: result.kept,
      totalBefore: result.totalBefore,
      totalAfter: result.totalAfter,
      deletedIds: result.deletedIds,
      mergedIds: result.mergedIds,
      details: options.dryRun ? result.details : undefined,
    },
  });
}

async function handleHousekeepPreview(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  characterId: string | null
) {
  if (!characterId) {
    return badRequest('characterId query parameter required for housekeep preview');
  }

  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Parse options from query params
  const { searchParams } = req.nextUrl;
  const options: HousekeepingOptions = { userId: user.id };

  if (searchParams.has('maxMemories')) {
    const val = parseInt(searchParams.get('maxMemories')!, 10);
    if (isNaN(val) || val < 1 || val > 100000) {
      return badRequest('maxMemories must be an integer between 1 and 100000');
    }
    options.maxMemories = val;
  }
  if (searchParams.has('maxAgeMonths')) {
    const val = parseInt(searchParams.get('maxAgeMonths')!, 10);
    if (isNaN(val) || val < 1 || val > 1200) {
      return badRequest('maxAgeMonths must be an integer between 1 and 1200');
    }
    options.maxAgeMonths = val;
  }
  if (searchParams.has('minImportance')) {
    const val = parseFloat(searchParams.get('minImportance')!);
    if (isNaN(val) || val < 0 || val > 1) {
      return badRequest('minImportance must be a number between 0 and 1');
    }
    options.minImportance = val;
  }
  if (searchParams.has('mergeSimilar')) {
    options.mergeSimilar = searchParams.get('mergeSimilar') === 'true';
  }

  // Get embedding profile from chat settings
  const chatSettings = await repos.chatSettings.findByUserId(user.id);
  if (chatSettings?.cheapLLMSettings?.embeddingProfileId) {
    options.embeddingProfileId = chatSettings.cheapLLMSettings.embeddingProfileId;
  }

  const preview = await getHousekeepingPreview(characterId, options);

  return NextResponse.json({
    success: true,
    preview: {
      wouldDelete: preview.deleted,
      wouldMerge: preview.merged,
      wouldKeep: preview.kept,
      totalBefore: preview.totalBefore,
      totalAfter: preview.totalAfter,
      details: preview.details,
    },
  });
}

async function handleGenerateEmbeddings(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json().catch(() => ({}));
  const { characterId, batchSize } = generateEmbeddingsSchema.parse(body);

  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Check embedding profile
  const defaultProfile = await repos.embeddingProfiles.findDefault(user.id);
  if (!defaultProfile) {
    return badRequest('No embedding profile configured. Please set up an embedding profile in settings.');
  }

  // Get memory stats
  const memories = await repos.memories.findByCharacterId(characterId);
  const memoriesWithoutEmbeddings = memories.filter(
    (m: any) => !m.embedding || m.embedding.length === 0
  );

  if (memoriesWithoutEmbeddings.length === 0) {
    return NextResponse.json({
      message: 'All memories already have embeddings',
      processed: 0,
      failed: 0,
      skipped: 0,
      total: memories.length,
    });
  }

  // Generate embeddings
  const result = await generateMissingEmbeddings(characterId, {
    userId: user.id,
    batchSize,
  });

  return NextResponse.json({
    message: 'Embedding generation complete',
    ...result,
    total: memories.length,
    remaining: memoriesWithoutEmbeddings.length - result.processed - result.failed,
  });
}

async function handleEmbeddingStatus(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  characterId: string | null
) {
  if (!characterId) {
    return badRequest('characterId query parameter required for embedding status');
  }

  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Get memory stats
  const memories = await repos.memories.findByCharacterId(characterId);
  const withEmbeddings = memories.filter((m: any) => m.embedding && m.embedding.length > 0);
  const withoutEmbeddings = memories.filter((m: any) => !m.embedding || m.embedding.length === 0);

  // Check if embedding profile is configured
  const defaultProfile = await repos.embeddingProfiles.findDefault(user.id);

  return NextResponse.json({
    total: memories.length,
    withEmbeddings: withEmbeddings.length,
    withoutEmbeddings: withoutEmbeddings.length,
    percentComplete: memories.length > 0
      ? Math.round((withEmbeddings.length / memories.length) * 100)
      : 100,
    embeddingProfileConfigured: defaultProfile !== null,
    embeddingProfileName: defaultProfile?.name || null,
  });
}

async function handleRebuildIndex(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json();
  const { characterId } = rebuildIndexSchema.parse(body);

  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Rebuild the vector index
  const result = await rebuildVectorIndex(characterId, { userId: user.id });

  return NextResponse.json({
    message: 'Vector index rebuilt successfully',
    ...result,
  });
}

async function handleDeleteByChatId(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  chatId: string
) {
  // Verify chat ownership
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  // Get all memories for this chat first (for vector store cleanup)
  const memories = await repos.memories.findByChatId(chatId);

  if (memories.length === 0) {
    return NextResponse.json({
      success: true,
      chatId,
      deletedCount: 0,
    });
  }

  logger.info('[Memories API] Deleting memories for chat', {
    chatId,
    memoryCount: memories.length,
  });

  // Group memories by character for vector store cleanup
  const memoriesByCharacter = new Map<string, string[]>();
  for (const memory of memories) {
    const existing = memoriesByCharacter.get(memory.characterId) || [];
    existing.push(memory.id);
    memoriesByCharacter.set(memory.characterId, existing);
  }

  // Clean up vector stores
  for (const [characterId, memoryIds] of memoriesByCharacter) {
    try {
      const vectorStore = await getCharacterVectorStore(characterId);
      for (const memoryId of memoryIds) {
        try {
          await vectorStore.removeVector(memoryId);
        } catch (err) {
          logger.warn('[Memories API] Failed to remove vector', {
            characterId,
            memoryId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      await vectorStore.save();
    } catch (err) {
      logger.warn('[Memories API] Failed to clean up vector store', {
        characterId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Delete from database
  const deletedCount = await repos.memories.deleteByChatId(chatId);

  logger.info('[Memories API] Memories deleted successfully', {
    chatId,
    deletedCount,
  });

  return NextResponse.json({
    success: true,
    chatId,
    deletedCount,
  });
}
