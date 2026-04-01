"use strict";

// ../../../node_modules/@oslojs/encoding/dist/base32.js
var EncodingPadding;
(function(EncodingPadding5) {
  EncodingPadding5[EncodingPadding5["Include"] = 0] = "Include";
  EncodingPadding5[EncodingPadding5["None"] = 1] = "None";
})(EncodingPadding || (EncodingPadding = {}));
var DecodingPadding;
(function(DecodingPadding5) {
  DecodingPadding5[DecodingPadding5["Required"] = 0] = "Required";
  DecodingPadding5[DecodingPadding5["Ignore"] = 1] = "Ignore";
})(DecodingPadding || (DecodingPadding = {}));

// ../../../node_modules/@oslojs/encoding/dist/base64.js
function encodeBase64(bytes) {
  return encodeBase64_internal(bytes, base64Alphabet, EncodingPadding2.Include);
}
function encodeBase64urlNoPadding(bytes) {
  return encodeBase64_internal(bytes, base64urlAlphabet, EncodingPadding2.None);
}
function encodeBase64_internal(bytes, alphabet, padding) {
  let result = "";
  for (let i = 0; i < bytes.byteLength; i += 3) {
    let buffer = 0;
    let bufferBitSize = 0;
    for (let j = 0; j < 3 && i + j < bytes.byteLength; j++) {
      buffer = buffer << 8 | bytes[i + j];
      bufferBitSize += 8;
    }
    for (let j = 0; j < 4; j++) {
      if (bufferBitSize >= 6) {
        result += alphabet[buffer >> bufferBitSize - 6 & 63];
        bufferBitSize -= 6;
      } else if (bufferBitSize > 0) {
        result += alphabet[buffer << 6 - bufferBitSize & 63];
        bufferBitSize = 0;
      } else if (padding === EncodingPadding2.Include) {
        result += "=";
      }
    }
  }
  return result;
}
var base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var base64urlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
var EncodingPadding2;
(function(EncodingPadding5) {
  EncodingPadding5[EncodingPadding5["Include"] = 0] = "Include";
  EncodingPadding5[EncodingPadding5["None"] = 1] = "None";
})(EncodingPadding2 || (EncodingPadding2 = {}));
var DecodingPadding2;
(function(DecodingPadding5) {
  DecodingPadding5[DecodingPadding5["Required"] = 0] = "Required";
  DecodingPadding5[DecodingPadding5["Ignore"] = 1] = "Ignore";
})(DecodingPadding2 || (DecodingPadding2 = {}));

