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
  BUILTIN_MODEL_NAME: () => BUILTIN_MODEL_NAME,
  BuiltinEmbeddingProvider: () => BuiltinEmbeddingProvider,
  STOP_WORDS: () => STOP_WORDS,
  TfIdfVectorizer: () => TfIdfVectorizer,
  default: () => index_default,
  generateBigrams: () => generateBigrams,
  plugin: () => plugin,
  stem: () => stem,
  tokenize: () => tokenize
});
module.exports = __toCommonJS(index_exports);

// porter-stemmer.ts
var STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "then",
  "else",
  "when",
  "at",
  "by",
  "for",
  "with",
  "about",
  "against",
  "between",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "to",
  "from",
  "up",
  "down",
  "in",
  "out",
  "on",
  "off",
  "over",
  "under",
  "again",
  "further",
  "once",
  "here",
  "there",
  "where",
  "why",
  "how",
  "all",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "s",
  "t",
  "can",
  "will",
  "just",
  "don",
  "should",
  "now",
  "i",
  "me",
  "my",
  "myself",
  "we",
  "our",
  "ours",
  "ourselves",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
  "he",
  "him",
  "his",
  "himself",
  "she",
  "her",
  "hers",
  "herself",
  "it",
  "its",
  "itself",
  "they",
  "them",
  "their",
  "theirs",
  "themselves",
  "what",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "am",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "having",
  "do",
  "does",
  "did",
  "doing",
  "would",
  "could",
  "ought",
  "of",
  "as"
]);
function isConsonant(word, i) {
  const c = word[i];
  if (c === "a" || c === "e" || c === "i" || c === "o" || c === "u") {
    return false;
  }
  if (c === "y") {
    return i === 0 || !isConsonant(word, i - 1);
  }
  return true;
}
function measure(word) {
  let m = 0;
  let i = 0;
  const len = word.length;
  while (i < len && isConsonant(word, i)) {
    i++;
  }
  while (i < len) {
    while (i < len && !isConsonant(word, i)) {
      i++;
    }
    if (i >= len) break;
    m++;
    while (i < len && isConsonant(word, i)) {
      i++;
    }
  }
  return m;
}
function hasVowel(word) {
  for (let i = 0; i < word.length; i++) {
    if (!isConsonant(word, i)) {
      return true;
    }
  }
  return false;
}
function endsWithDoubleConsonant(word) {
  if (word.length < 2) return false;
  const last = word.length - 1;
  return word[last] === word[last - 1] && isConsonant(word, last);
}
function endsWithCVC(word) {
  if (word.length < 3) return false;
  const last = word.length - 1;
  const c = word[last];
  return isConsonant(word, last) && !isConsonant(word, last - 1) && isConsonant(word, last - 2) && c !== "w" && c !== "x" && c !== "y";
}
function step1a(word) {
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("ies")) return word.slice(0, -2);
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}
function step1b(word) {
  if (word.endsWith("eed")) {
    const stem3 = word.slice(0, -3);
    if (measure(stem3) > 0) return stem3 + "ee";
    return word;
  }
  let stem2 = "";
  let hadSuffix = false;
  if (word.endsWith("ed")) {
    stem2 = word.slice(0, -2);
    hadSuffix = hasVowel(stem2);
  } else if (word.endsWith("ing")) {
    stem2 = word.slice(0, -3);
    hadSuffix = hasVowel(stem2);
  }
  if (hadSuffix) {
    word = stem2;
    if (word.endsWith("at") || word.endsWith("bl") || word.endsWith("iz")) {
      return word + "e";
    }
    if (endsWithDoubleConsonant(word) && !word.endsWith("l") && !word.endsWith("s") && !word.endsWith("z")) {
      return word.slice(0, -1);
    }
    if (measure(word) === 1 && endsWithCVC(word)) {
      return word + "e";
    }
  }
  return word;
}
function step1c(word) {
  if (word.endsWith("y") && hasVowel(word.slice(0, -1))) {
    return word.slice(0, -1) + "i";
  }
  return word;
}
function step2(word) {
  const mappings = [
    ["ational", "ate"],
    ["tional", "tion"],
    ["enci", "ence"],
    ["anci", "ance"],
    ["izer", "ize"],
    ["abli", "able"],
    ["alli", "al"],
    ["entli", "ent"],
    ["eli", "e"],
    ["ousli", "ous"],
    ["ization", "ize"],
    ["ation", "ate"],
    ["ator", "ate"],
    ["alism", "al"],
    ["iveness", "ive"],
    ["fulness", "ful"],
    ["ousness", "ous"],
    ["aliti", "al"],
    ["iviti", "ive"],
    ["biliti", "ble"]
  ];
  for (const [suffix, replacement] of mappings) {
    if (word.endsWith(suffix)) {
      const stem2 = word.slice(0, -suffix.length);
      if (measure(stem2) > 0) {
        return stem2 + replacement;
      }
      return word;
    }
  }
  return word;
}
function step3(word) {
  const mappings = [
    ["icate", "ic"],
    ["ative", ""],
    ["alize", "al"],
    ["iciti", "ic"],
    ["ical", "ic"],
    ["ful", ""],
    ["ness", ""]
  ];
  for (const [suffix, replacement] of mappings) {
    if (word.endsWith(suffix)) {
      const stem2 = word.slice(0, -suffix.length);
      if (measure(stem2) > 0) {
        return stem2 + replacement;
      }
      return word;
    }
  }
  return word;
}
function step4(word) {
  const suffixes = [
    "al",
    "ance",
    "ence",
    "er",
    "ic",
    "able",
    "ible",
    "ant",
    "ement",
    "ment",
    "ent",
    "ion",
    "ou",
    "ism",
    "ate",
    "iti",
    "ous",
    "ive",
    "ize"
  ];
  for (const suffix of suffixes) {
    if (word.endsWith(suffix)) {
      const stem2 = word.slice(0, -suffix.length);
      if (measure(stem2) > 1) {
        if (suffix === "ion") {
          if (stem2.endsWith("s") || stem2.endsWith("t")) {
            return stem2;
          }
        } else {
          return stem2;
        }
      }
      return word;
    }
  }
  return word;
}
function step5a(word) {
  if (word.endsWith("e")) {
    const stem2 = word.slice(0, -1);
    const m = measure(stem2);
    if (m > 1) return stem2;
    if (m === 1 && !endsWithCVC(stem2)) return stem2;
  }
  return word;
}
function step5b(word) {
  if (measure(word) > 1 && endsWithDoubleConsonant(word) && word.endsWith("l")) {
    return word.slice(0, -1);
  }
  return word;
}
function stem(word) {
  if (word.length <= 2) return word;
  let result = word.toLowerCase();
  result = step1a(result);
  result = step1b(result);
  result = step1c(result);
  result = step2(result);
  result = step3(result);
  result = step4(result);
  result = step5a(result);
  result = step5b(result);
  return result;
}
function tokenize(text, removeStopWords = true) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 0);
  const tokens = [];
  for (const word of words) {
    if (removeStopWords && STOP_WORDS.has(word)) {
      continue;
    }
    if (word.length < 2) {
      continue;
    }
    tokens.push(stem(word));
  }
  return tokens;
}
function generateBigrams(tokens) {
  const bigrams = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return bigrams;
}

