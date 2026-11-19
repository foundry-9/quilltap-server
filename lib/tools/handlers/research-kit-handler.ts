/**
 * Research kit tool handlers (docs/developer/features/research-kit.md §5).
 *
 * Thin callers of `lib/research/`: each validates its input against the
 * tool's Zod schema, resolves the scope from the tool context
 * (`resolveResearchScope`), runs the research function, and returns the text.
 * Errors come back as data, never thrown, so the model can read and adjust.
 *
 * Document tools (`find_documents`, `list_documents`) work under either scope
 * (the operator surface, or a Scenario Builder mount pool). Record tools
 * (`lookup_conversations`, `lookup_group`, `lookup_project`,
 * `lookup_wardrobe`, `lookup_atlas`) need the operator surface; the permit
 * (`OPERATOR_SURFACE_ONLY_TOOLS`) refuses them anywhere else, and so does the
 * scope check here.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import type { TieredMountPool } from '@/lib/mount-index/tiered-mount-pool'
import { resolveResearchScope } from '@/lib/research/scope'
import { findDocuments, listDocuments } from '@/lib/research/documents'
import { lookupAtlas, lookupConversations, lookupGroup, lookupProject, lookupWardrobe } from '@/lib/research/records'
import { findDocumentsToolInputSchema } from '../find-documents-tool'
import { listDocumentsToolInputSchema } from '../list-documents-tool'
import { lookupConversationsToolInputSchema } from '../lookup-conversations-tool'
import { lookupGroupToolInputSchema, lookupProjectToolInputSchema } from '../lookup-group-tool'
import { lookupAtlasToolInputSchema, lookupWardrobeToolInputSchema } from '../lookup-wardrobe-tool'

const logger = createServiceLogger('ResearchKitHandler')

export interface ResearchKitToolContext {
  userId: string
  operatorSurface?: boolean
  mountPool?: TieredMountPool
}

export type ResearchKitToolResult =
  | { success: true; text: string }
  | { success: false; error: string }

type Handler = (input: unknown, ctx: ResearchKitToolContext) => Promise<ResearchKitToolResult>

function invalid(tool: string, issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): ResearchKitToolResult {
  const issue = issues[0]
  return {
    success: false,
    error: `Invalid ${tool} input: ${issue ? `${issue.path.join('.') || 'arguments'} — ${issue.message}` : 'malformed arguments'}.`,
  }
}

/** Run one kit call: scope, the research function, failures as data. */
async function run(
  tool: string,
  ctx: ResearchKitToolContext,
  needsEverything: boolean,
  body: (scope: Exclude<ReturnType<typeof resolveResearchScope>, { ok: false }>['scope']) => Promise<
    { ok: true; text: string } | { ok: false; error: string }
  >,
): Promise<ResearchKitToolResult> {
  const resolved = resolveResearchScope(ctx)
  if (!resolved.ok) return { success: false, error: resolved.error }
  if (needsEverything && resolved.scope.kind !== 'everything') {
    return { success: false, error: `${tool} is only available on the operator's surfaces.` }
  }
  try {
    const outcome = await body(resolved.scope)
    logger.debug('Research kit call finished', {
      tool,
      scope: resolved.scope.kind,
      ok: outcome.ok,
      chars: outcome.ok ? outcome.text.length : 0,
    })
    return outcome.ok ? { success: true, text: outcome.text } : { success: false, error: outcome.error }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('Research kit call failed', { tool, error: message })
    return { success: false, error: `${tool} failed: ${message}` }
  }
}

const findDocumentsHandler: Handler = async (input, ctx) => {
  const parsed = findDocumentsToolInputSchema.safeParse(input)
  if (!parsed.success) return invalid('find_documents', parsed.error.issues)
  return run('find_documents', ctx, false, (scope) => findDocuments(scope, parsed.data, ctx))
}

const listDocumentsHandler: Handler = async (input, ctx) => {
  const parsed = listDocumentsToolInputSchema.safeParse(input ?? {})
  if (!parsed.success) return invalid('list_documents', parsed.error.issues)
  return run('list_documents', ctx, false, (scope) => listDocuments(scope, parsed.data, ctx))
}

const lookupConversationsHandler: Handler = async (input, ctx) => {
  const parsed = lookupConversationsToolInputSchema.safeParse(input ?? {})
  if (!parsed.success) return invalid('lookup_conversations', parsed.error.issues)
  return run('lookup_conversations', ctx, true, () => lookupConversations(parsed.data))
}

const lookupGroupHandler: Handler = async (input, ctx) => {
  const parsed = lookupGroupToolInputSchema.safeParse(input)
  if (!parsed.success) return invalid('lookup_group', parsed.error.issues)
  return run('lookup_group', ctx, true, () => lookupGroup(parsed.data.group))
}

const lookupProjectHandler: Handler = async (input, ctx) => {
  const parsed = lookupProjectToolInputSchema.safeParse(input)
  if (!parsed.success) return invalid('lookup_project', parsed.error.issues)
  return run('lookup_project', ctx, true, () => lookupProject(parsed.data.project))
}

const lookupWardrobeHandler: Handler = async (input, ctx) => {
  const parsed = lookupWardrobeToolInputSchema.safeParse(input)
  if (!parsed.success) return invalid('lookup_wardrobe', parsed.error.issues)
  return run('lookup_wardrobe', ctx, true, () => lookupWardrobe(parsed.data, ctx))
}

const lookupAtlasHandler: Handler = async (input, ctx) => {
  const parsed = lookupAtlasToolInputSchema.safeParse(input ?? {})
  if (!parsed.success) return invalid('lookup_atlas', parsed.error.issues)
  return run('lookup_atlas', ctx, true, () => lookupAtlas(parsed.data, ctx))
}

/** The kit's document tools, by name: either scope. */
export const RESEARCH_DOCUMENT_HANDLERS: Readonly<Record<string, Handler>> = {
  find_documents: findDocumentsHandler,
  list_documents: listDocumentsHandler,
}

/** The kit's record tools, by name: operator surface only. */
export const RESEARCH_RECORD_HANDLERS: Readonly<Record<string, Handler>> = {
  lookup_conversations: lookupConversationsHandler,
  lookup_group: lookupGroupHandler,
  lookup_project: lookupProjectHandler,
  lookup_wardrobe: lookupWardrobeHandler,
  lookup_atlas: lookupAtlasHandler,
}

/** Every research-kit tool handler (the new tools; the changed Brahma lookups keep their own). */
export const RESEARCH_KIT_HANDLERS: Readonly<Record<string, Handler>> = {
  ...RESEARCH_DOCUMENT_HANDLERS,
  ...RESEARCH_RECORD_HANDLERS,
}

export const RESEARCH_DOCUMENT_TOOL_NAMES = Object.keys(RESEARCH_DOCUMENT_HANDLERS)
export const RESEARCH_RECORD_TOOL_NAMES = Object.keys(RESEARCH_RECORD_HANDLERS)
export const RESEARCH_KIT_TOOL_NAMES = Object.keys(RESEARCH_KIT_HANDLERS)