// ../../../node_modules/@oslojs/binary/dist/uint.js
var BigEndian = class {
  uint8(data, offset) {
    if (data.byteLength < offset + 1) {
      throw new TypeError("Insufficient bytes");
    }
    return data[offset];
  }
  uint16(data, offset) {
    if (data.byteLength < offset + 2) {
      throw new TypeError("Insufficient bytes");
    }
    return data[offset] << 8 | data[offset + 1];
  }
  uint32(data, offset) {
    if (data.byteLength < offset + 4) {
      throw new TypeError("Insufficient bytes");
    }
    let result = 0;
    for (let i = 0; i < 4; i++) {
      result |= data[offset + i] << 24 - i * 8;
    }
    return result;
  }
  uint64(data, offset) {
    if (data.byteLength < offset + 8) {
      throw new TypeError("Insufficient bytes");
    }
    let result = 0n;
    for (let i = 0; i < 8; i++) {
      result |= BigInt(data[offset + i]) << BigInt(56 - i * 8);
    }
    return result;
  }
  putUint8(target, value, offset) {
    if (target.length < offset + 1) {
      throw new TypeError("Not enough space");
    }
    if (value < 0 || value > 255) {
      throw new TypeError("Invalid uint8 value");
    }
    target[offset] = value;
  }
  putUint16(target, value, offset) {
    if (target.length < offset + 2) {
      throw new TypeError("Not enough space");
    }
    if (value < 0 || value > 65535) {
      throw new TypeError("Invalid uint16 value");
    }
    target[offset] = value >> 8;
    target[offset + 1] = value & 255;
  }
  putUint32(target, value, offset) {
    if (target.length < offset + 4) {
      throw new TypeError("Not enough space");
    }
    if (value < 0 || value > 4294967295) {
      throw new TypeError("Invalid uint32 value");
    }
    for (let i = 0; i < 4; i++) {
      target[offset + i] = value >> (3 - i) * 8 & 255;
    }
  }
  putUint64(target, value, offset) {
    if (target.length < offset + 8) {
      throw new TypeError("Not enough space");
    }
    if (value < 0 || value > 18446744073709551615n) {
      throw new TypeError("Invalid uint64 value");
    }
    for (let i = 0; i < 8; i++) {
      target[offset + i] = Number(value >> BigInt((7 - i) * 8) & 0xffn);
    }
  }
};
var LittleEndian = class {
  uint8(data, offset) {
    if (data.byteLength < offset + 1) {
      throw new TypeError("Insufficient bytes");
    }
    return data[offset];
  }
  uint16(data, offset) {
    if (data.byteLength < offset + 2) {
      throw new TypeError("Insufficient bytes");
    }
    return data[offset] | data[offset + 1] << 8;
  }
  uint32(data, offset) {
    if (data.byteLength < offset + 4) {
      throw new TypeError("Insufficient bytes");
    }
    let result = 0;
    for (let i = 0; i < 4; i++) {
      result |= data[offset + i] << i * 8;
    }
    return result;
  }
  uint64(data, offset) {
    if (data.byteLength < offset + 8) {
      throw new TypeError("Insufficient bytes");
    }
    let result = 0n;
    for (let i = 0; i < 8; i++) {
      result |= BigInt(data[offset + i]) << BigInt(i * 8);
    }
    return result;
  }
  putUint8(target, value, offset) {
    if (target.length < 1 + offset) {
      throw new TypeError("Insufficient space");
    }
    if (value < 0 || value > 255) {
      throw new TypeError("Invalid uint8 value");
    }
    target[offset] = value;
  }
  putUint16(target, value, offset) {
    if (target.length < 2 + offset) {
      throw new TypeError("Insufficient space");
    }
    if (value < 0 || value > 65535) {
      throw new TypeError("Invalid uint16 value");
    }
    target[offset + 1] = value >> 8;
    target[offset] = value & 255;
  }
  putUint32(target, value, offset) {
    if (target.length < 4 + offset) {
      throw new TypeError("Insufficient space");
    }
    if (value < 0 || value > 4294967295) {
      throw new TypeError("Invalid uint32 value");
    }
    for (let i = 0; i < 4; i++) {
      target[offset + i] = value >> i * 8 & 255;
    }
  }
  putUint64(target, value, offset) {
    if (target.length < 8 + offset) {
      throw new TypeError("Insufficient space");
    }
    if (value < 0 || value > 18446744073709551615n) {
      throw new TypeError("Invalid uint64 value");
    }
    for (let i = 0; i < 8; i++) {
      target[offset + i] = Number(value >> BigInt(i * 8) & 0xffn);
    }
  }
};
var bigEndian = new BigEndian();
var littleEndian = new LittleEndian();

// ../../../node_modules/@oslojs/binary/dist/bits.js
function rotr32(x, n) {
  return (x << 32 - n | x >>> n) >>> 0;
}

// ../../../node_modules/@oslojs/crypto/dist/sha2/sha224.js
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);

