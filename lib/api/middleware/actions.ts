/**
 * Action Parameter Middleware
 *
 * Provides utilities for routing based on ?action= query parameters.
 * This enables consolidating multiple action-specific routes into a single
 * endpoint with action dispatch.
 *
 * Part of the API consolidation effort (v1 REST API structure).
 *
 * @example
 * ```ts
 * // Instead of:
 * // /api/characters/[id]/favorite
 * // /api/characters/[id]/export
 * // /api/characters/[id]/avatar
 *
 * // Use:
 * // POST /api/v1/characters/[id]?action=favorite
 * // GET /api/v1/characters/[id]?action=export
 * // POST /api/v1/characters/[id]?action=avatar
 *
 * export const POST = createContextParamsHandler<{ id: string }>(
 *   withActionDispatch({
 *     favorite: handleFavorite,
 *     avatar: handleAvatar,
 *   }, handleDefaultPost) // fallback for no action param
 * );
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import type { RequestContext } from './context';

const actionLogger = logger.child({ module: 'api-action-middleware' });

/**
 * Handler function type for action dispatch
 */
export type ActionHandler<P extends Record<string, string> = Record<string, string>> = (
  request: NextRequest,
  context: RequestContext,
  params: P
) => Promise<NextResponse>;

/**
 * Map of action names to their handlers
 */
export type ActionHandlerMap<P extends Record<string, string> = Record<string, string>> = {
  [action: string]: ActionHandler<P>;
};

/**
 * Extract the action parameter from a request URL
 *
 * @param request - The incoming request
 * @returns The action parameter value or null if not present
 */
export function getActionParam(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get('action');
}

/**
 * Create a handler that dispatches to action-specific handlers
 *
 * Routes requests based on the ?action= query parameter. If no action
 * is specified, falls back to the default handler.
 *
 * @param actions - Map of action names to handlers
 * @param defaultHandler - Handler for requests without action param (optional)
 * @returns Combined handler function
 *
 * @example
 * ```ts
 * // For collection endpoints (no [id])
 * export const POST = createContextHandler(
 *   withActionDispatch({
 *     'ai-wizard': handleAiWizard,
 *     'quick-create': handleQuickCreate,
 *     'import': handleImport,
 *   }, handleCreate) // default: create new entity
 * );
 * ```
 */
export function withActionDispatch<P extends Record<string, string> = Record<string, string>>(
  actions: ActionHandlerMap<P>,
  defaultHandler?: ActionHandler<P>
): ActionHandler<P> {
  return async (request: NextRequest, context: RequestContext, params: P) => {
    const action = getActionParam(request);

    if (action) {
      const handler = actions[action];

      if (handler) {
        return handler(request, context, params);
      }

      return unknownActionResponse(request, action, Object.keys(actions));
    }

    // No action param - use default handler or return error
    if (defaultHandler) {
      return defaultHandler(request, context, params);
    }

    // No default handler and no action - this is a method not allowed scenario
    return missingActionResponse(request, Object.keys(actions));
  };
}

/**
 * The 400 for an `?action=` nobody registered. One builder so every dispatcher
 * answers with the same shape (`error` + `availableActions`).
 */
function unknownActionResponse(
  request: NextRequest,
  action: string,
  availableActions: string[]
): NextResponse {
  actionLogger.warn('Unknown action requested', {
    action,
    availableActions,
    method: request.method,
    path: new URL(request.url).pathname,
  });

  return NextResponse.json(
    {
      error: `Unknown action: ${action}`,
      availableActions,
    },
    { status: 400 }
  );
}

/**
 * The 400 for a request with no `?action=` on a route that has no default.
 */
function missingActionResponse(request: NextRequest, availableActions: string[]): NextResponse {
  actionLogger.warn('No action param and no default handler', {
    method: request.method,
    path: new URL(request.url).pathname,
    availableActions,
  });

  return NextResponse.json(
    {
      error: 'Action parameter required',
      availableActions,
    },
    { status: 400 }
  );
}

