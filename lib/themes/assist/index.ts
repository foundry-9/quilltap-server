/**
 * Calliope's references and proposals (Calliope Live, Spec J, Stage 0).
 *
 * - `./styled-by.ts` — what the app's stylesheets set on each hook (a
 *   generated table, `./styled-by-build.ts`);
 * - `./change-set.ts` — a proposal's shape, and the one place it is applied
 *   and described (browser-safe);
 * - `./judge.ts` — what a proposal introduces and removes (server-side);
 * - `./proposal.ts` — a change set judged for a draft: offered or refused,
 *   and what each side hears of it;
 * - `./render.ts` — the one place the draft, tokens and hooks are rendered as
 *   text for a model.
 *
 * Server entry: everything. Browser code imports `./change-set` and
 * `./styled-by` directly (the judge pulls PostCSS and the icon registry; the
 * renderer the hook catalogue, which reaches the logger).
 *
 * @module themes/assist
 */

export * from './styled-by';
export * from './change-set';
export * from './judge';
export * from './render';
export * from './proposal';
