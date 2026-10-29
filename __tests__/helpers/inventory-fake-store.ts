/**
 * An in-memory document store for the Inventory tests: enough of the
 * repositories, the database-store writers and the folder helpers that the
 * real projection, location, pool, mutations and equip code run end to end.
 *
 * Use from a test file:
 *
 *   jest.mock('@/lib/repositories/factory', () => require('@/__tests__/helpers/inventory-fake-store').factoryModule())
 *   jest.mock('@/lib/mount-index/database-store', () => require('@/__tests__/helpers/inventory-fake-store').databaseStoreModule())
 *   jest.mock('@/lib/mount-index/folder-paths', () => require('@/__tests__/helpers/inventory-fake-store').folderPathsModule())
 *   jest.mock('@/lib/instance-settings', () => require('@/__tests__/helpers/inventory-fake-store').instanceSettingsModule())
 *   jest.mock('@/lib/mount-index/tiered-mount-pool', () => require('@/__tests__/helpers/inventory-fake-store').tieredPoolModule())
 *   jest.mock('@/lib/pascal/tool-gate-keys', () => require('@/__tests__/helpers/inventory-fake-store').toolGateKeysModule())
 *
 * The last one feeds the title lint's gate-key census from `state.gateKeys`
 * (add with {@link putGateKey}) and `state.gateKeysUnread`.
 */

export interface FakeCharacter {
  id: string;
  name: string;
  userId: string;
  characterDocumentMountPointId: string | null;
  archivedAt?: string | null;
}

export interface FakeChat {
  id: string;
  projectId?: string | null;
  equippedInventory?: unknown;
  participants?: Array<{ id: string; characterId: string | null; type?: string; status?: string; removedAt?: string | null }>;
  [key: string]: unknown;
}

export const GENERAL_MP = 'mp-general';
export const PROJECT_MP = 'mp-project';

export const state = {
  docs: new Map<string, string>(), // key `${mp}::${path}`
  folders: new Set<string>(), // key `${mp}::${path}`
  characters: new Map<string, FakeCharacter>(),
  projects: [] as Array<{ id: string; name: string; officialMountPointId: string | null }>,
  /** Characters a project's roster does NOT admit (default: every roster admits everyone). */
  offRoster: new Map<string, Set<string>>(),
  groups: [] as Array<{ id: string; name: string; officialMountPointId: string | null }>,
  chats: new Map<string, FakeChat>(),
  groupMounts: new Map<string, Array<{ group: { id: string; name: string }; mountPointIds: string[] }>>(),
  projectMounts: new Map<string, string[]>(),
  files: [] as Array<{ id: string; linkedTo: string[]; category: string; createdAt: string; storageKey?: string; originalFilename: string }>,
  /** Gate keys the title lint's census reports. */
  gateKeys: [] as Array<{ ref: string; toolName: string; clause: 'availableWhen' | 'withheldWhen'; subject: 'inventory' | 'inventoryCount'; mountName: string; definitionPath: string }>,
  /** Mount ids `docMountPoints.findById` answers null for (a store that does not exist). */
  missingMounts: new Set<string>(),
  /** What the census reports it could not read. */
  gateKeysUnread: [] as Array<{ mountName: string; definitionPath: string; reason: string }>,
};

export function resetStore(): void {
  state.docs.clear();
  state.folders.clear();
  state.characters.clear();
  state.projects = [{ id: 'project-1', name: 'The Quest', officialMountPointId: PROJECT_MP }];
  state.offRoster.clear();
  state.groups = [];
  state.chats.clear();
  state.groupMounts.clear();
  state.projectMounts = new Map([['project-1', [PROJECT_MP]]]);
  state.files = [];
  state.gateKeys = [];
  state.gateKeysUnread = [];
  state.missingMounts.clear();
}

const key = (mp: string, path: string) => `${mp}::${path}`;
const split = (k: string) => {
  const i = k.indexOf('::');
  return { mp: k.slice(0, i), path: k.slice(i + 2) };
};

function addFolderChain(mp: string, path: string): void {
  const segments = path.split('/').filter(Boolean);
  for (let i = 1; i <= segments.length; i++) state.folders.add(key(mp, segments.slice(0, i).join('/')));
}

