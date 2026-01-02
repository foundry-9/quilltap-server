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

// node_modules/@google/generative-ai/dist/index.mjs
var SchemaType;
(function(SchemaType2) {
  SchemaType2["STRING"] = "string";
  SchemaType2["NUMBER"] = "number";
  SchemaType2["INTEGER"] = "integer";
  SchemaType2["BOOLEAN"] = "boolean";
  SchemaType2["ARRAY"] = "array";
  SchemaType2["OBJECT"] = "object";
})(SchemaType || (SchemaType = {}));
var ExecutableCodeLanguage;
(function(ExecutableCodeLanguage2) {
  ExecutableCodeLanguage2["LANGUAGE_UNSPECIFIED"] = "language_unspecified";
  ExecutableCodeLanguage2["PYTHON"] = "python";
})(ExecutableCodeLanguage || (ExecutableCodeLanguage = {}));
var Outcome;
(function(Outcome2) {
  Outcome2["OUTCOME_UNSPECIFIED"] = "outcome_unspecified";
  Outcome2["OUTCOME_OK"] = "outcome_ok";
  Outcome2["OUTCOME_FAILED"] = "outcome_failed";
  Outcome2["OUTCOME_DEADLINE_EXCEEDED"] = "outcome_deadline_exceeded";
})(Outcome || (Outcome = {}));
var POSSIBLE_ROLES = ["user", "model", "function", "system"];
var HarmCategory;
(function(HarmCategory2) {
  HarmCategory2["HARM_CATEGORY_UNSPECIFIED"] = "HARM_CATEGORY_UNSPECIFIED";
  HarmCategory2["HARM_CATEGORY_HATE_SPEECH"] = "HARM_CATEGORY_HATE_SPEECH";
  HarmCategory2["HARM_CATEGORY_SEXUALLY_EXPLICIT"] = "HARM_CATEGORY_SEXUALLY_EXPLICIT";
  HarmCategory2["HARM_CATEGORY_HARASSMENT"] = "HARM_CATEGORY_HARASSMENT";
  HarmCategory2["HARM_CATEGORY_DANGEROUS_CONTENT"] = "HARM_CATEGORY_DANGEROUS_CONTENT";
  HarmCategory2["HARM_CATEGORY_CIVIC_INTEGRITY"] = "HARM_CATEGORY_CIVIC_INTEGRITY";
})(HarmCategory || (HarmCategory = {}));
var HarmBlockThreshold;
(function(HarmBlockThreshold2) {
  HarmBlockThreshold2["HARM_BLOCK_THRESHOLD_UNSPECIFIED"] = "HARM_BLOCK_THRESHOLD_UNSPECIFIED";
  HarmBlockThreshold2["BLOCK_LOW_AND_ABOVE"] = "BLOCK_LOW_AND_ABOVE";
  HarmBlockThreshold2["BLOCK_MEDIUM_AND_ABOVE"] = "BLOCK_MEDIUM_AND_ABOVE";
  HarmBlockThreshold2["BLOCK_ONLY_HIGH"] = "BLOCK_ONLY_HIGH";
  HarmBlockThreshold2["BLOCK_NONE"] = "BLOCK_NONE";
})(HarmBlockThreshold || (HarmBlockThreshold = {}));
var HarmProbability;
(function(HarmProbability2) {
  HarmProbability2["HARM_PROBABILITY_UNSPECIFIED"] = "HARM_PROBABILITY_UNSPECIFIED";
  HarmProbability2["NEGLIGIBLE"] = "NEGLIGIBLE";
  HarmProbability2["LOW"] = "LOW";
  HarmProbability2["MEDIUM"] = "MEDIUM";
  HarmProbability2["HIGH"] = "HIGH";
})(HarmProbability || (HarmProbability = {}));
var BlockReason;
(function(BlockReason2) {
  BlockReason2["BLOCKED_REASON_UNSPECIFIED"] = "BLOCKED_REASON_UNSPECIFIED";
  BlockReason2["SAFETY"] = "SAFETY";
  BlockReason2["OTHER"] = "OTHER";
})(BlockReason || (BlockReason = {}));
var FinishReason;
(function(FinishReason2) {
  FinishReason2["FINISH_REASON_UNSPECIFIED"] = "FINISH_REASON_UNSPECIFIED";
  FinishReason2["STOP"] = "STOP";
  FinishReason2["MAX_TOKENS"] = "MAX_TOKENS";
  FinishReason2["SAFETY"] = "SAFETY";
  FinishReason2["RECITATION"] = "RECITATION";
  FinishReason2["LANGUAGE"] = "LANGUAGE";
  FinishReason2["BLOCKLIST"] = "BLOCKLIST";
  FinishReason2["PROHIBITED_CONTENT"] = "PROHIBITED_CONTENT";
  FinishReason2["SPII"] = "SPII";
  FinishReason2["MALFORMED_FUNCTION_CALL"] = "MALFORMED_FUNCTION_CALL";
  FinishReason2["OTHER"] = "OTHER";
})(FinishReason || (FinishReason = {}));
var TaskType;
(function(TaskType2) {
  TaskType2["TASK_TYPE_UNSPECIFIED"] = "TASK_TYPE_UNSPECIFIED";
  TaskType2["RETRIEVAL_QUERY"] = "RETRIEVAL_QUERY";
  TaskType2["RETRIEVAL_DOCUMENT"] = "RETRIEVAL_DOCUMENT";
  TaskType2["SEMANTIC_SIMILARITY"] = "SEMANTIC_SIMILARITY";
  TaskType2["CLASSIFICATION"] = "CLASSIFICATION";
  TaskType2["CLUSTERING"] = "CLUSTERING";
})(TaskType || (TaskType = {}));
var FunctionCallingMode;
(function(FunctionCallingMode2) {
  FunctionCallingMode2["MODE_UNSPECIFIED"] = "MODE_UNSPECIFIED";
  FunctionCallingMode2["AUTO"] = "AUTO";
  FunctionCallingMode2["ANY"] = "ANY";
  FunctionCallingMode2["NONE"] = "NONE";
})(FunctionCallingMode || (FunctionCallingMode = {}));
var DynamicRetrievalMode;
(function(DynamicRetrievalMode2) {
  DynamicRetrievalMode2["MODE_UNSPECIFIED"] = "MODE_UNSPECIFIED";
  DynamicRetrievalMode2["MODE_DYNAMIC"] = "MODE_DYNAMIC";
})(DynamicRetrievalMode || (DynamicRetrievalMode = {}));
var GoogleGenerativeAIError = class extends Error {
  constructor(message) {
    super(`[GoogleGenerativeAI Error]: ${message}`);
  }
};
var GoogleGenerativeAIResponseError = class extends GoogleGenerativeAIError {
  constructor(message, response) {
    super(message);
    this.response = response;
  }
};
var GoogleGenerativeAIFetchError = class extends GoogleGenerativeAIError {
  constructor(message, status, statusText, errorDetails) {
    super(message);
    this.status = status;
    this.statusText = statusText;
    this.errorDetails = errorDetails;
  }
};
var GoogleGenerativeAIRequestInputError = class extends GoogleGenerativeAIError {
};
var GoogleGenerativeAIAbortError = class extends GoogleGenerativeAIError {
};
var DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
var DEFAULT_API_VERSION = "v1beta";
var PACKAGE_VERSION = "0.24.1";
var PACKAGE_LOG_HEADER = "genai-js";
var Task;
(function(Task2) {
  Task2["GENERATE_CONTENT"] = "generateContent";
  Task2["STREAM_GENERATE_CONTENT"] = "streamGenerateContent";
  Task2["COUNT_TOKENS"] = "countTokens";
  Task2["EMBED_CONTENT"] = "embedContent";
  Task2["BATCH_EMBED_CONTENTS"] = "batchEmbedContents";
})(Task || (Task = {}));
var RequestUrl = class {
  constructor(model, task, apiKey, stream, requestOptions) {
    this.model = model;
    this.task = task;
    this.apiKey = apiKey;
    this.stream = stream;
    this.requestOptions = requestOptions;
  }
  toString() {
    var _a, _b;
    const apiVersion = ((_a = this.requestOptions) === null || _a === void 0 ? void 0 : _a.apiVersion) || DEFAULT_API_VERSION;
    const baseUrl = ((_b = this.requestOptions) === null || _b === void 0 ? void 0 : _b.baseUrl) || DEFAULT_BASE_URL;
    let url = `${baseUrl}/${apiVersion}/${this.model}:${this.task}`;
    if (this.stream) {
      url += "?alt=sse";
    }
    return url;
  }
};
function getClientHeaders(requestOptions) {
  const clientHeaders = [];
  if (requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.apiClient) {
    clientHeaders.push(requestOptions.apiClient);
  }
  clientHeaders.push(`${PACKAGE_LOG_HEADER}/${PACKAGE_VERSION}`);
  return clientHeaders.join(" ");
}
async function getHeaders(url) {
  var _a;
  const headers = new Headers();
  headers.append("Content-Type", "application/json");
  headers.append("x-goog-api-client", getClientHeaders(url.requestOptions));
  headers.append("x-goog-api-key", url.apiKey);
  let customHeaders = (_a = url.requestOptions) === null || _a === void 0 ? void 0 : _a.customHeaders;
  if (customHeaders) {
    if (!(customHeaders instanceof Headers)) {
      try {
        customHeaders = new Headers(customHeaders);
      } catch (e) {
        throw new GoogleGenerativeAIRequestInputError(`unable to convert customHeaders value ${JSON.stringify(customHeaders)} to Headers: ${e.message}`);
      }
    }
    for (const [headerName, headerValue] of customHeaders.entries()) {
      if (headerName === "x-goog-api-key") {
        throw new GoogleGenerativeAIRequestInputError(`Cannot set reserved header name ${headerName}`);
      } else if (headerName === "x-goog-api-client") {
        throw new GoogleGenerativeAIRequestInputError(`Header name ${headerName} can only be set using the apiClient field`);
      }
      headers.append(headerName, headerValue);
    }
  }
  return headers;
}
async function constructModelRequest(model, task, apiKey, stream, body, requestOptions) {
  const url = new RequestUrl(model, task, apiKey, stream, requestOptions);
  return {
    url: url.toString(),
    fetchOptions: Object.assign(Object.assign({}, buildFetchOptions(requestOptions)), { method: "POST", headers: await getHeaders(url), body })
  };
}
async function makeModelRequest(model, task, apiKey, stream, body, requestOptions = {}, fetchFn = fetch) {
  const { url, fetchOptions } = await constructModelRequest(model, task, apiKey, stream, body, requestOptions);
  return makeRequest(url, fetchOptions, fetchFn);
}
async function makeRequest(url, fetchOptions, fetchFn = fetch) {
  let response;
  try {
    response = await fetchFn(url, fetchOptions);
  } catch (e) {
    handleResponseError(e, url);
  }
  if (!response.ok) {
    await handleResponseNotOk(response, url);
  }
  return response;
}
function handleResponseError(e, url) {
  let err = e;
  if (err.name === "AbortError") {
    err = new GoogleGenerativeAIAbortError(`Request aborted when fetching ${url.toString()}: ${e.message}`);
    err.stack = e.stack;
  } else if (!(e instanceof GoogleGenerativeAIFetchError || e instanceof GoogleGenerativeAIRequestInputError)) {
    err = new GoogleGenerativeAIError(`Error fetching from ${url.toString()}: ${e.message}`);
    err.stack = e.stack;
  }
  throw err;
}
async function handleResponseNotOk(response, url) {
  let message = "";
  let errorDetails;
  try {
    const json = await response.json();
    message = json.error.message;
    if (json.error.details) {
      message += ` ${JSON.stringify(json.error.details)}`;
      errorDetails = json.error.details;
    }
  } catch (e) {
  }
  throw new GoogleGenerativeAIFetchError(`Error fetching from ${url.toString()}: [${response.status} ${response.statusText}] ${message}`, response.status, response.statusText, errorDetails);
}
function buildFetchOptions(requestOptions) {
  const fetchOptions = {};
  if ((requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.signal) !== void 0 || (requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.timeout) >= 0) {
    const controller = new AbortController();
    if ((requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.timeout) >= 0) {
      setTimeout(() => controller.abort(), requestOptions.timeout);
    }
    if (requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.signal) {
      requestOptions.signal.addEventListener("abort", () => {
        controller.abort();
      });
    }
    fetchOptions.signal = controller.signal;
  }
  return fetchOptions;
}
function addHelpers(response) {
  response.text = () => {
    if (response.candidates && response.candidates.length > 0) {
      if (response.candidates.length > 1) {
        console.warn(`This response had ${response.candidates.length} candidates. Returning text from the first candidate only. Access response.candidates directly to use the other candidates.`);
      }
      if (hadBadFinishReason(response.candidates[0])) {
        throw new GoogleGenerativeAIResponseError(`${formatBlockErrorMessage(response)}`, response);
      }
      return getText(response);
    } else if (response.promptFeedback) {
      throw new GoogleGenerativeAIResponseError(`Text not available. ${formatBlockErrorMessage(response)}`, response);
    }
    return "";
  };
  response.functionCall = () => {
    if (response.candidates && response.candidates.length > 0) {
      if (response.candidates.length > 1) {
        console.warn(`This response had ${response.candidates.length} candidates. Returning function calls from the first candidate only. Access response.candidates directly to use the other candidates.`);
      }
      if (hadBadFinishReason(response.candidates[0])) {
        throw new GoogleGenerativeAIResponseError(`${formatBlockErrorMessage(response)}`, response);
      }
      console.warn(`response.functionCall() is deprecated. Use response.functionCalls() instead.`);
      return getFunctionCalls(response)[0];
    } else if (response.promptFeedback) {
      throw new GoogleGenerativeAIResponseError(`Function call not available. ${formatBlockErrorMessage(response)}`, response);
    }
    return void 0;
  };
  response.functionCalls = () => {
    if (response.candidates && response.candidates.length > 0) {
      if (response.candidates.length > 1) {
        console.warn(`This response had ${response.candidates.length} candidates. Returning function calls from the first candidate only. Access response.candidates directly to use the other candidates.`);
      }
      if (hadBadFinishReason(response.candidates[0])) {
        throw new GoogleGenerativeAIResponseError(`${formatBlockErrorMessage(response)}`, response);
      }
      return getFunctionCalls(response);
    } else if (response.promptFeedback) {
      throw new GoogleGenerativeAIResponseError(`Function call not available. ${formatBlockErrorMessage(response)}`, response);
    }
    return void 0;
  };
  return response;
}
function getText(response) {
  var _a, _b, _c, _d;
  const textStrings = [];
  if ((_b = (_a = response.candidates) === null || _a === void 0 ? void 0 : _a[0].content) === null || _b === void 0 ? void 0 : _b.parts) {
    for (const part of (_d = (_c = response.candidates) === null || _c === void 0 ? void 0 : _c[0].content) === null || _d === void 0 ? void 0 : _d.parts) {
      if (part.text) {
        textStrings.push(part.text);
      }
      if (part.executableCode) {
        textStrings.push("\n```" + part.executableCode.language + "\n" + part.executableCode.code + "\n```\n");
      }
      if (part.codeExecutionResult) {
        textStrings.push("\n```\n" + part.codeExecutionResult.output + "\n```\n");
      }
    }
  }
  if (textStrings.length > 0) {
    return textStrings.join("");
  } else {
    return "";
  }
}
function getFunctionCalls(response) {
  var _a, _b, _c, _d;
  const functionCalls = [];
  if ((_b = (_a = response.candidates) === null || _a === void 0 ? void 0 : _a[0].content) === null || _b === void 0 ? void 0 : _b.parts) {
    for (const part of (_d = (_c = response.candidates) === null || _c === void 0 ? void 0 : _c[0].content) === null || _d === void 0 ? void 0 : _d.parts) {
      if (part.functionCall) {
        functionCalls.push(part.functionCall);
      }
    }
  }
  if (functionCalls.length > 0) {
    return functionCalls;
  } else {
    return void 0;
  }
}
var badFinishReasons = [
  FinishReason.RECITATION,
  FinishReason.SAFETY,
  FinishReason.LANGUAGE
];
function hadBadFinishReason(candidate) {
  return !!candidate.finishReason && badFinishReasons.includes(candidate.finishReason);
}
function formatBlockErrorMessage(response) {
  var _a, _b, _c;
  let message = "";
  if ((!response.candidates || response.candidates.length === 0) && response.promptFeedback) {
    message += "Response was blocked";
    if ((_a = response.promptFeedback) === null || _a === void 0 ? void 0 : _a.blockReason) {
      message += ` due to ${response.promptFeedback.blockReason}`;
    }
    if ((_b = response.promptFeedback) === null || _b === void 0 ? void 0 : _b.blockReasonMessage) {
      message += `: ${response.promptFeedback.blockReasonMessage}`;
    }
  } else if ((_c = response.candidates) === null || _c === void 0 ? void 0 : _c[0]) {
    const firstCandidate = response.candidates[0];
    if (hadBadFinishReason(firstCandidate)) {
      message += `Candidate was blocked due to ${firstCandidate.finishReason}`;
      if (firstCandidate.finishMessage) {
        message += `: ${firstCandidate.finishMessage}`;
      }
    }
  }
  return message;
}
function __await(v) {
  return this instanceof __await ? (this.v = v, this) : new __await(v);
}
function __asyncGenerator(thisArg, _arguments, generator) {
  if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
  var g = generator.apply(thisArg, _arguments || []), i, q = [];
  return i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function() {
    return this;
  }, i;
  function verb(n) {
    if (g[n]) i[n] = function(v) {
      return new Promise(function(a, b) {
        q.push([n, v, a, b]) > 1 || resume(n, v);
      });
    };
  }
  function resume(n, v) {
    try {
      step(g[n](v));
    } catch (e) {
      settle(q[0][3], e);
    }
  }
  function step(r) {
    r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r);
  }
  function fulfill(value) {
    resume("next", value);
  }
  function reject(value) {
    resume("throw", value);
  }
  function settle(f, v) {
    if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]);
  }
}
var responseLineRE = /^data\: (.*)(?:\n\n|\r\r|\r\n\r\n)/;
function processStream(response) {
  const inputStream = response.body.pipeThrough(new TextDecoderStream("utf8", { fatal: true }));
  const responseStream = getResponseStream(inputStream);
  const [stream1, stream2] = responseStream.tee();
  return {
    stream: generateResponseSequence(stream1),
    response: getResponsePromise(stream2)
  };
}
async function getResponsePromise(stream) {
  const allResponses = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return addHelpers(aggregateResponses(allResponses));
    }
    allResponses.push(value);
  }
}
function generateResponseSequence(stream) {
  return __asyncGenerator(this, arguments, function* generateResponseSequence_1() {
    const reader = stream.getReader();
    while (true) {
      const { value, done } = yield __await(reader.read());
      if (done) {
        break;
      }
      yield yield __await(addHelpers(value));
    }
  });
}
function getResponseStream(inputStream) {
  const reader = inputStream.getReader();
  const stream = new ReadableStream({
    start(controller) {
      let currentText = "";
      return pump();
      function pump() {
        return reader.read().then(({ value, done }) => {
          if (done) {
            if (currentText.trim()) {
              controller.error(new GoogleGenerativeAIError("Failed to parse stream"));
              return;
            }
            controller.close();
            return;
          }
          currentText += value;
          let match = currentText.match(responseLineRE);
          let parsedResponse;
          while (match) {
            try {
              parsedResponse = JSON.parse(match[1]);
            } catch (e) {
              controller.error(new GoogleGenerativeAIError(`Error parsing JSON response: "${match[1]}"`));
              return;
            }
            controller.enqueue(parsedResponse);
            currentText = currentText.substring(match[0].length);
            match = currentText.match(responseLineRE);
          }
          return pump();
        }).catch((e) => {
          let err = e;
          err.stack = e.stack;
          if (err.name === "AbortError") {
            err = new GoogleGenerativeAIAbortError("Request aborted when reading from the stream");
          } else {
            err = new GoogleGenerativeAIError("Error reading from the stream");
          }
          throw err;
        });
      }
    }
  });
  return stream;
}
function aggregateResponses(responses) {
  const lastResponse = responses[responses.length - 1];
  const aggregatedResponse = {
    promptFeedback: lastResponse === null || lastResponse === void 0 ? void 0 : lastResponse.promptFeedback
  };
  for (const response of responses) {
    if (response.candidates) {
      let candidateIndex = 0;
      for (const candidate of response.candidates) {
        if (!aggregatedResponse.candidates) {
          aggregatedResponse.candidates = [];
        }
        if (!aggregatedResponse.candidates[candidateIndex]) {
          aggregatedResponse.candidates[candidateIndex] = {
            index: candidateIndex
          };
        }
        aggregatedResponse.candidates[candidateIndex].citationMetadata = candidate.citationMetadata;
        aggregatedResponse.candidates[candidateIndex].groundingMetadata = candidate.groundingMetadata;
        aggregatedResponse.candidates[candidateIndex].finishReason = candidate.finishReason;
        aggregatedResponse.candidates[candidateIndex].finishMessage = candidate.finishMessage;
        aggregatedResponse.candidates[candidateIndex].safetyRatings = candidate.safetyRatings;
        if (candidate.content && candidate.content.parts) {
          if (!aggregatedResponse.candidates[candidateIndex].content) {
            aggregatedResponse.candidates[candidateIndex].content = {
              role: candidate.content.role || "user",
              parts: []
            };
          }
          const newPart = {};
          for (const part of candidate.content.parts) {
            if (part.text) {
              newPart.text = part.text;
            }
            if (part.functionCall) {
              newPart.functionCall = part.functionCall;
            }
            if (part.executableCode) {
              newPart.executableCode = part.executableCode;
            }
            if (part.codeExecutionResult) {
              newPart.codeExecutionResult = part.codeExecutionResult;
            }
            if (Object.keys(newPart).length === 0) {
              newPart.text = "";
            }
            aggregatedResponse.candidates[candidateIndex].content.parts.push(newPart);
          }
        }
      }
      candidateIndex++;
    }
    if (response.usageMetadata) {
      aggregatedResponse.usageMetadata = response.usageMetadata;
    }
  }
  return aggregatedResponse;
}
async function generateContentStream(apiKey, model, params, requestOptions) {
  const response = await makeModelRequest(
    model,
    Task.STREAM_GENERATE_CONTENT,
    apiKey,
    /* stream */
    true,
    JSON.stringify(params),
    requestOptions
  );
  return processStream(response);
}
async function generateContent(apiKey, model, params, requestOptions) {
  const response = await makeModelRequest(
    model,
    Task.GENERATE_CONTENT,
    apiKey,
    /* stream */
    false,
    JSON.stringify(params),
    requestOptions
  );
  const responseJson = await response.json();
  const enhancedResponse = addHelpers(responseJson);
  return {
    response: enhancedResponse
  };
}
function formatSystemInstruction(input) {
  if (input == null) {
    return void 0;
  } else if (typeof input === "string") {
    return { role: "system", parts: [{ text: input }] };
  } else if (input.text) {
    return { role: "system", parts: [input] };
  } else if (input.parts) {
    if (!input.role) {
      return { role: "system", parts: input.parts };
    } else {
      return input;
    }
  }
}
function formatNewContent(request) {
  let newParts = [];
  if (typeof request === "string") {
    newParts = [{ text: request }];
  } else {
    for (const partOrString of request) {
      if (typeof partOrString === "string") {
        newParts.push({ text: partOrString });
      } else {
        newParts.push(partOrString);
      }
    }
  }
  return assignRoleToPartsAndValidateSendMessageRequest(newParts);
}
function assignRoleToPartsAndValidateSendMessageRequest(parts) {
  const userContent = { role: "user", parts: [] };
  const functionContent = { role: "function", parts: [] };
  let hasUserContent = false;
  let hasFunctionContent = false;
  for (const part of parts) {
    if ("functionResponse" in part) {
      functionContent.parts.push(part);
      hasFunctionContent = true;
    } else {
      userContent.parts.push(part);
      hasUserContent = true;
    }
  }
  if (hasUserContent && hasFunctionContent) {
    throw new GoogleGenerativeAIError("Within a single message, FunctionResponse cannot be mixed with other type of part in the request for sending chat message.");
  }
  if (!hasUserContent && !hasFunctionContent) {
    throw new GoogleGenerativeAIError("No content is provided for sending chat message.");
  }
  if (hasUserContent) {
    return userContent;
  }
  return functionContent;
}
function formatCountTokensInput(params, modelParams) {
  var _a;
  let formattedGenerateContentRequest = {
    model: modelParams === null || modelParams === void 0 ? void 0 : modelParams.model,
    generationConfig: modelParams === null || modelParams === void 0 ? void 0 : modelParams.generationConfig,
    safetySettings: modelParams === null || modelParams === void 0 ? void 0 : modelParams.safetySettings,
    tools: modelParams === null || modelParams === void 0 ? void 0 : modelParams.tools,
    toolConfig: modelParams === null || modelParams === void 0 ? void 0 : modelParams.toolConfig,
    systemInstruction: modelParams === null || modelParams === void 0 ? void 0 : modelParams.systemInstruction,
    cachedContent: (_a = modelParams === null || modelParams === void 0 ? void 0 : modelParams.cachedContent) === null || _a === void 0 ? void 0 : _a.name,
    contents: []
  };
  const containsGenerateContentRequest = params.generateContentRequest != null;
  if (params.contents) {
    if (containsGenerateContentRequest) {
      throw new GoogleGenerativeAIRequestInputError("CountTokensRequest must have one of contents or generateContentRequest, not both.");
    }
    formattedGenerateContentRequest.contents = params.contents;
  } else if (containsGenerateContentRequest) {
    formattedGenerateContentRequest = Object.assign(Object.assign({}, formattedGenerateContentRequest), params.generateContentRequest);
  } else {
    const content = formatNewContent(params);
    formattedGenerateContentRequest.contents = [content];
  }
  return { generateContentRequest: formattedGenerateContentRequest };
}
function formatGenerateContentInput(params) {
  let formattedRequest;
  if (params.contents) {
    formattedRequest = params;
  } else {
    const content = formatNewContent(params);
    formattedRequest = { contents: [content] };
  }
  if (params.systemInstruction) {
    formattedRequest.systemInstruction = formatSystemInstruction(params.systemInstruction);
  }
  return formattedRequest;
}
function formatEmbedContentInput(params) {
  if (typeof params === "string" || Array.isArray(params)) {
    const content = formatNewContent(params);
    return { content };
  }
  return params;
}
var VALID_PART_FIELDS = [
  "text",
  "inlineData",
  "functionCall",
  "functionResponse",
  "executableCode",
  "codeExecutionResult"
];
var VALID_PARTS_PER_ROLE = {
  user: ["text", "inlineData"],
  function: ["functionResponse"],
  model: ["text", "functionCall", "executableCode", "codeExecutionResult"],
  // System instructions shouldn't be in history anyway.
  system: ["text"]
};
function validateChatHistory(history) {
  let prevContent = false;
  for (const currContent of history) {
    const { role, parts } = currContent;
    if (!prevContent && role !== "user") {
      throw new GoogleGenerativeAIError(`First content should be with role 'user', got ${role}`);
    }
    if (!POSSIBLE_ROLES.includes(role)) {
      throw new GoogleGenerativeAIError(`Each item should include role field. Got ${role} but valid roles are: ${JSON.stringify(POSSIBLE_ROLES)}`);
    }
    if (!Array.isArray(parts)) {
      throw new GoogleGenerativeAIError("Content should have 'parts' property with an array of Parts");
    }
    if (parts.length === 0) {
      throw new GoogleGenerativeAIError("Each Content should have at least one part");
    }
    const countFields = {
      text: 0,
      inlineData: 0,
      functionCall: 0,
      functionResponse: 0,
      fileData: 0,
      executableCode: 0,
      codeExecutionResult: 0
    };
    for (const part of parts) {
      for (const key of VALID_PART_FIELDS) {
        if (key in part) {
          countFields[key] += 1;
        }
      }
    }
    const validParts = VALID_PARTS_PER_ROLE[role];
    for (const key of VALID_PART_FIELDS) {
      if (!validParts.includes(key) && countFields[key] > 0) {
        throw new GoogleGenerativeAIError(`Content with role '${role}' can't contain '${key}' part`);
      }
    }
    prevContent = true;
  }
}
function isValidResponse(response) {
  var _a;
  if (response.candidates === void 0 || response.candidates.length === 0) {
    return false;
  }
  const content = (_a = response.candidates[0]) === null || _a === void 0 ? void 0 : _a.content;
  if (content === void 0) {
    return false;
  }
  if (content.parts === void 0 || content.parts.length === 0) {
    return false;
  }
  for (const part of content.parts) {
    if (part === void 0 || Object.keys(part).length === 0) {
      return false;
    }
    if (part.text !== void 0 && part.text === "") {
      return false;
    }
  }
  return true;
}
var SILENT_ERROR = "SILENT_ERROR";
var ChatSession = class {
  constructor(apiKey, model, params, _requestOptions = {}) {
    this.model = model;
    this.params = params;
    this._requestOptions = _requestOptions;
    this._history = [];
    this._sendPromise = Promise.resolve();
    this._apiKey = apiKey;
    if (params === null || params === void 0 ? void 0 : params.history) {
      validateChatHistory(params.history);
      this._history = params.history;
    }
  }
  /**
   * Gets the chat history so far. Blocked prompts are not added to history.
   * Blocked candidates are not added to history, nor are the prompts that
   * generated them.
   */
  async getHistory() {
    await this._sendPromise;
    return this._history;
  }
  /**
   * Sends a chat message and receives a non-streaming
   * {@link GenerateContentResult}.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async sendMessage(request, requestOptions = {}) {
    var _a, _b, _c, _d, _e, _f;
    await this._sendPromise;
    const newContent = formatNewContent(request);
    const generateContentRequest = {
      safetySettings: (_a = this.params) === null || _a === void 0 ? void 0 : _a.safetySettings,
      generationConfig: (_b = this.params) === null || _b === void 0 ? void 0 : _b.generationConfig,
      tools: (_c = this.params) === null || _c === void 0 ? void 0 : _c.tools,
      toolConfig: (_d = this.params) === null || _d === void 0 ? void 0 : _d.toolConfig,
      systemInstruction: (_e = this.params) === null || _e === void 0 ? void 0 : _e.systemInstruction,
      cachedContent: (_f = this.params) === null || _f === void 0 ? void 0 : _f.cachedContent,
      contents: [...this._history, newContent]
    };
    const chatSessionRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    let finalResult;
    this._sendPromise = this._sendPromise.then(() => generateContent(this._apiKey, this.model, generateContentRequest, chatSessionRequestOptions)).then((result) => {
      var _a2;
      if (isValidResponse(result.response)) {
        this._history.push(newContent);
        const responseContent = Object.assign({
          parts: [],
          // Response seems to come back without a role set.
          role: "model"
        }, (_a2 = result.response.candidates) === null || _a2 === void 0 ? void 0 : _a2[0].content);
        this._history.push(responseContent);
      } else {
        const blockErrorMessage = formatBlockErrorMessage(result.response);
        if (blockErrorMessage) {
          console.warn(`sendMessage() was unsuccessful. ${blockErrorMessage}. Inspect response object for details.`);
        }
      }
      finalResult = result;
    }).catch((e) => {
      this._sendPromise = Promise.resolve();
      throw e;
    });
    await this._sendPromise;
    return finalResult;
  }
  /**
   * Sends a chat message and receives the response as a
   * {@link GenerateContentStreamResult} containing an iterable stream
   * and a response promise.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async sendMessageStream(request, requestOptions = {}) {
    var _a, _b, _c, _d, _e, _f;
    await this._sendPromise;
    const newContent = formatNewContent(request);
    const generateContentRequest = {
      safetySettings: (_a = this.params) === null || _a === void 0 ? void 0 : _a.safetySettings,
      generationConfig: (_b = this.params) === null || _b === void 0 ? void 0 : _b.generationConfig,
      tools: (_c = this.params) === null || _c === void 0 ? void 0 : _c.tools,
      toolConfig: (_d = this.params) === null || _d === void 0 ? void 0 : _d.toolConfig,
      systemInstruction: (_e = this.params) === null || _e === void 0 ? void 0 : _e.systemInstruction,
      cachedContent: (_f = this.params) === null || _f === void 0 ? void 0 : _f.cachedContent,
      contents: [...this._history, newContent]
    };
    const chatSessionRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    const streamPromise = generateContentStream(this._apiKey, this.model, generateContentRequest, chatSessionRequestOptions);
    this._sendPromise = this._sendPromise.then(() => streamPromise).catch((_ignored) => {
      throw new Error(SILENT_ERROR);
    }).then((streamResult) => streamResult.response).then((response) => {
      if (isValidResponse(response)) {
        this._history.push(newContent);
        const responseContent = Object.assign({}, response.candidates[0].content);
        if (!responseContent.role) {
          responseContent.role = "model";
        }
        this._history.push(responseContent);
      } else {
        const blockErrorMessage = formatBlockErrorMessage(response);
        if (blockErrorMessage) {
          console.warn(`sendMessageStream() was unsuccessful. ${blockErrorMessage}. Inspect response object for details.`);
        }
      }
    }).catch((e) => {
      if (e.message !== SILENT_ERROR) {
        console.error(e);
      }
    });
    return streamPromise;
  }
};
async function countTokens(apiKey, model, params, singleRequestOptions) {
  const response = await makeModelRequest(model, Task.COUNT_TOKENS, apiKey, false, JSON.stringify(params), singleRequestOptions);
  return response.json();
}
async function embedContent(apiKey, model, params, requestOptions) {
  const response = await makeModelRequest(model, Task.EMBED_CONTENT, apiKey, false, JSON.stringify(params), requestOptions);
  return response.json();
}
async function batchEmbedContents(apiKey, model, params, requestOptions) {
  const requestsWithModel = params.requests.map((request) => {
    return Object.assign(Object.assign({}, request), { model });
  });
  const response = await makeModelRequest(model, Task.BATCH_EMBED_CONTENTS, apiKey, false, JSON.stringify({ requests: requestsWithModel }), requestOptions);
  return response.json();
}
var GenerativeModel = class {
  constructor(apiKey, modelParams, _requestOptions = {}) {
    this.apiKey = apiKey;
    this._requestOptions = _requestOptions;
    if (modelParams.model.includes("/")) {
      this.model = modelParams.model;
    } else {
      this.model = `models/${modelParams.model}`;
    }
    this.generationConfig = modelParams.generationConfig || {};
    this.safetySettings = modelParams.safetySettings || [];
    this.tools = modelParams.tools;
    this.toolConfig = modelParams.toolConfig;
    this.systemInstruction = formatSystemInstruction(modelParams.systemInstruction);
    this.cachedContent = modelParams.cachedContent;
  }
  /**
   * Makes a single non-streaming call to the model
   * and returns an object containing a single {@link GenerateContentResponse}.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async generateContent(request, requestOptions = {}) {
    var _a;
    const formattedParams = formatGenerateContentInput(request);
    const generativeModelRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    return generateContent(this.apiKey, this.model, Object.assign({ generationConfig: this.generationConfig, safetySettings: this.safetySettings, tools: this.tools, toolConfig: this.toolConfig, systemInstruction: this.systemInstruction, cachedContent: (_a = this.cachedContent) === null || _a === void 0 ? void 0 : _a.name }, formattedParams), generativeModelRequestOptions);
  }
  /**
   * Makes a single streaming call to the model and returns an object
   * containing an iterable stream that iterates over all chunks in the
   * streaming response as well as a promise that returns the final
   * aggregated response.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async generateContentStream(request, requestOptions = {}) {
    var _a;
    const formattedParams = formatGenerateContentInput(request);
    const generativeModelRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    return generateContentStream(this.apiKey, this.model, Object.assign({ generationConfig: this.generationConfig, safetySettings: this.safetySettings, tools: this.tools, toolConfig: this.toolConfig, systemInstruction: this.systemInstruction, cachedContent: (_a = this.cachedContent) === null || _a === void 0 ? void 0 : _a.name }, formattedParams), generativeModelRequestOptions);
  }
  /**
   * Gets a new {@link ChatSession} instance which can be used for
   * multi-turn chats.
   */
  startChat(startChatParams) {
    var _a;
    return new ChatSession(this.apiKey, this.model, Object.assign({ generationConfig: this.generationConfig, safetySettings: this.safetySettings, tools: this.tools, toolConfig: this.toolConfig, systemInstruction: this.systemInstruction, cachedContent: (_a = this.cachedContent) === null || _a === void 0 ? void 0 : _a.name }, startChatParams), this._requestOptions);
  }
  /**
   * Counts the tokens in the provided request.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async countTokens(request, requestOptions = {}) {
    const formattedParams = formatCountTokensInput(request, {
      model: this.model,
      generationConfig: this.generationConfig,
      safetySettings: this.safetySettings,
      tools: this.tools,
      toolConfig: this.toolConfig,
      systemInstruction: this.systemInstruction,
      cachedContent: this.cachedContent
    });
    const generativeModelRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    return countTokens(this.apiKey, this.model, formattedParams, generativeModelRequestOptions);
  }
  /**
   * Embeds the provided content.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async embedContent(request, requestOptions = {}) {
    const formattedParams = formatEmbedContentInput(request);
    const generativeModelRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    return embedContent(this.apiKey, this.model, formattedParams, generativeModelRequestOptions);
  }
  /**
   * Embeds an array of {@link EmbedContentRequest}s.
   *
   * Fields set in the optional {@link SingleRequestOptions} parameter will
   * take precedence over the {@link RequestOptions} values provided to
   * {@link GoogleGenerativeAI.getGenerativeModel }.
   */
  async batchEmbedContents(batchEmbedContentRequest, requestOptions = {}) {
    const generativeModelRequestOptions = Object.assign(Object.assign({}, this._requestOptions), requestOptions);
    return batchEmbedContents(this.apiKey, this.model, batchEmbedContentRequest, generativeModelRequestOptions);
  }
};
var GoogleGenerativeAI = class {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  /**
   * Gets a {@link GenerativeModel} instance for the provided model name.
   */
  getGenerativeModel(modelParams, requestOptions) {
    if (!modelParams.model) {
      throw new GoogleGenerativeAIError(`Must provide a model name. Example: genai.getGenerativeModel({ model: 'my-model-name' })`);
    }
    return new GenerativeModel(this.apiKey, modelParams, requestOptions);
  }
  /**
   * Creates a {@link GenerativeModel} instance from provided content cache.
   */
  getGenerativeModelFromCachedContent(cachedContent, modelParams, requestOptions) {
    if (!cachedContent.name) {
      throw new GoogleGenerativeAIRequestInputError("Cached content must contain a `name` field.");
    }
    if (!cachedContent.model) {
      throw new GoogleGenerativeAIRequestInputError("Cached content must contain a `model` field.");
    }
    const disallowedDuplicates = ["model", "systemInstruction"];
    for (const key of disallowedDuplicates) {
      if ((modelParams === null || modelParams === void 0 ? void 0 : modelParams[key]) && cachedContent[key] && (modelParams === null || modelParams === void 0 ? void 0 : modelParams[key]) !== cachedContent[key]) {
        if (key === "model") {
          const modelParamsComp = modelParams.model.startsWith("models/") ? modelParams.model.replace("models/", "") : modelParams.model;
          const cachedContentComp = cachedContent.model.startsWith("models/") ? cachedContent.model.replace("models/", "") : cachedContent.model;
          if (modelParamsComp === cachedContentComp) {
            continue;
          }
        }
        throw new GoogleGenerativeAIRequestInputError(`Different value for "${key}" specified in modelParams (${modelParams[key]}) and cachedContent (${cachedContent[key]})`);
      }
    }
    const modelParamsFromCache = Object.assign(Object.assign({}, modelParams), { model: cachedContent.model, tools: cachedContent.tools, toolConfig: cachedContent.toolConfig, systemInstruction: cachedContent.systemInstruction, cachedContent });
    return new GenerativeModel(this.apiKey, modelParamsFromCache, requestOptions);
  }
};

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
      const oldestPath = (0, import_path.join)(this.logDir, `${filename}.${this.maxFiles}`);
      try {
        await import_fs.promises.unlink(oldestPath);
      } catch {
      }
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldPath = (0, import_path.join)(this.logDir, `${filename}.${i}`);
        const newPath = (0, import_path.join)(this.logDir, `${filename}.${i + 1}`);
        try {
          await import_fs.promises.rename(oldPath, newPath);
        } catch {
        }
      }
      const rotatedPath = (0, import_path.join)(this.logDir, `${filename}.1`);
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
  // S3 Configuration (required - S3 is the only supported file storage backend)
  // NOTE: 'disabled' option is deprecated and will be removed in a future version.
  // Use the migration plugin (qtap-plugin-upgrade) to migrate local files to S3.
  S3_MODE: import_zod.z.enum(["embedded", "external", "disabled"]).optional().default("embedded"),
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
      S3_MODE: "embedded",
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

