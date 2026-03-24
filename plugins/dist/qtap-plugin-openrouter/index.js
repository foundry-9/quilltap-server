"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default,
  plugin: () => plugin
});
module.exports = __toCommonJS(index_exports);

// node_modules/@openrouter/sdk/esm/models/openresponseseasyinputmessage.js
var z8 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/lib/primitives.js
function remap(inp, mappings) {
  let out = {};
  if (!Object.keys(mappings).length) {
    out = inp;
    return out;
  }
  for (const [k, v] of Object.entries(inp)) {
    const j = mappings[k];
    if (j === null) {
      continue;
    }
    out[j ?? k] = v;
  }
  return out;
}
function compactMap(values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== "undefined") {
      out[k] = v;
    }
  }
  return out;
}

// node_modules/@openrouter/sdk/esm/types/enums.js
var z = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/types/unrecognized.js
function unrecognized(value) {
  globalCount++;
  return value;
}
var globalCount = 0;

// node_modules/@openrouter/sdk/esm/types/enums.js
function inboundSchema(enumObj) {
  const options = Object.values(enumObj);
  return z.union([
    ...options.map((x) => z.literal(x)),
    z.string().transform((x) => unrecognized(x))
  ]);
}
function inboundSchemaInt(enumObj) {
  const options = Object.values(enumObj).filter((v) => typeof v === "number");
  return z.union([
    ...options.map((x) => z.literal(x)),
    z.int().transform((x) => unrecognized(x))
  ]);
}
function outboundSchema(_) {
  return z.string();
}
function outboundSchemaInt(_) {
  return z.int();
}

// node_modules/@openrouter/sdk/esm/models/responseinputaudio.js
var z4 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/lib/schemas.js
var z3 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/errors/sdkvalidationerror.js
var z2 = __toESM(require("zod/v4/core"), 1);
var SDKValidationError = class extends Error {
  // Allows for backwards compatibility for `instanceof` checks of `ResponseValidationError`
  static [Symbol.hasInstance](instance) {
    if (!(instance instanceof Error))
      return false;
    if (!("rawValue" in instance))
      return false;
    if (!("rawMessage" in instance))
      return false;
    if (!("pretty" in instance))
      return false;
    if (typeof instance.pretty !== "function")
      return false;
    return true;
  }
  constructor(message, cause, rawValue) {
    super(`${message}: ${cause}`);
    this.name = "SDKValidationError";
    this.cause = cause;
    this.rawValue = rawValue;
    this.rawMessage = message;
  }
  /**
   * Return a pretty-formatted error message if the underlying validation error
   * is a ZodError or some other recognized error type, otherwise return the
   * default error message.
   */
  pretty() {
    if (this.cause instanceof z2.$ZodError) {
      return `${this.rawMessage}
${formatZodError(this.cause)}`;
    } else {
      return this.toString();
    }
  }
};
function formatZodError(err) {
  return z2.prettifyError(err);
}

// node_modules/@openrouter/sdk/esm/types/fp.js
function OK(value) {
  return { ok: true, value };
}
function ERR(error) {
  return { ok: false, error };
}
async function unwrapAsync(pr) {
  const r = await pr;
  if (!r.ok) {
    throw r.error;
  }
  return r.value;
}

// node_modules/@openrouter/sdk/esm/lib/schemas.js
function safeParse(rawValue, fn, errorMessage) {
  try {
    return OK(fn(rawValue));
  } catch (err) {
    return ERR(new SDKValidationError(errorMessage, err, rawValue));
  }
}

// node_modules/@openrouter/sdk/esm/models/responseinputaudio.js
var ResponseInputAudioFormat = {
  Mp3: "mp3",
  Wav: "wav"
};
var ResponseInputAudioFormat$inboundSchema = inboundSchema(ResponseInputAudioFormat);
var ResponseInputAudioFormat$outboundSchema = outboundSchema(ResponseInputAudioFormat);
var ResponseInputAudioInputAudio$inboundSchema = z4.object({
  data: z4.string(),
  format: ResponseInputAudioFormat$inboundSchema
});
var ResponseInputAudioInputAudio$outboundSchema = z4.object({
  data: z4.string(),
  format: ResponseInputAudioFormat$outboundSchema
});
var ResponseInputAudio$inboundSchema = z4.object({
  type: z4.literal("input_audio"),
  input_audio: z4.lazy(() => ResponseInputAudioInputAudio$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "input_audio": "inputAudio"
  });
});
var ResponseInputAudio$outboundSchema = z4.object({
  type: z4.literal("input_audio"),
  inputAudio: z4.lazy(() => ResponseInputAudioInputAudio$outboundSchema)
}).transform((v) => {
  return remap(v, {
    inputAudio: "input_audio"
  });
});

// node_modules/@openrouter/sdk/esm/models/responseinputfile.js
var z5 = __toESM(require("zod/v4"), 1);
var ResponseInputFile$inboundSchema = z5.object({
  type: z5.literal("input_file"),
  file_id: z5.nullable(z5.string()).optional(),
  file_data: z5.string().optional(),
  filename: z5.string().optional(),
  file_url: z5.string().optional()
}).transform((v) => {
  return remap(v, {
    "file_id": "fileId",
    "file_data": "fileData",
    "file_url": "fileUrl"
  });
});
var ResponseInputFile$outboundSchema = z5.object({
  type: z5.literal("input_file"),
  fileId: z5.nullable(z5.string()).optional(),
  fileData: z5.string().optional(),
  filename: z5.string().optional(),
  fileUrl: z5.string().optional()
}).transform((v) => {
  return remap(v, {
    fileId: "file_id",
    fileData: "file_data",
    fileUrl: "file_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/responseinputtext.js
var z6 = __toESM(require("zod/v4"), 1);
var ResponseInputText$inboundSchema = z6.object({
  type: z6.literal("input_text"),
  text: z6.string()
});
var ResponseInputText$outboundSchema = z6.object({
  type: z6.literal("input_text"),
  text: z6.string()
});

// node_modules/@openrouter/sdk/esm/models/responseinputvideo.js
var z7 = __toESM(require("zod/v4"), 1);
var ResponseInputVideo$outboundSchema = z7.object({
  type: z7.literal("input_video"),
  videoUrl: z7.string()
}).transform((v) => {
  return remap(v, {
    videoUrl: "video_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponseseasyinputmessage.js
var OpenResponsesEasyInputMessageTypeMessage = {
  Message: "message"
};
var OpenResponsesEasyInputMessageRoleDeveloper = {
  Developer: "developer"
};
var OpenResponsesEasyInputMessageRoleAssistant = {
  Assistant: "assistant"
};
var OpenResponsesEasyInputMessageRoleSystem = {
  System: "system"
};
var OpenResponsesEasyInputMessageRoleUser = {
  User: "user"
};
var OpenResponsesEasyInputMessageDetail = {
  Auto: "auto",
  High: "high",
  Low: "low"
};
var OpenResponsesEasyInputMessageTypeMessage$outboundSchema = z8.enum(OpenResponsesEasyInputMessageTypeMessage);
var OpenResponsesEasyInputMessageRoleDeveloper$outboundSchema = z8.enum(OpenResponsesEasyInputMessageRoleDeveloper);
var OpenResponsesEasyInputMessageRoleAssistant$outboundSchema = z8.enum(OpenResponsesEasyInputMessageRoleAssistant);
var OpenResponsesEasyInputMessageRoleSystem$outboundSchema = z8.enum(OpenResponsesEasyInputMessageRoleSystem);
var OpenResponsesEasyInputMessageRoleUser$outboundSchema = z8.enum(OpenResponsesEasyInputMessageRoleUser);
var OpenResponsesEasyInputMessageRoleUnion$outboundSchema = z8.union([
  OpenResponsesEasyInputMessageRoleUser$outboundSchema,
  OpenResponsesEasyInputMessageRoleSystem$outboundSchema,
  OpenResponsesEasyInputMessageRoleAssistant$outboundSchema,
  OpenResponsesEasyInputMessageRoleDeveloper$outboundSchema
]);
var OpenResponsesEasyInputMessageDetail$outboundSchema = outboundSchema(OpenResponsesEasyInputMessageDetail);
var OpenResponsesEasyInputMessageContentInputImage$outboundSchema = z8.object({
  type: z8.literal("input_image"),
  detail: OpenResponsesEasyInputMessageDetail$outboundSchema,
  imageUrl: z8.nullable(z8.string()).optional()
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});
var OpenResponsesEasyInputMessageContentUnion1$outboundSchema = z8.union([
  ResponseInputText$outboundSchema,
  z8.lazy(() => OpenResponsesEasyInputMessageContentInputImage$outboundSchema),
  ResponseInputFile$outboundSchema,
  ResponseInputAudio$outboundSchema,
  ResponseInputVideo$outboundSchema
]);
var OpenResponsesEasyInputMessageContentUnion2$outboundSchema = z8.union([
  z8.array(z8.union([
    ResponseInputText$outboundSchema,
    z8.lazy(() => OpenResponsesEasyInputMessageContentInputImage$outboundSchema),
    ResponseInputFile$outboundSchema,
    ResponseInputAudio$outboundSchema,
    ResponseInputVideo$outboundSchema
  ])),
  z8.string()
]);
var OpenResponsesEasyInputMessage$outboundSchema = z8.object({
  type: OpenResponsesEasyInputMessageTypeMessage$outboundSchema.optional(),
  role: z8.union([
    OpenResponsesEasyInputMessageRoleUser$outboundSchema,
    OpenResponsesEasyInputMessageRoleSystem$outboundSchema,
    OpenResponsesEasyInputMessageRoleAssistant$outboundSchema,
    OpenResponsesEasyInputMessageRoleDeveloper$outboundSchema
  ]),
  content: z8.union([
    z8.array(z8.union([
      ResponseInputText$outboundSchema,
      z8.lazy(() => OpenResponsesEasyInputMessageContentInputImage$outboundSchema),
      ResponseInputFile$outboundSchema,
      ResponseInputAudio$outboundSchema,
      ResponseInputVideo$outboundSchema
    ])),
    z8.string()
  ])
});

// node_modules/@openrouter/sdk/esm/models/openresponsesfunctioncalloutput.js
var z9 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/toolcallstatus.js
var ToolCallStatus = {
  InProgress: "in_progress",
  Completed: "completed",
  Incomplete: "incomplete"
};
var ToolCallStatus$inboundSchema = inboundSchema(ToolCallStatus);
var ToolCallStatus$outboundSchema = outboundSchema(ToolCallStatus);

// node_modules/@openrouter/sdk/esm/models/openresponsesfunctioncalloutput.js
var OpenResponsesFunctionCallOutputType = {
  FunctionCallOutput: "function_call_output"
};
var OpenResponsesFunctionCallOutputType$outboundSchema = z9.enum(OpenResponsesFunctionCallOutputType);
var OpenResponsesFunctionCallOutput$outboundSchema = z9.object({
  type: OpenResponsesFunctionCallOutputType$outboundSchema,
  id: z9.nullable(z9.string()).optional(),
  callId: z9.string(),
  output: z9.string(),
  status: z9.nullable(ToolCallStatus$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    callId: "call_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesinputmessageitem.js
var z10 = __toESM(require("zod/v4"), 1);
var OpenResponsesInputMessageItemTypeMessage = {
  Message: "message"
};
var OpenResponsesInputMessageItemRoleDeveloper = {
  Developer: "developer"
};
var OpenResponsesInputMessageItemRoleSystem = {
  System: "system"
};
var OpenResponsesInputMessageItemRoleUser = {
  User: "user"
};
var OpenResponsesInputMessageItemDetail = {
  Auto: "auto",
  High: "high",
  Low: "low"
};
var OpenResponsesInputMessageItemTypeMessage$outboundSchema = z10.enum(OpenResponsesInputMessageItemTypeMessage);
var OpenResponsesInputMessageItemRoleDeveloper$outboundSchema = z10.enum(OpenResponsesInputMessageItemRoleDeveloper);
var OpenResponsesInputMessageItemRoleSystem$outboundSchema = z10.enum(OpenResponsesInputMessageItemRoleSystem);
var OpenResponsesInputMessageItemRoleUser$outboundSchema = z10.enum(OpenResponsesInputMessageItemRoleUser);
var OpenResponsesInputMessageItemRoleUnion$outboundSchema = z10.union([
  OpenResponsesInputMessageItemRoleUser$outboundSchema,
  OpenResponsesInputMessageItemRoleSystem$outboundSchema,
  OpenResponsesInputMessageItemRoleDeveloper$outboundSchema
]);
var OpenResponsesInputMessageItemDetail$outboundSchema = outboundSchema(OpenResponsesInputMessageItemDetail);
var OpenResponsesInputMessageItemContentInputImage$outboundSchema = z10.object({
  type: z10.literal("input_image"),
  detail: OpenResponsesInputMessageItemDetail$outboundSchema,
  imageUrl: z10.nullable(z10.string()).optional()
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});
var OpenResponsesInputMessageItemContentUnion$outboundSchema = z10.union([
  ResponseInputText$outboundSchema,
  z10.lazy(() => OpenResponsesInputMessageItemContentInputImage$outboundSchema),
  ResponseInputFile$outboundSchema,
  ResponseInputAudio$outboundSchema,
  ResponseInputVideo$outboundSchema
]);
var OpenResponsesInputMessageItem$outboundSchema = z10.object({
  id: z10.string().optional(),
  type: OpenResponsesInputMessageItemTypeMessage$outboundSchema.optional(),
  role: z10.union([
    OpenResponsesInputMessageItemRoleUser$outboundSchema,
    OpenResponsesInputMessageItemRoleSystem$outboundSchema,
    OpenResponsesInputMessageItemRoleDeveloper$outboundSchema
  ]),
  content: z10.array(z10.union([
    ResponseInputText$outboundSchema,
    z10.lazy(() => OpenResponsesInputMessageItemContentInputImage$outboundSchema),
    ResponseInputFile$outboundSchema,
    ResponseInputAudio$outboundSchema,
    ResponseInputVideo$outboundSchema
  ]))
});

// node_modules/@openrouter/sdk/esm/lib/stream-type-guards.js
function isOutputTextDeltaEvent(event) {
  return "type" in event && event.type === "response.output_text.delta";
}
function isReasoningDeltaEvent(event) {
  return "type" in event && event.type === "response.reasoning_text.delta";
}
function isFunctionCallArgumentsDeltaEvent(event) {
  return "type" in event && event.type === "response.function_call_arguments.delta";
}
function isOutputItemAddedEvent(event) {
  return "type" in event && event.type === "response.output_item.added";
}
function isOutputItemDoneEvent(event) {
  return "type" in event && event.type === "response.output_item.done";
}
function isResponseCompletedEvent(event) {
  return "type" in event && event.type === "response.completed";
}
function isResponseFailedEvent(event) {
  return "type" in event && event.type === "response.failed";
}
function isResponseIncompleteEvent(event) {
  return "type" in event && event.type === "response.incomplete";
}
function isFunctionCallArgumentsDoneEvent(event) {
  return "type" in event && event.type === "response.function_call_arguments.done";
}
function isOutputMessage(item) {
  return typeof item === "object" && item !== null && "type" in item && item.type === "message";
}
function isFunctionCallItem(item) {
  return typeof item === "object" && item !== null && "type" in item && item.type === "function_call";
}
function isReasoningOutputItem(item) {
  return typeof item === "object" && item !== null && "type" in item && item.type === "reasoning";
}
function isWebSearchCallOutputItem(item) {
  return typeof item === "object" && item !== null && "type" in item && item.type === "web_search_call";
}
function isFileSearchCallOutputItem(item) {
  return typeof item === "object" && item !== null && "type" in item && item.type === "file_search_call";
}
function isImageGenerationCallOutputItem(item) {
  return typeof item === "object" && item !== null && "type" in item && item.type === "image_generation_call";
}
function hasTypeProperty(item) {
  return typeof item === "object" && item !== null && "type" in item && typeof item.type === "string";
}

// node_modules/@openrouter/sdk/esm/lib/stream-transformers.js
async function* extractTextDeltas(stream) {
  const consumer = stream.createConsumer();
  for await (const event of consumer) {
    if (isOutputTextDeltaEvent(event)) {
      if (event.delta) {
        yield event.delta;
      }
    }
  }
}
async function* extractReasoningDeltas(stream) {
  const consumer = stream.createConsumer();
  for await (const event of consumer) {
    if (isReasoningDeltaEvent(event)) {
      if (event.delta) {
        yield event.delta;
      }
    }
  }
}
async function* extractToolDeltas(stream) {
  const consumer = stream.createConsumer();
  for await (const event of consumer) {
    if (isFunctionCallArgumentsDeltaEvent(event)) {
      if (event.delta) {
        yield event.delta;
      }
    }
  }
}
async function* buildMessageStreamCore(stream) {
  const consumer = stream.createConsumer();
  let currentText = "";
  let currentId = "";
  let hasStarted = false;
  for await (const event of consumer) {
    if (!("type" in event)) {
      continue;
    }
    switch (event.type) {
      case "response.output_item.added": {
        if (isOutputItemAddedEvent(event)) {
          if (event.item && isOutputMessage(event.item)) {
            hasStarted = true;
            currentText = "";
            currentId = event.item.id;
          }
        }
        break;
      }
      case "response.output_text.delta": {
        if (isOutputTextDeltaEvent(event)) {
          if (hasStarted && event.delta) {
            currentText += event.delta;
            yield {
              type: "delta",
              text: currentText,
              messageId: currentId
            };
          }
        }
        break;
      }
      case "response.output_item.done": {
        if (isOutputItemDoneEvent(event)) {
          if (event.item && isOutputMessage(event.item)) {
            yield {
              type: "complete",
              completeMessage: event.item
            };
          }
        }
        break;
      }
      case "response.completed":
      case "response.failed":
      case "response.incomplete":
        return;
      default:
        break;
    }
  }
}
async function* buildResponsesMessageStream(stream) {
  for await (const update of buildMessageStreamCore(stream)) {
    if (update.type === "delta" && update.text !== void 0 && update.messageId !== void 0) {
      yield {
        id: update.messageId,
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [
          {
            type: "output_text",
            text: update.text,
            annotations: []
          }
        ]
      };
    } else if (update.type === "complete" && update.completeMessage) {
      yield update.completeMessage;
    }
  }
}
function handleOutputItemAdded(event, itemsInProgress) {
  if (!isOutputItemAddedEvent(event) || !event.item) {
    return void 0;
  }
  const item = event.item;
  if (isOutputMessage(item)) {
    itemsInProgress.set(item.id, {
      type: "message",
      id: item.id,
      textContent: ""
    });
    return {
      id: item.id,
      type: "message",
      role: "assistant",
      status: "in_progress",
      content: []
    };
  }
  if (isFunctionCallItem(item)) {
    const itemKey = item.id ?? item.callId;
    itemsInProgress.set(itemKey, {
      type: "function_call",
      id: itemKey,
      name: item.name,
      callId: item.callId,
      argumentsAccumulated: ""
    });
    return {
      type: "function_call",
      id: item.id,
      callId: item.callId,
      name: item.name,
      arguments: "",
      status: "in_progress"
    };
  }
  if (isReasoningOutputItem(item)) {
    itemsInProgress.set(item.id, {
      type: "reasoning",
      id: item.id,
      reasoningContent: ""
    });
    return {
      type: "reasoning",
      id: item.id,
      status: "in_progress",
      summary: []
    };
  }
  if (isWebSearchCallOutputItem(item)) {
    return item;
  }
  if (isFileSearchCallOutputItem(item)) {
    return item;
  }
  if (isImageGenerationCallOutputItem(item)) {
    return item;
  }
  return void 0;
}
function handleTextDelta(event, itemsInProgress) {
  if (!isOutputTextDeltaEvent(event) || !event.delta) {
    return void 0;
  }
  const item = itemsInProgress.get(event.itemId);
  if (item?.type === "message") {
    item.textContent += event.delta;
    return {
      id: item.id,
      type: "message",
      role: "assistant",
      status: "in_progress",
      content: [
        {
          type: "output_text",
          text: item.textContent,
          annotations: []
        }
      ]
    };
  }
  return void 0;
}
function handleFunctionCallDelta(event, itemsInProgress) {
  if (!isFunctionCallArgumentsDeltaEvent(event) || !event.delta) {
    return void 0;
  }
  const item = itemsInProgress.get(event.itemId);
  if (item?.type === "function_call") {
    item.argumentsAccumulated += event.delta;
    return {
      type: "function_call",
      // Include id if it differs from callId (means API provided an id)
      id: item.id !== item.callId ? item.id : void 0,
      callId: item.callId,
      name: item.name,
      arguments: item.argumentsAccumulated,
      status: "in_progress"
    };
  }
  return void 0;
}
function handleReasoningDelta(event, itemsInProgress) {
  if (!isReasoningDeltaEvent(event) || !event.delta) {
    return void 0;
  }
  const item = itemsInProgress.get(event.itemId);
  if (item?.type === "reasoning") {
    item.reasoningContent += event.delta;
    return {
      type: "reasoning",
      id: item.id,
      status: "in_progress",
      summary: [
        {
          type: "summary_text",
          text: item.reasoningContent
        }
      ]
    };
  }
  return void 0;
}
function handleOutputItemDone(event, itemsInProgress) {
  if (!isOutputItemDoneEvent(event) || !event.item) {
    return void 0;
  }
  const item = event.item;
  if (isOutputMessage(item)) {
    itemsInProgress.delete(item.id);
    return item;
  }
  if (isFunctionCallItem(item)) {
    itemsInProgress.delete(item.id ?? item.callId);
    return item;
  }
  if (isReasoningOutputItem(item)) {
    itemsInProgress.delete(item.id);
    return item;
  }
  if (isWebSearchCallOutputItem(item)) {
    return item;
  }
  if (isFileSearchCallOutputItem(item)) {
    return item;
  }
  if (isImageGenerationCallOutputItem(item)) {
    return item;
  }
  return void 0;
}
var itemsStreamHandlers = {
  "response.output_item.added": handleOutputItemAdded,
  "response.output_text.delta": handleTextDelta,
  "response.function_call_arguments.delta": handleFunctionCallDelta,
  "response.reasoning_text.delta": handleReasoningDelta,
  "response.output_item.done": handleOutputItemDone
};
var streamTerminationEvents = /* @__PURE__ */ new Set([
  "response.completed",
  "response.failed",
  "response.incomplete"
]);
async function* buildItemsStream(stream) {
  const consumer = stream.createConsumer();
  const itemsInProgress = /* @__PURE__ */ new Map();
  for await (const event of consumer) {
    if (!("type" in event)) {
      continue;
    }
    if (streamTerminationEvents.has(event.type)) {
      return;
    }
    const handler = itemsStreamHandlers[event.type];
    if (handler) {
      const result = handler(event, itemsInProgress);
      if (result) {
        yield result;
      }
    }
  }
}
async function consumeStreamForCompletion(stream) {
  const consumer = stream.createConsumer();
  for await (const event of consumer) {
    if (!("type" in event)) {
      continue;
    }
    if (isResponseCompletedEvent(event)) {
      return event.response;
    }
    if (isResponseFailedEvent(event)) {
      throw new Error(`Response failed: ${JSON.stringify(event.response.error)}`);
    }
    if (isResponseIncompleteEvent(event)) {
      return event.response;
    }
  }
  throw new Error("Stream ended without completion event");
}
function convertToAssistantMessage(outputMessage) {
  const textContent = outputMessage.content.filter((part) => "type" in part && part.type === "output_text").map((part) => part.text).join("");
  return {
    role: "assistant",
    content: textContent || null
  };
}
function extractMessageFromResponse(response) {
  const messageItem = response.output.find((item) => "type" in item && item.type === "message");
  if (!messageItem) {
    throw new Error("No message found in response output");
  }
  return convertToAssistantMessage(messageItem);
}
function extractResponsesMessageFromResponse(response) {
  const messageItem = response.output.find((item) => "type" in item && item.type === "message");
  if (!messageItem) {
    throw new Error("No message found in response output");
  }
  return messageItem;
}
function extractTextFromResponse(response) {
  if (response.outputText) {
    return response.outputText;
  }
  const hasMessage = response.output.some((item) => "type" in item && item.type === "message");
  if (!hasMessage) {
    return "";
  }
  const message = extractMessageFromResponse(response);
  if (typeof message.content === "string") {
    return message.content;
  }
  return "";
}
function extractToolCallsFromResponse(response) {
  const toolCalls = [];
  for (const item of response.output) {
    if (isFunctionCallItem(item)) {
      try {
        const parsedArguments = JSON.parse(item.arguments);
        toolCalls.push({
          id: item.callId,
          name: item.name,
          arguments: parsedArguments
        });
      } catch (error) {
        console.warn(`Failed to parse tool call arguments for ${item.name}:`, error instanceof Error ? error.message : String(error), `
Arguments: ${item.arguments.substring(0, 100)}${item.arguments.length > 100 ? "..." : ""}`);
        toolCalls.push({
          id: item.callId,
          name: item.name,
          arguments: item.arguments
          // Keep as string if parsing fails
        });
      }
    }
  }
  return toolCalls;
}
async function* buildToolCallStream(stream) {
  const consumer = stream.createConsumer();
  const toolCallsInProgress = /* @__PURE__ */ new Map();
  for await (const event of consumer) {
    if (!("type" in event)) {
      continue;
    }
    switch (event.type) {
      case "response.output_item.added": {
        if (isOutputItemAddedEvent(event) && event.item && isFunctionCallItem(event.item)) {
          toolCallsInProgress.set(event.item.callId, {
            id: event.item.callId,
            name: event.item.name,
            argumentsAccumulated: ""
          });
        }
        break;
      }
      case "response.function_call_arguments.delta": {
        if (isFunctionCallArgumentsDeltaEvent(event)) {
          const toolCall = toolCallsInProgress.get(event.itemId);
          if (toolCall && event.delta) {
            toolCall.argumentsAccumulated += event.delta;
          }
        }
        break;
      }
      case "response.function_call_arguments.done": {
        if (isFunctionCallArgumentsDoneEvent(event)) {
          const toolCall = toolCallsInProgress.get(event.itemId);
          if (toolCall) {
            try {
              const parsedArguments = JSON.parse(event.arguments);
              yield {
                id: toolCall.id,
                name: event.name,
                arguments: parsedArguments
              };
            } catch (error) {
              console.warn(`Failed to parse tool call arguments for ${event.name}:`, error instanceof Error ? error.message : String(error), `
Arguments: ${event.arguments.substring(0, 100)}${event.arguments.length > 100 ? "..." : ""}`);
              yield {
                id: toolCall.id,
                name: event.name,
                arguments: event.arguments
              };
            }
            toolCallsInProgress.delete(event.itemId);
          }
        }
        break;
      }
      case "response.output_item.done": {
        if (isOutputItemDoneEvent(event) && event.item && isFunctionCallItem(event.item)) {
          if (toolCallsInProgress.has(event.item.callId)) {
            try {
              const parsedArguments = JSON.parse(event.item.arguments);
              yield {
                id: event.item.callId,
                name: event.item.name,
                arguments: parsedArguments
              };
            } catch (_error) {
              yield {
                id: event.item.callId,
                name: event.item.name,
                arguments: event.item.arguments
              };
            }
            toolCallsInProgress.delete(event.item.callId);
          }
        }
        break;
      }
    }
  }
}

// node_modules/@openrouter/sdk/esm/lib/async-params.js
function isParameterFunction(value) {
  return typeof value === "function";
}
function buildResolvedRequest(entries) {
  const obj = Object.fromEntries(entries);
  return obj;
}
async function resolveAsyncFunctions(input, context) {
  const resolvedEntries = [];
  const clientOnlyFields = /* @__PURE__ */ new Set([
    "stopWhen",
    // Handled separately in ModelResult
    "state",
    // Client-side state management
    "requireApproval",
    // Client-side approval check function
    "approveToolCalls",
    // Client-side approval decisions
    "rejectToolCalls"
    // Client-side rejection decisions
  ]);
  for (const [key, value] of Object.entries(input)) {
    if (clientOnlyFields.has(key)) {
      continue;
    }
    if (isParameterFunction(value)) {
      try {
        const result = await Promise.resolve(value(context));
        resolvedEntries.push([key, result]);
      } catch (error) {
        throw new Error(`Failed to resolve async function for field "${key}": ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      resolvedEntries.push([key, value]);
    }
  }
  return buildResolvedRequest(resolvedEntries);
}
function hasAsyncFunctions(input) {
  if (!input || typeof input !== "object") {
    return false;
  }
  return Object.values(input).some((value) => typeof value === "function");
}

// node_modules/@openrouter/sdk/esm/lib/chat-compat.js
function isToolResponseMessage(msg) {
  return msg.role === "tool";
}
function isAssistantMessage(msg) {
  return msg.role === "assistant";
}
function mapChatRole(role) {
  switch (role) {
    case "user":
      return OpenResponsesEasyInputMessageRoleUser.User;
    case "system":
      return OpenResponsesEasyInputMessageRoleSystem.System;
    case "assistant":
      return OpenResponsesEasyInputMessageRoleAssistant.Assistant;
    case "developer":
      return OpenResponsesEasyInputMessageRoleDeveloper.Developer;
    default: {
      const exhaustiveCheck = role;
      throw new Error(`Unhandled role type: ${exhaustiveCheck}`);
    }
  }
}
function contentToString(content) {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === void 0) {
    return "";
  }
  return JSON.stringify(content);
}
function fromChatMessages(messages) {
  return messages.map((msg) => {
    if (isToolResponseMessage(msg)) {
      return {
        type: OpenResponsesFunctionCallOutputType.FunctionCallOutput,
        callId: msg.toolCallId,
        output: contentToString(msg.content)
      };
    }
    if (isAssistantMessage(msg)) {
      return {
        role: mapChatRole("assistant"),
        content: contentToString(msg.content)
      };
    }
    return {
      role: mapChatRole(msg.role),
      content: contentToString(msg.content)
    };
  });
}

// node_modules/@openrouter/sdk/esm/lib/url.js
var hasOwn = Object.prototype.hasOwnProperty;
function pathToFunc(pathPattern, options) {
  const paramRE = /\{([a-zA-Z0-9_][a-zA-Z0-9_-]*?)\}/g;
  return function buildURLPath(params = {}) {
    return pathPattern.replace(paramRE, function(_, placeholder) {
      if (!hasOwn.call(params, placeholder)) {
        throw new Error(`Parameter '${placeholder}' is required`);
      }
      const value = params[placeholder];
      if (typeof value !== "string" && typeof value !== "number") {
        throw new Error(`Parameter '${placeholder}' must be a string or number`);
      }
      return options?.charEncoding === "percent" ? encodeURIComponent(`${value}`) : `${value}`;
    });
  };
}

// node_modules/@openrouter/sdk/esm/lib/config.js
var ServerProduction = "production";
var ServerList = {
  [ServerProduction]: "https://openrouter.ai/api/v1"
};
function serverURLFromOptions(options) {
  let serverURL = options.serverURL;
  const params = {};
  if (!serverURL) {
    const server = options.server ?? ServerProduction;
    serverURL = ServerList[server] || "";
  }
  const u = pathToFunc(serverURL)(params);
  return new URL(u);
}
var SDK_METADATA = {
  language: "typescript",
  openapiDocVersion: "1.0.0",
  sdkVersion: "0.9.11",
  genVersion: "2.788.4",
  userAgent: "speakeasy-sdk/typescript 0.9.11 2.788.4 1.0.0 @openrouter/sdk"
};

// node_modules/@openrouter/sdk/esm/lib/http.js
var DEFAULT_FETCHER = (input, init) => {
  if (init == null) {
    return fetch(input);
  } else {
    return fetch(input, init);
  }
};
var HTTPClient = class _HTTPClient {
  constructor(options = {}) {
    this.options = options;
    this.requestHooks = [];
    this.requestErrorHooks = [];
    this.responseHooks = [];
    this.fetcher = options.fetcher || DEFAULT_FETCHER;
  }
  async request(request) {
    let req = request;
    for (const hook of this.requestHooks) {
      const nextRequest = await hook(req);
      if (nextRequest) {
        req = nextRequest;
      }
    }
    try {
      const res = await this.fetcher(req);
      for (const hook of this.responseHooks) {
        await hook(res, req);
      }
      return res;
    } catch (err) {
      for (const hook of this.requestErrorHooks) {
        await hook(err, req);
      }
      throw err;
    }
  }
  addHook(...args) {
    if (args[0] === "beforeRequest") {
      this.requestHooks.push(args[1]);
    } else if (args[0] === "requestError") {
      this.requestErrorHooks.push(args[1]);
    } else if (args[0] === "response") {
      this.responseHooks.push(args[1]);
    } else {
      throw new Error(`Invalid hook type: ${args[0]}`);
    }
    return this;
  }
  removeHook(...args) {
    let target;
    if (args[0] === "beforeRequest") {
      target = this.requestHooks;
    } else if (args[0] === "requestError") {
      target = this.requestErrorHooks;
    } else if (args[0] === "response") {
      target = this.responseHooks;
    } else {
      throw new Error(`Invalid hook type: ${args[0]}`);
    }
    const index = target.findIndex((v) => v === args[1]);
    if (index >= 0) {
      target.splice(index, 1);
    }
    return this;
  }
  clone() {
    const child = new _HTTPClient(this.options);
    child.requestHooks = this.requestHooks.slice();
    child.requestErrorHooks = this.requestErrorHooks.slice();
    child.responseHooks = this.responseHooks.slice();
    return child;
  }
};
var mediaParamSeparator = /\s*;\s*/g;
function matchContentType(response, pattern) {
  if (pattern === "*") {
    return true;
  }
  let contentType = response.headers.get("content-type")?.trim() || "application/octet-stream";
  contentType = contentType.toLowerCase();
  const wantParts = pattern.toLowerCase().trim().split(mediaParamSeparator);
  const [wantType = "", ...wantParams] = wantParts;
  if (wantType.split("/").length !== 2) {
    return false;
  }
  const gotParts = contentType.split(mediaParamSeparator);
  const [gotType = "", ...gotParams] = gotParts;
  const [type = "", subtype = ""] = gotType.split("/");
  if (!type || !subtype) {
    return false;
  }
  if (wantType !== "*/*" && gotType !== wantType && `${type}/*` !== wantType && `*/${subtype}` !== wantType) {
    return false;
  }
  if (gotParams.length < wantParams.length) {
    return false;
  }
  const params = new Set(gotParams);
  for (const wantParam of wantParams) {
    if (!params.has(wantParam)) {
      return false;
    }
  }
  return true;
}
var codeRangeRE = new RegExp("^[0-9]xx$", "i");
function matchStatusCode(response, codes) {
  const actual = `${response.status}`;
  const expectedCodes = Array.isArray(codes) ? codes : [codes];
  if (!expectedCodes.length) {
    return false;
  }
  return expectedCodes.some((ec) => {
    const code = `${ec}`;
    if (code === "default") {
      return true;
    }
    if (!codeRangeRE.test(`${code}`)) {
      return code === actual;
    }
    const expectFamily = code.charAt(0);
    if (!expectFamily) {
      throw new Error("Invalid status code range");
    }
    const actualFamily = actual.charAt(0);
    if (!actualFamily) {
      throw new Error(`Invalid response status code: ${actual}`);
    }
    return actualFamily === expectFamily;
  });
}
function matchResponse(response, code, contentTypePattern) {
  return matchStatusCode(response, code) && matchContentType(response, contentTypePattern);
}
function isConnectionError(err) {
  if (typeof err !== "object" || err == null) {
    return false;
  }
  const isBrowserErr = err instanceof TypeError && err.message.toLowerCase().startsWith("failed to fetch");
  const isNodeErr = err instanceof TypeError && err.message.toLowerCase().startsWith("fetch failed");
  const isBunErr = "name" in err && err.name === "ConnectionError";
  const isGenericErr = "code" in err && typeof err.code === "string" && err.code.toLowerCase() === "econnreset";
  return isBrowserErr || isNodeErr || isGenericErr || isBunErr;
}
function isTimeoutError(err) {
  if (typeof err !== "object" || err == null) {
    return false;
  }
  const isNative = "name" in err && err.name === "TimeoutError";
  const isLegacyNative = "code" in err && err.code === 23;
  const isGenericErr = "code" in err && typeof err.code === "string" && err.code.toLowerCase() === "econnaborted";
  return isNative || isLegacyNative || isGenericErr;
}
function isAbortError(err) {
  if (typeof err !== "object" || err == null) {
    return false;
  }
  const isNative = "name" in err && err.name === "AbortError";
  const isLegacyNative = "code" in err && err.code === 20;
  const isGenericErr = "code" in err && typeof err.code === "string" && err.code.toLowerCase() === "econnaborted";
  return isNative || isLegacyNative || isGenericErr;
}

// node_modules/@openrouter/sdk/esm/lib/next-turn-params.js
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function buildNextTurnParamsContext(request) {
  return {
    input: request.input ?? [],
    model: request.model ?? "",
    models: request.models ?? [],
    temperature: request.temperature ?? null,
    maxOutputTokens: request.maxOutputTokens ?? null,
    topP: request.topP ?? null,
    topK: request.topK,
    instructions: request.instructions ?? null
  };
}
async function executeNextTurnParamsFunctions(toolCalls, tools, currentRequest) {
  const context = buildNextTurnParamsContext(currentRequest);
  const result = {};
  const workingContext = { ...context };
  for (const tool of tools) {
    if (!tool.function.nextTurnParams) {
      continue;
    }
    const callsForTool = toolCalls.filter((tc) => tc.name === tool.function.name);
    for (const call of callsForTool) {
      const nextParams = tool.function.nextTurnParams;
      if (!isRecord(call.arguments)) {
        const typeStr = Array.isArray(call.arguments) ? "array" : typeof call.arguments;
        throw new Error(`Tool call arguments for ${tool.function.name} must be an object, got ${typeStr}`);
      }
      await processNextTurnParamsForCall(nextParams, call.arguments, workingContext, result, tool.function.name);
    }
  }
  return result;
}
async function processNextTurnParamsForCall(nextParams, params, workingContext, result, toolName) {
  for (const paramKey of Object.keys(nextParams)) {
    const fn = nextParams[paramKey];
    if (typeof fn !== "function") {
      continue;
    }
    if (!isValidNextTurnParamKey(paramKey)) {
      if (process.env["NODE_ENV"] !== "production") {
        console.warn(`Invalid nextTurnParams key "${paramKey}" in tool "${toolName}". Valid keys: input, model, models, temperature, maxOutputTokens, topP, topK, instructions`);
      }
      continue;
    }
    const newValue = await Promise.resolve(fn(params, workingContext));
    setNextTurnParam(result, paramKey, newValue);
    setNextTurnParam(workingContext, paramKey, newValue);
  }
}
function isValidNextTurnParamKey(key) {
  const validKeys = /* @__PURE__ */ new Set([
    "input",
    "model",
    "models",
    "temperature",
    "maxOutputTokens",
    "topP",
    "topK",
    "instructions"
  ]);
  return validKeys.has(key);
}
function setNextTurnParam(target, key, value) {
  target[key] = value;
}
function applyNextTurnParamsToRequest(request, computedParams) {
  return {
    ...request,
    ...computedParams
  };
}

// node_modules/@openrouter/sdk/esm/lib/stop-conditions.js
function stepCountIs(stepCount) {
  return ({ steps }) => steps.length >= stepCount;
}
async function isStopConditionMet(options) {
  const { stopConditions, steps } = options;
  const results = await Promise.all(stopConditions.map((condition) => Promise.resolve(condition({
    steps
  }))));
  return results.some((result) => result === true);
}

// node_modules/@openrouter/sdk/esm/lib/tool-types.js
var ToolType;
(function(ToolType2) {
  ToolType2["Function"] = "function";
})(ToolType || (ToolType = {}));
function hasExecuteFunction(tool) {
  return "execute" in tool.function && typeof tool.function.execute === "function";
}
function isGeneratorTool(tool) {
  return "eventSchema" in tool.function;
}
function isRegularExecuteTool(tool) {
  return hasExecuteFunction(tool) && !isGeneratorTool(tool);
}

// node_modules/@openrouter/sdk/esm/models/activityitem.js
var z11 = __toESM(require("zod/v4"), 1);
var ActivityItem$inboundSchema = z11.object({
  date: z11.string(),
  model: z11.string(),
  model_permaslug: z11.string(),
  endpoint_id: z11.string(),
  provider_name: z11.string(),
  usage: z11.number(),
  byok_usage_inference: z11.number(),
  requests: z11.number(),
  prompt_tokens: z11.number(),
  completion_tokens: z11.number(),
  reasoning_tokens: z11.number()
}).transform((v) => {
  return remap(v, {
    "model_permaslug": "modelPermaslug",
    "endpoint_id": "endpointId",
    "provider_name": "providerName",
    "byok_usage_inference": "byokUsageInference",
    "prompt_tokens": "promptTokens",
    "completion_tokens": "completionTokens",
    "reasoning_tokens": "reasoningTokens"
  });
});

// node_modules/@openrouter/sdk/esm/models/assistantmessage.js
var z26 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/assistantmessageimages.js
var z12 = __toESM(require("zod/v4"), 1);
var AssistantMessageImagesImageUrl$inboundSchema = z12.object({
  url: z12.string()
});
var AssistantMessageImagesImageUrl$outboundSchema = z12.object({
  url: z12.string()
});
var AssistantMessageImages$inboundSchema = z12.object({
  image_url: z12.lazy(() => AssistantMessageImagesImageUrl$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "image_url": "imageUrl"
  });
});
var AssistantMessageImages$outboundSchema = z12.object({
  imageUrl: z12.lazy(() => AssistantMessageImagesImageUrl$outboundSchema)
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitem.js
var z20 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemaudio.js
var z13 = __toESM(require("zod/v4"), 1);
var ChatMessageContentItemAudioType = {
  InputAudio: "input_audio"
};
var ChatMessageContentItemAudioType$inboundSchema = z13.enum(ChatMessageContentItemAudioType);
var ChatMessageContentItemAudioType$outboundSchema = ChatMessageContentItemAudioType$inboundSchema;
var ChatMessageContentItemAudioInputAudio$inboundSchema = z13.object({
  data: z13.string(),
  format: z13.string()
});
var ChatMessageContentItemAudioInputAudio$outboundSchema = z13.object({
  data: z13.string(),
  format: z13.string()
});
var ChatMessageContentItemAudio$inboundSchema = z13.object({
  type: ChatMessageContentItemAudioType$inboundSchema,
  input_audio: z13.lazy(() => ChatMessageContentItemAudioInputAudio$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "input_audio": "inputAudio"
  });
});
var ChatMessageContentItemAudio$outboundSchema = z13.object({
  type: ChatMessageContentItemAudioType$outboundSchema,
  inputAudio: z13.lazy(() => ChatMessageContentItemAudioInputAudio$outboundSchema)
}).transform((v) => {
  return remap(v, {
    inputAudio: "input_audio"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemimage.js
var z14 = __toESM(require("zod/v4"), 1);
var ChatMessageContentItemImageType = {
  ImageUrl: "image_url"
};
var ChatMessageContentItemImageDetail = {
  Auto: "auto",
  Low: "low",
  High: "high"
};
var ChatMessageContentItemImageType$inboundSchema = z14.enum(ChatMessageContentItemImageType);
var ChatMessageContentItemImageType$outboundSchema = ChatMessageContentItemImageType$inboundSchema;
var ChatMessageContentItemImageDetail$inboundSchema = inboundSchema(ChatMessageContentItemImageDetail);
var ChatMessageContentItemImageDetail$outboundSchema = outboundSchema(ChatMessageContentItemImageDetail);
var ChatMessageContentItemImageImageUrl$inboundSchema = z14.object({
  url: z14.string(),
  detail: ChatMessageContentItemImageDetail$inboundSchema.optional()
});
var ChatMessageContentItemImageImageUrl$outboundSchema = z14.object({
  url: z14.string(),
  detail: ChatMessageContentItemImageDetail$outboundSchema.optional()
});
var ChatMessageContentItemImage$inboundSchema = z14.object({
  type: ChatMessageContentItemImageType$inboundSchema,
  image_url: z14.lazy(() => ChatMessageContentItemImageImageUrl$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "image_url": "imageUrl"
  });
});
var ChatMessageContentItemImage$outboundSchema = z14.object({
  type: ChatMessageContentItemImageType$outboundSchema,
  imageUrl: z14.lazy(() => ChatMessageContentItemImageImageUrl$outboundSchema)
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemtext.js
var z16 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemcachecontrol.js
var z15 = __toESM(require("zod/v4"), 1);
var ChatMessageContentItemCacheControlType = {
  Ephemeral: "ephemeral"
};
var Ttl = {
  Fivem: "5m",
  Oneh: "1h"
};
var ChatMessageContentItemCacheControlType$inboundSchema = z15.enum(ChatMessageContentItemCacheControlType);
var ChatMessageContentItemCacheControlType$outboundSchema = ChatMessageContentItemCacheControlType$inboundSchema;
var Ttl$inboundSchema = inboundSchema(Ttl);
var Ttl$outboundSchema = outboundSchema(Ttl);
var ChatMessageContentItemCacheControl$inboundSchema = z15.object({
  type: ChatMessageContentItemCacheControlType$inboundSchema,
  ttl: Ttl$inboundSchema.optional()
});
var ChatMessageContentItemCacheControl$outboundSchema = z15.object({
  type: ChatMessageContentItemCacheControlType$outboundSchema,
  ttl: Ttl$outboundSchema.optional()
});

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemtext.js
var ChatMessageContentItemTextType = {
  Text: "text"
};
var ChatMessageContentItemTextType$inboundSchema = z16.enum(ChatMessageContentItemTextType);
var ChatMessageContentItemTextType$outboundSchema = ChatMessageContentItemTextType$inboundSchema;
var ChatMessageContentItemText$inboundSchema = z16.object({
  type: ChatMessageContentItemTextType$inboundSchema,
  text: z16.string(),
  cache_control: ChatMessageContentItemCacheControl$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "cache_control": "cacheControl"
  });
});
var ChatMessageContentItemText$outboundSchema = z16.object({
  type: ChatMessageContentItemTextType$outboundSchema,
  text: z16.string(),
  cacheControl: ChatMessageContentItemCacheControl$outboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    cacheControl: "cache_control"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemvideo.js
var z18 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/videoinput.js
var z17 = __toESM(require("zod/v4"), 1);
var VideoInput$inboundSchema = z17.object({
  url: z17.string()
});
var VideoInput$outboundSchema = z17.object({
  url: z17.string()
});

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemvideo.js
var ChatMessageContentItemVideo$inboundSchema = z18.object({
  type: z18.literal("video_url"),
  video_url: VideoInput$inboundSchema
}).transform((v) => {
  return remap(v, {
    "video_url": "videoUrl"
  });
});
var ChatMessageContentItemVideo$outboundSchema = z18.object({
  type: z18.literal("video_url"),
  videoUrl: VideoInput$outboundSchema
}).transform((v) => {
  return remap(v, {
    videoUrl: "video_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemvideolegacy.js
var z19 = __toESM(require("zod/v4"), 1);
var ChatMessageContentItemVideoLegacy$inboundSchema = z19.object({
  type: z19.literal("input_video"),
  video_url: VideoInput$inboundSchema
}).transform((v) => {
  return remap(v, {
    "video_url": "videoUrl"
  });
});
var ChatMessageContentItemVideoLegacy$outboundSchema = z19.object({
  type: z19.literal("input_video"),
  videoUrl: VideoInput$outboundSchema
}).transform((v) => {
  return remap(v, {
    videoUrl: "video_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitem.js
var ChatMessageContentItem1$inboundSchema = z20.union([
  ChatMessageContentItemVideoLegacy$inboundSchema,
  ChatMessageContentItemVideo$inboundSchema
]);
var ChatMessageContentItem1$outboundSchema = z20.union([
  ChatMessageContentItemVideoLegacy$outboundSchema,
  ChatMessageContentItemVideo$outboundSchema
]);
var ChatMessageContentItem$inboundSchema = z20.union([
  ChatMessageContentItemText$inboundSchema,
  ChatMessageContentItemImage$inboundSchema,
  ChatMessageContentItemAudio$inboundSchema,
  z20.union([
    ChatMessageContentItemVideoLegacy$inboundSchema,
    ChatMessageContentItemVideo$inboundSchema
  ])
]);
var ChatMessageContentItem$outboundSchema = z20.union([
  ChatMessageContentItemText$outboundSchema,
  ChatMessageContentItemImage$outboundSchema,
  ChatMessageContentItemAudio$outboundSchema,
  z20.union([
    ChatMessageContentItemVideoLegacy$outboundSchema,
    ChatMessageContentItemVideo$outboundSchema
  ])
]);

// node_modules/@openrouter/sdk/esm/models/chatmessagetoolcall.js
var z21 = __toESM(require("zod/v4"), 1);
var ChatMessageToolCallType = {
  Function: "function"
};
var ChatMessageToolCallType$inboundSchema = z21.enum(ChatMessageToolCallType);
var ChatMessageToolCallType$outboundSchema = ChatMessageToolCallType$inboundSchema;
var ChatMessageToolCallFunction$inboundSchema = z21.object({
  name: z21.string(),
  arguments: z21.string()
});
var ChatMessageToolCallFunction$outboundSchema = z21.object({
  name: z21.string(),
  arguments: z21.string()
});
var ChatMessageToolCall$inboundSchema = z21.object({
  id: z21.string(),
  type: ChatMessageToolCallType$inboundSchema,
  function: z21.lazy(() => ChatMessageToolCallFunction$inboundSchema)
});
var ChatMessageToolCall$outboundSchema = z21.object({
  id: z21.string(),
  type: ChatMessageToolCallType$outboundSchema,
  function: z21.lazy(() => ChatMessageToolCallFunction$outboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/reasoningdetailunion.js
var z25 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/reasoningdetailencrypted.js
var z22 = __toESM(require("zod/v4"), 1);
var ReasoningDetailEncryptedFormat = {
  Unknown: "unknown",
  OpenaiResponsesV1: "openai-responses-v1",
  AzureOpenaiResponsesV1: "azure-openai-responses-v1",
  XaiResponsesV1: "xai-responses-v1",
  AnthropicClaudeV1: "anthropic-claude-v1",
  GoogleGeminiV1: "google-gemini-v1"
};
var ReasoningDetailEncryptedFormat$inboundSchema = inboundSchema(ReasoningDetailEncryptedFormat);
var ReasoningDetailEncryptedFormat$outboundSchema = outboundSchema(ReasoningDetailEncryptedFormat);
var ReasoningDetailEncrypted$inboundSchema = z22.object({
  type: z22.literal("reasoning.encrypted"),
  data: z22.string(),
  id: z22.nullable(z22.string()).optional(),
  format: z22.nullable(ReasoningDetailEncryptedFormat$inboundSchema).optional(),
  index: z22.number().optional()
});
var ReasoningDetailEncrypted$outboundSchema = z22.object({
  type: z22.literal("reasoning.encrypted"),
  data: z22.string(),
  id: z22.nullable(z22.string()).optional(),
  format: z22.nullable(ReasoningDetailEncryptedFormat$outboundSchema).optional(),
  index: z22.number().optional()
});

// node_modules/@openrouter/sdk/esm/models/reasoningdetailsummary.js
var z23 = __toESM(require("zod/v4"), 1);
var ReasoningDetailSummaryFormat = {
  Unknown: "unknown",
  OpenaiResponsesV1: "openai-responses-v1",
  AzureOpenaiResponsesV1: "azure-openai-responses-v1",
  XaiResponsesV1: "xai-responses-v1",
  AnthropicClaudeV1: "anthropic-claude-v1",
  GoogleGeminiV1: "google-gemini-v1"
};
var ReasoningDetailSummaryFormat$inboundSchema = inboundSchema(ReasoningDetailSummaryFormat);
var ReasoningDetailSummaryFormat$outboundSchema = outboundSchema(ReasoningDetailSummaryFormat);
var ReasoningDetailSummary$inboundSchema = z23.object({
  type: z23.literal("reasoning.summary"),
  summary: z23.string(),
  id: z23.nullable(z23.string()).optional(),
  format: z23.nullable(ReasoningDetailSummaryFormat$inboundSchema).optional(),
  index: z23.number().optional()
});
var ReasoningDetailSummary$outboundSchema = z23.object({
  type: z23.literal("reasoning.summary"),
  summary: z23.string(),
  id: z23.nullable(z23.string()).optional(),
  format: z23.nullable(ReasoningDetailSummaryFormat$outboundSchema).optional(),
  index: z23.number().optional()
});

// node_modules/@openrouter/sdk/esm/models/reasoningdetailtext.js
var z24 = __toESM(require("zod/v4"), 1);
var ReasoningDetailTextFormat = {
  Unknown: "unknown",
  OpenaiResponsesV1: "openai-responses-v1",
  AzureOpenaiResponsesV1: "azure-openai-responses-v1",
  XaiResponsesV1: "xai-responses-v1",
  AnthropicClaudeV1: "anthropic-claude-v1",
  GoogleGeminiV1: "google-gemini-v1"
};
var ReasoningDetailTextFormat$inboundSchema = inboundSchema(ReasoningDetailTextFormat);
var ReasoningDetailTextFormat$outboundSchema = outboundSchema(ReasoningDetailTextFormat);
var ReasoningDetailText$inboundSchema = z24.object({
  type: z24.literal("reasoning.text"),
  text: z24.nullable(z24.string()).optional(),
  signature: z24.nullable(z24.string()).optional(),
  id: z24.nullable(z24.string()).optional(),
  format: z24.nullable(ReasoningDetailTextFormat$inboundSchema).optional(),
  index: z24.number().optional()
});
var ReasoningDetailText$outboundSchema = z24.object({
  type: z24.literal("reasoning.text"),
  text: z24.nullable(z24.string()).optional(),
  signature: z24.nullable(z24.string()).optional(),
  id: z24.nullable(z24.string()).optional(),
  format: z24.nullable(ReasoningDetailTextFormat$outboundSchema).optional(),
  index: z24.number().optional()
});

// node_modules/@openrouter/sdk/esm/models/reasoningdetailunion.js
var ReasoningDetailUnion$inboundSchema = z25.union([
  ReasoningDetailSummary$inboundSchema,
  ReasoningDetailEncrypted$inboundSchema,
  ReasoningDetailText$inboundSchema
]);
var ReasoningDetailUnion$outboundSchema = z25.union([
  ReasoningDetailSummary$outboundSchema,
  ReasoningDetailEncrypted$outboundSchema,
  ReasoningDetailText$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/assistantmessage.js
var AssistantMessageRole = {
  Assistant: "assistant"
};
var AssistantMessageRole$inboundSchema = z26.enum(AssistantMessageRole);
var AssistantMessageRole$outboundSchema = AssistantMessageRole$inboundSchema;
var AssistantMessageContent$inboundSchema = z26.union([
  z26.string(),
  z26.array(ChatMessageContentItem$inboundSchema),
  z26.any()
]);
var AssistantMessageContent$outboundSchema = z26.union([
  z26.string(),
  z26.array(ChatMessageContentItem$outboundSchema),
  z26.any()
]);
var AssistantMessage$inboundSchema = z26.object({
  role: AssistantMessageRole$inboundSchema,
  content: z26.nullable(z26.union([
    z26.string(),
    z26.array(ChatMessageContentItem$inboundSchema),
    z26.any()
  ])).optional(),
  name: z26.string().optional(),
  tool_calls: z26.array(ChatMessageToolCall$inboundSchema).optional(),
  refusal: z26.nullable(z26.string()).optional(),
  reasoning: z26.nullable(z26.string()).optional(),
  reasoning_details: z26.array(ReasoningDetailUnion$inboundSchema).optional(),
  images: z26.array(AssistantMessageImages$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "tool_calls": "toolCalls",
    "reasoning_details": "reasoningDetails"
  });
});
var AssistantMessage$outboundSchema = z26.object({
  role: AssistantMessageRole$outboundSchema,
  content: z26.nullable(z26.union([
    z26.string(),
    z26.array(ChatMessageContentItem$outboundSchema),
    z26.any()
  ])).optional(),
  name: z26.string().optional(),
  toolCalls: z26.array(ChatMessageToolCall$outboundSchema).optional(),
  refusal: z26.nullable(z26.string()).optional(),
  reasoning: z26.nullable(z26.string()).optional(),
  reasoningDetails: z26.array(ReasoningDetailUnion$outboundSchema).optional(),
  images: z26.array(AssistantMessageImages$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    toolCalls: "tool_calls",
    reasoningDetails: "reasoning_details"
  });
});

// node_modules/@openrouter/sdk/esm/models/badgatewayresponseerrordata.js
var z27 = __toESM(require("zod/v4"), 1);
var BadGatewayResponseErrorData$inboundSchema = z27.object({
  code: z27.int(),
  message: z27.string(),
  metadata: z27.nullable(z27.record(z27.string(), z27.nullable(z27.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/badrequestresponseerrordata.js
var z28 = __toESM(require("zod/v4"), 1);
var BadRequestResponseErrorData$inboundSchema = z28.object({
  code: z28.int(),
  message: z28.string(),
  metadata: z28.nullable(z28.record(z28.string(), z28.nullable(z28.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/chatgenerationparams.js
var z50 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatstreamoptions.js
var z29 = __toESM(require("zod/v4"), 1);
var ChatStreamOptions$outboundSchema = z29.object({
  includeUsage: z29.boolean().optional()
}).transform((v) => {
  return remap(v, {
    includeUsage: "include_usage"
  });
});

// node_modules/@openrouter/sdk/esm/models/datacollection.js
var DataCollection = {
  Deny: "deny",
  Allow: "allow"
};
var DataCollection$outboundSchema = outboundSchema(DataCollection);

// node_modules/@openrouter/sdk/esm/models/debugoptions.js
var z30 = __toESM(require("zod/v4"), 1);
var DebugOptions$outboundSchema = z30.object({
  echoUpstreamBody: z30.boolean().optional()
}).transform((v) => {
  return remap(v, {
    echoUpstreamBody: "echo_upstream_body"
  });
});

// node_modules/@openrouter/sdk/esm/models/message.js
var z35 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/developermessage.js
var z31 = __toESM(require("zod/v4"), 1);
var DeveloperMessageContent$outboundSchema = z31.union([z31.string(), z31.array(ChatMessageContentItemText$outboundSchema)]);
var DeveloperMessage$outboundSchema = z31.object({
  role: z31.literal("developer"),
  content: z31.union([
    z31.string(),
    z31.array(ChatMessageContentItemText$outboundSchema)
  ]),
  name: z31.string().optional()
});

// node_modules/@openrouter/sdk/esm/models/systemmessage.js
var z32 = __toESM(require("zod/v4"), 1);
var SystemMessageContent$outboundSchema = z32.union([z32.string(), z32.array(ChatMessageContentItemText$outboundSchema)]);
var SystemMessage$outboundSchema = z32.object({
  role: z32.literal("system"),
  content: z32.union([
    z32.string(),
    z32.array(ChatMessageContentItemText$outboundSchema)
  ]),
  name: z32.string().optional()
});

// node_modules/@openrouter/sdk/esm/models/toolresponsemessage.js
var z33 = __toESM(require("zod/v4"), 1);
var ToolResponseMessageContent$outboundSchema = z33.union([z33.string(), z33.array(ChatMessageContentItem$outboundSchema)]);
var ToolResponseMessage$outboundSchema = z33.object({
  role: z33.literal("tool"),
  content: z33.union([
    z33.string(),
    z33.array(ChatMessageContentItem$outboundSchema)
  ]),
  toolCallId: z33.string()
}).transform((v) => {
  return remap(v, {
    toolCallId: "tool_call_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/usermessage.js
var z34 = __toESM(require("zod/v4"), 1);
var UserMessageContent$outboundSchema = z34.union([z34.string(), z34.array(ChatMessageContentItem$outboundSchema)]);
var UserMessage$outboundSchema = z34.object({
  role: z34.literal("user"),
  content: z34.union([
    z34.string(),
    z34.array(ChatMessageContentItem$outboundSchema)
  ]),
  name: z34.string().optional()
});

// node_modules/@openrouter/sdk/esm/models/message.js
var Message$outboundSchema = z35.union([
  SystemMessage$outboundSchema,
  UserMessage$outboundSchema,
  DeveloperMessage$outboundSchema,
  AssistantMessage$outboundSchema.and(z35.object({ role: z35.literal("assistant") })),
  ToolResponseMessage$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/pdfparseroptions.js
var z36 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/pdfparserengine.js
var PDFParserEngine = {
  MistralOcr: "mistral-ocr",
  PdfText: "pdf-text",
  Native: "native"
};
var PDFParserEngine$outboundSchema = outboundSchema(PDFParserEngine);

// node_modules/@openrouter/sdk/esm/models/pdfparseroptions.js
var PDFParserOptions$outboundSchema = z36.object({
  engine: PDFParserEngine$outboundSchema.optional()
});

// node_modules/@openrouter/sdk/esm/models/preferredmaxlatency.js
var z38 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/percentilelatencycutoffs.js
var z37 = __toESM(require("zod/v4"), 1);
var PercentileLatencyCutoffs$outboundSchema = z37.object({
  p50: z37.nullable(z37.number()).optional(),
  p75: z37.nullable(z37.number()).optional(),
  p90: z37.nullable(z37.number()).optional(),
  p99: z37.nullable(z37.number()).optional()
});

// node_modules/@openrouter/sdk/esm/models/preferredmaxlatency.js
var PreferredMaxLatency$outboundSchema = z38.union([z38.number(), PercentileLatencyCutoffs$outboundSchema, z38.any()]);

// node_modules/@openrouter/sdk/esm/models/preferredminthroughput.js
var z40 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/percentilethroughputcutoffs.js
var z39 = __toESM(require("zod/v4"), 1);
var PercentileThroughputCutoffs$outboundSchema = z39.object({
  p50: z39.nullable(z39.number()).optional(),
  p75: z39.nullable(z39.number()).optional(),
  p90: z39.nullable(z39.number()).optional(),
  p99: z39.nullable(z39.number()).optional()
});

// node_modules/@openrouter/sdk/esm/models/preferredminthroughput.js
var PreferredMinThroughput$outboundSchema = z40.union([z40.number(), PercentileThroughputCutoffs$outboundSchema, z40.any()]);

// node_modules/@openrouter/sdk/esm/models/providername.js
var ProviderName = {
  Ai21: "AI21",
  AionLabs: "AionLabs",
  Alibaba: "Alibaba",
  Ambient: "Ambient",
  AmazonBedrock: "Amazon Bedrock",
  AmazonNova: "Amazon Nova",
  Anthropic: "Anthropic",
  ArceeAI: "Arcee AI",
  AtlasCloud: "AtlasCloud",
  Avian: "Avian",
  Azure: "Azure",
  BaseTen: "BaseTen",
  BytePlus: "BytePlus",
  BlackForestLabs: "Black Forest Labs",
  Cerebras: "Cerebras",
  Chutes: "Chutes",
  Cirrascale: "Cirrascale",
  Clarifai: "Clarifai",
  Cloudflare: "Cloudflare",
  Cohere: "Cohere",
  Crusoe: "Crusoe",
  DeepInfra: "DeepInfra",
  DeepSeek: "DeepSeek",
  Featherless: "Featherless",
  Fireworks: "Fireworks",
  Friendli: "Friendli",
  GMICloud: "GMICloud",
  Google: "Google",
  GoogleAIStudio: "Google AI Studio",
  Groq: "Groq",
  Hyperbolic: "Hyperbolic",
  Inception: "Inception",
  Inceptron: "Inceptron",
  InferenceNet: "InferenceNet",
  Ionstream: "Ionstream",
  Infermatic: "Infermatic",
  IoNet: "Io Net",
  Inflection: "Inflection",
  Liquid: "Liquid",
  Mara: "Mara",
  Mancer2: "Mancer 2",
  Minimax: "Minimax",
  ModelRun: "ModelRun",
  Mistral: "Mistral",
  Modular: "Modular",
  MoonshotAI: "Moonshot AI",
  Morph: "Morph",
  NCompass: "NCompass",
  Nebius: "Nebius",
  NextBit: "NextBit",
  Novita: "Novita",
  Nvidia: "Nvidia",
  OpenAI: "OpenAI",
  OpenInference: "OpenInference",
  Parasail: "Parasail",
  Perplexity: "Perplexity",
  Phala: "Phala",
  Relace: "Relace",
  SambaNova: "SambaNova",
  Seed: "Seed",
  SiliconFlow: "SiliconFlow",
  Sourceful: "Sourceful",
  StepFun: "StepFun",
  Stealth: "Stealth",
  StreamLake: "StreamLake",
  Switchpoint: "Switchpoint",
  Together: "Together",
  Upstage: "Upstage",
  Venice: "Venice",
  WandB: "WandB",
  Xiaomi: "Xiaomi",
  XAI: "xAI",
  ZAi: "Z.AI",
  FakeProvider: "FakeProvider"
};
var ProviderName$inboundSchema = inboundSchema(ProviderName);
var ProviderName$outboundSchema = outboundSchema(ProviderName);

// node_modules/@openrouter/sdk/esm/models/quantization.js
var Quantization = {
  Int4: "int4",
  Int8: "int8",
  Fp4: "fp4",
  Fp6: "fp6",
  Fp8: "fp8",
  Fp16: "fp16",
  Bf16: "bf16",
  Fp32: "fp32",
  Unknown: "unknown"
};
var Quantization$outboundSchema = outboundSchema(Quantization);

// node_modules/@openrouter/sdk/esm/models/responseformatjsonobject.js
var z41 = __toESM(require("zod/v4"), 1);
var ResponseFormatJSONObject$inboundSchema = z41.object({
  type: z41.literal("json_object")
});
var ResponseFormatJSONObject$outboundSchema = z41.object({
  type: z41.literal("json_object")
});

// node_modules/@openrouter/sdk/esm/models/responseformatjsonschema.js
var z43 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/jsonschemaconfig.js
var z42 = __toESM(require("zod/v4"), 1);
var JSONSchemaConfig$outboundSchema = z42.object({
  name: z42.string(),
  description: z42.string().optional(),
  schema: z42.record(z42.string(), z42.nullable(z42.any())).optional(),
  strict: z42.nullable(z42.boolean()).optional()
});

// node_modules/@openrouter/sdk/esm/models/responseformatjsonschema.js
var ResponseFormatJSONSchema$outboundSchema = z43.object({
  type: z43.literal("json_schema"),
  jsonSchema: JSONSchemaConfig$outboundSchema
}).transform((v) => {
  return remap(v, {
    jsonSchema: "json_schema"
  });
});

// node_modules/@openrouter/sdk/esm/models/responseformattext.js
var z44 = __toESM(require("zod/v4"), 1);
var ResponseFormatText$outboundSchema = z44.object({
  type: z44.literal("text")
});

// node_modules/@openrouter/sdk/esm/models/responseformattextgrammar.js
var z45 = __toESM(require("zod/v4"), 1);
var ResponseFormatTextGrammar$outboundSchema = z45.object({
  type: z45.literal("grammar"),
  grammar: z45.string()
});

// node_modules/@openrouter/sdk/esm/models/responseformattextpython.js
var z46 = __toESM(require("zod/v4"), 1);
var ResponseFormatTextPython$outboundSchema = z46.object({
  type: z46.literal("python")
});

// node_modules/@openrouter/sdk/esm/models/toolchoiceoption.js
var z48 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/namedtoolchoice.js
var z47 = __toESM(require("zod/v4"), 1);
var NamedToolChoiceType = {
  Function: "function"
};
var NamedToolChoiceType$outboundSchema = z47.enum(NamedToolChoiceType);
var NamedToolChoiceFunction$outboundSchema = z47.object({
  name: z47.string()
});
var NamedToolChoice$outboundSchema = z47.object({
  type: NamedToolChoiceType$outboundSchema,
  function: z47.lazy(() => NamedToolChoiceFunction$outboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/toolchoiceoption.js
var ToolChoiceOptionRequired = {
  Required: "required"
};
var ToolChoiceOptionAuto = {
  Auto: "auto"
};
var ToolChoiceOptionNone = {
  None: "none"
};
var ToolChoiceOptionRequired$outboundSchema = z48.enum(ToolChoiceOptionRequired);
var ToolChoiceOptionAuto$outboundSchema = z48.enum(ToolChoiceOptionAuto);
var ToolChoiceOptionNone$outboundSchema = z48.enum(ToolChoiceOptionNone);
var ToolChoiceOption$outboundSchema = z48.union([
  NamedToolChoice$outboundSchema,
  ToolChoiceOptionNone$outboundSchema,
  ToolChoiceOptionAuto$outboundSchema,
  ToolChoiceOptionRequired$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/tooldefinitionjson.js
var z49 = __toESM(require("zod/v4"), 1);
var ToolDefinitionJsonType = {
  Function: "function"
};
var ToolDefinitionJsonType$outboundSchema = z49.enum(ToolDefinitionJsonType);
var ToolDefinitionJsonFunction$outboundSchema = z49.object({
  name: z49.string(),
  description: z49.string().optional(),
  parameters: z49.record(z49.string(), z49.nullable(z49.any())).optional(),
  strict: z49.nullable(z49.boolean()).optional()
});
var ToolDefinitionJson$outboundSchema = z49.object({
  type: ToolDefinitionJsonType$outboundSchema,
  function: z49.lazy(() => ToolDefinitionJsonFunction$outboundSchema),
  cacheControl: ChatMessageContentItemCacheControl$outboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    cacheControl: "cache_control"
  });
});

// node_modules/@openrouter/sdk/esm/models/websearchengine.js
var WebSearchEngine = {
  Native: "native",
  Exa: "exa"
};
var WebSearchEngine$outboundSchema = outboundSchema(WebSearchEngine);

// node_modules/@openrouter/sdk/esm/models/chatgenerationparams.js
var ChatGenerationParamsSortEnum = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency"
};
var ChatGenerationParamsProviderSortConfigEnum = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency"
};
var ChatGenerationParamsBy = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency"
};
var ChatGenerationParamsPartition = {
  Model: "model",
  None: "none"
};
var ChatGenerationParamsProviderSort = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency"
};
var Effort = {
  Xhigh: "xhigh",
  High: "high",
  Medium: "medium",
  Low: "low",
  Minimal: "minimal",
  None: "none"
};
var Modality = {
  Text: "text",
  Image: "image"
};
var ChatGenerationParamsOrder$outboundSchema = z50.union([ProviderName$outboundSchema, z50.string()]);
var ChatGenerationParamsOnly$outboundSchema = z50.union([ProviderName$outboundSchema, z50.string()]);
var ChatGenerationParamsIgnore$outboundSchema = z50.union([ProviderName$outboundSchema, z50.string()]);
var ChatGenerationParamsSortEnum$outboundSchema = outboundSchema(ChatGenerationParamsSortEnum);
var ChatGenerationParamsProviderSortConfigEnum$outboundSchema = z50.enum(ChatGenerationParamsProviderSortConfigEnum);
var ChatGenerationParamsBy$outboundSchema = outboundSchema(ChatGenerationParamsBy);
var ChatGenerationParamsPartition$outboundSchema = outboundSchema(ChatGenerationParamsPartition);
var ChatGenerationParamsProviderSortConfig$outboundSchema = z50.object({
  by: z50.nullable(ChatGenerationParamsBy$outboundSchema).optional(),
  partition: z50.nullable(ChatGenerationParamsPartition$outboundSchema).optional()
});
var ChatGenerationParamsProviderSortConfigUnion$outboundSchema = z50.union([
  z50.lazy(() => ChatGenerationParamsProviderSortConfig$outboundSchema),
  ChatGenerationParamsProviderSortConfigEnum$outboundSchema
]);
var ChatGenerationParamsProviderSort$outboundSchema = outboundSchema(ChatGenerationParamsProviderSort);
var ChatGenerationParamsSortUnion$outboundSchema = z50.union([
  ChatGenerationParamsProviderSort$outboundSchema,
  z50.union([
    z50.lazy(() => ChatGenerationParamsProviderSortConfig$outboundSchema),
    ChatGenerationParamsProviderSortConfigEnum$outboundSchema
  ]),
  ChatGenerationParamsSortEnum$outboundSchema
]);
var ChatGenerationParamsMaxPrice$outboundSchema = z50.object({
  prompt: z50.string().optional(),
  completion: z50.string().optional(),
  image: z50.string().optional(),
  audio: z50.string().optional(),
  request: z50.string().optional()
});
var ChatGenerationParamsProvider$outboundSchema = z50.object({
  allowFallbacks: z50.nullable(z50.boolean()).optional(),
  requireParameters: z50.nullable(z50.boolean()).optional(),
  dataCollection: z50.nullable(DataCollection$outboundSchema).optional(),
  zdr: z50.nullable(z50.boolean()).optional(),
  enforceDistillableText: z50.nullable(z50.boolean()).optional(),
  order: z50.nullable(z50.array(z50.union([ProviderName$outboundSchema, z50.string()]))).optional(),
  only: z50.nullable(z50.array(z50.union([ProviderName$outboundSchema, z50.string()]))).optional(),
  ignore: z50.nullable(z50.array(z50.union([ProviderName$outboundSchema, z50.string()]))).optional(),
  quantizations: z50.nullable(z50.array(Quantization$outboundSchema)).optional(),
  sort: z50.nullable(z50.union([
    ChatGenerationParamsProviderSort$outboundSchema,
    z50.union([
      z50.lazy(() => ChatGenerationParamsProviderSortConfig$outboundSchema),
      ChatGenerationParamsProviderSortConfigEnum$outboundSchema
    ]),
    ChatGenerationParamsSortEnum$outboundSchema
  ])).optional(),
  maxPrice: z50.lazy(() => ChatGenerationParamsMaxPrice$outboundSchema).optional(),
  preferredMinThroughput: z50.nullable(PreferredMinThroughput$outboundSchema).optional(),
  preferredMaxLatency: z50.nullable(PreferredMaxLatency$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    allowFallbacks: "allow_fallbacks",
    requireParameters: "require_parameters",
    dataCollection: "data_collection",
    enforceDistillableText: "enforce_distillable_text",
    maxPrice: "max_price",
    preferredMinThroughput: "preferred_min_throughput",
    preferredMaxLatency: "preferred_max_latency"
  });
});
var ChatGenerationParamsPluginResponseHealing$outboundSchema = z50.object({
  id: z50.literal("response-healing"),
  enabled: z50.boolean().optional()
});
var ChatGenerationParamsPluginFileParser$outboundSchema = z50.object({
  id: z50.literal("file-parser"),
  enabled: z50.boolean().optional(),
  pdf: PDFParserOptions$outboundSchema.optional()
});
var ChatGenerationParamsPluginWeb$outboundSchema = z50.object({
  id: z50.literal("web"),
  enabled: z50.boolean().optional(),
  maxResults: z50.number().optional(),
  searchPrompt: z50.string().optional(),
  engine: WebSearchEngine$outboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    maxResults: "max_results",
    searchPrompt: "search_prompt"
  });
});
var ChatGenerationParamsPluginModeration$outboundSchema = z50.object({
  id: z50.literal("moderation")
});
var ChatGenerationParamsPluginAutoRouter$outboundSchema = z50.object({
  id: z50.literal("auto-router"),
  enabled: z50.boolean().optional(),
  allowedModels: z50.array(z50.string()).optional()
}).transform((v) => {
  return remap(v, {
    allowedModels: "allowed_models"
  });
});
var ChatGenerationParamsPluginUnion$outboundSchema = z50.union([
  z50.lazy(() => ChatGenerationParamsPluginAutoRouter$outboundSchema),
  z50.lazy(() => ChatGenerationParamsPluginModeration$outboundSchema),
  z50.lazy(() => ChatGenerationParamsPluginWeb$outboundSchema),
  z50.lazy(() => ChatGenerationParamsPluginFileParser$outboundSchema),
  z50.lazy(() => ChatGenerationParamsPluginResponseHealing$outboundSchema)
]);
var ChatGenerationParamsTrace$outboundSchema = z50.object({
  traceId: z50.string().optional(),
  traceName: z50.string().optional(),
  spanName: z50.string().optional(),
  generationName: z50.string().optional(),
  parentSpanId: z50.string().optional(),
  additionalProperties: z50.record(z50.string(), z50.nullable(z50.any())).optional()
}).transform((v) => {
  return {
    ...v.additionalProperties,
    ...remap(v, {
      traceId: "trace_id",
      traceName: "trace_name",
      spanName: "span_name",
      generationName: "generation_name",
      parentSpanId: "parent_span_id",
      additionalProperties: null
    })
  };
});
var Effort$outboundSchema = outboundSchema(Effort);
var Reasoning$outboundSchema = z50.object({
  effort: z50.nullable(Effort$outboundSchema).optional(),
  summary: z50.nullable(z50.any()).optional()
});
var ResponseFormat$outboundSchema = z50.union([
  ResponseFormatText$outboundSchema,
  ResponseFormatJSONObject$outboundSchema,
  ResponseFormatJSONSchema$outboundSchema,
  ResponseFormatTextGrammar$outboundSchema,
  ResponseFormatTextPython$outboundSchema
]);
var Stop$outboundSchema = z50.union([
  z50.string(),
  z50.array(z50.string()),
  z50.any()
]);
var ChatGenerationParamsImageConfig$outboundSchema = z50.union([z50.string(), z50.number(), z50.array(z50.nullable(z50.any()))]);
var Modality$outboundSchema = outboundSchema(Modality);
var ChatGenerationParams$outboundSchema = z50.object({
  provider: z50.nullable(z50.lazy(() => ChatGenerationParamsProvider$outboundSchema)).optional(),
  plugins: z50.array(z50.union([
    z50.lazy(() => ChatGenerationParamsPluginAutoRouter$outboundSchema),
    z50.lazy(() => ChatGenerationParamsPluginModeration$outboundSchema),
    z50.lazy(() => ChatGenerationParamsPluginWeb$outboundSchema),
    z50.lazy(() => ChatGenerationParamsPluginFileParser$outboundSchema),
    z50.lazy(() => ChatGenerationParamsPluginResponseHealing$outboundSchema)
  ])).optional(),
  user: z50.string().optional(),
  sessionId: z50.string().optional(),
  trace: z50.lazy(() => ChatGenerationParamsTrace$outboundSchema).optional(),
  messages: z50.array(Message$outboundSchema),
  model: z50.string().optional(),
  models: z50.array(z50.string()).optional(),
  frequencyPenalty: z50.nullable(z50.number()).optional(),
  logitBias: z50.nullable(z50.record(z50.string(), z50.number())).optional(),
  logprobs: z50.nullable(z50.boolean()).optional(),
  topLogprobs: z50.nullable(z50.number()).optional(),
  maxCompletionTokens: z50.nullable(z50.number()).optional(),
  maxTokens: z50.nullable(z50.number()).optional(),
  metadata: z50.record(z50.string(), z50.string()).optional(),
  presencePenalty: z50.nullable(z50.number()).optional(),
  reasoning: z50.lazy(() => Reasoning$outboundSchema).optional(),
  responseFormat: z50.union([
    ResponseFormatText$outboundSchema,
    ResponseFormatJSONObject$outboundSchema,
    ResponseFormatJSONSchema$outboundSchema,
    ResponseFormatTextGrammar$outboundSchema,
    ResponseFormatTextPython$outboundSchema
  ]).optional(),
  seed: z50.nullable(z50.int()).optional(),
  stop: z50.nullable(z50.union([z50.string(), z50.array(z50.string()), z50.any()])).optional(),
  stream: z50.boolean().default(false),
  streamOptions: z50.nullable(ChatStreamOptions$outboundSchema).optional(),
  temperature: z50.nullable(z50.number().default(1)),
  parallelToolCalls: z50.nullable(z50.boolean()).optional(),
  toolChoice: ToolChoiceOption$outboundSchema.optional(),
  tools: z50.array(ToolDefinitionJson$outboundSchema).optional(),
  topP: z50.nullable(z50.number().default(1)),
  debug: DebugOptions$outboundSchema.optional(),
  imageConfig: z50.record(z50.string(), z50.union([z50.string(), z50.number(), z50.array(z50.nullable(z50.any()))])).optional(),
  modalities: z50.array(Modality$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    sessionId: "session_id",
    frequencyPenalty: "frequency_penalty",
    logitBias: "logit_bias",
    topLogprobs: "top_logprobs",
    maxCompletionTokens: "max_completion_tokens",
    maxTokens: "max_tokens",
    presencePenalty: "presence_penalty",
    responseFormat: "response_format",
    streamOptions: "stream_options",
    parallelToolCalls: "parallel_tool_calls",
    toolChoice: "tool_choice",
    topP: "top_p",
    imageConfig: "image_config"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatgenerationtokenusage.js
var z51 = __toESM(require("zod/v4"), 1);
var CompletionTokensDetails$inboundSchema = z51.object({
  reasoning_tokens: z51.nullable(z51.number()).optional(),
  audio_tokens: z51.nullable(z51.number()).optional(),
  accepted_prediction_tokens: z51.nullable(z51.number()).optional(),
  rejected_prediction_tokens: z51.nullable(z51.number()).optional()
}).transform((v) => {
  return remap(v, {
    "reasoning_tokens": "reasoningTokens",
    "audio_tokens": "audioTokens",
    "accepted_prediction_tokens": "acceptedPredictionTokens",
    "rejected_prediction_tokens": "rejectedPredictionTokens"
  });
});
var PromptTokensDetails$inboundSchema = z51.object({
  cached_tokens: z51.number().optional(),
  cache_write_tokens: z51.number().optional(),
  audio_tokens: z51.number().optional(),
  video_tokens: z51.number().optional()
}).transform((v) => {
  return remap(v, {
    "cached_tokens": "cachedTokens",
    "cache_write_tokens": "cacheWriteTokens",
    "audio_tokens": "audioTokens",
    "video_tokens": "videoTokens"
  });
});
var ChatGenerationTokenUsage$inboundSchema = z51.object({
  completion_tokens: z51.number(),
  prompt_tokens: z51.number(),
  total_tokens: z51.number(),
  completion_tokens_details: z51.nullable(z51.lazy(() => CompletionTokensDetails$inboundSchema)).optional(),
  prompt_tokens_details: z51.nullable(z51.lazy(() => PromptTokensDetails$inboundSchema)).optional()
}).transform((v) => {
  return remap(v, {
    "completion_tokens": "completionTokens",
    "prompt_tokens": "promptTokens",
    "total_tokens": "totalTokens",
    "completion_tokens_details": "completionTokensDetails",
    "prompt_tokens_details": "promptTokensDetails"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatmessagetokenlogprob.js
var z52 = __toESM(require("zod/v4"), 1);
var ChatMessageTokenLogprobTopLogprob$inboundSchema = z52.object({
  token: z52.string(),
  logprob: z52.number(),
  bytes: z52.nullable(z52.array(z52.number()))
});
var ChatMessageTokenLogprob$inboundSchema = z52.object({
  token: z52.string(),
  logprob: z52.number(),
  bytes: z52.nullable(z52.array(z52.number())),
  top_logprobs: z52.array(z52.lazy(() => ChatMessageTokenLogprobTopLogprob$inboundSchema))
}).transform((v) => {
  return remap(v, {
    "top_logprobs": "topLogprobs"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatmessagetokenlogprobs.js
var z53 = __toESM(require("zod/v4"), 1);
var ChatMessageTokenLogprobs$inboundSchema = z53.object({
  content: z53.nullable(z53.array(ChatMessageTokenLogprob$inboundSchema)),
  refusal: z53.nullable(z53.array(ChatMessageTokenLogprob$inboundSchema))
});

// node_modules/@openrouter/sdk/esm/models/chatresponse.js
var z55 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatresponsechoice.js
var z54 = __toESM(require("zod/v4"), 1);
var ChatResponseChoice$inboundSchema = z54.object({
  finish_reason: z54.nullable(z54.any()).optional(),
  index: z54.number(),
  message: AssistantMessage$inboundSchema,
  logprobs: z54.nullable(ChatMessageTokenLogprobs$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "finish_reason": "finishReason"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatresponse.js
var ChatResponseObject = {
  ChatCompletion: "chat.completion"
};
var ChatResponseObject$inboundSchema = z55.enum(ChatResponseObject);
var ChatResponse$inboundSchema = z55.object({
  id: z55.string(),
  choices: z55.array(ChatResponseChoice$inboundSchema),
  created: z55.number(),
  model: z55.string(),
  object: ChatResponseObject$inboundSchema,
  system_fingerprint: z55.nullable(z55.string()).optional(),
  usage: ChatGenerationTokenUsage$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "system_fingerprint": "systemFingerprint"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatstreamingchoice.js
var z58 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatstreamingmessagechunk.js
var z57 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatstreamingmessagetoolcall.js
var z56 = __toESM(require("zod/v4"), 1);
var ChatStreamingMessageToolCallType = {
  Function: "function"
};
var ChatStreamingMessageToolCallType$inboundSchema = z56.enum(ChatStreamingMessageToolCallType);
var ChatStreamingMessageToolCallFunction$inboundSchema = z56.object({
  name: z56.string().optional(),
  arguments: z56.string().optional()
});
var ChatStreamingMessageToolCall$inboundSchema = z56.object({
  index: z56.number(),
  id: z56.nullable(z56.string()).optional(),
  type: ChatStreamingMessageToolCallType$inboundSchema.optional(),
  function: z56.lazy(() => ChatStreamingMessageToolCallFunction$inboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/chatstreamingmessagechunk.js
var ChatStreamingMessageChunkRole = {
  Assistant: "assistant"
};
var ChatStreamingMessageChunkRole$inboundSchema = z57.enum(ChatStreamingMessageChunkRole);
var ChatStreamingMessageChunk$inboundSchema = z57.object({
  role: ChatStreamingMessageChunkRole$inboundSchema.optional(),
  content: z57.nullable(z57.string()).optional(),
  reasoning: z57.nullable(z57.string()).optional(),
  refusal: z57.nullable(z57.string()).optional(),
  tool_calls: z57.array(ChatStreamingMessageToolCall$inboundSchema).optional(),
  reasoning_details: z57.array(ReasoningDetailUnion$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "tool_calls": "toolCalls",
    "reasoning_details": "reasoningDetails"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatstreamingchoice.js
var ChatStreamingChoice$inboundSchema = z58.object({
  delta: ChatStreamingMessageChunk$inboundSchema,
  finish_reason: z58.nullable(z58.any()).optional(),
  index: z58.number(),
  logprobs: z58.nullable(ChatMessageTokenLogprobs$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "finish_reason": "finishReason"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatstreamingresponsechunk.js
var z59 = __toESM(require("zod/v4"), 1);
var ChatStreamingResponseChunkObject = {
  ChatCompletionChunk: "chat.completion.chunk"
};
var ChatStreamingResponseChunkObject$inboundSchema = z59.enum(ChatStreamingResponseChunkObject);
var ErrorT$inboundSchema = z59.object({
  message: z59.string(),
  code: z59.number()
});
var ChatStreamingResponseChunk$inboundSchema = z59.object({
  id: z59.string(),
  choices: z59.array(ChatStreamingChoice$inboundSchema),
  created: z59.number(),
  model: z59.string(),
  object: ChatStreamingResponseChunkObject$inboundSchema,
  system_fingerprint: z59.nullable(z59.string()).optional(),
  error: z59.lazy(() => ErrorT$inboundSchema).optional(),
  usage: ChatGenerationTokenUsage$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "system_fingerprint": "systemFingerprint"
  });
});

// node_modules/@openrouter/sdk/esm/models/createchargerequest.js
var z60 = __toESM(require("zod/v4"), 1);
var ChainId = {
  One: 1,
  OneHundredAndThirtySeven: 137,
  EightThousandFourHundredAndFiftyThree: 8453
};
var ChainId$outboundSchema = outboundSchemaInt(ChainId);
var CreateChargeRequest$outboundSchema = z60.object({
  amount: z60.number(),
  sender: z60.string(),
  chainId: ChainId$outboundSchema
}).transform((v) => {
  return remap(v, {
    chainId: "chain_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/defaultparameters.js
var z61 = __toESM(require("zod/v4"), 1);
var DefaultParameters$inboundSchema = z61.object({
  temperature: z61.nullable(z61.number()).optional(),
  top_p: z61.nullable(z61.number()).optional(),
  frequency_penalty: z61.nullable(z61.number()).optional()
}).transform((v) => {
  return remap(v, {
    "top_p": "topP",
    "frequency_penalty": "frequencyPenalty"
  });
});

// node_modules/@openrouter/sdk/esm/models/edgenetworktimeoutresponseerrordata.js
var z62 = __toESM(require("zod/v4"), 1);
var EdgeNetworkTimeoutResponseErrorData$inboundSchema = z62.object({
  code: z62.int(),
  message: z62.string(),
  metadata: z62.nullable(z62.record(z62.string(), z62.nullable(z62.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/endpointstatus.js
var EndpointStatus = {
  Zero: 0,
  Minus1: -1,
  Minus2: -2,
  Minus3: -3,
  Minus5: -5,
  Minus10: -10
};
var EndpointStatus$inboundSchema = inboundSchemaInt(EndpointStatus);

// node_modules/@openrouter/sdk/esm/models/filecitation.js
var z63 = __toESM(require("zod/v4"), 1);
var FileCitation$inboundSchema = z63.object({
  type: z63.literal("file_citation"),
  file_id: z63.string(),
  filename: z63.string(),
  index: z63.number()
}).transform((v) => {
  return remap(v, {
    "file_id": "fileId"
  });
});
var FileCitation$outboundSchema = z63.object({
  type: z63.literal("file_citation"),
  fileId: z63.string(),
  filename: z63.string(),
  index: z63.number()
}).transform((v) => {
  return remap(v, {
    fileId: "file_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/filepath.js
var z64 = __toESM(require("zod/v4"), 1);
var FilePath$inboundSchema = z64.object({
  type: z64.literal("file_path"),
  file_id: z64.string(),
  index: z64.number()
}).transform((v) => {
  return remap(v, {
    "file_id": "fileId"
  });
});
var FilePath$outboundSchema = z64.object({
  type: z64.literal("file_path"),
  fileId: z64.string(),
  index: z64.number()
}).transform((v) => {
  return remap(v, {
    fileId: "file_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/forbiddenresponseerrordata.js
var z65 = __toESM(require("zod/v4"), 1);
var ForbiddenResponseErrorData$inboundSchema = z65.object({
  code: z65.int(),
  message: z65.string(),
  metadata: z65.nullable(z65.record(z65.string(), z65.nullable(z65.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/imagegenerationstatus.js
var ImageGenerationStatus = {
  InProgress: "in_progress",
  Completed: "completed",
  Generating: "generating",
  Failed: "failed"
};
var ImageGenerationStatus$inboundSchema = inboundSchema(ImageGenerationStatus);
var ImageGenerationStatus$outboundSchema = outboundSchema(ImageGenerationStatus);

// node_modules/@openrouter/sdk/esm/models/inputmodality.js
var InputModality = {
  Text: "text",
  Image: "image",
  File: "file",
  Audio: "audio",
  Video: "video"
};
var InputModality$inboundSchema = inboundSchema(InputModality);

// node_modules/@openrouter/sdk/esm/models/instructtype.js
var InstructType = {
  None: "none",
  Airoboros: "airoboros",
  Alpaca: "alpaca",
  AlpacaModif: "alpaca-modif",
  Chatml: "chatml",
  Claude: "claude",
  CodeLlama: "code-llama",
  Gemma: "gemma",
  Llama2: "llama2",
  Llama3: "llama3",
  Mistral: "mistral",
  Nemotron: "nemotron",
  Neural: "neural",
  Openchat: "openchat",
  Phi3: "phi3",
  Rwkv: "rwkv",
  Vicuna: "vicuna",
  Zephyr: "zephyr",
  DeepseekR1: "deepseek-r1",
  DeepseekV31: "deepseek-v3.1",
  Qwq: "qwq",
  Qwen3: "qwen3"
};
var InstructType$inboundSchema = inboundSchema(InstructType);

// node_modules/@openrouter/sdk/esm/models/internalserverresponseerrordata.js
var z66 = __toESM(require("zod/v4"), 1);
var InternalServerResponseErrorData$inboundSchema = z66.object({
  code: z66.int(),
  message: z66.string(),
  metadata: z66.nullable(z66.record(z66.string(), z66.nullable(z66.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/listendpointsresponse.js
var z69 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/outputmodality.js
var OutputModality = {
  Text: "text",
  Image: "image",
  Embeddings: "embeddings",
  Audio: "audio"
};
var OutputModality$inboundSchema = inboundSchema(OutputModality);

// node_modules/@openrouter/sdk/esm/models/publicendpoint.js
var z68 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/parameter.js
var Parameter = {
  Temperature: "temperature",
  TopP: "top_p",
  TopK: "top_k",
  MinP: "min_p",
  TopA: "top_a",
  FrequencyPenalty: "frequency_penalty",
  PresencePenalty: "presence_penalty",
  RepetitionPenalty: "repetition_penalty",
  MaxTokens: "max_tokens",
  LogitBias: "logit_bias",
  Logprobs: "logprobs",
  TopLogprobs: "top_logprobs",
  Seed: "seed",
  ResponseFormat: "response_format",
  StructuredOutputs: "structured_outputs",
  Stop: "stop",
  Tools: "tools",
  ToolChoice: "tool_choice",
  ParallelToolCalls: "parallel_tool_calls",
  IncludeReasoning: "include_reasoning",
  Reasoning: "reasoning",
  ReasoningEffort: "reasoning_effort",
  WebSearchOptions: "web_search_options",
  Verbosity: "verbosity"
};
var Parameter$inboundSchema = inboundSchema(Parameter);

// node_modules/@openrouter/sdk/esm/models/percentilestats.js
var z67 = __toESM(require("zod/v4"), 1);
var PercentileStats$inboundSchema = z67.object({
  p50: z67.number(),
  p75: z67.number(),
  p90: z67.number(),
  p99: z67.number()
});

// node_modules/@openrouter/sdk/esm/models/publicendpoint.js
var PublicEndpointQuantization = {
  Int4: "int4",
  Int8: "int8",
  Fp4: "fp4",
  Fp6: "fp6",
  Fp8: "fp8",
  Fp16: "fp16",
  Bf16: "bf16",
  Fp32: "fp32",
  Unknown: "unknown"
};
var Pricing$inboundSchema = z68.object({
  prompt: z68.string(),
  completion: z68.string(),
  request: z68.string().optional(),
  image: z68.string().optional(),
  image_token: z68.string().optional(),
  image_output: z68.string().optional(),
  audio: z68.string().optional(),
  audio_output: z68.string().optional(),
  input_audio_cache: z68.string().optional(),
  web_search: z68.string().optional(),
  internal_reasoning: z68.string().optional(),
  input_cache_read: z68.string().optional(),
  input_cache_write: z68.string().optional(),
  discount: z68.number().optional()
}).transform((v) => {
  return remap(v, {
    "image_token": "imageToken",
    "image_output": "imageOutput",
    "audio_output": "audioOutput",
    "input_audio_cache": "inputAudioCache",
    "web_search": "webSearch",
    "internal_reasoning": "internalReasoning",
    "input_cache_read": "inputCacheRead",
    "input_cache_write": "inputCacheWrite"
  });
});
var PublicEndpointQuantization$inboundSchema = inboundSchema(PublicEndpointQuantization);
var PublicEndpoint$inboundSchema = z68.object({
  name: z68.string(),
  model_id: z68.string(),
  model_name: z68.string(),
  context_length: z68.number(),
  pricing: z68.lazy(() => Pricing$inboundSchema),
  provider_name: ProviderName$inboundSchema,
  tag: z68.string(),
  quantization: z68.nullable(PublicEndpointQuantization$inboundSchema),
  max_completion_tokens: z68.nullable(z68.number()),
  max_prompt_tokens: z68.nullable(z68.number()),
  supported_parameters: z68.array(Parameter$inboundSchema),
  status: EndpointStatus$inboundSchema.optional(),
  uptime_last_30m: z68.nullable(z68.number()),
  supports_implicit_caching: z68.boolean(),
  latency_last_30m: z68.nullable(PercentileStats$inboundSchema),
  throughput_last_30m: z68.nullable(PercentileStats$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "model_id": "modelId",
    "model_name": "modelName",
    "context_length": "contextLength",
    "provider_name": "providerName",
    "max_completion_tokens": "maxCompletionTokens",
    "max_prompt_tokens": "maxPromptTokens",
    "supported_parameters": "supportedParameters",
    "uptime_last_30m": "uptimeLast30m",
    "supports_implicit_caching": "supportsImplicitCaching",
    "latency_last_30m": "latencyLast30m",
    "throughput_last_30m": "throughputLast30m"
  });
});

// node_modules/@openrouter/sdk/esm/models/listendpointsresponse.js
var Tokenizer = {
  Router: "Router",
  Media: "Media",
  Other: "Other",
  Gpt: "GPT",
  Claude: "Claude",
  Gemini: "Gemini",
  Grok: "Grok",
  Cohere: "Cohere",
  Nova: "Nova",
  Qwen: "Qwen",
  Yi: "Yi",
  DeepSeek: "DeepSeek",
  Mistral: "Mistral",
  Llama2: "Llama2",
  Llama3: "Llama3",
  Llama4: "Llama4",
  PaLM: "PaLM",
  Rwkv: "RWKV",
  Qwen3: "Qwen3"
};
var Tokenizer$inboundSchema = inboundSchema(Tokenizer);
var Architecture$inboundSchema = z69.object({
  tokenizer: z69.nullable(Tokenizer$inboundSchema),
  instruct_type: z69.nullable(InstructType$inboundSchema),
  modality: z69.nullable(z69.string()),
  input_modalities: z69.array(InputModality$inboundSchema),
  output_modalities: z69.array(OutputModality$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "instruct_type": "instructType",
    "input_modalities": "inputModalities",
    "output_modalities": "outputModalities"
  });
});
var ListEndpointsResponse$inboundSchema = z69.object({
  id: z69.string(),
  name: z69.string(),
  created: z69.number(),
  description: z69.string(),
  architecture: z69.lazy(() => Architecture$inboundSchema),
  endpoints: z69.array(PublicEndpoint$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/model.js
var z74 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/modelarchitecture.js
var z70 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/modelgroup.js
var ModelGroup = {
  Router: "Router",
  Media: "Media",
  Other: "Other",
  Gpt: "GPT",
  Claude: "Claude",
  Gemini: "Gemini",
  Grok: "Grok",
  Cohere: "Cohere",
  Nova: "Nova",
  Qwen: "Qwen",
  Yi: "Yi",
  DeepSeek: "DeepSeek",
  Mistral: "Mistral",
  Llama2: "Llama2",
  Llama3: "Llama3",
  Llama4: "Llama4",
  PaLM: "PaLM",
  Rwkv: "RWKV",
  Qwen3: "Qwen3"
};
var ModelGroup$inboundSchema = inboundSchema(ModelGroup);

// node_modules/@openrouter/sdk/esm/models/modelarchitecture.js
var ModelArchitectureInstructType = {
  None: "none",
  Airoboros: "airoboros",
  Alpaca: "alpaca",
  AlpacaModif: "alpaca-modif",
  Chatml: "chatml",
  Claude: "claude",
  CodeLlama: "code-llama",
  Gemma: "gemma",
  Llama2: "llama2",
  Llama3: "llama3",
  Mistral: "mistral",
  Nemotron: "nemotron",
  Neural: "neural",
  Openchat: "openchat",
  Phi3: "phi3",
  Rwkv: "rwkv",
  Vicuna: "vicuna",
  Zephyr: "zephyr",
  DeepseekR1: "deepseek-r1",
  DeepseekV31: "deepseek-v3.1",
  Qwq: "qwq",
  Qwen3: "qwen3"
};
var ModelArchitectureInstructType$inboundSchema = inboundSchema(ModelArchitectureInstructType);
var ModelArchitecture$inboundSchema = z70.object({
  tokenizer: ModelGroup$inboundSchema.optional(),
  instruct_type: z70.nullable(ModelArchitectureInstructType$inboundSchema).optional(),
  modality: z70.nullable(z70.string()),
  input_modalities: z70.array(InputModality$inboundSchema),
  output_modalities: z70.array(OutputModality$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "instruct_type": "instructType",
    "input_modalities": "inputModalities",
    "output_modalities": "outputModalities"
  });
});

// node_modules/@openrouter/sdk/esm/models/perrequestlimits.js
var z71 = __toESM(require("zod/v4"), 1);
var PerRequestLimits$inboundSchema = z71.object({
  prompt_tokens: z71.number(),
  completion_tokens: z71.number()
}).transform((v) => {
  return remap(v, {
    "prompt_tokens": "promptTokens",
    "completion_tokens": "completionTokens"
  });
});

// node_modules/@openrouter/sdk/esm/models/publicpricing.js
var z72 = __toESM(require("zod/v4"), 1);
var PublicPricing$inboundSchema = z72.object({
  prompt: z72.string(),
  completion: z72.string(),
  request: z72.string().optional(),
  image: z72.string().optional(),
  image_token: z72.string().optional(),
  image_output: z72.string().optional(),
  audio: z72.string().optional(),
  audio_output: z72.string().optional(),
  input_audio_cache: z72.string().optional(),
  web_search: z72.string().optional(),
  internal_reasoning: z72.string().optional(),
  input_cache_read: z72.string().optional(),
  input_cache_write: z72.string().optional(),
  discount: z72.number().optional()
}).transform((v) => {
  return remap(v, {
    "image_token": "imageToken",
    "image_output": "imageOutput",
    "audio_output": "audioOutput",
    "input_audio_cache": "inputAudioCache",
    "web_search": "webSearch",
    "internal_reasoning": "internalReasoning",
    "input_cache_read": "inputCacheRead",
    "input_cache_write": "inputCacheWrite"
  });
});

// node_modules/@openrouter/sdk/esm/models/topproviderinfo.js
var z73 = __toESM(require("zod/v4"), 1);
var TopProviderInfo$inboundSchema = z73.object({
  context_length: z73.nullable(z73.number()).optional(),
  max_completion_tokens: z73.nullable(z73.number()).optional(),
  is_moderated: z73.boolean()
}).transform((v) => {
  return remap(v, {
    "context_length": "contextLength",
    "max_completion_tokens": "maxCompletionTokens",
    "is_moderated": "isModerated"
  });
});

// node_modules/@openrouter/sdk/esm/models/model.js
var Model$inboundSchema = z74.object({
  id: z74.string(),
  canonical_slug: z74.string(),
  hugging_face_id: z74.nullable(z74.string()).optional(),
  name: z74.string(),
  created: z74.number(),
  description: z74.string().optional(),
  pricing: PublicPricing$inboundSchema,
  context_length: z74.nullable(z74.number()),
  architecture: ModelArchitecture$inboundSchema,
  top_provider: TopProviderInfo$inboundSchema,
  per_request_limits: z74.nullable(PerRequestLimits$inboundSchema),
  supported_parameters: z74.array(Parameter$inboundSchema),
  default_parameters: z74.nullable(DefaultParameters$inboundSchema),
  expiration_date: z74.nullable(z74.string()).optional()
}).transform((v) => {
  return remap(v, {
    "canonical_slug": "canonicalSlug",
    "hugging_face_id": "huggingFaceId",
    "context_length": "contextLength",
    "top_provider": "topProvider",
    "per_request_limits": "perRequestLimits",
    "supported_parameters": "supportedParameters",
    "default_parameters": "defaultParameters",
    "expiration_date": "expirationDate"
  });
});

// node_modules/@openrouter/sdk/esm/models/modelscountresponse.js
var z75 = __toESM(require("zod/v4"), 1);
var Data$inboundSchema = z75.object({
  count: z75.number()
});
var ModelsCountResponse$inboundSchema = z75.object({
  data: z75.lazy(() => Data$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/modelslistresponse.js
var z76 = __toESM(require("zod/v4"), 1);
var ModelsListResponse$inboundSchema = z76.object({
  data: z76.array(Model$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/notfoundresponseerrordata.js
var z77 = __toESM(require("zod/v4"), 1);
var NotFoundResponseErrorData$inboundSchema = z77.object({
  code: z77.int(),
  message: z77.string(),
  metadata: z77.nullable(z77.record(z77.string(), z77.nullable(z77.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/openairesponsesannotation.js
var z79 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/urlcitation.js
var z78 = __toESM(require("zod/v4"), 1);
var URLCitation$inboundSchema = z78.object({
  type: z78.literal("url_citation"),
  url: z78.string(),
  title: z78.string(),
  start_index: z78.number(),
  end_index: z78.number()
}).transform((v) => {
  return remap(v, {
    "start_index": "startIndex",
    "end_index": "endIndex"
  });
});
var URLCitation$outboundSchema = z78.object({
  type: z78.literal("url_citation"),
  url: z78.string(),
  title: z78.string(),
  startIndex: z78.number(),
  endIndex: z78.number()
}).transform((v) => {
  return remap(v, {
    startIndex: "start_index",
    endIndex: "end_index"
  });
});

// node_modules/@openrouter/sdk/esm/models/openairesponsesannotation.js
var OpenAIResponsesAnnotation$inboundSchema = z79.union([
  FileCitation$inboundSchema,
  URLCitation$inboundSchema,
  FilePath$inboundSchema
]);
var OpenAIResponsesAnnotation$outboundSchema = z79.union([
  FileCitation$outboundSchema,
  URLCitation$outboundSchema,
  FilePath$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/openairesponsesincludable.js
var OpenAIResponsesIncludable = {
  FileSearchCallResults: "file_search_call.results",
  MessageInputImageImageUrl: "message.input_image.image_url",
  ComputerCallOutputOutputImageUrl: "computer_call_output.output.image_url",
  ReasoningEncryptedContent: "reasoning.encrypted_content",
  CodeInterpreterCallOutputs: "code_interpreter_call.outputs"
};
var OpenAIResponsesIncludable$outboundSchema = outboundSchema(OpenAIResponsesIncludable);

// node_modules/@openrouter/sdk/esm/models/openairesponsesincompletedetails.js
var z80 = __toESM(require("zod/v4"), 1);
var Reason = {
  MaxOutputTokens: "max_output_tokens",
  ContentFilter: "content_filter"
};
var Reason$inboundSchema = inboundSchema(Reason);
var OpenAIResponsesIncompleteDetails$inboundSchema = z80.object({
  reason: Reason$inboundSchema.optional()
});

// node_modules/@openrouter/sdk/esm/models/openairesponsesinputunion.js
var z86 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/outputitemimagegenerationcall.js
var z81 = __toESM(require("zod/v4"), 1);
var OutputItemImageGenerationCallType = {
  ImageGenerationCall: "image_generation_call"
};
var OutputItemImageGenerationCallType$inboundSchema = z81.enum(OutputItemImageGenerationCallType);
var OutputItemImageGenerationCall$inboundSchema = z81.object({
  type: OutputItemImageGenerationCallType$inboundSchema,
  id: z81.string(),
  result: z81.nullable(z81.string()).default(null),
  status: ImageGenerationStatus$inboundSchema
});

// node_modules/@openrouter/sdk/esm/models/outputmessage.js
var z84 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/openairesponsesrefusalcontent.js
var z82 = __toESM(require("zod/v4"), 1);
var OpenAIResponsesRefusalContent$inboundSchema = z82.object({
  type: z82.literal("refusal"),
  refusal: z82.string()
});
var OpenAIResponsesRefusalContent$outboundSchema = z82.object({
  type: z82.literal("refusal"),
  refusal: z82.string()
});

// node_modules/@openrouter/sdk/esm/models/responseoutputtext.js
var z83 = __toESM(require("zod/v4"), 1);
var ResponseOutputTextTopLogprob$inboundSchema = z83.object({
  token: z83.string(),
  bytes: z83.array(z83.number()),
  logprob: z83.number()
});
var ResponseOutputTextTopLogprob$outboundSchema = z83.object({
  token: z83.string(),
  bytes: z83.array(z83.number()),
  logprob: z83.number()
});
var Logprob$inboundSchema = z83.object({
  token: z83.string(),
  bytes: z83.array(z83.number()),
  logprob: z83.number(),
  top_logprobs: z83.array(z83.lazy(() => ResponseOutputTextTopLogprob$inboundSchema))
}).transform((v) => {
  return remap(v, {
    "top_logprobs": "topLogprobs"
  });
});
var Logprob$outboundSchema = z83.object({
  token: z83.string(),
  bytes: z83.array(z83.number()),
  logprob: z83.number(),
  topLogprobs: z83.array(z83.lazy(() => ResponseOutputTextTopLogprob$outboundSchema))
}).transform((v) => {
  return remap(v, {
    topLogprobs: "top_logprobs"
  });
});
var ResponseOutputText$inboundSchema = z83.object({
  type: z83.literal("output_text"),
  text: z83.string(),
  annotations: z83.array(OpenAIResponsesAnnotation$inboundSchema).optional(),
  logprobs: z83.array(z83.lazy(() => Logprob$inboundSchema)).optional()
});
var ResponseOutputText$outboundSchema = z83.object({
  type: z83.literal("output_text"),
  text: z83.string(),
  annotations: z83.array(OpenAIResponsesAnnotation$outboundSchema).optional(),
  logprobs: z83.array(z83.lazy(() => Logprob$outboundSchema)).optional()
});

// node_modules/@openrouter/sdk/esm/models/outputmessage.js
var OutputMessageRole = {
  Assistant: "assistant"
};
var OutputMessageType = {
  Message: "message"
};
var OutputMessageStatusInProgress = {
  InProgress: "in_progress"
};
var OutputMessageStatusIncomplete = {
  Incomplete: "incomplete"
};
var OutputMessageStatusCompleted = {
  Completed: "completed"
};
var OutputMessageRole$inboundSchema = z84.enum(OutputMessageRole);
var OutputMessageType$inboundSchema = z84.enum(OutputMessageType);
var OutputMessageStatusInProgress$inboundSchema = z84.enum(OutputMessageStatusInProgress);
var OutputMessageStatusIncomplete$inboundSchema = z84.enum(OutputMessageStatusIncomplete);
var OutputMessageStatusCompleted$inboundSchema = z84.enum(OutputMessageStatusCompleted);
var OutputMessageStatusUnion$inboundSchema = z84.union([
  OutputMessageStatusCompleted$inboundSchema,
  OutputMessageStatusIncomplete$inboundSchema,
  OutputMessageStatusInProgress$inboundSchema
]);
var OutputMessageContent$inboundSchema = z84.union([
  ResponseOutputText$inboundSchema,
  OpenAIResponsesRefusalContent$inboundSchema
]);
var OutputMessage$inboundSchema = z84.object({
  id: z84.string(),
  role: OutputMessageRole$inboundSchema,
  type: OutputMessageType$inboundSchema,
  status: z84.union([
    OutputMessageStatusCompleted$inboundSchema,
    OutputMessageStatusIncomplete$inboundSchema,
    OutputMessageStatusInProgress$inboundSchema
  ]).optional(),
  content: z84.array(z84.union([
    ResponseOutputText$inboundSchema,
    OpenAIResponsesRefusalContent$inboundSchema
  ]))
});

// node_modules/@openrouter/sdk/esm/models/responseinputimage.js
var z85 = __toESM(require("zod/v4"), 1);
var ResponseInputImageType = {
  InputImage: "input_image"
};
var ResponseInputImageDetail = {
  Auto: "auto",
  High: "high",
  Low: "low"
};
var ResponseInputImageType$inboundSchema = z85.enum(ResponseInputImageType);
var ResponseInputImageType$outboundSchema = ResponseInputImageType$inboundSchema;
var ResponseInputImageDetail$inboundSchema = inboundSchema(ResponseInputImageDetail);
var ResponseInputImageDetail$outboundSchema = outboundSchema(ResponseInputImageDetail);
var ResponseInputImage$inboundSchema = z85.object({
  type: ResponseInputImageType$inboundSchema,
  detail: ResponseInputImageDetail$inboundSchema,
  image_url: z85.nullable(z85.string()).optional()
}).transform((v) => {
  return remap(v, {
    "image_url": "imageUrl"
  });
});
var ResponseInputImage$outboundSchema = z85.object({
  type: ResponseInputImageType$outboundSchema,
  detail: ResponseInputImageDetail$outboundSchema,
  imageUrl: z85.nullable(z85.string()).optional()
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/openairesponsesinputunion.js
var OpenAIResponsesInputTypeFunctionCall = {
  FunctionCall: "function_call"
};
var OpenAIResponsesInputTypeFunctionCallOutput = {
  FunctionCallOutput: "function_call_output"
};
var OpenAIResponsesInputTypeMessage2 = {
  Message: "message"
};
var OpenAIResponsesInputRoleDeveloper2 = {
  Developer: "developer"
};
var OpenAIResponsesInputRoleSystem2 = {
  System: "system"
};
var OpenAIResponsesInputRoleUser2 = {
  User: "user"
};
var OpenAIResponsesInputTypeMessage1 = {
  Message: "message"
};
var OpenAIResponsesInputRoleDeveloper1 = {
  Developer: "developer"
};
var OpenAIResponsesInputRoleAssistant = {
  Assistant: "assistant"
};
var OpenAIResponsesInputRoleSystem1 = {
  System: "system"
};
var OpenAIResponsesInputRoleUser1 = {
  User: "user"
};
var OpenAIResponsesInputTypeFunctionCall$inboundSchema = z86.enum(OpenAIResponsesInputTypeFunctionCall);
var OpenAIResponsesInputFunctionCall$inboundSchema = z86.object({
  type: OpenAIResponsesInputTypeFunctionCall$inboundSchema,
  call_id: z86.string(),
  name: z86.string(),
  arguments: z86.string(),
  id: z86.string().optional(),
  status: z86.nullable(ToolCallStatus$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "call_id": "callId"
  });
});
var OpenAIResponsesInputTypeFunctionCallOutput$inboundSchema = z86.enum(OpenAIResponsesInputTypeFunctionCallOutput);
var OpenAIResponsesInputFunctionCallOutput$inboundSchema = z86.object({
  type: OpenAIResponsesInputTypeFunctionCallOutput$inboundSchema,
  id: z86.nullable(z86.string()).optional(),
  call_id: z86.string(),
  output: z86.string(),
  status: z86.nullable(ToolCallStatus$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "call_id": "callId"
  });
});
var OpenAIResponsesInputTypeMessage2$inboundSchema = z86.enum(OpenAIResponsesInputTypeMessage2);
var OpenAIResponsesInputRoleDeveloper2$inboundSchema = z86.enum(OpenAIResponsesInputRoleDeveloper2);
var OpenAIResponsesInputRoleSystem2$inboundSchema = z86.enum(OpenAIResponsesInputRoleSystem2);
var OpenAIResponsesInputRoleUser2$inboundSchema = z86.enum(OpenAIResponsesInputRoleUser2);
var OpenAIResponsesInputRoleUnion2$inboundSchema = z86.union([
  OpenAIResponsesInputRoleUser2$inboundSchema,
  OpenAIResponsesInputRoleSystem2$inboundSchema,
  OpenAIResponsesInputRoleDeveloper2$inboundSchema
]);
var OpenAIResponsesInputContent3$inboundSchema = z86.union([
  ResponseInputText$inboundSchema,
  ResponseInputImage$inboundSchema.and(z86.object({ type: z86.literal("input_image") })),
  ResponseInputFile$inboundSchema,
  ResponseInputAudio$inboundSchema
]);
var OpenAIResponsesInputMessage2$inboundSchema = z86.object({
  id: z86.string(),
  type: OpenAIResponsesInputTypeMessage2$inboundSchema.optional(),
  role: z86.union([
    OpenAIResponsesInputRoleUser2$inboundSchema,
    OpenAIResponsesInputRoleSystem2$inboundSchema,
    OpenAIResponsesInputRoleDeveloper2$inboundSchema
  ]),
  content: z86.array(z86.union([
    ResponseInputText$inboundSchema,
    ResponseInputImage$inboundSchema.and(z86.object({ type: z86.literal("input_image") })),
    ResponseInputFile$inboundSchema,
    ResponseInputAudio$inboundSchema
  ]))
});
var OpenAIResponsesInputTypeMessage1$inboundSchema = z86.enum(OpenAIResponsesInputTypeMessage1);
var OpenAIResponsesInputRoleDeveloper1$inboundSchema = z86.enum(OpenAIResponsesInputRoleDeveloper1);
var OpenAIResponsesInputRoleAssistant$inboundSchema = z86.enum(OpenAIResponsesInputRoleAssistant);
var OpenAIResponsesInputRoleSystem1$inboundSchema = z86.enum(OpenAIResponsesInputRoleSystem1);
var OpenAIResponsesInputRoleUser1$inboundSchema = z86.enum(OpenAIResponsesInputRoleUser1);
var OpenAIResponsesInputRoleUnion1$inboundSchema = z86.union([
  OpenAIResponsesInputRoleUser1$inboundSchema,
  OpenAIResponsesInputRoleSystem1$inboundSchema,
  OpenAIResponsesInputRoleAssistant$inboundSchema,
  OpenAIResponsesInputRoleDeveloper1$inboundSchema
]);
var OpenAIResponsesInputContent1$inboundSchema = z86.union([
  ResponseInputText$inboundSchema,
  ResponseInputImage$inboundSchema.and(z86.object({ type: z86.literal("input_image") })),
  ResponseInputFile$inboundSchema,
  ResponseInputAudio$inboundSchema
]);
var OpenAIResponsesInputContent2$inboundSchema = z86.union([
  z86.array(z86.union([
    ResponseInputText$inboundSchema,
    ResponseInputImage$inboundSchema.and(z86.object({ type: z86.literal("input_image") })),
    ResponseInputFile$inboundSchema,
    ResponseInputAudio$inboundSchema
  ])),
  z86.string()
]);
var OpenAIResponsesInputMessage1$inboundSchema = z86.object({
  type: OpenAIResponsesInputTypeMessage1$inboundSchema.optional(),
  role: z86.union([
    OpenAIResponsesInputRoleUser1$inboundSchema,
    OpenAIResponsesInputRoleSystem1$inboundSchema,
    OpenAIResponsesInputRoleAssistant$inboundSchema,
    OpenAIResponsesInputRoleDeveloper1$inboundSchema
  ]),
  content: z86.union([
    z86.array(z86.union([
      ResponseInputText$inboundSchema,
      ResponseInputImage$inboundSchema.and(z86.object({ type: z86.literal("input_image") })),
      ResponseInputFile$inboundSchema,
      ResponseInputAudio$inboundSchema
    ])),
    z86.string()
  ])
});
var OpenAIResponsesInputUnion1$inboundSchema = z86.union([
  z86.lazy(() => OpenAIResponsesInputFunctionCall$inboundSchema),
  OutputMessage$inboundSchema,
  z86.lazy(() => OpenAIResponsesInputMessage2$inboundSchema),
  z86.lazy(() => OpenAIResponsesInputFunctionCallOutput$inboundSchema),
  OutputItemImageGenerationCall$inboundSchema,
  z86.lazy(() => OpenAIResponsesInputMessage1$inboundSchema)
]);
var OpenAIResponsesInputUnion$inboundSchema = z86.union([
  z86.string(),
  z86.array(z86.union([
    z86.lazy(() => OpenAIResponsesInputFunctionCall$inboundSchema),
    OutputMessage$inboundSchema,
    z86.lazy(() => OpenAIResponsesInputMessage2$inboundSchema),
    z86.lazy(() => OpenAIResponsesInputFunctionCallOutput$inboundSchema),
    OutputItemImageGenerationCall$inboundSchema,
    z86.lazy(() => OpenAIResponsesInputMessage1$inboundSchema)
  ])),
  z86.any()
]);

// node_modules/@openrouter/sdk/esm/models/openairesponsesprompt.js
var z87 = __toESM(require("zod/v4"), 1);
var Variables$inboundSchema = z87.union([
  ResponseInputText$inboundSchema,
  ResponseInputImage$inboundSchema,
  ResponseInputFile$inboundSchema,
  z87.string()
]);
var Variables$outboundSchema = z87.union([
  ResponseInputText$outboundSchema,
  ResponseInputImage$outboundSchema,
  ResponseInputFile$outboundSchema,
  z87.string()
]);
var OpenAIResponsesPrompt$inboundSchema = z87.object({
  id: z87.string(),
  variables: z87.nullable(z87.record(z87.string(), z87.union([
    ResponseInputText$inboundSchema,
    ResponseInputImage$inboundSchema,
    ResponseInputFile$inboundSchema,
    z87.string()
  ]))).optional()
});
var OpenAIResponsesPrompt$outboundSchema = z87.object({
  id: z87.string(),
  variables: z87.nullable(z87.record(z87.string(), z87.union([
    ResponseInputText$outboundSchema,
    ResponseInputImage$outboundSchema,
    ResponseInputFile$outboundSchema,
    z87.string()
  ]))).optional()
});

// node_modules/@openrouter/sdk/esm/models/openairesponsesreasoningconfig.js
var z88 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/openairesponsesreasoningeffort.js
var OpenAIResponsesReasoningEffort = {
  Xhigh: "xhigh",
  High: "high",
  Medium: "medium",
  Low: "low",
  Minimal: "minimal",
  None: "none"
};
var OpenAIResponsesReasoningEffort$inboundSchema = inboundSchema(OpenAIResponsesReasoningEffort);
var OpenAIResponsesReasoningEffort$outboundSchema = outboundSchema(OpenAIResponsesReasoningEffort);

// node_modules/@openrouter/sdk/esm/models/reasoningsummaryverbosity.js
var ReasoningSummaryVerbosity = {
  Auto: "auto",
  Concise: "concise",
  Detailed: "detailed"
};
var ReasoningSummaryVerbosity$inboundSchema = inboundSchema(ReasoningSummaryVerbosity);
var ReasoningSummaryVerbosity$outboundSchema = outboundSchema(ReasoningSummaryVerbosity);

// node_modules/@openrouter/sdk/esm/models/openairesponsesreasoningconfig.js
var OpenAIResponsesReasoningConfig$inboundSchema = z88.object({
  effort: z88.nullable(OpenAIResponsesReasoningEffort$inboundSchema).optional(),
  summary: z88.nullable(ReasoningSummaryVerbosity$inboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/openairesponsesresponsestatus.js
var OpenAIResponsesResponseStatus = {
  Completed: "completed",
  Incomplete: "incomplete",
  InProgress: "in_progress",
  Failed: "failed",
  Cancelled: "cancelled",
  Queued: "queued"
};
var OpenAIResponsesResponseStatus$inboundSchema = inboundSchema(OpenAIResponsesResponseStatus);

// node_modules/@openrouter/sdk/esm/models/openairesponsesservicetier.js
var OpenAIResponsesServiceTier = {
  Auto: "auto",
  Default: "default",
  Flex: "flex",
  Priority: "priority",
  Scale: "scale"
};
var OpenAIResponsesServiceTier$inboundSchema = inboundSchema(OpenAIResponsesServiceTier);

// node_modules/@openrouter/sdk/esm/models/openairesponsestoolchoiceunion.js
var z89 = __toESM(require("zod/v4"), 1);
var OpenAIResponsesToolChoiceTypeWebSearchPreview = {
  WebSearchPreview: "web_search_preview"
};
var OpenAIResponsesToolChoiceTypeWebSearchPreview20250311 = {
  WebSearchPreview20250311: "web_search_preview_2025_03_11"
};
var OpenAIResponsesToolChoiceTypeFunction = {
  Function: "function"
};
var OpenAIResponsesToolChoiceRequired = {
  Required: "required"
};
var OpenAIResponsesToolChoiceNone = {
  None: "none"
};
var OpenAIResponsesToolChoiceAuto = {
  Auto: "auto"
};
var OpenAIResponsesToolChoiceTypeWebSearchPreview$inboundSchema = z89.enum(OpenAIResponsesToolChoiceTypeWebSearchPreview);
var OpenAIResponsesToolChoiceTypeWebSearchPreview$outboundSchema = OpenAIResponsesToolChoiceTypeWebSearchPreview$inboundSchema;
var OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$inboundSchema = z89.enum(OpenAIResponsesToolChoiceTypeWebSearchPreview20250311);
var OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$outboundSchema = OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$inboundSchema;
var Type$inboundSchema = z89.union([
  OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$inboundSchema,
  OpenAIResponsesToolChoiceTypeWebSearchPreview$inboundSchema
]);
var Type$outboundSchema = z89.union([
  OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$outboundSchema,
  OpenAIResponsesToolChoiceTypeWebSearchPreview$outboundSchema
]);
var OpenAIResponsesToolChoice$inboundSchema = z89.object({
  type: z89.union([
    OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$inboundSchema,
    OpenAIResponsesToolChoiceTypeWebSearchPreview$inboundSchema
  ])
});
var OpenAIResponsesToolChoice$outboundSchema = z89.object({
  type: z89.union([
    OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$outboundSchema,
    OpenAIResponsesToolChoiceTypeWebSearchPreview$outboundSchema
  ])
});
var OpenAIResponsesToolChoiceTypeFunction$inboundSchema = z89.enum(OpenAIResponsesToolChoiceTypeFunction);
var OpenAIResponsesToolChoiceTypeFunction$outboundSchema = OpenAIResponsesToolChoiceTypeFunction$inboundSchema;
var OpenAIResponsesToolChoiceFunction$inboundSchema = z89.object({
  type: OpenAIResponsesToolChoiceTypeFunction$inboundSchema,
  name: z89.string()
});
var OpenAIResponsesToolChoiceFunction$outboundSchema = z89.object({
  type: OpenAIResponsesToolChoiceTypeFunction$outboundSchema,
  name: z89.string()
});
var OpenAIResponsesToolChoiceRequired$inboundSchema = z89.enum(OpenAIResponsesToolChoiceRequired);
var OpenAIResponsesToolChoiceRequired$outboundSchema = OpenAIResponsesToolChoiceRequired$inboundSchema;
var OpenAIResponsesToolChoiceNone$inboundSchema = z89.enum(OpenAIResponsesToolChoiceNone);
var OpenAIResponsesToolChoiceNone$outboundSchema = OpenAIResponsesToolChoiceNone$inboundSchema;
var OpenAIResponsesToolChoiceAuto$inboundSchema = z89.enum(OpenAIResponsesToolChoiceAuto);
var OpenAIResponsesToolChoiceAuto$outboundSchema = OpenAIResponsesToolChoiceAuto$inboundSchema;
var OpenAIResponsesToolChoiceUnion$inboundSchema = z89.union([
  z89.lazy(() => OpenAIResponsesToolChoiceFunction$inboundSchema),
  z89.lazy(() => OpenAIResponsesToolChoice$inboundSchema),
  OpenAIResponsesToolChoiceAuto$inboundSchema,
  OpenAIResponsesToolChoiceNone$inboundSchema,
  OpenAIResponsesToolChoiceRequired$inboundSchema
]);
var OpenAIResponsesToolChoiceUnion$outboundSchema = z89.union([
  z89.lazy(() => OpenAIResponsesToolChoiceFunction$outboundSchema),
  z89.lazy(() => OpenAIResponsesToolChoice$outboundSchema),
  OpenAIResponsesToolChoiceAuto$outboundSchema,
  OpenAIResponsesToolChoiceNone$outboundSchema,
  OpenAIResponsesToolChoiceRequired$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/openairesponsestruncation.js
var OpenAIResponsesTruncation = {
  Auto: "auto",
  Disabled: "disabled"
};
var OpenAIResponsesTruncation$inboundSchema = inboundSchema(OpenAIResponsesTruncation);

// node_modules/@openrouter/sdk/esm/models/openresponseserrorevent.js
var z90 = __toESM(require("zod/v4"), 1);
var OpenResponsesErrorEvent$inboundSchema = z90.object({
  type: z90.literal("error"),
  code: z90.nullable(z90.string()),
  message: z90.string(),
  param: z90.nullable(z90.string()),
  sequence_number: z90.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesfunctiontoolcall.js
var z91 = __toESM(require("zod/v4"), 1);
var OpenResponsesFunctionToolCallType = {
  FunctionCall: "function_call"
};
var OpenResponsesFunctionToolCallType$outboundSchema = z91.enum(OpenResponsesFunctionToolCallType);
var OpenResponsesFunctionToolCall$outboundSchema = z91.object({
  type: OpenResponsesFunctionToolCallType$outboundSchema,
  callId: z91.string(),
  name: z91.string(),
  arguments: z91.string(),
  id: z91.string(),
  status: z91.nullable(ToolCallStatus$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    callId: "call_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesimagegencallcompleted.js
var z92 = __toESM(require("zod/v4"), 1);
var OpenResponsesImageGenCallCompleted$inboundSchema = z92.object({
  type: z92.literal("response.image_generation_call.completed"),
  item_id: z92.string(),
  output_index: z92.number(),
  sequence_number: z92.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesimagegencallgenerating.js
var z93 = __toESM(require("zod/v4"), 1);
var OpenResponsesImageGenCallGenerating$inboundSchema = z93.object({
  type: z93.literal("response.image_generation_call.generating"),
  item_id: z93.string(),
  output_index: z93.number(),
  sequence_number: z93.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesimagegencallinprogress.js
var z94 = __toESM(require("zod/v4"), 1);
var OpenResponsesImageGenCallInProgress$inboundSchema = z94.object({
  type: z94.literal("response.image_generation_call.in_progress"),
  item_id: z94.string(),
  output_index: z94.number(),
  sequence_number: z94.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesimagegencallpartialimage.js
var z95 = __toESM(require("zod/v4"), 1);
var OpenResponsesImageGenCallPartialImage$inboundSchema = z95.object({
  type: z95.literal("response.image_generation_call.partial_image"),
  item_id: z95.string(),
  output_index: z95.number(),
  sequence_number: z95.number(),
  partial_image_b64: z95.string(),
  partial_image_index: z95.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber",
    "partial_image_b64": "partialImageB64",
    "partial_image_index": "partialImageIndex"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesinput.js
var z105 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoning.js
var z98 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/reasoningsummarytext.js
var z96 = __toESM(require("zod/v4"), 1);
var ReasoningSummaryTextType = {
  SummaryText: "summary_text"
};
var ReasoningSummaryTextType$inboundSchema = z96.enum(ReasoningSummaryTextType);
var ReasoningSummaryTextType$outboundSchema = ReasoningSummaryTextType$inboundSchema;
var ReasoningSummaryText$inboundSchema = z96.object({
  type: ReasoningSummaryTextType$inboundSchema,
  text: z96.string()
});
var ReasoningSummaryText$outboundSchema = z96.object({
  type: ReasoningSummaryTextType$outboundSchema,
  text: z96.string()
});

// node_modules/@openrouter/sdk/esm/models/reasoningtextcontent.js
var z97 = __toESM(require("zod/v4"), 1);
var ReasoningTextContentType = {
  ReasoningText: "reasoning_text"
};
var ReasoningTextContentType$inboundSchema = z97.enum(ReasoningTextContentType);
var ReasoningTextContentType$outboundSchema = ReasoningTextContentType$inboundSchema;
var ReasoningTextContent$inboundSchema = z97.object({
  type: ReasoningTextContentType$inboundSchema,
  text: z97.string()
});
var ReasoningTextContent$outboundSchema = z97.object({
  type: ReasoningTextContentType$outboundSchema,
  text: z97.string()
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoning.js
var OpenResponsesReasoningType = {
  Reasoning: "reasoning"
};
var OpenResponsesReasoningStatusInProgress = {
  InProgress: "in_progress"
};
var OpenResponsesReasoningStatusIncomplete = {
  Incomplete: "incomplete"
};
var OpenResponsesReasoningStatusCompleted = {
  Completed: "completed"
};
var OpenResponsesReasoningFormat = {
  Unknown: "unknown",
  OpenaiResponsesV1: "openai-responses-v1",
  AzureOpenaiResponsesV1: "azure-openai-responses-v1",
  XaiResponsesV1: "xai-responses-v1",
  AnthropicClaudeV1: "anthropic-claude-v1",
  GoogleGeminiV1: "google-gemini-v1"
};
var OpenResponsesReasoningType$outboundSchema = z98.enum(OpenResponsesReasoningType);
var OpenResponsesReasoningStatusInProgress$outboundSchema = z98.enum(OpenResponsesReasoningStatusInProgress);
var OpenResponsesReasoningStatusIncomplete$outboundSchema = z98.enum(OpenResponsesReasoningStatusIncomplete);
var OpenResponsesReasoningStatusCompleted$outboundSchema = z98.enum(OpenResponsesReasoningStatusCompleted);
var OpenResponsesReasoningStatusUnion$outboundSchema = z98.union([
  OpenResponsesReasoningStatusCompleted$outboundSchema,
  OpenResponsesReasoningStatusIncomplete$outboundSchema,
  OpenResponsesReasoningStatusInProgress$outboundSchema
]);
var OpenResponsesReasoningFormat$outboundSchema = outboundSchema(OpenResponsesReasoningFormat);
var OpenResponsesReasoning$outboundSchema = z98.object({
  type: OpenResponsesReasoningType$outboundSchema,
  id: z98.string(),
  content: z98.nullable(z98.array(ReasoningTextContent$outboundSchema)).optional(),
  summary: z98.array(ReasoningSummaryText$outboundSchema),
  encryptedContent: z98.nullable(z98.string()).optional(),
  status: z98.union([
    OpenResponsesReasoningStatusCompleted$outboundSchema,
    OpenResponsesReasoningStatusIncomplete$outboundSchema,
    OpenResponsesReasoningStatusInProgress$outboundSchema
  ]).optional(),
  signature: z98.nullable(z98.string()).optional(),
  format: z98.nullable(OpenResponsesReasoningFormat$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    encryptedContent: "encrypted_content"
  });
});

// node_modules/@openrouter/sdk/esm/models/responsesimagegenerationcall.js
var z99 = __toESM(require("zod/v4"), 1);
var ResponsesImageGenerationCallType = {
  ImageGenerationCall: "image_generation_call"
};
var ResponsesImageGenerationCallType$inboundSchema = z99.enum(ResponsesImageGenerationCallType);
var ResponsesImageGenerationCallType$outboundSchema = ResponsesImageGenerationCallType$inboundSchema;
var ResponsesImageGenerationCall$inboundSchema = z99.object({
  type: ResponsesImageGenerationCallType$inboundSchema,
  id: z99.string(),
  result: z99.nullable(z99.string()).default(null),
  status: ImageGenerationStatus$inboundSchema
});
var ResponsesImageGenerationCall$outboundSchema = z99.object({
  type: ResponsesImageGenerationCallType$outboundSchema,
  id: z99.string(),
  result: z99.nullable(z99.string()).default(null),
  status: ImageGenerationStatus$outboundSchema
});

// node_modules/@openrouter/sdk/esm/models/responsesoutputitemfilesearchcall.js
var z100 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/websearchstatus.js
var WebSearchStatus = {
  Completed: "completed",
  Searching: "searching",
  InProgress: "in_progress",
  Failed: "failed"
};
var WebSearchStatus$inboundSchema = inboundSchema(WebSearchStatus);
var WebSearchStatus$outboundSchema = outboundSchema(WebSearchStatus);

// node_modules/@openrouter/sdk/esm/models/responsesoutputitemfilesearchcall.js
var ResponsesOutputItemFileSearchCallType = {
  FileSearchCall: "file_search_call"
};
var ResponsesOutputItemFileSearchCallType$inboundSchema = z100.enum(ResponsesOutputItemFileSearchCallType);
var ResponsesOutputItemFileSearchCallType$outboundSchema = ResponsesOutputItemFileSearchCallType$inboundSchema;
var ResponsesOutputItemFileSearchCall$inboundSchema = z100.object({
  type: ResponsesOutputItemFileSearchCallType$inboundSchema,
  id: z100.string(),
  queries: z100.array(z100.string()),
  status: WebSearchStatus$inboundSchema
});
var ResponsesOutputItemFileSearchCall$outboundSchema = z100.object({
  type: ResponsesOutputItemFileSearchCallType$outboundSchema,
  id: z100.string(),
  queries: z100.array(z100.string()),
  status: WebSearchStatus$outboundSchema
});

// node_modules/@openrouter/sdk/esm/models/responsesoutputitemfunctioncall.js
var z101 = __toESM(require("zod/v4"), 1);
var ResponsesOutputItemFunctionCallType = {
  FunctionCall: "function_call"
};
var ResponsesOutputItemFunctionCallStatusInProgress = {
  InProgress: "in_progress"
};
var ResponsesOutputItemFunctionCallStatusIncomplete = {
  Incomplete: "incomplete"
};
var ResponsesOutputItemFunctionCallStatusCompleted = {
  Completed: "completed"
};
var ResponsesOutputItemFunctionCallType$inboundSchema = z101.enum(ResponsesOutputItemFunctionCallType);
var ResponsesOutputItemFunctionCallType$outboundSchema = ResponsesOutputItemFunctionCallType$inboundSchema;
var ResponsesOutputItemFunctionCallStatusInProgress$inboundSchema = z101.enum(ResponsesOutputItemFunctionCallStatusInProgress);
var ResponsesOutputItemFunctionCallStatusInProgress$outboundSchema = ResponsesOutputItemFunctionCallStatusInProgress$inboundSchema;
var ResponsesOutputItemFunctionCallStatusIncomplete$inboundSchema = z101.enum(ResponsesOutputItemFunctionCallStatusIncomplete);
var ResponsesOutputItemFunctionCallStatusIncomplete$outboundSchema = ResponsesOutputItemFunctionCallStatusIncomplete$inboundSchema;
var ResponsesOutputItemFunctionCallStatusCompleted$inboundSchema = z101.enum(ResponsesOutputItemFunctionCallStatusCompleted);
var ResponsesOutputItemFunctionCallStatusCompleted$outboundSchema = ResponsesOutputItemFunctionCallStatusCompleted$inboundSchema;
var ResponsesOutputItemFunctionCallStatusUnion$inboundSchema = z101.union([
  ResponsesOutputItemFunctionCallStatusCompleted$inboundSchema,
  ResponsesOutputItemFunctionCallStatusIncomplete$inboundSchema,
  ResponsesOutputItemFunctionCallStatusInProgress$inboundSchema
]);
var ResponsesOutputItemFunctionCallStatusUnion$outboundSchema = z101.union([
  ResponsesOutputItemFunctionCallStatusCompleted$outboundSchema,
  ResponsesOutputItemFunctionCallStatusIncomplete$outboundSchema,
  ResponsesOutputItemFunctionCallStatusInProgress$outboundSchema
]);
var ResponsesOutputItemFunctionCall$inboundSchema = z101.object({
  type: ResponsesOutputItemFunctionCallType$inboundSchema,
  id: z101.string().optional(),
  name: z101.string(),
  arguments: z101.string(),
  call_id: z101.string(),
  status: z101.union([
    ResponsesOutputItemFunctionCallStatusCompleted$inboundSchema,
    ResponsesOutputItemFunctionCallStatusIncomplete$inboundSchema,
    ResponsesOutputItemFunctionCallStatusInProgress$inboundSchema
  ]).optional()
}).transform((v) => {
  return remap(v, {
    "call_id": "callId"
  });
});
var ResponsesOutputItemFunctionCall$outboundSchema = z101.object({
  type: ResponsesOutputItemFunctionCallType$outboundSchema,
  id: z101.string().optional(),
  name: z101.string(),
  arguments: z101.string(),
  callId: z101.string(),
  status: z101.union([
    ResponsesOutputItemFunctionCallStatusCompleted$outboundSchema,
    ResponsesOutputItemFunctionCallStatusIncomplete$outboundSchema,
    ResponsesOutputItemFunctionCallStatusInProgress$outboundSchema
  ]).optional()
}).transform((v) => {
  return remap(v, {
    callId: "call_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/responsesoutputitemreasoning.js
var z102 = __toESM(require("zod/v4"), 1);
var ResponsesOutputItemReasoningType = {
  Reasoning: "reasoning"
};
var ResponsesOutputItemReasoningStatusInProgress = {
  InProgress: "in_progress"
};
var ResponsesOutputItemReasoningStatusIncomplete = {
  Incomplete: "incomplete"
};
var ResponsesOutputItemReasoningStatusCompleted = {
  Completed: "completed"
};
var ResponsesOutputItemReasoningFormat = {
  Unknown: "unknown",
  OpenaiResponsesV1: "openai-responses-v1",
  AzureOpenaiResponsesV1: "azure-openai-responses-v1",
  XaiResponsesV1: "xai-responses-v1",
  AnthropicClaudeV1: "anthropic-claude-v1",
  GoogleGeminiV1: "google-gemini-v1"
};
var ResponsesOutputItemReasoningType$inboundSchema = z102.enum(ResponsesOutputItemReasoningType);
var ResponsesOutputItemReasoningType$outboundSchema = ResponsesOutputItemReasoningType$inboundSchema;
var ResponsesOutputItemReasoningStatusInProgress$inboundSchema = z102.enum(ResponsesOutputItemReasoningStatusInProgress);
var ResponsesOutputItemReasoningStatusInProgress$outboundSchema = ResponsesOutputItemReasoningStatusInProgress$inboundSchema;
var ResponsesOutputItemReasoningStatusIncomplete$inboundSchema = z102.enum(ResponsesOutputItemReasoningStatusIncomplete);
var ResponsesOutputItemReasoningStatusIncomplete$outboundSchema = ResponsesOutputItemReasoningStatusIncomplete$inboundSchema;
var ResponsesOutputItemReasoningStatusCompleted$inboundSchema = z102.enum(ResponsesOutputItemReasoningStatusCompleted);
var ResponsesOutputItemReasoningStatusCompleted$outboundSchema = ResponsesOutputItemReasoningStatusCompleted$inboundSchema;
var ResponsesOutputItemReasoningStatusUnion$inboundSchema = z102.union([
  ResponsesOutputItemReasoningStatusCompleted$inboundSchema,
  ResponsesOutputItemReasoningStatusIncomplete$inboundSchema,
  ResponsesOutputItemReasoningStatusInProgress$inboundSchema
]);
var ResponsesOutputItemReasoningStatusUnion$outboundSchema = z102.union([
  ResponsesOutputItemReasoningStatusCompleted$outboundSchema,
  ResponsesOutputItemReasoningStatusIncomplete$outboundSchema,
  ResponsesOutputItemReasoningStatusInProgress$outboundSchema
]);
var ResponsesOutputItemReasoningFormat$inboundSchema = inboundSchema(ResponsesOutputItemReasoningFormat);
var ResponsesOutputItemReasoningFormat$outboundSchema = outboundSchema(ResponsesOutputItemReasoningFormat);
var ResponsesOutputItemReasoning$inboundSchema = z102.object({
  type: ResponsesOutputItemReasoningType$inboundSchema,
  id: z102.string(),
  content: z102.nullable(z102.array(ReasoningTextContent$inboundSchema)).optional(),
  summary: z102.array(ReasoningSummaryText$inboundSchema),
  encrypted_content: z102.nullable(z102.string()).optional(),
  status: z102.union([
    ResponsesOutputItemReasoningStatusCompleted$inboundSchema,
    ResponsesOutputItemReasoningStatusIncomplete$inboundSchema,
    ResponsesOutputItemReasoningStatusInProgress$inboundSchema
  ]).optional(),
  signature: z102.nullable(z102.string()).optional(),
  format: z102.nullable(ResponsesOutputItemReasoningFormat$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "encrypted_content": "encryptedContent"
  });
});
var ResponsesOutputItemReasoning$outboundSchema = z102.object({
  type: ResponsesOutputItemReasoningType$outboundSchema,
  id: z102.string(),
  content: z102.nullable(z102.array(ReasoningTextContent$outboundSchema)).optional(),
  summary: z102.array(ReasoningSummaryText$outboundSchema),
  encryptedContent: z102.nullable(z102.string()).optional(),
  status: z102.union([
    ResponsesOutputItemReasoningStatusCompleted$outboundSchema,
    ResponsesOutputItemReasoningStatusIncomplete$outboundSchema,
    ResponsesOutputItemReasoningStatusInProgress$outboundSchema
  ]).optional(),
  signature: z102.nullable(z102.string()).optional(),
  format: z102.nullable(ResponsesOutputItemReasoningFormat$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    encryptedContent: "encrypted_content"
  });
});

// node_modules/@openrouter/sdk/esm/models/responsesoutputmessage.js
var z103 = __toESM(require("zod/v4"), 1);
var ResponsesOutputMessageRole = {
  Assistant: "assistant"
};
var ResponsesOutputMessageType = {
  Message: "message"
};
var ResponsesOutputMessageStatusInProgress = {
  InProgress: "in_progress"
};
var ResponsesOutputMessageStatusIncomplete = {
  Incomplete: "incomplete"
};
var ResponsesOutputMessageStatusCompleted = {
  Completed: "completed"
};
var ResponsesOutputMessageRole$inboundSchema = z103.enum(ResponsesOutputMessageRole);
var ResponsesOutputMessageRole$outboundSchema = ResponsesOutputMessageRole$inboundSchema;
var ResponsesOutputMessageType$inboundSchema = z103.enum(ResponsesOutputMessageType);
var ResponsesOutputMessageType$outboundSchema = ResponsesOutputMessageType$inboundSchema;
var ResponsesOutputMessageStatusInProgress$inboundSchema = z103.enum(ResponsesOutputMessageStatusInProgress);
var ResponsesOutputMessageStatusInProgress$outboundSchema = ResponsesOutputMessageStatusInProgress$inboundSchema;
var ResponsesOutputMessageStatusIncomplete$inboundSchema = z103.enum(ResponsesOutputMessageStatusIncomplete);
var ResponsesOutputMessageStatusIncomplete$outboundSchema = ResponsesOutputMessageStatusIncomplete$inboundSchema;
var ResponsesOutputMessageStatusCompleted$inboundSchema = z103.enum(ResponsesOutputMessageStatusCompleted);
var ResponsesOutputMessageStatusCompleted$outboundSchema = ResponsesOutputMessageStatusCompleted$inboundSchema;
var ResponsesOutputMessageStatusUnion$inboundSchema = z103.union([
  ResponsesOutputMessageStatusCompleted$inboundSchema,
  ResponsesOutputMessageStatusIncomplete$inboundSchema,
  ResponsesOutputMessageStatusInProgress$inboundSchema
]);
var ResponsesOutputMessageStatusUnion$outboundSchema = z103.union([
  ResponsesOutputMessageStatusCompleted$outboundSchema,
  ResponsesOutputMessageStatusIncomplete$outboundSchema,
  ResponsesOutputMessageStatusInProgress$outboundSchema
]);
var ResponsesOutputMessageContent$inboundSchema = z103.union([
  ResponseOutputText$inboundSchema,
  OpenAIResponsesRefusalContent$inboundSchema
]);
var ResponsesOutputMessageContent$outboundSchema = z103.union([
  ResponseOutputText$outboundSchema,
  OpenAIResponsesRefusalContent$outboundSchema
]);
var ResponsesOutputMessage$inboundSchema = z103.object({
  id: z103.string(),
  role: ResponsesOutputMessageRole$inboundSchema,
  type: ResponsesOutputMessageType$inboundSchema,
  status: z103.union([
    ResponsesOutputMessageStatusCompleted$inboundSchema,
    ResponsesOutputMessageStatusIncomplete$inboundSchema,
    ResponsesOutputMessageStatusInProgress$inboundSchema
  ]).optional(),
  content: z103.array(z103.union([
    ResponseOutputText$inboundSchema,
    OpenAIResponsesRefusalContent$inboundSchema
  ]))
});
var ResponsesOutputMessage$outboundSchema = z103.object({
  id: z103.string(),
  role: ResponsesOutputMessageRole$outboundSchema,
  type: ResponsesOutputMessageType$outboundSchema,
  status: z103.union([
    ResponsesOutputMessageStatusCompleted$outboundSchema,
    ResponsesOutputMessageStatusIncomplete$outboundSchema,
    ResponsesOutputMessageStatusInProgress$outboundSchema
  ]).optional(),
  content: z103.array(z103.union([
    ResponseOutputText$outboundSchema,
    OpenAIResponsesRefusalContent$outboundSchema
  ]))
});

// node_modules/@openrouter/sdk/esm/models/responseswebsearchcalloutput.js
var z104 = __toESM(require("zod/v4"), 1);
var ResponsesWebSearchCallOutputType = {
  WebSearchCall: "web_search_call"
};
var ResponsesWebSearchCallOutputType$inboundSchema = z104.enum(ResponsesWebSearchCallOutputType);
var ResponsesWebSearchCallOutputType$outboundSchema = ResponsesWebSearchCallOutputType$inboundSchema;
var ResponsesWebSearchCallOutput$inboundSchema = z104.object({
  type: ResponsesWebSearchCallOutputType$inboundSchema,
  id: z104.string(),
  status: WebSearchStatus$inboundSchema
});
var ResponsesWebSearchCallOutput$outboundSchema = z104.object({
  type: ResponsesWebSearchCallOutputType$outboundSchema,
  id: z104.string(),
  status: WebSearchStatus$outboundSchema
});

// node_modules/@openrouter/sdk/esm/models/openresponsesinput.js
var OpenResponsesInput1$outboundSchema = z105.union([
  OpenResponsesFunctionToolCall$outboundSchema,
  ResponsesOutputMessage$outboundSchema,
  ResponsesOutputItemFunctionCall$outboundSchema,
  ResponsesOutputItemFileSearchCall$outboundSchema,
  OpenResponsesReasoning$outboundSchema,
  OpenResponsesFunctionCallOutput$outboundSchema,
  ResponsesOutputItemReasoning$outboundSchema,
  ResponsesWebSearchCallOutput$outboundSchema,
  ResponsesImageGenerationCall$outboundSchema,
  OpenResponsesEasyInputMessage$outboundSchema,
  OpenResponsesInputMessageItem$outboundSchema
]);
var OpenResponsesInput$outboundSchema = z105.union([
  z105.string(),
  z105.array(z105.union([
    OpenResponsesFunctionToolCall$outboundSchema,
    ResponsesOutputMessage$outboundSchema,
    ResponsesOutputItemFunctionCall$outboundSchema,
    ResponsesOutputItemFileSearchCall$outboundSchema,
    OpenResponsesReasoning$outboundSchema,
    OpenResponsesFunctionCallOutput$outboundSchema,
    ResponsesOutputItemReasoning$outboundSchema,
    ResponsesWebSearchCallOutput$outboundSchema,
    ResponsesImageGenerationCall$outboundSchema,
    OpenResponsesEasyInputMessage$outboundSchema,
    OpenResponsesInputMessageItem$outboundSchema
  ]))
]);

// node_modules/@openrouter/sdk/esm/models/openresponseslogprobs.js
var z107 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/openresponsestoplogprobs.js
var z106 = __toESM(require("zod/v4"), 1);
var OpenResponsesTopLogprobs$inboundSchema = z106.object({
  token: z106.string().optional(),
  logprob: z106.number().optional()
});

// node_modules/@openrouter/sdk/esm/models/openresponseslogprobs.js
var OpenResponsesLogProbs$inboundSchema = z107.object({
  logprob: z107.number(),
  token: z107.string(),
  top_logprobs: z107.array(OpenResponsesTopLogprobs$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "top_logprobs": "topLogprobs"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesnonstreamingresponse.js
var z121 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/openresponsesusage.js
var z108 = __toESM(require("zod/v4"), 1);
var InputTokensDetails$inboundSchema = z108.object({
  cached_tokens: z108.number()
}).transform((v) => {
  return remap(v, {
    "cached_tokens": "cachedTokens"
  });
});
var OutputTokensDetails$inboundSchema = z108.object({
  reasoning_tokens: z108.number()
}).transform((v) => {
  return remap(v, {
    "reasoning_tokens": "reasoningTokens"
  });
});
var CostDetails$inboundSchema = z108.object({
  upstream_inference_cost: z108.nullable(z108.number()).optional(),
  upstream_inference_input_cost: z108.number(),
  upstream_inference_output_cost: z108.number()
}).transform((v) => {
  return remap(v, {
    "upstream_inference_cost": "upstreamInferenceCost",
    "upstream_inference_input_cost": "upstreamInferenceInputCost",
    "upstream_inference_output_cost": "upstreamInferenceOutputCost"
  });
});
var OpenResponsesUsage$inboundSchema = z108.object({
  input_tokens: z108.number(),
  input_tokens_details: z108.lazy(() => InputTokensDetails$inboundSchema),
  output_tokens: z108.number(),
  output_tokens_details: z108.lazy(() => OutputTokensDetails$inboundSchema),
  total_tokens: z108.number(),
  cost: z108.nullable(z108.number()).optional(),
  is_byok: z108.boolean().optional(),
  cost_details: z108.lazy(() => CostDetails$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "input_tokens": "inputTokens",
    "input_tokens_details": "inputTokensDetails",
    "output_tokens": "outputTokens",
    "output_tokens_details": "outputTokensDetails",
    "total_tokens": "totalTokens",
    "is_byok": "isByok",
    "cost_details": "costDetails"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponseswebsearch20250826tool.js
var z110 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/responsessearchcontextsize.js
var ResponsesSearchContextSize = {
  Low: "low",
  Medium: "medium",
  High: "high"
};
var ResponsesSearchContextSize$inboundSchema = inboundSchema(ResponsesSearchContextSize);
var ResponsesSearchContextSize$outboundSchema = outboundSchema(ResponsesSearchContextSize);

// node_modules/@openrouter/sdk/esm/models/responseswebsearchuserlocation.js
var z109 = __toESM(require("zod/v4"), 1);
var ResponsesWebSearchUserLocationType = {
  Approximate: "approximate"
};
var ResponsesWebSearchUserLocationType$inboundSchema = z109.enum(ResponsesWebSearchUserLocationType);
var ResponsesWebSearchUserLocationType$outboundSchema = ResponsesWebSearchUserLocationType$inboundSchema;
var ResponsesWebSearchUserLocation$inboundSchema = z109.object({
  type: ResponsesWebSearchUserLocationType$inboundSchema.optional(),
  city: z109.nullable(z109.string()).optional(),
  country: z109.nullable(z109.string()).optional(),
  region: z109.nullable(z109.string()).optional(),
  timezone: z109.nullable(z109.string()).optional()
});
var ResponsesWebSearchUserLocation$outboundSchema = z109.object({
  type: ResponsesWebSearchUserLocationType$outboundSchema.optional(),
  city: z109.nullable(z109.string()).optional(),
  country: z109.nullable(z109.string()).optional(),
  region: z109.nullable(z109.string()).optional(),
  timezone: z109.nullable(z109.string()).optional()
});

// node_modules/@openrouter/sdk/esm/models/openresponseswebsearch20250826tool.js
var OpenResponsesWebSearch20250826ToolFilters$inboundSchema = z110.object({
  allowed_domains: z110.nullable(z110.array(z110.string())).optional()
}).transform((v) => {
  return remap(v, {
    "allowed_domains": "allowedDomains"
  });
});
var OpenResponsesWebSearch20250826ToolFilters$outboundSchema = z110.object({
  allowedDomains: z110.nullable(z110.array(z110.string())).optional()
}).transform((v) => {
  return remap(v, {
    allowedDomains: "allowed_domains"
  });
});
var OpenResponsesWebSearch20250826Tool$inboundSchema = z110.object({
  type: z110.literal("web_search_2025_08_26"),
  filters: z110.nullable(z110.lazy(() => OpenResponsesWebSearch20250826ToolFilters$inboundSchema)).optional(),
  search_context_size: ResponsesSearchContextSize$inboundSchema.optional(),
  user_location: z110.nullable(ResponsesWebSearchUserLocation$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "search_context_size": "searchContextSize",
    "user_location": "userLocation"
  });
});
var OpenResponsesWebSearch20250826Tool$outboundSchema = z110.object({
  type: z110.literal("web_search_2025_08_26"),
  filters: z110.nullable(z110.lazy(() => OpenResponsesWebSearch20250826ToolFilters$outboundSchema)).optional(),
  searchContextSize: ResponsesSearchContextSize$outboundSchema.optional(),
  userLocation: z110.nullable(ResponsesWebSearchUserLocation$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    searchContextSize: "search_context_size",
    userLocation: "user_location"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponseswebsearchpreview20250311tool.js
var z112 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/websearchpreviewtooluserlocation.js
var z111 = __toESM(require("zod/v4"), 1);
var WebSearchPreviewToolUserLocationType = {
  Approximate: "approximate"
};
var WebSearchPreviewToolUserLocationType$inboundSchema = z111.enum(WebSearchPreviewToolUserLocationType);
var WebSearchPreviewToolUserLocationType$outboundSchema = WebSearchPreviewToolUserLocationType$inboundSchema;
var WebSearchPreviewToolUserLocation$inboundSchema = z111.object({
  type: WebSearchPreviewToolUserLocationType$inboundSchema,
  city: z111.nullable(z111.string()).optional(),
  country: z111.nullable(z111.string()).optional(),
  region: z111.nullable(z111.string()).optional(),
  timezone: z111.nullable(z111.string()).optional()
});
var WebSearchPreviewToolUserLocation$outboundSchema = z111.object({
  type: WebSearchPreviewToolUserLocationType$outboundSchema,
  city: z111.nullable(z111.string()).optional(),
  country: z111.nullable(z111.string()).optional(),
  region: z111.nullable(z111.string()).optional(),
  timezone: z111.nullable(z111.string()).optional()
});

// node_modules/@openrouter/sdk/esm/models/openresponseswebsearchpreview20250311tool.js
var OpenResponsesWebSearchPreview20250311Tool$inboundSchema = z112.object({
  type: z112.literal("web_search_preview_2025_03_11"),
  search_context_size: ResponsesSearchContextSize$inboundSchema.optional(),
  user_location: z112.nullable(WebSearchPreviewToolUserLocation$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "search_context_size": "searchContextSize",
    "user_location": "userLocation"
  });
});
var OpenResponsesWebSearchPreview20250311Tool$outboundSchema = z112.object({
  type: z112.literal("web_search_preview_2025_03_11"),
  searchContextSize: ResponsesSearchContextSize$outboundSchema.optional(),
  userLocation: z112.nullable(WebSearchPreviewToolUserLocation$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    searchContextSize: "search_context_size",
    userLocation: "user_location"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponseswebsearchpreviewtool.js
var z113 = __toESM(require("zod/v4"), 1);
var OpenResponsesWebSearchPreviewTool$inboundSchema = z113.object({
  type: z113.literal("web_search_preview"),
  search_context_size: ResponsesSearchContextSize$inboundSchema.optional(),
  user_location: z113.nullable(WebSearchPreviewToolUserLocation$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "search_context_size": "searchContextSize",
    "user_location": "userLocation"
  });
});
var OpenResponsesWebSearchPreviewTool$outboundSchema = z113.object({
  type: z113.literal("web_search_preview"),
  searchContextSize: ResponsesSearchContextSize$outboundSchema.optional(),
  userLocation: z113.nullable(WebSearchPreviewToolUserLocation$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    searchContextSize: "search_context_size",
    userLocation: "user_location"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponseswebsearchtool.js
var z114 = __toESM(require("zod/v4"), 1);
var OpenResponsesWebSearchToolFilters$inboundSchema = z114.object({
  allowed_domains: z114.nullable(z114.array(z114.string())).optional()
}).transform((v) => {
  return remap(v, {
    "allowed_domains": "allowedDomains"
  });
});
var OpenResponsesWebSearchToolFilters$outboundSchema = z114.object({
  allowedDomains: z114.nullable(z114.array(z114.string())).optional()
}).transform((v) => {
  return remap(v, {
    allowedDomains: "allowed_domains"
  });
});
var OpenResponsesWebSearchTool$inboundSchema = z114.object({
  type: z114.literal("web_search"),
  filters: z114.nullable(z114.lazy(() => OpenResponsesWebSearchToolFilters$inboundSchema)).optional(),
  search_context_size: ResponsesSearchContextSize$inboundSchema.optional(),
  user_location: z114.nullable(ResponsesWebSearchUserLocation$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "search_context_size": "searchContextSize",
    "user_location": "userLocation"
  });
});
var OpenResponsesWebSearchTool$outboundSchema = z114.object({
  type: z114.literal("web_search"),
  filters: z114.nullable(z114.lazy(() => OpenResponsesWebSearchToolFilters$outboundSchema)).optional(),
  searchContextSize: ResponsesSearchContextSize$outboundSchema.optional(),
  userLocation: z114.nullable(ResponsesWebSearchUserLocation$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    searchContextSize: "search_context_size",
    userLocation: "user_location"
  });
});

// node_modules/@openrouter/sdk/esm/models/responseserrorfield.js
var z115 = __toESM(require("zod/v4"), 1);
var Code = {
  ServerError: "server_error",
  RateLimitExceeded: "rate_limit_exceeded",
  InvalidPrompt: "invalid_prompt",
  VectorStoreTimeout: "vector_store_timeout",
  InvalidImage: "invalid_image",
  InvalidImageFormat: "invalid_image_format",
  InvalidBase64Image: "invalid_base64_image",
  InvalidImageUrl: "invalid_image_url",
  ImageTooLarge: "image_too_large",
  ImageTooSmall: "image_too_small",
  ImageParseError: "image_parse_error",
  ImageContentPolicyViolation: "image_content_policy_violation",
  InvalidImageMode: "invalid_image_mode",
  ImageFileTooLarge: "image_file_too_large",
  UnsupportedImageMediaType: "unsupported_image_media_type",
  EmptyImageFile: "empty_image_file",
  FailedToDownloadImage: "failed_to_download_image",
  ImageFileNotFound: "image_file_not_found"
};
var Code$inboundSchema = inboundSchema(Code);
var ResponsesErrorField$inboundSchema = z115.object({
  code: Code$inboundSchema,
  message: z115.string()
});

// node_modules/@openrouter/sdk/esm/models/responsesoutputitem.js
var z116 = __toESM(require("zod/v4"), 1);
var ResponsesOutputItem$inboundSchema = z116.union([
  ResponsesOutputMessage$inboundSchema.and(z116.object({ type: z116.literal("message") })),
  ResponsesOutputItemReasoning$inboundSchema.and(z116.object({ type: z116.literal("reasoning") })),
  ResponsesOutputItemFunctionCall$inboundSchema.and(z116.object({ type: z116.literal("function_call") })),
  ResponsesWebSearchCallOutput$inboundSchema.and(z116.object({ type: z116.literal("web_search_call") })),
  ResponsesOutputItemFileSearchCall$inboundSchema.and(z116.object({ type: z116.literal("file_search_call") })),
  ResponsesImageGenerationCall$inboundSchema.and(z116.object({ type: z116.literal("image_generation_call") }))
]);

// node_modules/@openrouter/sdk/esm/models/responsetextconfig.js
var z120 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/responseformattextconfig.js
var z119 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/responsesformattext.js
var z117 = __toESM(require("zod/v4"), 1);
var ResponsesFormatText$inboundSchema = z117.object({
  type: z117.literal("text")
});
var ResponsesFormatText$outboundSchema = z117.object({
  type: z117.literal("text")
});

// node_modules/@openrouter/sdk/esm/models/responsesformattextjsonschemaconfig.js
var z118 = __toESM(require("zod/v4"), 1);
var ResponsesFormatTextJSONSchemaConfig$inboundSchema = z118.object({
  type: z118.literal("json_schema"),
  name: z118.string(),
  description: z118.string().optional(),
  strict: z118.nullable(z118.boolean()).optional(),
  schema: z118.record(z118.string(), z118.nullable(z118.any()))
});
var ResponsesFormatTextJSONSchemaConfig$outboundSchema = z118.object({
  type: z118.literal("json_schema"),
  name: z118.string(),
  description: z118.string().optional(),
  strict: z118.nullable(z118.boolean()).optional(),
  schema: z118.record(z118.string(), z118.nullable(z118.any()))
});

// node_modules/@openrouter/sdk/esm/models/responseformattextconfig.js
var ResponseFormatTextConfig$inboundSchema = z119.union([
  ResponsesFormatText$inboundSchema,
  ResponseFormatJSONObject$inboundSchema,
  ResponsesFormatTextJSONSchemaConfig$inboundSchema
]);
var ResponseFormatTextConfig$outboundSchema = z119.union([
  ResponsesFormatText$outboundSchema,
  ResponseFormatJSONObject$outboundSchema,
  ResponsesFormatTextJSONSchemaConfig$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/responsetextconfig.js
var ResponseTextConfigVerbosity = {
  High: "high",
  Low: "low",
  Medium: "medium"
};
var ResponseTextConfigVerbosity$inboundSchema = inboundSchema(ResponseTextConfigVerbosity);
var ResponseTextConfig$inboundSchema = z120.object({
  format: ResponseFormatTextConfig$inboundSchema.optional(),
  verbosity: z120.nullable(ResponseTextConfigVerbosity$inboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/openresponsesnonstreamingresponse.js
var OpenResponsesNonStreamingResponseObject = {
  Response: "response"
};
var OpenResponsesNonStreamingResponseObject$inboundSchema = z121.enum(OpenResponsesNonStreamingResponseObject);
var OpenResponsesNonStreamingResponseToolFunction$inboundSchema = z121.object({
  type: z121.literal("function"),
  name: z121.string(),
  description: z121.nullable(z121.string()).optional(),
  strict: z121.nullable(z121.boolean()).optional(),
  parameters: z121.nullable(z121.record(z121.string(), z121.nullable(z121.any())))
});
var OpenResponsesNonStreamingResponseToolUnion$inboundSchema = z121.union([
  z121.lazy(() => OpenResponsesNonStreamingResponseToolFunction$inboundSchema),
  OpenResponsesWebSearchPreviewTool$inboundSchema,
  OpenResponsesWebSearchPreview20250311Tool$inboundSchema,
  OpenResponsesWebSearchTool$inboundSchema,
  OpenResponsesWebSearch20250826Tool$inboundSchema
]);
var OpenResponsesNonStreamingResponse$inboundSchema = z121.object({
  id: z121.string(),
  object: OpenResponsesNonStreamingResponseObject$inboundSchema,
  created_at: z121.number(),
  model: z121.string(),
  status: OpenAIResponsesResponseStatus$inboundSchema,
  completed_at: z121.nullable(z121.number()),
  output: z121.array(ResponsesOutputItem$inboundSchema),
  user: z121.nullable(z121.string()).optional(),
  output_text: z121.string().optional(),
  prompt_cache_key: z121.nullable(z121.string()).optional(),
  safety_identifier: z121.nullable(z121.string()).optional(),
  error: z121.nullable(ResponsesErrorField$inboundSchema),
  incomplete_details: z121.nullable(OpenAIResponsesIncompleteDetails$inboundSchema),
  usage: z121.nullable(OpenResponsesUsage$inboundSchema).optional(),
  max_tool_calls: z121.nullable(z121.number()).optional(),
  top_logprobs: z121.number().optional(),
  max_output_tokens: z121.nullable(z121.number()).optional(),
  temperature: z121.nullable(z121.number()),
  top_p: z121.nullable(z121.number()),
  presence_penalty: z121.nullable(z121.number()),
  frequency_penalty: z121.nullable(z121.number()),
  instructions: z121.nullable(OpenAIResponsesInputUnion$inboundSchema).optional(),
  metadata: z121.nullable(z121.record(z121.string(), z121.string())),
  tools: z121.array(z121.union([
    z121.lazy(() => OpenResponsesNonStreamingResponseToolFunction$inboundSchema),
    OpenResponsesWebSearchPreviewTool$inboundSchema,
    OpenResponsesWebSearchPreview20250311Tool$inboundSchema,
    OpenResponsesWebSearchTool$inboundSchema,
    OpenResponsesWebSearch20250826Tool$inboundSchema
  ])),
  tool_choice: OpenAIResponsesToolChoiceUnion$inboundSchema,
  parallel_tool_calls: z121.boolean(),
  prompt: z121.nullable(OpenAIResponsesPrompt$inboundSchema).optional(),
  background: z121.nullable(z121.boolean()).optional(),
  previous_response_id: z121.nullable(z121.string()).optional(),
  reasoning: z121.nullable(OpenAIResponsesReasoningConfig$inboundSchema).optional(),
  service_tier: z121.nullable(OpenAIResponsesServiceTier$inboundSchema).optional(),
  store: z121.boolean().optional(),
  truncation: z121.nullable(OpenAIResponsesTruncation$inboundSchema).optional(),
  text: ResponseTextConfig$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "created_at": "createdAt",
    "completed_at": "completedAt",
    "output_text": "outputText",
    "prompt_cache_key": "promptCacheKey",
    "safety_identifier": "safetyIdentifier",
    "incomplete_details": "incompleteDetails",
    "max_tool_calls": "maxToolCalls",
    "top_logprobs": "topLogprobs",
    "max_output_tokens": "maxOutputTokens",
    "top_p": "topP",
    "presence_penalty": "presencePenalty",
    "frequency_penalty": "frequencyPenalty",
    "tool_choice": "toolChoice",
    "parallel_tool_calls": "parallelToolCalls",
    "previous_response_id": "previousResponseId",
    "service_tier": "serviceTier"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoningconfig.js
var z122 = __toESM(require("zod/v4"), 1);
var OpenResponsesReasoningConfig$outboundSchema = z122.object({
  effort: z122.nullable(OpenAIResponsesReasoningEffort$outboundSchema).optional(),
  summary: z122.nullable(ReasoningSummaryVerbosity$outboundSchema).optional(),
  maxTokens: z122.nullable(z122.number()).optional(),
  enabled: z122.nullable(z122.boolean()).optional()
}).transform((v) => {
  return remap(v, {
    maxTokens: "max_tokens"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoningdeltaevent.js
var z123 = __toESM(require("zod/v4"), 1);
var OpenResponsesReasoningDeltaEvent$inboundSchema = z123.object({
  type: z123.literal("response.reasoning_text.delta"),
  output_index: z123.number(),
  item_id: z123.string(),
  content_index: z123.number(),
  delta: z123.string(),
  sequence_number: z123.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoningdoneevent.js
var z124 = __toESM(require("zod/v4"), 1);
var OpenResponsesReasoningDoneEvent$inboundSchema = z124.object({
  type: z124.literal("response.reasoning_text.done"),
  output_index: z124.number(),
  item_id: z124.string(),
  content_index: z124.number(),
  text: z124.string(),
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoningsummarypartaddedevent.js
var z125 = __toESM(require("zod/v4"), 1);
var OpenResponsesReasoningSummaryPartAddedEvent$inboundSchema = z125.object({
  type: z125.literal("response.reasoning_summary_part.added"),
  output_index: z125.number(),
  item_id: z125.string(),
  summary_index: z125.number(),
  part: ReasoningSummaryText$inboundSchema,
  sequence_number: z125.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "summary_index": "summaryIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoningsummarytextdeltaevent.js
var z126 = __toESM(require("zod/v4"), 1);
var OpenResponsesReasoningSummaryTextDeltaEvent$inboundSchema = z126.object({
  type: z126.literal("response.reasoning_summary_text.delta"),
  item_id: z126.string(),
  output_index: z126.number(),
  summary_index: z126.number(),
  delta: z126.string(),
  sequence_number: z126.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "summary_index": "summaryIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoningsummarytextdoneevent.js
var z127 = __toESM(require("zod/v4"), 1);
var OpenResponsesReasoningSummaryTextDoneEvent$inboundSchema = z127.object({
  type: z127.literal("response.reasoning_summary_text.done"),
  item_id: z127.string(),
  output_index: z127.number(),
  summary_index: z127.number(),
  text: z127.string(),
  sequence_number: z127.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "summary_index": "summaryIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesrequest.js
var z130 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/openresponsesresponsetext.js
var z128 = __toESM(require("zod/v4"), 1);
var OpenResponsesResponseTextVerbosity = {
  High: "high",
  Low: "low",
  Medium: "medium"
};
var OpenResponsesResponseTextVerbosity$outboundSchema = outboundSchema(OpenResponsesResponseTextVerbosity);
var OpenResponsesResponseText$outboundSchema = z128.object({
  format: ResponseFormatTextConfig$outboundSchema.optional(),
  verbosity: z128.nullable(OpenResponsesResponseTextVerbosity$outboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/providersort.js
var ProviderSort = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency"
};
var ProviderSort$outboundSchema = outboundSchema(ProviderSort);

// node_modules/@openrouter/sdk/esm/models/providersortconfig.js
var z129 = __toESM(require("zod/v4"), 1);
var By = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency"
};
var Partition = {
  Model: "model",
  None: "none"
};
var By$outboundSchema = outboundSchema(By);
var Partition$outboundSchema = outboundSchema(Partition);
var ProviderSortConfig$outboundSchema = z129.object({
  by: z129.nullable(By$outboundSchema).optional(),
  partition: z129.nullable(Partition$outboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/responsesoutputmodality.js
var ResponsesOutputModality = {
  Text: "text",
  Image: "image"
};
var ResponsesOutputModality$outboundSchema = outboundSchema(ResponsesOutputModality);

// node_modules/@openrouter/sdk/esm/models/openresponsesrequest.js
var ServiceTier = {
  Auto: "auto"
};
var Truncation = {
  Auto: "auto",
  Disabled: "disabled"
};
var OpenResponsesRequestToolFunction$outboundSchema = z130.object({
  type: z130.literal("function"),
  name: z130.string(),
  description: z130.nullable(z130.string()).optional(),
  strict: z130.nullable(z130.boolean()).optional(),
  parameters: z130.nullable(z130.record(z130.string(), z130.nullable(z130.any())))
});
var OpenResponsesRequestToolUnion$outboundSchema = z130.union([
  z130.lazy(() => OpenResponsesRequestToolFunction$outboundSchema),
  OpenResponsesWebSearchPreviewTool$outboundSchema,
  OpenResponsesWebSearchPreview20250311Tool$outboundSchema,
  OpenResponsesWebSearchTool$outboundSchema,
  OpenResponsesWebSearch20250826Tool$outboundSchema
]);
var OpenResponsesRequestImageConfig$outboundSchema = z130.union([z130.string(), z130.number()]);
var ServiceTier$outboundSchema = z130.enum(ServiceTier);
var Truncation$outboundSchema = outboundSchema(Truncation);
var OpenResponsesRequestOrder$outboundSchema = z130.union([ProviderName$outboundSchema, z130.string()]);
var OpenResponsesRequestOnly$outboundSchema = z130.union([ProviderName$outboundSchema, z130.string()]);
var OpenResponsesRequestIgnore$outboundSchema = z130.union([ProviderName$outboundSchema, z130.string()]);
var OpenResponsesRequestSort$outboundSchema = z130.union([
  ProviderSort$outboundSchema,
  ProviderSortConfig$outboundSchema,
  z130.any()
]);
var OpenResponsesRequestMaxPrice$outboundSchema = z130.object({
  prompt: z130.string().optional(),
  completion: z130.string().optional(),
  image: z130.string().optional(),
  audio: z130.string().optional(),
  request: z130.string().optional()
});
var OpenResponsesRequestProvider$outboundSchema = z130.object({
  allowFallbacks: z130.nullable(z130.boolean()).optional(),
  requireParameters: z130.nullable(z130.boolean()).optional(),
  dataCollection: z130.nullable(DataCollection$outboundSchema).optional(),
  zdr: z130.nullable(z130.boolean()).optional(),
  enforceDistillableText: z130.nullable(z130.boolean()).optional(),
  order: z130.nullable(z130.array(z130.union([ProviderName$outboundSchema, z130.string()]))).optional(),
  only: z130.nullable(z130.array(z130.union([ProviderName$outboundSchema, z130.string()]))).optional(),
  ignore: z130.nullable(z130.array(z130.union([ProviderName$outboundSchema, z130.string()]))).optional(),
  quantizations: z130.nullable(z130.array(Quantization$outboundSchema)).optional(),
  sort: z130.nullable(z130.union([
    ProviderSort$outboundSchema,
    ProviderSortConfig$outboundSchema,
    z130.any()
  ])).optional(),
  maxPrice: z130.lazy(() => OpenResponsesRequestMaxPrice$outboundSchema).optional(),
  preferredMinThroughput: z130.nullable(PreferredMinThroughput$outboundSchema).optional(),
  preferredMaxLatency: z130.nullable(PreferredMaxLatency$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    allowFallbacks: "allow_fallbacks",
    requireParameters: "require_parameters",
    dataCollection: "data_collection",
    enforceDistillableText: "enforce_distillable_text",
    maxPrice: "max_price",
    preferredMinThroughput: "preferred_min_throughput",
    preferredMaxLatency: "preferred_max_latency"
  });
});
var OpenResponsesRequestPluginResponseHealing$outboundSchema = z130.object({
  id: z130.literal("response-healing"),
  enabled: z130.boolean().optional()
});
var OpenResponsesRequestPluginFileParser$outboundSchema = z130.object({
  id: z130.literal("file-parser"),
  enabled: z130.boolean().optional(),
  pdf: PDFParserOptions$outboundSchema.optional()
});
var OpenResponsesRequestPluginWeb$outboundSchema = z130.object({
  id: z130.literal("web"),
  enabled: z130.boolean().optional(),
  maxResults: z130.number().optional(),
  searchPrompt: z130.string().optional(),
  engine: WebSearchEngine$outboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    maxResults: "max_results",
    searchPrompt: "search_prompt"
  });
});
var OpenResponsesRequestPluginModeration$outboundSchema = z130.object({
  id: z130.literal("moderation")
});
var OpenResponsesRequestPluginAutoRouter$outboundSchema = z130.object({
  id: z130.literal("auto-router"),
  enabled: z130.boolean().optional(),
  allowedModels: z130.array(z130.string()).optional()
}).transform((v) => {
  return remap(v, {
    allowedModels: "allowed_models"
  });
});
var OpenResponsesRequestPluginUnion$outboundSchema = z130.union([
  z130.lazy(() => OpenResponsesRequestPluginAutoRouter$outboundSchema),
  z130.lazy(() => OpenResponsesRequestPluginModeration$outboundSchema),
  z130.lazy(() => OpenResponsesRequestPluginWeb$outboundSchema),
  z130.lazy(() => OpenResponsesRequestPluginFileParser$outboundSchema),
  z130.lazy(() => OpenResponsesRequestPluginResponseHealing$outboundSchema)
]);
var OpenResponsesRequestTrace$outboundSchema = z130.object({
  traceId: z130.string().optional(),
  traceName: z130.string().optional(),
  spanName: z130.string().optional(),
  generationName: z130.string().optional(),
  parentSpanId: z130.string().optional(),
  additionalProperties: z130.record(z130.string(), z130.nullable(z130.any())).optional()
}).transform((v) => {
  return {
    ...v.additionalProperties,
    ...remap(v, {
      traceId: "trace_id",
      traceName: "trace_name",
      spanName: "span_name",
      generationName: "generation_name",
      parentSpanId: "parent_span_id",
      additionalProperties: null
    })
  };
});
var OpenResponsesRequest$outboundSchema = z130.object({
  input: OpenResponsesInput$outboundSchema.optional(),
  instructions: z130.nullable(z130.string()).optional(),
  metadata: z130.nullable(z130.record(z130.string(), z130.string())).optional(),
  tools: z130.array(z130.union([
    z130.lazy(() => OpenResponsesRequestToolFunction$outboundSchema),
    OpenResponsesWebSearchPreviewTool$outboundSchema,
    OpenResponsesWebSearchPreview20250311Tool$outboundSchema,
    OpenResponsesWebSearchTool$outboundSchema,
    OpenResponsesWebSearch20250826Tool$outboundSchema
  ])).optional(),
  toolChoice: OpenAIResponsesToolChoiceUnion$outboundSchema.optional(),
  parallelToolCalls: z130.nullable(z130.boolean()).optional(),
  model: z130.string().optional(),
  models: z130.array(z130.string()).optional(),
  text: OpenResponsesResponseText$outboundSchema.optional(),
  reasoning: z130.nullable(OpenResponsesReasoningConfig$outboundSchema).optional(),
  maxOutputTokens: z130.nullable(z130.number()).optional(),
  temperature: z130.nullable(z130.number()).optional(),
  topP: z130.nullable(z130.number()).optional(),
  topLogprobs: z130.nullable(z130.int()).optional(),
  maxToolCalls: z130.nullable(z130.int()).optional(),
  presencePenalty: z130.nullable(z130.number()).optional(),
  frequencyPenalty: z130.nullable(z130.number()).optional(),
  topK: z130.number().optional(),
  imageConfig: z130.record(z130.string(), z130.union([z130.string(), z130.number()])).optional(),
  modalities: z130.array(ResponsesOutputModality$outboundSchema).optional(),
  promptCacheKey: z130.nullable(z130.string()).optional(),
  previousResponseId: z130.nullable(z130.string()).optional(),
  prompt: z130.nullable(OpenAIResponsesPrompt$outboundSchema).optional(),
  include: z130.nullable(z130.array(OpenAIResponsesIncludable$outboundSchema)).optional(),
  background: z130.nullable(z130.boolean()).optional(),
  safetyIdentifier: z130.nullable(z130.string()).optional(),
  store: z130.literal(false).default(false),
  serviceTier: ServiceTier$outboundSchema.default("auto"),
  truncation: z130.nullable(Truncation$outboundSchema).optional(),
  stream: z130.boolean().default(false),
  provider: z130.nullable(z130.lazy(() => OpenResponsesRequestProvider$outboundSchema)).optional(),
  plugins: z130.array(z130.union([
    z130.lazy(() => OpenResponsesRequestPluginAutoRouter$outboundSchema),
    z130.lazy(() => OpenResponsesRequestPluginModeration$outboundSchema),
    z130.lazy(() => OpenResponsesRequestPluginWeb$outboundSchema),
    z130.lazy(() => OpenResponsesRequestPluginFileParser$outboundSchema),
    z130.lazy(() => OpenResponsesRequestPluginResponseHealing$outboundSchema)
  ])).optional(),
  user: z130.string().optional(),
  sessionId: z130.string().optional(),
  trace: z130.lazy(() => OpenResponsesRequestTrace$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    toolChoice: "tool_choice",
    parallelToolCalls: "parallel_tool_calls",
    maxOutputTokens: "max_output_tokens",
    topP: "top_p",
    topLogprobs: "top_logprobs",
    maxToolCalls: "max_tool_calls",
    presencePenalty: "presence_penalty",
    frequencyPenalty: "frequency_penalty",
    topK: "top_k",
    imageConfig: "image_config",
    promptCacheKey: "prompt_cache_key",
    previousResponseId: "previous_response_id",
    safetyIdentifier: "safety_identifier",
    serviceTier: "service_tier",
    sessionId: "session_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesstreamevent.js
var z131 = __toESM(require("zod/v4"), 1);
var OpenResponsesStreamEventResponseReasoningSummaryPartDone$inboundSchema = z131.object({
  type: z131.literal("response.reasoning_summary_part.done"),
  output_index: z131.number(),
  item_id: z131.string(),
  summary_index: z131.number(),
  part: ReasoningSummaryText$inboundSchema,
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "summary_index": "summaryIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseFunctionCallArgumentsDone$inboundSchema = z131.object({
  type: z131.literal("response.function_call_arguments.done"),
  item_id: z131.string(),
  output_index: z131.number(),
  name: z131.string(),
  arguments: z131.string(),
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseFunctionCallArgumentsDelta$inboundSchema = z131.object({
  type: z131.literal("response.function_call_arguments.delta"),
  item_id: z131.string(),
  output_index: z131.number(),
  delta: z131.string(),
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseOutputTextAnnotationAdded$inboundSchema = z131.object({
  type: z131.literal("response.output_text.annotation.added"),
  output_index: z131.number(),
  item_id: z131.string(),
  content_index: z131.number(),
  sequence_number: z131.number(),
  annotation_index: z131.number(),
  annotation: OpenAIResponsesAnnotation$inboundSchema
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber",
    "annotation_index": "annotationIndex"
  });
});
var OpenResponsesStreamEventResponseRefusalDone$inboundSchema = z131.object({
  type: z131.literal("response.refusal.done"),
  output_index: z131.number(),
  item_id: z131.string(),
  content_index: z131.number(),
  refusal: z131.string(),
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseRefusalDelta$inboundSchema = z131.object({
  type: z131.literal("response.refusal.delta"),
  output_index: z131.number(),
  item_id: z131.string(),
  content_index: z131.number(),
  delta: z131.string(),
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseOutputTextDone$inboundSchema = z131.object({
  type: z131.literal("response.output_text.done"),
  output_index: z131.number(),
  item_id: z131.string(),
  content_index: z131.number(),
  text: z131.string(),
  sequence_number: z131.number(),
  logprobs: z131.array(OpenResponsesLogProbs$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseOutputTextDelta$inboundSchema = z131.object({
  type: z131.literal("response.output_text.delta"),
  logprobs: z131.array(OpenResponsesLogProbs$inboundSchema),
  output_index: z131.number(),
  item_id: z131.string(),
  content_index: z131.number(),
  delta: z131.string(),
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});
var Part2$inboundSchema = z131.union([
  ResponseOutputText$inboundSchema,
  ReasoningTextContent$inboundSchema.and(z131.object({ type: z131.literal("reasoning_text") })),
  OpenAIResponsesRefusalContent$inboundSchema
]);
var OpenResponsesStreamEventResponseContentPartDone$inboundSchema = z131.object({
  type: z131.literal("response.content_part.done"),
  output_index: z131.number(),
  item_id: z131.string(),
  content_index: z131.number(),
  part: z131.union([
    ResponseOutputText$inboundSchema,
    ReasoningTextContent$inboundSchema.and(z131.object({ type: z131.literal("reasoning_text") })),
    OpenAIResponsesRefusalContent$inboundSchema
  ]),
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});
var Part1$inboundSchema = z131.union([
  ResponseOutputText$inboundSchema,
  ReasoningTextContent$inboundSchema.and(z131.object({ type: z131.literal("reasoning_text") })),
  OpenAIResponsesRefusalContent$inboundSchema
]);
var OpenResponsesStreamEventResponseContentPartAdded$inboundSchema = z131.object({
  type: z131.literal("response.content_part.added"),
  output_index: z131.number(),
  item_id: z131.string(),
  content_index: z131.number(),
  part: z131.union([
    ResponseOutputText$inboundSchema,
    ReasoningTextContent$inboundSchema.and(z131.object({ type: z131.literal("reasoning_text") })),
    OpenAIResponsesRefusalContent$inboundSchema
  ]),
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseOutputItemDone$inboundSchema = z131.object({
  type: z131.literal("response.output_item.done"),
  output_index: z131.number(),
  item: ResponsesOutputItem$inboundSchema,
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseOutputItemAdded$inboundSchema = z131.object({
  type: z131.literal("response.output_item.added"),
  output_index: z131.number(),
  item: ResponsesOutputItem$inboundSchema,
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseFailed$inboundSchema = z131.object({
  type: z131.literal("response.failed"),
  response: OpenResponsesNonStreamingResponse$inboundSchema,
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseIncomplete$inboundSchema = z131.object({
  type: z131.literal("response.incomplete"),
  response: OpenResponsesNonStreamingResponse$inboundSchema,
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseCompleted$inboundSchema = z131.object({
  type: z131.literal("response.completed"),
  response: OpenResponsesNonStreamingResponse$inboundSchema,
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseInProgress$inboundSchema = z131.object({
  type: z131.literal("response.in_progress"),
  response: OpenResponsesNonStreamingResponse$inboundSchema,
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseCreated$inboundSchema = z131.object({
  type: z131.literal("response.created"),
  response: OpenResponsesNonStreamingResponse$inboundSchema,
  sequence_number: z131.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEvent$inboundSchema = z131.union([
  z131.lazy(() => OpenResponsesStreamEventResponseCreated$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseInProgress$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseCompleted$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseIncomplete$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseFailed$inboundSchema),
  OpenResponsesErrorEvent$inboundSchema,
  z131.lazy(() => OpenResponsesStreamEventResponseOutputItemAdded$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseOutputItemDone$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseContentPartAdded$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseContentPartDone$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseOutputTextDelta$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseOutputTextDone$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseRefusalDelta$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseRefusalDone$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseOutputTextAnnotationAdded$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseFunctionCallArgumentsDelta$inboundSchema),
  z131.lazy(() => OpenResponsesStreamEventResponseFunctionCallArgumentsDone$inboundSchema),
  OpenResponsesReasoningDeltaEvent$inboundSchema,
  OpenResponsesReasoningDoneEvent$inboundSchema,
  OpenResponsesReasoningSummaryPartAddedEvent$inboundSchema,
  z131.lazy(() => OpenResponsesStreamEventResponseReasoningSummaryPartDone$inboundSchema),
  OpenResponsesReasoningSummaryTextDeltaEvent$inboundSchema,
  OpenResponsesReasoningSummaryTextDoneEvent$inboundSchema,
  OpenResponsesImageGenCallInProgress$inboundSchema,
  OpenResponsesImageGenCallGenerating$inboundSchema,
  OpenResponsesImageGenCallPartialImage$inboundSchema,
  OpenResponsesImageGenCallCompleted$inboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/payloadtoolargeresponseerrordata.js
var z132 = __toESM(require("zod/v4"), 1);
var PayloadTooLargeResponseErrorData$inboundSchema = z132.object({
  code: z132.int(),
  message: z132.string(),
  metadata: z132.nullable(z132.record(z132.string(), z132.nullable(z132.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/paymentrequiredresponseerrordata.js
var z133 = __toESM(require("zod/v4"), 1);
var PaymentRequiredResponseErrorData$inboundSchema = z133.object({
  code: z133.int(),
  message: z133.string(),
  metadata: z133.nullable(z133.record(z133.string(), z133.nullable(z133.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/provideroverloadedresponseerrordata.js
var z134 = __toESM(require("zod/v4"), 1);
var ProviderOverloadedResponseErrorData$inboundSchema = z134.object({
  code: z134.int(),
  message: z134.string(),
  metadata: z134.nullable(z134.record(z134.string(), z134.nullable(z134.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/providerpreferences.js
var z135 = __toESM(require("zod/v4"), 1);
var ProviderPreferencesSortEnum = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency"
};
var ProviderPreferencesProviderSortConfigEnum = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency"
};
var ProviderPreferencesBy = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency"
};
var ProviderPreferencesPartition = {
  Model: "model",
  None: "none"
};
var ProviderPreferencesProviderSort = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency"
};
var ProviderPreferencesOrder$outboundSchema = z135.union([ProviderName$outboundSchema, z135.string()]);
var ProviderPreferencesOnly$outboundSchema = z135.union([ProviderName$outboundSchema, z135.string()]);
var ProviderPreferencesIgnore$outboundSchema = z135.union([ProviderName$outboundSchema, z135.string()]);
var ProviderPreferencesSortEnum$outboundSchema = outboundSchema(ProviderPreferencesSortEnum);
var ProviderPreferencesProviderSortConfigEnum$outboundSchema = z135.enum(ProviderPreferencesProviderSortConfigEnum);
var ProviderPreferencesBy$outboundSchema = outboundSchema(ProviderPreferencesBy);
var ProviderPreferencesPartition$outboundSchema = outboundSchema(ProviderPreferencesPartition);
var ProviderPreferencesProviderSortConfig$outboundSchema = z135.object({
  by: z135.nullable(ProviderPreferencesBy$outboundSchema).optional(),
  partition: z135.nullable(ProviderPreferencesPartition$outboundSchema).optional()
});
var ProviderPreferencesProviderSortConfigUnion$outboundSchema = z135.union([
  z135.lazy(() => ProviderPreferencesProviderSortConfig$outboundSchema),
  ProviderPreferencesProviderSortConfigEnum$outboundSchema
]);
var ProviderPreferencesProviderSort$outboundSchema = outboundSchema(ProviderPreferencesProviderSort);
var ProviderPreferencesSortUnion$outboundSchema = z135.union([
  ProviderPreferencesProviderSort$outboundSchema,
  z135.union([
    z135.lazy(() => ProviderPreferencesProviderSortConfig$outboundSchema),
    ProviderPreferencesProviderSortConfigEnum$outboundSchema
  ]),
  ProviderPreferencesSortEnum$outboundSchema
]);
var ProviderPreferencesMaxPrice$outboundSchema = z135.object({
  prompt: z135.string().optional(),
  completion: z135.string().optional(),
  image: z135.string().optional(),
  audio: z135.string().optional(),
  request: z135.string().optional()
});
var ProviderPreferences$outboundSchema = z135.object({
  allowFallbacks: z135.nullable(z135.boolean()).optional(),
  requireParameters: z135.nullable(z135.boolean()).optional(),
  dataCollection: z135.nullable(DataCollection$outboundSchema).optional(),
  zdr: z135.nullable(z135.boolean()).optional(),
  enforceDistillableText: z135.nullable(z135.boolean()).optional(),
  order: z135.nullable(z135.array(z135.union([ProviderName$outboundSchema, z135.string()]))).optional(),
  only: z135.nullable(z135.array(z135.union([ProviderName$outboundSchema, z135.string()]))).optional(),
  ignore: z135.nullable(z135.array(z135.union([ProviderName$outboundSchema, z135.string()]))).optional(),
  quantizations: z135.nullable(z135.array(Quantization$outboundSchema)).optional(),
  sort: z135.nullable(z135.union([
    ProviderPreferencesProviderSort$outboundSchema,
    z135.union([
      z135.lazy(() => ProviderPreferencesProviderSortConfig$outboundSchema),
      ProviderPreferencesProviderSortConfigEnum$outboundSchema
    ]),
    ProviderPreferencesSortEnum$outboundSchema
  ])).optional(),
  maxPrice: z135.lazy(() => ProviderPreferencesMaxPrice$outboundSchema).optional(),
  preferredMinThroughput: z135.nullable(PreferredMinThroughput$outboundSchema).optional(),
  preferredMaxLatency: z135.nullable(PreferredMaxLatency$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    allowFallbacks: "allow_fallbacks",
    requireParameters: "require_parameters",
    dataCollection: "data_collection",
    enforceDistillableText: "enforce_distillable_text",
    maxPrice: "max_price",
    preferredMinThroughput: "preferred_min_throughput",
    preferredMaxLatency: "preferred_max_latency"
  });
});

// node_modules/@openrouter/sdk/esm/models/requesttimeoutresponseerrordata.js
var z136 = __toESM(require("zod/v4"), 1);
var RequestTimeoutResponseErrorData$inboundSchema = z136.object({
  code: z136.int(),
  message: z136.string(),
  metadata: z136.nullable(z136.record(z136.string(), z136.nullable(z136.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/serviceunavailableresponseerrordata.js
var z137 = __toESM(require("zod/v4"), 1);
var ServiceUnavailableResponseErrorData$inboundSchema = z137.object({
  code: z137.int(),
  message: z137.string(),
  metadata: z137.nullable(z137.record(z137.string(), z137.nullable(z137.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/toomanyrequestsresponseerrordata.js
var z138 = __toESM(require("zod/v4"), 1);
var TooManyRequestsResponseErrorData$inboundSchema = z138.object({
  code: z138.int(),
  message: z138.string(),
  metadata: z138.nullable(z138.record(z138.string(), z138.nullable(z138.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/unauthorizedresponseerrordata.js
var z139 = __toESM(require("zod/v4"), 1);
var UnauthorizedResponseErrorData$inboundSchema = z139.object({
  code: z139.int(),
  message: z139.string(),
  metadata: z139.nullable(z139.record(z139.string(), z139.nullable(z139.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/unprocessableentityresponseerrordata.js
var z140 = __toESM(require("zod/v4"), 1);
var UnprocessableEntityResponseErrorData$inboundSchema = z140.object({
  code: z140.int(),
  message: z140.string(),
  metadata: z140.nullable(z140.record(z140.string(), z140.nullable(z140.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/lib/turn-context.js
function normalizeInputToArray(input) {
  if (typeof input === "string") {
    const message = {
      role: OpenResponsesEasyInputMessageRoleUser.User,
      content: input
    };
    return [message];
  }
  return input;
}

// node_modules/@openrouter/sdk/esm/lib/conversation-state.js
function isValidUnsentToolResult(obj) {
  if (typeof obj !== "object" || obj === null)
    return false;
  const candidate = obj;
  return typeof candidate["callId"] === "string" && typeof candidate["name"] === "string" && "output" in candidate;
}
function generateConversationId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `conv_${crypto.randomUUID()}`;
  }
  return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}
function createInitialState(id) {
  const now = Date.now();
  return {
    id: id ?? generateConversationId(),
    messages: [],
    status: "in_progress",
    createdAt: now,
    updatedAt: now
  };
}
function updateState(state, updates) {
  return {
    ...state,
    ...updates,
    updatedAt: Date.now()
  };
}
function appendToMessages(current, newItems) {
  const currentArray = normalizeInputToArray(current);
  return [...currentArray, ...newItems];
}
async function toolRequiresApproval(toolCall, tools, context, callLevelCheck) {
  if (callLevelCheck) {
    return callLevelCheck(toolCall, context);
  }
  const tool = tools.find((t) => t.function.name === toolCall.name);
  if (!tool)
    return false;
  const requireApproval = tool.function.requireApproval;
  if (typeof requireApproval === "function") {
    return requireApproval(toolCall.arguments, context);
  }
  return requireApproval ?? false;
}
async function partitionToolCalls(toolCalls, tools, context, callLevelCheck) {
  const requiresApproval = [];
  const autoExecute = [];
  for (const tc of toolCalls) {
    if (await toolRequiresApproval(tc, tools, context, callLevelCheck)) {
      requiresApproval.push(tc);
    } else {
      autoExecute.push(tc);
    }
  }
  return { requiresApproval, autoExecute };
}
function createUnsentResult(callId, name, output) {
  const result = { callId, name, output };
  if (!isValidUnsentToolResult(result)) {
    throw new Error("Invalid UnsentToolResult structure");
  }
  return result;
}
function createRejectedResult(callId, name, reason) {
  const result = {
    callId,
    name,
    output: null,
    error: reason ?? "Tool call rejected by user"
  };
  if (!isValidUnsentToolResult(result)) {
    throw new Error("Invalid UnsentToolResult structure");
  }
  return result;
}
function unsentResultsToAPIFormat(results) {
  return results.map((r) => ({
    type: "function_call_output",
    id: `output_${r.callId}`,
    callId: r.callId,
    output: r.error ? JSON.stringify({ error: r.error }) : JSON.stringify(r.output)
  }));
}
function extractTextFromResponse2(response) {
  if (!response.output) {
    return "";
  }
  const outputs = Array.isArray(response.output) ? response.output : [response.output];
  const textParts = [];
  for (const item of outputs) {
    if (item.type === "message" && item.content) {
      for (const content of item.content) {
        if (content.type === "output_text" && content.text) {
          textParts.push(content.text);
        }
      }
    }
  }
  return textParts.join("");
}

// node_modules/@openrouter/sdk/esm/lib/tool-event-broadcaster.js
var ToolEventBroadcaster = class {
  constructor() {
    this.buffer = [];
    this.consumers = /* @__PURE__ */ new Map();
    this.nextConsumerId = 0;
    this.isComplete = false;
    this.completionError = null;
  }
  /**
   * Push a new event to all consumers.
   * Events are buffered so late-joining consumers can catch up.
   */
  push(event) {
    if (this.isComplete) {
      return;
    }
    this.buffer.push(event);
    this.notifyWaitingConsumers();
  }
  /**
   * Mark the broadcaster as complete - no more events will be pushed.
   * Optionally pass an error to signal failure to all consumers.
   * Cleans up buffer and consumers after completion.
   */
  complete(error) {
    this.isComplete = true;
    this.completionError = error ?? null;
    this.notifyWaitingConsumers();
    queueMicrotask(() => this.cleanup());
  }
  /**
   * Clean up resources after all consumers have finished.
   * Called automatically after complete(), but can be called manually.
   */
  cleanup() {
    if (this.isComplete && this.consumers.size === 0) {
      this.buffer = [];
    }
  }
  /**
   * Create a new consumer that can independently iterate over events.
   * Consumers can join at any time and will receive events from position 0.
   * Multiple consumers can be created and will all receive the same events.
   */
  createConsumer() {
    const consumerId = this.nextConsumerId++;
    const state = {
      position: 0,
      waitingPromise: null,
      cancelled: false
    };
    this.consumers.set(consumerId, state);
    const self = this;
    return {
      async next() {
        const consumer = self.consumers.get(consumerId);
        if (!consumer) {
          return { done: true, value: void 0 };
        }
        if (consumer.cancelled) {
          return { done: true, value: void 0 };
        }
        if (consumer.position < self.buffer.length) {
          const value = self.buffer[consumer.position];
          consumer.position++;
          return { done: false, value };
        }
        if (self.isComplete) {
          self.consumers.delete(consumerId);
          self.cleanup();
          if (self.completionError) {
            throw self.completionError;
          }
          return { done: true, value: void 0 };
        }
        const waitPromise = new Promise((resolve, reject) => {
          consumer.waitingPromise = { resolve, reject };
          if (self.isComplete || self.completionError || consumer.position < self.buffer.length) {
            resolve();
          }
        });
        await waitPromise;
        consumer.waitingPromise = null;
        return this.next();
      },
      async return() {
        const consumer = self.consumers.get(consumerId);
        if (consumer) {
          consumer.cancelled = true;
          self.consumers.delete(consumerId);
          self.cleanup();
        }
        return { done: true, value: void 0 };
      },
      async throw(e) {
        const consumer = self.consumers.get(consumerId);
        if (consumer) {
          consumer.cancelled = true;
          self.consumers.delete(consumerId);
          self.cleanup();
        }
        throw e;
      },
      [Symbol.asyncIterator]() {
        return this;
      }
    };
  }
  /**
   * Notify all waiting consumers that new data is available or stream completed
   */
  notifyWaitingConsumers() {
    for (const consumer of this.consumers.values()) {
      if (consumer.waitingPromise) {
        if (this.completionError) {
          consumer.waitingPromise.reject(this.completionError);
        } else {
          consumer.waitingPromise.resolve();
        }
        consumer.waitingPromise = null;
      }
    }
  }
};

// node_modules/@openrouter/sdk/esm/hooks/registration.js
function initHooks(_hooks) {
}

// node_modules/@openrouter/sdk/esm/hooks/hooks.js
var SDKHooks = class {
  constructor() {
    this.sdkInitHooks = [];
    this.beforeCreateRequestHooks = [];
    this.beforeRequestHooks = [];
    this.afterSuccessHooks = [];
    this.afterErrorHooks = [];
    const presetHooks = [];
    for (const hook of presetHooks) {
      if ("sdkInit" in hook) {
        this.registerSDKInitHook(hook);
      }
      if ("beforeCreateRequest" in hook) {
        this.registerBeforeCreateRequestHook(hook);
      }
      if ("beforeRequest" in hook) {
        this.registerBeforeRequestHook(hook);
      }
      if ("afterSuccess" in hook) {
        this.registerAfterSuccessHook(hook);
      }
      if ("afterError" in hook) {
        this.registerAfterErrorHook(hook);
      }
    }
    initHooks(this);
  }
  registerSDKInitHook(hook) {
    this.sdkInitHooks.push(hook);
  }
  registerBeforeCreateRequestHook(hook) {
    this.beforeCreateRequestHooks.push(hook);
  }
  registerBeforeRequestHook(hook) {
    this.beforeRequestHooks.push(hook);
  }
  registerAfterSuccessHook(hook) {
    this.afterSuccessHooks.push(hook);
  }
  registerAfterErrorHook(hook) {
    this.afterErrorHooks.push(hook);
  }
  sdkInit(opts) {
    return this.sdkInitHooks.reduce((opts2, hook) => hook.sdkInit(opts2), opts);
  }
  beforeCreateRequest(hookCtx, input) {
    let inp = input;
    for (const hook of this.beforeCreateRequestHooks) {
      inp = hook.beforeCreateRequest(hookCtx, inp);
    }
    return inp;
  }
  async beforeRequest(hookCtx, request) {
    let req = request;
    for (const hook of this.beforeRequestHooks) {
      req = await hook.beforeRequest(hookCtx, req);
    }
    return req;
  }
  async afterSuccess(hookCtx, response) {
    let res = response;
    for (const hook of this.afterSuccessHooks) {
      res = await hook.afterSuccess(hookCtx, res);
    }
    return res;
  }
  async afterError(hookCtx, response, error) {
    let res = response;
    let err = error;
    for (const hook of this.afterErrorHooks) {
      const result = await hook.afterError(hookCtx, res, err);
      res = result.response;
      err = result.error;
    }
    return { response: res, error: err };
  }
};

// node_modules/@openrouter/sdk/esm/models/errors/httpclienterrors.js
var HTTPClientError = class extends Error {
  constructor(message, opts) {
    let msg = message;
    if (opts?.cause) {
      msg += `: ${opts.cause}`;
    }
    super(msg, opts);
    this.name = "HTTPClientError";
    if (typeof this.cause === "undefined") {
      this.cause = opts?.cause;
    }
  }
};
var UnexpectedClientError = class extends HTTPClientError {
  constructor() {
    super(...arguments);
    this.name = "UnexpectedClientError";
  }
};
var InvalidRequestError = class extends HTTPClientError {
  constructor() {
    super(...arguments);
    this.name = "InvalidRequestError";
  }
};
var RequestAbortedError = class extends HTTPClientError {
  constructor() {
    super(...arguments);
    this.name = "RequestAbortedError";
  }
};
var RequestTimeoutError = class extends HTTPClientError {
  constructor() {
    super(...arguments);
    this.name = "RequestTimeoutError";
  }
};
var ConnectionError = class extends HTTPClientError {
  constructor() {
    super(...arguments);
    this.name = "ConnectionError";
  }
};

// node_modules/@openrouter/sdk/esm/lib/base64.js
var z141 = __toESM(require("zod/v4"), 1);
function bytesToBase64(u8arr) {
  return btoa(String.fromCodePoint(...u8arr));
}
function bytesFromBase64(encoded) {
  return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
}
function stringToBytes(str2) {
  return new TextEncoder().encode(str2);
}
function stringToBase64(str2) {
  return bytesToBase64(stringToBytes(str2));
}
var zodOutbound = z141.custom((x) => x instanceof Uint8Array).or(z141.string().transform(stringToBytes));
var zodInbound = z141.custom((x) => x instanceof Uint8Array).or(z141.string().transform(bytesFromBase64));

// node_modules/@openrouter/sdk/esm/lib/is-plain-object.js
function isPlainObject(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return (prototype === null || prototype === Object.prototype || Object.getPrototypeOf(prototype) === null) && !(Symbol.toStringTag in value) && !(Symbol.iterator in value);
}

// node_modules/@openrouter/sdk/esm/lib/encodings.js
var EncodingError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "EncodingError";
  }
};
function formEncoder(sep) {
  return (key, value, options) => {
    let out = "";
    const pairs = options?.explode ? explode(key, value) : [[key, value]];
    if (pairs.every(([_, v]) => v == null)) {
      return;
    }
    const encodeString = (v) => {
      return options?.charEncoding === "percent" ? encodeURIComponent(v) : v;
    };
    const encodeValue = (v) => encodeString(serializeValue(v));
    const encodedSep = encodeString(sep);
    pairs.forEach(([pk, pv]) => {
      let tmp = "";
      let encValue = null;
      if (pv == null) {
        return;
      } else if (Array.isArray(pv)) {
        encValue = mapDefined(pv, (v) => `${encodeValue(v)}`)?.join(encodedSep);
      } else if (isPlainObject(pv)) {
        encValue = mapDefinedEntries(Object.entries(pv), ([k, v]) => {
          return `${encodeString(k)}${encodedSep}${encodeValue(v)}`;
        })?.join(encodedSep);
      } else {
        encValue = `${encodeValue(pv)}`;
      }
      if (encValue == null) {
        return;
      }
      tmp = `${encodeString(pk)}=${encValue}`;
      if (!tmp || tmp === "=") {
        return;
      }
      out += `&${tmp}`;
    });
    return out.slice(1);
  };
}
var encodeForm = formEncoder(",");
var encodeSpaceDelimited = formEncoder(" ");
var encodePipeDelimited = formEncoder("|");
function encodeDeepObject(key, value, options) {
  if (value == null) {
    return;
  }
  if (!isPlainObject(value)) {
    throw new EncodingError(`Value of parameter '${key}' which uses deepObject encoding must be an object or null`);
  }
  return encodeDeepObjectObject(key, value, options);
}
function encodeDeepObjectObject(key, value, options) {
  if (value == null) {
    return;
  }
  let out = "";
  const encodeString = (v) => {
    return options?.charEncoding === "percent" ? encodeURIComponent(v) : v;
  };
  if (!isPlainObject(value)) {
    throw new EncodingError(`Expected parameter '${key}' to be an object.`);
  }
  Object.entries(value).forEach(([ck, cv]) => {
    if (cv == null) {
      return;
    }
    const pk = `${key}[${ck}]`;
    if (isPlainObject(cv)) {
      const objOut = encodeDeepObjectObject(pk, cv, options);
      out += objOut == null ? "" : `&${objOut}`;
      return;
    }
    const pairs = Array.isArray(cv) ? cv : [cv];
    const encoded = mapDefined(pairs, (v) => {
      return `${encodeString(pk)}=${encodeString(serializeValue(v))}`;
    })?.join("&");
    out += encoded == null ? "" : `&${encoded}`;
  });
  return out.slice(1);
}
function encodeJSON(key, value, options) {
  if (typeof value === "undefined") {
    return;
  }
  const encodeString = (v) => {
    return options?.charEncoding === "percent" ? encodeURIComponent(v) : v;
  };
  const encVal = encodeString(JSON.stringify(value, jsonReplacer));
  return options?.explode ? encVal : `${encodeString(key)}=${encVal}`;
}
var encodeSimple = (key, value, options) => {
  let out = "";
  const pairs = options?.explode ? explode(key, value) : [[key, value]];
  if (pairs.every(([_, v]) => v == null)) {
    return;
  }
  const encodeString = (v) => {
    return options?.charEncoding === "percent" ? encodeURIComponent(v) : v;
  };
  const encodeValue = (v) => encodeString(serializeValue(v));
  pairs.forEach(([pk, pv]) => {
    let tmp = "";
    if (pv == null) {
      return;
    } else if (Array.isArray(pv)) {
      tmp = mapDefined(pv, (v) => `${encodeValue(v)}`)?.join(",");
    } else if (isPlainObject(pv)) {
      const mapped = mapDefinedEntries(Object.entries(pv), ([k, v]) => {
        return `,${encodeString(k)},${encodeValue(v)}`;
      });
      tmp = mapped?.join("").slice(1);
    } else {
      const k = options?.explode && isPlainObject(value) ? `${pk}=` : "";
      tmp = `${k}${encodeValue(pv)}`;
    }
    out += tmp ? `,${tmp}` : "";
  });
  return out.slice(1);
};
function explode(key, value) {
  if (Array.isArray(value)) {
    return value.map((v) => [key, v]);
  } else if (isPlainObject(value)) {
    const o = value ?? {};
    return Object.entries(o).map(([k, v]) => [k, v]);
  } else {
    return [[key, value]];
  }
}
function serializeValue(value) {
  if (value == null) {
    return "";
  } else if (value instanceof Date) {
    return value.toISOString();
  } else if (value instanceof Uint8Array) {
    return bytesToBase64(value);
  } else if (typeof value === "object") {
    return JSON.stringify(value, jsonReplacer);
  }
  return `${value}`;
}
function jsonReplacer(_, value) {
  if (value instanceof Uint8Array) {
    return bytesToBase64(value);
  } else {
    return value;
  }
}
function mapDefined(inp, mapper) {
  const res = inp.reduce((acc, v) => {
    if (v == null) {
      return acc;
    }
    const m = mapper(v);
    if (m == null) {
      return acc;
    }
    acc.push(m);
    return acc;
  }, []);
  return res.length ? res : null;
}
function mapDefinedEntries(inp, mapper) {
  const acc = [];
  for (const [k, v] of inp) {
    if (v == null) {
      continue;
    }
    const m = mapper([k, v]);
    if (m == null) {
      continue;
    }
    acc.push(m);
  }
  return acc.length ? acc : null;
}
function queryJoin(...args) {
  return args.filter(Boolean).join("&");
}
function queryEncoder(f) {
  const bulkEncode = function(values, options) {
    const opts = {
      ...options,
      explode: options?.explode ?? true,
      charEncoding: options?.charEncoding ?? "percent"
    };
    const allowEmptySet = new Set(options?.allowEmptyValue ?? []);
    const encoded = Object.entries(values).map(([key, value]) => {
      if (allowEmptySet.has(key)) {
        if (value === void 0 || value === null || value === "" || Array.isArray(value) && value.length === 0) {
          return `${encodeURIComponent(key)}=`;
        }
      }
      return f(key, value, opts);
    });
    return queryJoin(...encoded);
  };
  return bulkEncode;
}
var encodeJSONQuery = queryEncoder(encodeJSON);
var encodeFormQuery = queryEncoder(encodeForm);
var encodeSpaceDelimitedQuery = queryEncoder(encodeSpaceDelimited);
var encodePipeDelimitedQuery = queryEncoder(encodePipeDelimited);
var encodeDeepObjectQuery = queryEncoder(encodeDeepObject);

// node_modules/@openrouter/sdk/esm/lib/env.js
var z142 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/lib/dlv.js
function dlv(obj, key, def, p, undef) {
  key = Array.isArray(key) ? key : key.split(".");
  for (p = 0; p < key.length; p++) {
    const k = key[p];
    obj = k != null && obj ? obj[k] : undef;
  }
  return obj === undef ? def : obj;
}

// node_modules/@openrouter/sdk/esm/lib/env.js
var envSchema = z142.object({
  OPENROUTER_API_KEY: z142.string().optional(),
  OPENROUTER_HTTP_REFERER: z142.string().optional(),
  OPENROUTER_X_TITLE: z142.string().optional(),
  OPENROUTER_DEBUG: z142.coerce.boolean().optional()
});
function isDeno() {
  if ("Deno" in globalThis) {
    return true;
  }
  return false;
}
var envMemo = void 0;
function env() {
  if (envMemo) {
    return envMemo;
  }
  let envObject = {};
  if (isDeno()) {
    envObject = globalThis.Deno?.env?.toObject?.() ?? {};
  } else {
    envObject = dlv(globalThis, "process.env") ?? {};
  }
  envMemo = envSchema.parse(envObject);
  return envMemo;
}
function fillGlobals(options) {
  const clone = { ...options };
  const envVars = env();
  if (typeof envVars.OPENROUTER_HTTP_REFERER !== "undefined") {
    clone.httpReferer ?? (clone.httpReferer = envVars.OPENROUTER_HTTP_REFERER);
  }
  if (typeof envVars.OPENROUTER_X_TITLE !== "undefined") {
    clone.xTitle ?? (clone.xTitle = envVars.OPENROUTER_X_TITLE);
  }
  return clone;
}

// node_modules/@openrouter/sdk/esm/lib/retries.js
var defaultBackoff = {
  initialInterval: 500,
  maxInterval: 6e4,
  exponent: 1.5,
  maxElapsedTime: 36e5
};
var PermanentError = class _PermanentError extends Error {
  constructor(message, options) {
    let msg = message;
    if (options?.cause) {
      msg += `: ${options.cause}`;
    }
    super(msg, options);
    this.name = "PermanentError";
    if (typeof this.cause === "undefined") {
      this.cause = options?.cause;
    }
    Object.setPrototypeOf(this, _PermanentError.prototype);
  }
};
var TemporaryError = class _TemporaryError extends Error {
  constructor(message, response) {
    super(message);
    this.response = response;
    this.name = "TemporaryError";
    Object.setPrototypeOf(this, _TemporaryError.prototype);
  }
};
async function retry(fetchFn, options) {
  switch (options.config.strategy) {
    case "backoff":
      return retryBackoff(wrapFetcher(fetchFn, {
        statusCodes: options.statusCodes,
        retryConnectionErrors: !!options.config.retryConnectionErrors
      }), options.config.backoff ?? defaultBackoff);
    default:
      return await fetchFn();
  }
}
function wrapFetcher(fn, options) {
  return async () => {
    try {
      const res = await fn();
      if (isRetryableResponse(res, options.statusCodes)) {
        throw new TemporaryError("Response failed with retryable status code", res);
      }
      return res;
    } catch (err) {
      if (err instanceof TemporaryError) {
        throw err;
      }
      if (options.retryConnectionErrors && (isTimeoutError(err) || isConnectionError(err))) {
        throw err;
      }
      throw new PermanentError("Permanent error", { cause: err });
    }
  };
}
var codeRangeRE2 = new RegExp("^[0-9]xx$", "i");
function isRetryableResponse(res, statusCodes) {
  const actual = `${res.status}`;
  return statusCodes.some((code) => {
    if (!codeRangeRE2.test(code)) {
      return code === actual;
    }
    const expectFamily = code.charAt(0);
    if (!expectFamily) {
      throw new Error("Invalid status code range");
    }
    const actualFamily = actual.charAt(0);
    if (!actualFamily) {
      throw new Error(`Invalid response status code: ${actual}`);
    }
    return actualFamily === expectFamily;
  });
}
async function retryBackoff(fn, strategy) {
  const { maxElapsedTime, initialInterval, exponent, maxInterval } = strategy;
  const start = Date.now();
  let x = 0;
  while (true) {
    try {
      const res = await fn();
      return res;
    } catch (err) {
      if (err instanceof PermanentError) {
        throw err.cause;
      }
      const elapsed = Date.now() - start;
      if (elapsed > maxElapsedTime) {
        if (err instanceof TemporaryError) {
          return err.response;
        }
        throw err;
      }
      let retryInterval = 0;
      if (err instanceof TemporaryError) {
        retryInterval = retryIntervalFromResponse(err.response);
      }
      if (retryInterval <= 0) {
        retryInterval = initialInterval * Math.pow(x, exponent) + Math.random() * 1e3;
      }
      const d = Math.min(retryInterval, maxInterval);
      await delay(d);
      x++;
    }
  }
}
function retryIntervalFromResponse(res) {
  const retryVal = res.headers.get("retry-after") || "";
  if (!retryVal) {
    return 0;
  }
  const parsedNumber = Number(retryVal);
  if (Number.isInteger(parsedNumber)) {
    return parsedNumber * 1e3;
  }
  const parsedDate = Date.parse(retryVal);
  if (Number.isInteger(parsedDate)) {
    const deltaMS = parsedDate - Date.now();
    return deltaMS > 0 ? Math.ceil(deltaMS) : 0;
  }
  return 0;
}
async function delay(delay2) {
  return new Promise((resolve) => setTimeout(resolve, delay2));
}

// node_modules/@openrouter/sdk/esm/lib/sdks.js
var __classPrivateFieldSet = function(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _ClientSDK_instances;
var _ClientSDK_httpClient;
var _ClientSDK_hooks;
var _ClientSDK_logger;
var _ClientSDK_registerHook;
var gt = typeof globalThis === "undefined" ? null : globalThis;
var webWorkerLike = typeof gt === "object" && gt != null && "importScripts" in gt && typeof gt["importScripts"] === "function";
var isBrowserLike = webWorkerLike || typeof navigator !== "undefined" && "serviceWorker" in navigator || typeof window === "object" && typeof window.document !== "undefined";
var ClientSDK = class {
  constructor(options = {}) {
    _ClientSDK_instances.add(this);
    _ClientSDK_httpClient.set(this, void 0);
    _ClientSDK_hooks.set(this, void 0);
    _ClientSDK_logger.set(this, void 0);
    if (options.hooks instanceof SDKHooks) {
      __classPrivateFieldSet(this, _ClientSDK_hooks, options.hooks, "f");
    } else {
      __classPrivateFieldSet(this, _ClientSDK_hooks, new SDKHooks(), "f");
      if (options.hooks) {
        const hooksArray = Array.isArray(options.hooks) ? options.hooks : [options.hooks];
        for (const hook of hooksArray) {
          __classPrivateFieldGet(this, _ClientSDK_instances, "m", _ClientSDK_registerHook).call(this, hook);
        }
      }
    }
    const defaultHttpClient = new HTTPClient();
    options.httpClient = options.httpClient || defaultHttpClient;
    options = __classPrivateFieldGet(this, _ClientSDK_hooks, "f").sdkInit(options);
    const url = serverURLFromOptions(options);
    if (url) {
      url.pathname = url.pathname.replace(/\/+$/, "") + "/";
    }
    this._baseURL = url;
    __classPrivateFieldSet(this, _ClientSDK_httpClient, options.httpClient || defaultHttpClient, "f");
    this._options = { ...fillGlobals(options), hooks: __classPrivateFieldGet(this, _ClientSDK_hooks, "f") };
    __classPrivateFieldSet(this, _ClientSDK_logger, this._options.debugLogger, "f");
    if (!__classPrivateFieldGet(this, _ClientSDK_logger, "f") && env().OPENROUTER_DEBUG) {
      __classPrivateFieldSet(this, _ClientSDK_logger, console, "f");
    }
  }
  _createRequest(context, conf, options) {
    const { method, path: path2, query, headers: opHeaders, security } = conf;
    const base = conf.baseURL ?? this._baseURL;
    if (!base) {
      return ERR(new InvalidRequestError("No base URL provided for operation"));
    }
    const reqURL = new URL(base);
    const inputURL = new URL(path2, reqURL);
    if (path2) {
      reqURL.pathname += reqURL.pathname.endsWith("/") ? "" : "/";
      reqURL.pathname += inputURL.pathname.replace(/^\/+/, "");
    }
    let finalQuery = query || "";
    const secQuery = [];
    for (const [k, v] of Object.entries(security?.queryParams || {})) {
      const q = encodeForm(k, v, { charEncoding: "percent" });
      if (typeof q !== "undefined") {
        secQuery.push(q);
      }
    }
    if (secQuery.length) {
      finalQuery += `&${secQuery.join("&")}`;
    }
    if (finalQuery) {
      const q = finalQuery.startsWith("&") ? finalQuery.slice(1) : finalQuery;
      reqURL.search = `?${q}`;
    }
    const headers = new Headers(opHeaders);
    const username = security?.basic.username;
    const password = security?.basic.password;
    if (username != null || password != null) {
      const encoded = stringToBase64([username || "", password || ""].join(":"));
      headers.set("Authorization", `Basic ${encoded}`);
    }
    const securityHeaders = new Headers(security?.headers || {});
    for (const [k, v] of securityHeaders) {
      headers.set(k, v);
    }
    let cookie = headers.get("cookie") || "";
    for (const [k, v] of Object.entries(security?.cookies || {})) {
      cookie += `; ${k}=${v}`;
    }
    cookie = cookie.startsWith("; ") ? cookie.slice(2) : cookie;
    headers.set("cookie", cookie);
    const userHeaders = new Headers(options?.headers ?? options?.fetchOptions?.headers);
    for (const [k, v] of userHeaders) {
      headers.set(k, v);
    }
    if (!isBrowserLike) {
      headers.set(conf.uaHeader ?? "user-agent", conf.userAgent ?? SDK_METADATA.userAgent);
    }
    const fetchOptions = {
      ...options?.fetchOptions,
      ...options
    };
    if (!fetchOptions?.signal && conf.timeoutMs && conf.timeoutMs > 0) {
      const timeoutSignal = AbortSignal.timeout(conf.timeoutMs);
      fetchOptions.signal = timeoutSignal;
    }
    if (conf.body instanceof ReadableStream) {
      Object.assign(fetchOptions, { duplex: "half" });
    }
    let input;
    try {
      input = __classPrivateFieldGet(this, _ClientSDK_hooks, "f").beforeCreateRequest(context, {
        url: reqURL,
        options: {
          ...fetchOptions,
          body: conf.body ?? null,
          headers,
          method
        }
      });
    } catch (err) {
      return ERR(new UnexpectedClientError("Create request hook failed to execute", {
        cause: err
      }));
    }
    return OK(new Request(input.url, input.options));
  }
  async _do(request, options) {
    const { context, errorCodes } = options;
    return retry(async () => {
      const req = await __classPrivateFieldGet(this, _ClientSDK_hooks, "f").beforeRequest(context, request.clone());
      await logRequest(__classPrivateFieldGet(this, _ClientSDK_logger, "f"), req).catch((e) => __classPrivateFieldGet(this, _ClientSDK_logger, "f")?.log("Failed to log request:", e));
      let response = await __classPrivateFieldGet(this, _ClientSDK_httpClient, "f").request(req);
      try {
        if (matchStatusCode(response, errorCodes)) {
          const result = await __classPrivateFieldGet(this, _ClientSDK_hooks, "f").afterError(context, response, null);
          if (result.error) {
            throw result.error;
          }
          response = result.response || response;
        } else {
          response = await __classPrivateFieldGet(this, _ClientSDK_hooks, "f").afterSuccess(context, response);
        }
      } finally {
        await logResponse(__classPrivateFieldGet(this, _ClientSDK_logger, "f"), response, req).catch((e) => __classPrivateFieldGet(this, _ClientSDK_logger, "f")?.log("Failed to log response:", e));
      }
      return response;
    }, { config: options.retryConfig, statusCodes: options.retryCodes }).then((r) => OK(r), (err) => {
      switch (true) {
        case isAbortError(err):
          return ERR(new RequestAbortedError("Request aborted by client", {
            cause: err
          }));
        case isTimeoutError(err):
          return ERR(new RequestTimeoutError("Request timed out", { cause: err }));
        case isConnectionError(err):
          return ERR(new ConnectionError("Unable to make request", { cause: err }));
        default:
          return ERR(new UnexpectedClientError("Unexpected HTTP client error", {
            cause: err
          }));
      }
    });
  }
};
_ClientSDK_httpClient = /* @__PURE__ */ new WeakMap(), _ClientSDK_hooks = /* @__PURE__ */ new WeakMap(), _ClientSDK_logger = /* @__PURE__ */ new WeakMap(), _ClientSDK_instances = /* @__PURE__ */ new WeakSet(), _ClientSDK_registerHook = function _ClientSDK_registerHook2(hook) {
  if ("sdkInit" in hook) {
    __classPrivateFieldGet(this, _ClientSDK_hooks, "f").registerSDKInitHook(hook);
  }
  if ("beforeCreateRequest" in hook) {
    __classPrivateFieldGet(this, _ClientSDK_hooks, "f").registerBeforeCreateRequestHook(hook);
  }
  if ("beforeRequest" in hook) {
    __classPrivateFieldGet(this, _ClientSDK_hooks, "f").registerBeforeRequestHook(hook);
  }
  if ("afterSuccess" in hook) {
    __classPrivateFieldGet(this, _ClientSDK_hooks, "f").registerAfterSuccessHook(hook);
  }
  if ("afterError" in hook) {
    __classPrivateFieldGet(this, _ClientSDK_hooks, "f").registerAfterErrorHook(hook);
  }
};
var jsonLikeContentTypeRE = /(application|text)\/.*?\+*json.*/;
var jsonlLikeContentTypeRE = /(application|text)\/(.*?\+*\bjsonl\b.*|.*?\+*\bx-ndjson\b.*)/;
async function logRequest(logger4, req) {
  if (!logger4) {
    return;
  }
  const contentType = req.headers.get("content-type");
  const ct = contentType?.split(";")[0] || "";
  logger4.group(`> Request: ${req.method} ${req.url}`);
  logger4.group("Headers:");
  for (const [k, v] of req.headers.entries()) {
    logger4.log(`${k}: ${v}`);
  }
  logger4.groupEnd();
  logger4.group("Body:");
  switch (true) {
    case jsonLikeContentTypeRE.test(ct):
      logger4.log(await req.clone().json());
      break;
    case ct.startsWith("text/"):
      logger4.log(await req.clone().text());
      break;
    case ct === "multipart/form-data": {
      const body = await req.clone().formData();
      for (const [k, v] of body) {
        const vlabel = v instanceof Blob ? "<Blob>" : v;
        logger4.log(`${k}: ${vlabel}`);
      }
      break;
    }
    default:
      logger4.log(`<${contentType}>`);
      break;
  }
  logger4.groupEnd();
  logger4.groupEnd();
}
async function logResponse(logger4, res, req) {
  if (!logger4) {
    return;
  }
  const contentType = res.headers.get("content-type");
  const ct = contentType?.split(";")[0] || "";
  logger4.group(`< Response: ${req.method} ${req.url}`);
  logger4.log("Status Code:", res.status, res.statusText);
  logger4.group("Headers:");
  for (const [k, v] of res.headers.entries()) {
    logger4.log(`${k}: ${v}`);
  }
  logger4.groupEnd();
  logger4.group("Body:");
  switch (true) {
    case (matchContentType(res, "application/json") || jsonLikeContentTypeRE.test(ct) && !jsonlLikeContentTypeRE.test(ct)):
      logger4.log(await res.clone().json());
      break;
    case (matchContentType(res, "application/jsonl") || jsonlLikeContentTypeRE.test(ct)):
      logger4.log(await res.clone().text());
      break;
    case matchContentType(res, "text/event-stream"):
      logger4.log(`<${contentType}>`);
      break;
    case matchContentType(res, "text/*"):
      logger4.log(await res.clone().text());
      break;
    case matchContentType(res, "multipart/form-data"): {
      const body = await res.clone().formData();
      for (const [k, v] of body) {
        const vlabel = v instanceof Blob ? "<Blob>" : v;
        logger4.log(`${k}: ${vlabel}`);
      }
      break;
    }
    default:
      logger4.log(`<${contentType}>`);
      break;
  }
  logger4.groupEnd();
  logger4.groupEnd();
}

// node_modules/@openrouter/sdk/esm/models/errors/openroutererror.js
var OpenRouterError = class extends Error {
  constructor(message, httpMeta) {
    super(message);
    this.statusCode = httpMeta.response.status;
    this.body = httpMeta.body;
    this.headers = httpMeta.response.headers;
    this.contentType = httpMeta.response.headers.get("content-type") || "";
    this.rawResponse = httpMeta.response;
    this.name = "OpenRouterError";
  }
};

// node_modules/@openrouter/sdk/esm/models/errors/openrouterdefaulterror.js
var OpenRouterDefaultError = class extends OpenRouterError {
  constructor(message, httpMeta) {
    if (message) {
      message += `: `;
    }
    message += `Status ${httpMeta.response.status}`;
    const contentType = httpMeta.response.headers.get("content-type") || `""`;
    if (contentType !== "application/json") {
      message += ` Content-Type ${contentType.includes(" ") ? `"${contentType}"` : contentType}`;
    }
    const body = httpMeta.body || `""`;
    message += body.length > 100 ? "\n" : ". ";
    let bodyDisplay = body;
    if (body.length > 1e4) {
      const truncated = body.substring(0, 1e4);
      const remaining = body.length - 1e4;
      bodyDisplay = `${truncated}...and ${remaining} more chars`;
    }
    message += `Body: ${bodyDisplay}`;
    message = message.trim();
    super(message, httpMeta);
    this.name = "OpenRouterDefaultError";
  }
};

// node_modules/@openrouter/sdk/esm/models/errors/responsevalidationerror.js
var z143 = __toESM(require("zod/v4/core"), 1);
var ResponseValidationError = class extends OpenRouterError {
  constructor(message, extra) {
    super(message, extra);
    this.name = "ResponseValidationError";
    this.cause = extra.cause;
    this.rawValue = extra.rawValue;
    this.rawMessage = extra.rawMessage;
  }
  /**
   * Return a pretty-formatted error message if the underlying validation error
   * is a ZodError or some other recognized error type, otherwise return the
   * default error message.
   */
  pretty() {
    if (this.cause instanceof z143.$ZodError) {
      return `${this.rawMessage}
${formatZodError(this.cause)}`;
    } else {
      return this.toString();
    }
  }
};

// node_modules/@openrouter/sdk/esm/lib/matchers.js
var DEFAULT_CONTENT_TYPES = {
  jsonl: "application/jsonl",
  json: "application/json",
  text: "text/plain",
  bytes: "application/octet-stream",
  stream: "application/octet-stream",
  sse: "text/event-stream",
  nil: "*",
  fail: "*"
};
function jsonErr(codes, schema, options) {
  return { ...options, err: true, enc: "json", codes, schema };
}
function json(codes, schema, options) {
  return { ...options, enc: "json", codes, schema };
}
function text(codes, schema, options) {
  return { ...options, enc: "text", codes, schema };
}
function sse(codes, schema, options) {
  return { ...options, enc: "sse", codes, schema };
}
function fail(codes) {
  return { enc: "fail", codes };
}
function match(...matchers) {
  return async function matchFunc(response, request, options) {
    let raw;
    let matcher;
    for (const match2 of matchers) {
      const { codes } = match2;
      const ctpattern = "ctype" in match2 ? match2.ctype : DEFAULT_CONTENT_TYPES[match2.enc];
      if (ctpattern && matchResponse(response, codes, ctpattern)) {
        matcher = match2;
        break;
      } else if (!ctpattern && matchStatusCode(response, codes)) {
        matcher = match2;
        break;
      }
    }
    if (!matcher) {
      return [{
        ok: false,
        error: new OpenRouterDefaultError("Unexpected Status or Content-Type", {
          response,
          request,
          body: await response.text().catch(() => "")
        })
      }, raw];
    }
    const encoding = matcher.enc;
    let body = "";
    switch (encoding) {
      case "json":
        body = await response.text();
        raw = JSON.parse(body);
        break;
      case "jsonl":
        raw = response.body;
        break;
      case "bytes":
        raw = new Uint8Array(await response.arrayBuffer());
        break;
      case "stream":
        raw = response.body;
        break;
      case "text":
        body = await response.text();
        raw = body;
        break;
      case "sse":
        raw = response.body;
        break;
      case "nil":
        body = await response.text();
        raw = void 0;
        break;
      case "fail":
        body = await response.text();
        raw = body;
        break;
      default:
        encoding;
        throw new Error(`Unsupported response type: ${encoding}`);
    }
    if (matcher.enc === "fail") {
      return [{
        ok: false,
        error: new OpenRouterDefaultError("API error occurred", {
          request,
          response,
          body
        })
      }, raw];
    }
    const resultKey = matcher.key || options?.resultKey;
    let data;
    if ("err" in matcher) {
      data = {
        ...options?.extraFields,
        ...matcher.hdrs ? { Headers: unpackHeaders(response.headers) } : null,
        ...isPlainObject(raw) ? raw : null,
        request$: request,
        response$: response,
        body$: body
      };
    } else if (resultKey) {
      data = {
        ...options?.extraFields,
        ...matcher.hdrs ? { Headers: unpackHeaders(response.headers) } : null,
        [resultKey]: raw
      };
    } else if (matcher.hdrs) {
      data = {
        ...options?.extraFields,
        ...matcher.hdrs ? { Headers: unpackHeaders(response.headers) } : null,
        ...isPlainObject(raw) ? raw : null
      };
    } else {
      data = raw;
    }
    if ("err" in matcher) {
      const result = safeParseResponse(data, (v) => matcher.schema.parse(v), "Response validation failed", { request, response, body });
      return [result.ok ? { ok: false, error: result.value } : result, raw];
    } else {
      return [
        safeParseResponse(data, (v) => matcher.schema.parse(v), "Response validation failed", { request, response, body }),
        raw
      ];
    }
  };
}
var headerValRE = /, */;
function unpackHeaders(headers) {
  const out = {};
  for (const [k, v] of headers.entries()) {
    out[k] = v.split(headerValRE);
  }
  return out;
}
function safeParseResponse(rawValue, fn, errorMessage, httpMeta) {
  try {
    return OK(fn(rawValue));
  } catch (err) {
    return ERR(new ResponseValidationError(errorMessage, {
      cause: err,
      rawValue,
      rawMessage: errorMessage,
      ...httpMeta
    }));
  }
}

// node_modules/@openrouter/sdk/esm/lib/security.js
var SecurityErrorCode;
(function(SecurityErrorCode2) {
  SecurityErrorCode2["Incomplete"] = "incomplete";
  SecurityErrorCode2["UnrecognisedSecurityType"] = "unrecognized_security_type";
})(SecurityErrorCode || (SecurityErrorCode = {}));
var SecurityError = class _SecurityError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "SecurityError";
  }
  static incomplete() {
    return new _SecurityError(SecurityErrorCode.Incomplete, "Security requirements not met in order to perform the operation");
  }
  static unrecognizedType(type) {
    return new _SecurityError(SecurityErrorCode.UnrecognisedSecurityType, `Unrecognised security type: ${type}`);
  }
};
function resolveSecurity(...options) {
  const state = {
    basic: {},
    headers: {},
    queryParams: {},
    cookies: {},
    oauth2: { type: "none" }
  };
  const option = options.find((opts) => {
    return opts.every((o) => {
      if (o.value == null) {
        return false;
      } else if (o.type === "http:basic") {
        return o.value.username != null || o.value.password != null;
      } else if (o.type === "http:custom") {
        return null;
      } else if (o.type === "oauth2:password") {
        return typeof o.value === "string" && !!o.value;
      } else if (o.type === "oauth2:client_credentials") {
        if (typeof o.value == "string") {
          return !!o.value;
        }
        return o.value.clientID != null || o.value.clientSecret != null;
      } else if (typeof o.value === "string") {
        return !!o.value;
      } else {
        throw new Error(`Unrecognized security type: ${o.type} (value type: ${typeof o.value})`);
      }
    });
  });
  if (option == null) {
    return null;
  }
  option.forEach((spec) => {
    if (spec.value == null) {
      return;
    }
    const { type } = spec;
    switch (type) {
      case "apiKey:header":
        state.headers[spec.fieldName] = spec.value;
        break;
      case "apiKey:query":
        state.queryParams[spec.fieldName] = spec.value;
        break;
      case "apiKey:cookie":
        state.cookies[spec.fieldName] = spec.value;
        break;
      case "http:basic":
        applyBasic(state, spec);
        break;
      case "http:custom":
        break;
      case "http:bearer":
        applyBearer(state, spec);
        break;
      case "oauth2":
        applyBearer(state, spec);
        break;
      case "oauth2:password":
        applyBearer(state, spec);
        break;
      case "oauth2:client_credentials":
        break;
      case "openIdConnect":
        applyBearer(state, spec);
        break;
      default:
        spec;
        throw SecurityError.unrecognizedType(type);
    }
  });
  return state;
}
function applyBasic(state, spec) {
  if (spec.value == null) {
    return;
  }
  state.basic = spec.value;
}
function applyBearer(state, spec) {
  if (typeof spec.value !== "string" || !spec.value) {
    return;
  }
  let value = spec.value;
  if (value.slice(0, 7).toLowerCase() !== "bearer ") {
    value = `Bearer ${value}`;
  }
  if (spec.fieldName !== void 0) {
    state.headers[spec.fieldName] = value;
  }
}
function resolveGlobalSecurity(security) {
  return resolveSecurity([
    {
      fieldName: "Authorization",
      type: "http:bearer",
      value: security?.apiKey ?? env().OPENROUTER_API_KEY
    }
  ]);
}
async function extractSecurity(sec) {
  if (sec == null) {
    return;
  }
  return typeof sec === "function" ? sec() : sec;
}

// node_modules/@openrouter/sdk/esm/models/errors/badgatewayresponseerror.js
var z144 = __toESM(require("zod/v4"), 1);
var BadGatewayResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "BadGatewayResponseError";
  }
};
var BadGatewayResponseError$inboundSchema = z144.object({
  error: BadGatewayResponseErrorData$inboundSchema,
  user_id: z144.nullable(z144.string()).optional(),
  request$: z144.custom((x) => x instanceof Request),
  response$: z144.custom((x) => x instanceof Response),
  body$: z144.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new BadGatewayResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/badrequestresponseerror.js
var z145 = __toESM(require("zod/v4"), 1);
var BadRequestResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "BadRequestResponseError";
  }
};
var BadRequestResponseError$inboundSchema = z145.object({
  error: BadRequestResponseErrorData$inboundSchema,
  user_id: z145.nullable(z145.string()).optional(),
  request$: z145.custom((x) => x instanceof Request),
  response$: z145.custom((x) => x instanceof Response),
  body$: z145.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new BadRequestResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/edgenetworktimeoutresponseerror.js
var z146 = __toESM(require("zod/v4"), 1);
var EdgeNetworkTimeoutResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "EdgeNetworkTimeoutResponseError";
  }
};
var EdgeNetworkTimeoutResponseError$inboundSchema = z146.object({
  error: EdgeNetworkTimeoutResponseErrorData$inboundSchema,
  user_id: z146.nullable(z146.string()).optional(),
  request$: z146.custom((x) => x instanceof Request),
  response$: z146.custom((x) => x instanceof Response),
  body$: z146.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new EdgeNetworkTimeoutResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/forbiddenresponseerror.js
var z147 = __toESM(require("zod/v4"), 1);
var ForbiddenResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "ForbiddenResponseError";
  }
};
var ForbiddenResponseError$inboundSchema = z147.object({
  error: ForbiddenResponseErrorData$inboundSchema,
  user_id: z147.nullable(z147.string()).optional(),
  request$: z147.custom((x) => x instanceof Request),
  response$: z147.custom((x) => x instanceof Response),
  body$: z147.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new ForbiddenResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/internalserverresponseerror.js
var z148 = __toESM(require("zod/v4"), 1);
var InternalServerResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "InternalServerResponseError";
  }
};
var InternalServerResponseError$inboundSchema = z148.object({
  error: InternalServerResponseErrorData$inboundSchema,
  user_id: z148.nullable(z148.string()).optional(),
  request$: z148.custom((x) => x instanceof Request),
  response$: z148.custom((x) => x instanceof Response),
  body$: z148.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new InternalServerResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/notfoundresponseerror.js
var z149 = __toESM(require("zod/v4"), 1);
var NotFoundResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "NotFoundResponseError";
  }
};
var NotFoundResponseError$inboundSchema = z149.object({
  error: NotFoundResponseErrorData$inboundSchema,
  user_id: z149.nullable(z149.string()).optional(),
  request$: z149.custom((x) => x instanceof Request),
  response$: z149.custom((x) => x instanceof Response),
  body$: z149.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new NotFoundResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/payloadtoolargeresponseerror.js
var z150 = __toESM(require("zod/v4"), 1);
var PayloadTooLargeResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "PayloadTooLargeResponseError";
  }
};
var PayloadTooLargeResponseError$inboundSchema = z150.object({
  error: PayloadTooLargeResponseErrorData$inboundSchema,
  user_id: z150.nullable(z150.string()).optional(),
  request$: z150.custom((x) => x instanceof Request),
  response$: z150.custom((x) => x instanceof Response),
  body$: z150.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new PayloadTooLargeResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/paymentrequiredresponseerror.js
var z151 = __toESM(require("zod/v4"), 1);
var PaymentRequiredResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "PaymentRequiredResponseError";
  }
};
var PaymentRequiredResponseError$inboundSchema = z151.object({
  error: PaymentRequiredResponseErrorData$inboundSchema,
  user_id: z151.nullable(z151.string()).optional(),
  request$: z151.custom((x) => x instanceof Request),
  response$: z151.custom((x) => x instanceof Response),
  body$: z151.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new PaymentRequiredResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/provideroverloadedresponseerror.js
var z152 = __toESM(require("zod/v4"), 1);
var ProviderOverloadedResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "ProviderOverloadedResponseError";
  }
};
var ProviderOverloadedResponseError$inboundSchema = z152.object({
  error: ProviderOverloadedResponseErrorData$inboundSchema,
  user_id: z152.nullable(z152.string()).optional(),
  request$: z152.custom((x) => x instanceof Request),
  response$: z152.custom((x) => x instanceof Response),
  body$: z152.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new ProviderOverloadedResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/requesttimeoutresponseerror.js
var z153 = __toESM(require("zod/v4"), 1);
var RequestTimeoutResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "RequestTimeoutResponseError";
  }
};
var RequestTimeoutResponseError$inboundSchema = z153.object({
  error: RequestTimeoutResponseErrorData$inboundSchema,
  user_id: z153.nullable(z153.string()).optional(),
  request$: z153.custom((x) => x instanceof Request),
  response$: z153.custom((x) => x instanceof Response),
  body$: z153.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new RequestTimeoutResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/serviceunavailableresponseerror.js
var z154 = __toESM(require("zod/v4"), 1);
var ServiceUnavailableResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "ServiceUnavailableResponseError";
  }
};
var ServiceUnavailableResponseError$inboundSchema = z154.object({
  error: ServiceUnavailableResponseErrorData$inboundSchema,
  user_id: z154.nullable(z154.string()).optional(),
  request$: z154.custom((x) => x instanceof Request),
  response$: z154.custom((x) => x instanceof Response),
  body$: z154.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new ServiceUnavailableResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/toomanyrequestsresponseerror.js
var z155 = __toESM(require("zod/v4"), 1);
var TooManyRequestsResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "TooManyRequestsResponseError";
  }
};
var TooManyRequestsResponseError$inboundSchema = z155.object({
  error: TooManyRequestsResponseErrorData$inboundSchema,
  user_id: z155.nullable(z155.string()).optional(),
  request$: z155.custom((x) => x instanceof Request),
  response$: z155.custom((x) => x instanceof Response),
  body$: z155.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new TooManyRequestsResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/unauthorizedresponseerror.js
var z156 = __toESM(require("zod/v4"), 1);
var UnauthorizedResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "UnauthorizedResponseError";
  }
};
var UnauthorizedResponseError$inboundSchema = z156.object({
  error: UnauthorizedResponseErrorData$inboundSchema,
  user_id: z156.nullable(z156.string()).optional(),
  request$: z156.custom((x) => x instanceof Request),
  response$: z156.custom((x) => x instanceof Response),
  body$: z156.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new UnauthorizedResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/unprocessableentityresponseerror.js
var z157 = __toESM(require("zod/v4"), 1);
var UnprocessableEntityResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "UnprocessableEntityResponseError";
  }
};
var UnprocessableEntityResponseError$inboundSchema = z157.object({
  error: UnprocessableEntityResponseErrorData$inboundSchema,
  user_id: z157.nullable(z157.string()).optional(),
  request$: z157.custom((x) => x instanceof Request),
  response$: z157.custom((x) => x instanceof Response),
  body$: z157.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new UnprocessableEntityResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/bulkassignkeystoguardrail.js
var z158 = __toESM(require("zod/v4"), 1);
var BulkAssignKeysToGuardrailRequestBody$outboundSchema = z158.object({
  keyHashes: z158.array(z158.string())
}).transform((v) => {
  return remap(v, {
    keyHashes: "key_hashes"
  });
});
var BulkAssignKeysToGuardrailRequest$outboundSchema = z158.object({
  httpReferer: z158.string().optional(),
  xTitle: z158.string().optional(),
  id: z158.string(),
  requestBody: z158.lazy(() => BulkAssignKeysToGuardrailRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    requestBody: "RequestBody"
  });
});
var BulkAssignKeysToGuardrailResponse$inboundSchema = z158.object({
  assigned_count: z158.number()
}).transform((v) => {
  return remap(v, {
    "assigned_count": "assignedCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/bulkassignmemberstoguardrail.js
var z159 = __toESM(require("zod/v4"), 1);
var BulkAssignMembersToGuardrailRequestBody$outboundSchema = z159.object({
  memberUserIds: z159.array(z159.string())
}).transform((v) => {
  return remap(v, {
    memberUserIds: "member_user_ids"
  });
});
var BulkAssignMembersToGuardrailRequest$outboundSchema = z159.object({
  httpReferer: z159.string().optional(),
  xTitle: z159.string().optional(),
  id: z159.string(),
  requestBody: z159.lazy(() => BulkAssignMembersToGuardrailRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    requestBody: "RequestBody"
  });
});
var BulkAssignMembersToGuardrailResponse$inboundSchema = z159.object({
  assigned_count: z159.number()
}).transform((v) => {
  return remap(v, {
    "assigned_count": "assignedCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/bulkunassignkeysfromguardrail.js
var z160 = __toESM(require("zod/v4"), 1);
var BulkUnassignKeysFromGuardrailRequestBody$outboundSchema = z160.object({
  keyHashes: z160.array(z160.string())
}).transform((v) => {
  return remap(v, {
    keyHashes: "key_hashes"
  });
});
var BulkUnassignKeysFromGuardrailRequest$outboundSchema = z160.object({
  httpReferer: z160.string().optional(),
  xTitle: z160.string().optional(),
  id: z160.string(),
  requestBody: z160.lazy(() => BulkUnassignKeysFromGuardrailRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    requestBody: "RequestBody"
  });
});
var BulkUnassignKeysFromGuardrailResponse$inboundSchema = z160.object({
  unassigned_count: z160.number()
}).transform((v) => {
  return remap(v, {
    "unassigned_count": "unassignedCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/bulkunassignmembersfromguardrail.js
var z161 = __toESM(require("zod/v4"), 1);
var BulkUnassignMembersFromGuardrailRequestBody$outboundSchema = z161.object({
  memberUserIds: z161.array(z161.string())
}).transform((v) => {
  return remap(v, {
    memberUserIds: "member_user_ids"
  });
});
var BulkUnassignMembersFromGuardrailRequest$outboundSchema = z161.object({
  httpReferer: z161.string().optional(),
  xTitle: z161.string().optional(),
  id: z161.string(),
  requestBody: z161.lazy(() => BulkUnassignMembersFromGuardrailRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    requestBody: "RequestBody"
  });
});
var BulkUnassignMembersFromGuardrailResponse$inboundSchema = z161.object({
  unassigned_count: z161.number()
}).transform((v) => {
  return remap(v, {
    "unassigned_count": "unassignedCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/createauthkeyscode.js
var z162 = __toESM(require("zod/v4"), 1);
var CreateAuthKeysCodeCodeChallengeMethod = {
  S256: "S256",
  Plain: "plain"
};
var UsageLimitType = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var CreateAuthKeysCodeCodeChallengeMethod$outboundSchema = outboundSchema(CreateAuthKeysCodeCodeChallengeMethod);
var UsageLimitType$outboundSchema = outboundSchema(UsageLimitType);
var CreateAuthKeysCodeRequestBody$outboundSchema = z162.object({
  callbackUrl: z162.string(),
  codeChallenge: z162.string().optional(),
  codeChallengeMethod: CreateAuthKeysCodeCodeChallengeMethod$outboundSchema.optional(),
  limit: z162.number().optional(),
  expiresAt: z162.nullable(z162.date().transform((v) => v.toISOString())).optional(),
  keyLabel: z162.string().optional(),
  usageLimitType: UsageLimitType$outboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    callbackUrl: "callback_url",
    codeChallenge: "code_challenge",
    codeChallengeMethod: "code_challenge_method",
    expiresAt: "expires_at",
    keyLabel: "key_label",
    usageLimitType: "usage_limit_type"
  });
});
var CreateAuthKeysCodeRequest$outboundSchema = z162.object({
  httpReferer: z162.string().optional(),
  xTitle: z162.string().optional(),
  requestBody: z162.lazy(() => CreateAuthKeysCodeRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    requestBody: "RequestBody"
  });
});
var CreateAuthKeysCodeData$inboundSchema = z162.object({
  id: z162.string(),
  app_id: z162.number(),
  created_at: z162.string()
}).transform((v) => {
  return remap(v, {
    "app_id": "appId",
    "created_at": "createdAt"
  });
});
var CreateAuthKeysCodeResponse$inboundSchema = z162.object({
  data: z162.lazy(() => CreateAuthKeysCodeData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/createcoinbasecharge.js
var z163 = __toESM(require("zod/v4"), 1);
var CreateCoinbaseChargeSecurity$outboundSchema = z163.object({
  bearer: z163.string()
});
var CreateCoinbaseChargeRequest$outboundSchema = z163.object({
  httpReferer: z163.string().optional(),
  xTitle: z163.string().optional(),
  createChargeRequest: CreateChargeRequest$outboundSchema
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    createChargeRequest: "CreateChargeRequest"
  });
});
var CallData$inboundSchema = z163.object({
  deadline: z163.string(),
  fee_amount: z163.string(),
  id: z163.string(),
  operator: z163.string(),
  prefix: z163.string(),
  recipient: z163.string(),
  recipient_amount: z163.string(),
  recipient_currency: z163.string(),
  refund_destination: z163.string(),
  signature: z163.string()
}).transform((v) => {
  return remap(v, {
    "fee_amount": "feeAmount",
    "recipient_amount": "recipientAmount",
    "recipient_currency": "recipientCurrency",
    "refund_destination": "refundDestination"
  });
});
var Metadata$inboundSchema = z163.object({
  chain_id: z163.number(),
  contract_address: z163.string(),
  sender: z163.string()
}).transform((v) => {
  return remap(v, {
    "chain_id": "chainId",
    "contract_address": "contractAddress"
  });
});
var TransferIntent$inboundSchema = z163.object({
  call_data: z163.lazy(() => CallData$inboundSchema),
  metadata: z163.lazy(() => Metadata$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "call_data": "callData"
  });
});
var Web3Data$inboundSchema = z163.object({
  transfer_intent: z163.lazy(() => TransferIntent$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "transfer_intent": "transferIntent"
  });
});
var CreateCoinbaseChargeData$inboundSchema = z163.object({
  id: z163.string(),
  created_at: z163.string(),
  expires_at: z163.string(),
  web3_data: z163.lazy(() => Web3Data$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "created_at": "createdAt",
    "expires_at": "expiresAt",
    "web3_data": "web3Data"
  });
});
var CreateCoinbaseChargeResponse$inboundSchema = z163.object({
  data: z163.lazy(() => CreateCoinbaseChargeData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/createembeddings.js
var z164 = __toESM(require("zod/v4"), 1);
var EncodingFormat = {
  Float: "float",
  Base64: "base64"
};
var ObjectT = {
  List: "list"
};
var ObjectEmbedding = {
  Embedding: "embedding"
};
var ImageUrl$outboundSchema = z164.object({
  url: z164.string()
});
var ContentImageURL$outboundSchema = z164.object({
  type: z164.literal("image_url"),
  imageUrl: z164.lazy(() => ImageUrl$outboundSchema)
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});
var ContentText$outboundSchema = z164.object({
  type: z164.literal("text"),
  text: z164.string()
});
var Content$outboundSchema = z164.union([
  z164.lazy(() => ContentText$outboundSchema),
  z164.lazy(() => ContentImageURL$outboundSchema)
]);
var Input$outboundSchema = z164.object({
  content: z164.array(z164.union([
    z164.lazy(() => ContentText$outboundSchema),
    z164.lazy(() => ContentImageURL$outboundSchema)
  ]))
});
var InputUnion$outboundSchema = z164.union([
  z164.string(),
  z164.array(z164.string()),
  z164.array(z164.number()),
  z164.array(z164.array(z164.number())),
  z164.array(z164.lazy(() => Input$outboundSchema))
]);
var EncodingFormat$outboundSchema = outboundSchema(EncodingFormat);
var CreateEmbeddingsRequestBody$outboundSchema = z164.object({
  input: z164.union([
    z164.string(),
    z164.array(z164.string()),
    z164.array(z164.number()),
    z164.array(z164.array(z164.number())),
    z164.array(z164.lazy(() => Input$outboundSchema))
  ]),
  model: z164.string(),
  encodingFormat: EncodingFormat$outboundSchema.optional(),
  dimensions: z164.int().optional(),
  user: z164.string().optional(),
  provider: ProviderPreferences$outboundSchema.optional(),
  inputType: z164.string().optional()
}).transform((v) => {
  return remap(v, {
    encodingFormat: "encoding_format",
    inputType: "input_type"
  });
});
var CreateEmbeddingsRequest$outboundSchema = z164.object({
  httpReferer: z164.string().optional(),
  xTitle: z164.string().optional(),
  requestBody: z164.lazy(() => CreateEmbeddingsRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    requestBody: "RequestBody"
  });
});
var ObjectT$inboundSchema = z164.enum(ObjectT);
var ObjectEmbedding$inboundSchema = z164.enum(ObjectEmbedding);
var Embedding$inboundSchema = z164.union([
  z164.array(z164.number()),
  z164.string()
]);
var CreateEmbeddingsData$inboundSchema = z164.object({
  object: ObjectEmbedding$inboundSchema,
  embedding: z164.union([z164.array(z164.number()), z164.string()]),
  index: z164.number().optional()
});
var Usage$inboundSchema = z164.object({
  prompt_tokens: z164.number(),
  total_tokens: z164.number(),
  cost: z164.number().optional()
}).transform((v) => {
  return remap(v, {
    "prompt_tokens": "promptTokens",
    "total_tokens": "totalTokens"
  });
});
var CreateEmbeddingsResponseBody$inboundSchema = z164.object({
  id: z164.string().optional(),
  object: ObjectT$inboundSchema,
  data: z164.array(z164.lazy(() => CreateEmbeddingsData$inboundSchema)),
  model: z164.string(),
  usage: z164.lazy(() => Usage$inboundSchema).optional()
});
var CreateEmbeddingsResponse$inboundSchema = z164.union([
  z164.lazy(() => CreateEmbeddingsResponseBody$inboundSchema),
  z164.string()
]);

// node_modules/@openrouter/sdk/esm/models/operations/createguardrail.js
var z165 = __toESM(require("zod/v4"), 1);
var CreateGuardrailResetIntervalRequest = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var CreateGuardrailResetIntervalResponse = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var CreateGuardrailResetIntervalRequest$outboundSchema = outboundSchema(CreateGuardrailResetIntervalRequest);
var CreateGuardrailRequestBody$outboundSchema = z165.object({
  name: z165.string(),
  description: z165.nullable(z165.string()).optional(),
  limitUsd: z165.nullable(z165.number()).optional(),
  resetInterval: z165.nullable(CreateGuardrailResetIntervalRequest$outboundSchema).optional(),
  allowedProviders: z165.nullable(z165.array(z165.string())).optional(),
  allowedModels: z165.nullable(z165.array(z165.string())).optional(),
  enforceZdr: z165.nullable(z165.boolean()).optional()
}).transform((v) => {
  return remap(v, {
    limitUsd: "limit_usd",
    resetInterval: "reset_interval",
    allowedProviders: "allowed_providers",
    allowedModels: "allowed_models",
    enforceZdr: "enforce_zdr"
  });
});
var CreateGuardrailRequest$outboundSchema = z165.object({
  httpReferer: z165.string().optional(),
  xTitle: z165.string().optional(),
  requestBody: z165.lazy(() => CreateGuardrailRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    requestBody: "RequestBody"
  });
});
var CreateGuardrailResetIntervalResponse$inboundSchema = inboundSchema(CreateGuardrailResetIntervalResponse);
var CreateGuardrailData$inboundSchema = z165.object({
  id: z165.string(),
  name: z165.string(),
  description: z165.nullable(z165.string()).optional(),
  limit_usd: z165.nullable(z165.number()).optional(),
  reset_interval: z165.nullable(CreateGuardrailResetIntervalResponse$inboundSchema).optional(),
  allowed_providers: z165.nullable(z165.array(z165.string())).optional(),
  allowed_models: z165.nullable(z165.array(z165.string())).optional(),
  enforce_zdr: z165.nullable(z165.boolean()).optional(),
  created_at: z165.string(),
  updated_at: z165.nullable(z165.string()).optional()
}).transform((v) => {
  return remap(v, {
    "limit_usd": "limitUsd",
    "reset_interval": "resetInterval",
    "allowed_providers": "allowedProviders",
    "allowed_models": "allowedModels",
    "enforce_zdr": "enforceZdr",
    "created_at": "createdAt",
    "updated_at": "updatedAt"
  });
});
var CreateGuardrailResponse$inboundSchema = z165.object({
  data: z165.lazy(() => CreateGuardrailData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/createkeys.js
var z166 = __toESM(require("zod/v4"), 1);
var CreateKeysLimitReset = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var CreateKeysLimitReset$outboundSchema = outboundSchema(CreateKeysLimitReset);
var CreateKeysRequestBody$outboundSchema = z166.object({
  name: z166.string(),
  limit: z166.nullable(z166.number()).optional(),
  limitReset: z166.nullable(CreateKeysLimitReset$outboundSchema).optional(),
  includeByokInLimit: z166.boolean().optional(),
  expiresAt: z166.nullable(z166.date().transform((v) => v.toISOString())).optional()
}).transform((v) => {
  return remap(v, {
    limitReset: "limit_reset",
    includeByokInLimit: "include_byok_in_limit",
    expiresAt: "expires_at"
  });
});
var CreateKeysRequest$outboundSchema = z166.object({
  httpReferer: z166.string().optional(),
  xTitle: z166.string().optional(),
  requestBody: z166.lazy(() => CreateKeysRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    requestBody: "RequestBody"
  });
});
var CreateKeysData$inboundSchema = z166.object({
  hash: z166.string(),
  name: z166.string(),
  label: z166.string(),
  disabled: z166.boolean(),
  limit: z166.nullable(z166.number()),
  limit_remaining: z166.nullable(z166.number()),
  limit_reset: z166.nullable(z166.string()),
  include_byok_in_limit: z166.boolean(),
  usage: z166.number(),
  usage_daily: z166.number(),
  usage_weekly: z166.number(),
  usage_monthly: z166.number(),
  byok_usage: z166.number(),
  byok_usage_daily: z166.number(),
  byok_usage_weekly: z166.number(),
  byok_usage_monthly: z166.number(),
  created_at: z166.string(),
  updated_at: z166.nullable(z166.string()),
  expires_at: z166.nullable(z166.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional()
}).transform((v) => {
  return remap(v, {
    "limit_remaining": "limitRemaining",
    "limit_reset": "limitReset",
    "include_byok_in_limit": "includeByokInLimit",
    "usage_daily": "usageDaily",
    "usage_weekly": "usageWeekly",
    "usage_monthly": "usageMonthly",
    "byok_usage": "byokUsage",
    "byok_usage_daily": "byokUsageDaily",
    "byok_usage_weekly": "byokUsageWeekly",
    "byok_usage_monthly": "byokUsageMonthly",
    "created_at": "createdAt",
    "updated_at": "updatedAt",
    "expires_at": "expiresAt"
  });
});
var CreateKeysResponse$inboundSchema = z166.object({
  data: z166.lazy(() => CreateKeysData$inboundSchema),
  key: z166.string()
});

// node_modules/@openrouter/sdk/esm/models/operations/createresponses.js
var z167 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/lib/event-streams.js
var EventStream = class extends ReadableStream {
  constructor(responseBody, parse2) {
    const upstream = responseBody.getReader();
    let buffer = new Uint8Array();
    super({
      async pull(downstream) {
        try {
          while (true) {
            const match2 = findBoundary(buffer);
            if (!match2) {
              const chunk = await upstream.read();
              if (chunk.done)
                return downstream.close();
              buffer = concatBuffer(buffer, chunk.value);
              continue;
            }
            const message = buffer.slice(0, match2.index);
            buffer = buffer.slice(match2.index + match2.length);
            const item = parseMessage(message, parse2);
            if (item && !item.done)
              return downstream.enqueue(item.value);
            if (item?.done) {
              await upstream.cancel("done");
              return downstream.close();
            }
          }
        } catch (e) {
          downstream.error(e);
          await upstream.cancel(e);
        }
      },
      cancel: (reason) => upstream.cancel(reason)
    });
  }
  // Polyfill for older browsers
  [Symbol.asyncIterator]() {
    const fn = ReadableStream.prototype[Symbol.asyncIterator];
    if (typeof fn === "function")
      return fn.call(this);
    const reader = this.getReader();
    return {
      next: async () => {
        const r = await reader.read();
        if (r.done) {
          reader.releaseLock();
          return { done: true, value: void 0 };
        }
        return { done: false, value: r.value };
      },
      throw: async (e) => {
        await reader.cancel(e);
        reader.releaseLock();
        return { done: true, value: void 0 };
      },
      return: async () => {
        await reader.cancel("done");
        reader.releaseLock();
        return { done: true, value: void 0 };
      },
      [Symbol.asyncIterator]() {
        return this;
      }
    };
  }
};
function concatBuffer(a, b) {
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}
function findBoundary(buf) {
  const len = buf.length;
  for (let i = 0; i < len; i++) {
    if (i <= len - 4 && buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) {
      return { index: i, length: 4 };
    }
    if (i <= len - 2 && buf[i] === 13 && buf[i + 1] === 13) {
      return { index: i, length: 2 };
    }
    if (i <= len - 2 && buf[i] === 10 && buf[i + 1] === 10) {
      return { index: i, length: 2 };
    }
  }
  return null;
}
function parseMessage(chunk, parse2) {
  const text2 = new TextDecoder().decode(chunk);
  const lines = text2.split(/\r\n|\r|\n/);
  const dataLines = [];
  const ret = {};
  let ignore = true;
  for (const line of lines) {
    if (!line || line.startsWith(":"))
      continue;
    ignore = false;
    const i = line.indexOf(":");
    const field = line.slice(0, i);
    const value = line[i + 1] === " " ? line.slice(i + 2) : line.slice(i + 1);
    if (field === "data")
      dataLines.push(value);
    else if (field === "event")
      ret.event = value;
    else if (field === "id")
      ret.id = value;
    else if (field === "retry") {
      const n = Number(value);
      if (!isNaN(n))
        ret.retry = n;
    }
  }
  if (ignore)
    return;
  if (dataLines.length)
    ret.data = dataLines.join("\n");
  return parse2(ret);
}

// node_modules/@openrouter/sdk/esm/models/operations/createresponses.js
var CreateResponsesRequest$outboundSchema = z167.object({
  httpReferer: z167.string().optional(),
  xTitle: z167.string().optional(),
  openResponsesRequest: OpenResponsesRequest$outboundSchema
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    openResponsesRequest: "OpenResponsesRequest"
  });
});
var CreateResponsesResponseBody$inboundSchema = z167.object({
  data: z167.string().transform((v, ctx) => {
    try {
      return JSON.parse(v);
    } catch (err) {
      ctx.addIssue({
        input: v,
        code: "custom",
        message: `malformed json: ${err}`
      });
      return z167.NEVER;
    }
  }).pipe(OpenResponsesStreamEvent$inboundSchema)
});
var CreateResponsesResponse$inboundSchema = z167.union([
  OpenResponsesNonStreamingResponse$inboundSchema,
  z167.custom((x) => x instanceof ReadableStream).transform((stream) => {
    return new EventStream(stream, (rawEvent) => {
      if (rawEvent.data === "[DONE]")
        return { done: true };
      return {
        value: z167.lazy(() => CreateResponsesResponseBody$inboundSchema).parse(rawEvent)?.data
      };
    });
  })
]);

// node_modules/@openrouter/sdk/esm/models/operations/deleteguardrail.js
var z168 = __toESM(require("zod/v4"), 1);
var DeleteGuardrailRequest$outboundSchema = z168.object({
  httpReferer: z168.string().optional(),
  xTitle: z168.string().optional(),
  id: z168.string()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var DeleteGuardrailResponse$inboundSchema = z168.object({
  deleted: z168.literal(true)
});

// node_modules/@openrouter/sdk/esm/models/operations/deletekeys.js
var z169 = __toESM(require("zod/v4"), 1);
var DeleteKeysRequest$outboundSchema = z169.object({
  httpReferer: z169.string().optional(),
  xTitle: z169.string().optional(),
  hash: z169.string()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var DeleteKeysResponse$inboundSchema = z169.object({
  deleted: z169.literal(true)
});

// node_modules/@openrouter/sdk/esm/models/operations/exchangeauthcodeforapikey.js
var z170 = __toESM(require("zod/v4"), 1);
var ExchangeAuthCodeForAPIKeyCodeChallengeMethod = {
  S256: "S256",
  Plain: "plain"
};
var ExchangeAuthCodeForAPIKeyCodeChallengeMethod$outboundSchema = outboundSchema(ExchangeAuthCodeForAPIKeyCodeChallengeMethod);
var ExchangeAuthCodeForAPIKeyRequestBody$outboundSchema = z170.object({
  code: z170.string(),
  codeVerifier: z170.string().optional(),
  codeChallengeMethod: z170.nullable(ExchangeAuthCodeForAPIKeyCodeChallengeMethod$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    codeVerifier: "code_verifier",
    codeChallengeMethod: "code_challenge_method"
  });
});
var ExchangeAuthCodeForAPIKeyRequest$outboundSchema = z170.object({
  httpReferer: z170.string().optional(),
  xTitle: z170.string().optional(),
  requestBody: z170.lazy(() => ExchangeAuthCodeForAPIKeyRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    requestBody: "RequestBody"
  });
});
var ExchangeAuthCodeForAPIKeyResponse$inboundSchema = z170.object({
  key: z170.string(),
  user_id: z170.nullable(z170.string())
}).transform((v) => {
  return remap(v, {
    "user_id": "userId"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/getcredits.js
var z171 = __toESM(require("zod/v4"), 1);
var GetCreditsRequest$outboundSchema = z171.object({
  httpReferer: z171.string().optional(),
  xTitle: z171.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var GetCreditsData$inboundSchema = z171.object({
  total_credits: z171.number(),
  total_usage: z171.number()
}).transform((v) => {
  return remap(v, {
    "total_credits": "totalCredits",
    "total_usage": "totalUsage"
  });
});
var GetCreditsResponse$inboundSchema = z171.object({
  data: z171.lazy(() => GetCreditsData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getcurrentkey.js
var z172 = __toESM(require("zod/v4"), 1);
var GetCurrentKeyRequest$outboundSchema = z172.object({
  httpReferer: z172.string().optional(),
  xTitle: z172.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var RateLimit$inboundSchema = z172.object({
  requests: z172.number(),
  interval: z172.string(),
  note: z172.string()
});
var GetCurrentKeyData$inboundSchema = z172.object({
  label: z172.string(),
  limit: z172.nullable(z172.number()),
  usage: z172.number(),
  usage_daily: z172.number(),
  usage_weekly: z172.number(),
  usage_monthly: z172.number(),
  byok_usage: z172.number(),
  byok_usage_daily: z172.number(),
  byok_usage_weekly: z172.number(),
  byok_usage_monthly: z172.number(),
  is_free_tier: z172.boolean(),
  is_management_key: z172.boolean(),
  is_provisioning_key: z172.boolean(),
  limit_remaining: z172.nullable(z172.number()),
  limit_reset: z172.nullable(z172.string()),
  include_byok_in_limit: z172.boolean(),
  expires_at: z172.nullable(z172.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional(),
  rate_limit: z172.lazy(() => RateLimit$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "usage_daily": "usageDaily",
    "usage_weekly": "usageWeekly",
    "usage_monthly": "usageMonthly",
    "byok_usage": "byokUsage",
    "byok_usage_daily": "byokUsageDaily",
    "byok_usage_weekly": "byokUsageWeekly",
    "byok_usage_monthly": "byokUsageMonthly",
    "is_free_tier": "isFreeTier",
    "is_management_key": "isManagementKey",
    "is_provisioning_key": "isProvisioningKey",
    "limit_remaining": "limitRemaining",
    "limit_reset": "limitReset",
    "include_byok_in_limit": "includeByokInLimit",
    "expires_at": "expiresAt",
    "rate_limit": "rateLimit"
  });
});
var GetCurrentKeyResponse$inboundSchema = z172.object({
  data: z172.lazy(() => GetCurrentKeyData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getgeneration.js
var z173 = __toESM(require("zod/v4"), 1);
var ApiType = {
  Completions: "completions",
  Embeddings: "embeddings"
};
var ProviderName2 = {
  AnyScale: "AnyScale",
  Atoma: "Atoma",
  CentML: "Cent-ML",
  CrofAI: "CrofAI",
  Enfer: "Enfer",
  GoPomelo: "GoPomelo",
  HuggingFace: "HuggingFace",
  Hyperbolic2: "Hyperbolic 2",
  InoCloud: "InoCloud",
  Kluster: "Kluster",
  Lambda: "Lambda",
  Lepton: "Lepton",
  Lynn2: "Lynn 2",
  Lynn: "Lynn",
  Mancer: "Mancer",
  Meta: "Meta",
  Modal: "Modal",
  Nineteen: "Nineteen",
  OctoAI: "OctoAI",
  Recursal: "Recursal",
  Reflection: "Reflection",
  Replicate: "Replicate",
  SambaNova2: "SambaNova 2",
  SFCompute: "SF Compute",
  Targon: "Targon",
  Together2: "Together 2",
  Ubicloud: "Ubicloud",
  OneDotAI: "01.AI",
  Ai21: "AI21",
  AionLabs: "AionLabs",
  Alibaba: "Alibaba",
  Ambient: "Ambient",
  AmazonBedrock: "Amazon Bedrock",
  AmazonNova: "Amazon Nova",
  Anthropic: "Anthropic",
  ArceeAI: "Arcee AI",
  AtlasCloud: "AtlasCloud",
  Avian: "Avian",
  Azure: "Azure",
  BaseTen: "BaseTen",
  BytePlus: "BytePlus",
  BlackForestLabs: "Black Forest Labs",
  Cerebras: "Cerebras",
  Chutes: "Chutes",
  Cirrascale: "Cirrascale",
  Clarifai: "Clarifai",
  Cloudflare: "Cloudflare",
  Cohere: "Cohere",
  Crusoe: "Crusoe",
  DeepInfra: "DeepInfra",
  DeepSeek: "DeepSeek",
  Featherless: "Featherless",
  Fireworks: "Fireworks",
  Friendli: "Friendli",
  GMICloud: "GMICloud",
  Google: "Google",
  GoogleAIStudio: "Google AI Studio",
  Groq: "Groq",
  Hyperbolic: "Hyperbolic",
  Inception: "Inception",
  Inceptron: "Inceptron",
  InferenceNet: "InferenceNet",
  Ionstream: "Ionstream",
  Infermatic: "Infermatic",
  IoNet: "Io Net",
  Inflection: "Inflection",
  Liquid: "Liquid",
  Mara: "Mara",
  Mancer2: "Mancer 2",
  Minimax: "Minimax",
  ModelRun: "ModelRun",
  Mistral: "Mistral",
  Modular: "Modular",
  MoonshotAI: "Moonshot AI",
  Morph: "Morph",
  NCompass: "NCompass",
  Nebius: "Nebius",
  NextBit: "NextBit",
  Novita: "Novita",
  Nvidia: "Nvidia",
  OpenAI: "OpenAI",
  OpenInference: "OpenInference",
  Parasail: "Parasail",
  Perplexity: "Perplexity",
  Phala: "Phala",
  Relace: "Relace",
  SambaNova: "SambaNova",
  Seed: "Seed",
  SiliconFlow: "SiliconFlow",
  Sourceful: "Sourceful",
  StepFun: "StepFun",
  Stealth: "Stealth",
  StreamLake: "StreamLake",
  Switchpoint: "Switchpoint",
  Together: "Together",
  Upstage: "Upstage",
  Venice: "Venice",
  WandB: "WandB",
  Xiaomi: "Xiaomi",
  XAI: "xAI",
  ZAi: "Z.AI",
  FakeProvider: "FakeProvider"
};
var GetGenerationRequest$outboundSchema = z173.object({
  httpReferer: z173.string().optional(),
  xTitle: z173.string().optional(),
  id: z173.string()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var ApiType$inboundSchema = inboundSchema(ApiType);
var ProviderName$inboundSchema2 = inboundSchema(ProviderName2);
var ProviderResponse$inboundSchema = z173.object({
  id: z173.string().optional(),
  endpoint_id: z173.string().optional(),
  model_permaslug: z173.string().optional(),
  provider_name: ProviderName$inboundSchema2.optional(),
  status: z173.nullable(z173.number()),
  latency: z173.number().optional(),
  is_byok: z173.boolean().optional()
}).transform((v) => {
  return remap(v, {
    "endpoint_id": "endpointId",
    "model_permaslug": "modelPermaslug",
    "provider_name": "providerName",
    "is_byok": "isByok"
  });
});
var GetGenerationData$inboundSchema = z173.object({
  id: z173.string(),
  upstream_id: z173.nullable(z173.string()),
  total_cost: z173.number(),
  cache_discount: z173.nullable(z173.number()),
  upstream_inference_cost: z173.nullable(z173.number()),
  created_at: z173.string(),
  model: z173.string(),
  app_id: z173.nullable(z173.number()),
  streamed: z173.nullable(z173.boolean()),
  cancelled: z173.nullable(z173.boolean()),
  provider_name: z173.nullable(z173.string()),
  latency: z173.nullable(z173.number()),
  moderation_latency: z173.nullable(z173.number()),
  generation_time: z173.nullable(z173.number()),
  finish_reason: z173.nullable(z173.string()),
  tokens_prompt: z173.nullable(z173.number()),
  tokens_completion: z173.nullable(z173.number()),
  native_tokens_prompt: z173.nullable(z173.number()),
  native_tokens_completion: z173.nullable(z173.number()),
  native_tokens_completion_images: z173.nullable(z173.number()),
  native_tokens_reasoning: z173.nullable(z173.number()),
  native_tokens_cached: z173.nullable(z173.number()),
  num_media_prompt: z173.nullable(z173.number()),
  num_input_audio_prompt: z173.nullable(z173.number()),
  num_media_completion: z173.nullable(z173.number()),
  num_search_results: z173.nullable(z173.number()),
  origin: z173.string(),
  usage: z173.number(),
  is_byok: z173.boolean(),
  native_finish_reason: z173.nullable(z173.string()),
  external_user: z173.nullable(z173.string()),
  api_type: z173.nullable(ApiType$inboundSchema),
  router: z173.nullable(z173.string()),
  provider_responses: z173.nullable(z173.array(z173.lazy(() => ProviderResponse$inboundSchema)))
}).transform((v) => {
  return remap(v, {
    "upstream_id": "upstreamId",
    "total_cost": "totalCost",
    "cache_discount": "cacheDiscount",
    "upstream_inference_cost": "upstreamInferenceCost",
    "created_at": "createdAt",
    "app_id": "appId",
    "provider_name": "providerName",
    "moderation_latency": "moderationLatency",
    "generation_time": "generationTime",
    "finish_reason": "finishReason",
    "tokens_prompt": "tokensPrompt",
    "tokens_completion": "tokensCompletion",
    "native_tokens_prompt": "nativeTokensPrompt",
    "native_tokens_completion": "nativeTokensCompletion",
    "native_tokens_completion_images": "nativeTokensCompletionImages",
    "native_tokens_reasoning": "nativeTokensReasoning",
    "native_tokens_cached": "nativeTokensCached",
    "num_media_prompt": "numMediaPrompt",
    "num_input_audio_prompt": "numInputAudioPrompt",
    "num_media_completion": "numMediaCompletion",
    "num_search_results": "numSearchResults",
    "is_byok": "isByok",
    "native_finish_reason": "nativeFinishReason",
    "external_user": "externalUser",
    "api_type": "apiType",
    "provider_responses": "providerResponses"
  });
});
var GetGenerationResponse$inboundSchema = z173.object({
  data: z173.lazy(() => GetGenerationData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getguardrail.js
var z174 = __toESM(require("zod/v4"), 1);
var GetGuardrailResetInterval = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var GetGuardrailRequest$outboundSchema = z174.object({
  httpReferer: z174.string().optional(),
  xTitle: z174.string().optional(),
  id: z174.string()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var GetGuardrailResetInterval$inboundSchema = inboundSchema(GetGuardrailResetInterval);
var GetGuardrailData$inboundSchema = z174.object({
  id: z174.string(),
  name: z174.string(),
  description: z174.nullable(z174.string()).optional(),
  limit_usd: z174.nullable(z174.number()).optional(),
  reset_interval: z174.nullable(GetGuardrailResetInterval$inboundSchema).optional(),
  allowed_providers: z174.nullable(z174.array(z174.string())).optional(),
  allowed_models: z174.nullable(z174.array(z174.string())).optional(),
  enforce_zdr: z174.nullable(z174.boolean()).optional(),
  created_at: z174.string(),
  updated_at: z174.nullable(z174.string()).optional()
}).transform((v) => {
  return remap(v, {
    "limit_usd": "limitUsd",
    "reset_interval": "resetInterval",
    "allowed_providers": "allowedProviders",
    "allowed_models": "allowedModels",
    "enforce_zdr": "enforceZdr",
    "created_at": "createdAt",
    "updated_at": "updatedAt"
  });
});
var GetGuardrailResponse$inboundSchema = z174.object({
  data: z174.lazy(() => GetGuardrailData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getkey.js
var z175 = __toESM(require("zod/v4"), 1);
var GetKeyRequest$outboundSchema = z175.object({
  httpReferer: z175.string().optional(),
  xTitle: z175.string().optional(),
  hash: z175.string()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var GetKeyData$inboundSchema = z175.object({
  hash: z175.string(),
  name: z175.string(),
  label: z175.string(),
  disabled: z175.boolean(),
  limit: z175.nullable(z175.number()),
  limit_remaining: z175.nullable(z175.number()),
  limit_reset: z175.nullable(z175.string()),
  include_byok_in_limit: z175.boolean(),
  usage: z175.number(),
  usage_daily: z175.number(),
  usage_weekly: z175.number(),
  usage_monthly: z175.number(),
  byok_usage: z175.number(),
  byok_usage_daily: z175.number(),
  byok_usage_weekly: z175.number(),
  byok_usage_monthly: z175.number(),
  created_at: z175.string(),
  updated_at: z175.nullable(z175.string()),
  expires_at: z175.nullable(z175.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional()
}).transform((v) => {
  return remap(v, {
    "limit_remaining": "limitRemaining",
    "limit_reset": "limitReset",
    "include_byok_in_limit": "includeByokInLimit",
    "usage_daily": "usageDaily",
    "usage_weekly": "usageWeekly",
    "usage_monthly": "usageMonthly",
    "byok_usage": "byokUsage",
    "byok_usage_daily": "byokUsageDaily",
    "byok_usage_weekly": "byokUsageWeekly",
    "byok_usage_monthly": "byokUsageMonthly",
    "created_at": "createdAt",
    "updated_at": "updatedAt",
    "expires_at": "expiresAt"
  });
});
var GetKeyResponse$inboundSchema = z175.object({
  data: z175.lazy(() => GetKeyData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getmodels.js
var z176 = __toESM(require("zod/v4"), 1);
var Category = {
  Programming: "programming",
  Roleplay: "roleplay",
  Marketing: "marketing",
  MarketingSeo: "marketing/seo",
  Technology: "technology",
  Science: "science",
  Translation: "translation",
  Legal: "legal",
  Finance: "finance",
  Health: "health",
  Trivia: "trivia",
  Academia: "academia"
};
var Category$outboundSchema = outboundSchema(Category);
var GetModelsRequest$outboundSchema = z176.object({
  httpReferer: z176.string().optional(),
  xTitle: z176.string().optional(),
  category: Category$outboundSchema.optional(),
  supportedParameters: z176.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    supportedParameters: "supported_parameters"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/getuseractivity.js
var z177 = __toESM(require("zod/v4"), 1);
var GetUserActivityRequest$outboundSchema = z177.object({
  httpReferer: z177.string().optional(),
  xTitle: z177.string().optional(),
  date: z177.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var GetUserActivityResponse$inboundSchema = z177.object({
  data: z177.array(ActivityItem$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/list.js
var z178 = __toESM(require("zod/v4"), 1);
var ListRequest$outboundSchema = z178.object({
  httpReferer: z178.string().optional(),
  xTitle: z178.string().optional(),
  includeDisabled: z178.string().optional(),
  offset: z178.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    includeDisabled: "include_disabled"
  });
});
var ListData$inboundSchema = z178.object({
  hash: z178.string(),
  name: z178.string(),
  label: z178.string(),
  disabled: z178.boolean(),
  limit: z178.nullable(z178.number()),
  limit_remaining: z178.nullable(z178.number()),
  limit_reset: z178.nullable(z178.string()),
  include_byok_in_limit: z178.boolean(),
  usage: z178.number(),
  usage_daily: z178.number(),
  usage_weekly: z178.number(),
  usage_monthly: z178.number(),
  byok_usage: z178.number(),
  byok_usage_daily: z178.number(),
  byok_usage_weekly: z178.number(),
  byok_usage_monthly: z178.number(),
  created_at: z178.string(),
  updated_at: z178.nullable(z178.string()),
  expires_at: z178.nullable(z178.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional()
}).transform((v) => {
  return remap(v, {
    "limit_remaining": "limitRemaining",
    "limit_reset": "limitReset",
    "include_byok_in_limit": "includeByokInLimit",
    "usage_daily": "usageDaily",
    "usage_weekly": "usageWeekly",
    "usage_monthly": "usageMonthly",
    "byok_usage": "byokUsage",
    "byok_usage_daily": "byokUsageDaily",
    "byok_usage_weekly": "byokUsageWeekly",
    "byok_usage_monthly": "byokUsageMonthly",
    "created_at": "createdAt",
    "updated_at": "updatedAt",
    "expires_at": "expiresAt"
  });
});
var ListResponse$inboundSchema = z178.object({
  data: z178.array(z178.lazy(() => ListData$inboundSchema))
});

// node_modules/@openrouter/sdk/esm/models/operations/listembeddingsmodels.js
var z179 = __toESM(require("zod/v4"), 1);
var ListEmbeddingsModelsRequest$outboundSchema = z179.object({
  httpReferer: z179.string().optional(),
  xTitle: z179.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listendpoints.js
var z180 = __toESM(require("zod/v4"), 1);
var ListEndpointsRequest$outboundSchema = z180.object({
  httpReferer: z180.string().optional(),
  xTitle: z180.string().optional(),
  author: z180.string(),
  slug: z180.string()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var ListEndpointsResponse$inboundSchema2 = z180.object({
  data: ListEndpointsResponse$inboundSchema
});

// node_modules/@openrouter/sdk/esm/models/operations/listendpointszdr.js
var z181 = __toESM(require("zod/v4"), 1);
var ListEndpointsZdrRequest$outboundSchema = z181.object({
  httpReferer: z181.string().optional(),
  xTitle: z181.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var ListEndpointsZdrResponse$inboundSchema = z181.object({
  data: z181.array(PublicEndpoint$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/listguardrailkeyassignments.js
var z182 = __toESM(require("zod/v4"), 1);
var ListGuardrailKeyAssignmentsRequest$outboundSchema = z182.object({
  httpReferer: z182.string().optional(),
  xTitle: z182.string().optional(),
  id: z182.string(),
  offset: z182.string().optional(),
  limit: z182.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var ListGuardrailKeyAssignmentsData$inboundSchema = z182.object({
  id: z182.string(),
  key_hash: z182.string(),
  guardrail_id: z182.string(),
  key_name: z182.string(),
  key_label: z182.string(),
  assigned_by: z182.nullable(z182.string()),
  created_at: z182.string()
}).transform((v) => {
  return remap(v, {
    "key_hash": "keyHash",
    "guardrail_id": "guardrailId",
    "key_name": "keyName",
    "key_label": "keyLabel",
    "assigned_by": "assignedBy",
    "created_at": "createdAt"
  });
});
var ListGuardrailKeyAssignmentsResponse$inboundSchema = z182.object({
  data: z182.array(z182.lazy(() => ListGuardrailKeyAssignmentsData$inboundSchema)),
  total_count: z182.number()
}).transform((v) => {
  return remap(v, {
    "total_count": "totalCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listguardrailmemberassignments.js
var z183 = __toESM(require("zod/v4"), 1);
var ListGuardrailMemberAssignmentsRequest$outboundSchema = z183.object({
  httpReferer: z183.string().optional(),
  xTitle: z183.string().optional(),
  id: z183.string(),
  offset: z183.string().optional(),
  limit: z183.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var ListGuardrailMemberAssignmentsData$inboundSchema = z183.object({
  id: z183.string(),
  user_id: z183.string(),
  organization_id: z183.string(),
  guardrail_id: z183.string(),
  assigned_by: z183.nullable(z183.string()),
  created_at: z183.string()
}).transform((v) => {
  return remap(v, {
    "user_id": "userId",
    "organization_id": "organizationId",
    "guardrail_id": "guardrailId",
    "assigned_by": "assignedBy",
    "created_at": "createdAt"
  });
});
var ListGuardrailMemberAssignmentsResponse$inboundSchema = z183.object({
  data: z183.array(z183.lazy(() => ListGuardrailMemberAssignmentsData$inboundSchema)),
  total_count: z183.number()
}).transform((v) => {
  return remap(v, {
    "total_count": "totalCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listguardrails.js
var z184 = __toESM(require("zod/v4"), 1);
var ListGuardrailsResetInterval = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var ListGuardrailsRequest$outboundSchema = z184.object({
  httpReferer: z184.string().optional(),
  xTitle: z184.string().optional(),
  offset: z184.string().optional(),
  limit: z184.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var ListGuardrailsResetInterval$inboundSchema = inboundSchema(ListGuardrailsResetInterval);
var ListGuardrailsData$inboundSchema = z184.object({
  id: z184.string(),
  name: z184.string(),
  description: z184.nullable(z184.string()).optional(),
  limit_usd: z184.nullable(z184.number()).optional(),
  reset_interval: z184.nullable(ListGuardrailsResetInterval$inboundSchema).optional(),
  allowed_providers: z184.nullable(z184.array(z184.string())).optional(),
  allowed_models: z184.nullable(z184.array(z184.string())).optional(),
  enforce_zdr: z184.nullable(z184.boolean()).optional(),
  created_at: z184.string(),
  updated_at: z184.nullable(z184.string()).optional()
}).transform((v) => {
  return remap(v, {
    "limit_usd": "limitUsd",
    "reset_interval": "resetInterval",
    "allowed_providers": "allowedProviders",
    "allowed_models": "allowedModels",
    "enforce_zdr": "enforceZdr",
    "created_at": "createdAt",
    "updated_at": "updatedAt"
  });
});
var ListGuardrailsResponse$inboundSchema = z184.object({
  data: z184.array(z184.lazy(() => ListGuardrailsData$inboundSchema)),
  total_count: z184.number()
}).transform((v) => {
  return remap(v, {
    "total_count": "totalCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listkeyassignments.js
var z185 = __toESM(require("zod/v4"), 1);
var ListKeyAssignmentsRequest$outboundSchema = z185.object({
  httpReferer: z185.string().optional(),
  xTitle: z185.string().optional(),
  offset: z185.string().optional(),
  limit: z185.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var ListKeyAssignmentsData$inboundSchema = z185.object({
  id: z185.string(),
  key_hash: z185.string(),
  guardrail_id: z185.string(),
  key_name: z185.string(),
  key_label: z185.string(),
  assigned_by: z185.nullable(z185.string()),
  created_at: z185.string()
}).transform((v) => {
  return remap(v, {
    "key_hash": "keyHash",
    "guardrail_id": "guardrailId",
    "key_name": "keyName",
    "key_label": "keyLabel",
    "assigned_by": "assignedBy",
    "created_at": "createdAt"
  });
});
var ListKeyAssignmentsResponse$inboundSchema = z185.object({
  data: z185.array(z185.lazy(() => ListKeyAssignmentsData$inboundSchema)),
  total_count: z185.number()
}).transform((v) => {
  return remap(v, {
    "total_count": "totalCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listmemberassignments.js
var z186 = __toESM(require("zod/v4"), 1);
var ListMemberAssignmentsRequest$outboundSchema = z186.object({
  httpReferer: z186.string().optional(),
  xTitle: z186.string().optional(),
  offset: z186.string().optional(),
  limit: z186.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var ListMemberAssignmentsData$inboundSchema = z186.object({
  id: z186.string(),
  user_id: z186.string(),
  organization_id: z186.string(),
  guardrail_id: z186.string(),
  assigned_by: z186.nullable(z186.string()),
  created_at: z186.string()
}).transform((v) => {
  return remap(v, {
    "user_id": "userId",
    "organization_id": "organizationId",
    "guardrail_id": "guardrailId",
    "assigned_by": "assignedBy",
    "created_at": "createdAt"
  });
});
var ListMemberAssignmentsResponse$inboundSchema = z186.object({
  data: z186.array(z186.lazy(() => ListMemberAssignmentsData$inboundSchema)),
  total_count: z186.number()
}).transform((v) => {
  return remap(v, {
    "total_count": "totalCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listmodelscount.js
var z187 = __toESM(require("zod/v4"), 1);
var ListModelsCountRequest$outboundSchema = z187.object({
  httpReferer: z187.string().optional(),
  xTitle: z187.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listmodelsuser.js
var z188 = __toESM(require("zod/v4"), 1);
var ListModelsUserSecurity$outboundSchema = z188.object({
  bearer: z188.string()
});
var ListModelsUserRequest$outboundSchema = z188.object({
  httpReferer: z188.string().optional(),
  xTitle: z188.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listproviders.js
var z189 = __toESM(require("zod/v4"), 1);
var ListProvidersRequest$outboundSchema = z189.object({
  httpReferer: z189.string().optional(),
  xTitle: z189.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title"
  });
});
var ListProvidersData$inboundSchema = z189.object({
  name: z189.string(),
  slug: z189.string(),
  privacy_policy_url: z189.nullable(z189.string()),
  terms_of_service_url: z189.nullable(z189.string()).optional(),
  status_page_url: z189.nullable(z189.string()).optional()
}).transform((v) => {
  return remap(v, {
    "privacy_policy_url": "privacyPolicyUrl",
    "terms_of_service_url": "termsOfServiceUrl",
    "status_page_url": "statusPageUrl"
  });
});
var ListProvidersResponse$inboundSchema = z189.object({
  data: z189.array(z189.lazy(() => ListProvidersData$inboundSchema))
});

// node_modules/@openrouter/sdk/esm/models/operations/sendchatcompletionrequest.js
var z190 = __toESM(require("zod/v4"), 1);
var SendChatCompletionRequestRequest$outboundSchema = z190.object({
  httpReferer: z190.string().optional(),
  xTitle: z190.string().optional(),
  chatGenerationParams: ChatGenerationParams$outboundSchema
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    chatGenerationParams: "ChatGenerationParams"
  });
});
var SendChatCompletionRequestResponseBody$inboundSchema = z190.object({
  data: z190.string().transform((v, ctx) => {
    try {
      return JSON.parse(v);
    } catch (err) {
      ctx.addIssue({
        input: v,
        code: "custom",
        message: `malformed json: ${err}`
      });
      return z190.NEVER;
    }
  }).pipe(ChatStreamingResponseChunk$inboundSchema)
});
var SendChatCompletionRequestResponse$inboundSchema = z190.union([
  ChatResponse$inboundSchema,
  z190.custom((x) => x instanceof ReadableStream).transform((stream) => {
    return new EventStream(stream, (rawEvent) => {
      if (rawEvent.data === "[DONE]")
        return { done: true };
      return {
        value: z190.lazy(() => SendChatCompletionRequestResponseBody$inboundSchema).parse(rawEvent)?.data
      };
    });
  })
]);

// node_modules/@openrouter/sdk/esm/models/operations/updateguardrail.js
var z191 = __toESM(require("zod/v4"), 1);
var UpdateGuardrailResetIntervalRequest = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var UpdateGuardrailResetIntervalResponse = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var UpdateGuardrailResetIntervalRequest$outboundSchema = outboundSchema(UpdateGuardrailResetIntervalRequest);
var UpdateGuardrailRequestBody$outboundSchema = z191.object({
  name: z191.string().optional(),
  description: z191.nullable(z191.string()).optional(),
  limitUsd: z191.nullable(z191.number()).optional(),
  resetInterval: z191.nullable(UpdateGuardrailResetIntervalRequest$outboundSchema).optional(),
  allowedProviders: z191.nullable(z191.array(z191.string())).optional(),
  allowedModels: z191.nullable(z191.array(z191.string())).optional(),
  enforceZdr: z191.nullable(z191.boolean()).optional()
}).transform((v) => {
  return remap(v, {
    limitUsd: "limit_usd",
    resetInterval: "reset_interval",
    allowedProviders: "allowed_providers",
    allowedModels: "allowed_models",
    enforceZdr: "enforce_zdr"
  });
});
var UpdateGuardrailRequest$outboundSchema = z191.object({
  httpReferer: z191.string().optional(),
  xTitle: z191.string().optional(),
  id: z191.string(),
  requestBody: z191.lazy(() => UpdateGuardrailRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    requestBody: "RequestBody"
  });
});
var UpdateGuardrailResetIntervalResponse$inboundSchema = inboundSchema(UpdateGuardrailResetIntervalResponse);
var UpdateGuardrailData$inboundSchema = z191.object({
  id: z191.string(),
  name: z191.string(),
  description: z191.nullable(z191.string()).optional(),
  limit_usd: z191.nullable(z191.number()).optional(),
  reset_interval: z191.nullable(UpdateGuardrailResetIntervalResponse$inboundSchema).optional(),
  allowed_providers: z191.nullable(z191.array(z191.string())).optional(),
  allowed_models: z191.nullable(z191.array(z191.string())).optional(),
  enforce_zdr: z191.nullable(z191.boolean()).optional(),
  created_at: z191.string(),
  updated_at: z191.nullable(z191.string()).optional()
}).transform((v) => {
  return remap(v, {
    "limit_usd": "limitUsd",
    "reset_interval": "resetInterval",
    "allowed_providers": "allowedProviders",
    "allowed_models": "allowedModels",
    "enforce_zdr": "enforceZdr",
    "created_at": "createdAt",
    "updated_at": "updatedAt"
  });
});
var UpdateGuardrailResponse$inboundSchema = z191.object({
  data: z191.lazy(() => UpdateGuardrailData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/updatekeys.js
var z192 = __toESM(require("zod/v4"), 1);
var UpdateKeysLimitReset = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var UpdateKeysLimitReset$outboundSchema = outboundSchema(UpdateKeysLimitReset);
var UpdateKeysRequestBody$outboundSchema = z192.object({
  name: z192.string().optional(),
  disabled: z192.boolean().optional(),
  limit: z192.nullable(z192.number()).optional(),
  limitReset: z192.nullable(UpdateKeysLimitReset$outboundSchema).optional(),
  includeByokInLimit: z192.boolean().optional()
}).transform((v) => {
  return remap(v, {
    limitReset: "limit_reset",
    includeByokInLimit: "include_byok_in_limit"
  });
});
var UpdateKeysRequest$outboundSchema = z192.object({
  httpReferer: z192.string().optional(),
  xTitle: z192.string().optional(),
  hash: z192.string(),
  requestBody: z192.lazy(() => UpdateKeysRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    xTitle: "X-Title",
    requestBody: "RequestBody"
  });
});
var UpdateKeysData$inboundSchema = z192.object({
  hash: z192.string(),
  name: z192.string(),
  label: z192.string(),
  disabled: z192.boolean(),
  limit: z192.nullable(z192.number()),
  limit_remaining: z192.nullable(z192.number()),
  limit_reset: z192.nullable(z192.string()),
  include_byok_in_limit: z192.boolean(),
  usage: z192.number(),
  usage_daily: z192.number(),
  usage_weekly: z192.number(),
  usage_monthly: z192.number(),
  byok_usage: z192.number(),
  byok_usage_daily: z192.number(),
  byok_usage_weekly: z192.number(),
  byok_usage_monthly: z192.number(),
  created_at: z192.string(),
  updated_at: z192.nullable(z192.string()),
  expires_at: z192.nullable(z192.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional()
}).transform((v) => {
  return remap(v, {
    "limit_remaining": "limitRemaining",
    "limit_reset": "limitReset",
    "include_byok_in_limit": "includeByokInLimit",
    "usage_daily": "usageDaily",
    "usage_weekly": "usageWeekly",
    "usage_monthly": "usageMonthly",
    "byok_usage": "byokUsage",
    "byok_usage_daily": "byokUsageDaily",
    "byok_usage_weekly": "byokUsageWeekly",
    "byok_usage_monthly": "byokUsageMonthly",
    "created_at": "createdAt",
    "updated_at": "updatedAt",
    "expires_at": "expiresAt"
  });
});
var UpdateKeysResponse$inboundSchema = z192.object({
  data: z192.lazy(() => UpdateKeysData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/types/async.js
var __classPrivateFieldSet2 = function(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet2 = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _APIPromise_promise;
var _APIPromise_unwrapped;
var _a;
var APIPromise = class {
  constructor(p) {
    _APIPromise_promise.set(this, void 0);
    _APIPromise_unwrapped.set(this, void 0);
    this[_a] = "APIPromise";
    __classPrivateFieldSet2(this, _APIPromise_promise, p instanceof Promise ? p : Promise.resolve(p), "f");
    __classPrivateFieldSet2(this, _APIPromise_unwrapped, p instanceof Promise ? __classPrivateFieldGet2(this, _APIPromise_promise, "f").then(([value]) => value) : Promise.resolve(p[0]), "f");
  }
  then(onfulfilled, onrejected) {
    return __classPrivateFieldGet2(this, _APIPromise_promise, "f").then(onfulfilled ? ([value]) => onfulfilled(value) : void 0, onrejected);
  }
  catch(onrejected) {
    return __classPrivateFieldGet2(this, _APIPromise_unwrapped, "f").catch(onrejected);
  }
  finally(onfinally) {
    return __classPrivateFieldGet2(this, _APIPromise_unwrapped, "f").finally(onfinally);
  }
  $inspect() {
    return __classPrivateFieldGet2(this, _APIPromise_promise, "f");
  }
};
_APIPromise_promise = /* @__PURE__ */ new WeakMap(), _APIPromise_unwrapped = /* @__PURE__ */ new WeakMap(), _a = Symbol.toStringTag;

// node_modules/@openrouter/sdk/esm/funcs/analyticsGetUserActivity.js
function analyticsGetUserActivity(client, request, options) {
  return new APIPromise($do(client, request, options));
}
async function $do(client, request, options) {
  const parsed = safeParse(request, (value) => GetUserActivityRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/activity")();
  const query = encodeFormQuery({
    "date": payload?.date
  });
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload?.["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "getUserActivity",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    query,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "401", "403", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, GetUserActivityResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(403, ForbiddenResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/sdk/analytics.js
var Analytics = class extends ClientSDK {
  /**
   * Get user activity grouped by endpoint
   *
   * @remarks
   * Returns user activity data grouped by endpoint for the last 30 (completed) UTC days. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async getUserActivity(request, options) {
    return unwrapAsync(analyticsGetUserActivity(this, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/apiKeysCreate.js
function apiKeysCreate(client, request, options) {
  return new APIPromise($do2(client, request, options));
}
async function $do2(client, request, options) {
  const parsed = safeParse(request, (value) => CreateKeysRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.RequestBody, { explode: true });
  const path2 = pathToFunc("/keys")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "createKeys",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "POST",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "401", "429", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(201, CreateKeysResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(429, TooManyRequestsResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/apiKeysDelete.js
function apiKeysDelete(client, request, options) {
  return new APIPromise($do3(client, request, options));
}
async function $do3(client, request, options) {
  const parsed = safeParse(request, (value) => DeleteKeysRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const pathParams = {
    hash: encodeSimple("hash", payload.hash, {
      explode: false,
      charEncoding: "percent"
    })
  };
  const path2 = pathToFunc("/keys/{hash}")(pathParams);
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "deleteKeys",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "DELETE",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["401", "404", "429", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, DeleteKeysResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(429, TooManyRequestsResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/apiKeysGet.js
function apiKeysGet(client, request, options) {
  return new APIPromise($do4(client, request, options));
}
async function $do4(client, request, options) {
  const parsed = safeParse(request, (value) => GetKeyRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const pathParams = {
    hash: encodeSimple("hash", payload.hash, {
      explode: false,
      charEncoding: "percent"
    })
  };
  const path2 = pathToFunc("/keys/{hash}")(pathParams);
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "getKey",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["401", "404", "429", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, GetKeyResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(429, TooManyRequestsResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/apiKeysGetCurrentKeyMetadata.js
function apiKeysGetCurrentKeyMetadata(client, request, options) {
  return new APIPromise($do5(client, request, options));
}
async function $do5(client, request, options) {
  const parsed = safeParse(request, (value) => GetCurrentKeyRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/key")();
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload?.["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "getCurrentKey",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["401", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, GetCurrentKeyResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/apiKeysList.js
function apiKeysList(client, request, options) {
  return new APIPromise($do6(client, request, options));
}
async function $do6(client, request, options) {
  const parsed = safeParse(request, (value) => ListRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/keys")();
  const query = encodeFormQuery({
    "include_disabled": payload?.include_disabled,
    "offset": payload?.offset
  });
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload?.["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "list",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    query,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["401", "429", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ListResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(429, TooManyRequestsResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/apiKeysUpdate.js
function apiKeysUpdate(client, request, options) {
  return new APIPromise($do7(client, request, options));
}
async function $do7(client, request, options) {
  const parsed = safeParse(request, (value) => UpdateKeysRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.RequestBody, { explode: true });
  const pathParams = {
    hash: encodeSimple("hash", payload.hash, {
      explode: false,
      charEncoding: "percent"
    })
  };
  const path2 = pathToFunc("/keys/{hash}")(pathParams);
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "updateKeys",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "PATCH",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "401", "404", "429", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, UpdateKeysResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(429, TooManyRequestsResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/sdk/apikeys.js
var APIKeys = class extends ClientSDK {
  /**
   * List API keys
   *
   * @remarks
   * List all API keys for the authenticated user. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async list(request, options) {
    return unwrapAsync(apiKeysList(this, request, options));
  }
  /**
   * Create a new API key
   *
   * @remarks
   * Create a new API key for the authenticated user. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async create(request, options) {
    return unwrapAsync(apiKeysCreate(this, request, options));
  }
  /**
   * Update an API key
   *
   * @remarks
   * Update an existing API key. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async update(request, options) {
    return unwrapAsync(apiKeysUpdate(this, request, options));
  }
  /**
   * Delete an API key
   *
   * @remarks
   * Delete an existing API key. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async delete(request, options) {
    return unwrapAsync(apiKeysDelete(this, request, options));
  }
  /**
   * Get a single API key
   *
   * @remarks
   * Get a single API key by hash. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async get(request, options) {
    return unwrapAsync(apiKeysGet(this, request, options));
  }
  /**
   * Get current API key
   *
   * @remarks
   * Get information on the API key associated with the current authentication session
   */
  async getCurrentKeyMetadata(request, options) {
    return unwrapAsync(apiKeysGetCurrentKeyMetadata(this, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/betaResponsesSend.js
function betaResponsesSend(client, request, options) {
  return new APIPromise($do8(client, request, options));
}
async function $do8(client, request, options) {
  const parsed = safeParse(request, (value) => CreateResponsesRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.OpenResponsesRequest, {
    explode: true
  });
  const path2 = pathToFunc("/responses")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: request?.openResponsesRequest?.stream ? "text/event-stream" : "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "createResponses",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "POST",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: [
      "400",
      "401",
      "402",
      "404",
      "408",
      "413",
      "422",
      "429",
      "4XX",
      "500",
      "502",
      "503",
      "524",
      "529",
      "5XX"
    ],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, CreateResponsesResponse$inboundSchema), sse(200, CreateResponsesResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(402, PaymentRequiredResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(408, RequestTimeoutResponseError$inboundSchema), jsonErr(413, PayloadTooLargeResponseError$inboundSchema), jsonErr(422, UnprocessableEntityResponseError$inboundSchema), jsonErr(429, TooManyRequestsResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), jsonErr(502, BadGatewayResponseError$inboundSchema), jsonErr(503, ServiceUnavailableResponseError$inboundSchema), jsonErr(524, EdgeNetworkTimeoutResponseError$inboundSchema), jsonErr(529, ProviderOverloadedResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/sdk/responses.js
var Responses = class extends ClientSDK {
  async send(request, options) {
    return unwrapAsync(betaResponsesSend(this, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/sdk/beta.js
var Beta = class extends ClientSDK {
  get responses() {
    return this._responses ?? (this._responses = new Responses(this._options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/chatSend.js
function chatSend(client, request, options) {
  return new APIPromise($do9(client, request, options));
}
async function $do9(client, request, options) {
  const parsed = safeParse(request, (value) => SendChatCompletionRequestRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.ChatGenerationParams, {
    explode: true
  });
  const path2 = pathToFunc("/chat/completions")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: request?.chatGenerationParams?.stream ? "text/event-stream" : "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "sendChatCompletionRequest",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "POST",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: [
      "400",
      "401",
      "402",
      "404",
      "408",
      "413",
      "422",
      "429",
      "4XX",
      "500",
      "502",
      "503",
      "524",
      "529",
      "5XX"
    ],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, SendChatCompletionRequestResponse$inboundSchema), sse(200, SendChatCompletionRequestResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(402, PaymentRequiredResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(408, RequestTimeoutResponseError$inboundSchema), jsonErr(413, PayloadTooLargeResponseError$inboundSchema), jsonErr(422, UnprocessableEntityResponseError$inboundSchema), jsonErr(429, TooManyRequestsResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), jsonErr(502, BadGatewayResponseError$inboundSchema), jsonErr(503, ServiceUnavailableResponseError$inboundSchema), jsonErr(524, EdgeNetworkTimeoutResponseError$inboundSchema), jsonErr(529, ProviderOverloadedResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/sdk/chat.js
var Chat = class extends ClientSDK {
  async send(request, options) {
    return unwrapAsync(chatSend(this, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/creditsCreateCoinbaseCharge.js
function creditsCreateCoinbaseCharge(client, security, request, options) {
  return new APIPromise($do10(client, security, request, options));
}
async function $do10(client, security, request, options) {
  const parsed = safeParse(request, (value) => CreateCoinbaseChargeRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.CreateChargeRequest, {
    explode: true
  });
  const path2 = pathToFunc("/credits/coinbase")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const requestSecurity = resolveSecurity([
    {
      fieldName: "Authorization",
      type: "http:bearer",
      value: security?.bearer
    }
  ]);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "createCoinbaseCharge",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: security,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "POST",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "401", "429", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, CreateCoinbaseChargeResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(429, TooManyRequestsResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/creditsGetCredits.js
function creditsGetCredits(client, request, options) {
  return new APIPromise($do11(client, request, options));
}
async function $do11(client, request, options) {
  const parsed = safeParse(request, (value) => GetCreditsRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/credits")();
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload?.["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "getCredits",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["401", "403", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, GetCreditsResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(403, ForbiddenResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/sdk/credits.js
var Credits = class extends ClientSDK {
  /**
   * Get remaining credits
   *
   * @remarks
   * Get total credits purchased and used for the authenticated user. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async getCredits(request, options) {
    return unwrapAsync(creditsGetCredits(this, request, options));
  }
  /**
   * Create a Coinbase charge for crypto payment
   *
   * @remarks
   * Create a Coinbase charge for crypto payment
   */
  async createCoinbaseCharge(security, request, options) {
    return unwrapAsync(creditsCreateCoinbaseCharge(this, security, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/embeddingsGenerate.js
function embeddingsGenerate(client, request, options) {
  return new APIPromise($do12(client, request, options));
}
async function $do12(client, request, options) {
  const parsed = safeParse(request, (value) => CreateEmbeddingsRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.RequestBody, { explode: true });
  const path2 = pathToFunc("/embeddings")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json;q=1, text/event-stream;q=0",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "createEmbeddings",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "POST",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: [
      "400",
      "401",
      "402",
      "404",
      "429",
      "4XX",
      "500",
      "502",
      "503",
      "524",
      "529",
      "5XX"
    ],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, CreateEmbeddingsResponse$inboundSchema), text(200, CreateEmbeddingsResponse$inboundSchema, {
    ctype: "text/event-stream"
  }), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(402, PaymentRequiredResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(429, TooManyRequestsResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), jsonErr(502, BadGatewayResponseError$inboundSchema), jsonErr(503, ServiceUnavailableResponseError$inboundSchema), jsonErr(524, EdgeNetworkTimeoutResponseError$inboundSchema), jsonErr(529, ProviderOverloadedResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/embeddingsListModels.js
function embeddingsListModels(client, request, options) {
  return new APIPromise($do13(client, request, options));
}
async function $do13(client, request, options) {
  const parsed = safeParse(request, (value) => ListEmbeddingsModelsRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/embeddings/models")();
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload?.["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "listEmbeddingsModels",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ModelsListResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/sdk/embeddings.js
var Embeddings = class extends ClientSDK {
  /**
   * Submit an embedding request
   *
   * @remarks
   * Submits an embedding request to the embeddings router
   */
  async generate(request, options) {
    return unwrapAsync(embeddingsGenerate(this, request, options));
  }
  /**
   * List all embeddings models
   *
   * @remarks
   * Returns a list of all available embeddings models and their properties
   */
  async listModels(request, options) {
    return unwrapAsync(embeddingsListModels(this, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/endpointsList.js
function endpointsList(client, request, options) {
  return new APIPromise($do14(client, request, options));
}
async function $do14(client, request, options) {
  const parsed = safeParse(request, (value) => ListEndpointsRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const pathParams = {
    author: encodeSimple("author", payload.author, {
      explode: false,
      charEncoding: "percent"
    }),
    slug: encodeSimple("slug", payload.slug, {
      explode: false,
      charEncoding: "percent"
    })
  };
  const path2 = pathToFunc("/models/{author}/{slug}/endpoints")(pathParams);
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "listEndpoints",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["404", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ListEndpointsResponse$inboundSchema2), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/endpointsListZdrEndpoints.js
function endpointsListZdrEndpoints(client, request, options) {
  return new APIPromise($do15(client, request, options));
}
async function $do15(client, request, options) {
  const parsed = safeParse(request, (value) => ListEndpointsZdrRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/endpoints/zdr")();
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload?.["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "listEndpointsZdr",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ListEndpointsZdrResponse$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/sdk/endpoints.js
var Endpoints = class extends ClientSDK {
  /**
   * List all endpoints for a model
   */
  async list(request, options) {
    return unwrapAsync(endpointsList(this, request, options));
  }
  /**
   * Preview the impact of ZDR on the available endpoints
   */
  async listZdrEndpoints(request, options) {
    return unwrapAsync(endpointsListZdrEndpoints(this, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/generationsGetGeneration.js
function generationsGetGeneration(client, request, options) {
  return new APIPromise($do16(client, request, options));
}
async function $do16(client, request, options) {
  const parsed = safeParse(request, (value) => GetGenerationRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/generation")();
  const query = encodeFormQuery({
    "id": payload.id
  });
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "getGeneration",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    query,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: [
      "401",
      "402",
      "404",
      "429",
      "4XX",
      "500",
      "502",
      "524",
      "529",
      "5XX"
    ],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, GetGenerationResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(402, PaymentRequiredResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(429, TooManyRequestsResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), jsonErr(502, BadGatewayResponseError$inboundSchema), jsonErr(524, EdgeNetworkTimeoutResponseError$inboundSchema), jsonErr(529, ProviderOverloadedResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/sdk/generations.js
var Generations = class extends ClientSDK {
  /**
   * Get request & usage metadata for a generation
   */
  async getGeneration(request, options) {
    return unwrapAsync(generationsGetGeneration(this, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/guardrailsBulkAssignKeys.js
function guardrailsBulkAssignKeys(client, request, options) {
  return new APIPromise($do17(client, request, options));
}
async function $do17(client, request, options) {
  const parsed = safeParse(request, (value) => BulkAssignKeysToGuardrailRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.RequestBody, { explode: true });
  const pathParams = {
    id: encodeSimple("id", payload.id, {
      explode: false,
      charEncoding: "percent"
    })
  };
  const path2 = pathToFunc("/guardrails/{id}/assignments/keys")(pathParams);
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "bulkAssignKeysToGuardrail",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "POST",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "401", "404", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, BulkAssignKeysToGuardrailResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/guardrailsBulkAssignMembers.js
function guardrailsBulkAssignMembers(client, request, options) {
  return new APIPromise($do18(client, request, options));
}
async function $do18(client, request, options) {
  const parsed = safeParse(request, (value) => BulkAssignMembersToGuardrailRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.RequestBody, { explode: true });
  const pathParams = {
    id: encodeSimple("id", payload.id, {
      explode: false,
      charEncoding: "percent"
    })
  };
  const path2 = pathToFunc("/guardrails/{id}/assignments/members")(pathParams);
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "bulkAssignMembersToGuardrail",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "POST",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "401", "404", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, BulkAssignMembersToGuardrailResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/guardrailsBulkUnassignKeys.js
function guardrailsBulkUnassignKeys(client, request, options) {
  return new APIPromise($do19(client, request, options));
}
async function $do19(client, request, options) {
  const parsed = safeParse(request, (value) => BulkUnassignKeysFromGuardrailRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.RequestBody, { explode: true });
  const pathParams = {
    id: encodeSimple("id", payload.id, {
      explode: false,
      charEncoding: "percent"
    })
  };
  const path2 = pathToFunc("/guardrails/{id}/assignments/keys/remove")(pathParams);
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "bulkUnassignKeysFromGuardrail",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "POST",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "401", "404", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, BulkUnassignKeysFromGuardrailResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/guardrailsBulkUnassignMembers.js
function guardrailsBulkUnassignMembers(client, request, options) {
  return new APIPromise($do20(client, request, options));
}
async function $do20(client, request, options) {
  const parsed = safeParse(request, (value) => BulkUnassignMembersFromGuardrailRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.RequestBody, { explode: true });
  const pathParams = {
    id: encodeSimple("id", payload.id, {
      explode: false,
      charEncoding: "percent"
    })
  };
  const path2 = pathToFunc("/guardrails/{id}/assignments/members/remove")(pathParams);
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "bulkUnassignMembersFromGuardrail",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "POST",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "401", "404", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, BulkUnassignMembersFromGuardrailResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/guardrailsCreate.js
function guardrailsCreate(client, request, options) {
  return new APIPromise($do21(client, request, options));
}
async function $do21(client, request, options) {
  const parsed = safeParse(request, (value) => CreateGuardrailRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.RequestBody, { explode: true });
  const path2 = pathToFunc("/guardrails")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "createGuardrail",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "POST",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "401", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(201, CreateGuardrailResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/guardrailsDelete.js
function guardrailsDelete(client, request, options) {
  return new APIPromise($do22(client, request, options));
}
async function $do22(client, request, options) {
  const parsed = safeParse(request, (value) => DeleteGuardrailRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const pathParams = {
    id: encodeSimple("id", payload.id, {
      explode: false,
      charEncoding: "percent"
    })
  };
  const path2 = pathToFunc("/guardrails/{id}")(pathParams);
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "deleteGuardrail",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "DELETE",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["401", "404", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, DeleteGuardrailResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/guardrailsGet.js
function guardrailsGet(client, request, options) {
  return new APIPromise($do23(client, request, options));
}
async function $do23(client, request, options) {
  const parsed = safeParse(request, (value) => GetGuardrailRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const pathParams = {
    id: encodeSimple("id", payload.id, {
      explode: false,
      charEncoding: "percent"
    })
  };
  const path2 = pathToFunc("/guardrails/{id}")(pathParams);
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "getGuardrail",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["401", "404", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, GetGuardrailResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/guardrailsList.js
function guardrailsList(client, request, options) {
  return new APIPromise($do24(client, request, options));
}
async function $do24(client, request, options) {
  const parsed = safeParse(request, (value) => ListGuardrailsRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/guardrails")();
  const query = encodeFormQuery({
    "limit": payload?.limit,
    "offset": payload?.offset
  });
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload?.["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "listGuardrails",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    query,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["401", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ListGuardrailsResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/guardrailsListGuardrailKeyAssignments.js
function guardrailsListGuardrailKeyAssignments(client, request, options) {
  return new APIPromise($do25(client, request, options));
}
async function $do25(client, request, options) {
  const parsed = safeParse(request, (value) => ListGuardrailKeyAssignmentsRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const pathParams = {
    id: encodeSimple("id", payload.id, {
      explode: false,
      charEncoding: "percent"
    })
  };
  const path2 = pathToFunc("/guardrails/{id}/assignments/keys")(pathParams);
  const query = encodeFormQuery({
    "limit": payload.limit,
    "offset": payload.offset
  });
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "listGuardrailKeyAssignments",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    query,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["401", "404", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ListGuardrailKeyAssignmentsResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/guardrailsListGuardrailMemberAssignments.js
function guardrailsListGuardrailMemberAssignments(client, request, options) {
  return new APIPromise($do26(client, request, options));
}
async function $do26(client, request, options) {
  const parsed = safeParse(request, (value) => ListGuardrailMemberAssignmentsRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const pathParams = {
    id: encodeSimple("id", payload.id, {
      explode: false,
      charEncoding: "percent"
    })
  };
  const path2 = pathToFunc("/guardrails/{id}/assignments/members")(pathParams);
  const query = encodeFormQuery({
    "limit": payload.limit,
    "offset": payload.offset
  });
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "listGuardrailMemberAssignments",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    query,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["401", "404", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ListGuardrailMemberAssignmentsResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/guardrailsListKeyAssignments.js
function guardrailsListKeyAssignments(client, request, options) {
  return new APIPromise($do27(client, request, options));
}
async function $do27(client, request, options) {
  const parsed = safeParse(request, (value) => ListKeyAssignmentsRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/guardrails/assignments/keys")();
  const query = encodeFormQuery({
    "limit": payload?.limit,
    "offset": payload?.offset
  });
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload?.["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "listKeyAssignments",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    query,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["401", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ListKeyAssignmentsResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/guardrailsListMemberAssignments.js
function guardrailsListMemberAssignments(client, request, options) {
  return new APIPromise($do28(client, request, options));
}
async function $do28(client, request, options) {
  const parsed = safeParse(request, (value) => ListMemberAssignmentsRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/guardrails/assignments/members")();
  const query = encodeFormQuery({
    "limit": payload?.limit,
    "offset": payload?.offset
  });
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload?.["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "listMemberAssignments",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    query,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["401", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ListMemberAssignmentsResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/guardrailsUpdate.js
function guardrailsUpdate(client, request, options) {
  return new APIPromise($do29(client, request, options));
}
async function $do29(client, request, options) {
  const parsed = safeParse(request, (value) => UpdateGuardrailRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.RequestBody, { explode: true });
  const pathParams = {
    id: encodeSimple("id", payload.id, {
      explode: false,
      charEncoding: "percent"
    })
  };
  const path2 = pathToFunc("/guardrails/{id}")(pathParams);
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "updateGuardrail",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "PATCH",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "401", "404", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, UpdateGuardrailResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/sdk/guardrails.js
var Guardrails = class extends ClientSDK {
  /**
   * List guardrails
   *
   * @remarks
   * List all guardrails for the authenticated user. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async list(request, options) {
    return unwrapAsync(guardrailsList(this, request, options));
  }
  /**
   * Create a guardrail
   *
   * @remarks
   * Create a new guardrail for the authenticated user. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async create(request, options) {
    return unwrapAsync(guardrailsCreate(this, request, options));
  }
  /**
   * Get a guardrail
   *
   * @remarks
   * Get a single guardrail by ID. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async get(request, options) {
    return unwrapAsync(guardrailsGet(this, request, options));
  }
  /**
   * Update a guardrail
   *
   * @remarks
   * Update an existing guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async update(request, options) {
    return unwrapAsync(guardrailsUpdate(this, request, options));
  }
  /**
   * Delete a guardrail
   *
   * @remarks
   * Delete an existing guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async delete(request, options) {
    return unwrapAsync(guardrailsDelete(this, request, options));
  }
  /**
   * List all key assignments
   *
   * @remarks
   * List all API key guardrail assignments for the authenticated user. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async listKeyAssignments(request, options) {
    return unwrapAsync(guardrailsListKeyAssignments(this, request, options));
  }
  /**
   * List all member assignments
   *
   * @remarks
   * List all organization member guardrail assignments for the authenticated user. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async listMemberAssignments(request, options) {
    return unwrapAsync(guardrailsListMemberAssignments(this, request, options));
  }
  /**
   * List key assignments for a guardrail
   *
   * @remarks
   * List all API key assignments for a specific guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async listGuardrailKeyAssignments(request, options) {
    return unwrapAsync(guardrailsListGuardrailKeyAssignments(this, request, options));
  }
  /**
   * Bulk assign keys to a guardrail
   *
   * @remarks
   * Assign multiple API keys to a specific guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async bulkAssignKeys(request, options) {
    return unwrapAsync(guardrailsBulkAssignKeys(this, request, options));
  }
  /**
   * List member assignments for a guardrail
   *
   * @remarks
   * List all organization member assignments for a specific guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async listGuardrailMemberAssignments(request, options) {
    return unwrapAsync(guardrailsListGuardrailMemberAssignments(this, request, options));
  }
  /**
   * Bulk assign members to a guardrail
   *
   * @remarks
   * Assign multiple organization members to a specific guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async bulkAssignMembers(request, options) {
    return unwrapAsync(guardrailsBulkAssignMembers(this, request, options));
  }
  /**
   * Bulk unassign keys from a guardrail
   *
   * @remarks
   * Unassign multiple API keys from a specific guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async bulkUnassignKeys(request, options) {
    return unwrapAsync(guardrailsBulkUnassignKeys(this, request, options));
  }
  /**
   * Bulk unassign members from a guardrail
   *
   * @remarks
   * Unassign multiple organization members from a specific guardrail. [Management key](/docs/guides/overview/auth/management-api-keys) required.
   */
  async bulkUnassignMembers(request, options) {
    return unwrapAsync(guardrailsBulkUnassignMembers(this, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/modelsCount.js
function modelsCount(client, request, options) {
  return new APIPromise($do30(client, request, options));
}
async function $do30(client, request, options) {
  const parsed = safeParse(request, (value) => ListModelsCountRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/models/count")();
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload?.["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "listModelsCount",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ModelsCountResponse$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/modelsList.js
function modelsList(client, request, options) {
  return new APIPromise($do31(client, request, options));
}
async function $do31(client, request, options) {
  const parsed = safeParse(request, (value) => GetModelsRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/models")();
  const query = encodeFormQuery({
    "category": payload?.category,
    "supported_parameters": payload?.supported_parameters
  });
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload?.["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "getModels",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    query,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ModelsListResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/modelsListForUser.js
function modelsListForUser(client, security, request, options) {
  return new APIPromise($do32(client, security, request, options));
}
async function $do32(client, security, request, options) {
  const parsed = safeParse(request, (value) => ListModelsUserRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/models/user")();
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload?.["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const requestSecurity = resolveSecurity([
    {
      fieldName: "Authorization",
      type: "http:bearer",
      value: security?.bearer
    }
  ]);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "listModelsUser",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: security,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["401", "404", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ModelsListResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/sdk/models.js
var Models = class extends ClientSDK {
  /**
   * Get total count of available models
   */
  async count(request, options) {
    return unwrapAsync(modelsCount(this, request, options));
  }
  /**
   * List all models and their properties
   */
  async list(request, options) {
    return unwrapAsync(modelsList(this, request, options));
  }
  /**
   * List models filtered by user provider preferences, privacy settings, and guardrails
   *
   * @remarks
   * List models filtered by user provider preferences, [privacy settings](https://openrouter.ai/docs/guides/privacy/logging), and [guardrails](https://openrouter.ai/docs/guides/features/guardrails). If requesting through `eu.openrouter.ai/api/v1/...` the results will be filtered to models that satisfy [EU in-region routing](https://openrouter.ai/docs/guides/privacy/logging#enterprise-eu-in-region-routing).
   */
  async listForUser(security, request, options) {
    return unwrapAsync(modelsListForUser(this, security, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/oAuthCreateAuthCode.js
function oAuthCreateAuthCode(client, request, options) {
  return new APIPromise($do33(client, request, options));
}
async function $do33(client, request, options) {
  const parsed = safeParse(request, (value) => CreateAuthKeysCodeRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.RequestBody, { explode: true });
  const path2 = pathToFunc("/auth/keys/code")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "createAuthKeysCode",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "POST",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "401", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, CreateAuthKeysCodeResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/oAuthExchangeAuthCodeForAPIKey.js
function oAuthExchangeAuthCodeForAPIKey(client, request, options) {
  return new APIPromise($do34(client, request, options));
}
async function $do34(client, request, options) {
  const parsed = safeParse(request, (value) => ExchangeAuthCodeForAPIKeyRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload.RequestBody, { explode: true });
  const path2 = pathToFunc("/auth/keys")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "exchangeAuthCodeForAPIKey",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "POST",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["400", "403", "4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ExchangeAuthCodeForAPIKeyResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(403, ForbiddenResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/funcs/oAuthCreateAuthorizationUrl.js
var import_v3 = __toESM(require("zod/v3"), 1);
var CreateAuthorizationUrlBaseSchema = import_v3.default.object({
  callbackUrl: import_v3.default.union([
    import_v3.default.string().url(),
    import_v3.default.instanceof(URL)
  ]),
  limit: import_v3.default.number().optional()
});
var CreateAuthorizationurlParamsSchema = import_v3.default.union([
  CreateAuthorizationUrlBaseSchema.extend({
    codeChallengeMethod: import_v3.default.enum([
      "S256",
      "plain"
    ]),
    codeChallenge: import_v3.default.string()
  }),
  CreateAuthorizationUrlBaseSchema
]);
function oAuthCreateAuthorizationUrl(client, params) {
  const parsedParams = CreateAuthorizationurlParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return {
      ok: false,
      error: parsedParams.error
    };
  }
  const baseURL = serverURLFromOptions(client._options);
  if (!baseURL) {
    return {
      ok: false,
      error: new Error("No server URL configured")
    };
  }
  const authURL = new URL("/auth", baseURL);
  authURL.searchParams.set("callback_url", parsedParams.data.callbackUrl.toString());
  if ("codeChallengeMethod" in parsedParams.data) {
    authURL.searchParams.set("code_challenge", parsedParams.data.codeChallenge);
    authURL.searchParams.set("code_challenge_method", parsedParams.data.codeChallengeMethod);
  }
  if (parsedParams.data.limit !== void 0) {
    authURL.searchParams.set("limit", parsedParams.data.limit.toString());
  }
  return {
    ok: true,
    value: authURL.toString()
  };
}

// node_modules/@openrouter/sdk/esm/funcs/oAuthCreateSHA256CodeChallenge.js
var import_v32 = __toESM(require("zod/v3"), 1);
var CreateSHA256CodeChallengeRequestSchema = import_v32.default.object({
  /**
   * If not provided, a random code verifier will be generated.
   * If provided, must be 43-128 characters and contain only unreserved
   * characters [A-Za-z0-9-._~] per RFC 7636.
   */
  codeVerifier: import_v32.default.string().min(43, "Code verifier must be at least 43 characters").max(128, "Code verifier must be at most 128 characters").regex(/^[A-Za-z0-9\-._~]+$/, "Code verifier must only contain unreserved characters: [A-Za-z0-9-._~]").optional()
});
function arrayBufferToBase64Url(buffer) {
  let binary = "";
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function generateCodeVerifier() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  return arrayBufferToBase64Url(randomBytes);
}
async function oAuthCreateSHA256CodeChallenge(params = {}) {
  const parsedParams = CreateSHA256CodeChallengeRequestSchema.safeParse(params);
  if (!parsedParams.success) {
    return {
      ok: false,
      error: parsedParams.error
    };
  }
  const { codeVerifier = generateCodeVerifier() } = parsedParams.data;
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hash);
  const codeChallenge = arrayBufferToBase64Url(hashArray);
  return {
    ok: true,
    value: {
      codeChallenge,
      codeVerifier
    }
  };
}

// node_modules/@openrouter/sdk/esm/sdk/oauth.js
var OAuth = class extends ClientSDK {
  // #region sdk-class-body
  /**
   * Generate a OAuth2 authorization URL
   *
   * @remarks
   * Generates a URL to redirect users to for authorizing your application. The
   * URL includes the provided callback URL and, if applicable, the code
   * challenge parameters for PKCE.
   *
   * @see {@link https://openrouter.ai/docs/use-cases/oauth-pkce}
   */
  async createAuthorizationUrl(request) {
    const result = oAuthCreateAuthorizationUrl(this, request);
    if (!result.ok) {
      throw result.error;
    }
    return result.value;
  }
  /**
   * Generate a SHA-256 code challenge for PKCE
   *
   * @remarks
   * Generates a SHA-256 code challenge and corresponding code verifier for use
   * in the PKCE extension to OAuth2. If no code verifier is provided, a random
   * one will be generated according to RFC 7636 (32 random bytes, base64url
   * encoded). If a code verifier is provided, it must be 43-128 characters and
   * contain only unreserved characters [A-Za-z0-9-._~].
   *
   * @see {@link https://openrouter.ai/docs/use-cases/oauth-pkce}
   * @see {@link https://datatracker.ietf.org/doc/html/rfc7636}
   */
  async createSHA256CodeChallenge() {
    return unwrapAsync(oAuthCreateSHA256CodeChallenge());
  }
  // #endregion sdk-class-body
  /**
   * Exchange authorization code for API key
   *
   * @remarks
   * Exchange an authorization code from the PKCE flow for a user-controlled API key
   */
  async exchangeAuthCodeForAPIKey(request, options) {
    return unwrapAsync(oAuthExchangeAuthCodeForAPIKey(this, request, options));
  }
  /**
   * Create authorization code
   *
   * @remarks
   * Create an authorization code for the PKCE flow to generate a user-controlled API key
   */
  async createAuthCode(request, options) {
    return unwrapAsync(oAuthCreateAuthCode(this, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/providersList.js
function providersList(client, request, options) {
  return new APIPromise($do35(client, request, options));
}
async function $do35(client, request, options) {
  const parsed = safeParse(request, (value) => ListProvidersRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path2 = pathToFunc("/providers")();
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-Title": encodeSimple("X-Title", payload?.["X-Title"] ?? client._options.xTitle, { explode: false, charEncoding: "none" })
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "listProviders",
    oAuth2Scopes: null,
    resolvedSecurity: requestSecurity,
    securitySource: client._options.apiKey,
    retryConfig: options?.retries || client._options.retryConfig || { strategy: "none" },
    retryCodes: options?.retryCodes || ["429", "500", "502", "503", "504"]
  };
  const requestRes = client._createRequest(context, {
    security: requestSecurity,
    method: "GET",
    baseURL: options?.serverURL,
    path: path2,
    headers,
    body,
    userAgent: client._options.userAgent,
    timeoutMs: options?.timeoutMs || client._options.timeoutMs || -1
  }, options);
  if (!requestRes.ok) {
    return [requestRes, { status: "invalid" }];
  }
  const req = requestRes.value;
  const doResult = await client._do(req, {
    context,
    errorCodes: ["4XX", "500", "5XX"],
    retryConfig: context.retryConfig,
    retryCodes: context.retryCodes
  });
  if (!doResult.ok) {
    return [doResult, { status: "request-error", request: req }];
  }
  const response = doResult.value;
  const responseFields = {
    HttpMeta: { Response: response, Request: req }
  };
  const [result] = await match(json(200, ListProvidersResponse$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/sdk/providers.js
var Providers = class extends ClientSDK {
  /**
   * List all providers
   */
  async list(request, options) {
    return unwrapAsync(providersList(this, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/lib/reusable-stream.js
var ReusableReadableStream = class {
  constructor(sourceStream) {
    this.sourceStream = sourceStream;
    this.buffer = [];
    this.consumers = /* @__PURE__ */ new Map();
    this.nextConsumerId = 0;
    this.sourceReader = null;
    this.sourceComplete = false;
    this.sourceError = null;
    this.pumpStarted = false;
  }
  /**
   * Create a new consumer that can independently iterate over the stream.
   * Multiple consumers can be created and will all receive the same data.
   */
  createConsumer() {
    const consumerId = this.nextConsumerId++;
    const state = {
      position: 0,
      waitingPromise: null,
      cancelled: false
    };
    this.consumers.set(consumerId, state);
    if (!this.pumpStarted) {
      this.startPump();
    }
    const self = this;
    return {
      async next() {
        const consumer = self.consumers.get(consumerId);
        if (!consumer) {
          return {
            done: true,
            value: void 0
          };
        }
        if (consumer.cancelled) {
          return {
            done: true,
            value: void 0
          };
        }
        if (consumer.position < self.buffer.length) {
          const value = self.buffer[consumer.position];
          consumer.position++;
          return {
            done: false,
            value
          };
        }
        if (self.sourceComplete) {
          self.consumers.delete(consumerId);
          return {
            done: true,
            value: void 0
          };
        }
        if (self.sourceError) {
          self.consumers.delete(consumerId);
          throw self.sourceError;
        }
        const waitPromise = new Promise((resolve, reject) => {
          consumer.waitingPromise = {
            resolve,
            reject
          };
          if (self.sourceComplete || self.sourceError || consumer.position < self.buffer.length) {
            resolve();
          }
        });
        await waitPromise;
        consumer.waitingPromise = null;
        return this.next();
      },
      async return() {
        const consumer = self.consumers.get(consumerId);
        if (consumer) {
          consumer.cancelled = true;
          self.consumers.delete(consumerId);
        }
        return {
          done: true,
          value: void 0
        };
      },
      async throw(e) {
        const consumer = self.consumers.get(consumerId);
        if (consumer) {
          consumer.cancelled = true;
          self.consumers.delete(consumerId);
        }
        throw e;
      },
      [Symbol.asyncIterator]() {
        return this;
      }
    };
  }
  /**
   * Start pumping data from the source stream into the buffer
   */
  startPump() {
    if (this.pumpStarted) {
      return;
    }
    this.pumpStarted = true;
    this.sourceReader = this.sourceStream.getReader();
    void (async () => {
      try {
        while (true) {
          const result = await this.sourceReader.read();
          if (result.done) {
            this.sourceComplete = true;
            this.notifyAllConsumers();
            break;
          }
          this.buffer.push(result.value);
          this.notifyAllConsumers();
        }
      } catch (error) {
        this.sourceError = error instanceof Error ? error : new Error(String(error));
        this.notifyAllConsumers();
      } finally {
        if (this.sourceReader) {
          this.sourceReader.releaseLock();
        }
      }
    })();
  }
  /**
   * Notify all waiting consumers that new data is available
   */
  notifyAllConsumers() {
    for (const consumer of this.consumers.values()) {
      if (consumer.waitingPromise) {
        if (this.sourceError) {
          consumer.waitingPromise.reject(this.sourceError);
        } else {
          consumer.waitingPromise.resolve();
        }
        consumer.waitingPromise = null;
      }
    }
  }
  /**
   * Cancel the source stream and all consumers
   */
  async cancel() {
    for (const consumer of this.consumers.values()) {
      consumer.cancelled = true;
      if (consumer.waitingPromise) {
        consumer.waitingPromise.resolve();
      }
    }
    this.consumers.clear();
    if (this.sourceReader) {
      await this.sourceReader.cancel();
      this.sourceReader.releaseLock();
    }
  }
};

// node_modules/@openrouter/sdk/esm/lib/tool-executor.js
var z410 = __toESM(require("zod/v4"), 1);
function isNonNullObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sanitizeJsonSchema(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeJsonSchema);
  }
  if (!isNonNullObject(obj)) {
    return obj;
  }
  const result = {};
  for (const key of Object.keys(obj)) {
    if (!key.startsWith("~")) {
      result[key] = sanitizeJsonSchema(obj[key]);
    }
  }
  return result;
}
function isZodSchema(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("_zod" in value)) {
    return false;
  }
  return typeof value._zod === "object";
}
function convertZodToJsonSchema(zodSchema) {
  if (!isZodSchema(zodSchema)) {
    throw new Error("Invalid Zod schema provided");
  }
  const jsonSchema = z410.toJSONSchema(zodSchema, {
    target: "draft-7"
  });
  return sanitizeJsonSchema(jsonSchema);
}
function convertToolsToAPIFormat(tools) {
  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description || null,
    strict: null,
    parameters: convertZodToJsonSchema(tool.function.inputSchema)
  }));
}
function validateToolInput(schema, args) {
  return z410.parse(schema, args);
}
function validateToolOutput(schema, result) {
  return z410.parse(schema, result);
}
function tryValidate(schema, value) {
  const result = z410.safeParse(schema, value);
  return result.success;
}
async function executeRegularTool(tool, toolCall, context) {
  if (!isRegularExecuteTool(tool)) {
    throw new Error(`Tool "${toolCall.name}" is not a regular execute tool or has no execute function`);
  }
  try {
    const validatedInput = validateToolInput(tool.function.inputSchema, toolCall.arguments);
    const result = await Promise.resolve(tool.function.execute(validatedInput, context));
    if (tool.function.outputSchema) {
      const validatedOutput = validateToolOutput(tool.function.outputSchema, result);
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: validatedOutput
      };
    }
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result
    };
  } catch (error) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: null,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
async function executeGeneratorTool(tool, toolCall, context, onPreliminaryResult) {
  if (!isGeneratorTool(tool)) {
    throw new Error(`Tool "${toolCall.name}" is not a generator tool`);
  }
  try {
    const validatedInput = validateToolInput(tool.function.inputSchema, toolCall.arguments);
    const preliminaryResults = [];
    let finalResult = void 0;
    let hasFinalResult = false;
    let lastEmittedValue = void 0;
    let hasEmittedValue = false;
    const iterator = tool.function.execute(validatedInput, context);
    let iterResult = await iterator.next();
    while (!iterResult.done) {
      const event = iterResult.value;
      lastEmittedValue = event;
      hasEmittedValue = true;
      const matchesOutputSchema = tryValidate(tool.function.outputSchema, event);
      const matchesEventSchema = tryValidate(tool.function.eventSchema, event);
      if (matchesOutputSchema && !matchesEventSchema && !hasFinalResult) {
        finalResult = validateToolOutput(tool.function.outputSchema, event);
        hasFinalResult = true;
      } else {
        const validatedPreliminary = validateToolOutput(tool.function.eventSchema, event);
        preliminaryResults.push(validatedPreliminary);
        if (onPreliminaryResult) {
          onPreliminaryResult(toolCall.id, validatedPreliminary);
        }
      }
      iterResult = await iterator.next();
    }
    if (iterResult.value !== void 0) {
      finalResult = validateToolOutput(tool.function.outputSchema, iterResult.value);
      hasFinalResult = true;
    }
    if (!hasFinalResult) {
      if (!hasEmittedValue) {
        throw new Error(`Generator tool "${toolCall.name}" completed without emitting any values or returning a result`);
      }
      finalResult = validateToolOutput(tool.function.outputSchema, lastEmittedValue);
    }
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: finalResult,
      preliminaryResults
    };
  } catch (error) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: null,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
async function executeTool(tool, toolCall, context, onPreliminaryResult) {
  if (!hasExecuteFunction(tool)) {
    throw new Error(`Tool "${toolCall.name}" has no execute function. Use manual tool execution.`);
  }
  if (isGeneratorTool(tool)) {
    return executeGeneratorTool(tool, toolCall, context, onPreliminaryResult);
  }
  return executeRegularTool(tool, toolCall, context);
}

// node_modules/@openrouter/sdk/esm/lib/model-result.js
var DEFAULT_MAX_STEPS = 5;
function isEventStream(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const constructorName = Object.getPrototypeOf(value)?.constructor?.name;
  if (constructorName === "EventStream") {
    return true;
  }
  const maybeStream = value;
  return typeof maybeStream.toReadableStream === "function";
}
var ModelResult = class {
  constructor(options) {
    this.reusableStream = null;
    this.textPromise = null;
    this.initPromise = null;
    this.toolExecutionPromise = null;
    this.finalResponse = null;
    this.toolEventBroadcaster = null;
    this.allToolExecutionRounds = [];
    this.resolvedRequest = null;
    this.stateAccessor = null;
    this.currentState = null;
    this.requireApprovalFn = null;
    this.approvedToolCalls = [];
    this.rejectedToolCalls = [];
    this.isResumingFromApproval = false;
    this.options = options;
    const hasApprovalDecisions = options.approveToolCalls && options.approveToolCalls.length > 0 || options.rejectToolCalls && options.rejectToolCalls.length > 0;
    if (hasApprovalDecisions && !options.state) {
      throw new Error('approveToolCalls and rejectToolCalls require a state accessor. Provide a StateAccessor via the "state" parameter to persist approval decisions.');
    }
    this.stateAccessor = options.state ?? null;
    this.requireApprovalFn = options.requireApproval ?? null;
    this.approvedToolCalls = options.approveToolCalls ?? [];
    this.rejectedToolCalls = options.rejectToolCalls ?? [];
  }
  /**
   * Get or create the tool event broadcaster (lazy initialization).
   * Ensures only one broadcaster exists for the lifetime of this ModelResult.
   * Broadcasts both preliminary results and final tool results.
   */
  ensureBroadcaster() {
    if (!this.toolEventBroadcaster) {
      this.toolEventBroadcaster = new ToolEventBroadcaster();
    }
    return this.toolEventBroadcaster;
  }
  /**
   * Type guard to check if a value is a non-streaming response
   * Only requires 'output' field and absence of 'toReadableStream' method
   */
  isNonStreamingResponse(value) {
    return value !== null && typeof value === "object" && "output" in value && !("toReadableStream" in value);
  }
  // =========================================================================
  // Extracted Helper Methods for executeToolsIfNeeded
  // =========================================================================
  /**
   * Get initial response from stream or cached final response.
   * Consumes the stream to completion if needed to extract the response.
   *
   * @returns The complete non-streaming response
   * @throws Error if neither stream nor response has been initialized
   */
  async getInitialResponse() {
    if (this.finalResponse) {
      return this.finalResponse;
    }
    if (this.reusableStream) {
      return consumeStreamForCompletion(this.reusableStream);
    }
    throw new Error("Neither stream nor response initialized");
  }
  /**
   * Save response output to state.
   * Appends the response output to the message history and records the response ID.
   *
   * @param response - The API response to save
   */
  async saveResponseToState(response) {
    if (!this.stateAccessor || !this.currentState)
      return;
    const outputItems = Array.isArray(response.output) ? response.output : [response.output];
    await this.saveStateSafely({
      messages: appendToMessages(this.currentState.messages, outputItems),
      previousResponseId: response.id
    });
  }
  /**
   * Mark state as complete.
   * Sets the conversation status to 'complete' indicating no further tool execution is needed.
   */
  async markStateComplete() {
    await this.saveStateSafely({ status: "complete" });
  }
  /**
   * Save tool results to state.
   * Appends tool execution results to the message history for multi-turn context.
   *
   * @param toolResults - The tool execution results to save
   */
  async saveToolResultsToState(toolResults) {
    if (!this.currentState)
      return;
    await this.saveStateSafely({
      messages: appendToMessages(this.currentState.messages, toolResults)
    });
  }
  /**
   * Check if execution should be interrupted by external signal.
   * Polls the state accessor for interruption flags set by external processes.
   *
   * @param currentResponse - The current response to save as partial state
   * @returns True if interrupted and caller should exit, false to continue
   */
  async checkForInterruption(currentResponse) {
    if (!this.stateAccessor)
      return false;
    const freshState = await this.stateAccessor.load();
    if (!freshState?.interruptedBy)
      return false;
    if (this.currentState) {
      const currentToolCalls = extractToolCallsFromResponse(currentResponse);
      await this.saveStateSafely({
        status: "interrupted",
        partialResponse: {
          text: extractTextFromResponse2(currentResponse),
          toolCalls: currentToolCalls
        }
      });
    }
    this.finalResponse = currentResponse;
    return true;
  }
  /**
   * Check if stop conditions are met.
   * Returns true if execution should stop.
   *
   * @remarks
   * Default: stepCountIs(DEFAULT_MAX_STEPS) if no stopWhen is specified.
   * This evaluates stop conditions against the complete step history.
   */
  async shouldStopExecution() {
    const stopWhen = this.options.stopWhen ?? stepCountIs(DEFAULT_MAX_STEPS);
    const stopConditions = Array.isArray(stopWhen) ? stopWhen : [stopWhen];
    return isStopConditionMet({
      stopConditions,
      steps: this.allToolExecutionRounds.map((round) => ({
        stepType: "continue",
        text: extractTextFromResponse(round.response),
        toolCalls: round.toolCalls,
        toolResults: round.toolResults.map((tr) => ({
          toolCallId: tr.callId,
          toolName: round.toolCalls.find((tc) => tc.id === tr.callId)?.name ?? "",
          result: JSON.parse(tr.output)
        })),
        response: round.response,
        usage: round.response.usage,
        finishReason: void 0
      }))
    });
  }
  /**
   * Check if any tool calls have execute functions.
   * Used to determine if automatic tool execution should be attempted.
   *
   * @param toolCalls - The tool calls to check
   * @returns True if at least one tool call has an executable function
   */
  hasExecutableToolCalls(toolCalls) {
    return toolCalls.some((toolCall) => {
      const tool = this.options.tools?.find((t) => t.function.name === toolCall.name);
      return tool && hasExecuteFunction(tool);
    });
  }
  /**
   * Execute tools that can auto-execute (don't require approval) in parallel.
   *
   * @param toolCalls - The tool calls to execute
   * @param turnContext - The current turn context
   * @returns Array of unsent tool results for later submission
   */
  async executeAutoApproveTools(toolCalls, turnContext) {
    const toolCallPromises = toolCalls.map(async (tc) => {
      const tool = this.options.tools?.find((t) => t.function.name === tc.name);
      if (!tool || !hasExecuteFunction(tool)) {
        return null;
      }
      const result = await executeTool(tool, tc, turnContext);
      if (result.error) {
        return createRejectedResult(tc.id, String(tc.name), result.error.message);
      }
      return createUnsentResult(tc.id, String(tc.name), result.result);
    });
    const settledResults = await Promise.allSettled(toolCallPromises);
    const results = [];
    for (let i = 0; i < settledResults.length; i++) {
      const settled = settledResults[i];
      const tc = toolCalls[i];
      if (!settled || !tc)
        continue;
      if (settled.status === "rejected") {
        const errorMessage = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        results.push(createRejectedResult(tc.id, String(tc.name), errorMessage));
        continue;
      }
      if (settled.value) {
        results.push(settled.value);
      }
    }
    return results;
  }
  /**
   * Check for tools requiring approval and handle accordingly.
   * Partitions tool calls into those needing approval and those that can auto-execute.
   *
   * @param toolCalls - The tool calls to check
   * @param currentRound - The current execution round (1-indexed)
   * @param currentResponse - The current response to save if pausing
   * @returns True if execution should pause for approval, false to continue
   * @throws Error if approval is required but no state accessor is configured
   */
  async handleApprovalCheck(toolCalls, currentRound, currentResponse) {
    if (!this.options.tools)
      return false;
    const turnContext = { numberOfTurns: currentRound };
    const { requiresApproval: needsApproval, autoExecute } = await partitionToolCalls(toolCalls, this.options.tools, turnContext, this.requireApprovalFn ?? void 0);
    if (needsApproval.length === 0)
      return false;
    if (!this.stateAccessor) {
      const toolNames = needsApproval.map((tc) => tc.name).join(", ");
      throw new Error(`Tool(s) require approval but no state accessor is configured: ${toolNames}. Provide a StateAccessor via the "state" parameter to enable approval workflows.`);
    }
    const unsentResults = await this.executeAutoApproveTools(autoExecute, turnContext);
    const stateUpdates = {
      pendingToolCalls: needsApproval,
      status: "awaiting_approval"
    };
    if (unsentResults.length > 0) {
      stateUpdates.unsentToolResults = unsentResults;
    }
    await this.saveStateSafely(stateUpdates);
    this.finalResponse = currentResponse;
    return true;
  }
  /**
   * Execute all tools in a single round in parallel.
   * Emits tool.result events after tool execution completes.
   *
   * @param toolCalls - The tool calls to execute
   * @param turnContext - The current turn context
   * @returns Array of function call outputs formatted for the API
   */
  async executeToolRound(toolCalls, turnContext) {
    const toolCallPromises = toolCalls.map(async (toolCall) => {
      const tool = this.options.tools?.find((t) => t.function.name === toolCall.name);
      if (!tool || !hasExecuteFunction(tool)) {
        return null;
      }
      const args = toolCall.arguments;
      if (typeof args === "string") {
        const rawArgs = args;
        const errorMessage = `Failed to parse tool call arguments for "${toolCall.name}": The model provided invalid JSON. Raw arguments received: "${rawArgs}". Please provide valid JSON arguments for this tool call.`;
        if (this.toolEventBroadcaster) {
          this.toolEventBroadcaster.push({
            type: "tool_result",
            toolCallId: toolCall.id,
            result: { error: errorMessage }
          });
        }
        return {
          type: "parse_error",
          toolCall,
          output: {
            type: "function_call_output",
            id: `output_${toolCall.id}`,
            callId: toolCall.id,
            output: JSON.stringify({ error: errorMessage })
          }
        };
      }
      const preliminaryResultsForCall = [];
      const onPreliminaryResult = this.toolEventBroadcaster ? (callId, resultValue) => {
        const typedResult = resultValue;
        preliminaryResultsForCall.push(typedResult);
        this.toolEventBroadcaster?.push({
          type: "preliminary_result",
          toolCallId: callId,
          result: typedResult
        });
      } : void 0;
      const result = await executeTool(tool, toolCall, turnContext, onPreliminaryResult);
      return {
        type: "execution",
        toolCall,
        tool,
        result,
        preliminaryResultsForCall
      };
    });
    const settledResults = await Promise.allSettled(toolCallPromises);
    const toolResults = [];
    for (let i = 0; i < settledResults.length; i++) {
      const settled = settledResults[i];
      const originalToolCall = toolCalls[i];
      if (!settled || !originalToolCall)
        continue;
      if (settled.status === "rejected") {
        const errorMessage = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        if (this.toolEventBroadcaster) {
          this.toolEventBroadcaster.push({
            type: "tool_result",
            toolCallId: originalToolCall.id,
            result: { error: errorMessage }
          });
        }
        toolResults.push({
          type: "function_call_output",
          id: `output_${originalToolCall.id}`,
          callId: originalToolCall.id,
          output: JSON.stringify({ error: errorMessage })
        });
        continue;
      }
      const value = settled.value;
      if (!value)
        continue;
      if (value.type === "parse_error") {
        toolResults.push(value.output);
        continue;
      }
      if (this.toolEventBroadcaster) {
        this.toolEventBroadcaster.push({
          type: "tool_result",
          toolCallId: value.toolCall.id,
          result: value.result.error ? { error: value.result.error.message } : value.result.result,
          ...value.preliminaryResultsForCall.length > 0 && {
            preliminaryResults: value.preliminaryResultsForCall
          }
        });
      }
      toolResults.push({
        type: "function_call_output",
        id: `output_${value.toolCall.id}`,
        callId: value.toolCall.id,
        output: value.result.error ? JSON.stringify({ error: value.result.error.message }) : JSON.stringify(value.result.result)
      });
    }
    return toolResults;
  }
  /**
   * Resolve async functions for the current turn.
   * Updates the resolved request with turn-specific parameter values.
   *
   * @param turnContext - The turn context for parameter resolution
   */
  async resolveAsyncFunctionsForTurn(turnContext) {
    if (hasAsyncFunctions(this.options.request)) {
      const resolved = await resolveAsyncFunctions(this.options.request, turnContext);
      const preservedInput = this.resolvedRequest?.input;
      this.resolvedRequest = {
        ...resolved,
        stream: false,
        ...preservedInput !== void 0 && { input: preservedInput }
      };
    }
  }
  /**
   * Apply nextTurnParams from executed tools.
   * Allows tools to modify request parameters for subsequent turns.
   *
   * @param toolCalls - The tool calls that were just executed
   */
  async applyNextTurnParams(toolCalls) {
    if (!this.options.tools || toolCalls.length === 0 || !this.resolvedRequest) {
      return;
    }
    const computedParams = await executeNextTurnParamsFunctions(toolCalls, this.options.tools, this.resolvedRequest);
    if (Object.keys(computedParams).length > 0) {
      this.resolvedRequest = applyNextTurnParamsToRequest(this.resolvedRequest, computedParams);
    }
  }
  /**
   * Make a follow-up API request with tool results.
   * Continues the conversation after tool execution.
   *
   * @param currentResponse - The response that contained tool calls
   * @param toolResults - The results from executing those tools
   * @returns The new response from the API
   */
  async makeFollowupRequest(currentResponse, toolResults) {
    const originalInput = this.resolvedRequest?.input;
    const normalizedOriginalInput = Array.isArray(originalInput) ? originalInput : originalInput ? [{ role: "user", content: originalInput }] : [];
    const newInput = [
      ...normalizedOriginalInput,
      ...Array.isArray(currentResponse.output) ? currentResponse.output : [currentResponse.output],
      ...toolResults
    ];
    if (!this.resolvedRequest) {
      throw new Error("Request not initialized");
    }
    this.resolvedRequest = {
      ...this.resolvedRequest,
      input: newInput
    };
    const newRequest = {
      ...this.resolvedRequest,
      stream: false
    };
    const newResult = await betaResponsesSend(this.options.client, { openResponsesRequest: newRequest }, this.options.options);
    if (!newResult.ok) {
      throw newResult.error;
    }
    const value = newResult.value;
    if (isEventStream(value)) {
      const stream = new ReusableReadableStream(value);
      return consumeStreamForCompletion(stream);
    } else if (this.isNonStreamingResponse(value)) {
      return value;
    } else {
      throw new Error("Unexpected response type from API");
    }
  }
  /**
   * Validate the final response has required fields.
   *
   * @param response - The response to validate
   * @throws Error if response is missing required fields or has invalid output
   */
  validateFinalResponse(response) {
    if (!response?.id || !response?.output) {
      throw new Error("Invalid final response: missing required fields");
    }
    if (!Array.isArray(response.output) || response.output.length === 0) {
      throw new Error("Invalid final response: empty or invalid output");
    }
  }
  /**
   * Resolve async functions in the request for a given turn context.
   * Extracts non-function fields and resolves any async parameter functions.
   *
   * @param context - The turn context for parameter resolution
   * @returns The resolved request without async functions
   */
  async resolveRequestForContext(context) {
    if (hasAsyncFunctions(this.options.request)) {
      return resolveAsyncFunctions(this.options.request, context);
    }
    const { stopWhen: _, state: _s, requireApproval: _r, approveToolCalls: _a4, rejectToolCalls: _rj, ...rest } = this.options.request;
    return rest;
  }
  /**
   * Safely persist state with error handling.
   * Wraps state save operations to ensure failures are properly reported.
   *
   * @param updates - Optional partial state updates to apply before saving
   * @throws Error if state persistence fails
   */
  async saveStateSafely(updates) {
    if (!this.stateAccessor || !this.currentState)
      return;
    if (updates) {
      this.currentState = updateState(this.currentState, updates);
    }
    try {
      await this.stateAccessor.save(this.currentState);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to persist conversation state: ${message}`);
    }
  }
  /**
   * Remove optional properties from state when they should be cleared.
   * Uses delete to properly remove optional properties rather than setting undefined.
   *
   * @param props - Array of property names to remove from current state
   */
  clearOptionalStateProperties(props) {
    if (!this.currentState)
      return;
    for (const prop of props) {
      delete this.currentState[prop];
    }
  }
  // =========================================================================
  // Core Methods
  // =========================================================================
  /**
   * Initialize the stream if not already started
   * This is idempotent - multiple calls will return the same promise
   */
  initStream() {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = (async () => {
      if (this.stateAccessor) {
        const loadedState = await this.stateAccessor.load();
        if (loadedState) {
          this.currentState = loadedState;
          if (loadedState.status === "awaiting_approval" && (this.approvedToolCalls.length > 0 || this.rejectedToolCalls.length > 0)) {
            this.isResumingFromApproval = true;
            await this.processApprovalDecisions();
            return;
          }
          if (loadedState.interruptedBy) {
            this.currentState = updateState(loadedState, { status: "in_progress" });
            this.clearOptionalStateProperties(["interruptedBy"]);
            await this.saveStateSafely();
          }
        } else {
          this.currentState = createInitialState();
        }
        await this.saveStateSafely({ status: "in_progress" });
      }
      const initialContext = {
        numberOfTurns: 0
      };
      let baseRequest = await this.resolveRequestForContext(initialContext);
      if (this.currentState && this.currentState.messages && Array.isArray(this.currentState.messages) && this.currentState.messages.length > 0) {
        const newInput = baseRequest.input;
        if (newInput) {
          const inputArray = Array.isArray(newInput) ? newInput : [newInput];
          baseRequest = {
            ...baseRequest,
            input: appendToMessages(this.currentState.messages, inputArray)
          };
        } else {
          baseRequest = {
            ...baseRequest,
            input: this.currentState.messages
          };
        }
      }
      this.resolvedRequest = {
        ...baseRequest,
        stream: true
      };
      const request = this.resolvedRequest;
      const apiResult = await betaResponsesSend(this.options.client, { openResponsesRequest: request }, this.options.options);
      if (!apiResult.ok) {
        throw apiResult.error;
      }
      if (isEventStream(apiResult.value)) {
        this.reusableStream = new ReusableReadableStream(apiResult.value);
      } else if (this.isNonStreamingResponse(apiResult.value)) {
        this.finalResponse = apiResult.value;
      } else {
        throw new Error("Unexpected response type from API");
      }
    })();
    return this.initPromise;
  }
  /**
   * Process approval/rejection decisions and resume execution
   */
  async processApprovalDecisions() {
    if (!this.currentState || !this.stateAccessor) {
      throw new Error("Cannot process approval decisions without state");
    }
    const pendingCalls = this.currentState.pendingToolCalls ?? [];
    const unsentResults = [...this.currentState.unsentToolResults ?? []];
    const turnContext = {
      numberOfTurns: this.allToolExecutionRounds.length + 1
    };
    for (const callId of this.approvedToolCalls) {
      const toolCall = pendingCalls.find((tc) => tc.id === callId);
      if (!toolCall)
        continue;
      const tool = this.options.tools?.find((t) => t.function.name === toolCall.name);
      if (!tool || !hasExecuteFunction(tool)) {
        unsentResults.push(createRejectedResult(callId, String(toolCall.name), "Tool not found or not executable"));
        continue;
      }
      const result = await executeTool(tool, toolCall, turnContext);
      if (result.error) {
        unsentResults.push(createRejectedResult(callId, String(toolCall.name), result.error.message));
      } else {
        unsentResults.push(createUnsentResult(callId, String(toolCall.name), result.result));
      }
    }
    for (const callId of this.rejectedToolCalls) {
      const toolCall = pendingCalls.find((tc) => tc.id === callId);
      if (!toolCall)
        continue;
      unsentResults.push(createRejectedResult(callId, String(toolCall.name), "Rejected by user"));
    }
    const processedIds = /* @__PURE__ */ new Set([...this.approvedToolCalls, ...this.rejectedToolCalls]);
    const remainingPending = pendingCalls.filter((tc) => !processedIds.has(tc.id));
    const stateUpdates = {
      status: remainingPending.length > 0 ? "awaiting_approval" : "in_progress"
    };
    if (remainingPending.length > 0) {
      stateUpdates.pendingToolCalls = remainingPending;
    }
    if (unsentResults.length > 0) {
      stateUpdates.unsentToolResults = unsentResults;
    }
    await this.saveStateSafely(stateUpdates);
    const propsToClear = [];
    if (remainingPending.length === 0)
      propsToClear.push("pendingToolCalls");
    if (unsentResults.length === 0)
      propsToClear.push("unsentToolResults");
    if (propsToClear.length > 0) {
      this.clearOptionalStateProperties(propsToClear);
      await this.saveStateSafely();
    }
    if (remainingPending.length > 0) {
      return;
    }
    await this.continueWithUnsentResults();
  }
  /**
   * Continue execution with unsent tool results
   */
  async continueWithUnsentResults() {
    if (!this.currentState || !this.stateAccessor)
      return;
    const unsentResults = this.currentState.unsentToolResults ?? [];
    if (unsentResults.length === 0)
      return;
    const toolOutputs = unsentResultsToAPIFormat(unsentResults);
    const currentMessages = this.currentState.messages;
    const newInput = appendToMessages(currentMessages, toolOutputs);
    this.currentState = updateState(this.currentState, {
      messages: newInput
    });
    this.clearOptionalStateProperties(["unsentToolResults"]);
    await this.saveStateSafely();
    const turnContext = {
      numberOfTurns: this.allToolExecutionRounds.length + 1
    };
    const baseRequest = await this.resolveRequestForContext(turnContext);
    const request = {
      ...baseRequest,
      input: newInput,
      stream: true
    };
    this.resolvedRequest = request;
    const apiResult = await betaResponsesSend(this.options.client, { openResponsesRequest: request }, this.options.options);
    if (!apiResult.ok) {
      throw apiResult.error;
    }
    if (isEventStream(apiResult.value)) {
      this.reusableStream = new ReusableReadableStream(apiResult.value);
    } else if (this.isNonStreamingResponse(apiResult.value)) {
      this.finalResponse = apiResult.value;
    } else {
      throw new Error("Unexpected response type from API");
    }
  }
  /**
   * Execute tools automatically if they are provided and have execute functions
   * This is idempotent - multiple calls will return the same promise
   */
  async executeToolsIfNeeded() {
    if (this.toolExecutionPromise) {
      return this.toolExecutionPromise;
    }
    this.toolExecutionPromise = (async () => {
      await this.initStream();
      if (this.isResumingFromApproval && this.currentState?.status === "awaiting_approval") {
        return;
      }
      let currentResponse = await this.getInitialResponse();
      await this.saveResponseToState(currentResponse);
      const hasToolCalls = currentResponse.output.some((item) => hasTypeProperty(item) && item.type === "function_call");
      if (!this.options.tools?.length || !hasToolCalls) {
        this.finalResponse = currentResponse;
        await this.markStateComplete();
        return;
      }
      const toolCalls = extractToolCallsFromResponse(currentResponse);
      if (await this.handleApprovalCheck(toolCalls, 0, currentResponse)) {
        return;
      }
      if (!this.hasExecutableToolCalls(toolCalls)) {
        this.finalResponse = currentResponse;
        await this.markStateComplete();
        return;
      }
      let currentRound = 0;
      while (true) {
        if (await this.checkForInterruption(currentResponse)) {
          return;
        }
        if (await this.shouldStopExecution()) {
          break;
        }
        const currentToolCalls = extractToolCallsFromResponse(currentResponse);
        if (currentToolCalls.length === 0) {
          break;
        }
        if (await this.handleApprovalCheck(currentToolCalls, currentRound + 1, currentResponse)) {
          return;
        }
        if (!this.hasExecutableToolCalls(currentToolCalls)) {
          break;
        }
        const turnContext = { numberOfTurns: currentRound + 1 };
        await this.resolveAsyncFunctionsForTurn(turnContext);
        const toolResults = await this.executeToolRound(currentToolCalls, turnContext);
        this.allToolExecutionRounds.push({
          round: currentRound,
          toolCalls: currentToolCalls,
          response: currentResponse,
          toolResults
        });
        await this.saveToolResultsToState(toolResults);
        await this.applyNextTurnParams(currentToolCalls);
        currentResponse = await this.makeFollowupRequest(currentResponse, toolResults);
        await this.saveResponseToState(currentResponse);
        currentRound++;
      }
      this.validateFinalResponse(currentResponse);
      this.finalResponse = currentResponse;
      await this.markStateComplete();
    })();
    return this.toolExecutionPromise;
  }
  /**
   * Internal helper to get the text after tool execution
   */
  async getTextInternal() {
    await this.executeToolsIfNeeded();
    if (!this.finalResponse) {
      throw new Error("Response not available");
    }
    return extractTextFromResponse(this.finalResponse);
  }
  /**
   * Get just the text content from the response.
   * This will consume the stream until completion, execute any tools, and extract the text.
   */
  getText() {
    if (this.textPromise) {
      return this.textPromise;
    }
    this.textPromise = this.getTextInternal();
    return this.textPromise;
  }
  /**
   * Get the complete response object including usage information.
   * This will consume the stream until completion and execute any tools.
   * Returns the full OpenResponsesNonStreamingResponse with usage data (inputTokens, outputTokens, cachedTokens, etc.)
   */
  async getResponse() {
    await this.executeToolsIfNeeded();
    if (!this.finalResponse) {
      throw new Error("Response not available");
    }
    return this.finalResponse;
  }
  /**
   * Stream all response events as they arrive.
   * Multiple consumers can iterate over this stream concurrently.
   * Preliminary tool results and tool results are streamed in REAL-TIME as generator tools yield.
   */
  getFullResponsesStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream) {
        throw new Error("Stream not initialized");
      }
      const broadcaster = this.ensureBroadcaster();
      const toolEventConsumer = broadcaster.createConsumer();
      const executionPromise = this.executeToolsIfNeeded().finally(() => {
        broadcaster.complete();
      });
      const consumer = this.reusableStream.createConsumer();
      for await (const event of consumer) {
        yield event;
      }
      for await (const event of toolEventConsumer) {
        if (event.type === "preliminary_result") {
          yield {
            type: "tool.preliminary_result",
            toolCallId: event.toolCallId,
            result: event.result,
            timestamp: Date.now()
          };
        } else if (event.type === "tool_result") {
          yield {
            type: "tool.result",
            toolCallId: event.toolCallId,
            result: event.result,
            timestamp: Date.now(),
            ...event.preliminaryResults && { preliminaryResults: event.preliminaryResults }
          };
        }
      }
      await executionPromise;
    }.call(this);
  }
  /**
   * Stream only text deltas as they arrive.
   * This filters the full event stream to only yield text content.
   */
  getTextStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream) {
        throw new Error("Stream not initialized");
      }
      yield* extractTextDeltas(this.reusableStream);
    }.call(this);
  }
  /**
   * Stream all output items cumulatively as they arrive.
   * Items are emitted with the same ID but progressively updated content as streaming progresses.
   * Also yields tool results (function_call_output) after tool execution completes.
   *
   * Item types include:
   * - message: Assistant text responses (emitted cumulatively as text streams)
   * - function_call: Tool calls (emitted cumulatively as arguments stream)
   * - reasoning: Model reasoning (emitted cumulatively as thinking streams)
   * - web_search_call: Web search operations
   * - file_search_call: File search operations
   * - image_generation_call: Image generation operations
   * - function_call_output: Results from executed tools
   */
  getItemsStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream) {
        throw new Error("Stream not initialized");
      }
      yield* buildItemsStream(this.reusableStream);
      await this.executeToolsIfNeeded();
      for (const round of this.allToolExecutionRounds) {
        if (round.round > 0) {
          for (const item of round.response.output) {
            if (isFunctionCallItem(item)) {
              yield item;
            }
          }
        }
        for (const toolResult of round.toolResults) {
          yield toolResult;
        }
      }
      if (this.finalResponse && this.allToolExecutionRounds.length > 0) {
        for (const item of this.finalResponse.output) {
          if (isOutputMessage(item) || isFunctionCallItem(item) || isReasoningOutputItem(item) || isWebSearchCallOutputItem(item) || isFileSearchCallOutputItem(item) || isImageGenerationCallOutputItem(item)) {
            yield item;
          }
        }
      }
    }.call(this);
  }
  /**
   * @deprecated Use `getItemsStream()` instead. This method only streams messages,
   * while `getItemsStream()` streams all output item types (messages, function_calls,
   * reasoning, etc.) with cumulative updates.
   *
   * Stream incremental message updates as content is added in responses format.
   * Each iteration yields an updated version of the message with new content.
   * Also yields function_call items and OpenResponsesFunctionCallOutput after tool execution completes.
   * Returns ResponsesOutputMessage, ResponsesOutputItemFunctionCall, or OpenResponsesFunctionCallOutput
   * compatible with OpenAI Responses API format.
   */
  getNewMessagesStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream) {
        throw new Error("Stream not initialized");
      }
      yield* buildResponsesMessageStream(this.reusableStream);
      await this.executeToolsIfNeeded();
      for (const round of this.allToolExecutionRounds) {
        for (const item of round.response.output) {
          if (isFunctionCallItem(item)) {
            yield item;
          }
        }
        for (const toolResult of round.toolResults) {
          yield toolResult;
        }
      }
      if (this.finalResponse && this.allToolExecutionRounds.length > 0) {
        const hasMessage = this.finalResponse.output.some((item) => hasTypeProperty(item) && item.type === "message");
        if (hasMessage) {
          yield extractResponsesMessageFromResponse(this.finalResponse);
        }
      }
    }.call(this);
  }
  /**
   * Stream only reasoning deltas as they arrive.
   * This filters the full event stream to only yield reasoning content.
   */
  getReasoningStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream) {
        throw new Error("Stream not initialized");
      }
      yield* extractReasoningDeltas(this.reusableStream);
    }.call(this);
  }
  /**
   * Stream tool call argument deltas and preliminary results.
   * Preliminary results are streamed in REAL-TIME as generator tools yield.
   * - Tool call argument deltas as { type: "delta", content: string }
   * - Preliminary results as { type: "preliminary_result", toolCallId, result }
   */
  getToolStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream) {
        throw new Error("Stream not initialized");
      }
      const broadcaster = this.ensureBroadcaster();
      const toolEventConsumer = broadcaster.createConsumer();
      const executionPromise = this.executeToolsIfNeeded().finally(() => {
        broadcaster.complete();
      });
      for await (const delta of extractToolDeltas(this.reusableStream)) {
        yield {
          type: "delta",
          content: delta
        };
      }
      for await (const event of toolEventConsumer) {
        if (event.type === "preliminary_result") {
          yield event;
        }
      }
      await executionPromise;
    }.call(this);
  }
  /**
   * Get all tool calls from the completed response (before auto-execution).
   * Note: If tools have execute functions, they will be automatically executed
   * and this will return the tool calls from the initial response.
   * Returns structured tool calls with parsed arguments.
   */
  async getToolCalls() {
    await this.initStream();
    if (this.finalResponse) {
      return extractToolCallsFromResponse(this.finalResponse);
    }
    if (!this.reusableStream) {
      throw new Error("Stream not initialized");
    }
    const completedResponse = await consumeStreamForCompletion(this.reusableStream);
    return extractToolCallsFromResponse(completedResponse);
  }
  /**
   * Stream structured tool call objects as they're completed.
   * Each iteration yields a complete tool call with parsed arguments.
   */
  getToolCallsStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream) {
        throw new Error("Stream not initialized");
      }
      yield* buildToolCallStream(this.reusableStream);
    }.call(this);
  }
  /**
   * Cancel the underlying stream and all consumers
   */
  async cancel() {
    if (this.reusableStream) {
      await this.reusableStream.cancel();
    }
  }
  // =========================================================================
  // Multi-Turn Conversation State Methods
  // =========================================================================
  /**
   * Check if the conversation requires human approval to continue.
   * Returns true if there are pending tool calls awaiting approval.
   */
  async requiresApproval() {
    await this.initStream();
    if (this.currentState?.status === "awaiting_approval") {
      return true;
    }
    return (this.currentState?.pendingToolCalls?.length ?? 0) > 0;
  }
  /**
   * Get the pending tool calls that require approval.
   * Returns empty array if no approvals needed.
   */
  async getPendingToolCalls() {
    await this.initStream();
    if (!this.isResumingFromApproval) {
      await this.executeToolsIfNeeded();
    }
    return this.currentState?.pendingToolCalls ?? [];
  }
  /**
   * Get the current conversation state.
   * Useful for inspection, debugging, or custom persistence.
   * Note: This returns the raw ConversationState for inspection only.
   * To resume a conversation, use the StateAccessor pattern.
   */
  async getState() {
    await this.initStream();
    if (!this.isResumingFromApproval) {
      await this.executeToolsIfNeeded();
    }
    if (!this.currentState) {
      throw new Error("State not initialized. Make sure a StateAccessor was provided to callModel.");
    }
    return this.currentState;
  }
};

// node_modules/@openrouter/sdk/esm/funcs/call-model.js
function callModel(client, request, options) {
  const { tools, stopWhen, state, requireApproval, approveToolCalls, rejectToolCalls, ...apiRequest } = request;
  const apiTools = tools ? convertToolsToAPIFormat(tools) : void 0;
  const finalRequest = {
    ...apiRequest
  };
  if (apiTools !== void 0) {
    finalRequest["tools"] = apiTools;
  }
  return new ModelResult({
    client,
    request: finalRequest,
    options: options ?? {},
    tools,
    ...stopWhen !== void 0 && { stopWhen },
    // Pass state management options
    ...state !== void 0 && { state },
    ...requireApproval !== void 0 && { requireApproval },
    ...approveToolCalls !== void 0 && { approveToolCalls },
    ...rejectToolCalls !== void 0 && { rejectToolCalls }
  });
}

// node_modules/@openrouter/sdk/esm/sdk/sdk.js
var OpenRouter = class extends ClientSDK {
  get beta() {
    return this._beta ?? (this._beta = new Beta(this._options));
  }
  get analytics() {
    return this._analytics ?? (this._analytics = new Analytics(this._options));
  }
  get chat() {
    return this._chat ?? (this._chat = new Chat(this._options));
  }
  get credits() {
    return this._credits ?? (this._credits = new Credits(this._options));
  }
  get embeddings() {
    return this._embeddings ?? (this._embeddings = new Embeddings(this._options));
  }
  get generations() {
    return this._generations ?? (this._generations = new Generations(this._options));
  }
  get models() {
    return this._models ?? (this._models = new Models(this._options));
  }
  get endpoints() {
    return this._endpoints ?? (this._endpoints = new Endpoints(this._options));
  }
  get providers() {
    return this._providers ?? (this._providers = new Providers(this._options));
  }
  get apiKeys() {
    return this._apiKeys ?? (this._apiKeys = new APIKeys(this._options));
  }
  get guardrails() {
    return this._guardrails ?? (this._guardrails = new Guardrails(this._options));
  }
  get oAuth() {
    return this._oAuth ?? (this._oAuth = new OAuth(this._options));
  }
  // #region sdk-class-body
  callModel(request, options) {
    return callModel(this, request, options);
  }
};

// ../../../node_modules/openai/internal/tslib.mjs
function __classPrivateFieldSet3(receiver, state, value, kind, f) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}
function __classPrivateFieldGet3(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}

// ../../../node_modules/openai/internal/utils/uuid.mjs
var uuid4 = function() {
  const { crypto: crypto2 } = globalThis;
  if (crypto2?.randomUUID) {
    uuid4 = crypto2.randomUUID.bind(crypto2);
    return crypto2.randomUUID();
  }
  const u8 = new Uint8Array(1);
  const randomByte = crypto2 ? () => crypto2.getRandomValues(u8)[0] : () => Math.random() * 255 & 255;
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (+c ^ randomByte() & 15 >> +c / 4).toString(16));
};

// ../../../node_modules/openai/internal/errors.mjs
function isAbortError2(err) {
  return typeof err === "object" && err !== null && // Spec-compliant fetch implementations
  ("name" in err && err.name === "AbortError" || // Expo fetch
  "message" in err && String(err.message).includes("FetchRequestCanceledException"));
}
var castToError = (err) => {
  if (err instanceof Error)
    return err;
  if (typeof err === "object" && err !== null) {
    try {
      if (Object.prototype.toString.call(err) === "[object Error]") {
        const error = new Error(err.message, err.cause ? { cause: err.cause } : {});
        if (err.stack)
          error.stack = err.stack;
        if (err.cause && !error.cause)
          error.cause = err.cause;
        if (err.name)
          error.name = err.name;
        return error;
      }
    } catch {
    }
    try {
      return new Error(JSON.stringify(err));
    } catch {
    }
  }
  return new Error(err);
};

// ../../../node_modules/openai/core/error.mjs
var OpenAIError = class extends Error {
};
var APIError = class _APIError extends OpenAIError {
  constructor(status, error, message, headers) {
    super(`${_APIError.makeMessage(status, error, message)}`);
    this.status = status;
    this.headers = headers;
    this.requestID = headers?.get("x-request-id");
    this.error = error;
    const data = error;
    this.code = data?.["code"];
    this.param = data?.["param"];
    this.type = data?.["type"];
  }
  static makeMessage(status, error, message) {
    const msg = error?.message ? typeof error.message === "string" ? error.message : JSON.stringify(error.message) : error ? JSON.stringify(error) : message;
    if (status && msg) {
      return `${status} ${msg}`;
    }
    if (status) {
      return `${status} status code (no body)`;
    }
    if (msg) {
      return msg;
    }
    return "(no status code or body)";
  }
  static generate(status, errorResponse, message, headers) {
    if (!status || !headers) {
      return new APIConnectionError({ message, cause: castToError(errorResponse) });
    }
    const error = errorResponse?.["error"];
    if (status === 400) {
      return new BadRequestError(status, error, message, headers);
    }
    if (status === 401) {
      return new AuthenticationError(status, error, message, headers);
    }
    if (status === 403) {
      return new PermissionDeniedError(status, error, message, headers);
    }
    if (status === 404) {
      return new NotFoundError(status, error, message, headers);
    }
    if (status === 409) {
      return new ConflictError(status, error, message, headers);
    }
    if (status === 422) {
      return new UnprocessableEntityError(status, error, message, headers);
    }
    if (status === 429) {
      return new RateLimitError(status, error, message, headers);
    }
    if (status >= 500) {
      return new InternalServerError(status, error, message, headers);
    }
    return new _APIError(status, error, message, headers);
  }
};
var APIUserAbortError = class extends APIError {
  constructor({ message } = {}) {
    super(void 0, void 0, message || "Request was aborted.", void 0);
  }
};
var APIConnectionError = class extends APIError {
  constructor({ message, cause }) {
    super(void 0, void 0, message || "Connection error.", void 0);
    if (cause)
      this.cause = cause;
  }
};
var APIConnectionTimeoutError = class extends APIConnectionError {
  constructor({ message } = {}) {
    super({ message: message ?? "Request timed out." });
  }
};
var BadRequestError = class extends APIError {
};
var AuthenticationError = class extends APIError {
};
var PermissionDeniedError = class extends APIError {
};
var NotFoundError = class extends APIError {
};
var ConflictError = class extends APIError {
};
var UnprocessableEntityError = class extends APIError {
};
var RateLimitError = class extends APIError {
};
var InternalServerError = class extends APIError {
};
var LengthFinishReasonError = class extends OpenAIError {
  constructor() {
    super(`Could not parse response content as the length limit was reached`);
  }
};
var ContentFilterFinishReasonError = class extends OpenAIError {
  constructor() {
    super(`Could not parse response content as the request was rejected by the content filter`);
  }
};
var InvalidWebhookSignatureError = class extends Error {
  constructor(message) {
    super(message);
  }
};

// ../../../node_modules/openai/internal/utils/values.mjs
var startsWithSchemeRegexp = /^[a-z][a-z0-9+.-]*:/i;
var isAbsoluteURL = (url) => {
  return startsWithSchemeRegexp.test(url);
};
var isArray = (val) => (isArray = Array.isArray, isArray(val));
var isReadonlyArray = isArray;
function maybeObj(x) {
  if (typeof x !== "object") {
    return {};
  }
  return x ?? {};
}
function isEmptyObj(obj) {
  if (!obj)
    return true;
  for (const _k in obj)
    return false;
  return true;
}
function hasOwn2(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function isObj(obj) {
  return obj != null && typeof obj === "object" && !Array.isArray(obj);
}
var validatePositiveInteger = (name, n) => {
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new OpenAIError(`${name} must be an integer`);
  }
  if (n < 0) {
    throw new OpenAIError(`${name} must be a positive integer`);
  }
  return n;
};
var safeJSON = (text2) => {
  try {
    return JSON.parse(text2);
  } catch (err) {
    return void 0;
  }
};

// ../../../node_modules/openai/internal/utils/sleep.mjs
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ../../../node_modules/openai/version.mjs
var VERSION = "6.32.0";

// ../../../node_modules/openai/internal/detect-platform.mjs
var isRunningInBrowser = () => {
  return (
    // @ts-ignore
    typeof window !== "undefined" && // @ts-ignore
    typeof window.document !== "undefined" && // @ts-ignore
    typeof navigator !== "undefined"
  );
};
function getDetectedPlatform() {
  if (typeof Deno !== "undefined" && Deno.build != null) {
    return "deno";
  }
  if (typeof EdgeRuntime !== "undefined") {
    return "edge";
  }
  if (Object.prototype.toString.call(typeof globalThis.process !== "undefined" ? globalThis.process : 0) === "[object process]") {
    return "node";
  }
  return "unknown";
}
var getPlatformProperties = () => {
  const detectedPlatform = getDetectedPlatform();
  if (detectedPlatform === "deno") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(Deno.build.os),
      "X-Stainless-Arch": normalizeArch(Deno.build.arch),
      "X-Stainless-Runtime": "deno",
      "X-Stainless-Runtime-Version": typeof Deno.version === "string" ? Deno.version : Deno.version?.deno ?? "unknown"
    };
  }
  if (typeof EdgeRuntime !== "undefined") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": `other:${EdgeRuntime}`,
      "X-Stainless-Runtime": "edge",
      "X-Stainless-Runtime-Version": globalThis.process.version
    };
  }
  if (detectedPlatform === "node") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(globalThis.process.platform ?? "unknown"),
      "X-Stainless-Arch": normalizeArch(globalThis.process.arch ?? "unknown"),
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": globalThis.process.version ?? "unknown"
    };
  }
  const browserInfo = getBrowserInfo();
  if (browserInfo) {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": "unknown",
      "X-Stainless-Runtime": `browser:${browserInfo.browser}`,
      "X-Stainless-Runtime-Version": browserInfo.version
    };
  }
  return {
    "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": VERSION,
    "X-Stainless-OS": "Unknown",
    "X-Stainless-Arch": "unknown",
    "X-Stainless-Runtime": "unknown",
    "X-Stainless-Runtime-Version": "unknown"
  };
};
function getBrowserInfo() {
  if (typeof navigator === "undefined" || !navigator) {
    return null;
  }
  const browserPatterns = [
    { key: "edge", pattern: /Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "chrome", pattern: /Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "firefox", pattern: /Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "safari", pattern: /(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/ }
  ];
  for (const { key, pattern } of browserPatterns) {
    const match2 = pattern.exec(navigator.userAgent);
    if (match2) {
      const major = match2[1] || 0;
      const minor = match2[2] || 0;
      const patch = match2[3] || 0;
      return { browser: key, version: `${major}.${minor}.${patch}` };
    }
  }
  return null;
}
var normalizeArch = (arch) => {
  if (arch === "x32")
    return "x32";
  if (arch === "x86_64" || arch === "x64")
    return "x64";
  if (arch === "arm")
    return "arm";
  if (arch === "aarch64" || arch === "arm64")
    return "arm64";
  if (arch)
    return `other:${arch}`;
  return "unknown";
};
var normalizePlatform = (platform) => {
  platform = platform.toLowerCase();
  if (platform.includes("ios"))
    return "iOS";
  if (platform === "android")
    return "Android";
  if (platform === "darwin")
    return "MacOS";
  if (platform === "win32")
    return "Windows";
  if (platform === "freebsd")
    return "FreeBSD";
  if (platform === "openbsd")
    return "OpenBSD";
  if (platform === "linux")
    return "Linux";
  if (platform)
    return `Other:${platform}`;
  return "Unknown";
};
var _platformHeaders;
var getPlatformHeaders = () => {
  return _platformHeaders ?? (_platformHeaders = getPlatformProperties());
};

// ../../../node_modules/openai/internal/shims.mjs
function getDefaultFetch() {
  if (typeof fetch !== "undefined") {
    return fetch;
  }
  throw new Error("`fetch` is not defined as a global; Either pass `fetch` to the client, `new OpenAI({ fetch })` or polyfill the global, `globalThis.fetch = fetch`");
}
function makeReadableStream(...args) {
  const ReadableStream2 = globalThis.ReadableStream;
  if (typeof ReadableStream2 === "undefined") {
    throw new Error("`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`");
  }
  return new ReadableStream2(...args);
}
function ReadableStreamFrom(iterable) {
  let iter = Symbol.asyncIterator in iterable ? iterable[Symbol.asyncIterator]() : iterable[Symbol.iterator]();
  return makeReadableStream({
    start() {
    },
    async pull(controller) {
      const { done, value } = await iter.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    async cancel() {
      await iter.return?.();
    }
  });
}
function ReadableStreamToAsyncIterable(stream) {
  if (stream[Symbol.asyncIterator])
    return stream;
  const reader = stream.getReader();
  return {
    async next() {
      try {
        const result = await reader.read();
        if (result?.done)
          reader.releaseLock();
        return result;
      } catch (e) {
        reader.releaseLock();
        throw e;
      }
    },
    async return() {
      const cancelPromise = reader.cancel();
      reader.releaseLock();
      await cancelPromise;
      return { done: true, value: void 0 };
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
}
async function CancelReadableStream(stream) {
  if (stream === null || typeof stream !== "object")
    return;
  if (stream[Symbol.asyncIterator]) {
    await stream[Symbol.asyncIterator]().return?.();
    return;
  }
  const reader = stream.getReader();
  const cancelPromise = reader.cancel();
  reader.releaseLock();
  await cancelPromise;
}

// ../../../node_modules/openai/internal/request-options.mjs
var FallbackEncoder = ({ headers, body }) => {
  return {
    bodyHeaders: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  };
};

// ../../../node_modules/openai/internal/qs/formats.mjs
var default_format = "RFC3986";
var default_formatter = (v) => String(v);
var formatters = {
  RFC1738: (v) => String(v).replace(/%20/g, "+"),
  RFC3986: default_formatter
};
var RFC1738 = "RFC1738";

// ../../../node_modules/openai/internal/qs/utils.mjs
var has = (obj, key) => (has = Object.hasOwn ?? Function.prototype.call.bind(Object.prototype.hasOwnProperty), has(obj, key));
var hex_table = /* @__PURE__ */ (() => {
  const array52 = [];
  for (let i = 0; i < 256; ++i) {
    array52.push("%" + ((i < 16 ? "0" : "") + i.toString(16)).toUpperCase());
  }
  return array52;
})();
var limit = 1024;
var encode = (str2, _defaultEncoder, charset, _kind, format) => {
  if (str2.length === 0) {
    return str2;
  }
  let string149 = str2;
  if (typeof str2 === "symbol") {
    string149 = Symbol.prototype.toString.call(str2);
  } else if (typeof str2 !== "string") {
    string149 = String(str2);
  }
  if (charset === "iso-8859-1") {
    return escape(string149).replace(/%u[0-9a-f]{4}/gi, function($0) {
      return "%26%23" + parseInt($0.slice(2), 16) + "%3B";
    });
  }
  let out = "";
  for (let j = 0; j < string149.length; j += limit) {
    const segment = string149.length >= limit ? string149.slice(j, j + limit) : string149;
    const arr = [];
    for (let i = 0; i < segment.length; ++i) {
      let c = segment.charCodeAt(i);
      if (c === 45 || // -
      c === 46 || // .
      c === 95 || // _
      c === 126 || // ~
      c >= 48 && c <= 57 || // 0-9
      c >= 65 && c <= 90 || // a-z
      c >= 97 && c <= 122 || // A-Z
      format === RFC1738 && (c === 40 || c === 41)) {
        arr[arr.length] = segment.charAt(i);
        continue;
      }
      if (c < 128) {
        arr[arr.length] = hex_table[c];
        continue;
      }
      if (c < 2048) {
        arr[arr.length] = hex_table[192 | c >> 6] + hex_table[128 | c & 63];
        continue;
      }
      if (c < 55296 || c >= 57344) {
        arr[arr.length] = hex_table[224 | c >> 12] + hex_table[128 | c >> 6 & 63] + hex_table[128 | c & 63];
        continue;
      }
      i += 1;
      c = 65536 + ((c & 1023) << 10 | segment.charCodeAt(i) & 1023);
      arr[arr.length] = hex_table[240 | c >> 18] + hex_table[128 | c >> 12 & 63] + hex_table[128 | c >> 6 & 63] + hex_table[128 | c & 63];
    }
    out += arr.join("");
  }
  return out;
};
function is_buffer(obj) {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  return !!(obj.constructor && obj.constructor.isBuffer && obj.constructor.isBuffer(obj));
}
function maybe_map(val, fn) {
  if (isArray(val)) {
    const mapped = [];
    for (let i = 0; i < val.length; i += 1) {
      mapped.push(fn(val[i]));
    }
    return mapped;
  }
  return fn(val);
}

// ../../../node_modules/openai/internal/qs/stringify.mjs
var array_prefix_generators = {
  brackets(prefix) {
    return String(prefix) + "[]";
  },
  comma: "comma",
  indices(prefix, key) {
    return String(prefix) + "[" + key + "]";
  },
  repeat(prefix) {
    return String(prefix);
  }
};
var push_to_array = function(arr, value_or_array) {
  Array.prototype.push.apply(arr, isArray(value_or_array) ? value_or_array : [value_or_array]);
};
var toISOString;
var defaults = {
  addQueryPrefix: false,
  allowDots: false,
  allowEmptyArrays: false,
  arrayFormat: "indices",
  charset: "utf-8",
  charsetSentinel: false,
  delimiter: "&",
  encode: true,
  encodeDotInKeys: false,
  encoder: encode,
  encodeValuesOnly: false,
  format: default_format,
  formatter: default_formatter,
  /** @deprecated */
  indices: false,
  serializeDate(date3) {
    return (toISOString ?? (toISOString = Function.prototype.call.bind(Date.prototype.toISOString)))(date3);
  },
  skipNulls: false,
  strictNullHandling: false
};
function is_non_nullish_primitive(v) {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "symbol" || typeof v === "bigint";
}
var sentinel = {};
function inner_stringify(object180, prefix, generateArrayPrefix, commaRoundTrip, allowEmptyArrays, strictNullHandling, skipNulls, encodeDotInKeys, encoder, filter, sort, allowDots, serializeDate, format, formatter, encodeValuesOnly, charset, sideChannel) {
  let obj = object180;
  let tmp_sc = sideChannel;
  let step = 0;
  let find_flag = false;
  while ((tmp_sc = tmp_sc.get(sentinel)) !== void 0 && !find_flag) {
    const pos = tmp_sc.get(object180);
    step += 1;
    if (typeof pos !== "undefined") {
      if (pos === step) {
        throw new RangeError("Cyclic object value");
      } else {
        find_flag = true;
      }
    }
    if (typeof tmp_sc.get(sentinel) === "undefined") {
      step = 0;
    }
  }
  if (typeof filter === "function") {
    obj = filter(prefix, obj);
  } else if (obj instanceof Date) {
    obj = serializeDate?.(obj);
  } else if (generateArrayPrefix === "comma" && isArray(obj)) {
    obj = maybe_map(obj, function(value) {
      if (value instanceof Date) {
        return serializeDate?.(value);
      }
      return value;
    });
  }
  if (obj === null) {
    if (strictNullHandling) {
      return encoder && !encodeValuesOnly ? (
        // @ts-expect-error
        encoder(prefix, defaults.encoder, charset, "key", format)
      ) : prefix;
    }
    obj = "";
  }
  if (is_non_nullish_primitive(obj) || is_buffer(obj)) {
    if (encoder) {
      const key_value = encodeValuesOnly ? prefix : encoder(prefix, defaults.encoder, charset, "key", format);
      return [
        formatter?.(key_value) + "=" + // @ts-expect-error
        formatter?.(encoder(obj, defaults.encoder, charset, "value", format))
      ];
    }
    return [formatter?.(prefix) + "=" + formatter?.(String(obj))];
  }
  const values = [];
  if (typeof obj === "undefined") {
    return values;
  }
  let obj_keys;
  if (generateArrayPrefix === "comma" && isArray(obj)) {
    if (encodeValuesOnly && encoder) {
      obj = maybe_map(obj, encoder);
    }
    obj_keys = [{ value: obj.length > 0 ? obj.join(",") || null : void 0 }];
  } else if (isArray(filter)) {
    obj_keys = filter;
  } else {
    const keys = Object.keys(obj);
    obj_keys = sort ? keys.sort(sort) : keys;
  }
  const encoded_prefix = encodeDotInKeys ? String(prefix).replace(/\./g, "%2E") : String(prefix);
  const adjusted_prefix = commaRoundTrip && isArray(obj) && obj.length === 1 ? encoded_prefix + "[]" : encoded_prefix;
  if (allowEmptyArrays && isArray(obj) && obj.length === 0) {
    return adjusted_prefix + "[]";
  }
  for (let j = 0; j < obj_keys.length; ++j) {
    const key = obj_keys[j];
    const value = (
      // @ts-ignore
      typeof key === "object" && typeof key.value !== "undefined" ? key.value : obj[key]
    );
    if (skipNulls && value === null) {
      continue;
    }
    const encoded_key = allowDots && encodeDotInKeys ? key.replace(/\./g, "%2E") : key;
    const key_prefix = isArray(obj) ? typeof generateArrayPrefix === "function" ? generateArrayPrefix(adjusted_prefix, encoded_key) : adjusted_prefix : adjusted_prefix + (allowDots ? "." + encoded_key : "[" + encoded_key + "]");
    sideChannel.set(object180, step);
    const valueSideChannel = /* @__PURE__ */ new WeakMap();
    valueSideChannel.set(sentinel, sideChannel);
    push_to_array(values, inner_stringify(
      value,
      key_prefix,
      generateArrayPrefix,
      commaRoundTrip,
      allowEmptyArrays,
      strictNullHandling,
      skipNulls,
      encodeDotInKeys,
      // @ts-ignore
      generateArrayPrefix === "comma" && encodeValuesOnly && isArray(obj) ? null : encoder,
      filter,
      sort,
      allowDots,
      serializeDate,
      format,
      formatter,
      encodeValuesOnly,
      charset,
      valueSideChannel
    ));
  }
  return values;
}
function normalize_stringify_options(opts = defaults) {
  if (typeof opts.allowEmptyArrays !== "undefined" && typeof opts.allowEmptyArrays !== "boolean") {
    throw new TypeError("`allowEmptyArrays` option can only be `true` or `false`, when provided");
  }
  if (typeof opts.encodeDotInKeys !== "undefined" && typeof opts.encodeDotInKeys !== "boolean") {
    throw new TypeError("`encodeDotInKeys` option can only be `true` or `false`, when provided");
  }
  if (opts.encoder !== null && typeof opts.encoder !== "undefined" && typeof opts.encoder !== "function") {
    throw new TypeError("Encoder has to be a function.");
  }
  const charset = opts.charset || defaults.charset;
  if (typeof opts.charset !== "undefined" && opts.charset !== "utf-8" && opts.charset !== "iso-8859-1") {
    throw new TypeError("The charset option must be either utf-8, iso-8859-1, or undefined");
  }
  let format = default_format;
  if (typeof opts.format !== "undefined") {
    if (!has(formatters, opts.format)) {
      throw new TypeError("Unknown format option provided.");
    }
    format = opts.format;
  }
  const formatter = formatters[format];
  let filter = defaults.filter;
  if (typeof opts.filter === "function" || isArray(opts.filter)) {
    filter = opts.filter;
  }
  let arrayFormat;
  if (opts.arrayFormat && opts.arrayFormat in array_prefix_generators) {
    arrayFormat = opts.arrayFormat;
  } else if ("indices" in opts) {
    arrayFormat = opts.indices ? "indices" : "repeat";
  } else {
    arrayFormat = defaults.arrayFormat;
  }
  if ("commaRoundTrip" in opts && typeof opts.commaRoundTrip !== "boolean") {
    throw new TypeError("`commaRoundTrip` must be a boolean, or absent");
  }
  const allowDots = typeof opts.allowDots === "undefined" ? !!opts.encodeDotInKeys === true ? true : defaults.allowDots : !!opts.allowDots;
  return {
    addQueryPrefix: typeof opts.addQueryPrefix === "boolean" ? opts.addQueryPrefix : defaults.addQueryPrefix,
    // @ts-ignore
    allowDots,
    allowEmptyArrays: typeof opts.allowEmptyArrays === "boolean" ? !!opts.allowEmptyArrays : defaults.allowEmptyArrays,
    arrayFormat,
    charset,
    charsetSentinel: typeof opts.charsetSentinel === "boolean" ? opts.charsetSentinel : defaults.charsetSentinel,
    commaRoundTrip: !!opts.commaRoundTrip,
    delimiter: typeof opts.delimiter === "undefined" ? defaults.delimiter : opts.delimiter,
    encode: typeof opts.encode === "boolean" ? opts.encode : defaults.encode,
    encodeDotInKeys: typeof opts.encodeDotInKeys === "boolean" ? opts.encodeDotInKeys : defaults.encodeDotInKeys,
    encoder: typeof opts.encoder === "function" ? opts.encoder : defaults.encoder,
    encodeValuesOnly: typeof opts.encodeValuesOnly === "boolean" ? opts.encodeValuesOnly : defaults.encodeValuesOnly,
    filter,
    format,
    formatter,
    serializeDate: typeof opts.serializeDate === "function" ? opts.serializeDate : defaults.serializeDate,
    skipNulls: typeof opts.skipNulls === "boolean" ? opts.skipNulls : defaults.skipNulls,
    // @ts-ignore
    sort: typeof opts.sort === "function" ? opts.sort : null,
    strictNullHandling: typeof opts.strictNullHandling === "boolean" ? opts.strictNullHandling : defaults.strictNullHandling
  };
}
function stringify(object180, opts = {}) {
  let obj = object180;
  const options = normalize_stringify_options(opts);
  let obj_keys;
  let filter;
  if (typeof options.filter === "function") {
    filter = options.filter;
    obj = filter("", obj);
  } else if (isArray(options.filter)) {
    filter = options.filter;
    obj_keys = filter;
  }
  const keys = [];
  if (typeof obj !== "object" || obj === null) {
    return "";
  }
  const generateArrayPrefix = array_prefix_generators[options.arrayFormat];
  const commaRoundTrip = generateArrayPrefix === "comma" && options.commaRoundTrip;
  if (!obj_keys) {
    obj_keys = Object.keys(obj);
  }
  if (options.sort) {
    obj_keys.sort(options.sort);
  }
  const sideChannel = /* @__PURE__ */ new WeakMap();
  for (let i = 0; i < obj_keys.length; ++i) {
    const key = obj_keys[i];
    if (options.skipNulls && obj[key] === null) {
      continue;
    }
    push_to_array(keys, inner_stringify(
      obj[key],
      key,
      // @ts-expect-error
      generateArrayPrefix,
      commaRoundTrip,
      options.allowEmptyArrays,
      options.strictNullHandling,
      options.skipNulls,
      options.encodeDotInKeys,
      options.encode ? options.encoder : null,
      options.filter,
      options.sort,
      options.allowDots,
      options.serializeDate,
      options.format,
      options.formatter,
      options.encodeValuesOnly,
      options.charset,
      sideChannel
    ));
  }
  const joined = keys.join(options.delimiter);
  let prefix = options.addQueryPrefix === true ? "?" : "";
  if (options.charsetSentinel) {
    if (options.charset === "iso-8859-1") {
      prefix += "utf8=%26%2310003%3B&";
    } else {
      prefix += "utf8=%E2%9C%93&";
    }
  }
  return joined.length > 0 ? prefix + joined : "";
}

// ../../../node_modules/openai/internal/utils/query.mjs
function stringifyQuery(query) {
  return stringify(query, { arrayFormat: "brackets" });
}

// ../../../node_modules/openai/internal/utils/bytes.mjs
function concatBytes(buffers) {
  let length = 0;
  for (const buffer of buffers) {
    length += buffer.length;
  }
  const output = new Uint8Array(length);
  let index = 0;
  for (const buffer of buffers) {
    output.set(buffer, index);
    index += buffer.length;
  }
  return output;
}
var encodeUTF8_;
function encodeUTF8(str2) {
  let encoder;
  return (encodeUTF8_ ?? (encoder = new globalThis.TextEncoder(), encodeUTF8_ = encoder.encode.bind(encoder)))(str2);
}
var decodeUTF8_;
function decodeUTF8(bytes) {
  let decoder;
  return (decodeUTF8_ ?? (decoder = new globalThis.TextDecoder(), decodeUTF8_ = decoder.decode.bind(decoder)))(bytes);
}

// ../../../node_modules/openai/internal/decoders/line.mjs
var _LineDecoder_buffer;
var _LineDecoder_carriageReturnIndex;
var LineDecoder = class {
  constructor() {
    _LineDecoder_buffer.set(this, void 0);
    _LineDecoder_carriageReturnIndex.set(this, void 0);
    __classPrivateFieldSet3(this, _LineDecoder_buffer, new Uint8Array(), "f");
    __classPrivateFieldSet3(this, _LineDecoder_carriageReturnIndex, null, "f");
  }
  decode(chunk) {
    if (chunk == null) {
      return [];
    }
    const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : typeof chunk === "string" ? encodeUTF8(chunk) : chunk;
    __classPrivateFieldSet3(this, _LineDecoder_buffer, concatBytes([__classPrivateFieldGet3(this, _LineDecoder_buffer, "f"), binaryChunk]), "f");
    const lines = [];
    let patternIndex;
    while ((patternIndex = findNewlineIndex(__classPrivateFieldGet3(this, _LineDecoder_buffer, "f"), __classPrivateFieldGet3(this, _LineDecoder_carriageReturnIndex, "f"))) != null) {
      if (patternIndex.carriage && __classPrivateFieldGet3(this, _LineDecoder_carriageReturnIndex, "f") == null) {
        __classPrivateFieldSet3(this, _LineDecoder_carriageReturnIndex, patternIndex.index, "f");
        continue;
      }
      if (__classPrivateFieldGet3(this, _LineDecoder_carriageReturnIndex, "f") != null && (patternIndex.index !== __classPrivateFieldGet3(this, _LineDecoder_carriageReturnIndex, "f") + 1 || patternIndex.carriage)) {
        lines.push(decodeUTF8(__classPrivateFieldGet3(this, _LineDecoder_buffer, "f").subarray(0, __classPrivateFieldGet3(this, _LineDecoder_carriageReturnIndex, "f") - 1)));
        __classPrivateFieldSet3(this, _LineDecoder_buffer, __classPrivateFieldGet3(this, _LineDecoder_buffer, "f").subarray(__classPrivateFieldGet3(this, _LineDecoder_carriageReturnIndex, "f")), "f");
        __classPrivateFieldSet3(this, _LineDecoder_carriageReturnIndex, null, "f");
        continue;
      }
      const endIndex = __classPrivateFieldGet3(this, _LineDecoder_carriageReturnIndex, "f") !== null ? patternIndex.preceding - 1 : patternIndex.preceding;
      const line = decodeUTF8(__classPrivateFieldGet3(this, _LineDecoder_buffer, "f").subarray(0, endIndex));
      lines.push(line);
      __classPrivateFieldSet3(this, _LineDecoder_buffer, __classPrivateFieldGet3(this, _LineDecoder_buffer, "f").subarray(patternIndex.index), "f");
      __classPrivateFieldSet3(this, _LineDecoder_carriageReturnIndex, null, "f");
    }
    return lines;
  }
  flush() {
    if (!__classPrivateFieldGet3(this, _LineDecoder_buffer, "f").length) {
      return [];
    }
    return this.decode("\n");
  }
};
_LineDecoder_buffer = /* @__PURE__ */ new WeakMap(), _LineDecoder_carriageReturnIndex = /* @__PURE__ */ new WeakMap();
LineDecoder.NEWLINE_CHARS = /* @__PURE__ */ new Set(["\n", "\r"]);
LineDecoder.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
function findNewlineIndex(buffer, startIndex) {
  const newline = 10;
  const carriage = 13;
  for (let i = startIndex ?? 0; i < buffer.length; i++) {
    if (buffer[i] === newline) {
      return { preceding: i, index: i + 1, carriage: false };
    }
    if (buffer[i] === carriage) {
      return { preceding: i, index: i + 1, carriage: true };
    }
  }
  return null;
}
function findDoubleNewlineIndex(buffer) {
  const newline = 10;
  const carriage = 13;
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] === newline && buffer[i + 1] === newline) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === carriage) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === newline && i + 3 < buffer.length && buffer[i + 2] === carriage && buffer[i + 3] === newline) {
      return i + 4;
    }
  }
  return -1;
}

// ../../../node_modules/openai/internal/utils/log.mjs
var levelNumbers = {
  off: 0,
  error: 200,
  warn: 300,
  info: 400,
  debug: 500
};
var parseLogLevel = (maybeLevel, sourceName, client) => {
  if (!maybeLevel) {
    return void 0;
  }
  if (hasOwn2(levelNumbers, maybeLevel)) {
    return maybeLevel;
  }
  loggerFor(client).warn(`${sourceName} was set to ${JSON.stringify(maybeLevel)}, expected one of ${JSON.stringify(Object.keys(levelNumbers))}`);
  return void 0;
};
function noop() {
}
function makeLogFn(fnLevel, logger4, logLevel) {
  if (!logger4 || levelNumbers[fnLevel] > levelNumbers[logLevel]) {
    return noop;
  } else {
    return logger4[fnLevel].bind(logger4);
  }
}
var noopLogger = {
  error: noop,
  warn: noop,
  info: noop,
  debug: noop
};
var cachedLoggers = /* @__PURE__ */ new WeakMap();
function loggerFor(client) {
  const logger4 = client.logger;
  const logLevel = client.logLevel ?? "off";
  if (!logger4) {
    return noopLogger;
  }
  const cachedLogger = cachedLoggers.get(logger4);
  if (cachedLogger && cachedLogger[0] === logLevel) {
    return cachedLogger[1];
  }
  const levelLogger = {
    error: makeLogFn("error", logger4, logLevel),
    warn: makeLogFn("warn", logger4, logLevel),
    info: makeLogFn("info", logger4, logLevel),
    debug: makeLogFn("debug", logger4, logLevel)
  };
  cachedLoggers.set(logger4, [logLevel, levelLogger]);
  return levelLogger;
}
var formatRequestDetails = (details) => {
  if (details.options) {
    details.options = { ...details.options };
    delete details.options["headers"];
  }
  if (details.headers) {
    details.headers = Object.fromEntries((details.headers instanceof Headers ? [...details.headers] : Object.entries(details.headers)).map(([name, value]) => [
      name,
      name.toLowerCase() === "authorization" || name.toLowerCase() === "cookie" || name.toLowerCase() === "set-cookie" ? "***" : value
    ]));
  }
  if ("retryOfRequestLogID" in details) {
    if (details.retryOfRequestLogID) {
      details.retryOf = details.retryOfRequestLogID;
    }
    delete details.retryOfRequestLogID;
  }
  return details;
};

// ../../../node_modules/openai/core/streaming.mjs
var _Stream_client;
var Stream = class _Stream {
  constructor(iterator, controller, client) {
    this.iterator = iterator;
    _Stream_client.set(this, void 0);
    this.controller = controller;
    __classPrivateFieldSet3(this, _Stream_client, client, "f");
  }
  static fromSSEResponse(response, controller, client, synthesizeEventData) {
    let consumed = false;
    const logger4 = client ? loggerFor(client) : console;
    async function* iterator() {
      if (consumed) {
        throw new OpenAIError("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      }
      consumed = true;
      let done = false;
      try {
        for await (const sse2 of _iterSSEMessages(response, controller)) {
          if (done)
            continue;
          if (sse2.data.startsWith("[DONE]")) {
            done = true;
            continue;
          }
          if (sse2.event === null || !sse2.event.startsWith("thread.")) {
            let data;
            try {
              data = JSON.parse(sse2.data);
            } catch (e) {
              logger4.error(`Could not parse message into JSON:`, sse2.data);
              logger4.error(`From chunk:`, sse2.raw);
              throw e;
            }
            if (data && data.error) {
              throw new APIError(void 0, data.error, void 0, response.headers);
            }
            yield synthesizeEventData ? { event: sse2.event, data } : data;
          } else {
            let data;
            try {
              data = JSON.parse(sse2.data);
            } catch (e) {
              console.error(`Could not parse message into JSON:`, sse2.data);
              console.error(`From chunk:`, sse2.raw);
              throw e;
            }
            if (sse2.event == "error") {
              throw new APIError(void 0, data.error, data.message, void 0);
            }
            yield { event: sse2.event, data };
          }
        }
        done = true;
      } catch (e) {
        if (isAbortError2(e))
          return;
        throw e;
      } finally {
        if (!done)
          controller.abort();
      }
    }
    return new _Stream(iterator, controller, client);
  }
  /**
   * Generates a Stream from a newline-separated ReadableStream
   * where each item is a JSON value.
   */
  static fromReadableStream(readableStream, controller, client) {
    let consumed = false;
    async function* iterLines() {
      const lineDecoder = new LineDecoder();
      const iter = ReadableStreamToAsyncIterable(readableStream);
      for await (const chunk of iter) {
        for (const line of lineDecoder.decode(chunk)) {
          yield line;
        }
      }
      for (const line of lineDecoder.flush()) {
        yield line;
      }
    }
    async function* iterator() {
      if (consumed) {
        throw new OpenAIError("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      }
      consumed = true;
      let done = false;
      try {
        for await (const line of iterLines()) {
          if (done)
            continue;
          if (line)
            yield JSON.parse(line);
        }
        done = true;
      } catch (e) {
        if (isAbortError2(e))
          return;
        throw e;
      } finally {
        if (!done)
          controller.abort();
      }
    }
    return new _Stream(iterator, controller, client);
  }
  [(_Stream_client = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
    return this.iterator();
  }
  /**
   * Splits the stream into two streams which can be
   * independently read from at different speeds.
   */
  tee() {
    const left = [];
    const right = [];
    const iterator = this.iterator();
    const teeIterator = (queue) => {
      return {
        next: () => {
          if (queue.length === 0) {
            const result = iterator.next();
            left.push(result);
            right.push(result);
          }
          return queue.shift();
        }
      };
    };
    return [
      new _Stream(() => teeIterator(left), this.controller, __classPrivateFieldGet3(this, _Stream_client, "f")),
      new _Stream(() => teeIterator(right), this.controller, __classPrivateFieldGet3(this, _Stream_client, "f"))
    ];
  }
  /**
   * Converts this stream to a newline-separated ReadableStream of
   * JSON stringified values in the stream
   * which can be turned back into a Stream with `Stream.fromReadableStream()`.
   */
  toReadableStream() {
    const self = this;
    let iter;
    return makeReadableStream({
      async start() {
        iter = self[Symbol.asyncIterator]();
      },
      async pull(ctrl) {
        try {
          const { value, done } = await iter.next();
          if (done)
            return ctrl.close();
          const bytes = encodeUTF8(JSON.stringify(value) + "\n");
          ctrl.enqueue(bytes);
        } catch (err) {
          ctrl.error(err);
        }
      },
      async cancel() {
        await iter.return?.();
      }
    });
  }
};
async function* _iterSSEMessages(response, controller) {
  if (!response.body) {
    controller.abort();
    if (typeof globalThis.navigator !== "undefined" && globalThis.navigator.product === "ReactNative") {
      throw new OpenAIError(`The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api`);
    }
    throw new OpenAIError(`Attempted to iterate over a response with no body`);
  }
  const sseDecoder = new SSEDecoder();
  const lineDecoder = new LineDecoder();
  const iter = ReadableStreamToAsyncIterable(response.body);
  for await (const sseChunk of iterSSEChunks(iter)) {
    for (const line of lineDecoder.decode(sseChunk)) {
      const sse2 = sseDecoder.decode(line);
      if (sse2)
        yield sse2;
    }
  }
  for (const line of lineDecoder.flush()) {
    const sse2 = sseDecoder.decode(line);
    if (sse2)
      yield sse2;
  }
}
async function* iterSSEChunks(iterator) {
  let data = new Uint8Array();
  for await (const chunk of iterator) {
    if (chunk == null) {
      continue;
    }
    const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : typeof chunk === "string" ? encodeUTF8(chunk) : chunk;
    let newData = new Uint8Array(data.length + binaryChunk.length);
    newData.set(data);
    newData.set(binaryChunk, data.length);
    data = newData;
    let patternIndex;
    while ((patternIndex = findDoubleNewlineIndex(data)) !== -1) {
      yield data.slice(0, patternIndex);
      data = data.slice(patternIndex);
    }
  }
  if (data.length > 0) {
    yield data;
  }
}
var SSEDecoder = class {
  constructor() {
    this.event = null;
    this.data = [];
    this.chunks = [];
  }
  decode(line) {
    if (line.endsWith("\r")) {
      line = line.substring(0, line.length - 1);
    }
    if (!line) {
      if (!this.event && !this.data.length)
        return null;
      const sse2 = {
        event: this.event,
        data: this.data.join("\n"),
        raw: this.chunks
      };
      this.event = null;
      this.data = [];
      this.chunks = [];
      return sse2;
    }
    this.chunks.push(line);
    if (line.startsWith(":")) {
      return null;
    }
    let [fieldname, _, value] = partition(line, ":");
    if (value.startsWith(" ")) {
      value = value.substring(1);
    }
    if (fieldname === "event") {
      this.event = value;
    } else if (fieldname === "data") {
      this.data.push(value);
    }
    return null;
  }
};
function partition(str2, delimiter) {
  const index = str2.indexOf(delimiter);
  if (index !== -1) {
    return [str2.substring(0, index), delimiter, str2.substring(index + delimiter.length)];
  }
  return [str2, "", ""];
}

// ../../../node_modules/openai/internal/parse.mjs
async function defaultParseResponse(client, props) {
  const { response, requestLogID, retryOfRequestLogID, startTime } = props;
  const body = await (async () => {
    if (props.options.stream) {
      loggerFor(client).debug("response", response.status, response.url, response.headers, response.body);
      if (props.options.__streamClass) {
        return props.options.__streamClass.fromSSEResponse(response, props.controller, client, props.options.__synthesizeEventData);
      }
      return Stream.fromSSEResponse(response, props.controller, client, props.options.__synthesizeEventData);
    }
    if (response.status === 204) {
      return null;
    }
    if (props.options.__binaryResponse) {
      return response;
    }
    const contentType = response.headers.get("content-type");
    const mediaType = contentType?.split(";")[0]?.trim();
    const isJSON = mediaType?.includes("application/json") || mediaType?.endsWith("+json");
    if (isJSON) {
      const contentLength = response.headers.get("content-length");
      if (contentLength === "0") {
        return void 0;
      }
      const json2 = await response.json();
      return addRequestID(json2, response);
    }
    const text2 = await response.text();
    return text2;
  })();
  loggerFor(client).debug(`[${requestLogID}] response parsed`, formatRequestDetails({
    retryOfRequestLogID,
    url: response.url,
    status: response.status,
    body,
    durationMs: Date.now() - startTime
  }));
  return body;
}
function addRequestID(value, response) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.defineProperty(value, "_request_id", {
    value: response.headers.get("x-request-id"),
    enumerable: false
  });
}

// ../../../node_modules/openai/core/api-promise.mjs
var _APIPromise_client;
var APIPromise2 = class _APIPromise extends Promise {
  constructor(client, responsePromise, parseResponse2 = defaultParseResponse) {
    super((resolve) => {
      resolve(null);
    });
    this.responsePromise = responsePromise;
    this.parseResponse = parseResponse2;
    _APIPromise_client.set(this, void 0);
    __classPrivateFieldSet3(this, _APIPromise_client, client, "f");
  }
  _thenUnwrap(transform) {
    return new _APIPromise(__classPrivateFieldGet3(this, _APIPromise_client, "f"), this.responsePromise, async (client, props) => addRequestID(transform(await this.parseResponse(client, props), props), props.response));
  }
  /**
   * Gets the raw `Response` instance instead of parsing the response
   * data.
   *
   * If you want to parse the response body but still get the `Response`
   * instance, you can use {@link withResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  asResponse() {
    return this.responsePromise.then((p) => p.response);
  }
  /**
   * Gets the parsed response data, the raw `Response` instance and the ID of the request,
   * returned via the X-Request-ID header which is useful for debugging requests and reporting
   * issues to OpenAI.
   *
   * If you just want to get the raw `Response` instance without parsing it,
   * you can use {@link asResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  async withResponse() {
    const [data, response] = await Promise.all([this.parse(), this.asResponse()]);
    return { data, response, request_id: response.headers.get("x-request-id") };
  }
  parse() {
    if (!this.parsedPromise) {
      this.parsedPromise = this.responsePromise.then((data) => this.parseResponse(__classPrivateFieldGet3(this, _APIPromise_client, "f"), data));
    }
    return this.parsedPromise;
  }
  then(onfulfilled, onrejected) {
    return this.parse().then(onfulfilled, onrejected);
  }
  catch(onrejected) {
    return this.parse().catch(onrejected);
  }
  finally(onfinally) {
    return this.parse().finally(onfinally);
  }
};
_APIPromise_client = /* @__PURE__ */ new WeakMap();

// ../../../node_modules/openai/core/pagination.mjs
var _AbstractPage_client;
var AbstractPage = class {
  constructor(client, response, body, options) {
    _AbstractPage_client.set(this, void 0);
    __classPrivateFieldSet3(this, _AbstractPage_client, client, "f");
    this.options = options;
    this.response = response;
    this.body = body;
  }
  hasNextPage() {
    const items = this.getPaginatedItems();
    if (!items.length)
      return false;
    return this.nextPageRequestOptions() != null;
  }
  async getNextPage() {
    const nextOptions = this.nextPageRequestOptions();
    if (!nextOptions) {
      throw new OpenAIError("No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.");
    }
    return await __classPrivateFieldGet3(this, _AbstractPage_client, "f").requestAPIList(this.constructor, nextOptions);
  }
  async *iterPages() {
    let page = this;
    yield page;
    while (page.hasNextPage()) {
      page = await page.getNextPage();
      yield page;
    }
  }
  async *[(_AbstractPage_client = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
    for await (const page of this.iterPages()) {
      for (const item of page.getPaginatedItems()) {
        yield item;
      }
    }
  }
};
var PagePromise = class extends APIPromise2 {
  constructor(client, request, Page2) {
    super(client, request, async (client2, props) => new Page2(client2, props.response, await defaultParseResponse(client2, props), props.options));
  }
  /**
   * Allow auto-paginating iteration on an unawaited list call, eg:
   *
   *    for await (const item of client.items.list()) {
   *      console.log(item)
   *    }
   */
  async *[Symbol.asyncIterator]() {
    const page = await this;
    for await (const item of page) {
      yield item;
    }
  }
};
var Page = class extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.object = body.object;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  nextPageRequestOptions() {
    return null;
  }
};
var CursorPage = class extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.has_more = body.has_more || false;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  hasNextPage() {
    if (this.has_more === false) {
      return false;
    }
    return super.hasNextPage();
  }
  nextPageRequestOptions() {
    const data = this.getPaginatedItems();
    const id = data[data.length - 1]?.id;
    if (!id) {
      return null;
    }
    return {
      ...this.options,
      query: {
        ...maybeObj(this.options.query),
        after: id
      }
    };
  }
};
var ConversationCursorPage = class extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.has_more = body.has_more || false;
    this.last_id = body.last_id || "";
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  hasNextPage() {
    if (this.has_more === false) {
      return false;
    }
    return super.hasNextPage();
  }
  nextPageRequestOptions() {
    const cursor = this.last_id;
    if (!cursor) {
      return null;
    }
    return {
      ...this.options,
      query: {
        ...maybeObj(this.options.query),
        after: cursor
      }
    };
  }
};

// ../../../node_modules/openai/internal/uploads.mjs
var checkFileSupport = () => {
  if (typeof File === "undefined") {
    const { process: process2 } = globalThis;
    const isOldNode = typeof process2?.versions?.node === "string" && parseInt(process2.versions.node.split(".")) < 20;
    throw new Error("`File` is not defined as a global, which is required for file uploads." + (isOldNode ? " Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`." : ""));
  }
};
function makeFile(fileBits, fileName, options) {
  checkFileSupport();
  return new File(fileBits, fileName ?? "unknown_file", options);
}
function getName(value) {
  return (typeof value === "object" && value !== null && ("name" in value && value.name && String(value.name) || "url" in value && value.url && String(value.url) || "filename" in value && value.filename && String(value.filename) || "path" in value && value.path && String(value.path)) || "").split(/[\\/]/).pop() || void 0;
}
var isAsyncIterable = (value) => value != null && typeof value === "object" && typeof value[Symbol.asyncIterator] === "function";
var maybeMultipartFormRequestOptions = async (opts, fetch2) => {
  if (!hasUploadableValue(opts.body))
    return opts;
  return { ...opts, body: await createForm(opts.body, fetch2) };
};
var multipartFormRequestOptions = async (opts, fetch2) => {
  return { ...opts, body: await createForm(opts.body, fetch2) };
};
var supportsFormDataMap = /* @__PURE__ */ new WeakMap();
function supportsFormData(fetchObject) {
  const fetch2 = typeof fetchObject === "function" ? fetchObject : fetchObject.fetch;
  const cached = supportsFormDataMap.get(fetch2);
  if (cached)
    return cached;
  const promise = (async () => {
    try {
      const FetchResponse = "Response" in fetch2 ? fetch2.Response : (await fetch2("data:,")).constructor;
      const data = new FormData();
      if (data.toString() === await new FetchResponse(data).text()) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  })();
  supportsFormDataMap.set(fetch2, promise);
  return promise;
}
var createForm = async (body, fetch2) => {
  if (!await supportsFormData(fetch2)) {
    throw new TypeError("The provided fetch function does not support file uploads with the current global FormData class.");
  }
  const form = new FormData();
  await Promise.all(Object.entries(body || {}).map(([key, value]) => addFormValue(form, key, value)));
  return form;
};
var isNamedBlob = (value) => value instanceof Blob && "name" in value;
var isUploadable = (value) => typeof value === "object" && value !== null && (value instanceof Response || isAsyncIterable(value) || isNamedBlob(value));
var hasUploadableValue = (value) => {
  if (isUploadable(value))
    return true;
  if (Array.isArray(value))
    return value.some(hasUploadableValue);
  if (value && typeof value === "object") {
    for (const k in value) {
      if (hasUploadableValue(value[k]))
        return true;
    }
  }
  return false;
};
var addFormValue = async (form, key, value) => {
  if (value === void 0)
    return;
  if (value == null) {
    throw new TypeError(`Received null for "${key}"; to pass null in FormData, you must use the string 'null'`);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    form.append(key, String(value));
  } else if (value instanceof Response) {
    form.append(key, makeFile([await value.blob()], getName(value)));
  } else if (isAsyncIterable(value)) {
    form.append(key, makeFile([await new Response(ReadableStreamFrom(value)).blob()], getName(value)));
  } else if (isNamedBlob(value)) {
    form.append(key, value, getName(value));
  } else if (Array.isArray(value)) {
    await Promise.all(value.map((entry) => addFormValue(form, key + "[]", entry)));
  } else if (typeof value === "object") {
    await Promise.all(Object.entries(value).map(([name, prop]) => addFormValue(form, `${key}[${name}]`, prop)));
  } else {
    throw new TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`);
  }
};

// ../../../node_modules/openai/internal/to-file.mjs
var isBlobLike = (value) => value != null && typeof value === "object" && typeof value.size === "number" && typeof value.type === "string" && typeof value.text === "function" && typeof value.slice === "function" && typeof value.arrayBuffer === "function";
var isFileLike = (value) => value != null && typeof value === "object" && typeof value.name === "string" && typeof value.lastModified === "number" && isBlobLike(value);
var isResponseLike = (value) => value != null && typeof value === "object" && typeof value.url === "string" && typeof value.blob === "function";
async function toFile(value, name, options) {
  checkFileSupport();
  value = await value;
  if (isFileLike(value)) {
    if (value instanceof File) {
      return value;
    }
    return makeFile([await value.arrayBuffer()], value.name);
  }
  if (isResponseLike(value)) {
    const blob = await value.blob();
    name || (name = new URL(value.url).pathname.split(/[\\/]/).pop());
    return makeFile(await getBytes(blob), name, options);
  }
  const parts = await getBytes(value);
  name || (name = getName(value));
  if (!options?.type) {
    const type = parts.find((part) => typeof part === "object" && "type" in part && part.type);
    if (typeof type === "string") {
      options = { ...options, type };
    }
  }
  return makeFile(parts, name, options);
}
async function getBytes(value) {
  let parts = [];
  if (typeof value === "string" || ArrayBuffer.isView(value) || // includes Uint8Array, Buffer, etc.
  value instanceof ArrayBuffer) {
    parts.push(value);
  } else if (isBlobLike(value)) {
    parts.push(value instanceof Blob ? value : await value.arrayBuffer());
  } else if (isAsyncIterable(value)) {
    for await (const chunk of value) {
      parts.push(...await getBytes(chunk));
    }
  } else {
    const constructor = value?.constructor?.name;
    throw new Error(`Unexpected data type: ${typeof value}${constructor ? `; constructor: ${constructor}` : ""}${propsForError(value)}`);
  }
  return parts;
}
function propsForError(value) {
  if (typeof value !== "object" || value === null)
    return "";
  const props = Object.getOwnPropertyNames(value);
  return `; props: [${props.map((p) => `"${p}"`).join(", ")}]`;
}

// ../../../node_modules/openai/core/resource.mjs
var APIResource = class {
  constructor(client) {
    this._client = client;
  }
};

// ../../../node_modules/openai/internal/utils/path.mjs
function encodeURIPath(str2) {
  return str2.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}
var EMPTY = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.create(null));
var createPathTagFunction = (pathEncoder = encodeURIPath) => function path2(statics, ...params) {
  if (statics.length === 1)
    return statics[0];
  let postPath = false;
  const invalidSegments = [];
  const path3 = statics.reduce((previousValue, currentValue, index) => {
    if (/[?#]/.test(currentValue)) {
      postPath = true;
    }
    const value = params[index];
    let encoded = (postPath ? encodeURIComponent : pathEncoder)("" + value);
    if (index !== params.length && (value == null || typeof value === "object" && // handle values from other realms
    value.toString === Object.getPrototypeOf(Object.getPrototypeOf(value.hasOwnProperty ?? EMPTY) ?? EMPTY)?.toString)) {
      encoded = value + "";
      invalidSegments.push({
        start: previousValue.length + currentValue.length,
        length: encoded.length,
        error: `Value of type ${Object.prototype.toString.call(value).slice(8, -1)} is not a valid path parameter`
      });
    }
    return previousValue + currentValue + (index === params.length ? "" : encoded);
  }, "");
  const pathOnly = path3.split(/[?#]/, 1)[0];
  const invalidSegmentPattern = /(?<=^|\/)(?:\.|%2e){1,2}(?=\/|$)/gi;
  let match2;
  while ((match2 = invalidSegmentPattern.exec(pathOnly)) !== null) {
    invalidSegments.push({
      start: match2.index,
      length: match2[0].length,
      error: `Value "${match2[0]}" can't be safely passed as a path parameter`
    });
  }
  invalidSegments.sort((a, b) => a.start - b.start);
  if (invalidSegments.length > 0) {
    let lastEnd = 0;
    const underline = invalidSegments.reduce((acc, segment) => {
      const spaces = " ".repeat(segment.start - lastEnd);
      const arrows = "^".repeat(segment.length);
      lastEnd = segment.start + segment.length;
      return acc + spaces + arrows;
    }, "");
    throw new OpenAIError(`Path parameters result in path with invalid segments:
${invalidSegments.map((e) => e.error).join("\n")}
${path3}
${underline}`);
  }
  return path3;
};
var path = /* @__PURE__ */ createPathTagFunction(encodeURIPath);

// ../../../node_modules/openai/resources/chat/completions/messages.mjs
var Messages = class extends APIResource {
  /**
   * Get the messages in a stored chat completion. Only Chat Completions that have
   * been created with the `store` parameter set to `true` will be returned.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const chatCompletionStoreMessage of client.chat.completions.messages.list(
   *   'completion_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(completionID, query = {}, options) {
    return this._client.getAPIList(path`/chat/completions/${completionID}/messages`, CursorPage, { query, ...options });
  }
};

// ../../../node_modules/openai/lib/parser.mjs
function isChatCompletionFunctionTool(tool) {
  return tool !== void 0 && "function" in tool && tool.function !== void 0;
}
function isAutoParsableResponseFormat(response_format) {
  return response_format?.["$brand"] === "auto-parseable-response-format";
}
function isAutoParsableTool(tool) {
  return tool?.["$brand"] === "auto-parseable-tool";
}
function maybeParseChatCompletion(completion, params) {
  if (!params || !hasAutoParseableInput(params)) {
    return {
      ...completion,
      choices: completion.choices.map((choice) => {
        assertToolCallsAreChatCompletionFunctionToolCalls(choice.message.tool_calls);
        return {
          ...choice,
          message: {
            ...choice.message,
            parsed: null,
            ...choice.message.tool_calls ? {
              tool_calls: choice.message.tool_calls
            } : void 0
          }
        };
      })
    };
  }
  return parseChatCompletion(completion, params);
}
function parseChatCompletion(completion, params) {
  const choices = completion.choices.map((choice) => {
    if (choice.finish_reason === "length") {
      throw new LengthFinishReasonError();
    }
    if (choice.finish_reason === "content_filter") {
      throw new ContentFilterFinishReasonError();
    }
    assertToolCallsAreChatCompletionFunctionToolCalls(choice.message.tool_calls);
    return {
      ...choice,
      message: {
        ...choice.message,
        ...choice.message.tool_calls ? {
          tool_calls: choice.message.tool_calls?.map((toolCall) => parseToolCall(params, toolCall)) ?? void 0
        } : void 0,
        parsed: choice.message.content && !choice.message.refusal ? parseResponseFormat(params, choice.message.content) : null
      }
    };
  });
  return { ...completion, choices };
}
function parseResponseFormat(params, content) {
  if (params.response_format?.type !== "json_schema") {
    return null;
  }
  if (params.response_format?.type === "json_schema") {
    if ("$parseRaw" in params.response_format) {
      const response_format = params.response_format;
      return response_format.$parseRaw(content);
    }
    return JSON.parse(content);
  }
  return null;
}
function parseToolCall(params, toolCall) {
  const inputTool = params.tools?.find((inputTool2) => isChatCompletionFunctionTool(inputTool2) && inputTool2.function?.name === toolCall.function.name);
  return {
    ...toolCall,
    function: {
      ...toolCall.function,
      parsed_arguments: isAutoParsableTool(inputTool) ? inputTool.$parseRaw(toolCall.function.arguments) : inputTool?.function.strict ? JSON.parse(toolCall.function.arguments) : null
    }
  };
}
function shouldParseToolCall(params, toolCall) {
  if (!params || !("tools" in params) || !params.tools) {
    return false;
  }
  const inputTool = params.tools?.find((inputTool2) => isChatCompletionFunctionTool(inputTool2) && inputTool2.function?.name === toolCall.function.name);
  return isChatCompletionFunctionTool(inputTool) && (isAutoParsableTool(inputTool) || inputTool?.function.strict || false);
}
function hasAutoParseableInput(params) {
  if (isAutoParsableResponseFormat(params.response_format)) {
    return true;
  }
  return params.tools?.some((t) => isAutoParsableTool(t) || t.type === "function" && t.function.strict === true) ?? false;
}
function assertToolCallsAreChatCompletionFunctionToolCalls(toolCalls) {
  for (const toolCall of toolCalls || []) {
    if (toolCall.type !== "function") {
      throw new OpenAIError(`Currently only \`function\` tool calls are supported; Received \`${toolCall.type}\``);
    }
  }
}
function validateInputTools(tools) {
  for (const tool of tools ?? []) {
    if (tool.type !== "function") {
      throw new OpenAIError(`Currently only \`function\` tool types support auto-parsing; Received \`${tool.type}\``);
    }
    if (tool.function.strict !== true) {
      throw new OpenAIError(`The \`${tool.function.name}\` tool is not marked with \`strict: true\`. Only strict function tools can be auto-parsed`);
    }
  }
}

// ../../../node_modules/openai/lib/chatCompletionUtils.mjs
var isAssistantMessage2 = (message) => {
  return message?.role === "assistant";
};
var isToolMessage = (message) => {
  return message?.role === "tool";
};

// ../../../node_modules/openai/lib/EventStream.mjs
var _EventStream_instances;
var _EventStream_connectedPromise;
var _EventStream_resolveConnectedPromise;
var _EventStream_rejectConnectedPromise;
var _EventStream_endPromise;
var _EventStream_resolveEndPromise;
var _EventStream_rejectEndPromise;
var _EventStream_listeners;
var _EventStream_ended;
var _EventStream_errored;
var _EventStream_aborted;
var _EventStream_catchingPromiseCreated;
var _EventStream_handleError;
var EventStream2 = class {
  constructor() {
    _EventStream_instances.add(this);
    this.controller = new AbortController();
    _EventStream_connectedPromise.set(this, void 0);
    _EventStream_resolveConnectedPromise.set(this, () => {
    });
    _EventStream_rejectConnectedPromise.set(this, () => {
    });
    _EventStream_endPromise.set(this, void 0);
    _EventStream_resolveEndPromise.set(this, () => {
    });
    _EventStream_rejectEndPromise.set(this, () => {
    });
    _EventStream_listeners.set(this, {});
    _EventStream_ended.set(this, false);
    _EventStream_errored.set(this, false);
    _EventStream_aborted.set(this, false);
    _EventStream_catchingPromiseCreated.set(this, false);
    __classPrivateFieldSet3(this, _EventStream_connectedPromise, new Promise((resolve, reject) => {
      __classPrivateFieldSet3(this, _EventStream_resolveConnectedPromise, resolve, "f");
      __classPrivateFieldSet3(this, _EventStream_rejectConnectedPromise, reject, "f");
    }), "f");
    __classPrivateFieldSet3(this, _EventStream_endPromise, new Promise((resolve, reject) => {
      __classPrivateFieldSet3(this, _EventStream_resolveEndPromise, resolve, "f");
      __classPrivateFieldSet3(this, _EventStream_rejectEndPromise, reject, "f");
    }), "f");
    __classPrivateFieldGet3(this, _EventStream_connectedPromise, "f").catch(() => {
    });
    __classPrivateFieldGet3(this, _EventStream_endPromise, "f").catch(() => {
    });
  }
  _run(executor) {
    setTimeout(() => {
      executor().then(() => {
        this._emitFinal();
        this._emit("end");
      }, __classPrivateFieldGet3(this, _EventStream_instances, "m", _EventStream_handleError).bind(this));
    }, 0);
  }
  _connected() {
    if (this.ended)
      return;
    __classPrivateFieldGet3(this, _EventStream_resolveConnectedPromise, "f").call(this);
    this._emit("connect");
  }
  get ended() {
    return __classPrivateFieldGet3(this, _EventStream_ended, "f");
  }
  get errored() {
    return __classPrivateFieldGet3(this, _EventStream_errored, "f");
  }
  get aborted() {
    return __classPrivateFieldGet3(this, _EventStream_aborted, "f");
  }
  abort() {
    this.controller.abort();
  }
  /**
   * Adds the listener function to the end of the listeners array for the event.
   * No checks are made to see if the listener has already been added. Multiple calls passing
   * the same combination of event and listener will result in the listener being added, and
   * called, multiple times.
   * @returns this ChatCompletionStream, so that calls can be chained
   */
  on(event, listener) {
    const listeners = __classPrivateFieldGet3(this, _EventStream_listeners, "f")[event] || (__classPrivateFieldGet3(this, _EventStream_listeners, "f")[event] = []);
    listeners.push({ listener });
    return this;
  }
  /**
   * Removes the specified listener from the listener array for the event.
   * off() will remove, at most, one instance of a listener from the listener array. If any single
   * listener has been added multiple times to the listener array for the specified event, then
   * off() must be called multiple times to remove each instance.
   * @returns this ChatCompletionStream, so that calls can be chained
   */
  off(event, listener) {
    const listeners = __classPrivateFieldGet3(this, _EventStream_listeners, "f")[event];
    if (!listeners)
      return this;
    const index = listeners.findIndex((l) => l.listener === listener);
    if (index >= 0)
      listeners.splice(index, 1);
    return this;
  }
  /**
   * Adds a one-time listener function for the event. The next time the event is triggered,
   * this listener is removed and then invoked.
   * @returns this ChatCompletionStream, so that calls can be chained
   */
  once(event, listener) {
    const listeners = __classPrivateFieldGet3(this, _EventStream_listeners, "f")[event] || (__classPrivateFieldGet3(this, _EventStream_listeners, "f")[event] = []);
    listeners.push({ listener, once: true });
    return this;
  }
  /**
   * This is similar to `.once()`, but returns a Promise that resolves the next time
   * the event is triggered, instead of calling a listener callback.
   * @returns a Promise that resolves the next time given event is triggered,
   * or rejects if an error is emitted.  (If you request the 'error' event,
   * returns a promise that resolves with the error).
   *
   * Example:
   *
   *   const message = await stream.emitted('message') // rejects if the stream errors
   */
  emitted(event) {
    return new Promise((resolve, reject) => {
      __classPrivateFieldSet3(this, _EventStream_catchingPromiseCreated, true, "f");
      if (event !== "error")
        this.once("error", reject);
      this.once(event, resolve);
    });
  }
  async done() {
    __classPrivateFieldSet3(this, _EventStream_catchingPromiseCreated, true, "f");
    await __classPrivateFieldGet3(this, _EventStream_endPromise, "f");
  }
  _emit(event, ...args) {
    if (__classPrivateFieldGet3(this, _EventStream_ended, "f")) {
      return;
    }
    if (event === "end") {
      __classPrivateFieldSet3(this, _EventStream_ended, true, "f");
      __classPrivateFieldGet3(this, _EventStream_resolveEndPromise, "f").call(this);
    }
    const listeners = __classPrivateFieldGet3(this, _EventStream_listeners, "f")[event];
    if (listeners) {
      __classPrivateFieldGet3(this, _EventStream_listeners, "f")[event] = listeners.filter((l) => !l.once);
      listeners.forEach(({ listener }) => listener(...args));
    }
    if (event === "abort") {
      const error = args[0];
      if (!__classPrivateFieldGet3(this, _EventStream_catchingPromiseCreated, "f") && !listeners?.length) {
        Promise.reject(error);
      }
      __classPrivateFieldGet3(this, _EventStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet3(this, _EventStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
      return;
    }
    if (event === "error") {
      const error = args[0];
      if (!__classPrivateFieldGet3(this, _EventStream_catchingPromiseCreated, "f") && !listeners?.length) {
        Promise.reject(error);
      }
      __classPrivateFieldGet3(this, _EventStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet3(this, _EventStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
    }
  }
  _emitFinal() {
  }
};
_EventStream_connectedPromise = /* @__PURE__ */ new WeakMap(), _EventStream_resolveConnectedPromise = /* @__PURE__ */ new WeakMap(), _EventStream_rejectConnectedPromise = /* @__PURE__ */ new WeakMap(), _EventStream_endPromise = /* @__PURE__ */ new WeakMap(), _EventStream_resolveEndPromise = /* @__PURE__ */ new WeakMap(), _EventStream_rejectEndPromise = /* @__PURE__ */ new WeakMap(), _EventStream_listeners = /* @__PURE__ */ new WeakMap(), _EventStream_ended = /* @__PURE__ */ new WeakMap(), _EventStream_errored = /* @__PURE__ */ new WeakMap(), _EventStream_aborted = /* @__PURE__ */ new WeakMap(), _EventStream_catchingPromiseCreated = /* @__PURE__ */ new WeakMap(), _EventStream_instances = /* @__PURE__ */ new WeakSet(), _EventStream_handleError = function _EventStream_handleError2(error) {
  __classPrivateFieldSet3(this, _EventStream_errored, true, "f");
  if (error instanceof Error && error.name === "AbortError") {
    error = new APIUserAbortError();
  }
  if (error instanceof APIUserAbortError) {
    __classPrivateFieldSet3(this, _EventStream_aborted, true, "f");
    return this._emit("abort", error);
  }
  if (error instanceof OpenAIError) {
    return this._emit("error", error);
  }
  if (error instanceof Error) {
    const openAIError = new OpenAIError(error.message);
    openAIError.cause = error;
    return this._emit("error", openAIError);
  }
  return this._emit("error", new OpenAIError(String(error)));
};

// ../../../node_modules/openai/lib/RunnableFunction.mjs
function isRunnableFunctionWithParse(fn) {
  return typeof fn.parse === "function";
}

// ../../../node_modules/openai/lib/AbstractChatCompletionRunner.mjs
var _AbstractChatCompletionRunner_instances;
var _AbstractChatCompletionRunner_getFinalContent;
var _AbstractChatCompletionRunner_getFinalMessage;
var _AbstractChatCompletionRunner_getFinalFunctionToolCall;
var _AbstractChatCompletionRunner_getFinalFunctionToolCallResult;
var _AbstractChatCompletionRunner_calculateTotalUsage;
var _AbstractChatCompletionRunner_validateParams;
var _AbstractChatCompletionRunner_stringifyFunctionCallResult;
var DEFAULT_MAX_CHAT_COMPLETIONS = 10;
var AbstractChatCompletionRunner = class extends EventStream2 {
  constructor() {
    super(...arguments);
    _AbstractChatCompletionRunner_instances.add(this);
    this._chatCompletions = [];
    this.messages = [];
  }
  _addChatCompletion(chatCompletion) {
    this._chatCompletions.push(chatCompletion);
    this._emit("chatCompletion", chatCompletion);
    const message = chatCompletion.choices[0]?.message;
    if (message)
      this._addMessage(message);
    return chatCompletion;
  }
  _addMessage(message, emit = true) {
    if (!("content" in message))
      message.content = null;
    this.messages.push(message);
    if (emit) {
      this._emit("message", message);
      if (isToolMessage(message) && message.content) {
        this._emit("functionToolCallResult", message.content);
      } else if (isAssistantMessage2(message) && message.tool_calls) {
        for (const tool_call of message.tool_calls) {
          if (tool_call.type === "function") {
            this._emit("functionToolCall", tool_call.function);
          }
        }
      }
    }
  }
  /**
   * @returns a promise that resolves with the final ChatCompletion, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletion.
   */
  async finalChatCompletion() {
    await this.done();
    const completion = this._chatCompletions[this._chatCompletions.length - 1];
    if (!completion)
      throw new OpenAIError("stream ended without producing a ChatCompletion");
    return completion;
  }
  /**
   * @returns a promise that resolves with the content of the final ChatCompletionMessage, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalContent() {
    await this.done();
    return __classPrivateFieldGet3(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalContent).call(this);
  }
  /**
   * @returns a promise that resolves with the the final assistant ChatCompletionMessage response,
   * or rejects if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalMessage() {
    await this.done();
    return __classPrivateFieldGet3(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this);
  }
  /**
   * @returns a promise that resolves with the content of the final FunctionCall, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalFunctionToolCall() {
    await this.done();
    return __classPrivateFieldGet3(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCall).call(this);
  }
  async finalFunctionToolCallResult() {
    await this.done();
    return __classPrivateFieldGet3(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCallResult).call(this);
  }
  async totalUsage() {
    await this.done();
    return __classPrivateFieldGet3(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_calculateTotalUsage).call(this);
  }
  allChatCompletions() {
    return [...this._chatCompletions];
  }
  _emitFinal() {
    const completion = this._chatCompletions[this._chatCompletions.length - 1];
    if (completion)
      this._emit("finalChatCompletion", completion);
    const finalMessage = __classPrivateFieldGet3(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this);
    if (finalMessage)
      this._emit("finalMessage", finalMessage);
    const finalContent = __classPrivateFieldGet3(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalContent).call(this);
    if (finalContent)
      this._emit("finalContent", finalContent);
    const finalFunctionCall = __classPrivateFieldGet3(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCall).call(this);
    if (finalFunctionCall)
      this._emit("finalFunctionToolCall", finalFunctionCall);
    const finalFunctionCallResult = __classPrivateFieldGet3(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCallResult).call(this);
    if (finalFunctionCallResult != null)
      this._emit("finalFunctionToolCallResult", finalFunctionCallResult);
    if (this._chatCompletions.some((c) => c.usage)) {
      this._emit("totalUsage", __classPrivateFieldGet3(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_calculateTotalUsage).call(this));
    }
  }
  async _createChatCompletion(client, params, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    __classPrivateFieldGet3(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_validateParams).call(this, params);
    const chatCompletion = await client.chat.completions.create({ ...params, stream: false }, { ...options, signal: this.controller.signal });
    this._connected();
    return this._addChatCompletion(parseChatCompletion(chatCompletion, params));
  }
  async _runChatCompletion(client, params, options) {
    for (const message of params.messages) {
      this._addMessage(message, false);
    }
    return await this._createChatCompletion(client, params, options);
  }
  async _runTools(client, params, options) {
    const role = "tool";
    const { tool_choice = "auto", stream, ...restParams } = params;
    const singleFunctionToCall = typeof tool_choice !== "string" && tool_choice.type === "function" && tool_choice?.function?.name;
    const { maxChatCompletions = DEFAULT_MAX_CHAT_COMPLETIONS } = options || {};
    const inputTools = params.tools.map((tool) => {
      if (isAutoParsableTool(tool)) {
        if (!tool.$callback) {
          throw new OpenAIError("Tool given to `.runTools()` that does not have an associated function");
        }
        return {
          type: "function",
          function: {
            function: tool.$callback,
            name: tool.function.name,
            description: tool.function.description || "",
            parameters: tool.function.parameters,
            parse: tool.$parseRaw,
            strict: true
          }
        };
      }
      return tool;
    });
    const functionsByName = {};
    for (const f of inputTools) {
      if (f.type === "function") {
        functionsByName[f.function.name || f.function.function.name] = f.function;
      }
    }
    const tools = "tools" in params ? inputTools.map((t) => t.type === "function" ? {
      type: "function",
      function: {
        name: t.function.name || t.function.function.name,
        parameters: t.function.parameters,
        description: t.function.description,
        strict: t.function.strict
      }
    } : t) : void 0;
    for (const message of params.messages) {
      this._addMessage(message, false);
    }
    for (let i = 0; i < maxChatCompletions; ++i) {
      const chatCompletion = await this._createChatCompletion(client, {
        ...restParams,
        tool_choice,
        tools,
        messages: [...this.messages]
      }, options);
      const message = chatCompletion.choices[0]?.message;
      if (!message) {
        throw new OpenAIError(`missing message in ChatCompletion response`);
      }
      if (!message.tool_calls?.length) {
        return;
      }
      for (const tool_call of message.tool_calls) {
        if (tool_call.type !== "function")
          continue;
        const tool_call_id = tool_call.id;
        const { name, arguments: args } = tool_call.function;
        const fn = functionsByName[name];
        if (!fn) {
          const content2 = `Invalid tool_call: ${JSON.stringify(name)}. Available options are: ${Object.keys(functionsByName).map((name2) => JSON.stringify(name2)).join(", ")}. Please try again`;
          this._addMessage({ role, tool_call_id, content: content2 });
          continue;
        } else if (singleFunctionToCall && singleFunctionToCall !== name) {
          const content2 = `Invalid tool_call: ${JSON.stringify(name)}. ${JSON.stringify(singleFunctionToCall)} requested. Please try again`;
          this._addMessage({ role, tool_call_id, content: content2 });
          continue;
        }
        let parsed;
        try {
          parsed = isRunnableFunctionWithParse(fn) ? await fn.parse(args) : args;
        } catch (error) {
          const content2 = error instanceof Error ? error.message : String(error);
          this._addMessage({ role, tool_call_id, content: content2 });
          continue;
        }
        const rawContent = await fn.function(parsed, this);
        const content = __classPrivateFieldGet3(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_stringifyFunctionCallResult).call(this, rawContent);
        this._addMessage({ role, tool_call_id, content });
        if (singleFunctionToCall) {
          return;
        }
      }
    }
    return;
  }
};
_AbstractChatCompletionRunner_instances = /* @__PURE__ */ new WeakSet(), _AbstractChatCompletionRunner_getFinalContent = function _AbstractChatCompletionRunner_getFinalContent2() {
  return __classPrivateFieldGet3(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this).content ?? null;
}, _AbstractChatCompletionRunner_getFinalMessage = function _AbstractChatCompletionRunner_getFinalMessage2() {
  let i = this.messages.length;
  while (i-- > 0) {
    const message = this.messages[i];
    if (isAssistantMessage2(message)) {
      const ret = {
        ...message,
        content: message.content ?? null,
        refusal: message.refusal ?? null
      };
      return ret;
    }
  }
  throw new OpenAIError("stream ended without producing a ChatCompletionMessage with role=assistant");
}, _AbstractChatCompletionRunner_getFinalFunctionToolCall = function _AbstractChatCompletionRunner_getFinalFunctionToolCall2() {
  for (let i = this.messages.length - 1; i >= 0; i--) {
    const message = this.messages[i];
    if (isAssistantMessage2(message) && message?.tool_calls?.length) {
      return message.tool_calls.filter((x) => x.type === "function").at(-1)?.function;
    }
  }
  return;
}, _AbstractChatCompletionRunner_getFinalFunctionToolCallResult = function _AbstractChatCompletionRunner_getFinalFunctionToolCallResult2() {
  for (let i = this.messages.length - 1; i >= 0; i--) {
    const message = this.messages[i];
    if (isToolMessage(message) && message.content != null && typeof message.content === "string" && this.messages.some((x) => x.role === "assistant" && x.tool_calls?.some((y) => y.type === "function" && y.id === message.tool_call_id))) {
      return message.content;
    }
  }
  return;
}, _AbstractChatCompletionRunner_calculateTotalUsage = function _AbstractChatCompletionRunner_calculateTotalUsage2() {
  const total = {
    completion_tokens: 0,
    prompt_tokens: 0,
    total_tokens: 0
  };
  for (const { usage } of this._chatCompletions) {
    if (usage) {
      total.completion_tokens += usage.completion_tokens;
      total.prompt_tokens += usage.prompt_tokens;
      total.total_tokens += usage.total_tokens;
    }
  }
  return total;
}, _AbstractChatCompletionRunner_validateParams = function _AbstractChatCompletionRunner_validateParams2(params) {
  if (params.n != null && params.n > 1) {
    throw new OpenAIError("ChatCompletion convenience helpers only support n=1 at this time. To use n>1, please use chat.completions.create() directly.");
  }
}, _AbstractChatCompletionRunner_stringifyFunctionCallResult = function _AbstractChatCompletionRunner_stringifyFunctionCallResult2(rawContent) {
  return typeof rawContent === "string" ? rawContent : rawContent === void 0 ? "undefined" : JSON.stringify(rawContent);
};

// ../../../node_modules/openai/lib/ChatCompletionRunner.mjs
var ChatCompletionRunner = class _ChatCompletionRunner extends AbstractChatCompletionRunner {
  static runTools(client, params, options) {
    const runner = new _ChatCompletionRunner();
    const opts = {
      ...options,
      headers: { ...options?.headers, "X-Stainless-Helper-Method": "runTools" }
    };
    runner._run(() => runner._runTools(client, params, opts));
    return runner;
  }
  _addMessage(message, emit = true) {
    super._addMessage(message, emit);
    if (isAssistantMessage2(message) && message.content) {
      this._emit("content", message.content);
    }
  }
};

// ../../../node_modules/openai/_vendor/partial-json-parser/parser.mjs
var STR = 1;
var NUM = 2;
var ARR = 4;
var OBJ = 8;
var NULL = 16;
var BOOL = 32;
var NAN = 64;
var INFINITY = 128;
var MINUS_INFINITY = 256;
var INF = INFINITY | MINUS_INFINITY;
var SPECIAL = NULL | BOOL | INF | NAN;
var ATOM = STR | NUM | SPECIAL;
var COLLECTION = ARR | OBJ;
var ALL = ATOM | COLLECTION;
var Allow = {
  STR,
  NUM,
  ARR,
  OBJ,
  NULL,
  BOOL,
  NAN,
  INFINITY,
  MINUS_INFINITY,
  INF,
  SPECIAL,
  ATOM,
  COLLECTION,
  ALL
};
var PartialJSON = class extends Error {
};
var MalformedJSON = class extends Error {
};
function parseJSON(jsonString, allowPartial = Allow.ALL) {
  if (typeof jsonString !== "string") {
    throw new TypeError(`expecting str, got ${typeof jsonString}`);
  }
  if (!jsonString.trim()) {
    throw new Error(`${jsonString} is empty`);
  }
  return _parseJSON(jsonString.trim(), allowPartial);
}
var _parseJSON = (jsonString, allow) => {
  const length = jsonString.length;
  let index = 0;
  const markPartialJSON = (msg) => {
    throw new PartialJSON(`${msg} at position ${index}`);
  };
  const throwMalformedError = (msg) => {
    throw new MalformedJSON(`${msg} at position ${index}`);
  };
  const parseAny = () => {
    skipBlank();
    if (index >= length)
      markPartialJSON("Unexpected end of input");
    if (jsonString[index] === '"')
      return parseStr();
    if (jsonString[index] === "{")
      return parseObj();
    if (jsonString[index] === "[")
      return parseArr();
    if (jsonString.substring(index, index + 4) === "null" || Allow.NULL & allow && length - index < 4 && "null".startsWith(jsonString.substring(index))) {
      index += 4;
      return null;
    }
    if (jsonString.substring(index, index + 4) === "true" || Allow.BOOL & allow && length - index < 4 && "true".startsWith(jsonString.substring(index))) {
      index += 4;
      return true;
    }
    if (jsonString.substring(index, index + 5) === "false" || Allow.BOOL & allow && length - index < 5 && "false".startsWith(jsonString.substring(index))) {
      index += 5;
      return false;
    }
    if (jsonString.substring(index, index + 8) === "Infinity" || Allow.INFINITY & allow && length - index < 8 && "Infinity".startsWith(jsonString.substring(index))) {
      index += 8;
      return Infinity;
    }
    if (jsonString.substring(index, index + 9) === "-Infinity" || Allow.MINUS_INFINITY & allow && 1 < length - index && length - index < 9 && "-Infinity".startsWith(jsonString.substring(index))) {
      index += 9;
      return -Infinity;
    }
    if (jsonString.substring(index, index + 3) === "NaN" || Allow.NAN & allow && length - index < 3 && "NaN".startsWith(jsonString.substring(index))) {
      index += 3;
      return NaN;
    }
    return parseNum();
  };
  const parseStr = () => {
    const start = index;
    let escape2 = false;
    index++;
    while (index < length && (jsonString[index] !== '"' || escape2 && jsonString[index - 1] === "\\")) {
      escape2 = jsonString[index] === "\\" ? !escape2 : false;
      index++;
    }
    if (jsonString.charAt(index) == '"') {
      try {
        return JSON.parse(jsonString.substring(start, ++index - Number(escape2)));
      } catch (e) {
        throwMalformedError(String(e));
      }
    } else if (Allow.STR & allow) {
      try {
        return JSON.parse(jsonString.substring(start, index - Number(escape2)) + '"');
      } catch (e) {
        return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf("\\")) + '"');
      }
    }
    markPartialJSON("Unterminated string literal");
  };
  const parseObj = () => {
    index++;
    skipBlank();
    const obj = {};
    try {
      while (jsonString[index] !== "}") {
        skipBlank();
        if (index >= length && Allow.OBJ & allow)
          return obj;
        const key = parseStr();
        skipBlank();
        index++;
        try {
          const value = parseAny();
          Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
        } catch (e) {
          if (Allow.OBJ & allow)
            return obj;
          else
            throw e;
        }
        skipBlank();
        if (jsonString[index] === ",")
          index++;
      }
    } catch (e) {
      if (Allow.OBJ & allow)
        return obj;
      else
        markPartialJSON("Expected '}' at end of object");
    }
    index++;
    return obj;
  };
  const parseArr = () => {
    index++;
    const arr = [];
    try {
      while (jsonString[index] !== "]") {
        arr.push(parseAny());
        skipBlank();
        if (jsonString[index] === ",") {
          index++;
        }
      }
    } catch (e) {
      if (Allow.ARR & allow) {
        return arr;
      }
      markPartialJSON("Expected ']' at end of array");
    }
    index++;
    return arr;
  };
  const parseNum = () => {
    if (index === 0) {
      if (jsonString === "-" && Allow.NUM & allow)
        markPartialJSON("Not sure what '-' is");
      try {
        return JSON.parse(jsonString);
      } catch (e) {
        if (Allow.NUM & allow) {
          try {
            if ("." === jsonString[jsonString.length - 1])
              return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf(".")));
            return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf("e")));
          } catch (e2) {
          }
        }
        throwMalformedError(String(e));
      }
    }
    const start = index;
    if (jsonString[index] === "-")
      index++;
    while (jsonString[index] && !",]}".includes(jsonString[index]))
      index++;
    if (index == length && !(Allow.NUM & allow))
      markPartialJSON("Unterminated number literal");
    try {
      return JSON.parse(jsonString.substring(start, index));
    } catch (e) {
      if (jsonString.substring(start, index) === "-" && Allow.NUM & allow)
        markPartialJSON("Not sure what '-' is");
      try {
        return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf("e")));
      } catch (e2) {
        throwMalformedError(String(e2));
      }
    }
  };
  const skipBlank = () => {
    while (index < length && " \n\r	".includes(jsonString[index])) {
      index++;
    }
  };
  return parseAny();
};
var partialParse = (input) => parseJSON(input, Allow.ALL ^ Allow.NUM);

// ../../../node_modules/openai/lib/ChatCompletionStream.mjs
var _ChatCompletionStream_instances;
var _ChatCompletionStream_params;
var _ChatCompletionStream_choiceEventStates;
var _ChatCompletionStream_currentChatCompletionSnapshot;
var _ChatCompletionStream_beginRequest;
var _ChatCompletionStream_getChoiceEventState;
var _ChatCompletionStream_addChunk;
var _ChatCompletionStream_emitToolCallDoneEvent;
var _ChatCompletionStream_emitContentDoneEvents;
var _ChatCompletionStream_endRequest;
var _ChatCompletionStream_getAutoParseableResponseFormat;
var _ChatCompletionStream_accumulateChatCompletion;
var ChatCompletionStream = class _ChatCompletionStream extends AbstractChatCompletionRunner {
  constructor(params) {
    super();
    _ChatCompletionStream_instances.add(this);
    _ChatCompletionStream_params.set(this, void 0);
    _ChatCompletionStream_choiceEventStates.set(this, void 0);
    _ChatCompletionStream_currentChatCompletionSnapshot.set(this, void 0);
    __classPrivateFieldSet3(this, _ChatCompletionStream_params, params, "f");
    __classPrivateFieldSet3(this, _ChatCompletionStream_choiceEventStates, [], "f");
  }
  get currentChatCompletionSnapshot() {
    return __classPrivateFieldGet3(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
  }
  /**
   * Intended for use on the frontend, consuming a stream produced with
   * `.toReadableStream()` on the backend.
   *
   * Note that messages sent to the model do not appear in `.on('message')`
   * in this context.
   */
  static fromReadableStream(stream) {
    const runner = new _ChatCompletionStream(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  static createChatCompletion(client, params, options) {
    const runner = new _ChatCompletionStream(params);
    runner._run(() => runner._runChatCompletion(client, { ...params, stream: true }, { ...options, headers: { ...options?.headers, "X-Stainless-Helper-Method": "stream" } }));
    return runner;
  }
  async _createChatCompletion(client, params, options) {
    super._createChatCompletion;
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_beginRequest).call(this);
    const stream = await client.chat.completions.create({ ...params, stream: true }, { ...options, signal: this.controller.signal });
    this._connected();
    for await (const chunk of stream) {
      __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_addChunk).call(this, chunk);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addChatCompletion(__classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
  }
  async _fromReadableStream(readableStream, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_beginRequest).call(this);
    this._connected();
    const stream = Stream.fromReadableStream(readableStream, this.controller);
    let chatId;
    for await (const chunk of stream) {
      if (chatId && chatId !== chunk.id) {
        this._addChatCompletion(__classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
      }
      __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_addChunk).call(this, chunk);
      chatId = chunk.id;
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addChatCompletion(__classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
  }
  [(_ChatCompletionStream_params = /* @__PURE__ */ new WeakMap(), _ChatCompletionStream_choiceEventStates = /* @__PURE__ */ new WeakMap(), _ChatCompletionStream_currentChatCompletionSnapshot = /* @__PURE__ */ new WeakMap(), _ChatCompletionStream_instances = /* @__PURE__ */ new WeakSet(), _ChatCompletionStream_beginRequest = function _ChatCompletionStream_beginRequest2() {
    if (this.ended)
      return;
    __classPrivateFieldSet3(this, _ChatCompletionStream_currentChatCompletionSnapshot, void 0, "f");
  }, _ChatCompletionStream_getChoiceEventState = function _ChatCompletionStream_getChoiceEventState2(choice) {
    let state = __classPrivateFieldGet3(this, _ChatCompletionStream_choiceEventStates, "f")[choice.index];
    if (state) {
      return state;
    }
    state = {
      content_done: false,
      refusal_done: false,
      logprobs_content_done: false,
      logprobs_refusal_done: false,
      done_tool_calls: /* @__PURE__ */ new Set(),
      current_tool_call_index: null
    };
    __classPrivateFieldGet3(this, _ChatCompletionStream_choiceEventStates, "f")[choice.index] = state;
    return state;
  }, _ChatCompletionStream_addChunk = function _ChatCompletionStream_addChunk2(chunk) {
    if (this.ended)
      return;
    const completion = __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_accumulateChatCompletion).call(this, chunk);
    this._emit("chunk", chunk, completion);
    for (const choice of chunk.choices) {
      const choiceSnapshot = completion.choices[choice.index];
      if (choice.delta.content != null && choiceSnapshot.message?.role === "assistant" && choiceSnapshot.message?.content) {
        this._emit("content", choice.delta.content, choiceSnapshot.message.content);
        this._emit("content.delta", {
          delta: choice.delta.content,
          snapshot: choiceSnapshot.message.content,
          parsed: choiceSnapshot.message.parsed
        });
      }
      if (choice.delta.refusal != null && choiceSnapshot.message?.role === "assistant" && choiceSnapshot.message?.refusal) {
        this._emit("refusal.delta", {
          delta: choice.delta.refusal,
          snapshot: choiceSnapshot.message.refusal
        });
      }
      if (choice.logprobs?.content != null && choiceSnapshot.message?.role === "assistant") {
        this._emit("logprobs.content.delta", {
          content: choice.logprobs?.content,
          snapshot: choiceSnapshot.logprobs?.content ?? []
        });
      }
      if (choice.logprobs?.refusal != null && choiceSnapshot.message?.role === "assistant") {
        this._emit("logprobs.refusal.delta", {
          refusal: choice.logprobs?.refusal,
          snapshot: choiceSnapshot.logprobs?.refusal ?? []
        });
      }
      const state = __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
      if (choiceSnapshot.finish_reason) {
        __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitContentDoneEvents).call(this, choiceSnapshot);
        if (state.current_tool_call_index != null) {
          __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitToolCallDoneEvent).call(this, choiceSnapshot, state.current_tool_call_index);
        }
      }
      for (const toolCall of choice.delta.tool_calls ?? []) {
        if (state.current_tool_call_index !== toolCall.index) {
          __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitContentDoneEvents).call(this, choiceSnapshot);
          if (state.current_tool_call_index != null) {
            __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitToolCallDoneEvent).call(this, choiceSnapshot, state.current_tool_call_index);
          }
        }
        state.current_tool_call_index = toolCall.index;
      }
      for (const toolCallDelta of choice.delta.tool_calls ?? []) {
        const toolCallSnapshot = choiceSnapshot.message.tool_calls?.[toolCallDelta.index];
        if (!toolCallSnapshot?.type) {
          continue;
        }
        if (toolCallSnapshot?.type === "function") {
          this._emit("tool_calls.function.arguments.delta", {
            name: toolCallSnapshot.function?.name,
            index: toolCallDelta.index,
            arguments: toolCallSnapshot.function.arguments,
            parsed_arguments: toolCallSnapshot.function.parsed_arguments,
            arguments_delta: toolCallDelta.function?.arguments ?? ""
          });
        } else {
          assertNever(toolCallSnapshot?.type);
        }
      }
    }
  }, _ChatCompletionStream_emitToolCallDoneEvent = function _ChatCompletionStream_emitToolCallDoneEvent2(choiceSnapshot, toolCallIndex) {
    const state = __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
    if (state.done_tool_calls.has(toolCallIndex)) {
      return;
    }
    const toolCallSnapshot = choiceSnapshot.message.tool_calls?.[toolCallIndex];
    if (!toolCallSnapshot) {
      throw new Error("no tool call snapshot");
    }
    if (!toolCallSnapshot.type) {
      throw new Error("tool call snapshot missing `type`");
    }
    if (toolCallSnapshot.type === "function") {
      const inputTool = __classPrivateFieldGet3(this, _ChatCompletionStream_params, "f")?.tools?.find((tool) => isChatCompletionFunctionTool(tool) && tool.function.name === toolCallSnapshot.function.name);
      this._emit("tool_calls.function.arguments.done", {
        name: toolCallSnapshot.function.name,
        index: toolCallIndex,
        arguments: toolCallSnapshot.function.arguments,
        parsed_arguments: isAutoParsableTool(inputTool) ? inputTool.$parseRaw(toolCallSnapshot.function.arguments) : inputTool?.function.strict ? JSON.parse(toolCallSnapshot.function.arguments) : null
      });
    } else {
      assertNever(toolCallSnapshot.type);
    }
  }, _ChatCompletionStream_emitContentDoneEvents = function _ChatCompletionStream_emitContentDoneEvents2(choiceSnapshot) {
    const state = __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
    if (choiceSnapshot.message.content && !state.content_done) {
      state.content_done = true;
      const responseFormat = __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getAutoParseableResponseFormat).call(this);
      this._emit("content.done", {
        content: choiceSnapshot.message.content,
        parsed: responseFormat ? responseFormat.$parseRaw(choiceSnapshot.message.content) : null
      });
    }
    if (choiceSnapshot.message.refusal && !state.refusal_done) {
      state.refusal_done = true;
      this._emit("refusal.done", { refusal: choiceSnapshot.message.refusal });
    }
    if (choiceSnapshot.logprobs?.content && !state.logprobs_content_done) {
      state.logprobs_content_done = true;
      this._emit("logprobs.content.done", { content: choiceSnapshot.logprobs.content });
    }
    if (choiceSnapshot.logprobs?.refusal && !state.logprobs_refusal_done) {
      state.logprobs_refusal_done = true;
      this._emit("logprobs.refusal.done", { refusal: choiceSnapshot.logprobs.refusal });
    }
  }, _ChatCompletionStream_endRequest = function _ChatCompletionStream_endRequest2() {
    if (this.ended) {
      throw new OpenAIError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = __classPrivateFieldGet3(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
    if (!snapshot) {
      throw new OpenAIError(`request ended without sending any chunks`);
    }
    __classPrivateFieldSet3(this, _ChatCompletionStream_currentChatCompletionSnapshot, void 0, "f");
    __classPrivateFieldSet3(this, _ChatCompletionStream_choiceEventStates, [], "f");
    return finalizeChatCompletion(snapshot, __classPrivateFieldGet3(this, _ChatCompletionStream_params, "f"));
  }, _ChatCompletionStream_getAutoParseableResponseFormat = function _ChatCompletionStream_getAutoParseableResponseFormat2() {
    const responseFormat = __classPrivateFieldGet3(this, _ChatCompletionStream_params, "f")?.response_format;
    if (isAutoParsableResponseFormat(responseFormat)) {
      return responseFormat;
    }
    return null;
  }, _ChatCompletionStream_accumulateChatCompletion = function _ChatCompletionStream_accumulateChatCompletion2(chunk) {
    var _a4, _b, _c, _d;
    let snapshot = __classPrivateFieldGet3(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
    const { choices, ...rest } = chunk;
    if (!snapshot) {
      snapshot = __classPrivateFieldSet3(this, _ChatCompletionStream_currentChatCompletionSnapshot, {
        ...rest,
        choices: []
      }, "f");
    } else {
      Object.assign(snapshot, rest);
    }
    for (const { delta, finish_reason, index, logprobs = null, ...other } of chunk.choices) {
      let choice = snapshot.choices[index];
      if (!choice) {
        choice = snapshot.choices[index] = { finish_reason, index, message: {}, logprobs, ...other };
      }
      if (logprobs) {
        if (!choice.logprobs) {
          choice.logprobs = Object.assign({}, logprobs);
        } else {
          const { content: content2, refusal: refusal2, ...rest3 } = logprobs;
          assertIsEmpty(rest3);
          Object.assign(choice.logprobs, rest3);
          if (content2) {
            (_a4 = choice.logprobs).content ?? (_a4.content = []);
            choice.logprobs.content.push(...content2);
          }
          if (refusal2) {
            (_b = choice.logprobs).refusal ?? (_b.refusal = []);
            choice.logprobs.refusal.push(...refusal2);
          }
        }
      }
      if (finish_reason) {
        choice.finish_reason = finish_reason;
        if (__classPrivateFieldGet3(this, _ChatCompletionStream_params, "f") && hasAutoParseableInput(__classPrivateFieldGet3(this, _ChatCompletionStream_params, "f"))) {
          if (finish_reason === "length") {
            throw new LengthFinishReasonError();
          }
          if (finish_reason === "content_filter") {
            throw new ContentFilterFinishReasonError();
          }
        }
      }
      Object.assign(choice, other);
      if (!delta)
        continue;
      const { content, refusal, function_call, role, tool_calls, ...rest2 } = delta;
      assertIsEmpty(rest2);
      Object.assign(choice.message, rest2);
      if (refusal) {
        choice.message.refusal = (choice.message.refusal || "") + refusal;
      }
      if (role)
        choice.message.role = role;
      if (function_call) {
        if (!choice.message.function_call) {
          choice.message.function_call = function_call;
        } else {
          if (function_call.name)
            choice.message.function_call.name = function_call.name;
          if (function_call.arguments) {
            (_c = choice.message.function_call).arguments ?? (_c.arguments = "");
            choice.message.function_call.arguments += function_call.arguments;
          }
        }
      }
      if (content) {
        choice.message.content = (choice.message.content || "") + content;
        if (!choice.message.refusal && __classPrivateFieldGet3(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getAutoParseableResponseFormat).call(this)) {
          choice.message.parsed = partialParse(choice.message.content);
        }
      }
      if (tool_calls) {
        if (!choice.message.tool_calls)
          choice.message.tool_calls = [];
        for (const { index: index2, id, type, function: fn, ...rest3 } of tool_calls) {
          const tool_call = (_d = choice.message.tool_calls)[index2] ?? (_d[index2] = {});
          Object.assign(tool_call, rest3);
          if (id)
            tool_call.id = id;
          if (type)
            tool_call.type = type;
          if (fn)
            tool_call.function ?? (tool_call.function = { name: fn.name ?? "", arguments: "" });
          if (fn?.name)
            tool_call.function.name = fn.name;
          if (fn?.arguments) {
            tool_call.function.arguments += fn.arguments;
            if (shouldParseToolCall(__classPrivateFieldGet3(this, _ChatCompletionStream_params, "f"), tool_call)) {
              tool_call.function.parsed_arguments = partialParse(tool_call.function.arguments);
            }
          }
        }
      }
    }
    return snapshot;
  }, Symbol.asyncIterator)]() {
    const pushQueue = [];
    const readQueue = [];
    let done = false;
    this.on("chunk", (chunk) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(chunk);
      } else {
        pushQueue.push(chunk);
      }
    });
    this.on("end", () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(void 0);
      }
      readQueue.length = 0;
    });
    this.on("abort", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    this.on("error", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    return {
      next: async () => {
        if (!pushQueue.length) {
          if (done) {
            return { value: void 0, done: true };
          }
          return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((chunk2) => chunk2 ? { value: chunk2, done: false } : { value: void 0, done: true });
        }
        const chunk = pushQueue.shift();
        return { value: chunk, done: false };
      },
      return: async () => {
        this.abort();
        return { value: void 0, done: true };
      }
    };
  }
  toReadableStream() {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }
};
function finalizeChatCompletion(snapshot, params) {
  const { id, choices, created, model, system_fingerprint, ...rest } = snapshot;
  const completion = {
    ...rest,
    id,
    choices: choices.map(({ message, finish_reason, index, logprobs, ...choiceRest }) => {
      if (!finish_reason) {
        throw new OpenAIError(`missing finish_reason for choice ${index}`);
      }
      const { content = null, function_call, tool_calls, ...messageRest } = message;
      const role = message.role;
      if (!role) {
        throw new OpenAIError(`missing role for choice ${index}`);
      }
      if (function_call) {
        const { arguments: args, name } = function_call;
        if (args == null) {
          throw new OpenAIError(`missing function_call.arguments for choice ${index}`);
        }
        if (!name) {
          throw new OpenAIError(`missing function_call.name for choice ${index}`);
        }
        return {
          ...choiceRest,
          message: {
            content,
            function_call: { arguments: args, name },
            role,
            refusal: message.refusal ?? null
          },
          finish_reason,
          index,
          logprobs
        };
      }
      if (tool_calls) {
        return {
          ...choiceRest,
          index,
          finish_reason,
          logprobs,
          message: {
            ...messageRest,
            role,
            content,
            refusal: message.refusal ?? null,
            tool_calls: tool_calls.map((tool_call, i) => {
              const { function: fn, type, id: id2, ...toolRest } = tool_call;
              const { arguments: args, name, ...fnRest } = fn || {};
              if (id2 == null) {
                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].id
${str(snapshot)}`);
              }
              if (type == null) {
                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].type
${str(snapshot)}`);
              }
              if (name == null) {
                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].function.name
${str(snapshot)}`);
              }
              if (args == null) {
                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].function.arguments
${str(snapshot)}`);
              }
              return { ...toolRest, id: id2, type, function: { ...fnRest, name, arguments: args } };
            })
          }
        };
      }
      return {
        ...choiceRest,
        message: { ...messageRest, content, role, refusal: message.refusal ?? null },
        finish_reason,
        index,
        logprobs
      };
    }),
    created,
    model,
    object: "chat.completion",
    ...system_fingerprint ? { system_fingerprint } : {}
  };
  return maybeParseChatCompletion(completion, params);
}
function str(x) {
  return JSON.stringify(x);
}
function assertIsEmpty(obj) {
  return;
}
function assertNever(_x) {
}

// ../../../node_modules/openai/lib/ChatCompletionStreamingRunner.mjs
var ChatCompletionStreamingRunner = class _ChatCompletionStreamingRunner extends ChatCompletionStream {
  static fromReadableStream(stream) {
    const runner = new _ChatCompletionStreamingRunner(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  static runTools(client, params, options) {
    const runner = new _ChatCompletionStreamingRunner(
      // @ts-expect-error TODO these types are incompatible
      params
    );
    const opts = {
      ...options,
      headers: { ...options?.headers, "X-Stainless-Helper-Method": "runTools" }
    };
    runner._run(() => runner._runTools(client, params, opts));
    return runner;
  }
};

// ../../../node_modules/openai/resources/chat/completions/completions.mjs
var Completions = class extends APIResource {
  constructor() {
    super(...arguments);
    this.messages = new Messages(this._client);
  }
  create(body, options) {
    return this._client.post("/chat/completions", { body, ...options, stream: body.stream ?? false });
  }
  /**
   * Get a stored chat completion. Only Chat Completions that have been created with
   * the `store` parameter set to `true` will be returned.
   *
   * @example
   * ```ts
   * const chatCompletion =
   *   await client.chat.completions.retrieve('completion_id');
   * ```
   */
  retrieve(completionID, options) {
    return this._client.get(path`/chat/completions/${completionID}`, options);
  }
  /**
   * Modify a stored chat completion. Only Chat Completions that have been created
   * with the `store` parameter set to `true` can be modified. Currently, the only
   * supported modification is to update the `metadata` field.
   *
   * @example
   * ```ts
   * const chatCompletion = await client.chat.completions.update(
   *   'completion_id',
   *   { metadata: { foo: 'string' } },
   * );
   * ```
   */
  update(completionID, body, options) {
    return this._client.post(path`/chat/completions/${completionID}`, { body, ...options });
  }
  /**
   * List stored Chat Completions. Only Chat Completions that have been stored with
   * the `store` parameter set to `true` will be returned.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const chatCompletion of client.chat.completions.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/chat/completions", CursorPage, { query, ...options });
  }
  /**
   * Delete a stored chat completion. Only Chat Completions that have been created
   * with the `store` parameter set to `true` can be deleted.
   *
   * @example
   * ```ts
   * const chatCompletionDeleted =
   *   await client.chat.completions.delete('completion_id');
   * ```
   */
  delete(completionID, options) {
    return this._client.delete(path`/chat/completions/${completionID}`, options);
  }
  parse(body, options) {
    validateInputTools(body.tools);
    return this._client.chat.completions.create(body, {
      ...options,
      headers: {
        ...options?.headers,
        "X-Stainless-Helper-Method": "chat.completions.parse"
      }
    })._thenUnwrap((completion) => parseChatCompletion(completion, body));
  }
  runTools(body, options) {
    if (body.stream) {
      return ChatCompletionStreamingRunner.runTools(this._client, body, options);
    }
    return ChatCompletionRunner.runTools(this._client, body, options);
  }
  /**
   * Creates a chat completion stream
   */
  stream(body, options) {
    return ChatCompletionStream.createChatCompletion(this._client, body, options);
  }
};
Completions.Messages = Messages;

// ../../../node_modules/openai/resources/chat/chat.mjs
var Chat2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.completions = new Completions(this._client);
  }
};
Chat2.Completions = Completions;

// ../../../node_modules/openai/internal/headers.mjs
var brand_privateNullableHeaders = /* @__PURE__ */ Symbol("brand.privateNullableHeaders");
function* iterateHeaders(headers) {
  if (!headers)
    return;
  if (brand_privateNullableHeaders in headers) {
    const { values, nulls } = headers;
    yield* values.entries();
    for (const name of nulls) {
      yield [name, null];
    }
    return;
  }
  let shouldClear = false;
  let iter;
  if (headers instanceof Headers) {
    iter = headers.entries();
  } else if (isReadonlyArray(headers)) {
    iter = headers;
  } else {
    shouldClear = true;
    iter = Object.entries(headers ?? {});
  }
  for (let row of iter) {
    const name = row[0];
    if (typeof name !== "string")
      throw new TypeError("expected header name to be a string");
    const values = isReadonlyArray(row[1]) ? row[1] : [row[1]];
    let didClear = false;
    for (const value of values) {
      if (value === void 0)
        continue;
      if (shouldClear && !didClear) {
        didClear = true;
        yield [name, null];
      }
      yield [name, value];
    }
  }
}
var buildHeaders = (newHeaders) => {
  const targetHeaders = new Headers();
  const nullHeaders = /* @__PURE__ */ new Set();
  for (const headers of newHeaders) {
    const seenHeaders = /* @__PURE__ */ new Set();
    for (const [name, value] of iterateHeaders(headers)) {
      const lowerName = name.toLowerCase();
      if (!seenHeaders.has(lowerName)) {
        targetHeaders.delete(name);
        seenHeaders.add(lowerName);
      }
      if (value === null) {
        targetHeaders.delete(name);
        nullHeaders.add(lowerName);
      } else {
        targetHeaders.append(name, value);
        nullHeaders.delete(lowerName);
      }
    }
  }
  return { [brand_privateNullableHeaders]: true, values: targetHeaders, nulls: nullHeaders };
};

// ../../../node_modules/openai/resources/audio/speech.mjs
var Speech = class extends APIResource {
  /**
   * Generates audio from the input text.
   *
   * Returns the audio file content, or a stream of audio events.
   *
   * @example
   * ```ts
   * const speech = await client.audio.speech.create({
   *   input: 'input',
   *   model: 'string',
   *   voice: 'string',
   * });
   *
   * const content = await speech.blob();
   * console.log(content);
   * ```
   */
  create(body, options) {
    return this._client.post("/audio/speech", {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "application/octet-stream" }, options?.headers]),
      __binaryResponse: true
    });
  }
};

// ../../../node_modules/openai/resources/audio/transcriptions.mjs
var Transcriptions = class extends APIResource {
  create(body, options) {
    return this._client.post("/audio/transcriptions", multipartFormRequestOptions({
      body,
      ...options,
      stream: body.stream ?? false,
      __metadata: { model: body.model }
    }, this._client));
  }
};

// ../../../node_modules/openai/resources/audio/translations.mjs
var Translations = class extends APIResource {
  create(body, options) {
    return this._client.post("/audio/translations", multipartFormRequestOptions({ body, ...options, __metadata: { model: body.model } }, this._client));
  }
};

// ../../../node_modules/openai/resources/audio/audio.mjs
var Audio = class extends APIResource {
  constructor() {
    super(...arguments);
    this.transcriptions = new Transcriptions(this._client);
    this.translations = new Translations(this._client);
    this.speech = new Speech(this._client);
  }
};
Audio.Transcriptions = Transcriptions;
Audio.Translations = Translations;
Audio.Speech = Speech;

// ../../../node_modules/openai/resources/batches.mjs
var Batches = class extends APIResource {
  /**
   * Creates and executes a batch from an uploaded file of requests
   */
  create(body, options) {
    return this._client.post("/batches", { body, ...options });
  }
  /**
   * Retrieves a batch.
   */
  retrieve(batchID, options) {
    return this._client.get(path`/batches/${batchID}`, options);
  }
  /**
   * List your organization's batches.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/batches", CursorPage, { query, ...options });
  }
  /**
   * Cancels an in-progress batch. The batch will be in status `cancelling` for up to
   * 10 minutes, before changing to `cancelled`, where it will have partial results
   * (if any) available in the output file.
   */
  cancel(batchID, options) {
    return this._client.post(path`/batches/${batchID}/cancel`, options);
  }
};

// ../../../node_modules/openai/resources/beta/assistants.mjs
var Assistants = class extends APIResource {
  /**
   * Create an assistant with a model and instructions.
   *
   * @deprecated
   */
  create(body, options) {
    return this._client.post("/assistants", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Retrieves an assistant.
   *
   * @deprecated
   */
  retrieve(assistantID, options) {
    return this._client.get(path`/assistants/${assistantID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Modifies an assistant.
   *
   * @deprecated
   */
  update(assistantID, body, options) {
    return this._client.post(path`/assistants/${assistantID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Returns a list of assistants.
   *
   * @deprecated
   */
  list(query = {}, options) {
    return this._client.getAPIList("/assistants", CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Delete an assistant.
   *
   * @deprecated
   */
  delete(assistantID, options) {
    return this._client.delete(path`/assistants/${assistantID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
};

// ../../../node_modules/openai/resources/beta/realtime/sessions.mjs
var Sessions = class extends APIResource {
  /**
   * Create an ephemeral API token for use in client-side applications with the
   * Realtime API. Can be configured with the same session parameters as the
   * `session.update` client event.
   *
   * It responds with a session object, plus a `client_secret` key which contains a
   * usable ephemeral API token that can be used to authenticate browser clients for
   * the Realtime API.
   *
   * @example
   * ```ts
   * const session =
   *   await client.beta.realtime.sessions.create();
   * ```
   */
  create(body, options) {
    return this._client.post("/realtime/sessions", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
};

// ../../../node_modules/openai/resources/beta/realtime/transcription-sessions.mjs
var TranscriptionSessions = class extends APIResource {
  /**
   * Create an ephemeral API token for use in client-side applications with the
   * Realtime API specifically for realtime transcriptions. Can be configured with
   * the same session parameters as the `transcription_session.update` client event.
   *
   * It responds with a session object, plus a `client_secret` key which contains a
   * usable ephemeral API token that can be used to authenticate browser clients for
   * the Realtime API.
   *
   * @example
   * ```ts
   * const transcriptionSession =
   *   await client.beta.realtime.transcriptionSessions.create();
   * ```
   */
  create(body, options) {
    return this._client.post("/realtime/transcription_sessions", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
};

// ../../../node_modules/openai/resources/beta/realtime/realtime.mjs
var Realtime = class extends APIResource {
  constructor() {
    super(...arguments);
    this.sessions = new Sessions(this._client);
    this.transcriptionSessions = new TranscriptionSessions(this._client);
  }
};
Realtime.Sessions = Sessions;
Realtime.TranscriptionSessions = TranscriptionSessions;

// ../../../node_modules/openai/resources/beta/chatkit/sessions.mjs
var Sessions2 = class extends APIResource {
  /**
   * Create a ChatKit session.
   *
   * @example
   * ```ts
   * const chatSession =
   *   await client.beta.chatkit.sessions.create({
   *     user: 'x',
   *     workflow: { id: 'id' },
   *   });
   * ```
   */
  create(body, options) {
    return this._client.post("/chatkit/sessions", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers])
    });
  }
  /**
   * Cancel an active ChatKit session and return its most recent metadata.
   *
   * Cancelling prevents new requests from using the issued client secret.
   *
   * @example
   * ```ts
   * const chatSession =
   *   await client.beta.chatkit.sessions.cancel('cksess_123');
   * ```
   */
  cancel(sessionID, options) {
    return this._client.post(path`/chatkit/sessions/${sessionID}/cancel`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers])
    });
  }
};

// ../../../node_modules/openai/resources/beta/chatkit/threads.mjs
var Threads = class extends APIResource {
  /**
   * Retrieve a ChatKit thread by its identifier.
   *
   * @example
   * ```ts
   * const chatkitThread =
   *   await client.beta.chatkit.threads.retrieve('cthr_123');
   * ```
   */
  retrieve(threadID, options) {
    return this._client.get(path`/chatkit/threads/${threadID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers])
    });
  }
  /**
   * List ChatKit threads with optional pagination and user filters.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const chatkitThread of client.beta.chatkit.threads.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/chatkit/threads", ConversationCursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers])
    });
  }
  /**
   * Delete a ChatKit thread along with its items and stored attachments.
   *
   * @example
   * ```ts
   * const thread = await client.beta.chatkit.threads.delete(
   *   'cthr_123',
   * );
   * ```
   */
  delete(threadID, options) {
    return this._client.delete(path`/chatkit/threads/${threadID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers])
    });
  }
  /**
   * List items that belong to a ChatKit thread.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const thread of client.beta.chatkit.threads.listItems(
   *   'cthr_123',
   * )) {
   *   // ...
   * }
   * ```
   */
  listItems(threadID, query = {}, options) {
    return this._client.getAPIList(path`/chatkit/threads/${threadID}/items`, ConversationCursorPage, { query, ...options, headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers]) });
  }
};

// ../../../node_modules/openai/resources/beta/chatkit/chatkit.mjs
var ChatKit = class extends APIResource {
  constructor() {
    super(...arguments);
    this.sessions = new Sessions2(this._client);
    this.threads = new Threads(this._client);
  }
};
ChatKit.Sessions = Sessions2;
ChatKit.Threads = Threads;

// ../../../node_modules/openai/resources/beta/threads/messages.mjs
var Messages2 = class extends APIResource {
  /**
   * Create a message.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  create(threadID, body, options) {
    return this._client.post(path`/threads/${threadID}/messages`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Retrieve a message.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  retrieve(messageID, params, options) {
    const { thread_id } = params;
    return this._client.get(path`/threads/${thread_id}/messages/${messageID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Modifies a message.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  update(messageID, params, options) {
    const { thread_id, ...body } = params;
    return this._client.post(path`/threads/${thread_id}/messages/${messageID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Returns a list of messages for a given thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  list(threadID, query = {}, options) {
    return this._client.getAPIList(path`/threads/${threadID}/messages`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Deletes a message.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  delete(messageID, params, options) {
    const { thread_id } = params;
    return this._client.delete(path`/threads/${thread_id}/messages/${messageID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
};

// ../../../node_modules/openai/resources/beta/threads/runs/steps.mjs
var Steps = class extends APIResource {
  /**
   * Retrieves a run step.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  retrieve(stepID, params, options) {
    const { thread_id, run_id, ...query } = params;
    return this._client.get(path`/threads/${thread_id}/runs/${run_id}/steps/${stepID}`, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Returns a list of run steps belonging to a run.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  list(runID, params, options) {
    const { thread_id, ...query } = params;
    return this._client.getAPIList(path`/threads/${thread_id}/runs/${runID}/steps`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
};

// ../../../node_modules/openai/internal/utils/base64.mjs
var toFloat32Array = (base64Str) => {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(base64Str, "base64");
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / Float32Array.BYTES_PER_ELEMENT));
  } else {
    const binaryStr = atob(base64Str);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return Array.from(new Float32Array(bytes.buffer));
  }
};

// ../../../node_modules/openai/internal/utils/env.mjs
var readEnv = (env2) => {
  if (typeof globalThis.process !== "undefined") {
    return globalThis.process.env?.[env2]?.trim() ?? void 0;
  }
  if (typeof globalThis.Deno !== "undefined") {
    return globalThis.Deno.env?.get?.(env2)?.trim();
  }
  return void 0;
};

// ../../../node_modules/openai/lib/AssistantStream.mjs
var _AssistantStream_instances;
var _a2;
var _AssistantStream_events;
var _AssistantStream_runStepSnapshots;
var _AssistantStream_messageSnapshots;
var _AssistantStream_messageSnapshot;
var _AssistantStream_finalRun;
var _AssistantStream_currentContentIndex;
var _AssistantStream_currentContent;
var _AssistantStream_currentToolCallIndex;
var _AssistantStream_currentToolCall;
var _AssistantStream_currentEvent;
var _AssistantStream_currentRunSnapshot;
var _AssistantStream_currentRunStepSnapshot;
var _AssistantStream_addEvent;
var _AssistantStream_endRequest;
var _AssistantStream_handleMessage;
var _AssistantStream_handleRunStep;
var _AssistantStream_handleEvent;
var _AssistantStream_accumulateRunStep;
var _AssistantStream_accumulateMessage;
var _AssistantStream_accumulateContent;
var _AssistantStream_handleRun;
var AssistantStream = class extends EventStream2 {
  constructor() {
    super(...arguments);
    _AssistantStream_instances.add(this);
    _AssistantStream_events.set(this, []);
    _AssistantStream_runStepSnapshots.set(this, {});
    _AssistantStream_messageSnapshots.set(this, {});
    _AssistantStream_messageSnapshot.set(this, void 0);
    _AssistantStream_finalRun.set(this, void 0);
    _AssistantStream_currentContentIndex.set(this, void 0);
    _AssistantStream_currentContent.set(this, void 0);
    _AssistantStream_currentToolCallIndex.set(this, void 0);
    _AssistantStream_currentToolCall.set(this, void 0);
    _AssistantStream_currentEvent.set(this, void 0);
    _AssistantStream_currentRunSnapshot.set(this, void 0);
    _AssistantStream_currentRunStepSnapshot.set(this, void 0);
  }
  [(_AssistantStream_events = /* @__PURE__ */ new WeakMap(), _AssistantStream_runStepSnapshots = /* @__PURE__ */ new WeakMap(), _AssistantStream_messageSnapshots = /* @__PURE__ */ new WeakMap(), _AssistantStream_messageSnapshot = /* @__PURE__ */ new WeakMap(), _AssistantStream_finalRun = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentContentIndex = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentContent = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentToolCallIndex = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentToolCall = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentEvent = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentRunSnapshot = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentRunStepSnapshot = /* @__PURE__ */ new WeakMap(), _AssistantStream_instances = /* @__PURE__ */ new WeakSet(), Symbol.asyncIterator)]() {
    const pushQueue = [];
    const readQueue = [];
    let done = false;
    this.on("event", (event) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
      }
    });
    this.on("end", () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(void 0);
      }
      readQueue.length = 0;
    });
    this.on("abort", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    this.on("error", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    return {
      next: async () => {
        if (!pushQueue.length) {
          if (done) {
            return { value: void 0, done: true };
          }
          return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((chunk2) => chunk2 ? { value: chunk2, done: false } : { value: void 0, done: true });
        }
        const chunk = pushQueue.shift();
        return { value: chunk, done: false };
      },
      return: async () => {
        this.abort();
        return { value: void 0, done: true };
      }
    };
  }
  static fromReadableStream(stream) {
    const runner = new _a2();
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  async _fromReadableStream(readableStream, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    this._connected();
    const stream = Stream.fromReadableStream(readableStream, this.controller);
    for await (const event of stream) {
      __classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addRun(__classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
  }
  toReadableStream() {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }
  static createToolAssistantStream(runId, runs, params, options) {
    const runner = new _a2();
    runner._run(() => runner._runToolAssistantStream(runId, runs, params, {
      ...options,
      headers: { ...options?.headers, "X-Stainless-Helper-Method": "stream" }
    }));
    return runner;
  }
  async _createToolAssistantStream(run, runId, params, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    const body = { ...params, stream: true };
    const stream = await run.submitToolOutputs(runId, body, {
      ...options,
      signal: this.controller.signal
    });
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addRun(__classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
  }
  static createThreadAssistantStream(params, thread, options) {
    const runner = new _a2();
    runner._run(() => runner._threadAssistantStream(params, thread, {
      ...options,
      headers: { ...options?.headers, "X-Stainless-Helper-Method": "stream" }
    }));
    return runner;
  }
  static createAssistantStream(threadId, runs, params, options) {
    const runner = new _a2();
    runner._run(() => runner._runAssistantStream(threadId, runs, params, {
      ...options,
      headers: { ...options?.headers, "X-Stainless-Helper-Method": "stream" }
    }));
    return runner;
  }
  currentEvent() {
    return __classPrivateFieldGet3(this, _AssistantStream_currentEvent, "f");
  }
  currentRun() {
    return __classPrivateFieldGet3(this, _AssistantStream_currentRunSnapshot, "f");
  }
  currentMessageSnapshot() {
    return __classPrivateFieldGet3(this, _AssistantStream_messageSnapshot, "f");
  }
  currentRunStepSnapshot() {
    return __classPrivateFieldGet3(this, _AssistantStream_currentRunStepSnapshot, "f");
  }
  async finalRunSteps() {
    await this.done();
    return Object.values(__classPrivateFieldGet3(this, _AssistantStream_runStepSnapshots, "f"));
  }
  async finalMessages() {
    await this.done();
    return Object.values(__classPrivateFieldGet3(this, _AssistantStream_messageSnapshots, "f"));
  }
  async finalRun() {
    await this.done();
    if (!__classPrivateFieldGet3(this, _AssistantStream_finalRun, "f"))
      throw Error("Final run was not received.");
    return __classPrivateFieldGet3(this, _AssistantStream_finalRun, "f");
  }
  async _createThreadAssistantStream(thread, params, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    const body = { ...params, stream: true };
    const stream = await thread.createAndRun(body, { ...options, signal: this.controller.signal });
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addRun(__classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
  }
  async _createAssistantStream(run, threadId, params, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    const body = { ...params, stream: true };
    const stream = await run.create(threadId, body, { ...options, signal: this.controller.signal });
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addRun(__classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
  }
  static accumulateDelta(acc, delta) {
    for (const [key, deltaValue] of Object.entries(delta)) {
      if (!acc.hasOwnProperty(key)) {
        acc[key] = deltaValue;
        continue;
      }
      let accValue = acc[key];
      if (accValue === null || accValue === void 0) {
        acc[key] = deltaValue;
        continue;
      }
      if (key === "index" || key === "type") {
        acc[key] = deltaValue;
        continue;
      }
      if (typeof accValue === "string" && typeof deltaValue === "string") {
        accValue += deltaValue;
      } else if (typeof accValue === "number" && typeof deltaValue === "number") {
        accValue += deltaValue;
      } else if (isObj(accValue) && isObj(deltaValue)) {
        accValue = this.accumulateDelta(accValue, deltaValue);
      } else if (Array.isArray(accValue) && Array.isArray(deltaValue)) {
        if (accValue.every((x) => typeof x === "string" || typeof x === "number")) {
          accValue.push(...deltaValue);
          continue;
        }
        for (const deltaEntry of deltaValue) {
          if (!isObj(deltaEntry)) {
            throw new Error(`Expected array delta entry to be an object but got: ${deltaEntry}`);
          }
          const index = deltaEntry["index"];
          if (index == null) {
            console.error(deltaEntry);
            throw new Error("Expected array delta entry to have an `index` property");
          }
          if (typeof index !== "number") {
            throw new Error(`Expected array delta entry \`index\` property to be a number but got ${index}`);
          }
          const accEntry = accValue[index];
          if (accEntry == null) {
            accValue.push(deltaEntry);
          } else {
            accValue[index] = this.accumulateDelta(accEntry, deltaEntry);
          }
        }
        continue;
      } else {
        throw Error(`Unhandled record type: ${key}, deltaValue: ${deltaValue}, accValue: ${accValue}`);
      }
      acc[key] = accValue;
    }
    return acc;
  }
  _addRun(run) {
    return run;
  }
  async _threadAssistantStream(params, thread, options) {
    return await this._createThreadAssistantStream(thread, params, options);
  }
  async _runAssistantStream(threadId, runs, params, options) {
    return await this._createAssistantStream(runs, threadId, params, options);
  }
  async _runToolAssistantStream(runId, runs, params, options) {
    return await this._createToolAssistantStream(runs, runId, params, options);
  }
};
_a2 = AssistantStream, _AssistantStream_addEvent = function _AssistantStream_addEvent2(event) {
  if (this.ended)
    return;
  __classPrivateFieldSet3(this, _AssistantStream_currentEvent, event, "f");
  __classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_handleEvent).call(this, event);
  switch (event.event) {
    case "thread.created":
      break;
    case "thread.run.created":
    case "thread.run.queued":
    case "thread.run.in_progress":
    case "thread.run.requires_action":
    case "thread.run.completed":
    case "thread.run.incomplete":
    case "thread.run.failed":
    case "thread.run.cancelling":
    case "thread.run.cancelled":
    case "thread.run.expired":
      __classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_handleRun).call(this, event);
      break;
    case "thread.run.step.created":
    case "thread.run.step.in_progress":
    case "thread.run.step.delta":
    case "thread.run.step.completed":
    case "thread.run.step.failed":
    case "thread.run.step.cancelled":
    case "thread.run.step.expired":
      __classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_handleRunStep).call(this, event);
      break;
    case "thread.message.created":
    case "thread.message.in_progress":
    case "thread.message.delta":
    case "thread.message.completed":
    case "thread.message.incomplete":
      __classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_handleMessage).call(this, event);
      break;
    case "error":
      throw new Error("Encountered an error event in event processing - errors should be processed earlier");
    default:
      assertNever2(event);
  }
}, _AssistantStream_endRequest = function _AssistantStream_endRequest2() {
  if (this.ended) {
    throw new OpenAIError(`stream has ended, this shouldn't happen`);
  }
  if (!__classPrivateFieldGet3(this, _AssistantStream_finalRun, "f"))
    throw Error("Final run has not been received");
  return __classPrivateFieldGet3(this, _AssistantStream_finalRun, "f");
}, _AssistantStream_handleMessage = function _AssistantStream_handleMessage2(event) {
  const [accumulatedMessage, newContent] = __classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_accumulateMessage).call(this, event, __classPrivateFieldGet3(this, _AssistantStream_messageSnapshot, "f"));
  __classPrivateFieldSet3(this, _AssistantStream_messageSnapshot, accumulatedMessage, "f");
  __classPrivateFieldGet3(this, _AssistantStream_messageSnapshots, "f")[accumulatedMessage.id] = accumulatedMessage;
  for (const content of newContent) {
    const snapshotContent = accumulatedMessage.content[content.index];
    if (snapshotContent?.type == "text") {
      this._emit("textCreated", snapshotContent.text);
    }
  }
  switch (event.event) {
    case "thread.message.created":
      this._emit("messageCreated", event.data);
      break;
    case "thread.message.in_progress":
      break;
    case "thread.message.delta":
      this._emit("messageDelta", event.data.delta, accumulatedMessage);
      if (event.data.delta.content) {
        for (const content of event.data.delta.content) {
          if (content.type == "text" && content.text) {
            let textDelta = content.text;
            let snapshot = accumulatedMessage.content[content.index];
            if (snapshot && snapshot.type == "text") {
              this._emit("textDelta", textDelta, snapshot.text);
            } else {
              throw Error("The snapshot associated with this text delta is not text or missing");
            }
          }
          if (content.index != __classPrivateFieldGet3(this, _AssistantStream_currentContentIndex, "f")) {
            if (__classPrivateFieldGet3(this, _AssistantStream_currentContent, "f")) {
              switch (__classPrivateFieldGet3(this, _AssistantStream_currentContent, "f").type) {
                case "text":
                  this._emit("textDone", __classPrivateFieldGet3(this, _AssistantStream_currentContent, "f").text, __classPrivateFieldGet3(this, _AssistantStream_messageSnapshot, "f"));
                  break;
                case "image_file":
                  this._emit("imageFileDone", __classPrivateFieldGet3(this, _AssistantStream_currentContent, "f").image_file, __classPrivateFieldGet3(this, _AssistantStream_messageSnapshot, "f"));
                  break;
              }
            }
            __classPrivateFieldSet3(this, _AssistantStream_currentContentIndex, content.index, "f");
          }
          __classPrivateFieldSet3(this, _AssistantStream_currentContent, accumulatedMessage.content[content.index], "f");
        }
      }
      break;
    case "thread.message.completed":
    case "thread.message.incomplete":
      if (__classPrivateFieldGet3(this, _AssistantStream_currentContentIndex, "f") !== void 0) {
        const currentContent = event.data.content[__classPrivateFieldGet3(this, _AssistantStream_currentContentIndex, "f")];
        if (currentContent) {
          switch (currentContent.type) {
            case "image_file":
              this._emit("imageFileDone", currentContent.image_file, __classPrivateFieldGet3(this, _AssistantStream_messageSnapshot, "f"));
              break;
            case "text":
              this._emit("textDone", currentContent.text, __classPrivateFieldGet3(this, _AssistantStream_messageSnapshot, "f"));
              break;
          }
        }
      }
      if (__classPrivateFieldGet3(this, _AssistantStream_messageSnapshot, "f")) {
        this._emit("messageDone", event.data);
      }
      __classPrivateFieldSet3(this, _AssistantStream_messageSnapshot, void 0, "f");
  }
}, _AssistantStream_handleRunStep = function _AssistantStream_handleRunStep2(event) {
  const accumulatedRunStep = __classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_accumulateRunStep).call(this, event);
  __classPrivateFieldSet3(this, _AssistantStream_currentRunStepSnapshot, accumulatedRunStep, "f");
  switch (event.event) {
    case "thread.run.step.created":
      this._emit("runStepCreated", event.data);
      break;
    case "thread.run.step.delta":
      const delta = event.data.delta;
      if (delta.step_details && delta.step_details.type == "tool_calls" && delta.step_details.tool_calls && accumulatedRunStep.step_details.type == "tool_calls") {
        for (const toolCall of delta.step_details.tool_calls) {
          if (toolCall.index == __classPrivateFieldGet3(this, _AssistantStream_currentToolCallIndex, "f")) {
            this._emit("toolCallDelta", toolCall, accumulatedRunStep.step_details.tool_calls[toolCall.index]);
          } else {
            if (__classPrivateFieldGet3(this, _AssistantStream_currentToolCall, "f")) {
              this._emit("toolCallDone", __classPrivateFieldGet3(this, _AssistantStream_currentToolCall, "f"));
            }
            __classPrivateFieldSet3(this, _AssistantStream_currentToolCallIndex, toolCall.index, "f");
            __classPrivateFieldSet3(this, _AssistantStream_currentToolCall, accumulatedRunStep.step_details.tool_calls[toolCall.index], "f");
            if (__classPrivateFieldGet3(this, _AssistantStream_currentToolCall, "f"))
              this._emit("toolCallCreated", __classPrivateFieldGet3(this, _AssistantStream_currentToolCall, "f"));
          }
        }
      }
      this._emit("runStepDelta", event.data.delta, accumulatedRunStep);
      break;
    case "thread.run.step.completed":
    case "thread.run.step.failed":
    case "thread.run.step.cancelled":
    case "thread.run.step.expired":
      __classPrivateFieldSet3(this, _AssistantStream_currentRunStepSnapshot, void 0, "f");
      const details = event.data.step_details;
      if (details.type == "tool_calls") {
        if (__classPrivateFieldGet3(this, _AssistantStream_currentToolCall, "f")) {
          this._emit("toolCallDone", __classPrivateFieldGet3(this, _AssistantStream_currentToolCall, "f"));
          __classPrivateFieldSet3(this, _AssistantStream_currentToolCall, void 0, "f");
        }
      }
      this._emit("runStepDone", event.data, accumulatedRunStep);
      break;
    case "thread.run.step.in_progress":
      break;
  }
}, _AssistantStream_handleEvent = function _AssistantStream_handleEvent2(event) {
  __classPrivateFieldGet3(this, _AssistantStream_events, "f").push(event);
  this._emit("event", event);
}, _AssistantStream_accumulateRunStep = function _AssistantStream_accumulateRunStep2(event) {
  switch (event.event) {
    case "thread.run.step.created":
      __classPrivateFieldGet3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id] = event.data;
      return event.data;
    case "thread.run.step.delta":
      let snapshot = __classPrivateFieldGet3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id];
      if (!snapshot) {
        throw Error("Received a RunStepDelta before creation of a snapshot");
      }
      let data = event.data;
      if (data.delta) {
        const accumulated = _a2.accumulateDelta(snapshot, data.delta);
        __classPrivateFieldGet3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id] = accumulated;
      }
      return __classPrivateFieldGet3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id];
    case "thread.run.step.completed":
    case "thread.run.step.failed":
    case "thread.run.step.cancelled":
    case "thread.run.step.expired":
    case "thread.run.step.in_progress":
      __classPrivateFieldGet3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id] = event.data;
      break;
  }
  if (__classPrivateFieldGet3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id])
    return __classPrivateFieldGet3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id];
  throw new Error("No snapshot available");
}, _AssistantStream_accumulateMessage = function _AssistantStream_accumulateMessage2(event, snapshot) {
  let newContent = [];
  switch (event.event) {
    case "thread.message.created":
      return [event.data, newContent];
    case "thread.message.delta":
      if (!snapshot) {
        throw Error("Received a delta with no existing snapshot (there should be one from message creation)");
      }
      let data = event.data;
      if (data.delta.content) {
        for (const contentElement of data.delta.content) {
          if (contentElement.index in snapshot.content) {
            let currentContent = snapshot.content[contentElement.index];
            snapshot.content[contentElement.index] = __classPrivateFieldGet3(this, _AssistantStream_instances, "m", _AssistantStream_accumulateContent).call(this, contentElement, currentContent);
          } else {
            snapshot.content[contentElement.index] = contentElement;
            newContent.push(contentElement);
          }
        }
      }
      return [snapshot, newContent];
    case "thread.message.in_progress":
    case "thread.message.completed":
    case "thread.message.incomplete":
      if (snapshot) {
        return [snapshot, newContent];
      } else {
        throw Error("Received thread message event with no existing snapshot");
      }
  }
  throw Error("Tried to accumulate a non-message event");
}, _AssistantStream_accumulateContent = function _AssistantStream_accumulateContent2(contentElement, currentContent) {
  return _a2.accumulateDelta(currentContent, contentElement);
}, _AssistantStream_handleRun = function _AssistantStream_handleRun2(event) {
  __classPrivateFieldSet3(this, _AssistantStream_currentRunSnapshot, event.data, "f");
  switch (event.event) {
    case "thread.run.created":
      break;
    case "thread.run.queued":
      break;
    case "thread.run.in_progress":
      break;
    case "thread.run.requires_action":
    case "thread.run.cancelled":
    case "thread.run.failed":
    case "thread.run.completed":
    case "thread.run.expired":
    case "thread.run.incomplete":
      __classPrivateFieldSet3(this, _AssistantStream_finalRun, event.data, "f");
      if (__classPrivateFieldGet3(this, _AssistantStream_currentToolCall, "f")) {
        this._emit("toolCallDone", __classPrivateFieldGet3(this, _AssistantStream_currentToolCall, "f"));
        __classPrivateFieldSet3(this, _AssistantStream_currentToolCall, void 0, "f");
      }
      break;
    case "thread.run.cancelling":
      break;
  }
};
function assertNever2(_x) {
}

// ../../../node_modules/openai/resources/beta/threads/runs/runs.mjs
var Runs = class extends APIResource {
  constructor() {
    super(...arguments);
    this.steps = new Steps(this._client);
  }
  create(threadID, params, options) {
    const { include, ...body } = params;
    return this._client.post(path`/threads/${threadID}/runs`, {
      query: { include },
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      stream: params.stream ?? false,
      __synthesizeEventData: true
    });
  }
  /**
   * Retrieves a run.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  retrieve(runID, params, options) {
    const { thread_id } = params;
    return this._client.get(path`/threads/${thread_id}/runs/${runID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Modifies a run.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  update(runID, params, options) {
    const { thread_id, ...body } = params;
    return this._client.post(path`/threads/${thread_id}/runs/${runID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Returns a list of runs belonging to a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  list(threadID, query = {}, options) {
    return this._client.getAPIList(path`/threads/${threadID}/runs`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Cancels a run that is `in_progress`.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  cancel(runID, params, options) {
    const { thread_id } = params;
    return this._client.post(path`/threads/${thread_id}/runs/${runID}/cancel`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * A helper to create a run an poll for a terminal state. More information on Run
   * lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  async createAndPoll(threadId, body, options) {
    const run = await this.create(threadId, body, options);
    return await this.poll(run.id, { thread_id: threadId }, options);
  }
  /**
   * Create a Run stream
   *
   * @deprecated use `stream` instead
   */
  createAndStream(threadId, body, options) {
    return AssistantStream.createAssistantStream(threadId, this._client.beta.threads.runs, body, options);
  }
  /**
   * A helper to poll a run status until it reaches a terminal state. More
   * information on Run lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  async poll(runId, params, options) {
    const headers = buildHeaders([
      options?.headers,
      {
        "X-Stainless-Poll-Helper": "true",
        "X-Stainless-Custom-Poll-Interval": options?.pollIntervalMs?.toString() ?? void 0
      }
    ]);
    while (true) {
      const { data: run, response } = await this.retrieve(runId, params, {
        ...options,
        headers: { ...options?.headers, ...headers }
      }).withResponse();
      switch (run.status) {
        //If we are in any sort of intermediate state we poll
        case "queued":
        case "in_progress":
        case "cancelling":
          let sleepInterval = 5e3;
          if (options?.pollIntervalMs) {
            sleepInterval = options.pollIntervalMs;
          } else {
            const headerInterval = response.headers.get("openai-poll-after-ms");
            if (headerInterval) {
              const headerIntervalMs = parseInt(headerInterval);
              if (!isNaN(headerIntervalMs)) {
                sleepInterval = headerIntervalMs;
              }
            }
          }
          await sleep(sleepInterval);
          break;
        //We return the run in any terminal state.
        case "requires_action":
        case "incomplete":
        case "cancelled":
        case "completed":
        case "failed":
        case "expired":
          return run;
      }
    }
  }
  /**
   * Create a Run stream
   */
  stream(threadId, body, options) {
    return AssistantStream.createAssistantStream(threadId, this._client.beta.threads.runs, body, options);
  }
  submitToolOutputs(runID, params, options) {
    const { thread_id, ...body } = params;
    return this._client.post(path`/threads/${thread_id}/runs/${runID}/submit_tool_outputs`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      stream: params.stream ?? false,
      __synthesizeEventData: true
    });
  }
  /**
   * A helper to submit a tool output to a run and poll for a terminal run state.
   * More information on Run lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  async submitToolOutputsAndPoll(runId, params, options) {
    const run = await this.submitToolOutputs(runId, params, options);
    return await this.poll(run.id, params, options);
  }
  /**
   * Submit the tool outputs from a previous run and stream the run to a terminal
   * state. More information on Run lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  submitToolOutputsStream(runId, params, options) {
    return AssistantStream.createToolAssistantStream(runId, this._client.beta.threads.runs, params, options);
  }
};
Runs.Steps = Steps;

// ../../../node_modules/openai/resources/beta/threads/threads.mjs
var Threads2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.runs = new Runs(this._client);
    this.messages = new Messages2(this._client);
  }
  /**
   * Create a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  create(body = {}, options) {
    return this._client.post("/threads", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Retrieves a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  retrieve(threadID, options) {
    return this._client.get(path`/threads/${threadID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Modifies a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  update(threadID, body, options) {
    return this._client.post(path`/threads/${threadID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Delete a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  delete(threadID, options) {
    return this._client.delete(path`/threads/${threadID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  createAndRun(body, options) {
    return this._client.post("/threads/runs", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      stream: body.stream ?? false,
      __synthesizeEventData: true
    });
  }
  /**
   * A helper to create a thread, start a run and then poll for a terminal state.
   * More information on Run lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  async createAndRunPoll(body, options) {
    const run = await this.createAndRun(body, options);
    return await this.runs.poll(run.id, { thread_id: run.thread_id }, options);
  }
  /**
   * Create a thread and stream the run back
   */
  createAndRunStream(body, options) {
    return AssistantStream.createThreadAssistantStream(body, this._client.beta.threads, options);
  }
};
Threads2.Runs = Runs;
Threads2.Messages = Messages2;

// ../../../node_modules/openai/resources/beta/beta.mjs
var Beta2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.realtime = new Realtime(this._client);
    this.chatkit = new ChatKit(this._client);
    this.assistants = new Assistants(this._client);
    this.threads = new Threads2(this._client);
  }
};
Beta2.Realtime = Realtime;
Beta2.ChatKit = ChatKit;
Beta2.Assistants = Assistants;
Beta2.Threads = Threads2;

// ../../../node_modules/openai/resources/completions.mjs
var Completions2 = class extends APIResource {
  create(body, options) {
    return this._client.post("/completions", { body, ...options, stream: body.stream ?? false });
  }
};

// ../../../node_modules/openai/resources/containers/files/content.mjs
var Content = class extends APIResource {
  /**
   * Retrieve Container File Content
   */
  retrieve(fileID, params, options) {
    const { container_id } = params;
    return this._client.get(path`/containers/${container_id}/files/${fileID}/content`, {
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __binaryResponse: true
    });
  }
};

// ../../../node_modules/openai/resources/containers/files/files.mjs
var Files = class extends APIResource {
  constructor() {
    super(...arguments);
    this.content = new Content(this._client);
  }
  /**
   * Create a Container File
   *
   * You can send either a multipart/form-data request with the raw file content, or
   * a JSON request with a file ID.
   */
  create(containerID, body, options) {
    return this._client.post(path`/containers/${containerID}/files`, maybeMultipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Retrieve Container File
   */
  retrieve(fileID, params, options) {
    const { container_id } = params;
    return this._client.get(path`/containers/${container_id}/files/${fileID}`, options);
  }
  /**
   * List Container files
   */
  list(containerID, query = {}, options) {
    return this._client.getAPIList(path`/containers/${containerID}/files`, CursorPage, {
      query,
      ...options
    });
  }
  /**
   * Delete Container File
   */
  delete(fileID, params, options) {
    const { container_id } = params;
    return this._client.delete(path`/containers/${container_id}/files/${fileID}`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
};
Files.Content = Content;

// ../../../node_modules/openai/resources/containers/containers.mjs
var Containers = class extends APIResource {
  constructor() {
    super(...arguments);
    this.files = new Files(this._client);
  }
  /**
   * Create Container
   */
  create(body, options) {
    return this._client.post("/containers", { body, ...options });
  }
  /**
   * Retrieve Container
   */
  retrieve(containerID, options) {
    return this._client.get(path`/containers/${containerID}`, options);
  }
  /**
   * List Containers
   */
  list(query = {}, options) {
    return this._client.getAPIList("/containers", CursorPage, { query, ...options });
  }
  /**
   * Delete Container
   */
  delete(containerID, options) {
    return this._client.delete(path`/containers/${containerID}`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
};
Containers.Files = Files;

// ../../../node_modules/openai/resources/conversations/items.mjs
var Items = class extends APIResource {
  /**
   * Create items in a conversation with the given ID.
   */
  create(conversationID, params, options) {
    const { include, ...body } = params;
    return this._client.post(path`/conversations/${conversationID}/items`, {
      query: { include },
      body,
      ...options
    });
  }
  /**
   * Get a single item from a conversation with the given IDs.
   */
  retrieve(itemID, params, options) {
    const { conversation_id, ...query } = params;
    return this._client.get(path`/conversations/${conversation_id}/items/${itemID}`, { query, ...options });
  }
  /**
   * List all items for a conversation with the given ID.
   */
  list(conversationID, query = {}, options) {
    return this._client.getAPIList(path`/conversations/${conversationID}/items`, ConversationCursorPage, { query, ...options });
  }
  /**
   * Delete an item from a conversation with the given IDs.
   */
  delete(itemID, params, options) {
    const { conversation_id } = params;
    return this._client.delete(path`/conversations/${conversation_id}/items/${itemID}`, options);
  }
};

// ../../../node_modules/openai/resources/conversations/conversations.mjs
var Conversations = class extends APIResource {
  constructor() {
    super(...arguments);
    this.items = new Items(this._client);
  }
  /**
   * Create a conversation.
   */
  create(body = {}, options) {
    return this._client.post("/conversations", { body, ...options });
  }
  /**
   * Get a conversation
   */
  retrieve(conversationID, options) {
    return this._client.get(path`/conversations/${conversationID}`, options);
  }
  /**
   * Update a conversation
   */
  update(conversationID, body, options) {
    return this._client.post(path`/conversations/${conversationID}`, { body, ...options });
  }
  /**
   * Delete a conversation. Items in the conversation will not be deleted.
   */
  delete(conversationID, options) {
    return this._client.delete(path`/conversations/${conversationID}`, options);
  }
};
Conversations.Items = Items;

// ../../../node_modules/openai/resources/embeddings.mjs
var Embeddings2 = class extends APIResource {
  /**
   * Creates an embedding vector representing the input text.
   *
   * @example
   * ```ts
   * const createEmbeddingResponse =
   *   await client.embeddings.create({
   *     input: 'The quick brown fox jumped over the lazy dog',
   *     model: 'text-embedding-3-small',
   *   });
   * ```
   */
  create(body, options) {
    const hasUserProvidedEncodingFormat = !!body.encoding_format;
    let encoding_format = hasUserProvidedEncodingFormat ? body.encoding_format : "base64";
    if (hasUserProvidedEncodingFormat) {
      loggerFor(this._client).debug("embeddings/user defined encoding_format:", body.encoding_format);
    }
    const response = this._client.post("/embeddings", {
      body: {
        ...body,
        encoding_format
      },
      ...options
    });
    if (hasUserProvidedEncodingFormat) {
      return response;
    }
    loggerFor(this._client).debug("embeddings/decoding base64 embeddings from base64");
    return response._thenUnwrap((response2) => {
      if (response2 && response2.data) {
        response2.data.forEach((embeddingBase64Obj) => {
          const embeddingBase64Str = embeddingBase64Obj.embedding;
          embeddingBase64Obj.embedding = toFloat32Array(embeddingBase64Str);
        });
      }
      return response2;
    });
  }
};

// ../../../node_modules/openai/resources/evals/runs/output-items.mjs
var OutputItems = class extends APIResource {
  /**
   * Get an evaluation run output item by ID.
   */
  retrieve(outputItemID, params, options) {
    const { eval_id, run_id } = params;
    return this._client.get(path`/evals/${eval_id}/runs/${run_id}/output_items/${outputItemID}`, options);
  }
  /**
   * Get a list of output items for an evaluation run.
   */
  list(runID, params, options) {
    const { eval_id, ...query } = params;
    return this._client.getAPIList(path`/evals/${eval_id}/runs/${runID}/output_items`, CursorPage, { query, ...options });
  }
};

// ../../../node_modules/openai/resources/evals/runs/runs.mjs
var Runs2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.outputItems = new OutputItems(this._client);
  }
  /**
   * Kicks off a new run for a given evaluation, specifying the data source, and what
   * model configuration to use to test. The datasource will be validated against the
   * schema specified in the config of the evaluation.
   */
  create(evalID, body, options) {
    return this._client.post(path`/evals/${evalID}/runs`, { body, ...options });
  }
  /**
   * Get an evaluation run by ID.
   */
  retrieve(runID, params, options) {
    const { eval_id } = params;
    return this._client.get(path`/evals/${eval_id}/runs/${runID}`, options);
  }
  /**
   * Get a list of runs for an evaluation.
   */
  list(evalID, query = {}, options) {
    return this._client.getAPIList(path`/evals/${evalID}/runs`, CursorPage, {
      query,
      ...options
    });
  }
  /**
   * Delete an eval run.
   */
  delete(runID, params, options) {
    const { eval_id } = params;
    return this._client.delete(path`/evals/${eval_id}/runs/${runID}`, options);
  }
  /**
   * Cancel an ongoing evaluation run.
   */
  cancel(runID, params, options) {
    const { eval_id } = params;
    return this._client.post(path`/evals/${eval_id}/runs/${runID}`, options);
  }
};
Runs2.OutputItems = OutputItems;

// ../../../node_modules/openai/resources/evals/evals.mjs
var Evals = class extends APIResource {
  constructor() {
    super(...arguments);
    this.runs = new Runs2(this._client);
  }
  /**
   * Create the structure of an evaluation that can be used to test a model's
   * performance. An evaluation is a set of testing criteria and the config for a
   * data source, which dictates the schema of the data used in the evaluation. After
   * creating an evaluation, you can run it on different models and model parameters.
   * We support several types of graders and datasources. For more information, see
   * the [Evals guide](https://platform.openai.com/docs/guides/evals).
   */
  create(body, options) {
    return this._client.post("/evals", { body, ...options });
  }
  /**
   * Get an evaluation by ID.
   */
  retrieve(evalID, options) {
    return this._client.get(path`/evals/${evalID}`, options);
  }
  /**
   * Update certain properties of an evaluation.
   */
  update(evalID, body, options) {
    return this._client.post(path`/evals/${evalID}`, { body, ...options });
  }
  /**
   * List evaluations for a project.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/evals", CursorPage, { query, ...options });
  }
  /**
   * Delete an evaluation.
   */
  delete(evalID, options) {
    return this._client.delete(path`/evals/${evalID}`, options);
  }
};
Evals.Runs = Runs2;

// ../../../node_modules/openai/resources/files.mjs
var Files2 = class extends APIResource {
  /**
   * Upload a file that can be used across various endpoints. Individual files can be
   * up to 512 MB, and each project can store up to 2.5 TB of files in total. There
   * is no organization-wide storage limit.
   *
   * - The Assistants API supports files up to 2 million tokens and of specific file
   *   types. See the
   *   [Assistants Tools guide](https://platform.openai.com/docs/assistants/tools)
   *   for details.
   * - The Fine-tuning API only supports `.jsonl` files. The input also has certain
   *   required formats for fine-tuning
   *   [chat](https://platform.openai.com/docs/api-reference/fine-tuning/chat-input)
   *   or
   *   [completions](https://platform.openai.com/docs/api-reference/fine-tuning/completions-input)
   *   models.
   * - The Batch API only supports `.jsonl` files up to 200 MB in size. The input
   *   also has a specific required
   *   [format](https://platform.openai.com/docs/api-reference/batch/request-input).
   *
   * Please [contact us](https://help.openai.com/) if you need to increase these
   * storage limits.
   */
  create(body, options) {
    return this._client.post("/files", multipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Returns information about a specific file.
   */
  retrieve(fileID, options) {
    return this._client.get(path`/files/${fileID}`, options);
  }
  /**
   * Returns a list of files.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/files", CursorPage, { query, ...options });
  }
  /**
   * Delete a file and remove it from all vector stores.
   */
  delete(fileID, options) {
    return this._client.delete(path`/files/${fileID}`, options);
  }
  /**
   * Returns the contents of the specified file.
   */
  content(fileID, options) {
    return this._client.get(path`/files/${fileID}/content`, {
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __binaryResponse: true
    });
  }
  /**
   * Waits for the given file to be processed, default timeout is 30 mins.
   */
  async waitForProcessing(id, { pollInterval = 5e3, maxWait = 30 * 60 * 1e3 } = {}) {
    const TERMINAL_STATES = /* @__PURE__ */ new Set(["processed", "error", "deleted"]);
    const start = Date.now();
    let file = await this.retrieve(id);
    while (!file.status || !TERMINAL_STATES.has(file.status)) {
      await sleep(pollInterval);
      file = await this.retrieve(id);
      if (Date.now() - start > maxWait) {
        throw new APIConnectionTimeoutError({
          message: `Giving up on waiting for file ${id} to finish processing after ${maxWait} milliseconds.`
        });
      }
    }
    return file;
  }
};

// ../../../node_modules/openai/resources/fine-tuning/methods.mjs
var Methods = class extends APIResource {
};

// ../../../node_modules/openai/resources/fine-tuning/alpha/graders.mjs
var Graders = class extends APIResource {
  /**
   * Run a grader.
   *
   * @example
   * ```ts
   * const response = await client.fineTuning.alpha.graders.run({
   *   grader: {
   *     input: 'input',
   *     name: 'name',
   *     operation: 'eq',
   *     reference: 'reference',
   *     type: 'string_check',
   *   },
   *   model_sample: 'model_sample',
   * });
   * ```
   */
  run(body, options) {
    return this._client.post("/fine_tuning/alpha/graders/run", { body, ...options });
  }
  /**
   * Validate a grader.
   *
   * @example
   * ```ts
   * const response =
   *   await client.fineTuning.alpha.graders.validate({
   *     grader: {
   *       input: 'input',
   *       name: 'name',
   *       operation: 'eq',
   *       reference: 'reference',
   *       type: 'string_check',
   *     },
   *   });
   * ```
   */
  validate(body, options) {
    return this._client.post("/fine_tuning/alpha/graders/validate", { body, ...options });
  }
};

// ../../../node_modules/openai/resources/fine-tuning/alpha/alpha.mjs
var Alpha = class extends APIResource {
  constructor() {
    super(...arguments);
    this.graders = new Graders(this._client);
  }
};
Alpha.Graders = Graders;

// ../../../node_modules/openai/resources/fine-tuning/checkpoints/permissions.mjs
var Permissions = class extends APIResource {
  /**
   * **NOTE:** Calling this endpoint requires an [admin API key](../admin-api-keys).
   *
   * This enables organization owners to share fine-tuned models with other projects
   * in their organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const permissionCreateResponse of client.fineTuning.checkpoints.permissions.create(
   *   'ft:gpt-4o-mini-2024-07-18:org:weather:B7R9VjQd',
   *   { project_ids: ['string'] },
   * )) {
   *   // ...
   * }
   * ```
   */
  create(fineTunedModelCheckpoint, body, options) {
    return this._client.getAPIList(path`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, Page, { body, method: "post", ...options });
  }
  /**
   * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
   *
   * Organization owners can use this endpoint to view all permissions for a
   * fine-tuned model checkpoint.
   *
   * @deprecated Retrieve is deprecated. Please swap to the paginated list method instead.
   */
  retrieve(fineTunedModelCheckpoint, query = {}, options) {
    return this._client.get(path`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, {
      query,
      ...options
    });
  }
  /**
   * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
   *
   * Organization owners can use this endpoint to view all permissions for a
   * fine-tuned model checkpoint.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const permissionListResponse of client.fineTuning.checkpoints.permissions.list(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(fineTunedModelCheckpoint, query = {}, options) {
    return this._client.getAPIList(path`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, ConversationCursorPage, { query, ...options });
  }
  /**
   * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
   *
   * Organization owners can use this endpoint to delete a permission for a
   * fine-tuned model checkpoint.
   *
   * @example
   * ```ts
   * const permission =
   *   await client.fineTuning.checkpoints.permissions.delete(
   *     'cp_zc4Q7MP6XxulcVzj4MZdwsAB',
   *     {
   *       fine_tuned_model_checkpoint:
   *         'ft:gpt-4o-mini-2024-07-18:org:weather:B7R9VjQd',
   *     },
   *   );
   * ```
   */
  delete(permissionID, params, options) {
    const { fine_tuned_model_checkpoint } = params;
    return this._client.delete(path`/fine_tuning/checkpoints/${fine_tuned_model_checkpoint}/permissions/${permissionID}`, options);
  }
};

// ../../../node_modules/openai/resources/fine-tuning/checkpoints/checkpoints.mjs
var Checkpoints = class extends APIResource {
  constructor() {
    super(...arguments);
    this.permissions = new Permissions(this._client);
  }
};
Checkpoints.Permissions = Permissions;

// ../../../node_modules/openai/resources/fine-tuning/jobs/checkpoints.mjs
var Checkpoints2 = class extends APIResource {
  /**
   * List checkpoints for a fine-tuning job.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const fineTuningJobCheckpoint of client.fineTuning.jobs.checkpoints.list(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(fineTuningJobID, query = {}, options) {
    return this._client.getAPIList(path`/fine_tuning/jobs/${fineTuningJobID}/checkpoints`, CursorPage, { query, ...options });
  }
};

// ../../../node_modules/openai/resources/fine-tuning/jobs/jobs.mjs
var Jobs = class extends APIResource {
  constructor() {
    super(...arguments);
    this.checkpoints = new Checkpoints2(this._client);
  }
  /**
   * Creates a fine-tuning job which begins the process of creating a new model from
   * a given dataset.
   *
   * Response includes details of the enqueued job including job status and the name
   * of the fine-tuned models once complete.
   *
   * [Learn more about fine-tuning](https://platform.openai.com/docs/guides/model-optimization)
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.create({
   *   model: 'gpt-4o-mini',
   *   training_file: 'file-abc123',
   * });
   * ```
   */
  create(body, options) {
    return this._client.post("/fine_tuning/jobs", { body, ...options });
  }
  /**
   * Get info about a fine-tuning job.
   *
   * [Learn more about fine-tuning](https://platform.openai.com/docs/guides/model-optimization)
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.retrieve(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * );
   * ```
   */
  retrieve(fineTuningJobID, options) {
    return this._client.get(path`/fine_tuning/jobs/${fineTuningJobID}`, options);
  }
  /**
   * List your organization's fine-tuning jobs
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const fineTuningJob of client.fineTuning.jobs.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/fine_tuning/jobs", CursorPage, { query, ...options });
  }
  /**
   * Immediately cancel a fine-tune job.
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.cancel(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * );
   * ```
   */
  cancel(fineTuningJobID, options) {
    return this._client.post(path`/fine_tuning/jobs/${fineTuningJobID}/cancel`, options);
  }
  /**
   * Get status updates for a fine-tuning job.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const fineTuningJobEvent of client.fineTuning.jobs.listEvents(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * )) {
   *   // ...
   * }
   * ```
   */
  listEvents(fineTuningJobID, query = {}, options) {
    return this._client.getAPIList(path`/fine_tuning/jobs/${fineTuningJobID}/events`, CursorPage, { query, ...options });
  }
  /**
   * Pause a fine-tune job.
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.pause(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * );
   * ```
   */
  pause(fineTuningJobID, options) {
    return this._client.post(path`/fine_tuning/jobs/${fineTuningJobID}/pause`, options);
  }
  /**
   * Resume a fine-tune job.
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.resume(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * );
   * ```
   */
  resume(fineTuningJobID, options) {
    return this._client.post(path`/fine_tuning/jobs/${fineTuningJobID}/resume`, options);
  }
};
Jobs.Checkpoints = Checkpoints2;

// ../../../node_modules/openai/resources/fine-tuning/fine-tuning.mjs
var FineTuning = class extends APIResource {
  constructor() {
    super(...arguments);
    this.methods = new Methods(this._client);
    this.jobs = new Jobs(this._client);
    this.checkpoints = new Checkpoints(this._client);
    this.alpha = new Alpha(this._client);
  }
};
FineTuning.Methods = Methods;
FineTuning.Jobs = Jobs;
FineTuning.Checkpoints = Checkpoints;
FineTuning.Alpha = Alpha;

// ../../../node_modules/openai/resources/graders/grader-models.mjs
var GraderModels = class extends APIResource {
};

// ../../../node_modules/openai/resources/graders/graders.mjs
var Graders2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.graderModels = new GraderModels(this._client);
  }
};
Graders2.GraderModels = GraderModels;

// ../../../node_modules/openai/resources/images.mjs
var Images = class extends APIResource {
  /**
   * Creates a variation of a given image. This endpoint only supports `dall-e-2`.
   *
   * @example
   * ```ts
   * const imagesResponse = await client.images.createVariation({
   *   image: fs.createReadStream('otter.png'),
   * });
   * ```
   */
  createVariation(body, options) {
    return this._client.post("/images/variations", multipartFormRequestOptions({ body, ...options }, this._client));
  }
  edit(body, options) {
    return this._client.post("/images/edits", multipartFormRequestOptions({ body, ...options, stream: body.stream ?? false }, this._client));
  }
  generate(body, options) {
    return this._client.post("/images/generations", { body, ...options, stream: body.stream ?? false });
  }
};

// ../../../node_modules/openai/resources/models.mjs
var Models2 = class extends APIResource {
  /**
   * Retrieves a model instance, providing basic information about the model such as
   * the owner and permissioning.
   */
  retrieve(model, options) {
    return this._client.get(path`/models/${model}`, options);
  }
  /**
   * Lists the currently available models, and provides basic information about each
   * one such as the owner and availability.
   */
  list(options) {
    return this._client.getAPIList("/models", Page, options);
  }
  /**
   * Delete a fine-tuned model. You must have the Owner role in your organization to
   * delete a model.
   */
  delete(model, options) {
    return this._client.delete(path`/models/${model}`, options);
  }
};

// ../../../node_modules/openai/resources/moderations.mjs
var Moderations = class extends APIResource {
  /**
   * Classifies if text and/or image inputs are potentially harmful. Learn more in
   * the [moderation guide](https://platform.openai.com/docs/guides/moderation).
   */
  create(body, options) {
    return this._client.post("/moderations", { body, ...options });
  }
};

// ../../../node_modules/openai/resources/realtime/calls.mjs
var Calls = class extends APIResource {
  /**
   * Accept an incoming SIP call and configure the realtime session that will handle
   * it.
   *
   * @example
   * ```ts
   * await client.realtime.calls.accept('call_id', {
   *   type: 'realtime',
   * });
   * ```
   */
  accept(callID, body, options) {
    return this._client.post(path`/realtime/calls/${callID}/accept`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
  /**
   * End an active Realtime API call, whether it was initiated over SIP or WebRTC.
   *
   * @example
   * ```ts
   * await client.realtime.calls.hangup('call_id');
   * ```
   */
  hangup(callID, options) {
    return this._client.post(path`/realtime/calls/${callID}/hangup`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
  /**
   * Transfer an active SIP call to a new destination using the SIP REFER verb.
   *
   * @example
   * ```ts
   * await client.realtime.calls.refer('call_id', {
   *   target_uri: 'tel:+14155550123',
   * });
   * ```
   */
  refer(callID, body, options) {
    return this._client.post(path`/realtime/calls/${callID}/refer`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
  /**
   * Decline an incoming SIP call by returning a SIP status code to the caller.
   *
   * @example
   * ```ts
   * await client.realtime.calls.reject('call_id');
   * ```
   */
  reject(callID, body = {}, options) {
    return this._client.post(path`/realtime/calls/${callID}/reject`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
};

// ../../../node_modules/openai/resources/realtime/client-secrets.mjs
var ClientSecrets = class extends APIResource {
  /**
   * Create a Realtime client secret with an associated session configuration.
   *
   * Client secrets are short-lived tokens that can be passed to a client app, such
   * as a web frontend or mobile client, which grants access to the Realtime API
   * without leaking your main API key. You can configure a custom TTL for each
   * client secret.
   *
   * You can also attach session configuration options to the client secret, which
   * will be applied to any sessions created using that client secret, but these can
   * also be overridden by the client connection.
   *
   * [Learn more about authentication with client secrets over WebRTC](https://platform.openai.com/docs/guides/realtime-webrtc).
   *
   * Returns the created client secret and the effective session object. The client
   * secret is a string that looks like `ek_1234`.
   *
   * @example
   * ```ts
   * const clientSecret =
   *   await client.realtime.clientSecrets.create();
   * ```
   */
  create(body, options) {
    return this._client.post("/realtime/client_secrets", { body, ...options });
  }
};

// ../../../node_modules/openai/resources/realtime/realtime.mjs
var Realtime2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.clientSecrets = new ClientSecrets(this._client);
    this.calls = new Calls(this._client);
  }
};
Realtime2.ClientSecrets = ClientSecrets;
Realtime2.Calls = Calls;

// ../../../node_modules/openai/lib/ResponsesParser.mjs
function maybeParseResponse(response, params) {
  if (!params || !hasAutoParseableInput2(params)) {
    return {
      ...response,
      output_parsed: null,
      output: response.output.map((item) => {
        if (item.type === "function_call") {
          return {
            ...item,
            parsed_arguments: null
          };
        }
        if (item.type === "message") {
          return {
            ...item,
            content: item.content.map((content) => ({
              ...content,
              parsed: null
            }))
          };
        } else {
          return item;
        }
      })
    };
  }
  return parseResponse(response, params);
}
function parseResponse(response, params) {
  const output = response.output.map((item) => {
    if (item.type === "function_call") {
      return {
        ...item,
        parsed_arguments: parseToolCall2(params, item)
      };
    }
    if (item.type === "message") {
      const content = item.content.map((content2) => {
        if (content2.type === "output_text") {
          return {
            ...content2,
            parsed: parseTextFormat(params, content2.text)
          };
        }
        return content2;
      });
      return {
        ...item,
        content
      };
    }
    return item;
  });
  const parsed = Object.assign({}, response, { output });
  if (!Object.getOwnPropertyDescriptor(response, "output_text")) {
    addOutputText(parsed);
  }
  Object.defineProperty(parsed, "output_parsed", {
    enumerable: true,
    get() {
      for (const output2 of parsed.output) {
        if (output2.type !== "message") {
          continue;
        }
        for (const content of output2.content) {
          if (content.type === "output_text" && content.parsed !== null) {
            return content.parsed;
          }
        }
      }
      return null;
    }
  });
  return parsed;
}
function parseTextFormat(params, content) {
  if (params.text?.format?.type !== "json_schema") {
    return null;
  }
  if ("$parseRaw" in params.text?.format) {
    const text_format = params.text?.format;
    return text_format.$parseRaw(content);
  }
  return JSON.parse(content);
}
function hasAutoParseableInput2(params) {
  if (isAutoParsableResponseFormat(params.text?.format)) {
    return true;
  }
  return false;
}
function isAutoParsableTool2(tool) {
  return tool?.["$brand"] === "auto-parseable-tool";
}
function getInputToolByName(input_tools, name) {
  return input_tools.find((tool) => tool.type === "function" && tool.name === name);
}
function parseToolCall2(params, toolCall) {
  const inputTool = getInputToolByName(params.tools ?? [], toolCall.name);
  return {
    ...toolCall,
    ...toolCall,
    parsed_arguments: isAutoParsableTool2(inputTool) ? inputTool.$parseRaw(toolCall.arguments) : inputTool?.strict ? JSON.parse(toolCall.arguments) : null
  };
}
function addOutputText(rsp) {
  const texts = [];
  for (const output of rsp.output) {
    if (output.type !== "message") {
      continue;
    }
    for (const content of output.content) {
      if (content.type === "output_text") {
        texts.push(content.text);
      }
    }
  }
  rsp.output_text = texts.join("");
}

// ../../../node_modules/openai/lib/responses/ResponseStream.mjs
var _ResponseStream_instances;
var _ResponseStream_params;
var _ResponseStream_currentResponseSnapshot;
var _ResponseStream_finalResponse;
var _ResponseStream_beginRequest;
var _ResponseStream_addEvent;
var _ResponseStream_endRequest;
var _ResponseStream_accumulateResponse;
var ResponseStream = class _ResponseStream extends EventStream2 {
  constructor(params) {
    super();
    _ResponseStream_instances.add(this);
    _ResponseStream_params.set(this, void 0);
    _ResponseStream_currentResponseSnapshot.set(this, void 0);
    _ResponseStream_finalResponse.set(this, void 0);
    __classPrivateFieldSet3(this, _ResponseStream_params, params, "f");
  }
  static createResponse(client, params, options) {
    const runner = new _ResponseStream(params);
    runner._run(() => runner._createOrRetrieveResponse(client, params, {
      ...options,
      headers: { ...options?.headers, "X-Stainless-Helper-Method": "stream" }
    }));
    return runner;
  }
  async _createOrRetrieveResponse(client, params, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    __classPrivateFieldGet3(this, _ResponseStream_instances, "m", _ResponseStream_beginRequest).call(this);
    let stream;
    let starting_after = null;
    if ("response_id" in params) {
      stream = await client.responses.retrieve(params.response_id, { stream: true }, { ...options, signal: this.controller.signal, stream: true });
      starting_after = params.starting_after ?? null;
    } else {
      stream = await client.responses.create({ ...params, stream: true }, { ...options, signal: this.controller.signal });
    }
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet3(this, _ResponseStream_instances, "m", _ResponseStream_addEvent).call(this, event, starting_after);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return __classPrivateFieldGet3(this, _ResponseStream_instances, "m", _ResponseStream_endRequest).call(this);
  }
  [(_ResponseStream_params = /* @__PURE__ */ new WeakMap(), _ResponseStream_currentResponseSnapshot = /* @__PURE__ */ new WeakMap(), _ResponseStream_finalResponse = /* @__PURE__ */ new WeakMap(), _ResponseStream_instances = /* @__PURE__ */ new WeakSet(), _ResponseStream_beginRequest = function _ResponseStream_beginRequest2() {
    if (this.ended)
      return;
    __classPrivateFieldSet3(this, _ResponseStream_currentResponseSnapshot, void 0, "f");
  }, _ResponseStream_addEvent = function _ResponseStream_addEvent2(event, starting_after) {
    if (this.ended)
      return;
    const maybeEmit = (name, event2) => {
      if (starting_after == null || event2.sequence_number > starting_after) {
        this._emit(name, event2);
      }
    };
    const response = __classPrivateFieldGet3(this, _ResponseStream_instances, "m", _ResponseStream_accumulateResponse).call(this, event);
    maybeEmit("event", event);
    switch (event.type) {
      case "response.output_text.delta": {
        const output = response.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === "message") {
          const content = output.content[event.content_index];
          if (!content) {
            throw new OpenAIError(`missing content at index ${event.content_index}`);
          }
          if (content.type !== "output_text") {
            throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
          }
          maybeEmit("response.output_text.delta", {
            ...event,
            snapshot: content.text
          });
        }
        break;
      }
      case "response.function_call_arguments.delta": {
        const output = response.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === "function_call") {
          maybeEmit("response.function_call_arguments.delta", {
            ...event,
            snapshot: output.arguments
          });
        }
        break;
      }
      default:
        maybeEmit(event.type, event);
        break;
    }
  }, _ResponseStream_endRequest = function _ResponseStream_endRequest2() {
    if (this.ended) {
      throw new OpenAIError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = __classPrivateFieldGet3(this, _ResponseStream_currentResponseSnapshot, "f");
    if (!snapshot) {
      throw new OpenAIError(`request ended without sending any events`);
    }
    __classPrivateFieldSet3(this, _ResponseStream_currentResponseSnapshot, void 0, "f");
    const parsedResponse = finalizeResponse(snapshot, __classPrivateFieldGet3(this, _ResponseStream_params, "f"));
    __classPrivateFieldSet3(this, _ResponseStream_finalResponse, parsedResponse, "f");
    return parsedResponse;
  }, _ResponseStream_accumulateResponse = function _ResponseStream_accumulateResponse2(event) {
    let snapshot = __classPrivateFieldGet3(this, _ResponseStream_currentResponseSnapshot, "f");
    if (!snapshot) {
      if (event.type !== "response.created") {
        throw new OpenAIError(`When snapshot hasn't been set yet, expected 'response.created' event, got ${event.type}`);
      }
      snapshot = __classPrivateFieldSet3(this, _ResponseStream_currentResponseSnapshot, event.response, "f");
      return snapshot;
    }
    switch (event.type) {
      case "response.output_item.added": {
        snapshot.output.push(event.item);
        break;
      }
      case "response.content_part.added": {
        const output = snapshot.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        const type = output.type;
        const part = event.part;
        if (type === "message" && part.type !== "reasoning_text") {
          output.content.push(part);
        } else if (type === "reasoning" && part.type === "reasoning_text") {
          if (!output.content) {
            output.content = [];
          }
          output.content.push(part);
        }
        break;
      }
      case "response.output_text.delta": {
        const output = snapshot.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === "message") {
          const content = output.content[event.content_index];
          if (!content) {
            throw new OpenAIError(`missing content at index ${event.content_index}`);
          }
          if (content.type !== "output_text") {
            throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
          }
          content.text += event.delta;
        }
        break;
      }
      case "response.function_call_arguments.delta": {
        const output = snapshot.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === "function_call") {
          output.arguments += event.delta;
        }
        break;
      }
      case "response.reasoning_text.delta": {
        const output = snapshot.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === "reasoning") {
          const content = output.content?.[event.content_index];
          if (!content) {
            throw new OpenAIError(`missing content at index ${event.content_index}`);
          }
          if (content.type !== "reasoning_text") {
            throw new OpenAIError(`expected content to be 'reasoning_text', got ${content.type}`);
          }
          content.text += event.delta;
        }
        break;
      }
      case "response.completed": {
        __classPrivateFieldSet3(this, _ResponseStream_currentResponseSnapshot, event.response, "f");
        break;
      }
    }
    return snapshot;
  }, Symbol.asyncIterator)]() {
    const pushQueue = [];
    const readQueue = [];
    let done = false;
    this.on("event", (event) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
      }
    });
    this.on("end", () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(void 0);
      }
      readQueue.length = 0;
    });
    this.on("abort", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    this.on("error", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    return {
      next: async () => {
        if (!pushQueue.length) {
          if (done) {
            return { value: void 0, done: true };
          }
          return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((event2) => event2 ? { value: event2, done: false } : { value: void 0, done: true });
        }
        const event = pushQueue.shift();
        return { value: event, done: false };
      },
      return: async () => {
        this.abort();
        return { value: void 0, done: true };
      }
    };
  }
  /**
   * @returns a promise that resolves with the final Response, or rejects
   * if an error occurred or the stream ended prematurely without producing a REsponse.
   */
  async finalResponse() {
    await this.done();
    const response = __classPrivateFieldGet3(this, _ResponseStream_finalResponse, "f");
    if (!response)
      throw new OpenAIError("stream ended without producing a ChatCompletion");
    return response;
  }
};
function finalizeResponse(snapshot, params) {
  return maybeParseResponse(snapshot, params);
}

// ../../../node_modules/openai/resources/responses/input-items.mjs
var InputItems = class extends APIResource {
  /**
   * Returns a list of input items for a given response.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const responseItem of client.responses.inputItems.list(
   *   'response_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(responseID, query = {}, options) {
    return this._client.getAPIList(path`/responses/${responseID}/input_items`, CursorPage, { query, ...options });
  }
};

// ../../../node_modules/openai/resources/responses/input-tokens.mjs
var InputTokens = class extends APIResource {
  /**
   * Returns input token counts of the request.
   *
   * Returns an object with `object` set to `response.input_tokens` and an
   * `input_tokens` count.
   *
   * @example
   * ```ts
   * const response = await client.responses.inputTokens.count();
   * ```
   */
  count(body = {}, options) {
    return this._client.post("/responses/input_tokens", { body, ...options });
  }
};

// ../../../node_modules/openai/resources/responses/responses.mjs
var Responses2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.inputItems = new InputItems(this._client);
    this.inputTokens = new InputTokens(this._client);
  }
  create(body, options) {
    return this._client.post("/responses", { body, ...options, stream: body.stream ?? false })._thenUnwrap((rsp) => {
      if ("object" in rsp && rsp.object === "response") {
        addOutputText(rsp);
      }
      return rsp;
    });
  }
  retrieve(responseID, query = {}, options) {
    return this._client.get(path`/responses/${responseID}`, {
      query,
      ...options,
      stream: query?.stream ?? false
    })._thenUnwrap((rsp) => {
      if ("object" in rsp && rsp.object === "response") {
        addOutputText(rsp);
      }
      return rsp;
    });
  }
  /**
   * Deletes a model response with the given ID.
   *
   * @example
   * ```ts
   * await client.responses.delete(
   *   'resp_677efb5139a88190b512bc3fef8e535d',
   * );
   * ```
   */
  delete(responseID, options) {
    return this._client.delete(path`/responses/${responseID}`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
  parse(body, options) {
    return this._client.responses.create(body, options)._thenUnwrap((response) => parseResponse(response, body));
  }
  /**
   * Creates a model response stream
   */
  stream(body, options) {
    return ResponseStream.createResponse(this._client, body, options);
  }
  /**
   * Cancels a model response with the given ID. Only responses created with the
   * `background` parameter set to `true` can be cancelled.
   * [Learn more](https://platform.openai.com/docs/guides/background).
   *
   * @example
   * ```ts
   * const response = await client.responses.cancel(
   *   'resp_677efb5139a88190b512bc3fef8e535d',
   * );
   * ```
   */
  cancel(responseID, options) {
    return this._client.post(path`/responses/${responseID}/cancel`, options);
  }
  /**
   * Compact a conversation. Returns a compacted response object.
   *
   * Learn when and how to compact long-running conversations in the
   * [conversation state guide](https://platform.openai.com/docs/guides/conversation-state#managing-the-context-window).
   * For ZDR-compatible compaction details, see
   * [Compaction (advanced)](https://platform.openai.com/docs/guides/conversation-state#compaction-advanced).
   *
   * @example
   * ```ts
   * const compactedResponse = await client.responses.compact({
   *   model: 'gpt-5.4',
   * });
   * ```
   */
  compact(body, options) {
    return this._client.post("/responses/compact", { body, ...options });
  }
};
Responses2.InputItems = InputItems;
Responses2.InputTokens = InputTokens;

// ../../../node_modules/openai/resources/skills/content.mjs
var Content2 = class extends APIResource {
  /**
   * Download a skill zip bundle by its ID.
   */
  retrieve(skillID, options) {
    return this._client.get(path`/skills/${skillID}/content`, {
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __binaryResponse: true
    });
  }
};

// ../../../node_modules/openai/resources/skills/versions/content.mjs
var Content3 = class extends APIResource {
  /**
   * Download a skill version zip bundle.
   */
  retrieve(version, params, options) {
    const { skill_id } = params;
    return this._client.get(path`/skills/${skill_id}/versions/${version}/content`, {
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __binaryResponse: true
    });
  }
};

// ../../../node_modules/openai/resources/skills/versions/versions.mjs
var Versions = class extends APIResource {
  constructor() {
    super(...arguments);
    this.content = new Content3(this._client);
  }
  /**
   * Create a new immutable skill version.
   */
  create(skillID, body = {}, options) {
    return this._client.post(path`/skills/${skillID}/versions`, maybeMultipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Get a specific skill version.
   */
  retrieve(version, params, options) {
    const { skill_id } = params;
    return this._client.get(path`/skills/${skill_id}/versions/${version}`, options);
  }
  /**
   * List skill versions for a skill.
   */
  list(skillID, query = {}, options) {
    return this._client.getAPIList(path`/skills/${skillID}/versions`, CursorPage, {
      query,
      ...options
    });
  }
  /**
   * Delete a skill version.
   */
  delete(version, params, options) {
    const { skill_id } = params;
    return this._client.delete(path`/skills/${skill_id}/versions/${version}`, options);
  }
};
Versions.Content = Content3;

// ../../../node_modules/openai/resources/skills/skills.mjs
var Skills = class extends APIResource {
  constructor() {
    super(...arguments);
    this.content = new Content2(this._client);
    this.versions = new Versions(this._client);
  }
  /**
   * Create a new skill.
   */
  create(body = {}, options) {
    return this._client.post("/skills", maybeMultipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Get a skill by its ID.
   */
  retrieve(skillID, options) {
    return this._client.get(path`/skills/${skillID}`, options);
  }
  /**
   * Update the default version pointer for a skill.
   */
  update(skillID, body, options) {
    return this._client.post(path`/skills/${skillID}`, { body, ...options });
  }
  /**
   * List all skills for the current project.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/skills", CursorPage, { query, ...options });
  }
  /**
   * Delete a skill by its ID.
   */
  delete(skillID, options) {
    return this._client.delete(path`/skills/${skillID}`, options);
  }
};
Skills.Content = Content2;
Skills.Versions = Versions;

// ../../../node_modules/openai/resources/uploads/parts.mjs
var Parts = class extends APIResource {
  /**
   * Adds a
   * [Part](https://platform.openai.com/docs/api-reference/uploads/part-object) to an
   * [Upload](https://platform.openai.com/docs/api-reference/uploads/object) object.
   * A Part represents a chunk of bytes from the file you are trying to upload.
   *
   * Each Part can be at most 64 MB, and you can add Parts until you hit the Upload
   * maximum of 8 GB.
   *
   * It is possible to add multiple Parts in parallel. You can decide the intended
   * order of the Parts when you
   * [complete the Upload](https://platform.openai.com/docs/api-reference/uploads/complete).
   */
  create(uploadID, body, options) {
    return this._client.post(path`/uploads/${uploadID}/parts`, multipartFormRequestOptions({ body, ...options }, this._client));
  }
};

// ../../../node_modules/openai/resources/uploads/uploads.mjs
var Uploads = class extends APIResource {
  constructor() {
    super(...arguments);
    this.parts = new Parts(this._client);
  }
  /**
   * Creates an intermediate
   * [Upload](https://platform.openai.com/docs/api-reference/uploads/object) object
   * that you can add
   * [Parts](https://platform.openai.com/docs/api-reference/uploads/part-object) to.
   * Currently, an Upload can accept at most 8 GB in total and expires after an hour
   * after you create it.
   *
   * Once you complete the Upload, we will create a
   * [File](https://platform.openai.com/docs/api-reference/files/object) object that
   * contains all the parts you uploaded. This File is usable in the rest of our
   * platform as a regular File object.
   *
   * For certain `purpose` values, the correct `mime_type` must be specified. Please
   * refer to documentation for the
   * [supported MIME types for your use case](https://platform.openai.com/docs/assistants/tools/file-search#supported-files).
   *
   * For guidance on the proper filename extensions for each purpose, please follow
   * the documentation on
   * [creating a File](https://platform.openai.com/docs/api-reference/files/create).
   *
   * Returns the Upload object with status `pending`.
   */
  create(body, options) {
    return this._client.post("/uploads", { body, ...options });
  }
  /**
   * Cancels the Upload. No Parts may be added after an Upload is cancelled.
   *
   * Returns the Upload object with status `cancelled`.
   */
  cancel(uploadID, options) {
    return this._client.post(path`/uploads/${uploadID}/cancel`, options);
  }
  /**
   * Completes the
   * [Upload](https://platform.openai.com/docs/api-reference/uploads/object).
   *
   * Within the returned Upload object, there is a nested
   * [File](https://platform.openai.com/docs/api-reference/files/object) object that
   * is ready to use in the rest of the platform.
   *
   * You can specify the order of the Parts by passing in an ordered list of the Part
   * IDs.
   *
   * The number of bytes uploaded upon completion must match the number of bytes
   * initially specified when creating the Upload object. No Parts may be added after
   * an Upload is completed. Returns the Upload object with status `completed`,
   * including an additional `file` property containing the created usable File
   * object.
   */
  complete(uploadID, body, options) {
    return this._client.post(path`/uploads/${uploadID}/complete`, { body, ...options });
  }
};
Uploads.Parts = Parts;

// ../../../node_modules/openai/lib/Util.mjs
var allSettledWithThrow = async (promises) => {
  const results = await Promise.allSettled(promises);
  const rejected = results.filter((result) => result.status === "rejected");
  if (rejected.length) {
    for (const result of rejected) {
      console.error(result.reason);
    }
    throw new Error(`${rejected.length} promise(s) failed - see the above errors`);
  }
  const values = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      values.push(result.value);
    }
  }
  return values;
};

// ../../../node_modules/openai/resources/vector-stores/file-batches.mjs
var FileBatches = class extends APIResource {
  /**
   * Create a vector store file batch.
   */
  create(vectorStoreID, body, options) {
    return this._client.post(path`/vector_stores/${vectorStoreID}/file_batches`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Retrieves a vector store file batch.
   */
  retrieve(batchID, params, options) {
    const { vector_store_id } = params;
    return this._client.get(path`/vector_stores/${vector_store_id}/file_batches/${batchID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Cancel a vector store file batch. This attempts to cancel the processing of
   * files in this batch as soon as possible.
   */
  cancel(batchID, params, options) {
    const { vector_store_id } = params;
    return this._client.post(path`/vector_stores/${vector_store_id}/file_batches/${batchID}/cancel`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Create a vector store batch and poll until all files have been processed.
   */
  async createAndPoll(vectorStoreId, body, options) {
    const batch = await this.create(vectorStoreId, body);
    return await this.poll(vectorStoreId, batch.id, options);
  }
  /**
   * Returns a list of vector store files in a batch.
   */
  listFiles(batchID, params, options) {
    const { vector_store_id, ...query } = params;
    return this._client.getAPIList(path`/vector_stores/${vector_store_id}/file_batches/${batchID}/files`, CursorPage, { query, ...options, headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]) });
  }
  /**
   * Wait for the given file batch to be processed.
   *
   * Note: this will return even if one of the files failed to process, you need to
   * check batch.file_counts.failed_count to handle this case.
   */
  async poll(vectorStoreID, batchID, options) {
    const headers = buildHeaders([
      options?.headers,
      {
        "X-Stainless-Poll-Helper": "true",
        "X-Stainless-Custom-Poll-Interval": options?.pollIntervalMs?.toString() ?? void 0
      }
    ]);
    while (true) {
      const { data: batch, response } = await this.retrieve(batchID, { vector_store_id: vectorStoreID }, {
        ...options,
        headers
      }).withResponse();
      switch (batch.status) {
        case "in_progress":
          let sleepInterval = 5e3;
          if (options?.pollIntervalMs) {
            sleepInterval = options.pollIntervalMs;
          } else {
            const headerInterval = response.headers.get("openai-poll-after-ms");
            if (headerInterval) {
              const headerIntervalMs = parseInt(headerInterval);
              if (!isNaN(headerIntervalMs)) {
                sleepInterval = headerIntervalMs;
              }
            }
          }
          await sleep(sleepInterval);
          break;
        case "failed":
        case "cancelled":
        case "completed":
          return batch;
      }
    }
  }
  /**
   * Uploads the given files concurrently and then creates a vector store file batch.
   *
   * The concurrency limit is configurable using the `maxConcurrency` parameter.
   */
  async uploadAndPoll(vectorStoreId, { files, fileIds = [] }, options) {
    if (files == null || files.length == 0) {
      throw new Error(`No \`files\` provided to process. If you've already uploaded files you should use \`.createAndPoll()\` instead`);
    }
    const configuredConcurrency = options?.maxConcurrency ?? 5;
    const concurrencyLimit = Math.min(configuredConcurrency, files.length);
    const client = this._client;
    const fileIterator = files.values();
    const allFileIds = [...fileIds];
    async function processFiles(iterator) {
      for (let item of iterator) {
        const fileObj = await client.files.create({ file: item, purpose: "assistants" }, options);
        allFileIds.push(fileObj.id);
      }
    }
    const workers = Array(concurrencyLimit).fill(fileIterator).map(processFiles);
    await allSettledWithThrow(workers);
    return await this.createAndPoll(vectorStoreId, {
      file_ids: allFileIds
    });
  }
};

// ../../../node_modules/openai/resources/vector-stores/files.mjs
var Files3 = class extends APIResource {
  /**
   * Create a vector store file by attaching a
   * [File](https://platform.openai.com/docs/api-reference/files) to a
   * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object).
   */
  create(vectorStoreID, body, options) {
    return this._client.post(path`/vector_stores/${vectorStoreID}/files`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Retrieves a vector store file.
   */
  retrieve(fileID, params, options) {
    const { vector_store_id } = params;
    return this._client.get(path`/vector_stores/${vector_store_id}/files/${fileID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Update attributes on a vector store file.
   */
  update(fileID, params, options) {
    const { vector_store_id, ...body } = params;
    return this._client.post(path`/vector_stores/${vector_store_id}/files/${fileID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Returns a list of vector store files.
   */
  list(vectorStoreID, query = {}, options) {
    return this._client.getAPIList(path`/vector_stores/${vectorStoreID}/files`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Delete a vector store file. This will remove the file from the vector store but
   * the file itself will not be deleted. To delete the file, use the
   * [delete file](https://platform.openai.com/docs/api-reference/files/delete)
   * endpoint.
   */
  delete(fileID, params, options) {
    const { vector_store_id } = params;
    return this._client.delete(path`/vector_stores/${vector_store_id}/files/${fileID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Attach a file to the given vector store and wait for it to be processed.
   */
  async createAndPoll(vectorStoreId, body, options) {
    const file = await this.create(vectorStoreId, body, options);
    return await this.poll(vectorStoreId, file.id, options);
  }
  /**
   * Wait for the vector store file to finish processing.
   *
   * Note: this will return even if the file failed to process, you need to check
   * file.last_error and file.status to handle these cases
   */
  async poll(vectorStoreID, fileID, options) {
    const headers = buildHeaders([
      options?.headers,
      {
        "X-Stainless-Poll-Helper": "true",
        "X-Stainless-Custom-Poll-Interval": options?.pollIntervalMs?.toString() ?? void 0
      }
    ]);
    while (true) {
      const fileResponse = await this.retrieve(fileID, {
        vector_store_id: vectorStoreID
      }, { ...options, headers }).withResponse();
      const file = fileResponse.data;
      switch (file.status) {
        case "in_progress":
          let sleepInterval = 5e3;
          if (options?.pollIntervalMs) {
            sleepInterval = options.pollIntervalMs;
          } else {
            const headerInterval = fileResponse.response.headers.get("openai-poll-after-ms");
            if (headerInterval) {
              const headerIntervalMs = parseInt(headerInterval);
              if (!isNaN(headerIntervalMs)) {
                sleepInterval = headerIntervalMs;
              }
            }
          }
          await sleep(sleepInterval);
          break;
        case "failed":
        case "completed":
          return file;
      }
    }
  }
  /**
   * Upload a file to the `files` API and then attach it to the given vector store.
   *
   * Note the file will be asynchronously processed (you can use the alternative
   * polling helper method to wait for processing to complete).
   */
  async upload(vectorStoreId, file, options) {
    const fileInfo = await this._client.files.create({ file, purpose: "assistants" }, options);
    return this.create(vectorStoreId, { file_id: fileInfo.id }, options);
  }
  /**
   * Add a file to a vector store and poll until processing is complete.
   */
  async uploadAndPoll(vectorStoreId, file, options) {
    const fileInfo = await this.upload(vectorStoreId, file, options);
    return await this.poll(vectorStoreId, fileInfo.id, options);
  }
  /**
   * Retrieve the parsed contents of a vector store file.
   */
  content(fileID, params, options) {
    const { vector_store_id } = params;
    return this._client.getAPIList(path`/vector_stores/${vector_store_id}/files/${fileID}/content`, Page, { ...options, headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]) });
  }
};

// ../../../node_modules/openai/resources/vector-stores/vector-stores.mjs
var VectorStores = class extends APIResource {
  constructor() {
    super(...arguments);
    this.files = new Files3(this._client);
    this.fileBatches = new FileBatches(this._client);
  }
  /**
   * Create a vector store.
   */
  create(body, options) {
    return this._client.post("/vector_stores", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Retrieves a vector store.
   */
  retrieve(vectorStoreID, options) {
    return this._client.get(path`/vector_stores/${vectorStoreID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Modifies a vector store.
   */
  update(vectorStoreID, body, options) {
    return this._client.post(path`/vector_stores/${vectorStoreID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Returns a list of vector stores.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/vector_stores", CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Delete a vector store.
   */
  delete(vectorStoreID, options) {
    return this._client.delete(path`/vector_stores/${vectorStoreID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Search a vector store for relevant chunks based on a query and file attributes
   * filter.
   */
  search(vectorStoreID, body, options) {
    return this._client.getAPIList(path`/vector_stores/${vectorStoreID}/search`, Page, {
      body,
      method: "post",
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
};
VectorStores.Files = Files3;
VectorStores.FileBatches = FileBatches;

// ../../../node_modules/openai/resources/videos.mjs
var Videos = class extends APIResource {
  /**
   * Create a new video generation job from a prompt and optional reference assets.
   */
  create(body, options) {
    return this._client.post("/videos", multipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Fetch the latest metadata for a generated video.
   */
  retrieve(videoID, options) {
    return this._client.get(path`/videos/${videoID}`, options);
  }
  /**
   * List recently generated videos for the current project.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/videos", ConversationCursorPage, { query, ...options });
  }
  /**
   * Permanently delete a completed or failed video and its stored assets.
   */
  delete(videoID, options) {
    return this._client.delete(path`/videos/${videoID}`, options);
  }
  /**
   * Create a character from an uploaded video.
   */
  createCharacter(body, options) {
    return this._client.post("/videos/characters", multipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Download the generated video bytes or a derived preview asset.
   *
   * Streams the rendered video content for the specified video job.
   */
  downloadContent(videoID, query = {}, options) {
    return this._client.get(path`/videos/${videoID}/content`, {
      query,
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __binaryResponse: true
    });
  }
  /**
   * Create a new video generation job by editing a source video or existing
   * generated video.
   */
  edit(body, options) {
    return this._client.post("/videos/edits", multipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Create an extension of a completed video.
   */
  extend(body, options) {
    return this._client.post("/videos/extensions", multipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Fetch a character.
   */
  getCharacter(characterID, options) {
    return this._client.get(path`/videos/characters/${characterID}`, options);
  }
  /**
   * Create a remix of a completed video using a refreshed prompt.
   */
  remix(videoID, body, options) {
    return this._client.post(path`/videos/${videoID}/remix`, maybeMultipartFormRequestOptions({ body, ...options }, this._client));
  }
};

// ../../../node_modules/openai/resources/webhooks/webhooks.mjs
var _Webhooks_instances;
var _Webhooks_validateSecret;
var _Webhooks_getRequiredHeader;
var Webhooks = class extends APIResource {
  constructor() {
    super(...arguments);
    _Webhooks_instances.add(this);
  }
  /**
   * Validates that the given payload was sent by OpenAI and parses the payload.
   */
  async unwrap(payload, headers, secret = this._client.webhookSecret, tolerance = 300) {
    await this.verifySignature(payload, headers, secret, tolerance);
    return JSON.parse(payload);
  }
  /**
   * Validates whether or not the webhook payload was sent by OpenAI.
   *
   * An error will be raised if the webhook payload was not sent by OpenAI.
   *
   * @param payload - The webhook payload
   * @param headers - The webhook headers
   * @param secret - The webhook secret (optional, will use client secret if not provided)
   * @param tolerance - Maximum age of the webhook in seconds (default: 300 = 5 minutes)
   */
  async verifySignature(payload, headers, secret = this._client.webhookSecret, tolerance = 300) {
    if (typeof crypto === "undefined" || typeof crypto.subtle.importKey !== "function" || typeof crypto.subtle.verify !== "function") {
      throw new Error("Webhook signature verification is only supported when the `crypto` global is defined");
    }
    __classPrivateFieldGet3(this, _Webhooks_instances, "m", _Webhooks_validateSecret).call(this, secret);
    const headersObj = buildHeaders([headers]).values;
    const signatureHeader = __classPrivateFieldGet3(this, _Webhooks_instances, "m", _Webhooks_getRequiredHeader).call(this, headersObj, "webhook-signature");
    const timestamp = __classPrivateFieldGet3(this, _Webhooks_instances, "m", _Webhooks_getRequiredHeader).call(this, headersObj, "webhook-timestamp");
    const webhookId = __classPrivateFieldGet3(this, _Webhooks_instances, "m", _Webhooks_getRequiredHeader).call(this, headersObj, "webhook-id");
    const timestampSeconds = parseInt(timestamp, 10);
    if (isNaN(timestampSeconds)) {
      throw new InvalidWebhookSignatureError("Invalid webhook timestamp format");
    }
    const nowSeconds = Math.floor(Date.now() / 1e3);
    if (nowSeconds - timestampSeconds > tolerance) {
      throw new InvalidWebhookSignatureError("Webhook timestamp is too old");
    }
    if (timestampSeconds > nowSeconds + tolerance) {
      throw new InvalidWebhookSignatureError("Webhook timestamp is too new");
    }
    const signatures = signatureHeader.split(" ").map((part) => part.startsWith("v1,") ? part.substring(3) : part);
    const decodedSecret = secret.startsWith("whsec_") ? Buffer.from(secret.replace("whsec_", ""), "base64") : Buffer.from(secret, "utf-8");
    const signedPayload = webhookId ? `${webhookId}.${timestamp}.${payload}` : `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey("raw", decodedSecret, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    for (const signature of signatures) {
      try {
        const signatureBytes = Buffer.from(signature, "base64");
        const isValid = await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(signedPayload));
        if (isValid) {
          return;
        }
      } catch {
        continue;
      }
    }
    throw new InvalidWebhookSignatureError("The given webhook signature does not match the expected signature");
  }
};
_Webhooks_instances = /* @__PURE__ */ new WeakSet(), _Webhooks_validateSecret = function _Webhooks_validateSecret2(secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error(`The webhook secret must either be set using the env var, OPENAI_WEBHOOK_SECRET, on the client class, OpenAI({ webhookSecret: '123' }), or passed to this function`);
  }
}, _Webhooks_getRequiredHeader = function _Webhooks_getRequiredHeader2(headers, name) {
  if (!headers) {
    throw new Error(`Headers are required`);
  }
  const value = headers.get(name);
  if (value === null || value === void 0) {
    throw new Error(`Missing required header: ${name}`);
  }
  return value;
};

// ../../../node_modules/openai/client.mjs
var _OpenAI_instances;
var _a3;
var _OpenAI_encoder;
var _OpenAI_baseURLOverridden;
var OpenAI = class {
  /**
   * API Client for interfacing with the OpenAI API.
   *
   * @param {string | undefined} [opts.apiKey=process.env['OPENAI_API_KEY'] ?? undefined]
   * @param {string | null | undefined} [opts.organization=process.env['OPENAI_ORG_ID'] ?? null]
   * @param {string | null | undefined} [opts.project=process.env['OPENAI_PROJECT_ID'] ?? null]
   * @param {string | null | undefined} [opts.webhookSecret=process.env['OPENAI_WEBHOOK_SECRET'] ?? null]
   * @param {string} [opts.baseURL=process.env['OPENAI_BASE_URL'] ?? https://api.openai.com/v1] - Override the default base URL for the API.
   * @param {number} [opts.timeout=10 minutes] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
   * @param {MergedRequestInit} [opts.fetchOptions] - Additional `RequestInit` options to be passed to `fetch` calls.
   * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
   * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
   * @param {HeadersLike} opts.defaultHeaders - Default headers to include with every request to the API.
   * @param {Record<string, string | undefined>} opts.defaultQuery - Default query parameters to include with every request to the API.
   * @param {boolean} [opts.dangerouslyAllowBrowser=false] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
   */
  constructor({ baseURL = readEnv("OPENAI_BASE_URL"), apiKey = readEnv("OPENAI_API_KEY"), organization = readEnv("OPENAI_ORG_ID") ?? null, project = readEnv("OPENAI_PROJECT_ID") ?? null, webhookSecret = readEnv("OPENAI_WEBHOOK_SECRET") ?? null, ...opts } = {}) {
    _OpenAI_instances.add(this);
    _OpenAI_encoder.set(this, void 0);
    this.completions = new Completions2(this);
    this.chat = new Chat2(this);
    this.embeddings = new Embeddings2(this);
    this.files = new Files2(this);
    this.images = new Images(this);
    this.audio = new Audio(this);
    this.moderations = new Moderations(this);
    this.models = new Models2(this);
    this.fineTuning = new FineTuning(this);
    this.graders = new Graders2(this);
    this.vectorStores = new VectorStores(this);
    this.webhooks = new Webhooks(this);
    this.beta = new Beta2(this);
    this.batches = new Batches(this);
    this.uploads = new Uploads(this);
    this.responses = new Responses2(this);
    this.realtime = new Realtime2(this);
    this.conversations = new Conversations(this);
    this.evals = new Evals(this);
    this.containers = new Containers(this);
    this.skills = new Skills(this);
    this.videos = new Videos(this);
    if (apiKey === void 0) {
      throw new OpenAIError("Missing credentials. Please pass an `apiKey`, or set the `OPENAI_API_KEY` environment variable.");
    }
    const options = {
      apiKey,
      organization,
      project,
      webhookSecret,
      ...opts,
      baseURL: baseURL || `https://api.openai.com/v1`
    };
    if (!options.dangerouslyAllowBrowser && isRunningInBrowser()) {
      throw new OpenAIError("It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\nIf you understand the risks and have appropriate mitigations in place,\nyou can set the `dangerouslyAllowBrowser` option to `true`, e.g.,\n\nnew OpenAI({ apiKey, dangerouslyAllowBrowser: true });\n\nhttps://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety\n");
    }
    this.baseURL = options.baseURL;
    this.timeout = options.timeout ?? _a3.DEFAULT_TIMEOUT;
    this.logger = options.logger ?? console;
    const defaultLogLevel = "warn";
    this.logLevel = defaultLogLevel;
    this.logLevel = parseLogLevel(options.logLevel, "ClientOptions.logLevel", this) ?? parseLogLevel(readEnv("OPENAI_LOG"), "process.env['OPENAI_LOG']", this) ?? defaultLogLevel;
    this.fetchOptions = options.fetchOptions;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetch = options.fetch ?? getDefaultFetch();
    __classPrivateFieldSet3(this, _OpenAI_encoder, FallbackEncoder, "f");
    this._options = options;
    this.apiKey = typeof apiKey === "string" ? apiKey : "Missing Key";
    this.organization = organization;
    this.project = project;
    this.webhookSecret = webhookSecret;
  }
  /**
   * Create a new client instance re-using the same options given to the current client with optional overriding.
   */
  withOptions(options) {
    const client = new this.constructor({
      ...this._options,
      baseURL: this.baseURL,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
      logger: this.logger,
      logLevel: this.logLevel,
      fetch: this.fetch,
      fetchOptions: this.fetchOptions,
      apiKey: this.apiKey,
      organization: this.organization,
      project: this.project,
      webhookSecret: this.webhookSecret,
      ...options
    });
    return client;
  }
  defaultQuery() {
    return this._options.defaultQuery;
  }
  validateHeaders({ values, nulls }) {
    return;
  }
  async authHeaders(opts) {
    return buildHeaders([{ Authorization: `Bearer ${this.apiKey}` }]);
  }
  stringifyQuery(query) {
    return stringifyQuery(query);
  }
  getUserAgent() {
    return `${this.constructor.name}/JS ${VERSION}`;
  }
  defaultIdempotencyKey() {
    return `stainless-node-retry-${uuid4()}`;
  }
  makeStatusError(status, error, message, headers) {
    return APIError.generate(status, error, message, headers);
  }
  async _callApiKey() {
    const apiKey = this._options.apiKey;
    if (typeof apiKey !== "function")
      return false;
    let token;
    try {
      token = await apiKey();
    } catch (err) {
      if (err instanceof OpenAIError)
        throw err;
      throw new OpenAIError(
        `Failed to get token from 'apiKey' function: ${err.message}`,
        // @ts-ignore
        { cause: err }
      );
    }
    if (typeof token !== "string" || !token) {
      throw new OpenAIError(`Expected 'apiKey' function argument to return a string but it returned ${token}`);
    }
    this.apiKey = token;
    return true;
  }
  buildURL(path2, query, defaultBaseURL) {
    const baseURL = !__classPrivateFieldGet3(this, _OpenAI_instances, "m", _OpenAI_baseURLOverridden).call(this) && defaultBaseURL || this.baseURL;
    const url = isAbsoluteURL(path2) ? new URL(path2) : new URL(baseURL + (baseURL.endsWith("/") && path2.startsWith("/") ? path2.slice(1) : path2));
    const defaultQuery = this.defaultQuery();
    const pathQuery = Object.fromEntries(url.searchParams);
    if (!isEmptyObj(defaultQuery) || !isEmptyObj(pathQuery)) {
      query = { ...pathQuery, ...defaultQuery, ...query };
    }
    if (typeof query === "object" && query && !Array.isArray(query)) {
      url.search = this.stringifyQuery(query);
    }
    return url.toString();
  }
  /**
   * Used as a callback for mutating the given `FinalRequestOptions` object.
   */
  async prepareOptions(options) {
    await this._callApiKey();
  }
  /**
   * Used as a callback for mutating the given `RequestInit` object.
   *
   * This is useful for cases where you want to add certain headers based off of
   * the request properties, e.g. `method` or `url`.
   */
  async prepareRequest(request, { url, options }) {
  }
  get(path2, opts) {
    return this.methodRequest("get", path2, opts);
  }
  post(path2, opts) {
    return this.methodRequest("post", path2, opts);
  }
  patch(path2, opts) {
    return this.methodRequest("patch", path2, opts);
  }
  put(path2, opts) {
    return this.methodRequest("put", path2, opts);
  }
  delete(path2, opts) {
    return this.methodRequest("delete", path2, opts);
  }
  methodRequest(method, path2, opts) {
    return this.request(Promise.resolve(opts).then((opts2) => {
      return { method, path: path2, ...opts2 };
    }));
  }
  request(options, remainingRetries = null) {
    return new APIPromise2(this, this.makeRequest(options, remainingRetries, void 0));
  }
  async makeRequest(optionsInput, retriesRemaining, retryOfRequestLogID) {
    const options = await optionsInput;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    if (retriesRemaining == null) {
      retriesRemaining = maxRetries;
    }
    await this.prepareOptions(options);
    const { req, url, timeout } = await this.buildRequest(options, {
      retryCount: maxRetries - retriesRemaining
    });
    await this.prepareRequest(req, { url, options });
    const requestLogID = "log_" + (Math.random() * (1 << 24) | 0).toString(16).padStart(6, "0");
    const retryLogStr = retryOfRequestLogID === void 0 ? "" : `, retryOf: ${retryOfRequestLogID}`;
    const startTime = Date.now();
    loggerFor(this).debug(`[${requestLogID}] sending request`, formatRequestDetails({
      retryOfRequestLogID,
      method: options.method,
      url,
      options,
      headers: req.headers
    }));
    if (options.signal?.aborted) {
      throw new APIUserAbortError();
    }
    const controller = new AbortController();
    const response = await this.fetchWithTimeout(url, req, timeout, controller).catch(castToError);
    const headersTime = Date.now();
    if (response instanceof globalThis.Error) {
      const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;
      if (options.signal?.aborted) {
        throw new APIUserAbortError();
      }
      const isTimeout = isAbortError2(response) || /timed? ?out/i.test(String(response) + ("cause" in response ? String(response.cause) : ""));
      if (retriesRemaining) {
        loggerFor(this).info(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} - ${retryMessage}`);
        loggerFor(this).debug(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} (${retryMessage})`, formatRequestDetails({
          retryOfRequestLogID,
          url,
          durationMs: headersTime - startTime,
          message: response.message
        }));
        return this.retryRequest(options, retriesRemaining, retryOfRequestLogID ?? requestLogID);
      }
      loggerFor(this).info(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} - error; no more retries left`);
      loggerFor(this).debug(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} (error; no more retries left)`, formatRequestDetails({
        retryOfRequestLogID,
        url,
        durationMs: headersTime - startTime,
        message: response.message
      }));
      if (isTimeout) {
        throw new APIConnectionTimeoutError();
      }
      throw new APIConnectionError({ cause: response });
    }
    const specialHeaders = [...response.headers.entries()].filter(([name]) => name === "x-request-id").map(([name, value]) => ", " + name + ": " + JSON.stringify(value)).join("");
    const responseInfo = `[${requestLogID}${retryLogStr}${specialHeaders}] ${req.method} ${url} ${response.ok ? "succeeded" : "failed"} with status ${response.status} in ${headersTime - startTime}ms`;
    if (!response.ok) {
      const shouldRetry = await this.shouldRetry(response);
      if (retriesRemaining && shouldRetry) {
        const retryMessage2 = `retrying, ${retriesRemaining} attempts remaining`;
        await CancelReadableStream(response.body);
        loggerFor(this).info(`${responseInfo} - ${retryMessage2}`);
        loggerFor(this).debug(`[${requestLogID}] response error (${retryMessage2})`, formatRequestDetails({
          retryOfRequestLogID,
          url: response.url,
          status: response.status,
          headers: response.headers,
          durationMs: headersTime - startTime
        }));
        return this.retryRequest(options, retriesRemaining, retryOfRequestLogID ?? requestLogID, response.headers);
      }
      const retryMessage = shouldRetry ? `error; no more retries left` : `error; not retryable`;
      loggerFor(this).info(`${responseInfo} - ${retryMessage}`);
      const errText = await response.text().catch((err2) => castToError(err2).message);
      const errJSON = safeJSON(errText);
      const errMessage = errJSON ? void 0 : errText;
      loggerFor(this).debug(`[${requestLogID}] response error (${retryMessage})`, formatRequestDetails({
        retryOfRequestLogID,
        url: response.url,
        status: response.status,
        headers: response.headers,
        message: errMessage,
        durationMs: Date.now() - startTime
      }));
      const err = this.makeStatusError(response.status, errJSON, errMessage, response.headers);
      throw err;
    }
    loggerFor(this).info(responseInfo);
    loggerFor(this).debug(`[${requestLogID}] response start`, formatRequestDetails({
      retryOfRequestLogID,
      url: response.url,
      status: response.status,
      headers: response.headers,
      durationMs: headersTime - startTime
    }));
    return { response, options, controller, requestLogID, retryOfRequestLogID, startTime };
  }
  getAPIList(path2, Page2, opts) {
    return this.requestAPIList(Page2, opts && "then" in opts ? opts.then((opts2) => ({ method: "get", path: path2, ...opts2 })) : { method: "get", path: path2, ...opts });
  }
  requestAPIList(Page2, options) {
    const request = this.makeRequest(options, null, void 0);
    return new PagePromise(this, request, Page2);
  }
  async fetchWithTimeout(url, init, ms, controller) {
    const { signal, method, ...options } = init || {};
    const abort = this._makeAbort(controller);
    if (signal)
      signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, ms);
    const isReadableBody = globalThis.ReadableStream && options.body instanceof globalThis.ReadableStream || typeof options.body === "object" && options.body !== null && Symbol.asyncIterator in options.body;
    const fetchOptions = {
      signal: controller.signal,
      ...isReadableBody ? { duplex: "half" } : {},
      method: "GET",
      ...options
    };
    if (method) {
      fetchOptions.method = method.toUpperCase();
    }
    try {
      return await this.fetch.call(void 0, url, fetchOptions);
    } finally {
      clearTimeout(timeout);
    }
  }
  async shouldRetry(response) {
    const shouldRetryHeader = response.headers.get("x-should-retry");
    if (shouldRetryHeader === "true")
      return true;
    if (shouldRetryHeader === "false")
      return false;
    if (response.status === 408)
      return true;
    if (response.status === 409)
      return true;
    if (response.status === 429)
      return true;
    if (response.status >= 500)
      return true;
    return false;
  }
  async retryRequest(options, retriesRemaining, requestLogID, responseHeaders) {
    let timeoutMillis;
    const retryAfterMillisHeader = responseHeaders?.get("retry-after-ms");
    if (retryAfterMillisHeader) {
      const timeoutMs = parseFloat(retryAfterMillisHeader);
      if (!Number.isNaN(timeoutMs)) {
        timeoutMillis = timeoutMs;
      }
    }
    const retryAfterHeader = responseHeaders?.get("retry-after");
    if (retryAfterHeader && !timeoutMillis) {
      const timeoutSeconds = parseFloat(retryAfterHeader);
      if (!Number.isNaN(timeoutSeconds)) {
        timeoutMillis = timeoutSeconds * 1e3;
      } else {
        timeoutMillis = Date.parse(retryAfterHeader) - Date.now();
      }
    }
    if (timeoutMillis === void 0) {
      const maxRetries = options.maxRetries ?? this.maxRetries;
      timeoutMillis = this.calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries);
    }
    await sleep(timeoutMillis);
    return this.makeRequest(options, retriesRemaining - 1, requestLogID);
  }
  calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries) {
    const initialRetryDelay = 0.5;
    const maxRetryDelay = 8;
    const numRetries = maxRetries - retriesRemaining;
    const sleepSeconds = Math.min(initialRetryDelay * Math.pow(2, numRetries), maxRetryDelay);
    const jitter = 1 - Math.random() * 0.25;
    return sleepSeconds * jitter * 1e3;
  }
  async buildRequest(inputOptions, { retryCount = 0 } = {}) {
    const options = { ...inputOptions };
    const { method, path: path2, query, defaultBaseURL } = options;
    const url = this.buildURL(path2, query, defaultBaseURL);
    if ("timeout" in options)
      validatePositiveInteger("timeout", options.timeout);
    options.timeout = options.timeout ?? this.timeout;
    const { bodyHeaders, body } = this.buildBody({ options });
    const reqHeaders = await this.buildHeaders({ options: inputOptions, method, bodyHeaders, retryCount });
    const req = {
      method,
      headers: reqHeaders,
      ...options.signal && { signal: options.signal },
      ...globalThis.ReadableStream && body instanceof globalThis.ReadableStream && { duplex: "half" },
      ...body && { body },
      ...this.fetchOptions ?? {},
      ...options.fetchOptions ?? {}
    };
    return { req, url, timeout: options.timeout };
  }
  async buildHeaders({ options, method, bodyHeaders, retryCount }) {
    let idempotencyHeaders = {};
    if (this.idempotencyHeader && method !== "get") {
      if (!options.idempotencyKey)
        options.idempotencyKey = this.defaultIdempotencyKey();
      idempotencyHeaders[this.idempotencyHeader] = options.idempotencyKey;
    }
    const headers = buildHeaders([
      idempotencyHeaders,
      {
        Accept: "application/json",
        "User-Agent": this.getUserAgent(),
        "X-Stainless-Retry-Count": String(retryCount),
        ...options.timeout ? { "X-Stainless-Timeout": String(Math.trunc(options.timeout / 1e3)) } : {},
        ...getPlatformHeaders(),
        "OpenAI-Organization": this.organization,
        "OpenAI-Project": this.project
      },
      await this.authHeaders(options),
      this._options.defaultHeaders,
      bodyHeaders,
      options.headers
    ]);
    this.validateHeaders(headers);
    return headers.values;
  }
  _makeAbort(controller) {
    return () => controller.abort();
  }
  buildBody({ options: { body, headers: rawHeaders } }) {
    if (!body) {
      return { bodyHeaders: void 0, body: void 0 };
    }
    const headers = buildHeaders([rawHeaders]);
    if (
      // Pass raw type verbatim
      ArrayBuffer.isView(body) || body instanceof ArrayBuffer || body instanceof DataView || typeof body === "string" && // Preserve legacy string encoding behavior for now
      headers.values.has("content-type") || // `Blob` is superset of `File`
      globalThis.Blob && body instanceof globalThis.Blob || // `FormData` -> `multipart/form-data`
      body instanceof FormData || // `URLSearchParams` -> `application/x-www-form-urlencoded`
      body instanceof URLSearchParams || // Send chunked stream (each chunk has own `length`)
      globalThis.ReadableStream && body instanceof globalThis.ReadableStream
    ) {
      return { bodyHeaders: void 0, body };
    } else if (typeof body === "object" && (Symbol.asyncIterator in body || Symbol.iterator in body && "next" in body && typeof body.next === "function")) {
      return { bodyHeaders: void 0, body: ReadableStreamFrom(body) };
    } else if (typeof body === "object" && headers.values.get("content-type") === "application/x-www-form-urlencoded") {
      return {
        bodyHeaders: { "content-type": "application/x-www-form-urlencoded" },
        body: this.stringifyQuery(body)
      };
    } else {
      return __classPrivateFieldGet3(this, _OpenAI_encoder, "f").call(this, { body, headers });
    }
  }
};
_a3 = OpenAI, _OpenAI_encoder = /* @__PURE__ */ new WeakMap(), _OpenAI_instances = /* @__PURE__ */ new WeakSet(), _OpenAI_baseURLOverridden = function _OpenAI_baseURLOverridden2() {
  return this.baseURL !== "https://api.openai.com/v1";
};
OpenAI.OpenAI = _a3;
OpenAI.DEFAULT_TIMEOUT = 6e5;
OpenAI.OpenAIError = OpenAIError;
OpenAI.APIError = APIError;
OpenAI.APIConnectionError = APIConnectionError;
OpenAI.APIConnectionTimeoutError = APIConnectionTimeoutError;
OpenAI.APIUserAbortError = APIUserAbortError;
OpenAI.NotFoundError = NotFoundError;
OpenAI.ConflictError = ConflictError;
OpenAI.RateLimitError = RateLimitError;
OpenAI.BadRequestError = BadRequestError;
OpenAI.AuthenticationError = AuthenticationError;
OpenAI.InternalServerError = InternalServerError;
OpenAI.PermissionDeniedError = PermissionDeniedError;
OpenAI.UnprocessableEntityError = UnprocessableEntityError;
OpenAI.InvalidWebhookSignatureError = InvalidWebhookSignatureError;
OpenAI.toFile = toFile;
OpenAI.Completions = Completions2;
OpenAI.Chat = Chat2;
OpenAI.Embeddings = Embeddings2;
OpenAI.Files = Files2;
OpenAI.Images = Images;
OpenAI.Audio = Audio;
OpenAI.Moderations = Moderations;
OpenAI.Models = Models2;
OpenAI.FineTuning = FineTuning;
OpenAI.Graders = Graders2;
OpenAI.VectorStores = VectorStores;
OpenAI.Webhooks = Webhooks;
OpenAI.Beta = Beta2;
OpenAI.Batches = Batches;
OpenAI.Uploads = Uploads;
OpenAI.Responses = Responses2;
OpenAI.Realtime = Realtime2;
OpenAI.Conversations = Conversations;
OpenAI.Evals = Evals;
OpenAI.Containers = Containers;
OpenAI.Skills = Skills;
OpenAI.Videos = Videos;

// node_modules/@quilltap/plugin-utils/dist/index.mjs
var import_fs = require("fs");
function parseOpenAIToolCalls(response) {
  const toolCalls = [];
  try {
    const resp = response;
    let toolCallsArray = resp?.tool_calls;
    if (!toolCallsArray) {
      toolCallsArray = resp?.toolCalls;
    }
    if (!toolCallsArray) {
      const choices = resp?.choices;
      toolCallsArray = choices?.[0]?.message?.tool_calls || choices?.[0]?.message?.toolCalls;
    }
    if (!toolCallsArray) {
      const choices = resp?.choices;
      toolCallsArray = choices?.[0]?.delta?.tool_calls || choices?.[0]?.delta?.toolCalls;
    }
    if (toolCallsArray && Array.isArray(toolCallsArray) && toolCallsArray.length > 0) {
      for (const toolCall of toolCallsArray) {
        const tc = toolCall;
        if (tc.type === "function" && tc.function) {
          const argsStr = tc.function.arguments || "{}";
          const trimmed = argsStr.trim();
          if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
            continue;
          }
          try {
            toolCalls.push({
              name: tc.function.name,
              arguments: JSON.parse(argsStr),
              callId: tc.id || void 0
            });
          } catch {
            continue;
          }
        }
      }
    }
  } catch (error) {
    console.error("[plugin-utils] Error parsing OpenAI tool calls:", error);
  }
  return toolCalls;
}
function getCoreLoggerFactory() {
  return globalThis.__quilltap_logger_factory ?? null;
}
function createConsoleLoggerWithChild(prefix, minLevel = "debug", baseContext = {}) {
  const levels = ["debug", "info", "warn", "error"];
  const shouldLog = (level) => levels.indexOf(level) >= levels.indexOf(minLevel);
  const formatContext = (context) => {
    const merged = { ...baseContext, ...context };
    const entries = Object.entries(merged).filter(([key]) => key !== "context").map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ");
    return entries ? ` ${entries}` : "";
  };
  const logger4 = {
    debug: (message, context) => {
      if (shouldLog("debug")) {
        console.debug(`[${prefix}] ${message}${formatContext(context)}`);
      }
    },
    info: (message, context) => {
      if (shouldLog("info")) {
        console.info(`[${prefix}] ${message}${formatContext(context)}`);
      }
    },
    warn: (message, context) => {
      if (shouldLog("warn")) {
        console.warn(`[${prefix}] ${message}${formatContext(context)}`);
      }
    },
    error: (message, context, error) => {
      if (shouldLog("error")) {
        console.error(
          `[${prefix}] ${message}${formatContext(context)}`,
          error ? `
${error.stack || error.message}` : ""
        );
      }
    },
    child: (additionalContext) => {
      return createConsoleLoggerWithChild(prefix, minLevel, {
        ...baseContext,
        ...additionalContext
      });
    }
  };
  return logger4;
}
function createPluginLogger(pluginName, minLevel = "debug") {
  const coreFactory = getCoreLoggerFactory();
  if (coreFactory) {
    return coreFactory(pluginName);
  }
  return createConsoleLoggerWithChild(pluginName, minLevel);
}
var GLOBAL_VERSION_KEY = "__quilltap_app_version";
function getQuilltapVersion() {
  const version = globalThis[GLOBAL_VERSION_KEY];
  return typeof version === "string" ? version : "unknown";
}
function getQuilltapUserAgent() {
  return `Quilltap/${getQuilltapVersion()}`;
}
var rewriteLogger = createPluginLogger("host-rewrite");

// provider.ts
var logger = createPluginLogger("qtap-plugin-openrouter");
var OpenRouterProvider = class {
  constructor() {
    this.supportsFileAttachments = false;
    // Model-dependent, conservative default
    this.supportedMimeTypes = [];
    this.supportsImageGeneration = true;
    this.supportsWebSearch = true;
  }
  /**
   * Helper to collect attachment failures
   * OpenRouter proxies to many models, file support is model-dependent
   */
  collectAttachmentFailures(params) {
    const failed = [];
    for (const msg of params.messages) {
      if (msg.attachments) {
        for (const attachment of msg.attachments) {
          failed.push({
            id: attachment.id,
            error: "OpenRouter file attachment support depends on model (not yet implemented)"
          });
        }
      }
    }
    return { sent: [], failed };
  }
  async sendMessage(params, apiKey) {
    const attachmentResults = this.collectAttachmentFailures(params);
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || "http://localhost:3000",
      xTitle: getQuilltapUserAgent()
    });
    const messages = params.messages.filter((m) => !(m.role === "tool" && !m.toolCallId)).map((m) => {
      if (m.role === "tool" && m.toolCallId) {
        return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: tc.type, function: tc.function }))
        };
      }
      return {
        role: m.role,
        content: m.content
      };
    });
    const requestParams = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens ?? 4096,
      topP: params.topP ?? 1,
      stop: params.stop,
      stream: false
    };
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools;
      requestParams.toolChoice = "auto";
    }
    if (params.webSearchEnabled) {
      requestParams.plugins = [{ id: "web", maxResults: 5 }];
    }
    if (params.responseFormat) {
      if (params.responseFormat.type === "json_schema" && params.responseFormat.jsonSchema) {
        requestParams.responseFormat = {
          type: "json_schema",
          jsonSchema: {
            name: params.responseFormat.jsonSchema.name,
            strict: params.responseFormat.jsonSchema.strict ?? true,
            schema: params.responseFormat.jsonSchema.schema
          }
        };
      } else if (params.responseFormat.type !== "text") {
        requestParams.responseFormat = { type: params.responseFormat.type };
      }
    }
    const profileParams = params.profileParameters;
    if (profileParams?.fallbackModels?.length) {
      requestParams.models = [params.model, ...profileParams.fallbackModels];
      requestParams.route = "fallback";
      delete requestParams.model;
    }
    const providerPrefs = profileParams?.providerPreferences;
    if (providerPrefs) {
      requestParams.provider = {};
      if (providerPrefs.order) requestParams.provider.order = providerPrefs.order;
      if (providerPrefs.allowFallbacks !== void 0) requestParams.provider.allowFallbacks = providerPrefs.allowFallbacks;
      if (providerPrefs.requireParameters) requestParams.provider.requireParameters = providerPrefs.requireParameters;
      if (providerPrefs.dataCollection) requestParams.provider.dataCollection = providerPrefs.dataCollection;
      if (providerPrefs.ignore) requestParams.provider.ignore = providerPrefs.ignore;
      if (providerPrefs.only) requestParams.provider.only = providerPrefs.only;
    }
    const response = await client.chat.send({
      chatGenerationParams: requestParams
    });
    const choice = response.choices[0];
    const content = choice.message.content;
    const contentStr = typeof content === "string" ? content : "";
    const usageAny = response.usage;
    const cacheUsage = usageAny?.cachedTokens || usageAny?.cacheDiscount ? {
      cachedTokens: usageAny.cachedTokens,
      cacheDiscount: usageAny.cacheDiscount,
      cacheCreationInputTokens: usageAny.cacheCreationInputTokens,
      cacheReadInputTokens: usageAny.cacheReadInputTokens
    } : void 0;
    return {
      content: contentStr,
      finishReason: choice.finishReason || "stop",
      usage: {
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
        totalTokens: response.usage?.totalTokens ?? 0
      },
      raw: response,
      attachmentResults,
      cacheUsage
    };
  }
  async *streamMessage(params, apiKey) {
    const attachmentResults = this.collectAttachmentFailures(params);
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || "http://localhost:3000",
      xTitle: getQuilltapUserAgent()
    });
    const messages = params.messages.filter((m) => !(m.role === "tool" && !m.toolCallId)).map((m) => {
      if (m.role === "tool" && m.toolCallId) {
        return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: tc.type, function: tc.function }))
        };
      }
      return {
        role: m.role,
        content: m.content
      };
    });
    const input = fromChatMessages(messages);
    const requestParams = {
      model: params.model,
      input,
      temperature: params.temperature ?? 0.7,
      maxOutputTokens: params.maxTokens ?? 4096,
      topP: params.topP ?? 1
    };
    const hasTools = params.tools && params.tools.length > 0;
    if (hasTools) {
      yield* this.streamWithTools(params, apiKey, attachmentResults);
      return;
    }
    if (params.webSearchEnabled) {
      requestParams.tools = requestParams.tools || [];
      requestParams.tools.push({ type: "web_search_preview" });
    }
    if (params.responseFormat) {
      if (params.responseFormat.type === "json_schema" && params.responseFormat.jsonSchema) {
        requestParams.text = {
          format: {
            type: "json_schema",
            jsonSchema: {
              name: params.responseFormat.jsonSchema.name,
              strict: params.responseFormat.jsonSchema.strict ?? true,
              schema: params.responseFormat.jsonSchema.schema
            }
          }
        };
      } else if (params.responseFormat.type === "json_object") {
        requestParams.text = { format: { type: "json_object" } };
      }
    }
    const profileParams = params.profileParameters;
    if (profileParams?.fallbackModels?.length) {
      requestParams.models = [params.model, ...profileParams.fallbackModels];
      delete requestParams.model;
    }
    const providerPrefs = profileParams?.providerPreferences;
    if (providerPrefs) {
      requestParams.provider = {};
      if (providerPrefs.order) requestParams.provider.order = providerPrefs.order;
      if (providerPrefs.allowFallbacks !== void 0) requestParams.provider.allowFallbacks = providerPrefs.allowFallbacks;
      if (providerPrefs.requireParameters) requestParams.provider.requireParameters = providerPrefs.requireParameters;
      if (providerPrefs.dataCollection) requestParams.provider.dataCollection = providerPrefs.dataCollection;
      if (providerPrefs.ignore) requestParams.provider.ignore = providerPrefs.ignore;
      if (providerPrefs.only) requestParams.provider.only = providerPrefs.only;
    }
    const result = client.callModel(requestParams);
    for await (const textDelta of result.getTextStream()) {
      if (textDelta) {
        yield {
          content: textDelta,
          done: false
        };
      }
    }
    let response;
    try {
      response = await result.getResponse();
    } catch (error) {
      logger.error("Failed to get response after stream", {
        context: "OpenRouterProvider.streamMessage"
      }, error instanceof Error ? error : void 0);
      yield {
        content: "",
        done: true,
        attachmentResults
      };
      return;
    }
    const usage = response.usage ? {
      promptTokens: response.usage.inputTokens ?? 0,
      completionTokens: response.usage.outputTokens ?? 0,
      totalTokens: (response.usage.inputTokens ?? 0) + (response.usage.outputTokens ?? 0)
    } : void 0;
    const responseUsage = response.usage;
    const cacheUsage = responseUsage?.cachedTokens || responseUsage?.cacheDiscount ? {
      cachedTokens: responseUsage.cachedTokens,
      cacheDiscount: responseUsage.cacheDiscount,
      cacheCreationInputTokens: responseUsage.cacheCreationInputTokens,
      cacheReadInputTokens: responseUsage.cacheReadInputTokens
    } : void 0;
    const toolCalls = response.output?.filter((item) => item.type === "function_call").map((item) => ({
      id: item.callId || item.id,
      type: "function",
      function: {
        name: item.name,
        arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments)
      }
    }));
    const rawResponse = {
      choices: [{
        finishReason: response.status === "completed" ? "stop" : response.status,
        delta: {
          toolCalls: toolCalls?.length ? toolCalls : void 0
        }
      }],
      usage: response.usage,
      // Include full response for debugging
      _openResponsesResponse: response
    };
    yield {
      content: "",
      done: true,
      usage,
      attachmentResults,
      rawResponse,
      cacheUsage
    };
  }
  /**
   * Stream with tools using direct API call
   *
   * The OpenRouter SDK's callModel expects Zod schemas for tool inputSchema,
   * but Quilltap provides tools with JSON Schema in parameters.
   * This method bypasses the SDK and calls the OpenRouter API directly.
   */
  async *streamWithTools(params, apiKey, attachmentResults) {
    const messages = params.messages.filter((m) => !(m.role === "tool" && !m.toolCallId)).map((m) => {
      if (m.role === "tool" && m.toolCallId) {
        return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: tc.type, function: tc.function }))
        };
      }
      return {
        role: m.role,
        content: m.content
      };
    });
    const tools = params.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.function?.name || tool.name,
        description: tool.function?.description || tool.description,
        parameters: tool.function?.parameters || tool.parameters
      }
    }));
    const body = {
      model: params.model,
      messages,
      tools,
      tool_choice: "auto",
      stream: true,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
      top_p: params.topP ?? 1
    };
    if (params.webSearchEnabled) {
      body.tools.push({ type: "web_search_preview" });
    }
    const profileParams = params.profileParameters;
    if (profileParams?.fallbackModels?.length) {
      body.route = "fallback";
    }
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": process.env.BASE_URL || "http://localhost:3000",
          "X-Title": "Quilltap",
          "User-Agent": getQuilltapUserAgent()
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const errorText = await response.text();
        logger.error("OpenRouter API error", {
          context: "OpenRouterProvider.streamWithTools",
          status: response.status,
          error: errorText
        });
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let usage;
      let toolCalls = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const chunk = JSON.parse(data);
            const choice = chunk.choices?.[0];
            if (choice?.delta?.content) {
              yield {
                content: choice.delta.content,
                done: false
              };
            }
            if (choice?.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index;
                if (!toolCalls[idx]) {
                  toolCalls[idx] = {
                    id: tc.id || "",
                    type: "function",
                    function: { name: "", arguments: "" }
                  };
                }
                if (tc.id) toolCalls[idx].id = tc.id;
                if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
                if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
              }
            }
            if (chunk.usage) {
              usage = {
                promptTokens: chunk.usage.prompt_tokens ?? 0,
                completionTokens: chunk.usage.completion_tokens ?? 0,
                totalTokens: chunk.usage.total_tokens ?? 0
              };
            }
          } catch (e) {
          }
        }
      }
      const rawResponse = {
        choices: [{
          finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
          delta: {
            toolCalls: toolCalls.length > 0 ? toolCalls : void 0
          }
        }],
        usage
      };
      yield {
        content: "",
        done: true,
        usage,
        attachmentResults,
        rawResponse
      };
    } catch (error) {
      logger.error("Error in streamWithTools", {
        context: "OpenRouterProvider.streamWithTools"
      }, error instanceof Error ? error : void 0);
      throw error;
    }
  }
  async validateApiKey(apiKey) {
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || "http://localhost:3000",
        xTitle: getQuilltapUserAgent()
      });
      await client.models.list();
      return true;
    } catch (error) {
      logger.error(
        "OpenRouter API key validation failed",
        { provider: "openrouter" },
        error instanceof Error ? error : void 0
      );
      return false;
    }
  }
  async getAvailableModels(apiKey) {
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || "http://localhost:3000",
        xTitle: getQuilltapUserAgent()
      });
      const response = await client.models.list();
      const models = response.data?.map((m) => m.id) ?? [];
      return models;
    } catch (error) {
      logger.error(
        "Failed to fetch OpenRouter models",
        { provider: "openrouter" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  }
  async generateImage(params, apiKey) {
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || "http://localhost:3000",
      xTitle: getQuilltapUserAgent()
    });
    const requestBody = {
      model: params.model ?? "google/gemini-2.5-flash-image-preview",
      messages: [{ role: "user", content: params.prompt }],
      modalities: ["image", "text"],
      // Required for image generation
      stream: false
    };
    if (params.aspectRatio) {
      requestBody.imageConfig = { aspectRatio: params.aspectRatio };
    }
    const response = await client.chat.send({
      chatGenerationParams: requestBody
    });
    const choice = response.choices?.[0];
    if (!choice) {
      throw new Error("No choices in OpenRouter response");
    }
    const images = [];
    if (choice.message.images && Array.isArray(choice.message.images)) {
      for (const image of choice.message.images) {
        if (image.imageUrl?.url || image.image_url?.url) {
          const dataUrl = image.imageUrl?.url || image.image_url?.url;
          if (dataUrl.startsWith("data:image/")) {
            const [, base64] = dataUrl.split(",");
            const mimeType = dataUrl.match(/data:(image\/[^;]+)/)?.[1] || "image/png";
            images.push({
              data: base64,
              mimeType
            });
          }
        }
      }
    }
    if (images.length === 0) {
      throw new Error("No images returned from OpenRouter");
    }
    return {
      images,
      raw: response
    };
  }
};

// embedding-provider.ts
var logger2 = createPluginLogger("qtap-plugin-openrouter");
var OpenRouterEmbeddingProvider = class {
  /**
   * Generate an embedding for the given text
   *
   * @param text The text to embed
   * @param model The model to use (e.g., 'openai/text-embedding-3-small')
   * @param apiKey The OpenRouter API key
   * @param options Optional configuration (dimensions, encoding format)
   * @returns The embedding result
   */
  async generateEmbedding(text2, model, apiKey, options) {
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || "http://localhost:3000",
      xTitle: getQuilltapUserAgent()
    });
    const response = await client.embeddings.generate({
      requestBody: {
        input: text2,
        model,
        dimensions: options?.dimensions
      }
    });
    if (typeof response === "string") {
      throw new Error(`OpenRouter returned an error: ${response}`);
    }
    const embeddingData = response.data[0]?.embedding;
    if (!embeddingData) {
      throw new Error("No embedding returned from OpenRouter");
    }
    let embedding;
    if (typeof embeddingData === "string") {
      const buffer = Buffer.from(embeddingData, "base64");
      embedding = Array.from(
        new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4)
      );
    } else {
      embedding = embeddingData;
    }
    return {
      embedding,
      model: response.model,
      dimensions: embedding.length,
      usage: response.usage ? {
        promptTokens: response.usage.promptTokens,
        totalTokens: response.usage.totalTokens,
        cost: response.usage.cost
      } : void 0
    };
  }
  /**
   * Generate embeddings for multiple texts in a batch
   *
   * @param texts Array of texts to embed
   * @param model The model to use
   * @param apiKey The OpenRouter API key
   * @param options Optional configuration
   * @returns Array of embedding results
   */
  async generateBatchEmbeddings(texts, model, apiKey, options) {
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || "http://localhost:3000",
      xTitle: getQuilltapUserAgent()
    });
    const response = await client.embeddings.generate({
      requestBody: {
        input: texts,
        model,
        dimensions: options?.dimensions
      }
    });
    if (typeof response === "string") {
      throw new Error(`OpenRouter returned an error: ${response}`);
    }
    const results = [];
    for (const data of response.data) {
      const embeddingData = data.embedding;
      if (!embeddingData) {
        continue;
      }
      let embedding;
      if (typeof embeddingData === "string") {
        const buffer = Buffer.from(embeddingData, "base64");
        embedding = Array.from(
          new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4)
        );
      } else {
        embedding = embeddingData;
      }
      results.push({
        embedding,
        model: response.model,
        dimensions: embedding.length,
        usage: response.usage ? {
          promptTokens: response.usage.promptTokens,
          totalTokens: response.usage.totalTokens,
          cost: response.usage.cost
        } : void 0
      });
    }
    return results;
  }
  /**
   * Get available embedding models from OpenRouter
   *
   * @param apiKey The OpenRouter API key
   * @returns Array of model IDs
   */
  async getAvailableModels(apiKey) {
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || "http://localhost:3000",
        xTitle: getQuilltapUserAgent()
      });
      const response = await client.embeddings.listModels();
      const models = response.data?.map((m) => m.id) ?? [];
      return models;
    } catch (error) {
      logger2.error(
        "Failed to fetch OpenRouter embedding models",
        { context: "OpenRouterEmbeddingProvider.getAvailableModels" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  }
};

// node_modules/@quilltap/plugin-utils/dist/tools/index.mjs
var TOOL_NAME_ALIASES = {
  // Direct mappings
  "search_memories": "search_memories",
  "generate_image": "generate_image",
  "search_web": "search_web",
  // Memory tool aliases
  "memory": "search_memories",
  "memory_search": "search_memories",
  "search_memory": "search_memories",
  "memories": "search_memories",
  // Image tool aliases
  "image": "generate_image",
  "create_image": "generate_image",
  "image_generation": "generate_image",
  "gen_image": "generate_image",
  // Web search aliases
  "search": "search_web",
  "web_search": "search_web",
  "websearch": "search_web",
  "web": "search_web",
  // Help tool aliases
  "help_search": "help_search",
  "helpsearch": "help_search",
  "search_help": "help_search",
  "help_navigate": "help_navigate",
  "helpnavigate": "help_navigate"
};
function normalizeToolName(name) {
  const normalized = name.toLowerCase().trim();
  return TOOL_NAME_ALIASES[normalized] || name;
}
function convertToToolCallRequest(parsed) {
  switch (parsed.toolName) {
    case "search_memories":
      return {
        name: "search_memories",
        arguments: {
          query: parsed.arguments.query || parsed.arguments.search || Object.values(parsed.arguments)[0] || "",
          limit: parsed.arguments.limit
        }
      };
    case "generate_image":
      return {
        name: "generate_image",
        arguments: {
          prompt: parsed.arguments.prompt || parsed.arguments.description || Object.values(parsed.arguments)[0] || ""
        }
      };
    case "search_web":
      return {
        name: "search_web",
        arguments: {
          query: parsed.arguments.query || parsed.arguments.search || Object.values(parsed.arguments)[0] || ""
        }
      };
    case "help_search":
      return {
        name: "help_search",
        arguments: {
          query: parsed.arguments.query || parsed.arguments.search || Object.values(parsed.arguments)[0] || "",
          limit: parsed.arguments.limit
        }
      };
    case "help_navigate":
      return {
        name: "help_navigate",
        arguments: {
          url: parsed.arguments.url || parsed.arguments.path || Object.values(parsed.arguments)[0] || ""
        }
      };
    default:
      return {
        name: parsed.toolName,
        arguments: parsed.arguments
      };
  }
}
function parseFunctionCallsFormat(response) {
  const results = [];
  const functionCallsPattern = /<function_calls>([\s\S]*?)<\/function_calls>/gi;
  let wrapperMatch;
  while ((wrapperMatch = functionCallsPattern.exec(response)) !== null) {
    const wrapperContent = wrapperMatch[1];
    const wrapperStartIndex = wrapperMatch.index;
    const contentOffset = wrapperStartIndex + "<function_calls>".length;
    const invokePattern = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi;
    let invokeMatch;
    while ((invokeMatch = invokePattern.exec(wrapperContent)) !== null) {
      const toolName = invokeMatch[1];
      const paramContent = invokeMatch[2];
      const invokeStartIndex = contentOffset + invokeMatch.index;
      const invokeEndIndex = invokeStartIndex + invokeMatch[0].length;
      const args = {};
      let format = "claude";
      const deepseekParamPattern = /<parameter\s+name=["']([^"']+)["']\s+string=["']([^"']*)["'][^>]*>([^<]*)<\/parameter>/gi;
      let paramMatch;
      while ((paramMatch = deepseekParamPattern.exec(paramContent)) !== null) {
        const paramName = paramMatch[1];
        const stringAttr = paramMatch[2];
        const value = paramMatch[3].trim();
        if (stringAttr === "false") {
          const numVal = Number(value);
          if (!isNaN(numVal)) {
            args[paramName] = numVal;
          } else if (value === "true") {
            args[paramName] = true;
          } else if (value === "false") {
            args[paramName] = false;
          } else {
            args[paramName] = value;
          }
        } else {
          args[paramName] = value;
        }
        format = "deepseek";
      }
      if (Object.keys(args).length === 0) {
        const claudeParamPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/parameter>/gi;
        while ((paramMatch = claudeParamPattern.exec(paramContent)) !== null) {
          args[paramMatch[1]] = paramMatch[2].trim();
        }
      }
      const antmlParamPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/antml:parameter>/gi;
      while ((paramMatch = antmlParamPattern.exec(paramContent)) !== null) {
        args[paramMatch[1]] = paramMatch[2].trim();
      }
      results.push({
        toolName: normalizeToolName(toolName),
        arguments: args,
        fullMatch: invokeMatch[0],
        startIndex: invokeStartIndex,
        endIndex: invokeEndIndex,
        format
      });
    }
  }
  return results;
}
function parseToolCallFormat(response) {
  const results = [];
  const toolCallPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match2;
  while ((match2 = toolCallPattern.exec(response)) !== null) {
    const content = match2[1];
    const startIndex = match2.index;
    const nameMatch = /<name>([^<]+)<\/name>/i.exec(content);
    if (!nameMatch) continue;
    const toolName = nameMatch[1].trim();
    const args = {};
    const argsMatch = /<arguments>([\s\S]*?)<\/arguments>/i.exec(content);
    if (argsMatch) {
      const argsContent = argsMatch[1];
      const argPattern = /<(\w+)>([^<]*)<\/\1>/gi;
      let argMatch;
      while ((argMatch = argPattern.exec(argsContent)) !== null) {
        args[argMatch[1]] = argMatch[2].trim();
      }
    }
    results.push({
      toolName: normalizeToolName(toolName),
      arguments: args,
      fullMatch: match2[0],
      startIndex,
      endIndex: startIndex + match2[0].length,
      format: "generic"
    });
  }
  return results;
}
function parseFunctionCallFormat(response) {
  const results = [];
  const functionCallPattern = /<function_call\s+name=["']([^"']+)["']>([\s\S]*?)<\/function_call>/gi;
  let match2;
  while ((match2 = functionCallPattern.exec(response)) !== null) {
    const toolName = match2[1];
    const content = match2[2];
    const startIndex = match2.index;
    const args = {};
    const paramPattern = /<param\s+name=["']([^"']+)["']>([^<]*)<\/param>/gi;
    let paramMatch;
    while ((paramMatch = paramPattern.exec(content)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }
    const parameterPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/parameter>/gi;
    while ((paramMatch = parameterPattern.exec(content)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }
    results.push({
      toolName: normalizeToolName(toolName),
      arguments: args,
      fullMatch: match2[0],
      startIndex,
      endIndex: startIndex + match2[0].length,
      format: "function_call"
    });
  }
  return results;
}
function parseToolUseFormat(response) {
  const results = [];
  const toolUsePattern = /<tool_use(?:\s+name=["']([^"']+)["'])?\s*>([\s\S]*?)<\/tool_use>/gi;
  let match2;
  while ((match2 = toolUsePattern.exec(response)) !== null) {
    const attrName = match2[1];
    const content = match2[2];
    const startIndex = match2.index;
    const trimmedContent = content.trim();
    if (trimmedContent.startsWith("{")) {
      try {
        const jsonBlob = JSON.parse(trimmedContent);
        if (typeof jsonBlob === "object" && jsonBlob !== null && jsonBlob.name) {
          const args2 = jsonBlob.input || jsonBlob.arguments || jsonBlob.parameters || {};
          results.push({
            toolName: normalizeToolName(jsonBlob.name),
            arguments: typeof args2 === "object" && args2 !== null ? args2 : {},
            fullMatch: match2[0],
            startIndex,
            endIndex: startIndex + match2[0].length,
            format: "tool_use"
          });
          continue;
        }
      } catch {
      }
    }
    let toolName = attrName;
    if (!toolName) {
      const nameMatch = /<name>([^<]+)<\/name>/i.exec(content);
      if (!nameMatch) continue;
      toolName = nameMatch[1].trim();
    }
    const args = {};
    const argsMatch = /<(?:arguments|input|parameters)>([\s\S]*?)<\/(?:arguments|input|parameters)>/i.exec(content);
    if (argsMatch) {
      const argsContent = argsMatch[1].trim();
      if (argsContent.startsWith("{")) {
        try {
          const parsed = JSON.parse(argsContent);
          if (typeof parsed === "object" && parsed !== null) {
            Object.assign(args, parsed);
          }
        } catch {
        }
      }
      if (Object.keys(args).length === 0) {
        const argPattern = /<(\w+)>([^<]*)<\/\1>/gi;
        let argMatch;
        while ((argMatch = argPattern.exec(argsContent)) !== null) {
          args[argMatch[1]] = argMatch[2].trim();
        }
      }
    }
    results.push({
      toolName: normalizeToolName(toolName),
      arguments: args,
      fullMatch: match2[0],
      startIndex,
      endIndex: startIndex + match2[0].length,
      format: "tool_use"
    });
  }
  return results;
}
function parseInvokeFormat(response) {
  const results = [];
  const invokePattern = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi;
  let match2;
  while ((match2 = invokePattern.exec(response)) !== null) {
    const toolName = match2[1];
    const paramContent = match2[2];
    const startIndex = match2.index;
    const args = {};
    const paramPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/parameter>/gi;
    let paramMatch;
    while ((paramMatch = paramPattern.exec(paramContent)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }
    results.push({
      toolName: normalizeToolName(toolName),
      arguments: args,
      fullMatch: match2[0],
      startIndex,
      endIndex: startIndex + match2[0].length,
      format: "invoke"
    });
  }
  return results;
}
function parseAllXMLFormats(response) {
  const allResults = [];
  allResults.push(...parseFunctionCallsFormat(response));
  allResults.push(...parseToolCallFormat(response));
  allResults.push(...parseFunctionCallFormat(response));
  allResults.push(...parseToolUseFormat(response));
  allResults.push(...parseInvokeFormat(response));
  const seen = /* @__PURE__ */ new Set();
  const deduped = allResults.filter((result) => {
    if (seen.has(result.startIndex)) {
      return false;
    }
    seen.add(result.startIndex);
    return true;
  });
  deduped.sort((a, b) => a.startIndex - b.startIndex);
  return deduped;
}
function parseAllXMLAsToolCalls(response) {
  return parseAllXMLFormats(response).map(convertToToolCallRequest);
}
function hasAnyXMLToolMarkers(response) {
  return /<function_calls>/i.test(response) || /<tool_call>/i.test(response) || /<function_call\s+/i.test(response) || /<tool_use[\s>]/i.test(response) || /<invoke\s+name=/i.test(response);
}
function stripAllXMLToolMarkers(response) {
  let stripped = response;
  stripped = stripped.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, "");
  stripped = stripped.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  stripped = stripped.replace(/<function_call\s+[^>]*>[\s\S]*?<\/function_call>/gi, "");
  stripped = stripped.replace(/<tool_use[\s>][\s\S]*?<\/tool_use>/gi, "");
  stripped = stripped.replace(/<invoke\s+name=["'][^"']*["']>[\s\S]*?<\/invoke>/gi, "");
  stripped = stripped.replace(/\n{3,}/g, "\n\n").replace(/  +/g, " ").trim();
  return stripped;
}

// index.ts
var logger3 = createPluginLogger("qtap-plugin-openrouter");
var metadata = {
  providerName: "OPENROUTER",
  displayName: "OpenRouter",
  description: "OpenRouter provides access to 100+ models including GPT-4, Claude, Gemini, Llama and more with unified pricing",
  colors: {
    bg: "bg-orange-100",
    text: "text-orange-800",
    icon: "text-orange-600"
  },
  abbreviation: "ORT"
};
var config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: "OpenRouter API Key"
};
var capabilities = {
  chat: true,
  imageGeneration: true,
  embeddings: true,
  webSearch: true,
  toolUse: false
};
var attachmentSupport = {
  supportsAttachments: false,
  supportedMimeTypes: [],
  description: "File attachment support depends on the underlying model",
  notes: "OpenRouter proxies to 100+ models with varying capabilities. Some models may support image/file attachments."
};
var messageFormat = {
  supportsNameField: false,
  supportedRoles: []
};
var cheapModels = {
  defaultModel: "openai/gpt-4o-mini",
  recommendedModels: [
    "openai/gpt-4o-mini",
    "anthropic/claude-3-haiku",
    "google/gemini-2.0-flash",
    "mistralai/mistral-7b-instruct"
  ]
};
var plugin = {
  metadata,
  icon: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M12 2L2 12l10 10 10-10L12 2zm0 3.5L19.5 12 12 19.5 4.5 12 12 5.5z", fill: "currentColor", fillRule: "evenodd" }
    ]
  },
  config,
  capabilities,
  attachmentSupport,
  // Runtime configuration
  messageFormat,
  charsPerToken: 3.5,
  toolFormat: "openai",
  // OpenRouter uses OpenAI format
  cheapModels,
  defaultContextWindow: 128e3,
  /**
   * Factory method to create an OpenRouter LLM provider instance
   */
  createProvider: (baseUrl) => {
    return new OpenRouterProvider();
  },
  /**
   * Factory method to create an OpenRouter embedding provider instance
   */
  createEmbeddingProvider: (baseUrl) => {
    return new OpenRouterEmbeddingProvider();
  },
  /**
   * Get list of available models from OpenRouter API
   * Requires a valid API key
   * Returns 100+ models from various providers
   */
  getAvailableModels: async (apiKey, baseUrl) => {
    try {
      const provider = new OpenRouterProvider();
      const models = await provider.getAvailableModels(apiKey);
      return models;
    } catch (error) {
      logger3.error(
        "Failed to fetch OpenRouter models",
        { context: "plugin.getAvailableModels" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Validate an OpenRouter API key
   */
  validateApiKey: async (apiKey, baseUrl) => {
    try {
      const provider = new OpenRouterProvider();
      const isValid = await provider.validateApiKey(apiKey);
      return isValid;
    } catch (error) {
      logger3.error(
        "Error validating OpenRouter API key",
        { context: "plugin.validateApiKey" },
        error instanceof Error ? error : void 0
      );
      return false;
    }
  },
  /**
   * Get static model information
   * Returns cached information about popular OpenRouter models
   */
  getModelInfo: () => {
    return [
      {
        id: "openai/gpt-4-turbo",
        name: "OpenAI GPT-4 Turbo",
        contextWindow: 128e3,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "anthropic/claude-3-opus",
        name: "Anthropic Claude 3 Opus",
        contextWindow: 2e5,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "anthropic/claude-3-sonnet",
        name: "Anthropic Claude 3 Sonnet",
        contextWindow: 2e5,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "google/gemini-pro-1.5",
        name: "Google Gemini 1.5 Pro",
        contextWindow: 1e6,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "meta-llama/llama-2-70b-chat",
        name: "Meta Llama 2 70B Chat",
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false
      },
      {
        id: "mistralai/mistral-7b-instruct",
        name: "Mistral 7B Instruct",
        contextWindow: 8192,
        maxOutputTokens: 4096,
        supportsImages: false,
        supportsTools: false
      }
    ];
  },
  /**
   * Get static embedding model information
   * Returns cached information about popular OpenRouter embedding models
   */
  getEmbeddingModels: () => {
    return [
      {
        id: "openai/text-embedding-3-small",
        name: "OpenAI Text Embedding 3 Small",
        dimensions: 1536,
        description: "OpenAI small embedding model, efficient for most use cases"
      },
      {
        id: "openai/text-embedding-3-large",
        name: "OpenAI Text Embedding 3 Large",
        dimensions: 3072,
        description: "OpenAI large embedding model for highest quality"
      },
      {
        id: "openai/text-embedding-ada-002",
        name: "OpenAI Ada 002",
        dimensions: 1536,
        description: "OpenAI legacy embedding model"
      },
      {
        id: "cohere/embed-english-v3.0",
        name: "Cohere Embed English v3",
        dimensions: 1024,
        description: "Cohere English embedding model"
      },
      {
        id: "cohere/embed-multilingual-v3.0",
        name: "Cohere Embed Multilingual v3",
        dimensions: 1024,
        description: "Cohere multilingual embedding model"
      },
      {
        id: "voyage/voyage-large-2",
        name: "Voyage Large 2",
        dimensions: 1536,
        description: "Voyage AI large embedding model"
      },
      {
        id: "voyage/voyage-code-2",
        name: "Voyage Code 2",
        dimensions: 1536,
        description: "Voyage AI embedding model optimized for code"
      }
    ];
  },
  /**
   * Get static image generation model information
   * Returns cached information about popular OpenRouter image generation models
   */
  getImageGenerationModels: () => {
    return [
      {
        id: "google/gemini-2.0-flash-exp:free",
        name: "Gemini 2.0 Flash Experimental (Free)",
        supportedAspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
        description: "Free experimental Gemini 2.0 model with image generation capabilities"
      },
      {
        id: "google/gemini-2.5-flash-preview-05-20",
        name: "Gemini 2.5 Flash Preview",
        supportedAspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
        description: "Fast preview model with state-of-the-art image generation"
      },
      {
        id: "google/gemini-2.5-flash-preview-native-image",
        name: "Gemini 2.5 Flash Native Image",
        supportedAspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
        description: "Native image generation variant of Gemini 2.5 Flash"
      },
      {
        id: "google/gemini-3-pro-image-preview",
        name: "Nano Banana Pro (Gemini 3 Pro Image)",
        supportedAspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9", "21:9"],
        description: "Advanced image generation with fine-grained creative controls, 2K/4K output support"
      }
    ];
  },
  /**
   * Render the OpenRouter icon
   */
  /**
   * Format tools from OpenAI format to OpenAI format
   * OpenRouter uses OpenAI format, with Grok constraints applied if needed
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in OpenAI format
   */
  formatTools: (tools) => {
    try {
      const formattedTools = [];
      for (const tool of tools) {
        if (!("function" in tool)) {
          logger3.warn("Skipping tool with invalid format", {
            context: "plugin.formatTools"
          });
          continue;
        }
        formattedTools.push(tool);
      }
      return formattedTools;
    } catch (error) {
      logger3.error(
        "Error formatting tools for OpenRouter",
        { context: "plugin.formatTools" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Parse tool calls from OpenRouter response format
   * Extracts tool calls from OpenRouter API responses (OpenAI format)
   *
   * @param response OpenRouter API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response) => {
    try {
      const toolCalls = parseOpenAIToolCalls(response);
      return toolCalls;
    } catch (error) {
      logger3.error(
        "Error parsing tool calls from OpenRouter response",
        { context: "plugin.parseToolCalls" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Detect spontaneous XML tool call markers in OpenRouter text responses
   * Checks all XML formats since OpenRouter routes to any model
   */
  hasTextToolMarkers(text2) {
    return hasAnyXMLToolMarkers(text2);
  },
  /**
   * Parse spontaneous XML tool calls from OpenRouter text responses
   */
  parseTextToolCalls(text2) {
    try {
      const results = parseAllXMLAsToolCalls(text2);
      return results;
    } catch (error) {
      logger3.error(
        "Error parsing text tool calls",
        { context: "openrouter.parseTextToolCalls" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Strip spontaneous XML tool call markers from OpenRouter text responses
   */
  stripTextToolMarkers(text2) {
    return stripAllXMLToolMarkers(text2);
  }
};
var index_default = plugin;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
