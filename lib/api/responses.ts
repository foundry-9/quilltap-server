/**
 * Standardized API Response Helpers
 *
 * Provides consistent response formatting across all API routes.
 * Consolidates error response patterns and ensures uniform API shape.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * Standard error response shape
 */
export interface ErrorResponse {
  error: string;
  details?: unknown;
}

/**
 * Standard success response shape with optional message
 */
export interface SuccessResponse<T = unknown> {
  data?: T;
  message?: string;
}

/**
 * Create an error response with standard formatting
 *
 * @param message - Error message
 * @param status - HTTP status code (default: 500)
 * @param details - Optional additional error details
 * @returns NextResponse with error JSON
 *
 * @example
 * ```ts
 * // Simple error
 * return errorResponse('Resource not found', 404);
 *
 * // With details
 * return errorResponse('Validation failed', 400, { field: 'email' });
 * ```
 */
export function errorResponse(
  message: string,
  status: number = 500,
  details?: unknown
): NextResponse<ErrorResponse> {
  const body: ErrorResponse = { error: message };

  if (details !== undefined) {
    body.details = details;
  }

  return NextResponse.json(body, { status });
}

/**
 * Create a success response with data
 *
 * @param data - Response data
 * @param status - HTTP status code (default: 200)
 * @returns NextResponse with data JSON
 *
 * @example
 * ```ts
 * const character = await repos.characters.findById(id);
 * return successResponse({ character });
 * ```
 */
export function successResponse<T>(
  data: T,
  status: number = 200
): NextResponse<T> {
  return NextResponse.json(data, { status });
}

/**
 * Create a success response with just a message
 *
 * @param message - Success message
 * @param status - HTTP status code (default: 200)
 * @returns NextResponse with message JSON
 *
 * @example
 * ```ts
 * await repos.characters.delete(id);
 * return messageResponse('Character deleted successfully');
 * ```
 */
export function messageResponse(
  message: string,
  status: number = 200
): NextResponse<{ message: string }> {
  return NextResponse.json({ message }, { status });
}

/**
 * Create a validation error response from Zod errors
 *
 * @param zodError - The Zod validation error
 * @returns NextResponse with 400 status and error details
 *
 * @example
 * ```ts
 * try {
 *   const data = schema.parse(body);
 * } catch (error) {
 *   if (error instanceof z.ZodError) {
 *     return validationError(error);
 *   }
 *   throw error;
 * }
 * ```
 */
export function validationError(
  zodError: z.ZodError
): NextResponse<ErrorResponse> {
  return NextResponse.json(
    {
      error: 'Validation error',
      details: zodError.errors,
    },
    { status: 400 }
  );
}

/**
 * Create an unauthorized response
 *
 * @param message - Optional custom message (default: 'Unauthorized')
 * @returns NextResponse with 401 status
 */
export function unauthorized(
  message: string = 'Unauthorized'
): NextResponse<ErrorResponse> {
  return errorResponse(message, 401);
}

/**
 * Create a forbidden response
 *
 * @param message - Optional custom message (default: 'Forbidden')
 * @returns NextResponse with 403 status
 */
export function forbidden(
  message: string = 'Forbidden'
): NextResponse<ErrorResponse> {
  return errorResponse(message, 403);
}

/**
 * Create a not found response
 *
 * @param resource - Optional resource type for message (e.g., 'Character')
 * @returns NextResponse with 404 status
 */
export function notFound(
  resource?: string
): NextResponse<ErrorResponse> {
  const message = resource ? `${resource} not found` : 'Not found';
  return errorResponse(message, 404);
}

/**
 * Create a conflict response
 *
 * @param message - Conflict description
 * @returns NextResponse with 409 status
 */
export function conflict(
  message: string
): NextResponse<ErrorResponse> {
  return errorResponse(message, 409);
}

/**
 * Create a bad request response
 *
 * @param message - Error description
 * @param details - Optional additional details
 * @returns NextResponse with 400 status
 */
export function badRequest(
  message: string,
  details?: unknown
): NextResponse<ErrorResponse> {
  return errorResponse(message, 400, details);
}

/**
 * Create an internal server error response
 *
 * @param message - Optional custom message (default: 'Internal server error')
 * @returns NextResponse with 500 status
 */
export function serverError(
  message: string = 'Internal server error'
): NextResponse<ErrorResponse> {
  return errorResponse(message, 500);
}

/**
 * Create a created response (201)
 *
 * @param data - The created resource data
 * @returns NextResponse with 201 status
 *
 * @example
 * ```ts
 * const character = await repos.characters.create(data);
 * return created({ character });
 * ```
 */
export function created<T>(data: T): NextResponse<T> {
  return NextResponse.json(data, { status: 201 });
}

/**
 * Create a no content response (204)
 *
 * @returns NextResponse with 204 status and no body
 */
export function noContent(): NextResponse<null> {
  return new NextResponse(null, { status: 204 });
}

/**
 * Wrap an async handler with standard error handling
 *
 * Catches errors and returns appropriate error responses.
 * Handles Zod validation errors specially.
 *
 * @param handler - Async handler function
 * @param errorMessage - Message for unhandled errors
 * @returns The handler result or error response
 *
 * @example
 * ```ts
 * export async function POST(req: NextRequest) {
 *   return withErrorHandling(async () => {
 *     const body = await req.json();
 *     const data = schema.parse(body);
 *     const result = await someOperation(data);
 *     return successResponse(result);
 *   }, 'Failed to create resource');
 * }
 * ```
 */
export async function withErrorHandling(
  handler: () => Promise<NextResponse>,
  errorMessage: string = 'Operation failed'
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    // Log would be done by caller typically
    return serverError(errorMessage);
  }
}
