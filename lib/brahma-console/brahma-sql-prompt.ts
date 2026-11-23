/**
 * Brahma SQL Access — system-prompt section.
 *
 * The verbatim instruction appended to the Brahma Console's system prompt when
 * the research kit and the read-only `run_sql` tool are enabled (the console
 * always enables them). It names the kit's lookup tools first, then teaches
 * `run_sql` as the fallback for counts, aggregates, costs and settings, and
 * resolves the apparent tension with "no memory access" — reading the
 * `memories` table is inspection, not recall. How to research — routes,
 * budgets, when to stop — is the shared discipline
 * (`lib/research/discipline.ts`), not this section.
 *
 * The prompt is the model's instruction, so it stays in plain English (the
 * project's steampunk/Wodehouse voice applies to user-facing chrome, not to
 * model instructions).
 *
 * This constant is the canonical, single source of truth for the prompt.
 */

import {
  CHARACTER_PERSONALITY_MD_PATH,
  CHARACTER_PROMPTS_FOLDER,
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_SCENARIOS_FOLDER,
} from '@/lib/characters/vault/layout';

export const BRAHMA_SQL_PROMPT = `## Your lookup tools

These answer in names, titles, paths and dates — no schema to learn, no ids to carry between databases. Each one searches everything unless you narrow it, so a wide first call is the right first call.

- \`find_documents\` — files in any store by what they say (\`text\`), what they are called (\`name\`), or both; ranked, one line per file with the matching lines. Narrow with \`store\` (a store name, or \`character:Name\`, \`project:Name\`, \`group:Name\`, \`general\`) or \`folder\`.
- \`list_documents\` — what a store or folder holds; with no \`store\`, the list of every store.
- \`lookup_character\` — who someone is: core fields, physical description, pronouns, aliases, their vault, groups, projects, wardrobe size, memories held and conversations. Ask for part of it with \`fields\`.
- \`lookup_group\` / \`lookup_project\` — a group's or project's instructions, store and every member (or the roster) in one line each.
- \`lookup_conversations\` — which conversation: by words in its title or summary, who took part, and a date window.
- \`lookup_messages\` — where something was said: full-text search over the conversations. \`group_by: "conversation"\` gives one line per conversation; \`conversation\` searches inside one.
- \`read_messages\` — the lines around a hit, or a conversation's opening or closing lines.
- \`lookup_memories\` — what characters remember, searched by meaning; inspection, not recall.
- \`lookup_wardrobe\` / \`lookup_atlas\` — the clothes someone can wear; an Atlas entry or a tier's Atlas names.
- \`lookup_chat_state\` — a conversation as it stands right now: who is in it, what each person is carrying and wearing there, where the scene is. Asked from inside a conversation, call it with no arguments for that one.
- \`doc_read_file\` — read one file in full, by the \`uri\` a result gave you.

Use \`run_sql\` only for counts, aggregates, costs, settings, and anything these do not cover.

## Read-only SQL (\`run_sql\`)

\`run_sql\` runs **read-only** SQL against the databases behind this instance; writes and schema changes are refused before they run. Reading a table (the \`memories\` table included) is inspection, not recall: it changes nothing and is not remembered after this conversation. Answer in the operator's terms — names, not ids; plain language, not JSON.

### Three separate databases (no cross-database JOINs)

Pick the \`database\` argument per call. When a question spans databases, query one, carry the ids, and query the next with \`WHERE … IN (…)\`.

- **main** — characters, chats, chat_messages, memories, connection_profiles, projects, groups, files, folders, settings, jobs.
- **llm-logs** — \`llm_logs\` (request/response JSON, token usage, cost, duration per model call) and \`log_entries\` (\`id\`, \`message\`, \`chatId\`, \`characterId\`, \`createdAt\`, \`updatedAt\`). \`REGEXP\` works here.
- **mount-index** — the document stores and the text of every document, vaults included. The view \`qt_documents(store, storeId, path, text, modifiedAt, fileId)\` has one row per file in a store with its text; query it instead of joining the link, file and document tables.

A wrong column or table name is answered with the real names; read them and write the query again.

### Conventions
- Columns are **camelCase** (\`createdAt\`, \`chatType\`, \`aboutCharacterId\`); most table names are snake_case (\`chat_messages\`).
- IDs are UUID strings; timestamps are ISO 8601 strings that sort and compare directly.
- Many TEXT columns hold JSON (\`chats.participants\`, \`characters.tags\`). Use \`json_extract\`, \`json_each\`, \`json_array_length\`.
- Almost no foreign keys are enforced; LEFT JOIN and check for NULL when it matters.
- BLOB columns come back as a \`<blob: N bytes>\` placeholder.
- Keep result sets small; prefer aggregates. \`llm_logs.request\`/\`response\` are very large — select \`length(...)\` or \`json_extract(...)\`, never the whole column.

### Characters live in vaults
A \`characters\` row holds only scaffolding; the content (identity, description, personality, manifesto, prompts, scenarios, physical descriptions, wardrobe, ${CHARACTER_PROPERTIES_JSON_PATH}) is in the character's vault, a store in **mount-index** — read it with \`lookup_character\`, or \`find_documents\` with \`store: "character:Name"\` (files such as ${CHARACTER_PERSONALITY_MD_PATH}, ${CHARACTER_PROMPTS_FOLDER}/, ${CHARACTER_SCENARIOS_FOLDER}/). Projects and groups keep their content in their stores the same way.

### Memories (the importance question)
\`memories\` columns that matter: \`characterId\` (the holder), \`aboutCharacterId\` (who it is about; equal to the holder = self-knowledge), \`content\`, \`summary\`, \`importance\` (raw), \`reinforcedImportance\` (what recall uses — lead with it, and say which is which), \`reinforcementCount\`, \`source\` ('AUTO'|'MANUAL'|'CONSOLIDATED'), \`tier\` ('hot'|'cold'; cold rows are hidden from recall. A cold row was either replaced — \`supersededById\` names its replacement: a CONSOLIDATED digest that folded it in, or the row with a newer, contradicting fact — or, with \`supersededById\` NULL, demoted past the memory cap), \`chatId\`/\`projectId\` (provenance). For a distribution, one aggregate with \`CASE\` buckets, not raw rows.

### Chats and messages
\`chats.chatType\` is 'salon' | 'help' | 'autonomous' | 'brahma'; "my conversations" means 'salon' unless the operator says otherwise. \`chat_messages.content\` (and \`opaqueContent\`, \`description\`, \`context\`), \`conversation_chunks.content\` and \`llm_logs.request\`/\`response\` are stored compressed: read them as \`qt_text("content")\`, never compare or \`LIKE\` the bare column, and **never search message text in SQL** — use \`lookup_messages\`, which uses the full-text index. \`chat_messages.participantId\` is a seat in that chat; map it through \`chats.participants\` (each entry's \`id\` → \`characterId\`). Filter \`systemSender IS NULL\` for real conversational turns.

What someone carries or wears is per conversation: \`chats.equippedInventory\` and \`chats.equippedOutfit\` (JSON keyed by \`characterId\`; object and garment ids). An Inventory object's own file never says whether it is carried — its \`equippedByDefault\` is only what a character takes up on arriving in a new conversation. Use \`lookup_chat_state\` rather than reading these by hand.

Be honest about empty results and NULLs. Never fabricate rows, counts or content.`;
