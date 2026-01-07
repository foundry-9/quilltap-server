"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// index.ts
var qtap_plugin_curl_exports = {};
__export(qtap_plugin_curl_exports, {
  default: () => qtap_plugin_curl_default,
  plugin: () => plugin
});
module.exports = __toCommonJS(qtap_plugin_curl_exports);

// curl-tool.ts
var curlToolDefinition = {
  type: "function",
  function: {
    name: "curl",
    description: `Make HTTP requests to fetch web content, APIs, or other network resources.
Returns response headers and body in JSON format.
Useful for retrieving data from REST APIs, checking website availability, or fetching remote content.
NOTE: URLs must match the configured allowlist patterns. Private/local addresses are blocked for security.`,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to request. Must be http:// or https:// and match configured allowlist patterns."
        },
        request: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
          description: "HTTP method to use. Default is GET."
        },
        header: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } }
          ],
          description: 'HTTP header(s) to include. Format: "Header-Name: value". Can be a single string or array of strings.'
        },
        data: {
          type: "string",
          description: "Request body data for POST, PUT, PATCH requests. For JSON, will auto-set Content-Type if not specified."
        },
        userAgent: {
          type: "string",
          description: "Custom User-Agent header value."
        },
        maxTime: {
          type: "number",
          minimum: 1,
          maximum: 60,
          description: "Maximum time in seconds to wait for response. Default is 30, maximum is 60."
        },
        location: {
          type: "boolean",
          description: "Follow HTTP redirects. Default is true (from tool configuration)."
        },
        insecure: {
          type: "boolean",
          description: "Allow connections to SSL sites without valid certificates. Default is false. Not recommended for production use."
        }
      },
      required: ["url"]
    }
  }
};
function validateCurlInput(input) {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const obj = input;
  if (typeof obj.url !== "string" || obj.url.length === 0) {
    return false;
  }
  if (obj.request !== void 0) {
    const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
    if (typeof obj.request !== "string" || !validMethods.includes(obj.request)) {
      return false;
    }
  }
  if (obj.header !== void 0) {
    if (typeof obj.header === "string") {
    } else if (Array.isArray(obj.header)) {
      if (!obj.header.every((h) => typeof h === "string")) {
        return false;
      }
    } else {
      return false;
    }
  }
  if (obj.data !== void 0 && typeof obj.data !== "string") {
    return false;
  }
  if (obj.userAgent !== void 0 && typeof obj.userAgent !== "string") {
    return false;
  }
  if (obj.maxTime !== void 0) {
    if (typeof obj.maxTime !== "number" || obj.maxTime < 1 || obj.maxTime > 60) {
      return false;
    }
  }
  if (obj.location !== void 0 && typeof obj.location !== "boolean") {
    return false;
  }
  if (obj.insecure !== void 0 && typeof obj.insecure !== "boolean") {
    return false;
  }
  return true;
}