// tfidf-vectorizer.ts
var BM25_K1 = 1.5;
var BM25_B = 0.75;
var TfIdfVectorizer = class {
  /**
   * Create a new TF-IDF vectorizer
   *
   * @param includeBigrams Whether to include bigrams in the vocabulary (default: true)
   */
  constructor(includeBigrams = true) {
    this.vocabulary = /* @__PURE__ */ new Map();
    this.idf = [];
    this.avgDocLength = 0;
    this.fittedAt = null;
    this.includeBigrams = includeBigrams;
  }
  /**
   * Check if the vectorizer has been fitted
   */
  isFitted() {
    return this.vocabulary.size > 0 && this.fittedAt !== null;
  }
  /**
   * Get the vocabulary size
   */
  getVocabularySize() {
    return this.vocabulary.size;
  }
  /**
   * Get the embedding dimensions (same as vocabulary size)
   */
  getDimensions() {
    return this.vocabulary.size;
  }
  /**
   * Fit the vectorizer on a corpus of documents
   *
   * This method:
   * 1. Tokenizes all documents
   * 2. Builds vocabulary from unique terms
   * 3. Calculates IDF weights
   * 4. Computes average document length for BM25
   *
   * @param documents Array of text documents
   */
  fitCorpus(documents) {
    if (documents.length === 0) {
      throw new Error("Cannot fit on empty corpus");
    }
    const tokenizedDocs = documents.map((doc) => this.tokenizeDocument(doc));
    const termSet = /* @__PURE__ */ new Set();
    for (const tokens of tokenizedDocs) {
      for (const token of tokens) {
        termSet.add(token);
      }
    }
    const sortedTerms = Array.from(termSet).sort();
    this.vocabulary = /* @__PURE__ */ new Map();
    for (let i = 0; i < sortedTerms.length; i++) {
      this.vocabulary.set(sortedTerms[i], i);
    }
    const docFrequencies = new Array(this.vocabulary.size).fill(0);
    for (const tokens of tokenizedDocs) {
      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        const idx = this.vocabulary.get(token);
        if (idx !== void 0) {
          docFrequencies[idx]++;
        }
      }
    }
    const N = documents.length;
    this.idf = docFrequencies.map((df) => {
      return Math.log((N - df + 0.5) / (df + 0.5) + 1);
    });
    let totalLength = 0;
    for (const tokens of tokenizedDocs) {
      totalLength += tokens.length;
    }
    this.avgDocLength = totalLength / documents.length;
    this.fittedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  /**
   * Transform a document into a TF-IDF vector with BM25 weighting
   *
   * @param document The text document to vectorize
   * @returns The TF-IDF vector (sparse representation as full array)
   */
  transform(document) {
    if (!this.isFitted()) {
      throw new Error("Vectorizer must be fitted before transform");
    }
    const tokens = this.tokenizeDocument(document);
    const docLength = tokens.length;
    const termCounts = /* @__PURE__ */ new Map();
    for (const token of tokens) {
      termCounts.set(token, (termCounts.get(token) || 0) + 1);
    }
    const vector = new Array(this.vocabulary.size).fill(0);
    for (const [term, count] of termCounts) {
      const idx = this.vocabulary.get(term);
      if (idx === void 0) continue;
      const tf = count;
      const lengthNorm = 1 - BM25_B + BM25_B * (docLength / this.avgDocLength);
      const bm25Tf = tf * (BM25_K1 + 1) / (tf + BM25_K1 * lengthNorm);
      vector[idx] = bm25Tf * this.idf[idx];
    }
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }
    return vector;
  }
  /**
   * Tokenize a document into terms (unigrams and optionally bigrams)
   */
  tokenizeDocument(document) {
    const unigrams = tokenize(document);
    if (!this.includeBigrams) {
      return unigrams;
    }
    const bigrams = generateBigrams(unigrams);
    return [...unigrams, ...bigrams];
  }
  /**
   * Get the current state for serialization
   */
  getState() {
    if (!this.isFitted()) {
      return null;
    }
    return {
      vocabulary: Array.from(this.vocabulary.entries()),
      idf: this.idf,
      avgDocLength: this.avgDocLength,
      vocabularySize: this.vocabulary.size,
      includeBigrams: this.includeBigrams,
      fittedAt: this.fittedAt
    };
  }
  /**
   * Load state from a serialized representation
   */
  loadState(state) {
    this.vocabulary = new Map(state.vocabulary);
    this.idf = state.idf;
    this.avgDocLength = state.avgDocLength;
    this.includeBigrams = state.includeBigrams;
    this.fittedAt = state.fittedAt;
  }
  /**
   * Calculate cosine similarity between two vectors
   *
   * @param a First vector
   * @param b Second vector
   * @returns Similarity score (0-1, where 1 is identical)
   */
  static cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;
    return dotProduct / magnitude;
  }
};

