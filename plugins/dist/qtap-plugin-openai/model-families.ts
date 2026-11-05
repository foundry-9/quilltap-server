/**
 * OpenAI model-family rules.
 *
 * Every family decision the provider makes (which models the fetch lists,
 * which are reasoning models, which get 24h prompt-cache retention) is made
 * here from the model ID's family and version number, never from a list of
 * literal prefixes. A literal list goes stale the day OpenAI ships a new
 * generation: `['gpt-4', 'gpt-5']` silently dropped every gpt-6.x model from
 * the model fetch.
 */

export interface OpenAIModelFamily {
  /** 'gpt' for gpt-N, 'o' for the o-series (o1, o3, o4-mini, ...). */
  family: 'gpt' | 'o';
  major: number;
  /** Minor version when the ID carries one (gpt-5.2 → 2), else undefined. */
  minor?: number;
  /** The lower-cased ID. */
  id: string;
}

const GPT_RE = /^gpt-(\d+)(?:\.(\d+))?(?![\d.])/;
const O_SERIES_RE = /^o(\d+)(?![\d.])/;

/**
 * Parse a model ID into its family and version. Returns null for anything
 * that is not a versioned GPT or o-series chat model (gpt-image-1,
 * gpt-realtime, text-embedding-3-small, dall-e-3, ...).
 */
export function parseOpenAIModelFamily(model: string): OpenAIModelFamily | null {
  const id = (model ?? '').toLowerCase();
  const gpt = GPT_RE.exec(id);
  if (gpt) {
    return {
      family: 'gpt',
      major: Number(gpt[1]),
      minor: gpt[2] !== undefined ? Number(gpt[2]) : undefined,
      id,
    };
  }
  const o = O_SERIES_RE.exec(id);
  if (o) {
    return { family: 'o', major: Number(o[1]), id };
  }
  return null;
}

/** Oldest GPT generation the Responses-API chat path supports. */
const MIN_CHAT_GPT_MAJOR = 4;
/** First GPT generation that is a reasoning model (no temperature/top_p). */
const FIRST_REASONING_GPT_MAJOR = 5;
/** First GPT generation assumed to support 24h prompt-cache retention throughout. */
const FIRST_RETENTION_GPT_MAJOR = 6;
/** gpt-5 minors documented to support 24h retention (gpt-5.3-chat-latest does not). */
const GPT5_RETENTION_MINORS = new Set([1, 2, 5]);

/**
 * Is this a chat model the model fetch should list? Any GPT generation from
 * 4 on and every o-series model. gpt-3.5 and the unversioned families
 * (gpt-image, gpt-realtime, embeddings, ...) are left out.
 */
export function isOpenAIChatModel(model: string): boolean {
  const parsed = parseOpenAIModelFamily(model);
  if (!parsed) return false;
  return parsed.family === 'o' || parsed.major >= MIN_CHAT_GPT_MAJOR;
}

/**
 * Reasoning models reject temperature, top_p and the other sampling
 * parameters. Every o-series model and every GPT from 5 on is one.
 * See: https://platform.openai.com/docs/guides/reasoning
 */
export function isOpenAIReasoningModel(model: string): boolean {
  const parsed = parseOpenAIModelFamily(model);
  if (!parsed) return false;
  return parsed.family === 'o' || parsed.major >= FIRST_REASONING_GPT_MAJOR;
}

/**
 * Does this model accept `prompt_cache_retention: '24h'`? The documented gpt-5
 * minors (5.1, 5.2, 5.5), and every later generation except the
 * `-chat-latest` aliases, which OpenAI has so far left out (gpt-5.3-chat-latest).
 * A later model that turns out not to accept it is caught by the provider's
 * retry without retention, so a wrong guess costs one round trip, not a turn.
 */
export function supportsOpenAIExtendedCacheRetention(model: string): boolean {
  const parsed = parseOpenAIModelFamily(model);
  if (!parsed || parsed.family !== 'gpt') return false;
  if (parsed.major === 5) {
    return parsed.minor !== undefined && GPT5_RETENTION_MINORS.has(parsed.minor);
  }
  return parsed.major >= FIRST_RETENTION_GPT_MAJOR && !parsed.id.includes('chat-latest');
}

/**
 * Did the API reject the request because of `prompt_cache_retention`? Used to
 * retry once without it.
 */
export function isCacheRetentionRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  if (status !== undefined && status !== 400) return false;
  const message = error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? '');
  const param = (error as { param?: unknown }).param;
  return param === 'prompt_cache_retention' || /prompt_cache_retention/i.test(message);
}
