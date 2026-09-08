/**
 * Character progressions — the engine.
 *
 * Everything else in the feature is plumbing around the five functions here:
 * parse a character's `metadata.progressions`, derive one progression's state
 * against a clock, decide whether this turn should mention it, render the line
 * the character reads, and flatten the lot into the primitive sheet Pascal's
 * comparators already know how to read.
 *
 * ## The clock is the wall clock
 *
 * `nowMs` is `Date.now()`, injected everywhere so tests can hold it still. It
 * is deliberately NOT the chat's fictional timestamp: a progression belongs to
 * a character across every chat they sit in, while fictional time is per chat,
 * so a story clock would give the same pregnancy two different ages in two
 * rooms. The default wording prints no absolute dates, so a fictional-time
 * chat sees no contradiction between the Host's announced story date and the
 * progress report; `{{start}}` / `{{end}}` are documented as wall-clock.
 *
 * ## Month and year are fixed-length
 *
 * 30.436875 and 365.2425 days — the mean Gregorian month and year. Elapsed
 * time is then deterministic and calendar-free (no calendar library is a
 * dependency of this project, and "eight months along" does not need calendar
 * months). Documented in the help page so nobody is surprised that a
 * progression started on the 31st does not tick on the 31st.
 *
 * CLIENT-SAFE: pure, no logging, no I/O, no server imports. The Aurora editor
 * renders live report previews with it and Pascal's Workbench derives a mock
 * fact sheet with it, both in the browser. The one logging reader is
 * `prompt-section.ts`, which is server-side and passes an `onIssue` hook down.
 */

import {
  ProgressionSchema,
  PROGRESSION_ID_PATTERN,
  PROGRESSIONS_METADATA_KEY,
  MAX_PROGRESSIONS_PER_CHARACTER,
  parseIsoInstant,
  type Progression,
  type Progressions,
  type TimeIncrement,
} from './schema';

/** Milliseconds in one of each increment. Month and year are the mean Gregorian lengths. */
export const UNIT_MS: Record<TimeIncrement, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_629_746_000, // 30.436875 days
  year: 31_556_952_000, // 365.2425 days
};

/** The next finer unit a remainder is spoken in. `second` has none. */
const FINER_UNIT: Record<TimeIncrement, TimeIncrement | null> = {
  year: 'month',
  month: 'day',
  week: 'day',
  day: 'hour',
  hour: 'minute',
  minute: 'second',
  second: null,
};

/** The period suffixes the `<n><unit>` cadence grammar accepts. */
const PERIOD_UNIT_MS: Record<string, number> = {
  s: UNIT_MS.second,
  m: UNIT_MS.minute,
  h: UNIT_MS.hour,
  d: UNIT_MS.day,
  w: UNIT_MS.week,
};

/** Where a progression sits relative to its own span at a given instant. */
export type ProgressionState = 'pending' | 'active' | 'complete';

/** Everything computed from one progression and one instant. */
export interface DerivedProgression {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  nowMs: number;
  /** `clamp(now − start, 0, end − start)` — what has actually run. */
  elapsedMs: number;
  /** `end − now`, negative when overdue. Uncapped. */
  remainingMs: number;
  /** `(now − start) / (end − start) × 100`, UNCAPPED — this is what Pascal sees. */
  percent: number;
  /** The same, clamped to 0–100, for display. */
  percentClamped: number;
  state: ProgressionState;
  started: boolean;
  complete: boolean;
  /** `total × percentClamped / 100`, absent when the progression carries no quantity. */
  quantityCurrent?: number;
  /** Formatted spans, in `timeIncrement` plus one finer unit. */
  elapsed: string;
  elapsedWhole: string;
  remaining: string;
  remainingWhole: string;
}

/** Why `shouldReportProgression` decided the way it did. Logged verbatim. */
export type ReportReason =
  | 'first'
  | 'updated'
  | 'transition'
  | 'silenced'
  | 'turn'
  | 'increment'
  | 'period'
  | 'skip';