// ../../../node_modules/@oslojs/crypto/dist/sha2/sha256.js
function sha256(data) {
  const hash = new SHA256();
  hash.update(data);
  return hash.digest();
}
var SHA256 = class {
  blockSize = 64;
  size = 32;
  blocks = new Uint8Array(64);
  currentBlockSize = 0;
  H = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  l = 0n;
  w = new Uint32Array(64);
  update(data) {
    this.l += BigInt(data.byteLength) * 8n;
    if (this.currentBlockSize + data.byteLength < 64) {
      this.blocks.set(data, this.currentBlockSize);
      this.currentBlockSize += data.byteLength;
      return;
    }
    let processed = 0;
    if (this.currentBlockSize > 0) {
      const next = data.slice(0, 64 - this.currentBlockSize);
      this.blocks.set(next, this.currentBlockSize);
      this.process();
      processed += next.byteLength;
      this.currentBlockSize = 0;
    }
    while (processed + 64 <= data.byteLength) {
      const next = data.slice(processed, processed + 64);
      this.blocks.set(next);
      this.process();
      processed += 64;
    }
    if (data.byteLength - processed > 0) {
      const remaining = data.slice(processed);
      this.blocks.set(remaining);
      this.currentBlockSize = remaining.byteLength;
    }
  }
  digest() {
    this.blocks[this.currentBlockSize] = 128;
    this.currentBlockSize += 1;
    if (64 - this.currentBlockSize < 8) {
      this.blocks.fill(0, this.currentBlockSize);
      this.process();
      this.currentBlockSize = 0;
    }
    this.blocks.fill(0, this.currentBlockSize);
    bigEndian.putUint64(this.blocks, this.l, this.blockSize - 8);
    this.process();
    const result = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      bigEndian.putUint32(result, this.H[i], i * 4);
    }
    return result;
  }
  process() {
    for (let t = 0; t < 16; t++) {
      this.w[t] = (this.blocks[t * 4] << 24 | this.blocks[t * 4 + 1] << 16 | this.blocks[t * 4 + 2] << 8 | this.blocks[t * 4 + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const sigma1 = (rotr32(this.w[t - 2], 17) ^ rotr32(this.w[t - 2], 19) ^ this.w[t - 2] >>> 10) >>> 0;
      const sigma0 = (rotr32(this.w[t - 15], 7) ^ rotr32(this.w[t - 15], 18) ^ this.w[t - 15] >>> 3) >>> 0;
      this.w[t] = sigma1 + this.w[t - 7] + sigma0 + this.w[t - 16] | 0;
    }
    let a = this.H[0];
    let b = this.H[1];
    let c = this.H[2];
    let d = this.H[3];
    let e = this.H[4];
    let f = this.H[5];
    let g = this.H[6];
    let h = this.H[7];
    for (let t = 0; t < 64; t++) {
      const sigma1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = (e & f ^ ~e & g) >>> 0;
      const t1 = h + sigma1 + ch + K2[t] + this.w[t] | 0;
      const sigma0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = (a & b ^ a & c ^ b & c) >>> 0;
      const t2 = sigma0 + maj | 0;
      h = g;
      g = f;
      f = e;
      e = d + t1 | 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 | 0;
    }
    this.H[0] = a + this.H[0] | 0;
    this.H[1] = b + this.H[1] | 0;
    this.H[2] = c + this.H[2] | 0;
    this.H[3] = d + this.H[3] | 0;
    this.H[4] = e + this.H[4] | 0;
    this.H[5] = f + this.H[5] | 0;
    this.H[6] = g + this.H[6] | 0;
    this.H[7] = h + this.H[7] | 0;
  }
};
var K2 = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);

