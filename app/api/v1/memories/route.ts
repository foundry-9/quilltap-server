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
 * - POST ?action=maintain - Memory maintenance ({ characterId?, phases?, dryRun?, settings? }); naming `consolidate` implies `mirror`. A dry run runs in-process and returns the report (`reports` for a user-wide dry run, allowed only for the LLM-free phases); otherwise one MEMORY_MAINTENANCE job per character (or for every character the user owns) is enqueued and `{ jobIds }` returned
 * - POST ?action=embeddings - Generate missing embeddings (characterId in body)
 * - POST ?action=maintenance-config - Update memory maintenance settings (enabled, per-phase toggles, per-character cap and overrides; instance-wide)
 * - POST ?action=repair - Graph repair ({ characterId?, dryRun? }): find links to rows that no longer exist and rows without embeddings; a live run scrubs the links and queues embedding jobs
 * - POST ?action=extraction-limits-config - Update per-hour extraction rate limits
 * - POST ?action=recall-config - Update recall relevance settings (cross-project scope policy, related-memory expansion)
 * - POST ?action=consolidation-config - Update consolidation settings (instance-wide)
 * - POST ?action=extraction-mode-config - Update the extraction grain of the OTHER pass (instance-wide)
 * - POST ?action=backfill-embeddings - Enqueue embedding-generate jobs for memories missing an embedding
 * - POST ?action=regenerate-all - Wipe and rebuild every chat-linked memory in the background
 * - POST ?action=anchor-gate-probe - Measure whether the embedded anchor line suppresses gate reinforcement (read-only dev tool; characterId in body)
 * - PUT ?action=embeddings - Rebuild vector index (characterId in body)
 * - GET ?action=maintenance-status[&characterId=] - The maintenance ledger: last run per phase, last outcome, last demotion's effectiveness
 * - GET ?action=embeddings&characterId= - Get embedding status
 * - GET ?action=maintenance-config - Read memory maintenance settings
 * - GET ?action=extraction-limits-config - Read current extraction rate limits
 * - GET ?action=recall-config - Read current recall relevance settings
 * - GET ?action=consolidation-config - Read consolidation settings
 * - GET ?action=extraction-mode-config - Read the extraction grain settings
 * - GET ?action=backfill-embeddings - Report progress of the embedding backfill
 * - GET ?action=character-memory-counts - List user's characters with memory counts (for the Maintenance card)
 * - GET ?action=regenerate-all - Report whether a regenerate sweep is in flight
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createContextHandler,
  dispatchAction,
  type RequestContext,
} from '@/lib/api/middleware';
import { searchMemories } from '@/lib/memory/recall/search';
import { generateMissingEmbeddings, rebuildVectorIndex, enqueueMissingEmbeddings } from '@/lib/memory/index-store/backfill';
import { admitCandidate, admissionInserted } from '@/lib/memory/admission';
import { retireChatMemories } from '@/lib/memory/retire';
import { repairMemoryGraph } from '@/lib/memory/repair';
import {
  runMaintenance,
  getMaintenanceLedgerStatus,
  MAINTENANCE_PHASES,
  withImpliedPhases,
  type MaintenanceReport,
} from '@/lib/memory/maintenance';
import { runAnchorGateProbe } from '@/lib/memory/anchor-gate-probe';
import { filterImportance, TOOL_MIN_IMPORTANCE } from '@/lib/memory/scoring';
import { MemoryCandidateSchema, MEMORY_ENTITY_CAP } from '@/lib/memory/candidate';
import {
  MemoryMaintenanceCapSchema,
  MemoryMaintenanceCapOverridesSchema,
  MemoryMaintenancePhaseTogglesSchema,
} from '@/lib/schemas/settings.types';
import { scheduleRefit } from '@/lib/embedding/embedding-job-scheduler';
import { enqueueMemoryMaintenance, enqueueMemoryMaintenanceForUser, enqueueMemoryRegenerateAll } from '@/lib/background-jobs/queue-service';
import {
  getMemoryMaintenanceSettings,
  setMemoryMaintenanceSettings,
  getMemoryExtractionLimits,
  setMemoryExtractionLimits,
  getMemoryRecallSettings,
  setMemoryRecallSettings,
  getMemoryConsolidationSettings,
  setMemoryConsolidationSettings,
  getMemoryExtractionModeSettings,
  setMemoryExtractionModeSettings,
} from '@/lib/instance-settings';
import {
  MemoryConsolidationSettingsSchema,
  MemoryExtractionLimitsSchema,
  MemoryExtractionModeSettingsSchema,
  MemoryRecallSettingsSchema,
} from '@/lib/schemas/settings.types';
import { patchSchemaOf } from '@/lib/schemas/patch-schema';
import { MemoryKindEnum } from '@/lib/schemas/memory.types';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, validationError, successResponse, errorResponse } from '@/lib/api/responses';
import type { ChatEvent, MessageEvent, ChatMetadata } from '@/lib/schemas/types';
import { readConciergeSettings } from '@/lib/services/dangerous-content/resolver.service';