// embedding-provider.ts
var BUILTIN_MODEL_NAME = "tfidf-bm25-v1";
var BuiltinEmbeddingProvider = class {
  /**
   * Create a new Built-in Embedding Provider
   *
   * @param includeBigrams Whether to include bigrams in the vocabulary (default: true)
   */
  constructor(includeBigrams = true) {
    this.vectorizer = new TfIdfVectorizer(includeBigrams);
  }
  /**
   * Generate an embedding for a single text
   *
   * @param text The text to embed
   * @returns The embedding result
   * @throws Error if the provider has not been fitted
   */
  generateEmbedding(text) {
    if (!this.vectorizer.isFitted()) {
      throw new Error(
        "Built-in embedding provider must be fitted before generating embeddings. Call fitCorpus() with your documents first."
      );
    }
    const embedding = this.vectorizer.transform(text);
    return {
      embedding,
      model: BUILTIN_MODEL_NAME,
      dimensions: embedding.length
    };
  }
  /**
   * Generate embeddings for multiple texts in a batch
   *
   * @param texts Array of texts to embed
   * @returns Array of embedding results
   */
  generateBatchEmbeddings(texts) {
    return texts.map((text) => this.generateEmbedding(text));
  }
  /**
   * Fit the vocabulary on a corpus of documents
   *
   * This analyzes the corpus to build vocabulary, calculate IDF weights,
   * and compute statistics needed for embedding generation.
   *
   * After fitting, the state should be saved using getState() and stored
   * in the database for persistence.
   *
   * @param documents Array of text documents to analyze
   */
  fitCorpus(documents) {
    this.vectorizer.fitCorpus(documents);
  }
  /**
   * Check if the vocabulary has been fitted
   *
   * @returns True if fitCorpus has been called with documents
   */
  isFitted() {
    return this.vectorizer.isFitted();
  }
  /**
   * Load state from a serialized representation
   *
   * Call this to restore the vocabulary from the database.
   *
   * @param state The serialized provider state
   */
  loadState(state) {
    this.vectorizer.loadState(state);
  }
  /**
   * Get the current state for serialization
   *
   * Call this to save the vocabulary to the database.
   *
   * @returns The provider state, or null if not fitted
   */
  getState() {
    return this.vectorizer.getState();
  }
  /**
   * Get the vocabulary size
   *
   * @returns Number of terms in the vocabulary
   */
  getVocabularySize() {
    return this.vectorizer.getVocabularySize();
  }
  /**
   * Get the embedding dimensions
   *
   * @returns Number of dimensions in generated embeddings
   */
  getDimensions() {
    return this.vectorizer.getDimensions();
  }
  /**
   * Check if the provider is available
   *
   * The built-in provider is always available since it has no external dependencies.
   *
   * @returns Always returns true
   */
  async isAvailable() {
    return true;
  }
  /**
   * Get available models
   *
   * The built-in provider only has one model.
   *
   * @returns Array with single model ID
   */
  async getAvailableModels() {
    return [BUILTIN_MODEL_NAME];
  }
  /**
   * Calculate cosine similarity between two embeddings
   *
   * @param a First embedding
   * @param b Second embedding
   * @returns Similarity score (0-1)
   */
  static cosineSimilarity(a, b) {
    return TfIdfVectorizer.cosineSimilarity(a, b);
  }
};

