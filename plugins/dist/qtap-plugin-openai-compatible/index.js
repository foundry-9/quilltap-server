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

// icon.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function OpenAICompatibleIcon({ className = "h-5 w-5" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      className: `text-slate-600 ${className}`,
      fill: "currentColor",
      viewBox: "0 0 24 24",
      xmlns: "http://www.w3.org/2000/svg",
      "data-testid": "openai-compatible-icon",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "11", fill: "none", stroke: "currentColor", strokeWidth: "2" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "path",
          {
            d: "M12 2A10 10 0 1 1 2 12A10 10 0 0 1 12 2Z",
            fill: "currentColor",
            opacity: "0.1"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "text",
          {
            x: "50%",
            y: "50%",
            textAnchor: "middle",
            dominantBaseline: "middle",
            fill: "currentColor",
            fontSize: "9",
            fontWeight: "bold",
            fontFamily: "system-ui, -apple-system, sans-serif",
            children: "OAC"
          }
        )
      ]
    }
  );
}

// index.ts
var import_plugin_utils2 = require("@quilltap/plugin-utils");
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
  webSearch: false
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
    logger.debug("Creating OpenAI-compatible provider instance", {
      context: "plugin.createProvider",
      baseUrl: url
    });
    return new import_plugin_utils.OpenAICompatibleProvider(url);
  },
  /**
   * Get list of available models from the compatible API
   * Requires a valid base URL and optional API key
   */
  getAvailableModels: async (apiKey, baseUrl) => {
    logger.debug("Fetching available OpenAI-compatible models", {
      context: "plugin.getAvailableModels",
      baseUrl
    });
    try {
      const url = baseUrl || "http://localhost:8080/v1";
      const provider = new import_plugin_utils.OpenAICompatibleProvider(url);
      const models = await provider.getAvailableModels(apiKey);
      logger.debug("Successfully fetched OpenAI-compatible models", {
        context: "plugin.getAvailableModels",
        count: models.length
      });
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
    logger.debug("Validating OpenAI-compatible API connection", {
      context: "plugin.validateApiKey",
      baseUrl
    });
    try {
      const url = baseUrl || "http://localhost:8080/v1";
      const provider = new import_plugin_utils.OpenAICompatibleProvider(url);
      const isValid = await provider.validateApiKey(apiKey);
      logger.debug("OpenAI-compatible API validation result", {
        context: "plugin.validateApiKey",
        isValid
      });
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
  renderIcon: (props) => {
    logger.debug("Rendering OpenAI-compatible icon", {
      context: "plugin.renderIcon",
      className: props.className
    });
    return OpenAICompatibleIcon(props);
  },
  /**
   * Format tools from OpenAI format to OpenAI format
   * OpenAI-compatible providers use OpenAI format, with Grok constraints applied if needed
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in OpenAI format
   */
  formatTools: (tools) => {
    logger.debug("Formatting tools for OpenAI-compatible provider", {
      context: "plugin.formatTools",
      toolCount: tools.length
    });
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
      logger.debug("Successfully formatted tools", {
        context: "plugin.formatTools",
        count: formattedTools.length
      });
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
    logger.debug("Parsing tool calls from OpenAI-compatible response", {
      context: "plugin.parseToolCalls"
    });
    try {
      const toolCalls = (0, import_plugin_utils2.parseOpenAIToolCalls)(response);
      logger.debug("Successfully parsed tool calls", {
        context: "plugin.parseToolCalls",
        count: toolCalls.length
      });
      return toolCalls;
    } catch (error) {
      logger.error(
        "Error parsing tool calls from OpenAI-compatible response",
        { context: "plugin.parseToolCalls" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  }
};
var index_default = plugin;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