// =============================================================================
// Validation Schemas
// =============================================================================

const createMemorySchema = z.object({
  characterId: z.uuid('Character ID is required'),
  // Trimmed: blank text is the client's 400, never an admission reject (bug 236).
  content: z.string().trim().min(1, 'Memory content is required'),
  summary: z.string().trim().min(1, 'Memory summary is required'),
  keywords: z.array(z.string()).prefault([]),
  tags: z.array(z.uuid()).prefault([]),
  importance: z.number().min(0).max(1).prefault(0.5),
  aboutCharacterId: z.uuid().nullable().optional(),
  chatId: z.uuid().nullable().optional(),
  /** Explicit project; otherwise derived from `chatId`'s chat when it has one. */
  projectId: z.uuid().nullable().optional(),
  sourceMessageId: z.uuid().nullable().optional(),
  kind: MemoryKindEnum.optional(),
  /** ISO wall-clock time of the event the memory records. */
  occurredAt: z.iso.datetime({ offset: true }).nullable().optional(),
  /** The candidate schema's bound (`MEMORY_ENTITY_CAP`). */
  entities: z.array(z.string().min(1)).max(MEMORY_ENTITY_CAP).optional(),
  // Deliberately absent (bug 218, refactor decision 13): `source` is always
  // MANUAL here — a client-claimed AUTO would switch on the extractor-only
  // heuristics — and `skipGate` has left the API, so every manual write goes
  // through the gate. Zod strips both if a caller still sends them.
});

const searchMemorySchema = z.object({
  characterId: z.uuid('Character ID is required'),
  query: z.string().min(1, 'Search query is required'),
  limit: z.number().min(1).max(100).prefault(20),
  minImportance: z.number().min(0).max(1).optional(),
  minScore: z.number().min(0).max(1).optional(),
  source: z.enum(['AUTO', 'MANUAL', 'CONSOLIDATED']).optional(),
});


/** `?action=maintain`. */
const maintainSchema = z.object({
  /** One character; omitted, every character the user owns (not for a dry run). */
  characterId: z.uuid().optional(),
  phases: z.array(z.enum(MAINTENANCE_PHASES)).min(1).optional(),
  dryRun: z.boolean().optional(),
  settings: z
    .object({
      consolidation: patchSchemaOf(MemoryConsolidationSettingsSchema).optional(),
      maxClustersPerRun: z.number().int().min(1).max(1000).optional(),
      cap: MemoryMaintenanceCapSchema.optional(),
    })
    .optional(),
});

/** `?action=repair`. */
const repairSchema = z.object({
  /** One character; omitted, every memory in the instance. */
  characterId: z.uuid().optional(),
  dryRun: z.boolean().optional(),
});

const generateEmbeddingsSchema = z.object({
  characterId: z.uuid('Character ID is required'),
});

const rebuildIndexSchema = z.object({
  characterId: z.uuid('Character ID is required'),
  confirm: z.literal(true, {
    error: () => 'Must confirm rebuild with confirm: true',
  }),
});

// The maintenance settings validate through their own schema (bounds included,
// overrides too); unknown keys such as the retired merge knobs are stripped.
const maintenanceConfigSchema = z.object({
  enabled: z.boolean().optional(),
  phases: patchSchemaOf(MemoryMaintenancePhaseTogglesSchema).optional(),
  perCharacterCap: MemoryMaintenanceCapSchema.optional(),
  perCharacterCapOverrides: MemoryMaintenanceCapOverridesSchema.optional(),
});

// Every settings write validates through the façade's own schemas, as a patch:
// an omitted key stays omitted, so a card that sends one field changes one
// field (bug 244 — `.partial()` alone re-applies every default).
const extractionLimitsConfigSchema = patchSchemaOf(MemoryExtractionLimitsSchema);

const recallConfigSchema = patchSchemaOf(MemoryRecallSettingsSchema);

const consolidationConfigSchema = patchSchemaOf(MemoryConsolidationSettingsSchema);

const extractionModeConfigSchema = patchSchemaOf(MemoryExtractionModeSettingsSchema);


const backfillStartSchema = z.object({
  /** Restrict backfill to one character; omit to backfill all of user's characters. */
  characterId: z.uuid().optional(),
  /** Batch size per call (caller may poll repeatedly for large backlogs). */
  batchSize: z.number().int().min(1).max(2000).prefault(500),
});

// =============================================================================
// GET /api/v1/memories - List memories
// =============================================================================

