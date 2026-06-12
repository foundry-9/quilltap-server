/**
 * Query-key factory — the single source of truth for TanStack Query cache
 * identity.
 *
 * RULE: components and hooks must NEVER pass raw string/array keys to
 * `useQuery`/`invalidateQueries`. Always go through `queryKeys`. This is what
 * makes targeted, prefix-based invalidation reliable instead of brittle
 * URL string-matching — e.g. `invalidateQueries({ queryKey: queryKeys.characters.all })`
 * invalidates every list and detail under `['characters']`.
 *
 * Convention per entity:
 *   all:    the broadest prefix — invalidate this to refetch everything for the entity.
 *   list:   a (optionally filtered) collection read. Filters are folded into the
 *           key so distinct filter sets cache independently.
 *   detail: a single record by id.
 *   <sub>:  nested sub-resources hang under the parent id so they invalidate with it.
 *
 * This factory starts with the central entities and GROWS PER PHASE as each
 * migration batch moves its reads onto TanStack Query. Add a block when you
 * migrate an entity; do not scatter ad-hoc keys at call sites.
 */

type Filters = Readonly<Record<string, unknown>> | undefined

export const queryKeys = {
  characters: {
    all: ['characters'] as const,
    list: (filters?: Filters) => ['characters', 'list', filters ?? {}] as const,
    detail: (id: string) => ['characters', 'detail', id] as const,
    prompts: (id: string) => ['characters', id, 'prompts'] as const,
    photos: (id: string) => ['characters', id, 'photos'] as const,
  },
  chats: {
    all: ['chats'] as const,
    list: (filters?: Filters) => ['chats', 'list', filters ?? {}] as const,
    detail: (id: string) => ['chats', 'detail', id] as const,
    state: (id: string) => ['chats', id, 'state'] as const,
    photoAlbums: (id: string) => ['chats', id, 'photo-albums'] as const,
    groupStores: (id: string) => ['chats', id, 'group-stores'] as const,
  },
  settings: {
    chat: ['settings', 'chat'] as const,
  },
  connectionProfiles: {
    all: ['connection-profiles'] as const,
  },
  providers: {
    all: ['providers'] as const,
  },
  projects: {
    all: ['projects'] as const,
    list: (filters?: Filters) => ['projects', 'list', filters ?? {}] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
    files: (projectId: string) => ['projects', projectId, 'files'] as const,
  },
  mountPoints: {
    all: ['mount-points'] as const,
    list: (filters?: Filters) => ['mount-points', 'list', filters ?? {}] as const,
  },
  tags: {
    all: ['tags'] as const,
    list: (filters?: Filters) => ['tags', 'list', filters ?? {}] as const,
  },
  plugins: {
    all: ['plugins'] as const,
    config: (pluginName: string) => ['plugins', pluginName, 'config'] as const,
  },
  photos: {
    all: ['photos'] as const,
    list: (filters?: Filters) => ['photos', 'list', filters ?? {}] as const,
  },
  files: {
    all: ['files'] as const,
    list: (filters?: Filters) => ['files', 'list', filters ?? {}] as const,
    folders: (projectId?: string) => ['files', 'folders', projectId ?? null] as const,
    content: (url: string) => ['files', 'content', url] as const,
  },
  helpChat: {
    all: ['help-chat'] as const,
    entity: (apiUrl: string) => ['help-chat', 'entity', apiUrl] as const,
  },
} as const