// icon.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function BuiltinEmbeddingsIcon({ className = "h-5 w-5" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      className,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      xmlns: "http://www.w3.org/2000/svg",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "3", y: "4", width: "8", height: "16", rx: "1" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", { x1: "5", y1: "8", x2: "9", y2: "8" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", { x1: "5", y1: "11", x2: "9", y2: "11" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", { x1: "5", y1: "14", x2: "9", y2: "14" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M11 12 L14 12" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("polyline", { points: "13 10 15 12 13 14" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "18", cy: "7", r: "1.5", fill: "currentColor", stroke: "none" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "18", cy: "12", r: "1.5", fill: "currentColor", stroke: "none" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "18", cy: "17", r: "1.5", fill: "currentColor", stroke: "none" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "20", cy: "9.5", r: "1", fill: "currentColor", stroke: "none", opacity: "0.6" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "20", cy: "14.5", r: "1", fill: "currentColor", stroke: "none", opacity: "0.6" })
      ]
    }
  );
}

// index.ts
var metadata = {
  providerName: "BUILTIN",
  displayName: "Built-in (TF-IDF)",
  description: "Offline embeddings using TF-IDF with BM25 enhancement - no API keys required",
  colors: {
    bg: "bg-emerald-100",
    text: "text-emerald-800",
    icon: "text-emerald-600"
  },
  abbreviation: "TF"
};
var config = {
  requiresApiKey: false,
  requiresBaseUrl: false
};
var capabilities = {
  chat: false,
  imageGeneration: false,
  embeddings: true,
  webSearch: false
};
var attachmentSupport = {
  supportsAttachments: false,
  supportedMimeTypes: [],
  description: "No file attachments - embedding provider only"
};
var plugin = {
  metadata,
  config,
  capabilities,
  attachmentSupport,
  /**
   * Factory method to create the embedding provider
   *
   * Returns a LocalEmbeddingProvider that must be fitted on a corpus
   * before use. The vocabulary state should be persisted to the database.
   */
  createEmbeddingProvider: () => {
    return new BuiltinEmbeddingProvider(true);
  },
  /**
   * This is an embedding-only provider - no LLM support
   */
  createProvider: () => {
    throw new Error("Built-in provider does not support chat - it is an embedding-only provider");
  },
  /**
   * This is an embedding-only provider - no image generation
   */
  createImageProvider: () => {
    throw new Error("Built-in provider does not support image generation");
  },
  /**
   * Get available chat models
   *
   * This provider does not support chat, so returns empty array.
   */
  getAvailableModels: async () => {
    return [];
  },
  /**
   * Get embedding models
   *
   * Returns information about the TF-IDF embedding model.
   * Note: dimensions are not fixed - they depend on vocabulary size.
   */
  getEmbeddingModels: () => {
    return [
      {
        id: BUILTIN_MODEL_NAME,
        name: "TF-IDF with BM25",
        description: "Offline embedding model using TF-IDF with BM25 enhancement and Porter stemming. Dimensions vary based on vocabulary size (typically 1000-50000). Requires fitting on your document corpus."
      }
    ];
  },
  /**
   * Validate API key
   *
   * Built-in provider does not use API keys, always returns true.
   */
  validateApiKey: async () => {
    return true;
  },
  /**
   * Render the provider icon
   */
  renderIcon: (props) => {
    return BuiltinEmbeddingsIcon(props);
  },
  // No tool support needed for embedding provider
  formatTools: void 0,
  parseToolCalls: void 0,
  // No message format support needed
  messageFormat: void 0,
  // Runtime configuration not applicable
  charsPerToken: void 0,
  toolFormat: void 0,
  cheapModels: void 0,
  defaultContextWindow: void 0
};
var index_default = plugin;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BUILTIN_MODEL_NAME,
  BuiltinEmbeddingProvider,
  STOP_WORDS,
  TfIdfVectorizer,
  generateBigrams,
  plugin,
  stem,
  tokenize
});
