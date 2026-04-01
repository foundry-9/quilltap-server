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
  plugin: () => plugin
});
module.exports = __toCommonJS(index_exports);
var SERPER_API_URL = "https://google.serper.dev/search";
var plugin = {
  metadata: {
    providerName: "SERPER",
    displayName: "Serper Web Search",
    description: "Google search results via the Serper.dev API",
    abbreviation: "SRP",
    colors: {
      bg: "bg-orange-100",
      text: "text-orange-800",
      icon: "text-orange-600"
    }
  },
  config: {
    requiresApiKey: true,
    apiKeyLabel: "Serper API Key",
    requiresBaseUrl: false
  },
  /**
   * Execute a web search using the Serper.dev API
   */
  async executeSearch(query, maxResults, apiKey, _baseUrl) {
    try {
      const response = await fetch(SERPER_API_URL, {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          q: query,
          num: maxResults
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401 || response.status === 403) {
          return {
            success: false,
            error: "Invalid Serper API key. Please check your API key in Settings > API Keys.",
            totalFound: 0,
            query
          };
        }
        if (response.status === 429) {
          return {
            success: false,
            error: "Serper API rate limit exceeded. Please try again later or upgrade your plan at serper.dev.",
            totalFound: 0,
            query
          };
        }
        return {
          success: false,
          error: `Serper API error: ${response.status} ${response.statusText} - ${errorText}`,
          totalFound: 0,
          query
        };
      }
      const data = await response.json();
      const results = (data.organic ?? []).map((result) => ({
        title: result.title,
        url: result.link,
        snippet: result.snippet,
        publishedDate: result.date
      }));
      const kg = data.knowledgeGraph;
      if (kg?.description && results.length < maxResults) {
        results.unshift({
          title: kg.title ?? "Knowledge Graph",
          url: kg.source?.link ?? "",
          snippet: kg.description
        });
      }
      return {
        success: true,
        results,
        totalFound: results.length,
        query
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error during Serper web search",
        totalFound: 0,
        query
      };
    }
  },
  /**
   * Format search results for LLM context
   */
  formatResults(results) {
    if (results.length === 0) {
      return "No search results found.";
    }
    const formatted = results.map((result, index) => {
      const dateStr = result.publishedDate ? ` (Published: ${new Date(result.publishedDate).toLocaleDateString()})` : "";
      return `[Result ${index + 1}]${dateStr}
Title: ${result.title}
URL: ${result.url}
Summary: ${result.snippet}`;
    });
    return `Found ${results.length} search results:

${formatted.join("\n\n")}`;
  },
  /**
   * Validate a Serper API key by making a minimal search request
   */
  async validateApiKey(apiKey, _baseUrl) {
    try {
      const response = await fetch(SERPER_API_URL, {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          q: "test",
          num: 1
        })
      });
      return response.ok;
    } catch {
      return false;
    }
  },
  icon: {
    viewBox: "0 0 24 24",
    paths: [
      {
        d: "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
        fill: "currentColor"
      }
    ]
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