// ../../../node_modules/@oslojs/crypto/dist/sha2/sha512.js
var K3 = new BigUint64Array([
  0x428a2f98d728ae22n,
  0x7137449123ef65cdn,
  0xb5c0fbcfec4d3b2fn,
  0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n,
  0x59f111f1b605d019n,
  0x923f82a4af194f9bn,
  0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n,
  0x12835b0145706fben,
  0x243185be4ee4b28cn,
  0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn,
  0x80deb1fe3b1696b1n,
  0x9bdc06a725c71235n,
  0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n,
  0xefbe4786384f25e3n,
  0x0fc19dc68b8cd5b5n,
  0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n,
  0x4a7484aa6ea6e483n,
  0x5cb0a9dcbd41fbd4n,
  0x76f988da831153b5n,
  0x983e5152ee66dfabn,
  0xa831c66d2db43210n,
  0xb00327c898fb213fn,
  0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n,
  0xd5a79147930aa725n,
  0x06ca6351e003826fn,
  0x142929670a0e6e70n,
  0x27b70a8546d22ffcn,
  0x2e1b21385c26c926n,
  0x4d2c6dfc5ac42aedn,
  0x53380d139d95b3dfn,
  0x650a73548baf63den,
  0x766a0abb3c77b2a8n,
  0x81c2c92e47edaee6n,
  0x92722c851482353bn,
  0xa2bfe8a14cf10364n,
  0xa81a664bbc423001n,
  0xc24b8b70d0f89791n,
  0xc76c51a30654be30n,
  0xd192e819d6ef5218n,
  0xd69906245565a910n,
  0xf40e35855771202an,
  0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n,
  0x1e376c085141ab53n,
  0x2748774cdf8eeb99n,
  0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n,
  0x4ed8aa4ae3418acbn,
  0x5b9cca4f7763e373n,
  0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn,
  0x78a5636f43172f60n,
  0x84c87814a1f0ab72n,
  0x8cc702081a6439ecn,
  0x90befffa23631e28n,
  0xa4506cebde82bde9n,
  0xbef9a3f7b2c67915n,
  0xc67178f2e372532bn,
  0xca273eceea26619cn,
  0xd186b8c721c0c207n,
  0xeada7dd6cde0eb1en,
  0xf57d4f7fee6ed178n,
  0x06f067aa72176fban,
  0x0a637dc5a2c898a6n,
  0x113f9804bef90daen,
  0x1b710b35131c471bn,
  0x28db77f523047d84n,
  0x32caab7b40c72493n,
  0x3c9ebe0a15c9bebcn,
  0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n,
  0x597f299cfc657e2an,
  0x5fcb6fab3ad6faecn,
  0x6c44198c4a475817n
]);

// ../../../node_modules/arctic/dist/oauth2.js
var OAuth2Tokens = class {
  data;
  constructor(data) {
    this.data = data;
  }
  tokenType() {
    if ("token_type" in this.data && typeof this.data.token_type === "string") {
      return this.data.token_type;
    }
    throw new Error("Missing or invalid 'token_type' field");
  }
  accessToken() {
    if ("access_token" in this.data && typeof this.data.access_token === "string") {
      return this.data.access_token;
    }
    throw new Error("Missing or invalid 'access_token' field");
  }
  accessTokenExpiresInSeconds() {
    if ("expires_in" in this.data && typeof this.data.expires_in === "number") {
      return this.data.expires_in;
    }
    throw new Error("Missing or invalid 'expires_in' field");
  }
  accessTokenExpiresAt() {
    return new Date(Date.now() + this.accessTokenExpiresInSeconds() * 1e3);
  }
  hasRefreshToken() {
    return "refresh_token" in this.data && typeof this.data.refresh_token === "string";
  }
  refreshToken() {
    if ("refresh_token" in this.data && typeof this.data.refresh_token === "string") {
      return this.data.refresh_token;
    }
    throw new Error("Missing or invalid 'refresh_token' field");
  }
  hasScopes() {
    return "scope" in this.data && typeof this.data.scope === "string";
  }
  scopes() {
    if ("scope" in this.data && typeof this.data.scope === "string") {
      return this.data.scope.split(" ");
    }
    throw new Error("Missing or invalid 'scope' field");
  }
  idToken() {
    if ("id_token" in this.data && typeof this.data.id_token === "string") {
      return this.data.id_token;
    }
    throw new Error("Missing or invalid field 'id_token'");
  }
};
function createS256CodeChallenge(codeVerifier) {
  const codeChallengeBytes = sha256(new TextEncoder().encode(codeVerifier));
  return encodeBase64urlNoPadding(codeChallengeBytes);
}

