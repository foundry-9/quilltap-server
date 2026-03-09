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

// provider.ts
var import_plugin_utils = require("@quilltap/plugin-utils");

// index.ts
var import_plugin_utils2 = require("@quilltap/plugin-utils");
var import_tools = require("@quilltap/plugin-utils/tools");
var logger = (0, import_plugin_utils2.createPluginLogger)("qtap-plugin-openai-compatible");
var metadata = {
  providerName: "OPENAI_COMPATIBLE",
  displayName: "OpenAI-Compatible",
  description: "OpenAI-compatible API provider for local and remote LLM services",
  colors: {
    bg: "bg-slate-100",
    text: "text-slate-800",
    icon: "text-slate-600"
  },
  abbreviation: "OAC"
};
var config = {
  requiresApiKey: false,
  requiresBaseUrl: true,
  apiKeyLabel: "API Key (optional)",
  baseUrlLabel: "Base URL",
  baseUrlPlaceholder: "http://localhost:8080/v1",
  baseUrlDefault: "http://localhost:8080/v1"
};
var capabilities = {
  chat: true,
  imageGeneration: false,
  embeddings: false,
  webSearch: false,
  toolUse: false
};
var attachmentSupport = {
  supportsAttachments: false,
  supportedMimeTypes: [],
  description: "File attachments are not supported. Attachment support varies by implementation.",
  notes: "Some compatible implementations may support attachments; this is a conservative default."
};
var messageFormat = {
  supportsNameField: true,
  supportedRoles: ["user", "assistant"],
  maxNameLength: 64
};
var cheapModels = {
  defaultModel: "gpt-4o-mini",
  recommendedModels: ["gpt-4o-mini", "gpt-3.5-turbo"]
};
var plugin = {
  metadata,
  icon: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M8 2v6H6v3c0 2.2 1.8 4 4 4v5h4v-5c2.2 0 4-1.8 4-4V8h-2V2h-2v6h-4V2H8z", fill: "currentColor" }
    ]
  },
  config,
  capabilities,
  attachmentSupport,
  // Runtime configuration
  messageFormat,
  charsPerToken: 3.5,
  toolFormat: "openai",
  cheapModels,
  defaultContextWindow: 8192,
  // Conservative default for unknown implementations
  /**
   * Factory method to create an OpenAI-compatible LLM provider instance
   * IMPORTANT: baseUrl is REQUIRED for this provider
   */
  createProvider: (baseUrl) => {
    if (!baseUrl) {
      const defaultUrl = "http://localhost:8080/v1";
      logger.warn("No baseUrl provided for OpenAI-compatible provider, using default", {
        context: "plugin.createProvider",
        defaultUrl
      });
    }
    const url = baseUrl || "http://localhost:8080/v1";
    return new import_plugin_utils.OpenAICompatibleProvider(url);
  },
  /**
   * Get list of available models from the compatible API
   * Requires a valid base URL and optional API key
   */
  getAvailableModels: async (apiKey, baseUrl) => {
    try {
      const url = baseUrl || "http://localhost:8080/v1";
      const provider = new import_plugin_utils.OpenAICompatibleProvider(url);
      const models = await provider.getAvailableModels(apiKey);
      return models;
    } catch (error) {
      logger.error(
        "Failed to fetch OpenAI-compatible models",
        { context: "plugin.getAvailableModels", baseUrl },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Validate an OpenAI-compatible API connection
   */
  validateApiKey: async (apiKey, baseUrl) => {
    try {
      const url = baseUrl || "http://localhost:8080/v1";
      const provider = new import_plugin_utils.OpenAICompatibleProvider(url);
      const isValid = await provider.validateApiKey(apiKey);
      return isValid;
    } catch (error) {
      logger.error(
        "Error validating OpenAI-compatible API connection",
        { context: "plugin.validateApiKey", baseUrl },
        error instanceof Error ? error : void 0
      );
      return false;
    }
  },
  /**
   * Get static model information
   * Returns generic information applicable to most compatible implementations
   */
  getModelInfo: () => {
    return [
      {
        id: "default",
        name: "Default Model",
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false
      }
    ];
  },
  /**
   * Render the OpenAI-compatible icon
   */
  /**
   * Format tools from OpenAI format to OpenAI format
   * OpenAI-compatible providers use OpenAI format, with Grok constraints applied if needed
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in OpenAI format
   */
  formatTools: (tools) => {
    try {
      const formattedTools = [];
      for (const tool of tools) {
        if (!("function" in tool)) {
          logger.warn("Skipping tool with invalid format", {
            context: "plugin.formatTools"
          });
          continue;
        }
        formattedTools.push(tool);
      }
      return formattedTools;
    } catch (error) {
      logger.error(
        "Error formatting tools for OpenAI-compatible",
        { context: "plugin.formatTools" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Parse tool calls from OpenAI-compatible response format
   * Extracts tool calls from OpenAI-compatible API responses (OpenAI format)
   *
   * @param response OpenAI-compatible API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response) => {
    try {
      const toolCalls = (0, import_plugin_utils2.parseOpenAIToolCalls)(response);
      return toolCalls;
    } catch (error) {
      logger.error(
        "Error parsing tool calls from OpenAI-compatible response",
        { context: "plugin.parseToolCalls" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Detect spontaneous XML tool call markers in OpenAI-compatible text responses
   * Checks all XML formats since unknown endpoints are unpredictable
   */
  hasTextToolMarkers(text) {
    return (0, import_tools.hasAnyXMLToolMarkers)(text);
  },
  /**
   * Parse spontaneous XML tool calls from OpenAI-compatible text responses
   */
  parseTextToolCalls(text) {
    try {
      const results = (0, import_tools.parseAllXMLAsToolCalls)(text);
      if (results.length > 0) {
        logger.debug("Detected spontaneous XML tool calls in OpenAI-compatible response", {
          context: "openai-compatible.parseTextToolCalls",
          count: results.length,
          tools: results.map((r) => r.name)
        });
      }
      return results;
    } catch (error) {
      logger.error(
        "Error parsing text tool calls",
        { context: "openai-compatible.parseTextToolCalls" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Strip spontaneous XML tool call markers from OpenAI-compatible text responses
   */
  stripTextToolMarkers(text) {
    return (0, import_tools.stripAllXMLToolMarkers)(text);
  }
};
var index_default = plugin;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
