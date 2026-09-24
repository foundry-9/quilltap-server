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
 * Map of action names to argument-less handler thunks.
 *
 * This is the shape a route handler builds *inside* its own closure, after it
 * has already loaded the entity every action needs (the chat, the profile, the
 * character) — each thunk captures `req`, `ctx` and that entity itself, so
 * `dispatchAction` never has to know about them. `R` is `NextResponse` for
 * ordinary JSON routes and plain `Response` where an action streams bytes.
 */
export type ActionThunkMap<A extends string, R extends Response = NextResponse> = Record<
  A,
  () => Promise<R>
>;

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
 * The one 400 body every unknown `?action=` in the API answers with.
 *
 * `availableActions` rides at the top level (not under `details`) because that
 * is the shape `withActionDispatch` has always returned and clients may read.
 */
function unknownActionResponse(
  request: NextRequest,
  action: string,
  availableActions: readonly string[]
): NextResponse {
  actionLogger.warn('Unknown action requested', {
    action,
    availableActions,
    method: request.method,
    path: request.nextUrl.pathname,
  });

  return NextResponse.json(
    { error: `Unknown action: ${action}`, availableActions },
    { status: 400 }
  );
}

/**
 * The 400 body for a route that takes only actions and was called without one.
 */
function actionRequiredResponse(
  request: NextRequest,
  availableActions: readonly string[]
): NextResponse {
  actionLogger.warn('No action param and no default handler', {
    method: request.method,
    path: request.nextUrl.pathname,
    availableActions,
  });

  return NextResponse.json(
    { error: 'Action parameter required', availableActions },
    { status: 400 }
  );
}

/**
 * Dispatch a request to one of a map of action thunks by its `?action=` param.
 *
 * This is the single source of truth for how `?action=` is interpreted:
 *
 * - **No `action` parameter at all** → `fallback` (the plain CRUD verb: list,
 *   create, update, delete the entity). Without a fallback the route takes only
 *   actions, and the answer is a 400 `Action parameter required`.
 * - **A known action** → its thunk.
 * - **Anything else** — an unknown name, *or a bare `?action=`* — → a 400
 *   `Unknown action` listing the actions that exist.
 *
 * That third rule is the point. An unknown action must never fall through to
 * the fallback: on a `DELETE` route the fallback deletes the whole entity, on a
 * `POST` route it creates one, and on a `GET` route it quietly serves a body the
 * caller did not ask for and then reads the wrong fields off (Bug 74). A typo in
 * a client's action string is a 400 the developer sees, not a project gone.
 *
 * Handlers that must load the entity first (to 404 before anything else) do so
 * and then call this with thunks closing over it:
 *
 * ```ts
 * const chat = await repos.chats.findById(chatId);
 * if (!chat) return notFound('Chat');
 * return dispatchAction(req, {
 *   'regenerate-title': () => handleRegenerateTitle(chatId, chat, ctx),
 *   'rebuild-summary': () => handleRebuildSummary(chatId, chat, ctx),
 * });
 * ```
 *
 * `withActionDispatch` is this same rule for handlers that take
 * `(request, context, params)` instead of closing over them.
 */
export function dispatchAction<A extends string>(
  request: NextRequest,
  handlers: ActionThunkMap<A>,
  fallback?: () => Promise<NextResponse>
): Promise<NextResponse>;
export function dispatchAction<A extends string>(
  request: NextRequest,
  handlers: ActionThunkMap<A, Response>,
  fallback?: () => Promise<Response>
): Promise<Response>;
export function dispatchAction<A extends string>(
  request: NextRequest,
  handlers: ActionThunkMap<A, Response>,
  fallback?: () => Promise<Response>
): Promise<Response> {
  const action = getActionParam(request);
  const availableActions = Object.keys(handlers);

  if (action === null) {
    if (fallback) {
      return fallback();
    }
    return Promise.resolve(actionRequiredResponse(request, availableActions));
  }

  if (Object.prototype.hasOwnProperty.call(handlers, action)) {
    return handlers[action as A]();
  }

  return Promise.resolve(unknownActionResponse(request, action, availableActions));
}

/**
 * Create a handler that dispatches to action-specific handlers
 *
 * Routes requests based on the ?action= query parameter. A request with no
 * `action` parameter goes to the default handler; a known action goes to its
 * handler; an unknown action (or a bare `?action=`) is a 400 and never reaches
 * the default. See `dispatchAction` for why.
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
  return (request: NextRequest, context: RequestContext, params: P) => {
    const thunks = Object.fromEntries(
      Object.entries(actions).map(([name, handler]) => [name, () => handler(request, context, params)])
    ) as ActionThunkMap<string>;

    return dispatchAction(
      request,
      thunks,
      defaultHandler ? () => defaultHandler(request, context, params) : undefined
    );
  };
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
