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
var index_exports = {};
__export(index_exports, {
  default: () => index_default,
  plugin: () => plugin
});
module.exports = __toCommonJS(index_exports);

// ../../../lib/logging/transports/console.ts
var ConsoleTransport = class {
  /**
   * Write a log entry to the console
   * @param logData The structured log data to write
   */
  write(logData) {
    const logString = JSON.stringify(logData);
    switch (logData.level) {
      case "error" /* ERROR */:
        console.error(logString);
        break;
      case "warn" /* WARN */:
        console.warn(logString);
        break;
      case "info" /* INFO */:
        console.info(logString);
        break;
      case "debug" /* DEBUG */:
        console.debug(logString);
        break;
      default:
        console.log(logString);
    }
  }
};

// ../../../lib/logging/transports/file.ts
var import_fs = require("fs");
var import_path = require("path");
function buildRotatedLogPath(logDir, filename, rotation) {
  const rotatedName = [filename, String(rotation)].join(".");
  return (0, import_path.join)(logDir, rotatedName);
}
var FileTransport = class {
  /**
   * Create a new FileTransport instance
   * @param logDir Directory where log files will be stored
   * @param maxFileSize Maximum size of a log file in bytes (default: 10MB)
   * @param maxFiles Maximum number of rotated files to keep (default: 5)
   */
  constructor(logDir, maxFileSize = 10485760, maxFiles = 5) {
    this.fileSizes = /* @__PURE__ */ new Map();
    this.logDir = logDir;
    this.maxFileSize = maxFileSize;
    this.maxFiles = maxFiles;
    this.initializeDirectory();
  }
  /**
   * Initialize the log directory and track existing file sizes
   */
  async initializeDirectory() {
    try {
      await import_fs.promises.mkdir(this.logDir, { recursive: true });
      const combinedLogPath = (0, import_path.join)(this.logDir, "combined.log");
      const errorLogPath = (0, import_path.join)(this.logDir, "error.log");
      try {
        const combinedStats = await import_fs.promises.stat(combinedLogPath);
        this.fileSizes.set("combined.log", combinedStats.size);
      } catch {
        this.fileSizes.set("combined.log", 0);
      }
      try {
        const errorStats = await import_fs.promises.stat(errorLogPath);
        this.fileSizes.set("error.log", errorStats.size);
      } catch {
        this.fileSizes.set("error.log", 0);
      }
    } catch (error) {
      console.error(
        "Failed to initialize logging directory:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  /**
   * Write a log entry to the appropriate file(s)
   * @param logData The structured log data to write
   */
  async write(logData) {
    const logString = JSON.stringify(logData);
    const lineWithNewline = logString + "\n";
    await this.writeToFile("combined.log", lineWithNewline);
    if (logData.level === "error" /* ERROR */) {
      await this.writeToFile("error.log", lineWithNewline);
    }
  }
  /**
   * Write a line to a specific log file with rotation support
   * @param filename The log filename (combined.log or error.log)
   * @param content The log line to write
   */
  async writeToFile(filename, content) {
    try {
      const filePath = (0, import_path.join)(this.logDir, filename);
      const contentSize = Buffer.byteLength(content, "utf-8");
      const currentSize = this.fileSizes.get(filename) || 0;
      if (currentSize + contentSize > this.maxFileSize) {
        await this.rotateFile(filename);
      }
      await import_fs.promises.appendFile(filePath, content, "utf-8");
      const newSize = (this.fileSizes.get(filename) || 0) + contentSize;
      this.fileSizes.set(filename, newSize);
    } catch (error) {
      console.error(
        `Failed to write to ${filename}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  /**
   * Rotate a log file when it exceeds maxFileSize
   * Renames existing rotated files and starts fresh
   * Old rotations beyond maxFiles are deleted
   * @param filename The log filename to rotate
   */
  async rotateFile(filename) {
    try {
      const basePath = (0, import_path.join)(this.logDir, filename);
      const oldestPath = buildRotatedLogPath(this.logDir, filename, this.maxFiles);
      try {
        await import_fs.promises.unlink(oldestPath);
      } catch {
      }
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldPath = buildRotatedLogPath(this.logDir, filename, i);
        const newPath = buildRotatedLogPath(this.logDir, filename, i + 1);
        try {
          await import_fs.promises.rename(oldPath, newPath);
        } catch {
        }
      }
      const rotatedPath = buildRotatedLogPath(this.logDir, filename, 1);
      try {
        await import_fs.promises.rename(basePath, rotatedPath);
      } catch {
      }
      this.fileSizes.set(filename, 0);
    } catch (error) {
      console.error(
        `Failed to rotate ${filename}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
};

// ../../../lib/env.ts
var import_zod = require("zod");
var envSchema = import_zod.z.object({
  // Node environment
  NODE_ENV: import_zod.z.enum(["development", "production", "test"]).default("development"),
  // Database (legacy - no longer used, MongoDB is required)
  DATABASE_URL: import_zod.z.string().url().optional(),
  // Base URL for the application (used for OAuth callbacks, etc.)
  BASE_URL: import_zod.z.string().url().optional().default("http://localhost:3000"),
  // OAuth Providers (all optional - configured via auth plugins)
  GOOGLE_CLIENT_ID: import_zod.z.string().optional(),
  GOOGLE_CLIENT_SECRET: import_zod.z.string().optional(),
  APPLE_ID: import_zod.z.string().optional(),
  APPLE_SECRET: import_zod.z.string().optional(),
  GITHUB_ID: import_zod.z.string().optional(),
  GITHUB_SECRET: import_zod.z.string().optional(),
  // Encryption
  ENCRYPTION_MASTER_PEPPER: import_zod.z.string().min(32, "ENCRYPTION_MASTER_PEPPER must be at least 32 characters"),
  // Rate Limiting (optional)
  RATE_LIMIT_API_MAX: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_API_WINDOW: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_AUTH_MAX: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_AUTH_WINDOW: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_CHAT_MAX: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_CHAT_WINDOW: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_GENERAL_MAX: import_zod.z.string().regex(/^\d+$/).optional(),
  RATE_LIMIT_GENERAL_WINDOW: import_zod.z.string().regex(/^\d+$/).optional(),
  // Logging (optional)
  LOG_LEVEL: import_zod.z.enum(["error", "warn", "info", "debug"]).optional().default("info"),
  LOG_OUTPUT: import_zod.z.enum(["console", "file", "both"]).optional().default("console"),
  LOG_FILE_PATH: import_zod.z.string().optional().default("./logs"),
  LOG_FILE_MAX_SIZE: import_zod.z.string().regex(/^\d+$/).optional(),
  LOG_FILE_MAX_FILES: import_zod.z.string().regex(/^\d+$/).optional(),
  // Production SSL (optional)
  DOMAIN: import_zod.z.string().optional(),
  SSL_EMAIL: import_zod.z.string().email().optional(),
  // Data Backend Configuration
  // NOTE: 'json' option is deprecated and will be removed in a future version.
  // Use the migration plugin (qtap-plugin-upgrade) to migrate JSON data to MongoDB.
  DATA_BACKEND: import_zod.z.enum(["json", "mongodb"]).optional().default("mongodb"),
  // MongoDB Configuration (required - MongoDB is the default data backend)
  MONGODB_URI: import_zod.z.string().min(1, "MONGODB_URI is required for MongoDB backend"),
  MONGODB_DATABASE: import_zod.z.string().optional().default("quilltap"),
  MONGODB_MODE: import_zod.z.enum(["external", "embedded"]).optional().default("external"),
  MONGODB_DATA_DIR: import_zod.z.string().optional().default("/data/mongodb"),
  MONGODB_CONNECTION_TIMEOUT_MS: import_zod.z.string().regex(/^\d+$/).optional(),
  MONGODB_MAX_POOL_SIZE: import_zod.z.string().regex(/^\d+$/).optional(),
  // File Storage Configuration
  // Path for local filesystem storage (built-in backend)
  QUILLTAP_FILE_STORAGE_PATH: import_zod.z.string().optional().default("./data/files"),
  // Encryption key for mount point secrets (auto-generated if not set, falls back to ENCRYPTION_MASTER_PEPPER)
  QUILLTAP_ENCRYPTION_KEY: import_zod.z.string().min(32).optional(),
  // S3 Configuration (optional - S3 is now a plugin, local filesystem is the default)
  // These env vars are used to auto-create an S3 mount point during migration
  S3_MODE: import_zod.z.enum(["embedded", "external", "disabled"]).optional().default("disabled"),
  S3_ENDPOINT: import_zod.z.string().url().optional(),
  S3_REGION: import_zod.z.string().optional().default("us-east-1"),
  S3_ACCESS_KEY: import_zod.z.string().optional(),
  S3_SECRET_KEY: import_zod.z.string().optional(),
  S3_BUCKET: import_zod.z.string().optional().default("quilltap-files"),
  S3_PATH_PREFIX: import_zod.z.string().optional(),
  S3_PUBLIC_URL: import_zod.z.string().url().optional(),
  S3_FORCE_PATH_STYLE: import_zod.z.enum(["true", "false"]).optional()
}).refine(
  (data) => {
    if (data.DATA_BACKEND === "mongodb" && !data.MONGODB_URI) {
      return false;
    }
    return true;
  },
  {
    message: "MONGODB_URI is required when DATA_BACKEND is mongodb",
    path: ["MONGODB_URI"]
  }
).refine(
  (data) => {
    if (data.S3_MODE === "external") {
      if (data.S3_ACCESS_KEY && !data.S3_SECRET_KEY || !data.S3_ACCESS_KEY && data.S3_SECRET_KEY) {
        return false;
      }
    }
    return true;
  },
  {
    message: "S3_ACCESS_KEY and S3_SECRET_KEY must both be provided, or both omitted (for IAM role auth)",
    path: ["S3_MODE"]
  }
);
var isBuildPhase = process.env.SKIP_ENV_VALIDATION === "true" || process.env.NEXT_PHASE === "phase-production-build" || process.env.NEXT_RUNTIME === void 0 && process.argv.some((arg) => arg.includes("next") && process.argv.includes("build"));
function validateEnv() {
  if (isBuildPhase) {
    return {
      NODE_ENV: process.env.NODE_ENV || "production",
      BASE_URL: process.env.BASE_URL || "http://localhost:3000",
      ENCRYPTION_MASTER_PEPPER: process.env.ENCRYPTION_MASTER_PEPPER || "build-time-placeholder-pepper-value",
      MONGODB_URI: process.env.MONGODB_URI || "mongodb://localhost:27017",
      MONGODB_DATABASE: "quilltap",
      MONGODB_MODE: "external",
      MONGODB_DATA_DIR: "/data/mongodb",
      DATA_BACKEND: "mongodb",
      QUILLTAP_FILE_STORAGE_PATH: "./data/files",
      S3_MODE: "disabled",
      S3_REGION: "us-east-1",
      S3_BUCKET: "quilltap-files",
      LOG_LEVEL: "info",
      LOG_OUTPUT: "console",
      LOG_FILE_PATH: "./logs"
    };
  }
  try {
    const env2 = envSchema.parse(process.env);
    return env2;
  } catch (error) {
    if (error instanceof import_zod.z.ZodError) {
      const missingVars = error.errors.map((err) => {
        return `  - ${err.path.join(".")}: ${err.message}`;
      });
      console.error("\u274C Environment validation failed:");
      console.error(missingVars.join("\n"));
      console.error("\nPlease check your .env file and ensure all required variables are set.");
      console.error("See .env.example for reference.\n");
      if (process.env.NODE_ENV !== "test") {
        process.exit(1);
      }
      throw error;
    }
    throw error;
  }
}
var env = validateEnv();
var isProduction = env.NODE_ENV === "production";
var isDevelopment = env.NODE_ENV === "development";
var isTest = env.NODE_ENV === "test";
function isLocalHostname(hostname) {
  const lowerHostname = hostname.toLowerCase();
  return lowerHostname === "localhost" || lowerHostname === "127.0.0.1";
}
function extractHostname(urlString) {
  if (!urlString) return null;
  try {
    const url = new URL(urlString);
    return url.hostname;
  } catch {
    const match = urlString.match(/mongodb(?:\+srv)?:\/\/(?:[^:@]+(?::[^@]+)?@)?([^:/?]+)/);
    return match ? match[1] : null;
  }
}
function checkIsUserManaged() {
  const mongodbMode = env.MONGODB_MODE;
  if (mongodbMode === "embedded") {
    return true;
  }
  const mongoHostname = extractHostname(env.MONGODB_URI);
  if (mongoHostname && isLocalHostname(mongoHostname)) {
    return true;
  }
  const s3Mode = env.S3_MODE;
  if (s3Mode === "embedded") {
    return true;
  }
  const s3Hostname = extractHostname(env.S3_ENDPOINT);
  if (s3Hostname && isLocalHostname(s3Hostname)) {
    return true;
  }
  return false;
}
var isUserManaged = checkIsUserManaged();

// ../../../lib/logger.ts
var LOG_LEVELS = {
  ["error" /* ERROR */]: 0,
  ["warn" /* WARN */]: 1,
  ["info" /* INFO */]: 2,
  ["debug" /* DEBUG */]: 3
};
var CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || "info" /* INFO */];
function initializeTransports() {
  const transports = [];
  const output = env.LOG_OUTPUT || "console";
  if (output === "console" || output === "both") {
    transports.push(new ConsoleTransport());
  }
  if (output === "file" || output === "both") {
    const maxFileSize = env.LOG_FILE_MAX_SIZE ? Number.parseInt(env.LOG_FILE_MAX_SIZE) : void 0;
    const maxFiles = env.LOG_FILE_MAX_FILES ? Number.parseInt(env.LOG_FILE_MAX_FILES) : void 0;
    transports.push(new FileTransport(
      env.LOG_FILE_PATH || "./logs",
      maxFileSize,
      maxFiles
    ));
  }
  return transports;
}
var Logger = class _Logger {
  constructor(context = {}, transports, minLevel) {
    this.context = context;
    this.transports = transports || initializeTransports();
    this.minLevel = minLevel ? LOG_LEVELS[minLevel] : CURRENT_LEVEL;
  }
  /**
   * Create a child logger with additional context
   */
  child(additionalContext) {
    const levelKey = Object.keys(LOG_LEVELS).find((key) => LOG_LEVELS[key] === this.minLevel);
    return new _Logger({ ...this.context, ...additionalContext }, this.transports, levelKey);
  }
  /**
   * Log an error message
   */
  error(message, context, error) {
    this.log("error" /* ERROR */, message, context, error);
  }
  /**
   * Log a warning message
   */
  warn(message, context) {
    this.log("warn" /* WARN */, message, context);
  }
  /**
   * Log an info message
   */
  info(message, context) {
    this.log("info" /* INFO */, message, context);
  }
  /**
   * Log a debug message
   */
  debug(message, context) {
    this.log("debug" /* DEBUG */, message, context);
  }
  /**
   * Internal logging implementation
   */
  log(level, message, context, error) {
    if (LOG_LEVELS[level] > this.minLevel) {
      return;
    }
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const logData = {
      timestamp,
      level,
      message,
      context: {
        ...this.context,
        ...context
      },
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : void 0
    };
    for (const transport of this.transports) {
      try {
        const result = transport.write(logData);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error("Transport write failed:", err);
          });
        }
      } catch (err) {
        console.error("Transport write failed:", err);
      }
    }
  }
  /**
   * Log an HTTP request
   */
  logRequest(method, path, statusCode, duration, context) {
    this.info("HTTP request", {
      method,
      path,
      statusCode,
      duration,
      ...context
    });
  }
  /**
   * Log an API key operation (without exposing the key)
   */
  logApiKeyOperation(operation, provider, userId, success) {
    this.info("API key operation", {
      operation,
      provider,
      userId,
      success
    });
  }
  /**
   * Log LLM API call (without exposing API key or full content)
   */
  logLLMCall(provider, model, tokenCount, success, duration) {
    this.info("LLM API call", {
      provider,
      model,
      tokenCount,
      success,
      duration
    });
  }
  /**
   * Log authentication events
   */
  logAuth(event, provider, userId, success) {
    this.info("Authentication event", {
      event,
      provider,
      userId,
      success
    });
  }
};
var logger = new Logger({
  service: "quilltap",
  environment: process.env.NODE_ENV || "development"
});

// sse-parser.ts
function parseSSEEvents(chunk) {
  const events = [];
  const lines = chunk.split("\n");
  let currentEvent = {};
  let dataLines = [];
  for (const line of lines) {
    if (line.startsWith(":")) {
      continue;
    }
    if (line === "") {
      if (dataLines.length > 0) {
        currentEvent.data = dataLines.join("\n");
        events.push(currentEvent);
      }
      currentEvent = {};
      dataLines = [];
      continue;
    }
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }
    const field = line.slice(0, colonIndex);
    let value = line.slice(colonIndex + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    switch (field) {
      case "event":
        currentEvent.event = value;
        break;
      case "data":
        dataLines.push(value);
        break;
      case "id":
        currentEvent.id = value;
        break;
      case "retry":
        const retry = parseInt(value, 10);
        if (!isNaN(retry)) {
          currentEvent.retry = retry;
        }
        break;
    }
  }
  if (dataLines.length > 0) {
    currentEvent.data = dataLines.join("\n");
    events.push(currentEvent);
  }
  return events;
}
function parseSSEData(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}
async function* createSSEReader(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          const events = parseSSEEvents(buffer);
          for (const event of events) {
            yield event;
          }
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let eventEnd = buffer.indexOf("\n\n");
      while (eventEnd !== -1) {
        const eventText = buffer.slice(0, eventEnd + 2);
        buffer = buffer.slice(eventEnd + 2);
        const events = parseSSEEvents(eventText);
        for (const event of events) {
          yield event;
        }
        eventEnd = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// security.ts
function isPrivateHost(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "localhost.localdomain") {
    return true;
  }
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }
  const lowerHostname = hostname.toLowerCase();
  if (lowerHostname === "::1" || lowerHostname === "[::1]") return true;
  if (lowerHostname.startsWith("fe80:") || lowerHostname.startsWith("[fe80:")) return true;
  if (lowerHostname.startsWith("fc") || lowerHostname.startsWith("fd") || lowerHostname.startsWith("[fc") || lowerHostname.startsWith("[fd")) {
    return true;
  }
  return false;
}
function validateMCPServerUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        valid: false,
        error: `Invalid protocol: ${parsed.protocol}. Only http and https are allowed.`
      };
    }
    if (parsed.username || parsed.password) {
      return {
        valid: false,
        error: "URLs with embedded credentials are not allowed. Use authentication headers instead."
      };
    }
    if (isPrivateHost(parsed.hostname)) {
      return {
        valid: false,
        error: `Access to private/local addresses is blocked: ${parsed.hostname}`
      };
    }
    return { valid: true };
  } catch {
    return {
      valid: false,
      error: "Invalid URL format"
    };
  }
}
var DANGEROUS_HEADERS = [
  "host",
  "cookie",
  "set-cookie",
  "authorization",
  // Handled separately via authType
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "upgrade"
];
function sanitizeCustomHeaders(headersJson) {
  if (!headersJson) return null;
  try {
    const parsed = JSON.parse(headersJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const sanitized = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") continue;
      if (DANGEROUS_HEADERS.includes(key.toLowerCase())) continue;
      if (!/^[\w-]+$/.test(key)) continue;
      sanitized[key] = value;
    }
    return Object.keys(sanitized).length > 0 ? sanitized : null;
  } catch {
    return null;
  }
}
function sanitizeServerName(name) {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 50);
}
function validateServerConfig(config) {
  if (typeof config !== "object" || config === null) {
    return { valid: false, error: "Server configuration must be an object" };
  }
  const obj = config;
  if (typeof obj.name !== "string" || obj.name.length === 0) {
    return { valid: false, error: "Server name is required" };
  }
  if (typeof obj.url !== "string" || obj.url.length === 0) {
    return { valid: false, error: "Server URL is required" };
  }
  const urlValidation = validateMCPServerUrl(obj.url);
  if (!urlValidation.valid) {
    return { valid: false, error: urlValidation.error };
  }
  const validAuthTypes = ["none", "bearer", "api-key", "custom-header"];
  const authType = obj.authType ?? "none";
  if (typeof authType !== "string" || !validAuthTypes.includes(authType)) {
    return { valid: false, error: `Invalid authType: ${authType}` };
  }
  if (authType === "bearer" && typeof obj.bearerToken !== "string") {
    return { valid: false, error: "Bearer token required for bearer auth" };
  }
  if (authType === "api-key" && typeof obj.apiKey !== "string") {
    return { valid: false, error: "API key required for api-key auth" };
  }
  if (authType === "custom-header") {
    const headers = sanitizeCustomHeaders(obj.customHeaders);
    if (!headers) {
      return { valid: false, error: "Valid custom headers JSON required for custom-header auth" };
    }
  }
  const sanitizedConfig = {
    name: sanitizeServerName(obj.name),
    displayName: typeof obj.displayName === "string" ? obj.displayName : sanitizeServerName(obj.name),
    url: obj.url,
    authType,
    enabled: obj.enabled !== false,
    // Default to enabled
    timeout: typeof obj.timeout === "number" ? Math.max(5, Math.min(120, obj.timeout)) : 30
  };
  if (authType === "bearer") {
    sanitizedConfig.bearerToken = obj.bearerToken;
  } else if (authType === "api-key") {
    sanitizedConfig.apiKey = obj.apiKey;
    sanitizedConfig.apiKeyHeader = typeof obj.apiKeyHeader === "string" ? obj.apiKeyHeader : "X-API-Key";
  } else if (authType === "custom-header") {
    sanitizedConfig.customHeaders = obj.customHeaders;
  }
  return { valid: true, config: sanitizedConfig };
}
function parseServerConfigs(serversJson) {
  const servers = [];
  const errors = [];
  try {
    const parsed = JSON.parse(serversJson);
    if (!Array.isArray(parsed)) {
      return { servers: [], errors: ["Server configuration must be a JSON array"] };
    }
    for (let i = 0; i < parsed.length; i++) {
      const result = validateServerConfig(parsed[i]);
      if (result.valid) {
        servers.push(result.config);
      } else {
        errors.push(`Server ${i + 1}: ${result.error}`);
      }
    }
  } catch (e) {
    errors.push(`Invalid JSON: ${e instanceof Error ? e.message : "parse error"}`);
  }
  return { servers, errors };
}