export interface ShouldReportResult {
  report: boolean;
  reason: ReportReason;
}

/** What `parseProgressions` reports about an entry it had to drop. */
export interface ProgressionIssue {
  id: string;
  issue: string;
}

/**
 * Read the reserved `progressions` key off a character's metadata.
 *
 * Total and fail-soft: a missing key, a key holding something other than an
 * object, an entry with a malformed id or a body the schema refuses — all of
 * those drop quietly through `onIssue` and the survivors are returned. A
 * broken entry must never hollow the character or fail a turn, so this never
 * throws and never returns `null`.
 *
 * Over-count is trimmed rather than rejected wholesale, for the same reason:
 * a 33rd progression should cost the user their 33rd progression, not their
 * other 32.
 */
export function parseProgressions(
  metadata: unknown,
  onIssue?: (id: string, issue: string) => void,
): Progressions {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return {};

  const raw = (metadata as Record<string, unknown>)[PROGRESSIONS_METADATA_KEY];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    if (raw !== undefined) onIssue?.('*', 'the progressions key does not hold an object');
    return {};
  }

  const parsed: Progressions = {};
  let kept = 0;

  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!PROGRESSION_ID_PATTERN.test(id)) {
      onIssue?.(id, 'the id is not a lowercase identifier (a-z, 0-9, _ and -, starting with a letter)');
      continue;
    }
    if (kept >= MAX_PROGRESSIONS_PER_CHARACTER) {
      onIssue?.(id, `over the ceiling of ${MAX_PROGRESSIONS_PER_CHARACTER} progressions per character`);
      continue;
    }
    const result = ProgressionSchema.safeParse(entry);
    if (!result.success) {
      onIssue?.(id, result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '));
      continue;
    }
    parsed[id] = result.data;
    kept += 1;
  }

  return parsed;
}

/**
 * Format a span as whole units of `unit` plus a remainder in the next finer
 * one — "20 weeks, 3 days", "2 minutes, 10 seconds", "45 seconds".
 *
 * The single home of that rule; every rendered span in the feature comes
 * through here. Negative input never reaches it (callers pass magnitudes), and
 * is defended against anyway by taking the absolute value. A span shorter than
 * one whole unit renders as "0 <units>" only when there is no finer unit to
 * spend it in — otherwise "0 minutes, 12 seconds" would be noise where
 * "12 seconds" is the answer.
 */
export function formatSpan(ms: number, unit: TimeIncrement): string {
  const magnitude = Number.isFinite(ms) ? Math.abs(ms) : 0;
  const unitMs = UNIT_MS[unit];
  const whole = Math.floor(magnitude / unitMs);
  const finer = FINER_UNIT[unit];

  if (finer === null) return plural(Math.floor(magnitude / unitMs), unit);

  const remainderMs = magnitude - whole * unitMs;
  const finerWhole = Math.floor(remainderMs / UNIT_MS[finer]);

  if (whole === 0 && finerWhole === 0) return plural(0, unit);
  if (whole === 0) return plural(finerWhole, finer);
  if (finerWhole === 0) return plural(whole, unit);
  return `${plural(whole, unit)}, ${plural(finerWhole, finer)}`;
}

/** Whole units of `unit` only — what `{{elapsedWhole}}` and `{{remainingWhole}}` render. */
export function formatSpanWhole(ms: number, unit: TimeIncrement): string {
  const magnitude = Number.isFinite(ms) ? Math.abs(ms) : 0;
  return plural(Math.floor(magnitude / UNIT_MS[unit]), unit);
}

function plural(count: number, unit: TimeIncrement): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * Derive one progression's state at an instant.
 *
 * `percent` is uncapped on purpose — Pascal tests it, and "118% of the way to
 * a due date" is a fact a tool may reasonably branch on. Display goes through
 * `percentClamped`. Before the start the spans mean something different from
 * during: `elapsed` is 0 and `remaining` counts down to the START, which is
 * exactly what the "begins in …" wording needs; after the end, `elapsed`
 * counts up from the END, which is what "3 days past due" needs.
 */