// url-validator.ts
var PRIVATE_IP_PATTERNS = [
  /^127\./,
  // Loopback
  /^10\./,
  // Private Class A
  /^192\.168\./,
  // Private Class C
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  // Private Class B (172.16-31.x.x)
  /^169\.254\./,
  // Link-local
  /^0\./,
  // Current network
  /^::1$/,
  // IPv6 loopback
  /^fe80:/i,
  // IPv6 link-local
  /^fc00:/i,
  // IPv6 unique local
  /^fd[0-9a-f]{2}:/i
  // IPv6 unique local
];
var BLOCKED_HOSTNAMES = [
  "localhost",
  "localhost.localdomain",
  "local",
  "0.0.0.0",
  "::",
  "::1"
];
function parseUrlPatterns(patternsString) {
  if (!patternsString || typeof patternsString !== "string") {
    return [];
  }
  return patternsString.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#")).map((pattern) => {
    const isWildcard = pattern.includes("*");
    let regexStr = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    if (!regexStr.startsWith("http")) {
      regexStr = `^https?://${regexStr}`;
    } else {
      regexStr = `^${regexStr}`;
    }
    if (!regexStr.endsWith(".*")) {
      regexStr = `${regexStr}($|/|\\?|#)`;
    }
    return {
      pattern,
      isWildcard,
      regex: new RegExp(regexStr, "i")
    };
  });
}
function urlMatchesPatterns(url, patterns) {
  if (patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => pattern.regex.test(url));
}
function isPrivateHost(hostname) {
  if (BLOCKED_HOSTNAMES.includes(hostname.toLowerCase())) {
    return true;
  }
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(hostname));
}
function validateUrlSecurity(urlString) {
  try {
    const url = new URL(urlString);
    if (!["http:", "https:"].includes(url.protocol)) {
      return {
        valid: false,
        error: `Invalid protocol: ${url.protocol}. Only http and https are allowed.`
      };
    }
    if (isPrivateHost(url.hostname)) {
      return {
        valid: false,
        error: `Access to private/local addresses is blocked: ${url.hostname}`
      };
    }
    if (url.username || url.password) {
      return {
        valid: false,
        error: "URLs with embedded credentials are not allowed."
      };
    }
    return { valid: true };
  } catch {
    return {
      valid: false,
      error: "Invalid URL format."
    };
  }
}
function validateUrl(urlString, allowedPatterns) {
  const securityCheck = validateUrlSecurity(urlString);
  if (!securityCheck.valid) {
    return securityCheck;
  }
  if (!urlMatchesPatterns(urlString, allowedPatterns)) {
    return {
      valid: false,
      error: `URL not in allowlist. Configure allowed URL patterns in tool settings.`
    };
  }
  return { valid: true };
}

// curl-handler.ts
var DEFAULTS = {
  allowedUrlPatterns: "",
  maxResponseSize: 102400,
  // 100KB
  defaultTimeout: 30,
  followRedirects: true
};
var MAX_TIMEOUT = 60;
var DEFAULT_USER_AGENT = "Quilltap-curl/1.0";
function parseHeaders(headerInput) {
  const headers = new Headers();
  if (!headerInput) {
    return headers;
  }
  const headerList = Array.isArray(headerInput) ? headerInput : [headerInput];
  for (const header of headerList) {
    const colonIndex = header.indexOf(":");
    if (colonIndex > 0) {
      const name = header.substring(0, colonIndex).trim();
      const value = header.substring(colonIndex + 1).trim();
      headers.append(name, value);
    }
  }
  return headers;
}
function headersToObject(headers) {
  const result = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}
function truncateBody(body, maxSize) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(body);
  const originalSize = bytes.length;
  if (originalSize <= maxSize) {
    return { body, truncated: false, originalSize };
  }
  const truncatedBytes = bytes.slice(0, maxSize);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const truncatedBody = decoder.decode(truncatedBytes);
  return {
    body: truncatedBody + "\n\n[Response truncated - original size: " + originalSize + " bytes]",
    truncated: true,
    originalSize
  };
}
async function executeCurlRequest(input, config) {
  const startTime = Date.now();
  const effectiveConfig = {
    ...DEFAULTS,
    ...config
  };
  const allowedPatterns = parseUrlPatterns(effectiveConfig.allowedUrlPatterns);
  const urlValidation = validateUrl(input.url, allowedPatterns);
  if (!urlValidation.valid) {
    return {
      success: false,
      error: urlValidation.error,
      timing: { totalMs: Date.now() - startTime }
    };
  }
  const method = input.request || "GET";
  const headers = parseHeaders(input.header);
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", input.userAgent || DEFAULT_USER_AGENT);
  }
  const timeout = Math.min(
    input.maxTime || effectiveConfig.defaultTimeout,
    MAX_TIMEOUT
  ) * 1e3;
  const followRedirects = input.location !== void 0 ? input.location : effectiveConfig.followRedirects;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const fetchOptions = {
      method,
      headers,
      signal: controller.signal,
      redirect: followRedirects ? "follow" : "manual"
    };
    if (input.data && ["POST", "PUT", "PATCH"].includes(method)) {
      fetchOptions.body = input.data;
      if (!headers.has("Content-Type")) {
        try {
          JSON.parse(input.data);
          headers.set("Content-Type", "application/json");
        } catch {
        }
      }
    }
    const response = await fetch(input.url, fetchOptions);
    clearTimeout(timeoutId);
    const bodyText = await response.text();
    const { body, truncated, originalSize } = truncateBody(
      bodyText,
      effectiveConfig.maxResponseSize
    );
    const output = {
      success: true,
      statusCode: response.status,
      statusText: response.statusText,
      headers: headersToObject(response.headers),
      body,
      bodyTruncated: truncated,
      timing: { totalMs: Date.now() - startTime }
    };
    if (truncated) {
      output.originalSize = originalSize;
    }
    if (response.redirected && response.url !== input.url) {
      output.finalUrl = response.url;
    }
    return output;
  } catch (error) {
    const totalMs = Date.now() - startTime;
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          success: false,
          error: `Request timed out after ${timeout / 1e3} seconds`,
          timing: { totalMs }
        };
      }
      if (error.message.includes("certificate") || error.message.includes("SSL")) {
        return {
          success: false,
          error: `SSL/TLS error: ${error.message}. Use --insecure to skip certificate verification (not recommended).`,
          timing: { totalMs }
        };
      }
      if (error.message.includes("ENOTFOUND") || error.message.includes("getaddrinfo")) {
        return {
          success: false,
          error: `DNS lookup failed: Could not resolve hostname`,
          timing: { totalMs }
        };
      }
      if (error.message.includes("ECONNREFUSED")) {
        return {
          success: false,
          error: `Connection refused: Server is not accepting connections`,
          timing: { totalMs }
        };
      }
      return {
        success: false,
        error: error.message,
        timing: { totalMs }
      };
    }
    return {
      success: false,
      error: "Unknown error occurred",
      timing: { totalMs }
    };
  }
}

