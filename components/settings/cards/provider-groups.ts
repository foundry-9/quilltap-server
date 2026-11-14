/**
 * The read-time regrouping behind Providers → *By provider* (D10): keys and
 * the three kinds of profile, gathered under the provider each one names.
 *
 * A provider is "configured" when it has a key or any profile names it, so a
 * keyless local provider (Ollama, the built-in embedder) still gets a card. A
 * profile is grouped by its own `provider` field, falling back to its key's
 * provider when the field is empty. Pure and client-safe.
 *
 * @module components/settings/cards/provider-groups
 */

export type ProviderProfileKind = 'connection' | 'image' | 'embedding'

/** The order kinds are listed in, inside a provider card and its Add menu. */
export const PROVIDER_PROFILE_KINDS: readonly ProviderProfileKind[] = ['connection', 'image', 'embedding']

export const PROVIDER_PROFILE_KIND_LABELS: Record<ProviderProfileKind, string> = {
  connection: 'Connection',
  image: 'Image',
  embedding: 'Embedding',
}

interface KeyLike {
  id: string
  provider: string
  label: string
}

interface ProfileLike {
  id: string
  name: string
  provider?: string | null
  apiKeyId?: string | null
}

export interface ProviderGroup<K, C, I, E> {
  /** The provider's identifier as keys and profiles store it (e.g. `OPENAI`). */
  provider: string
  keys: K[]
  /** Every profile that uses this provider, connection → image → embedding, then by name. */
  profiles: Array<
    | { kind: 'connection'; profile: C }
    | { kind: 'image'; profile: I }
    | { kind: 'embedding'; profile: E }
  >
}

export interface GroupByProviderInput<K, C, I, E> {
  keys: readonly K[]
  connection: readonly C[]
  image: readonly I[]
  embedding: readonly E[]
}

/**
 * Gather keys and profiles under their providers. Groups come back sorted by
 * provider identifier; the caller re-sorts by display name if it has them.
 */
export function groupByProvider<
  K extends KeyLike,
  C extends ProfileLike,
  I extends ProfileLike,
  E extends ProfileLike,
>(input: GroupByProviderInput<K, C, I, E>): ProviderGroup<K, C, I, E>[] {
  const groups = new Map<string, ProviderGroup<K, C, I, E>>()
  const keyProvider = new Map(input.keys.map((k) => [k.id, k.provider]))

  const groupFor = (provider: string): ProviderGroup<K, C, I, E> => {
    let group = groups.get(provider)
    if (!group) {
      group = { provider, keys: [], profiles: [] }
      groups.set(provider, group)
    }
    return group
  }

  const providerOf = (profile: ProfileLike): string | null =>
    profile.provider || (profile.apiKeyId ? keyProvider.get(profile.apiKeyId) ?? null : null)

  for (const key of input.keys) {
    groupFor(key.provider).keys.push(key)
  }

  type Entry = ProviderGroup<K, C, I, E>['profiles'][number]
  const add = (entry: Entry) => {
    const provider = providerOf(entry.profile)
    if (provider) groupFor(provider).profiles.push(entry)
  }
  for (const profile of input.connection) add({ kind: 'connection', profile })
  for (const profile of input.image) add({ kind: 'image', profile })
  for (const profile of input.embedding) add({ kind: 'embedding', profile })

  const kindRank = (kind: ProviderProfileKind) => PROVIDER_PROFILE_KINDS.indexOf(kind)
  for (const group of groups.values()) {
    group.keys.sort((a, b) => a.label.localeCompare(b.label))
    group.profiles.sort(
      (a, b) => kindRank(a.kind) - kindRank(b.kind) || a.profile.name.localeCompare(b.profile.name)
    )
  }

  return [...groups.values()].sort((a, b) => a.provider.localeCompare(b.provider))
}