export function deriveProgression(id: string, p: Progression, nowMs: number): DerivedProgression {
  const startMs = parseIsoInstant(p.startTime);
  const endMs = parseIsoInstant(p.endTime);
  const spanMs = endMs - startMs;

  const started = nowMs >= startMs;
  const complete = nowMs >= endMs;
  const state: ProgressionState = complete ? 'complete' : started ? 'active' : 'pending';

  const elapsedMs = Math.min(Math.max(nowMs - startMs, 0), spanMs);
  const remainingMs = endMs - nowMs;

  const percent = spanMs > 0 ? ((nowMs - startMs) / spanMs) * 100 : 100;
  const percentClamped = Math.min(Math.max(percent, 0), 100);

  // What the rendered spans actually count, which differs by state: before the
  // start there is nothing elapsed and the countdown is to the start; after the
  // end the "elapsed" a report wants is the overrun.
  const elapsedForDisplay = state === 'complete' ? nowMs - endMs : elapsedMs;
  const remainingForDisplay = state === 'pending' ? startMs - nowMs : Math.max(remainingMs, 0);

  const unit = p.timeIncrement;

  return {
    id,
    name: p.name,
    startMs,
    endMs,
    nowMs,
    elapsedMs,
    remainingMs,
    percent,
    percentClamped,
    state,
    started,
    complete,
    ...(p.quantity ? { quantityCurrent: (p.quantity.total * percentClamped) / 100 } : {}),
    elapsed: formatSpan(elapsedForDisplay, unit),
    elapsedWhole: formatSpanWhole(elapsedForDisplay, unit),
    remaining: formatSpan(remainingForDisplay, unit),
    remainingWhole: formatSpanWhole(remainingForDisplay, unit),
  };
}

/** The state a progression was in at an arbitrary earlier instant. */
function stateAt(p: Progression, atMs: number): ProgressionState {
  const startMs = parseIsoInstant(p.startTime);
  const endMs = parseIsoInstant(p.endTime);
  if (atMs >= endMs) return 'complete';
  if (atMs >= startMs) return 'active';
  return 'pending';
}

/** Elapsed-into-span at an arbitrary instant, clamped the way `elapsedMs` is. */
function elapsedAt(p: Progression, atMs: number): number {
  const startMs = parseIsoInstant(p.startTime);
  const endMs = parseIsoInstant(p.endTime);
  return Math.min(Math.max(atMs - startMs, 0), endMs - startMs);
}

/** `<n><unit>` → period length in ms, or `null` when the string isn't one. */
export function parseReportPeriodMs(reportFrequency: string): number | null {
  const match = /^([1-9]\d{0,4})([smhdw])$/.exec(reportFrequency);
  if (!match) return null;
  return Number(match[1]) * PERIOD_UNIT_MS[match[2]];
}

/**
 * Decide whether THIS turn mentions this progression.
 *
 * The one input the caller supplies is `lastTurnMs`: the `createdAt` of the
 * responding character's own most recent visible assistant message in this
 * chat, or `null` if they have never spoken. Cadence is derived from history
 * rather than stored, exactly as Aurora's Core whisper derives its own — a
 * stored "last reported at" would be a write on every prompted turn for a
 * `turn`-cadence progression, would race the participant-JSON whole-column
 * replace, and could not be read back within a single job in the forked child.
 *
 * The known approximation, documented in the help page: a character who is
 * prompted but does not speak has no new own message, so a period-cadence
 * progression can be mentioned again on their next prompt inside the same
 * period. That is over-reporting by at most one turn per silent turn, and it
 * is the honest trade for zero writes.
 *
 * Rules in order; the first that applies wins.
 */