// provider.ts
var GOOGLE_SUPPORTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
];
var GoogleProvider = class {
  constructor() {
    this.supportsFileAttachments = true;
    this.supportedMimeTypes = GOOGLE_SUPPORTED_MIME_TYPES;
    this.supportsImageGeneration = true;
    this.supportsWebSearch = true;
  }
  /**
   * Check if a model is a Gemini 3 thinking model that requires thought signatures
   * These models require thought signatures on ALL model responses when tools are enabled
   */
  isThinkingModel(modelName) {
    const thinkingModels = [
      "gemini-3-pro",
      "gemini-3-pro-preview",
      "gemini-3-pro-image-preview",
      "gemini-2.5-pro",
      // 2.5 Pro also has thinking capabilities
      "gemini-2.5-flash-preview-05-20"
      // Thinking preview
    ];
    return thinkingModels.some((m) => modelName.toLowerCase().includes(m.toLowerCase()));
  }
  /**
   * Check if a model supports function calling (tools)
   * Some models like image-specialized models do not support function calling
   */
  supportsToolCalling(modelName) {
    const noToolsModels = [
      "gemini-2.5-flash-image",
      // Image generation model, no function calling
      "gemini-2.0-flash-exp-image-generation",
      // Experimental image model
      "imagen"
      // Imagen models don't support function calling
    ];
    const lowerName = modelName.toLowerCase();
    if (noToolsModels.some((m) => lowerName.includes(m.toLowerCase()))) {
      return false;
    }
    if (lowerName.includes("-image") && !lowerName.includes("vision")) {
      return false;
    }
    return true;
  }
  /**
   * Extract thought signature from Google Gemini response
   * Gemini 3 thinking models return thoughtSignature in the first part of the response
   * This must be stored and passed back for multi-turn function calling conversations
   */
  extractThoughtSignature(response) {
    try {
      const candidates = response?.candidates;
      if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
        return void 0;
      }
      const parts = candidates[0]?.content?.parts;
      if (!parts || !Array.isArray(parts) || parts.length === 0) {
        return void 0;
      }
      const firstPart = parts[0];
      if (firstPart?.thoughtSignature) {
        logger.debug("Extracted thought signature from response", {
          context: "GoogleProvider.extractThoughtSignature",
          signatureLength: firstPart.thoughtSignature.length
        });
        return firstPart.thoughtSignature;
      }
      for (const part of parts) {
        if (part?.functionCall?.thoughtSignature) {
          logger.debug("Extracted thought signature from function call", {
            context: "GoogleProvider.extractThoughtSignature",
            functionName: part.functionCall.name
          });
          return part.functionCall.thoughtSignature;
        }
      }
      return void 0;
    } catch (error) {
      logger.warn("Error extracting thought signature", {
        context: "GoogleProvider.extractThoughtSignature",
        error: error instanceof Error ? error.message : String(error)
      });
      return void 0;
    }
  }
  async formatMessagesWithAttachments(messages, modelName, hasTools) {
    logger.debug("Formatting messages with attachments", { context: "GoogleProvider.formatMessagesWithAttachments", messageCount: messages.length });
    const sent = [];
    const failed = [];
    const isThinking = this.isThinkingModel(modelName);
    let systemInstruction;
    let nonSystemMessages = messages;
    const systemMessages = messages.filter((m) => m.role === "system");
    if (systemMessages.length > 0) {
      systemInstruction = systemMessages.map((m) => m.content).join("\n\n");
      nonSystemMessages = messages.filter((m) => m.role !== "system");
      logger.debug("Extracted system instruction", {
        context: "GoogleProvider.formatMessagesWithAttachments",
        systemMessageCount: systemMessages.length,
        instructionLength: systemInstruction.length
      });
    }
    let filteredMessages = nonSystemMessages;
    let shouldDisableTools = false;
    if (hasTools && !this.supportsToolCalling(modelName)) {
      shouldDisableTools = true;
      logger.info("Disabling tools - model does not support function calling", {
        context: "GoogleProvider.formatMessagesWithAttachments",
        modelName
      });
    }
    if (!shouldDisableTools && isThinking && hasTools) {
      const assistantMessages = nonSystemMessages.filter((m) => m.role === "assistant");
      const assistantWithoutSig = assistantMessages.filter((m) => !m.thoughtSignature);
      if (assistantWithoutSig.length > 0) {
        shouldDisableTools = true;
        logger.warn("Disabling tools for thinking model due to legacy messages without thought signatures", {
          context: "GoogleProvider.formatMessagesWithAttachments",
          legacyMessageCount: assistantWithoutSig.length,
          totalAssistantMessages: assistantMessages.length,
          modelName
        });
      }
    }
    const mergedMessages = [];
    for (const msg of filteredMessages) {
      const lastMsg = mergedMessages[mergedMessages.length - 1];
      if (lastMsg && lastMsg.role === "user" && msg.role === "user") {
        lastMsg.content = lastMsg.content + "\n\n" + msg.content;
        if (msg.attachments) {
          lastMsg.attachments = [...lastMsg.attachments || [], ...msg.attachments];
        }
        logger.debug("Merged consecutive user messages", {
          context: "GoogleProvider.formatMessagesWithAttachments"
        });
      } else {
        mergedMessages.push({ ...msg });
      }
    }
    logger.debug("Messages after processing", {
      context: "GoogleProvider.formatMessagesWithAttachments",
      originalCount: messages.length,
      afterSystemExtraction: nonSystemMessages.length,
      afterMerging: mergedMessages.length,
      finalRoles: mergedMessages.map((m) => m.role),
      hasSystemInstruction: !!systemInstruction,
      shouldDisableTools
    });
    const formattedMessages = [];
    for (const msg of mergedMessages) {
      const formattedMessage = {
        role: msg.role === "assistant" ? "model" : "user",
        parts: []
      };
      if (msg.content) {
        formattedMessage.parts.push({ text: msg.content });
      }
      if (msg.role === "assistant" && msg.thoughtSignature) {
        if (formattedMessage.parts.length > 0 && formattedMessage.parts[0].text !== void 0) {
          formattedMessage.parts[0].thoughtSignature = msg.thoughtSignature;
        }
        logger.debug("Added thought signature to message", {
          context: "GoogleProvider.formatMessagesWithAttachments",
          hasSignature: true
        });
      }
      if (msg.attachments && msg.attachments.length > 0) {
        for (const attachment of msg.attachments) {
          if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
            logger.warn("Unsupported attachment type", {
              context: "GoogleProvider.formatMessagesWithAttachments",
              mimeType: attachment.mimeType
            });
            failed.push({
              id: attachment.id,
              error: `Unsupported file type: ${attachment.mimeType}. Google supports: ${this.supportedMimeTypes.join(", ")}`
            });
            continue;
          }
          if (!attachment.data) {
            logger.warn("Attachment data not loaded", {
              context: "GoogleProvider.formatMessagesWithAttachments",
              attachmentId: attachment.id
            });
            failed.push({
              id: attachment.id,
              error: "File data not loaded"
            });
            continue;
          }
          formattedMessage.parts.push({
            inlineData: {
              mimeType: attachment.mimeType,
              data: attachment.data
            }
          });
          sent.push(attachment.id);
        }
      }
      formattedMessages.push(formattedMessage);
    }
    logger.debug("Messages formatted with attachments", {
      context: "GoogleProvider.formatMessagesWithAttachments",
      sentCount: sent.length,
      failedCount: failed.length,
      messageCount: formattedMessages.length
    });
    return { messages: formattedMessages, systemInstruction, shouldDisableTools, attachmentResults: { sent, failed } };
  }
  async sendMessage(params, apiKey) {
    logger.debug("Google sendMessage called", { context: "GoogleProvider.sendMessage", model: params.model });
    const client = new GoogleGenerativeAI(apiKey);
    const tools = [];
    if (params.tools && params.tools.length > 0) {
      logger.debug("Adding tools to request", { context: "GoogleProvider.sendMessage", toolCount: params.tools.length });
      tools.push({
        functionDeclarations: params.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "OBJECT",
            properties: tool.parameters?.properties || {},
            required: tool.parameters?.required || []
          }
        }))
      });
    }
    if (params.webSearchEnabled) {
      logger.debug("Web search enabled", { context: "GoogleProvider.sendMessage" });
      tools.push({ googleSearch: {} });
    }
    const hasTools = tools.length > 0;
    const { messages, systemInstruction, shouldDisableTools, attachmentResults } = await this.formatMessagesWithAttachments(params.messages, params.model, hasTools);
    const modelConfig = {
      model: params.model,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        }
      ]
    };
    if (systemInstruction) {
      modelConfig.systemInstruction = systemInstruction;
      logger.debug("Using systemInstruction", { context: "GoogleProvider.sendMessage", instructionLength: systemInstruction.length });
    }
    if (hasTools && !shouldDisableTools) {
      modelConfig.tools = tools;
    } else if (shouldDisableTools) {
      logger.info("Tools disabled for this request due to legacy messages without thought signatures", {
        context: "GoogleProvider.sendMessage",
        toolCount: tools.length
      });
    }
    const model = client.getGenerativeModel(modelConfig);
    const stopSequences = params.stop ? Array.isArray(params.stop) ? params.stop : [params.stop] : void 0;
    const response = await model.generateContent({
      contents: messages,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 4096,
        topP: params.topP ?? 1,
        stopSequences
      }
    });
    const text = response.text?.() ?? "";
    const finishReason = response.candidates?.[0]?.finishReason ?? "STOP";
    const usage = response.usageMetadata;
    const thoughtSignature = this.extractThoughtSignature(response.response ?? response);
    logger.debug("Received Google response", {
      context: "GoogleProvider.sendMessage",
      finishReason,
      promptTokens: usage?.promptTokenCount,
      completionTokens: usage?.candidatesTokenCount,
      hasThoughtSignature: !!thoughtSignature
    });
    return {
      content: text,
      finishReason,
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0
      },
      raw: response,
      attachmentResults,
      thoughtSignature
    };
  }
  async *streamMessage(params, apiKey) {
    logger.debug("Google streamMessage called", { context: "GoogleProvider.streamMessage", model: params.model });
    const client = new GoogleGenerativeAI(apiKey);
    const tools = [];
    if (params.tools && params.tools.length > 0) {
      logger.debug("Adding tools to stream request", { context: "GoogleProvider.streamMessage", toolCount: params.tools.length });
      tools.push({
        functionDeclarations: params.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "OBJECT",
            properties: tool.parameters?.properties || {},
            required: tool.parameters?.required || []
          }
        }))
      });
    }
    if (params.webSearchEnabled) {
      logger.debug("Web search enabled for stream", { context: "GoogleProvider.streamMessage" });
      tools.push({ googleSearch: {} });
    }
    const hasTools = tools.length > 0;
    const { messages, systemInstruction, shouldDisableTools, attachmentResults } = await this.formatMessagesWithAttachments(params.messages, params.model, hasTools);
    const modelConfig = {
      model: params.model,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        }
      ]
    };
    if (systemInstruction) {
      modelConfig.systemInstruction = systemInstruction;
      logger.debug("Using systemInstruction for stream", { context: "GoogleProvider.streamMessage", instructionLength: systemInstruction.length });
    }
    if (hasTools && !shouldDisableTools) {
      modelConfig.tools = tools;
    } else if (shouldDisableTools) {
      logger.info("Tools disabled for this stream request due to legacy messages without thought signatures", {
        context: "GoogleProvider.streamMessage",
        toolCount: tools.length
      });
    }
    const model = client.getGenerativeModel(modelConfig);
    const stopSequences = params.stop ? Array.isArray(params.stop) ? params.stop : [params.stop] : void 0;
    const stream = await model.generateContentStream({
      contents: messages,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 4096,
        topP: params.topP ?? 1,
        stopSequences
      }
    });
    let chunkCount = 0;
    for await (const chunk of stream.stream) {
      chunkCount++;
      const text = chunk.text?.() ?? "";
      if (text) {
        logger.debug("Received stream chunk", { context: "GoogleProvider.streamMessage", chunkNumber: chunkCount, contentLength: text.length });
        yield {
          content: text,
          done: false
        };
      }
    }
    const response = await stream.response;
    const usage = response.usageMetadata;
    const thoughtSignature = this.extractThoughtSignature(response);
    const candidates = response?.candidates;
    const firstCandidate = candidates?.[0];
    const parts = firstCandidate?.content?.parts || [];
    const hasFunctionCall = parts.some((p) => p.functionCall);
    const finishReason = firstCandidate?.finishReason;
    logger.debug("Stream completed", {
      context: "GoogleProvider.streamMessage",
      totalChunks: chunkCount,
      promptTokens: usage?.promptTokenCount,
      completionTokens: usage?.candidatesTokenCount,
      hasThoughtSignature: !!thoughtSignature,
      hasFunctionCall,
      finishReason,
      partsCount: parts.length,
      partTypes: parts.map((p) => Object.keys(p))
    });
    yield {
      content: "",
      done: true,
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0
      },
      attachmentResults,
      rawResponse: response,
      thoughtSignature
    };
  }
  async validateApiKey(apiKey) {
    try {
      logger.debug("Validating Google API key", { context: "GoogleProvider.validateApiKey" });
      const client = new GoogleGenerativeAI(apiKey);
      const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });
      await model.generateContent("test");
      logger.debug("Google API key validation successful", { context: "GoogleProvider.validateApiKey" });
      return true;
    } catch (error) {
      logger.error("Google API key validation failed", { context: "GoogleProvider.validateApiKey" }, error instanceof Error ? error : void 0);
      return false;
    }
  }
  async getAvailableModels(apiKey) {
    try {
      logger.debug("Fetching Google models", { context: "GoogleProvider.getAvailableModels" });
      const models = [
        "gemini-2.5-flash-image",
        "gemini-3-pro-image-preview",
        "imagen-4",
        "imagen-4-fast",
        "gemini-2.5-flash",
        "gemini-pro-vision"
      ];
      logger.debug("Retrieved Google models", { context: "GoogleProvider.getAvailableModels", modelCount: models.length });
      return models;
    } catch (error) {
      logger.error("Failed to fetch Google models", { context: "GoogleProvider.getAvailableModels" }, error instanceof Error ? error : void 0);
      return [];
    }
  }
  async generateImage(params, apiKey) {
    logger.debug("Generating image with Google", {
      context: "GoogleProvider.generateImage",
      model: params.model,
      promptLength: params.prompt.length
    });
    const client = new GoogleGenerativeAI(apiKey);
    const modelName = params.model ?? "gemini-2.5-flash-image";
    const model = client.getGenerativeModel({
      model: modelName,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE
        }
      ]
    });
    const config2 = {
      temperature: 0.7
    };
    if (params.aspectRatio) {
      config2.aspectRatio = params.aspectRatio;
    }
    const response = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: params.prompt }]
        }
      ],
      generationConfig: config2
    });
    const images = [];
    const candidates = response.candidates ?? [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      for (const part of parts) {
        if ("inlineData" in part && part.inlineData) {
          images.push({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || "image/png"
          });
        }
      }
    }
    if (images.length === 0) {
      logger.error("No images generated in response", { context: "GoogleProvider.generateImage" });
      throw new Error("No images generated in response");
    }
    logger.debug("Image generation completed", { context: "GoogleProvider.generateImage", imageCount: images.length });
    return {
      images,
      raw: response
    };
  }
  /**
   * Get metadata for a specific model, including warnings and recommendations.
   * Returns warnings for models with known issues or limitations.
   */
  getModelMetadata(modelId) {
    const lowerModelId = modelId.toLowerCase();
    if (lowerModelId.includes("gemini-3-pro")) {
      return {
        id: modelId,
        displayName: "Gemini 3 Pro",
        experimental: true,
        warnings: [
          {
            level: "warning",
            message: "This thinking model may return empty responses due to a known Gemini API issue. Thought signature support is experimental."
          }
        ],
        missingCapabilities: lowerModelId.includes("-image") ? ["reliable-responses"] : void 0
      };
    }
    if (lowerModelId.includes("-image") && !lowerModelId.includes("vision")) {
      return {
        id: modelId,
        displayName: modelId.includes("2.5") ? "Gemini 2.5 Flash Image" : "Image Model",
        warnings: [
          {
            level: "info",
            message: "This model is optimized for image generation and does not support function calling (tools like memory search will be disabled)."
          }
        ],
        missingCapabilities: ["function-calling", "tools"]
      };
    }
    if (lowerModelId.includes("imagen")) {
      return {
        id: modelId,
        displayName: modelId.includes("4-fast") ? "Imagen 4 Fast" : "Imagen 4",
        warnings: [
          {
            level: "info",
            message: "Imagen models are specialized for image generation only and do not support chat or function calling."
          }
        ],
        missingCapabilities: ["chat", "function-calling", "tools"]
      };
    }
    return void 0;
  }
  /**
   * Get metadata for all models with special warnings or recommendations.
   */
  async getModelsWithMetadata(_apiKey) {
    const modelsWithWarnings = [
      "gemini-3-pro-image-preview",
      "gemini-2.5-flash-image",
      "imagen-4",
      "imagen-4-fast"
    ];
    return modelsWithWarnings.map((modelId) => this.getModelMetadata(modelId)).filter((m) => m !== void 0);
  }
};