// mcp-client.ts
var clientLogger = logger.child({ module: "mcp-client" });
var MCPClient = class {
  constructor(config) {
    this.abortController = null;
    this.pendingRequests = /* @__PURE__ */ new Map();
    this.messageId = 0;
    this.sseReader = null;
    this.readLoopPromise = null;
    this.config = config;
    this.state = {
      serverId: config.name,
      status: "disconnected",
      tools: [],
      reconnectAttempts: 0
    };
  }
  /**
   * Get current connection state
   */
  getState() {
    return { ...this.state };
  }
  /**
   * Get discovered tools
   */
  getTools() {
    return [...this.state.tools];
  }
  /**
   * Get server configuration
   */
  getConfig() {
    return { ...this.config };
  }
  /**
   * Build request headers for the MCP server
   */
  buildHeaders() {
    const headers = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache"
    };
    switch (this.config.authType) {
      case "bearer":
        if (this.config.bearerToken) {
          headers["Authorization"] = `Bearer ${this.config.bearerToken}`;
        }
        break;
      case "api-key":
        if (this.config.apiKey) {
          const headerName = this.config.apiKeyHeader || "X-API-Key";
          headers[headerName] = this.config.apiKey;
        }
        break;
      case "custom-header":
        if (this.config.customHeaders) {
          const customHeaders = sanitizeCustomHeaders(this.config.customHeaders);
          if (customHeaders) {
            Object.assign(headers, customHeaders);
          }
        }
        break;
    }
    return headers;
  }
  /**
   * Connect to the MCP server via SSE
   */
  async connect() {
    if (this.state.status === "connected" || this.state.status === "ready") {
      clientLogger.debug("Already connected", { serverId: this.config.name });
      return;
    }
    this.state.status = "connecting";
    this.abortController = new AbortController();
    try {
      clientLogger.info("Connecting to MCP server", {
        serverId: this.config.name,
        url: this.config.url
      });
      const response = await fetch(this.config.url, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: this.abortController.signal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      if (!response.body) {
        throw new Error("No response body");
      }
      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("text/event-stream")) {
        clientLogger.warn("Unexpected content type", {
          serverId: this.config.name,
          contentType
        });
      }
      this.state.status = "connected";
      this.state.lastConnected = /* @__PURE__ */ new Date();
      this.state.reconnectAttempts = 0;
      this.sseReader = createSSEReader(response.body);
      this.readLoopPromise = this.readLoop();
      clientLogger.info("Connected to MCP server", { serverId: this.config.name });
    } catch (error) {
      this.state.status = "error";
      this.state.lastError = error instanceof Error ? error.message : "Connection failed";
      clientLogger.error("Failed to connect to MCP server", {
        serverId: this.config.name,
        error: this.state.lastError
      });
      throw error;
    }
  }
  /**
   * Read loop for processing SSE events
   */
  async readLoop() {
    if (!this.sseReader) return;
    try {
      for await (const event of this.sseReader) {
        this.handleSSEEvent(event);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        clientLogger.debug("SSE read loop aborted", { serverId: this.config.name });
      } else {
        clientLogger.error("SSE read loop error", {
          serverId: this.config.name,
          error: error instanceof Error ? error.message : String(error)
        });
        this.state.status = "error";
        this.state.lastError = error instanceof Error ? error.message : "Read loop error";
      }
    }
  }
  /**
   * Handle an incoming SSE event
   */
  handleSSEEvent(event) {
    clientLogger.debug("SSE event received", {
      serverId: this.config.name,
      eventType: event.event,
      hasData: !!event.data
    });
    const response = parseSSEData(event);
    if (response && response.jsonrpc === "2.0" && response.id !== void 0) {
      this.handleResponse(response);
    }
  }
  /**
   * Handle a JSON-RPC response
   */
  handleResponse(response) {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      clientLogger.warn("Received response for unknown request", {
        serverId: this.config.name,
        id: response.id
      });
      return;
    }
    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(response.id);
    pending.resolve(response);
  }
  /**
   * Send a JSON-RPC request and wait for response
   */
  async sendRequest(method, params) {
    if (this.state.status !== "connected" && this.state.status !== "ready") {
      throw new Error(`Not connected (status: ${this.state.status})`);
    }
    const id = ++this.messageId;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };
    const timeout = (this.config.timeout || 30) * 1e3;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);
      this.pendingRequests.set(id, {
        id,
        resolve: (response) => {
          if (response.error) {
            reject(new Error(`MCP error: ${response.error.message} (code: ${response.error.code})`));
          } else {
            resolve(response.result);
          }
        },
        reject,
        timeoutId,
        timestamp: /* @__PURE__ */ new Date()
      });
      this.postRequest(request).catch((error) => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(id);
        reject(error);
      });
    });
  }
  /**
   * POST a JSON-RPC request to the server
   */
  async postRequest(request) {
    const headers = this.buildHeaders();
    headers["Content-Type"] = "application/json";
    clientLogger.debug("Sending MCP request", {
      serverId: this.config.name,
      method: request.method,
      id: request.id
    });
    const response = await fetch(this.config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: this.abortController?.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      try {
        const jsonResponse = await response.json();
        if (jsonResponse.jsonrpc === "2.0" && jsonResponse.id === request.id) {
          this.handleResponse(jsonResponse);
        }
      } catch {
      }
    }
  }
  /**
   * Discover tools from the MCP server
   */
  async discoverTools() {
    this.state.status = "discovering";
    try {
      clientLogger.info("Discovering tools", { serverId: this.config.name });
      const result = await this.sendRequest("tools/list");
      this.state.tools = result.tools || [];
      this.state.status = "ready";
      clientLogger.info("Tools discovered", {
        serverId: this.config.name,
        toolCount: this.state.tools.length,
        tools: this.state.tools.map((t) => t.name)
      });
      return this.state.tools;
    } catch (error) {
      this.state.status = "error";
      this.state.lastError = error instanceof Error ? error.message : "Tool discovery failed";
      clientLogger.error("Tool discovery failed", {
        serverId: this.config.name,
        error: this.state.lastError
      });
      throw error;
    }
  }
  /**
   * Call a tool on the MCP server
   */
  async callTool(toolName, args) {
    if (this.state.status !== "ready") {
      throw new Error(`Server not ready (status: ${this.state.status})`);
    }
    clientLogger.debug("Calling MCP tool", {
      serverId: this.config.name,
      toolName
    });
    const params = {
      name: toolName,
      arguments: args
    };
    const result = await this.sendRequest("tools/call", params);
    clientLogger.debug("MCP tool call completed", {
      serverId: this.config.name,
      toolName,
      isError: result.isError,
      contentCount: result.content?.length
    });
    return result;
  }
  /**
   * Disconnect from the MCP server
   */
  disconnect() {
    clientLogger.info("Disconnecting from MCP server", { serverId: this.config.name });
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Connection closed"));
      this.pendingRequests.delete(id);
    }
    this.sseReader = null;
    this.readLoopPromise = null;
    this.state.status = "disconnected";
    this.state.tools = [];
  }
  /**
   * Check if connected and ready
   */
  isReady() {
    return this.state.status === "ready";
  }
  /**
   * Check if connected (but not necessarily ready)
   */
  isConnected() {
    return this.state.status === "connected" || this.state.status === "discovering" || this.state.status === "ready";
  }
};