export function shouldReportProgression(
  p: Progression,
  d: DerivedProgression,
  lastTurnMs: number | null,
): ShouldReportResult {
  // 1. Never spoken here — say everything once, so an opener knows what she carries.
  if (lastTurnMs === null || !Number.isFinite(lastTurnMs)) return { report: true, reason: 'first' };

  // 2. A writer Quilltap controls touched this since the character last spoke.
  //    A re-armed cannon is announced immediately, cadence notwithstanding.
  const updatedAtMs = p.updatedAt === undefined ? NaN : parseIsoInstant(p.updatedAt);
  if (Number.isFinite(updatedAtMs) && updatedAtMs > lastTurnMs) return { report: true, reason: 'updated' };

  // 3. The span crossed one of its own boundaries since then. This is what
  //    makes `onComplete: 'once'` work without storing a flag: the completion
  //    turn is the one where the state flipped.
  if (stateAt(p, lastTurnMs) !== d.state) return { report: true, reason: 'transition' };

  // 4. Finished, already announced, and asked to go quiet afterwards.
  if (d.state === 'complete' && p.onComplete === 'once') return { report: false, reason: 'silenced' };

  if (p.reportFrequency === 'turn') return { report: true, reason: 'turn' };

  if (p.reportFrequency === 'increment') {
    const unitMs = UNIT_MS[p.timeIncrement];
    const ticked =
      Math.floor(elapsedAt(p, d.nowMs) / unitMs) !== Math.floor(elapsedAt(p, lastTurnMs) / unitMs);
    return ticked ? { report: true, reason: 'increment' } : { report: false, reason: 'skip' };
  }

  const periodMs = parseReportPeriodMs(p.reportFrequency);
  if (periodMs === null) {
    // The schema's regex admits nothing else, so this is unreachable from a
    // parsed progression; treat an impossible cadence as "every turn" rather
    // than silently muting a condition the user authored.
    return { report: true, reason: 'turn' };
  }

  // Epoch-anchored wall-clock buckets: `1h` means at most once per clock hour,
  // not "an hour since the last mention".
  const bucketed = Math.floor(d.nowMs / periodMs) !== Math.floor(lastTurnMs / periodMs);
  return bucketed ? { report: true, reason: 'period' } : { report: false, reason: 'skip' };
}

export interface RenderProgressionOptions {
  /** The chat's resolved timezone, for `{{start}}` / `{{end}}`. Undefined = the host's. */
  timezone?: string;
}

/**
 * Render the line the character reads.
 *
 * `reportTemplate` overrides the IN-PROGRESS wording only: the other two
 * states are short, fixed and structurally different ("begins in …",
 * "complete; … since it finished"), and an author's in-progress sentence would
 * read as nonsense in either.
 *
 * Substitution is Pascal's `renderTemplate` mechanics: a plain scan, no logic,
 * and an unknown placeholder left verbatim so the author can see which name
 * they got wrong rather than watching a hole open in the sentence.
 */
export function renderProgressionReport(
  p: Progression,
  d: DerivedProgression,
  opts: RenderProgressionOptions = {},
): string {
  const values = progressionPlaceholders(p, d, opts);

  if (d.state === 'pending') return `${p.name}: begins in ${d.remaining}.`;
  if (d.state === 'complete') return `${p.name}: complete; ${d.elapsed} since it finished.`;

  const template = p.reportTemplate ?? defaultInProgressTemplate(p);
  return substitute(template, values);
}

/**
 * The default in-progress wording, composed from the flags so a plain entry
 * reads well with nothing else set.
 */
export function defaultInProgressTemplate(p: Progression): string {
  const parts = ['{{name}}: {{elapsed}} elapsed, {{remaining}} remaining'];
  if (p.percentageReport) parts.push(', {{percent}}% complete');
  if (p.quantity) parts.push(' ({{quantity}})');
  const sentence = `${parts.join('')}.`;
  return p.description ? `${p.description} ${sentence}` : sentence;
}

