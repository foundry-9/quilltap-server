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
  initialize: () => initialize,
  metadata: () => metadata,
  plugin: () => plugin
});
module.exports = __toCommonJS(index_exports);
var import_plugin_utils = require("@quilltap/plugin-utils");
var QUILLTAP_RP_SYSTEM_PROMPT = `[SYSTEM INSTRUCTION: INTERACTION FORMATTING PROTOCOL]
You must adhere to the following custom syntax for all outputs. Do NOT use standard roleplay formatting.

1. SPOKEN DIALOGUE: Write as bare text. Do NOT use quotation marks.
   - Example: Put the gun down, John.
   - Markdown Italics (*text*) denote VOCAL EMPHASIS only, never action.

2. ACTION & NARRATION: Enclose all physical movements, facial expressions, and environmental descriptions in SQUARE BRACKETS [ ].
   - Example: [I lean back in the chair, crossing my arms.]

3. INTERNAL MONOLOGUE: Enclose private thoughts and feelings in CURLY BRACES { }.
   - Example: {He's lying to me. I can feel it.}

4. META/OOC: Any Out-of-Character comments or instructions must start with "// ".
   - Example: // The user is simulating a high-gravity environment now.

5. STRICT COMPLIANCE: You must mirror this formatting in your responses. Never use asterisks for actions.`;
var plugin = (0, import_plugin_utils.createSingleTemplatePlugin)({
  templateId: "quilltap-rp",
  displayName: "Quilltap RP",
  description: "Custom formatting protocol with dialogue as bare text, actions in [brackets], thoughts in {braces}, and OOC with // prefix.",
  systemPrompt: QUILLTAP_RP_SYSTEM_PROMPT,
  author: {
    name: "Foundry-9 LLC",
    email: "charles.sebold@foundry-9.com",
    url: "https://foundry-9.com"
  },
  tags: ["quilltap", "custom", "brackets", "braces"],
  narrationDelimiters: ["[", "]"],
  version: "1.0.5",
  enableLogging: true
});
function initialize() {
  return plugin.initialize?.();
}
var metadata = {
  name: "qtap-plugin-template-quilltap-rp",
  version: "1.0.5",
  type: "ROLEPLAY_TEMPLATE"
};
var pluginExport = { plugin, initialize, metadata };
var index_default = pluginExport;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  initialize,
  metadata,
  plugin
});