// ../../../node_modules/arctic/dist/request.js
function createOAuth2Request(endpoint, body) {
  const bodyBytes = new TextEncoder().encode(body.toString());
  const request = new Request(endpoint, {
    method: "POST",
    body: bodyBytes
  });
  request.headers.set("Content-Type", "application/x-www-form-urlencoded");
  request.headers.set("Accept", "application/json");
  request.headers.set("User-Agent", "arctic");
  request.headers.set("Content-Length", bodyBytes.byteLength.toString());
  return request;
}
function encodeBasicCredentials(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return encodeBase64(bytes);
}
async function sendTokenRequest(request) {
  let response;
  try {
    response = await fetch(request);
  } catch (e) {
    throw new ArcticFetchError(e);
  }
  if (response.status === 400 || response.status === 401) {
    let data;
    try {
      data = await response.json();
    } catch {
      throw new UnexpectedResponseError(response.status);
    }
    if (typeof data !== "object" || data === null) {
      throw new UnexpectedErrorResponseBodyError(response.status, data);
    }
    let error;
    try {
      error = createOAuth2RequestError(data);
    } catch {
      throw new UnexpectedErrorResponseBodyError(response.status, data);
    }
    throw error;
  }
  if (response.status === 200) {
    let data;
    try {
      data = await response.json();
    } catch {
      throw new UnexpectedResponseError(response.status);
    }
    if (typeof data !== "object" || data === null) {
      throw new UnexpectedErrorResponseBodyError(response.status, data);
    }
    const tokens = new OAuth2Tokens(data);
    return tokens;
  }
  if (response.body !== null) {
    await response.body.cancel();
  }
  throw new UnexpectedResponseError(response.status);
}
async function sendTokenRevocationRequest(request) {
  let response;
  try {
    response = await fetch(request);
  } catch (e) {
    throw new ArcticFetchError(e);
  }
  if (response.status === 400 || response.status === 401) {
    let data;
    try {
      data = await response.json();
    } catch {
      throw new UnexpectedErrorResponseBodyError(response.status, null);
    }
    if (typeof data !== "object" || data === null) {
      throw new UnexpectedErrorResponseBodyError(response.status, data);
    }
    let error;
    try {
      error = createOAuth2RequestError(data);
    } catch {
      throw new UnexpectedErrorResponseBodyError(response.status, data);
    }
    throw error;
  }
  if (response.status === 200) {
    if (response.body !== null) {
      await response.body.cancel();
    }
    return;
  }
  if (response.body !== null) {
    await response.body.cancel();
  }
  throw new UnexpectedResponseError(response.status);
}
function createOAuth2RequestError(result) {
  let code;
  if ("error" in result && typeof result.error === "string") {
    code = result.error;
  } else {
    throw new Error("Invalid error response");
  }
  let description = null;
  let uri = null;
  let state = null;
  if ("error_description" in result) {
    if (typeof result.error_description !== "string") {
      throw new Error("Invalid data");
    }
    description = result.error_description;
  }
  if ("error_uri" in result) {
    if (typeof result.error_uri !== "string") {
      throw new Error("Invalid data");
    }
    uri = result.error_uri;
  }
  if ("state" in result) {
    if (typeof result.state !== "string") {
      throw new Error("Invalid data");
    }
    state = result.state;
  }
  const error = new OAuth2RequestError(code, description, uri, state);
  return error;
}
var ArcticFetchError = class extends Error {
  constructor(cause) {
    super("Failed to send request", {
      cause
    });
  }
};
var OAuth2RequestError = class extends Error {
  code;
  description;
  uri;
  state;
  constructor(code, description, uri, state) {
    super(`OAuth request error: ${code}`);
    this.code = code;
    this.description = description;
    this.uri = uri;
    this.state = state;
  }
};
var UnexpectedResponseError = class extends Error {
  status;
  constructor(responseStatus) {
    super("Unexpected error response");
    this.status = responseStatus;
  }
};
var UnexpectedErrorResponseBodyError = class extends Error {
  status;
  data;
  constructor(status, data) {
    super("Unexpected error response body");
    this.status = status;
    this.data = data;
  }
};