/** Every placeholder a report template may name, already rendered to text. */
export function progressionPlaceholders(
  p: Progression,
  d: DerivedProgression,
  opts: RenderProgressionOptions = {},
): Record<string, string> {
  return {
    name: p.name,
    description: p.description ?? '',
    elapsed: d.elapsed,
    elapsedWhole: d.elapsedWhole,
    remaining: d.remaining,
    remainingWhole: d.remainingWhole,
    percent: String(Math.round(d.percentClamped)),
    quantity: p.quantity
      ? `${(d.quantityCurrent ?? 0).toFixed(p.quantity.precision)}/${p.quantity.total.toFixed(p.quantity.precision)} ${p.quantity.unit}`
      : '',
    start: formatInstant(d.startMs, p.timeIncrement, opts.timezone),
    end: formatInstant(d.endMs, p.timeIncrement, opts.timezone),
    increment: p.timeIncrement,
  };
}

/** Plain scan-and-replace; an unknown placeholder stays exactly as written. */
function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (whole, rawKey: string) => {
    const key = rawKey.trim();
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole;
  });
}

/**
 * Wall-clock date-time in the chat's resolved timezone — date only when the
 * increment is `day` or coarser, because a pregnancy's start does not want a
 * time of day attached to it.
 */
function formatInstant(ms: number, unit: TimeIncrement, timezone?: string): string {
  if (!Number.isFinite(ms)) return '';
  const dateOnly = unit === 'day' || unit === 'week' || unit === 'month' || unit === 'year';
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      ...(dateOnly ? {} : { timeStyle: 'short' }),
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(ms));
  } catch {
    // An unresolvable timezone must not sink a turn; fall back to the host's.
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      ...(dateOnly ? {} : { timeStyle: 'short' }),
    }).format(new Date(ms));
  }
}

/** The primitive value types a flattened progress sheet holds — Pascal's comparator vocabulary. */
export type ProgressPrimitive = number | string | boolean;

/**
 * Flatten every progression on a character into the sheet Pascal reads:
 * `"<id>.<field>"` → primitive. All primitives, so the existing fail-soft
 * comparison table applies unchanged and an absent id or field is simply a
 * comparator that does not hold.
 *
 * Times come out as **epoch milliseconds**, not ISO strings, so ordering
 * comparators and `{{now}} + 600000` arithmetic work on them.
 */
export function flattenProgressions(
  metadata: unknown,
  nowMs: number,
  onIssue?: (id: string, issue: string) => void,
): Record<string, ProgressPrimitive> {
  const sheet: Record<string, ProgressPrimitive> = {};

  for (const [id, p] of Object.entries(parseProgressions(metadata, onIssue))) {
    const d = deriveProgression(id, p, nowMs);
    sheet[`${id}.name`] = d.name;
    sheet[`${id}.percent`] = d.percent;
    sheet[`${id}.elapsedMs`] = d.elapsedMs;
    sheet[`${id}.remainingMs`] = d.remainingMs;
    sheet[`${id}.startTime`] = d.startMs;
    sheet[`${id}.endTime`] = d.endMs;
    sheet[`${id}.started`] = d.started;
    sheet[`${id}.complete`] = d.complete;
    sheet[`${id}.state`] = d.state;
    sheet[`${id}.elapsed`] = d.elapsed;
    sheet[`${id}.remaining`] = d.remaining;
    if (d.quantityCurrent !== undefined) sheet[`${id}.quantity`] = d.quantityCurrent;
  }

  return sheet;
}

/**
 * The increment a span of this length is best spoken in — used when a Pascal
 * effect creates a progression nobody pre-authored and there is no author to
 * ask. Thresholds chosen so the whole-unit part of a report is never zero and
 * never absurd: a ten-minute recharge speaks in minutes, a nine-month
 * gestation in months.
 */
export function inferIncrement(spanMs: number): TimeIncrement {
  const span = Math.abs(spanMs);
  if (span < 2 * UNIT_MS.minute) return 'second';
  if (span < 2 * UNIT_MS.hour) return 'minute';
  if (span < 2 * UNIT_MS.day) return 'hour';
  if (span < 2 * UNIT_MS.week) return 'day';
  if (span < 8 * UNIT_MS.week) return 'week';
  if (span < 2 * UNIT_MS.year) return 'month';
  return 'year';
}
