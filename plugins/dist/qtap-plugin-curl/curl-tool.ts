/**
 * curl Tool Definition
 *
 * Defines the tool schema and validation for the curl tool.
 */

import type { UniversalTool } from '@quilltap/plugin-types';
import type { CurlToolInput } from './types';

/**
 * Tool definition in universal (OpenAI) format
 */
export const curlToolDefinition: UniversalTool = {
  type: 'function',
  function: {
    name: 'curl',
    description: `Make HTTP requests to fetch web content, APIs, or other network resources.
Returns response headers and body in JSON format.
Useful for retrieving data from REST APIs, checking website availability, or fetching remote content.
NOTE: URLs must match the configured allowlist patterns. Private/local addresses are blocked for security.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to request. Must be http:// or https:// and match configured allowlist patterns.',
        },
        request: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
          description: 'HTTP method to use. Default is GET.',
        },
        header: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } },
          ],
          description: 'HTTP header(s) to include. Format: "Header-Name: value". Can be a single string or array of strings.',
        },
        data: {
          type: 'string',
          description: 'Request body data for POST, PUT, PATCH requests. For JSON, will auto-set Content-Type if not specified.',
        },
        userAgent: {
          type: 'string',
          description: 'Custom User-Agent header value.',
        },
        maxTime: {
          type: 'number',
          minimum: 1,
          maximum: 60,
          description: 'Maximum time in seconds to wait for response. Default is 30, maximum is 60.',
        },
        location: {
          type: 'boolean',
          description: 'Follow HTTP redirects. Default is true (from tool configuration).',
        },
        insecure: {
          type: 'boolean',
          description: 'Allow connections to SSL sites without valid certificates. Default is false. Not recommended for production use.',
        },
        render: {
          type: 'boolean',
          description: 'Convert HTML response to plain text for easier reading. Default is false. Useful for web pages.',
        },
      },
      required: ['url'],
    },
  },
};

/**
 * Validate curl tool input
 *
 * @param input The input to validate
 * @returns true if valid, false otherwise
 */
export function validateCurlInput(input: unknown): input is CurlToolInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // url is required and must be a string
  if (typeof obj.url !== 'string' || obj.url.length === 0) {
    return false;
  }

  // request must be a valid HTTP method if provided
  if (obj.request !== undefined) {
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    if (typeof obj.request !== 'string' || !validMethods.includes(obj.request)) {
      return false;
    }
  }

  // header must be string or array of strings if provided
  if (obj.header !== undefined) {
    if (typeof obj.header === 'string') {
      // OK
    } else if (Array.isArray(obj.header)) {
      if (!obj.header.every(h => typeof h === 'string')) {
        return false;
      }
    } else {
      return false;
    }
  }

  // data must be a string if provided
  if (obj.data !== undefined && typeof obj.data !== 'string') {
    return false;
  }

  // userAgent must be a string if provided
  if (obj.userAgent !== undefined && typeof obj.userAgent !== 'string') {
    return false;
  }

  // maxTime must be a number between 1 and 60 if provided
  if (obj.maxTime !== undefined) {
    if (typeof obj.maxTime !== 'number' || obj.maxTime < 1 || obj.maxTime > 60) {
      return false;
    }
  }

  // location must be a boolean if provided
  if (obj.location !== undefined && typeof obj.location !== 'boolean') {
    return false;
  }

  // insecure must be a boolean if provided
  if (obj.insecure !== undefined && typeof obj.insecure !== 'boolean') {
    return false;
  }

  // render must be a boolean if provided
  if (obj.render !== undefined && typeof obj.render !== 'boolean') {
    return false;
  }

  return true;
}