// ../../../node_modules/arctic/dist/client.js
var OAuth2Client = class {
  clientId;
  clientPassword;
  redirectURI;
  constructor(clientId, clientPassword, redirectURI) {
    this.clientId = clientId;
    this.clientPassword = clientPassword;
    this.redirectURI = redirectURI;
  }
  createAuthorizationURL(authorizationEndpoint2, state, scopes) {
    const url = new URL(authorizationEndpoint2);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.clientId);
    if (this.redirectURI !== null) {
      url.searchParams.set("redirect_uri", this.redirectURI);
    }
    url.searchParams.set("state", state);
    if (scopes.length > 0) {
      url.searchParams.set("scope", scopes.join(" "));
    }
    return url;
  }
  createAuthorizationURLWithPKCE(authorizationEndpoint2, state, codeChallengeMethod, codeVerifier, scopes) {
    const url = new URL(authorizationEndpoint2);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.clientId);
    if (this.redirectURI !== null) {
      url.searchParams.set("redirect_uri", this.redirectURI);
    }
    url.searchParams.set("state", state);
    if (codeChallengeMethod === CodeChallengeMethod.S256) {
      const codeChallenge = createS256CodeChallenge(codeVerifier);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("code_challenge", codeChallenge);
    } else if (codeChallengeMethod === CodeChallengeMethod.Plain) {
      url.searchParams.set("code_challenge_method", "plain");
      url.searchParams.set("code_challenge", codeVerifier);
    }
    if (scopes.length > 0) {
      url.searchParams.set("scope", scopes.join(" "));
    }
    return url;
  }
  async validateAuthorizationCode(tokenEndpoint2, code, codeVerifier) {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", code);
    if (this.redirectURI !== null) {
      body.set("redirect_uri", this.redirectURI);
    }
    if (codeVerifier !== null) {
      body.set("code_verifier", codeVerifier);
    }
    if (this.clientPassword === null) {
      body.set("client_id", this.clientId);
    }
    const request = createOAuth2Request(tokenEndpoint2, body);
    if (this.clientPassword !== null) {
      const encodedCredentials = encodeBasicCredentials(this.clientId, this.clientPassword);
      request.headers.set("Authorization", `Basic ${encodedCredentials}`);
    }
    const tokens = await sendTokenRequest(request);
    return tokens;
  }
  async refreshAccessToken(tokenEndpoint2, refreshToken, scopes) {
    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
    if (this.clientPassword === null) {
      body.set("client_id", this.clientId);
    }
    if (scopes.length > 0) {
      body.set("scope", scopes.join(" "));
    }
    const request = createOAuth2Request(tokenEndpoint2, body);
    if (this.clientPassword !== null) {
      const encodedCredentials = encodeBasicCredentials(this.clientId, this.clientPassword);
      request.headers.set("Authorization", `Basic ${encodedCredentials}`);
    }
    const tokens = await sendTokenRequest(request);
    return tokens;
  }
  async revokeToken(tokenRevocationEndpoint2, token) {
    const body = new URLSearchParams();
    body.set("token", token);
    if (this.clientPassword === null) {
      body.set("client_id", this.clientId);
    }
    const request = createOAuth2Request(tokenRevocationEndpoint2, body);
    if (this.clientPassword !== null) {
      const encodedCredentials = encodeBasicCredentials(this.clientId, this.clientPassword);
      request.headers.set("Authorization", `Basic ${encodedCredentials}`);
    }
    await sendTokenRevocationRequest(request);
  }
};
var CodeChallengeMethod;
(function(CodeChallengeMethod2) {
  CodeChallengeMethod2[CodeChallengeMethod2["S256"] = 0] = "S256";
  CodeChallengeMethod2[CodeChallengeMethod2["Plain"] = 1] = "Plain";
})(CodeChallengeMethod || (CodeChallengeMethod = {}));

