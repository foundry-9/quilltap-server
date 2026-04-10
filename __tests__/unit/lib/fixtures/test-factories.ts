/**
 * Test Factory Functions
 *
 * Factory functions for creating test data with sensible defaults.
 * Each factory returns a valid entity with all required fields populated,
 * and allows overriding any field via the `overrides` parameter.
 */

import { randomUUID } from 'crypto';
import type {
  Character,
  Persona,
  ChatMetadata,
  ChatParticipantBase,
  Tag,
  Memory,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  RoleplayTemplate,
  PromptTemplate,
  MessageEvent,
  FileEntry,
} from '@/lib/schemas/types';
import type {
  QuilltapExport,
  QuilltapExportManifest,
  ExportedCharacter,
  ExportedPersona,
  ExportedChat,
  SanitizedConnectionProfile,
  SanitizedImageProfile,
  SanitizedEmbeddingProfile,
} from '@/lib/export/types';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a new UUID
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Generate a current ISO timestamp
 */
export function generateTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Generate a timestamp from a date offset (days ago)
 */
export function timestampDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

// ============================================================================
// ENTITY FACTORIES
// ============================================================================

/**
 * Create a mock Character with defaults
 */
export function createMockCharacter(overrides: Partial<Character> = {}): Character {
  const now = generateTimestamp();
  const id = overrides.id || generateId();

  return {
    id,
    userId: generateId(),
    name: 'Test Character',
    title: null,
    description: 'A test character for unit tests',
    personality: 'Friendly and helpful',
    scenarios: [],
    firstMessage: 'Hello! How can I help you today?',
    exampleDialogues: null,
    systemPrompts: [],
    avatarUrl: null,
    defaultImageId: null,
    defaultConnectionProfileId: null,
    defaultRoleplayTemplateId: null,
    sillyTavernData: null,
    isFavorite: false,
    npc: false,
    talkativeness: 0.5,
    partnerLinks: [],
    tags: [],
    avatarOverrides: [],
    physicalDescriptions: [],
    clothingRecords: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock Persona with defaults
 */
export function createMockPersona(overrides: Partial<Persona> = {}): Persona {
  const now = generateTimestamp();

  return {
    id: generateId(),
    userId: generateId(),
    name: 'Test Persona',
    title: null,
    description: 'A test persona for unit tests',
    personalityTraits: null,
    avatarUrl: null,
    defaultImageId: null,
    sillyTavernData: null,
    characterLinks: [],
    tags: [],
    physicalDescriptions: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock ChatParticipant with defaults
 */
export function createMockChatParticipant(
  overrides: Partial<ChatParticipantBase> = {}
): ChatParticipantBase {
  const now = generateTimestamp();
  const type = overrides.type || 'CHARACTER';

  return {
    id: generateId(),
    type,
    characterId: type === 'CHARACTER' ? generateId() : null,
    connectionProfileId: type === 'CHARACTER' ? generateId() : null,
    imageProfileId: null,
    roleplayTemplateId: null,

    selectedSystemPromptId: null,
    displayOrder: 0,
    controlledBy: 'llm',
    isActive: true,
    status: 'active',
    hasHistoryAccess: false,
    joinScenario: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock ChatMetadata with defaults
 */
export function createMockChat(overrides: Partial<ChatMetadata> = {}): ChatMetadata {
  const now = generateTimestamp();
  const characterId = generateId();
  const connectionProfileId = generateId();

  // Create default participant if none provided
  const defaultParticipant = createMockChatParticipant({
    characterId,
    connectionProfileId,
    type: 'CHARACTER',
  });

  return {
    id: generateId(),
    userId: generateId(),
    participants: [defaultParticipant],
    title: 'Test Chat',
    contextSummary: null,
    sillyTavernMetadata: null,
    tags: [],
    roleplayTemplateId: null,
    lastTurnParticipantId: null,
    messageCount: 0,
    lastMessageAt: null,
    lastRenameCheckInterchange: 0,
    chatType: 'salon',
    isPaused: false,
    turnQueue: '[]',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock Tag with defaults
 */
export function createMockTag(overrides: Partial<Tag> = {}): Tag {
  const now = generateTimestamp();
  const name = overrides.name || 'Test Tag';

  return {
    id: generateId(),
    userId: generateId(),
    name,
    nameLower: name.toLowerCase(),
    quickHide: false,
    visualStyle: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock Memory with defaults
 */
export function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  const now = generateTimestamp();

  return {
    id: generateId(),
    characterId: generateId(),
    aboutCharacterId: null,
    chatId: null,
    content: 'This is a test memory content for unit tests.',
    summary: 'Test memory summary',
    keywords: ['test', 'memory'],
    tags: [],
    importance: 0.5,
    embedding: null,
    reinforcementCount: 1,
    source: 'MANUAL',
    sourceMessageId: null,
    lastAccessedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock ConnectionProfile with defaults
 */
export function createMockConnectionProfile(
  overrides: Partial<ConnectionProfile> = {}
): ConnectionProfile {
  const now = generateTimestamp();

  return {
    id: generateId(),
    userId: generateId(),
    name: 'Test Connection Profile',
    provider: 'openai',
    apiKeyId: generateId(),
    baseUrl: null,
    modelName: 'gpt-4',
    parameters: {},
    isDefault: false,
    isCheap: false,
    allowWebSearch: false,
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock ImageProfile with defaults
 */
export function createMockImageProfile(overrides: Partial<ImageProfile> = {}): ImageProfile {
  const now = generateTimestamp();

  return {
    id: generateId(),
    userId: generateId(),
    name: 'Test Image Profile',
    provider: 'openai',
    apiKeyId: generateId(),
    baseUrl: null,
    modelName: 'dall-e-3',
    parameters: {},
    isDefault: false,
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock EmbeddingProfile with defaults
 */
export function createMockEmbeddingProfile(
  overrides: Partial<EmbeddingProfile> = {}
): EmbeddingProfile {
  const now = generateTimestamp();

  return {
    id: generateId(),
    userId: generateId(),
    name: 'Test Embedding Profile',
    provider: 'OPENAI',
    apiKeyId: generateId(),
    baseUrl: null,
    modelName: 'text-embedding-3-small',
    dimensions: 1536,
    isDefault: false,
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock RoleplayTemplate with defaults
 */
export function createMockRoleplayTemplate(
  overrides: Partial<RoleplayTemplate> = {}
): RoleplayTemplate {
  const now = generateTimestamp();

  return {
    id: generateId(),
    userId: generateId(),
    name: 'Test Roleplay Template',
    description: 'A test roleplay template',
    systemPrompt: 'You are a helpful assistant in a roleplay scenario.',
    isBuiltIn: false,
    tags: [],
    delimiters: [],
    renderingPatterns: [],
    dialogueDetection: null,
    narrationDelimiters: '*',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock PromptTemplate with defaults
 */
export function createMockPromptTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  const now = generateTimestamp();

  return {
    id: generateId(),
    userId: generateId(),
    name: 'Test Prompt Template',
    content: 'This is a test prompt template content.',
    description: 'A test prompt template',
    isBuiltIn: false,
    category: null,
    modelHint: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock MessageEvent with defaults
 */
export function createMockMessage(overrides: Partial<MessageEvent> = {}): MessageEvent {
  const now = generateTimestamp();

  return {
    type: 'message',
    id: generateId(),
    role: 'USER',
    content: 'This is a test message.',
    rawResponse: null,
    tokenCount: null,
    swipeGroupId: null,
    swipeIndex: null,
    attachments: [],
    createdAt: now,
    participantId: null,
    ...overrides,
  };
}

/**
 * Create a mock FileEntry with defaults
 */
export function createMockFileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  const now = generateTimestamp();
  const id = overrides.id || generateId();
  const userId = overrides.userId || generateId();
  const storageKey = `users/${userId}/files/${id}.png`;

  return {
    id,
    userId,
    sha256: 'a'.repeat(64),
    originalFilename: 'test-image.png',
    mimeType: 'image/png',
    size: 1024,
    width: 512,
    height: 512,
    linkedTo: [],
    source: 'UPLOADED',
    category: 'IMAGE',
    generationPrompt: null,
    generationModel: null,
    generationRevisedPrompt: null,
    description: null,
    tags: [],
    storageKey,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ============================================================================
// EXPORT/IMPORT FACTORIES
// ============================================================================

/**
 * Create a mock ExportedCharacter (Character with export metadata)
 */
export function createMockExportedCharacter(
  overrides: Partial<ExportedCharacter> = {}
): ExportedCharacter {
  const character = createMockCharacter(overrides);
  return {
    ...character,
    _tagNames: overrides._tagNames,
    _linkedPersonaNames: overrides._linkedPersonaNames,
  };
}

/**
 * Create a mock ExportedPersona (Persona with export metadata)
 */
export function createMockExportedPersona(
  overrides: Partial<ExportedPersona> = {}
): ExportedPersona {
  const persona = createMockPersona(overrides);
  return {
    ...persona,
    _tagNames: overrides._tagNames,
    _linkedCharacterNames: overrides._linkedCharacterNames,
  };
}

/**
 * Create a mock ExportedChat (Chat with messages and export metadata)
 */
export function createMockExportedChat(
  overrides: Partial<ExportedChat> = {}
): ExportedChat {
  const chat = createMockChat(overrides);
  return {
    ...chat,
    messages: overrides.messages || [createMockMessage()],
    _tagNames: overrides._tagNames,
    _participantInfo: overrides._participantInfo,
  };
}

/**
 * Create a mock SanitizedConnectionProfile (without apiKeyId)
 */
export function createMockSanitizedConnectionProfile(
  overrides: Partial<SanitizedConnectionProfile> = {}
): SanitizedConnectionProfile {
  const profile = createMockConnectionProfile();
  const { apiKeyId, ...sanitized } = profile;

  return {
    ...sanitized,
    _apiKeyLabel: overrides._apiKeyLabel,
    ...overrides,
  } as SanitizedConnectionProfile;
}

/**
 * Create a mock SanitizedImageProfile (without apiKeyId)
 */
export function createMockSanitizedImageProfile(
  overrides: Partial<SanitizedImageProfile> = {}
): SanitizedImageProfile {
  const profile = createMockImageProfile();
  const { apiKeyId, ...sanitized } = profile;

  return {
    ...sanitized,
    _apiKeyLabel: overrides._apiKeyLabel,
    ...overrides,
  } as SanitizedImageProfile;
}

/**
 * Create a mock SanitizedEmbeddingProfile (without apiKeyId)
 */
export function createMockSanitizedEmbeddingProfile(
  overrides: Partial<SanitizedEmbeddingProfile> = {}
): SanitizedEmbeddingProfile {
  const profile = createMockEmbeddingProfile();
  const { apiKeyId, ...sanitized } = profile;

  return {
    ...sanitized,
    _apiKeyLabel: overrides._apiKeyLabel,
    ...overrides,
  } as SanitizedEmbeddingProfile;
}

/**
 * Create a mock QuilltapExportManifest
 */
export function createMockExportManifest(
  overrides: Partial<QuilltapExportManifest> = {}
): QuilltapExportManifest {
  return {
    format: 'quilltap-export',
    version: '1.0',
    exportType: 'characters',
    createdAt: generateTimestamp(),
    appVersion: '2.5.0',
    settings: {
      includeMemories: false,
      scope: 'selected',
      selectedIds: [],
    },
    counts: {
      characters: 1,
    },
    ...overrides,
  };
}

/**
 * Create a mock QuilltapExport with characters
 */
export function createMockQuilltapExport(
  overrides: {
    manifest?: Partial<QuilltapExportManifest>;
    characters?: ExportedCharacter[];
    memories?: Memory[];
  } = {}
): QuilltapExport {
  const characters = overrides.characters || [createMockExportedCharacter()];

  return {
    manifest: createMockExportManifest({
      exportType: 'characters',
      counts: { characters: characters.length },
      ...overrides.manifest,
    }),
    data: {
      characters,
      ...(overrides.memories && { memories: overrides.memories }),
    },
  };
}

/**
 * Create a mock QuilltapExport with personas
 */
export function createMockPersonasExport(
  overrides: {
    manifest?: Partial<QuilltapExportManifest>;
    personas?: ExportedPersona[];
    memories?: Memory[];
  } = {}
): QuilltapExport {
  const personas = overrides.personas || [createMockExportedPersona()];

  return {
    manifest: createMockExportManifest({
      exportType: 'personas',
      counts: { personas: personas.length },
      ...overrides.manifest,
    }),
    data: {
      personas,
      ...(overrides.memories && { memories: overrides.memories }),
    },
  };
}

/**
 * Create a mock QuilltapExport with chats
 */
export function createMockChatsExport(
  overrides: {
    manifest?: Partial<QuilltapExportManifest>;
    chats?: ExportedChat[];
    memories?: Memory[];
  } = {}
): QuilltapExport {
  const chats = overrides.chats || [createMockExportedChat()];
  const messageCount = chats.reduce((sum, chat) => sum + chat.messages.length, 0);

  return {
    manifest: createMockExportManifest({
      exportType: 'chats',
      counts: { chats: chats.length, messages: messageCount },
      ...overrides.manifest,
    }),
    data: {
      chats,
      ...(overrides.memories && { memories: overrides.memories }),
    },
  };
}

/**
 * Create a mock QuilltapExport with tags
 */
export function createMockTagsExport(
  overrides: {
    manifest?: Partial<QuilltapExportManifest>;
    tags?: Tag[];
  } = {}
): QuilltapExport {
  const tags = overrides.tags || [createMockTag()];

  return {
    manifest: createMockExportManifest({
      exportType: 'tags',
      counts: { tags: tags.length },
      ...overrides.manifest,
    }),
    data: {
      tags,
    },
  };
}

/**
 * Create a mock QuilltapExport with connection profiles
 */
export function createMockConnectionProfilesExport(
  overrides: {
    manifest?: Partial<QuilltapExportManifest>;
    connectionProfiles?: SanitizedConnectionProfile[];
  } = {}
): QuilltapExport {
  const connectionProfiles = overrides.connectionProfiles || [
    createMockSanitizedConnectionProfile(),
  ];

  return {
    manifest: createMockExportManifest({
      exportType: 'connection-profiles',
      counts: { connectionProfiles: connectionProfiles.length },
      ...overrides.manifest,
    }),
    data: {
      connectionProfiles,
    },
  };
}

// ============================================================================
// SYNC FACTORIES
// ============================================================================

/**
 * Create a mock Sync Instance
 */
export function createMockSyncInstance(overrides: Record<string, unknown> = {}): {
  id: string;
  userId: string;
  name: string;
  baseUrl: string;
  apiKeyHash: string;
  isActive: boolean;
  lastSyncAt: string | null;
  lastSyncDirection: 'pull' | 'push' | 'bidirectional' | null;
  lastSyncEntityCounts: Record<string, number>;
  createdAt: string;
  updatedAt: string;
} {
  const now = generateTimestamp();

  return {
    id: generateId(),
    userId: generateId(),
    name: 'Test Sync Instance',
    baseUrl: 'https://remote.quilltap.example.com',
    apiKeyHash: 'mock-api-key-hash',
    isActive: true,
    lastSyncAt: null,
    lastSyncDirection: null,
    lastSyncEntityCounts: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock Sync Operation
 */
export function createMockSyncOperation(overrides: Record<string, unknown> = {}): {
  id: string;
  userId: string;
  instanceId: string;
  direction: 'pull' | 'push' | 'bidirectional';
  status: 'pending' | 'running' | 'completed' | 'failed';
  entityCounts: Record<string, number>;
  conflicts: Array<{ entityType: string; entityId: string; resolution: string }>;
  errors: string[];
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
} {
  const now = generateTimestamp();

  return {
    id: generateId(),
    userId: generateId(),
    instanceId: generateId(),
    direction: 'bidirectional',
    status: 'pending',
    entityCounts: {},
    conflicts: [],
    errors: [],
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ============================================================================
// BATCH FACTORIES
// ============================================================================

/**
 * Create multiple mock characters
 */
export function createMockCharacters(count: number, overrides: Partial<Character> = {}): Character[] {
  return Array.from({ length: count }, (_, i) =>
    createMockCharacter({
      name: `Test Character ${i + 1}`,
      ...overrides,
    })
  );
}

/**
 * Create multiple mock personas
 */
export function createMockPersonas(count: number, overrides: Partial<Persona> = {}): Persona[] {
  return Array.from({ length: count }, (_, i) =>
    createMockPersona({
      name: `Test Persona ${i + 1}`,
      ...overrides,
    })
  );
}

/**
 * Create multiple mock tags
 */
export function createMockTags(count: number, overrides: Partial<Tag> = {}): Tag[] {
  return Array.from({ length: count }, (_, i) =>
    createMockTag({
      name: `Test Tag ${i + 1}`,
      ...overrides,
    })
  );
}

/**
 * Create multiple mock memories for a character
 */
export function createMockMemories(
  count: number,
  characterId: string,
  overrides: Partial<Memory> = {}
): Memory[] {
  return Array.from({ length: count }, (_, i) =>
    createMockMemory({
      characterId,
      content: `Test memory content ${i + 1}`,
      summary: `Test memory summary ${i + 1}`,
      ...overrides,
    })
  );
}

/**
 * Create a set of related mock entities (character with persona, chat, memories)
 */
export function createMockCharacterWithRelations(): {
  character: Character;
  persona: Persona;
  chat: ChatMetadata;
  memories: Memory[];
  tags: Tag[];
} {
  const userId = generateId();
  const tag = createMockTag({ userId, name: 'Related Tag' });
  const persona = createMockPersona({ userId, tags: [tag.id] });
  const character = createMockCharacter({
    userId,
    partnerLinks: [{ partnerId: persona.id, isDefault: true }],
    tags: [tag.id],
  });

  const participant = createMockChatParticipant({
    characterId: character.id,
    type: 'CHARACTER',
  });

  const chat = createMockChat({
    userId,
    participants: [participant],
    tags: [tag.id],
  });

  const memories = createMockMemories(3, character.id, {
    chatId: chat.id,
  });

  return {
    character,
    persona,
    chat,
    memories,
    tags: [tag],
  };
}