/**
 * A thunk that answers one `?action=`. Thunks close over whatever the handler
 * already has in hand (the request, the context, the route's `id`), which is
 * what lets a hand-written method handler dispatch without re-threading those
 * through the `ActionHandler` signature.
 */
export type ActionThunk = () => Promise<NextResponse>;

/**
 * Map of action names to thunks
 */
export type ActionThunkMap = {
  [action: string]: ActionThunk;
};

/**
 * Dispatch an already-received request by its `?action=` query parameter.
 *
 * The inline counterpart of {@link withActionDispatch} for method handlers that
 * take `(req, ctx, id)` themselves rather than being built by the middleware.
 * The rules are the same:
 *
 * - `?action=<key>` runs that thunk.
 * - No `?action=` at all runs `fallback`, or answers 400 when there is none.
 * - Anything else — an unregistered name, or a bare `?action=` with no value —
 *   answers 400 with `availableActions`, never the fallback. Falling through to
 *   the default body is how a typo in a client URL used to be served the whole
 *   chat instead of an error.
 *
 * @param request - The incoming request
 * @param thunks - Map of action names to thunks
 * @param fallback - Thunk for a request without an action param (optional)
 * @returns The chosen thunk's response, or the 400
 *
 * @example
 * ```ts
 * export async function handleGet(req: NextRequest, ctx: RequestContext, chatId: string) {
 *   return dispatchAction(req, {
 *     export: () => handleExport(req, ctx, chatId),
 *     cost: () => handleCost(req, ctx, chatId),
 *   }, () => handleGetChat(req, ctx, chatId));
 * }
 * ```
 */
export function dispatchAction(
  request: NextRequest,
  thunks: ActionThunkMap,
  fallback?: ActionThunk
): Promise<NextResponse> {
  const action = getActionParam(request);
  const availableActions = Object.keys(thunks);

  if (action === null) {
    if (fallback) {
      return fallback();
    }
    return Promise.resolve(missingActionResponse(request, availableActions));
  }

  const thunk = Object.prototype.hasOwnProperty.call(thunks, action) ? thunks[action] : undefined;
  if (thunk) {
    actionLogger.debug('Dispatching action', {
      action,
      method: request.method,
      path: new URL(request.url).pathname,
    });
    return thunk();
  }

  return Promise.resolve(unknownActionResponse(request, action, availableActions));
}

/**
 * Create a handler for collection endpoints (no [id]) with action dispatch
 *
 * Simplified version for routes like /api/v1/characters that support
 * both standard CRUD and action-based operations.
 *
 * @param actions - Map of action names to handlers
 * @param defaultHandler - Handler for requests without action param
 * @returns Handler function compatible with createContextHandler
 */
export function withCollectionActionDispatch(
  actions: ActionHandlerMap<Record<string, never>>,
  defaultHandler?: ActionHandler<Record<string, never>>
): (request: NextRequest, context: RequestContext) => Promise<NextResponse> {
  const dispatchHandler = withActionDispatch(actions, defaultHandler);
  return (request: NextRequest, context: RequestContext) => {
    return dispatchHandler(request, context, {} as Record<string, never>);
  };
}

/**
 * Type guard to check if an action is valid
 *
 * @param action - Action string to check
 * @param validActions - Array of valid action names
 * @returns True if action is in the valid list
 */
export function isValidAction<T extends string>(
  action: string | null,
  validActions: readonly T[]
): action is T {
  return action !== null && (validActions as readonly string[]).includes(action);
}

/**
 * Get all query parameters except 'action'
 *
 * Useful when actions need to access other query params.
 *
 * @param request - The incoming request
 * @returns Object with all query params except action
 */
export function getQueryParamsWithoutAction(
  request: NextRequest
): Record<string, string> {
  const params: Record<string, string> = {};

  request.nextUrl.searchParams.forEach((value, key) => {
    if (key !== 'action') {
      params[key] = value;
    }
  });

  return params;
}