// index.ts
var plugin = {
  metadata: {
    toolName: "curl",
    displayName: "curl",
    description: "Make HTTP requests to fetch web content, APIs, or other network resources",
    category: "Network"
  },
  /**
   * Get the tool definition in universal format
   */
  getToolDefinition() {
    return curlToolDefinition;
  },
  /**
   * Validate input arguments
   */
  validateInput(input) {
    return validateCurlInput(input);
  },
  /**
   * Execute the curl request
   */
  async execute(input, context) {
    const curlInput = input;
    const config = context.toolConfig;
    const output = await executeCurlRequest(curlInput, config);
    return {
      success: output.success,
      result: output,
      error: output.error,
      formattedText: formatCurlOutput(output),
      metadata: {
        url: curlInput.url,
        method: curlInput.request || "GET",
        statusCode: output.statusCode,
        timing: output.timing
      }
    };
  },
  /**
   * Format results for LLM consumption
   */
  formatResults(result) {
    if (result.formattedText) {
      return result.formattedText;
    }
    return JSON.stringify(result.result, null, 2);
  },
  /**
   * Check if tool is properly configured
   */
  isConfigured(config) {
    const patterns = config.allowedUrlPatterns;
    if (typeof patterns !== "string") {
      return false;
    }
    const lines = patterns.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"));
    return lines.length > 0;
  },
  /**
   * Get default configuration
   */
  getDefaultConfig() {
    return {
      allowedUrlPatterns: "",
      maxResponseSize: 102400,
      defaultTimeout: 30,
      followRedirects: true
    };
  }
};
function formatCurlOutput(output) {
  if (!output.success) {
    return `curl request failed: ${output.error}`;
  }
  const lines = [];
  lines.push(`HTTP ${output.statusCode} ${output.statusText}`);
  lines.push("");
  if (output.headers && Object.keys(output.headers).length > 0) {
    lines.push("Response Headers:");
    for (const [key, value] of Object.entries(output.headers)) {
      lines.push(`  ${key}: ${value}`);
    }
    lines.push("");
  }
  if (output.finalUrl) {
    lines.push(`Final URL (after redirect): ${output.finalUrl}`);
    lines.push("");
  }
  if (output.body) {
    lines.push("Response Body:");
    lines.push(output.body);
    if (output.bodyTruncated && output.originalSize) {
      lines.push("");
      lines.push(`[Response truncated from ${output.originalSize} bytes]`);
    }
  }
  if (output.timing) {
    lines.push("");
    lines.push(`Request completed in ${output.timing.totalMs}ms`);
  }
  return lines.join("\n");
}
var qtap_plugin_curl_default = { plugin };
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
