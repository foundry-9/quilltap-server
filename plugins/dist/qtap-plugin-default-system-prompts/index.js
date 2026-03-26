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
var import_plugin_utils = require("@quilltap/plugin-utils");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function parsePromptFilename(filename) {
  const baseName = filename.replace(/\.md$/i, "");
  const parts = baseName.split("_");
  if (parts.length < 2) {
    return { modelHint: baseName, category: "GENERAL" };
  }
  const category = parts.pop();
  const modelHint = parts.join("_");
  return { modelHint, category };
}
function loadPrompts() {
  const promptsDir = (0, import_node_path.join)((0, import_node_path.dirname)(__filename), "prompts");
  const files = (0, import_node_fs.readdirSync)(promptsDir).filter((f) => f.endsWith(".md")).sort();
  const prompts = [];
  for (const file of files) {
    const content = (0, import_node_fs.readFileSync)((0, import_node_path.join)(promptsDir, file), "utf-8");
    const name = file.replace(/\.md$/i, "");
    const { modelHint, category } = parsePromptFilename(file);
    prompts.push({ name, content, modelHint, category });
  }
  return prompts;
}
var plugin = (0, import_plugin_utils.createSystemPromptPlugin)({
  metadata: {
    pluginId: "default-system-prompts",
    displayName: "Default System Prompts",
    description: "Built-in system prompt templates for various LLM models in companion and romantic categories",
    version: "1.1.0"
  },
  prompts: loadPrompts()
});
var pluginExport = { plugin };
var index_default = pluginExport;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
