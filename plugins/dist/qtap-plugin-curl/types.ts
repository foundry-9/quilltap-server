/**
 * Types for the curl tool plugin
 */

/**
 * Input parameters for the curl tool
 */
export interface CurlToolInput {
  /** The URL to request (required) */
  url: string;

  /** HTTP method (default: GET) */
  request?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

  /** HTTP header(s) to include */
  header?: string | string[];

  /** Request body data for POST, PUT, PATCH requests */
  data?: string;

  /** Custom User-Agent header value */
  userAgent?: string;

  /** Maximum time in seconds to wait for response (default: 30, max: 60) */
  maxTime?: number;

  /** Follow HTTP redirects (default: from config) */
  location?: boolean;

  /** Allow connections to SSL sites without valid certificates (default: false) */
  insecure?: boolean;

  /** Convert HTML response to plain text using html-to-text (default: false) */
  render?: boolean;
}

/**
 * User configuration for the curl tool
 */
export interface CurlToolConfig {
  /** Allowed URL patterns (glob patterns or exact domains, one per line) */
  allowedUrlPatterns: string;

  /** Maximum response body size in bytes (default: 102400) */
  maxResponseSize: number;

  /** Default timeout in seconds (default: 30) */
  defaultTimeout: number;

  /** Whether to follow redirects by default (default: true) */
  followRedirects: boolean;
}

/**
 * Output from the curl tool
 */
export interface CurlToolOutput {
  /** Whether the request was successful */
  success: boolean;

  /** HTTP status code */
  statusCode?: number;

  /** HTTP status text */
  statusText?: string;

  /** Response headers as key-value pairs */
  headers?: Record<string, string>;

  /** Response body (may be truncated) */
  body?: string;

  /** Whether the body was truncated due to size limits */
  bodyTruncated?: boolean;

  /** Original body size in bytes (if truncated) */
  originalSize?: number;

  /** Error message if request failed */
  error?: string;

  /** Timing information */
  timing?: {
    /** Total request time in milliseconds */
    totalMs: number;
  };

  /** Final URL after redirects (if different from original) */
  finalUrl?: string;

  /** Number of redirects followed */
  redirectCount?: number;
}

/**
 * Parsed URL pattern for allowlist matching
 */
export interface UrlPattern {
  /** Original pattern string */
  pattern: string;

  /** Whether this is a wildcard pattern */
  isWildcard: boolean;

  /** Regex for matching */
  regex: RegExp;
}
