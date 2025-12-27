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
  sdkVersion: "0.3.1",
  genVersion: "2.768.0",
  userAgent: "speakeasy-sdk/typescript 0.3.1 2.768.0 1.0.0 @openrouter/sdk"
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

// node_modules/@openrouter/sdk/esm/lib/base64.js
var z = __toESM(require("zod/v4"), 1);
function bytesToBase64(u8arr) {
  return btoa(String.fromCodePoint(...u8arr));
}
function bytesFromBase64(encoded) {
  return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
}
function stringToBytes(str) {
  return new TextEncoder().encode(str);
}
function stringToBase64(str) {
  return bytesToBase64(stringToBytes(str));
}
var zodOutbound = z.custom((x) => x instanceof Uint8Array).or(z.string().transform(stringToBytes));
var zodInbound = z.custom((x) => x instanceof Uint8Array).or(z.string().transform(bytesFromBase64));

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
var z2 = __toESM(require("zod/v4"), 1);

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
var envSchema = z2.object({
  OPENROUTER_API_KEY: z2.string().optional(),
  OPENROUTER_HTTP_REFERER: z2.string().optional(),
  OPENROUTER_X_TITLE: z2.string().optional(),
  OPENROUTER_DEBUG: z2.coerce.boolean().optional()
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
var _ClientSDK_httpClient;
var _ClientSDK_hooks;
var _ClientSDK_logger;
var gt = typeof globalThis === "undefined" ? null : globalThis;
var webWorkerLike = typeof gt === "object" && gt != null && "importScripts" in gt && typeof gt["importScripts"] === "function";
var isBrowserLike = webWorkerLike || typeof navigator !== "undefined" && "serviceWorker" in navigator || typeof window === "object" && typeof window.document !== "undefined";
var ClientSDK = class {
  constructor(options = {}) {
    _ClientSDK_httpClient.set(this, void 0);
    _ClientSDK_hooks.set(this, void 0);
    _ClientSDK_logger.set(this, void 0);
    const opt = options;
    if (typeof opt === "object" && opt != null && "hooks" in opt && opt.hooks instanceof SDKHooks) {
      __classPrivateFieldSet(this, _ClientSDK_hooks, opt.hooks, "f");
    } else {
      __classPrivateFieldSet(this, _ClientSDK_hooks, new SDKHooks(), "f");
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
    const { method, path, query, headers: opHeaders, security } = conf;
    const base = conf.baseURL ?? this._baseURL;
    if (!base) {
      return ERR(new InvalidRequestError("No base URL provided for operation"));
    }
    const reqURL = new URL(base);
    const inputURL = new URL(path, reqURL);
    if (path) {
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
_ClientSDK_httpClient = /* @__PURE__ */ new WeakMap(), _ClientSDK_hooks = /* @__PURE__ */ new WeakMap(), _ClientSDK_logger = /* @__PURE__ */ new WeakMap();
var jsonLikeContentTypeRE = /(application|text)\/.*?\+*json.*/;
var jsonlLikeContentTypeRE = /(application|text)\/(.*?\+*\bjsonl\b.*|.*?\+*\bx-ndjson\b.*)/;
async function logRequest(logger2, req) {
  if (!logger2) {
    return;
  }
  const contentType = req.headers.get("content-type");
  const ct = contentType?.split(";")[0] || "";
  logger2.group(`> Request: ${req.method} ${req.url}`);
  logger2.group("Headers:");
  for (const [k, v] of req.headers.entries()) {
    logger2.log(`${k}: ${v}`);
  }
  logger2.groupEnd();
  logger2.group("Body:");
  switch (true) {
    case jsonLikeContentTypeRE.test(ct):
      logger2.log(await req.clone().json());
      break;
    case ct.startsWith("text/"):
      logger2.log(await req.clone().text());
      break;
    case ct === "multipart/form-data": {
      const body = await req.clone().formData();
      for (const [k, v] of body) {
        const vlabel = v instanceof Blob ? "<Blob>" : v;
        logger2.log(`${k}: ${vlabel}`);
      }
      break;
    }
    default:
      logger2.log(`<${contentType}>`);
      break;
  }
  logger2.groupEnd();
  logger2.groupEnd();
}
async function logResponse(logger2, res, req) {
  if (!logger2) {
    return;
  }
  const contentType = res.headers.get("content-type");
  const ct = contentType?.split(";")[0] || "";
  logger2.group(`< Response: ${req.method} ${req.url}`);
  logger2.log("Status Code:", res.status, res.statusText);
  logger2.group("Headers:");
  for (const [k, v] of res.headers.entries()) {
    logger2.log(`${k}: ${v}`);
  }
  logger2.groupEnd();
  logger2.group("Body:");
  switch (true) {
    case (matchContentType(res, "application/json") || jsonLikeContentTypeRE.test(ct) && !jsonlLikeContentTypeRE.test(ct)):
      logger2.log(await res.clone().json());
      break;
    case (matchContentType(res, "application/jsonl") || jsonlLikeContentTypeRE.test(ct)):
      logger2.log(await res.clone().text());
      break;
    case matchContentType(res, "text/event-stream"):
      logger2.log(`<${contentType}>`);
      break;
    case matchContentType(res, "text/*"):
      logger2.log(await res.clone().text());
      break;
    case matchContentType(res, "multipart/form-data"): {
      const body = await res.clone().formData();
      for (const [k, v] of body) {
        const vlabel = v instanceof Blob ? "<Blob>" : v;
        logger2.log(`${k}: ${vlabel}`);
      }
      break;
    }
    default:
      logger2.log(`<${contentType}>`);
      break;
  }
  logger2.groupEnd();
  logger2.groupEnd();
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
var z4 = __toESM(require("zod/v4/core"), 1);

// node_modules/@openrouter/sdk/esm/models/errors/sdkvalidationerror.js
var z3 = __toESM(require("zod/v4/core"), 1);
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
    if (this.cause instanceof z3.$ZodError) {
      return `${this.rawMessage}
${formatZodError(this.cause)}`;
    } else {
      return this.toString();
    }
  }
};
function formatZodError(err) {
  return z3.prettifyError(err);
}

// node_modules/@openrouter/sdk/esm/models/errors/responsevalidationerror.js
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
    if (this.cause instanceof z4.$ZodError) {
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

// node_modules/@openrouter/sdk/esm/lib/schemas.js
var z5 = __toESM(require("zod/v4"), 1);
function safeParse(rawValue, fn, errorMessage) {
  try {
    return OK(fn(rawValue));
  } catch (err) {
    return ERR(new SDKValidationError(errorMessage, err, rawValue));
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
var z134 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/activityitem.js
var z6 = __toESM(require("zod/v4"), 1);
var ActivityItem$inboundSchema = z6.object({
  date: z6.string(),
  model: z6.string(),
  model_permaslug: z6.string(),
  endpoint_id: z6.string(),
  provider_name: z6.string(),
  usage: z6.number(),
  byok_usage_inference: z6.number(),
  requests: z6.number(),
  prompt_tokens: z6.number(),
  completion_tokens: z6.number(),
  reasoning_tokens: z6.number()
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
var z15 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitem.js
var z13 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemaudio.js
var z7 = __toESM(require("zod/v4"), 1);
var ChatMessageContentItemAudioInputAudio$inboundSchema = z7.object({
  data: z7.string(),
  format: z7.string()
});
var ChatMessageContentItemAudioInputAudio$outboundSchema = z7.object({
  data: z7.string(),
  format: z7.string()
});
var ChatMessageContentItemAudio$inboundSchema = z7.object({
  type: z7.literal("input_audio"),
  input_audio: z7.lazy(() => ChatMessageContentItemAudioInputAudio$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "input_audio": "inputAudio"
  });
});
var ChatMessageContentItemAudio$outboundSchema = z7.object({
  type: z7.literal("input_audio"),
  inputAudio: z7.lazy(() => ChatMessageContentItemAudioInputAudio$outboundSchema)
}).transform((v) => {
  return remap(v, {
    inputAudio: "input_audio"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemimage.js
var z9 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/types/enums.js
var z8 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/types/unrecognized.js
function unrecognized(value) {
  globalCount++;
  return value;
}
var globalCount = 0;

// node_modules/@openrouter/sdk/esm/types/enums.js
function inboundSchema(enumObj) {
  const options = Object.values(enumObj);
  return z8.union([
    ...options.map((x) => z8.literal(x)),
    z8.string().transform((x) => unrecognized(x))
  ]);
}
function inboundSchemaInt(enumObj) {
  const options = Object.values(enumObj).filter((v) => typeof v === "number");
  return z8.union([
    ...options.map((x) => z8.literal(x)),
    z8.int().transform((x) => unrecognized(x))
  ]);
}
function outboundSchema(_) {
  return z8.string();
}
function outboundSchemaInt(_) {
  return z8.int();
}

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemimage.js
var ChatMessageContentItemImageDetail = {
  Auto: "auto",
  Low: "low",
  High: "high"
};
var ChatMessageContentItemImageDetail$inboundSchema = inboundSchema(ChatMessageContentItemImageDetail);
var ChatMessageContentItemImageDetail$outboundSchema = outboundSchema(ChatMessageContentItemImageDetail);
var ImageUrl$inboundSchema = z9.object({
  url: z9.string(),
  detail: ChatMessageContentItemImageDetail$inboundSchema.optional()
});
var ImageUrl$outboundSchema = z9.object({
  url: z9.string(),
  detail: ChatMessageContentItemImageDetail$outboundSchema.optional()
});
var ChatMessageContentItemImage$inboundSchema = z9.object({
  type: z9.literal("image_url"),
  image_url: z9.lazy(() => ImageUrl$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "image_url": "imageUrl"
  });
});
var ChatMessageContentItemImage$outboundSchema = z9.object({
  type: z9.literal("image_url"),
  imageUrl: z9.lazy(() => ImageUrl$outboundSchema)
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemtext.js
var z11 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemcachecontrol.js
var z10 = __toESM(require("zod/v4"), 1);
var Ttl = {
  Fivem: "5m",
  Oneh: "1h"
};
var Ttl$inboundSchema = inboundSchema(Ttl);
var Ttl$outboundSchema = outboundSchema(Ttl);
var ChatMessageContentItemCacheControl$inboundSchema = z10.object({
  type: z10.literal("ephemeral"),
  ttl: Ttl$inboundSchema.optional()
});
var ChatMessageContentItemCacheControl$outboundSchema = z10.object({
  type: z10.literal("ephemeral"),
  ttl: Ttl$outboundSchema.optional()
});

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemtext.js
var ChatMessageContentItemText$inboundSchema = z11.object({
  type: z11.literal("text"),
  text: z11.string(),
  cache_control: ChatMessageContentItemCacheControl$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "cache_control": "cacheControl"
  });
});
var ChatMessageContentItemText$outboundSchema = z11.object({
  type: z11.literal("text"),
  text: z11.string(),
  cacheControl: ChatMessageContentItemCacheControl$outboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    cacheControl: "cache_control"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitemvideo.js
var z12 = __toESM(require("zod/v4"), 1);
var VideoUrl2$inboundSchema = z12.object({
  url: z12.string()
});
var VideoUrl2$outboundSchema = z12.object({
  url: z12.string()
});
var ChatMessageContentItemVideoVideoURL$inboundSchema = z12.object({
  type: z12.literal("video_url"),
  video_url: z12.lazy(() => VideoUrl2$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "video_url": "videoUrl"
  });
});
var ChatMessageContentItemVideoVideoURL$outboundSchema = z12.object({
  type: z12.literal("video_url"),
  videoUrl: z12.lazy(() => VideoUrl2$outboundSchema)
}).transform((v) => {
  return remap(v, {
    videoUrl: "video_url"
  });
});
var VideoUrl1$inboundSchema = z12.object({
  url: z12.string()
});
var VideoUrl1$outboundSchema = z12.object({
  url: z12.string()
});
var ChatMessageContentItemVideoInputVideo$inboundSchema = z12.object({
  type: z12.literal("input_video"),
  video_url: z12.lazy(() => VideoUrl1$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "video_url": "videoUrl"
  });
});
var ChatMessageContentItemVideoInputVideo$outboundSchema = z12.object({
  type: z12.literal("input_video"),
  videoUrl: z12.lazy(() => VideoUrl1$outboundSchema)
}).transform((v) => {
  return remap(v, {
    videoUrl: "video_url"
  });
});
var ChatMessageContentItemVideo$inboundSchema = z12.union([
  z12.lazy(() => ChatMessageContentItemVideoInputVideo$inboundSchema),
  z12.lazy(() => ChatMessageContentItemVideoVideoURL$inboundSchema)
]);
var ChatMessageContentItemVideo$outboundSchema = z12.union([
  z12.lazy(() => ChatMessageContentItemVideoInputVideo$outboundSchema),
  z12.lazy(() => ChatMessageContentItemVideoVideoURL$outboundSchema)
]);

// node_modules/@openrouter/sdk/esm/models/chatmessagecontentitem.js
var ChatMessageContentItem$inboundSchema = z13.union([
  ChatMessageContentItemText$inboundSchema,
  ChatMessageContentItemImage$inboundSchema,
  ChatMessageContentItemAudio$inboundSchema,
  ChatMessageContentItemVideo$inboundSchema.and(z13.object({ type: z13.literal("input_video") })),
  z13.lazy(() => ChatMessageContentItemVideo$inboundSchema).and(z13.object({ type: z13.literal("video_url") }))
]);
var ChatMessageContentItem$outboundSchema = z13.union([
  ChatMessageContentItemText$outboundSchema,
  ChatMessageContentItemImage$outboundSchema,
  ChatMessageContentItemAudio$outboundSchema,
  ChatMessageContentItemVideo$outboundSchema.and(z13.object({ type: z13.literal("input_video") })),
  z13.lazy(() => ChatMessageContentItemVideo$outboundSchema).and(z13.object({ type: z13.literal("video_url") }))
]);

// node_modules/@openrouter/sdk/esm/models/chatmessagetoolcall.js
var z14 = __toESM(require("zod/v4"), 1);
var ChatMessageToolCallFunction$inboundSchema = z14.object({
  name: z14.string(),
  arguments: z14.string()
});
var ChatMessageToolCallFunction$outboundSchema = z14.object({
  name: z14.string(),
  arguments: z14.string()
});
var ChatMessageToolCall$inboundSchema = z14.object({
  id: z14.string(),
  type: z14.literal("function"),
  function: z14.lazy(() => ChatMessageToolCallFunction$inboundSchema)
});
var ChatMessageToolCall$outboundSchema = z14.object({
  id: z14.string(),
  type: z14.literal("function"),
  function: z14.lazy(() => ChatMessageToolCallFunction$outboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/assistantmessage.js
var AssistantMessageContent$inboundSchema = z15.union([z15.string(), z15.array(ChatMessageContentItem$inboundSchema)]);
var AssistantMessageContent$outboundSchema = z15.union([z15.string(), z15.array(ChatMessageContentItem$outboundSchema)]);
var AssistantMessage$inboundSchema = z15.object({
  role: z15.literal("assistant"),
  content: z15.nullable(z15.union([z15.string(), z15.array(ChatMessageContentItem$inboundSchema)])).optional(),
  name: z15.string().optional(),
  tool_calls: z15.array(ChatMessageToolCall$inboundSchema).optional(),
  refusal: z15.nullable(z15.string()).optional(),
  reasoning: z15.nullable(z15.string()).optional()
}).transform((v) => {
  return remap(v, {
    "tool_calls": "toolCalls"
  });
});
var AssistantMessage$outboundSchema = z15.object({
  role: z15.literal("assistant"),
  content: z15.nullable(z15.union([z15.string(), z15.array(ChatMessageContentItem$outboundSchema)])).optional(),
  name: z15.string().optional(),
  toolCalls: z15.array(ChatMessageToolCall$outboundSchema).optional(),
  refusal: z15.nullable(z15.string()).optional(),
  reasoning: z15.nullable(z15.string()).optional()
}).transform((v) => {
  return remap(v, {
    toolCalls: "tool_calls"
  });
});

// node_modules/@openrouter/sdk/esm/models/badgatewayresponseerrordata.js
var z16 = __toESM(require("zod/v4"), 1);
var BadGatewayResponseErrorData$inboundSchema = z16.object({
  code: z16.int(),
  message: z16.string(),
  metadata: z16.nullable(z16.record(z16.string(), z16.nullable(z16.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/badrequestresponseerrordata.js
var z17 = __toESM(require("zod/v4"), 1);
var BadRequestResponseErrorData$inboundSchema = z17.object({
  code: z17.int(),
  message: z17.string(),
  metadata: z17.nullable(z17.record(z17.string(), z17.nullable(z17.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/chatcompletionfinishreason.js
var ChatCompletionFinishReason = {
  ToolCalls: "tool_calls",
  Stop: "stop",
  Length: "length",
  ContentFilter: "content_filter",
  Error: "error"
};
var ChatCompletionFinishReason$inboundSchema = inboundSchema(ChatCompletionFinishReason);

// node_modules/@openrouter/sdk/esm/models/chaterror.js
var z18 = __toESM(require("zod/v4"), 1);
var Code$inboundSchema = z18.union([
  z18.string(),
  z18.number()
]);
var ChatErrorError$inboundSchema = z18.object({
  code: z18.nullable(z18.union([z18.string(), z18.number()])),
  message: z18.string(),
  param: z18.nullable(z18.string()).optional(),
  type: z18.nullable(z18.string()).optional()
});

// node_modules/@openrouter/sdk/esm/models/chatgenerationparams.js
var z31 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatstreamoptions.js
var z19 = __toESM(require("zod/v4"), 1);
var ChatStreamOptions$outboundSchema = z19.object({
  includeUsage: z19.boolean().optional()
}).transform((v) => {
  return remap(v, {
    includeUsage: "include_usage"
  });
});

// node_modules/@openrouter/sdk/esm/models/message.js
var z23 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/systemmessage.js
var z20 = __toESM(require("zod/v4"), 1);
var SystemMessageContent$outboundSchema = z20.union([z20.string(), z20.array(ChatMessageContentItemText$outboundSchema)]);
var SystemMessage$outboundSchema = z20.object({
  role: z20.literal("system"),
  content: z20.union([
    z20.string(),
    z20.array(ChatMessageContentItemText$outboundSchema)
  ]),
  name: z20.string().optional()
});

// node_modules/@openrouter/sdk/esm/models/toolresponsemessage.js
var z21 = __toESM(require("zod/v4"), 1);
var ToolResponseMessageContent$outboundSchema = z21.union([z21.string(), z21.array(ChatMessageContentItem$outboundSchema)]);
var ToolResponseMessage$outboundSchema = z21.object({
  role: z21.literal("tool"),
  content: z21.union([
    z21.string(),
    z21.array(ChatMessageContentItem$outboundSchema)
  ]),
  toolCallId: z21.string()
}).transform((v) => {
  return remap(v, {
    toolCallId: "tool_call_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/usermessage.js
var z22 = __toESM(require("zod/v4"), 1);
var UserMessageContent$outboundSchema = z22.union([z22.string(), z22.array(ChatMessageContentItem$outboundSchema)]);
var UserMessage$outboundSchema = z22.object({
  role: z22.literal("user"),
  content: z22.union([
    z22.string(),
    z22.array(ChatMessageContentItem$outboundSchema)
  ]),
  name: z22.string().optional()
});

// node_modules/@openrouter/sdk/esm/models/message.js
var MessageContent$outboundSchema = z23.union([z23.string(), z23.array(ChatMessageContentItemText$outboundSchema)]);
var MessageDeveloper$outboundSchema = z23.object({
  role: z23.literal("developer"),
  content: z23.union([
    z23.string(),
    z23.array(ChatMessageContentItemText$outboundSchema)
  ]),
  name: z23.string().optional()
});
var Message$outboundSchema = z23.union([
  SystemMessage$outboundSchema,
  UserMessage$outboundSchema,
  z23.lazy(() => MessageDeveloper$outboundSchema),
  AssistantMessage$outboundSchema,
  ToolResponseMessage$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/providersortunion.js
var z25 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/providersort.js
var ProviderSort = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency"
};
var ProviderSort$outboundSchema = outboundSchema(ProviderSort);

// node_modules/@openrouter/sdk/esm/models/providersortconfig.js
var z24 = __toESM(require("zod/v4"), 1);
var Partition = {
  Model: "model",
  None: "none"
};
var Partition$outboundSchema = outboundSchema(Partition);
var ProviderSortConfig$outboundSchema = z24.object({
  by: z24.nullable(ProviderSort$outboundSchema).optional(),
  partition: z24.nullable(Partition$outboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/providersortunion.js
var ProviderSortUnion$outboundSchema = z25.union([ProviderSort$outboundSchema, ProviderSortConfig$outboundSchema]);

// node_modules/@openrouter/sdk/esm/models/reasoningsummaryverbosity.js
var ReasoningSummaryVerbosity = {
  Auto: "auto",
  Concise: "concise",
  Detailed: "detailed"
};
var ReasoningSummaryVerbosity$inboundSchema = inboundSchema(ReasoningSummaryVerbosity);
var ReasoningSummaryVerbosity$outboundSchema = outboundSchema(ReasoningSummaryVerbosity);

// node_modules/@openrouter/sdk/esm/models/responseformatjsonschema.js
var z27 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/jsonschemaconfig.js
var z26 = __toESM(require("zod/v4"), 1);
var JSONSchemaConfig$outboundSchema = z26.object({
  name: z26.string(),
  description: z26.string().optional(),
  schema: z26.record(z26.string(), z26.any()).optional(),
  strict: z26.nullable(z26.boolean()).optional()
});

// node_modules/@openrouter/sdk/esm/models/responseformatjsonschema.js
var ResponseFormatJSONSchema$outboundSchema = z27.object({
  type: z27.literal("json_schema"),
  jsonSchema: JSONSchemaConfig$outboundSchema
}).transform((v) => {
  return remap(v, {
    jsonSchema: "json_schema"
  });
});

// node_modules/@openrouter/sdk/esm/models/responseformattextgrammar.js
var z28 = __toESM(require("zod/v4"), 1);
var ResponseFormatTextGrammar$outboundSchema = z28.object({
  type: z28.literal("grammar"),
  grammar: z28.string()
});

// node_modules/@openrouter/sdk/esm/models/schema0.js
var z29 = __toESM(require("zod/v4"), 1);
var Schema0Enum = {
  Ai21: "AI21",
  AionLabs: "AionLabs",
  Alibaba: "Alibaba",
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
  GoPomelo: "GoPomelo",
  Google: "Google",
  GoogleAIStudio: "Google AI Studio",
  Groq: "Groq",
  Hyperbolic: "Hyperbolic",
  Inception: "Inception",
  InferenceNet: "InferenceNet",
  Infermatic: "Infermatic",
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
  SiliconFlow: "SiliconFlow",
  Sourceful: "Sourceful",
  Stealth: "Stealth",
  StreamLake: "StreamLake",
  Switchpoint: "Switchpoint",
  Targon: "Targon",
  Together: "Together",
  Venice: "Venice",
  WandB: "WandB",
  Xiaomi: "Xiaomi",
  XAI: "xAI",
  ZAi: "Z.AI",
  FakeProvider: "FakeProvider"
};
var Schema0Enum$outboundSchema = outboundSchema(Schema0Enum);
var Schema0$outboundSchema = z29.union([Schema0Enum$outboundSchema, z29.string()]);

// node_modules/@openrouter/sdk/esm/models/tooldefinitionjson.js
var z30 = __toESM(require("zod/v4"), 1);
var ToolDefinitionJsonFunction$outboundSchema = z30.object({
  name: z30.string(),
  description: z30.string().optional(),
  parameters: z30.record(z30.string(), z30.any()).optional(),
  strict: z30.nullable(z30.boolean()).optional()
});
var ToolDefinitionJson$outboundSchema = z30.object({
  type: z30.literal("function"),
  function: z30.lazy(() => ToolDefinitionJsonFunction$outboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/chatgenerationparams.js
var ChatGenerationParamsDataCollection = {
  Deny: "deny",
  Allow: "allow"
};
var Quantizations = {
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
var PdfEngine = {
  MistralOcr: "mistral-ocr",
  PdfText: "pdf-text",
  Native: "native"
};
var Engine = {
  Native: "native",
  Exa: "exa"
};
var Route = {
  Fallback: "fallback",
  Sort: "sort"
};
var Effort = {
  Xhigh: "xhigh",
  High: "high",
  Medium: "medium",
  Low: "low",
  Minimal: "minimal",
  None: "none"
};
var ChatGenerationParamsDataCollection$outboundSchema = outboundSchema(ChatGenerationParamsDataCollection);
var Quantizations$outboundSchema = outboundSchema(Quantizations);
var ChatGenerationParamsMaxPrice$outboundSchema = z31.object({
  prompt: z31.any().optional(),
  completion: z31.any().optional(),
  image: z31.any().optional(),
  audio: z31.any().optional(),
  request: z31.any().optional()
});
var ChatGenerationParamsProvider$outboundSchema = z31.object({
  allowFallbacks: z31.nullable(z31.boolean()).optional(),
  requireParameters: z31.nullable(z31.boolean()).optional(),
  dataCollection: z31.nullable(ChatGenerationParamsDataCollection$outboundSchema).optional(),
  zdr: z31.nullable(z31.boolean()).optional(),
  enforceDistillableText: z31.nullable(z31.boolean()).optional(),
  order: z31.nullable(z31.array(Schema0$outboundSchema)).optional(),
  only: z31.nullable(z31.array(Schema0$outboundSchema)).optional(),
  ignore: z31.nullable(z31.array(Schema0$outboundSchema)).optional(),
  quantizations: z31.nullable(z31.array(Quantizations$outboundSchema)).optional(),
  sort: z31.nullable(ProviderSortUnion$outboundSchema).optional(),
  maxPrice: z31.lazy(() => ChatGenerationParamsMaxPrice$outboundSchema).optional(),
  preferredMinThroughput: z31.nullable(z31.number()).optional(),
  preferredMaxLatency: z31.nullable(z31.number()).optional(),
  minThroughput: z31.nullable(z31.number()).optional(),
  maxLatency: z31.nullable(z31.number()).optional()
}).transform((v) => {
  return remap(v, {
    allowFallbacks: "allow_fallbacks",
    requireParameters: "require_parameters",
    dataCollection: "data_collection",
    enforceDistillableText: "enforce_distillable_text",
    maxPrice: "max_price",
    preferredMinThroughput: "preferred_min_throughput",
    preferredMaxLatency: "preferred_max_latency",
    minThroughput: "min_throughput",
    maxLatency: "max_latency"
  });
});
var ChatGenerationParamsPluginResponseHealing$outboundSchema = z31.object({
  id: z31.literal("response-healing"),
  enabled: z31.boolean().optional()
});
var PdfEngine$outboundSchema = outboundSchema(PdfEngine);
var Pdf$outboundSchema = z31.object({
  engine: PdfEngine$outboundSchema.optional()
});
var ChatGenerationParamsPluginFileParser$outboundSchema = z31.object({
  id: z31.literal("file-parser"),
  enabled: z31.boolean().optional(),
  pdf: z31.lazy(() => Pdf$outboundSchema).optional()
});
var Engine$outboundSchema = outboundSchema(Engine);
var ChatGenerationParamsPluginWeb$outboundSchema = z31.object({
  id: z31.literal("web"),
  enabled: z31.boolean().optional(),
  maxResults: z31.number().optional(),
  searchPrompt: z31.string().optional(),
  engine: Engine$outboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    maxResults: "max_results",
    searchPrompt: "search_prompt"
  });
});
var ChatGenerationParamsPluginModeration$outboundSchema = z31.object({
  id: z31.literal("moderation")
});
var ChatGenerationParamsPluginUnion$outboundSchema = z31.union([
  z31.lazy(() => ChatGenerationParamsPluginModeration$outboundSchema),
  z31.lazy(() => ChatGenerationParamsPluginWeb$outboundSchema),
  z31.lazy(() => ChatGenerationParamsPluginFileParser$outboundSchema),
  z31.lazy(() => ChatGenerationParamsPluginResponseHealing$outboundSchema)
]);
var Route$outboundSchema = outboundSchema(Route);
var Effort$outboundSchema = outboundSchema(Effort);
var Reasoning$outboundSchema = z31.object({
  effort: z31.nullable(Effort$outboundSchema).optional(),
  summary: z31.nullable(ReasoningSummaryVerbosity$outboundSchema).optional()
});
var ChatGenerationParamsResponseFormatPython$outboundSchema = z31.object({
  type: z31.literal("python")
});
var ChatGenerationParamsResponseFormatJSONObject$outboundSchema = z31.object({
  type: z31.literal("json_object")
});
var ChatGenerationParamsResponseFormatText$outboundSchema = z31.object({
  type: z31.literal("text")
});
var ChatGenerationParamsResponseFormatUnion$outboundSchema = z31.union([
  z31.lazy(() => ChatGenerationParamsResponseFormatText$outboundSchema),
  z31.lazy(() => ChatGenerationParamsResponseFormatJSONObject$outboundSchema),
  ResponseFormatJSONSchema$outboundSchema,
  ResponseFormatTextGrammar$outboundSchema,
  z31.lazy(() => ChatGenerationParamsResponseFormatPython$outboundSchema)
]);
var ChatGenerationParamsStop$outboundSchema = z31.union([z31.string(), z31.array(z31.string())]);
var Debug$outboundSchema = z31.object({
  echoUpstreamBody: z31.boolean().optional()
}).transform((v) => {
  return remap(v, {
    echoUpstreamBody: "echo_upstream_body"
  });
});
var ChatGenerationParams$outboundSchema = z31.object({
  provider: z31.nullable(z31.lazy(() => ChatGenerationParamsProvider$outboundSchema)).optional(),
  plugins: z31.array(z31.union([
    z31.lazy(() => ChatGenerationParamsPluginModeration$outboundSchema),
    z31.lazy(() => ChatGenerationParamsPluginWeb$outboundSchema),
    z31.lazy(() => ChatGenerationParamsPluginFileParser$outboundSchema),
    z31.lazy(() => ChatGenerationParamsPluginResponseHealing$outboundSchema)
  ])).optional(),
  route: z31.nullable(Route$outboundSchema).optional(),
  user: z31.string().optional(),
  sessionId: z31.string().optional(),
  messages: z31.array(Message$outboundSchema),
  model: z31.string().optional(),
  models: z31.array(z31.string()).optional(),
  frequencyPenalty: z31.nullable(z31.number()).optional(),
  logitBias: z31.nullable(z31.record(z31.string(), z31.number())).optional(),
  logprobs: z31.nullable(z31.boolean()).optional(),
  topLogprobs: z31.nullable(z31.number()).optional(),
  maxCompletionTokens: z31.nullable(z31.number()).optional(),
  maxTokens: z31.nullable(z31.number()).optional(),
  metadata: z31.record(z31.string(), z31.string()).optional(),
  presencePenalty: z31.nullable(z31.number()).optional(),
  reasoning: z31.lazy(() => Reasoning$outboundSchema).optional(),
  responseFormat: z31.union([
    z31.lazy(() => ChatGenerationParamsResponseFormatText$outboundSchema),
    z31.lazy(() => ChatGenerationParamsResponseFormatJSONObject$outboundSchema),
    ResponseFormatJSONSchema$outboundSchema,
    ResponseFormatTextGrammar$outboundSchema,
    z31.lazy(() => ChatGenerationParamsResponseFormatPython$outboundSchema)
  ]).optional(),
  seed: z31.nullable(z31.int()).optional(),
  stop: z31.nullable(z31.union([z31.string(), z31.array(z31.string())])).optional(),
  stream: z31.boolean().default(false),
  streamOptions: z31.nullable(ChatStreamOptions$outboundSchema).optional(),
  temperature: z31.nullable(z31.number()).optional(),
  toolChoice: z31.any().optional(),
  tools: z31.array(ToolDefinitionJson$outboundSchema).optional(),
  topP: z31.nullable(z31.number()).optional(),
  debug: z31.lazy(() => Debug$outboundSchema).optional()
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
    toolChoice: "tool_choice",
    topP: "top_p"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatgenerationtokenusage.js
var z32 = __toESM(require("zod/v4"), 1);
var CompletionTokensDetails$inboundSchema = z32.object({
  reasoning_tokens: z32.nullable(z32.number()).optional(),
  audio_tokens: z32.nullable(z32.number()).optional(),
  accepted_prediction_tokens: z32.nullable(z32.number()).optional(),
  rejected_prediction_tokens: z32.nullable(z32.number()).optional()
}).transform((v) => {
  return remap(v, {
    "reasoning_tokens": "reasoningTokens",
    "audio_tokens": "audioTokens",
    "accepted_prediction_tokens": "acceptedPredictionTokens",
    "rejected_prediction_tokens": "rejectedPredictionTokens"
  });
});
var PromptTokensDetails$inboundSchema = z32.object({
  cached_tokens: z32.number().optional(),
  audio_tokens: z32.number().optional(),
  video_tokens: z32.number().optional()
}).transform((v) => {
  return remap(v, {
    "cached_tokens": "cachedTokens",
    "audio_tokens": "audioTokens",
    "video_tokens": "videoTokens"
  });
});
var ChatGenerationTokenUsage$inboundSchema = z32.object({
  completion_tokens: z32.number(),
  prompt_tokens: z32.number(),
  total_tokens: z32.number(),
  completion_tokens_details: z32.nullable(z32.lazy(() => CompletionTokensDetails$inboundSchema)).optional(),
  prompt_tokens_details: z32.nullable(z32.lazy(() => PromptTokensDetails$inboundSchema)).optional()
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
var z33 = __toESM(require("zod/v4"), 1);
var TopLogprob$inboundSchema = z33.object({
  token: z33.string(),
  logprob: z33.number(),
  bytes: z33.nullable(z33.array(z33.number()))
});
var ChatMessageTokenLogprob$inboundSchema = z33.object({
  token: z33.string(),
  logprob: z33.number(),
  bytes: z33.nullable(z33.array(z33.number())),
  top_logprobs: z33.array(z33.lazy(() => TopLogprob$inboundSchema))
}).transform((v) => {
  return remap(v, {
    "top_logprobs": "topLogprobs"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatmessagetokenlogprobs.js
var z34 = __toESM(require("zod/v4"), 1);
var ChatMessageTokenLogprobs$inboundSchema = z34.object({
  content: z34.nullable(z34.array(ChatMessageTokenLogprob$inboundSchema)),
  refusal: z34.nullable(z34.array(ChatMessageTokenLogprob$inboundSchema))
});

// node_modules/@openrouter/sdk/esm/models/chatresponse.js
var z37 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatresponsechoice.js
var z36 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/schema3.js
var z35 = __toESM(require("zod/v4"), 1);
var Schema5 = {
  Unknown: "unknown",
  OpenaiResponsesV1: "openai-responses-v1",
  XaiResponsesV1: "xai-responses-v1",
  AnthropicClaudeV1: "anthropic-claude-v1",
  GoogleGeminiV1: "google-gemini-v1"
};
var Schema5$inboundSchema = inboundSchema(Schema5);
var Schema3ReasoningText$inboundSchema = z35.object({
  type: z35.literal("reasoning.text"),
  text: z35.nullable(z35.string()).optional(),
  signature: z35.nullable(z35.string()).optional(),
  id: z35.nullable(z35.string()).optional(),
  format: z35.nullable(Schema5$inboundSchema).optional(),
  index: z35.number().optional()
});
var Schema3ReasoningEncrypted$inboundSchema = z35.object({
  type: z35.literal("reasoning.encrypted"),
  data: z35.string(),
  id: z35.nullable(z35.string()).optional(),
  format: z35.nullable(Schema5$inboundSchema).optional(),
  index: z35.number().optional()
});
var Schema3ReasoningSummary$inboundSchema = z35.object({
  type: z35.literal("reasoning.summary"),
  summary: z35.string(),
  id: z35.nullable(z35.string()).optional(),
  format: z35.nullable(Schema5$inboundSchema).optional(),
  index: z35.number().optional()
});
var Schema3$inboundSchema = z35.union([
  z35.lazy(() => Schema3ReasoningSummary$inboundSchema),
  z35.lazy(() => Schema3ReasoningEncrypted$inboundSchema),
  z35.lazy(() => Schema3ReasoningText$inboundSchema)
]);

// node_modules/@openrouter/sdk/esm/models/chatresponsechoice.js
var ChatResponseChoice$inboundSchema = z36.object({
  finish_reason: z36.nullable(ChatCompletionFinishReason$inboundSchema),
  index: z36.number(),
  message: AssistantMessage$inboundSchema,
  reasoning_details: z36.array(Schema3$inboundSchema).optional(),
  logprobs: z36.nullable(ChatMessageTokenLogprobs$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "finish_reason": "finishReason",
    "reasoning_details": "reasoningDetails"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatresponse.js
var ChatResponse$inboundSchema = z37.object({
  id: z37.string(),
  choices: z37.array(ChatResponseChoice$inboundSchema),
  created: z37.number(),
  model: z37.string(),
  object: z37.literal("chat.completion"),
  system_fingerprint: z37.nullable(z37.string()).optional(),
  usage: ChatGenerationTokenUsage$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "system_fingerprint": "systemFingerprint"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatstreamingchoice.js
var z40 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatstreamingmessagechunk.js
var z39 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatstreamingmessagetoolcall.js
var z38 = __toESM(require("zod/v4"), 1);
var ChatStreamingMessageToolCallFunction$inboundSchema = z38.object({
  name: z38.string().optional(),
  arguments: z38.string().optional()
});
var ChatStreamingMessageToolCall$inboundSchema = z38.object({
  index: z38.number(),
  id: z38.nullable(z38.string()).optional(),
  type: z38.literal("function").optional(),
  function: z38.lazy(() => ChatStreamingMessageToolCallFunction$inboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/chatstreamingmessagechunk.js
var ChatStreamingMessageChunkRole = {
  Assistant: "assistant"
};
var ChatStreamingMessageChunkRole$inboundSchema = z39.enum(ChatStreamingMessageChunkRole);
var ChatStreamingMessageChunk$inboundSchema = z39.object({
  role: ChatStreamingMessageChunkRole$inboundSchema.optional(),
  content: z39.nullable(z39.string()).optional(),
  reasoning: z39.nullable(z39.string()).optional(),
  refusal: z39.nullable(z39.string()).optional(),
  tool_calls: z39.array(ChatStreamingMessageToolCall$inboundSchema).optional(),
  reasoning_details: z39.array(Schema3$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "tool_calls": "toolCalls",
    "reasoning_details": "reasoningDetails"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatstreamingchoice.js
var ChatStreamingChoice$inboundSchema = z40.object({
  delta: ChatStreamingMessageChunk$inboundSchema,
  finish_reason: z40.nullable(ChatCompletionFinishReason$inboundSchema),
  index: z40.number(),
  logprobs: z40.nullable(ChatMessageTokenLogprobs$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "finish_reason": "finishReason"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatstreamingresponsechunk.js
var z41 = __toESM(require("zod/v4"), 1);
var ChatStreamingResponseChunkError$inboundSchema = z41.object({
  message: z41.string(),
  code: z41.number()
});
var ChatStreamingResponseChunkData$inboundSchema = z41.object({
  id: z41.string(),
  choices: z41.array(ChatStreamingChoice$inboundSchema),
  created: z41.number(),
  model: z41.string(),
  object: z41.literal("chat.completion.chunk"),
  system_fingerprint: z41.nullable(z41.string()).optional(),
  error: z41.lazy(() => ChatStreamingResponseChunkError$inboundSchema).optional(),
  usage: ChatGenerationTokenUsage$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "system_fingerprint": "systemFingerprint"
  });
});
var ChatStreamingResponseChunk$inboundSchema = z41.object({
  data: z41.string().transform((v, ctx) => {
    try {
      return JSON.parse(v);
    } catch (err) {
      ctx.addIssue({
        input: v,
        code: "custom",
        message: `malformed json: ${err}`
      });
      return z41.NEVER;
    }
  }).pipe(z41.lazy(() => ChatStreamingResponseChunkData$inboundSchema))
});

// node_modules/@openrouter/sdk/esm/models/completionchoice.js
var z43 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/completionlogprobs.js
var z42 = __toESM(require("zod/v4"), 1);
var CompletionLogprobs$inboundSchema = z42.object({
  tokens: z42.array(z42.string()),
  token_logprobs: z42.array(z42.number()),
  top_logprobs: z42.nullable(z42.array(z42.record(z42.string(), z42.number()))),
  text_offset: z42.array(z42.number())
}).transform((v) => {
  return remap(v, {
    "token_logprobs": "tokenLogprobs",
    "top_logprobs": "topLogprobs",
    "text_offset": "textOffset"
  });
});

// node_modules/@openrouter/sdk/esm/models/completionchoice.js
var CompletionFinishReason = {
  Stop: "stop",
  Length: "length",
  ContentFilter: "content_filter"
};
var CompletionFinishReason$inboundSchema = inboundSchema(CompletionFinishReason);
var CompletionChoice$inboundSchema = z43.object({
  text: z43.string(),
  index: z43.number(),
  logprobs: z43.nullable(CompletionLogprobs$inboundSchema),
  finish_reason: z43.nullable(CompletionFinishReason$inboundSchema),
  native_finish_reason: z43.string().optional(),
  reasoning: z43.nullable(z43.string()).optional()
}).transform((v) => {
  return remap(v, {
    "finish_reason": "finishReason",
    "native_finish_reason": "nativeFinishReason"
  });
});

// node_modules/@openrouter/sdk/esm/models/completioncreateparams.js
var z44 = __toESM(require("zod/v4"), 1);
var Prompt$outboundSchema = z44.union([
  z44.string(),
  z44.array(z44.string()),
  z44.array(z44.number()),
  z44.array(z44.array(z44.number()))
]);
var CompletionCreateParamsStop$outboundSchema = z44.union([z44.string(), z44.array(z44.string())]);
var StreamOptions$outboundSchema = z44.object({
  includeUsage: z44.nullable(z44.boolean()).optional()
}).transform((v) => {
  return remap(v, {
    includeUsage: "include_usage"
  });
});
var CompletionCreateParamsResponseFormatPython$outboundSchema = z44.object({
  type: z44.literal("python")
});
var CompletionCreateParamsResponseFormatJSONObject$outboundSchema = z44.object({
  type: z44.literal("json_object")
});
var CompletionCreateParamsResponseFormatText$outboundSchema = z44.object({
  type: z44.literal("text")
});
var CompletionCreateParamsResponseFormatUnion$outboundSchema = z44.union([
  z44.lazy(() => CompletionCreateParamsResponseFormatText$outboundSchema),
  z44.lazy(() => CompletionCreateParamsResponseFormatJSONObject$outboundSchema),
  ResponseFormatJSONSchema$outboundSchema,
  ResponseFormatTextGrammar$outboundSchema,
  z44.lazy(() => CompletionCreateParamsResponseFormatPython$outboundSchema)
]);
var CompletionCreateParams$outboundSchema = z44.object({
  model: z44.string().optional(),
  models: z44.array(z44.string()).optional(),
  prompt: z44.union([
    z44.string(),
    z44.array(z44.string()),
    z44.array(z44.number()),
    z44.array(z44.array(z44.number()))
  ]),
  bestOf: z44.nullable(z44.int()).optional(),
  echo: z44.nullable(z44.boolean()).optional(),
  frequencyPenalty: z44.nullable(z44.number()).optional(),
  logitBias: z44.nullable(z44.record(z44.string(), z44.number())).optional(),
  logprobs: z44.nullable(z44.int()).optional(),
  maxTokens: z44.nullable(z44.int()).optional(),
  n: z44.nullable(z44.int()).optional(),
  presencePenalty: z44.nullable(z44.number()).optional(),
  seed: z44.nullable(z44.int()).optional(),
  stop: z44.nullable(z44.union([z44.string(), z44.array(z44.string())])).optional(),
  stream: z44.boolean().default(false),
  streamOptions: z44.nullable(z44.lazy(() => StreamOptions$outboundSchema)).optional(),
  suffix: z44.nullable(z44.string()).optional(),
  temperature: z44.nullable(z44.number()).optional(),
  topP: z44.nullable(z44.number()).optional(),
  user: z44.string().optional(),
  metadata: z44.nullable(z44.record(z44.string(), z44.string())).optional(),
  responseFormat: z44.nullable(z44.union([
    z44.lazy(() => CompletionCreateParamsResponseFormatText$outboundSchema),
    z44.lazy(() => CompletionCreateParamsResponseFormatJSONObject$outboundSchema),
    ResponseFormatJSONSchema$outboundSchema,
    ResponseFormatTextGrammar$outboundSchema,
    z44.lazy(() => CompletionCreateParamsResponseFormatPython$outboundSchema)
  ])).optional()
}).transform((v) => {
  return remap(v, {
    bestOf: "best_of",
    frequencyPenalty: "frequency_penalty",
    logitBias: "logit_bias",
    maxTokens: "max_tokens",
    presencePenalty: "presence_penalty",
    streamOptions: "stream_options",
    topP: "top_p",
    responseFormat: "response_format"
  });
});

// node_modules/@openrouter/sdk/esm/models/completionresponse.js
var z46 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/completionusage.js
var z45 = __toESM(require("zod/v4"), 1);
var CompletionUsage$inboundSchema = z45.object({
  prompt_tokens: z45.number(),
  completion_tokens: z45.number(),
  total_tokens: z45.number()
}).transform((v) => {
  return remap(v, {
    "prompt_tokens": "promptTokens",
    "completion_tokens": "completionTokens",
    "total_tokens": "totalTokens"
  });
});

// node_modules/@openrouter/sdk/esm/models/completionresponse.js
var CompletionResponse$inboundSchema = z46.object({
  id: z46.string(),
  object: z46.literal("text_completion"),
  created: z46.number(),
  model: z46.string(),
  provider: z46.string().optional(),
  system_fingerprint: z46.string().optional(),
  choices: z46.array(CompletionChoice$inboundSchema),
  usage: CompletionUsage$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "system_fingerprint": "systemFingerprint"
  });
});

// node_modules/@openrouter/sdk/esm/models/createchargerequest.js
var z47 = __toESM(require("zod/v4"), 1);
var ChainId = {
  One: 1,
  OneHundredAndThirtySeven: 137,
  EightThousandFourHundredAndFiftyThree: 8453
};
var ChainId$outboundSchema = outboundSchemaInt(ChainId);
var CreateChargeRequest$outboundSchema = z47.object({
  amount: z47.number(),
  sender: z47.string(),
  chainId: ChainId$outboundSchema
}).transform((v) => {
  return remap(v, {
    chainId: "chain_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/datacollection.js
var DataCollection = {
  Deny: "deny",
  Allow: "allow"
};
var DataCollection$outboundSchema = outboundSchema(DataCollection);

// node_modules/@openrouter/sdk/esm/models/defaultparameters.js
var z48 = __toESM(require("zod/v4"), 1);
var DefaultParameters$inboundSchema = z48.object({
  temperature: z48.nullable(z48.number()).optional(),
  top_p: z48.nullable(z48.number()).optional(),
  frequency_penalty: z48.nullable(z48.number()).optional()
}).transform((v) => {
  return remap(v, {
    "top_p": "topP",
    "frequency_penalty": "frequencyPenalty"
  });
});

// node_modules/@openrouter/sdk/esm/models/edgenetworktimeoutresponseerrordata.js
var z49 = __toESM(require("zod/v4"), 1);
var EdgeNetworkTimeoutResponseErrorData$inboundSchema = z49.object({
  code: z49.int(),
  message: z49.string(),
  metadata: z49.nullable(z49.record(z49.string(), z49.nullable(z49.any()))).optional()
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
var z50 = __toESM(require("zod/v4"), 1);
var FileCitation$inboundSchema = z50.object({
  type: z50.literal("file_citation"),
  file_id: z50.string(),
  filename: z50.string(),
  index: z50.number()
}).transform((v) => {
  return remap(v, {
    "file_id": "fileId"
  });
});
var FileCitation$outboundSchema = z50.object({
  type: z50.literal("file_citation"),
  fileId: z50.string(),
  filename: z50.string(),
  index: z50.number()
}).transform((v) => {
  return remap(v, {
    fileId: "file_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/filepath.js
var z51 = __toESM(require("zod/v4"), 1);
var FilePath$inboundSchema = z51.object({
  type: z51.literal("file_path"),
  file_id: z51.string(),
  index: z51.number()
}).transform((v) => {
  return remap(v, {
    "file_id": "fileId"
  });
});
var FilePath$outboundSchema = z51.object({
  type: z51.literal("file_path"),
  fileId: z51.string(),
  index: z51.number()
}).transform((v) => {
  return remap(v, {
    fileId: "file_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/forbiddenresponseerrordata.js
var z52 = __toESM(require("zod/v4"), 1);
var ForbiddenResponseErrorData$inboundSchema = z52.object({
  code: z52.int(),
  message: z52.string(),
  metadata: z52.nullable(z52.record(z52.string(), z52.nullable(z52.any()))).optional()
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
var z53 = __toESM(require("zod/v4"), 1);
var InternalServerResponseErrorData$inboundSchema = z53.object({
  code: z53.int(),
  message: z53.string(),
  metadata: z53.nullable(z53.record(z53.string(), z53.nullable(z53.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/listendpointsresponse.js
var z55 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/outputmodality.js
var OutputModality = {
  Text: "text",
  Image: "image",
  Embeddings: "embeddings"
};
var OutputModality$inboundSchema = inboundSchema(OutputModality);

// node_modules/@openrouter/sdk/esm/models/publicendpoint.js
var z54 = __toESM(require("zod/v4"), 1);

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

// node_modules/@openrouter/sdk/esm/models/providername.js
var ProviderName = {
  Ai21: "AI21",
  AionLabs: "AionLabs",
  Alibaba: "Alibaba",
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
  GoPomelo: "GoPomelo",
  Google: "Google",
  GoogleAIStudio: "Google AI Studio",
  Groq: "Groq",
  Hyperbolic: "Hyperbolic",
  Inception: "Inception",
  InferenceNet: "InferenceNet",
  Infermatic: "Infermatic",
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
  SiliconFlow: "SiliconFlow",
  Sourceful: "Sourceful",
  Stealth: "Stealth",
  StreamLake: "StreamLake",
  Switchpoint: "Switchpoint",
  Targon: "Targon",
  Together: "Together",
  Venice: "Venice",
  WandB: "WandB",
  Xiaomi: "Xiaomi",
  XAI: "xAI",
  ZAi: "Z.AI",
  FakeProvider: "FakeProvider"
};
var ProviderName$inboundSchema = inboundSchema(ProviderName);
var ProviderName$outboundSchema = outboundSchema(ProviderName);

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
var Pricing$inboundSchema = z54.object({
  prompt: z54.string(),
  completion: z54.string(),
  request: z54.string().optional(),
  image: z54.string().optional(),
  image_token: z54.string().optional(),
  image_output: z54.string().optional(),
  audio: z54.string().optional(),
  input_audio_cache: z54.string().optional(),
  web_search: z54.string().optional(),
  internal_reasoning: z54.string().optional(),
  input_cache_read: z54.string().optional(),
  input_cache_write: z54.string().optional(),
  discount: z54.number().optional()
}).transform((v) => {
  return remap(v, {
    "image_token": "imageToken",
    "image_output": "imageOutput",
    "input_audio_cache": "inputAudioCache",
    "web_search": "webSearch",
    "internal_reasoning": "internalReasoning",
    "input_cache_read": "inputCacheRead",
    "input_cache_write": "inputCacheWrite"
  });
});
var PublicEndpointQuantization$inboundSchema = inboundSchema(PublicEndpointQuantization);
var PublicEndpoint$inboundSchema = z54.object({
  name: z54.string(),
  model_name: z54.string(),
  context_length: z54.number(),
  pricing: z54.lazy(() => Pricing$inboundSchema),
  provider_name: ProviderName$inboundSchema,
  tag: z54.string(),
  quantization: z54.nullable(PublicEndpointQuantization$inboundSchema),
  max_completion_tokens: z54.nullable(z54.number()),
  max_prompt_tokens: z54.nullable(z54.number()),
  supported_parameters: z54.array(Parameter$inboundSchema),
  status: EndpointStatus$inboundSchema.optional(),
  uptime_last_30m: z54.nullable(z54.number()),
  supports_implicit_caching: z54.boolean()
}).transform((v) => {
  return remap(v, {
    "model_name": "modelName",
    "context_length": "contextLength",
    "provider_name": "providerName",
    "max_completion_tokens": "maxCompletionTokens",
    "max_prompt_tokens": "maxPromptTokens",
    "supported_parameters": "supportedParameters",
    "uptime_last_30m": "uptimeLast30m",
    "supports_implicit_caching": "supportsImplicitCaching"
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
var Architecture$inboundSchema = z55.object({
  tokenizer: z55.nullable(Tokenizer$inboundSchema),
  instruct_type: z55.nullable(InstructType$inboundSchema),
  modality: z55.nullable(z55.string()),
  input_modalities: z55.array(InputModality$inboundSchema),
  output_modalities: z55.array(OutputModality$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "instruct_type": "instructType",
    "input_modalities": "inputModalities",
    "output_modalities": "outputModalities"
  });
});
var ListEndpointsResponse$inboundSchema = z55.object({
  id: z55.string(),
  name: z55.string(),
  created: z55.number(),
  description: z55.string(),
  architecture: z55.lazy(() => Architecture$inboundSchema),
  endpoints: z55.array(PublicEndpoint$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/model.js
var z60 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/modelarchitecture.js
var z56 = __toESM(require("zod/v4"), 1);

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
var ModelArchitecture$inboundSchema = z56.object({
  tokenizer: ModelGroup$inboundSchema.optional(),
  instruct_type: z56.nullable(ModelArchitectureInstructType$inboundSchema).optional(),
  modality: z56.nullable(z56.string()),
  input_modalities: z56.array(InputModality$inboundSchema),
  output_modalities: z56.array(OutputModality$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "instruct_type": "instructType",
    "input_modalities": "inputModalities",
    "output_modalities": "outputModalities"
  });
});

// node_modules/@openrouter/sdk/esm/models/perrequestlimits.js
var z57 = __toESM(require("zod/v4"), 1);
var PerRequestLimits$inboundSchema = z57.object({
  prompt_tokens: z57.number(),
  completion_tokens: z57.number()
}).transform((v) => {
  return remap(v, {
    "prompt_tokens": "promptTokens",
    "completion_tokens": "completionTokens"
  });
});

// node_modules/@openrouter/sdk/esm/models/publicpricing.js
var z58 = __toESM(require("zod/v4"), 1);
var PublicPricing$inboundSchema = z58.object({
  prompt: z58.string(),
  completion: z58.string(),
  request: z58.string().optional(),
  image: z58.string().optional(),
  image_token: z58.string().optional(),
  image_output: z58.string().optional(),
  audio: z58.string().optional(),
  input_audio_cache: z58.string().optional(),
  web_search: z58.string().optional(),
  internal_reasoning: z58.string().optional(),
  input_cache_read: z58.string().optional(),
  input_cache_write: z58.string().optional(),
  discount: z58.number().optional()
}).transform((v) => {
  return remap(v, {
    "image_token": "imageToken",
    "image_output": "imageOutput",
    "input_audio_cache": "inputAudioCache",
    "web_search": "webSearch",
    "internal_reasoning": "internalReasoning",
    "input_cache_read": "inputCacheRead",
    "input_cache_write": "inputCacheWrite"
  });
});

// node_modules/@openrouter/sdk/esm/models/topproviderinfo.js
var z59 = __toESM(require("zod/v4"), 1);
var TopProviderInfo$inboundSchema = z59.object({
  context_length: z59.nullable(z59.number()).optional(),
  max_completion_tokens: z59.nullable(z59.number()).optional(),
  is_moderated: z59.boolean()
}).transform((v) => {
  return remap(v, {
    "context_length": "contextLength",
    "max_completion_tokens": "maxCompletionTokens",
    "is_moderated": "isModerated"
  });
});

// node_modules/@openrouter/sdk/esm/models/model.js
var Model$inboundSchema = z60.object({
  id: z60.string(),
  canonical_slug: z60.string(),
  hugging_face_id: z60.nullable(z60.string()).optional(),
  name: z60.string(),
  created: z60.number(),
  description: z60.string().optional(),
  pricing: PublicPricing$inboundSchema,
  context_length: z60.nullable(z60.number()),
  architecture: ModelArchitecture$inboundSchema,
  top_provider: TopProviderInfo$inboundSchema,
  per_request_limits: z60.nullable(PerRequestLimits$inboundSchema),
  supported_parameters: z60.array(Parameter$inboundSchema),
  default_parameters: z60.nullable(DefaultParameters$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "canonical_slug": "canonicalSlug",
    "hugging_face_id": "huggingFaceId",
    "context_length": "contextLength",
    "top_provider": "topProvider",
    "per_request_limits": "perRequestLimits",
    "supported_parameters": "supportedParameters",
    "default_parameters": "defaultParameters"
  });
});

// node_modules/@openrouter/sdk/esm/models/modelscountresponse.js
var z61 = __toESM(require("zod/v4"), 1);
var ModelsCountResponseData$inboundSchema = z61.object({
  count: z61.number()
});
var ModelsCountResponse$inboundSchema = z61.object({
  data: z61.lazy(() => ModelsCountResponseData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/modelslistresponse.js
var z62 = __toESM(require("zod/v4"), 1);
var ModelsListResponse$inboundSchema = z62.object({
  data: z62.array(Model$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/notfoundresponseerrordata.js
var z63 = __toESM(require("zod/v4"), 1);
var NotFoundResponseErrorData$inboundSchema = z63.object({
  code: z63.int(),
  message: z63.string(),
  metadata: z63.nullable(z63.record(z63.string(), z63.nullable(z63.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/openairesponsesannotation.js
var z65 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/urlcitation.js
var z64 = __toESM(require("zod/v4"), 1);
var URLCitation$inboundSchema = z64.object({
  type: z64.literal("url_citation"),
  url: z64.string(),
  title: z64.string(),
  start_index: z64.number(),
  end_index: z64.number()
}).transform((v) => {
  return remap(v, {
    "start_index": "startIndex",
    "end_index": "endIndex"
  });
});
var URLCitation$outboundSchema = z64.object({
  type: z64.literal("url_citation"),
  url: z64.string(),
  title: z64.string(),
  startIndex: z64.number(),
  endIndex: z64.number()
}).transform((v) => {
  return remap(v, {
    startIndex: "start_index",
    endIndex: "end_index"
  });
});

// node_modules/@openrouter/sdk/esm/models/openairesponsesannotation.js
var OpenAIResponsesAnnotation$inboundSchema = z65.union([
  FileCitation$inboundSchema,
  URLCitation$inboundSchema,
  FilePath$inboundSchema
]);
var OpenAIResponsesAnnotation$outboundSchema = z65.union([
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
var z66 = __toESM(require("zod/v4"), 1);
var Reason = {
  MaxOutputTokens: "max_output_tokens",
  ContentFilter: "content_filter"
};
var Reason$inboundSchema = inboundSchema(Reason);
var OpenAIResponsesIncompleteDetails$inboundSchema = z66.object({
  reason: Reason$inboundSchema.optional()
});

// node_modules/@openrouter/sdk/esm/models/openairesponsesinputunion.js
var z75 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/outputitemimagegenerationcall.js
var z67 = __toESM(require("zod/v4"), 1);
var OutputItemImageGenerationCallType = {
  ImageGenerationCall: "image_generation_call"
};
var OutputItemImageGenerationCallType$inboundSchema = z67.enum(OutputItemImageGenerationCallType);
var OutputItemImageGenerationCall$inboundSchema = z67.object({
  type: OutputItemImageGenerationCallType$inboundSchema,
  id: z67.string(),
  result: z67.nullable(z67.string()).default(null),
  status: ImageGenerationStatus$inboundSchema
});

// node_modules/@openrouter/sdk/esm/models/outputmessage.js
var z70 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/openairesponsesrefusalcontent.js
var z68 = __toESM(require("zod/v4"), 1);
var OpenAIResponsesRefusalContent$inboundSchema = z68.object({
  type: z68.literal("refusal"),
  refusal: z68.string()
});
var OpenAIResponsesRefusalContent$outboundSchema = z68.object({
  type: z68.literal("refusal"),
  refusal: z68.string()
});

// node_modules/@openrouter/sdk/esm/models/responseoutputtext.js
var z69 = __toESM(require("zod/v4"), 1);
var ResponseOutputText$inboundSchema = z69.object({
  type: z69.literal("output_text"),
  text: z69.string(),
  annotations: z69.array(OpenAIResponsesAnnotation$inboundSchema).optional()
});
var ResponseOutputText$outboundSchema = z69.object({
  type: z69.literal("output_text"),
  text: z69.string(),
  annotations: z69.array(OpenAIResponsesAnnotation$outboundSchema).optional()
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
var OutputMessageRole$inboundSchema = z70.enum(OutputMessageRole);
var OutputMessageType$inboundSchema = z70.enum(OutputMessageType);
var OutputMessageStatusInProgress$inboundSchema = z70.enum(OutputMessageStatusInProgress);
var OutputMessageStatusIncomplete$inboundSchema = z70.enum(OutputMessageStatusIncomplete);
var OutputMessageStatusCompleted$inboundSchema = z70.enum(OutputMessageStatusCompleted);
var OutputMessageStatusUnion$inboundSchema = z70.union([
  OutputMessageStatusCompleted$inboundSchema,
  OutputMessageStatusIncomplete$inboundSchema,
  OutputMessageStatusInProgress$inboundSchema
]);
var OutputMessageContent$inboundSchema = z70.union([
  ResponseOutputText$inboundSchema,
  OpenAIResponsesRefusalContent$inboundSchema
]);
var OutputMessage$inboundSchema = z70.object({
  id: z70.string(),
  role: OutputMessageRole$inboundSchema,
  type: OutputMessageType$inboundSchema,
  status: z70.union([
    OutputMessageStatusCompleted$inboundSchema,
    OutputMessageStatusIncomplete$inboundSchema,
    OutputMessageStatusInProgress$inboundSchema
  ]).optional(),
  content: z70.array(z70.union([
    ResponseOutputText$inboundSchema,
    OpenAIResponsesRefusalContent$inboundSchema
  ]))
});

// node_modules/@openrouter/sdk/esm/models/responseinputaudio.js
var z71 = __toESM(require("zod/v4"), 1);
var ResponseInputAudioFormat = {
  Mp3: "mp3",
  Wav: "wav"
};
var ResponseInputAudioFormat$inboundSchema = inboundSchema(ResponseInputAudioFormat);
var ResponseInputAudioFormat$outboundSchema = outboundSchema(ResponseInputAudioFormat);
var ResponseInputAudioInputAudio$inboundSchema = z71.object({
  data: z71.string(),
  format: ResponseInputAudioFormat$inboundSchema
});
var ResponseInputAudioInputAudio$outboundSchema = z71.object({
  data: z71.string(),
  format: ResponseInputAudioFormat$outboundSchema
});
var ResponseInputAudio$inboundSchema = z71.object({
  type: z71.literal("input_audio"),
  input_audio: z71.lazy(() => ResponseInputAudioInputAudio$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "input_audio": "inputAudio"
  });
});
var ResponseInputAudio$outboundSchema = z71.object({
  type: z71.literal("input_audio"),
  inputAudio: z71.lazy(() => ResponseInputAudioInputAudio$outboundSchema)
}).transform((v) => {
  return remap(v, {
    inputAudio: "input_audio"
  });
});

// node_modules/@openrouter/sdk/esm/models/responseinputfile.js
var z72 = __toESM(require("zod/v4"), 1);
var ResponseInputFile$inboundSchema = z72.object({
  type: z72.literal("input_file"),
  file_id: z72.nullable(z72.string()).optional(),
  file_data: z72.string().optional(),
  filename: z72.string().optional(),
  file_url: z72.string().optional()
}).transform((v) => {
  return remap(v, {
    "file_id": "fileId",
    "file_data": "fileData",
    "file_url": "fileUrl"
  });
});
var ResponseInputFile$outboundSchema = z72.object({
  type: z72.literal("input_file"),
  fileId: z72.nullable(z72.string()).optional(),
  fileData: z72.string().optional(),
  filename: z72.string().optional(),
  fileUrl: z72.string().optional()
}).transform((v) => {
  return remap(v, {
    fileId: "file_id",
    fileData: "file_data",
    fileUrl: "file_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/responseinputimage.js
var z73 = __toESM(require("zod/v4"), 1);
var ResponseInputImageDetail = {
  Auto: "auto",
  High: "high",
  Low: "low"
};
var ResponseInputImageDetail$inboundSchema = inboundSchema(ResponseInputImageDetail);
var ResponseInputImageDetail$outboundSchema = outboundSchema(ResponseInputImageDetail);
var ResponseInputImage$inboundSchema = z73.object({
  type: z73.literal("input_image"),
  detail: ResponseInputImageDetail$inboundSchema,
  image_url: z73.nullable(z73.string()).optional()
}).transform((v) => {
  return remap(v, {
    "image_url": "imageUrl"
  });
});
var ResponseInputImage$outboundSchema = z73.object({
  type: z73.literal("input_image"),
  detail: ResponseInputImageDetail$outboundSchema,
  imageUrl: z73.nullable(z73.string()).optional()
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/responseinputtext.js
var z74 = __toESM(require("zod/v4"), 1);
var ResponseInputText$inboundSchema = z74.object({
  type: z74.literal("input_text"),
  text: z74.string()
});
var ResponseInputText$outboundSchema = z74.object({
  type: z74.literal("input_text"),
  text: z74.string()
});

// node_modules/@openrouter/sdk/esm/models/toolcallstatus.js
var ToolCallStatus = {
  InProgress: "in_progress",
  Completed: "completed",
  Incomplete: "incomplete"
};
var ToolCallStatus$inboundSchema = inboundSchema(ToolCallStatus);
var ToolCallStatus$outboundSchema = outboundSchema(ToolCallStatus);

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
var OpenAIResponsesInputTypeFunctionCall$inboundSchema = z75.enum(OpenAIResponsesInputTypeFunctionCall);
var OpenAIResponsesInputFunctionCall$inboundSchema = z75.object({
  type: OpenAIResponsesInputTypeFunctionCall$inboundSchema,
  call_id: z75.string(),
  name: z75.string(),
  arguments: z75.string(),
  id: z75.string().optional(),
  status: z75.nullable(ToolCallStatus$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "call_id": "callId"
  });
});
var OpenAIResponsesInputTypeFunctionCallOutput$inboundSchema = z75.enum(OpenAIResponsesInputTypeFunctionCallOutput);
var OpenAIResponsesInputFunctionCallOutput$inboundSchema = z75.object({
  type: OpenAIResponsesInputTypeFunctionCallOutput$inboundSchema,
  id: z75.nullable(z75.string()).optional(),
  call_id: z75.string(),
  output: z75.string(),
  status: z75.nullable(ToolCallStatus$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "call_id": "callId"
  });
});
var OpenAIResponsesInputTypeMessage2$inboundSchema = z75.enum(OpenAIResponsesInputTypeMessage2);
var OpenAIResponsesInputRoleDeveloper2$inboundSchema = z75.enum(OpenAIResponsesInputRoleDeveloper2);
var OpenAIResponsesInputRoleSystem2$inboundSchema = z75.enum(OpenAIResponsesInputRoleSystem2);
var OpenAIResponsesInputRoleUser2$inboundSchema = z75.enum(OpenAIResponsesInputRoleUser2);
var OpenAIResponsesInputRoleUnion2$inboundSchema = z75.union([
  OpenAIResponsesInputRoleUser2$inboundSchema,
  OpenAIResponsesInputRoleSystem2$inboundSchema,
  OpenAIResponsesInputRoleDeveloper2$inboundSchema
]);
var OpenAIResponsesInputContent3$inboundSchema = z75.union([
  ResponseInputText$inboundSchema,
  ResponseInputImage$inboundSchema,
  ResponseInputFile$inboundSchema,
  ResponseInputAudio$inboundSchema
]);
var OpenAIResponsesInputMessage2$inboundSchema = z75.object({
  id: z75.string(),
  type: OpenAIResponsesInputTypeMessage2$inboundSchema.optional(),
  role: z75.union([
    OpenAIResponsesInputRoleUser2$inboundSchema,
    OpenAIResponsesInputRoleSystem2$inboundSchema,
    OpenAIResponsesInputRoleDeveloper2$inboundSchema
  ]),
  content: z75.array(z75.union([
    ResponseInputText$inboundSchema,
    ResponseInputImage$inboundSchema,
    ResponseInputFile$inboundSchema,
    ResponseInputAudio$inboundSchema
  ]))
});
var OpenAIResponsesInputTypeMessage1$inboundSchema = z75.enum(OpenAIResponsesInputTypeMessage1);
var OpenAIResponsesInputRoleDeveloper1$inboundSchema = z75.enum(OpenAIResponsesInputRoleDeveloper1);
var OpenAIResponsesInputRoleAssistant$inboundSchema = z75.enum(OpenAIResponsesInputRoleAssistant);
var OpenAIResponsesInputRoleSystem1$inboundSchema = z75.enum(OpenAIResponsesInputRoleSystem1);
var OpenAIResponsesInputRoleUser1$inboundSchema = z75.enum(OpenAIResponsesInputRoleUser1);
var OpenAIResponsesInputRoleUnion1$inboundSchema = z75.union([
  OpenAIResponsesInputRoleUser1$inboundSchema,
  OpenAIResponsesInputRoleSystem1$inboundSchema,
  OpenAIResponsesInputRoleAssistant$inboundSchema,
  OpenAIResponsesInputRoleDeveloper1$inboundSchema
]);
var OpenAIResponsesInputContent1$inboundSchema = z75.union([
  ResponseInputText$inboundSchema,
  ResponseInputImage$inboundSchema,
  ResponseInputFile$inboundSchema,
  ResponseInputAudio$inboundSchema
]);
var OpenAIResponsesInputContent2$inboundSchema = z75.union([
  z75.array(z75.union([
    ResponseInputText$inboundSchema,
    ResponseInputImage$inboundSchema,
    ResponseInputFile$inboundSchema,
    ResponseInputAudio$inboundSchema
  ])),
  z75.string()
]);
var OpenAIResponsesInputMessage1$inboundSchema = z75.object({
  type: OpenAIResponsesInputTypeMessage1$inboundSchema.optional(),
  role: z75.union([
    OpenAIResponsesInputRoleUser1$inboundSchema,
    OpenAIResponsesInputRoleSystem1$inboundSchema,
    OpenAIResponsesInputRoleAssistant$inboundSchema,
    OpenAIResponsesInputRoleDeveloper1$inboundSchema
  ]),
  content: z75.union([
    z75.array(z75.union([
      ResponseInputText$inboundSchema,
      ResponseInputImage$inboundSchema,
      ResponseInputFile$inboundSchema,
      ResponseInputAudio$inboundSchema
    ])),
    z75.string()
  ])
});
var OpenAIResponsesInputUnion1$inboundSchema = z75.union([
  z75.lazy(() => OpenAIResponsesInputFunctionCall$inboundSchema),
  OutputMessage$inboundSchema,
  z75.lazy(() => OpenAIResponsesInputMessage2$inboundSchema),
  z75.lazy(() => OpenAIResponsesInputFunctionCallOutput$inboundSchema),
  OutputItemImageGenerationCall$inboundSchema,
  z75.lazy(() => OpenAIResponsesInputMessage1$inboundSchema)
]);
var OpenAIResponsesInputUnion$inboundSchema = z75.union([
  z75.string(),
  z75.array(z75.union([
    z75.lazy(() => OpenAIResponsesInputFunctionCall$inboundSchema),
    OutputMessage$inboundSchema,
    z75.lazy(() => OpenAIResponsesInputMessage2$inboundSchema),
    z75.lazy(() => OpenAIResponsesInputFunctionCallOutput$inboundSchema),
    OutputItemImageGenerationCall$inboundSchema,
    z75.lazy(() => OpenAIResponsesInputMessage1$inboundSchema)
  ])),
  z75.any()
]);

// node_modules/@openrouter/sdk/esm/models/openairesponsesprompt.js
var z76 = __toESM(require("zod/v4"), 1);
var Variables$inboundSchema = z76.union([
  ResponseInputText$inboundSchema,
  ResponseInputImage$inboundSchema,
  ResponseInputFile$inboundSchema,
  z76.string()
]);
var Variables$outboundSchema = z76.union([
  ResponseInputText$outboundSchema,
  ResponseInputImage$outboundSchema,
  ResponseInputFile$outboundSchema,
  z76.string()
]);
var OpenAIResponsesPrompt$inboundSchema = z76.object({
  id: z76.string(),
  variables: z76.nullable(z76.record(z76.string(), z76.union([
    ResponseInputText$inboundSchema,
    ResponseInputImage$inboundSchema,
    ResponseInputFile$inboundSchema,
    z76.string()
  ]))).optional()
});
var OpenAIResponsesPrompt$outboundSchema = z76.object({
  id: z76.string(),
  variables: z76.nullable(z76.record(z76.string(), z76.union([
    ResponseInputText$outboundSchema,
    ResponseInputImage$outboundSchema,
    ResponseInputFile$outboundSchema,
    z76.string()
  ]))).optional()
});

// node_modules/@openrouter/sdk/esm/models/openairesponsesreasoningconfig.js
var z77 = __toESM(require("zod/v4"), 1);

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

// node_modules/@openrouter/sdk/esm/models/openairesponsesreasoningconfig.js
var OpenAIResponsesReasoningConfig$inboundSchema = z77.object({
  effort: z77.nullable(OpenAIResponsesReasoningEffort$inboundSchema).optional(),
  summary: ReasoningSummaryVerbosity$inboundSchema.optional()
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
var z78 = __toESM(require("zod/v4"), 1);
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
var OpenAIResponsesToolChoiceTypeWebSearchPreview$inboundSchema = z78.enum(OpenAIResponsesToolChoiceTypeWebSearchPreview);
var OpenAIResponsesToolChoiceTypeWebSearchPreview$outboundSchema = OpenAIResponsesToolChoiceTypeWebSearchPreview$inboundSchema;
var OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$inboundSchema = z78.enum(OpenAIResponsesToolChoiceTypeWebSearchPreview20250311);
var OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$outboundSchema = OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$inboundSchema;
var Type$inboundSchema = z78.union([
  OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$inboundSchema,
  OpenAIResponsesToolChoiceTypeWebSearchPreview$inboundSchema
]);
var Type$outboundSchema = z78.union([
  OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$outboundSchema,
  OpenAIResponsesToolChoiceTypeWebSearchPreview$outboundSchema
]);
var OpenAIResponsesToolChoice$inboundSchema = z78.object({
  type: z78.union([
    OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$inboundSchema,
    OpenAIResponsesToolChoiceTypeWebSearchPreview$inboundSchema
  ])
});
var OpenAIResponsesToolChoice$outboundSchema = z78.object({
  type: z78.union([
    OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$outboundSchema,
    OpenAIResponsesToolChoiceTypeWebSearchPreview$outboundSchema
  ])
});
var OpenAIResponsesToolChoiceTypeFunction$inboundSchema = z78.enum(OpenAIResponsesToolChoiceTypeFunction);
var OpenAIResponsesToolChoiceTypeFunction$outboundSchema = OpenAIResponsesToolChoiceTypeFunction$inboundSchema;
var OpenAIResponsesToolChoiceFunction$inboundSchema = z78.object({
  type: OpenAIResponsesToolChoiceTypeFunction$inboundSchema,
  name: z78.string()
});
var OpenAIResponsesToolChoiceFunction$outboundSchema = z78.object({
  type: OpenAIResponsesToolChoiceTypeFunction$outboundSchema,
  name: z78.string()
});
var OpenAIResponsesToolChoiceRequired$inboundSchema = z78.enum(OpenAIResponsesToolChoiceRequired);
var OpenAIResponsesToolChoiceRequired$outboundSchema = OpenAIResponsesToolChoiceRequired$inboundSchema;
var OpenAIResponsesToolChoiceNone$inboundSchema = z78.enum(OpenAIResponsesToolChoiceNone);
var OpenAIResponsesToolChoiceNone$outboundSchema = OpenAIResponsesToolChoiceNone$inboundSchema;
var OpenAIResponsesToolChoiceAuto$inboundSchema = z78.enum(OpenAIResponsesToolChoiceAuto);
var OpenAIResponsesToolChoiceAuto$outboundSchema = OpenAIResponsesToolChoiceAuto$inboundSchema;
var OpenAIResponsesToolChoiceUnion$inboundSchema = z78.union([
  z78.lazy(() => OpenAIResponsesToolChoiceFunction$inboundSchema),
  z78.lazy(() => OpenAIResponsesToolChoice$inboundSchema),
  OpenAIResponsesToolChoiceAuto$inboundSchema,
  OpenAIResponsesToolChoiceNone$inboundSchema,
  OpenAIResponsesToolChoiceRequired$inboundSchema
]);
var OpenAIResponsesToolChoiceUnion$outboundSchema = z78.union([
  z78.lazy(() => OpenAIResponsesToolChoiceFunction$outboundSchema),
  z78.lazy(() => OpenAIResponsesToolChoice$outboundSchema),
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

// node_modules/@openrouter/sdk/esm/models/openresponseseasyinputmessage.js
var z79 = __toESM(require("zod/v4"), 1);
var OpenResponsesEasyInputMessageType = {
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
var OpenResponsesEasyInputMessageType$outboundSchema = z79.enum(OpenResponsesEasyInputMessageType);
var OpenResponsesEasyInputMessageRoleDeveloper$outboundSchema = z79.enum(OpenResponsesEasyInputMessageRoleDeveloper);
var OpenResponsesEasyInputMessageRoleAssistant$outboundSchema = z79.enum(OpenResponsesEasyInputMessageRoleAssistant);
var OpenResponsesEasyInputMessageRoleSystem$outboundSchema = z79.enum(OpenResponsesEasyInputMessageRoleSystem);
var OpenResponsesEasyInputMessageRoleUser$outboundSchema = z79.enum(OpenResponsesEasyInputMessageRoleUser);
var OpenResponsesEasyInputMessageRoleUnion$outboundSchema = z79.union([
  OpenResponsesEasyInputMessageRoleUser$outboundSchema,
  OpenResponsesEasyInputMessageRoleSystem$outboundSchema,
  OpenResponsesEasyInputMessageRoleAssistant$outboundSchema,
  OpenResponsesEasyInputMessageRoleDeveloper$outboundSchema
]);
var OpenResponsesEasyInputMessageContent1$outboundSchema = z79.union([
  ResponseInputText$outboundSchema,
  ResponseInputImage$outboundSchema,
  ResponseInputFile$outboundSchema,
  ResponseInputAudio$outboundSchema
]);
var OpenResponsesEasyInputMessageContent2$outboundSchema = z79.union([
  z79.array(z79.union([
    ResponseInputText$outboundSchema,
    ResponseInputImage$outboundSchema,
    ResponseInputFile$outboundSchema,
    ResponseInputAudio$outboundSchema
  ])),
  z79.string()
]);
var OpenResponsesEasyInputMessage$outboundSchema = z79.object({
  type: OpenResponsesEasyInputMessageType$outboundSchema.optional(),
  role: z79.union([
    OpenResponsesEasyInputMessageRoleUser$outboundSchema,
    OpenResponsesEasyInputMessageRoleSystem$outboundSchema,
    OpenResponsesEasyInputMessageRoleAssistant$outboundSchema,
    OpenResponsesEasyInputMessageRoleDeveloper$outboundSchema
  ]),
  content: z79.union([
    z79.array(z79.union([
      ResponseInputText$outboundSchema,
      ResponseInputImage$outboundSchema,
      ResponseInputFile$outboundSchema,
      ResponseInputAudio$outboundSchema
    ])),
    z79.string()
  ])
});

// node_modules/@openrouter/sdk/esm/models/openresponseserrorevent.js
var z80 = __toESM(require("zod/v4"), 1);
var OpenResponsesErrorEvent$inboundSchema = z80.object({
  type: z80.literal("error"),
  code: z80.nullable(z80.string()),
  message: z80.string(),
  param: z80.nullable(z80.string()),
  sequence_number: z80.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesfunctioncalloutput.js
var z81 = __toESM(require("zod/v4"), 1);
var OpenResponsesFunctionCallOutputType = {
  FunctionCallOutput: "function_call_output"
};
var OpenResponsesFunctionCallOutputType$outboundSchema = z81.enum(OpenResponsesFunctionCallOutputType);
var OpenResponsesFunctionCallOutput$outboundSchema = z81.object({
  type: OpenResponsesFunctionCallOutputType$outboundSchema,
  id: z81.nullable(z81.string()).optional(),
  callId: z81.string(),
  output: z81.string(),
  status: z81.nullable(ToolCallStatus$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    callId: "call_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesfunctiontoolcall.js
var z82 = __toESM(require("zod/v4"), 1);
var OpenResponsesFunctionToolCallType = {
  FunctionCall: "function_call"
};
var OpenResponsesFunctionToolCallType$outboundSchema = z82.enum(OpenResponsesFunctionToolCallType);
var OpenResponsesFunctionToolCall$outboundSchema = z82.object({
  type: OpenResponsesFunctionToolCallType$outboundSchema,
  callId: z82.string(),
  name: z82.string(),
  arguments: z82.string(),
  id: z82.string(),
  status: z82.nullable(ToolCallStatus$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    callId: "call_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesimagegencallcompleted.js
var z83 = __toESM(require("zod/v4"), 1);
var OpenResponsesImageGenCallCompleted$inboundSchema = z83.object({
  type: z83.literal("response.image_generation_call.completed"),
  item_id: z83.string(),
  output_index: z83.number(),
  sequence_number: z83.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesimagegencallgenerating.js
var z84 = __toESM(require("zod/v4"), 1);
var OpenResponsesImageGenCallGenerating$inboundSchema = z84.object({
  type: z84.literal("response.image_generation_call.generating"),
  item_id: z84.string(),
  output_index: z84.number(),
  sequence_number: z84.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesimagegencallinprogress.js
var z85 = __toESM(require("zod/v4"), 1);
var OpenResponsesImageGenCallInProgress$inboundSchema = z85.object({
  type: z85.literal("response.image_generation_call.in_progress"),
  item_id: z85.string(),
  output_index: z85.number(),
  sequence_number: z85.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesimagegencallpartialimage.js
var z86 = __toESM(require("zod/v4"), 1);
var OpenResponsesImageGenCallPartialImage$inboundSchema = z86.object({
  type: z86.literal("response.image_generation_call.partial_image"),
  item_id: z86.string(),
  output_index: z86.number(),
  sequence_number: z86.number(),
  partial_image_b64: z86.string(),
  partial_image_index: z86.number()
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
var z97 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/openresponsesinputmessageitem.js
var z87 = __toESM(require("zod/v4"), 1);
var OpenResponsesInputMessageItemType = {
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
var OpenResponsesInputMessageItemType$outboundSchema = z87.enum(OpenResponsesInputMessageItemType);
var OpenResponsesInputMessageItemRoleDeveloper$outboundSchema = z87.enum(OpenResponsesInputMessageItemRoleDeveloper);
var OpenResponsesInputMessageItemRoleSystem$outboundSchema = z87.enum(OpenResponsesInputMessageItemRoleSystem);
var OpenResponsesInputMessageItemRoleUser$outboundSchema = z87.enum(OpenResponsesInputMessageItemRoleUser);
var OpenResponsesInputMessageItemRoleUnion$outboundSchema = z87.union([
  OpenResponsesInputMessageItemRoleUser$outboundSchema,
  OpenResponsesInputMessageItemRoleSystem$outboundSchema,
  OpenResponsesInputMessageItemRoleDeveloper$outboundSchema
]);
var OpenResponsesInputMessageItemContent$outboundSchema = z87.union([
  ResponseInputText$outboundSchema,
  ResponseInputImage$outboundSchema,
  ResponseInputFile$outboundSchema,
  ResponseInputAudio$outboundSchema
]);
var OpenResponsesInputMessageItem$outboundSchema = z87.object({
  id: z87.string().optional(),
  type: OpenResponsesInputMessageItemType$outboundSchema.optional(),
  role: z87.union([
    OpenResponsesInputMessageItemRoleUser$outboundSchema,
    OpenResponsesInputMessageItemRoleSystem$outboundSchema,
    OpenResponsesInputMessageItemRoleDeveloper$outboundSchema
  ]),
  content: z87.array(z87.union([
    ResponseInputText$outboundSchema,
    ResponseInputImage$outboundSchema,
    ResponseInputFile$outboundSchema,
    ResponseInputAudio$outboundSchema
  ]))
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoning.js
var z90 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/reasoningsummarytext.js
var z88 = __toESM(require("zod/v4"), 1);
var ReasoningSummaryTextType = {
  SummaryText: "summary_text"
};
var ReasoningSummaryTextType$inboundSchema = z88.enum(ReasoningSummaryTextType);
var ReasoningSummaryTextType$outboundSchema = ReasoningSummaryTextType$inboundSchema;
var ReasoningSummaryText$inboundSchema = z88.object({
  type: ReasoningSummaryTextType$inboundSchema,
  text: z88.string()
});
var ReasoningSummaryText$outboundSchema = z88.object({
  type: ReasoningSummaryTextType$outboundSchema,
  text: z88.string()
});

// node_modules/@openrouter/sdk/esm/models/reasoningtextcontent.js
var z89 = __toESM(require("zod/v4"), 1);
var ReasoningTextContentType = {
  ReasoningText: "reasoning_text"
};
var ReasoningTextContentType$inboundSchema = z89.enum(ReasoningTextContentType);
var ReasoningTextContentType$outboundSchema = ReasoningTextContentType$inboundSchema;
var ReasoningTextContent$inboundSchema = z89.object({
  type: ReasoningTextContentType$inboundSchema,
  text: z89.string()
});
var ReasoningTextContent$outboundSchema = z89.object({
  type: ReasoningTextContentType$outboundSchema,
  text: z89.string()
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
  XaiResponsesV1: "xai-responses-v1",
  AnthropicClaudeV1: "anthropic-claude-v1",
  GoogleGeminiV1: "google-gemini-v1"
};
var OpenResponsesReasoningType$outboundSchema = z90.enum(OpenResponsesReasoningType);
var OpenResponsesReasoningStatusInProgress$outboundSchema = z90.enum(OpenResponsesReasoningStatusInProgress);
var OpenResponsesReasoningStatusIncomplete$outboundSchema = z90.enum(OpenResponsesReasoningStatusIncomplete);
var OpenResponsesReasoningStatusCompleted$outboundSchema = z90.enum(OpenResponsesReasoningStatusCompleted);
var OpenResponsesReasoningStatusUnion$outboundSchema = z90.union([
  OpenResponsesReasoningStatusCompleted$outboundSchema,
  OpenResponsesReasoningStatusIncomplete$outboundSchema,
  OpenResponsesReasoningStatusInProgress$outboundSchema
]);
var OpenResponsesReasoningFormat$outboundSchema = outboundSchema(OpenResponsesReasoningFormat);
var OpenResponsesReasoning$outboundSchema = z90.object({
  type: OpenResponsesReasoningType$outboundSchema,
  id: z90.string(),
  content: z90.array(ReasoningTextContent$outboundSchema).optional(),
  summary: z90.array(ReasoningSummaryText$outboundSchema),
  encryptedContent: z90.nullable(z90.string()).optional(),
  status: z90.union([
    OpenResponsesReasoningStatusCompleted$outboundSchema,
    OpenResponsesReasoningStatusIncomplete$outboundSchema,
    OpenResponsesReasoningStatusInProgress$outboundSchema
  ]).optional(),
  signature: z90.nullable(z90.string()).optional(),
  format: z90.nullable(OpenResponsesReasoningFormat$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    encryptedContent: "encrypted_content"
  });
});

// node_modules/@openrouter/sdk/esm/models/responsesimagegenerationcall.js
var z91 = __toESM(require("zod/v4"), 1);
var ResponsesImageGenerationCallType = {
  ImageGenerationCall: "image_generation_call"
};
var ResponsesImageGenerationCallType$inboundSchema = z91.enum(ResponsesImageGenerationCallType);
var ResponsesImageGenerationCallType$outboundSchema = ResponsesImageGenerationCallType$inboundSchema;
var ResponsesImageGenerationCall$inboundSchema = z91.object({
  type: ResponsesImageGenerationCallType$inboundSchema,
  id: z91.string(),
  result: z91.nullable(z91.string()).default(null),
  status: ImageGenerationStatus$inboundSchema
});
var ResponsesImageGenerationCall$outboundSchema = z91.object({
  type: ResponsesImageGenerationCallType$outboundSchema,
  id: z91.string(),
  result: z91.nullable(z91.string()).default(null),
  status: ImageGenerationStatus$outboundSchema
});

// node_modules/@openrouter/sdk/esm/models/responsesoutputitemfilesearchcall.js
var z92 = __toESM(require("zod/v4"), 1);

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
var ResponsesOutputItemFileSearchCallType$inboundSchema = z92.enum(ResponsesOutputItemFileSearchCallType);
var ResponsesOutputItemFileSearchCallType$outboundSchema = ResponsesOutputItemFileSearchCallType$inboundSchema;
var ResponsesOutputItemFileSearchCall$inboundSchema = z92.object({
  type: ResponsesOutputItemFileSearchCallType$inboundSchema,
  id: z92.string(),
  queries: z92.array(z92.string()),
  status: WebSearchStatus$inboundSchema
});
var ResponsesOutputItemFileSearchCall$outboundSchema = z92.object({
  type: ResponsesOutputItemFileSearchCallType$outboundSchema,
  id: z92.string(),
  queries: z92.array(z92.string()),
  status: WebSearchStatus$outboundSchema
});

// node_modules/@openrouter/sdk/esm/models/responsesoutputitemfunctioncall.js
var z93 = __toESM(require("zod/v4"), 1);
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
var ResponsesOutputItemFunctionCallType$inboundSchema = z93.enum(ResponsesOutputItemFunctionCallType);
var ResponsesOutputItemFunctionCallType$outboundSchema = ResponsesOutputItemFunctionCallType$inboundSchema;
var ResponsesOutputItemFunctionCallStatusInProgress$inboundSchema = z93.enum(ResponsesOutputItemFunctionCallStatusInProgress);
var ResponsesOutputItemFunctionCallStatusInProgress$outboundSchema = ResponsesOutputItemFunctionCallStatusInProgress$inboundSchema;
var ResponsesOutputItemFunctionCallStatusIncomplete$inboundSchema = z93.enum(ResponsesOutputItemFunctionCallStatusIncomplete);
var ResponsesOutputItemFunctionCallStatusIncomplete$outboundSchema = ResponsesOutputItemFunctionCallStatusIncomplete$inboundSchema;
var ResponsesOutputItemFunctionCallStatusCompleted$inboundSchema = z93.enum(ResponsesOutputItemFunctionCallStatusCompleted);
var ResponsesOutputItemFunctionCallStatusCompleted$outboundSchema = ResponsesOutputItemFunctionCallStatusCompleted$inboundSchema;
var ResponsesOutputItemFunctionCallStatusUnion$inboundSchema = z93.union([
  ResponsesOutputItemFunctionCallStatusCompleted$inboundSchema,
  ResponsesOutputItemFunctionCallStatusIncomplete$inboundSchema,
  ResponsesOutputItemFunctionCallStatusInProgress$inboundSchema
]);
var ResponsesOutputItemFunctionCallStatusUnion$outboundSchema = z93.union([
  ResponsesOutputItemFunctionCallStatusCompleted$outboundSchema,
  ResponsesOutputItemFunctionCallStatusIncomplete$outboundSchema,
  ResponsesOutputItemFunctionCallStatusInProgress$outboundSchema
]);
var ResponsesOutputItemFunctionCall$inboundSchema = z93.object({
  type: ResponsesOutputItemFunctionCallType$inboundSchema,
  id: z93.string().optional(),
  name: z93.string(),
  arguments: z93.string(),
  call_id: z93.string(),
  status: z93.union([
    ResponsesOutputItemFunctionCallStatusCompleted$inboundSchema,
    ResponsesOutputItemFunctionCallStatusIncomplete$inboundSchema,
    ResponsesOutputItemFunctionCallStatusInProgress$inboundSchema
  ]).optional()
}).transform((v) => {
  return remap(v, {
    "call_id": "callId"
  });
});
var ResponsesOutputItemFunctionCall$outboundSchema = z93.object({
  type: ResponsesOutputItemFunctionCallType$outboundSchema,
  id: z93.string().optional(),
  name: z93.string(),
  arguments: z93.string(),
  callId: z93.string(),
  status: z93.union([
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
var z94 = __toESM(require("zod/v4"), 1);
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
var ResponsesOutputItemReasoningType$inboundSchema = z94.enum(ResponsesOutputItemReasoningType);
var ResponsesOutputItemReasoningType$outboundSchema = ResponsesOutputItemReasoningType$inboundSchema;
var ResponsesOutputItemReasoningStatusInProgress$inboundSchema = z94.enum(ResponsesOutputItemReasoningStatusInProgress);
var ResponsesOutputItemReasoningStatusInProgress$outboundSchema = ResponsesOutputItemReasoningStatusInProgress$inboundSchema;
var ResponsesOutputItemReasoningStatusIncomplete$inboundSchema = z94.enum(ResponsesOutputItemReasoningStatusIncomplete);
var ResponsesOutputItemReasoningStatusIncomplete$outboundSchema = ResponsesOutputItemReasoningStatusIncomplete$inboundSchema;
var ResponsesOutputItemReasoningStatusCompleted$inboundSchema = z94.enum(ResponsesOutputItemReasoningStatusCompleted);
var ResponsesOutputItemReasoningStatusCompleted$outboundSchema = ResponsesOutputItemReasoningStatusCompleted$inboundSchema;
var ResponsesOutputItemReasoningStatusUnion$inboundSchema = z94.union([
  ResponsesOutputItemReasoningStatusCompleted$inboundSchema,
  ResponsesOutputItemReasoningStatusIncomplete$inboundSchema,
  ResponsesOutputItemReasoningStatusInProgress$inboundSchema
]);
var ResponsesOutputItemReasoningStatusUnion$outboundSchema = z94.union([
  ResponsesOutputItemReasoningStatusCompleted$outboundSchema,
  ResponsesOutputItemReasoningStatusIncomplete$outboundSchema,
  ResponsesOutputItemReasoningStatusInProgress$outboundSchema
]);
var ResponsesOutputItemReasoning$inboundSchema = z94.object({
  type: ResponsesOutputItemReasoningType$inboundSchema,
  id: z94.string(),
  content: z94.array(ReasoningTextContent$inboundSchema).optional(),
  summary: z94.array(ReasoningSummaryText$inboundSchema),
  encrypted_content: z94.nullable(z94.string()).optional(),
  status: z94.union([
    ResponsesOutputItemReasoningStatusCompleted$inboundSchema,
    ResponsesOutputItemReasoningStatusIncomplete$inboundSchema,
    ResponsesOutputItemReasoningStatusInProgress$inboundSchema
  ]).optional()
}).transform((v) => {
  return remap(v, {
    "encrypted_content": "encryptedContent"
  });
});
var ResponsesOutputItemReasoning$outboundSchema = z94.object({
  type: ResponsesOutputItemReasoningType$outboundSchema,
  id: z94.string(),
  content: z94.array(ReasoningTextContent$outboundSchema).optional(),
  summary: z94.array(ReasoningSummaryText$outboundSchema),
  encryptedContent: z94.nullable(z94.string()).optional(),
  status: z94.union([
    ResponsesOutputItemReasoningStatusCompleted$outboundSchema,
    ResponsesOutputItemReasoningStatusIncomplete$outboundSchema,
    ResponsesOutputItemReasoningStatusInProgress$outboundSchema
  ]).optional()
}).transform((v) => {
  return remap(v, {
    encryptedContent: "encrypted_content"
  });
});

// node_modules/@openrouter/sdk/esm/models/responsesoutputmessage.js
var z95 = __toESM(require("zod/v4"), 1);
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
var ResponsesOutputMessageRole$inboundSchema = z95.enum(ResponsesOutputMessageRole);
var ResponsesOutputMessageRole$outboundSchema = ResponsesOutputMessageRole$inboundSchema;
var ResponsesOutputMessageType$inboundSchema = z95.enum(ResponsesOutputMessageType);
var ResponsesOutputMessageType$outboundSchema = ResponsesOutputMessageType$inboundSchema;
var ResponsesOutputMessageStatusInProgress$inboundSchema = z95.enum(ResponsesOutputMessageStatusInProgress);
var ResponsesOutputMessageStatusInProgress$outboundSchema = ResponsesOutputMessageStatusInProgress$inboundSchema;
var ResponsesOutputMessageStatusIncomplete$inboundSchema = z95.enum(ResponsesOutputMessageStatusIncomplete);
var ResponsesOutputMessageStatusIncomplete$outboundSchema = ResponsesOutputMessageStatusIncomplete$inboundSchema;
var ResponsesOutputMessageStatusCompleted$inboundSchema = z95.enum(ResponsesOutputMessageStatusCompleted);
var ResponsesOutputMessageStatusCompleted$outboundSchema = ResponsesOutputMessageStatusCompleted$inboundSchema;
var ResponsesOutputMessageStatusUnion$inboundSchema = z95.union([
  ResponsesOutputMessageStatusCompleted$inboundSchema,
  ResponsesOutputMessageStatusIncomplete$inboundSchema,
  ResponsesOutputMessageStatusInProgress$inboundSchema
]);
var ResponsesOutputMessageStatusUnion$outboundSchema = z95.union([
  ResponsesOutputMessageStatusCompleted$outboundSchema,
  ResponsesOutputMessageStatusIncomplete$outboundSchema,
  ResponsesOutputMessageStatusInProgress$outboundSchema
]);
var ResponsesOutputMessageContent$inboundSchema = z95.union([
  ResponseOutputText$inboundSchema,
  OpenAIResponsesRefusalContent$inboundSchema
]);
var ResponsesOutputMessageContent$outboundSchema = z95.union([
  ResponseOutputText$outboundSchema,
  OpenAIResponsesRefusalContent$outboundSchema
]);
var ResponsesOutputMessage$inboundSchema = z95.object({
  id: z95.string(),
  role: ResponsesOutputMessageRole$inboundSchema,
  type: ResponsesOutputMessageType$inboundSchema,
  status: z95.union([
    ResponsesOutputMessageStatusCompleted$inboundSchema,
    ResponsesOutputMessageStatusIncomplete$inboundSchema,
    ResponsesOutputMessageStatusInProgress$inboundSchema
  ]).optional(),
  content: z95.array(z95.union([
    ResponseOutputText$inboundSchema,
    OpenAIResponsesRefusalContent$inboundSchema
  ]))
});
var ResponsesOutputMessage$outboundSchema = z95.object({
  id: z95.string(),
  role: ResponsesOutputMessageRole$outboundSchema,
  type: ResponsesOutputMessageType$outboundSchema,
  status: z95.union([
    ResponsesOutputMessageStatusCompleted$outboundSchema,
    ResponsesOutputMessageStatusIncomplete$outboundSchema,
    ResponsesOutputMessageStatusInProgress$outboundSchema
  ]).optional(),
  content: z95.array(z95.union([
    ResponseOutputText$outboundSchema,
    OpenAIResponsesRefusalContent$outboundSchema
  ]))
});

// node_modules/@openrouter/sdk/esm/models/responseswebsearchcalloutput.js
var z96 = __toESM(require("zod/v4"), 1);
var ResponsesWebSearchCallOutputType = {
  WebSearchCall: "web_search_call"
};
var ResponsesWebSearchCallOutputType$inboundSchema = z96.enum(ResponsesWebSearchCallOutputType);
var ResponsesWebSearchCallOutputType$outboundSchema = ResponsesWebSearchCallOutputType$inboundSchema;
var ResponsesWebSearchCallOutput$inboundSchema = z96.object({
  type: ResponsesWebSearchCallOutputType$inboundSchema,
  id: z96.string(),
  status: WebSearchStatus$inboundSchema
});
var ResponsesWebSearchCallOutput$outboundSchema = z96.object({
  type: ResponsesWebSearchCallOutputType$outboundSchema,
  id: z96.string(),
  status: WebSearchStatus$outboundSchema
});

// node_modules/@openrouter/sdk/esm/models/openresponsesinput.js
var OpenResponsesInput1$outboundSchema = z97.union([
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
var OpenResponsesInput$outboundSchema = z97.union([
  z97.string(),
  z97.array(z97.union([
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
var z99 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/openresponsestoplogprobs.js
var z98 = __toESM(require("zod/v4"), 1);
var OpenResponsesTopLogprobs$inboundSchema = z98.object({
  token: z98.string().optional(),
  logprob: z98.number().optional()
});

// node_modules/@openrouter/sdk/esm/models/openresponseslogprobs.js
var OpenResponsesLogProbs$inboundSchema = z99.object({
  logprob: z99.number(),
  token: z99.string(),
  top_logprobs: z99.array(OpenResponsesTopLogprobs$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "top_logprobs": "topLogprobs"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesnonstreamingresponse.js
var z114 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/openresponsesusage.js
var z100 = __toESM(require("zod/v4"), 1);
var InputTokensDetails$inboundSchema = z100.object({
  cached_tokens: z100.number()
}).transform((v) => {
  return remap(v, {
    "cached_tokens": "cachedTokens"
  });
});
var OutputTokensDetails$inboundSchema = z100.object({
  reasoning_tokens: z100.number()
}).transform((v) => {
  return remap(v, {
    "reasoning_tokens": "reasoningTokens"
  });
});
var CostDetails$inboundSchema = z100.object({
  upstream_inference_cost: z100.nullable(z100.number()).optional(),
  upstream_inference_input_cost: z100.number(),
  upstream_inference_output_cost: z100.number()
}).transform((v) => {
  return remap(v, {
    "upstream_inference_cost": "upstreamInferenceCost",
    "upstream_inference_input_cost": "upstreamInferenceInputCost",
    "upstream_inference_output_cost": "upstreamInferenceOutputCost"
  });
});
var OpenResponsesUsage$inboundSchema = z100.object({
  input_tokens: z100.number(),
  input_tokens_details: z100.lazy(() => InputTokensDetails$inboundSchema),
  output_tokens: z100.number(),
  output_tokens_details: z100.lazy(() => OutputTokensDetails$inboundSchema),
  total_tokens: z100.number(),
  cost: z100.nullable(z100.number()).optional(),
  is_byok: z100.boolean().optional(),
  cost_details: z100.lazy(() => CostDetails$inboundSchema).optional()
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
var z102 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/responsessearchcontextsize.js
var ResponsesSearchContextSize = {
  Low: "low",
  Medium: "medium",
  High: "high"
};
var ResponsesSearchContextSize$inboundSchema = inboundSchema(ResponsesSearchContextSize);
var ResponsesSearchContextSize$outboundSchema = outboundSchema(ResponsesSearchContextSize);

// node_modules/@openrouter/sdk/esm/models/responseswebsearchuserlocation.js
var z101 = __toESM(require("zod/v4"), 1);
var ResponsesWebSearchUserLocationType = {
  Approximate: "approximate"
};
var ResponsesWebSearchUserLocationType$inboundSchema = z101.enum(ResponsesWebSearchUserLocationType);
var ResponsesWebSearchUserLocationType$outboundSchema = ResponsesWebSearchUserLocationType$inboundSchema;
var ResponsesWebSearchUserLocation$inboundSchema = z101.object({
  type: ResponsesWebSearchUserLocationType$inboundSchema.optional(),
  city: z101.nullable(z101.string()).optional(),
  country: z101.nullable(z101.string()).optional(),
  region: z101.nullable(z101.string()).optional(),
  timezone: z101.nullable(z101.string()).optional()
});
var ResponsesWebSearchUserLocation$outboundSchema = z101.object({
  type: ResponsesWebSearchUserLocationType$outboundSchema.optional(),
  city: z101.nullable(z101.string()).optional(),
  country: z101.nullable(z101.string()).optional(),
  region: z101.nullable(z101.string()).optional(),
  timezone: z101.nullable(z101.string()).optional()
});

// node_modules/@openrouter/sdk/esm/models/openresponseswebsearch20250826tool.js
var OpenResponsesWebSearch20250826ToolFilters$inboundSchema = z102.object({
  allowed_domains: z102.nullable(z102.array(z102.string())).optional()
}).transform((v) => {
  return remap(v, {
    "allowed_domains": "allowedDomains"
  });
});
var OpenResponsesWebSearch20250826ToolFilters$outboundSchema = z102.object({
  allowedDomains: z102.nullable(z102.array(z102.string())).optional()
}).transform((v) => {
  return remap(v, {
    allowedDomains: "allowed_domains"
  });
});
var OpenResponsesWebSearch20250826Tool$inboundSchema = z102.object({
  type: z102.literal("web_search_2025_08_26"),
  filters: z102.nullable(z102.lazy(() => OpenResponsesWebSearch20250826ToolFilters$inboundSchema)).optional(),
  search_context_size: ResponsesSearchContextSize$inboundSchema.optional(),
  user_location: z102.nullable(ResponsesWebSearchUserLocation$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "search_context_size": "searchContextSize",
    "user_location": "userLocation"
  });
});
var OpenResponsesWebSearch20250826Tool$outboundSchema = z102.object({
  type: z102.literal("web_search_2025_08_26"),
  filters: z102.nullable(z102.lazy(() => OpenResponsesWebSearch20250826ToolFilters$outboundSchema)).optional(),
  searchContextSize: ResponsesSearchContextSize$outboundSchema.optional(),
  userLocation: z102.nullable(ResponsesWebSearchUserLocation$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    searchContextSize: "search_context_size",
    userLocation: "user_location"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponseswebsearchpreview20250311tool.js
var z104 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/websearchpreviewtooluserlocation.js
var z103 = __toESM(require("zod/v4"), 1);
var WebSearchPreviewToolUserLocationType = {
  Approximate: "approximate"
};
var WebSearchPreviewToolUserLocationType$inboundSchema = z103.enum(WebSearchPreviewToolUserLocationType);
var WebSearchPreviewToolUserLocationType$outboundSchema = WebSearchPreviewToolUserLocationType$inboundSchema;
var WebSearchPreviewToolUserLocation$inboundSchema = z103.object({
  type: WebSearchPreviewToolUserLocationType$inboundSchema,
  city: z103.nullable(z103.string()).optional(),
  country: z103.nullable(z103.string()).optional(),
  region: z103.nullable(z103.string()).optional(),
  timezone: z103.nullable(z103.string()).optional()
});
var WebSearchPreviewToolUserLocation$outboundSchema = z103.object({
  type: WebSearchPreviewToolUserLocationType$outboundSchema,
  city: z103.nullable(z103.string()).optional(),
  country: z103.nullable(z103.string()).optional(),
  region: z103.nullable(z103.string()).optional(),
  timezone: z103.nullable(z103.string()).optional()
});

// node_modules/@openrouter/sdk/esm/models/openresponseswebsearchpreview20250311tool.js
var OpenResponsesWebSearchPreview20250311Tool$inboundSchema = z104.object({
  type: z104.literal("web_search_preview_2025_03_11"),
  search_context_size: ResponsesSearchContextSize$inboundSchema.optional(),
  user_location: z104.nullable(WebSearchPreviewToolUserLocation$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "search_context_size": "searchContextSize",
    "user_location": "userLocation"
  });
});
var OpenResponsesWebSearchPreview20250311Tool$outboundSchema = z104.object({
  type: z104.literal("web_search_preview_2025_03_11"),
  searchContextSize: ResponsesSearchContextSize$outboundSchema.optional(),
  userLocation: z104.nullable(WebSearchPreviewToolUserLocation$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    searchContextSize: "search_context_size",
    userLocation: "user_location"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponseswebsearchpreviewtool.js
var z105 = __toESM(require("zod/v4"), 1);
var OpenResponsesWebSearchPreviewTool$inboundSchema = z105.object({
  type: z105.literal("web_search_preview"),
  search_context_size: ResponsesSearchContextSize$inboundSchema.optional(),
  user_location: z105.nullable(WebSearchPreviewToolUserLocation$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "search_context_size": "searchContextSize",
    "user_location": "userLocation"
  });
});
var OpenResponsesWebSearchPreviewTool$outboundSchema = z105.object({
  type: z105.literal("web_search_preview"),
  searchContextSize: ResponsesSearchContextSize$outboundSchema.optional(),
  userLocation: z105.nullable(WebSearchPreviewToolUserLocation$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    searchContextSize: "search_context_size",
    userLocation: "user_location"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponseswebsearchtool.js
var z106 = __toESM(require("zod/v4"), 1);
var OpenResponsesWebSearchToolFilters$inboundSchema = z106.object({
  allowed_domains: z106.nullable(z106.array(z106.string())).optional()
}).transform((v) => {
  return remap(v, {
    "allowed_domains": "allowedDomains"
  });
});
var OpenResponsesWebSearchToolFilters$outboundSchema = z106.object({
  allowedDomains: z106.nullable(z106.array(z106.string())).optional()
}).transform((v) => {
  return remap(v, {
    allowedDomains: "allowed_domains"
  });
});
var OpenResponsesWebSearchTool$inboundSchema = z106.object({
  type: z106.literal("web_search"),
  filters: z106.nullable(z106.lazy(() => OpenResponsesWebSearchToolFilters$inboundSchema)).optional(),
  search_context_size: ResponsesSearchContextSize$inboundSchema.optional(),
  user_location: z106.nullable(ResponsesWebSearchUserLocation$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "search_context_size": "searchContextSize",
    "user_location": "userLocation"
  });
});
var OpenResponsesWebSearchTool$outboundSchema = z106.object({
  type: z106.literal("web_search"),
  filters: z106.nullable(z106.lazy(() => OpenResponsesWebSearchToolFilters$outboundSchema)).optional(),
  searchContextSize: ResponsesSearchContextSize$outboundSchema.optional(),
  userLocation: z106.nullable(ResponsesWebSearchUserLocation$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    searchContextSize: "search_context_size",
    userLocation: "user_location"
  });
});

// node_modules/@openrouter/sdk/esm/models/responseserrorfield.js
var z107 = __toESM(require("zod/v4"), 1);
var CodeEnum = {
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
var CodeEnum$inboundSchema = inboundSchema(CodeEnum);
var ResponsesErrorField$inboundSchema = z107.object({
  code: CodeEnum$inboundSchema,
  message: z107.string()
});

// node_modules/@openrouter/sdk/esm/models/responsesoutputitem.js
var z108 = __toESM(require("zod/v4"), 1);
var ResponsesOutputItem$inboundSchema = z108.union([
  ResponsesOutputMessage$inboundSchema.and(z108.object({ type: z108.literal("message") })),
  ResponsesOutputItemReasoning$inboundSchema.and(z108.object({ type: z108.literal("reasoning") })),
  ResponsesOutputItemFunctionCall$inboundSchema.and(z108.object({ type: z108.literal("function_call") })),
  ResponsesWebSearchCallOutput$inboundSchema.and(z108.object({ type: z108.literal("web_search_call") })),
  ResponsesOutputItemFileSearchCall$inboundSchema.and(z108.object({ type: z108.literal("file_search_call") })),
  ResponsesImageGenerationCall$inboundSchema.and(z108.object({ type: z108.literal("image_generation_call") }))
]);

// node_modules/@openrouter/sdk/esm/models/responsetextconfig.js
var z113 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/responseformattextconfig.js
var z112 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/responsesformatjsonobject.js
var z109 = __toESM(require("zod/v4"), 1);
var ResponsesFormatJSONObject$inboundSchema = z109.object({
  type: z109.literal("json_object")
});
var ResponsesFormatJSONObject$outboundSchema = z109.object({
  type: z109.literal("json_object")
});

// node_modules/@openrouter/sdk/esm/models/responsesformattext.js
var z110 = __toESM(require("zod/v4"), 1);
var ResponsesFormatText$inboundSchema = z110.object({
  type: z110.literal("text")
});
var ResponsesFormatText$outboundSchema = z110.object({
  type: z110.literal("text")
});

// node_modules/@openrouter/sdk/esm/models/responsesformattextjsonschemaconfig.js
var z111 = __toESM(require("zod/v4"), 1);
var ResponsesFormatTextJSONSchemaConfig$inboundSchema = z111.object({
  type: z111.literal("json_schema"),
  name: z111.string(),
  description: z111.string().optional(),
  strict: z111.nullable(z111.boolean()).optional(),
  schema: z111.record(z111.string(), z111.nullable(z111.any()))
});
var ResponsesFormatTextJSONSchemaConfig$outboundSchema = z111.object({
  type: z111.literal("json_schema"),
  name: z111.string(),
  description: z111.string().optional(),
  strict: z111.nullable(z111.boolean()).optional(),
  schema: z111.record(z111.string(), z111.nullable(z111.any()))
});

// node_modules/@openrouter/sdk/esm/models/responseformattextconfig.js
var ResponseFormatTextConfig$inboundSchema = z112.union([
  ResponsesFormatText$inboundSchema,
  ResponsesFormatJSONObject$inboundSchema,
  ResponsesFormatTextJSONSchemaConfig$inboundSchema
]);
var ResponseFormatTextConfig$outboundSchema = z112.union([
  ResponsesFormatText$outboundSchema,
  ResponsesFormatJSONObject$outboundSchema,
  ResponsesFormatTextJSONSchemaConfig$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/responsetextconfig.js
var ResponseTextConfigVerbosity = {
  High: "high",
  Low: "low",
  Medium: "medium"
};
var ResponseTextConfigVerbosity$inboundSchema = inboundSchema(ResponseTextConfigVerbosity);
var ResponseTextConfig$inboundSchema = z113.object({
  format: ResponseFormatTextConfig$inboundSchema.optional(),
  verbosity: z113.nullable(ResponseTextConfigVerbosity$inboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/openresponsesnonstreamingresponse.js
var ObjectT = {
  Response: "response"
};
var ObjectT$inboundSchema = z114.enum(ObjectT);
var OpenResponsesNonStreamingResponseToolFunction$inboundSchema = z114.object({
  type: z114.literal("function"),
  name: z114.string(),
  description: z114.nullable(z114.string()).optional(),
  strict: z114.nullable(z114.boolean()).optional(),
  parameters: z114.nullable(z114.record(z114.string(), z114.nullable(z114.any())))
});
var OpenResponsesNonStreamingResponseToolUnion$inboundSchema = z114.union([
  z114.lazy(() => OpenResponsesNonStreamingResponseToolFunction$inboundSchema),
  OpenResponsesWebSearchPreviewTool$inboundSchema,
  OpenResponsesWebSearchPreview20250311Tool$inboundSchema,
  OpenResponsesWebSearchTool$inboundSchema,
  OpenResponsesWebSearch20250826Tool$inboundSchema
]);
var OpenResponsesNonStreamingResponse$inboundSchema = z114.object({
  id: z114.string(),
  object: ObjectT$inboundSchema,
  created_at: z114.number(),
  model: z114.string(),
  status: OpenAIResponsesResponseStatus$inboundSchema.optional(),
  output: z114.array(ResponsesOutputItem$inboundSchema),
  user: z114.nullable(z114.string()).optional(),
  output_text: z114.string().optional(),
  prompt_cache_key: z114.nullable(z114.string()).optional(),
  safety_identifier: z114.nullable(z114.string()).optional(),
  error: z114.nullable(ResponsesErrorField$inboundSchema),
  incomplete_details: z114.nullable(OpenAIResponsesIncompleteDetails$inboundSchema),
  usage: OpenResponsesUsage$inboundSchema.optional(),
  max_tool_calls: z114.nullable(z114.number()).optional(),
  top_logprobs: z114.number().optional(),
  max_output_tokens: z114.nullable(z114.number()).optional(),
  temperature: z114.nullable(z114.number()),
  top_p: z114.nullable(z114.number()),
  instructions: z114.nullable(OpenAIResponsesInputUnion$inboundSchema).optional(),
  metadata: z114.nullable(z114.record(z114.string(), z114.string())),
  tools: z114.array(z114.union([
    z114.lazy(() => OpenResponsesNonStreamingResponseToolFunction$inboundSchema),
    OpenResponsesWebSearchPreviewTool$inboundSchema,
    OpenResponsesWebSearchPreview20250311Tool$inboundSchema,
    OpenResponsesWebSearchTool$inboundSchema,
    OpenResponsesWebSearch20250826Tool$inboundSchema
  ])),
  tool_choice: OpenAIResponsesToolChoiceUnion$inboundSchema,
  parallel_tool_calls: z114.boolean(),
  prompt: z114.nullable(OpenAIResponsesPrompt$inboundSchema).optional(),
  background: z114.nullable(z114.boolean()).optional(),
  previous_response_id: z114.nullable(z114.string()).optional(),
  reasoning: z114.nullable(OpenAIResponsesReasoningConfig$inboundSchema).optional(),
  service_tier: z114.nullable(OpenAIResponsesServiceTier$inboundSchema).optional(),
  store: z114.boolean().optional(),
  truncation: z114.nullable(OpenAIResponsesTruncation$inboundSchema).optional(),
  text: ResponseTextConfig$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "created_at": "createdAt",
    "output_text": "outputText",
    "prompt_cache_key": "promptCacheKey",
    "safety_identifier": "safetyIdentifier",
    "incomplete_details": "incompleteDetails",
    "max_tool_calls": "maxToolCalls",
    "top_logprobs": "topLogprobs",
    "max_output_tokens": "maxOutputTokens",
    "top_p": "topP",
    "tool_choice": "toolChoice",
    "parallel_tool_calls": "parallelToolCalls",
    "previous_response_id": "previousResponseId",
    "service_tier": "serviceTier"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoningconfig.js
var z115 = __toESM(require("zod/v4"), 1);
var OpenResponsesReasoningConfig$outboundSchema = z115.object({
  effort: z115.nullable(OpenAIResponsesReasoningEffort$outboundSchema).optional(),
  summary: ReasoningSummaryVerbosity$outboundSchema.optional(),
  maxTokens: z115.nullable(z115.number()).optional(),
  enabled: z115.nullable(z115.boolean()).optional()
}).transform((v) => {
  return remap(v, {
    maxTokens: "max_tokens"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoningdeltaevent.js
var z116 = __toESM(require("zod/v4"), 1);
var OpenResponsesReasoningDeltaEvent$inboundSchema = z116.object({
  type: z116.literal("response.reasoning_text.delta"),
  output_index: z116.number(),
  item_id: z116.string(),
  content_index: z116.number(),
  delta: z116.string(),
  sequence_number: z116.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoningdoneevent.js
var z117 = __toESM(require("zod/v4"), 1);
var OpenResponsesReasoningDoneEvent$inboundSchema = z117.object({
  type: z117.literal("response.reasoning_text.done"),
  output_index: z117.number(),
  item_id: z117.string(),
  content_index: z117.number(),
  text: z117.string(),
  sequence_number: z117.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoningsummarypartaddedevent.js
var z118 = __toESM(require("zod/v4"), 1);
var OpenResponsesReasoningSummaryPartAddedEvent$inboundSchema = z118.object({
  type: z118.literal("response.reasoning_summary_part.added"),
  output_index: z118.number(),
  item_id: z118.string(),
  summary_index: z118.number(),
  part: ReasoningSummaryText$inboundSchema,
  sequence_number: z118.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "summary_index": "summaryIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoningsummarytextdeltaevent.js
var z119 = __toESM(require("zod/v4"), 1);
var OpenResponsesReasoningSummaryTextDeltaEvent$inboundSchema = z119.object({
  type: z119.literal("response.reasoning_summary_text.delta"),
  item_id: z119.string(),
  output_index: z119.number(),
  summary_index: z119.number(),
  delta: z119.string(),
  sequence_number: z119.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "summary_index": "summaryIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesreasoningsummarytextdoneevent.js
var z120 = __toESM(require("zod/v4"), 1);
var OpenResponsesReasoningSummaryTextDoneEvent$inboundSchema = z120.object({
  type: z120.literal("response.reasoning_summary_text.done"),
  item_id: z120.string(),
  output_index: z120.number(),
  summary_index: z120.number(),
  text: z120.string(),
  sequence_number: z120.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "summary_index": "summaryIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesrequest.js
var z123 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/openresponsesresponsetext.js
var z121 = __toESM(require("zod/v4"), 1);
var OpenResponsesResponseTextVerbosity = {
  High: "high",
  Low: "low",
  Medium: "medium"
};
var OpenResponsesResponseTextVerbosity$outboundSchema = outboundSchema(OpenResponsesResponseTextVerbosity);
var OpenResponsesResponseText$outboundSchema = z121.object({
  format: ResponseFormatTextConfig$outboundSchema.optional(),
  verbosity: z121.nullable(OpenResponsesResponseTextVerbosity$outboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/pdfparseroptions.js
var z122 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/pdfparserengine.js
var PDFParserEngine = {
  MistralOcr: "mistral-ocr",
  PdfText: "pdf-text",
  Native: "native"
};
var PDFParserEngine$outboundSchema = outboundSchema(PDFParserEngine);

// node_modules/@openrouter/sdk/esm/models/pdfparseroptions.js
var PDFParserOptions$outboundSchema = z122.object({
  engine: PDFParserEngine$outboundSchema.optional()
});

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

// node_modules/@openrouter/sdk/esm/models/websearchengine.js
var WebSearchEngine = {
  Native: "native",
  Exa: "exa"
};
var WebSearchEngine$outboundSchema = outboundSchema(WebSearchEngine);

// node_modules/@openrouter/sdk/esm/models/openresponsesrequest.js
var ServiceTier = {
  Auto: "auto"
};
var Truncation = {
  Auto: "auto",
  Disabled: "disabled"
};
var OpenResponsesRequestToolFunction$outboundSchema = z123.object({
  type: z123.literal("function"),
  name: z123.string(),
  description: z123.nullable(z123.string()).optional(),
  strict: z123.nullable(z123.boolean()).optional(),
  parameters: z123.nullable(z123.record(z123.string(), z123.nullable(z123.any())))
});
var OpenResponsesRequestToolUnion$outboundSchema = z123.union([
  z123.lazy(() => OpenResponsesRequestToolFunction$outboundSchema),
  OpenResponsesWebSearchPreviewTool$outboundSchema,
  OpenResponsesWebSearchPreview20250311Tool$outboundSchema,
  OpenResponsesWebSearchTool$outboundSchema,
  OpenResponsesWebSearch20250826Tool$outboundSchema
]);
var ServiceTier$outboundSchema = z123.enum(ServiceTier);
var Truncation$outboundSchema = outboundSchema(Truncation);
var OpenResponsesRequestOrder$outboundSchema = z123.union([ProviderName$outboundSchema, z123.string()]);
var OpenResponsesRequestOnly$outboundSchema = z123.union([ProviderName$outboundSchema, z123.string()]);
var OpenResponsesRequestIgnore$outboundSchema = z123.union([ProviderName$outboundSchema, z123.string()]);
var OpenResponsesRequestSort$outboundSchema = z123.union([
  ProviderSort$outboundSchema,
  ProviderSortConfig$outboundSchema,
  z123.any()
]);
var OpenResponsesRequestMaxPrice$outboundSchema = z123.object({
  prompt: z123.string().optional(),
  completion: z123.string().optional(),
  image: z123.string().optional(),
  audio: z123.string().optional(),
  request: z123.string().optional()
});
var OpenResponsesRequestProvider$outboundSchema = z123.object({
  allowFallbacks: z123.nullable(z123.boolean()).optional(),
  requireParameters: z123.nullable(z123.boolean()).optional(),
  dataCollection: z123.nullable(DataCollection$outboundSchema).optional(),
  zdr: z123.nullable(z123.boolean()).optional(),
  enforceDistillableText: z123.nullable(z123.boolean()).optional(),
  order: z123.nullable(z123.array(z123.union([ProviderName$outboundSchema, z123.string()]))).optional(),
  only: z123.nullable(z123.array(z123.union([ProviderName$outboundSchema, z123.string()]))).optional(),
  ignore: z123.nullable(z123.array(z123.union([ProviderName$outboundSchema, z123.string()]))).optional(),
  quantizations: z123.nullable(z123.array(Quantization$outboundSchema)).optional(),
  sort: z123.nullable(z123.union([
    ProviderSort$outboundSchema,
    ProviderSortConfig$outboundSchema,
    z123.any()
  ])).optional(),
  maxPrice: z123.lazy(() => OpenResponsesRequestMaxPrice$outboundSchema).optional(),
  preferredMinThroughput: z123.nullable(z123.number()).optional(),
  preferredMaxLatency: z123.nullable(z123.number()).optional(),
  minThroughput: z123.nullable(z123.number()).optional(),
  maxLatency: z123.nullable(z123.number()).optional()
}).transform((v) => {
  return remap(v, {
    allowFallbacks: "allow_fallbacks",
    requireParameters: "require_parameters",
    dataCollection: "data_collection",
    enforceDistillableText: "enforce_distillable_text",
    maxPrice: "max_price",
    preferredMinThroughput: "preferred_min_throughput",
    preferredMaxLatency: "preferred_max_latency",
    minThroughput: "min_throughput",
    maxLatency: "max_latency"
  });
});
var OpenResponsesRequestPluginResponseHealing$outboundSchema = z123.object({
  id: z123.literal("response-healing"),
  enabled: z123.boolean().optional()
});
var OpenResponsesRequestPluginFileParser$outboundSchema = z123.object({
  id: z123.literal("file-parser"),
  enabled: z123.boolean().optional(),
  pdf: PDFParserOptions$outboundSchema.optional()
});
var OpenResponsesRequestPluginWeb$outboundSchema = z123.object({
  id: z123.literal("web"),
  enabled: z123.boolean().optional(),
  maxResults: z123.number().optional(),
  searchPrompt: z123.string().optional(),
  engine: WebSearchEngine$outboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    maxResults: "max_results",
    searchPrompt: "search_prompt"
  });
});
var OpenResponsesRequestPluginModeration$outboundSchema = z123.object({
  id: z123.literal("moderation")
});
var OpenResponsesRequestPluginUnion$outboundSchema = z123.union([
  z123.lazy(() => OpenResponsesRequestPluginModeration$outboundSchema),
  z123.lazy(() => OpenResponsesRequestPluginWeb$outboundSchema),
  z123.lazy(() => OpenResponsesRequestPluginFileParser$outboundSchema),
  z123.lazy(() => OpenResponsesRequestPluginResponseHealing$outboundSchema)
]);
var OpenResponsesRequest$outboundSchema = z123.object({
  input: OpenResponsesInput$outboundSchema.optional(),
  instructions: z123.nullable(z123.string()).optional(),
  metadata: z123.nullable(z123.record(z123.string(), z123.string())).optional(),
  tools: z123.array(z123.union([
    z123.lazy(() => OpenResponsesRequestToolFunction$outboundSchema),
    OpenResponsesWebSearchPreviewTool$outboundSchema,
    OpenResponsesWebSearchPreview20250311Tool$outboundSchema,
    OpenResponsesWebSearchTool$outboundSchema,
    OpenResponsesWebSearch20250826Tool$outboundSchema
  ])).optional(),
  toolChoice: OpenAIResponsesToolChoiceUnion$outboundSchema.optional(),
  parallelToolCalls: z123.nullable(z123.boolean()).optional(),
  model: z123.string().optional(),
  models: z123.array(z123.string()).optional(),
  text: OpenResponsesResponseText$outboundSchema.optional(),
  reasoning: z123.nullable(OpenResponsesReasoningConfig$outboundSchema).optional(),
  maxOutputTokens: z123.nullable(z123.number()).optional(),
  temperature: z123.nullable(z123.number()).optional(),
  topP: z123.nullable(z123.number()).optional(),
  topK: z123.number().optional(),
  promptCacheKey: z123.nullable(z123.string()).optional(),
  previousResponseId: z123.nullable(z123.string()).optional(),
  prompt: z123.nullable(OpenAIResponsesPrompt$outboundSchema).optional(),
  include: z123.nullable(z123.array(OpenAIResponsesIncludable$outboundSchema)).optional(),
  background: z123.nullable(z123.boolean()).optional(),
  safetyIdentifier: z123.nullable(z123.string()).optional(),
  store: z123.literal(false).default(false),
  serviceTier: ServiceTier$outboundSchema.default("auto"),
  truncation: z123.nullable(Truncation$outboundSchema).optional(),
  stream: z123.boolean().default(false),
  provider: z123.nullable(z123.lazy(() => OpenResponsesRequestProvider$outboundSchema)).optional(),
  plugins: z123.array(z123.union([
    z123.lazy(() => OpenResponsesRequestPluginModeration$outboundSchema),
    z123.lazy(() => OpenResponsesRequestPluginWeb$outboundSchema),
    z123.lazy(() => OpenResponsesRequestPluginFileParser$outboundSchema),
    z123.lazy(() => OpenResponsesRequestPluginResponseHealing$outboundSchema)
  ])).optional(),
  user: z123.string().optional(),
  sessionId: z123.string().optional()
}).transform((v) => {
  return remap(v, {
    toolChoice: "tool_choice",
    parallelToolCalls: "parallel_tool_calls",
    maxOutputTokens: "max_output_tokens",
    topP: "top_p",
    topK: "top_k",
    promptCacheKey: "prompt_cache_key",
    previousResponseId: "previous_response_id",
    safetyIdentifier: "safety_identifier",
    serviceTier: "service_tier",
    sessionId: "session_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesstreamevent.js
var z124 = __toESM(require("zod/v4"), 1);
var OpenResponsesStreamEventResponseReasoningSummaryPartDone$inboundSchema = z124.object({
  type: z124.literal("response.reasoning_summary_part.done"),
  output_index: z124.number(),
  item_id: z124.string(),
  summary_index: z124.number(),
  part: ReasoningSummaryText$inboundSchema,
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "summary_index": "summaryIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseFunctionCallArgumentsDone$inboundSchema = z124.object({
  type: z124.literal("response.function_call_arguments.done"),
  item_id: z124.string(),
  output_index: z124.number(),
  name: z124.string(),
  arguments: z124.string(),
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseFunctionCallArgumentsDelta$inboundSchema = z124.object({
  type: z124.literal("response.function_call_arguments.delta"),
  item_id: z124.string(),
  output_index: z124.number(),
  delta: z124.string(),
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseOutputTextAnnotationAdded$inboundSchema = z124.object({
  type: z124.literal("response.output_text.annotation.added"),
  output_index: z124.number(),
  item_id: z124.string(),
  content_index: z124.number(),
  sequence_number: z124.number(),
  annotation_index: z124.number(),
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
var OpenResponsesStreamEventResponseRefusalDone$inboundSchema = z124.object({
  type: z124.literal("response.refusal.done"),
  output_index: z124.number(),
  item_id: z124.string(),
  content_index: z124.number(),
  refusal: z124.string(),
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseRefusalDelta$inboundSchema = z124.object({
  type: z124.literal("response.refusal.delta"),
  output_index: z124.number(),
  item_id: z124.string(),
  content_index: z124.number(),
  delta: z124.string(),
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseOutputTextDone$inboundSchema = z124.object({
  type: z124.literal("response.output_text.done"),
  output_index: z124.number(),
  item_id: z124.string(),
  content_index: z124.number(),
  text: z124.string(),
  sequence_number: z124.number(),
  logprobs: z124.array(OpenResponsesLogProbs$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseOutputTextDelta$inboundSchema = z124.object({
  type: z124.literal("response.output_text.delta"),
  logprobs: z124.array(OpenResponsesLogProbs$inboundSchema),
  output_index: z124.number(),
  item_id: z124.string(),
  content_index: z124.number(),
  delta: z124.string(),
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});
var Part2$inboundSchema = z124.union([
  ResponseOutputText$inboundSchema,
  ReasoningTextContent$inboundSchema.and(z124.object({ type: z124.literal("reasoning_text") })),
  OpenAIResponsesRefusalContent$inboundSchema
]);
var OpenResponsesStreamEventResponseContentPartDone$inboundSchema = z124.object({
  type: z124.literal("response.content_part.done"),
  output_index: z124.number(),
  item_id: z124.string(),
  content_index: z124.number(),
  part: z124.union([
    ResponseOutputText$inboundSchema,
    ReasoningTextContent$inboundSchema.and(z124.object({ type: z124.literal("reasoning_text") })),
    OpenAIResponsesRefusalContent$inboundSchema
  ]),
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});
var Part1$inboundSchema = z124.union([
  ResponseOutputText$inboundSchema,
  ReasoningTextContent$inboundSchema.and(z124.object({ type: z124.literal("reasoning_text") })),
  OpenAIResponsesRefusalContent$inboundSchema
]);
var OpenResponsesStreamEventResponseContentPartAdded$inboundSchema = z124.object({
  type: z124.literal("response.content_part.added"),
  output_index: z124.number(),
  item_id: z124.string(),
  content_index: z124.number(),
  part: z124.union([
    ResponseOutputText$inboundSchema,
    ReasoningTextContent$inboundSchema.and(z124.object({ type: z124.literal("reasoning_text") })),
    OpenAIResponsesRefusalContent$inboundSchema
  ]),
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseOutputItemDone$inboundSchema = z124.object({
  type: z124.literal("response.output_item.done"),
  output_index: z124.number(),
  item: ResponsesOutputItem$inboundSchema,
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseOutputItemAdded$inboundSchema = z124.object({
  type: z124.literal("response.output_item.added"),
  output_index: z124.number(),
  item: ResponsesOutputItem$inboundSchema,
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseFailed$inboundSchema = z124.object({
  type: z124.literal("response.failed"),
  response: OpenResponsesNonStreamingResponse$inboundSchema,
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseIncomplete$inboundSchema = z124.object({
  type: z124.literal("response.incomplete"),
  response: OpenResponsesNonStreamingResponse$inboundSchema,
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseCompleted$inboundSchema = z124.object({
  type: z124.literal("response.completed"),
  response: OpenResponsesNonStreamingResponse$inboundSchema,
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseInProgress$inboundSchema = z124.object({
  type: z124.literal("response.in_progress"),
  response: OpenResponsesNonStreamingResponse$inboundSchema,
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEventResponseCreated$inboundSchema = z124.object({
  type: z124.literal("response.created"),
  response: OpenResponsesNonStreamingResponse$inboundSchema,
  sequence_number: z124.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var OpenResponsesStreamEvent$inboundSchema = z124.union([
  z124.lazy(() => OpenResponsesStreamEventResponseCreated$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseInProgress$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseCompleted$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseIncomplete$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseFailed$inboundSchema),
  OpenResponsesErrorEvent$inboundSchema,
  z124.lazy(() => OpenResponsesStreamEventResponseOutputItemAdded$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseOutputItemDone$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseContentPartAdded$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseContentPartDone$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseOutputTextDelta$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseOutputTextDone$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseRefusalDelta$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseRefusalDone$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseOutputTextAnnotationAdded$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseFunctionCallArgumentsDelta$inboundSchema),
  z124.lazy(() => OpenResponsesStreamEventResponseFunctionCallArgumentsDone$inboundSchema),
  OpenResponsesReasoningDeltaEvent$inboundSchema,
  OpenResponsesReasoningDoneEvent$inboundSchema,
  OpenResponsesReasoningSummaryPartAddedEvent$inboundSchema,
  z124.lazy(() => OpenResponsesStreamEventResponseReasoningSummaryPartDone$inboundSchema),
  OpenResponsesReasoningSummaryTextDeltaEvent$inboundSchema,
  OpenResponsesReasoningSummaryTextDoneEvent$inboundSchema,
  OpenResponsesImageGenCallInProgress$inboundSchema,
  OpenResponsesImageGenCallGenerating$inboundSchema,
  OpenResponsesImageGenCallPartialImage$inboundSchema,
  OpenResponsesImageGenCallCompleted$inboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/payloadtoolargeresponseerrordata.js
var z125 = __toESM(require("zod/v4"), 1);
var PayloadTooLargeResponseErrorData$inboundSchema = z125.object({
  code: z125.int(),
  message: z125.string(),
  metadata: z125.nullable(z125.record(z125.string(), z125.nullable(z125.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/paymentrequiredresponseerrordata.js
var z126 = __toESM(require("zod/v4"), 1);
var PaymentRequiredResponseErrorData$inboundSchema = z126.object({
  code: z126.int(),
  message: z126.string(),
  metadata: z126.nullable(z126.record(z126.string(), z126.nullable(z126.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/provideroverloadedresponseerrordata.js
var z127 = __toESM(require("zod/v4"), 1);
var ProviderOverloadedResponseErrorData$inboundSchema = z127.object({
  code: z127.int(),
  message: z127.string(),
  metadata: z127.nullable(z127.record(z127.string(), z127.nullable(z127.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/providerpreferences.js
var z128 = __toESM(require("zod/v4"), 1);
var SortEnum = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency"
};
var ProviderSortConfigEnum = {
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
var ProviderPreferencesOrder$outboundSchema = z128.union([ProviderName$outboundSchema, z128.string()]);
var ProviderPreferencesOnly$outboundSchema = z128.union([ProviderName$outboundSchema, z128.string()]);
var ProviderPreferencesIgnore$outboundSchema = z128.union([ProviderName$outboundSchema, z128.string()]);
var SortEnum$outboundSchema = outboundSchema(SortEnum);
var ProviderSortConfigEnum$outboundSchema = z128.enum(ProviderSortConfigEnum);
var ProviderPreferencesPartition$outboundSchema = outboundSchema(ProviderPreferencesPartition);
var ProviderPreferencesProviderSortConfig$outboundSchema = z128.object({
  by: z128.nullable(ProviderSort$outboundSchema).optional(),
  partition: z128.nullable(ProviderPreferencesPartition$outboundSchema).optional()
});
var ProviderSortConfigUnion$outboundSchema = z128.union([
  z128.lazy(() => ProviderPreferencesProviderSortConfig$outboundSchema),
  ProviderSortConfigEnum$outboundSchema
]);
var ProviderPreferencesProviderSort$outboundSchema = outboundSchema(ProviderPreferencesProviderSort);
var ProviderPreferencesSortUnion$outboundSchema = z128.union([
  ProviderPreferencesProviderSort$outboundSchema,
  z128.union([
    z128.lazy(() => ProviderPreferencesProviderSortConfig$outboundSchema),
    ProviderSortConfigEnum$outboundSchema
  ]),
  SortEnum$outboundSchema
]);
var ProviderPreferencesMaxPrice$outboundSchema = z128.object({
  prompt: z128.string().optional(),
  completion: z128.string().optional(),
  image: z128.string().optional(),
  audio: z128.string().optional(),
  request: z128.string().optional()
});
var ProviderPreferences$outboundSchema = z128.object({
  allowFallbacks: z128.nullable(z128.boolean()).optional(),
  requireParameters: z128.nullable(z128.boolean()).optional(),
  dataCollection: z128.nullable(DataCollection$outboundSchema).optional(),
  zdr: z128.nullable(z128.boolean()).optional(),
  enforceDistillableText: z128.nullable(z128.boolean()).optional(),
  order: z128.nullable(z128.array(z128.union([ProviderName$outboundSchema, z128.string()]))).optional(),
  only: z128.nullable(z128.array(z128.union([ProviderName$outboundSchema, z128.string()]))).optional(),
  ignore: z128.nullable(z128.array(z128.union([ProviderName$outboundSchema, z128.string()]))).optional(),
  quantizations: z128.nullable(z128.array(Quantization$outboundSchema)).optional(),
  sort: z128.nullable(z128.union([
    ProviderPreferencesProviderSort$outboundSchema,
    z128.union([
      z128.lazy(() => ProviderPreferencesProviderSortConfig$outboundSchema),
      ProviderSortConfigEnum$outboundSchema
    ]),
    SortEnum$outboundSchema
  ])).optional(),
  maxPrice: z128.lazy(() => ProviderPreferencesMaxPrice$outboundSchema).optional(),
  preferredMinThroughput: z128.nullable(z128.number()).optional(),
  preferredMaxLatency: z128.nullable(z128.number()).optional(),
  minThroughput: z128.nullable(z128.number()).optional(),
  maxLatency: z128.nullable(z128.number()).optional()
}).transform((v) => {
  return remap(v, {
    allowFallbacks: "allow_fallbacks",
    requireParameters: "require_parameters",
    dataCollection: "data_collection",
    enforceDistillableText: "enforce_distillable_text",
    maxPrice: "max_price",
    preferredMinThroughput: "preferred_min_throughput",
    preferredMaxLatency: "preferred_max_latency",
    minThroughput: "min_throughput",
    maxLatency: "max_latency"
  });
});

// node_modules/@openrouter/sdk/esm/models/requesttimeoutresponseerrordata.js
var z129 = __toESM(require("zod/v4"), 1);
var RequestTimeoutResponseErrorData$inboundSchema = z129.object({
  code: z129.int(),
  message: z129.string(),
  metadata: z129.nullable(z129.record(z129.string(), z129.nullable(z129.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/serviceunavailableresponseerrordata.js
var z130 = __toESM(require("zod/v4"), 1);
var ServiceUnavailableResponseErrorData$inboundSchema = z130.object({
  code: z130.int(),
  message: z130.string(),
  metadata: z130.nullable(z130.record(z130.string(), z130.nullable(z130.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/toomanyrequestsresponseerrordata.js
var z131 = __toESM(require("zod/v4"), 1);
var TooManyRequestsResponseErrorData$inboundSchema = z131.object({
  code: z131.int(),
  message: z131.string(),
  metadata: z131.nullable(z131.record(z131.string(), z131.nullable(z131.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/unauthorizedresponseerrordata.js
var z132 = __toESM(require("zod/v4"), 1);
var UnauthorizedResponseErrorData$inboundSchema = z132.object({
  code: z132.int(),
  message: z132.string(),
  metadata: z132.nullable(z132.record(z132.string(), z132.nullable(z132.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/unprocessableentityresponseerrordata.js
var z133 = __toESM(require("zod/v4"), 1);
var UnprocessableEntityResponseErrorData$inboundSchema = z133.object({
  code: z133.int(),
  message: z133.string(),
  metadata: z133.nullable(z133.record(z133.string(), z133.nullable(z133.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/errors/badgatewayresponseerror.js
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
var BadGatewayResponseError$inboundSchema = z134.object({
  error: BadGatewayResponseErrorData$inboundSchema,
  user_id: z134.nullable(z134.string()).optional(),
  request$: z134.custom((x) => x instanceof Request),
  response$: z134.custom((x) => x instanceof Response),
  body$: z134.string()
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
var z135 = __toESM(require("zod/v4"), 1);
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
var BadRequestResponseError$inboundSchema = z135.object({
  error: BadRequestResponseErrorData$inboundSchema,
  user_id: z135.nullable(z135.string()).optional(),
  request$: z135.custom((x) => x instanceof Request),
  response$: z135.custom((x) => x instanceof Response),
  body$: z135.string()
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

// node_modules/@openrouter/sdk/esm/models/errors/chaterror.js
var z136 = __toESM(require("zod/v4"), 1);
var ChatError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    this.name = "ChatError";
  }
};
var ChatError$inboundSchema = z136.object({
  error: z136.lazy(() => ChatErrorError$inboundSchema),
  request$: z136.custom((x) => x instanceof Request),
  response$: z136.custom((x) => x instanceof Response),
  body$: z136.string()
}).transform((v) => {
  return new ChatError(v, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/edgenetworktimeoutresponseerror.js
var z137 = __toESM(require("zod/v4"), 1);
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
var EdgeNetworkTimeoutResponseError$inboundSchema = z137.object({
  error: EdgeNetworkTimeoutResponseErrorData$inboundSchema,
  user_id: z137.nullable(z137.string()).optional(),
  request$: z137.custom((x) => x instanceof Request),
  response$: z137.custom((x) => x instanceof Response),
  body$: z137.string()
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
var z138 = __toESM(require("zod/v4"), 1);
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
var ForbiddenResponseError$inboundSchema = z138.object({
  error: ForbiddenResponseErrorData$inboundSchema,
  user_id: z138.nullable(z138.string()).optional(),
  request$: z138.custom((x) => x instanceof Request),
  response$: z138.custom((x) => x instanceof Response),
  body$: z138.string()
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
var z139 = __toESM(require("zod/v4"), 1);
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
var InternalServerResponseError$inboundSchema = z139.object({
  error: InternalServerResponseErrorData$inboundSchema,
  user_id: z139.nullable(z139.string()).optional(),
  request$: z139.custom((x) => x instanceof Request),
  response$: z139.custom((x) => x instanceof Response),
  body$: z139.string()
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
var z140 = __toESM(require("zod/v4"), 1);
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
var NotFoundResponseError$inboundSchema = z140.object({
  error: NotFoundResponseErrorData$inboundSchema,
  user_id: z140.nullable(z140.string()).optional(),
  request$: z140.custom((x) => x instanceof Request),
  response$: z140.custom((x) => x instanceof Response),
  body$: z140.string()
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
var z141 = __toESM(require("zod/v4"), 1);
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
var PayloadTooLargeResponseError$inboundSchema = z141.object({
  error: PayloadTooLargeResponseErrorData$inboundSchema,
  user_id: z141.nullable(z141.string()).optional(),
  request$: z141.custom((x) => x instanceof Request),
  response$: z141.custom((x) => x instanceof Response),
  body$: z141.string()
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
var z142 = __toESM(require("zod/v4"), 1);
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
var PaymentRequiredResponseError$inboundSchema = z142.object({
  error: PaymentRequiredResponseErrorData$inboundSchema,
  user_id: z142.nullable(z142.string()).optional(),
  request$: z142.custom((x) => x instanceof Request),
  response$: z142.custom((x) => x instanceof Response),
  body$: z142.string()
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
var z143 = __toESM(require("zod/v4"), 1);
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
var ProviderOverloadedResponseError$inboundSchema = z143.object({
  error: ProviderOverloadedResponseErrorData$inboundSchema,
  user_id: z143.nullable(z143.string()).optional(),
  request$: z143.custom((x) => x instanceof Request),
  response$: z143.custom((x) => x instanceof Response),
  body$: z143.string()
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
var z144 = __toESM(require("zod/v4"), 1);
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
var RequestTimeoutResponseError$inboundSchema = z144.object({
  error: RequestTimeoutResponseErrorData$inboundSchema,
  user_id: z144.nullable(z144.string()).optional(),
  request$: z144.custom((x) => x instanceof Request),
  response$: z144.custom((x) => x instanceof Response),
  body$: z144.string()
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
var z145 = __toESM(require("zod/v4"), 1);
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
var ServiceUnavailableResponseError$inboundSchema = z145.object({
  error: ServiceUnavailableResponseErrorData$inboundSchema,
  user_id: z145.nullable(z145.string()).optional(),
  request$: z145.custom((x) => x instanceof Request),
  response$: z145.custom((x) => x instanceof Response),
  body$: z145.string()
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
var z146 = __toESM(require("zod/v4"), 1);
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
var TooManyRequestsResponseError$inboundSchema = z146.object({
  error: TooManyRequestsResponseErrorData$inboundSchema,
  user_id: z146.nullable(z146.string()).optional(),
  request$: z146.custom((x) => x instanceof Request),
  response$: z146.custom((x) => x instanceof Response),
  body$: z146.string()
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
var z147 = __toESM(require("zod/v4"), 1);
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
var UnauthorizedResponseError$inboundSchema = z147.object({
  error: UnauthorizedResponseErrorData$inboundSchema,
  user_id: z147.nullable(z147.string()).optional(),
  request$: z147.custom((x) => x instanceof Request),
  response$: z147.custom((x) => x instanceof Response),
  body$: z147.string()
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
var z148 = __toESM(require("zod/v4"), 1);
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
var UnprocessableEntityResponseError$inboundSchema = z148.object({
  error: UnprocessableEntityResponseErrorData$inboundSchema,
  user_id: z148.nullable(z148.string()).optional(),
  request$: z148.custom((x) => x instanceof Request),
  response$: z148.custom((x) => x instanceof Response),
  body$: z148.string()
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

// node_modules/@openrouter/sdk/esm/models/operations/createauthkeyscode.js
var z149 = __toESM(require("zod/v4"), 1);
var CreateAuthKeysCodeCodeChallengeMethod = {
  S256: "S256",
  Plain: "plain"
};
var CreateAuthKeysCodeCodeChallengeMethod$outboundSchema = outboundSchema(CreateAuthKeysCodeCodeChallengeMethod);
var CreateAuthKeysCodeRequest$outboundSchema = z149.object({
  callbackUrl: z149.string(),
  codeChallenge: z149.string().optional(),
  codeChallengeMethod: CreateAuthKeysCodeCodeChallengeMethod$outboundSchema.optional(),
  limit: z149.number().optional(),
  expiresAt: z149.nullable(z149.date().transform((v) => v.toISOString())).optional()
}).transform((v) => {
  return remap(v, {
    callbackUrl: "callback_url",
    codeChallenge: "code_challenge",
    codeChallengeMethod: "code_challenge_method",
    expiresAt: "expires_at"
  });
});
var CreateAuthKeysCodeData$inboundSchema = z149.object({
  id: z149.string(),
  app_id: z149.number(),
  created_at: z149.string()
}).transform((v) => {
  return remap(v, {
    "app_id": "appId",
    "created_at": "createdAt"
  });
});
var CreateAuthKeysCodeResponse$inboundSchema = z149.object({
  data: z149.lazy(() => CreateAuthKeysCodeData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/createcoinbasecharge.js
var z150 = __toESM(require("zod/v4"), 1);
var CreateCoinbaseChargeSecurity$outboundSchema = z150.object({
  bearer: z150.string()
});
var CallData$inboundSchema = z150.object({
  deadline: z150.string(),
  fee_amount: z150.string(),
  id: z150.string(),
  operator: z150.string(),
  prefix: z150.string(),
  recipient: z150.string(),
  recipient_amount: z150.string(),
  recipient_currency: z150.string(),
  refund_destination: z150.string(),
  signature: z150.string()
}).transform((v) => {
  return remap(v, {
    "fee_amount": "feeAmount",
    "recipient_amount": "recipientAmount",
    "recipient_currency": "recipientCurrency",
    "refund_destination": "refundDestination"
  });
});
var Metadata$inboundSchema = z150.object({
  chain_id: z150.number(),
  contract_address: z150.string(),
  sender: z150.string()
}).transform((v) => {
  return remap(v, {
    "chain_id": "chainId",
    "contract_address": "contractAddress"
  });
});
var TransferIntent$inboundSchema = z150.object({
  call_data: z150.lazy(() => CallData$inboundSchema),
  metadata: z150.lazy(() => Metadata$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "call_data": "callData"
  });
});
var Web3Data$inboundSchema = z150.object({
  transfer_intent: z150.lazy(() => TransferIntent$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "transfer_intent": "transferIntent"
  });
});
var CreateCoinbaseChargeData$inboundSchema = z150.object({
  id: z150.string(),
  created_at: z150.string(),
  expires_at: z150.string(),
  web3_data: z150.lazy(() => Web3Data$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "created_at": "createdAt",
    "expires_at": "expiresAt",
    "web3_data": "web3Data"
  });
});
var CreateCoinbaseChargeResponse$inboundSchema = z150.object({
  data: z150.lazy(() => CreateCoinbaseChargeData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/createembeddings.js
var z151 = __toESM(require("zod/v4"), 1);
var EncodingFormat = {
  Float: "float",
  Base64: "base64"
};
var ObjectT2 = {
  List: "list"
};
var ObjectEmbedding = {
  Embedding: "embedding"
};
var ImageUrl$outboundSchema2 = z151.object({
  url: z151.string()
});
var ContentImageURL$outboundSchema = z151.object({
  type: z151.literal("image_url"),
  imageUrl: z151.lazy(() => ImageUrl$outboundSchema2)
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});
var ContentText$outboundSchema = z151.object({
  type: z151.literal("text"),
  text: z151.string()
});
var Content$outboundSchema = z151.union([
  z151.lazy(() => ContentText$outboundSchema),
  z151.lazy(() => ContentImageURL$outboundSchema)
]);
var Input$outboundSchema = z151.object({
  content: z151.array(z151.union([
    z151.lazy(() => ContentText$outboundSchema),
    z151.lazy(() => ContentImageURL$outboundSchema)
  ]))
});
var InputUnion$outboundSchema = z151.union([
  z151.string(),
  z151.array(z151.string()),
  z151.array(z151.number()),
  z151.array(z151.array(z151.number())),
  z151.array(z151.lazy(() => Input$outboundSchema))
]);
var EncodingFormat$outboundSchema = outboundSchema(EncodingFormat);
var CreateEmbeddingsRequest$outboundSchema = z151.object({
  input: z151.union([
    z151.string(),
    z151.array(z151.string()),
    z151.array(z151.number()),
    z151.array(z151.array(z151.number())),
    z151.array(z151.lazy(() => Input$outboundSchema))
  ]),
  model: z151.string(),
  encodingFormat: EncodingFormat$outboundSchema.optional(),
  dimensions: z151.int().optional(),
  user: z151.string().optional(),
  provider: ProviderPreferences$outboundSchema.optional(),
  inputType: z151.string().optional()
}).transform((v) => {
  return remap(v, {
    encodingFormat: "encoding_format",
    inputType: "input_type"
  });
});
var ObjectT$inboundSchema2 = z151.enum(ObjectT2);
var ObjectEmbedding$inboundSchema = z151.enum(ObjectEmbedding);
var Embedding$inboundSchema = z151.union([
  z151.array(z151.number()),
  z151.string()
]);
var CreateEmbeddingsData$inboundSchema = z151.object({
  object: ObjectEmbedding$inboundSchema,
  embedding: z151.union([z151.array(z151.number()), z151.string()]),
  index: z151.number().optional()
});
var Usage$inboundSchema = z151.object({
  prompt_tokens: z151.number(),
  total_tokens: z151.number(),
  cost: z151.number().optional()
}).transform((v) => {
  return remap(v, {
    "prompt_tokens": "promptTokens",
    "total_tokens": "totalTokens"
  });
});
var CreateEmbeddingsResponseBody$inboundSchema = z151.object({
  id: z151.string().optional(),
  object: ObjectT$inboundSchema2,
  data: z151.array(z151.lazy(() => CreateEmbeddingsData$inboundSchema)),
  model: z151.string(),
  usage: z151.lazy(() => Usage$inboundSchema).optional()
});
var CreateEmbeddingsResponse$inboundSchema = z151.union([
  z151.lazy(() => CreateEmbeddingsResponseBody$inboundSchema),
  z151.string()
]);

// node_modules/@openrouter/sdk/esm/models/operations/createkeys.js
var z152 = __toESM(require("zod/v4"), 1);
var CreateKeysLimitReset = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var CreateKeysLimitReset$outboundSchema = outboundSchema(CreateKeysLimitReset);
var CreateKeysRequest$outboundSchema = z152.object({
  name: z152.string(),
  limit: z152.nullable(z152.number()).optional(),
  limitReset: z152.nullable(CreateKeysLimitReset$outboundSchema).optional(),
  includeByokInLimit: z152.boolean().optional(),
  expiresAt: z152.nullable(z152.date().transform((v) => v.toISOString())).optional()
}).transform((v) => {
  return remap(v, {
    limitReset: "limit_reset",
    includeByokInLimit: "include_byok_in_limit",
    expiresAt: "expires_at"
  });
});
var CreateKeysData$inboundSchema = z152.object({
  hash: z152.string(),
  name: z152.string(),
  label: z152.string(),
  disabled: z152.boolean(),
  limit: z152.nullable(z152.number()),
  limit_remaining: z152.nullable(z152.number()),
  limit_reset: z152.nullable(z152.string()),
  include_byok_in_limit: z152.boolean(),
  usage: z152.number(),
  usage_daily: z152.number(),
  usage_weekly: z152.number(),
  usage_monthly: z152.number(),
  byok_usage: z152.number(),
  byok_usage_daily: z152.number(),
  byok_usage_weekly: z152.number(),
  byok_usage_monthly: z152.number(),
  created_at: z152.string(),
  updated_at: z152.nullable(z152.string()),
  expires_at: z152.nullable(z152.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional()
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
var CreateKeysResponse$inboundSchema = z152.object({
  data: z152.lazy(() => CreateKeysData$inboundSchema),
  key: z152.string()
});

// node_modules/@openrouter/sdk/esm/models/operations/createresponses.js
var z153 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/lib/event-streams.js
var EventStream = class extends ReadableStream {
  constructor(responseBody, parse) {
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
            const item = parseMessage(message, parse);
            if (item?.value)
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
function parseMessage(chunk, parse) {
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
  return parse(ret);
}

// node_modules/@openrouter/sdk/esm/models/operations/createresponses.js
var CreateResponsesResponseBody$inboundSchema = z153.object({
  data: z153.string().transform((v, ctx) => {
    try {
      return JSON.parse(v);
    } catch (err) {
      ctx.addIssue({
        input: v,
        code: "custom",
        message: `malformed json: ${err}`
      });
      return z153.NEVER;
    }
  }).pipe(OpenResponsesStreamEvent$inboundSchema)
});
var CreateResponsesResponse$inboundSchema = z153.union([
  OpenResponsesNonStreamingResponse$inboundSchema,
  z153.custom((x) => x instanceof ReadableStream).transform((stream) => {
    return new EventStream(stream, (rawEvent) => {
      if (rawEvent.data === "[DONE]")
        return { done: true };
      return {
        value: z153.lazy(() => CreateResponsesResponseBody$inboundSchema).parse(rawEvent)?.data
      };
    });
  })
]);

// node_modules/@openrouter/sdk/esm/models/operations/deletekeys.js
var z154 = __toESM(require("zod/v4"), 1);
var DeleteKeysRequest$outboundSchema = z154.object({
  hash: z154.string()
});
var DeleteKeysResponse$inboundSchema = z154.object({
  deleted: z154.literal(true)
});

// node_modules/@openrouter/sdk/esm/models/operations/exchangeauthcodeforapikey.js
var z155 = __toESM(require("zod/v4"), 1);
var ExchangeAuthCodeForAPIKeyCodeChallengeMethod = {
  S256: "S256",
  Plain: "plain"
};
var ExchangeAuthCodeForAPIKeyCodeChallengeMethod$outboundSchema = outboundSchema(ExchangeAuthCodeForAPIKeyCodeChallengeMethod);
var ExchangeAuthCodeForAPIKeyRequest$outboundSchema = z155.object({
  code: z155.string(),
  codeVerifier: z155.string().optional(),
  codeChallengeMethod: z155.nullable(ExchangeAuthCodeForAPIKeyCodeChallengeMethod$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    codeVerifier: "code_verifier",
    codeChallengeMethod: "code_challenge_method"
  });
});
var ExchangeAuthCodeForAPIKeyResponse$inboundSchema = z155.object({
  key: z155.string(),
  user_id: z155.nullable(z155.string())
}).transform((v) => {
  return remap(v, {
    "user_id": "userId"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/getcredits.js
var z156 = __toESM(require("zod/v4"), 1);
var GetCreditsData$inboundSchema = z156.object({
  total_credits: z156.number(),
  total_usage: z156.number()
}).transform((v) => {
  return remap(v, {
    "total_credits": "totalCredits",
    "total_usage": "totalUsage"
  });
});
var GetCreditsResponse$inboundSchema = z156.object({
  data: z156.lazy(() => GetCreditsData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getcurrentkey.js
var z157 = __toESM(require("zod/v4"), 1);
var RateLimit$inboundSchema = z157.object({
  requests: z157.number(),
  interval: z157.string(),
  note: z157.string()
});
var GetCurrentKeyData$inboundSchema = z157.object({
  label: z157.string(),
  limit: z157.nullable(z157.number()),
  usage: z157.number(),
  usage_daily: z157.number(),
  usage_weekly: z157.number(),
  usage_monthly: z157.number(),
  byok_usage: z157.number(),
  byok_usage_daily: z157.number(),
  byok_usage_weekly: z157.number(),
  byok_usage_monthly: z157.number(),
  is_free_tier: z157.boolean(),
  is_provisioning_key: z157.boolean(),
  limit_remaining: z157.nullable(z157.number()),
  limit_reset: z157.nullable(z157.string()),
  include_byok_in_limit: z157.boolean(),
  expires_at: z157.nullable(z157.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional(),
  rate_limit: z157.lazy(() => RateLimit$inboundSchema)
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
    "is_provisioning_key": "isProvisioningKey",
    "limit_remaining": "limitRemaining",
    "limit_reset": "limitReset",
    "include_byok_in_limit": "includeByokInLimit",
    "expires_at": "expiresAt",
    "rate_limit": "rateLimit"
  });
});
var GetCurrentKeyResponse$inboundSchema = z157.object({
  data: z157.lazy(() => GetCurrentKeyData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getgeneration.js
var z158 = __toESM(require("zod/v4"), 1);
var ApiType = {
  Completions: "completions",
  Embeddings: "embeddings"
};
var GetGenerationRequest$outboundSchema = z158.object({
  id: z158.string()
});
var ApiType$inboundSchema = inboundSchema(ApiType);
var GetGenerationData$inboundSchema = z158.object({
  id: z158.string(),
  upstream_id: z158.nullable(z158.string()),
  total_cost: z158.number(),
  cache_discount: z158.nullable(z158.number()),
  upstream_inference_cost: z158.nullable(z158.number()),
  created_at: z158.string(),
  model: z158.string(),
  app_id: z158.nullable(z158.number()),
  streamed: z158.nullable(z158.boolean()),
  cancelled: z158.nullable(z158.boolean()),
  provider_name: z158.nullable(z158.string()),
  latency: z158.nullable(z158.number()),
  moderation_latency: z158.nullable(z158.number()),
  generation_time: z158.nullable(z158.number()),
  finish_reason: z158.nullable(z158.string()),
  tokens_prompt: z158.nullable(z158.number()),
  tokens_completion: z158.nullable(z158.number()),
  native_tokens_prompt: z158.nullable(z158.number()),
  native_tokens_completion: z158.nullable(z158.number()),
  native_tokens_completion_images: z158.nullable(z158.number()),
  native_tokens_reasoning: z158.nullable(z158.number()),
  native_tokens_cached: z158.nullable(z158.number()),
  num_media_prompt: z158.nullable(z158.number()),
  num_input_audio_prompt: z158.nullable(z158.number()),
  num_media_completion: z158.nullable(z158.number()),
  num_search_results: z158.nullable(z158.number()),
  origin: z158.string(),
  usage: z158.number(),
  is_byok: z158.boolean(),
  native_finish_reason: z158.nullable(z158.string()),
  external_user: z158.nullable(z158.string()),
  api_type: z158.nullable(ApiType$inboundSchema)
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
    "api_type": "apiType"
  });
});
var GetGenerationResponse$inboundSchema = z158.object({
  data: z158.lazy(() => GetGenerationData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getkey.js
var z159 = __toESM(require("zod/v4"), 1);
var GetKeyRequest$outboundSchema = z159.object({
  hash: z159.string()
});
var GetKeyData$inboundSchema = z159.object({
  hash: z159.string(),
  name: z159.string(),
  label: z159.string(),
  disabled: z159.boolean(),
  limit: z159.nullable(z159.number()),
  limit_remaining: z159.nullable(z159.number()),
  limit_reset: z159.nullable(z159.string()),
  include_byok_in_limit: z159.boolean(),
  usage: z159.number(),
  usage_daily: z159.number(),
  usage_weekly: z159.number(),
  usage_monthly: z159.number(),
  byok_usage: z159.number(),
  byok_usage_daily: z159.number(),
  byok_usage_weekly: z159.number(),
  byok_usage_monthly: z159.number(),
  created_at: z159.string(),
  updated_at: z159.nullable(z159.string()),
  expires_at: z159.nullable(z159.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional()
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
var GetKeyResponse$inboundSchema = z159.object({
  data: z159.lazy(() => GetKeyData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getmodels.js
var z160 = __toESM(require("zod/v4"), 1);
var GetModelsRequest$outboundSchema = z160.object({
  category: z160.string().optional(),
  supportedParameters: z160.string().optional()
}).transform((v) => {
  return remap(v, {
    supportedParameters: "supported_parameters"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/getparameters.js
var z161 = __toESM(require("zod/v4"), 1);
var SupportedParameter = {
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
var GetParametersSecurity$outboundSchema = z161.object({
  bearer: z161.string()
});
var GetParametersRequest$outboundSchema = z161.object({
  author: z161.string(),
  slug: z161.string(),
  provider: ProviderName$outboundSchema.optional()
});
var SupportedParameter$inboundSchema = inboundSchema(SupportedParameter);
var GetParametersData$inboundSchema = z161.object({
  model: z161.string(),
  supported_parameters: z161.array(SupportedParameter$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "supported_parameters": "supportedParameters"
  });
});
var GetParametersResponse$inboundSchema = z161.object({
  data: z161.lazy(() => GetParametersData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getuseractivity.js
var z162 = __toESM(require("zod/v4"), 1);
var GetUserActivityRequest$outboundSchema = z162.object({
  date: z162.string().optional()
});
var GetUserActivityResponse$inboundSchema = z162.object({
  data: z162.array(ActivityItem$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/list.js
var z163 = __toESM(require("zod/v4"), 1);
var ListRequest$outboundSchema = z163.object({
  includeDisabled: z163.string().optional(),
  offset: z163.string().optional()
}).transform((v) => {
  return remap(v, {
    includeDisabled: "include_disabled"
  });
});
var ListData$inboundSchema = z163.object({
  hash: z163.string(),
  name: z163.string(),
  label: z163.string(),
  disabled: z163.boolean(),
  limit: z163.nullable(z163.number()),
  limit_remaining: z163.nullable(z163.number()),
  limit_reset: z163.nullable(z163.string()),
  include_byok_in_limit: z163.boolean(),
  usage: z163.number(),
  usage_daily: z163.number(),
  usage_weekly: z163.number(),
  usage_monthly: z163.number(),
  byok_usage: z163.number(),
  byok_usage_daily: z163.number(),
  byok_usage_weekly: z163.number(),
  byok_usage_monthly: z163.number(),
  created_at: z163.string(),
  updated_at: z163.nullable(z163.string()),
  expires_at: z163.nullable(z163.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional()
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
var ListResponse$inboundSchema = z163.object({
  data: z163.array(z163.lazy(() => ListData$inboundSchema))
});

// node_modules/@openrouter/sdk/esm/models/operations/listendpoints.js
var z164 = __toESM(require("zod/v4"), 1);
var ListEndpointsRequest$outboundSchema = z164.object({
  author: z164.string(),
  slug: z164.string()
});
var ListEndpointsResponse$inboundSchema2 = z164.object({
  data: ListEndpointsResponse$inboundSchema
});

// node_modules/@openrouter/sdk/esm/models/operations/listendpointszdr.js
var z165 = __toESM(require("zod/v4"), 1);
var ListEndpointsZdrResponse$inboundSchema = z165.object({
  data: z165.array(PublicEndpoint$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/listproviders.js
var z166 = __toESM(require("zod/v4"), 1);
var ListProvidersData$inboundSchema = z166.object({
  name: z166.string(),
  slug: z166.string(),
  privacy_policy_url: z166.nullable(z166.string()),
  terms_of_service_url: z166.nullable(z166.string()).optional(),
  status_page_url: z166.nullable(z166.string()).optional()
}).transform((v) => {
  return remap(v, {
    "privacy_policy_url": "privacyPolicyUrl",
    "terms_of_service_url": "termsOfServiceUrl",
    "status_page_url": "statusPageUrl"
  });
});
var ListProvidersResponse$inboundSchema = z166.object({
  data: z166.array(z166.lazy(() => ListProvidersData$inboundSchema))
});

// node_modules/@openrouter/sdk/esm/models/operations/sendchatcompletionrequest.js
var z167 = __toESM(require("zod/v4"), 1);
var SendChatCompletionRequestResponse$inboundSchema = z167.union([
  ChatResponse$inboundSchema,
  z167.custom((x) => x instanceof ReadableStream).transform((stream) => {
    return new EventStream(stream, (rawEvent) => {
      if (rawEvent.data === "[DONE]")
        return { done: true };
      return {
        value: ChatStreamingResponseChunk$inboundSchema.parse(rawEvent)?.data
      };
    });
  })
]);

// node_modules/@openrouter/sdk/esm/models/operations/updatekeys.js
var z168 = __toESM(require("zod/v4"), 1);
var UpdateKeysLimitReset = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var UpdateKeysLimitReset$outboundSchema = outboundSchema(UpdateKeysLimitReset);
var UpdateKeysRequestBody$outboundSchema = z168.object({
  name: z168.string().optional(),
  disabled: z168.boolean().optional(),
  limit: z168.nullable(z168.number()).optional(),
  limitReset: z168.nullable(UpdateKeysLimitReset$outboundSchema).optional(),
  includeByokInLimit: z168.boolean().optional()
}).transform((v) => {
  return remap(v, {
    limitReset: "limit_reset",
    includeByokInLimit: "include_byok_in_limit"
  });
});
var UpdateKeysRequest$outboundSchema = z168.object({
  hash: z168.string(),
  requestBody: z168.lazy(() => UpdateKeysRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    requestBody: "RequestBody"
  });
});
var UpdateKeysData$inboundSchema = z168.object({
  hash: z168.string(),
  name: z168.string(),
  label: z168.string(),
  disabled: z168.boolean(),
  limit: z168.nullable(z168.number()),
  limit_remaining: z168.nullable(z168.number()),
  limit_reset: z168.nullable(z168.string()),
  include_byok_in_limit: z168.boolean(),
  usage: z168.number(),
  usage_daily: z168.number(),
  usage_weekly: z168.number(),
  usage_monthly: z168.number(),
  byok_usage: z168.number(),
  byok_usage_daily: z168.number(),
  byok_usage_weekly: z168.number(),
  byok_usage_monthly: z168.number(),
  created_at: z168.string(),
  updated_at: z168.nullable(z168.string()),
  expires_at: z168.nullable(z168.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional()
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
var UpdateKeysResponse$inboundSchema = z168.object({
  data: z168.lazy(() => UpdateKeysData$inboundSchema)
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
  const path = pathToFunc("/activity")();
  const query = encodeFormQuery({
    "date": payload?.date
  });
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
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
   * Returns user activity data grouped by endpoint for the last 30 (completed) UTC days
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
  const body = encodeJSON("body", payload, { explode: true });
  const path = pathToFunc("/keys")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json"
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
    path,
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
  const path = pathToFunc("/keys/{hash}")(pathParams);
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
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
  const path = pathToFunc("/keys/{hash}")(pathParams);
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
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
function apiKeysGetCurrentKeyMetadata(client, options) {
  return new APIPromise($do5(client, options));
}
async function $do5(client, options) {
  const path = pathToFunc("/key")();
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
    headers,
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
  const path = pathToFunc("/keys")();
  const query = encodeFormQuery({
    "include_disabled": payload?.include_disabled,
    "offset": payload?.offset
  });
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
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
  const path = pathToFunc("/keys/{hash}")(pathParams);
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json"
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
    path,
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
   */
  async list(request, options) {
    return unwrapAsync(apiKeysList(this, request, options));
  }
  /**
   * Create a new API key
   */
  async create(request, options) {
    return unwrapAsync(apiKeysCreate(this, request, options));
  }
  /**
   * Update an API key
   */
  async update(request, options) {
    return unwrapAsync(apiKeysUpdate(this, request, options));
  }
  /**
   * Delete an API key
   */
  async delete(request, options) {
    return unwrapAsync(apiKeysDelete(this, request, options));
  }
  /**
   * Get a single API key
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
  async getCurrentKeyMetadata(options) {
    return unwrapAsync(apiKeysGetCurrentKeyMetadata(this, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/betaResponsesSend.js
function betaResponsesSend(client, request, options) {
  return new APIPromise($do8(client, request, options));
}
async function $do8(client, request, options) {
  const parsed = safeParse(request, (value) => OpenResponsesRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload, { explode: true });
  const path = pathToFunc("/responses")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: request?.stream ? "text/event-stream" : "application/json"
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
    path,
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
  const parsed = safeParse(request, (value) => ChatGenerationParams$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload, { explode: true });
  const path = pathToFunc("/chat/completions")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: request?.stream ? "text/event-stream" : "application/json"
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
    path,
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
  const [result] = await match(json(200, SendChatCompletionRequestResponse$inboundSchema), sse(200, SendChatCompletionRequestResponse$inboundSchema), jsonErr([400, 401, 429], ChatError$inboundSchema), jsonErr(500, ChatError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
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

// node_modules/@openrouter/sdk/esm/funcs/completionsGenerate.js
function completionsGenerate(client, request, options) {
  return new APIPromise($do10(client, request, options));
}
async function $do10(client, request, options) {
  const parsed = safeParse(request, (value) => CompletionCreateParams$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload, { explode: true });
  const path = pathToFunc("/completions")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json"
  }));
  const secConfig = await extractSecurity(client._options.apiKey);
  const securityInput = secConfig == null ? {} : { apiKey: secConfig };
  const requestSecurity = resolveGlobalSecurity(securityInput);
  const context = {
    options: client._options,
    baseURL: options?.serverURL ?? client._baseURL ?? "",
    operationID: "createCompletions",
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
    path,
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
  const [result] = await match(json(200, CompletionResponse$inboundSchema), jsonErr([400, 401, 429], ChatError$inboundSchema), jsonErr(500, ChatError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/sdk/completions.js
var Completions = class extends ClientSDK {
  /**
   * Create a completion
   *
   * @remarks
   * Creates a completion for the provided prompt and parameters. Supports both streaming and non-streaming modes.
   */
  async generate(request, options) {
    return unwrapAsync(completionsGenerate(this, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/creditsCreateCoinbaseCharge.js
function creditsCreateCoinbaseCharge(client, security, request, options) {
  return new APIPromise($do11(client, security, request, options));
}
async function $do11(client, security, request, options) {
  const parsed = safeParse(request, (value) => CreateChargeRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload, { explode: true });
  const path = pathToFunc("/credits/coinbase")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json"
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
    path,
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
function creditsGetCredits(client, options) {
  return new APIPromise($do12(client, options));
}
async function $do12(client, options) {
  const path = pathToFunc("/credits")();
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
    headers,
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
   * Get total credits purchased and used for the authenticated user
   */
  async getCredits(options) {
    return unwrapAsync(creditsGetCredits(this, options));
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
  return new APIPromise($do13(client, request, options));
}
async function $do13(client, request, options) {
  const parsed = safeParse(request, (value) => CreateEmbeddingsRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload, { explode: true });
  const path = pathToFunc("/embeddings")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json;q=1, text/event-stream;q=0"
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
    path,
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
function embeddingsListModels(client, options) {
  return new APIPromise($do14(client, options));
}
async function $do14(client, options) {
  const path = pathToFunc("/embeddings/models")();
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
    headers,
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
  async listModels(options) {
    return unwrapAsync(embeddingsListModels(this, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/endpointsList.js
function endpointsList(client, request, options) {
  return new APIPromise($do15(client, request, options));
}
async function $do15(client, request, options) {
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
  const path = pathToFunc("/models/{author}/{slug}/endpoints")(pathParams);
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
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
function endpointsListZdrEndpoints(client, options) {
  return new APIPromise($do16(client, options));
}
async function $do16(client, options) {
  const path = pathToFunc("/endpoints/zdr")();
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
    headers,
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
  async listZdrEndpoints(options) {
    return unwrapAsync(endpointsListZdrEndpoints(this, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/generationsGetGeneration.js
function generationsGetGeneration(client, request, options) {
  return new APIPromise($do17(client, request, options));
}
async function $do17(client, request, options) {
  const parsed = safeParse(request, (value) => GetGenerationRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path = pathToFunc("/generation")();
  const query = encodeFormQuery({
    "id": payload.id
  });
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
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

// node_modules/@openrouter/sdk/esm/funcs/modelsCount.js
function modelsCount(client, options) {
  return new APIPromise($do18(client, options));
}
async function $do18(client, options) {
  const path = pathToFunc("/models/count")();
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
    headers,
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
  return new APIPromise($do19(client, request, options));
}
async function $do19(client, request, options) {
  const parsed = safeParse(request, (value) => GetModelsRequest$outboundSchema.optional().parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = null;
  const path = pathToFunc("/models")();
  const query = encodeFormQuery({
    "category": payload?.category,
    "supported_parameters": payload?.supported_parameters
  });
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
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
function modelsListForUser(client, security, options) {
  return new APIPromise($do20(client, security, options));
}
async function $do20(client, security, options) {
  const path = pathToFunc("/models/user")();
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
    headers,
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
  const [result] = await match(json(200, ModelsListResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
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
  async count(options) {
    return unwrapAsync(modelsCount(this, options));
  }
  /**
   * List all models and their properties
   */
  async list(request, options) {
    return unwrapAsync(modelsList(this, request, options));
  }
  /**
   * List models filtered by user provider preferences
   */
  async listForUser(security, options) {
    return unwrapAsync(modelsListForUser(this, security, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/oAuthCreateAuthCode.js
function oAuthCreateAuthCode(client, request, options) {
  return new APIPromise($do21(client, request, options));
}
async function $do21(client, request, options) {
  const parsed = safeParse(request, (value) => CreateAuthKeysCodeRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload, { explode: true });
  const path = pathToFunc("/auth/keys/code")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json"
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
    path,
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
  return new APIPromise($do22(client, request, options));
}
async function $do22(client, request, options) {
  const parsed = safeParse(request, (value) => ExchangeAuthCodeForAPIKeyRequest$outboundSchema.parse(value), "Input validation failed");
  if (!parsed.ok) {
    return [parsed, { status: "invalid" }];
  }
  const payload = parsed.value;
  const body = encodeJSON("body", payload, { explode: true });
  const path = pathToFunc("/auth/keys")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: "application/json"
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
    path,
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

// node_modules/@openrouter/sdk/esm/funcs/parametersGetParameters.js
function parametersGetParameters(client, security, request, options) {
  return new APIPromise($do23(client, security, request, options));
}
async function $do23(client, security, request, options) {
  const parsed = safeParse(request, (value) => GetParametersRequest$outboundSchema.parse(value), "Input validation failed");
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
  const path = pathToFunc("/parameters/{author}/{slug}")(pathParams);
  const query = encodeFormQuery({
    "provider": payload.provider
  });
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    operationID: "getParameters",
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
    path,
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
  const [result] = await match(json(200, GetParametersResponse$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(404, NotFoundResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
  if (!result.ok) {
    return [result, { status: "complete", request: req, response }];
  }
  return [result, { status: "complete", request: req, response }];
}

// node_modules/@openrouter/sdk/esm/sdk/parameters.js
var ParametersT = class extends ClientSDK {
  /**
   * Get a model's supported parameters and data about which are most popular
   */
  async getParameters(security, request, options) {
    return unwrapAsync(parametersGetParameters(this, security, request, options));
  }
};

// node_modules/@openrouter/sdk/esm/funcs/providersList.js
function providersList(client, options) {
  return new APIPromise($do24(client, options));
}
async function $do24(client, options) {
  const path = pathToFunc("/providers")();
  const headers = new Headers(compactMap({
    Accept: "application/json"
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
    path,
    headers,
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
  async list(options) {
    return unwrapAsync(providersList(this, options));
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
        });
        if (self.sourceComplete || self.sourceError || consumer.position < self.buffer.length) {
          if (consumer.waitingPromise) {
            consumer.waitingPromise.resolve();
            consumer.waitingPromise = null;
          }
        }
        await waitPromise;
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

// node_modules/@openrouter/sdk/esm/lib/stream-transformers.js
async function* extractTextDeltas(stream) {
  const consumer = stream.createConsumer();
  for await (const event of consumer) {
    if ("type" in event && event.type === "response.output_text.delta") {
      const deltaEvent = event;
      if (deltaEvent.delta) {
        yield deltaEvent.delta;
      }
    }
  }
}
async function* extractReasoningDeltas(stream) {
  const consumer = stream.createConsumer();
  for await (const event of consumer) {
    if ("type" in event && event.type === "response.reasoning_text.delta") {
      const deltaEvent = event;
      if (deltaEvent.delta) {
        yield deltaEvent.delta;
      }
    }
  }
}
async function* extractToolDeltas(stream) {
  const consumer = stream.createConsumer();
  for await (const event of consumer) {
    if ("type" in event && event.type === "response.function_call_arguments.delta") {
      const deltaEvent = event;
      if (deltaEvent.delta) {
        yield deltaEvent.delta;
      }
    }
  }
}
async function* buildMessageStream(stream) {
  const consumer = stream.createConsumer();
  let currentText = "";
  let hasStarted = false;
  for await (const event of consumer) {
    if (!("type" in event)) {
      continue;
    }
    switch (event.type) {
      case "response.output_item.added": {
        const itemEvent = event;
        if (itemEvent.item && "type" in itemEvent.item && itemEvent.item.type === "message") {
          hasStarted = true;
          currentText = "";
        }
        break;
      }
      case "response.output_text.delta": {
        const deltaEvent = event;
        if (hasStarted && deltaEvent.delta) {
          currentText += deltaEvent.delta;
          yield {
            role: "assistant",
            content: currentText
          };
        }
        break;
      }
      case "response.output_item.done": {
        const itemDoneEvent = event;
        if (itemDoneEvent.item && "type" in itemDoneEvent.item && itemDoneEvent.item.type === "message") {
          const outputMessage = itemDoneEvent.item;
          yield convertToAssistantMessage(outputMessage);
        }
        break;
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
    if (event.type === "response.completed") {
      const completedEvent = event;
      return completedEvent.response;
    }
    if (event.type === "response.failed") {
      const failedEvent = event;
      throw new Error(`Response failed: ${JSON.stringify(failedEvent.response.error)}`);
    }
    if (event.type === "response.incomplete") {
      const incompleteEvent = event;
      return incompleteEvent.response;
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
function extractTextFromResponse(response) {
  if (response.outputText) {
    return response.outputText;
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
    if ("type" in item && item.type === "function_call") {
      const functionCallItem = item;
      try {
        const parsedArguments = JSON.parse(functionCallItem.arguments);
        toolCalls.push({
          id: functionCallItem.callId,
          name: functionCallItem.name,
          arguments: parsedArguments
        });
      } catch (_error) {
        toolCalls.push({
          id: functionCallItem.callId,
          name: functionCallItem.name,
          arguments: functionCallItem.arguments
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
        const itemEvent = event;
        if (itemEvent.item && "type" in itemEvent.item && itemEvent.item.type === "function_call") {
          const functionCallItem = itemEvent.item;
          toolCallsInProgress.set(functionCallItem.callId, {
            id: functionCallItem.callId,
            name: functionCallItem.name,
            argumentsAccumulated: ""
          });
        }
        break;
      }
      case "response.function_call_arguments.delta": {
        const deltaEvent = event;
        const toolCall = toolCallsInProgress.get(deltaEvent.itemId);
        if (toolCall && deltaEvent.delta) {
          toolCall.argumentsAccumulated += deltaEvent.delta;
        }
        break;
      }
      case "response.function_call_arguments.done": {
        const doneEvent = event;
        const toolCall = toolCallsInProgress.get(doneEvent.itemId);
        if (toolCall) {
          try {
            const parsedArguments = JSON.parse(doneEvent.arguments);
            yield {
              id: toolCall.id,
              name: doneEvent.name,
              arguments: parsedArguments
            };
          } catch (_error) {
            yield {
              id: toolCall.id,
              name: doneEvent.name,
              arguments: doneEvent.arguments
            };
          }
          toolCallsInProgress.delete(doneEvent.itemId);
        }
        break;
      }
      case "response.output_item.done": {
        const itemDoneEvent = event;
        if (itemDoneEvent.item && "type" in itemDoneEvent.item && itemDoneEvent.item.type === "function_call") {
          const functionCallItem = itemDoneEvent.item;
          if (toolCallsInProgress.has(functionCallItem.callId)) {
            try {
              const parsedArguments = JSON.parse(functionCallItem.arguments);
              yield {
                id: functionCallItem.callId,
                name: functionCallItem.name,
                arguments: parsedArguments
              };
            } catch (_error) {
              yield {
                id: functionCallItem.callId,
                name: functionCallItem.name,
                arguments: functionCallItem.arguments
              };
            }
            toolCallsInProgress.delete(functionCallItem.callId);
          }
        }
        break;
      }
    }
  }
}

// node_modules/@openrouter/sdk/esm/lib/tool-executor.js
var import_v4 = require("zod/v4");

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

// node_modules/@openrouter/sdk/esm/lib/tool-executor.js
function convertZodToJsonSchema(zodSchema) {
  const jsonSchema = (0, import_v4.toJSONSchema)(zodSchema, {
    target: "openapi-3.0"
  });
  return jsonSchema;
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
  return schema.parse(args);
}
function validateToolOutput(schema, result) {
  return schema.parse(result);
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
    let lastEmittedValue = null;
    let hasEmittedValue = false;
    for await (const event of tool.function.execute(validatedInput, context)) {
      hasEmittedValue = true;
      const validatedEvent = validateToolOutput(tool.function.eventSchema, event);
      preliminaryResults.push(validatedEvent);
      lastEmittedValue = validatedEvent;
      if (onPreliminaryResult) {
        onPreliminaryResult(toolCall.id, validatedEvent);
      }
    }
    if (!hasEmittedValue) {
      throw new Error(`Generator tool "${toolCall.name}" completed without emitting any values`);
    }
    const finalResult = validateToolOutput(tool.function.outputSchema, lastEmittedValue);
    preliminaryResults.pop();
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

// node_modules/@openrouter/sdk/esm/lib/response-wrapper.js
var ResponseWrapper = class {
  constructor(options) {
    this.reusableStream = null;
    this.streamPromise = null;
    this.messagePromise = null;
    this.textPromise = null;
    this.initPromise = null;
    this.toolExecutionPromise = null;
    this.finalResponse = null;
    this.preliminaryResults = /* @__PURE__ */ new Map();
    this.allToolExecutionRounds = [];
    this.options = options;
  }
  /**
   * Type guard to check if a value is a non-streaming response
   */
  isNonStreamingResponse(value) {
    return value !== null && typeof value === "object" && "id" in value && "object" in value && "output" in value && !("toReadableStream" in value);
  }
  /**
   * Initialize the stream if not already started
   * This is idempotent - multiple calls will return the same promise
   */
  initStream() {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = (async () => {
      const request = {
        ...this.options.request,
        stream: true
      };
      this.streamPromise = betaResponsesSend(this.options.client, request, this.options.options).then((result) => {
        if (!result.ok) {
          throw result.error;
        }
        return result.value;
      });
      const eventStream = await this.streamPromise;
      this.reusableStream = new ReusableReadableStream(eventStream);
    })();
    return this.initPromise;
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
      if (!this.reusableStream) {
        throw new Error("Stream not initialized");
      }
      const initialResponse = await consumeStreamForCompletion(this.reusableStream);
      const shouldAutoExecute = this.options.tools && this.options.tools.length > 0 && initialResponse.output.some((item) => "type" in item && item.type === "function_call");
      if (!shouldAutoExecute) {
        this.finalResponse = initialResponse;
        return;
      }
      const toolCalls = extractToolCallsFromResponse(initialResponse);
      const executableTools = toolCalls.filter((toolCall) => {
        const tool = this.options.tools?.find((t) => t.function.name === toolCall.name);
        return tool && hasExecuteFunction(tool);
      });
      if (executableTools.length === 0) {
        this.finalResponse = initialResponse;
        return;
      }
      const maxToolRounds = this.options.maxToolRounds ?? 5;
      let currentResponse = initialResponse;
      let currentRound = 0;
      let currentInput = this.options.request.input || [];
      while (true) {
        const currentToolCalls = extractToolCallsFromResponse(currentResponse);
        if (currentToolCalls.length === 0) {
          break;
        }
        const hasExecutable = currentToolCalls.some((toolCall) => {
          const tool = this.options.tools?.find((t) => t.function.name === toolCall.name);
          return tool && hasExecuteFunction(tool);
        });
        if (!hasExecutable) {
          break;
        }
        if (typeof maxToolRounds === "number") {
          if (currentRound >= maxToolRounds) {
            break;
          }
        } else if (typeof maxToolRounds === "function") {
          const turnContext2 = {
            numberOfTurns: currentRound + 1,
            messageHistory: currentInput,
            ...this.options.request.model && {
              model: this.options.request.model
            },
            ...this.options.request.models && {
              models: this.options.request.models
            }
          };
          const shouldContinue = maxToolRounds(turnContext2);
          if (!shouldContinue) {
            break;
          }
        }
        this.allToolExecutionRounds.push({
          round: currentRound,
          toolCalls: currentToolCalls,
          response: currentResponse
        });
        const turnContext = {
          numberOfTurns: currentRound + 1,
          // 1-indexed
          messageHistory: currentInput,
          ...this.options.request.model && {
            model: this.options.request.model
          },
          ...this.options.request.models && {
            models: this.options.request.models
          }
        };
        const toolResults = [];
        for (const toolCall of currentToolCalls) {
          const tool = this.options.tools?.find((t) => t.function.name === toolCall.name);
          if (!tool || !hasExecuteFunction(tool)) {
            continue;
          }
          const result = await executeTool(tool, toolCall, turnContext);
          if (result.preliminaryResults && result.preliminaryResults.length > 0) {
            this.preliminaryResults.set(toolCall.id, result.preliminaryResults);
          }
          toolResults.push({
            type: "function_call_output",
            id: `output_${toolCall.id}`,
            callId: toolCall.id,
            output: result.error ? JSON.stringify({
              error: result.error.message
            }) : JSON.stringify(result.result)
          });
        }
        const newInput = [
          ...Array.isArray(currentResponse.output) ? currentResponse.output : [
            currentResponse.output
          ],
          ...toolResults
        ];
        currentInput = newInput;
        const newRequest = {
          ...this.options.request,
          input: newInput,
          stream: false
        };
        const newResult = await betaResponsesSend(this.options.client, newRequest, this.options.options);
        if (!newResult.ok) {
          throw newResult.error;
        }
        const value = newResult.value;
        if (value && typeof value === "object" && "toReadableStream" in value) {
          const stream = new ReusableReadableStream(value);
          currentResponse = await consumeStreamForCompletion(stream);
        } else if (this.isNonStreamingResponse(value)) {
          currentResponse = value;
        } else {
          throw new Error("Unexpected response type from API");
        }
        currentRound++;
      }
      if (!currentResponse || !currentResponse.id || !currentResponse.output) {
        throw new Error("Invalid final response: missing required fields");
      }
      if (!Array.isArray(currentResponse.output) || currentResponse.output.length === 0) {
        throw new Error("Invalid final response: empty or invalid output");
      }
      this.finalResponse = currentResponse;
    })();
    return this.toolExecutionPromise;
  }
  /**
   * Internal helper to get the message after tool execution
   */
  async getMessageInternal() {
    await this.executeToolsIfNeeded();
    if (!this.finalResponse) {
      throw new Error("Response not available");
    }
    return extractMessageFromResponse(this.finalResponse);
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
   * Get the completed message from the response.
   * This will consume the stream until completion, execute any tools, and extract the first message.
   * Returns an AssistantMessage in chat format.
   */
  getMessage() {
    if (this.messagePromise) {
      return this.messagePromise;
    }
    this.messagePromise = this.getMessageInternal();
    return this.messagePromise;
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
   * Includes preliminary tool result events after tool execution.
   */
  getFullResponsesStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream) {
        throw new Error("Stream not initialized");
      }
      const consumer = this.reusableStream.createConsumer();
      for await (const event of consumer) {
        yield event;
      }
      await this.executeToolsIfNeeded();
      for (const [toolCallId, results] of this.preliminaryResults) {
        for (const result of results) {
          yield {
            type: "tool.preliminary_result",
            toolCallId,
            result,
            timestamp: Date.now()
          };
        }
      }
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
   * Stream incremental message updates as content is added.
   * Each iteration yields an updated version of the message with new content.
   * Also yields ToolResponseMessages after tool execution completes.
   * Returns AssistantMessage or ToolResponseMessage in chat format.
   */
  getNewMessagesStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream) {
        throw new Error("Stream not initialized");
      }
      yield* buildMessageStream(this.reusableStream);
      await this.executeToolsIfNeeded();
      for (const round of this.allToolExecutionRounds) {
        for (const toolCall of round.toolCalls) {
          const tool = this.options.tools?.find((t) => t.function.name === toolCall.name);
          if (!tool || !hasExecuteFunction(tool)) {
            continue;
          }
          const prelimResults = this.preliminaryResults.get(toolCall.id);
          const result = prelimResults && prelimResults.length > 0 ? prelimResults[prelimResults.length - 1] : void 0;
          yield {
            role: "tool",
            content: result !== void 0 ? JSON.stringify(result) : "",
            toolCallId: toolCall.id
          };
        }
      }
      if (this.finalResponse && this.allToolExecutionRounds.length > 0) {
        const hasMessage = this.finalResponse.output.some((item) => "type" in item && item.type === "message");
        if (hasMessage) {
          yield extractMessageFromResponse(this.finalResponse);
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
   * This filters the full event stream to yield:
   * - Tool call argument deltas as { type: "delta", content: string }
   * - Preliminary results as { type: "preliminary_result", toolCallId, result }
   */
  getToolStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream) {
        throw new Error("Stream not initialized");
      }
      for await (const delta of extractToolDeltas(this.reusableStream)) {
        yield {
          type: "delta",
          content: delta
        };
      }
      await this.executeToolsIfNeeded();
      for (const [toolCallId, results] of this.preliminaryResults) {
        for (const result of results) {
          yield {
            type: "preliminary_result",
            toolCallId,
            result
          };
        }
      }
    }.call(this);
  }
  /**
   * Stream events in chat format (compatibility layer).
   * Note: This transforms responses API events into a chat-like format.
   * Includes preliminary tool result events after tool execution.
   *
   * @remarks
   * This is a compatibility method that attempts to transform the responses API
   * stream into a format similar to the chat API. Due to differences in the APIs,
   * this may not be a perfect mapping.
   */
  getFullChatStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream) {
        throw new Error("Stream not initialized");
      }
      const consumer = this.reusableStream.createConsumer();
      for await (const event of consumer) {
        if (!("type" in event)) {
          continue;
        }
        if (event.type === "response.output_text.delta") {
          const deltaEvent = event;
          yield {
            type: "content.delta",
            delta: deltaEvent.delta
          };
        } else if (event.type === "response.completed") {
          const completedEvent = event;
          yield {
            type: "message.complete",
            response: completedEvent.response
          };
        } else {
          yield {
            type: event.type,
            event
          };
        }
      }
      await this.executeToolsIfNeeded();
      for (const [toolCallId, results] of this.preliminaryResults) {
        for (const result of results) {
          yield {
            type: "tool.preliminary_result",
            toolCallId,
            result
          };
        }
      }
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
};

// node_modules/@openrouter/sdk/esm/funcs/callModel.js
function isChatStyleMessages(input) {
  if (!Array.isArray(input)) {
    return false;
  }
  if (input.length === 0) {
    return false;
  }
  const first = input[0];
  return first && "role" in first && !("type" in first);
}
function isChatStyleTools(tools) {
  if (!Array.isArray(tools)) {
    return false;
  }
  if (tools.length === 0) {
    return false;
  }
  const first = tools[0];
  const fn = first?.["function"];
  return first && "function" in first && fn !== void 0 && fn !== null && "name" in fn && !("inputSchema" in fn);
}
function convertChatToResponsesTools(tools) {
  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description ?? null,
    strict: tool.function.strict ?? null,
    parameters: tool.function.parameters ?? null
  }));
}
function convertChatToResponsesInput(messages) {
  return messages.map((msg) => {
    const { role, content, ...extraFields } = msg;
    if (role === "tool") {
      const toolMsg = msg;
      return {
        type: "function_call_output",
        callId: toolMsg.toolCallId,
        output: typeof toolMsg.content === "string" ? toolMsg.content : JSON.stringify(toolMsg.content),
        ...extraFields
      };
    }
    if (role === "assistant") {
      const assistantMsg = msg;
      return {
        role: "assistant",
        content: typeof assistantMsg.content === "string" ? assistantMsg.content : assistantMsg.content === null ? "" : JSON.stringify(assistantMsg.content),
        ...extraFields
      };
    }
    const convertedContent = typeof content === "string" ? content : content === null || content === void 0 ? "" : JSON.stringify(content);
    return {
      role,
      content: convertedContent,
      ...extraFields
    };
  });
}
function callModel(client, request, options) {
  const { tools, maxToolRounds, input, ...restRequest } = request;
  const convertedInput = input && isChatStyleMessages(input) ? convertChatToResponsesInput(input) : input;
  const apiRequest = {
    ...restRequest,
    input: convertedInput
  };
  let isEnhancedTools = false;
  let isChatTools = false;
  if (tools && Array.isArray(tools) && tools.length > 0) {
    const firstTool = tools[0];
    const fn = firstTool?.["function"];
    isEnhancedTools = "function" in firstTool && fn !== void 0 && fn !== null && "inputSchema" in fn;
    isChatTools = !isEnhancedTools && isChatStyleTools(tools);
  }
  const enhancedTools = isEnhancedTools ? tools : void 0;
  let apiTools;
  if (enhancedTools) {
    apiTools = convertToolsToAPIFormat(enhancedTools);
  } else if (isChatTools) {
    apiTools = convertChatToResponsesTools(tools);
  } else {
    apiTools = tools;
  }
  const finalRequest = {
    ...apiRequest,
    ...apiTools && {
      tools: apiTools
    }
  };
  const wrapperOptions = {
    client,
    request: finalRequest,
    options: options ?? {}
  };
  if (enhancedTools) {
    wrapperOptions.tools = enhancedTools;
  }
  if (maxToolRounds !== void 0) {
    wrapperOptions.maxToolRounds = maxToolRounds;
  }
  return new ResponseWrapper(wrapperOptions);
}

// node_modules/@openrouter/sdk/esm/sdk/sdk.js
var OpenRouter = class extends ClientSDK {
  get beta() {
    return this._beta ?? (this._beta = new Beta(this._options));
  }
  get analytics() {
    return this._analytics ?? (this._analytics = new Analytics(this._options));
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
  get parameters() {
    return this._parameters ?? (this._parameters = new ParametersT(this._options));
  }
  get providers() {
    return this._providers ?? (this._providers = new Providers(this._options));
  }
  get apiKeys() {
    return this._apiKeys ?? (this._apiKeys = new APIKeys(this._options));
  }
  get oAuth() {
    return this._oAuth ?? (this._oAuth = new OAuth(this._options));
  }
  get chat() {
    return this._chat ?? (this._chat = new Chat(this._options));
  }
  get completions() {
    return this._completions ?? (this._completions = new Completions(this._options));
  }
  // #region sdk-class-body
  callModel(request, options) {
    return callModel(this, request, options);
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
var envSchema2 = import_zod.z.object({
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
    const env3 = envSchema2.parse(process.env);
    return env3;
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
var env2 = validateEnv();
var isProduction = env2.NODE_ENV === "production";
var isDevelopment = env2.NODE_ENV === "development";
var isTest = env2.NODE_ENV === "test";

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
  const output = env2.LOG_OUTPUT || "console";
  if (output === "console" || output === "both") {
    transports.push(new ConsoleTransport());
  }
  if (output === "file" || output === "both") {
    const maxFileSize = env2.LOG_FILE_MAX_SIZE ? Number.parseInt(env2.LOG_FILE_MAX_SIZE) : void 0;
    const maxFiles = env2.LOG_FILE_MAX_FILES ? Number.parseInt(env2.LOG_FILE_MAX_FILES) : void 0;
    transports.push(new FileTransport(
      env2.LOG_FILE_PATH || "./logs",
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
    logger.debug("OpenRouter sendMessage called", {
      context: "OpenRouterProvider.sendMessage",
      model: params.model
    });
    const attachmentResults = this.collectAttachmentFailures(params);
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || "http://localhost:3000",
      xTitle: "Quilltap"
    });
    const messages = params.messages.map((m) => ({
      role: m.role,
      content: m.content
    }));
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
      logger.debug("Adding tools to request", {
        context: "OpenRouterProvider.sendMessage",
        toolCount: params.tools.length
      });
      requestParams.tools = params.tools;
      requestParams.toolChoice = "auto";
    }
    if (params.webSearchEnabled) {
      logger.debug("Enabling web search plugin", {
        context: "OpenRouterProvider.sendMessage"
      });
      requestParams.plugins = [{ id: "web", maxResults: 5 }];
    }
    if (params.responseFormat) {
      if (params.responseFormat.type === "json_schema" && params.responseFormat.jsonSchema) {
        logger.debug("Adding JSON schema response format", {
          context: "OpenRouterProvider.sendMessage",
          schemaName: params.responseFormat.jsonSchema.name
        });
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
      logger.debug("Adding fallback models", {
        context: "OpenRouterProvider.sendMessage",
        fallbackCount: profileParams.fallbackModels.length
      });
      requestParams.models = [params.model, ...profileParams.fallbackModels];
      requestParams.route = "fallback";
      delete requestParams.model;
    }
    const providerPrefs = profileParams?.providerPreferences;
    if (providerPrefs) {
      logger.debug("Adding provider preferences", {
        context: "OpenRouterProvider.sendMessage",
        hasOrder: !!providerPrefs.order,
        dataCollection: providerPrefs.dataCollection
      });
      requestParams.provider = {};
      if (providerPrefs.order) requestParams.provider.order = providerPrefs.order;
      if (providerPrefs.allowFallbacks !== void 0) requestParams.provider.allowFallbacks = providerPrefs.allowFallbacks;
      if (providerPrefs.requireParameters) requestParams.provider.requireParameters = providerPrefs.requireParameters;
      if (providerPrefs.dataCollection) requestParams.provider.dataCollection = providerPrefs.dataCollection;
      if (providerPrefs.ignore) requestParams.provider.ignore = providerPrefs.ignore;
      if (providerPrefs.only) requestParams.provider.only = providerPrefs.only;
    }
    const response = await client.chat.send(requestParams);
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
    logger.debug("Received OpenRouter response", {
      context: "OpenRouterProvider.sendMessage",
      finishReason: choice.finishReason,
      promptTokens: response.usage?.promptTokens,
      completionTokens: response.usage?.completionTokens,
      cachedTokens: cacheUsage?.cachedTokens
    });
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
    logger.debug("OpenRouter streamMessage called", {
      context: "OpenRouterProvider.streamMessage",
      model: params.model
    });
    const attachmentResults = this.collectAttachmentFailures(params);
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || "http://localhost:3000",
      xTitle: "Quilltap"
    });
    const messages = params.messages.map((m) => ({
      role: m.role,
      content: m.content
    }));
    const requestParams = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens ?? 4096,
      topP: params.topP ?? 1,
      stream: true,
      streamOptions: { includeUsage: true }
    };
    if (params.tools && params.tools.length > 0) {
      logger.debug("Adding tools to stream request", {
        context: "OpenRouterProvider.streamMessage",
        toolCount: params.tools.length
      });
      requestParams.tools = params.tools;
      requestParams.toolChoice = "auto";
    }
    if (params.webSearchEnabled) {
      logger.debug("Enabling web search plugin for streaming", {
        context: "OpenRouterProvider.streamMessage"
      });
      requestParams.plugins = [{ id: "web", maxResults: 5 }];
    }
    if (params.responseFormat) {
      if (params.responseFormat.type === "json_schema" && params.responseFormat.jsonSchema) {
        logger.debug("Adding JSON schema response format for streaming", {
          context: "OpenRouterProvider.streamMessage",
          schemaName: params.responseFormat.jsonSchema.name
        });
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
      logger.debug("Adding fallback models for streaming", {
        context: "OpenRouterProvider.streamMessage",
        fallbackCount: profileParams.fallbackModels.length
      });
      requestParams.models = [params.model, ...profileParams.fallbackModels];
      requestParams.route = "fallback";
      delete requestParams.model;
    }
    const providerPrefs = profileParams?.providerPreferences;
    if (providerPrefs) {
      logger.debug("Adding provider preferences for streaming", {
        context: "OpenRouterProvider.streamMessage",
        hasOrder: !!providerPrefs.order,
        dataCollection: providerPrefs.dataCollection
      });
      requestParams.provider = {};
      if (providerPrefs.order) requestParams.provider.order = providerPrefs.order;
      if (providerPrefs.allowFallbacks !== void 0) requestParams.provider.allowFallbacks = providerPrefs.allowFallbacks;
      if (providerPrefs.requireParameters) requestParams.provider.requireParameters = providerPrefs.requireParameters;
      if (providerPrefs.dataCollection) requestParams.provider.dataCollection = providerPrefs.dataCollection;
      if (providerPrefs.ignore) requestParams.provider.ignore = providerPrefs.ignore;
      if (providerPrefs.only) requestParams.provider.only = providerPrefs.only;
    }
    const stream = await client.chat.send(requestParams);
    let fullMessage = null;
    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content;
      const finishReason = chunk.choices?.[0]?.finishReason;
      const hasUsage = chunk.usage;
      if (!fullMessage) {
        fullMessage = chunk;
      } else {
        const toolCalls = chunk.choices?.[0]?.delta?.toolCalls;
        if (toolCalls) {
          fullMessage.choices[0].delta.toolCalls ??= [];
          fullMessage.choices[0].delta.toolCalls = toolCalls;
        }
        if (finishReason) {
          fullMessage.choices[0].finishReason = finishReason;
        }
        if (hasUsage) {
          fullMessage.usage = chunk.usage;
        }
      }
      if (content && !(finishReason && hasUsage)) {
        yield {
          content,
          done: false
        };
      }
      if (finishReason && hasUsage) {
        const usageAny = chunk.usage;
        const cacheUsage = usageAny?.cachedTokens || usageAny?.cacheDiscount ? {
          cachedTokens: usageAny.cachedTokens,
          cacheDiscount: usageAny.cacheDiscount,
          cacheCreationInputTokens: usageAny.cacheCreationInputTokens,
          cacheReadInputTokens: usageAny.cacheReadInputTokens
        } : void 0;
        logger.debug("Stream completed", {
          context: "OpenRouterProvider.streamMessage",
          finishReason,
          promptTokens: chunk.usage?.promptTokens,
          completionTokens: chunk.usage?.completionTokens,
          cachedTokens: cacheUsage?.cachedTokens
        });
        yield {
          content: "",
          done: true,
          usage: {
            promptTokens: chunk.usage?.promptTokens ?? 0,
            completionTokens: chunk.usage?.completionTokens ?? 0,
            totalTokens: chunk.usage?.totalTokens ?? 0
          },
          attachmentResults,
          rawResponse: fullMessage,
          cacheUsage
        };
      }
    }
  }
  async validateApiKey(apiKey) {
    try {
      logger.debug("Validating OpenRouter API key", {
        context: "OpenRouterProvider.validateApiKey"
      });
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || "http://localhost:3000",
        xTitle: "Quilltap"
      });
      await client.models.list();
      logger.debug("OpenRouter API key validation successful", {
        context: "OpenRouterProvider.validateApiKey"
      });
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
      logger.debug("Fetching OpenRouter models", {
        context: "OpenRouterProvider.getAvailableModels"
      });
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || "http://localhost:3000",
        xTitle: "Quilltap"
      });
      const response = await client.models.list();
      const models = response.data?.map((m) => m.id) ?? [];
      logger.debug("Retrieved OpenRouter models", {
        context: "OpenRouterProvider.getAvailableModels",
        modelCount: models.length
      });
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
    logger.debug("Generating image with OpenRouter", {
      context: "OpenRouterProvider.generateImage",
      model: params.model,
      prompt: params.prompt.substring(0, 100)
    });
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || "http://localhost:3000",
      xTitle: "Quilltap"
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
    const response = await client.chat.send(requestBody);
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
    logger.debug("Image generation completed", {
      context: "OpenRouterProvider.generateImage",
      imageCount: images.length
    });
    return {
      images,
      raw: response
    };
  }
};

// embedding-provider.ts
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
    logger.debug("OpenRouter generateEmbedding called", {
      context: "OpenRouterEmbeddingProvider.generateEmbedding",
      model,
      textLength: text2.length
    });
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || "http://localhost:3000",
      xTitle: "Quilltap"
    });
    const response = await client.embeddings.generate({
      input: text2,
      model,
      dimensions: options?.dimensions
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
    logger.debug("OpenRouter embedding generated", {
      context: "OpenRouterEmbeddingProvider.generateEmbedding",
      model: response.model,
      dimensions: embedding.length,
      usage: response.usage
    });
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
    logger.debug("OpenRouter generateBatchEmbeddings called", {
      context: "OpenRouterEmbeddingProvider.generateBatchEmbeddings",
      model,
      count: texts.length
    });
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || "http://localhost:3000",
      xTitle: "Quilltap"
    });
    const response = await client.embeddings.generate({
      input: texts,
      model,
      dimensions: options?.dimensions
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
    logger.debug("OpenRouter batch embeddings generated", {
      context: "OpenRouterEmbeddingProvider.generateBatchEmbeddings",
      model: response.model,
      count: results.length
    });
    return results;
  }
  /**
   * Get available embedding models from OpenRouter
   *
   * @param apiKey The OpenRouter API key
   * @returns Array of model IDs
   */
  async getAvailableModels(apiKey) {
    logger.debug("OpenRouter getAvailableModels called", {
      context: "OpenRouterEmbeddingProvider.getAvailableModels"
    });
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || "http://localhost:3000",
        xTitle: "Quilltap"
      });
      const response = await client.embeddings.listModels();
      const models = response.data?.map((m) => m.id) ?? [];
      logger.debug("OpenRouter embedding models fetched", {
        context: "OpenRouterEmbeddingProvider.getAvailableModels",
        count: models.length
      });
      return models;
    } catch (error) {
      logger.error(
        "Failed to fetch OpenRouter embedding models",
        { context: "OpenRouterEmbeddingProvider.getAvailableModels" },
        error instanceof Error ? error : void 0
      );
      return [];
    }
  }
};

// icon.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function OpenRouterIcon({ className = "h-5 w-5" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      className: `text-orange-600 ${className}`,
      fill: "currentColor",
      viewBox: "0 0 24 24",
      xmlns: "http://www.w3.org/2000/svg",
      "data-testid": "openrouter-icon",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "circle",
          {
            cx: "12",
            cy: "12",
            r: "11",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "2"
          }
        ),
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
            children: "ORT"
          }
        )
      ]
    }
  );
}

// ../../../lib/llm/tool-formatting-utils.ts
function parseOpenAIToolCalls(response) {
  const toolCalls = [];
  try {
    let toolCallsArray = response?.tool_calls;
    if (!toolCallsArray && response?.choices?.[0]?.message?.tool_calls) {
      toolCallsArray = response.choices[0].message.tool_calls;
    }
    if (toolCallsArray && Array.isArray(toolCallsArray) && toolCallsArray.length > 0) {
      for (const toolCall of toolCallsArray) {
        if (toolCall.type === "function" && toolCall.function) {
          logger.debug("Parsed OpenAI tool call", {
            context: "tool-parsing",
            toolName: toolCall.function.name
          });
          toolCalls.push({
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments || "{}")
          });
        }
      }
    }
  } catch (error) {
    logger.error("Error parsing OpenAI tool calls", { context: "tool-parsing" }, error instanceof Error ? error : void 0);
  }
  return toolCalls;
}

// index.ts
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
  webSearch: true
};
var attachmentSupport = {
  supportsAttachments: false,
  supportedMimeTypes: [],
  description: "File attachment support depends on the underlying model",
  notes: "OpenRouter proxies to 100+ models with varying capabilities. Some models may support image/file attachments."
};
var plugin = {
  metadata,
  config,
  capabilities,
  attachmentSupport,
  /**
   * Factory method to create an OpenRouter LLM provider instance
   */
  createProvider: (baseUrl) => {
    logger.debug("Creating OpenRouter provider instance", {
      context: "plugin.createProvider",
      baseUrl
    });
    return new OpenRouterProvider();
  },
  /**
   * Factory method to create an OpenRouter embedding provider instance
   */
  createEmbeddingProvider: (baseUrl) => {
    logger.debug("Creating OpenRouter embedding provider instance", {
      context: "plugin.createEmbeddingProvider",
      baseUrl
    });
    return new OpenRouterEmbeddingProvider();
  },
  /**
   * Get list of available models from OpenRouter API
   * Requires a valid API key
   * Returns 100+ models from various providers
   */
  getAvailableModels: async (apiKey, baseUrl) => {
    logger.debug("Fetching available OpenRouter models", {
      context: "plugin.getAvailableModels"
    });
    try {
      const provider = new OpenRouterProvider();
      const models = await provider.getAvailableModels(apiKey);
      logger.debug("Successfully fetched OpenRouter models", {
        context: "plugin.getAvailableModels",
        count: models.length
      });
      return models;
    } catch (error) {
      logger.error(
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
    logger.debug("Validating OpenRouter API key", {
      context: "plugin.validateApiKey"
    });
    try {
      const provider = new OpenRouterProvider();
      const isValid = await provider.validateApiKey(apiKey);
      logger.debug("OpenRouter API key validation result", {
        context: "plugin.validateApiKey",
        isValid
      });
      return isValid;
    } catch (error) {
      logger.error(
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
  renderIcon: (props) => {
    logger.debug("Rendering OpenRouter icon", {
      context: "plugin.renderIcon",
      className: props.className
    });
    return OpenRouterIcon(props);
  },
  /**
   * Format tools from OpenAI format to OpenAI format
   * OpenRouter uses OpenAI format, with Grok constraints applied if needed
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in OpenAI format
   */
  formatTools: (tools) => {
    logger.debug("Formatting tools for OpenRouter provider", {
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
    logger.debug("Parsing tool calls from OpenRouter response", {
      context: "plugin.parseToolCalls"
    });
    try {
      const toolCalls = parseOpenAIToolCalls(response);
      logger.debug("Successfully parsed tool calls", {
        context: "plugin.parseToolCalls",
        count: toolCalls.length
      });
      return toolCalls;
    } catch (error) {
      logger.error(
        "Error parsing tool calls from OpenRouter response",
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
