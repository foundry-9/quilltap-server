/**
 * Remapping a Brahma Console Writing Assistant context across an import or a
 * restore.
 *
 * `chats.consoleContext[].id` is polymorphic — the kind of row it names
 * depends on the entry's `kind` (`chat` → chat, `project` → project, `store`
 * → document store) — so it is a `bespoke` entry in the id-field table and
 * both sides call this. An entry whose target cannot be resolved is dropped,
 * never given an id that names nothing. `general` carries no id and is kept.
 *
 * Pure; the caller supplies the lookup.
 *
 * @module lib/brahma-console/context-remap
 */

import { ConsoleContextRefSchema, type ConsoleContextRef } from '@/lib/schemas/chat.types'

export type ContextRefTargetKind = Exclude<ConsoleContextRef['kind'], 'general'>

/**
 * Remap a stored context. `lookup` answers the new id for an old one of the
 * given kind, or null when the target is missing. Unparseable entries are
 * dropped. A non-array value comes back as null.
 */
export function remapConsoleContext(
  value: unknown,
  lookup: (kind: ContextRefTargetKind, id: string) => string | null,
): ConsoleContextRef[] | null {
  if (value === null || value === undefined) return null
  let raw: unknown = value
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!Array.isArray(raw)) return null
  const out: ConsoleContextRef[] = []
  for (const entry of raw) {
    const parsed = ConsoleContextRefSchema.safeParse(entry)
    if (!parsed.success) continue
    const ref = parsed.data
    if (ref.kind === 'general') {
      out.push(ref)
      continue
    }
    const mapped = lookup(ref.kind, ref.id)
    if (mapped) out.push({ kind: ref.kind, id: mapped })
  }
  return out
}