// tool-generator.ts
var MCP_TOOL_PREFIX = "mcp";
function generateToolName(serverId, mcpToolName) {
  const sanitizedToolName = mcpToolName.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return `${MCP_TOOL_PREFIX}_${serverId}_${sanitizedToolName}`;
}
function parseToolName(toolName) {
  if (!toolName.startsWith(`${MCP_TOOL_PREFIX}_`)) {
    return null;
  }
  const remainder = toolName.slice(MCP_TOOL_PREFIX.length + 1);
  const underscoreIndex = remainder.indexOf("_");
  if (underscoreIndex === -1) {
    return null;
  }
  const serverId = remainder.slice(0, underscoreIndex);
  const originalName = remainder.slice(underscoreIndex + 1);
  if (!serverId || !originalName) {
    return null;
  }
  return { serverId, originalName };
}
function convertToUniversalTool(serverId, serverDisplayName, mcpTool) {
  const quilltapName = generateToolName(serverId, mcpTool.name);
  const description = mcpTool.description ? `[${serverDisplayName}] ${mcpTool.description}` : `[${serverDisplayName}] Tool: ${mcpTool.name}`;
  const parameters = {
    type: "object",
    properties: mcpTool.inputSchema.properties || {},
    required: mcpTool.inputSchema.required || []
  };
  return {
    type: "function",
    function: {
      name: quilltapName,
      description,
      parameters
    }
  };
}
function convertTools(serverId, serverDisplayName, mcpTools) {
  const tools = [];
  const mappings = [];
  for (const mcpTool of mcpTools) {
    const universalTool = convertToUniversalTool(serverId, serverDisplayName, mcpTool);
    tools.push(universalTool);
    mappings.push({
      quilltapName: universalTool.function.name,
      mcpName: mcpTool.name,
      serverId,
      definition: mcpTool
    });
  }
  return { tools, mappings };
}

