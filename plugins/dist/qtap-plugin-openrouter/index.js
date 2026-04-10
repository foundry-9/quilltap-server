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
    }).replace(/^\/+/, "");
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
  sdkVersion: "0.11.2",
  genVersion: "2.879.1",
  userAgent: "speakeasy-sdk/typescript 0.11.2 2.879.1 1.0.0 @openrouter/sdk"
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
function stringToBytes(str2) {
  return new TextEncoder().encode(str2);
}
function stringToBase64(str2) {
  return bytesToBase64(stringToBytes(str2));
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
  OPENROUTER_APP_TITLE: z2.string().optional(),
  OPENROUTER_APP_CATEGORIES: z2.string().optional(),
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
  if (typeof envVars.OPENROUTER_APP_TITLE !== "undefined") {
    clone.appTitle ?? (clone.appTitle = envVars.OPENROUTER_APP_TITLE);
  }
  if (typeof envVars.OPENROUTER_APP_CATEGORIES !== "undefined") {
    clone.appCategories ?? (clone.appCategories = envVars.OPENROUTER_APP_CATEGORIES);
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
    const { method, path: path2, query, headers: opHeaders, security } = conf;
    const base = conf.baseURL ?? this._baseURL;
    if (!base) {
      return ERR(new InvalidRequestError("No base URL provided for operation"));
    }
    const baseURL = new URL(base);
    let reqURL;
    if (path2) {
      baseURL.pathname = baseURL.pathname.replace(/\/+$/, "") + "/";
      reqURL = new URL(path2, baseURL);
    } else {
      reqURL = baseURL;
    }
    reqURL.hash = "";
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
var jsonLikeContentTypeRE = /^(application|text)\/([^+]+\+)*json.*/;
var jsonlLikeContentTypeRE = /^(application|text)\/([^+]+\+)*(jsonl|x-ndjson)\b.*/;
async function logRequest(logger5, req) {
  if (!logger5) {
    return;
  }
  const contentType = req.headers.get("content-type");
  const ct = contentType?.split(";")[0] || "";
  logger5.group(`> Request: ${req.method} ${req.url}`);
  logger5.group("Headers:");
  for (const [k, v] of req.headers.entries()) {
    logger5.log(`${k}: ${v}`);
  }
  logger5.groupEnd();
  logger5.group("Body:");
  switch (true) {
    case jsonLikeContentTypeRE.test(ct):
      logger5.log(await req.clone().json());
      break;
    case ct.startsWith("text/"):
      logger5.log(await req.clone().text());
      break;
    case ct === "multipart/form-data": {
      const body = await req.clone().formData();
      for (const [k, v] of body) {
        const vlabel = v instanceof Blob ? "<Blob>" : v;
        logger5.log(`${k}: ${vlabel}`);
      }
      break;
    }
    default:
      logger5.log(`<${contentType}>`);
      break;
  }
  logger5.groupEnd();
  logger5.groupEnd();
}
async function logResponse(logger5, res, req) {
  if (!logger5) {
    return;
  }
  const contentType = res.headers.get("content-type");
  const ct = contentType?.split(";")[0] || "";
  logger5.group(`< Response: ${req.method} ${req.url}`);
  logger5.log("Status Code:", res.status, res.statusText);
  logger5.group("Headers:");
  for (const [k, v] of res.headers.entries()) {
    logger5.log(`${k}: ${v}`);
  }
  logger5.groupEnd();
  logger5.group("Body:");
  switch (true) {
    case (matchContentType(res, "application/json") || jsonLikeContentTypeRE.test(ct) && !jsonlLikeContentTypeRE.test(ct)):
      logger5.log(await res.clone().json());
      break;
    case (matchContentType(res, "application/jsonl") || jsonlLikeContentTypeRE.test(ct)):
      logger5.log(await res.clone().text());
      break;
    case matchContentType(res, "text/event-stream"):
      logger5.log(`<${contentType}>`);
      break;
    case matchContentType(res, "text/*"):
      logger5.log(await res.clone().text());
      break;
    case matchContentType(res, "multipart/form-data"): {
      const body = await res.clone().formData();
      for (const [k, v] of body) {
        const vlabel = v instanceof Blob ? "<Blob>" : v;
        logger5.log(`${k}: ${vlabel}`);
      }
      break;
    }
    default:
      logger5.log(`<${contentType}>`);
      break;
  }
  logger5.groupEnd();
  logger5.groupEnd();
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
function collectExtraKeys(obj, extrasKey, optional) {
  return obj.transform((val) => {
    const extras = {};
    const { shape } = obj;
    for (const [key] of Object.entries(val)) {
      if (key in shape) {
        continue;
      }
      const v = val[key];
      if (typeof v === "undefined") {
        continue;
      }
      extras[key] = v;
      delete val[key];
    }
    if (optional && Object.keys(extras).length === 0) {
      return val;
    }
    return { ...val, [extrasKey]: extras };
  });
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
        throw SecurityError.unrecognizedType((spec, type));
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
function resolveGlobalSecurity(security, allowedFields) {
  let inputs = [
    [
      {
        fieldName: "Authorization",
        type: "http:bearer",
        value: security?.apiKey ?? env().OPENROUTER_API_KEY
      }
    ]
  ];
  if (allowedFields) {
    inputs = allowedFields.map((i) => {
      if (i < 0 || i >= inputs.length) {
        throw new RangeError(`invalid allowedFields index ${i}`);
      }
      return inputs[i];
    });
  }
  return resolveSecurity(...inputs);
}
async function extractSecurity(sec) {
  if (sec == null) {
    return;
  }
  return typeof sec === "function" ? sec() : sec;
}

// node_modules/@openrouter/sdk/esm/models/errors/badgatewayresponseerror.js
var z176 = __toESM(require("zod/v4"), 1);

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

// node_modules/@openrouter/sdk/esm/models/annotationaddedevent.js
var z11 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/openairesponsesannotation.js
var z10 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/filecitation.js
var z7 = __toESM(require("zod/v4"), 1);
var FileCitation$inboundSchema = z7.object({
  type: z7.literal("file_citation"),
  file_id: z7.string(),
  filename: z7.string(),
  index: z7.number()
}).transform((v) => {
  return remap(v, {
    "file_id": "fileId"
  });
});
var FileCitation$outboundSchema = z7.object({
  type: z7.literal("file_citation"),
  fileId: z7.string(),
  filename: z7.string(),
  index: z7.number()
}).transform((v) => {
  return remap(v, {
    fileId: "file_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/filepath.js
var z8 = __toESM(require("zod/v4"), 1);
var FilePath$inboundSchema = z8.object({
  type: z8.literal("file_path"),
  file_id: z8.string(),
  index: z8.number()
}).transform((v) => {
  return remap(v, {
    "file_id": "fileId"
  });
});
var FilePath$outboundSchema = z8.object({
  type: z8.literal("file_path"),
  fileId: z8.string(),
  index: z8.number()
}).transform((v) => {
  return remap(v, {
    fileId: "file_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/urlcitation.js
var z9 = __toESM(require("zod/v4"), 1);
var URLCitation$inboundSchema = z9.object({
  type: z9.literal("url_citation"),
  url: z9.string(),
  title: z9.string(),
  start_index: z9.number(),
  end_index: z9.number()
}).transform((v) => {
  return remap(v, {
    "start_index": "startIndex",
    "end_index": "endIndex"
  });
});
var URLCitation$outboundSchema = z9.object({
  type: z9.literal("url_citation"),
  url: z9.string(),
  title: z9.string(),
  startIndex: z9.number(),
  endIndex: z9.number()
}).transform((v) => {
  return remap(v, {
    startIndex: "start_index",
    endIndex: "end_index"
  });
});

// node_modules/@openrouter/sdk/esm/models/openairesponsesannotation.js
var OpenAIResponsesAnnotation$inboundSchema = z10.union([
  FileCitation$inboundSchema,
  URLCitation$inboundSchema,
  FilePath$inboundSchema
]);
var OpenAIResponsesAnnotation$outboundSchema = z10.union([
  FileCitation$outboundSchema,
  URLCitation$outboundSchema,
  FilePath$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/annotationaddedevent.js
var AnnotationAddedEvent$inboundSchema = z11.object({
  type: z11.literal("response.output_text.annotation.added"),
  output_index: z11.number(),
  item_id: z11.string(),
  content_index: z11.number(),
  sequence_number: z11.number(),
  annotation_index: z11.number(),
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

// node_modules/@openrouter/sdk/esm/models/applypatchservertool.js
var z12 = __toESM(require("zod/v4"), 1);
var ApplyPatchServerTool$inboundSchema = z12.object({
  type: z12.literal("apply_patch")
});
var ApplyPatchServerTool$outboundSchema = z12.object({
  type: z12.literal("apply_patch")
});

// node_modules/@openrouter/sdk/esm/models/badgatewayresponseerrordata.js
var z13 = __toESM(require("zod/v4"), 1);
var BadGatewayResponseErrorData$inboundSchema = z13.object({
  code: z13.int(),
  message: z13.string(),
  metadata: z13.nullable(z13.record(z13.string(), z13.nullable(z13.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/badrequestresponseerrordata.js
var z14 = __toESM(require("zod/v4"), 1);
var BadRequestResponseErrorData$inboundSchema = z14.object({
  code: z14.int(),
  message: z14.string(),
  metadata: z14.nullable(z14.record(z14.string(), z14.nullable(z14.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/baseinputsunion.js
var z24 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/inputaudio.js
var z16 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/types/enums.js
var z15 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/types/unrecognized.js
function unrecognized(value) {
  globalCount++;
  return value;
}
var globalCount = 0;

// node_modules/@openrouter/sdk/esm/types/enums.js
function inboundSchema(enumObj) {
  const options = Object.values(enumObj);
  return z15.union([
    ...options.map((x) => z15.literal(x)),
    z15.string().transform((x) => unrecognized(x))
  ]);
}
function inboundSchemaInt(enumObj) {
  const options = Object.values(enumObj).filter((v) => typeof v === "number");
  return z15.union([
    ...options.map((x) => z15.literal(x)),
    z15.int().transform((x) => unrecognized(x))
  ]);
}
function outboundSchema(_) {
  return z15.string();
}
function outboundSchemaInt(_) {
  return z15.int();
}

// node_modules/@openrouter/sdk/esm/models/inputaudio.js
var InputAudioFormat = {
  Mp3: "mp3",
  Wav: "wav"
};
var InputAudioFormat$inboundSchema = inboundSchema(InputAudioFormat);
var InputAudioFormat$outboundSchema = outboundSchema(InputAudioFormat);
var InputAudioInputAudio$inboundSchema = z16.object({
  data: z16.string(),
  format: InputAudioFormat$inboundSchema
});
var InputAudioInputAudio$outboundSchema = z16.object({
  data: z16.string(),
  format: InputAudioFormat$outboundSchema
});
var InputAudio$inboundSchema = z16.object({
  type: z16.literal("input_audio"),
  input_audio: z16.lazy(() => InputAudioInputAudio$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "input_audio": "inputAudio"
  });
});
var InputAudio$outboundSchema = z16.object({
  type: z16.literal("input_audio"),
  inputAudio: z16.lazy(() => InputAudioInputAudio$outboundSchema)
}).transform((v) => {
  return remap(v, {
    inputAudio: "input_audio"
  });
});

// node_modules/@openrouter/sdk/esm/models/inputfile.js
var z17 = __toESM(require("zod/v4"), 1);
var InputFile$inboundSchema = z17.object({
  type: z17.literal("input_file"),
  file_id: z17.nullable(z17.string()).optional(),
  file_data: z17.string().optional(),
  filename: z17.string().optional(),
  file_url: z17.string().optional()
}).transform((v) => {
  return remap(v, {
    "file_id": "fileId",
    "file_data": "fileData",
    "file_url": "fileUrl"
  });
});
var InputFile$outboundSchema = z17.object({
  type: z17.literal("input_file"),
  fileId: z17.nullable(z17.string()).optional(),
  fileData: z17.string().optional(),
  filename: z17.string().optional(),
  fileUrl: z17.string().optional()
}).transform((v) => {
  return remap(v, {
    fileId: "file_id",
    fileData: "file_data",
    fileUrl: "file_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/inputimage.js
var z18 = __toESM(require("zod/v4"), 1);
var InputImageTypeEnum = {
  InputImage: "input_image"
};
var InputImageDetail = {
  Auto: "auto",
  High: "high",
  Low: "low"
};
var InputImageTypeEnum$inboundSchema = z18.enum(InputImageTypeEnum);
var InputImageTypeEnum$outboundSchema = InputImageTypeEnum$inboundSchema;
var InputImageDetail$inboundSchema = inboundSchema(InputImageDetail);
var InputImageDetail$outboundSchema = outboundSchema(InputImageDetail);
var InputImage$inboundSchema = z18.object({
  type: InputImageTypeEnum$inboundSchema,
  detail: InputImageDetail$inboundSchema,
  image_url: z18.nullable(z18.string()).optional()
}).transform((v) => {
  return remap(v, {
    "image_url": "imageUrl"
  });
});
var InputImage$outboundSchema = z18.object({
  type: InputImageTypeEnum$outboundSchema,
  detail: InputImageDetail$outboundSchema,
  imageUrl: z18.nullable(z18.string()).optional()
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/inputtext.js
var z19 = __toESM(require("zod/v4"), 1);
var InputText$inboundSchema = z19.object({
  type: z19.literal("input_text"),
  text: z19.string()
});
var InputText$outboundSchema = z19.object({
  type: z19.literal("input_text"),
  text: z19.string()
});

// node_modules/@openrouter/sdk/esm/models/outputitemimagegenerationcall.js
var z20 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/imagegenerationstatus.js
var ImageGenerationStatus = {
  InProgress: "in_progress",
  Completed: "completed",
  Generating: "generating",
  Failed: "failed"
};
var ImageGenerationStatus$inboundSchema = inboundSchema(ImageGenerationStatus);
var ImageGenerationStatus$outboundSchema = outboundSchema(ImageGenerationStatus);

// node_modules/@openrouter/sdk/esm/models/outputitemimagegenerationcall.js
var OutputItemImageGenerationCallType = {
  ImageGenerationCall: "image_generation_call"
};
var OutputItemImageGenerationCallType$inboundSchema = z20.enum(OutputItemImageGenerationCallType);
var OutputItemImageGenerationCall$inboundSchema = z20.object({
  type: OutputItemImageGenerationCallType$inboundSchema,
  id: z20.string(),
  result: z20.nullable(z20.string()).default(null),
  status: ImageGenerationStatus$inboundSchema
});

// node_modules/@openrouter/sdk/esm/models/outputmessage.js
var z23 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/openairesponsesrefusalcontent.js
var z21 = __toESM(require("zod/v4"), 1);
var OpenAIResponsesRefusalContent$inboundSchema = z21.object({
  type: z21.literal("refusal"),
  refusal: z21.string()
});
var OpenAIResponsesRefusalContent$outboundSchema = z21.object({
  type: z21.literal("refusal"),
  refusal: z21.string()
});

// node_modules/@openrouter/sdk/esm/models/responseoutputtext.js
var z22 = __toESM(require("zod/v4"), 1);
var ResponseOutputTextTopLogprob$inboundSchema = z22.object({
  token: z22.string(),
  bytes: z22.array(z22.number()),
  logprob: z22.number()
});
var ResponseOutputTextTopLogprob$outboundSchema = z22.object({
  token: z22.string(),
  bytes: z22.array(z22.number()),
  logprob: z22.number()
});
var ResponseOutputTextLogprob$inboundSchema = z22.object({
  token: z22.string(),
  bytes: z22.array(z22.number()),
  logprob: z22.number(),
  top_logprobs: z22.array(z22.lazy(() => ResponseOutputTextTopLogprob$inboundSchema))
}).transform((v) => {
  return remap(v, {
    "top_logprobs": "topLogprobs"
  });
});
var ResponseOutputTextLogprob$outboundSchema = z22.object({
  token: z22.string(),
  bytes: z22.array(z22.number()),
  logprob: z22.number(),
  topLogprobs: z22.array(z22.lazy(() => ResponseOutputTextTopLogprob$outboundSchema))
}).transform((v) => {
  return remap(v, {
    topLogprobs: "top_logprobs"
  });
});
var ResponseOutputText$inboundSchema = z22.object({
  type: z22.literal("output_text"),
  text: z22.string(),
  annotations: z22.array(OpenAIResponsesAnnotation$inboundSchema).optional(),
  logprobs: z22.array(z22.lazy(() => ResponseOutputTextLogprob$inboundSchema)).optional()
});
var ResponseOutputText$outboundSchema = z22.object({
  type: z22.literal("output_text"),
  text: z22.string(),
  annotations: z22.array(OpenAIResponsesAnnotation$outboundSchema).optional(),
  logprobs: z22.array(z22.lazy(() => ResponseOutputTextLogprob$outboundSchema)).optional()
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
var OutputMessagePhaseFinalAnswer = {
  FinalAnswer: "final_answer"
};
var OutputMessagePhaseCommentary = {
  Commentary: "commentary"
};
var OutputMessageRole$inboundSchema = z23.enum(OutputMessageRole);
var OutputMessageType$inboundSchema = z23.enum(OutputMessageType);
var OutputMessageStatusInProgress$inboundSchema = z23.enum(OutputMessageStatusInProgress);
var OutputMessageStatusIncomplete$inboundSchema = z23.enum(OutputMessageStatusIncomplete);
var OutputMessageStatusCompleted$inboundSchema = z23.enum(OutputMessageStatusCompleted);
var OutputMessageStatusUnion$inboundSchema = z23.union([
  OutputMessageStatusCompleted$inboundSchema,
  OutputMessageStatusIncomplete$inboundSchema,
  OutputMessageStatusInProgress$inboundSchema
]);
var OutputMessageContent$inboundSchema = z23.union([
  ResponseOutputText$inboundSchema,
  OpenAIResponsesRefusalContent$inboundSchema
]);
var OutputMessagePhaseFinalAnswer$inboundSchema = z23.enum(OutputMessagePhaseFinalAnswer);
var OutputMessagePhaseCommentary$inboundSchema = z23.enum(OutputMessagePhaseCommentary);
var OutputMessagePhaseUnion$inboundSchema = z23.union([
  OutputMessagePhaseCommentary$inboundSchema,
  OutputMessagePhaseFinalAnswer$inboundSchema,
  z23.any()
]);
var OutputMessage$inboundSchema = z23.object({
  id: z23.string(),
  role: OutputMessageRole$inboundSchema,
  type: OutputMessageType$inboundSchema,
  status: z23.union([
    OutputMessageStatusCompleted$inboundSchema,
    OutputMessageStatusIncomplete$inboundSchema,
    OutputMessageStatusInProgress$inboundSchema
  ]).optional(),
  content: z23.array(z23.union([
    ResponseOutputText$inboundSchema,
    OpenAIResponsesRefusalContent$inboundSchema
  ])),
  phase: z23.nullable(z23.union([
    OutputMessagePhaseCommentary$inboundSchema,
    OutputMessagePhaseFinalAnswer$inboundSchema,
    z23.any()
  ])).optional()
});

// node_modules/@openrouter/sdk/esm/models/toolcallstatusenum.js
var ToolCallStatusEnum = {
  InProgress: "in_progress",
  Completed: "completed",
  Incomplete: "incomplete"
};
var ToolCallStatusEnum$inboundSchema = inboundSchema(ToolCallStatusEnum);
var ToolCallStatusEnum$outboundSchema = outboundSchema(ToolCallStatusEnum);

// node_modules/@openrouter/sdk/esm/models/baseinputsunion.js
var BaseInputsTypeFunctionCall = {
  FunctionCall: "function_call"
};
var BaseInputsTypeFunctionCallOutput = {
  FunctionCallOutput: "function_call_output"
};
var BaseInputsTypeMessage2 = {
  Message: "message"
};
var BaseInputsRoleDeveloper2 = {
  Developer: "developer"
};
var BaseInputsRoleSystem2 = {
  System: "system"
};
var BaseInputsRoleUser2 = {
  User: "user"
};
var BaseInputsTypeMessage1 = {
  Message: "message"
};
var BaseInputsRoleDeveloper1 = {
  Developer: "developer"
};
var BaseInputsRoleAssistant = {
  Assistant: "assistant"
};
var BaseInputsRoleSystem1 = {
  System: "system"
};
var BaseInputsRoleUser1 = {
  User: "user"
};
var BaseInputsPhaseFinalAnswer = {
  FinalAnswer: "final_answer"
};
var BaseInputsPhaseCommentary = {
  Commentary: "commentary"
};
var BaseInputsTypeFunctionCall$inboundSchema = z24.enum(BaseInputsTypeFunctionCall);
var BaseInputsFunctionCall$inboundSchema = z24.object({
  type: BaseInputsTypeFunctionCall$inboundSchema,
  call_id: z24.string(),
  name: z24.string(),
  arguments: z24.string(),
  id: z24.string().optional(),
  status: z24.nullable(ToolCallStatusEnum$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "call_id": "callId"
  });
});
var BaseInputsTypeFunctionCallOutput$inboundSchema = z24.enum(BaseInputsTypeFunctionCallOutput);
var BaseInputsOutput1$inboundSchema = z24.union([
  InputText$inboundSchema,
  InputImage$inboundSchema.and(z24.object({ type: z24.literal("input_image") })),
  InputFile$inboundSchema
]);
var BaseInputsOutput2$inboundSchema = z24.union([
  z24.string(),
  z24.array(z24.union([
    InputText$inboundSchema,
    InputImage$inboundSchema.and(z24.object({ type: z24.literal("input_image") })),
    InputFile$inboundSchema
  ]))
]);
var BaseInputsFunctionCallOutput$inboundSchema = z24.object({
  type: BaseInputsTypeFunctionCallOutput$inboundSchema,
  id: z24.nullable(z24.string()).optional(),
  call_id: z24.string(),
  output: z24.union([
    z24.string(),
    z24.array(z24.union([
      InputText$inboundSchema,
      InputImage$inboundSchema.and(z24.object({ type: z24.literal("input_image") })),
      InputFile$inboundSchema
    ]))
  ]),
  status: z24.nullable(ToolCallStatusEnum$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "call_id": "callId"
  });
});
var BaseInputsTypeMessage2$inboundSchema = z24.enum(BaseInputsTypeMessage2);
var BaseInputsRoleDeveloper2$inboundSchema = z24.enum(BaseInputsRoleDeveloper2);
var BaseInputsRoleSystem2$inboundSchema = z24.enum(BaseInputsRoleSystem2);
var BaseInputsRoleUser2$inboundSchema = z24.enum(BaseInputsRoleUser2);
var BaseInputsRoleUnion2$inboundSchema = z24.union([
  BaseInputsRoleUser2$inboundSchema,
  BaseInputsRoleSystem2$inboundSchema,
  BaseInputsRoleDeveloper2$inboundSchema
]);
var BaseInputsContent3$inboundSchema = z24.union([
  InputText$inboundSchema,
  InputImage$inboundSchema.and(z24.object({ type: z24.literal("input_image") })),
  InputFile$inboundSchema,
  InputAudio$inboundSchema
]);
var BaseInputsMessage2$inboundSchema = z24.object({
  id: z24.string(),
  type: BaseInputsTypeMessage2$inboundSchema.optional(),
  role: z24.union([
    BaseInputsRoleUser2$inboundSchema,
    BaseInputsRoleSystem2$inboundSchema,
    BaseInputsRoleDeveloper2$inboundSchema
  ]),
  content: z24.array(z24.union([
    InputText$inboundSchema,
    InputImage$inboundSchema.and(z24.object({ type: z24.literal("input_image") })),
    InputFile$inboundSchema,
    InputAudio$inboundSchema
  ]))
});
var BaseInputsTypeMessage1$inboundSchema = z24.enum(BaseInputsTypeMessage1);
var BaseInputsRoleDeveloper1$inboundSchema = z24.enum(BaseInputsRoleDeveloper1);
var BaseInputsRoleAssistant$inboundSchema = z24.enum(BaseInputsRoleAssistant);
var BaseInputsRoleSystem1$inboundSchema = z24.enum(BaseInputsRoleSystem1);
var BaseInputsRoleUser1$inboundSchema = z24.enum(BaseInputsRoleUser1);
var BaseInputsRoleUnion1$inboundSchema = z24.union([
  BaseInputsRoleUser1$inboundSchema,
  BaseInputsRoleSystem1$inboundSchema,
  BaseInputsRoleAssistant$inboundSchema,
  BaseInputsRoleDeveloper1$inboundSchema
]);
var BaseInputsContent1$inboundSchema = z24.union([
  InputText$inboundSchema,
  InputImage$inboundSchema.and(z24.object({ type: z24.literal("input_image") })),
  InputFile$inboundSchema,
  InputAudio$inboundSchema
]);
var BaseInputsContent2$inboundSchema = z24.union([
  z24.array(z24.union([
    InputText$inboundSchema,
    InputImage$inboundSchema.and(z24.object({ type: z24.literal("input_image") })),
    InputFile$inboundSchema,
    InputAudio$inboundSchema
  ])),
  z24.string()
]);
var BaseInputsPhaseFinalAnswer$inboundSchema = z24.enum(BaseInputsPhaseFinalAnswer);
var BaseInputsPhaseCommentary$inboundSchema = z24.enum(BaseInputsPhaseCommentary);
var BaseInputsPhaseUnion$inboundSchema = z24.union([
  BaseInputsPhaseCommentary$inboundSchema,
  BaseInputsPhaseFinalAnswer$inboundSchema,
  z24.any()
]);
var BaseInputsMessage1$inboundSchema = z24.object({
  type: BaseInputsTypeMessage1$inboundSchema.optional(),
  role: z24.union([
    BaseInputsRoleUser1$inboundSchema,
    BaseInputsRoleSystem1$inboundSchema,
    BaseInputsRoleAssistant$inboundSchema,
    BaseInputsRoleDeveloper1$inboundSchema
  ]),
  content: z24.union([
    z24.array(z24.union([
      InputText$inboundSchema,
      InputImage$inboundSchema.and(z24.object({ type: z24.literal("input_image") })),
      InputFile$inboundSchema,
      InputAudio$inboundSchema
    ])),
    z24.string()
  ]),
  phase: z24.nullable(z24.union([
    BaseInputsPhaseCommentary$inboundSchema,
    BaseInputsPhaseFinalAnswer$inboundSchema,
    z24.any()
  ])).optional()
});
var BaseInputsUnion1$inboundSchema = z24.union([
  z24.lazy(() => BaseInputsFunctionCall$inboundSchema),
  OutputMessage$inboundSchema,
  z24.lazy(() => BaseInputsMessage2$inboundSchema),
  z24.lazy(() => BaseInputsFunctionCallOutput$inboundSchema),
  OutputItemImageGenerationCall$inboundSchema,
  z24.lazy(() => BaseInputsMessage1$inboundSchema)
]);
var BaseInputsUnion$inboundSchema = z24.union([
  z24.string(),
  z24.array(z24.union([
    z24.lazy(() => BaseInputsFunctionCall$inboundSchema),
    OutputMessage$inboundSchema,
    z24.lazy(() => BaseInputsMessage2$inboundSchema),
    z24.lazy(() => BaseInputsFunctionCallOutput$inboundSchema),
    OutputItemImageGenerationCall$inboundSchema,
    z24.lazy(() => BaseInputsMessage1$inboundSchema)
  ])),
  z24.any()
]);

// node_modules/@openrouter/sdk/esm/models/basereasoningconfig.js
var z25 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/reasoningeffortenum.js
var ReasoningEffortEnum = {
  Xhigh: "xhigh",
  High: "high",
  Medium: "medium",
  Low: "low",
  Minimal: "minimal",
  None: "none"
};
var ReasoningEffortEnum$inboundSchema = inboundSchema(ReasoningEffortEnum);
var ReasoningEffortEnum$outboundSchema = outboundSchema(ReasoningEffortEnum);

// node_modules/@openrouter/sdk/esm/models/reasoningsummaryverbosityenum.js
var ReasoningSummaryVerbosityEnum = {
  Auto: "auto",
  Concise: "concise",
  Detailed: "detailed"
};
var ReasoningSummaryVerbosityEnum$inboundSchema = inboundSchema(ReasoningSummaryVerbosityEnum);
var ReasoningSummaryVerbosityEnum$outboundSchema = outboundSchema(ReasoningSummaryVerbosityEnum);

// node_modules/@openrouter/sdk/esm/models/basereasoningconfig.js
var BaseReasoningConfig$inboundSchema = z25.object({
  effort: z25.nullable(ReasoningEffortEnum$inboundSchema).optional(),
  summary: z25.nullable(ReasoningSummaryVerbosityEnum$inboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/chatassistantimages.js
var z26 = __toESM(require("zod/v4"), 1);
var ChatAssistantImagesImageUrl$inboundSchema = z26.object({
  url: z26.string()
});
var ChatAssistantImagesImageUrl$outboundSchema = z26.object({
  url: z26.string()
});
var ChatAssistantImages$inboundSchema = z26.object({
  image_url: z26.lazy(() => ChatAssistantImagesImageUrl$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "image_url": "imageUrl"
  });
});
var ChatAssistantImages$outboundSchema = z26.object({
  imageUrl: z26.lazy(() => ChatAssistantImagesImageUrl$outboundSchema)
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatassistantmessage.js
var z42 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chataudiooutput.js
var z27 = __toESM(require("zod/v4"), 1);
var ChatAudioOutput$inboundSchema = z27.object({
  id: z27.string().optional(),
  expires_at: z27.number().optional(),
  data: z27.string().optional(),
  transcript: z27.string().optional()
}).transform((v) => {
  return remap(v, {
    "expires_at": "expiresAt"
  });
});
var ChatAudioOutput$outboundSchema = z27.object({
  id: z27.string().optional(),
  expiresAt: z27.number().optional(),
  data: z27.string().optional(),
  transcript: z27.string().optional()
}).transform((v) => {
  return remap(v, {
    expiresAt: "expires_at"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatcontentitems.js
var z36 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatcontentaudio.js
var z28 = __toESM(require("zod/v4"), 1);
var ChatContentAudioType = {
  InputAudio: "input_audio"
};
var ChatContentAudioType$inboundSchema = z28.enum(ChatContentAudioType);
var ChatContentAudioType$outboundSchema = ChatContentAudioType$inboundSchema;
var ChatContentAudioInputAudio$inboundSchema = z28.object({
  data: z28.string(),
  format: z28.string()
});
var ChatContentAudioInputAudio$outboundSchema = z28.object({
  data: z28.string(),
  format: z28.string()
});
var ChatContentAudio$inboundSchema = z28.object({
  type: ChatContentAudioType$inboundSchema,
  input_audio: z28.lazy(() => ChatContentAudioInputAudio$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "input_audio": "inputAudio"
  });
});
var ChatContentAudio$outboundSchema = z28.object({
  type: ChatContentAudioType$outboundSchema,
  inputAudio: z28.lazy(() => ChatContentAudioInputAudio$outboundSchema)
}).transform((v) => {
  return remap(v, {
    inputAudio: "input_audio"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatcontentfile.js
var z29 = __toESM(require("zod/v4"), 1);
var ChatContentFileType = {
  File: "file"
};
var ChatContentFileType$inboundSchema = z29.enum(ChatContentFileType);
var ChatContentFileType$outboundSchema = ChatContentFileType$inboundSchema;
var FileT$inboundSchema = z29.object({
  file_data: z29.string().optional(),
  file_id: z29.string().optional(),
  filename: z29.string().optional()
}).transform((v) => {
  return remap(v, {
    "file_data": "fileData",
    "file_id": "fileId"
  });
});
var FileT$outboundSchema = z29.object({
  fileData: z29.string().optional(),
  fileId: z29.string().optional(),
  filename: z29.string().optional()
}).transform((v) => {
  return remap(v, {
    fileData: "file_data",
    fileId: "file_id"
  });
});
var ChatContentFile$inboundSchema = z29.object({
  type: ChatContentFileType$inboundSchema,
  file: z29.lazy(() => FileT$inboundSchema)
});
var ChatContentFile$outboundSchema = z29.object({
  type: ChatContentFileType$outboundSchema,
  file: z29.lazy(() => FileT$outboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/chatcontentimage.js
var z30 = __toESM(require("zod/v4"), 1);
var ChatContentImageType = {
  ImageUrl: "image_url"
};
var ChatContentImageDetail = {
  Auto: "auto",
  Low: "low",
  High: "high"
};
var ChatContentImageType$inboundSchema = z30.enum(ChatContentImageType);
var ChatContentImageType$outboundSchema = ChatContentImageType$inboundSchema;
var ChatContentImageDetail$inboundSchema = inboundSchema(ChatContentImageDetail);
var ChatContentImageDetail$outboundSchema = outboundSchema(ChatContentImageDetail);
var ChatContentImageImageUrl$inboundSchema = z30.object({
  url: z30.string(),
  detail: ChatContentImageDetail$inboundSchema.optional()
});
var ChatContentImageImageUrl$outboundSchema = z30.object({
  url: z30.string(),
  detail: ChatContentImageDetail$outboundSchema.optional()
});
var ChatContentImage$inboundSchema = z30.object({
  type: ChatContentImageType$inboundSchema,
  image_url: z30.lazy(() => ChatContentImageImageUrl$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "image_url": "imageUrl"
  });
});
var ChatContentImage$outboundSchema = z30.object({
  type: ChatContentImageType$outboundSchema,
  imageUrl: z30.lazy(() => ChatContentImageImageUrl$outboundSchema)
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatcontenttext.js
var z32 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatcontentcachecontrol.js
var z31 = __toESM(require("zod/v4"), 1);
var ChatContentCacheControlType = {
  Ephemeral: "ephemeral"
};
var ChatContentCacheControlTtl = {
  Fivem: "5m",
  Oneh: "1h"
};
var ChatContentCacheControlType$inboundSchema = z31.enum(ChatContentCacheControlType);
var ChatContentCacheControlType$outboundSchema = ChatContentCacheControlType$inboundSchema;
var ChatContentCacheControlTtl$inboundSchema = inboundSchema(ChatContentCacheControlTtl);
var ChatContentCacheControlTtl$outboundSchema = outboundSchema(ChatContentCacheControlTtl);
var ChatContentCacheControl$inboundSchema = z31.object({
  type: ChatContentCacheControlType$inboundSchema,
  ttl: ChatContentCacheControlTtl$inboundSchema.optional()
});
var ChatContentCacheControl$outboundSchema = z31.object({
  type: ChatContentCacheControlType$outboundSchema,
  ttl: ChatContentCacheControlTtl$outboundSchema.optional()
});

// node_modules/@openrouter/sdk/esm/models/chatcontenttext.js
var ChatContentTextType = {
  Text: "text"
};
var ChatContentTextType$inboundSchema = z32.enum(ChatContentTextType);
var ChatContentTextType$outboundSchema = ChatContentTextType$inboundSchema;
var ChatContentText$inboundSchema = z32.object({
  type: ChatContentTextType$inboundSchema,
  text: z32.string(),
  cache_control: ChatContentCacheControl$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "cache_control": "cacheControl"
  });
});
var ChatContentText$outboundSchema = z32.object({
  type: ChatContentTextType$outboundSchema,
  text: z32.string(),
  cacheControl: ChatContentCacheControl$outboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    cacheControl: "cache_control"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatcontentvideo.js
var z34 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatcontentvideoinput.js
var z33 = __toESM(require("zod/v4"), 1);
var ChatContentVideoInput$inboundSchema = z33.object({
  url: z33.string()
});
var ChatContentVideoInput$outboundSchema = z33.object({
  url: z33.string()
});

// node_modules/@openrouter/sdk/esm/models/chatcontentvideo.js
var ChatContentVideo$inboundSchema = z34.object({
  type: z34.literal("video_url"),
  video_url: ChatContentVideoInput$inboundSchema
}).transform((v) => {
  return remap(v, {
    "video_url": "videoUrl"
  });
});
var ChatContentVideo$outboundSchema = z34.object({
  type: z34.literal("video_url"),
  videoUrl: ChatContentVideoInput$outboundSchema
}).transform((v) => {
  return remap(v, {
    videoUrl: "video_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/legacychatcontentvideo.js
var z35 = __toESM(require("zod/v4"), 1);
var LegacyChatContentVideo$inboundSchema = z35.object({
  type: z35.literal("input_video"),
  video_url: ChatContentVideoInput$inboundSchema
}).transform((v) => {
  return remap(v, {
    "video_url": "videoUrl"
  });
});
var LegacyChatContentVideo$outboundSchema = z35.object({
  type: z35.literal("input_video"),
  videoUrl: ChatContentVideoInput$outboundSchema
}).transform((v) => {
  return remap(v, {
    videoUrl: "video_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatcontentitems.js
var ChatContentItems1$inboundSchema = z36.union([
  LegacyChatContentVideo$inboundSchema,
  ChatContentVideo$inboundSchema
]);
var ChatContentItems1$outboundSchema = z36.union([
  LegacyChatContentVideo$outboundSchema,
  ChatContentVideo$outboundSchema
]);
var ChatContentItems$inboundSchema = z36.union([
  ChatContentText$inboundSchema,
  ChatContentImage$inboundSchema,
  ChatContentAudio$inboundSchema,
  ChatContentFile$inboundSchema,
  z36.union([
    LegacyChatContentVideo$inboundSchema,
    ChatContentVideo$inboundSchema
  ])
]);
var ChatContentItems$outboundSchema = z36.union([
  ChatContentText$outboundSchema,
  ChatContentImage$outboundSchema,
  ChatContentAudio$outboundSchema,
  ChatContentFile$outboundSchema,
  z36.union([
    LegacyChatContentVideo$outboundSchema,
    ChatContentVideo$outboundSchema
  ])
]);

// node_modules/@openrouter/sdk/esm/models/chattoolcall.js
var z37 = __toESM(require("zod/v4"), 1);
var ChatToolCallType = {
  Function: "function"
};
var ChatToolCallType$inboundSchema = z37.enum(ChatToolCallType);
var ChatToolCallType$outboundSchema = ChatToolCallType$inboundSchema;
var ChatToolCallFunction$inboundSchema = z37.object({
  name: z37.string(),
  arguments: z37.string()
});
var ChatToolCallFunction$outboundSchema = z37.object({
  name: z37.string(),
  arguments: z37.string()
});
var ChatToolCall$inboundSchema = z37.object({
  id: z37.string(),
  type: ChatToolCallType$inboundSchema,
  function: z37.lazy(() => ChatToolCallFunction$inboundSchema)
});
var ChatToolCall$outboundSchema = z37.object({
  id: z37.string(),
  type: ChatToolCallType$outboundSchema,
  function: z37.lazy(() => ChatToolCallFunction$outboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/reasoningdetailunion.js
var z41 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/reasoningdetailencrypted.js
var z38 = __toESM(require("zod/v4"), 1);
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
var ReasoningDetailEncrypted$inboundSchema = z38.object({
  type: z38.literal("reasoning.encrypted"),
  data: z38.string(),
  id: z38.nullable(z38.string()).optional(),
  format: z38.nullable(ReasoningDetailEncryptedFormat$inboundSchema).optional(),
  index: z38.number().optional()
});
var ReasoningDetailEncrypted$outboundSchema = z38.object({
  type: z38.literal("reasoning.encrypted"),
  data: z38.string(),
  id: z38.nullable(z38.string()).optional(),
  format: z38.nullable(ReasoningDetailEncryptedFormat$outboundSchema).optional(),
  index: z38.number().optional()
});

// node_modules/@openrouter/sdk/esm/models/reasoningdetailsummary.js
var z39 = __toESM(require("zod/v4"), 1);
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
var ReasoningDetailSummary$inboundSchema = z39.object({
  type: z39.literal("reasoning.summary"),
  summary: z39.string(),
  id: z39.nullable(z39.string()).optional(),
  format: z39.nullable(ReasoningDetailSummaryFormat$inboundSchema).optional(),
  index: z39.number().optional()
});
var ReasoningDetailSummary$outboundSchema = z39.object({
  type: z39.literal("reasoning.summary"),
  summary: z39.string(),
  id: z39.nullable(z39.string()).optional(),
  format: z39.nullable(ReasoningDetailSummaryFormat$outboundSchema).optional(),
  index: z39.number().optional()
});

// node_modules/@openrouter/sdk/esm/models/reasoningdetailtext.js
var z40 = __toESM(require("zod/v4"), 1);
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
var ReasoningDetailText$inboundSchema = z40.object({
  type: z40.literal("reasoning.text"),
  text: z40.nullable(z40.string()).optional(),
  signature: z40.nullable(z40.string()).optional(),
  id: z40.nullable(z40.string()).optional(),
  format: z40.nullable(ReasoningDetailTextFormat$inboundSchema).optional(),
  index: z40.number().optional()
});
var ReasoningDetailText$outboundSchema = z40.object({
  type: z40.literal("reasoning.text"),
  text: z40.nullable(z40.string()).optional(),
  signature: z40.nullable(z40.string()).optional(),
  id: z40.nullable(z40.string()).optional(),
  format: z40.nullable(ReasoningDetailTextFormat$outboundSchema).optional(),
  index: z40.number().optional()
});

// node_modules/@openrouter/sdk/esm/models/reasoningdetailunion.js
var ReasoningDetailUnion$inboundSchema = z41.union([
  ReasoningDetailSummary$inboundSchema,
  ReasoningDetailEncrypted$inboundSchema,
  ReasoningDetailText$inboundSchema
]);
var ReasoningDetailUnion$outboundSchema = z41.union([
  ReasoningDetailSummary$outboundSchema,
  ReasoningDetailEncrypted$outboundSchema,
  ReasoningDetailText$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/chatassistantmessage.js
var ChatAssistantMessageRole = {
  Assistant: "assistant"
};
var ChatAssistantMessageRole$inboundSchema = z42.enum(ChatAssistantMessageRole);
var ChatAssistantMessageRole$outboundSchema = ChatAssistantMessageRole$inboundSchema;
var ChatAssistantMessageContent$inboundSchema = z42.union([z42.string(), z42.array(ChatContentItems$inboundSchema), z42.any()]);
var ChatAssistantMessageContent$outboundSchema = z42.union([z42.string(), z42.array(ChatContentItems$outboundSchema), z42.any()]);
var ChatAssistantMessage$inboundSchema = z42.object({
  role: ChatAssistantMessageRole$inboundSchema,
  content: z42.nullable(z42.union([z42.string(), z42.array(ChatContentItems$inboundSchema), z42.any()])).optional(),
  name: z42.string().optional(),
  tool_calls: z42.array(ChatToolCall$inboundSchema).optional(),
  refusal: z42.nullable(z42.string()).optional(),
  reasoning: z42.nullable(z42.string()).optional(),
  reasoning_details: z42.array(ReasoningDetailUnion$inboundSchema).optional(),
  images: z42.array(ChatAssistantImages$inboundSchema).optional(),
  audio: ChatAudioOutput$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "tool_calls": "toolCalls",
    "reasoning_details": "reasoningDetails"
  });
});
var ChatAssistantMessage$outboundSchema = z42.object({
  role: ChatAssistantMessageRole$outboundSchema,
  content: z42.nullable(z42.union([z42.string(), z42.array(ChatContentItems$outboundSchema), z42.any()])).optional(),
  name: z42.string().optional(),
  toolCalls: z42.array(ChatToolCall$outboundSchema).optional(),
  refusal: z42.nullable(z42.string()).optional(),
  reasoning: z42.nullable(z42.string()).optional(),
  reasoningDetails: z42.array(ReasoningDetailUnion$outboundSchema).optional(),
  images: z42.array(ChatAssistantImages$outboundSchema).optional(),
  audio: ChatAudioOutput$outboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    toolCalls: "tool_calls",
    reasoningDetails: "reasoning_details"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatchoice.js
var z45 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chattokenlogprobs.js
var z44 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chattokenlogprob.js
var z43 = __toESM(require("zod/v4"), 1);
var ChatTokenLogprobTopLogprob$inboundSchema = z43.object({
  token: z43.string(),
  logprob: z43.number(),
  bytes: z43.nullable(z43.array(z43.number()))
});
var ChatTokenLogprob$inboundSchema = z43.object({
  token: z43.string(),
  logprob: z43.number(),
  bytes: z43.nullable(z43.array(z43.number())),
  top_logprobs: z43.array(z43.lazy(() => ChatTokenLogprobTopLogprob$inboundSchema))
}).transform((v) => {
  return remap(v, {
    "top_logprobs": "topLogprobs"
  });
});

// node_modules/@openrouter/sdk/esm/models/chattokenlogprobs.js
var ChatTokenLogprobs$inboundSchema = z44.object({
  content: z44.nullable(z44.array(ChatTokenLogprob$inboundSchema)),
  refusal: z44.nullable(z44.array(ChatTokenLogprob$inboundSchema)).optional()
});

// node_modules/@openrouter/sdk/esm/models/chatchoice.js
var ChatChoice$inboundSchema = z45.object({
  finish_reason: z45.nullable(z45.any()),
  index: z45.number(),
  message: ChatAssistantMessage$inboundSchema,
  logprobs: z45.nullable(ChatTokenLogprobs$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "finish_reason": "finishReason"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatdebugoptions.js
var z46 = __toESM(require("zod/v4"), 1);
var ChatDebugOptions$outboundSchema = z46.object({
  echoUpstreamBody: z46.boolean().optional()
}).transform((v) => {
  return remap(v, {
    echoUpstreamBody: "echo_upstream_body"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatdevelopermessage.js
var z47 = __toESM(require("zod/v4"), 1);
var ChatDeveloperMessageContent$outboundSchema = z47.union([z47.string(), z47.array(ChatContentText$outboundSchema)]);
var ChatDeveloperMessage$outboundSchema = z47.object({
  role: z47.literal("developer"),
  content: z47.union([z47.string(), z47.array(ChatContentText$outboundSchema)]),
  name: z47.string().optional()
});

// node_modules/@openrouter/sdk/esm/models/chatformatgrammarconfig.js
var z48 = __toESM(require("zod/v4"), 1);
var ChatFormatGrammarConfig$outboundSchema = z48.object({
  type: z48.literal("grammar"),
  grammar: z48.string()
});

// node_modules/@openrouter/sdk/esm/models/chatformatjsonschemaconfig.js
var z50 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatjsonschemaconfig.js
var z49 = __toESM(require("zod/v4"), 1);
var ChatJsonSchemaConfig$outboundSchema = z49.object({
  name: z49.string(),
  description: z49.string().optional(),
  schema: z49.record(z49.string(), z49.nullable(z49.any())).optional(),
  strict: z49.nullable(z49.boolean()).optional()
});

// node_modules/@openrouter/sdk/esm/models/chatformatjsonschemaconfig.js
var ChatFormatJsonSchemaConfig$outboundSchema = z50.object({
  type: z50.literal("json_schema"),
  jsonSchema: ChatJsonSchemaConfig$outboundSchema
}).transform((v) => {
  return remap(v, {
    jsonSchema: "json_schema"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatformatpythonconfig.js
var z51 = __toESM(require("zod/v4"), 1);
var ChatFormatPythonConfig$outboundSchema = z51.object({
  type: z51.literal("python")
});

// node_modules/@openrouter/sdk/esm/models/chatformattextconfig.js
var z52 = __toESM(require("zod/v4"), 1);
var ChatFormatTextConfig$outboundSchema = z52.object({
  type: z52.literal("text")
});

// node_modules/@openrouter/sdk/esm/models/chatfunctiontool.js
var z56 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatwebsearchservertool.js
var z53 = __toESM(require("zod/v4"), 1);
var ChatWebSearchServerToolTypeOpenrouterWebSearch = {
  OpenrouterWebSearch: "openrouter:web_search"
};
var ChatWebSearchServerToolEngine = {
  Auto: "auto",
  Native: "native",
  Exa: "exa",
  Firecrawl: "firecrawl",
  Parallel: "parallel"
};
var ChatWebSearchServerToolSearchContextSize = {
  Low: "low",
  Medium: "medium",
  High: "high"
};
var ChatWebSearchServerToolParametersType = {
  Approximate: "approximate"
};
var ChatWebSearchServerToolTypeOpenrouterWebSearch$outboundSchema = z53.enum(ChatWebSearchServerToolTypeOpenrouterWebSearch);
var ChatWebSearchServerToolEngine$outboundSchema = outboundSchema(ChatWebSearchServerToolEngine);
var ChatWebSearchServerToolSearchContextSize$outboundSchema = outboundSchema(ChatWebSearchServerToolSearchContextSize);
var ChatWebSearchServerToolParametersType$outboundSchema = z53.enum(ChatWebSearchServerToolParametersType);
var ChatWebSearchServerToolUserLocation$outboundSchema = z53.object({
  type: ChatWebSearchServerToolParametersType$outboundSchema.optional(),
  city: z53.string().optional(),
  region: z53.string().optional(),
  country: z53.string().optional(),
  timezone: z53.string().optional()
});
var ChatWebSearchServerToolParameters$outboundSchema = z53.object({
  engine: ChatWebSearchServerToolEngine$outboundSchema.optional(),
  maxResults: z53.number().optional(),
  maxTotalResults: z53.number().optional(),
  searchContextSize: ChatWebSearchServerToolSearchContextSize$outboundSchema.optional(),
  userLocation: z53.lazy(() => ChatWebSearchServerToolUserLocation$outboundSchema).optional(),
  allowedDomains: z53.array(z53.string()).optional(),
  excludedDomains: z53.array(z53.string()).optional()
}).transform((v) => {
  return remap(v, {
    maxResults: "max_results",
    maxTotalResults: "max_total_results",
    searchContextSize: "search_context_size",
    userLocation: "user_location",
    allowedDomains: "allowed_domains",
    excludedDomains: "excluded_domains"
  });
});
var ChatWebSearchServerTool$outboundSchema = z53.object({
  type: ChatWebSearchServerToolTypeOpenrouterWebSearch$outboundSchema,
  parameters: z53.lazy(() => ChatWebSearchServerToolParameters$outboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/chatwebsearchshorthand.js
var z54 = __toESM(require("zod/v4"), 1);
var ChatWebSearchShorthandType = {
  WebSearch: "web_search",
  WebSearchPreview: "web_search_preview",
  WebSearchPreview20250311: "web_search_preview_2025_03_11",
  WebSearch20250826: "web_search_2025_08_26"
};
var ChatWebSearchShorthandEngine = {
  Auto: "auto",
  Native: "native",
  Exa: "exa",
  Firecrawl: "firecrawl",
  Parallel: "parallel"
};
var ChatWebSearchShorthandSearchContextSize = {
  Low: "low",
  Medium: "medium",
  High: "high"
};
var ChatWebSearchShorthandTypeApproximate = {
  Approximate: "approximate"
};
var ChatWebSearchShorthandParametersEngine = {
  Auto: "auto",
  Native: "native",
  Exa: "exa",
  Firecrawl: "firecrawl",
  Parallel: "parallel"
};
var ChatWebSearchShorthandParametersSearchContextSize = {
  Low: "low",
  Medium: "medium",
  High: "high"
};
var ChatWebSearchShorthandParametersType = {
  Approximate: "approximate"
};
var ChatWebSearchShorthandType$outboundSchema = outboundSchema(ChatWebSearchShorthandType);
var ChatWebSearchShorthandEngine$outboundSchema = outboundSchema(ChatWebSearchShorthandEngine);
var ChatWebSearchShorthandSearchContextSize$outboundSchema = outboundSchema(ChatWebSearchShorthandSearchContextSize);
var ChatWebSearchShorthandTypeApproximate$outboundSchema = z54.enum(ChatWebSearchShorthandTypeApproximate);
var ChatWebSearchShorthandUserLocation$outboundSchema = z54.object({
  type: ChatWebSearchShorthandTypeApproximate$outboundSchema.optional(),
  city: z54.string().optional(),
  region: z54.string().optional(),
  country: z54.string().optional(),
  timezone: z54.string().optional()
});
var ChatWebSearchShorthandParametersEngine$outboundSchema = outboundSchema(ChatWebSearchShorthandParametersEngine);
var ChatWebSearchShorthandParametersSearchContextSize$outboundSchema = outboundSchema(ChatWebSearchShorthandParametersSearchContextSize);
var ChatWebSearchShorthandParametersType$outboundSchema = z54.enum(ChatWebSearchShorthandParametersType);
var ChatWebSearchShorthandParametersUserLocation$outboundSchema = z54.object({
  type: ChatWebSearchShorthandParametersType$outboundSchema.optional(),
  city: z54.string().optional(),
  region: z54.string().optional(),
  country: z54.string().optional(),
  timezone: z54.string().optional()
});
var ChatWebSearchShorthandParameters$outboundSchema = z54.object({
  engine: ChatWebSearchShorthandParametersEngine$outboundSchema.optional(),
  maxResults: z54.number().optional(),
  maxTotalResults: z54.number().optional(),
  searchContextSize: ChatWebSearchShorthandParametersSearchContextSize$outboundSchema.optional(),
  userLocation: z54.lazy(() => ChatWebSearchShorthandParametersUserLocation$outboundSchema).optional(),
  allowedDomains: z54.array(z54.string()).optional(),
  excludedDomains: z54.array(z54.string()).optional()
}).transform((v) => {
  return remap(v, {
    maxResults: "max_results",
    maxTotalResults: "max_total_results",
    searchContextSize: "search_context_size",
    userLocation: "user_location",
    allowedDomains: "allowed_domains",
    excludedDomains: "excluded_domains"
  });
});
var ChatWebSearchShorthand$outboundSchema = z54.object({
  type: ChatWebSearchShorthandType$outboundSchema,
  engine: ChatWebSearchShorthandEngine$outboundSchema.optional(),
  maxResults: z54.number().optional(),
  maxTotalResults: z54.number().optional(),
  searchContextSize: ChatWebSearchShorthandSearchContextSize$outboundSchema.optional(),
  userLocation: z54.lazy(() => ChatWebSearchShorthandUserLocation$outboundSchema).optional(),
  allowedDomains: z54.array(z54.string()).optional(),
  excludedDomains: z54.array(z54.string()).optional(),
  parameters: z54.lazy(() => ChatWebSearchShorthandParameters$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    maxResults: "max_results",
    maxTotalResults: "max_total_results",
    searchContextSize: "search_context_size",
    userLocation: "user_location",
    allowedDomains: "allowed_domains",
    excludedDomains: "excluded_domains"
  });
});

// node_modules/@openrouter/sdk/esm/models/datetimeservertool.js
var z55 = __toESM(require("zod/v4"), 1);
var DatetimeServerToolType = {
  OpenrouterDatetime: "openrouter:datetime"
};
var DatetimeServerToolType$outboundSchema = z55.enum(DatetimeServerToolType);
var DatetimeServerToolParameters$outboundSchema = z55.object({
  timezone: z55.string().optional()
});
var DatetimeServerTool$outboundSchema = z55.object({
  type: DatetimeServerToolType$outboundSchema,
  parameters: z55.lazy(() => DatetimeServerToolParameters$outboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/chatfunctiontool.js
var ChatFunctionToolType = {
  Function: "function"
};
var ChatFunctionToolType$outboundSchema = z56.enum(ChatFunctionToolType);
var ChatFunctionToolFunctionFunction$outboundSchema = z56.object({
  name: z56.string(),
  description: z56.string().optional(),
  parameters: z56.record(z56.string(), z56.nullable(z56.any())).optional(),
  strict: z56.nullable(z56.boolean()).optional()
});
var ChatFunctionToolFunction$outboundSchema = z56.object({
  type: ChatFunctionToolType$outboundSchema,
  function: z56.lazy(() => ChatFunctionToolFunctionFunction$outboundSchema),
  cacheControl: ChatContentCacheControl$outboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    cacheControl: "cache_control"
  });
});
var ChatFunctionTool$outboundSchema = z56.union([
  z56.lazy(() => ChatFunctionToolFunction$outboundSchema),
  DatetimeServerTool$outboundSchema,
  ChatWebSearchServerTool$outboundSchema,
  ChatWebSearchShorthand$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/chatmessages.js
var z60 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatsystemmessage.js
var z57 = __toESM(require("zod/v4"), 1);
var ChatSystemMessageContent$outboundSchema = z57.union([z57.string(), z57.array(ChatContentText$outboundSchema)]);
var ChatSystemMessage$outboundSchema = z57.object({
  role: z57.literal("system"),
  content: z57.union([z57.string(), z57.array(ChatContentText$outboundSchema)]),
  name: z57.string().optional()
});

// node_modules/@openrouter/sdk/esm/models/chattoolmessage.js
var z58 = __toESM(require("zod/v4"), 1);
var ChatToolMessageContent$outboundSchema = z58.union([z58.string(), z58.array(ChatContentItems$outboundSchema)]);
var ChatToolMessage$outboundSchema = z58.object({
  role: z58.literal("tool"),
  content: z58.union([z58.string(), z58.array(ChatContentItems$outboundSchema)]),
  toolCallId: z58.string()
}).transform((v) => {
  return remap(v, {
    toolCallId: "tool_call_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatusermessage.js
var z59 = __toESM(require("zod/v4"), 1);
var ChatUserMessageContent$outboundSchema = z59.union([z59.string(), z59.array(ChatContentItems$outboundSchema)]);
var ChatUserMessage$outboundSchema = z59.object({
  role: z59.literal("user"),
  content: z59.union([z59.string(), z59.array(ChatContentItems$outboundSchema)]),
  name: z59.string().optional()
});

// node_modules/@openrouter/sdk/esm/models/chatmessages.js
var ChatMessages$outboundSchema = z60.union([
  ChatSystemMessage$outboundSchema,
  ChatUserMessage$outboundSchema,
  ChatDeveloperMessage$outboundSchema,
  ChatAssistantMessage$outboundSchema.and(z60.object({ role: z60.literal("assistant") })),
  ChatToolMessage$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/chatnamedtoolchoice.js
var z61 = __toESM(require("zod/v4"), 1);
var ChatNamedToolChoiceType = {
  Function: "function"
};
var ChatNamedToolChoiceType$outboundSchema = z61.enum(ChatNamedToolChoiceType);
var ChatNamedToolChoiceFunction$outboundSchema = z61.object({
  name: z61.string()
});
var ChatNamedToolChoice$outboundSchema = z61.object({
  type: ChatNamedToolChoiceType$outboundSchema,
  function: z61.lazy(() => ChatNamedToolChoiceFunction$outboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/chatrequest.js
var z72 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatstreamoptions.js
var z62 = __toESM(require("zod/v4"), 1);
var ChatStreamOptions$outboundSchema = z62.object({
  includeUsage: z62.boolean().optional()
}).transform((v) => {
  return remap(v, {
    includeUsage: "include_usage"
  });
});

// node_modules/@openrouter/sdk/esm/models/chattoolchoice.js
var z63 = __toESM(require("zod/v4"), 1);
var ChatToolChoiceRequired = {
  Required: "required"
};
var ChatToolChoiceAuto = {
  Auto: "auto"
};
var ChatToolChoiceNone = {
  None: "none"
};
var ChatToolChoiceRequired$outboundSchema = z63.enum(ChatToolChoiceRequired);
var ChatToolChoiceAuto$outboundSchema = z63.enum(ChatToolChoiceAuto);
var ChatToolChoiceNone$outboundSchema = z63.enum(ChatToolChoiceNone);
var ChatToolChoice$outboundSchema = z63.union([
  ChatNamedToolChoice$outboundSchema,
  ChatToolChoiceNone$outboundSchema,
  ChatToolChoiceAuto$outboundSchema,
  ChatToolChoiceRequired$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/contextcompressionengine.js
var z64 = __toESM(require("zod/v4"), 1);
var ContextCompressionEngine = {
  MiddleOut: "middle-out"
};
var ContextCompressionEngine$outboundSchema = z64.enum(ContextCompressionEngine);

// node_modules/@openrouter/sdk/esm/models/datacollection.js
var DataCollection = {
  Deny: "deny",
  Allow: "allow"
};
var DataCollection$outboundSchema = outboundSchema(DataCollection);

// node_modules/@openrouter/sdk/esm/models/formatjsonobjectconfig.js
var z65 = __toESM(require("zod/v4"), 1);
var FormatJsonObjectConfig$inboundSchema = z65.object({
  type: z65.literal("json_object")
});
var FormatJsonObjectConfig$outboundSchema = z65.object({
  type: z65.literal("json_object")
});

// node_modules/@openrouter/sdk/esm/models/pdfparseroptions.js
var z67 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/pdfparserengine.js
var z66 = __toESM(require("zod/v4"), 1);
var PDFParserEnginePDFText = {
  PdfText: "pdf-text"
};
var PDFParserEngineEnum = {
  MistralOcr: "mistral-ocr",
  Native: "native",
  CloudflareAi: "cloudflare-ai"
};
var PDFParserEnginePDFText$outboundSchema = z66.enum(PDFParserEnginePDFText);
var PDFParserEngineEnum$outboundSchema = outboundSchema(PDFParserEngineEnum);
var PDFParserEngine$outboundSchema = z66.union([
  PDFParserEngineEnum$outboundSchema,
  PDFParserEnginePDFText$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/pdfparseroptions.js
var PDFParserOptions$outboundSchema = z67.object({
  engine: PDFParserEngine$outboundSchema.optional()
});

// node_modules/@openrouter/sdk/esm/models/preferredmaxlatency.js
var z69 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/percentilelatencycutoffs.js
var z68 = __toESM(require("zod/v4"), 1);
var PercentileLatencyCutoffs$outboundSchema = z68.object({
  p50: z68.nullable(z68.number()).optional(),
  p75: z68.nullable(z68.number()).optional(),
  p90: z68.nullable(z68.number()).optional(),
  p99: z68.nullable(z68.number()).optional()
});

// node_modules/@openrouter/sdk/esm/models/preferredmaxlatency.js
var PreferredMaxLatency$outboundSchema = z69.union([z69.number(), PercentileLatencyCutoffs$outboundSchema, z69.any()]);

// node_modules/@openrouter/sdk/esm/models/preferredminthroughput.js
var z71 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/percentilethroughputcutoffs.js
var z70 = __toESM(require("zod/v4"), 1);
var PercentileThroughputCutoffs$outboundSchema = z70.object({
  p50: z70.nullable(z70.number()).optional(),
  p75: z70.nullable(z70.number()).optional(),
  p90: z70.nullable(z70.number()).optional(),
  p99: z70.nullable(z70.number()).optional()
});

// node_modules/@openrouter/sdk/esm/models/preferredminthroughput.js
var PreferredMinThroughput$outboundSchema = z71.union([z71.number(), PercentileThroughputCutoffs$outboundSchema, z71.any()]);

// node_modules/@openrouter/sdk/esm/models/providername.js
var ProviderName = {
  AkashML: "AkashML",
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
  Reka: "Reka",
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

// node_modules/@openrouter/sdk/esm/models/websearchengine.js
var WebSearchEngine = {
  Native: "native",
  Exa: "exa",
  Firecrawl: "firecrawl",
  Parallel: "parallel"
};
var WebSearchEngine$outboundSchema = outboundSchema(WebSearchEngine);

// node_modules/@openrouter/sdk/esm/models/chatrequest.js
var ChatRequestSortEnum = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency",
  Exacto: "exacto"
};
var ChatRequestProviderSortConfigEnum = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency",
  Exacto: "exacto"
};
var ChatRequestBy = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency",
  Exacto: "exacto"
};
var ChatRequestPartition = {
  Model: "model",
  None: "none"
};
var ChatRequestProviderSort = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency",
  Exacto: "exacto"
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
  Image: "image",
  Audio: "audio"
};
var ChatRequestType = {
  Ephemeral: "ephemeral"
};
var ChatRequestTtl = {
  Fivem: "5m",
  Oneh: "1h"
};
var ChatRequestServiceTier = {
  Auto: "auto",
  Default: "default",
  Flex: "flex",
  Priority: "priority",
  Scale: "scale"
};
var ChatRequestOrder$outboundSchema = z72.union([ProviderName$outboundSchema, z72.string()]);
var ChatRequestOnly$outboundSchema = z72.union([ProviderName$outboundSchema, z72.string()]);
var ChatRequestIgnore$outboundSchema = z72.union([ProviderName$outboundSchema, z72.string()]);
var ChatRequestSortEnum$outboundSchema = outboundSchema(ChatRequestSortEnum);
var ChatRequestProviderSortConfigEnum$outboundSchema = z72.enum(ChatRequestProviderSortConfigEnum);
var ChatRequestBy$outboundSchema = outboundSchema(ChatRequestBy);
var ChatRequestPartition$outboundSchema = outboundSchema(ChatRequestPartition);
var ChatRequestProviderSortConfig$outboundSchema = z72.object({
  by: z72.nullable(ChatRequestBy$outboundSchema).optional(),
  partition: z72.nullable(ChatRequestPartition$outboundSchema).optional()
});
var ChatRequestProviderSortConfigUnion$outboundSchema = z72.union([
  z72.lazy(() => ChatRequestProviderSortConfig$outboundSchema),
  ChatRequestProviderSortConfigEnum$outboundSchema
]);
var ChatRequestProviderSort$outboundSchema = outboundSchema(ChatRequestProviderSort);
var ChatRequestSortUnion$outboundSchema = z72.union([
  ChatRequestProviderSort$outboundSchema,
  z72.union([
    z72.lazy(() => ChatRequestProviderSortConfig$outboundSchema),
    ChatRequestProviderSortConfigEnum$outboundSchema
  ]),
  ChatRequestSortEnum$outboundSchema
]);
var ChatRequestMaxPrice$outboundSchema = z72.object({
  prompt: z72.string().optional(),
  completion: z72.string().optional(),
  image: z72.string().optional(),
  audio: z72.string().optional(),
  request: z72.string().optional()
});
var ChatRequestProvider$outboundSchema = z72.object({
  allowFallbacks: z72.nullable(z72.boolean()).optional(),
  requireParameters: z72.nullable(z72.boolean()).optional(),
  dataCollection: z72.nullable(DataCollection$outboundSchema).optional(),
  zdr: z72.nullable(z72.boolean()).optional(),
  enforceDistillableText: z72.nullable(z72.boolean()).optional(),
  order: z72.nullable(z72.array(z72.union([ProviderName$outboundSchema, z72.string()]))).optional(),
  only: z72.nullable(z72.array(z72.union([ProviderName$outboundSchema, z72.string()]))).optional(),
  ignore: z72.nullable(z72.array(z72.union([ProviderName$outboundSchema, z72.string()]))).optional(),
  quantizations: z72.nullable(z72.array(Quantization$outboundSchema)).optional(),
  sort: z72.nullable(z72.union([
    ChatRequestProviderSort$outboundSchema,
    z72.union([
      z72.lazy(() => ChatRequestProviderSortConfig$outboundSchema),
      ChatRequestProviderSortConfigEnum$outboundSchema
    ]),
    ChatRequestSortEnum$outboundSchema
  ])).optional(),
  maxPrice: z72.lazy(() => ChatRequestMaxPrice$outboundSchema).optional(),
  preferredMinThroughput: z72.nullable(PreferredMinThroughput$outboundSchema).optional(),
  preferredMaxLatency: z72.nullable(PreferredMaxLatency$outboundSchema).optional()
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
var ChatRequestPluginContextCompression$outboundSchema = z72.object({
  id: z72.literal("context-compression"),
  enabled: z72.boolean().optional(),
  engine: ContextCompressionEngine$outboundSchema.optional()
});
var ChatRequestPluginResponseHealing$outboundSchema = z72.object({
  id: z72.literal("response-healing"),
  enabled: z72.boolean().optional()
});
var ChatRequestPluginFileParser$outboundSchema = z72.object({
  id: z72.literal("file-parser"),
  enabled: z72.boolean().optional(),
  pdf: PDFParserOptions$outboundSchema.optional()
});
var ChatRequestPluginWeb$outboundSchema = z72.object({
  id: z72.literal("web"),
  enabled: z72.boolean().optional(),
  maxResults: z72.number().optional(),
  searchPrompt: z72.string().optional(),
  engine: WebSearchEngine$outboundSchema.optional(),
  includeDomains: z72.array(z72.string()).optional(),
  excludeDomains: z72.array(z72.string()).optional()
}).transform((v) => {
  return remap(v, {
    maxResults: "max_results",
    searchPrompt: "search_prompt",
    includeDomains: "include_domains",
    excludeDomains: "exclude_domains"
  });
});
var ChatRequestPluginModeration$outboundSchema = z72.object({
  id: z72.literal("moderation")
});
var ChatRequestPluginAutoRouter$outboundSchema = z72.object({
  id: z72.literal("auto-router"),
  enabled: z72.boolean().optional(),
  allowedModels: z72.array(z72.string()).optional()
}).transform((v) => {
  return remap(v, {
    allowedModels: "allowed_models"
  });
});
var ChatRequestPluginUnion$outboundSchema = z72.union([
  z72.lazy(() => ChatRequestPluginAutoRouter$outboundSchema),
  z72.lazy(() => ChatRequestPluginModeration$outboundSchema),
  z72.lazy(() => ChatRequestPluginWeb$outboundSchema),
  z72.lazy(() => ChatRequestPluginFileParser$outboundSchema),
  z72.lazy(() => ChatRequestPluginResponseHealing$outboundSchema),
  z72.lazy(() => ChatRequestPluginContextCompression$outboundSchema)
]);
var ChatRequestTrace$outboundSchema = z72.object({
  traceId: z72.string().optional(),
  traceName: z72.string().optional(),
  spanName: z72.string().optional(),
  generationName: z72.string().optional(),
  parentSpanId: z72.string().optional(),
  additionalProperties: z72.record(z72.string(), z72.nullable(z72.any())).optional()
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
var Reasoning$outboundSchema = z72.object({
  effort: z72.nullable(Effort$outboundSchema).optional(),
  summary: z72.nullable(z72.any()).optional()
});
var ResponseFormat$outboundSchema = z72.union([
  ChatFormatTextConfig$outboundSchema,
  FormatJsonObjectConfig$outboundSchema,
  ChatFormatJsonSchemaConfig$outboundSchema,
  ChatFormatGrammarConfig$outboundSchema,
  ChatFormatPythonConfig$outboundSchema
]);
var Stop$outboundSchema = z72.union([
  z72.string(),
  z72.array(z72.string()),
  z72.any()
]);
var ChatRequestImageConfig$outboundSchema = z72.union([z72.string(), z72.number(), z72.array(z72.nullable(z72.any()))]);
var Modality$outboundSchema = outboundSchema(Modality);
var ChatRequestType$outboundSchema = z72.enum(ChatRequestType);
var ChatRequestTtl$outboundSchema = outboundSchema(ChatRequestTtl);
var CacheControl$outboundSchema = z72.object({
  type: ChatRequestType$outboundSchema,
  ttl: ChatRequestTtl$outboundSchema.optional()
});
var ChatRequestServiceTier$outboundSchema = outboundSchema(ChatRequestServiceTier);
var ChatRequest$outboundSchema = z72.object({
  provider: z72.nullable(z72.lazy(() => ChatRequestProvider$outboundSchema)).optional(),
  plugins: z72.array(z72.union([
    z72.lazy(() => ChatRequestPluginAutoRouter$outboundSchema),
    z72.lazy(() => ChatRequestPluginModeration$outboundSchema),
    z72.lazy(() => ChatRequestPluginWeb$outboundSchema),
    z72.lazy(() => ChatRequestPluginFileParser$outboundSchema),
    z72.lazy(() => ChatRequestPluginResponseHealing$outboundSchema),
    z72.lazy(() => ChatRequestPluginContextCompression$outboundSchema)
  ])).optional(),
  user: z72.string().optional(),
  sessionId: z72.string().optional(),
  trace: z72.lazy(() => ChatRequestTrace$outboundSchema).optional(),
  messages: z72.array(ChatMessages$outboundSchema),
  model: z72.string().optional(),
  models: z72.array(z72.string()).optional(),
  frequencyPenalty: z72.nullable(z72.number()).optional(),
  logitBias: z72.nullable(z72.record(z72.string(), z72.number())).optional(),
  logprobs: z72.nullable(z72.boolean()).optional(),
  topLogprobs: z72.nullable(z72.number()).optional(),
  maxCompletionTokens: z72.nullable(z72.number()).optional(),
  maxTokens: z72.nullable(z72.number()).optional(),
  metadata: z72.record(z72.string(), z72.string()).optional(),
  presencePenalty: z72.nullable(z72.number()).optional(),
  reasoning: z72.lazy(() => Reasoning$outboundSchema).optional(),
  responseFormat: z72.union([
    ChatFormatTextConfig$outboundSchema,
    FormatJsonObjectConfig$outboundSchema,
    ChatFormatJsonSchemaConfig$outboundSchema,
    ChatFormatGrammarConfig$outboundSchema,
    ChatFormatPythonConfig$outboundSchema
  ]).optional(),
  seed: z72.nullable(z72.int()).optional(),
  stop: z72.nullable(z72.union([z72.string(), z72.array(z72.string()), z72.any()])).optional(),
  stream: z72.boolean().default(false),
  streamOptions: z72.nullable(ChatStreamOptions$outboundSchema).optional(),
  temperature: z72.nullable(z72.number().default(1)),
  parallelToolCalls: z72.nullable(z72.boolean()).optional(),
  toolChoice: ChatToolChoice$outboundSchema.optional(),
  tools: z72.array(ChatFunctionTool$outboundSchema).optional(),
  topP: z72.nullable(z72.number().default(1)),
  debug: ChatDebugOptions$outboundSchema.optional(),
  imageConfig: z72.record(z72.string(), z72.union([z72.string(), z72.number(), z72.array(z72.nullable(z72.any()))])).optional(),
  modalities: z72.array(Modality$outboundSchema).optional(),
  cacheControl: z72.lazy(() => CacheControl$outboundSchema).optional(),
  serviceTier: z72.nullable(ChatRequestServiceTier$outboundSchema).optional()
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
    imageConfig: "image_config",
    cacheControl: "cache_control",
    serviceTier: "service_tier"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatresult.js
var z74 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatusage.js
var z73 = __toESM(require("zod/v4"), 1);
var CompletionTokensDetails$inboundSchema = z73.object({
  reasoning_tokens: z73.nullable(z73.number()).optional(),
  audio_tokens: z73.nullable(z73.number()).optional(),
  accepted_prediction_tokens: z73.nullable(z73.number()).optional(),
  rejected_prediction_tokens: z73.nullable(z73.number()).optional()
}).transform((v) => {
  return remap(v, {
    "reasoning_tokens": "reasoningTokens",
    "audio_tokens": "audioTokens",
    "accepted_prediction_tokens": "acceptedPredictionTokens",
    "rejected_prediction_tokens": "rejectedPredictionTokens"
  });
});
var PromptTokensDetails$inboundSchema = z73.object({
  cached_tokens: z73.number().optional(),
  cache_write_tokens: z73.number().optional(),
  audio_tokens: z73.number().optional(),
  video_tokens: z73.number().optional()
}).transform((v) => {
  return remap(v, {
    "cached_tokens": "cachedTokens",
    "cache_write_tokens": "cacheWriteTokens",
    "audio_tokens": "audioTokens",
    "video_tokens": "videoTokens"
  });
});
var ChatUsage$inboundSchema = z73.object({
  completion_tokens: z73.number(),
  prompt_tokens: z73.number(),
  total_tokens: z73.number(),
  completion_tokens_details: z73.nullable(z73.lazy(() => CompletionTokensDetails$inboundSchema)).optional(),
  prompt_tokens_details: z73.nullable(z73.lazy(() => PromptTokensDetails$inboundSchema)).optional()
}).transform((v) => {
  return remap(v, {
    "completion_tokens": "completionTokens",
    "prompt_tokens": "promptTokens",
    "total_tokens": "totalTokens",
    "completion_tokens_details": "completionTokensDetails",
    "prompt_tokens_details": "promptTokensDetails"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatresult.js
var ChatResultObject = {
  ChatCompletion: "chat.completion"
};
var ChatResultObject$inboundSchema = z74.enum(ChatResultObject);
var ChatResult$inboundSchema = z74.object({
  id: z74.string(),
  choices: z74.array(ChatChoice$inboundSchema),
  created: z74.number(),
  model: z74.string(),
  object: ChatResultObject$inboundSchema,
  system_fingerprint: z74.nullable(z74.string()),
  service_tier: z74.nullable(z74.string()).optional(),
  usage: ChatUsage$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "system_fingerprint": "systemFingerprint",
    "service_tier": "serviceTier"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatstreamchoice.js
var z77 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatstreamdelta.js
var z76 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/chatstreamtoolcall.js
var z75 = __toESM(require("zod/v4"), 1);
var ChatStreamToolCallType = {
  Function: "function"
};
var ChatStreamToolCallType$inboundSchema = z75.enum(ChatStreamToolCallType);
var ChatStreamToolCallFunction$inboundSchema = z75.object({
  name: z75.string().optional(),
  arguments: z75.string().optional()
});
var ChatStreamToolCall$inboundSchema = z75.object({
  index: z75.number(),
  id: z75.string().optional(),
  type: ChatStreamToolCallType$inboundSchema.optional(),
  function: z75.lazy(() => ChatStreamToolCallFunction$inboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/chatstreamdelta.js
var ChatStreamDeltaRole = {
  Assistant: "assistant"
};
var ChatStreamDeltaRole$inboundSchema = z76.enum(ChatStreamDeltaRole);
var ChatStreamDelta$inboundSchema = z76.object({
  role: ChatStreamDeltaRole$inboundSchema.optional(),
  content: z76.nullable(z76.string()).optional(),
  reasoning: z76.nullable(z76.string()).optional(),
  refusal: z76.nullable(z76.string()).optional(),
  tool_calls: z76.array(ChatStreamToolCall$inboundSchema).optional(),
  reasoning_details: z76.array(ReasoningDetailUnion$inboundSchema).optional(),
  audio: ChatAudioOutput$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "tool_calls": "toolCalls",
    "reasoning_details": "reasoningDetails"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatstreamchoice.js
var ChatStreamChoice$inboundSchema = z77.object({
  delta: ChatStreamDelta$inboundSchema,
  finish_reason: z77.nullable(z77.any()),
  index: z77.number(),
  logprobs: z77.nullable(ChatTokenLogprobs$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "finish_reason": "finishReason"
  });
});

// node_modules/@openrouter/sdk/esm/models/chatstreamchunk.js
var z78 = __toESM(require("zod/v4"), 1);
var ChatStreamChunkObject = {
  ChatCompletionChunk: "chat.completion.chunk"
};
var ChatStreamChunkObject$inboundSchema = z78.enum(ChatStreamChunkObject);
var ErrorT$inboundSchema = z78.object({
  message: z78.string(),
  code: z78.number()
});
var ChatStreamChunk$inboundSchema = z78.object({
  id: z78.string(),
  choices: z78.array(ChatStreamChoice$inboundSchema),
  created: z78.number(),
  model: z78.string(),
  object: ChatStreamChunkObject$inboundSchema,
  system_fingerprint: z78.string().optional(),
  service_tier: z78.nullable(z78.string()).optional(),
  error: z78.lazy(() => ErrorT$inboundSchema).optional(),
  usage: ChatUsage$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "system_fingerprint": "systemFingerprint",
    "service_tier": "serviceTier"
  });
});

// node_modules/@openrouter/sdk/esm/models/codeinterpreterservertool.js
var z79 = __toESM(require("zod/v4"), 1);
var ContainerType = {
  Auto: "auto"
};
var MemoryLimit = {
  Oneg: "1g",
  Fourg: "4g",
  Sixteeng: "16g",
  SixtyFourg: "64g"
};
var ContainerType$inboundSchema = z79.enum(ContainerType);
var ContainerType$outboundSchema = ContainerType$inboundSchema;
var MemoryLimit$inboundSchema = inboundSchema(MemoryLimit);
var MemoryLimit$outboundSchema = outboundSchema(MemoryLimit);
var ContainerAuto$inboundSchema = z79.object({
  type: ContainerType$inboundSchema,
  file_ids: z79.array(z79.string()).optional(),
  memory_limit: z79.nullable(MemoryLimit$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "file_ids": "fileIds",
    "memory_limit": "memoryLimit"
  });
});
var ContainerAuto$outboundSchema = z79.object({
  type: ContainerType$outboundSchema,
  fileIds: z79.array(z79.string()).optional(),
  memoryLimit: z79.nullable(MemoryLimit$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    fileIds: "file_ids",
    memoryLimit: "memory_limit"
  });
});
var Container$inboundSchema = z79.union([
  z79.lazy(() => ContainerAuto$inboundSchema),
  z79.string()
]);
var Container$outboundSchema = z79.union([z79.lazy(() => ContainerAuto$outboundSchema), z79.string()]);
var CodeInterpreterServerTool$inboundSchema = z79.object({
  type: z79.literal("code_interpreter"),
  container: z79.union([z79.lazy(() => ContainerAuto$inboundSchema), z79.string()])
});
var CodeInterpreterServerTool$outboundSchema = z79.object({
  type: z79.literal("code_interpreter"),
  container: z79.union([z79.lazy(() => ContainerAuto$outboundSchema), z79.string()])
});

// node_modules/@openrouter/sdk/esm/models/codexlocalshelltool.js
var z80 = __toESM(require("zod/v4"), 1);
var CodexLocalShellTool$inboundSchema = z80.object({
  type: z80.literal("local_shell")
});
var CodexLocalShellTool$outboundSchema = z80.object({
  type: z80.literal("local_shell")
});

// node_modules/@openrouter/sdk/esm/models/compoundfilter.js
var z81 = __toESM(require("zod/v4"), 1);
var CompoundFilterType = {
  And: "and",
  Or: "or"
};
var CompoundFilterType$inboundSchema = inboundSchema(CompoundFilterType);
var CompoundFilterType$outboundSchema = outboundSchema(CompoundFilterType);
var CompoundFilter$inboundSchema = z81.object({
  type: CompoundFilterType$inboundSchema,
  filters: z81.array(z81.record(z81.string(), z81.nullable(z81.any())))
});
var CompoundFilter$outboundSchema = z81.object({
  type: CompoundFilterType$outboundSchema,
  filters: z81.array(z81.record(z81.string(), z81.nullable(z81.any())))
});

// node_modules/@openrouter/sdk/esm/models/computeruseservertool.js
var z82 = __toESM(require("zod/v4"), 1);
var Environment = {
  Windows: "windows",
  Mac: "mac",
  Linux: "linux",
  Ubuntu: "ubuntu",
  Browser: "browser"
};
var Environment$inboundSchema = inboundSchema(Environment);
var Environment$outboundSchema = outboundSchema(Environment);
var ComputerUseServerTool$inboundSchema = z82.object({
  type: z82.literal("computer_use_preview"),
  display_height: z82.number(),
  display_width: z82.number(),
  environment: Environment$inboundSchema
}).transform((v) => {
  return remap(v, {
    "display_height": "displayHeight",
    "display_width": "displayWidth"
  });
});
var ComputerUseServerTool$outboundSchema = z82.object({
  type: z82.literal("computer_use_preview"),
  displayHeight: z82.number(),
  displayWidth: z82.number(),
  environment: Environment$outboundSchema
}).transform((v) => {
  return remap(v, {
    displayHeight: "display_height",
    displayWidth: "display_width"
  });
});

// node_modules/@openrouter/sdk/esm/models/conflictresponseerrordata.js
var z83 = __toESM(require("zod/v4"), 1);
var ConflictResponseErrorData$inboundSchema = z83.object({
  code: z83.int(),
  message: z83.string(),
  metadata: z83.nullable(z83.record(z83.string(), z83.nullable(z83.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/contentpartaddedevent.js
var z85 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/reasoningtextcontent.js
var z84 = __toESM(require("zod/v4"), 1);
var ReasoningTextContentType = {
  ReasoningText: "reasoning_text"
};
var ReasoningTextContentType$inboundSchema = z84.enum(ReasoningTextContentType);
var ReasoningTextContentType$outboundSchema = ReasoningTextContentType$inboundSchema;
var ReasoningTextContent$inboundSchema = z84.object({
  type: ReasoningTextContentType$inboundSchema,
  text: z84.string()
});
var ReasoningTextContent$outboundSchema = z84.object({
  type: ReasoningTextContentType$outboundSchema,
  text: z84.string()
});

// node_modules/@openrouter/sdk/esm/models/contentpartaddedevent.js
var ContentPartAddedEventPart$inboundSchema = z85.union([
  ResponseOutputText$inboundSchema,
  ReasoningTextContent$inboundSchema.and(z85.object({ type: z85.literal("reasoning_text") })),
  OpenAIResponsesRefusalContent$inboundSchema
]);
var ContentPartAddedEvent$inboundSchema = z85.object({
  type: z85.literal("response.content_part.added"),
  output_index: z85.number(),
  item_id: z85.string(),
  content_index: z85.number(),
  part: z85.union([
    ResponseOutputText$inboundSchema,
    ReasoningTextContent$inboundSchema.and(z85.object({ type: z85.literal("reasoning_text") })),
    OpenAIResponsesRefusalContent$inboundSchema
  ]),
  sequence_number: z85.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/contentpartdoneevent.js
var z86 = __toESM(require("zod/v4"), 1);
var ContentPartDoneEventPart$inboundSchema = z86.union([
  ResponseOutputText$inboundSchema,
  ReasoningTextContent$inboundSchema.and(z86.object({ type: z86.literal("reasoning_text") })),
  OpenAIResponsesRefusalContent$inboundSchema
]);
var ContentPartDoneEvent$inboundSchema = z86.object({
  type: z86.literal("response.content_part.done"),
  output_index: z86.number(),
  item_id: z86.string(),
  content_index: z86.number(),
  part: z86.union([
    ResponseOutputText$inboundSchema,
    ReasoningTextContent$inboundSchema.and(z86.object({ type: z86.literal("reasoning_text") })),
    OpenAIResponsesRefusalContent$inboundSchema
  ]),
  sequence_number: z86.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/createchargerequest.js
var z87 = __toESM(require("zod/v4"), 1);
var ChainId = {
  One: 1,
  OneHundredAndThirtySeven: 137,
  EightThousandFourHundredAndFiftyThree: 8453
};
var ChainId$outboundSchema = outboundSchemaInt(ChainId);
var CreateChargeRequest$outboundSchema = z87.object({
  amount: z87.number(),
  sender: z87.string(),
  chainId: ChainId$outboundSchema
}).transform((v) => {
  return remap(v, {
    chainId: "chain_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/customtool.js
var z88 = __toESM(require("zod/v4"), 1);
var Syntax = {
  Lark: "lark",
  Regex: "regex"
};
var Syntax$inboundSchema = inboundSchema(Syntax);
var Syntax$outboundSchema = outboundSchema(Syntax);
var FormatGrammar$inboundSchema = z88.object({
  type: z88.literal("grammar"),
  definition: z88.string(),
  syntax: Syntax$inboundSchema
});
var FormatGrammar$outboundSchema = z88.object({
  type: z88.literal("grammar"),
  definition: z88.string(),
  syntax: Syntax$outboundSchema
});
var FormatText$inboundSchema = z88.object({
  type: z88.literal("text")
});
var FormatText$outboundSchema = z88.object({
  type: z88.literal("text")
});
var Format$inboundSchema = z88.union([
  z88.lazy(() => FormatText$inboundSchema),
  z88.lazy(() => FormatGrammar$inboundSchema)
]);
var Format$outboundSchema = z88.union([
  z88.lazy(() => FormatText$outboundSchema),
  z88.lazy(() => FormatGrammar$outboundSchema)
]);
var CustomTool$inboundSchema = z88.object({
  type: z88.literal("custom"),
  name: z88.string(),
  description: z88.string().optional(),
  format: z88.union([
    z88.lazy(() => FormatText$inboundSchema),
    z88.lazy(() => FormatGrammar$inboundSchema)
  ]).optional()
});
var CustomTool$outboundSchema = z88.object({
  type: z88.literal("custom"),
  name: z88.string(),
  description: z88.string().optional(),
  format: z88.union([
    z88.lazy(() => FormatText$outboundSchema),
    z88.lazy(() => FormatGrammar$outboundSchema)
  ]).optional()
});

// node_modules/@openrouter/sdk/esm/models/defaultparameters.js
var z89 = __toESM(require("zod/v4"), 1);
var DefaultParameters$inboundSchema = z89.object({
  temperature: z89.nullable(z89.number()).optional(),
  top_p: z89.nullable(z89.number()).optional(),
  top_k: z89.nullable(z89.int()).optional(),
  frequency_penalty: z89.nullable(z89.number()).optional(),
  presence_penalty: z89.nullable(z89.number()).optional(),
  repetition_penalty: z89.nullable(z89.number()).optional()
}).transform((v) => {
  return remap(v, {
    "top_p": "topP",
    "top_k": "topK",
    "frequency_penalty": "frequencyPenalty",
    "presence_penalty": "presencePenalty",
    "repetition_penalty": "repetitionPenalty"
  });
});

// node_modules/@openrouter/sdk/esm/models/easyinputmessage.js
var z91 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/inputvideo.js
var z90 = __toESM(require("zod/v4"), 1);
var InputVideo$outboundSchema = z90.object({
  type: z90.literal("input_video"),
  videoUrl: z90.string()
}).transform((v) => {
  return remap(v, {
    videoUrl: "video_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/easyinputmessage.js
var EasyInputMessageTypeMessage = {
  Message: "message"
};
var EasyInputMessageRoleDeveloper = {
  Developer: "developer"
};
var EasyInputMessageRoleAssistant = {
  Assistant: "assistant"
};
var EasyInputMessageRoleSystem = {
  System: "system"
};
var EasyInputMessageRoleUser = {
  User: "user"
};
var EasyInputMessageDetail = {
  Auto: "auto",
  High: "high",
  Low: "low"
};
var EasyInputMessagePhaseFinalAnswer = {
  FinalAnswer: "final_answer"
};
var EasyInputMessagePhaseCommentary = {
  Commentary: "commentary"
};
var EasyInputMessageTypeMessage$outboundSchema = z91.enum(EasyInputMessageTypeMessage);
var EasyInputMessageRoleDeveloper$outboundSchema = z91.enum(EasyInputMessageRoleDeveloper);
var EasyInputMessageRoleAssistant$outboundSchema = z91.enum(EasyInputMessageRoleAssistant);
var EasyInputMessageRoleSystem$outboundSchema = z91.enum(EasyInputMessageRoleSystem);
var EasyInputMessageRoleUser$outboundSchema = z91.enum(EasyInputMessageRoleUser);
var EasyInputMessageRoleUnion$outboundSchema = z91.union([
  EasyInputMessageRoleUser$outboundSchema,
  EasyInputMessageRoleSystem$outboundSchema,
  EasyInputMessageRoleAssistant$outboundSchema,
  EasyInputMessageRoleDeveloper$outboundSchema
]);
var EasyInputMessageDetail$outboundSchema = outboundSchema(EasyInputMessageDetail);
var EasyInputMessageContentInputImage$outboundSchema = z91.object({
  type: z91.literal("input_image"),
  detail: EasyInputMessageDetail$outboundSchema,
  imageUrl: z91.nullable(z91.string()).optional()
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});
var EasyInputMessageContentUnion1$outboundSchema = z91.union([
  InputText$outboundSchema,
  z91.lazy(() => EasyInputMessageContentInputImage$outboundSchema),
  InputFile$outboundSchema,
  InputAudio$outboundSchema,
  InputVideo$outboundSchema
]);
var EasyInputMessageContentUnion2$outboundSchema = z91.union([
  z91.array(z91.union([
    InputText$outboundSchema,
    z91.lazy(() => EasyInputMessageContentInputImage$outboundSchema),
    InputFile$outboundSchema,
    InputAudio$outboundSchema,
    InputVideo$outboundSchema
  ])),
  z91.string(),
  z91.any()
]);
var EasyInputMessagePhaseFinalAnswer$outboundSchema = z91.enum(EasyInputMessagePhaseFinalAnswer);
var EasyInputMessagePhaseCommentary$outboundSchema = z91.enum(EasyInputMessagePhaseCommentary);
var EasyInputMessagePhaseUnion$outboundSchema = z91.union([
  EasyInputMessagePhaseCommentary$outboundSchema,
  EasyInputMessagePhaseFinalAnswer$outboundSchema,
  z91.any()
]);
var EasyInputMessage$outboundSchema = z91.object({
  type: EasyInputMessageTypeMessage$outboundSchema.optional(),
  role: z91.union([
    EasyInputMessageRoleUser$outboundSchema,
    EasyInputMessageRoleSystem$outboundSchema,
    EasyInputMessageRoleAssistant$outboundSchema,
    EasyInputMessageRoleDeveloper$outboundSchema
  ]),
  content: z91.nullable(z91.union([
    z91.array(z91.union([
      InputText$outboundSchema,
      z91.lazy(() => EasyInputMessageContentInputImage$outboundSchema),
      InputFile$outboundSchema,
      InputAudio$outboundSchema,
      InputVideo$outboundSchema
    ])),
    z91.string(),
    z91.any()
  ])).optional(),
  phase: z91.nullable(z91.union([
    EasyInputMessagePhaseCommentary$outboundSchema,
    EasyInputMessagePhaseFinalAnswer$outboundSchema,
    z91.any()
  ])).optional()
});

// node_modules/@openrouter/sdk/esm/models/edgenetworktimeoutresponseerrordata.js
var z92 = __toESM(require("zod/v4"), 1);
var EdgeNetworkTimeoutResponseErrorData$inboundSchema = z92.object({
  code: z92.int(),
  message: z92.string(),
  metadata: z92.nullable(z92.record(z92.string(), z92.nullable(z92.any()))).optional()
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

// node_modules/@openrouter/sdk/esm/models/errorevent.js
var z93 = __toESM(require("zod/v4"), 1);
var ErrorEvent$inboundSchema = z93.object({
  type: z93.literal("error"),
  code: z93.nullable(z93.string()),
  message: z93.string(),
  param: z93.nullable(z93.string()),
  sequence_number: z93.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/filesearchservertool.js
var z94 = __toESM(require("zod/v4"), 1);
var FiltersType = {
  Eq: "eq",
  Ne: "ne",
  Gt: "gt",
  Gte: "gte",
  Lt: "lt",
  Lte: "lte"
};
var Ranker = {
  Auto: "auto",
  Default20241115: "default-2024-11-15"
};
var FiltersType$inboundSchema = inboundSchema(FiltersType);
var FiltersType$outboundSchema = outboundSchema(FiltersType);
var Value1$inboundSchema = z94.union([
  z94.string(),
  z94.number()
]);
var Value1$outboundSchema = z94.union([z94.string(), z94.number()]);
var Value2$inboundSchema = z94.union([
  z94.string(),
  z94.number(),
  z94.boolean(),
  z94.array(z94.union([z94.string(), z94.number()]))
]);
var Value2$outboundSchema = z94.union([
  z94.string(),
  z94.number(),
  z94.boolean(),
  z94.array(z94.union([z94.string(), z94.number()]))
]);
var FileSearchServerToolFilters$inboundSchema = z94.object({
  key: z94.string(),
  type: FiltersType$inboundSchema,
  value: z94.union([
    z94.string(),
    z94.number(),
    z94.boolean(),
    z94.array(z94.union([z94.string(), z94.number()]))
  ])
});
var FileSearchServerToolFilters$outboundSchema = z94.object({
  key: z94.string(),
  type: FiltersType$outboundSchema,
  value: z94.union([
    z94.string(),
    z94.number(),
    z94.boolean(),
    z94.array(z94.union([z94.string(), z94.number()]))
  ])
});
var Filters$inboundSchema = z94.union([
  z94.lazy(() => FileSearchServerToolFilters$inboundSchema),
  CompoundFilter$inboundSchema,
  z94.any()
]);
var Filters$outboundSchema = z94.union([
  z94.lazy(() => FileSearchServerToolFilters$outboundSchema),
  CompoundFilter$outboundSchema,
  z94.any()
]);
var Ranker$inboundSchema = inboundSchema(Ranker);
var Ranker$outboundSchema = outboundSchema(Ranker);
var RankingOptions$inboundSchema = z94.object({
  ranker: Ranker$inboundSchema.optional(),
  score_threshold: z94.number().optional()
}).transform((v) => {
  return remap(v, {
    "score_threshold": "scoreThreshold"
  });
});
var RankingOptions$outboundSchema = z94.object({
  ranker: Ranker$outboundSchema.optional(),
  scoreThreshold: z94.number().optional()
}).transform((v) => {
  return remap(v, {
    scoreThreshold: "score_threshold"
  });
});
var FileSearchServerTool$inboundSchema = z94.object({
  type: z94.literal("file_search"),
  vector_store_ids: z94.array(z94.string()),
  filters: z94.nullable(z94.union([
    z94.lazy(() => FileSearchServerToolFilters$inboundSchema),
    CompoundFilter$inboundSchema,
    z94.any()
  ])).optional(),
  max_num_results: z94.int().optional(),
  ranking_options: z94.lazy(() => RankingOptions$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "vector_store_ids": "vectorStoreIds",
    "max_num_results": "maxNumResults",
    "ranking_options": "rankingOptions"
  });
});
var FileSearchServerTool$outboundSchema = z94.object({
  type: z94.literal("file_search"),
  vectorStoreIds: z94.array(z94.string()),
  filters: z94.nullable(z94.union([
    z94.lazy(() => FileSearchServerToolFilters$outboundSchema),
    CompoundFilter$outboundSchema,
    z94.any()
  ])).optional(),
  maxNumResults: z94.int().optional(),
  rankingOptions: z94.lazy(() => RankingOptions$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    vectorStoreIds: "vector_store_ids",
    maxNumResults: "max_num_results",
    rankingOptions: "ranking_options"
  });
});

// node_modules/@openrouter/sdk/esm/models/forbiddenresponseerrordata.js
var z95 = __toESM(require("zod/v4"), 1);
var ForbiddenResponseErrorData$inboundSchema = z95.object({
  code: z95.int(),
  message: z95.string(),
  metadata: z95.nullable(z95.record(z95.string(), z95.nullable(z95.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/formatjsonschemaconfig.js
var z96 = __toESM(require("zod/v4"), 1);
var FormatJsonSchemaConfig$inboundSchema = z96.object({
  type: z96.literal("json_schema"),
  name: z96.string(),
  description: z96.string().optional(),
  strict: z96.nullable(z96.boolean()).optional(),
  schema: z96.record(z96.string(), z96.nullable(z96.any()))
});
var FormatJsonSchemaConfig$outboundSchema = z96.object({
  type: z96.literal("json_schema"),
  name: z96.string(),
  description: z96.string().optional(),
  strict: z96.nullable(z96.boolean()).optional(),
  schema: z96.record(z96.string(), z96.nullable(z96.any()))
});

// node_modules/@openrouter/sdk/esm/models/formats.js
var z98 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/formattextconfig.js
var z97 = __toESM(require("zod/v4"), 1);
var FormatTextConfig$inboundSchema = z97.object({
  type: z97.literal("text")
});
var FormatTextConfig$outboundSchema = z97.object({
  type: z97.literal("text")
});

// node_modules/@openrouter/sdk/esm/models/formats.js
var Formats$inboundSchema = z98.union([
  FormatTextConfig$inboundSchema,
  FormatJsonObjectConfig$inboundSchema,
  FormatJsonSchemaConfig$inboundSchema
]);
var Formats$outboundSchema = z98.union([
  FormatTextConfig$outboundSchema,
  FormatJsonObjectConfig$outboundSchema,
  FormatJsonSchemaConfig$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/functioncallargsdeltaevent.js
var z99 = __toESM(require("zod/v4"), 1);
var FunctionCallArgsDeltaEvent$inboundSchema = z99.object({
  type: z99.literal("response.function_call_arguments.delta"),
  item_id: z99.string(),
  output_index: z99.number(),
  delta: z99.string(),
  sequence_number: z99.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/functioncallargsdoneevent.js
var z100 = __toESM(require("zod/v4"), 1);
var FunctionCallArgsDoneEvent$inboundSchema = z100.object({
  type: z100.literal("response.function_call_arguments.done"),
  item_id: z100.string(),
  output_index: z100.number(),
  name: z100.string(),
  arguments: z100.string(),
  sequence_number: z100.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/functioncallitem.js
var z101 = __toESM(require("zod/v4"), 1);
var FunctionCallItemType = {
  FunctionCall: "function_call"
};
var FunctionCallItemType$outboundSchema = z101.enum(FunctionCallItemType);
var FunctionCallItem$outboundSchema = z101.object({
  type: FunctionCallItemType$outboundSchema,
  callId: z101.string(),
  name: z101.string(),
  arguments: z101.string(),
  id: z101.string(),
  status: z101.nullable(ToolCallStatusEnum$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    callId: "call_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/functioncalloutputitem.js
var z102 = __toESM(require("zod/v4"), 1);
var FunctionCallOutputItemTypeFunctionCallOutput = {
  FunctionCallOutput: "function_call_output"
};
var FunctionCallOutputItemDetail = {
  Auto: "auto",
  High: "high",
  Low: "low"
};
var FunctionCallOutputItemTypeFunctionCallOutput$outboundSchema = z102.enum(FunctionCallOutputItemTypeFunctionCallOutput);
var FunctionCallOutputItemDetail$outboundSchema = outboundSchema(FunctionCallOutputItemDetail);
var OutputInputImage$outboundSchema = z102.object({
  type: z102.literal("input_image"),
  detail: FunctionCallOutputItemDetail$outboundSchema,
  imageUrl: z102.nullable(z102.string()).optional()
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});
var FunctionCallOutputItemOutputUnion1$outboundSchema = z102.union([
  InputText$outboundSchema,
  z102.lazy(() => OutputInputImage$outboundSchema),
  InputFile$outboundSchema
]);
var FunctionCallOutputItemOutputUnion2$outboundSchema = z102.union([
  z102.string(),
  z102.array(z102.union([
    InputText$outboundSchema,
    z102.lazy(() => OutputInputImage$outboundSchema),
    InputFile$outboundSchema
  ]))
]);
var FunctionCallOutputItem$outboundSchema = z102.object({
  type: FunctionCallOutputItemTypeFunctionCallOutput$outboundSchema,
  id: z102.nullable(z102.string()).optional(),
  callId: z102.string(),
  output: z102.union([
    z102.string(),
    z102.array(z102.union([
      InputText$outboundSchema,
      z102.lazy(() => OutputInputImage$outboundSchema),
      InputFile$outboundSchema
    ]))
  ]),
  status: z102.nullable(ToolCallStatusEnum$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    callId: "call_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/imagegencallcompletedevent.js
var z103 = __toESM(require("zod/v4"), 1);
var ImageGenCallCompletedEvent$inboundSchema = z103.object({
  type: z103.literal("response.image_generation_call.completed"),
  item_id: z103.string(),
  output_index: z103.number(),
  sequence_number: z103.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/imagegencallgeneratingevent.js
var z104 = __toESM(require("zod/v4"), 1);
var ImageGenCallGeneratingEvent$inboundSchema = z104.object({
  type: z104.literal("response.image_generation_call.generating"),
  item_id: z104.string(),
  output_index: z104.number(),
  sequence_number: z104.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/imagegencallinprogressevent.js
var z105 = __toESM(require("zod/v4"), 1);
var ImageGenCallInProgressEvent$inboundSchema = z105.object({
  type: z105.literal("response.image_generation_call.in_progress"),
  item_id: z105.string(),
  output_index: z105.number(),
  sequence_number: z105.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/imagegencallpartialimageevent.js
var z106 = __toESM(require("zod/v4"), 1);
var ImageGenCallPartialImageEvent$inboundSchema = z106.object({
  type: z106.literal("response.image_generation_call.partial_image"),
  item_id: z106.string(),
  output_index: z106.number(),
  sequence_number: z106.number(),
  partial_image_b64: z106.string(),
  partial_image_index: z106.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber",
    "partial_image_b64": "partialImageB64",
    "partial_image_index": "partialImageIndex"
  });
});

// node_modules/@openrouter/sdk/esm/models/imagegenerationservertool.js
var z107 = __toESM(require("zod/v4"), 1);
var Background = {
  Transparent: "transparent",
  Opaque: "opaque",
  Auto: "auto"
};
var InputFidelity = {
  High: "high",
  Low: "low"
};
var ModelEnum = {
  GptImage1: "gpt-image-1",
  GptImage1Mini: "gpt-image-1-mini"
};
var Moderation = {
  Auto: "auto",
  Low: "low"
};
var OutputFormat = {
  Png: "png",
  Webp: "webp",
  Jpeg: "jpeg"
};
var Quality = {
  Low: "low",
  Medium: "medium",
  High: "high",
  Auto: "auto"
};
var Size = {
  OneThousandAndTwentyFourx1024: "1024x1024",
  OneThousandAndTwentyFourx1536: "1024x1536",
  OneThousandFiveHundredAndThirtySixx1024: "1536x1024",
  Auto: "auto"
};
var Background$inboundSchema = inboundSchema(Background);
var Background$outboundSchema = outboundSchema(Background);
var InputFidelity$inboundSchema = inboundSchema(InputFidelity);
var InputFidelity$outboundSchema = outboundSchema(InputFidelity);
var InputImageMask$inboundSchema = z107.object({
  image_url: z107.string().optional(),
  file_id: z107.string().optional()
}).transform((v) => {
  return remap(v, {
    "image_url": "imageUrl",
    "file_id": "fileId"
  });
});
var InputImageMask$outboundSchema = z107.object({
  imageUrl: z107.string().optional(),
  fileId: z107.string().optional()
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url",
    fileId: "file_id"
  });
});
var ModelEnum$inboundSchema = inboundSchema(ModelEnum);
var ModelEnum$outboundSchema = outboundSchema(ModelEnum);
var Moderation$inboundSchema = inboundSchema(Moderation);
var Moderation$outboundSchema = outboundSchema(Moderation);
var OutputFormat$inboundSchema = inboundSchema(OutputFormat);
var OutputFormat$outboundSchema = outboundSchema(OutputFormat);
var Quality$inboundSchema = inboundSchema(Quality);
var Quality$outboundSchema = outboundSchema(Quality);
var Size$inboundSchema = inboundSchema(Size);
var Size$outboundSchema = outboundSchema(Size);
var ImageGenerationServerTool$inboundSchema = z107.object({
  type: z107.literal("image_generation"),
  background: Background$inboundSchema.optional(),
  input_fidelity: z107.nullable(InputFidelity$inboundSchema).optional(),
  input_image_mask: z107.lazy(() => InputImageMask$inboundSchema).optional(),
  model: ModelEnum$inboundSchema.optional(),
  moderation: Moderation$inboundSchema.optional(),
  output_compression: z107.number().optional(),
  output_format: OutputFormat$inboundSchema.optional(),
  partial_images: z107.number().optional(),
  quality: Quality$inboundSchema.optional(),
  size: Size$inboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    "input_fidelity": "inputFidelity",
    "input_image_mask": "inputImageMask",
    "output_compression": "outputCompression",
    "output_format": "outputFormat",
    "partial_images": "partialImages"
  });
});
var ImageGenerationServerTool$outboundSchema = z107.object({
  type: z107.literal("image_generation"),
  background: Background$outboundSchema.optional(),
  inputFidelity: z107.nullable(InputFidelity$outboundSchema).optional(),
  inputImageMask: z107.lazy(() => InputImageMask$outboundSchema).optional(),
  model: ModelEnum$outboundSchema.optional(),
  moderation: Moderation$outboundSchema.optional(),
  outputCompression: z107.number().optional(),
  outputFormat: OutputFormat$outboundSchema.optional(),
  partialImages: z107.number().optional(),
  quality: Quality$outboundSchema.optional(),
  size: Size$outboundSchema.optional()
}).transform((v) => {
  return remap(v, {
    inputFidelity: "input_fidelity",
    inputImageMask: "input_image_mask",
    outputCompression: "output_compression",
    outputFormat: "output_format",
    partialImages: "partial_images"
  });
});

// node_modules/@openrouter/sdk/esm/models/incompletedetails.js
var z108 = __toESM(require("zod/v4"), 1);
var Reason = {
  MaxOutputTokens: "max_output_tokens",
  ContentFilter: "content_filter"
};
var Reason$inboundSchema = inboundSchema(Reason);
var IncompleteDetails$inboundSchema = z108.object({
  reason: Reason$inboundSchema.optional()
});

// node_modules/@openrouter/sdk/esm/models/inputmessageitem.js
var z109 = __toESM(require("zod/v4"), 1);
var InputMessageItemTypeMessage = {
  Message: "message"
};
var InputMessageItemRoleDeveloper = {
  Developer: "developer"
};
var InputMessageItemRoleSystem = {
  System: "system"
};
var InputMessageItemRoleUser = {
  User: "user"
};
var InputMessageItemDetail = {
  Auto: "auto",
  High: "high",
  Low: "low"
};
var InputMessageItemTypeMessage$outboundSchema = z109.enum(InputMessageItemTypeMessage);
var InputMessageItemRoleDeveloper$outboundSchema = z109.enum(InputMessageItemRoleDeveloper);
var InputMessageItemRoleSystem$outboundSchema = z109.enum(InputMessageItemRoleSystem);
var InputMessageItemRoleUser$outboundSchema = z109.enum(InputMessageItemRoleUser);
var InputMessageItemRoleUnion$outboundSchema = z109.union([
  InputMessageItemRoleUser$outboundSchema,
  InputMessageItemRoleSystem$outboundSchema,
  InputMessageItemRoleDeveloper$outboundSchema
]);
var InputMessageItemDetail$outboundSchema = outboundSchema(InputMessageItemDetail);
var InputMessageItemContentInputImage$outboundSchema = z109.object({
  type: z109.literal("input_image"),
  detail: InputMessageItemDetail$outboundSchema,
  imageUrl: z109.nullable(z109.string()).optional()
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});
var InputMessageItemContentUnion$outboundSchema = z109.union([
  InputText$outboundSchema,
  z109.lazy(() => InputMessageItemContentInputImage$outboundSchema),
  InputFile$outboundSchema,
  InputAudio$outboundSchema,
  InputVideo$outboundSchema
]);
var InputMessageItem$outboundSchema = z109.object({
  id: z109.string().optional(),
  type: InputMessageItemTypeMessage$outboundSchema.optional(),
  role: z109.union([
    InputMessageItemRoleUser$outboundSchema,
    InputMessageItemRoleSystem$outboundSchema,
    InputMessageItemRoleDeveloper$outboundSchema
  ]),
  content: z109.nullable(z109.array(z109.union([
    InputText$outboundSchema,
    z109.lazy(() => InputMessageItemContentInputImage$outboundSchema),
    InputFile$outboundSchema,
    InputAudio$outboundSchema,
    InputVideo$outboundSchema
  ]))).optional()
});

// node_modules/@openrouter/sdk/esm/models/inputmodality.js
var InputModality = {
  Text: "text",
  Image: "image",
  File: "file",
  Audio: "audio",
  Video: "video"
};
var InputModality$inboundSchema = inboundSchema(InputModality);

// node_modules/@openrouter/sdk/esm/models/inputsunion.js
var z118 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/outputdatetimeitem.js
var z110 = __toESM(require("zod/v4"), 1);
var OutputDatetimeItemType = {
  OpenrouterDatetime: "openrouter:datetime"
};
var OutputDatetimeItemStatus = {
  Completed: "completed",
  InProgress: "in_progress",
  Incomplete: "incomplete"
};
var OutputDatetimeItemType$outboundSchema = z110.enum(OutputDatetimeItemType);
var OutputDatetimeItemStatus$outboundSchema = outboundSchema(OutputDatetimeItemStatus);
var OutputDatetimeItem$outboundSchema = z110.object({
  type: OutputDatetimeItemType$outboundSchema,
  id: z110.string().optional(),
  status: OutputDatetimeItemStatus$outboundSchema,
  datetime: z110.string(),
  timezone: z110.string()
});

// node_modules/@openrouter/sdk/esm/models/outputfilesearchcallitem.js
var z111 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/websearchstatus.js
var WebSearchStatus = {
  Completed: "completed",
  Searching: "searching",
  InProgress: "in_progress",
  Failed: "failed"
};
var WebSearchStatus$inboundSchema = inboundSchema(WebSearchStatus);
var WebSearchStatus$outboundSchema = outboundSchema(WebSearchStatus);

// node_modules/@openrouter/sdk/esm/models/outputfilesearchcallitem.js
var OutputFileSearchCallItemType = {
  FileSearchCall: "file_search_call"
};
var OutputFileSearchCallItemType$inboundSchema = z111.enum(OutputFileSearchCallItemType);
var OutputFileSearchCallItemType$outboundSchema = OutputFileSearchCallItemType$inboundSchema;
var OutputFileSearchCallItem$inboundSchema = z111.object({
  type: OutputFileSearchCallItemType$inboundSchema,
  id: z111.string(),
  queries: z111.array(z111.string()),
  status: WebSearchStatus$inboundSchema
});
var OutputFileSearchCallItem$outboundSchema = z111.object({
  type: OutputFileSearchCallItemType$outboundSchema,
  id: z111.string(),
  queries: z111.array(z111.string()),
  status: WebSearchStatus$outboundSchema
});

// node_modules/@openrouter/sdk/esm/models/outputfunctioncallitem.js
var z112 = __toESM(require("zod/v4"), 1);
var OutputFunctionCallItemType = {
  FunctionCall: "function_call"
};
var OutputFunctionCallItemStatusInProgress = {
  InProgress: "in_progress"
};
var OutputFunctionCallItemStatusIncomplete = {
  Incomplete: "incomplete"
};
var OutputFunctionCallItemStatusCompleted = {
  Completed: "completed"
};
var OutputFunctionCallItemType$inboundSchema = z112.enum(OutputFunctionCallItemType);
var OutputFunctionCallItemType$outboundSchema = OutputFunctionCallItemType$inboundSchema;
var OutputFunctionCallItemStatusInProgress$inboundSchema = z112.enum(OutputFunctionCallItemStatusInProgress);
var OutputFunctionCallItemStatusInProgress$outboundSchema = OutputFunctionCallItemStatusInProgress$inboundSchema;
var OutputFunctionCallItemStatusIncomplete$inboundSchema = z112.enum(OutputFunctionCallItemStatusIncomplete);
var OutputFunctionCallItemStatusIncomplete$outboundSchema = OutputFunctionCallItemStatusIncomplete$inboundSchema;
var OutputFunctionCallItemStatusCompleted$inboundSchema = z112.enum(OutputFunctionCallItemStatusCompleted);
var OutputFunctionCallItemStatusCompleted$outboundSchema = OutputFunctionCallItemStatusCompleted$inboundSchema;
var OutputFunctionCallItemStatusUnion$inboundSchema = z112.union([
  OutputFunctionCallItemStatusCompleted$inboundSchema,
  OutputFunctionCallItemStatusIncomplete$inboundSchema,
  OutputFunctionCallItemStatusInProgress$inboundSchema
]);
var OutputFunctionCallItemStatusUnion$outboundSchema = z112.union([
  OutputFunctionCallItemStatusCompleted$outboundSchema,
  OutputFunctionCallItemStatusIncomplete$outboundSchema,
  OutputFunctionCallItemStatusInProgress$outboundSchema
]);
var OutputFunctionCallItem$inboundSchema = z112.object({
  type: OutputFunctionCallItemType$inboundSchema,
  id: z112.string().optional(),
  name: z112.string(),
  arguments: z112.string(),
  call_id: z112.string(),
  status: z112.union([
    OutputFunctionCallItemStatusCompleted$inboundSchema,
    OutputFunctionCallItemStatusIncomplete$inboundSchema,
    OutputFunctionCallItemStatusInProgress$inboundSchema
  ]).optional()
}).transform((v) => {
  return remap(v, {
    "call_id": "callId"
  });
});
var OutputFunctionCallItem$outboundSchema = z112.object({
  type: OutputFunctionCallItemType$outboundSchema,
  id: z112.string().optional(),
  name: z112.string(),
  arguments: z112.string(),
  callId: z112.string(),
  status: z112.union([
    OutputFunctionCallItemStatusCompleted$outboundSchema,
    OutputFunctionCallItemStatusIncomplete$outboundSchema,
    OutputFunctionCallItemStatusInProgress$outboundSchema
  ]).optional()
}).transform((v) => {
  return remap(v, {
    callId: "call_id"
  });
});

// node_modules/@openrouter/sdk/esm/models/outputimagegenerationcallitem.js
var z113 = __toESM(require("zod/v4"), 1);
var OutputImageGenerationCallItemType = {
  ImageGenerationCall: "image_generation_call"
};
var OutputImageGenerationCallItemType$inboundSchema = z113.enum(OutputImageGenerationCallItemType);
var OutputImageGenerationCallItemType$outboundSchema = OutputImageGenerationCallItemType$inboundSchema;
var OutputImageGenerationCallItem$inboundSchema = z113.object({
  type: OutputImageGenerationCallItemType$inboundSchema,
  id: z113.string(),
  result: z113.nullable(z113.string()).default(null),
  status: ImageGenerationStatus$inboundSchema
});
var OutputImageGenerationCallItem$outboundSchema = z113.object({
  type: OutputImageGenerationCallItemType$outboundSchema,
  id: z113.string(),
  result: z113.nullable(z113.string()).default(null),
  status: ImageGenerationStatus$outboundSchema
});

// node_modules/@openrouter/sdk/esm/models/outputservertoolitem.js
var z114 = __toESM(require("zod/v4"), 1);
var OutputServerToolItemStatus = {
  Completed: "completed",
  InProgress: "in_progress",
  Incomplete: "incomplete"
};
var OutputServerToolItemStatus$inboundSchema = inboundSchema(OutputServerToolItemStatus);
var OutputServerToolItemStatus$outboundSchema = outboundSchema(OutputServerToolItemStatus);
var OutputServerToolItem$inboundSchema = collectExtraKeys(z114.object({
  type: z114.string(),
  id: z114.string().optional(),
  status: OutputServerToolItemStatus$inboundSchema
}).catchall(z114.any()), "additionalProperties", true);
var OutputServerToolItem$outboundSchema = z114.object({
  type: z114.string(),
  id: z114.string().optional(),
  status: OutputServerToolItemStatus$outboundSchema,
  additionalProperties: z114.record(z114.string(), z114.nullable(z114.any())).optional()
}).transform((v) => {
  return {
    ...v.additionalProperties,
    ...remap(v, {
      additionalProperties: null
    })
  };
});

// node_modules/@openrouter/sdk/esm/models/outputwebsearchcallitem.js
var z115 = __toESM(require("zod/v4"), 1);
var TypeWebSearchCall = {
  WebSearchCall: "web_search_call"
};
var TypeURL = {
  Url: "url"
};
var TypeWebSearchCall$inboundSchema = z115.enum(TypeWebSearchCall);
var TypeWebSearchCall$outboundSchema = TypeWebSearchCall$inboundSchema;
var ActionFindInPage$inboundSchema = z115.object({
  type: z115.literal("find_in_page"),
  pattern: z115.string(),
  url: z115.string()
});
var ActionFindInPage$outboundSchema = z115.object({
  type: z115.literal("find_in_page"),
  pattern: z115.string(),
  url: z115.string()
});
var ActionOpenPage$inboundSchema = z115.object({
  type: z115.literal("open_page"),
  url: z115.nullable(z115.string()).optional()
});
var ActionOpenPage$outboundSchema = z115.object({
  type: z115.literal("open_page"),
  url: z115.nullable(z115.string()).optional()
});
var TypeURL$inboundSchema = z115.enum(TypeURL);
var TypeURL$outboundSchema = TypeURL$inboundSchema;
var Source$inboundSchema = z115.object({
  type: TypeURL$inboundSchema,
  url: z115.string()
});
var Source$outboundSchema = z115.object({
  type: TypeURL$outboundSchema,
  url: z115.string()
});
var ActionSearch$inboundSchema = z115.object({
  type: z115.literal("search"),
  query: z115.string(),
  queries: z115.array(z115.string()).optional(),
  sources: z115.array(z115.lazy(() => Source$inboundSchema)).optional()
});
var ActionSearch$outboundSchema = z115.object({
  type: z115.literal("search"),
  query: z115.string(),
  queries: z115.array(z115.string()).optional(),
  sources: z115.array(z115.lazy(() => Source$outboundSchema)).optional()
});
var Action$inboundSchema = z115.union([
  z115.lazy(() => ActionSearch$inboundSchema),
  z115.lazy(() => ActionOpenPage$inboundSchema),
  z115.lazy(() => ActionFindInPage$inboundSchema)
]);
var Action$outboundSchema = z115.union([
  z115.lazy(() => ActionSearch$outboundSchema),
  z115.lazy(() => ActionOpenPage$outboundSchema),
  z115.lazy(() => ActionFindInPage$outboundSchema)
]);
var OutputWebSearchCallItem$inboundSchema = z115.object({
  type: TypeWebSearchCall$inboundSchema,
  id: z115.string(),
  action: z115.union([
    z115.lazy(() => ActionSearch$inboundSchema),
    z115.lazy(() => ActionOpenPage$inboundSchema),
    z115.lazy(() => ActionFindInPage$inboundSchema)
  ]),
  status: WebSearchStatus$inboundSchema
});
var OutputWebSearchCallItem$outboundSchema = z115.object({
  type: TypeWebSearchCall$outboundSchema,
  id: z115.string(),
  action: z115.union([
    z115.lazy(() => ActionSearch$outboundSchema),
    z115.lazy(() => ActionOpenPage$outboundSchema),
    z115.lazy(() => ActionFindInPage$outboundSchema)
  ]),
  status: WebSearchStatus$outboundSchema
});

// node_modules/@openrouter/sdk/esm/models/reasoningitem.js
var z117 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/reasoningsummarytext.js
var z116 = __toESM(require("zod/v4"), 1);
var ReasoningSummaryTextType = {
  SummaryText: "summary_text"
};
var ReasoningSummaryTextType$inboundSchema = z116.enum(ReasoningSummaryTextType);
var ReasoningSummaryTextType$outboundSchema = ReasoningSummaryTextType$inboundSchema;
var ReasoningSummaryText$inboundSchema = z116.object({
  type: ReasoningSummaryTextType$inboundSchema,
  text: z116.string()
});
var ReasoningSummaryText$outboundSchema = z116.object({
  type: ReasoningSummaryTextType$outboundSchema,
  text: z116.string()
});

// node_modules/@openrouter/sdk/esm/models/reasoningitem.js
var ReasoningItemType = {
  Reasoning: "reasoning"
};
var ReasoningItemStatusInProgress = {
  InProgress: "in_progress"
};
var ReasoningItemStatusIncomplete = {
  Incomplete: "incomplete"
};
var ReasoningItemStatusCompleted = {
  Completed: "completed"
};
var ReasoningItemFormat = {
  Unknown: "unknown",
  OpenaiResponsesV1: "openai-responses-v1",
  AzureOpenaiResponsesV1: "azure-openai-responses-v1",
  XaiResponsesV1: "xai-responses-v1",
  AnthropicClaudeV1: "anthropic-claude-v1",
  GoogleGeminiV1: "google-gemini-v1"
};
var ReasoningItemType$outboundSchema = z117.enum(ReasoningItemType);
var ReasoningItemStatusInProgress$outboundSchema = z117.enum(ReasoningItemStatusInProgress);
var ReasoningItemStatusIncomplete$outboundSchema = z117.enum(ReasoningItemStatusIncomplete);
var ReasoningItemStatusCompleted$outboundSchema = z117.enum(ReasoningItemStatusCompleted);
var ReasoningItemStatusUnion$outboundSchema = z117.union([
  ReasoningItemStatusCompleted$outboundSchema,
  ReasoningItemStatusIncomplete$outboundSchema,
  ReasoningItemStatusInProgress$outboundSchema
]);
var ReasoningItemFormat$outboundSchema = outboundSchema(ReasoningItemFormat);
var ReasoningItem$outboundSchema = z117.object({
  type: ReasoningItemType$outboundSchema,
  id: z117.string(),
  content: z117.nullable(z117.array(ReasoningTextContent$outboundSchema)).optional(),
  summary: z117.array(ReasoningSummaryText$outboundSchema),
  encryptedContent: z117.nullable(z117.string()).optional(),
  status: z117.union([
    ReasoningItemStatusCompleted$outboundSchema,
    ReasoningItemStatusIncomplete$outboundSchema,
    ReasoningItemStatusInProgress$outboundSchema
  ]).optional(),
  signature: z117.nullable(z117.string()).optional(),
  format: z117.nullable(ReasoningItemFormat$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    encryptedContent: "encrypted_content"
  });
});

// node_modules/@openrouter/sdk/esm/models/inputsunion.js
var InputsTypeReasoning = {
  Reasoning: "reasoning"
};
var InputsStatusInProgress2 = {
  InProgress: "in_progress"
};
var InputsStatusIncomplete2 = {
  Incomplete: "incomplete"
};
var InputsStatusCompleted2 = {
  Completed: "completed"
};
var InputsFormat = {
  Unknown: "unknown",
  OpenaiResponsesV1: "openai-responses-v1",
  AzureOpenaiResponsesV1: "azure-openai-responses-v1",
  XaiResponsesV1: "xai-responses-v1",
  AnthropicClaudeV1: "anthropic-claude-v1",
  GoogleGeminiV1: "google-gemini-v1"
};
var InputsRole = {
  Assistant: "assistant"
};
var InputsTypeMessage = {
  Message: "message"
};
var InputsStatusInProgress1 = {
  InProgress: "in_progress"
};
var InputsStatusIncomplete1 = {
  Incomplete: "incomplete"
};
var InputsStatusCompleted1 = {
  Completed: "completed"
};
var InputsPhaseFinalAnswer = {
  FinalAnswer: "final_answer"
};
var InputsPhaseCommentary = {
  Commentary: "commentary"
};
var InputsTypeReasoning$outboundSchema = z118.enum(InputsTypeReasoning);
var InputsStatusInProgress2$outboundSchema = z118.enum(InputsStatusInProgress2);
var InputsStatusIncomplete2$outboundSchema = z118.enum(InputsStatusIncomplete2);
var InputsStatusCompleted2$outboundSchema = z118.enum(InputsStatusCompleted2);
var InputsStatusUnion2$outboundSchema = z118.union([
  InputsStatusCompleted2$outboundSchema,
  InputsStatusIncomplete2$outboundSchema,
  InputsStatusInProgress2$outboundSchema
]);
var InputsFormat$outboundSchema = outboundSchema(InputsFormat);
var InputsReasoning$outboundSchema = z118.object({
  type: InputsTypeReasoning$outboundSchema,
  id: z118.string(),
  content: z118.nullable(z118.array(ReasoningTextContent$outboundSchema)).optional(),
  summary: z118.nullable(z118.array(ReasoningSummaryText$outboundSchema)),
  encryptedContent: z118.nullable(z118.string()).optional(),
  status: z118.union([
    InputsStatusCompleted2$outboundSchema,
    InputsStatusIncomplete2$outboundSchema,
    InputsStatusInProgress2$outboundSchema
  ]).optional(),
  signature: z118.nullable(z118.string()).optional(),
  format: z118.nullable(InputsFormat$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    encryptedContent: "encrypted_content"
  });
});
var InputsRole$outboundSchema = z118.enum(InputsRole);
var InputsTypeMessage$outboundSchema = z118.enum(InputsTypeMessage);
var InputsStatusInProgress1$outboundSchema = z118.enum(InputsStatusInProgress1);
var InputsStatusIncomplete1$outboundSchema = z118.enum(InputsStatusIncomplete1);
var InputsStatusCompleted1$outboundSchema = z118.enum(InputsStatusCompleted1);
var InputsStatusUnion1$outboundSchema = z118.union([
  InputsStatusCompleted1$outboundSchema,
  InputsStatusIncomplete1$outboundSchema,
  InputsStatusInProgress1$outboundSchema
]);
var InputsContent1$outboundSchema = z118.union([
  ResponseOutputText$outboundSchema,
  OpenAIResponsesRefusalContent$outboundSchema
]);
var InputsContent2$outboundSchema = z118.union([
  z118.array(z118.union([
    ResponseOutputText$outboundSchema,
    OpenAIResponsesRefusalContent$outboundSchema
  ])),
  z118.string(),
  z118.any()
]);
var InputsPhaseFinalAnswer$outboundSchema = z118.enum(InputsPhaseFinalAnswer);
var InputsPhaseCommentary$outboundSchema = z118.enum(InputsPhaseCommentary);
var InputsPhaseUnion$outboundSchema = z118.union([
  InputsPhaseCommentary$outboundSchema,
  InputsPhaseFinalAnswer$outboundSchema,
  z118.any()
]);
var InputsMessage$outboundSchema = z118.object({
  id: z118.string(),
  role: InputsRole$outboundSchema,
  type: InputsTypeMessage$outboundSchema,
  status: z118.union([
    InputsStatusCompleted1$outboundSchema,
    InputsStatusIncomplete1$outboundSchema,
    InputsStatusInProgress1$outboundSchema
  ]).optional(),
  content: z118.nullable(z118.union([
    z118.array(z118.union([
      ResponseOutputText$outboundSchema,
      OpenAIResponsesRefusalContent$outboundSchema
    ])),
    z118.string(),
    z118.any()
  ])),
  phase: z118.nullable(z118.union([
    InputsPhaseCommentary$outboundSchema,
    InputsPhaseFinalAnswer$outboundSchema,
    z118.any()
  ])).optional()
});
var InputsUnion1$outboundSchema = z118.union([
  FunctionCallItem$outboundSchema,
  z118.lazy(() => InputsMessage$outboundSchema),
  OutputFunctionCallItem$outboundSchema,
  OutputWebSearchCallItem$outboundSchema,
  OutputFileSearchCallItem$outboundSchema,
  OutputDatetimeItem$outboundSchema,
  ReasoningItem$outboundSchema,
  FunctionCallOutputItem$outboundSchema,
  z118.lazy(() => InputsReasoning$outboundSchema),
  OutputImageGenerationCallItem$outboundSchema,
  OutputServerToolItem$outboundSchema,
  EasyInputMessage$outboundSchema,
  InputMessageItem$outboundSchema
]);
var InputsUnion$outboundSchema = z118.union([
  z118.string(),
  z118.array(z118.union([
    FunctionCallItem$outboundSchema,
    z118.lazy(() => InputsMessage$outboundSchema),
    OutputFunctionCallItem$outboundSchema,
    OutputWebSearchCallItem$outboundSchema,
    OutputFileSearchCallItem$outboundSchema,
    OutputDatetimeItem$outboundSchema,
    ReasoningItem$outboundSchema,
    FunctionCallOutputItem$outboundSchema,
    z118.lazy(() => InputsReasoning$outboundSchema),
    OutputImageGenerationCallItem$outboundSchema,
    OutputServerToolItem$outboundSchema,
    EasyInputMessage$outboundSchema,
    InputMessageItem$outboundSchema
  ]))
]);

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
var z119 = __toESM(require("zod/v4"), 1);
var InternalServerResponseErrorData$inboundSchema = z119.object({
  code: z119.int(),
  message: z119.string(),
  metadata: z119.nullable(z119.record(z119.string(), z119.nullable(z119.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/legacywebsearchservertool.js
var z121 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/searchcontextsizeenum.js
var SearchContextSizeEnum = {
  Low: "low",
  Medium: "medium",
  High: "high"
};
var SearchContextSizeEnum$inboundSchema = inboundSchema(SearchContextSizeEnum);
var SearchContextSizeEnum$outboundSchema = outboundSchema(SearchContextSizeEnum);

// node_modules/@openrouter/sdk/esm/models/websearchuserlocation.js
var z120 = __toESM(require("zod/v4"), 1);
var WebSearchUserLocationType = {
  Approximate: "approximate"
};
var WebSearchUserLocationType$inboundSchema = z120.enum(WebSearchUserLocationType);
var WebSearchUserLocationType$outboundSchema = WebSearchUserLocationType$inboundSchema;
var WebSearchUserLocation$inboundSchema = z120.object({
  type: WebSearchUserLocationType$inboundSchema.optional(),
  city: z120.nullable(z120.string()).optional(),
  country: z120.nullable(z120.string()).optional(),
  region: z120.nullable(z120.string()).optional(),
  timezone: z120.nullable(z120.string()).optional()
});
var WebSearchUserLocation$outboundSchema = z120.object({
  type: WebSearchUserLocationType$outboundSchema.optional(),
  city: z120.nullable(z120.string()).optional(),
  country: z120.nullable(z120.string()).optional(),
  region: z120.nullable(z120.string()).optional(),
  timezone: z120.nullable(z120.string()).optional()
});

// node_modules/@openrouter/sdk/esm/models/legacywebsearchservertool.js
var LegacyWebSearchServerToolEngine = {
  Auto: "auto",
  Native: "native",
  Exa: "exa",
  Firecrawl: "firecrawl",
  Parallel: "parallel"
};
var LegacyWebSearchServerToolFilters$inboundSchema = z121.object({
  allowed_domains: z121.nullable(z121.array(z121.string())).optional(),
  excluded_domains: z121.nullable(z121.array(z121.string())).optional()
}).transform((v) => {
  return remap(v, {
    "allowed_domains": "allowedDomains",
    "excluded_domains": "excludedDomains"
  });
});
var LegacyWebSearchServerToolFilters$outboundSchema = z121.object({
  allowedDomains: z121.nullable(z121.array(z121.string())).optional(),
  excludedDomains: z121.nullable(z121.array(z121.string())).optional()
}).transform((v) => {
  return remap(v, {
    allowedDomains: "allowed_domains",
    excludedDomains: "excluded_domains"
  });
});
var LegacyWebSearchServerToolEngine$inboundSchema = inboundSchema(LegacyWebSearchServerToolEngine);
var LegacyWebSearchServerToolEngine$outboundSchema = outboundSchema(LegacyWebSearchServerToolEngine);
var LegacyWebSearchServerTool$inboundSchema = z121.object({
  type: z121.literal("web_search"),
  filters: z121.nullable(z121.lazy(() => LegacyWebSearchServerToolFilters$inboundSchema)).optional(),
  search_context_size: SearchContextSizeEnum$inboundSchema.optional(),
  user_location: z121.nullable(WebSearchUserLocation$inboundSchema).optional(),
  engine: LegacyWebSearchServerToolEngine$inboundSchema.optional(),
  max_results: z121.number().optional()
}).transform((v) => {
  return remap(v, {
    "search_context_size": "searchContextSize",
    "user_location": "userLocation",
    "max_results": "maxResults"
  });
});
var LegacyWebSearchServerTool$outboundSchema = z121.object({
  type: z121.literal("web_search"),
  filters: z121.nullable(z121.lazy(() => LegacyWebSearchServerToolFilters$outboundSchema)).optional(),
  searchContextSize: SearchContextSizeEnum$outboundSchema.optional(),
  userLocation: z121.nullable(WebSearchUserLocation$outboundSchema).optional(),
  engine: LegacyWebSearchServerToolEngine$outboundSchema.optional(),
  maxResults: z121.number().optional()
}).transform((v) => {
  return remap(v, {
    searchContextSize: "search_context_size",
    userLocation: "user_location",
    maxResults: "max_results"
  });
});

// node_modules/@openrouter/sdk/esm/models/listendpointsresponse.js
var z124 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/outputmodality.js
var OutputModality = {
  Text: "text",
  Image: "image",
  Embeddings: "embeddings",
  Audio: "audio",
  Video: "video"
};
var OutputModality$inboundSchema = inboundSchema(OutputModality);

// node_modules/@openrouter/sdk/esm/models/publicendpoint.js
var z123 = __toESM(require("zod/v4"), 1);

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
var z122 = __toESM(require("zod/v4"), 1);
var PercentileStats$inboundSchema = z122.object({
  p50: z122.number(),
  p75: z122.number(),
  p90: z122.number(),
  p99: z122.number()
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
var Pricing$inboundSchema = z123.object({
  prompt: z123.string(),
  completion: z123.string(),
  request: z123.string().optional(),
  image: z123.string().optional(),
  image_token: z123.string().optional(),
  image_output: z123.string().optional(),
  audio: z123.string().optional(),
  audio_output: z123.string().optional(),
  input_audio_cache: z123.string().optional(),
  web_search: z123.string().optional(),
  internal_reasoning: z123.string().optional(),
  input_cache_read: z123.string().optional(),
  input_cache_write: z123.string().optional(),
  discount: z123.number().optional()
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
var PublicEndpoint$inboundSchema = z123.object({
  name: z123.string(),
  model_id: z123.string(),
  model_name: z123.string(),
  context_length: z123.number(),
  pricing: z123.lazy(() => Pricing$inboundSchema),
  provider_name: ProviderName$inboundSchema,
  tag: z123.string(),
  quantization: z123.nullable(PublicEndpointQuantization$inboundSchema),
  max_completion_tokens: z123.nullable(z123.number()),
  max_prompt_tokens: z123.nullable(z123.number()),
  supported_parameters: z123.array(Parameter$inboundSchema),
  status: EndpointStatus$inboundSchema.optional(),
  uptime_last_30m: z123.nullable(z123.number()),
  supports_implicit_caching: z123.boolean(),
  latency_last_30m: z123.nullable(PercentileStats$inboundSchema),
  throughput_last_30m: z123.nullable(PercentileStats$inboundSchema)
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
var Architecture$inboundSchema = z124.object({
  tokenizer: z124.nullable(Tokenizer$inboundSchema),
  instruct_type: z124.nullable(InstructType$inboundSchema),
  modality: z124.nullable(z124.string()),
  input_modalities: z124.array(InputModality$inboundSchema),
  output_modalities: z124.array(OutputModality$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "instruct_type": "instructType",
    "input_modalities": "inputModalities",
    "output_modalities": "outputModalities"
  });
});
var ListEndpointsResponse$inboundSchema = z124.object({
  id: z124.string(),
  name: z124.string(),
  created: z124.number(),
  description: z124.string(),
  architecture: z124.lazy(() => Architecture$inboundSchema),
  endpoints: z124.array(PublicEndpoint$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/mcpservertool.js
var z125 = __toESM(require("zod/v4"), 1);
var ConnectorId = {
  ConnectorDropbox: "connector_dropbox",
  ConnectorGmail: "connector_gmail",
  ConnectorGooglecalendar: "connector_googlecalendar",
  ConnectorGoogledrive: "connector_googledrive",
  ConnectorMicrosoftteams: "connector_microsoftteams",
  ConnectorOutlookcalendar: "connector_outlookcalendar",
  ConnectorOutlookemail: "connector_outlookemail",
  ConnectorSharepoint: "connector_sharepoint"
};
var RequireApprovalNever = {
  Never: "never"
};
var RequireApprovalAlways = {
  Always: "always"
};
var AllowedTools$inboundSchema = z125.object({
  tool_names: z125.array(z125.string()).optional(),
  read_only: z125.boolean().optional()
}).transform((v) => {
  return remap(v, {
    "tool_names": "toolNames",
    "read_only": "readOnly"
  });
});
var AllowedTools$outboundSchema = z125.object({
  toolNames: z125.array(z125.string()).optional(),
  readOnly: z125.boolean().optional()
}).transform((v) => {
  return remap(v, {
    toolNames: "tool_names",
    readOnly: "read_only"
  });
});
var ConnectorId$inboundSchema = inboundSchema(ConnectorId);
var ConnectorId$outboundSchema = outboundSchema(ConnectorId);
var RequireApprovalNever$inboundSchema = z125.enum(RequireApprovalNever);
var RequireApprovalAlways$inboundSchema = z125.enum(RequireApprovalAlways);
var Never$inboundSchema = z125.object({
  tool_names: z125.array(z125.string()).optional()
}).transform((v) => {
  return remap(v, {
    "tool_names": "toolNames"
  });
});
var Never$outboundSchema = z125.object({
  toolNames: z125.array(z125.string()).optional()
}).transform((v) => {
  return remap(v, {
    toolNames: "tool_names"
  });
});
var Always$inboundSchema = z125.object({
  tool_names: z125.array(z125.string()).optional()
}).transform((v) => {
  return remap(v, {
    "tool_names": "toolNames"
  });
});
var Always$outboundSchema = z125.object({
  toolNames: z125.array(z125.string()).optional()
}).transform((v) => {
  return remap(v, {
    toolNames: "tool_names"
  });
});
var RequireApproval$inboundSchema = z125.object({
  never: z125.lazy(() => Never$inboundSchema).optional(),
  always: z125.lazy(() => Always$inboundSchema).optional()
});
var RequireApproval$outboundSchema = z125.object({
  never: z125.lazy(() => Never$outboundSchema).optional(),
  always: z125.lazy(() => Always$outboundSchema).optional()
});
var McpServerTool$inboundSchema = z125.object({
  type: z125.literal("mcp"),
  server_label: z125.string(),
  allowed_tools: z125.nullable(z125.any()).optional(),
  authorization: z125.string().optional(),
  connector_id: ConnectorId$inboundSchema.optional(),
  headers: z125.nullable(z125.record(z125.string(), z125.string())).optional(),
  require_approval: z125.nullable(z125.any()).optional(),
  server_description: z125.string().optional(),
  server_url: z125.string().optional()
}).transform((v) => {
  return remap(v, {
    "server_label": "serverLabel",
    "allowed_tools": "allowedTools",
    "connector_id": "connectorId",
    "require_approval": "requireApproval",
    "server_description": "serverDescription",
    "server_url": "serverUrl"
  });
});
var McpServerTool$outboundSchema = z125.object({
  type: z125.literal("mcp"),
  serverLabel: z125.string(),
  allowedTools: z125.nullable(z125.any()).optional(),
  authorization: z125.string().optional(),
  connectorId: ConnectorId$outboundSchema.optional(),
  headers: z125.nullable(z125.record(z125.string(), z125.string())).optional(),
  requireApproval: z125.nullable(z125.any()).optional(),
  serverDescription: z125.string().optional(),
  serverUrl: z125.string().optional()
}).transform((v) => {
  return remap(v, {
    serverLabel: "server_label",
    allowedTools: "allowed_tools",
    connectorId: "connector_id",
    requireApproval: "require_approval",
    serverDescription: "server_description",
    serverUrl: "server_url"
  });
});

// node_modules/@openrouter/sdk/esm/models/model.js
var z130 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/modelarchitecture.js
var z126 = __toESM(require("zod/v4"), 1);

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
var ModelArchitecture$inboundSchema = z126.object({
  tokenizer: ModelGroup$inboundSchema.optional(),
  instruct_type: z126.nullable(ModelArchitectureInstructType$inboundSchema).optional(),
  modality: z126.nullable(z126.string()),
  input_modalities: z126.array(InputModality$inboundSchema),
  output_modalities: z126.array(OutputModality$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "instruct_type": "instructType",
    "input_modalities": "inputModalities",
    "output_modalities": "outputModalities"
  });
});

// node_modules/@openrouter/sdk/esm/models/perrequestlimits.js
var z127 = __toESM(require("zod/v4"), 1);
var PerRequestLimits$inboundSchema = z127.object({
  prompt_tokens: z127.number(),
  completion_tokens: z127.number()
}).transform((v) => {
  return remap(v, {
    "prompt_tokens": "promptTokens",
    "completion_tokens": "completionTokens"
  });
});

// node_modules/@openrouter/sdk/esm/models/publicpricing.js
var z128 = __toESM(require("zod/v4"), 1);
var PublicPricing$inboundSchema = z128.object({
  prompt: z128.string(),
  completion: z128.string(),
  request: z128.string().optional(),
  image: z128.string().optional(),
  image_token: z128.string().optional(),
  image_output: z128.string().optional(),
  audio: z128.string().optional(),
  audio_output: z128.string().optional(),
  input_audio_cache: z128.string().optional(),
  web_search: z128.string().optional(),
  internal_reasoning: z128.string().optional(),
  input_cache_read: z128.string().optional(),
  input_cache_write: z128.string().optional(),
  discount: z128.number().optional()
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
var z129 = __toESM(require("zod/v4"), 1);
var TopProviderInfo$inboundSchema = z129.object({
  context_length: z129.nullable(z129.number()).optional(),
  max_completion_tokens: z129.nullable(z129.number()).optional(),
  is_moderated: z129.boolean()
}).transform((v) => {
  return remap(v, {
    "context_length": "contextLength",
    "max_completion_tokens": "maxCompletionTokens",
    "is_moderated": "isModerated"
  });
});

// node_modules/@openrouter/sdk/esm/models/model.js
var Model$inboundSchema = z130.object({
  id: z130.string(),
  canonical_slug: z130.string(),
  hugging_face_id: z130.nullable(z130.string()).optional(),
  name: z130.string(),
  created: z130.number(),
  description: z130.string().optional(),
  pricing: PublicPricing$inboundSchema,
  context_length: z130.nullable(z130.number()),
  architecture: ModelArchitecture$inboundSchema,
  top_provider: TopProviderInfo$inboundSchema,
  per_request_limits: z130.nullable(PerRequestLimits$inboundSchema),
  supported_parameters: z130.array(Parameter$inboundSchema),
  default_parameters: z130.nullable(DefaultParameters$inboundSchema),
  knowledge_cutoff: z130.nullable(z130.string()).optional(),
  expiration_date: z130.nullable(z130.string()).optional()
}).transform((v) => {
  return remap(v, {
    "canonical_slug": "canonicalSlug",
    "hugging_face_id": "huggingFaceId",
    "context_length": "contextLength",
    "top_provider": "topProvider",
    "per_request_limits": "perRequestLimits",
    "supported_parameters": "supportedParameters",
    "default_parameters": "defaultParameters",
    "knowledge_cutoff": "knowledgeCutoff",
    "expiration_date": "expirationDate"
  });
});

// node_modules/@openrouter/sdk/esm/models/modelscountresponse.js
var z131 = __toESM(require("zod/v4"), 1);
var Data$inboundSchema = z131.object({
  count: z131.number()
});
var ModelsCountResponse$inboundSchema = z131.object({
  data: z131.lazy(() => Data$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/modelslistresponse.js
var z132 = __toESM(require("zod/v4"), 1);
var ModelsListResponse$inboundSchema = z132.object({
  data: z132.array(Model$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/notfoundresponseerrordata.js
var z133 = __toESM(require("zod/v4"), 1);
var NotFoundResponseErrorData$inboundSchema = z133.object({
  code: z133.int(),
  message: z133.string(),
  metadata: z133.nullable(z133.record(z133.string(), z133.nullable(z133.any()))).optional()
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

// node_modules/@openrouter/sdk/esm/models/openairesponsestoolchoiceunion.js
var z134 = __toESM(require("zod/v4"), 1);
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
var OpenAIResponsesToolChoiceTypeWebSearchPreview$inboundSchema = z134.enum(OpenAIResponsesToolChoiceTypeWebSearchPreview);
var OpenAIResponsesToolChoiceTypeWebSearchPreview$outboundSchema = OpenAIResponsesToolChoiceTypeWebSearchPreview$inboundSchema;
var OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$inboundSchema = z134.enum(OpenAIResponsesToolChoiceTypeWebSearchPreview20250311);
var OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$outboundSchema = OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$inboundSchema;
var Type$inboundSchema = z134.union([
  OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$inboundSchema,
  OpenAIResponsesToolChoiceTypeWebSearchPreview$inboundSchema
]);
var Type$outboundSchema = z134.union([
  OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$outboundSchema,
  OpenAIResponsesToolChoiceTypeWebSearchPreview$outboundSchema
]);
var OpenAIResponsesToolChoice$inboundSchema = z134.object({
  type: z134.union([
    OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$inboundSchema,
    OpenAIResponsesToolChoiceTypeWebSearchPreview$inboundSchema
  ])
});
var OpenAIResponsesToolChoice$outboundSchema = z134.object({
  type: z134.union([
    OpenAIResponsesToolChoiceTypeWebSearchPreview20250311$outboundSchema,
    OpenAIResponsesToolChoiceTypeWebSearchPreview$outboundSchema
  ])
});
var OpenAIResponsesToolChoiceTypeFunction$inboundSchema = z134.enum(OpenAIResponsesToolChoiceTypeFunction);
var OpenAIResponsesToolChoiceTypeFunction$outboundSchema = OpenAIResponsesToolChoiceTypeFunction$inboundSchema;
var OpenAIResponsesToolChoiceFunction$inboundSchema = z134.object({
  type: OpenAIResponsesToolChoiceTypeFunction$inboundSchema,
  name: z134.string()
});
var OpenAIResponsesToolChoiceFunction$outboundSchema = z134.object({
  type: OpenAIResponsesToolChoiceTypeFunction$outboundSchema,
  name: z134.string()
});
var OpenAIResponsesToolChoiceRequired$inboundSchema = z134.enum(OpenAIResponsesToolChoiceRequired);
var OpenAIResponsesToolChoiceRequired$outboundSchema = OpenAIResponsesToolChoiceRequired$inboundSchema;
var OpenAIResponsesToolChoiceNone$inboundSchema = z134.enum(OpenAIResponsesToolChoiceNone);
var OpenAIResponsesToolChoiceNone$outboundSchema = OpenAIResponsesToolChoiceNone$inboundSchema;
var OpenAIResponsesToolChoiceAuto$inboundSchema = z134.enum(OpenAIResponsesToolChoiceAuto);
var OpenAIResponsesToolChoiceAuto$outboundSchema = OpenAIResponsesToolChoiceAuto$inboundSchema;
var OpenAIResponsesToolChoiceUnion$inboundSchema = z134.union([
  z134.lazy(() => OpenAIResponsesToolChoiceFunction$inboundSchema),
  z134.lazy(() => OpenAIResponsesToolChoice$inboundSchema),
  OpenAIResponsesToolChoiceAuto$inboundSchema,
  OpenAIResponsesToolChoiceNone$inboundSchema,
  OpenAIResponsesToolChoiceRequired$inboundSchema
]);
var OpenAIResponsesToolChoiceUnion$outboundSchema = z134.union([
  z134.lazy(() => OpenAIResponsesToolChoiceFunction$outboundSchema),
  z134.lazy(() => OpenAIResponsesToolChoice$outboundSchema),
  OpenAIResponsesToolChoiceAuto$outboundSchema,
  OpenAIResponsesToolChoiceNone$outboundSchema,
  OpenAIResponsesToolChoiceRequired$outboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/openairesponsestruncation.js
var OpenAIResponsesTruncation = {
  Auto: "auto",
  Disabled: "disabled"
};
var OpenAIResponsesTruncation$outboundSchema = outboundSchema(OpenAIResponsesTruncation);

// node_modules/@openrouter/sdk/esm/models/openresponsesresult.js
var z147 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/outputitems.js
var z137 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/outputmessageitem.js
var z135 = __toESM(require("zod/v4"), 1);
var OutputMessageItemRole = {
  Assistant: "assistant"
};
var OutputMessageItemType = {
  Message: "message"
};
var OutputMessageItemStatusInProgress = {
  InProgress: "in_progress"
};
var OutputMessageItemStatusIncomplete = {
  Incomplete: "incomplete"
};
var OutputMessageItemStatusCompleted = {
  Completed: "completed"
};
var OutputMessageItemPhaseFinalAnswer = {
  FinalAnswer: "final_answer"
};
var OutputMessageItemPhaseCommentary = {
  Commentary: "commentary"
};
var OutputMessageItemRole$inboundSchema = z135.enum(OutputMessageItemRole);
var OutputMessageItemType$inboundSchema = z135.enum(OutputMessageItemType);
var OutputMessageItemStatusInProgress$inboundSchema = z135.enum(OutputMessageItemStatusInProgress);
var OutputMessageItemStatusIncomplete$inboundSchema = z135.enum(OutputMessageItemStatusIncomplete);
var OutputMessageItemStatusCompleted$inboundSchema = z135.enum(OutputMessageItemStatusCompleted);
var OutputMessageItemStatusUnion$inboundSchema = z135.union([
  OutputMessageItemStatusCompleted$inboundSchema,
  OutputMessageItemStatusIncomplete$inboundSchema,
  OutputMessageItemStatusInProgress$inboundSchema
]);
var OutputMessageItemContent$inboundSchema = z135.union([
  ResponseOutputText$inboundSchema,
  OpenAIResponsesRefusalContent$inboundSchema
]);
var OutputMessageItemPhaseFinalAnswer$inboundSchema = z135.enum(OutputMessageItemPhaseFinalAnswer);
var OutputMessageItemPhaseCommentary$inboundSchema = z135.enum(OutputMessageItemPhaseCommentary);
var OutputMessageItemPhaseUnion$inboundSchema = z135.union([
  OutputMessageItemPhaseCommentary$inboundSchema,
  OutputMessageItemPhaseFinalAnswer$inboundSchema,
  z135.any()
]);
var OutputMessageItem$inboundSchema = z135.object({
  id: z135.string(),
  role: OutputMessageItemRole$inboundSchema,
  type: OutputMessageItemType$inboundSchema,
  status: z135.union([
    OutputMessageItemStatusCompleted$inboundSchema,
    OutputMessageItemStatusIncomplete$inboundSchema,
    OutputMessageItemStatusInProgress$inboundSchema
  ]).optional(),
  content: z135.array(z135.union([
    ResponseOutputText$inboundSchema,
    OpenAIResponsesRefusalContent$inboundSchema
  ])),
  phase: z135.nullable(z135.union([
    OutputMessageItemPhaseCommentary$inboundSchema,
    OutputMessageItemPhaseFinalAnswer$inboundSchema,
    z135.any()
  ])).optional()
});

// node_modules/@openrouter/sdk/esm/models/outputreasoningitem.js
var z136 = __toESM(require("zod/v4"), 1);
var OutputReasoningItemType = {
  Reasoning: "reasoning"
};
var OutputReasoningItemStatusInProgress = {
  InProgress: "in_progress"
};
var OutputReasoningItemStatusIncomplete = {
  Incomplete: "incomplete"
};
var OutputReasoningItemStatusCompleted = {
  Completed: "completed"
};
var OutputReasoningItemFormat = {
  Unknown: "unknown",
  OpenaiResponsesV1: "openai-responses-v1",
  AzureOpenaiResponsesV1: "azure-openai-responses-v1",
  XaiResponsesV1: "xai-responses-v1",
  AnthropicClaudeV1: "anthropic-claude-v1",
  GoogleGeminiV1: "google-gemini-v1"
};
var OutputReasoningItemType$inboundSchema = z136.enum(OutputReasoningItemType);
var OutputReasoningItemStatusInProgress$inboundSchema = z136.enum(OutputReasoningItemStatusInProgress);
var OutputReasoningItemStatusIncomplete$inboundSchema = z136.enum(OutputReasoningItemStatusIncomplete);
var OutputReasoningItemStatusCompleted$inboundSchema = z136.enum(OutputReasoningItemStatusCompleted);
var OutputReasoningItemStatusUnion$inboundSchema = z136.union([
  OutputReasoningItemStatusCompleted$inboundSchema,
  OutputReasoningItemStatusIncomplete$inboundSchema,
  OutputReasoningItemStatusInProgress$inboundSchema
]);
var OutputReasoningItemFormat$inboundSchema = inboundSchema(OutputReasoningItemFormat);
var OutputReasoningItem$inboundSchema = z136.object({
  type: OutputReasoningItemType$inboundSchema,
  id: z136.string(),
  content: z136.nullable(z136.array(ReasoningTextContent$inboundSchema)).optional(),
  summary: z136.array(ReasoningSummaryText$inboundSchema),
  encrypted_content: z136.nullable(z136.string()).optional(),
  status: z136.union([
    OutputReasoningItemStatusCompleted$inboundSchema,
    OutputReasoningItemStatusIncomplete$inboundSchema,
    OutputReasoningItemStatusInProgress$inboundSchema
  ]).optional(),
  signature: z136.nullable(z136.string()).optional(),
  format: z136.nullable(OutputReasoningItemFormat$inboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    "encrypted_content": "encryptedContent"
  });
});

// node_modules/@openrouter/sdk/esm/models/outputitems.js
var OutputItems$inboundSchema = z137.union([
  OutputMessageItem$inboundSchema,
  OutputFunctionCallItem$inboundSchema,
  OutputWebSearchCallItem$inboundSchema,
  OutputFileSearchCallItem$inboundSchema,
  OutputReasoningItem$inboundSchema,
  OutputImageGenerationCallItem$inboundSchema,
  OutputServerToolItem$inboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/preview20250311websearchservertool.js
var z139 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/previewwebsearchuserlocation.js
var z138 = __toESM(require("zod/v4"), 1);
var PreviewWebSearchUserLocationType = {
  Approximate: "approximate"
};
var PreviewWebSearchUserLocationType$inboundSchema = z138.enum(PreviewWebSearchUserLocationType);
var PreviewWebSearchUserLocationType$outboundSchema = PreviewWebSearchUserLocationType$inboundSchema;
var PreviewWebSearchUserLocation$inboundSchema = z138.object({
  type: PreviewWebSearchUserLocationType$inboundSchema,
  city: z138.nullable(z138.string()).optional(),
  country: z138.nullable(z138.string()).optional(),
  region: z138.nullable(z138.string()).optional(),
  timezone: z138.nullable(z138.string()).optional()
});
var PreviewWebSearchUserLocation$outboundSchema = z138.object({
  type: PreviewWebSearchUserLocationType$outboundSchema,
  city: z138.nullable(z138.string()).optional(),
  country: z138.nullable(z138.string()).optional(),
  region: z138.nullable(z138.string()).optional(),
  timezone: z138.nullable(z138.string()).optional()
});

// node_modules/@openrouter/sdk/esm/models/preview20250311websearchservertool.js
var Preview20250311WebSearchServerToolEngine = {
  Auto: "auto",
  Native: "native",
  Exa: "exa",
  Firecrawl: "firecrawl",
  Parallel: "parallel"
};
var Preview20250311WebSearchServerToolEngine$inboundSchema = inboundSchema(Preview20250311WebSearchServerToolEngine);
var Preview20250311WebSearchServerToolEngine$outboundSchema = outboundSchema(Preview20250311WebSearchServerToolEngine);
var Preview20250311WebSearchServerToolFilters$inboundSchema = z139.object({
  allowed_domains: z139.nullable(z139.array(z139.string())).optional(),
  excluded_domains: z139.nullable(z139.array(z139.string())).optional()
}).transform((v) => {
  return remap(v, {
    "allowed_domains": "allowedDomains",
    "excluded_domains": "excludedDomains"
  });
});
var Preview20250311WebSearchServerToolFilters$outboundSchema = z139.object({
  allowedDomains: z139.nullable(z139.array(z139.string())).optional(),
  excludedDomains: z139.nullable(z139.array(z139.string())).optional()
}).transform((v) => {
  return remap(v, {
    allowedDomains: "allowed_domains",
    excludedDomains: "excluded_domains"
  });
});
var Preview20250311WebSearchServerTool$inboundSchema = z139.object({
  type: z139.literal("web_search_preview_2025_03_11"),
  search_context_size: SearchContextSizeEnum$inboundSchema.optional(),
  user_location: z139.nullable(PreviewWebSearchUserLocation$inboundSchema).optional(),
  engine: Preview20250311WebSearchServerToolEngine$inboundSchema.optional(),
  max_results: z139.number().optional(),
  filters: z139.nullable(z139.lazy(() => Preview20250311WebSearchServerToolFilters$inboundSchema)).optional()
}).transform((v) => {
  return remap(v, {
    "search_context_size": "searchContextSize",
    "user_location": "userLocation",
    "max_results": "maxResults"
  });
});
var Preview20250311WebSearchServerTool$outboundSchema = z139.object({
  type: z139.literal("web_search_preview_2025_03_11"),
  searchContextSize: SearchContextSizeEnum$outboundSchema.optional(),
  userLocation: z139.nullable(PreviewWebSearchUserLocation$outboundSchema).optional(),
  engine: Preview20250311WebSearchServerToolEngine$outboundSchema.optional(),
  maxResults: z139.number().optional(),
  filters: z139.nullable(z139.lazy(() => Preview20250311WebSearchServerToolFilters$outboundSchema)).optional()
}).transform((v) => {
  return remap(v, {
    searchContextSize: "search_context_size",
    userLocation: "user_location",
    maxResults: "max_results"
  });
});

// node_modules/@openrouter/sdk/esm/models/previewwebsearchservertool.js
var z140 = __toESM(require("zod/v4"), 1);
var PreviewWebSearchServerToolEngine = {
  Auto: "auto",
  Native: "native",
  Exa: "exa",
  Firecrawl: "firecrawl",
  Parallel: "parallel"
};
var PreviewWebSearchServerToolEngine$inboundSchema = inboundSchema(PreviewWebSearchServerToolEngine);
var PreviewWebSearchServerToolEngine$outboundSchema = outboundSchema(PreviewWebSearchServerToolEngine);
var PreviewWebSearchServerToolFilters$inboundSchema = z140.object({
  allowed_domains: z140.nullable(z140.array(z140.string())).optional(),
  excluded_domains: z140.nullable(z140.array(z140.string())).optional()
}).transform((v) => {
  return remap(v, {
    "allowed_domains": "allowedDomains",
    "excluded_domains": "excludedDomains"
  });
});
var PreviewWebSearchServerToolFilters$outboundSchema = z140.object({
  allowedDomains: z140.nullable(z140.array(z140.string())).optional(),
  excludedDomains: z140.nullable(z140.array(z140.string())).optional()
}).transform((v) => {
  return remap(v, {
    allowedDomains: "allowed_domains",
    excludedDomains: "excluded_domains"
  });
});
var PreviewWebSearchServerTool$inboundSchema = z140.object({
  type: z140.literal("web_search_preview"),
  search_context_size: SearchContextSizeEnum$inboundSchema.optional(),
  user_location: z140.nullable(PreviewWebSearchUserLocation$inboundSchema).optional(),
  engine: PreviewWebSearchServerToolEngine$inboundSchema.optional(),
  max_results: z140.number().optional(),
  filters: z140.nullable(z140.lazy(() => PreviewWebSearchServerToolFilters$inboundSchema)).optional()
}).transform((v) => {
  return remap(v, {
    "search_context_size": "searchContextSize",
    "user_location": "userLocation",
    "max_results": "maxResults"
  });
});
var PreviewWebSearchServerTool$outboundSchema = z140.object({
  type: z140.literal("web_search_preview"),
  searchContextSize: SearchContextSizeEnum$outboundSchema.optional(),
  userLocation: z140.nullable(PreviewWebSearchUserLocation$outboundSchema).optional(),
  engine: PreviewWebSearchServerToolEngine$outboundSchema.optional(),
  maxResults: z140.number().optional(),
  filters: z140.nullable(z140.lazy(() => PreviewWebSearchServerToolFilters$outboundSchema)).optional()
}).transform((v) => {
  return remap(v, {
    searchContextSize: "search_context_size",
    userLocation: "user_location",
    maxResults: "max_results"
  });
});

// node_modules/@openrouter/sdk/esm/models/responseserrorfield.js
var z141 = __toESM(require("zod/v4"), 1);
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
var ResponsesErrorField$inboundSchema = z141.object({
  code: Code$inboundSchema,
  message: z141.string()
});

// node_modules/@openrouter/sdk/esm/models/shellservertool.js
var z142 = __toESM(require("zod/v4"), 1);
var ShellServerTool$inboundSchema = z142.object({
  type: z142.literal("shell")
});
var ShellServerTool$outboundSchema = z142.object({
  type: z142.literal("shell")
});

// node_modules/@openrouter/sdk/esm/models/storedprompttemplate.js
var z143 = __toESM(require("zod/v4"), 1);
var Variables$inboundSchema = z143.union([
  InputText$inboundSchema,
  InputImage$inboundSchema,
  InputFile$inboundSchema,
  z143.string()
]);
var Variables$outboundSchema = z143.union([
  InputText$outboundSchema,
  InputImage$outboundSchema,
  InputFile$outboundSchema,
  z143.string()
]);
var StoredPromptTemplate$inboundSchema = z143.object({
  id: z143.string(),
  variables: z143.nullable(z143.record(z143.string(), z143.union([
    InputText$inboundSchema,
    InputImage$inboundSchema,
    InputFile$inboundSchema,
    z143.string()
  ]))).optional()
});
var StoredPromptTemplate$outboundSchema = z143.object({
  id: z143.string(),
  variables: z143.nullable(z143.record(z143.string(), z143.union([
    InputText$outboundSchema,
    InputImage$outboundSchema,
    InputFile$outboundSchema,
    z143.string()
  ]))).optional()
});

// node_modules/@openrouter/sdk/esm/models/textconfig.js
var z144 = __toESM(require("zod/v4"), 1);
var TextConfigVerbosity = {
  High: "high",
  Low: "low",
  Medium: "medium"
};
var TextConfigVerbosity$inboundSchema = inboundSchema(TextConfigVerbosity);
var TextConfig$inboundSchema = z144.object({
  format: Formats$inboundSchema.optional(),
  verbosity: z144.nullable(TextConfigVerbosity$inboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/truncationenum.js
var TruncationEnum = {
  Auto: "auto",
  Disabled: "disabled"
};
var TruncationEnum$inboundSchema = inboundSchema(TruncationEnum);

// node_modules/@openrouter/sdk/esm/models/usage.js
var z145 = __toESM(require("zod/v4"), 1);
var InputTokensDetails$inboundSchema = z145.object({
  cached_tokens: z145.number()
}).transform((v) => {
  return remap(v, {
    "cached_tokens": "cachedTokens"
  });
});
var OutputTokensDetails$inboundSchema = z145.object({
  reasoning_tokens: z145.number()
}).transform((v) => {
  return remap(v, {
    "reasoning_tokens": "reasoningTokens"
  });
});
var CostDetails$inboundSchema = z145.object({
  upstream_inference_cost: z145.nullable(z145.number()).optional(),
  upstream_inference_input_cost: z145.number(),
  upstream_inference_output_cost: z145.number()
}).transform((v) => {
  return remap(v, {
    "upstream_inference_cost": "upstreamInferenceCost",
    "upstream_inference_input_cost": "upstreamInferenceInputCost",
    "upstream_inference_output_cost": "upstreamInferenceOutputCost"
  });
});
var Usage$inboundSchema = z145.object({
  input_tokens: z145.number(),
  input_tokens_details: z145.lazy(() => InputTokensDetails$inboundSchema),
  output_tokens: z145.number(),
  output_tokens_details: z145.lazy(() => OutputTokensDetails$inboundSchema),
  total_tokens: z145.number(),
  cost: z145.nullable(z145.number()).optional(),
  is_byok: z145.boolean().optional(),
  cost_details: z145.lazy(() => CostDetails$inboundSchema).optional()
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

// node_modules/@openrouter/sdk/esm/models/websearchservertool.js
var z146 = __toESM(require("zod/v4"), 1);
var WebSearchServerToolEngine = {
  Auto: "auto",
  Native: "native",
  Exa: "exa",
  Firecrawl: "firecrawl",
  Parallel: "parallel"
};
var WebSearchServerToolFilters$inboundSchema = z146.object({
  allowed_domains: z146.nullable(z146.array(z146.string())).optional(),
  excluded_domains: z146.nullable(z146.array(z146.string())).optional()
}).transform((v) => {
  return remap(v, {
    "allowed_domains": "allowedDomains",
    "excluded_domains": "excludedDomains"
  });
});
var WebSearchServerToolFilters$outboundSchema = z146.object({
  allowedDomains: z146.nullable(z146.array(z146.string())).optional(),
  excludedDomains: z146.nullable(z146.array(z146.string())).optional()
}).transform((v) => {
  return remap(v, {
    allowedDomains: "allowed_domains",
    excludedDomains: "excluded_domains"
  });
});
var WebSearchServerToolEngine$inboundSchema = inboundSchema(WebSearchServerToolEngine);
var WebSearchServerToolEngine$outboundSchema = outboundSchema(WebSearchServerToolEngine);
var WebSearchServerTool$inboundSchema = z146.object({
  type: z146.literal("web_search_2025_08_26"),
  filters: z146.nullable(z146.lazy(() => WebSearchServerToolFilters$inboundSchema)).optional(),
  search_context_size: SearchContextSizeEnum$inboundSchema.optional(),
  user_location: z146.nullable(WebSearchUserLocation$inboundSchema).optional(),
  engine: WebSearchServerToolEngine$inboundSchema.optional(),
  max_results: z146.number().optional()
}).transform((v) => {
  return remap(v, {
    "search_context_size": "searchContextSize",
    "user_location": "userLocation",
    "max_results": "maxResults"
  });
});
var WebSearchServerTool$outboundSchema = z146.object({
  type: z146.literal("web_search_2025_08_26"),
  filters: z146.nullable(z146.lazy(() => WebSearchServerToolFilters$outboundSchema)).optional(),
  searchContextSize: SearchContextSizeEnum$outboundSchema.optional(),
  userLocation: z146.nullable(WebSearchUserLocation$outboundSchema).optional(),
  engine: WebSearchServerToolEngine$outboundSchema.optional(),
  maxResults: z146.number().optional()
}).transform((v) => {
  return remap(v, {
    searchContextSize: "search_context_size",
    userLocation: "user_location",
    maxResults: "max_results"
  });
});

// node_modules/@openrouter/sdk/esm/models/openresponsesresult.js
var OpenResponsesResultObject = {
  Response: "response"
};
var OpenResponsesResultObject$inboundSchema = z147.enum(OpenResponsesResultObject);
var OpenResponsesResultToolFunction$inboundSchema = z147.object({
  type: z147.literal("function"),
  name: z147.string(),
  description: z147.nullable(z147.string()).optional(),
  strict: z147.nullable(z147.boolean()).optional(),
  parameters: z147.nullable(z147.record(z147.string(), z147.nullable(z147.any())))
});
var OpenResponsesResultToolUnion$inboundSchema = z147.union([
  z147.lazy(() => OpenResponsesResultToolFunction$inboundSchema),
  PreviewWebSearchServerTool$inboundSchema,
  Preview20250311WebSearchServerTool$inboundSchema,
  LegacyWebSearchServerTool$inboundSchema,
  WebSearchServerTool$inboundSchema,
  FileSearchServerTool$inboundSchema,
  ComputerUseServerTool$inboundSchema,
  CodeInterpreterServerTool$inboundSchema,
  McpServerTool$inboundSchema,
  ImageGenerationServerTool$inboundSchema,
  CodexLocalShellTool$inboundSchema,
  ShellServerTool$inboundSchema,
  ApplyPatchServerTool$inboundSchema,
  CustomTool$inboundSchema
]);
var OpenResponsesResult$inboundSchema = z147.object({
  id: z147.string(),
  object: OpenResponsesResultObject$inboundSchema,
  created_at: z147.number(),
  model: z147.string(),
  status: OpenAIResponsesResponseStatus$inboundSchema,
  completed_at: z147.nullable(z147.number()),
  output: z147.array(OutputItems$inboundSchema),
  user: z147.nullable(z147.string()).optional(),
  output_text: z147.string().optional(),
  prompt_cache_key: z147.nullable(z147.string()).optional(),
  safety_identifier: z147.nullable(z147.string()).optional(),
  error: z147.nullable(ResponsesErrorField$inboundSchema),
  incomplete_details: z147.nullable(IncompleteDetails$inboundSchema),
  usage: z147.nullable(Usage$inboundSchema).optional(),
  max_tool_calls: z147.nullable(z147.number()).optional(),
  top_logprobs: z147.number().optional(),
  max_output_tokens: z147.nullable(z147.number()).optional(),
  temperature: z147.nullable(z147.number()),
  top_p: z147.nullable(z147.number()),
  presence_penalty: z147.nullable(z147.number()),
  frequency_penalty: z147.nullable(z147.number()),
  instructions: z147.nullable(BaseInputsUnion$inboundSchema),
  metadata: z147.nullable(z147.record(z147.string(), z147.string())),
  tools: z147.array(z147.union([
    z147.lazy(() => OpenResponsesResultToolFunction$inboundSchema),
    PreviewWebSearchServerTool$inboundSchema,
    Preview20250311WebSearchServerTool$inboundSchema,
    LegacyWebSearchServerTool$inboundSchema,
    WebSearchServerTool$inboundSchema,
    FileSearchServerTool$inboundSchema,
    ComputerUseServerTool$inboundSchema,
    CodeInterpreterServerTool$inboundSchema,
    McpServerTool$inboundSchema,
    ImageGenerationServerTool$inboundSchema,
    CodexLocalShellTool$inboundSchema,
    ShellServerTool$inboundSchema,
    ApplyPatchServerTool$inboundSchema,
    CustomTool$inboundSchema
  ])),
  tool_choice: OpenAIResponsesToolChoiceUnion$inboundSchema,
  parallel_tool_calls: z147.boolean(),
  prompt: z147.nullable(StoredPromptTemplate$inboundSchema).optional(),
  background: z147.nullable(z147.boolean()).optional(),
  previous_response_id: z147.nullable(z147.string()).optional(),
  reasoning: z147.nullable(BaseReasoningConfig$inboundSchema).optional(),
  service_tier: z147.nullable(z147.string()).optional(),
  store: z147.boolean().optional(),
  truncation: z147.nullable(TruncationEnum$inboundSchema).optional(),
  text: TextConfig$inboundSchema.optional()
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

// node_modules/@openrouter/sdk/esm/models/outputmodalityenum.js
var OutputModalityEnum = {
  Text: "text",
  Image: "image"
};
var OutputModalityEnum$outboundSchema = outboundSchema(OutputModalityEnum);

// node_modules/@openrouter/sdk/esm/models/payloadtoolargeresponseerrordata.js
var z148 = __toESM(require("zod/v4"), 1);
var PayloadTooLargeResponseErrorData$inboundSchema = z148.object({
  code: z148.int(),
  message: z148.string(),
  metadata: z148.nullable(z148.record(z148.string(), z148.nullable(z148.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/paymentrequiredresponseerrordata.js
var z149 = __toESM(require("zod/v4"), 1);
var PaymentRequiredResponseErrorData$inboundSchema = z149.object({
  code: z149.int(),
  message: z149.string(),
  metadata: z149.nullable(z149.record(z149.string(), z149.nullable(z149.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/provideroverloadedresponseerrordata.js
var z150 = __toESM(require("zod/v4"), 1);
var ProviderOverloadedResponseErrorData$inboundSchema = z150.object({
  code: z150.int(),
  message: z150.string(),
  metadata: z150.nullable(z150.record(z150.string(), z150.nullable(z150.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/providerpreferences.js
var z151 = __toESM(require("zod/v4"), 1);
var ProviderPreferencesSortEnum = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency",
  Exacto: "exacto"
};
var ProviderPreferencesProviderSortConfigEnum = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency",
  Exacto: "exacto"
};
var ProviderPreferencesBy = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency",
  Exacto: "exacto"
};
var ProviderPreferencesPartition = {
  Model: "model",
  None: "none"
};
var ProviderPreferencesProviderSort = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency",
  Exacto: "exacto"
};
var ProviderPreferencesOrder$outboundSchema = z151.union([ProviderName$outboundSchema, z151.string()]);
var ProviderPreferencesOnly$outboundSchema = z151.union([ProviderName$outboundSchema, z151.string()]);
var ProviderPreferencesIgnore$outboundSchema = z151.union([ProviderName$outboundSchema, z151.string()]);
var ProviderPreferencesSortEnum$outboundSchema = outboundSchema(ProviderPreferencesSortEnum);
var ProviderPreferencesProviderSortConfigEnum$outboundSchema = z151.enum(ProviderPreferencesProviderSortConfigEnum);
var ProviderPreferencesBy$outboundSchema = outboundSchema(ProviderPreferencesBy);
var ProviderPreferencesPartition$outboundSchema = outboundSchema(ProviderPreferencesPartition);
var ProviderPreferencesProviderSortConfig$outboundSchema = z151.object({
  by: z151.nullable(ProviderPreferencesBy$outboundSchema).optional(),
  partition: z151.nullable(ProviderPreferencesPartition$outboundSchema).optional()
});
var ProviderPreferencesProviderSortConfigUnion$outboundSchema = z151.union([
  z151.lazy(() => ProviderPreferencesProviderSortConfig$outboundSchema),
  ProviderPreferencesProviderSortConfigEnum$outboundSchema
]);
var ProviderPreferencesProviderSort$outboundSchema = outboundSchema(ProviderPreferencesProviderSort);
var ProviderPreferencesSortUnion$outboundSchema = z151.union([
  ProviderPreferencesProviderSort$outboundSchema,
  z151.union([
    z151.lazy(() => ProviderPreferencesProviderSortConfig$outboundSchema),
    ProviderPreferencesProviderSortConfigEnum$outboundSchema
  ]),
  ProviderPreferencesSortEnum$outboundSchema
]);
var ProviderPreferencesMaxPrice$outboundSchema = z151.object({
  prompt: z151.string().optional(),
  completion: z151.string().optional(),
  image: z151.string().optional(),
  audio: z151.string().optional(),
  request: z151.string().optional()
});
var ProviderPreferences$outboundSchema = z151.object({
  allowFallbacks: z151.nullable(z151.boolean()).optional(),
  requireParameters: z151.nullable(z151.boolean()).optional(),
  dataCollection: z151.nullable(DataCollection$outboundSchema).optional(),
  zdr: z151.nullable(z151.boolean()).optional(),
  enforceDistillableText: z151.nullable(z151.boolean()).optional(),
  order: z151.nullable(z151.array(z151.union([ProviderName$outboundSchema, z151.string()]))).optional(),
  only: z151.nullable(z151.array(z151.union([ProviderName$outboundSchema, z151.string()]))).optional(),
  ignore: z151.nullable(z151.array(z151.union([ProviderName$outboundSchema, z151.string()]))).optional(),
  quantizations: z151.nullable(z151.array(Quantization$outboundSchema)).optional(),
  sort: z151.nullable(z151.union([
    ProviderPreferencesProviderSort$outboundSchema,
    z151.union([
      z151.lazy(() => ProviderPreferencesProviderSortConfig$outboundSchema),
      ProviderPreferencesProviderSortConfigEnum$outboundSchema
    ]),
    ProviderPreferencesSortEnum$outboundSchema
  ])).optional(),
  maxPrice: z151.lazy(() => ProviderPreferencesMaxPrice$outboundSchema).optional(),
  preferredMinThroughput: z151.nullable(PreferredMinThroughput$outboundSchema).optional(),
  preferredMaxLatency: z151.nullable(PreferredMaxLatency$outboundSchema).optional()
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

// node_modules/@openrouter/sdk/esm/models/providersort.js
var ProviderSort = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency",
  Exacto: "exacto"
};
var ProviderSort$outboundSchema = outboundSchema(ProviderSort);

// node_modules/@openrouter/sdk/esm/models/providersortconfig.js
var z152 = __toESM(require("zod/v4"), 1);
var By = {
  Price: "price",
  Throughput: "throughput",
  Latency: "latency",
  Exacto: "exacto"
};
var Partition = {
  Model: "model",
  None: "none"
};
var By$outboundSchema = outboundSchema(By);
var Partition$outboundSchema = outboundSchema(Partition);
var ProviderSortConfig$outboundSchema = z152.object({
  by: z152.nullable(By$outboundSchema).optional(),
  partition: z152.nullable(Partition$outboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/reasoningconfig.js
var z153 = __toESM(require("zod/v4"), 1);
var ReasoningConfig$outboundSchema = z153.object({
  effort: z153.nullable(ReasoningEffortEnum$outboundSchema).optional(),
  summary: z153.nullable(ReasoningSummaryVerbosityEnum$outboundSchema).optional(),
  maxTokens: z153.nullable(z153.number()).optional(),
  enabled: z153.nullable(z153.boolean()).optional()
}).transform((v) => {
  return remap(v, {
    maxTokens: "max_tokens"
  });
});

// node_modules/@openrouter/sdk/esm/models/reasoningdeltaevent.js
var z154 = __toESM(require("zod/v4"), 1);
var ReasoningDeltaEvent$inboundSchema = z154.object({
  type: z154.literal("response.reasoning_text.delta"),
  output_index: z154.number(),
  item_id: z154.string(),
  content_index: z154.number(),
  delta: z154.string(),
  sequence_number: z154.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/reasoningdoneevent.js
var z155 = __toESM(require("zod/v4"), 1);
var ReasoningDoneEvent$inboundSchema = z155.object({
  type: z155.literal("response.reasoning_text.done"),
  output_index: z155.number(),
  item_id: z155.string(),
  content_index: z155.number(),
  text: z155.string(),
  sequence_number: z155.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/reasoningsummarypartaddedevent.js
var z156 = __toESM(require("zod/v4"), 1);
var ReasoningSummaryPartAddedEvent$inboundSchema = z156.object({
  type: z156.literal("response.reasoning_summary_part.added"),
  output_index: z156.number(),
  item_id: z156.string(),
  summary_index: z156.number(),
  part: ReasoningSummaryText$inboundSchema,
  sequence_number: z156.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "summary_index": "summaryIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/reasoningsummarypartdoneevent.js
var z157 = __toESM(require("zod/v4"), 1);
var ReasoningSummaryPartDoneEvent$inboundSchema = z157.object({
  type: z157.literal("response.reasoning_summary_part.done"),
  output_index: z157.number(),
  item_id: z157.string(),
  summary_index: z157.number(),
  part: ReasoningSummaryText$inboundSchema,
  sequence_number: z157.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "summary_index": "summaryIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/reasoningsummarytextdeltaevent.js
var z158 = __toESM(require("zod/v4"), 1);
var ReasoningSummaryTextDeltaEvent$inboundSchema = z158.object({
  type: z158.literal("response.reasoning_summary_text.delta"),
  item_id: z158.string(),
  output_index: z158.number(),
  summary_index: z158.number(),
  delta: z158.string(),
  sequence_number: z158.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "summary_index": "summaryIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/reasoningsummarytextdoneevent.js
var z159 = __toESM(require("zod/v4"), 1);
var ReasoningSummaryTextDoneEvent$inboundSchema = z159.object({
  type: z159.literal("response.reasoning_summary_text.done"),
  item_id: z159.string(),
  output_index: z159.number(),
  summary_index: z159.number(),
  text: z159.string(),
  sequence_number: z159.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "summary_index": "summaryIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/refusaldeltaevent.js
var z160 = __toESM(require("zod/v4"), 1);
var RefusalDeltaEvent$inboundSchema = z160.object({
  type: z160.literal("response.refusal.delta"),
  output_index: z160.number(),
  item_id: z160.string(),
  content_index: z160.number(),
  delta: z160.string(),
  sequence_number: z160.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/refusaldoneevent.js
var z161 = __toESM(require("zod/v4"), 1);
var RefusalDoneEvent$inboundSchema = z161.object({
  type: z161.literal("response.refusal.done"),
  output_index: z161.number(),
  item_id: z161.string(),
  content_index: z161.number(),
  refusal: z161.string(),
  sequence_number: z161.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/requesttimeoutresponseerrordata.js
var z162 = __toESM(require("zod/v4"), 1);
var RequestTimeoutResponseErrorData$inboundSchema = z162.object({
  code: z162.int(),
  message: z162.string(),
  metadata: z162.nullable(z162.record(z162.string(), z162.nullable(z162.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/responseincludesenum.js
var ResponseIncludesEnum = {
  FileSearchCallResults: "file_search_call.results",
  MessageInputImageImageUrl: "message.input_image.image_url",
  ComputerCallOutputOutputImageUrl: "computer_call_output.output.image_url",
  ReasoningEncryptedContent: "reasoning.encrypted_content",
  CodeInterpreterCallOutputs: "code_interpreter_call.outputs"
};
var ResponseIncludesEnum$outboundSchema = outboundSchema(ResponseIncludesEnum);

// node_modules/@openrouter/sdk/esm/models/responsesrequest.js
var z165 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/textextendedconfig.js
var z163 = __toESM(require("zod/v4"), 1);
var TextExtendedConfigVerbosity = {
  High: "high",
  Low: "low",
  Medium: "medium"
};
var TextExtendedConfigVerbosity$outboundSchema = outboundSchema(TextExtendedConfigVerbosity);
var TextExtendedConfig$outboundSchema = z163.object({
  format: Formats$outboundSchema.optional(),
  verbosity: z163.nullable(TextExtendedConfigVerbosity$outboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/websearchservertoolopenrouter.js
var z164 = __toESM(require("zod/v4"), 1);
var WebSearchServerToolOpenRouterParameters$outboundSchema = z164.object({
  maxResults: z164.number().optional(),
  maxTotalResults: z164.number().optional()
}).transform((v) => {
  return remap(v, {
    maxResults: "max_results",
    maxTotalResults: "max_total_results"
  });
});
var WebSearchServerToolOpenRouter$outboundSchema = z164.object({
  type: z164.literal("openrouter:web_search"),
  parameters: z164.lazy(() => WebSearchServerToolOpenRouterParameters$outboundSchema).optional()
});

// node_modules/@openrouter/sdk/esm/models/responsesrequest.js
var ResponsesRequestServiceTier = {
  Auto: "auto",
  Default: "default",
  Flex: "flex",
  Priority: "priority",
  Scale: "scale"
};
var ResponsesRequestToolFunction$outboundSchema = z165.object({
  type: z165.literal("function"),
  name: z165.string(),
  description: z165.nullable(z165.string()).optional(),
  strict: z165.nullable(z165.boolean()).optional(),
  parameters: z165.nullable(z165.record(z165.string(), z165.nullable(z165.any())))
});
var ResponsesRequestToolUnion$outboundSchema = z165.union([
  z165.lazy(() => ResponsesRequestToolFunction$outboundSchema),
  PreviewWebSearchServerTool$outboundSchema,
  Preview20250311WebSearchServerTool$outboundSchema,
  LegacyWebSearchServerTool$outboundSchema,
  WebSearchServerTool$outboundSchema,
  FileSearchServerTool$outboundSchema,
  ComputerUseServerTool$outboundSchema,
  CodeInterpreterServerTool$outboundSchema,
  McpServerTool$outboundSchema,
  ImageGenerationServerTool$outboundSchema,
  CodexLocalShellTool$outboundSchema,
  ShellServerTool$outboundSchema,
  ApplyPatchServerTool$outboundSchema,
  CustomTool$outboundSchema,
  DatetimeServerTool$outboundSchema.and(z165.object({ type: z165.literal("openrouter:datetime") })),
  WebSearchServerToolOpenRouter$outboundSchema
]);
var ResponsesRequestImageConfig$outboundSchema = z165.union([z165.string(), z165.number()]);
var ResponsesRequestServiceTier$outboundSchema = outboundSchema(ResponsesRequestServiceTier);
var ResponsesRequestOrder$outboundSchema = z165.union([ProviderName$outboundSchema, z165.string()]);
var ResponsesRequestOnly$outboundSchema = z165.union([ProviderName$outboundSchema, z165.string()]);
var ResponsesRequestIgnore$outboundSchema = z165.union([ProviderName$outboundSchema, z165.string()]);
var ResponsesRequestSort$outboundSchema = z165.union([
  ProviderSort$outboundSchema,
  ProviderSortConfig$outboundSchema,
  z165.any()
]);
var ResponsesRequestMaxPrice$outboundSchema = z165.object({
  prompt: z165.string().optional(),
  completion: z165.string().optional(),
  image: z165.string().optional(),
  audio: z165.string().optional(),
  request: z165.string().optional()
});
var ResponsesRequestProvider$outboundSchema = z165.object({
  allowFallbacks: z165.nullable(z165.boolean()).optional(),
  requireParameters: z165.nullable(z165.boolean()).optional(),
  dataCollection: z165.nullable(DataCollection$outboundSchema).optional(),
  zdr: z165.nullable(z165.boolean()).optional(),
  enforceDistillableText: z165.nullable(z165.boolean()).optional(),
  order: z165.nullable(z165.array(z165.union([ProviderName$outboundSchema, z165.string()]))).optional(),
  only: z165.nullable(z165.array(z165.union([ProviderName$outboundSchema, z165.string()]))).optional(),
  ignore: z165.nullable(z165.array(z165.union([ProviderName$outboundSchema, z165.string()]))).optional(),
  quantizations: z165.nullable(z165.array(Quantization$outboundSchema)).optional(),
  sort: z165.nullable(z165.union([
    ProviderSort$outboundSchema,
    ProviderSortConfig$outboundSchema,
    z165.any()
  ])).optional(),
  maxPrice: z165.lazy(() => ResponsesRequestMaxPrice$outboundSchema).optional(),
  preferredMinThroughput: z165.nullable(PreferredMinThroughput$outboundSchema).optional(),
  preferredMaxLatency: z165.nullable(PreferredMaxLatency$outboundSchema).optional()
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
var ResponsesRequestPluginContextCompression$outboundSchema = z165.object({
  id: z165.literal("context-compression"),
  enabled: z165.boolean().optional(),
  engine: ContextCompressionEngine$outboundSchema.optional()
});
var ResponsesRequestPluginResponseHealing$outboundSchema = z165.object({
  id: z165.literal("response-healing"),
  enabled: z165.boolean().optional()
});
var ResponsesRequestPluginFileParser$outboundSchema = z165.object({
  id: z165.literal("file-parser"),
  enabled: z165.boolean().optional(),
  pdf: PDFParserOptions$outboundSchema.optional()
});
var ResponsesRequestPluginWeb$outboundSchema = z165.object({
  id: z165.literal("web"),
  enabled: z165.boolean().optional(),
  maxResults: z165.number().optional(),
  searchPrompt: z165.string().optional(),
  engine: WebSearchEngine$outboundSchema.optional(),
  includeDomains: z165.array(z165.string()).optional(),
  excludeDomains: z165.array(z165.string()).optional()
}).transform((v) => {
  return remap(v, {
    maxResults: "max_results",
    searchPrompt: "search_prompt",
    includeDomains: "include_domains",
    excludeDomains: "exclude_domains"
  });
});
var ResponsesRequestPluginModeration$outboundSchema = z165.object({
  id: z165.literal("moderation")
});
var ResponsesRequestPluginAutoRouter$outboundSchema = z165.object({
  id: z165.literal("auto-router"),
  enabled: z165.boolean().optional(),
  allowedModels: z165.array(z165.string()).optional()
}).transform((v) => {
  return remap(v, {
    allowedModels: "allowed_models"
  });
});
var ResponsesRequestPluginUnion$outboundSchema = z165.union([
  z165.lazy(() => ResponsesRequestPluginAutoRouter$outboundSchema),
  z165.lazy(() => ResponsesRequestPluginModeration$outboundSchema),
  z165.lazy(() => ResponsesRequestPluginWeb$outboundSchema),
  z165.lazy(() => ResponsesRequestPluginFileParser$outboundSchema),
  z165.lazy(() => ResponsesRequestPluginResponseHealing$outboundSchema),
  z165.lazy(() => ResponsesRequestPluginContextCompression$outboundSchema)
]);
var ResponsesRequestTrace$outboundSchema = z165.object({
  traceId: z165.string().optional(),
  traceName: z165.string().optional(),
  spanName: z165.string().optional(),
  generationName: z165.string().optional(),
  parentSpanId: z165.string().optional(),
  additionalProperties: z165.record(z165.string(), z165.nullable(z165.any())).optional()
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
var ResponsesRequest$outboundSchema = z165.object({
  input: InputsUnion$outboundSchema.optional(),
  instructions: z165.nullable(z165.string()).optional(),
  metadata: z165.nullable(z165.record(z165.string(), z165.string())).optional(),
  tools: z165.array(z165.union([
    z165.lazy(() => ResponsesRequestToolFunction$outboundSchema),
    PreviewWebSearchServerTool$outboundSchema,
    Preview20250311WebSearchServerTool$outboundSchema,
    LegacyWebSearchServerTool$outboundSchema,
    WebSearchServerTool$outboundSchema,
    FileSearchServerTool$outboundSchema,
    ComputerUseServerTool$outboundSchema,
    CodeInterpreterServerTool$outboundSchema,
    McpServerTool$outboundSchema,
    ImageGenerationServerTool$outboundSchema,
    CodexLocalShellTool$outboundSchema,
    ShellServerTool$outboundSchema,
    ApplyPatchServerTool$outboundSchema,
    CustomTool$outboundSchema,
    DatetimeServerTool$outboundSchema.and(z165.object({ type: z165.literal("openrouter:datetime") })),
    WebSearchServerToolOpenRouter$outboundSchema
  ])).optional(),
  toolChoice: OpenAIResponsesToolChoiceUnion$outboundSchema.optional(),
  parallelToolCalls: z165.nullable(z165.boolean()).optional(),
  model: z165.string().optional(),
  models: z165.array(z165.string()).optional(),
  text: TextExtendedConfig$outboundSchema.optional(),
  reasoning: z165.nullable(ReasoningConfig$outboundSchema).optional(),
  maxOutputTokens: z165.nullable(z165.number()).optional(),
  temperature: z165.nullable(z165.number()).optional(),
  topP: z165.nullable(z165.number()).optional(),
  topLogprobs: z165.nullable(z165.int()).optional(),
  maxToolCalls: z165.nullable(z165.int()).optional(),
  presencePenalty: z165.nullable(z165.number()).optional(),
  frequencyPenalty: z165.nullable(z165.number()).optional(),
  topK: z165.number().optional(),
  imageConfig: z165.record(z165.string(), z165.union([z165.string(), z165.number()])).optional(),
  modalities: z165.array(OutputModalityEnum$outboundSchema).optional(),
  promptCacheKey: z165.nullable(z165.string()).optional(),
  previousResponseId: z165.nullable(z165.string()).optional(),
  prompt: z165.nullable(StoredPromptTemplate$outboundSchema).optional(),
  include: z165.nullable(z165.array(ResponseIncludesEnum$outboundSchema)).optional(),
  background: z165.nullable(z165.boolean()).optional(),
  safetyIdentifier: z165.nullable(z165.string()).optional(),
  store: z165.literal(false).default(false),
  serviceTier: z165.nullable(ResponsesRequestServiceTier$outboundSchema.default("auto")),
  truncation: z165.nullable(OpenAIResponsesTruncation$outboundSchema).optional(),
  stream: z165.boolean().default(false),
  provider: z165.nullable(z165.lazy(() => ResponsesRequestProvider$outboundSchema)).optional(),
  plugins: z165.array(z165.union([
    z165.lazy(() => ResponsesRequestPluginAutoRouter$outboundSchema),
    z165.lazy(() => ResponsesRequestPluginModeration$outboundSchema),
    z165.lazy(() => ResponsesRequestPluginWeb$outboundSchema),
    z165.lazy(() => ResponsesRequestPluginFileParser$outboundSchema),
    z165.lazy(() => ResponsesRequestPluginResponseHealing$outboundSchema),
    z165.lazy(() => ResponsesRequestPluginContextCompression$outboundSchema)
  ])).optional(),
  user: z165.string().optional(),
  sessionId: z165.string().optional(),
  trace: z165.lazy(() => ResponsesRequestTrace$outboundSchema).optional()
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

// node_modules/@openrouter/sdk/esm/models/serviceunavailableresponseerrordata.js
var z166 = __toESM(require("zod/v4"), 1);
var ServiceUnavailableResponseErrorData$inboundSchema = z166.object({
  code: z166.int(),
  message: z166.string(),
  metadata: z166.nullable(z166.record(z166.string(), z166.nullable(z166.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/streamevents.js
var z172 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/models/textdeltaevent.js
var z167 = __toESM(require("zod/v4"), 1);
var TextDeltaEventTopLogprob$inboundSchema = z167.object({
  token: z167.string().optional(),
  logprob: z167.number().optional(),
  bytes: z167.array(z167.number()).optional()
});
var TextDeltaEventLogprob$inboundSchema = z167.object({
  logprob: z167.number(),
  token: z167.string(),
  top_logprobs: z167.array(z167.lazy(() => TextDeltaEventTopLogprob$inboundSchema)).optional(),
  bytes: z167.array(z167.number()).optional()
}).transform((v) => {
  return remap(v, {
    "top_logprobs": "topLogprobs"
  });
});
var TextDeltaEvent$inboundSchema = z167.object({
  type: z167.literal("response.output_text.delta"),
  logprobs: z167.array(z167.lazy(() => TextDeltaEventLogprob$inboundSchema)),
  output_index: z167.number(),
  item_id: z167.string(),
  content_index: z167.number(),
  delta: z167.string(),
  sequence_number: z167.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/textdoneevent.js
var z168 = __toESM(require("zod/v4"), 1);
var TextDoneEventTopLogprob$inboundSchema = z168.object({
  token: z168.string().optional(),
  logprob: z168.number().optional(),
  bytes: z168.array(z168.number()).optional()
});
var TextDoneEventLogprob$inboundSchema = z168.object({
  logprob: z168.number(),
  token: z168.string(),
  top_logprobs: z168.array(z168.lazy(() => TextDoneEventTopLogprob$inboundSchema)).optional(),
  bytes: z168.array(z168.number()).optional()
}).transform((v) => {
  return remap(v, {
    "top_logprobs": "topLogprobs"
  });
});
var TextDoneEvent$inboundSchema = z168.object({
  type: z168.literal("response.output_text.done"),
  output_index: z168.number(),
  item_id: z168.string(),
  content_index: z168.number(),
  text: z168.string(),
  sequence_number: z168.number(),
  logprobs: z168.array(z168.lazy(() => TextDoneEventLogprob$inboundSchema))
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "item_id": "itemId",
    "content_index": "contentIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/websearchcallcompletedevent.js
var z169 = __toESM(require("zod/v4"), 1);
var WebSearchCallCompletedEvent$inboundSchema = z169.object({
  type: z169.literal("response.web_search_call.completed"),
  item_id: z169.string(),
  output_index: z169.number(),
  sequence_number: z169.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/websearchcallinprogressevent.js
var z170 = __toESM(require("zod/v4"), 1);
var WebSearchCallInProgressEvent$inboundSchema = z170.object({
  type: z170.literal("response.web_search_call.in_progress"),
  item_id: z170.string(),
  output_index: z170.number(),
  sequence_number: z170.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/websearchcallsearchingevent.js
var z171 = __toESM(require("zod/v4"), 1);
var WebSearchCallSearchingEvent$inboundSchema = z171.object({
  type: z171.literal("response.web_search_call.searching"),
  item_id: z171.string(),
  output_index: z171.number(),
  sequence_number: z171.number()
}).transform((v) => {
  return remap(v, {
    "item_id": "itemId",
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});

// node_modules/@openrouter/sdk/esm/models/streamevents.js
var StreamEventsResponseOutputItemDone$inboundSchema = z172.object({
  type: z172.literal("response.output_item.done"),
  output_index: z172.number(),
  item: OutputItems$inboundSchema,
  sequence_number: z172.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});
var StreamEventsResponseOutputItemAdded$inboundSchema = z172.object({
  type: z172.literal("response.output_item.added"),
  output_index: z172.number(),
  item: OutputItems$inboundSchema,
  sequence_number: z172.number()
}).transform((v) => {
  return remap(v, {
    "output_index": "outputIndex",
    "sequence_number": "sequenceNumber"
  });
});
var StreamEventsResponseFailed$inboundSchema = z172.object({
  type: z172.literal("response.failed"),
  response: OpenResponsesResult$inboundSchema,
  sequence_number: z172.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var StreamEventsResponseIncomplete$inboundSchema = z172.object({
  type: z172.literal("response.incomplete"),
  response: OpenResponsesResult$inboundSchema,
  sequence_number: z172.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var StreamEventsResponseCompleted$inboundSchema = z172.object({
  type: z172.literal("response.completed"),
  response: OpenResponsesResult$inboundSchema,
  sequence_number: z172.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var StreamEventsResponseInProgress$inboundSchema = z172.object({
  type: z172.literal("response.in_progress"),
  response: OpenResponsesResult$inboundSchema,
  sequence_number: z172.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var StreamEventsResponseCreated$inboundSchema = z172.object({
  type: z172.literal("response.created"),
  response: OpenResponsesResult$inboundSchema,
  sequence_number: z172.number()
}).transform((v) => {
  return remap(v, {
    "sequence_number": "sequenceNumber"
  });
});
var StreamEvents$inboundSchema = z172.union([
  z172.lazy(() => StreamEventsResponseCreated$inboundSchema),
  z172.lazy(() => StreamEventsResponseInProgress$inboundSchema),
  z172.lazy(() => StreamEventsResponseCompleted$inboundSchema),
  z172.lazy(() => StreamEventsResponseIncomplete$inboundSchema),
  z172.lazy(() => StreamEventsResponseFailed$inboundSchema),
  ErrorEvent$inboundSchema,
  z172.lazy(() => StreamEventsResponseOutputItemAdded$inboundSchema),
  z172.lazy(() => StreamEventsResponseOutputItemDone$inboundSchema),
  ContentPartAddedEvent$inboundSchema,
  ContentPartDoneEvent$inboundSchema,
  TextDeltaEvent$inboundSchema,
  TextDoneEvent$inboundSchema,
  RefusalDeltaEvent$inboundSchema,
  RefusalDoneEvent$inboundSchema,
  AnnotationAddedEvent$inboundSchema,
  FunctionCallArgsDeltaEvent$inboundSchema,
  FunctionCallArgsDoneEvent$inboundSchema,
  ReasoningDeltaEvent$inboundSchema,
  ReasoningDoneEvent$inboundSchema,
  ReasoningSummaryPartAddedEvent$inboundSchema,
  ReasoningSummaryPartDoneEvent$inboundSchema,
  ReasoningSummaryTextDeltaEvent$inboundSchema,
  ReasoningSummaryTextDoneEvent$inboundSchema,
  ImageGenCallInProgressEvent$inboundSchema,
  ImageGenCallGeneratingEvent$inboundSchema,
  ImageGenCallPartialImageEvent$inboundSchema,
  ImageGenCallCompletedEvent$inboundSchema,
  WebSearchCallInProgressEvent$inboundSchema,
  WebSearchCallSearchingEvent$inboundSchema,
  WebSearchCallCompletedEvent$inboundSchema
]);

// node_modules/@openrouter/sdk/esm/models/toomanyrequestsresponseerrordata.js
var z173 = __toESM(require("zod/v4"), 1);
var TooManyRequestsResponseErrorData$inboundSchema = z173.object({
  code: z173.int(),
  message: z173.string(),
  metadata: z173.nullable(z173.record(z173.string(), z173.nullable(z173.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/unauthorizedresponseerrordata.js
var z174 = __toESM(require("zod/v4"), 1);
var UnauthorizedResponseErrorData$inboundSchema = z174.object({
  code: z174.int(),
  message: z174.string(),
  metadata: z174.nullable(z174.record(z174.string(), z174.nullable(z174.any()))).optional()
});

// node_modules/@openrouter/sdk/esm/models/unprocessableentityresponseerrordata.js
var z175 = __toESM(require("zod/v4"), 1);
var UnprocessableEntityResponseErrorData$inboundSchema = z175.object({
  code: z175.int(),
  message: z175.string(),
  metadata: z175.nullable(z175.record(z175.string(), z175.nullable(z175.any()))).optional()
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
var BadGatewayResponseError$inboundSchema = z176.object({
  error: BadGatewayResponseErrorData$inboundSchema,
  user_id: z176.nullable(z176.string()).optional(),
  request$: z176.custom((x) => x instanceof Request),
  response$: z176.custom((x) => x instanceof Response),
  body$: z176.string()
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
var z177 = __toESM(require("zod/v4"), 1);
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
var BadRequestResponseError$inboundSchema = z177.object({
  error: BadRequestResponseErrorData$inboundSchema,
  user_id: z177.nullable(z177.string()).optional(),
  request$: z177.custom((x) => x instanceof Request),
  response$: z177.custom((x) => x instanceof Response),
  body$: z177.string()
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

// node_modules/@openrouter/sdk/esm/models/errors/conflictresponseerror.js
var z178 = __toESM(require("zod/v4"), 1);
var ConflictResponseError = class extends OpenRouterError {
  constructor(err, httpMeta) {
    const message = err.error?.message || `API error occurred: ${JSON.stringify(err)}`;
    super(message, httpMeta);
    this.data$ = err;
    this.error = err.error;
    if (err.userId != null)
      this.userId = err.userId;
    this.name = "ConflictResponseError";
  }
};
var ConflictResponseError$inboundSchema = z178.object({
  error: ConflictResponseErrorData$inboundSchema,
  user_id: z178.nullable(z178.string()).optional(),
  request$: z178.custom((x) => x instanceof Request),
  response$: z178.custom((x) => x instanceof Response),
  body$: z178.string()
}).transform((v) => {
  const remapped = remap(v, {
    "user_id": "userId"
  });
  return new ConflictResponseError(remapped, {
    request: v.request$,
    response: v.response$,
    body: v.body$
  });
});

// node_modules/@openrouter/sdk/esm/models/errors/edgenetworktimeoutresponseerror.js
var z179 = __toESM(require("zod/v4"), 1);
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
var EdgeNetworkTimeoutResponseError$inboundSchema = z179.object({
  error: EdgeNetworkTimeoutResponseErrorData$inboundSchema,
  user_id: z179.nullable(z179.string()).optional(),
  request$: z179.custom((x) => x instanceof Request),
  response$: z179.custom((x) => x instanceof Response),
  body$: z179.string()
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
var z180 = __toESM(require("zod/v4"), 1);
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
var ForbiddenResponseError$inboundSchema = z180.object({
  error: ForbiddenResponseErrorData$inboundSchema,
  user_id: z180.nullable(z180.string()).optional(),
  request$: z180.custom((x) => x instanceof Request),
  response$: z180.custom((x) => x instanceof Response),
  body$: z180.string()
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
var z181 = __toESM(require("zod/v4"), 1);
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
var InternalServerResponseError$inboundSchema = z181.object({
  error: InternalServerResponseErrorData$inboundSchema,
  user_id: z181.nullable(z181.string()).optional(),
  request$: z181.custom((x) => x instanceof Request),
  response$: z181.custom((x) => x instanceof Response),
  body$: z181.string()
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
var z182 = __toESM(require("zod/v4"), 1);
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
var NotFoundResponseError$inboundSchema = z182.object({
  error: NotFoundResponseErrorData$inboundSchema,
  user_id: z182.nullable(z182.string()).optional(),
  request$: z182.custom((x) => x instanceof Request),
  response$: z182.custom((x) => x instanceof Response),
  body$: z182.string()
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
var z183 = __toESM(require("zod/v4"), 1);
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
var PayloadTooLargeResponseError$inboundSchema = z183.object({
  error: PayloadTooLargeResponseErrorData$inboundSchema,
  user_id: z183.nullable(z183.string()).optional(),
  request$: z183.custom((x) => x instanceof Request),
  response$: z183.custom((x) => x instanceof Response),
  body$: z183.string()
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
var z184 = __toESM(require("zod/v4"), 1);
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
var PaymentRequiredResponseError$inboundSchema = z184.object({
  error: PaymentRequiredResponseErrorData$inboundSchema,
  user_id: z184.nullable(z184.string()).optional(),
  request$: z184.custom((x) => x instanceof Request),
  response$: z184.custom((x) => x instanceof Response),
  body$: z184.string()
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
var z185 = __toESM(require("zod/v4"), 1);
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
var ProviderOverloadedResponseError$inboundSchema = z185.object({
  error: ProviderOverloadedResponseErrorData$inboundSchema,
  user_id: z185.nullable(z185.string()).optional(),
  request$: z185.custom((x) => x instanceof Request),
  response$: z185.custom((x) => x instanceof Response),
  body$: z185.string()
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
var z186 = __toESM(require("zod/v4"), 1);
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
var RequestTimeoutResponseError$inboundSchema = z186.object({
  error: RequestTimeoutResponseErrorData$inboundSchema,
  user_id: z186.nullable(z186.string()).optional(),
  request$: z186.custom((x) => x instanceof Request),
  response$: z186.custom((x) => x instanceof Response),
  body$: z186.string()
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
var z187 = __toESM(require("zod/v4"), 1);
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
var ServiceUnavailableResponseError$inboundSchema = z187.object({
  error: ServiceUnavailableResponseErrorData$inboundSchema,
  user_id: z187.nullable(z187.string()).optional(),
  request$: z187.custom((x) => x instanceof Request),
  response$: z187.custom((x) => x instanceof Response),
  body$: z187.string()
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
var z188 = __toESM(require("zod/v4"), 1);
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
var TooManyRequestsResponseError$inboundSchema = z188.object({
  error: TooManyRequestsResponseErrorData$inboundSchema,
  user_id: z188.nullable(z188.string()).optional(),
  request$: z188.custom((x) => x instanceof Request),
  response$: z188.custom((x) => x instanceof Response),
  body$: z188.string()
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
var z189 = __toESM(require("zod/v4"), 1);
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
var UnauthorizedResponseError$inboundSchema = z189.object({
  error: UnauthorizedResponseErrorData$inboundSchema,
  user_id: z189.nullable(z189.string()).optional(),
  request$: z189.custom((x) => x instanceof Request),
  response$: z189.custom((x) => x instanceof Response),
  body$: z189.string()
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
var z190 = __toESM(require("zod/v4"), 1);
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
var UnprocessableEntityResponseError$inboundSchema = z190.object({
  error: UnprocessableEntityResponseErrorData$inboundSchema,
  user_id: z190.nullable(z190.string()).optional(),
  request$: z190.custom((x) => x instanceof Request),
  response$: z190.custom((x) => x instanceof Response),
  body$: z190.string()
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
var z191 = __toESM(require("zod/v4"), 1);
var BulkAssignKeysToGuardrailRequestBody$outboundSchema = z191.object({
  keyHashes: z191.array(z191.string())
}).transform((v) => {
  return remap(v, {
    keyHashes: "key_hashes"
  });
});
var BulkAssignKeysToGuardrailRequest$outboundSchema = z191.object({
  httpReferer: z191.string().optional(),
  appTitle: z191.string().optional(),
  appCategories: z191.string().optional(),
  id: z191.string(),
  requestBody: z191.lazy(() => BulkAssignKeysToGuardrailRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    requestBody: "RequestBody"
  });
});
var BulkAssignKeysToGuardrailResponse$inboundSchema = z191.object({
  assigned_count: z191.number()
}).transform((v) => {
  return remap(v, {
    "assigned_count": "assignedCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/bulkassignmemberstoguardrail.js
var z192 = __toESM(require("zod/v4"), 1);
var BulkAssignMembersToGuardrailRequestBody$outboundSchema = z192.object({
  memberUserIds: z192.array(z192.string())
}).transform((v) => {
  return remap(v, {
    memberUserIds: "member_user_ids"
  });
});
var BulkAssignMembersToGuardrailRequest$outboundSchema = z192.object({
  httpReferer: z192.string().optional(),
  appTitle: z192.string().optional(),
  appCategories: z192.string().optional(),
  id: z192.string(),
  requestBody: z192.lazy(() => BulkAssignMembersToGuardrailRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    requestBody: "RequestBody"
  });
});
var BulkAssignMembersToGuardrailResponse$inboundSchema = z192.object({
  assigned_count: z192.number()
}).transform((v) => {
  return remap(v, {
    "assigned_count": "assignedCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/bulkunassignkeysfromguardrail.js
var z193 = __toESM(require("zod/v4"), 1);
var BulkUnassignKeysFromGuardrailRequestBody$outboundSchema = z193.object({
  keyHashes: z193.array(z193.string())
}).transform((v) => {
  return remap(v, {
    keyHashes: "key_hashes"
  });
});
var BulkUnassignKeysFromGuardrailRequest$outboundSchema = z193.object({
  httpReferer: z193.string().optional(),
  appTitle: z193.string().optional(),
  appCategories: z193.string().optional(),
  id: z193.string(),
  requestBody: z193.lazy(() => BulkUnassignKeysFromGuardrailRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    requestBody: "RequestBody"
  });
});
var BulkUnassignKeysFromGuardrailResponse$inboundSchema = z193.object({
  unassigned_count: z193.number()
}).transform((v) => {
  return remap(v, {
    "unassigned_count": "unassignedCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/bulkunassignmembersfromguardrail.js
var z194 = __toESM(require("zod/v4"), 1);
var BulkUnassignMembersFromGuardrailRequestBody$outboundSchema = z194.object({
  memberUserIds: z194.array(z194.string())
}).transform((v) => {
  return remap(v, {
    memberUserIds: "member_user_ids"
  });
});
var BulkUnassignMembersFromGuardrailRequest$outboundSchema = z194.object({
  httpReferer: z194.string().optional(),
  appTitle: z194.string().optional(),
  appCategories: z194.string().optional(),
  id: z194.string(),
  requestBody: z194.lazy(() => BulkUnassignMembersFromGuardrailRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    requestBody: "RequestBody"
  });
});
var BulkUnassignMembersFromGuardrailResponse$inboundSchema = z194.object({
  unassigned_count: z194.number()
}).transform((v) => {
  return remap(v, {
    "unassigned_count": "unassignedCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/createauthkeyscode.js
var z195 = __toESM(require("zod/v4"), 1);
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
var CreateAuthKeysCodeRequestBody$outboundSchema = z195.object({
  callbackUrl: z195.string(),
  codeChallenge: z195.string().optional(),
  codeChallengeMethod: CreateAuthKeysCodeCodeChallengeMethod$outboundSchema.optional(),
  limit: z195.number().optional(),
  expiresAt: z195.nullable(z195.date().transform((v) => v.toISOString())).optional(),
  keyLabel: z195.string().optional(),
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
var CreateAuthKeysCodeRequest$outboundSchema = z195.object({
  httpReferer: z195.string().optional(),
  appTitle: z195.string().optional(),
  appCategories: z195.string().optional(),
  requestBody: z195.lazy(() => CreateAuthKeysCodeRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    requestBody: "RequestBody"
  });
});
var CreateAuthKeysCodeData$inboundSchema = z195.object({
  id: z195.string(),
  app_id: z195.number(),
  created_at: z195.string()
}).transform((v) => {
  return remap(v, {
    "app_id": "appId",
    "created_at": "createdAt"
  });
});
var CreateAuthKeysCodeResponse$inboundSchema = z195.object({
  data: z195.lazy(() => CreateAuthKeysCodeData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/createcoinbasecharge.js
var z196 = __toESM(require("zod/v4"), 1);
var CreateCoinbaseChargeSecurity$outboundSchema = z196.object({
  bearer: z196.string()
});
var CreateCoinbaseChargeRequest$outboundSchema = z196.object({
  httpReferer: z196.string().optional(),
  appTitle: z196.string().optional(),
  appCategories: z196.string().optional(),
  createChargeRequest: CreateChargeRequest$outboundSchema
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    createChargeRequest: "CreateChargeRequest"
  });
});
var CallData$inboundSchema = z196.object({
  deadline: z196.string(),
  fee_amount: z196.string(),
  id: z196.string(),
  operator: z196.string(),
  prefix: z196.string(),
  recipient: z196.string(),
  recipient_amount: z196.string(),
  recipient_currency: z196.string(),
  refund_destination: z196.string(),
  signature: z196.string()
}).transform((v) => {
  return remap(v, {
    "fee_amount": "feeAmount",
    "recipient_amount": "recipientAmount",
    "recipient_currency": "recipientCurrency",
    "refund_destination": "refundDestination"
  });
});
var Metadata$inboundSchema = z196.object({
  chain_id: z196.number(),
  contract_address: z196.string(),
  sender: z196.string()
}).transform((v) => {
  return remap(v, {
    "chain_id": "chainId",
    "contract_address": "contractAddress"
  });
});
var TransferIntent$inboundSchema = z196.object({
  call_data: z196.lazy(() => CallData$inboundSchema),
  metadata: z196.lazy(() => Metadata$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "call_data": "callData"
  });
});
var Web3Data$inboundSchema = z196.object({
  transfer_intent: z196.lazy(() => TransferIntent$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "transfer_intent": "transferIntent"
  });
});
var CreateCoinbaseChargeData$inboundSchema = z196.object({
  id: z196.string(),
  created_at: z196.string(),
  expires_at: z196.string(),
  web3_data: z196.lazy(() => Web3Data$inboundSchema)
}).transform((v) => {
  return remap(v, {
    "created_at": "createdAt",
    "expires_at": "expiresAt",
    "web3_data": "web3Data"
  });
});
var CreateCoinbaseChargeResponse$inboundSchema = z196.object({
  data: z196.lazy(() => CreateCoinbaseChargeData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/createembeddings.js
var z197 = __toESM(require("zod/v4"), 1);
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
var ImageUrl$outboundSchema = z197.object({
  url: z197.string()
});
var ContentImageURL$outboundSchema = z197.object({
  type: z197.literal("image_url"),
  imageUrl: z197.lazy(() => ImageUrl$outboundSchema)
}).transform((v) => {
  return remap(v, {
    imageUrl: "image_url"
  });
});
var ContentText$outboundSchema = z197.object({
  type: z197.literal("text"),
  text: z197.string()
});
var Content$outboundSchema = z197.union([
  z197.lazy(() => ContentText$outboundSchema),
  z197.lazy(() => ContentImageURL$outboundSchema)
]);
var Input$outboundSchema = z197.object({
  content: z197.array(z197.union([
    z197.lazy(() => ContentText$outboundSchema),
    z197.lazy(() => ContentImageURL$outboundSchema)
  ]))
});
var InputUnion$outboundSchema = z197.union([
  z197.string(),
  z197.array(z197.string()),
  z197.array(z197.number()),
  z197.array(z197.array(z197.number())),
  z197.array(z197.lazy(() => Input$outboundSchema))
]);
var EncodingFormat$outboundSchema = outboundSchema(EncodingFormat);
var CreateEmbeddingsRequestBody$outboundSchema = z197.object({
  input: z197.union([
    z197.string(),
    z197.array(z197.string()),
    z197.array(z197.number()),
    z197.array(z197.array(z197.number())),
    z197.array(z197.lazy(() => Input$outboundSchema))
  ]),
  model: z197.string(),
  encodingFormat: EncodingFormat$outboundSchema.optional(),
  dimensions: z197.int().optional(),
  user: z197.string().optional(),
  provider: ProviderPreferences$outboundSchema.optional(),
  inputType: z197.string().optional()
}).transform((v) => {
  return remap(v, {
    encodingFormat: "encoding_format",
    inputType: "input_type"
  });
});
var CreateEmbeddingsRequest$outboundSchema = z197.object({
  httpReferer: z197.string().optional(),
  appTitle: z197.string().optional(),
  appCategories: z197.string().optional(),
  requestBody: z197.lazy(() => CreateEmbeddingsRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    requestBody: "RequestBody"
  });
});
var ObjectT$inboundSchema = z197.enum(ObjectT);
var ObjectEmbedding$inboundSchema = z197.enum(ObjectEmbedding);
var Embedding$inboundSchema = z197.union([
  z197.array(z197.number()),
  z197.string()
]);
var CreateEmbeddingsData$inboundSchema = z197.object({
  object: ObjectEmbedding$inboundSchema,
  embedding: z197.union([z197.array(z197.number()), z197.string()]),
  index: z197.number().optional()
});
var Usage$inboundSchema2 = z197.object({
  prompt_tokens: z197.number(),
  total_tokens: z197.number(),
  cost: z197.number().optional()
}).transform((v) => {
  return remap(v, {
    "prompt_tokens": "promptTokens",
    "total_tokens": "totalTokens"
  });
});
var CreateEmbeddingsResponseBody$inboundSchema = z197.object({
  id: z197.string().optional(),
  object: ObjectT$inboundSchema,
  data: z197.array(z197.lazy(() => CreateEmbeddingsData$inboundSchema)),
  model: z197.string(),
  usage: z197.lazy(() => Usage$inboundSchema2).optional()
});
var CreateEmbeddingsResponse$inboundSchema = z197.union([
  z197.lazy(() => CreateEmbeddingsResponseBody$inboundSchema),
  z197.string()
]);

// node_modules/@openrouter/sdk/esm/models/operations/createguardrail.js
var z198 = __toESM(require("zod/v4"), 1);
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
var CreateGuardrailRequestBody$outboundSchema = z198.object({
  name: z198.string(),
  description: z198.nullable(z198.string()).optional(),
  limitUsd: z198.nullable(z198.number()).optional(),
  resetInterval: z198.nullable(CreateGuardrailResetIntervalRequest$outboundSchema).optional(),
  allowedProviders: z198.nullable(z198.array(z198.string())).optional(),
  ignoredProviders: z198.nullable(z198.array(z198.string())).optional(),
  allowedModels: z198.nullable(z198.array(z198.string())).optional(),
  enforceZdr: z198.nullable(z198.boolean()).optional()
}).transform((v) => {
  return remap(v, {
    limitUsd: "limit_usd",
    resetInterval: "reset_interval",
    allowedProviders: "allowed_providers",
    ignoredProviders: "ignored_providers",
    allowedModels: "allowed_models",
    enforceZdr: "enforce_zdr"
  });
});
var CreateGuardrailRequest$outboundSchema = z198.object({
  httpReferer: z198.string().optional(),
  appTitle: z198.string().optional(),
  appCategories: z198.string().optional(),
  requestBody: z198.lazy(() => CreateGuardrailRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    requestBody: "RequestBody"
  });
});
var CreateGuardrailResetIntervalResponse$inboundSchema = inboundSchema(CreateGuardrailResetIntervalResponse);
var CreateGuardrailData$inboundSchema = z198.object({
  id: z198.string(),
  name: z198.string(),
  description: z198.nullable(z198.string()).optional(),
  limit_usd: z198.nullable(z198.number()).optional(),
  reset_interval: z198.nullable(CreateGuardrailResetIntervalResponse$inboundSchema).optional(),
  allowed_providers: z198.nullable(z198.array(z198.string())).optional(),
  ignored_providers: z198.nullable(z198.array(z198.string())).optional(),
  allowed_models: z198.nullable(z198.array(z198.string())).optional(),
  enforce_zdr: z198.nullable(z198.boolean()).optional(),
  created_at: z198.string(),
  updated_at: z198.nullable(z198.string()).optional()
}).transform((v) => {
  return remap(v, {
    "limit_usd": "limitUsd",
    "reset_interval": "resetInterval",
    "allowed_providers": "allowedProviders",
    "ignored_providers": "ignoredProviders",
    "allowed_models": "allowedModels",
    "enforce_zdr": "enforceZdr",
    "created_at": "createdAt",
    "updated_at": "updatedAt"
  });
});
var CreateGuardrailResponse$inboundSchema = z198.object({
  data: z198.lazy(() => CreateGuardrailData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/createkeys.js
var z199 = __toESM(require("zod/v4"), 1);
var CreateKeysLimitReset = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var CreateKeysLimitReset$outboundSchema = outboundSchema(CreateKeysLimitReset);
var CreateKeysRequestBody$outboundSchema = z199.object({
  name: z199.string(),
  limit: z199.nullable(z199.number()).optional(),
  limitReset: z199.nullable(CreateKeysLimitReset$outboundSchema).optional(),
  includeByokInLimit: z199.boolean().optional(),
  expiresAt: z199.nullable(z199.date().transform((v) => v.toISOString())).optional()
}).transform((v) => {
  return remap(v, {
    limitReset: "limit_reset",
    includeByokInLimit: "include_byok_in_limit",
    expiresAt: "expires_at"
  });
});
var CreateKeysRequest$outboundSchema = z199.object({
  httpReferer: z199.string().optional(),
  appTitle: z199.string().optional(),
  appCategories: z199.string().optional(),
  requestBody: z199.lazy(() => CreateKeysRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    requestBody: "RequestBody"
  });
});
var CreateKeysData$inboundSchema = z199.object({
  hash: z199.string(),
  name: z199.string(),
  label: z199.string(),
  disabled: z199.boolean(),
  limit: z199.nullable(z199.number()),
  limit_remaining: z199.nullable(z199.number()),
  limit_reset: z199.nullable(z199.string()),
  include_byok_in_limit: z199.boolean(),
  usage: z199.number(),
  usage_daily: z199.number(),
  usage_weekly: z199.number(),
  usage_monthly: z199.number(),
  byok_usage: z199.number(),
  byok_usage_daily: z199.number(),
  byok_usage_weekly: z199.number(),
  byok_usage_monthly: z199.number(),
  created_at: z199.string(),
  updated_at: z199.nullable(z199.string()),
  expires_at: z199.nullable(z199.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional(),
  creator_user_id: z199.nullable(z199.string())
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
    "expires_at": "expiresAt",
    "creator_user_id": "creatorUserId"
  });
});
var CreateKeysResponse$inboundSchema = z199.object({
  data: z199.lazy(() => CreateKeysData$inboundSchema),
  key: z199.string()
});

// node_modules/@openrouter/sdk/esm/models/operations/createresponses.js
var z200 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/lib/event-streams.js
var EventStream = class extends ReadableStream {
  constructor(responseBody, parse3, opts) {
    const upstream = responseBody.getReader();
    let buffer = new Uint8Array();
    const state = { eventId: void 0 };
    const dataRequired = opts?.dataRequired ?? true;
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
            const item = parseMessage(message, parse3, state, dataRequired);
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
var CR = 13;
var LF = 10;
var BOUNDARIES = [
  [CR, LF, CR, LF],
  // \r\n\r\n
  [CR, LF, CR],
  // \r\n\r
  [CR, LF, LF],
  // \r\n\n
  [CR, CR, LF],
  // \r\r\n
  [LF, CR, LF],
  // \n\r\n
  [CR, CR],
  // \r\r
  [LF, CR],
  // \n\r
  [LF, LF]
  // \n\n
];
function findBoundary(buf) {
  const len = buf.length;
  for (let i = 0; i < len; i++) {
    if (buf[i] !== CR && buf[i] !== LF)
      continue;
    for (const boundary of BOUNDARIES) {
      if (i + boundary.length > len)
        continue;
      let match2 = true;
      for (let j = 0; j < boundary.length; j++) {
        if (buf[i + j] !== boundary[j]) {
          match2 = false;
          break;
        }
      }
      if (match2)
        return { index: i, length: boundary.length };
    }
  }
  return null;
}
function parseMessage(chunk, parse3, state, dataRequired) {
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
    let field = line;
    let value = "";
    if (i > 0) {
      field = line.slice(0, i);
      value = line[i + 1] === " " ? line.slice(i + 2) : line.slice(i + 1);
    }
    if (field === "data")
      dataLines.push(value);
    else if (field === "event")
      ret.event = value;
    else if (field === "id" && !value.includes("\0"))
      state.eventId = value;
    else if (field === "retry" && /^\d+$/.test(value)) {
      ret.retry = Number(value);
    }
  }
  if (ignore)
    return;
  ret.id = state.eventId;
  if (dataLines.length)
    ret.data = dataLines.join("\n");
  else if (dataRequired)
    return;
  return parse3(ret);
}

// node_modules/@openrouter/sdk/esm/models/operations/createresponses.js
var CreateResponsesRequest$outboundSchema = z200.object({
  httpReferer: z200.string().optional(),
  appTitle: z200.string().optional(),
  appCategories: z200.string().optional(),
  responsesRequest: ResponsesRequest$outboundSchema
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    responsesRequest: "ResponsesRequest"
  });
});
var CreateResponsesResponseBody$inboundSchema = z200.object({
  data: z200.string().transform((v, ctx) => {
    try {
      return JSON.parse(v);
    } catch (err) {
      ctx.addIssue({
        input: v,
        code: "custom",
        message: `malformed json: ${err}`
      });
      return z200.NEVER;
    }
  }).pipe(StreamEvents$inboundSchema)
});
var CreateResponsesResponse$inboundSchema = z200.union([
  OpenResponsesResult$inboundSchema,
  z200.custom((x) => x instanceof ReadableStream).transform((stream) => {
    return new EventStream(stream, (rawEvent) => {
      if (rawEvent.data === "[DONE]")
        return { done: true, value: void 0 };
      return {
        done: false,
        value: z200.lazy(() => CreateResponsesResponseBody$inboundSchema).parse(rawEvent)?.data
      };
    });
  })
]);

// node_modules/@openrouter/sdk/esm/models/operations/deleteguardrail.js
var z201 = __toESM(require("zod/v4"), 1);
var DeleteGuardrailRequest$outboundSchema = z201.object({
  httpReferer: z201.string().optional(),
  appTitle: z201.string().optional(),
  appCategories: z201.string().optional(),
  id: z201.string()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var DeleteGuardrailResponse$inboundSchema = z201.object({
  deleted: z201.literal(true)
});

// node_modules/@openrouter/sdk/esm/models/operations/deletekeys.js
var z202 = __toESM(require("zod/v4"), 1);
var DeleteKeysRequest$outboundSchema = z202.object({
  httpReferer: z202.string().optional(),
  appTitle: z202.string().optional(),
  appCategories: z202.string().optional(),
  hash: z202.string()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var DeleteKeysResponse$inboundSchema = z202.object({
  deleted: z202.literal(true)
});

// node_modules/@openrouter/sdk/esm/models/operations/exchangeauthcodeforapikey.js
var z203 = __toESM(require("zod/v4"), 1);
var ExchangeAuthCodeForAPIKeyCodeChallengeMethod = {
  S256: "S256",
  Plain: "plain"
};
var ExchangeAuthCodeForAPIKeyCodeChallengeMethod$outboundSchema = outboundSchema(ExchangeAuthCodeForAPIKeyCodeChallengeMethod);
var ExchangeAuthCodeForAPIKeyRequestBody$outboundSchema = z203.object({
  code: z203.string(),
  codeVerifier: z203.string().optional(),
  codeChallengeMethod: z203.nullable(ExchangeAuthCodeForAPIKeyCodeChallengeMethod$outboundSchema).optional()
}).transform((v) => {
  return remap(v, {
    codeVerifier: "code_verifier",
    codeChallengeMethod: "code_challenge_method"
  });
});
var ExchangeAuthCodeForAPIKeyRequest$outboundSchema = z203.object({
  httpReferer: z203.string().optional(),
  appTitle: z203.string().optional(),
  appCategories: z203.string().optional(),
  requestBody: z203.lazy(() => ExchangeAuthCodeForAPIKeyRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    requestBody: "RequestBody"
  });
});
var ExchangeAuthCodeForAPIKeyResponse$inboundSchema = z203.object({
  key: z203.string(),
  user_id: z203.nullable(z203.string())
}).transform((v) => {
  return remap(v, {
    "user_id": "userId"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/getcredits.js
var z204 = __toESM(require("zod/v4"), 1);
var GetCreditsRequest$outboundSchema = z204.object({
  httpReferer: z204.string().optional(),
  appTitle: z204.string().optional(),
  appCategories: z204.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var GetCreditsData$inboundSchema = z204.object({
  total_credits: z204.number(),
  total_usage: z204.number()
}).transform((v) => {
  return remap(v, {
    "total_credits": "totalCredits",
    "total_usage": "totalUsage"
  });
});
var GetCreditsResponse$inboundSchema = z204.object({
  data: z204.lazy(() => GetCreditsData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getcurrentkey.js
var z205 = __toESM(require("zod/v4"), 1);
var GetCurrentKeyRequest$outboundSchema = z205.object({
  httpReferer: z205.string().optional(),
  appTitle: z205.string().optional(),
  appCategories: z205.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var RateLimit$inboundSchema = z205.object({
  requests: z205.number(),
  interval: z205.string(),
  note: z205.string()
});
var GetCurrentKeyData$inboundSchema = z205.object({
  label: z205.string(),
  limit: z205.nullable(z205.number()),
  usage: z205.number(),
  usage_daily: z205.number(),
  usage_weekly: z205.number(),
  usage_monthly: z205.number(),
  byok_usage: z205.number(),
  byok_usage_daily: z205.number(),
  byok_usage_weekly: z205.number(),
  byok_usage_monthly: z205.number(),
  is_free_tier: z205.boolean(),
  is_management_key: z205.boolean(),
  is_provisioning_key: z205.boolean(),
  limit_remaining: z205.nullable(z205.number()),
  limit_reset: z205.nullable(z205.string()),
  include_byok_in_limit: z205.boolean(),
  expires_at: z205.nullable(z205.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional(),
  creator_user_id: z205.nullable(z205.string()),
  rate_limit: z205.lazy(() => RateLimit$inboundSchema)
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
    "creator_user_id": "creatorUserId",
    "rate_limit": "rateLimit"
  });
});
var GetCurrentKeyResponse$inboundSchema = z205.object({
  data: z205.lazy(() => GetCurrentKeyData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getgeneration.js
var z206 = __toESM(require("zod/v4"), 1);
var ApiType = {
  Completions: "completions",
  Embeddings: "embeddings",
  Video: "video"
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
  AkashML: "AkashML",
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
  Reka: "Reka",
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
var GetGenerationRequest$outboundSchema = z206.object({
  httpReferer: z206.string().optional(),
  appTitle: z206.string().optional(),
  appCategories: z206.string().optional(),
  id: z206.string()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var ApiType$inboundSchema = inboundSchema(ApiType);
var ProviderName$inboundSchema2 = inboundSchema(ProviderName2);
var ProviderResponse$inboundSchema = z206.object({
  id: z206.string().optional(),
  endpoint_id: z206.string().optional(),
  model_permaslug: z206.string().optional(),
  provider_name: ProviderName$inboundSchema2.optional(),
  status: z206.nullable(z206.number()),
  latency: z206.number().optional(),
  is_byok: z206.boolean().optional()
}).transform((v) => {
  return remap(v, {
    "endpoint_id": "endpointId",
    "model_permaslug": "modelPermaslug",
    "provider_name": "providerName",
    "is_byok": "isByok"
  });
});
var GetGenerationData$inboundSchema = z206.object({
  id: z206.string(),
  upstream_id: z206.nullable(z206.string()),
  total_cost: z206.number(),
  cache_discount: z206.nullable(z206.number()),
  upstream_inference_cost: z206.nullable(z206.number()),
  created_at: z206.string(),
  model: z206.string(),
  app_id: z206.nullable(z206.number()),
  streamed: z206.nullable(z206.boolean()),
  cancelled: z206.nullable(z206.boolean()),
  provider_name: z206.nullable(z206.string()),
  latency: z206.nullable(z206.number()),
  moderation_latency: z206.nullable(z206.number()),
  generation_time: z206.nullable(z206.number()),
  finish_reason: z206.nullable(z206.string()),
  tokens_prompt: z206.nullable(z206.number()),
  tokens_completion: z206.nullable(z206.number()),
  native_tokens_prompt: z206.nullable(z206.number()),
  native_tokens_completion: z206.nullable(z206.number()),
  native_tokens_completion_images: z206.nullable(z206.number()),
  native_tokens_reasoning: z206.nullable(z206.number()),
  native_tokens_cached: z206.nullable(z206.number()),
  num_media_prompt: z206.nullable(z206.number()),
  num_input_audio_prompt: z206.nullable(z206.number()),
  num_media_completion: z206.nullable(z206.number()),
  num_search_results: z206.nullable(z206.number()),
  origin: z206.string(),
  usage: z206.number(),
  is_byok: z206.boolean(),
  native_finish_reason: z206.nullable(z206.string()),
  external_user: z206.nullable(z206.string()),
  api_type: z206.nullable(ApiType$inboundSchema),
  router: z206.nullable(z206.string()),
  provider_responses: z206.nullable(z206.array(z206.lazy(() => ProviderResponse$inboundSchema))),
  user_agent: z206.nullable(z206.string()),
  http_referer: z206.nullable(z206.string())
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
    "provider_responses": "providerResponses",
    "user_agent": "userAgent",
    "http_referer": "httpReferer"
  });
});
var GetGenerationResponse$inboundSchema = z206.object({
  data: z206.lazy(() => GetGenerationData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getguardrail.js
var z207 = __toESM(require("zod/v4"), 1);
var GetGuardrailResetInterval = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var GetGuardrailRequest$outboundSchema = z207.object({
  httpReferer: z207.string().optional(),
  appTitle: z207.string().optional(),
  appCategories: z207.string().optional(),
  id: z207.string()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var GetGuardrailResetInterval$inboundSchema = inboundSchema(GetGuardrailResetInterval);
var GetGuardrailData$inboundSchema = z207.object({
  id: z207.string(),
  name: z207.string(),
  description: z207.nullable(z207.string()).optional(),
  limit_usd: z207.nullable(z207.number()).optional(),
  reset_interval: z207.nullable(GetGuardrailResetInterval$inboundSchema).optional(),
  allowed_providers: z207.nullable(z207.array(z207.string())).optional(),
  ignored_providers: z207.nullable(z207.array(z207.string())).optional(),
  allowed_models: z207.nullable(z207.array(z207.string())).optional(),
  enforce_zdr: z207.nullable(z207.boolean()).optional(),
  created_at: z207.string(),
  updated_at: z207.nullable(z207.string()).optional()
}).transform((v) => {
  return remap(v, {
    "limit_usd": "limitUsd",
    "reset_interval": "resetInterval",
    "allowed_providers": "allowedProviders",
    "ignored_providers": "ignoredProviders",
    "allowed_models": "allowedModels",
    "enforce_zdr": "enforceZdr",
    "created_at": "createdAt",
    "updated_at": "updatedAt"
  });
});
var GetGuardrailResponse$inboundSchema = z207.object({
  data: z207.lazy(() => GetGuardrailData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getkey.js
var z208 = __toESM(require("zod/v4"), 1);
var GetKeyRequest$outboundSchema = z208.object({
  httpReferer: z208.string().optional(),
  appTitle: z208.string().optional(),
  appCategories: z208.string().optional(),
  hash: z208.string()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var GetKeyData$inboundSchema = z208.object({
  hash: z208.string(),
  name: z208.string(),
  label: z208.string(),
  disabled: z208.boolean(),
  limit: z208.nullable(z208.number()),
  limit_remaining: z208.nullable(z208.number()),
  limit_reset: z208.nullable(z208.string()),
  include_byok_in_limit: z208.boolean(),
  usage: z208.number(),
  usage_daily: z208.number(),
  usage_weekly: z208.number(),
  usage_monthly: z208.number(),
  byok_usage: z208.number(),
  byok_usage_daily: z208.number(),
  byok_usage_weekly: z208.number(),
  byok_usage_monthly: z208.number(),
  created_at: z208.string(),
  updated_at: z208.nullable(z208.string()),
  expires_at: z208.nullable(z208.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional(),
  creator_user_id: z208.nullable(z208.string())
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
    "expires_at": "expiresAt",
    "creator_user_id": "creatorUserId"
  });
});
var GetKeyResponse$inboundSchema = z208.object({
  data: z208.lazy(() => GetKeyData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/getmodels.js
var z209 = __toESM(require("zod/v4"), 1);
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
var GetModelsRequest$outboundSchema = z209.object({
  httpReferer: z209.string().optional(),
  appTitle: z209.string().optional(),
  appCategories: z209.string().optional(),
  category: Category$outboundSchema.optional(),
  supportedParameters: z209.string().optional(),
  outputModalities: z209.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    supportedParameters: "supported_parameters",
    outputModalities: "output_modalities"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/getuseractivity.js
var z210 = __toESM(require("zod/v4"), 1);
var GetUserActivityRequest$outboundSchema = z210.object({
  httpReferer: z210.string().optional(),
  appTitle: z210.string().optional(),
  appCategories: z210.string().optional(),
  date: z210.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var GetUserActivityResponse$inboundSchema = z210.object({
  data: z210.array(ActivityItem$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/list.js
var z211 = __toESM(require("zod/v4"), 1);
var ListRequest$outboundSchema = z211.object({
  httpReferer: z211.string().optional(),
  appTitle: z211.string().optional(),
  appCategories: z211.string().optional(),
  includeDisabled: z211.string().optional(),
  offset: z211.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    includeDisabled: "include_disabled"
  });
});
var ListData$inboundSchema = z211.object({
  hash: z211.string(),
  name: z211.string(),
  label: z211.string(),
  disabled: z211.boolean(),
  limit: z211.nullable(z211.number()),
  limit_remaining: z211.nullable(z211.number()),
  limit_reset: z211.nullable(z211.string()),
  include_byok_in_limit: z211.boolean(),
  usage: z211.number(),
  usage_daily: z211.number(),
  usage_weekly: z211.number(),
  usage_monthly: z211.number(),
  byok_usage: z211.number(),
  byok_usage_daily: z211.number(),
  byok_usage_weekly: z211.number(),
  byok_usage_monthly: z211.number(),
  created_at: z211.string(),
  updated_at: z211.nullable(z211.string()),
  expires_at: z211.nullable(z211.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional(),
  creator_user_id: z211.nullable(z211.string())
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
    "expires_at": "expiresAt",
    "creator_user_id": "creatorUserId"
  });
});
var ListResponse$inboundSchema = z211.object({
  data: z211.array(z211.lazy(() => ListData$inboundSchema))
});

// node_modules/@openrouter/sdk/esm/models/operations/listembeddingsmodels.js
var z212 = __toESM(require("zod/v4"), 1);
var ListEmbeddingsModelsRequest$outboundSchema = z212.object({
  httpReferer: z212.string().optional(),
  appTitle: z212.string().optional(),
  appCategories: z212.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listendpoints.js
var z213 = __toESM(require("zod/v4"), 1);
var ListEndpointsRequest$outboundSchema = z213.object({
  httpReferer: z213.string().optional(),
  appTitle: z213.string().optional(),
  appCategories: z213.string().optional(),
  author: z213.string(),
  slug: z213.string()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var ListEndpointsResponse$inboundSchema2 = z213.object({
  data: ListEndpointsResponse$inboundSchema
});

// node_modules/@openrouter/sdk/esm/models/operations/listendpointszdr.js
var z214 = __toESM(require("zod/v4"), 1);
var ListEndpointsZdrRequest$outboundSchema = z214.object({
  httpReferer: z214.string().optional(),
  appTitle: z214.string().optional(),
  appCategories: z214.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var ListEndpointsZdrResponse$inboundSchema = z214.object({
  data: z214.array(PublicEndpoint$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/listguardrailkeyassignments.js
var z215 = __toESM(require("zod/v4"), 1);
var ListGuardrailKeyAssignmentsRequest$outboundSchema = z215.object({
  httpReferer: z215.string().optional(),
  appTitle: z215.string().optional(),
  appCategories: z215.string().optional(),
  id: z215.string(),
  offset: z215.string().optional(),
  limit: z215.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var ListGuardrailKeyAssignmentsData$inboundSchema = z215.object({
  id: z215.string(),
  key_hash: z215.string(),
  guardrail_id: z215.string(),
  key_name: z215.string(),
  key_label: z215.string(),
  assigned_by: z215.nullable(z215.string()),
  created_at: z215.string()
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
var ListGuardrailKeyAssignmentsResponse$inboundSchema = z215.object({
  data: z215.array(z215.lazy(() => ListGuardrailKeyAssignmentsData$inboundSchema)),
  total_count: z215.number()
}).transform((v) => {
  return remap(v, {
    "total_count": "totalCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listguardrailmemberassignments.js
var z216 = __toESM(require("zod/v4"), 1);
var ListGuardrailMemberAssignmentsRequest$outboundSchema = z216.object({
  httpReferer: z216.string().optional(),
  appTitle: z216.string().optional(),
  appCategories: z216.string().optional(),
  id: z216.string(),
  offset: z216.string().optional(),
  limit: z216.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var ListGuardrailMemberAssignmentsData$inboundSchema = z216.object({
  id: z216.string(),
  user_id: z216.string(),
  organization_id: z216.string(),
  guardrail_id: z216.string(),
  assigned_by: z216.nullable(z216.string()),
  created_at: z216.string()
}).transform((v) => {
  return remap(v, {
    "user_id": "userId",
    "organization_id": "organizationId",
    "guardrail_id": "guardrailId",
    "assigned_by": "assignedBy",
    "created_at": "createdAt"
  });
});
var ListGuardrailMemberAssignmentsResponse$inboundSchema = z216.object({
  data: z216.array(z216.lazy(() => ListGuardrailMemberAssignmentsData$inboundSchema)),
  total_count: z216.number()
}).transform((v) => {
  return remap(v, {
    "total_count": "totalCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listguardrails.js
var z217 = __toESM(require("zod/v4"), 1);
var ListGuardrailsResetInterval = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var ListGuardrailsRequest$outboundSchema = z217.object({
  httpReferer: z217.string().optional(),
  appTitle: z217.string().optional(),
  appCategories: z217.string().optional(),
  offset: z217.string().optional(),
  limit: z217.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var ListGuardrailsResetInterval$inboundSchema = inboundSchema(ListGuardrailsResetInterval);
var ListGuardrailsData$inboundSchema = z217.object({
  id: z217.string(),
  name: z217.string(),
  description: z217.nullable(z217.string()).optional(),
  limit_usd: z217.nullable(z217.number()).optional(),
  reset_interval: z217.nullable(ListGuardrailsResetInterval$inboundSchema).optional(),
  allowed_providers: z217.nullable(z217.array(z217.string())).optional(),
  ignored_providers: z217.nullable(z217.array(z217.string())).optional(),
  allowed_models: z217.nullable(z217.array(z217.string())).optional(),
  enforce_zdr: z217.nullable(z217.boolean()).optional(),
  created_at: z217.string(),
  updated_at: z217.nullable(z217.string()).optional()
}).transform((v) => {
  return remap(v, {
    "limit_usd": "limitUsd",
    "reset_interval": "resetInterval",
    "allowed_providers": "allowedProviders",
    "ignored_providers": "ignoredProviders",
    "allowed_models": "allowedModels",
    "enforce_zdr": "enforceZdr",
    "created_at": "createdAt",
    "updated_at": "updatedAt"
  });
});
var ListGuardrailsResponse$inboundSchema = z217.object({
  data: z217.array(z217.lazy(() => ListGuardrailsData$inboundSchema)),
  total_count: z217.number()
}).transform((v) => {
  return remap(v, {
    "total_count": "totalCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listkeyassignments.js
var z218 = __toESM(require("zod/v4"), 1);
var ListKeyAssignmentsRequest$outboundSchema = z218.object({
  httpReferer: z218.string().optional(),
  appTitle: z218.string().optional(),
  appCategories: z218.string().optional(),
  offset: z218.string().optional(),
  limit: z218.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var ListKeyAssignmentsData$inboundSchema = z218.object({
  id: z218.string(),
  key_hash: z218.string(),
  guardrail_id: z218.string(),
  key_name: z218.string(),
  key_label: z218.string(),
  assigned_by: z218.nullable(z218.string()),
  created_at: z218.string()
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
var ListKeyAssignmentsResponse$inboundSchema = z218.object({
  data: z218.array(z218.lazy(() => ListKeyAssignmentsData$inboundSchema)),
  total_count: z218.number()
}).transform((v) => {
  return remap(v, {
    "total_count": "totalCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listmemberassignments.js
var z219 = __toESM(require("zod/v4"), 1);
var ListMemberAssignmentsRequest$outboundSchema = z219.object({
  httpReferer: z219.string().optional(),
  appTitle: z219.string().optional(),
  appCategories: z219.string().optional(),
  offset: z219.string().optional(),
  limit: z219.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var ListMemberAssignmentsData$inboundSchema = z219.object({
  id: z219.string(),
  user_id: z219.string(),
  organization_id: z219.string(),
  guardrail_id: z219.string(),
  assigned_by: z219.nullable(z219.string()),
  created_at: z219.string()
}).transform((v) => {
  return remap(v, {
    "user_id": "userId",
    "organization_id": "organizationId",
    "guardrail_id": "guardrailId",
    "assigned_by": "assignedBy",
    "created_at": "createdAt"
  });
});
var ListMemberAssignmentsResponse$inboundSchema = z219.object({
  data: z219.array(z219.lazy(() => ListMemberAssignmentsData$inboundSchema)),
  total_count: z219.number()
}).transform((v) => {
  return remap(v, {
    "total_count": "totalCount"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listmodelscount.js
var z220 = __toESM(require("zod/v4"), 1);
var ListModelsCountRequest$outboundSchema = z220.object({
  httpReferer: z220.string().optional(),
  appTitle: z220.string().optional(),
  appCategories: z220.string().optional(),
  outputModalities: z220.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    outputModalities: "output_modalities"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listmodelsuser.js
var z221 = __toESM(require("zod/v4"), 1);
var ListModelsUserSecurity$outboundSchema = z221.object({
  bearer: z221.string()
});
var ListModelsUserRequest$outboundSchema = z221.object({
  httpReferer: z221.string().optional(),
  appTitle: z221.string().optional(),
  appCategories: z221.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});

// node_modules/@openrouter/sdk/esm/models/operations/listproviders.js
var z222 = __toESM(require("zod/v4"), 1);
var Headquarters = {
  Ad: "AD",
  Ae: "AE",
  Af: "AF",
  Ag: "AG",
  Ai: "AI",
  Al: "AL",
  Am: "AM",
  Ao: "AO",
  Aq: "AQ",
  Ar: "AR",
  As: "AS",
  At: "AT",
  Au: "AU",
  Aw: "AW",
  Ax: "AX",
  Az: "AZ",
  Ba: "BA",
  Bb: "BB",
  Bd: "BD",
  Be: "BE",
  Bf: "BF",
  Bg: "BG",
  Bh: "BH",
  Bi: "BI",
  Bj: "BJ",
  Bl: "BL",
  Bm: "BM",
  Bn: "BN",
  Bo: "BO",
  Bq: "BQ",
  Br: "BR",
  Bs: "BS",
  Bt: "BT",
  Bv: "BV",
  Bw: "BW",
  By: "BY",
  Bz: "BZ",
  Ca: "CA",
  Cc: "CC",
  Cd: "CD",
  Cf: "CF",
  Cg: "CG",
  Ch: "CH",
  Ci: "CI",
  Ck: "CK",
  Cl: "CL",
  Cm: "CM",
  Cn: "CN",
  Co: "CO",
  Cr: "CR",
  Cu: "CU",
  Cv: "CV",
  Cw: "CW",
  Cx: "CX",
  Cy: "CY",
  Cz: "CZ",
  De: "DE",
  Dj: "DJ",
  Dk: "DK",
  Dm: "DM",
  Do: "DO",
  Dz: "DZ",
  Ec: "EC",
  Ee: "EE",
  Eg: "EG",
  Eh: "EH",
  Er: "ER",
  Es: "ES",
  Et: "ET",
  Fi: "FI",
  Fj: "FJ",
  Fk: "FK",
  Fm: "FM",
  Fo: "FO",
  Fr: "FR",
  Ga: "GA",
  Gb: "GB",
  Gd: "GD",
  Ge: "GE",
  Gf: "GF",
  Gg: "GG",
  Gh: "GH",
  Gi: "GI",
  Gl: "GL",
  Gm: "GM",
  Gn: "GN",
  Gp: "GP",
  Gq: "GQ",
  Gr: "GR",
  Gs: "GS",
  Gt: "GT",
  Gu: "GU",
  Gw: "GW",
  Gy: "GY",
  Hk: "HK",
  Hm: "HM",
  Hn: "HN",
  Hr: "HR",
  Ht: "HT",
  Hu: "HU",
  Id: "ID",
  Ie: "IE",
  Il: "IL",
  Im: "IM",
  In: "IN",
  Io: "IO",
  Iq: "IQ",
  Ir: "IR",
  Is: "IS",
  It: "IT",
  Je: "JE",
  Jm: "JM",
  Jo: "JO",
  Jp: "JP",
  Ke: "KE",
  Kg: "KG",
  Kh: "KH",
  Ki: "KI",
  Km: "KM",
  Kn: "KN",
  Kp: "KP",
  Kr: "KR",
  Kw: "KW",
  Ky: "KY",
  Kz: "KZ",
  La: "LA",
  Lb: "LB",
  Lc: "LC",
  Li: "LI",
  Lk: "LK",
  Lr: "LR",
  Ls: "LS",
  Lt: "LT",
  Lu: "LU",
  Lv: "LV",
  Ly: "LY",
  Ma: "MA",
  Mc: "MC",
  Md: "MD",
  Me: "ME",
  Mf: "MF",
  Mg: "MG",
  Mh: "MH",
  Mk: "MK",
  Ml: "ML",
  Mm: "MM",
  Mn: "MN",
  Mo: "MO",
  Mp: "MP",
  Mq: "MQ",
  Mr: "MR",
  Ms: "MS",
  Mt: "MT",
  Mu: "MU",
  Mv: "MV",
  Mw: "MW",
  Mx: "MX",
  My: "MY",
  Mz: "MZ",
  Na: "NA",
  Nc: "NC",
  Ne: "NE",
  Nf: "NF",
  Ng: "NG",
  Ni: "NI",
  Nl: "NL",
  No: "NO",
  Np: "NP",
  Nr: "NR",
  Nu: "NU",
  Nz: "NZ",
  Om: "OM",
  Pa: "PA",
  Pe: "PE",
  Pf: "PF",
  Pg: "PG",
  Ph: "PH",
  Pk: "PK",
  Pl: "PL",
  Pm: "PM",
  Pn: "PN",
  Pr: "PR",
  Ps: "PS",
  Pt: "PT",
  Pw: "PW",
  Py: "PY",
  Qa: "QA",
  Re: "RE",
  Ro: "RO",
  Rs: "RS",
  Ru: "RU",
  Rw: "RW",
  Sa: "SA",
  Sb: "SB",
  Sc: "SC",
  Sd: "SD",
  Se: "SE",
  Sg: "SG",
  Sh: "SH",
  Si: "SI",
  Sj: "SJ",
  Sk: "SK",
  Sl: "SL",
  Sm: "SM",
  Sn: "SN",
  So: "SO",
  Sr: "SR",
  Ss: "SS",
  St: "ST",
  Sv: "SV",
  Sx: "SX",
  Sy: "SY",
  Sz: "SZ",
  Tc: "TC",
  Td: "TD",
  Tf: "TF",
  Tg: "TG",
  Th: "TH",
  Tj: "TJ",
  Tk: "TK",
  Tl: "TL",
  Tm: "TM",
  Tn: "TN",
  To: "TO",
  Tr: "TR",
  Tt: "TT",
  Tv: "TV",
  Tw: "TW",
  Tz: "TZ",
  Ua: "UA",
  Ug: "UG",
  Um: "UM",
  Us: "US",
  Uy: "UY",
  Uz: "UZ",
  Va: "VA",
  Vc: "VC",
  Ve: "VE",
  Vg: "VG",
  Vi: "VI",
  Vn: "VN",
  Vu: "VU",
  Wf: "WF",
  Ws: "WS",
  Ye: "YE",
  Yt: "YT",
  Za: "ZA",
  Zm: "ZM",
  Zw: "ZW"
};
var Datacenter = {
  Ad: "AD",
  Ae: "AE",
  Af: "AF",
  Ag: "AG",
  Ai: "AI",
  Al: "AL",
  Am: "AM",
  Ao: "AO",
  Aq: "AQ",
  Ar: "AR",
  As: "AS",
  At: "AT",
  Au: "AU",
  Aw: "AW",
  Ax: "AX",
  Az: "AZ",
  Ba: "BA",
  Bb: "BB",
  Bd: "BD",
  Be: "BE",
  Bf: "BF",
  Bg: "BG",
  Bh: "BH",
  Bi: "BI",
  Bj: "BJ",
  Bl: "BL",
  Bm: "BM",
  Bn: "BN",
  Bo: "BO",
  Bq: "BQ",
  Br: "BR",
  Bs: "BS",
  Bt: "BT",
  Bv: "BV",
  Bw: "BW",
  By: "BY",
  Bz: "BZ",
  Ca: "CA",
  Cc: "CC",
  Cd: "CD",
  Cf: "CF",
  Cg: "CG",
  Ch: "CH",
  Ci: "CI",
  Ck: "CK",
  Cl: "CL",
  Cm: "CM",
  Cn: "CN",
  Co: "CO",
  Cr: "CR",
  Cu: "CU",
  Cv: "CV",
  Cw: "CW",
  Cx: "CX",
  Cy: "CY",
  Cz: "CZ",
  De: "DE",
  Dj: "DJ",
  Dk: "DK",
  Dm: "DM",
  Do: "DO",
  Dz: "DZ",
  Ec: "EC",
  Ee: "EE",
  Eg: "EG",
  Eh: "EH",
  Er: "ER",
  Es: "ES",
  Et: "ET",
  Fi: "FI",
  Fj: "FJ",
  Fk: "FK",
  Fm: "FM",
  Fo: "FO",
  Fr: "FR",
  Ga: "GA",
  Gb: "GB",
  Gd: "GD",
  Ge: "GE",
  Gf: "GF",
  Gg: "GG",
  Gh: "GH",
  Gi: "GI",
  Gl: "GL",
  Gm: "GM",
  Gn: "GN",
  Gp: "GP",
  Gq: "GQ",
  Gr: "GR",
  Gs: "GS",
  Gt: "GT",
  Gu: "GU",
  Gw: "GW",
  Gy: "GY",
  Hk: "HK",
  Hm: "HM",
  Hn: "HN",
  Hr: "HR",
  Ht: "HT",
  Hu: "HU",
  Id: "ID",
  Ie: "IE",
  Il: "IL",
  Im: "IM",
  In: "IN",
  Io: "IO",
  Iq: "IQ",
  Ir: "IR",
  Is: "IS",
  It: "IT",
  Je: "JE",
  Jm: "JM",
  Jo: "JO",
  Jp: "JP",
  Ke: "KE",
  Kg: "KG",
  Kh: "KH",
  Ki: "KI",
  Km: "KM",
  Kn: "KN",
  Kp: "KP",
  Kr: "KR",
  Kw: "KW",
  Ky: "KY",
  Kz: "KZ",
  La: "LA",
  Lb: "LB",
  Lc: "LC",
  Li: "LI",
  Lk: "LK",
  Lr: "LR",
  Ls: "LS",
  Lt: "LT",
  Lu: "LU",
  Lv: "LV",
  Ly: "LY",
  Ma: "MA",
  Mc: "MC",
  Md: "MD",
  Me: "ME",
  Mf: "MF",
  Mg: "MG",
  Mh: "MH",
  Mk: "MK",
  Ml: "ML",
  Mm: "MM",
  Mn: "MN",
  Mo: "MO",
  Mp: "MP",
  Mq: "MQ",
  Mr: "MR",
  Ms: "MS",
  Mt: "MT",
  Mu: "MU",
  Mv: "MV",
  Mw: "MW",
  Mx: "MX",
  My: "MY",
  Mz: "MZ",
  Na: "NA",
  Nc: "NC",
  Ne: "NE",
  Nf: "NF",
  Ng: "NG",
  Ni: "NI",
  Nl: "NL",
  No: "NO",
  Np: "NP",
  Nr: "NR",
  Nu: "NU",
  Nz: "NZ",
  Om: "OM",
  Pa: "PA",
  Pe: "PE",
  Pf: "PF",
  Pg: "PG",
  Ph: "PH",
  Pk: "PK",
  Pl: "PL",
  Pm: "PM",
  Pn: "PN",
  Pr: "PR",
  Ps: "PS",
  Pt: "PT",
  Pw: "PW",
  Py: "PY",
  Qa: "QA",
  Re: "RE",
  Ro: "RO",
  Rs: "RS",
  Ru: "RU",
  Rw: "RW",
  Sa: "SA",
  Sb: "SB",
  Sc: "SC",
  Sd: "SD",
  Se: "SE",
  Sg: "SG",
  Sh: "SH",
  Si: "SI",
  Sj: "SJ",
  Sk: "SK",
  Sl: "SL",
  Sm: "SM",
  Sn: "SN",
  So: "SO",
  Sr: "SR",
  Ss: "SS",
  St: "ST",
  Sv: "SV",
  Sx: "SX",
  Sy: "SY",
  Sz: "SZ",
  Tc: "TC",
  Td: "TD",
  Tf: "TF",
  Tg: "TG",
  Th: "TH",
  Tj: "TJ",
  Tk: "TK",
  Tl: "TL",
  Tm: "TM",
  Tn: "TN",
  To: "TO",
  Tr: "TR",
  Tt: "TT",
  Tv: "TV",
  Tw: "TW",
  Tz: "TZ",
  Ua: "UA",
  Ug: "UG",
  Um: "UM",
  Us: "US",
  Uy: "UY",
  Uz: "UZ",
  Va: "VA",
  Vc: "VC",
  Ve: "VE",
  Vg: "VG",
  Vi: "VI",
  Vn: "VN",
  Vu: "VU",
  Wf: "WF",
  Ws: "WS",
  Ye: "YE",
  Yt: "YT",
  Za: "ZA",
  Zm: "ZM",
  Zw: "ZW"
};
var ListProvidersRequest$outboundSchema = z222.object({
  httpReferer: z222.string().optional(),
  appTitle: z222.string().optional(),
  appCategories: z222.string().optional()
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer"
  });
});
var Headquarters$inboundSchema = inboundSchema(Headquarters);
var Datacenter$inboundSchema = inboundSchema(Datacenter);
var ListProvidersData$inboundSchema = z222.object({
  name: z222.string(),
  slug: z222.string(),
  privacy_policy_url: z222.nullable(z222.string()),
  terms_of_service_url: z222.nullable(z222.string()).optional(),
  status_page_url: z222.nullable(z222.string()).optional(),
  headquarters: z222.nullable(Headquarters$inboundSchema).optional(),
  datacenters: z222.nullable(z222.array(Datacenter$inboundSchema)).optional()
}).transform((v) => {
  return remap(v, {
    "privacy_policy_url": "privacyPolicyUrl",
    "terms_of_service_url": "termsOfServiceUrl",
    "status_page_url": "statusPageUrl"
  });
});
var ListProvidersResponse$inboundSchema = z222.object({
  data: z222.array(z222.lazy(() => ListProvidersData$inboundSchema))
});

// node_modules/@openrouter/sdk/esm/models/operations/sendchatcompletionrequest.js
var z223 = __toESM(require("zod/v4"), 1);
var SendChatCompletionRequestRequest$outboundSchema = z223.object({
  httpReferer: z223.string().optional(),
  appTitle: z223.string().optional(),
  appCategories: z223.string().optional(),
  chatRequest: ChatRequest$outboundSchema
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    chatRequest: "ChatRequest"
  });
});
var SendChatCompletionRequestResponseBody$inboundSchema = z223.object({
  data: z223.string().transform((v, ctx) => {
    try {
      return JSON.parse(v);
    } catch (err) {
      ctx.addIssue({
        input: v,
        code: "custom",
        message: `malformed json: ${err}`
      });
      return z223.NEVER;
    }
  }).pipe(ChatStreamChunk$inboundSchema)
});
var SendChatCompletionRequestResponse$inboundSchema = z223.union([
  ChatResult$inboundSchema,
  z223.custom((x) => x instanceof ReadableStream).transform((stream) => {
    return new EventStream(stream, (rawEvent) => {
      if (rawEvent.data === "[DONE]")
        return { done: true, value: void 0 };
      return {
        done: false,
        value: z223.lazy(() => SendChatCompletionRequestResponseBody$inboundSchema).parse(rawEvent)?.data
      };
    });
  })
]);

// node_modules/@openrouter/sdk/esm/models/operations/updateguardrail.js
var z224 = __toESM(require("zod/v4"), 1);
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
var UpdateGuardrailRequestBody$outboundSchema = z224.object({
  name: z224.string().optional(),
  description: z224.nullable(z224.string()).optional(),
  limitUsd: z224.nullable(z224.number()).optional(),
  resetInterval: z224.nullable(UpdateGuardrailResetIntervalRequest$outboundSchema).optional(),
  allowedProviders: z224.nullable(z224.array(z224.string())).optional(),
  ignoredProviders: z224.nullable(z224.array(z224.string())).optional(),
  allowedModels: z224.nullable(z224.array(z224.string())).optional(),
  enforceZdr: z224.nullable(z224.boolean()).optional()
}).transform((v) => {
  return remap(v, {
    limitUsd: "limit_usd",
    resetInterval: "reset_interval",
    allowedProviders: "allowed_providers",
    ignoredProviders: "ignored_providers",
    allowedModels: "allowed_models",
    enforceZdr: "enforce_zdr"
  });
});
var UpdateGuardrailRequest$outboundSchema = z224.object({
  httpReferer: z224.string().optional(),
  appTitle: z224.string().optional(),
  appCategories: z224.string().optional(),
  id: z224.string(),
  requestBody: z224.lazy(() => UpdateGuardrailRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    requestBody: "RequestBody"
  });
});
var UpdateGuardrailResetIntervalResponse$inboundSchema = inboundSchema(UpdateGuardrailResetIntervalResponse);
var UpdateGuardrailData$inboundSchema = z224.object({
  id: z224.string(),
  name: z224.string(),
  description: z224.nullable(z224.string()).optional(),
  limit_usd: z224.nullable(z224.number()).optional(),
  reset_interval: z224.nullable(UpdateGuardrailResetIntervalResponse$inboundSchema).optional(),
  allowed_providers: z224.nullable(z224.array(z224.string())).optional(),
  ignored_providers: z224.nullable(z224.array(z224.string())).optional(),
  allowed_models: z224.nullable(z224.array(z224.string())).optional(),
  enforce_zdr: z224.nullable(z224.boolean()).optional(),
  created_at: z224.string(),
  updated_at: z224.nullable(z224.string()).optional()
}).transform((v) => {
  return remap(v, {
    "limit_usd": "limitUsd",
    "reset_interval": "resetInterval",
    "allowed_providers": "allowedProviders",
    "ignored_providers": "ignoredProviders",
    "allowed_models": "allowedModels",
    "enforce_zdr": "enforceZdr",
    "created_at": "createdAt",
    "updated_at": "updatedAt"
  });
});
var UpdateGuardrailResponse$inboundSchema = z224.object({
  data: z224.lazy(() => UpdateGuardrailData$inboundSchema)
});

// node_modules/@openrouter/sdk/esm/models/operations/updatekeys.js
var z225 = __toESM(require("zod/v4"), 1);
var UpdateKeysLimitReset = {
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly"
};
var UpdateKeysLimitReset$outboundSchema = outboundSchema(UpdateKeysLimitReset);
var UpdateKeysRequestBody$outboundSchema = z225.object({
  name: z225.string().optional(),
  disabled: z225.boolean().optional(),
  limit: z225.nullable(z225.number()).optional(),
  limitReset: z225.nullable(UpdateKeysLimitReset$outboundSchema).optional(),
  includeByokInLimit: z225.boolean().optional()
}).transform((v) => {
  return remap(v, {
    limitReset: "limit_reset",
    includeByokInLimit: "include_byok_in_limit"
  });
});
var UpdateKeysRequest$outboundSchema = z225.object({
  httpReferer: z225.string().optional(),
  appTitle: z225.string().optional(),
  appCategories: z225.string().optional(),
  hash: z225.string(),
  requestBody: z225.lazy(() => UpdateKeysRequestBody$outboundSchema)
}).transform((v) => {
  return remap(v, {
    httpReferer: "HTTP-Referer",
    requestBody: "RequestBody"
  });
});
var UpdateKeysData$inboundSchema = z225.object({
  hash: z225.string(),
  name: z225.string(),
  label: z225.string(),
  disabled: z225.boolean(),
  limit: z225.nullable(z225.number()),
  limit_remaining: z225.nullable(z225.number()),
  limit_reset: z225.nullable(z225.string()),
  include_byok_in_limit: z225.boolean(),
  usage: z225.number(),
  usage_daily: z225.number(),
  usage_weekly: z225.number(),
  usage_monthly: z225.number(),
  byok_usage: z225.number(),
  byok_usage_daily: z225.number(),
  byok_usage_weekly: z225.number(),
  byok_usage_monthly: z225.number(),
  created_at: z225.string(),
  updated_at: z225.nullable(z225.string()),
  expires_at: z225.nullable(z225.iso.datetime({ offset: true }).transform((v) => new Date(v))).optional(),
  creator_user_id: z225.nullable(z225.string())
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
    "expires_at": "expiresAt",
    "creator_user_id": "creatorUserId"
  });
});
var UpdateKeysResponse$inboundSchema = z225.object({
  data: z225.lazy(() => UpdateKeysData$inboundSchema)
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload?.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload?.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload?.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload?.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload?.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload?.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
  const body = encodeJSON("body", payload.ResponsesRequest, { explode: true });
  const path2 = pathToFunc("/responses")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: request?.responsesRequest?.stream ? "text/event-stream" : "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
  const body = encodeJSON("body", payload.ChatRequest, { explode: true });
  const path2 = pathToFunc("/chat/completions")();
  const headers = new Headers(compactMap({
    "Content-Type": "application/json",
    Accept: request?.chatRequest?.stream ? "text/event-stream" : "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload?.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload?.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload?.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload?.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload?.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload?.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload?.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload?.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload?.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload?.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload?.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload?.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
  const query = encodeFormQuery({
    "output_modalities": payload?.output_modalities
  });
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload?.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload?.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
  const [result] = await match(json(200, ModelsCountResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
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
    "output_modalities": payload?.output_modalities,
    "supported_parameters": payload?.supported_parameters
  });
  const headers = new Headers(compactMap({
    Accept: "application/json",
    "HTTP-Referer": encodeSimple("HTTP-Referer", payload?.["HTTP-Referer"] ?? client._options.httpReferer, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload?.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload?.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload?.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload?.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    errorCodes: ["400", "401", "409", "4XX", "500", "5XX"],
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
  const [result] = await match(json(200, CreateAuthKeysCodeResponse$inboundSchema), jsonErr(400, BadRequestResponseError$inboundSchema), jsonErr(401, UnauthorizedResponseError$inboundSchema), jsonErr(409, ConflictResponseError$inboundSchema), jsonErr(500, InternalServerResponseError$inboundSchema), fail("4XX"), fail("5XX"))(response, req, { extraFields: responseFields });
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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
    "X-OpenRouter-Categories": encodeSimple("X-OpenRouter-Categories", payload?.appCategories ?? client._options.appCategories, { explode: false, charEncoding: "none" }),
    "X-OpenRouter-Title": encodeSimple("X-OpenRouter-Title", payload?.appTitle ?? client._options.appTitle, { explode: false, charEncoding: "none" })
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

// node_modules/@openrouter/sdk/esm/lib/tool-context.js
var z410 = __toESM(require("zod/v4"), 1);

// node_modules/@openrouter/sdk/esm/lib/tool-types.js
var ToolType;
(function(ToolType2) {
  ToolType2["Function"] = "function";
})(ToolType || (ToolType = {}));
var SHARED_CONTEXT_KEY = "shared";
function hasExecuteFunction(tool) {
  return "execute" in tool.function && typeof tool.function.execute === "function";
}
function isGeneratorTool(tool) {
  return "eventSchema" in tool.function;
}
function isRegularExecuteTool(tool) {
  return hasExecuteFunction(tool) && !isGeneratorTool(tool);
}
function isToolCallOutputEvent(event) {
  return event.type === "tool.call_output";
}

// node_modules/@openrouter/sdk/esm/lib/tool-context.js
var ToolContextStore = class {
  constructor(initialValues = {}) {
    this.listeners = /* @__PURE__ */ new Set();
    this.store = {};
    for (const [key, value] of Object.entries(initialValues)) {
      this.store[key] = { ...value };
    }
  }
  /** Subscribe to context changes. Returns an unsubscribe function. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Get a deep-shallow copy of the full context (all tools) */
  getSnapshot() {
    const snapshot = {};
    for (const [key, value] of Object.entries(this.store)) {
      snapshot[key] = { ...value };
    }
    return snapshot;
  }
  /** Get a shallow copy of context for a specific tool */
  getToolContext(toolName) {
    const data = this.store[toolName];
    if (!data) {
      return {};
    }
    return { ...data };
  }
  /** Set context for a specific tool and notify listeners */
  setToolContext(toolName, values) {
    this.store[toolName] = { ...values };
    this.notifyListeners();
  }
  /** Merge partial values into a specific tool's context and notify listeners */
  mergeToolContext(toolName, partial) {
    const existing = this.store[toolName] ?? {};
    this.store[toolName] = { ...existing, ...partial };
    this.notifyListeners();
  }
  notifyListeners() {
    const snapshot = {};
    for (const [key, value] of Object.entries(this.store)) {
      snapshot[key] = { ...value };
    }
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
};
function validatePartialAgainstSchema(partial, schema) {
  const schemaKeys = Object.keys(schema._zod.def.shape);
  const filteredPartial = {};
  for (const [key, value] of Object.entries(partial)) {
    if (schemaKeys.includes(key)) {
      filteredPartial[key] = value;
    }
  }
  const shape = schema._zod.def.shape;
  for (const [key, value] of Object.entries(filteredPartial)) {
    const keySchema = shape[key];
    if (keySchema) {
      z410.parse(keySchema, value);
    }
  }
  return filteredPartial;
}
function buildToolExecuteContext(turnContext, store, toolName, schema, sharedSchema) {
  if (store && schema) {
    extractToolContext(store, toolName, schema);
  }
  if (store && sharedSchema) {
    extractToolContext(store, SHARED_CONTEXT_KEY, sharedSchema);
  }
  const ctx = {
    ...turnContext,
    get local() {
      const data = store ? store.getToolContext(toolName) : {};
      return Object.freeze(data);
    },
    setContext(partial) {
      if (!store || !schema) {
        return;
      }
      const filteredPartial = validatePartialAgainstSchema(partial, schema);
      store.mergeToolContext(toolName, filteredPartial);
    },
    get shared() {
      const data = store ? store.getToolContext(SHARED_CONTEXT_KEY) : {};
      return Object.freeze(data);
    },
    setSharedContext(partial) {
      if (!store || !sharedSchema) {
        return;
      }
      const filteredPartial = validatePartialAgainstSchema(partial, sharedSchema);
      store.mergeToolContext(SHARED_CONTEXT_KEY, filteredPartial);
    }
  };
  return ctx;
}
async function resolveContext(contextInput, turnContext) {
  if (contextInput === void 0) {
    return {};
  }
  if (typeof contextInput === "function") {
    return Promise.resolve(contextInput(turnContext));
  }
  return contextInput;
}
function extractToolContext(store, toolName, schema) {
  if (!schema) {
    return {};
  }
  const toolData = store.getToolContext(toolName);
  z410.parse(schema, toolData);
  return toolData;
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
    "rejectToolCalls",
    // Client-side rejection decisions
    "context",
    // Passed through via GetResponseOptions, not sent to API
    "sharedContextSchema",
    // Client-side schema for shared context validation
    "onTurnStart",
    // Client-side turn start callback
    "onTurnEnd"
    // Client-side turn end callback
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

// node_modules/@openrouter/sdk/esm/lib/turn-context.js
function normalizeInputToArray(input) {
  if (typeof input === "string") {
    const message = {
      role: EasyInputMessageRoleUser.User,
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
  return "callId" in obj && typeof obj.callId === "string" && "name" in obj && typeof obj.name === "string" && "output" in obj;
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
function extractTextFromResponse(response) {
  if (!response.output) {
    return "";
  }
  const outputs = Array.isArray(response.output) ? response.output : [response.output];
  const textParts = [];
  for (const item of outputs) {
    if (item.type === "message" && "content" in item && item.content) {
      for (const content of item.content) {
        if (content.type === "output_text" && "text" in content && content.text) {
          textParts.push(content.text);
        }
      }
    }
  }
  return textParts.join("");
}

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
function extractTextFromResponse2(response) {
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
        const trimmedArgs = item.arguments.trim();
        const parsedArguments = trimmedArgs ? JSON.parse(trimmedArgs) : {};
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
          const itemKey = event.item.id ?? event.item.callId;
          toolCallsInProgress.set(itemKey, {
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
              const trimmedArgs = event.arguments.trim();
              const parsedArguments = trimmedArgs ? JSON.parse(trimmedArgs) : {};
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
          const itemKey = event.item.id ?? event.item.callId;
          if (toolCallsInProgress.has(itemKey)) {
            try {
              const trimmedArgs = event.item.arguments.trim();
              const parsedArguments = trimmedArgs ? JSON.parse(trimmedArgs) : {};
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
            toolCallsInProgress.delete(itemKey);
          }
        }
        break;
      }
    }
  }
}

// node_modules/@openrouter/sdk/esm/lib/tool-executor.js
var z411 = __toESM(require("zod/v4"), 1);
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
  const jsonSchema = z411.toJSONSchema(zodSchema, {
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
  return z411.parse(schema, args);
}
function validateToolOutput(schema, result) {
  return z411.parse(schema, result);
}
function tryValidate(schema, value) {
  const result = z411.safeParse(schema, value);
  return result.success;
}
function buildExecuteCtx(tool, turnContext, contextStore, sharedSchema) {
  return buildToolExecuteContext(turnContext, contextStore, tool.function.name, tool.function.contextSchema, sharedSchema);
}
async function executeRegularTool(tool, toolCall, context, contextStore, sharedSchema) {
  if (!isRegularExecuteTool(tool)) {
    throw new Error(`Tool "${toolCall.name}" is not a regular execute tool or has no execute function`);
  }
  try {
    const validatedInput = validateToolInput(tool.function.inputSchema, toolCall.arguments);
    const executeContext = buildExecuteCtx(tool, context, contextStore, sharedSchema);
    const result = await Promise.resolve(tool.function.execute(validatedInput, executeContext));
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
async function executeGeneratorTool(tool, toolCall, context, onPreliminaryResult, contextStore, sharedSchema) {
  if (!isGeneratorTool(tool)) {
    throw new Error(`Tool "${toolCall.name}" is not a generator tool`);
  }
  try {
    const validatedInput = validateToolInput(tool.function.inputSchema, toolCall.arguments);
    const executeContext = buildExecuteCtx(tool, context, contextStore, sharedSchema);
    const preliminaryResults = [];
    let finalResult;
    let hasFinalResult = false;
    let lastEmittedValue;
    let hasEmittedValue = false;
    const iterator = tool.function.execute(validatedInput, executeContext);
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
async function executeTool(tool, toolCall, context, onPreliminaryResult, contextStore, sharedSchema) {
  if (!hasExecuteFunction(tool)) {
    throw new Error(`Tool "${toolCall.name}" has no execute function. Use manual tool execution.`);
  }
  if (isGeneratorTool(tool)) {
    return executeGeneratorTool(tool, toolCall, context, onPreliminaryResult, contextStore, sharedSchema);
  }
  return executeRegularTool(tool, toolCall, context, contextStore, sharedSchema);
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
    this.turnBroadcaster = null;
    this.initialStreamPipeStarted = false;
    this.initialPipePromise = null;
    this.contextStore = null;
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
   * Get or create the unified turn broadcaster (lazy initialization).
   * Broadcasts all API stream events, tool events, and turn delimiters across turns.
   */
  ensureTurnBroadcaster() {
    if (!this.turnBroadcaster) {
      this.turnBroadcaster = new ToolEventBroadcaster();
    }
    return this.turnBroadcaster;
  }
  /**
   * Start piping the initial stream into the turn broadcaster.
   * Idempotent — only starts once even if called multiple times.
   * Wraps the initial stream events with turn.start(0) / turn.end(0) delimiters.
   */
  startInitialStreamPipe() {
    if (this.initialStreamPipeStarted)
      return;
    this.initialStreamPipeStarted = true;
    const broadcaster = this.ensureTurnBroadcaster();
    if (!this.reusableStream) {
      return;
    }
    const stream = this.reusableStream;
    this.initialPipePromise = (async () => {
      broadcaster.push({
        type: "turn.start",
        turnNumber: 0,
        timestamp: Date.now()
      });
      const consumer = stream.createConsumer();
      for await (const event of consumer) {
        broadcaster.push(event);
      }
      broadcaster.push({
        type: "turn.end",
        turnNumber: 0,
        timestamp: Date.now()
      });
    })().catch((error) => {
      broadcaster.complete(error instanceof Error ? error : new Error(String(error)));
    });
  }
  /**
   * Pipe a follow-up stream into the turn broadcaster and capture the completed response.
   * Emits turn.start / turn.end delimiters around the stream events.
   */
  async pipeAndConsumeStream(stream, turnNumber) {
    const broadcaster = this.turnBroadcaster;
    broadcaster.push({
      type: "turn.start",
      turnNumber,
      timestamp: Date.now()
    });
    const consumer = stream.createConsumer();
    let completedResponse = null;
    for await (const event of consumer) {
      broadcaster.push(event);
      if (isResponseCompletedEvent(event)) {
        completedResponse = event.response;
      }
      if (isResponseFailedEvent(event)) {
        const errorMsg = "message" in event ? String(event.message) : "Response failed";
        throw new Error(errorMsg);
      }
      if (isResponseIncompleteEvent(event)) {
        completedResponse = event.response;
      }
    }
    broadcaster.push({
      type: "turn.end",
      turnNumber,
      timestamp: Date.now()
    });
    if (!completedResponse) {
      throw new Error("Follow-up stream ended without a completed response");
    }
    return completedResponse;
  }
  /**
   * Push a tool result event to both the legacy tool event broadcaster
   * and the unified turn broadcaster.
   */
  broadcastToolResult(toolCallId, result, preliminaryResults) {
    this.toolEventBroadcaster?.push({
      type: "tool_result",
      toolCallId,
      result,
      ...preliminaryResults?.length && { preliminaryResults }
    });
    this.turnBroadcaster?.push({
      type: "tool.result",
      toolCallId,
      result,
      timestamp: Date.now(),
      ...preliminaryResults?.length && { preliminaryResults }
    });
  }
  /**
   * Push a preliminary result event to both the legacy tool event broadcaster
   * and the unified turn broadcaster.
   */
  broadcastPreliminaryResult(toolCallId, result) {
    this.toolEventBroadcaster?.push({
      type: "preliminary_result",
      toolCallId,
      result
    });
    this.turnBroadcaster?.push({
      type: "tool.preliminary_result",
      toolCallId,
      result,
      timestamp: Date.now()
    });
  }
  /**
   * Set up the turn broadcaster with tool execution and return the consumer.
   * Used by stream methods that need to iterate over all turns.
   */
  startTurnBroadcasterExecution() {
    const broadcaster = this.ensureTurnBroadcaster();
    this.startInitialStreamPipe();
    const consumer = broadcaster.createConsumer();
    const executionPromise = this.executeToolsIfNeeded().finally(async () => {
      if (this.initialPipePromise) {
        await this.initialPipePromise;
      }
      broadcaster.complete();
    });
    return { consumer, executionPromise };
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
          text: extractTextFromResponse(currentResponse),
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
        text: extractTextFromResponse2(round.response),
        toolCalls: round.toolCalls,
        toolResults: round.toolResults.map((tr) => ({
          toolCallId: tr.callId,
          toolName: round.toolCalls.find((tc) => tc.id === tr.callId)?.name ?? "",
          result: typeof tr.output === "string" ? JSON.parse(tr.output) : tr.output
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
      const result = await executeTool(tool, tc, turnContext, void 0, this.contextStore ?? void 0, this.options.sharedContextSchema);
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
    const turnContext = {
      numberOfTurns: currentRound
      // context is handled via contextStore, not on TurnContext
    };
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
        this.broadcastToolResult(toolCall.id, { error: errorMessage });
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
      const hasBroadcaster = this.toolEventBroadcaster || this.turnBroadcaster;
      const onPreliminaryResult = hasBroadcaster ? (callId, resultValue) => {
        const typedResult = resultValue;
        preliminaryResultsForCall.push(typedResult);
        this.broadcastPreliminaryResult(callId, typedResult);
      } : void 0;
      const result = await executeTool(tool, toolCall, turnContext, onPreliminaryResult, this.contextStore ?? void 0, this.options.sharedContextSchema);
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
        this.broadcastToolResult(originalToolCall.id, { error: errorMessage });
        const rejectedOutput = {
          type: "function_call_output",
          id: `output_${originalToolCall.id}`,
          callId: originalToolCall.id,
          output: JSON.stringify({ error: errorMessage })
        };
        toolResults.push(rejectedOutput);
        this.turnBroadcaster?.push({
          type: "tool.call_output",
          output: rejectedOutput,
          timestamp: Date.now()
        });
        continue;
      }
      const value = settled.value;
      if (!value)
        continue;
      if (value.type === "parse_error") {
        toolResults.push(value.output);
        this.turnBroadcaster?.push({
          type: "tool.call_output",
          output: value.output,
          timestamp: Date.now()
        });
        continue;
      }
      const toolResult = value.result.error ? { error: value.result.error.message } : value.result.result;
      this.broadcastToolResult(value.toolCall.id, toolResult, value.preliminaryResultsForCall.length > 0 ? value.preliminaryResultsForCall : void 0);
      const executedOutput = {
        type: "function_call_output",
        id: `output_${value.toolCall.id}`,
        callId: value.toolCall.id,
        output: value.result.error ? JSON.stringify({ error: value.result.error.message }) : JSON.stringify(value.result.result)
      };
      toolResults.push(executedOutput);
      this.turnBroadcaster?.push({
        type: "tool.call_output",
        output: executedOutput,
        timestamp: Date.now()
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
      const preservedStream = this.resolvedRequest?.stream;
      this.resolvedRequest = {
        ...resolved,
        stream: preservedStream ?? true,
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
   * Uses streaming and pipes events through the turn broadcaster when available.
   */
  async makeFollowupRequest(currentResponse, toolResults, turnNumber) {
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
      stream: true
    };
    const newResult = await betaResponsesSend(this.options.client, { responsesRequest: newRequest }, this.options.options);
    if (!newResult.ok) {
      throw newResult.error;
    }
    const value = newResult.value;
    if (isEventStream(value)) {
      const followUpStream = new ReusableReadableStream(value);
      if (this.turnBroadcaster) {
        return this.pipeAndConsumeStream(followUpStream, turnNumber);
      }
      return consumeStreamForCompletion(followUpStream);
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
    const { stopWhen: _, state: _s, requireApproval: _r, approveToolCalls: _a4, rejectToolCalls: _rj, context: _c, ...rest } = this.options.request;
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
            if (this.options.context !== void 0) {
              const approvalContext = { numberOfTurns: 0 };
              const resolvedCtx = await resolveContext(this.options.context, approvalContext);
              this.contextStore = new ToolContextStore(resolvedCtx);
            }
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
      const initialContext = { numberOfTurns: 0 };
      if (this.options.context !== void 0) {
        const resolvedCtx = await resolveContext(this.options.context, initialContext);
        this.contextStore = new ToolContextStore(resolvedCtx);
      }
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
      const apiResult = await betaResponsesSend(this.options.client, { responsesRequest: request }, this.options.options);
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
      // context is handled via contextStore, not on TurnContext
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
      const result = await executeTool(tool, toolCall, turnContext, void 0, this.contextStore ?? void 0, this.options.sharedContextSchema);
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
    const apiResult = await betaResponsesSend(this.options.client, { responsesRequest: request }, this.options.options);
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
        const turnNumber = currentRound + 1;
        const turnContext = { numberOfTurns: turnNumber };
        await this.options.onTurnStart?.(turnContext);
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
        currentResponse = await this.makeFollowupRequest(currentResponse, toolResults, turnNumber);
        await this.options.onTurnEnd?.(turnContext, currentResponse);
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
    return extractTextFromResponse2(this.finalResponse);
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
   * Returns the full OpenResponsesResult with usage data (inputTokens, outputTokens, cachedTokens, etc.)
   */
  async getResponse() {
    await this.executeToolsIfNeeded();
    if (!this.finalResponse) {
      throw new Error("Response not available");
    }
    return this.finalResponse;
  }
  /**
   * Stream all response events as they arrive across all turns.
   * Multiple consumers can iterate over this stream concurrently.
   * Includes API events, tool events, and turn.start/turn.end delimiters.
   */
  getFullResponsesStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream && !this.finalResponse) {
        throw new Error("Stream not initialized");
      }
      if (!this.options.tools?.length) {
        if (this.reusableStream) {
          const consumer2 = this.reusableStream.createConsumer();
          for await (const event of consumer2) {
            yield event;
          }
        }
        return;
      }
      const { consumer, executionPromise } = this.startTurnBroadcasterExecution();
      for await (const event of consumer) {
        yield event;
      }
      await executionPromise;
    }.call(this);
  }
  /**
   * Stream only text deltas as they arrive from all turns.
   * This filters the full event stream to only yield text content,
   * including text from follow-up responses in multi-turn tool loops.
   */
  getTextStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream && !this.finalResponse) {
        throw new Error("Stream not initialized");
      }
      if (!this.options.tools?.length) {
        if (this.reusableStream) {
          yield* extractTextDeltas(this.reusableStream);
        }
        return;
      }
      const { consumer, executionPromise } = this.startTurnBroadcasterExecution();
      for await (const event of consumer) {
        if (isOutputTextDeltaEvent(event)) {
          yield event.delta;
        }
      }
      await executionPromise;
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
      if (!this.reusableStream && !this.finalResponse) {
        throw new Error("Stream not initialized");
      }
      if (!this.options.tools?.length) {
        if (this.reusableStream) {
          yield* buildItemsStream(this.reusableStream);
        }
        return;
      }
      const { consumer, executionPromise } = this.startTurnBroadcasterExecution();
      const itemsInProgress = /* @__PURE__ */ new Map();
      for await (const event of consumer) {
        if (isToolCallOutputEvent(event)) {
          yield event.output;
          continue;
        }
        if ("type" in event && streamTerminationEvents.has(event.type)) {
          itemsInProgress.clear();
        }
        if ("type" in event && event.type in itemsStreamHandlers) {
          const handler = itemsStreamHandlers[event.type];
          if (handler) {
            const result = handler(event, itemsInProgress);
            if (result) {
              yield result;
            }
          }
        }
      }
      await executionPromise;
    }.call(this);
  }
  /**
   * @deprecated Use `getItemsStream()` instead. This method only streams messages,
   * while `getItemsStream()` streams all output item types (messages, function_calls,
   * reasoning, etc.) with cumulative updates.
   *
   * Stream cumulative message snapshots as content is added in responses format.
   * Each iteration yields an updated version of the message with new content.
   * Also yields function_call items and FunctionCallOutputItem after tool execution completes.
   * Returns OutputMessage, OutputFunctionCallItem, or FunctionCallOutputItem
   * compatible with OpenAI Responses API format.
   */
  getNewMessagesStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream && !this.finalResponse) {
        throw new Error("Stream not initialized");
      }
      if (this.reusableStream) {
        yield* buildResponsesMessageStream(this.reusableStream);
      }
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
   * Stream only reasoning deltas as they arrive from all turns.
   * This filters the full event stream to only yield reasoning content,
   * including reasoning from follow-up responses in multi-turn tool loops.
   */
  getReasoningStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream && !this.finalResponse) {
        throw new Error("Stream not initialized");
      }
      if (!this.options.tools?.length) {
        if (this.reusableStream) {
          yield* extractReasoningDeltas(this.reusableStream);
        }
        return;
      }
      const { consumer, executionPromise } = this.startTurnBroadcasterExecution();
      for await (const event of consumer) {
        if (isReasoningDeltaEvent(event)) {
          yield event.delta;
        }
      }
      await executionPromise;
    }.call(this);
  }
  /**
   * Stream tool call argument deltas and preliminary results from all turns.
   * Preliminary results are streamed in REAL-TIME as generator tools yield.
   * - Tool call argument deltas as { type: "delta", content: string }
   * - Preliminary results as { type: "preliminary_result", toolCallId, result }
   */
  getToolStream() {
    return async function* () {
      await this.initStream();
      if (!this.reusableStream && !this.finalResponse) {
        throw new Error("Stream not initialized");
      }
      if (!this.options.tools?.length) {
        if (this.reusableStream) {
          for await (const delta of extractToolDeltas(this.reusableStream)) {
            yield { type: "delta", content: delta };
          }
        }
        return;
      }
      const { consumer, executionPromise } = this.startTurnBroadcasterExecution();
      for await (const event of consumer) {
        if (event.type === "response.function_call_arguments.delta") {
          yield { type: "delta", content: event.delta };
          continue;
        }
        if (event.type === "tool.preliminary_result") {
          yield {
            type: "preliminary_result",
            toolCallId: event.toolCallId,
            result: event.result
          };
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
      if (!this.reusableStream && !this.finalResponse) {
        throw new Error("Stream not initialized");
      }
      if (this.reusableStream) {
        yield* buildToolCallStream(this.reusableStream);
      }
    }.call(this);
  }
  /**
   * Returns an async iterable that emits a full context snapshot every time
   * any tool calls ctx.update(). Can be consumed concurrently with getText(),
   * getToolStream(), etc.
   *
   * @example
   * ```typescript
   * for await (const snapshot of result.getContextUpdates()) {
   *   console.log('Context changed:', snapshot);
   * }
   * ```
   */
  async *getContextUpdates() {
    await this.initStream();
    if (!this.contextStore) {
      return;
    }
    const store = this.contextStore;
    const queue = [];
    let resolve = null;
    let done = false;
    const unsubscribe = store.subscribe((snapshot) => {
      queue.push(snapshot);
      if (resolve) {
        resolve();
        resolve = null;
      }
    });
    this.executeToolsIfNeeded().then(() => {
      done = true;
      if (resolve) {
        resolve();
        resolve = null;
      }
    }, () => {
      done = true;
      if (resolve) {
        resolve();
        resolve = null;
      }
    });
    try {
      while (!done) {
        if (queue.length > 0) {
          yield queue.shift();
        } else {
          await new Promise((r) => {
            resolve = r;
          });
        }
      }
      while (queue.length > 0) {
        yield queue.shift();
      }
    } finally {
      unsubscribe();
    }
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
  const { tools, stopWhen, state, requireApproval, approveToolCalls, rejectToolCalls, context, sharedContextSchema, onTurnStart, onTurnEnd, ...apiRequest } = request;
  const apiTools = tools ? convertToolsToAPIFormat(tools) : void 0;
  const finalRequest = {
    ...apiRequest
  };
  if (apiTools !== void 0) {
    finalRequest["tools"] = apiTools;
  }
  const callModelOptions = {
    ...options,
    headers: {
      ...Object.fromEntries(new Headers(options?.headers ?? options?.fetchOptions?.headers ?? void 0)),
      "x-openrouter-callmodel": "true"
    }
  };
  return new ModelResult({
    client,
    request: finalRequest,
    options: callModelOptions,
    tools,
    ...stopWhen !== void 0 && { stopWhen },
    // Pass state management options
    ...state !== void 0 && { state },
    ...requireApproval !== void 0 && { requireApproval },
    ...approveToolCalls !== void 0 && { approveToolCalls },
    ...rejectToolCalls !== void 0 && { rejectToolCalls },
    ...context !== void 0 && { context },
    ...sharedContextSchema !== void 0 && { sharedContextSchema },
    ...onTurnStart !== void 0 && { onTurnStart },
    ...onTurnEnd !== void 0 && { onTurnEnd }
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
      return EasyInputMessageRoleUser.User;
    case "system":
      return EasyInputMessageRoleSystem.System;
    case "assistant":
      return EasyInputMessageRoleAssistant.Assistant;
    case "developer":
      return EasyInputMessageRoleDeveloper.Developer;
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
        type: "function_call_output",
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
var OAuthError = class extends APIError {
  constructor(status, error, headers) {
    let finalMessage = "OAuth2 authentication error";
    let error_code = void 0;
    if (error && typeof error === "object") {
      const errorData = error;
      error_code = errorData["error"];
      const description = errorData["error_description"];
      if (description && typeof description === "string") {
        finalMessage = description;
      } else if (error_code) {
        finalMessage = error_code;
      }
    }
    super(status, error, finalMessage, headers);
    this.error_code = error_code;
  }
};
var SubjectTokenProviderError = class extends OpenAIError {
  constructor(message, provider, cause) {
    super(message);
    this.provider = provider;
    this.cause = cause;
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
var VERSION = "6.34.0";

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
  const array62 = [];
  for (let i = 0; i < 256; ++i) {
    array62.push("%" + ((i < 16 ? "0" : "") + i.toString(16)).toUpperCase());
  }
  return array62;
})();
var limit = 1024;
var encode = (str2, _defaultEncoder, charset, _kind, format) => {
  if (str2.length === 0) {
    return str2;
  }
  let string176 = str2;
  if (typeof str2 === "symbol") {
    string176 = Symbol.prototype.toString.call(str2);
  } else if (typeof str2 !== "string") {
    string176 = String(str2);
  }
  if (charset === "iso-8859-1") {
    return escape(string176).replace(/%u[0-9a-f]{4}/gi, function($0) {
      return "%26%23" + parseInt($0.slice(2), 16) + "%3B";
    });
  }
  let out = "";
  for (let j = 0; j < string176.length; j += limit) {
    const segment = string176.length >= limit ? string176.slice(j, j + limit) : string176;
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
function inner_stringify(object211, prefix, generateArrayPrefix, commaRoundTrip, allowEmptyArrays, strictNullHandling, skipNulls, encodeDotInKeys, encoder, filter, sort, allowDots, serializeDate, format, formatter, encodeValuesOnly, charset, sideChannel) {
  let obj = object211;
  let tmp_sc = sideChannel;
  let step = 0;
  let find_flag = false;
  while ((tmp_sc = tmp_sc.get(sentinel)) !== void 0 && !find_flag) {
    const pos = tmp_sc.get(object211);
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
    sideChannel.set(object211, step);
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
function stringify(object211, opts = {}) {
  let obj = object211;
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
function makeLogFn(fnLevel, logger5, logLevel) {
  if (!logger5 || levelNumbers[fnLevel] > levelNumbers[logLevel]) {
    return noop;
  } else {
    return logger5[fnLevel].bind(logger5);
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
  const logger5 = client.logger;
  const logLevel = client.logLevel ?? "off";
  if (!logger5) {
    return noopLogger;
  }
  const cachedLogger = cachedLoggers.get(logger5);
  if (cachedLogger && cachedLogger[0] === logLevel) {
    return cachedLogger[1];
  }
  const levelLogger = {
    error: makeLogFn("error", logger5, logLevel),
    warn: makeLogFn("warn", logger5, logLevel),
    info: makeLogFn("info", logger5, logLevel),
    debug: makeLogFn("debug", logger5, logLevel)
  };
  cachedLoggers.set(logger5, [logLevel, levelLogger]);
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
    const logger5 = client ? loggerFor(client) : console;
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
              logger5.error(`Could not parse message into JSON:`, sse2.data);
              logger5.error(`From chunk:`, sse2.raw);
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

// ../../../node_modules/openai/auth/workload-identity-auth.mjs
var SUBJECT_TOKEN_TYPES = {
  jwt: "urn:ietf:params:oauth:token-type:jwt",
  id: "urn:ietf:params:oauth:token-type:id_token"
};
var TOKEN_EXCHANGE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
var WorkloadIdentityAuth = class {
  constructor(config2, fetch2) {
    this.cachedToken = null;
    this.refreshPromise = null;
    this.tokenExchangeUrl = "https://auth.openai.com/oauth/token";
    this.config = config2;
    this.fetch = fetch2 ?? getDefaultFetch();
  }
  async getToken() {
    if (!this.cachedToken || this.isTokenExpired(this.cachedToken)) {
      if (this.refreshPromise) {
        return await this.refreshPromise;
      }
      this.refreshPromise = this.refreshToken();
      try {
        const token = await this.refreshPromise;
        return token;
      } finally {
        this.refreshPromise = null;
      }
    }
    if (this.needsRefresh(this.cachedToken) && !this.refreshPromise) {
      this.refreshPromise = this.refreshToken().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.cachedToken.token;
  }
  async refreshToken() {
    const subjectToken = await this.config.provider.getToken();
    const response = await this.fetch(this.tokenExchangeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: this.config.clientId,
        subject_token: subjectToken,
        subject_token_type: SUBJECT_TOKEN_TYPES[this.config.provider.tokenType],
        identity_provider_id: this.config.identityProviderId,
        service_account_id: this.config.serviceAccountId
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      let body = void 0;
      try {
        body = JSON.parse(errorText);
      } catch {
      }
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new OAuthError(response.status, body, response.headers);
      }
      throw APIError.generate(response.status, body, `Token exchange failed with status ${response.status}`, response.headers);
    }
    const tokenResponse = await response.json();
    const expiresIn = tokenResponse.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1e3;
    this.cachedToken = {
      token: tokenResponse.access_token,
      expiresAt
    };
    return tokenResponse.access_token;
  }
  isTokenExpired(cachedToken) {
    return Date.now() >= cachedToken.expiresAt;
  }
  needsRefresh(cachedToken) {
    const bufferSeconds = this.config.refreshBufferSeconds ?? 1200;
    const bufferMs = bufferSeconds * 1e3;
    return Date.now() >= cachedToken.expiresAt - bufferMs;
  }
  invalidateToken() {
    this.cachedToken = null;
    this.refreshPromise = null;
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
var WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER = "workload-identity-auth";
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
  constructor({ baseURL = readEnv("OPENAI_BASE_URL"), apiKey = readEnv("OPENAI_API_KEY"), organization = readEnv("OPENAI_ORG_ID") ?? null, project = readEnv("OPENAI_PROJECT_ID") ?? null, webhookSecret = readEnv("OPENAI_WEBHOOK_SECRET") ?? null, workloadIdentity, ...opts } = {}) {
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
    if (workloadIdentity) {
      if (apiKey && apiKey !== WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER) {
        throw new OpenAIError("The `apiKey` and `workloadIdentity` arguments are mutually exclusive; only one can be passed at a time.");
      }
      apiKey = WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER;
    } else if (apiKey === void 0) {
      throw new OpenAIError("Missing credentials. Please pass an `apiKey`, `workloadIdentity`, or set the `OPENAI_API_KEY` environment variable.");
    }
    const options = {
      apiKey,
      organization,
      project,
      webhookSecret,
      workloadIdentity,
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
    if (workloadIdentity) {
      this._workloadIdentityAuth = new WorkloadIdentityAuth(workloadIdentity, this.fetch);
    }
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
      workloadIdentity: this._options.workloadIdentity,
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
    const response = await this.fetchWithAuth(url, req, timeout, controller).catch(castToError);
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
      if (response instanceof OAuthError || response instanceof SubjectTokenProviderError) {
        throw response;
      }
      if (isTimeout) {
        throw new APIConnectionTimeoutError();
      }
      throw new APIConnectionError({ cause: response });
    }
    const specialHeaders = [...response.headers.entries()].filter(([name]) => name === "x-request-id").map(([name, value]) => ", " + name + ": " + JSON.stringify(value)).join("");
    const responseInfo = `[${requestLogID}${retryLogStr}${specialHeaders}] ${req.method} ${url} ${response.ok ? "succeeded" : "failed"} with status ${response.status} in ${headersTime - startTime}ms`;
    if (!response.ok) {
      if (response.status === 401 && this._workloadIdentityAuth && !options.__metadata?.["hasStreamingBody"] && !options.__metadata?.["workloadIdentityTokenRefreshed"]) {
        await CancelReadableStream(response.body);
        this._workloadIdentityAuth.invalidateToken();
        return this.makeRequest({
          ...options,
          __metadata: {
            ...options.__metadata,
            workloadIdentityTokenRefreshed: true
          }
        }, retriesRemaining, retryOfRequestLogID ?? requestLogID);
      }
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
  async fetchWithAuth(url, init, timeout, controller) {
    if (this._workloadIdentityAuth) {
      const headers = init.headers;
      const authHeader = headers.get("Authorization");
      if (!authHeader || authHeader === `Bearer ${WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER}`) {
        const token = await this._workloadIdentityAuth.getToken();
        headers.set("Authorization", `Bearer ${token}`);
      }
    }
    const response = await this.fetchWithTimeout(url, init, timeout, controller);
    return response;
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
    const { bodyHeaders, body, isStreamingBody } = this.buildBody({ options });
    if (isStreamingBody) {
      inputOptions.__metadata = {
        ...inputOptions.__metadata,
        hasStreamingBody: true
      };
    }
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
      return { bodyHeaders: void 0, body: void 0, isStreamingBody: false };
    }
    const headers = buildHeaders([rawHeaders]);
    const isReadableStream = typeof globalThis.ReadableStream !== "undefined" && body instanceof globalThis.ReadableStream;
    const isRetryableBody = !isReadableStream && (typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || typeof globalThis.Blob !== "undefined" && body instanceof globalThis.Blob || body instanceof URLSearchParams || body instanceof FormData);
    if (
      // Pass raw type verbatim
      ArrayBuffer.isView(body) || body instanceof ArrayBuffer || body instanceof DataView || typeof body === "string" && // Preserve legacy string encoding behavior for now
      headers.values.has("content-type") || // `Blob` is superset of `File`
      globalThis.Blob && body instanceof globalThis.Blob || // `FormData` -> `multipart/form-data`
      body instanceof FormData || // `URLSearchParams` -> `application/x-www-form-urlencoded`
      body instanceof URLSearchParams || // Send chunked stream (each chunk has own `length`)
      isReadableStream
    ) {
      return { bodyHeaders: void 0, body, isStreamingBody: !isRetryableBody };
    } else if (typeof body === "object" && (Symbol.asyncIterator in body || Symbol.iterator in body && "next" in body && typeof body.next === "function")) {
      return {
        bodyHeaders: void 0,
        body: ReadableStreamFrom(body),
        isStreamingBody: true
      };
    } else if (typeof body === "object" && headers.values.get("content-type") === "application/x-www-form-urlencoded") {
      return {
        bodyHeaders: { "content-type": "application/x-www-form-urlencoded" },
        body: this.stringifyQuery(body),
        isStreamingBody: false
      };
    } else {
      return { ...__classPrivateFieldGet3(this, _OpenAI_encoder, "f").call(this, { body, headers }), isStreamingBody: false };
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
  const logger5 = {
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
  return logger5;
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
      appTitle: getQuilltapUserAgent()
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
      chatRequest: requestParams
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
      appTitle: getQuilltapUserAgent()
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
        appTitle: getQuilltapUserAgent()
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
        appTitle: getQuilltapUserAgent()
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
      appTitle: getQuilltapUserAgent()
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
      appTitle: getQuilltapUserAgent()
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
        appTitle: getQuilltapUserAgent()
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

// image-provider.ts
var logger3 = createPluginLogger("qtap-plugin-openrouter");
var FALLBACK_IMAGE_MODELS = [
  "google/gemini-2.5-flash-preview-native-image",
  "google/gemini-3-pro-image-preview",
  "openai/gpt-5-image",
  "openai/gpt-5-image-mini"
];
var OpenRouterImageProvider = class {
  constructor() {
    this.provider = "OPENROUTER";
    this.supportedModels = [...FALLBACK_IMAGE_MODELS];
  }
  async generateImage(params, apiKey) {
    if (!apiKey) {
      throw new Error("OpenRouter provider requires an API key");
    }
    const model = params.model ?? FALLBACK_IMAGE_MODELS[0];
    logger3.debug("Generating image via OpenRouter", {
      context: "OpenRouterImageProvider.generateImage",
      model,
      hasAspectRatio: !!params.aspectRatio,
      hasNegativePrompt: !!params.negativePrompt
    });
    let prompt = params.prompt;
    if (params.negativePrompt) {
      prompt += `

Avoid the following in the image: ${params.negativePrompt}`;
    }
    if (params.style) {
      prompt += `

Use a ${params.style} artistic style.`;
    }
    const body = {
      model,
      messages: [
        { role: "user", content: prompt }
      ],
      modalities: ["image", "text"]
    };
    const imageConfig = {};
    if (params.aspectRatio) {
      imageConfig.aspect_ratio = params.aspectRatio;
    }
    if (params.quality === "hd") {
      imageConfig.image_size = "4K";
    }
    if (Object.keys(imageConfig).length > 0) {
      body.image_config = imageConfig;
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
        logger3.error("OpenRouter image generation API error", {
          context: "OpenRouterImageProvider.generateImage",
          status: response.status,
          error: errorText,
          model
        });
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
      }
      const data = await response.json();
      logger3.debug("OpenRouter image generation raw response structure", {
        context: "OpenRouterImageProvider.generateImage",
        model,
        choiceCount: data.choices?.length,
        hasImages: !!data.choices?.[0]?.message?.images,
        imageCount: data.choices?.[0]?.message?.images?.length,
        contentType: typeof data.choices?.[0]?.message?.content,
        contentIsArray: Array.isArray(data.choices?.[0]?.message?.content)
      });
      return this.parseImageResponse(data);
    } catch (error) {
      logger3.error("Failed to generate image via OpenRouter", {
        context: "OpenRouterImageProvider.generateImage",
        model
      }, error instanceof Error ? error : void 0);
      throw error;
    }
  }
  /**
   * Parse the OpenRouter chat completion response to extract images.
   *
   * OpenRouter returns images in the message.images[] array:
   *   message.images: [{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }]
   *
   * Also handles fallback formats:
   * - Images in content array (multipart content)
   * - Inline data format (Gemini native passthrough)
   */
  parseImageResponse(data) {
    const images = [];
    let textContent = "";
    const choices = data.choices || [];
    for (const choice of choices) {
      const message = choice.message;
      if (!message) continue;
      if (Array.isArray(message.images)) {
        for (const img of message.images) {
          const url = img.image_url?.url || img.url;
          if (url) {
            this.extractImageFromUrl(url, images);
          }
        }
      }
      if (message.refusal) {
        textContent = message.refusal;
      }
      if (typeof message.content === "string" && message.content) {
        textContent = message.content;
      }
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === "image_url" && part.image_url?.url) {
            this.extractImageFromUrl(part.image_url.url, images);
          } else if (part.type === "text" && part.text) {
            textContent = part.text;
          }
          const inlineData = part.inline_data || part.inlineData;
          if (inlineData?.data) {
            images.push({
              data: inlineData.data,
              mimeType: inlineData.mimeType || inlineData.mime_type || "image/png"
            });
          }
        }
      }
    }
    if (images.length === 0) {
      logger3.error("No images in OpenRouter response", {
        context: "OpenRouterImageProvider.parseImageResponse",
        textContent: textContent.slice(0, 500),
        choiceCount: choices.length,
        messageKeys: choices[0]?.message ? Object.keys(choices[0].message) : []
      });
      if (textContent) {
        const summary = textContent.length > 200 ? textContent.slice(0, 200) + "..." : textContent;
        throw new Error(`Model declined to generate an image: ${summary}`);
      }
      throw new Error("No images returned from OpenRouter API");
    }
    logger3.debug("Successfully parsed image response", {
      context: "OpenRouterImageProvider.parseImageResponse",
      imageCount: images.length
    });
    return {
      images,
      raw: data
    };
  }
  /**
   * Extract image data from a URL (data URI or external URL)
   */
  extractImageFromUrl(url, images) {
    const dataUriMatch = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (dataUriMatch) {
      images.push({
        data: dataUriMatch[2],
        mimeType: dataUriMatch[1]
      });
    } else {
      images.push({ url, mimeType: "image/png" });
    }
  }
  async validateApiKey(apiKey) {
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || "http://localhost:3000",
        appTitle: getQuilltapUserAgent()
      });
      await client.models.list();
      return true;
    } catch (error) {
      logger3.error("OpenRouter API key validation failed for image generation", {
        context: "OpenRouterImageProvider.validateApiKey"
      }, error instanceof Error ? error : void 0);
      return false;
    }
  }
  /**
   * Get available image generation models.
   * Dynamically discovers models via the OpenRouter models API by checking
   * each model's output_modalities for "image" support.
   * Falls back to the static list if no API key is provided or the API call fails.
   */
  async getAvailableModels(apiKey) {
    if (!apiKey) {
      logger3.debug("No API key provided, returning fallback image models", {
        context: "OpenRouterImageProvider.getAvailableModels"
      });
      return [...FALLBACK_IMAGE_MODELS];
    }
    try {
      const client = new OpenRouter({
        apiKey,
        httpReferer: process.env.BASE_URL || "http://localhost:3000",
        appTitle: getQuilltapUserAgent()
      });
      const response = await client.models.list();
      const imageModels = [];
      for (const model of response.data || []) {
        const modelAny = model;
        const outputModalities = modelAny.output_modalities || modelAny.outputModalities;
        if (Array.isArray(outputModalities) && outputModalities.includes("image")) {
          imageModels.push(model.id);
          continue;
        }
        const outputModality = modelAny.architecture?.outputModality;
        if (typeof outputModality === "string" && outputModality.includes("image")) {
          imageModels.push(model.id);
          continue;
        }
        const genMethods = modelAny.supported_generation_methods;
        if (Array.isArray(genMethods) && genMethods.includes("image")) {
          imageModels.push(model.id);
          continue;
        }
      }
      if (imageModels.length > 0) {
        logger3.info("Discovered image generation models from OpenRouter API", {
          context: "OpenRouterImageProvider.getAvailableModels",
          count: imageModels.length,
          models: imageModels.slice(0, 10)
        });
        return imageModels;
      }
      logger3.warn("No image models found via API, using fallback list", {
        context: "OpenRouterImageProvider.getAvailableModels"
      });
      return [...FALLBACK_IMAGE_MODELS];
    } catch (error) {
      logger3.error("Failed to fetch image models from OpenRouter API, using fallback list", {
        context: "OpenRouterImageProvider.getAvailableModels"
      }, error instanceof Error ? error : void 0);
      return [...FALLBACK_IMAGE_MODELS];
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
var logger4 = createPluginLogger("qtap-plugin-openrouter");
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
   * Factory method to create an OpenRouter image generation provider instance
   */
  createImageProvider: (baseUrl) => {
    return new OpenRouterImageProvider();
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
      logger4.error(
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
      logger4.error(
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
          logger4.warn("Skipping tool with invalid format", {
            context: "plugin.formatTools"
          });
          continue;
        }
        formattedTools.push(tool);
      }
      return formattedTools;
    } catch (error) {
      logger4.error(
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
      logger4.error(
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
      logger4.error(
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