export const GET = createContextHandler(async (req, { user, repos }) => {
  const { searchParams } = req.nextUrl;
  const characterId = searchParams.get('characterId');
  const chatId = searchParams.get('chatId');
  const messageId = searchParams.get('messageId');

  return dispatchAction(
    req,
    {
      'maintenance-status': () => handleMaintenanceStatus(req, { user, repos }),
      embeddings: () => handleEmbeddingStatus(req, { user, repos }, characterId),
      'maintenance-config': () => handleReadMaintenanceConfig(req, { user, repos }),
      'extraction-limits-config': () => handleReadExtractionLimitsConfig(req, { user, repos }),
      'recall-config': () => handleReadRecallConfig(req, { user, repos }),
      'consolidation-config': () => handleReadConsolidationConfig(),
      'extraction-mode-config': () => handleReadExtractionModeConfig(),
      'backfill-embeddings': () => handleBackfillProgress(req, { user, repos }),
      'character-memory-counts': () => handleCharacterMemoryCounts(req, { user, repos }),
      'regenerate-all': () => handleRegenerateAllStatus(req, { user, repos }),
    },
    () => handleListMemories(req, { user, repos }, { characterId, chatId, messageId })
  );
});

async function handleListMemories(
  req: NextRequest,
  { user, repos }: Pick<RequestContext, 'user' | 'repos'>,
  { characterId, chatId, messageId }: { characterId: string | null; chatId: string | null; messageId: string | null }
): Promise<NextResponse> {
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
}

// =============================================================================
// POST /api/v1/memories - Create memory or perform action
// =============================================================================

export const POST = createContextHandler(async (req, { user, repos }) =>
  dispatchAction(
    req,
    {
      search: () => handleSearch(req, { user, repos }),
      maintain: () => handleMaintain(req, { user, repos }),
      repair: () => handleRepair(req, { user, repos }),
      embeddings: () => handleGenerateEmbeddings(req, { user, repos }),
      'maintenance-config': () => handleWriteMaintenanceConfig(req, { user, repos }),
      'extraction-limits-config': () => handleWriteExtractionLimitsConfig(req, { user, repos }),
      'recall-config': () => handleWriteRecallConfig(req, { user, repos }),
      'consolidation-config': () => handleWriteConsolidationConfig(req),
      'extraction-mode-config': () => handleWriteExtractionModeConfig(req),
      'backfill-embeddings': () => handleBackfillStart(req, { user, repos }),
      'regenerate-all': () => handleRegenerateAll(req, { user, repos }),
      'anchor-gate-probe': () => handleAnchorGateProbe(req, { user, repos }),
    },
    () => handleCreateMemory(req, { user, repos })
  )
);

// =============================================================================
// PUT /api/v1/memories - Bulk operations (action-based only)
// =============================================================================

export const PUT = createContextHandler(async (req, { user, repos }) =>
  dispatchAction(req, { embeddings: () => handleRebuildIndex(req, { user, repos }) })
);

// =============================================================================
// DELETE /api/v1/memories - Delete memories by filter
// =============================================================================