// connection-manager.ts
var managerLogger = logger.child({ module: "mcp-connection-manager" });
var MCPConnectionManager = class {
  constructor() {
    this.clients = /* @__PURE__ */ new Map();
    this.toolIndex = /* @__PURE__ */ new Map();
    this.allTools = [];
    this.config = {
      servers: "[]",
      discoveryTimeout: 30,
      autoReconnect: true,
      maxReconnectAttempts: 3
    };
    this.initialized = false;
  }
  /**
   * Initialize the connection manager with configuration
   */
  async initialize(config) {
    this.config = { ...this.config, ...config };
    managerLogger.info("Initializing MCP connection manager", {
      discoveryTimeout: this.config.discoveryTimeout,
      autoReconnect: this.config.autoReconnect
    });
    await this.reconfigure(this.config.servers);
    this.initialized = true;
  }
  /**
   * Reconfigure with new server settings
   *
   * Disconnects from removed servers, connects to new servers,
   * and rediscovers tools.
   */
  async reconfigure(serversJson) {
    managerLogger.info("Reconfiguring MCP servers");
    const { servers, errors } = parseServerConfigs(serversJson);
    if (errors.length > 0) {
      managerLogger.warn("Server configuration errors", { errors });
    }
    const enabledServers = servers.filter((s) => s.enabled);
    const newServerIds = new Set(enabledServers.map((s) => s.name));
    for (const [serverId, client] of this.clients) {
      if (!newServerIds.has(serverId)) {
        managerLogger.info("Disconnecting removed server", { serverId });
        client.disconnect();
        this.clients.delete(serverId);
      }
    }
    for (const serverConfig of enabledServers) {
      const existingClient = this.clients.get(serverConfig.name);
      if (existingClient) {
        const existingConfig = existingClient.getConfig();
        if (JSON.stringify(existingConfig) !== JSON.stringify(serverConfig)) {
          managerLogger.info("Server config changed, reconnecting", {
            serverId: serverConfig.name
          });
          existingClient.disconnect();
          this.clients.delete(serverConfig.name);
          await this.connectServer(serverConfig);
        }
      } else {
        await this.connectServer(serverConfig);
      }
    }
    await this.rebuildToolIndex();
  }
  /**
   * Connect to a single MCP server
   */
  async connectServer(config) {
    const client = new MCPClient(config);
    try {
      await client.connect();
      await client.discoverTools();
      this.clients.set(config.name, client);
      managerLogger.info("Server connected and tools discovered", {
        serverId: config.name,
        toolCount: client.getTools().length
      });
    } catch (error) {
      managerLogger.error("Failed to connect to server", {
        serverId: config.name,
        error: error instanceof Error ? error.message : String(error)
      });
      this.clients.set(config.name, client);
    }
  }
  /**
   * Rebuild the unified tool index from all connected servers
   */
  async rebuildToolIndex() {
    this.allTools = [];
    this.toolIndex.clear();
    for (const [serverId, client] of this.clients) {
      if (!client.isReady()) continue;
      const config = client.getConfig();
      const mcpTools = client.getTools();
      const { tools, mappings } = convertTools(serverId, config.displayName, mcpTools);
      this.allTools.push(...tools);
      for (const mapping of mappings) {
        this.toolIndex.set(mapping.quilltapName, mapping);
      }
    }
    managerLogger.info("Tool index rebuilt", {
      totalTools: this.allTools.length,
      servers: Array.from(this.clients.keys())
    });
  }
  /**
   * Get all available tools from all connected servers
   */
  getAllToolDefinitions() {
    return [...this.allTools];
  }
  /**
   * Get a client by server ID
   */
  getClient(serverId) {
    return this.clients.get(serverId) || null;
  }
  /**
   * Get tool mapping by Quilltap tool name
   */
  getToolMapping(quilltapToolName) {
    return this.toolIndex.get(quilltapToolName) || null;
  }
  /**
   * Execute a tool by its Quilltap name
   */
  async executeTool(quilltapToolName, args) {
    const startTime = Date.now();
    const parsed = parseToolName(quilltapToolName);
    if (!parsed) {
      return {
        success: false,
        error: `Invalid MCP tool name format: ${quilltapToolName}`,
        serverId: "",
        originalToolName: "",
        executionTimeMs: Date.now() - startTime
      };
    }
    const { serverId, originalName } = parsed;
    const client = this.clients.get(serverId);
    if (!client) {
      return {
        success: false,
        error: `MCP server not found: ${serverId}`,
        serverId,
        originalToolName: originalName,
        executionTimeMs: Date.now() - startTime
      };
    }
    if (!client.isReady()) {
      return {
        success: false,
        error: `MCP server not ready: ${serverId} (status: ${client.getState().status})`,
        serverId,
        originalToolName: originalName,
        executionTimeMs: Date.now() - startTime
      };
    }
    try {
      const result = await client.callTool(originalName, args);
      const content = this.formatMCPContent(result);
      return {
        success: !result.isError,
        content,
        error: result.isError ? content : void 0,
        serverId,
        originalToolName: originalName,
        executionTimeMs: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        serverId,
        originalToolName: originalName,
        executionTimeMs: Date.now() - startTime
      };
    }
  }
  /**
   * Format MCP response content as a string
   */
  formatMCPContent(result) {
    if (!result.content || result.content.length === 0) {
      return "";
    }
    const parts = [];
    for (const block of result.content) {
      switch (block.type) {
        case "text":
          if (block.text) {
            parts.push(block.text);
          }
          break;
        case "image":
          if (block.data && block.mimeType) {
            parts.push(`[Image: ${block.mimeType}]`);
          }
          break;
        case "resource":
          parts.push(`[Resource: ${block.mimeType || "unknown type"}]`);
          break;
      }
    }
    return parts.join("\n");
  }
  /**
   * Get connection states for all servers
   */
  getConnectionStates() {
    return Array.from(this.clients.values()).map((client) => client.getState());
  }
  /**
   * Get statistics about the connection manager
   */
  getStats() {
    const servers = Array.from(this.clients.entries()).map(([serverId, client]) => ({
      serverId,
      status: client.getState().status,
      toolCount: client.getTools().length
    }));
    return {
      initialized: this.initialized,
      serverCount: this.clients.size,
      readyCount: servers.filter((s) => s.status === "ready").length,
      toolCount: this.allTools.length,
      servers
    };
  }
  /**
   * Disconnect from all servers
   */
  disconnectAll() {
    managerLogger.info("Disconnecting all MCP servers");
    for (const [serverId, client] of this.clients) {
      client.disconnect();
    }
    this.clients.clear();
    this.toolIndex.clear();
    this.allTools = [];
  }
  /**
   * Check if any servers are connected and ready
   */
  hasReadyServers() {
    for (const client of this.clients.values()) {
      if (client.isReady()) {
        return true;
      }
    }
    return false;
  }
  /**
   * Attempt to reconnect disconnected servers
   */
  async reconnectDisconnected() {
    for (const [serverId, client] of this.clients) {
      const state = client.getState();
      if (state.status === "error" || state.status === "disconnected") {
        if (this.config.maxReconnectAttempts === 0 || state.reconnectAttempts < this.config.maxReconnectAttempts) {
          managerLogger.info("Attempting reconnection", {
            serverId,
            attempt: state.reconnectAttempts + 1
          });
          try {
            await client.connect();
            await client.discoverTools();
            await this.rebuildToolIndex();
          } catch (error) {
            managerLogger.warn("Reconnection failed", {
              serverId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    }
  }
};
var connectionManager = new MCPConnectionManager();

// index.ts
var pluginLogger = logger.child({ module: "qtap-plugin-mcp" });
function parseConfig(toolConfig) {
  return {
    servers: typeof toolConfig.servers === "string" ? toolConfig.servers : "[]",
    discoveryTimeout: typeof toolConfig.discoveryTimeout === "number" ? toolConfig.discoveryTimeout : 30,
    autoReconnect: toolConfig.autoReconnect !== false,
    maxReconnectAttempts: typeof toolConfig.maxReconnectAttempts === "number" ? toolConfig.maxReconnectAttempts : 3
  };
}
function hasValidConfiguration(toolConfig) {
  const serversJson = typeof toolConfig.servers === "string" ? toolConfig.servers : "[]";
  const { servers, errors } = parseServerConfigs(serversJson);
  if (errors.length > 0) {
    pluginLogger.debug("Configuration validation errors", { errors });
  }
  const enabledServers = servers.filter((s) => s.enabled);
  return enabledServers.length > 0;
}
var initialized = false;
async function ensureInitialized(toolConfig) {
  if (initialized) return;
  const config = parseConfig(toolConfig);
  pluginLogger.info("Initializing MCP plugin", {
    hasServers: config.servers !== "[]"
  });
  try {
    await connectionManager.initialize(config);
    initialized = true;
    const stats = connectionManager.getStats();
    pluginLogger.info("MCP plugin initialized", {
      serverCount: stats.serverCount,
      readyCount: stats.readyCount,
      toolCount: stats.toolCount
    });
  } catch (error) {
    pluginLogger.error("Failed to initialize MCP plugin", {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
var metadata = {
  toolName: "mcp_connector",
  displayName: "MCP Server Connector",
  description: "Connects to MCP servers and exposes their tools to LLMs",
  category: "integration"
};
var placeholderToolDefinition = {
  type: "function",
  function: {
    name: "mcp_connector",
    description: "MCP Server Connector - this tool provides access to tools from connected MCP servers",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  }
};
var plugin = {
  metadata,
  /**
   * Get the placeholder tool definition
   * (Not used - getMultipleToolDefinitions takes precedence)
   */
  getToolDefinition() {
    return placeholderToolDefinition;
  },
  /**
   * Get all tool definitions from connected MCP servers
   *
   * This is called by the tool registry to get all available tools.
   * Each MCP tool is exposed as a separate tool with the naming convention:
   * mcp_{servername}_{toolname}
   */
  getMultipleToolDefinitions() {
    const tools = connectionManager.getAllToolDefinitions();
    pluginLogger.debug("Getting multiple tool definitions", {
      toolCount: tools.length
    });
    return tools;
  },
  /**
   * Validate input for any MCP tool
   *
   * Basic validation - detailed validation happens on the MCP server.
   */
  validateInput(input) {
    return typeof input === "object" && input !== null;
  },
  /**
   * Execute the placeholder tool (not used for multi-tool plugins)
   */
  async execute(_input, _context) {
    return {
      success: false,
      error: "This is a multi-tool plugin. Use specific MCP tools like mcp_servername_toolname instead."
    };
  },
  /**
   * Execute a specific tool by name
   *
   * Routes the execution to the appropriate MCP server based on the tool name prefix.
   */
  async executeByName(toolName, input, context) {
    await ensureInitialized(context.toolConfig);
    pluginLogger.debug("Executing MCP tool", {
      toolName,
      userId: context.userId,
      chatId: context.chatId
    });
    const result = await connectionManager.executeTool(toolName, input);
    pluginLogger.debug("MCP tool execution complete", {
      toolName,
      success: result.success,
      serverId: result.serverId,
      executionTimeMs: result.executionTimeMs
    });
    return {
      success: result.success,
      result: result.content,
      error: result.error,
      formattedText: result.content,
      metadata: {
        serverId: result.serverId,
        originalToolName: result.originalToolName,
        executionTimeMs: result.executionTimeMs
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
    if (result.error) {
      return `Error: ${result.error}`;
    }
    if (result.result !== void 0) {
      return typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2);
    }
    return "";
  },
  /**
   * Check if the plugin is properly configured
   *
   * Requires at least one enabled MCP server with valid configuration.
   */
  isConfigured(config) {
    const isConfigured = hasValidConfiguration(config);
    pluginLogger.debug("Checking configuration", {
      isConfigured
    });
    return isConfigured;
  },
  /**
   * Get default configuration
   */
  getDefaultConfig() {
    return {
      servers: "[]",
      discoveryTimeout: 30,
      autoReconnect: true,
      maxReconnectAttempts: 3
    };
  },
  /**
   * Handle configuration changes
   *
   * Reconfigures server connections when user settings change.
   */
  async onConfigurationChange(config) {
    pluginLogger.info("Configuration changed, reconfiguring");
    const parsedConfig = parseConfig(config);
    try {
      await connectionManager.reconfigure(parsedConfig.servers || "[]");
      const stats = connectionManager.getStats();
      pluginLogger.info("Reconfiguration complete", {
        serverCount: stats.serverCount,
        readyCount: stats.readyCount,
        toolCount: stats.toolCount
      });
    } catch (error) {
      pluginLogger.error("Reconfiguration failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
};
var index_default = { plugin };
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