// ../../../node_modules/@oslojs/jwt/node_modules/@oslojs/encoding/dist/base32.js
var EncodingPadding3;
(function(EncodingPadding5) {
  EncodingPadding5[EncodingPadding5["Include"] = 0] = "Include";
  EncodingPadding5[EncodingPadding5["None"] = 1] = "None";
})(EncodingPadding3 || (EncodingPadding3 = {}));
var DecodingPadding3;
(function(DecodingPadding5) {
  DecodingPadding5[DecodingPadding5["Required"] = 0] = "Required";
  DecodingPadding5[DecodingPadding5["Ignore"] = 1] = "Ignore";
})(DecodingPadding3 || (DecodingPadding3 = {}));

// ../../../node_modules/@oslojs/jwt/node_modules/@oslojs/encoding/dist/base64.js
var EncodingPadding4;
(function(EncodingPadding5) {
  EncodingPadding5[EncodingPadding5["Include"] = 0] = "Include";
  EncodingPadding5[EncodingPadding5["None"] = 1] = "None";
})(EncodingPadding4 || (EncodingPadding4 = {}));
var DecodingPadding4;
(function(DecodingPadding5) {
  DecodingPadding5[DecodingPadding5["Required"] = 0] = "Required";
  DecodingPadding5[DecodingPadding5["Ignore"] = 1] = "Ignore";
})(DecodingPadding4 || (DecodingPadding4 = {}));

// ../../../node_modules/arctic/dist/providers/google.js
var authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
var tokenEndpoint = "https://oauth2.googleapis.com/token";
var tokenRevocationEndpoint = "https://oauth2.googleapis.com/revoke";
var Google = class {
  client;
  constructor(clientId, clientSecret, redirectURI) {
    this.client = new OAuth2Client(clientId, clientSecret, redirectURI);
  }
  createAuthorizationURL(state, codeVerifier, scopes) {
    const url = this.client.createAuthorizationURLWithPKCE(authorizationEndpoint, state, CodeChallengeMethod.S256, codeVerifier, scopes);
    return url;
  }
  async validateAuthorizationCode(code, codeVerifier) {
    const tokens = await this.client.validateAuthorizationCode(tokenEndpoint, code, codeVerifier);
    return tokens;
  }
  async refreshAccessToken(refreshToken) {
    const tokens = await this.client.refreshAccessToken(tokenEndpoint, refreshToken, []);
    return tokens;
  }
  async revokeToken(token) {
    await this.client.revokeToken(tokenRevocationEndpoint, token);
  }
};

// index.ts
var REQUIRED_ENV_VARS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
var DEFAULT_SCOPES = ["openid", "email", "profile"];
var config = {
  providerId: "google",
  displayName: "Google",
  icon: "google",
  requiredEnvVars: REQUIRED_ENV_VARS,
  scopes: DEFAULT_SCOPES,
  buttonColor: "bg-white hover:bg-gray-50 border border-gray-300",
  buttonTextColor: "text-gray-700"
};
function checkEnvVars(requiredVars) {
  const missingVars = requiredVars.filter((varName) => !process.env[varName]);
  return {
    isConfigured: missingVars.length === 0,
    missingVars
  };
}
function getCallbackUrl() {
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  return `${baseUrl}/api/auth/oauth/google/callback`;
}
function isConfigured() {
  const status = getConfigStatus();
  return status.isConfigured;
}
function getConfigStatus() {
  return checkEnvVars(REQUIRED_ENV_VARS);
}
function getScopes() {
  return DEFAULT_SCOPES;
}
function createArcticProvider() {
  if (!isConfigured()) {
    return null;
  }
  return new Google(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getCallbackUrl()
  );
}
async function fetchUserInfo(accessToken) {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Google user info: ${response.status}`);
  }
  const data = await response.json();
  return {
    id: data.id,
    email: data.email,
    name: data.name,
    image: data.picture
  };
}
module.exports = {
  config,
  isConfigured,
  getConfigStatus,
  getScopes,
  createArcticProvider,
  fetchUserInfo
};