export const DELETE = createContextHandler(async (req, { user, repos }) => {
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

  // Get query params for filtering and pagination
  const { searchParams } = req.nextUrl;
  const search = searchParams.get('search') || undefined;
  const minImportanceParam = searchParams.get('minImportance');
  const source = searchParams.get('source') as 'AUTO' | 'MANUAL' | 'CONSOLIDATED' | null;
  const tierParam = searchParams.get('tier');
  const tier: 'hot' | 'cold' | undefined = tierParam === 'hot' || tierParam === 'cold' ? tierParam : undefined;
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';

  // Pagination params (default: no limit = return all for backward compat)
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');

  const minImportance = minImportanceParam ? parseFloat(minImportanceParam) : undefined;

  // If pagination params provided, use paginated query
  if (limitParam) {
    const limit = Math.max(1, Math.min(200, parseInt(limitParam, 10) || 50));
    const offset = Math.max(0, parseInt(offsetParam || '0', 10) || 0);

    const { memories, totalCount } = await repos.memories.findByCharacterIdPaginated(characterId, {
      limit,
      offset,
      sortBy,
      sortOrder,
      search,
      source: source && (source === 'AUTO' || source === 'MANUAL' || source === 'CONSOLIDATED') ? source : undefined,
      minImportance: minImportance !== undefined && !isNaN(minImportance) ? minImportance : undefined,
      tier,
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
      totalCount,
    });
  }

  // Legacy unpaginated path (for other callers)
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

  if (minImportance !== undefined && !isNaN(minImportance)) {
    memories = memories.filter((m: any) => filterImportance(m) >= minImportance);
  }

  if (source && (source === 'AUTO' || source === 'MANUAL' || source === 'CONSOLIDATED')) {
    memories = memories.filter((m: any) => m.source === source);
  }

  if (tier) {
    memories = memories.filter((m: any) => (m.tier ?? 'hot') === tier);
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
    totalCount: memoriesWithTags.length,
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
  const parsed = createMemorySchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  const validatedData = parsed.data;

  if (body && typeof body === 'object' && ('skipGate' in body || ('source' in body && body.source !== 'MANUAL'))) {
    logger.debug('[Memories API] Ignoring client-supplied source/skipGate on manual create', {
      characterId: validatedData.characterId,
      source: body.source,
      skipGate: body.skipGate,
    });
  }

  // Verify character ownership
  const character = await repos.characters.findById(validatedData.characterId);
  if (!character) {
    return notFound('Character');
  }

  // Resolve the project: an explicit one must exist; otherwise the source
  // chat's project (if any) is the memory's, as it is for extracted rows.
  let projectId: string | null = null;
  if (validatedData.projectId) {
    const project = await repos.projects.findById(validatedData.projectId);
    if (!project) {
      return notFound('Project');
    }
    projectId = project.id;
  }
  if (validatedData.chatId) {
    const chat = await repos.chats.findById(validatedData.chatId);
    if (!chat) {
      return notFound('Chat');
    }
    if (!projectId) {
      projectId = chat.projectId ?? null;
    }
  }

  // Every manual write goes through the gate (decision 13): source forced to
  // MANUAL, provenance stamped 'manual'. A hand-written memory carries no
  // targeting tags (it reads as the defaults) and its event time is given,
  // not phrased.
  const parsedCandidate = MemoryCandidateSchema.safeParse({
    content: validatedData.content,
    summary: validatedData.summary,
    keywords: validatedData.keywords,
    targeting: null,
    importance: validatedData.importance,
    kind: validatedData.kind ?? 'semantic',
    when: null,
    entities: validatedData.entities ?? [],
    tags: validatedData.tags,
    subject: { holderId: validatedData.characterId, aboutId: validatedData.aboutCharacterId ?? null },
    provenance: {
      source: 'MANUAL',
      witnessedContext: 'manual',
      chatId: validatedData.chatId ?? null,
      projectId,
      sourceMessageId: validatedData.sourceMessageId ?? null,
      anchorTimeMs: Date.now(),
      pass: 'manual',
    },
  });
  if (!parsedCandidate.success) {
    // The request schema should already have refused anything the candidate
    // refuses; a gap between the two is still the client's 400, never a 500.
    logger.debug('[Memories API] Manual memory refused by the candidate schema', {
      characterId: validatedData.characterId,
      issues: parsedCandidate.error.issues.length,
    });
    return validationError(parsedCandidate.error);
  }
  const candidate = parsedCandidate.data;
  // A hand-written memory never folds into an extracted row (it is inserted
  // and linked instead); folded into a MANUAL row or a digest, it raises that
  // row's importance to the one asked for.
  const outcome = await admitCandidate(
    candidate,
    { occurredAt: validatedData.occurredAt ?? null, narrativeTime: null },
    { userId: user.id }
  );

  const memory = outcome.memory;
  if (!memory) {
    // Nothing was written. Say why: only an embedding failure is the
    // provider's fault (bug 236).
    const reason = outcome.action.kind === 'reject' ? outcome.action.reason : 'unknown';
    logger.debug('[Memories API] Manual memory not admitted', {
      characterId: validatedData.characterId,
      reason,
    });
    if (reason === 'empty') {
      return badRequest('Memory content and summary must not be blank.');
    }
    if (reason === 'embedding-failed') {
      // A memory without an embedding would be invisible to every future
      // admission, so none was kept. The edit route answers the same way.
      return errorResponse(
        'The memory was not saved because its text could not be embedded. Check the configured embedding profile.',
        502
      );
    }
    return serverError('The memory was not saved.');
  }

  const inserted = admissionInserted(outcome);
  logger.debug('[Memories API] Manual memory create resolved', {
    characterId: validatedData.characterId,
    memoryId: memory.id,
    action: outcome.action.kind,
    inserted,
    projectId,
  });

  // Schedule vocabulary refit for BUILTIN profiles (debounced)
  // This runs in the background and doesn't block the response
  scheduleRefit(user.id).catch((error) => {
    logger.warn('[Memories API] Failed to schedule refit', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // 201 only when a row was created; a reinforcement or near-duplicate
  // absorption returns 200 with the existing row, and `action` says which.
  return NextResponse.json({ memory, action: outcome.action.kind }, { status: inserted ? 201 : 200 });
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
  // The Memories API search returns rows to a person browsing, not to a model:
  // it stamps nothing (only `deliver` writes lastAccessedAt).
  const searchResults = await searchMemories(characterId, query, {
    userId: user.id,
    limit,
    minScore,
    minImportance: minImportance ?? TOOL_MIN_IMPORTANCE,
    source,
    // The Commonplace Book browses the whole archive, cold rows included.
    includeCold: true,
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

  return NextResponse.json({
    memories: memoriesWithTags,
    count: memoriesWithTags.length,
    query,
    usedEmbedding: searchResults.length > 0 ? searchResults[0].usedEmbedding : false,
  });
}

const anchorGateProbeSchema = z.object({
  characterId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).optional(),
});

/**
 * POST ?action=anchor-gate-probe — re-embed a character's most recent rows with
 * and without the episodic anchor line and report how many would have crossed
 * the gate's reinforce / near-duplicate thresholds each way. Read-only; costs
 * up to ~(limit × 7) embedding calls. Wrapped by `quilltap anchor-probe`.
 */
async function handleAnchorGateProbe(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json().catch(() => ({}));
  const parsed = anchorGateProbeSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const character = await repos.characters.findById(parsed.data.characterId);
  if (!character) {
    return notFound('Character');
  }

  logger.debug('[Memories API] Running anchor gate probe', {
    characterId: parsed.data.characterId,
    limit: parsed.data.limit,
  });
  try {
    const result = await runAnchorGateProbe({
      characterId: parsed.data.characterId,
      userId: user.id,
      limit: parsed.data.limit,
    });
    return successResponse(result);
  } catch (error) {
    logger.error('[Memories API] Anchor gate probe failed', {
      characterId: parsed.data.characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Anchor gate probe failed');
  }
}

/** In-process dry runs are bounded: each consolidation cluster is one model call. */
const MAINTAIN_DRY_RUN_DEFAULT_CLUSTERS = 10;
const MAINTAIN_DRY_RUN_MAX_CLUSTERS = 40;
const MAINTAIN_DRY_RUN_TIME_BUDGET_MS = 120_000;

async function handleMaintain(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json().catch(() => ({}));
  const parsed = maintainSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  const { characterId, dryRun, settings } = parsed.data;
  const phases = parsed.data.phases ? withImpliedPhases(parsed.data.phases) : undefined;

  if (characterId) {
    const character = await repos.characters.findById(characterId);
    if (!character) {
      return notFound('Character');
    }
  }

  if (dryRun) {
    // A dry run that may call the model (consolidation) names one character;
    // the LLM-free phases may dry-run across every character the user owns.
    const mayCallModel = !phases || phases.includes('consolidate');
    if (!characterId && mayCallModel) {
      return badRequest('A dry run that includes consolidation names one character (characterId)');
    }
    const maxClustersPerRun = Math.min(
      settings?.maxClustersPerRun ?? MAINTAIN_DRY_RUN_DEFAULT_CLUSTERS,
      MAINTAIN_DRY_RUN_MAX_CLUSTERS
    );
    const targets: Array<{ id: string }> = characterId
      ? [{ id: characterId }]
      : (await repos.characters.findByUserId(user.id)).filter((c: { archivedAt?: string | null }) => !c.archivedAt);
    logger.debug('[Memories API] Maintenance dry run (in-process)', {
      characterId: characterId ?? 'all',
      characters: targets.length,
      phases: phases ?? 'all',
      maxClustersPerRun,
    });
    try {
      const reports: MaintenanceReport[] = [];
      for (const target of targets) {
        reports.push(
          await runMaintenance(
            {
              characterId: target.id,
              reason: 'manual',
              dryRun: true,
              ...(phases ? { phases } : {}),
              settings: { ...settings, maxClustersPerRun },
            },
            { userId: user.id, timeBudgetMs: MAINTAIN_DRY_RUN_TIME_BUDGET_MS }
          )
        );
      }
      return NextResponse.json(
        characterId
          ? { success: true, dryRun: true, report: reports[0] }
          : { success: true, dryRun: true, reports }
      );
    } catch (error) {
      logger.error('[Memories API] Maintenance dry run failed', { characterId }, error instanceof Error ? error : undefined);
      return serverError('Maintenance dry run failed');
    }
  }

  try {
    const payload = {
      reason: 'manual' as const,
      ...(phases ? { phases } : {}),
      ...(settings ? { settings } : {}),
    };
    const jobIds = characterId
      ? [await enqueueMemoryMaintenance(user.id, { ...payload, characterId })]
      : await enqueueMemoryMaintenanceForUser(user.id, payload);
    logger.info('[Memories API] Maintenance enqueued', { userId: user.id, characterId: characterId ?? 'all', phases: phases ?? 'all', jobs: jobIds.length });
    return NextResponse.json({ success: true, dryRun: false, jobId: jobIds[0] ?? null, jobIds });
  } catch (error) {
    logger.error('[Memories API] Failed to enqueue maintenance', { characterId }, error instanceof Error ? error : undefined);
    return serverError('Failed to enqueue maintenance');
  }
}

async function handleMaintenanceStatus(
  req: NextRequest,
  { repos }: { user: { id: string }; repos: any }
) {
  const characterId = req.nextUrl.searchParams.get('characterId');
  if (characterId) {
    const character = await repos.characters.findById(characterId);
    if (!character) {
      return notFound('Character');
    }
  }
  const ledger = await getMaintenanceLedgerStatus(characterId ?? undefined);
  logger.debug('[Memories API] Maintenance status read', { characterId: characterId ?? 'all', entries: ledger.length });
  return NextResponse.json({ success: true, ledger });
}

async function handleRepair(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json().catch(() => ({}));
  const parsed = repairSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  const { characterId, dryRun = false } = parsed.data;
  if (characterId) {
    const character = await repos.characters.findById(characterId);
    if (!character) {
      return notFound('Character');
    }
  }
  try {
    const report = await repairMemoryGraph({ userId: user.id, characterId, dryRun });
    return NextResponse.json({ success: true, report });
  } catch (error) {
    logger.error('[Memories API] Memory graph repair failed', { characterId }, error instanceof Error ? error : undefined);
    return serverError('Memory graph repair failed');
  }
}





async function handleReadMaintenanceConfig(
  _req: NextRequest,
  _ctx: { user: { id: string }; repos: any }
) {
  const settings = await getMemoryMaintenanceSettings();
  return NextResponse.json({ success: true, settings });
}

async function handleWriteMaintenanceConfig(
  req: NextRequest,
  { user }: { user: { id: string }; repos: any }
) {
  const body = await req.json();
  const parsed = maintenanceConfigSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  // Per-phase toggles merge into the stored ones, so a card can send one.
  const { phases, ...rest } = parsed.data;
  const current = phases ? await getMemoryMaintenanceSettings() : null;
  const settings = await setMemoryMaintenanceSettings({
    ...rest,
    ...(phases && current ? { phases: { ...current.phases, ...phases } } : {}),
  });

  logger.info('[Memories API] Memory maintenance settings updated', {
    userId: user.id,
    enabled: settings.enabled,
    perCharacterCap: settings.perCharacterCap,
    capOverrides: Object.keys(settings.perCharacterCapOverrides).length,
    phases: settings.phases,
  });

  return NextResponse.json({ success: true, settings });
}

async function handleReadExtractionLimitsConfig(
  _req: NextRequest,
  _ctx: { user: { id: string }; repos: any }
) {
  const memoryExtractionLimits = await getMemoryExtractionLimits();
  return NextResponse.json({ success: true, settings: memoryExtractionLimits });
}

async function handleWriteExtractionLimitsConfig(
  req: NextRequest,
  _ctx: { user: { id: string }; repos: any }
) {
  const body = await req.json();
  const parsed = extractionLimitsConfigSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const currentSettings = await getMemoryExtractionLimits();
  const merged = {
    enabled: parsed.data.enabled ?? currentSettings.enabled,
    maxPerHour: parsed.data.maxPerHour ?? currentSettings.maxPerHour,
    softStartFraction: parsed.data.softStartFraction ?? currentSettings.softStartFraction,
    softFloor: parsed.data.softFloor ?? currentSettings.softFloor,
  };

  await setMemoryExtractionLimits(merged);

  logger.info('[Memories API] Extraction rate limits updated (instance-wide)', {
    enabled: merged.enabled,
    maxPerHour: merged.maxPerHour,
  });

  return NextResponse.json({ success: true, settings: merged });
}

async function handleReadRecallConfig(
  _req: NextRequest,
  _ctx: { user: { id: string }; repos: any }
) {
  const memoryRecall = await getMemoryRecallSettings();
  return NextResponse.json({ success: true, settings: memoryRecall });
}

async function handleWriteRecallConfig(
  req: NextRequest,
  _ctx: { user: { id: string }; repos: any }
) {
  const body = await req.json();
  const parsed = recallConfigSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const currentSettings = await getMemoryRecallSettings();
  const merged = {
    scopePolicy: parsed.data.scopePolicy ?? currentSettings.scopePolicy,
    expandRelated: parsed.data.expandRelated ?? currentSettings.expandRelated,
    perTurnConversationSummaries:
      parsed.data.perTurnConversationSummaries ?? currentSettings.perTurnConversationSummaries,
  };

  await setMemoryRecallSettings(merged);

  logger.info('[Memories API] Recall settings updated (instance-wide)', {
    scopePolicy: merged.scopePolicy,
    expandRelated: merged.expandRelated,
    perTurnConversationSummaries: merged.perTurnConversationSummaries,
  });

  return NextResponse.json({ success: true, settings: merged });
}

async function handleReadConsolidationConfig() {
  const settings = await getMemoryConsolidationSettings();
  return NextResponse.json({ success: true, settings });
}

async function handleWriteConsolidationConfig(req: NextRequest) {
  const body = await req.json();
  const parsed = consolidationConfigSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  // Drop undefined keys so a partial write never clobbers stored values.
  const patch = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  );
  await setMemoryConsolidationSettings(patch);
  const settings = await getMemoryConsolidationSettings();
  logger.info('[Memories API] Consolidation settings updated (instance-wide)', {
    enabled: settings.enabled,
    fields: Object.keys(patch),
  });
  return NextResponse.json({ success: true, settings });
}

async function handleReadExtractionModeConfig() {
  const settings = await getMemoryExtractionModeSettings();
  return NextResponse.json({ success: true, settings });
}

async function handleWriteExtractionModeConfig(req: NextRequest) {
  const body = await req.json();
  const parsed = extractionModeConfigSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  const patch = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  );
  await setMemoryExtractionModeSettings(patch);
  const settings = await getMemoryExtractionModeSettings();
  logger.info('[Memories API] Extraction-mode settings updated (instance-wide)', {
    otherPass: settings.otherPass,
    fields: Object.keys(patch),
  });
  return NextResponse.json({ success: true, settings });
}


async function handleCharacterMemoryCounts(
  _req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const characters = await repos.characters.findByUserId(user.id);
  // The housekeeping cap measures demotable rows only (hot AUTO; bug 210), so
  // the card compares `demotable` to the cap. `memoryCount` stays the total
  // across both tiers for older readers.
  const results = await Promise.all(
    characters.map(async (c: { id: string; name: string }) => {
      const breakdown: { hotTotal: number; demotable: number; protected: number; cold: number } =
        await repos.memories.countCapBreakdown(c.id);
      return {
        id: c.id,
        name: c.name,
        memoryCount: breakdown.hotTotal + breakdown.cold,
        hotTotal: breakdown.hotTotal,
        demotable: breakdown.demotable,
        protected: breakdown.protected,
        cold: breakdown.cold,
      };
    })
  );
  // Sort by the cap-measured count descending so characters nearest their cap surface first
  results.sort((a, b) => b.demotable - a.demotable || b.memoryCount - a.memoryCount);
  logger.debug('[Memories API] Character memory counts computed', {
    userId: user.id,
    characters: results.length,
  });
  return NextResponse.json({ success: true, characters: results });
}

async function handleBackfillProgress(
  _req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  // Count memories still missing embeddings (across this user's characters)
  const remaining = await repos.memories.countWithoutEmbedding();

  // Count in-flight EMBEDDING_GENERATE jobs for this user
  const [pending, processing] = await Promise.all([
    repos.backgroundJobs.findByUserId(user.id, 'PENDING'),
    repos.backgroundJobs.findByUserId(user.id, 'PROCESSING'),
  ]);
  const isEmbeddingMemory = (job: { type: string; payload: unknown }) => {
    if (job.type !== 'EMBEDDING_GENERATE') return false;
    const payload = job.payload as { entityType?: string } | undefined;
    return payload?.entityType === 'MEMORY';
  };
  const inFlight = pending.filter(isEmbeddingMemory).length + processing.filter(isEmbeddingMemory).length;

  return NextResponse.json({
    success: true,
    progress: {
      remaining,
      inFlight,
    },
  });
}

async function handleBackfillStart(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json().catch(() => ({}));
  const parsed = backfillStartSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  const { characterId, batchSize } = parsed.data;

  // Verify ownership if targeting a specific character
  if (characterId) {
    const character = await repos.characters.findById(characterId);
    if (!character) {
      return notFound('Character');
    }
  }

  const queued = await enqueueMissingEmbeddings({ userId: user.id, characterId, limit: batchSize });
  if (queued.status === 'no-profile') {
    return badRequest(
      'No default embedding profile is configured. Set one in the Commonplace Book tab before running the backfill.'
    );
  }
  const { enqueued, remaining } = queued;
  if (enqueued === 0 && remaining === 0) {
    return NextResponse.json({
      success: true,
      enqueued: 0,
      remaining: 0,
      message: 'No memories missing embeddings — nothing to backfill.',
    });
  }

  logger.info('[Memories API] Embedding backfill batch enqueued', {
    userId: user.id,
    characterId: characterId ?? '(all)',
    enqueued,
    remaining,
  });

  return NextResponse.json({
    success: true,
    enqueued,
    remaining,
    message:
      remaining > 0
        ? `Enqueued ${enqueued} embedding jobs. ${remaining} memories still missing embeddings — run again to continue.`
        : `Enqueued ${enqueued} embedding jobs. All memories are now accounted for.`,
  });
}

async function handleGenerateEmbeddings(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json().catch(() => ({}));
  const { characterId } = generateEmbeddingsSchema.parse(body);

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
  const result = await rebuildVectorIndex(characterId);

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

  // Manual rows, cold rows and digests with surviving members are spared (bug 201).
  const { retired: deleted, spared } = await retireChatMemories(chatId);

  // No publish here. This path runs through `retireMemories`, which already
  // announces `memories` collection-wide
  // — which a chat-scoped subscriber takes, since `useRealtimeTopic`'s id filter
  // only discards an event that names a *different* id. A second, chat-scoped
  // hint would cost every subscriber a duplicate refetch, and would fire on the
  // one case where the gate correctly stays silent: a chat with no memories,
  // where nothing was deleted and nothing changed.
  logger.debug('[Memories API] Wiped a chat\'s extracted memories', { chatId, deleted, spared });

  return NextResponse.json({
    success: true,
    chatId,
    deletedCount: deleted,
    sparedCount: spared,
  });
}

async function handleRegenerateAll(
  _req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
) {
  // Pressing the button again is an explicit "kill the previous sweep and
  // start over" gesture — wipe every PENDING/PROCESSING job from the
  // previous run before enqueueing the new fan-out. Currently-executing
  // handlers will finish their LLM call and try to mark themselves
  // complete; those updates become no-ops because the row is gone, and
  // any memories they wrote post-cancel get cleaned up by the next round
  // of MEMORY_REGENERATE_CHAT wipes the fresh sweep enqueues.
  const cleared = await repos.backgroundJobs.deleteByTypesAndStatuses(
    [
      'MEMORY_REGENERATE_ALL',
      'MEMORY_REGENERATE_CHAT',
      'MEMORY_EXTRACTION',
    ],
    ['PENDING', 'PROCESSING'],
  );
  if (cleared > 0) {
    logger.info('[Memories API] Cleared in-flight regenerate jobs before fresh sweep', {
      userId: user.id,
      cleared,
    });
  }

  // Resolve the standard + dangerous-compatible cheap profiles up front and
  // hand them to the fan-out job. Resolution is cheap (a single connection
  // lookup) but it has to happen before we enqueue, so the job's payload is
  // self-contained.
  const settings = await repos.chatSettings.findByUserId(user.id);
  const profiles = await repos.connections.findByUserId(user.id);

  const cheapDefaultId = settings?.cheapLLMSettings?.defaultCheapProfileId ?? null;
  const cheapDefault = cheapDefaultId
    ? profiles.find((p: { id: string }) => p.id === cheapDefaultId)
    : null;
  const standardProfileId = cheapDefault?.id ?? profiles[0]?.id ?? null;
  if (!standardProfileId) {
    return badRequest(
      'No connection profiles found. Add at least one provider connection before regenerating memories.',
    );
  }

  const uncensoredTextProfileId =
    readConciergeSettings(settings).uncensoredTextProfileId ?? null;
  const uncensoredCheap = uncensoredTextProfileId
    ? profiles.find(
        (p: { id: string; isCheap?: boolean }) =>
          p.id === uncensoredTextProfileId && p.isCheap === true,
      )
    : null;
  const anyDangerousCheap = profiles.find(
    (p: { isCheap?: boolean; isDangerousCompatible?: boolean }) =>
      p.isCheap === true && p.isDangerousCompatible === true,
  );
  const dangerousProfileId =
    uncensoredCheap?.id ?? anyDangerousCheap?.id ?? standardProfileId;

  // Single fan-out job — the actual chat enumeration, orphan walk, and
  // per-chat enqueues happen in the background processor so this endpoint
  // returns in milliseconds even on instances with tens of thousands of
  // memories. Dedupes on userId so a double-click doesn't produce two
  // fan-outs.
  const { jobId, isNew } = await enqueueMemoryRegenerateAll(user.id, {
    standardProfileId,
    dangerousProfileId,
  });

  logger.info('[Memories API] Regenerate-all fan-out enqueued', {
    userId: user.id,
    jobId,
    isNew,
    standardProfileId,
    dangerousProfileId,
  });

  const clearedSuffix = cleared > 0
    ? ` Cleared ${cleared} in-flight job${cleared === 1 ? '' : 's'} from the previous sweep.`
    : '';

  return NextResponse.json({
    success: true,
    jobId,
    isNew,
    cleared,
    message: isNew
      ? `Regeneration scheduled — building the chat list in the background. The Mem badge will start ticking shortly.${clearedSuffix}`
      : `A regeneration sweep is already in progress. The existing run will continue.${clearedSuffix}`,
  });
}

async function handleRegenerateAllStatus(
  _req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
) {
  const [pending, processing] = await Promise.all([
    repos.backgroundJobs.findByUserId(user.id, 'PENDING'),
    repos.backgroundJobs.findByUserId(user.id, 'PROCESSING'),
  ]);
  const all = [...pending, ...processing];
  const inFlightFanOut = all.filter(
    (j: { type: string }) => j.type === 'MEMORY_REGENERATE_ALL',
  ).length;
  const inFlightWipes = all.filter(
    (j: { type: string }) => j.type === 'MEMORY_REGENERATE_CHAT',
  ).length;
  const inFlightExtractions = all.filter(
    (j: { type: string }) => j.type === 'MEMORY_EXTRACTION',
  ).length;
  return NextResponse.json({
    success: true,
    inFlightFanOut,
    inFlightWipes,
    inFlightExtractions,
    inFlight: inFlightFanOut + inFlightWipes + inFlightExtractions,
  });
}
