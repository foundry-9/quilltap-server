/**
 * Tests for Prospero's group + personal-vault context whisper.
 *
 * The builder functions (`buildGroupAndVaultWhisperContent` /
 * `...OpaqueContent`) are pure and tested directly. `postProsperoGroupContextWhisper`
 * is repo-driven: jest.setup.ts globally mocks `@/lib/repositories/factory`
 * (getRepositories) and we configure it per-test via jest.mocked. The same
 * mocked repos drive `resolveGroupMountPointIdsForCharacter` (which the writer
 * calls through to) and the message-posting path.
 */

// ── Subject ───────────────────────────────────────────────────────────────────
import {
  buildGroupAndVaultWhisperContent,
  buildGroupAndVaultWhisperOpaqueContent,
  postProsperoGroupContextWhisper,
  type ProsperoDocumentStoreInfo,
} from '../writer';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';

const groupStore: ProsperoDocumentStoreInfo = {
  id: 'gm1',
  name: 'Circle Files',
  mountType: 'database',
  storeType: 'documents',
  isOfficial: false,
  enabled: true,
};

const vaultStore: ProsperoDocumentStoreInfo = {
  id: 'v1',
  name: 'Aria Vault',
  mountType: 'database',
  storeType: 'character',
  isOfficial: false,
  enabled: true,
};

describe('buildGroupAndVaultWhisperContent (persona-voiced)', () => {
  it('groups + vault names both sections, both scope hints, and the both-opener', () => {
    const out = buildGroupAndVaultWhisperContent([groupStore], vaultStore);
    expect(out).toContain('and your own vault besides');
    expect(out).toContain('**Shared shelves of the groups you belong to:**');
    expect(out).toContain('Circle Files');
    expect(out).toContain('**Your own vault:**');
    expect(out).toContain('Aria Vault');
    expect(out).toContain('scope: "group"');
    expect(out).toContain('scope: "character"');
  });

  it('groups only — no vault section, no character scope hint', () => {
    const out = buildGroupAndVaultWhisperContent([groupStore], null);
    expect(out).toContain('right of membership:');
    expect(out).not.toContain('and your own vault besides');
    expect(out).toContain('**Shared shelves of the groups you belong to:**');
    expect(out).not.toContain('**Your own vault:**');
    expect(out).toContain('scope: "group"');
    expect(out).not.toContain('scope: "character"');
  });

  it('vault only — its own opener, no group section', () => {
    const out = buildGroupAndVaultWhisperContent([], vaultStore);
    expect(out).toContain('the vault that is yours alone');
    expect(out).not.toContain('**Shared shelves of the groups you belong to:**');
    expect(out).toContain('**Your own vault:**');
    expect(out).toContain('scope: "character"');
    expect(out).not.toContain('scope: "group"');
  });

  it('returns empty string when there is nothing to whisper', () => {
    expect(buildGroupAndVaultWhisperContent([], null)).toBe('');
  });
});

describe('buildGroupAndVaultWhisperOpaqueContent (persona-stripped)', () => {
  it('drops the Prospero persona but keeps the store listing', () => {
    const out = buildGroupAndVaultWhisperOpaqueContent([groupStore], vaultStore);
    expect(out).not.toContain('Prospero');
    expect(out).toContain('Document stores you can reach by group membership, plus your own vault:');
    expect(out).toContain('Circle Files');
    expect(out).toContain('Aria Vault');
  });

  it('returns empty string when there is nothing to whisper', () => {
    expect(buildGroupAndVaultWhisperOpaqueContent([], null)).toBe('');
  });
});

function makeMockRepos(opts: {
  memberships?: Array<{ groupId: string }>;
  groups?: Record<string, { id: string; name: string; officialMountPointId: string | null }>;
  links?: Record<string, Array<{ mountPointId: string }>>;
  mounts?: Record<string, ProsperoDocumentStoreInfo>;
  characterVaultMountPointId?: string | null;
  addMessage?: jest.Mock;
}) {
  const {
    memberships = [],
    groups = {},
    links = {},
    mounts = {},
    characterVaultMountPointId = null,
    addMessage = jest.fn().mockResolvedValue(undefined),
  } = opts;

  return {
    groupCharacterMembers: {
      findByCharacterId: jest.fn().mockResolvedValue(memberships),
    },
    groups: {
      findByIdRaw: jest.fn().mockImplementation(async (id: string) => groups[id] ?? null),
    },
    groupDocMountLinks: {
      findByGroupId: jest.fn().mockImplementation(async (id: string) => links[id] ?? []),
    },
    docMountPoints: {
      findById: jest.fn().mockImplementation(async (id: string) => mounts[id] ?? null),
    },
    characters: {
      findByIdRaw: jest
        .fn()
        .mockResolvedValue({ id: 'c1', characterDocumentMountPointId: characterVaultMountPointId }),
    },
    chats: {
      findById: jest.fn().mockResolvedValue({ id: 'chat-1', participants: [] }),
      addMessage,
    },
  };
}

describe('postProsperoGroupContextWhisper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts a group-context message targeted to the participant when group stores exist', async () => {
    const addMessage = jest.fn().mockResolvedValue(undefined);
    jest.mocked(getRepositories).mockReturnValue(
      makeMockRepos({
        memberships: [{ groupId: 'g1' }],
        groups: { g1: { id: 'g1', name: 'The Circle', officialMountPointId: 'gm1' } },
        mounts: { gm1: groupStore },
        characterVaultMountPointId: null,
        addMessage,
      }) as never,
    );

    const result = await postProsperoGroupContextWhisper({
      chatId: 'chat-1',
      targetParticipantId: 'p1',
      characterId: 'c1',
    });

    expect(result).not.toBeNull();
    expect(addMessage).toHaveBeenCalledTimes(1);
    const [, message] = addMessage.mock.calls[0];
    expect(message.systemSender).toBe('prospero');
    expect(message.systemKind).toBe('group-context');
    expect(message.targetParticipantIds).toEqual(['p1']);
    expect(message.content).toContain('Circle Files');
  });

  it('posts nothing when the character has no group stores and no vault', async () => {
    const addMessage = jest.fn().mockResolvedValue(undefined);
    jest.mocked(getRepositories).mockReturnValue(
      makeMockRepos({ memberships: [], characterVaultMountPointId: null, addMessage }) as never,
    );

    const result = await postProsperoGroupContextWhisper({
      chatId: 'chat-1',
      targetParticipantId: 'p1',
      characterId: 'c1',
    });

    expect(result).toBeNull();
    expect(addMessage).not.toHaveBeenCalled();
  });
});
