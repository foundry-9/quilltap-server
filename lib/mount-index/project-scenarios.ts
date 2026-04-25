/**
 * Project Scenarios — read/write helpers for the per-project `Scenarios/`
 * folder that lives inside each project's official document store.
 *
 * Each scenario is a plain markdown file with optional YAML frontmatter:
 *
 *   ---
 *   name: Optional Display Name        # overrides filename (without .md) as the title
 *   description: Optional subtitle      # one-line summary shown in the new-chat dropdown
 *   isDefault: true                     # marks this as the project default (one wins)
 *   ---
 *   <body — the scenario content delivered to the LLM>
 *
 * Frontmatter is parsed via `lib/doc-edit/markdown-parser.ts`. The same
 * key conventions (`name`, `isDefault`) match `Prompts/*.md` in character
 * vaults, and the additive frontmatter handling matches the refactored
 * `parseScenarioFile` in `character-properties-overlay.ts`.
 *
 * All scenarios live at `Scenarios/<filename>.md` directly under the
 * official store's root — nested paths under Scenarios/ are ignored.
 *
 * Default-conflict semantics: if multiple files set `isDefault: true`,
 * the alphabetically-first filename wins. The losers have their `isDefault`
 * reported as false in the API response; the file frontmatter on disk is
 * NOT auto-rewritten (the surfaced warning lets the user fix it).
 *
 * @module mount-index/project-scenarios
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import {
  readDatabaseDocument,
  writeDatabaseDocument,
} from '@/lib/mount-index/database-store';
import {
  parseFrontmatter,
  updateFrontmatterInContent,
} from '@/lib/doc-edit/markdown-parser';
import type { DocMountDocument } from '@/lib/schemas/mount-index.types';

export const PROJECT_SCENARIOS_FOLDER = 'Scenarios';

export interface ParsedProjectScenario {
  /** Relative path inside the mount point, e.g. `Scenarios/welcome.md`. */
  path: string;
  /** Filename inside `Scenarios/`, without the `.md` extension. */
  filename: string;
  /** Display title — frontmatter `name` if present, else filename. */
  name: string;
  /** Optional one-line description from frontmatter, never includes the body. */
  description?: string;
  /** True when this scenario is the effective project default after conflict resolution. */
  isDefault: boolean;
  /** True when the file's frontmatter set `isDefault: true`, regardless of conflict resolution. */
  rawIsDefault: boolean;
  /** Scenario body — content after frontmatter, trimmed. */
  body: string;
  /** Raw `lastModified` from the underlying doc row. */
  lastModified: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListProjectScenariosResult {
  scenarios: ParsedProjectScenario[];
  /** Soft warnings — e.g. multiple files marked isDefault: true. */
  warnings: string[];
}

/**
 * Idempotent: ensure the `Scenarios/` folder exists in the given mount point.
 * Returns the folder ID. Wraps `ensureFolderPath` for symmetry with
 * `ensureProjectOfficialStore`.
 */
export async function ensureProjectScenariosFolder(
  mountPointId: string,
): Promise<{ folderId: string | null }> {
  const folderId = await ensureFolderPath(mountPointId, PROJECT_SCENARIOS_FOLDER);
  return { folderId };
}

/**
 * Parse a single Scenarios/*.md file. Returns null if the file has no usable
 * body (empty bodies are skipped — same rule as character-vault scenarios).
 *
 * `rawIsDefault` reflects the file's own frontmatter; `isDefault` is set by
 * the caller after conflict resolution.
 */