/** Put a file in the store as the Scriptorium would. */
export function putDoc(mp: string, path: string, content: string | object): void {
  state.docs.set(key(mp, path), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  const slash = path.lastIndexOf('/');
  if (slash > 0) addFolderChain(mp, path.slice(0, slash));
}

/** Every document path in one mount. */
export function pathsIn(mp: string): string[] {
  return Array.from(state.docs.keys())
    .map(split)
    .filter((d) => d.mp === mp)
    .map((d) => d.path)
    .sort();
}

/** Parsed JSON of every `.json` under `Inventory/` in one mount. */
export function objectsIn(mp: string): Array<Record<string, unknown> & { __path: string }> {
  return pathsIn(mp)
    .filter((p) => p.toLowerCase().startsWith('inventory/') && p.endsWith('.json'))
    .map((p) => ({ ...JSON.parse(state.docs.get(key(mp, p)) as string), __path: p }));
}

function docsIn(mps: string[], folder: string, ext: string, recursive: boolean) {
  const prefix = `${folder}/`.toLowerCase();
  const out = [];
  for (const [k, content] of state.docs) {
    const { mp, path } = split(k);
    if (!mps.includes(mp)) continue;
    const lower = path.toLowerCase();
    if (!lower.startsWith(prefix)) continue;
    const rest = lower.slice(prefix.length);
    if (!recursive && rest.includes('/')) continue;
    if (!rest.endsWith(ext.toLowerCase())) continue;
    out.push({
      id: k,
      mountPointId: mp,
      relativePath: path,
      fileName: path.slice(path.lastIndexOf('/') + 1),
      content,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
  }
  return out;
}

function chatParticipants(chat: FakeChat) {
  return chat.participants ?? [];
}

export function repositories() {
  return {
    docMountDocuments: {
      findManyByMountPointsInFolder: jest.fn(async (mps: string[], folder: string, ext = '.md', opts: { recursive?: boolean } = {}) =>
        docsIn(mps, folder, ext, opts.recursive === true),
      ),
      findByMountPointAndPath: jest.fn(async (mp: string, path: string) => {
        const found = Array.from(state.docs.entries()).find(([k]) => {
          const d = split(k);
          return d.mp === mp && d.path.toLowerCase() === path.toLowerCase();
        });
        return found ? { mountPointId: mp, relativePath: split(found[0]).path, content: found[1] } : null;
      }),
      findManyInFolderContaining: jest.fn(async (folder: string, ext: string, needles: string[]) => {
        const mps = Array.from(new Set(Array.from(state.docs.keys()).map((k) => split(k).mp)))
        return docsIn(mps, folder, ext, true).filter((doc) => needles.some((needle) => String(doc.content ?? '').includes(needle)))
      }),
    },
    docMountFolders: {
      findByMountPointId: jest.fn(async (mp: string) =>
        Array.from(state.folders).map(split).filter((f) => f.mp === mp).map((f) => ({ id: key(f.mp, f.path), path: f.path })),
      ),
      findByMountPointAndPath: jest.fn(async (mp: string, path: string) => {
        const found = Array.from(state.folders).map(split).find((f) => f.mp === mp && f.path.toLowerCase() === path.toLowerCase());
        return found ? { id: key(found.mp, found.path), path: found.path } : null;
      }),
    },
    docMountFileLinks: {
      findByMountPointId: jest.fn(async (mp: string) =>
        Array.from(state.docs.keys()).map(split).filter((d) => d.mp === mp).map((d) => ({ id: key(d.mp, d.path), relativePath: d.path })),
      ),
    },
    docMountPoints: {
      findAll: jest.fn(async () => {
        const mps = new Set<string>([GENERAL_MP, PROJECT_MP]);
        for (const k of state.docs.keys()) mps.add(split(k).mp);
        for (const c of state.characters.values()) if (c.characterDocumentMountPointId) mps.add(c.characterDocumentMountPointId);
        return Array.from(mps).map((id) => ({ id, name: id }));
      }),
      findById: jest.fn(async (id: string) => (state.missingMounts.has(id) ? null : { id, name: id })),
    },
    characters: {
      findByIdRaw: jest.fn(async (id: string) => state.characters.get(id) ?? null),
      findById: jest.fn(async (id: string) => state.characters.get(id) ?? null),
      findByDocumentMountPointIdRaw: jest.fn(
        async (mp: string) => Array.from(state.characters.values()).find((c) => c.characterDocumentMountPointId === mp) ?? null,
      ),
    },
    projects: {
      findAll: jest.fn(async () => state.projects),
      findById: jest.fn(async (id: string) => state.projects.find((p) => p.id === id) ?? null),
      canCharacterParticipate: jest.fn(async (projectId: string, characterId: string) => !state.offRoster.get(projectId)?.has(characterId)),
    },
    groups: {
      findAll: jest.fn(async () => state.groups),
      findById: jest.fn(async (id: string) => state.groups.find((g) => g.id === id) ?? null),
    },
    chats: {
      findById: jest.fn(async (id: string) => {
        const chat = state.chats.get(id);
        return chat ? { ...chat, participants: chatParticipants(chat) } : null;
      }),
      getEquippedInventory: jest.fn(async (id: string) => {
        const { normalizeEquippedInventory } = jest.requireActual('@/lib/database/repositories/chats.repository');
        return normalizeEquippedInventory(state.chats.get(id)?.equippedInventory);
      }),
      setEquippedInventory: jest.fn(async (chatId: string, characterId: string, ids: string[] | null) => {
        const chat = state.chats.get(chatId);
        if (!chat) return false;
        const current = (chat.equippedInventory ?? {}) as Record<string, string[]>;
        const next = { ...current };
        if (ids === null) delete next[characterId];
        else next[characterId] = Array.from(new Set(ids)).sort();
        chat.equippedInventory = next;
        return true;
      }),
      findChatIdsCarryingInventoryId: jest.fn(async (characterId: string, itemId: string) =>
        Array.from(state.chats.values())
          .filter((chat) => ((chat.equippedInventory ?? {}) as Record<string, string[]>)[characterId]?.includes(itemId))
          .map((chat) => chat.id)),
      removeEquippedInventoryId: jest.fn(async (chatId: string, characterId: string, itemId: string) => {
        const chat = state.chats.get(chatId);
        const current = (chat?.equippedInventory ?? {}) as Record<string, string[]>;
        if (!chat || !current[characterId]?.includes(itemId)) return false;
        chat.equippedInventory = { ...current, [characterId]: current[characterId].filter((id) => id !== itemId) };
        return true;
      }),
    },
    files: {
      findByLinkedTo: jest.fn(async (id: string) => state.files.filter((f) => f.linkedTo.includes(id))),
      delete: jest.fn(async () => true),
    },
  };
}

let repos: ReturnType<typeof repositories> | null = null;
export function getFakeRepos(): ReturnType<typeof repositories> {
  repos ??= repositories();
  return repos;
}

export function factoryModule() {
  return { getRepositories: () => getFakeRepos() };
}

export function databaseStoreModule() {
  class DatabaseStoreError extends Error {
    constructor(message: string, public code: string) {
      super(message);
    }
  }
  return {
    DatabaseStoreError,
    writeDatabaseDocument: jest.fn(async (mp: string, path: string, content: string) => {
      putDoc(mp, path, content);
      return { mtime: Date.now() };
    }),
    deleteDatabaseDocument: jest.fn(async (mp: string, path: string) => {
      if (!state.docs.delete(key(mp, path))) throw new DatabaseStoreError('missing', 'NOT_FOUND');
    }),
    moveDatabaseFolder: jest.fn(async (mp: string, from: string, to: string) => {
      const prefix = `${from}/`;
      for (const [k, content] of Array.from(state.docs)) {
        const d = split(k);
        if (d.mp === mp && d.path.startsWith(prefix)) {
          state.docs.delete(k);
          putDoc(mp, `${to}/${d.path.slice(prefix.length)}`, content);
        }
      }
      for (const f of Array.from(state.folders)) {
        const d = split(f);
        if (d.mp === mp && (d.path === from || d.path.startsWith(prefix))) {
          state.folders.delete(f);
          addFolderChain(mp, `${to}${d.path.slice(from.length)}`);
        }
      }
    }),
    deleteDatabaseFolder: jest.fn(async (mp: string, path: string) => {
      state.folders.delete(key(mp, path));
    }),
  };
}

export function folderPathsModule() {
  return {
    ensureFolderPath: jest.fn(async (mp: string, path: string) => {
      addFolderChain(mp, path);
      return key(mp, path);
    }),
  };
}

export function instanceSettingsModule() {
  return { getGeneralMountPointId: jest.fn(async () => GENERAL_MP) };
}

export function tieredPoolModule() {
  return {
    resolveGroupMountsForCharacter: jest.fn(async (characterId: string) => state.groupMounts.get(characterId) ?? []),
    resolveProjectMountPointIds: jest.fn(async (projectId: string | null) => (projectId ? state.projectMounts.get(projectId) ?? [] : [])),
  };
}

/** Add a character with a vault mount `mp-<id>`. */
/** Take a character off a project's roster (the roster no longer admits them). */
export function putOffRoster(projectId: string, characterId: string): void {
  const set = state.offRoster.get(projectId) ?? new Set<string>();
  set.add(characterId);
  state.offRoster.set(projectId, set);
}

export function addCharacter(id: string, name: string, opts: { archived?: boolean } = {}): FakeCharacter {
  const character: FakeCharacter = {
    id,
    name,
    userId: 'user-1',
    characterDocumentMountPointId: `mp-${id}`,
    archivedAt: opts.archived ? '2026-10-01T00:00:00.000Z' : null,
  };
  state.characters.set(id, character);
  return character;
}

/** A tool gate keyed on `ref` (an `availableWhen.inventory` key unless told otherwise). */
export function putGateKey(
  toolName: string,
  ref: string,
  opts: { clause?: 'availableWhen' | 'withheldWhen'; subject?: 'inventory' | 'inventoryCount' } = {},
): void {
  state.gateKeys.push({
    ref,
    toolName,
    clause: opts.clause ?? 'availableWhen',
    subject: opts.subject ?? 'inventory',
    mountName: 'Quilltap General',
    definitionPath: `Tools/${toolName}.tool.json`,
  });
}

export function toolGateKeysModule() {
  return {
    collectToolGateKeys: jest.fn(async () => ({
      keys: [...state.gateKeys],
      unread: [...state.gateKeysUnread],
      storesConsulted: ['Quilltap General'],
    })),
  };
}