// image-provider.ts
var GEMINI_IMAGE_MODELS = [
  "gemini-2.0-flash-exp",
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-preview-native-image",
  "gemini-3-pro-image-preview"
  // Nano Banana Pro
];
var IMAGEN_MODELS = ["imagen-4", "imagen-4-fast"];
var GoogleImagenProvider = class {
  constructor() {
    this.provider = "GOOGLE";
    this.supportedModels = [...IMAGEN_MODELS, ...GEMINI_IMAGE_MODELS];
  }
  /**
   * Check if a model uses the Gemini generateContent API
   */
  isGeminiImageModel(model) {
    return GEMINI_IMAGE_MODELS.some(
      (m) => model === m || model.startsWith(`${m}-`) || model.includes(m)
    );
  }
  async generateImage(params, apiKey) {
    const model = params.model ?? "imagen-4";
    logger.debug("Google image generation started", {
      context: "GoogleImagenProvider.generateImage",
      model,
      promptLength: params.prompt.length,
      isGeminiModel: this.isGeminiImageModel(model)
    });
    if (this.isGeminiImageModel(model)) {
      return this.generateWithGemini(params, apiKey, model);
    } else {
      return this.generateWithImagen(params, apiKey, model);
    }
  }
  /**
   * Generate images using Gemini's generateContent API
   * Used for: gemini-2.5-flash-image, gemini-3-pro-image-preview (Nano Banana Pro)
   */
  async generateWithGemini(params, apiKey, model) {
    const baseUrl = "https://generativelanguage.googleapis.com/v1beta";
    const endpoint = `${baseUrl}/models/${model}:generateContent`;
    const requestBody = {
      contents: [
        {
          parts: [{ text: params.prompt }]
        }
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"]
      }
    };
    const imageConfig = {};
    if (params.aspectRatio) {
      imageConfig.aspectRatio = params.aspectRatio;
    }
    const extendedParams = params;
    if (extendedParams.imageSize) {
      imageConfig.imageSize = extendedParams.imageSize;
    }
    if (Object.keys(imageConfig).length > 0) {
      requestBody.generationConfig.imageConfig = imageConfig;
    }
    logger.debug("Sending request to Gemini generateContent API", {
      context: "GoogleImagenProvider.generateWithGemini",
      endpoint,
      model,
      hasImageConfig: Object.keys(imageConfig).length > 0
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const error = await response.json();
      logger.error("Gemini API error", {
        context: "GoogleImagenProvider.generateWithGemini",
        status: response.status,
        errorMessage: error.error?.message
      });
      throw new Error(
        error.error?.message || `Gemini API error: ${response.status}`
      );
    }
    const data = await response.json();
    const images = [];
    let textResponse = "";
    const candidate = data.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          images.push({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || "image/png"
          });
        } else if (part.text) {
          textResponse = part.text;
        }
      }
    }
    logger.debug("Gemini image generation completed", {
      context: "GoogleImagenProvider.generateWithGemini",
      imageCount: images.length,
      hasTextResponse: !!textResponse
    });
    if (images.length === 0) {
      throw new Error(
        textResponse || "No images returned from Gemini API"
      );
    }
    return {
      images,
      raw: data
    };
  }
  /**
   * Generate images using Imagen's predict API
   * Used for: imagen-4, imagen-4-fast
   */
  async generateWithImagen(params, apiKey, model) {
    const baseUrl = "https://generativelanguage.googleapis.com/v1beta";
    const endpoint = `${baseUrl}/models/${model}:predict`;
    const requestBody = {
      instances: [
        {
          prompt: params.prompt
        }
      ],
      parameters: {
        sampleCount: params.n ?? 1
      }
    };
    if (params.aspectRatio) {
      requestBody.parameters.aspectRatio = params.aspectRatio;
    }
    const extendedParams = params;
    if (extendedParams.seed !== void 0) {
      requestBody.parameters.seed = extendedParams.seed;
    }
    logger.debug("Sending request to Google Imagen API", {
      context: "GoogleImagenProvider.generateWithImagen",
      endpoint,
      sampleCount: requestBody.parameters.sampleCount
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const error = await response.json();
      logger.error("Google Imagen API error", {
        context: "GoogleImagenProvider.generateWithImagen",
        status: response.status,
        errorMessage: error.error?.message
      });
      throw new Error(
        error.error?.message || `Google Imagen API error: ${response.status}`
      );
    }
    const data = await response.json();
    logger.debug("Imagen generation completed", {
      context: "GoogleImagenProvider.generateWithImagen",
      imageCount: data.predictions?.length ?? 0
    });
    return {
      images: (data.predictions ?? []).map((pred) => ({
        data: pred.bytesBase64Encoded,
        mimeType: pred.mimeType || "image/png"
      })),
      raw: data
    };
  }
  async validateApiKey(apiKey) {
    try {
      logger.debug("Validating Google API key for image generation", { context: "GoogleImagenProvider.validateApiKey" });
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        method: "GET",
        headers: {
          "x-goog-api-key": apiKey
        }
      });
      const isValid = response.ok;
      logger.debug("Google API key validation result", { context: "GoogleImagenProvider.validateApiKey", isValid });
      return isValid;
    } catch (error) {
      logger.error("Google API key validation failed for image generation", {
        context: "GoogleImagenProvider.validateApiKey"
      }, error instanceof Error ? error : void 0);
      return false;
    }
  }
  async getAvailableModels() {
    logger.debug("Getting available Google image models", { context: "GoogleImagenProvider.getAvailableModels" });
    return this.supportedModels;
  }
};