function parseProjectScenario(doc: DocMountDocument): ParsedProjectScenario | null {
  const content = doc.content;
  const parsed = parseFrontmatter(content);

  let frontmatterName: string | undefined;
  let frontmatterDescription: string | undefined;
  let rawIsDefault = false;
  if (parsed.data) {
    if (typeof parsed.data.name === 'string' && parsed.data.name.trim().length > 0) {
      frontmatterName = parsed.data.name.trim();
    }
    if (typeof parsed.data.description === 'string' && parsed.data.description.trim().length > 0) {
      frontmatterDescription = parsed.data.description.trim().slice(0, 500);
    }
    rawIsDefault = parsed.data.isDefault === true;
  }

  // Body = everything after the frontmatter block. We do NOT strip the first
  // `# heading` here (unlike character-vault scenarios) — project scenarios
  // are authored via the Lexical editor in project settings, where the title
  // is a separate field stored in frontmatter, not a leading heading.
  const body = content.slice(parsed.bodyStartOffset).trim();

  if (body.length === 0) {
    logger.warn('Project scenario file body is empty; skipping', {
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }

  // Filename without extension — `Scenarios/welcome.md` → `welcome`.
  const fileNameNoExt = doc.fileName.replace(/\.md$/i, '');

  return {
    path: doc.relativePath,
    filename: fileNameNoExt,
    name: (frontmatterName ?? fileNameNoExt).slice(0, 200),
    ...(frontmatterDescription !== undefined && { description: frontmatterDescription }),
    isDefault: rawIsDefault,
    rawIsDefault,
    body,
    lastModified: doc.lastModified,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * List all `Scenarios/*.md` files in a project's official store, parsed and
 * sorted alphabetically by path. If multiple files have `isDefault: true` in
 * their frontmatter, the alphabetically-first one wins; the others are
 * reported as `isDefault: false` and a warning naming the offenders is
 * included in the result.
 *
 * Files at nested paths under Scenarios/ are excluded (top-level only).
 * Files with empty bodies are dropped silently with a logged warning.
 */
export async function listProjectScenarios(
  mountPointId: string,
): Promise<ListProjectScenariosResult> {
  const repos = getRepositories();

  const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    PROJECT_SCENARIOS_FOLDER,
    '.md',
  );

  // Sort alphabetically by relativePath BEFORE parsing so default-conflict
  // resolution is stable.
  docs.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const parsed: ParsedProjectScenario[] = [];
  for (const doc of docs) {
    const scenario = parseProjectScenario(doc);
    if (scenario) parsed.push(scenario);
  }

  // Resolve default conflict: keep the first file that claimed isDefault,
  // demote any subsequent ones in the API view.
  const warnings: string[] = [];
  let defaultClaimed = false;
  const offenders: string[] = [];
  for (const scenario of parsed) {
    if (scenario.rawIsDefault) {
      if (!defaultClaimed) {
        defaultClaimed = true;
        scenario.isDefault = true;
      } else {
        scenario.isDefault = false;
        offenders.push(scenario.filename);
      }
    }
  }
  if (offenders.length > 0) {
    const winner = parsed.find(s => s.isDefault)?.filename ?? '<none>';
    warnings.push(
      `Multiple scenarios mark themselves as default; using "${winner}". ` +
      `These are also marked default but are being ignored: ${offenders.map(o => `"${o}"`).join(', ')}.`,
    );
    logger.warn('Project scenarios: multiple isDefault: true entries', {
      mountPointId,
      winner,
      offenders,
    });
  }

  return { scenarios: parsed, warnings };
}

/**
 * Read a single scenario by relative path and return its parsed shape. The
 * `isDefault` field reflects ONLY the file's own frontmatter — does not
 * cross-reference siblings.
 */
export async function readProjectScenario(
  mountPointId: string,
  relativePath: string,
): Promise<ParsedProjectScenario | null> {
  const repos = getRepositories();
  const doc = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, relativePath);
  if (!doc) return null;
  return parseProjectScenario(doc);
}

/**
 * Resolve a project scenario's body by `Scenarios/<filename>.md` path.
 * Used by the chat creation API to bake the scenario into `chat.scenarioText`.
 * Returns null when the file is missing or has no usable body.
 */
export async function resolveProjectScenarioBody(
  mountPointId: string,
  scenarioPath: string,
): Promise<string | null> {
  // Accept both `Scenarios/foo.md` and `foo.md` and `foo` for client convenience.
  let normalised = scenarioPath.trim();
  if (!normalised.startsWith(`${PROJECT_SCENARIOS_FOLDER}/`)) {
    normalised = `${PROJECT_SCENARIOS_FOLDER}/${normalised.replace(/^\/+/, '')}`;
  }
  if (!/\.md$/i.test(normalised)) {
    normalised = `${normalised}.md`;
  }

  try {
    const { content } = await readDatabaseDocument(mountPointId, normalised);
    const parsed = parseFrontmatter(content);
    const body = content.slice(parsed.bodyStartOffset).trim();
    return body.length > 0 ? body : null;
  } catch (error) {
    logger.warn('Failed to resolve project scenario body', {
      mountPointId,
      scenarioPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Set a single file as the project default. Sequenced multi-file write:
 *   1. Set `isDefault: true` on the chosen file.
 *   2. Demote any other files that had `isDefault: true` to `isDefault: false`.
 *
 * No transaction — partial failure leaves the alphabetical-tiebreaker rule
 * to handle the consequence (a soft warning surfaces to the user).
 */
export async function setProjectScenarioDefault(
  mountPointId: string,
  defaultPath: string,
): Promise<void> {
  const repos = getRepositories();
  const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    PROJECT_SCENARIOS_FOLDER,
    '.md',
  );

  let chosenFound = false;

  // Promote the chosen file.
  for (const doc of docs) {
    if (doc.relativePath === defaultPath) {
      const updated = updateFrontmatterInContent(doc.content, { isDefault: true });
      if (updated !== doc.content) {
        await writeDatabaseDocument(mountPointId, doc.relativePath, updated);
      }
      chosenFound = true;
      break;
    }
  }

  if (!chosenFound) {
    throw new Error(`Cannot set default — scenario not found: ${defaultPath}`);
  }

  // Demote everyone else that previously claimed default.
  for (const doc of docs) {
    if (doc.relativePath === defaultPath) continue;
    const parsed = parseFrontmatter(doc.content);
    if (parsed.data?.isDefault === true) {
      const updated = updateFrontmatterInContent(doc.content, { isDefault: false });
      if (updated !== doc.content) {
        try {
          await writeDatabaseDocument(mountPointId, doc.relativePath, updated);
        } catch (error) {
          logger.warn('Failed to demote a previously-default project scenario; alphabetical tiebreaker will compensate', {
            mountPointId,
            relativePath: doc.relativePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }
}
