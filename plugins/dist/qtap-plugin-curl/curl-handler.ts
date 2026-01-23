/**
 * curl HTTP Request Handler
 *
 * Executes HTTP requests using Node.js fetch API.
 */

import { convert as htmlToText } from 'html-to-text';
import type { CurlToolInput, CurlToolConfig, CurlToolOutput } from './types';
import { parseUrlPatterns, validateUrl } from './url-validator';

/**
 * Default configuration values
 */
const DEFAULTS: CurlToolConfig = {
  allowedUrlPatterns: '',
  maxResponseSize: 102400,   // 100KB
  defaultTimeout: 30,
  followRedirects: true,
};

/**
 * Maximum allowed timeout (enforced regardless of config)
 */
const MAX_TIMEOUT = 60;

/**
 * Default User-Agent string
 */
const DEFAULT_USER_AGENT = 'Quilltap-curl/1.0';

/**
 * Parse header strings into a Headers object
 *
 * @param headerInput Single header string or array of headers
 * @returns Headers object
 */
function parseHeaders(headerInput: string | string[] | undefined): Headers {
  const headers = new Headers();

  if (!headerInput) {
    return headers;
  }

  const headerList = Array.isArray(headerInput) ? headerInput : [headerInput];

  for (const header of headerList) {
    const colonIndex = header.indexOf(':');
    if (colonIndex > 0) {
      const name = header.substring(0, colonIndex).trim();
      const value = header.substring(colonIndex + 1).trim();
      headers.append(name, value);
    }
  }

  return headers;
}

/**
 * Convert fetch Headers to a plain object
 */
function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Truncate body text to max size
 *
 * @param body The body text
 * @param maxSize Maximum size in bytes
 * @returns Truncated body and metadata
 */
function truncateBody(
  body: string,
  maxSize: number
): { body: string; truncated: boolean; originalSize: number } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(body);
  const originalSize = bytes.length;

  if (originalSize <= maxSize) {
    return { body, truncated: false, originalSize };
  }

  // Truncate to maxSize bytes and decode
  const truncatedBytes = bytes.slice(0, maxSize);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const truncatedBody = decoder.decode(truncatedBytes);

  return {
    body: truncatedBody + '\n\n[Response truncated - original size: ' + originalSize + ' bytes]',
    truncated: true,
    originalSize,
  };
}

/**
 * Execute a curl request
 *
 * @param input The curl tool input parameters
 * @param config User configuration for the tool
 * @returns The curl output with response data
 */
export async function executeCurlRequest(
  input: CurlToolInput,
  config: Partial<CurlToolConfig>
): Promise<CurlToolOutput> {
  const startTime = Date.now();

  // Merge config with defaults
  const effectiveConfig: CurlToolConfig = {
    ...DEFAULTS,
    ...config,
  };

  // Parse allowed patterns
  const allowedPatterns = parseUrlPatterns(effectiveConfig.allowedUrlPatterns);

  // Validate URL
  const urlValidation = validateUrl(input.url, allowedPatterns);
  if (!urlValidation.valid) {
    return {
      success: false,
      error: urlValidation.error,
      timing: { totalMs: Date.now() - startTime },
    };
  }

  // Build request options
  const method = input.request || 'GET';
  const headers = parseHeaders(input.header);

  // Set User-Agent if not already set
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', input.userAgent || DEFAULT_USER_AGENT);
  }

  // Calculate timeout
  const timeout = Math.min(
    input.maxTime || effectiveConfig.defaultTimeout,
    MAX_TIMEOUT
  ) * 1000;

  // Determine redirect behavior
  const followRedirects = input.location !== undefined
    ? input.location
    : effectiveConfig.followRedirects;

  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Build fetch options
    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: controller.signal,
      redirect: followRedirects ? 'follow' : 'manual',
    };

    // Add body for methods that support it
    if (input.data && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = input.data;

      // Set Content-Type if not already set and data looks like JSON
      if (!headers.has('Content-Type')) {
        try {
          JSON.parse(input.data);
          headers.set('Content-Type', 'application/json');
        } catch {
          // Not JSON, don't set Content-Type
        }
      }
    }

    // Execute request
    const response = await fetch(input.url, fetchOptions);
    clearTimeout(timeoutId);

    // Read response body
    let bodyText = await response.text();

    // Convert HTML to text if render option is enabled
    if (input.render) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        bodyText = htmlToText(bodyText, {
          wordwrap: 120,
          selectors: [
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'img', format: 'skip' },
            { selector: 'script', format: 'skip' },
            { selector: 'style', format: 'skip' },
          ],
        });
      }
    }

    const { body, truncated, originalSize } = truncateBody(
      bodyText,
      effectiveConfig.maxResponseSize
    );

    // Build output
    const output: CurlToolOutput = {
      success: true,
      statusCode: response.status,
      statusText: response.statusText,
      headers: headersToObject(response.headers),
      body,
      bodyTruncated: truncated,
      timing: { totalMs: Date.now() - startTime },
    };

    if (truncated) {
      output.originalSize = originalSize;
    }

    // Track redirects
    if (response.redirected && response.url !== input.url) {
      output.finalUrl = response.url;
    }

    return output;
  } catch (error) {
    const totalMs = Date.now() - startTime;

    if (error instanceof Error) {
      // Handle specific error types
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: `Request timed out after ${timeout / 1000} seconds`,
          timing: { totalMs },
        };
      }

      // SSL errors
      if (error.message.includes('certificate') || error.message.includes('SSL')) {
        return {
          success: false,
          error: `SSL/TLS error: ${error.message}. Use --insecure to skip certificate verification (not recommended).`,
          timing: { totalMs },
        };
      }

      // Network errors
      if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
        return {
          success: false,
          error: `DNS lookup failed: Could not resolve hostname`,
          timing: { totalMs },
        };
      }

      if (error.message.includes('ECONNREFUSED')) {
        return {
          success: false,
          error: `Connection refused: Server is not accepting connections`,
          timing: { totalMs },
        };
      }

      return {
        success: false,
        error: error.message,
        timing: { totalMs },
      };
    }

    return {
      success: false,
      error: 'Unknown error occurred',
      timing: { totalMs },
    };
  }
}