// icon.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function GoogleIcon({ className = "h-5 w-5" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      className: `text-blue-600 ${className}`,
      fill: "currentColor",
      viewBox: "0 0 24 24",
      xmlns: "http://www.w3.org/2000/svg",
      "data-testid": "google-icon",
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
            fontSize: "10",
            fontWeight: "bold",
            fontFamily: "system-ui, -apple-system, sans-serif",
            children: "GGL"
          }
        )
      ]
    }
  );
}

// ../../../lib/llm/tool-formatting-utils.ts
function convertOpenAIToGoogleFormat(tool) {
  logger.debug("Converting tool to Google format", {
    context: "tool-formatting",
    toolName: tool.function.name
  });
  return {
    name: tool.function.name,
    description: tool.function.description,
    parameters: {
      type: "object",
      properties: tool.function.parameters.properties,
      required: tool.function.parameters.required
    }
  };
}
function parseGoogleToolCalls(response) {
  const toolCalls = [];
  try {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!parts || !Array.isArray(parts)) {
      return toolCalls;
    }
    for (const part of parts) {
      if (part.functionCall) {
        logger.debug("Parsed Google tool call", {
          context: "tool-parsing",
          toolName: part.functionCall.name
        });
        toolCalls.push({
          name: part.functionCall.name,
          arguments: part.functionCall.args || {}
        });
      }
    }
  } catch (error) {
    logger.error("Error parsing Google tool calls", { context: "tool-parsing" }, error instanceof Error ? error : void 0);
  }
  return toolCalls;
}

