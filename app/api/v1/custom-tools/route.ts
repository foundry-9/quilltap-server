/**
 * `/api/v1/custom-tools` — Pascal's Workbench collection resource.
 *
 * - `GET`                       — the library: every definition in every
 *                                 enabled store, valid or broken, with
 *                                 attachment badges.
 * - `GET  ?action=destinations` — the save-target list, grouped by what each
 *                                 store is attached to.
 * - `POST ?action=preview`      — dry-run a definition through the one true
 *                                 execution core. Posts nothing, writes
 *                                 nothing.
 * - `POST ?action=audit`        — deal ten thousand hands and report where
 *                                 they landed.
 *
 * File content I/O is deliberately NOT here: reads, writes, and deletes go
 * through the existing mount-points file routes, so the Workbench adds no
 * second write path into stores.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createContextHandler, withCollectionActionDispatch, type RequestContext } from '@/lib/api/middleware';
import { badRequest, errorResponse, notFound, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { QtapCustomToolSchema, formatDefinitionIssues, type QtapCustomTool } from '@/lib/pascal/custom-tool.types';
import { CustomToolRunError, executeCustomTool, simulateOutcomes } from '@/lib/pascal/custom-tools';
import { buildCustomToolLibrary, listCustomToolDestinations } from '@/lib/pascal/workbench';
import { CharacterVaultUnavailableError } from '@/lib/database/repositories/vault-overlay/schema';

const HANDLER = 'api.v1.custom-tools';

/** Draws per audit. Roll + match only (no template rendering), so this is cheap. */
const AUDIT_RUNS = 10_000;

// ---------------------------------------------------------------------------
// GET — library and destinations
// ---------------------------------------------------------------------------

async function handleLibrary(): Promise<NextResponse> {
  logger.debug('Workbench library requested', { context: HANDLER });
  const library = await buildCustomToolLibrary();
  return successResponse(library);
}

async function handleDestinations(): Promise<NextResponse> {
  logger.debug('Workbench destinations requested', { context: HANDLER });
  const destinations = await listCustomToolDestinations();
  return successResponse(destinations);
}

// ---------------------------------------------------------------------------
// POST — preview and audit
// ---------------------------------------------------------------------------

/**
 * The bench's fact sheet: a hand-typed metadata object, or a pointer at a
 * character whose real sheet the server hydrates. The `{ characterId }` branch
 * must come first in the union — that exact shape would also satisfy the
 * catch-all record.
 */
const MetadataInputSchema = z.union([
  z.strictObject({ characterId: z.string().min(1) }),
  z.record(z.string(), z.unknown()),
]);

const PreviewBodySchema = z.object({
  definition: z.unknown(),
  params: z.record(z.string(), z.unknown()).nullish(),
  private: z.boolean().optional(),
  metadata: MetadataInputSchema.nullish(),
});

const AuditBodySchema = z.object({
  definition: z.unknown(),
  params: z.record(z.string(), z.unknown()).nullish(),
  metadata: MetadataInputSchema.nullish(),
});

/** A parsed body, or the error response that should be returned instead. */
type Parsed<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

async function parseBody<T>(req: NextRequest, schema: z.ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: badRequest('Request body must be JSON') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: badRequest('Invalid request body', parsed.error.issues) };
  }
  return { ok: true, value: parsed.data };
}

/** Validate a raw definition, or produce the 400 the author reads. */
function parseDefinition(raw: unknown): Parsed<QtapCustomTool> {
  const parsed = QtapCustomToolSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: badRequest(formatDefinitionIssues(parsed.error)) };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Resolve the fact sheet. A plain object passes through verbatim; the
 * `{ characterId }` form hydrates that character and uses their real
 * `metadata.json` — the honest "what would happen if they rolled this".
 */
async function resolveMetadata(
  ctx: RequestContext,
  metadata: z.infer<typeof MetadataInputSchema> | null | undefined
): Promise<Parsed<Record<string, unknown>>> {
  if (metadata === null || metadata === undefined) return { ok: true, value: {} };

  const isCharacterRef =
    typeof metadata === 'object' &&
    Object.keys(metadata).length === 1 &&
    typeof (metadata as { characterId?: unknown }).characterId === 'string';

  if (!isCharacterRef) return { ok: true, value: metadata as Record<string, unknown> };

  const characterId = (metadata as { characterId: string }).characterId;
  try {
    const character = await ctx.repos.characters.findById(characterId);
    if (!character) return { ok: false, response: notFound('Character') };
    return { ok: true, value: (character.metadata ?? {}) as Record<string, unknown> };
  } catch (error) {
    // A broken vault is surfaced honestly, never papered over with `{}` — the
    // bench would otherwise report metadata rows declining for the wrong reason.
    if (error instanceof CharacterVaultUnavailableError) {
      return { ok: false, response: errorResponse(error.message, 422) };
    }
    throw error;
  }
}

async function handlePreview(req: NextRequest, ctx: RequestContext): Promise<NextResponse> {
  const body = await parseBody(req, PreviewBodySchema);
  if (!body.ok) return body.response;

  const definition = parseDefinition(body.value.definition);
  if (!definition.ok) return definition.response;

  const metadata = await resolveMetadata(ctx, body.value.metadata);
  if (!metadata.ok) return metadata.response;

  try {
    const result = executeCustomTool(definition.value, body.value.params ?? undefined, {
      private: body.value.private,
      metadata: metadata.value,
    });
    logger.debug('Workbench preview rolled', {
      context: HANDLER,
      tool: definition.value.name,
      state: result.state,
      outcomeIndex: result.outcomeIndex,
    });
    return successResponse(result);
  } catch (error) {
    if (error instanceof CustomToolRunError) {
      logger.debug('Workbench preview refused', { context: HANDLER, tool: definition.value.name, reason: error.message });
      return errorResponse(error.message, 422);
    }
    throw error;
  }
}

async function handleAudit(req: NextRequest, ctx: RequestContext): Promise<NextResponse> {
  const body = await parseBody(req, AuditBodySchema);
  if (!body.ok) return body.response;

  const definition = parseDefinition(body.value.definition);
  if (!definition.ok) return definition.response;

  const metadata = await resolveMetadata(ctx, body.value.metadata);
  if (!metadata.ok) return metadata.response;

  try {
    const result = simulateOutcomes(definition.value, body.value.params ?? undefined, AUDIT_RUNS, metadata.value);
    logger.debug('Workbench audit dealt', {
      context: HANDLER,
      tool: definition.value.name,
      runs: result.runs,
    });
    return successResponse(result);
  } catch (error) {
    if (error instanceof CustomToolRunError) {
      logger.debug('Workbench audit refused', { context: HANDLER, tool: definition.value.name, reason: error.message });
      return errorResponse(error.message, 422);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Route wiring
// ---------------------------------------------------------------------------

export const GET = createContextHandler(
  withCollectionActionDispatch({ destinations: handleDestinations }, handleLibrary)
);

export const POST = createContextHandler(
  withCollectionActionDispatch({ preview: handlePreview, audit: handleAudit })
);