// index.ts
var metadata = {
  providerName: "GOOGLE",
  displayName: "Google Gemini",
  description: "Google Gemini models including text and image generation via Generative AI API",
  colors: {
    bg: "bg-blue-100",
    text: "text-blue-800",
    icon: "text-blue-600"
  },
  abbreviation: "GGL"
};
var config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: "Google Generative AI API Key"
};
var capabilities = {
  chat: true,
  imageGeneration: true,
  embeddings: false,
  webSearch: true
};
var attachmentSupport = {
  supportsAttachments: true,
  supportedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  description: "Images only (JPEG, PNG, GIF, WebP)",
  notes: "Images are supported in Gemini models for vision analysis"
};
var messageFormat = {
  supportsNameField: false,
  supportedRoles: []
};
var cheapModels = {
  defaultModel: "gemini-2.0-flash",
  recommendedModels: ["gemini-2.0-flash", "gemini-1.5-flash"]
};
var plugin = {
  metadata,
  config,
  capabilities,
  attachmentSupport,
  // Runtime configuration
  messageFormat,
  charsPerToken: 3.8,
  // Google uses SentencePiece tokenizer, slightly more efficient
  toolFormat: "google",
  cheapModels,
  defaultContextWindow: 1e6,
  /**
   * Factory method to create a Google LLM provider instance
   */
  createProvider: (baseUrl) => {
    logger.debug("Creating Google provider instance", { context: "plugin.createProvider", baseUrl });
    return new GoogleProvider();
  },
  /**
   * Factory method to create a Google Imagen image generation provider instance
   */
  createImageProvider: (baseUrl) => {
    logger.debug("Creating Google Imagen provider instance", { context: "plugin.createImageProvider", baseUrl });
    return new GoogleImagenProvider();
  },
  /**
   * Get list of available models from Google API
   * Requires a valid API key
   */
  getAvailableModels: async (apiKey, baseUrl) => {
    logger.debug("Fetching available Google models", { context: "plugin.getAvailableModels" });
    try {
      const provider = new GoogleProvider();
      const models = await provider.getAvailableModels(apiKey);
      logger.debug("Successfully fetched Google models", { context: "plugin.getAvailableModels", count: models.length });
      return models;
    } catch (error) {
      logger.error("Failed to fetch Google models", { context: "plugin.getAvailableModels" }, error instanceof Error ? error : void 0);
      return [];
    }
  },
  /**
   * Validate a Google API key
   */
  validateApiKey: async (apiKey, baseUrl) => {
    logger.debug("Validating Google API key", { context: "plugin.validateApiKey" });
    try {
      const provider = new GoogleProvider();
      const isValid = await provider.validateApiKey(apiKey);
      logger.debug("Google API key validation result", { context: "plugin.validateApiKey", isValid });
      return isValid;
    } catch (error) {
      logger.error("Error validating Google API key", { context: "plugin.validateApiKey" }, error instanceof Error ? error : void 0);
      return false;
    }
  },
  /**
   * Get static model information
   * Returns cached information about Google models without needing API calls
   */
  getModelInfo: () => {
    logger.debug("Getting Google model information", {
      context: "plugin.getModelInfo"
    });
    return [
      // Chat models
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        contextWindow: 1e6,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "gemini-pro-vision",
        name: "Gemini Pro Vision",
        contextWindow: 32e3,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true
      },
      // Gemini image generation models (use generateContent API)
      {
        id: "gemini-2.0-flash-exp",
        name: "Gemini 2.0 Flash Experimental",
        contextWindow: 1e6,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "gemini-2.5-flash-image",
        name: "Gemini 2.5 Flash Image (Nano Banana)",
        contextWindow: 1e6,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "gemini-2.5-flash-preview-native-image",
        name: "Gemini 2.5 Flash Native Image",
        contextWindow: 1e6,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true
      },
      {
        id: "gemini-3-pro-image-preview",
        name: "Gemini 3 Pro Image Preview (Nano Banana Pro)",
        contextWindow: 65536,
        maxOutputTokens: 32768,
        supportsImages: true,
        supportsTools: true
      },
      // Imagen models (use predict API)
      {
        id: "imagen-4",
        name: "Imagen 4",
        contextWindow: 0,
        maxOutputTokens: 0,
        supportsImages: false,
        supportsTools: false
      },
      {
        id: "imagen-4-fast",
        name: "Imagen 4 Fast",
        contextWindow: 0,
        maxOutputTokens: 0,
        supportsImages: false,
        supportsTools: false
      }
    ];
  },
  /**
   * Get static image generation model information
   * Returns cached information about Google image generation models
   */
  getImageGenerationModels: () => {
    return [
      // Gemini image generation models (use generateContent API)
      {
        id: "gemini-2.0-flash-exp",
        name: "Gemini 2.0 Flash Experimental",
        supportedAspectRatios: [
          "1:1",
          "2:3",
          "3:2",
          "3:4",
          "4:3",
          "4:5",
          "5:4",
          "9:16",
          "16:9"
        ],
        description: "Experimental Gemini 2.0 model with image generation"
      },
      {
        id: "gemini-2.5-flash-image",
        name: "Gemini 2.5 Flash Image (Nano Banana)",
        supportedAspectRatios: [
          "1:1",
          "2:3",
          "3:2",
          "3:4",
          "4:3",
          "4:5",
          "5:4",
          "9:16",
          "16:9",
          "21:9"
        ],
        description: "Fast, efficient model for general image generation with text rendering"
      },
      {
        id: "gemini-2.5-flash-preview-native-image",
        name: "Gemini 2.5 Flash Native Image",
        supportedAspectRatios: [
          "1:1",
          "2:3",
          "3:2",
          "3:4",
          "4:3",
          "4:5",
          "5:4",
          "9:16",
          "16:9",
          "21:9"
        ],
        description: "Native image generation variant of Gemini 2.5 Flash"
      },
      {
        id: "gemini-3-pro-image-preview",
        name: "Gemini 3 Pro Image Preview (Nano Banana Pro)",
        supportedAspectRatios: [
          "1:1",
          "2:3",
          "3:2",
          "3:4",
          "4:3",
          "4:5",
          "5:4",
          "9:16",
          "16:9",
          "21:9"
        ],
        description: "Advanced image generation with fine-grained creative controls, 2K/4K output, up to 14 reference images"
      },
      // Imagen models (use predict API)
      {
        id: "imagen-4",
        name: "Imagen 4",
        supportedAspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
        description: "High-quality image generation with Imagen 4"
      },
      {
        id: "imagen-4-fast",
        name: "Imagen 4 Fast",
        supportedAspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
        description: "Faster image generation variant of Imagen 4"
      }
    ];
  },
  /**
   * Render the Google icon
   */
  renderIcon: (props) => {
    logger.debug("Rendering Google icon", { context: "plugin.renderIcon", className: props.className });
    return GoogleIcon(props);
  },
  /**
   * Format tools from OpenAI format to Google format
   * Converts tool definitions to Google's function calling format
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in Google format
   */
  formatTools: (tools) => {
    logger.debug("Formatting tools for Google provider", {
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
        const openaiTool = tool;
        const googleTool = convertOpenAIToGoogleFormat(openaiTool);
        formattedTools.push(googleTool);
      }
      logger.debug("Successfully formatted tools", {
        context: "plugin.formatTools",
        count: formattedTools.length
      });
      return formattedTools;
    } catch (error) {
      logger.error(
        "Error formatting tools for Google",
        { context: "plugin.formatTools" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  },
  /**
   * Parse tool calls from Google response format
   * Extracts tool calls from Google Gemini API responses
   *
   * @param response Google API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response) => {
    logger.debug("Parsing tool calls from Google response", {
      context: "plugin.parseToolCalls"
    });
    try {
      const toolCalls = parseGoogleToolCalls(response);
      logger.debug("Successfully parsed tool calls", {
        context: "plugin.parseToolCalls",
        count: toolCalls.length
      });
      return toolCalls;
    } catch (error) {
      logger.error(
        "Error parsing tool calls from Google response",
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
/*! Bundled license information:

@google/generative-ai/dist/index.mjs:
  (**
   * @license
   * Copyright 2024 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)

@google/generative-ai/dist/index.mjs:
  (**
   * @license
   * Copyright 2024 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)
*/
