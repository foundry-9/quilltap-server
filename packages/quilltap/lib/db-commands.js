'use strict';

const { openMainDb, openLlmLogsDb, openMountIndexDb } = require('./db-helpers');

// Tables grouped by domain for `db schema` (with-no-arg) overview, and for
// DB-routing when a verb names a specific table. Keep this list short — it's
// a cheat-sheet, not an exhaustive catalogue.
const DB_DOMAINS = {
  main: {
    'Characters & memory': ['characters', 'wardrobe_items', 'character_plugin_data', 'memories'],
    'Chats & messages': ['chats', 'chat_messages', 'chat_settings', 'chat_documents', 'terminal_sessions'],
    'Projects & files': ['projects', 'files', 'folders'],
    'Connections & templates': ['connection_profiles', 'prompt_templates', 'roleplay_templates'],
    'System': ['background_jobs', 'migrations_state', 'instance_settings', 'users'],
  },
  logs: {
    'LLM logs': ['llm_logs'],
  },
  mount: {
    'Document mount index': [
      'doc_mount_points', 'doc_mount_folders', 'doc_mount_files',
      'doc_mount_documents', 'doc_mount_chunks', 'doc_mount_blobs',
      'doc_mount_file_links', 'project_doc_mount_links',
    ],
  },
};

// Lookup: table name → which DB it lives in
const TABLE_DB = (() => {
  const m = {};
  for (const [db, groups] of Object.entries(DB_DOMAINS)) {
    for (const tables of Object.values(groups)) {
      for (const t of tables) m[t] = db;
    }
  }
  return m;
})();

// GitHub heading anchors: lowercase, spaces → dashes, most punctuation dropped.
// Underscores are preserved, so `### chat_messages` → `#chat_messages`.
function ddlAnchor(tableName) {
  return `docs/developer/DDL.md#${tableName.toLowerCase()}`;
}

// ---------- arg parsing ----------

function parseSubArgs(args) {
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positional.push(a);
    }
    i++;
  }
  return { flags, positional };
}

function asInt(v, dflt) {
  if (v === undefined || v === true) return dflt;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

function asBool(v) {
  return v === true || v === 'true' || v === '1';
}

// ---------- output ----------

function printTable(rows) {
  if (!rows || rows.length === 0) {
    console.log('(no results)');
    return;
  }
  console.table(rows);
}

function printJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function truncate(s, n) {
  if (s == null) return '';
  const str = String(s);
  if (str.length <= n) return str;
  return str.slice(0, n) + `… (+${str.length - n} chars)`;
}

function printRecord(label, row) {
  console.log(`── ${label} ──`);
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    if (typeof v === 'string' && v.length > 80) {
      console.log(`  ${k}:`);
      for (const line of v.split('\n')) console.log(`    ${line}`);
    } else {
      console.log(`  ${k}: ${v}`);
    }
  }
}

// ---------- name resolution ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveCharacter(db, query) {
  if (UUID_RE.test(query)) {
    const row = db.prepare('SELECT id, name, aliases FROM characters WHERE id = ?').get(query);
    if (!row) throw new Error(`No character with id ${query}`);
    return row;
  }
  const exact = db.prepare(
    'SELECT id, name, aliases FROM characters WHERE LOWER(name) = LOWER(?)'
  ).all(query);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw ambiguous('character', exact);
  }
  const fuzzy = db.prepare(
    'SELECT id, name, aliases FROM characters WHERE LOWER(name) LIKE LOWER(?) OR LOWER(aliases) LIKE LOWER(?) ORDER BY name'
  ).all(`%${query}%`, `%${query}%`);
  if (fuzzy.length === 0) throw new Error(`No character matching '${query}'`);
  if (fuzzy.length > 1) throw ambiguous('character', fuzzy);
  return fuzzy[0];
}

function resolveChat(db, query) {
  if (UUID_RE.test(query)) {
    const row = db.prepare('SELECT id, title, chatType, projectId FROM chats WHERE id = ?').get(query);
    if (!row) throw new Error(`No chat with id ${query}`);
    return row;
  }
  const fuzzy = db.prepare(
    "SELECT id, title, chatType, projectId, lastMessageAt FROM chats WHERE LOWER(title) LIKE LOWER(?) ORDER BY lastMessageAt DESC"
  ).all(`%${query}%`);
  if (fuzzy.length === 0) throw new Error(`No chat matching '${query}'`);
  if (fuzzy.length > 1) throw ambiguous('chat', fuzzy);
  return fuzzy[0];
}

function resolveProject(db, query) {
  if (UUID_RE.test(query)) {
    const row = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(query);
    if (!row) throw new Error(`No project with id ${query}`);
    return row;
  }
  const fuzzy = db.prepare(
    'SELECT id, name FROM projects WHERE LOWER(name) LIKE LOWER(?) ORDER BY name'
  ).all(`%${query}%`);
  if (fuzzy.length === 0) throw new Error(`No project matching '${query}'`);
  if (fuzzy.length > 1) throw ambiguous('project', fuzzy);
  return fuzzy[0];
}

function ambiguous(kind, rows) {
  const list = rows.slice(0, 10).map(r => `  ${r.id}  ${r.name || r.title || ''}`).join('\n');
  const more = rows.length > 10 ? `\n  … and ${rows.length - 10} more` : '';
  const err = new Error(`Multiple ${kind}s match. Use a UUID or a more specific name:\n${list}${more}`);
  err.ambiguous = true;
  return err;
}

// ---------- verb: schema ----------

function cmdSchema(args, ctx) {
  const { flags, positional } = parseSubArgs(args);
  const json = asBool(flags.json);

  if (flags.grep) {
    return schemaGrep(String(flags.grep), { json, ctx });
  }

  const table = positional[0];
  if (!table) {
    return schemaOverview({ json, ctx });
  }
  return schemaForTable(table, { json, ctx });
}

function getAllTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
}

function getTableInfo(db, table) {
  return db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all();
}

function getForeignKeys(db, table) {
  return db.prepare(`PRAGMA foreign_key_list("${table.replace(/"/g, '""')}")`).all();
}

function getIndexes(db, table) {
  return db.prepare(`PRAGMA index_list("${table.replace(/"/g, '""')}")`).all();
}

function openDbForTable(ctx, table) {
  const which = TABLE_DB[table] || 'main';
  if (which === 'logs') return { db: ctx.openLogs(), which };
  if (which === 'mount') return { db: ctx.openMounts(), which };
  return { db: ctx.openMain(), which };
}

function schemaForTable(table, { json, ctx }) {
  // Try main first, fall back to other DBs if not found
  const order = (TABLE_DB[table] === 'logs') ? ['logs', 'main', 'mount']
    : (TABLE_DB[table] === 'mount') ? ['mount', 'main', 'logs']
    : ['main', 'logs', 'mount'];

  for (const which of order) {
    const opener = which === 'logs' ? ctx.openLogs : which === 'mount' ? ctx.openMounts : ctx.openMain;
    let db;
    try { db = opener(); } catch { continue; }
    try {
      const tables = new Set(getAllTables(db));
      if (!tables.has(table)) continue;
      const cols = getTableInfo(db, table);
      const fks = getForeignKeys(db, table);
      const idxs = getIndexes(db, table);

      if (json) {
        printJson({ database: which, table, columns: cols, foreignKeys: fks, indexes: idxs });
        return;
      }

      console.log(`Table: ${table}  (database: ${which})`);
      console.log('');
      console.log('Columns:');
      const rows = cols.map(c => ({
        name: c.name,
        type: c.type,
        notNull: c.notnull ? 'NOT NULL' : '',
        default: c.dflt_value === null ? '' : c.dflt_value,
        pk: c.pk ? `pk${c.pk > 1 ? '(' + c.pk + ')' : ''}` : '',
      }));
      console.table(rows);
      if (fks.length) {
        console.log('Foreign keys:');
        console.table(fks.map(f => ({ from: f.from, to: `${f.table}.${f.to}`, onDelete: f.on_delete, onUpdate: f.on_update })));
      }
      if (idxs.length) {
        console.log('Indexes:');
        for (const idx of idxs) {
          const cols = db.prepare(`PRAGMA index_info("${idx.name.replace(/"/g, '""')}")`).all().map(c => c.name).join(', ');
          console.log(`  ${idx.unique ? 'UNIQUE ' : ''}${idx.name} (${cols})`);
        }
      }
      console.log('');
      console.log(`→ ${ddlAnchor(table)}`);
      return;
    } finally {
      try { db.close(); } catch {}
    }
  }
  throw new Error(`Table '${table}' not found in any database.`);
}

function schemaOverview({ json, ctx }) {
  const out = {};
  for (const [which, opener] of [['main', ctx.openMain], ['logs', ctx.openLogs], ['mount', ctx.openMounts]]) {
    let db;
    try { db = opener(); } catch { continue; }
    try {
      out[which] = getAllTables(db);
    } finally {
      try { db.close(); } catch {}
    }
  }

  if (json) {
    printJson({ databases: out, domains: DB_DOMAINS });
    return;
  }

  for (const [whichDb, groups] of Object.entries(DB_DOMAINS)) {
    if (!out[whichDb]) continue;
    const present = new Set(out[whichDb]);
    console.log(`── ${whichDb} database (${out[whichDb].length} tables) ──`);
    for (const [groupName, tables] of Object.entries(groups)) {
      const hits = tables.filter(t => present.has(t));
      if (hits.length === 0) continue;
      console.log(`  ${groupName}:`);
      for (const t of hits) console.log(`    ${t}`);
    }
    const grouped = new Set(Object.values(groups).flat());
    const ungrouped = out[whichDb].filter(t => !grouped.has(t) && !t.startsWith('sqlite_'));
    if (ungrouped.length) {
      console.log('  Other:');
      for (const t of ungrouped) console.log(`    ${t}`);
    }
    console.log('');
  }
  console.log("Use `quilltap db schema <table>` for column details, or `quilltap db schema --grep <text>` to search.");
}

function schemaGrep(needle, { json, ctx }) {
  const lc = needle.toLowerCase();
  const matches = [];
  for (const [which, opener] of [['main', ctx.openMain], ['logs', ctx.openLogs], ['mount', ctx.openMounts]]) {
    let db;
    try { db = opener(); } catch { continue; }
    try {
      const tables = getAllTables(db);
      for (const t of tables) {
        const tableHit = t.toLowerCase().includes(lc);
        const cols = getTableInfo(db, t);
        const colHits = cols.filter(c => c.name.toLowerCase().includes(lc));
        if (tableHit || colHits.length) {
          matches.push({
            database: which,
            table: t,
            tableMatch: tableHit,
            columns: tableHit && colHits.length === 0 ? cols.map(c => c.name) : colHits.map(c => c.name),
          });
        }
      }
    } finally {
      try { db.close(); } catch {}
    }
  }

  if (json) { printJson({ query: needle, matches }); return; }

  if (matches.length === 0) {
    console.log(`No tables or columns matching '${needle}'.`);
    return;
  }
  for (const m of matches) {
    const flag = m.tableMatch ? '*' : ' ';
    console.log(`${flag} ${m.database}: ${m.table}`);
    for (const c of m.columns) console.log(`      .${c}`);
  }
  console.log('');
  console.log('(* = table name matched; columns shown are matched columns, or all columns if the whole table matched)');
}

// ---------- verb: find ----------

function cmdFind(args, ctx) {
  const [kind, ...rest] = args;
  if (!kind) throw new Error('Usage: quilltap db find <character|chat|project> [query]');
  const { flags, positional } = parseSubArgs(rest);
  const json = asBool(flags.json);
  const limit = asInt(flags.limit, 50);
  const query = positional.join(' ');

  if (kind === 'character') return findCharacters(query, { json, limit, ctx });
  if (kind === 'chat') return findChats(query, { json, limit, ctx });
  if (kind === 'project') return findProjects(query, { json, limit, ctx });
  throw new Error(`Unknown find kind: ${kind}. Try character|chat|project.`);
}

function findCharacters(query, { json, limit, ctx }) {
  const db = ctx.openMain();
  try {
    let rows;
    if (!query) {
      rows = db.prepare('SELECT id, name, npc, isFavorite, controlledBy FROM characters ORDER BY name LIMIT ?').all(limit);
    } else if (UUID_RE.test(query)) {
      rows = db.prepare('SELECT id, name, npc, isFavorite, controlledBy, aliases FROM characters WHERE id = ?').all(query);
    } else {
      rows = db.prepare(
        'SELECT id, name, npc, isFavorite, controlledBy, aliases FROM characters WHERE LOWER(name) LIKE LOWER(?) OR LOWER(aliases) LIKE LOWER(?) ORDER BY name LIMIT ?'
      ).all(`%${query}%`, `%${query}%`, limit);
    }
    if (json) return printJson(rows);
    printTable(rows);
  } finally {
    db.close();
  }
}

function findChats(query, { json, limit, ctx }) {
  const db = ctx.openMain();
  try {
    let rows;
    if (!query) {
      rows = db.prepare('SELECT id, title, chatType, messageCount, lastMessageAt FROM chats ORDER BY lastMessageAt DESC LIMIT ?').all(limit);
    } else if (UUID_RE.test(query)) {
      rows = db.prepare('SELECT id, title, chatType, projectId, messageCount, lastMessageAt FROM chats WHERE id = ?').all(query);
    } else {
      rows = db.prepare(
        'SELECT id, title, chatType, projectId, messageCount, lastMessageAt FROM chats WHERE LOWER(title) LIKE LOWER(?) ORDER BY lastMessageAt DESC LIMIT ?'
      ).all(`%${query}%`, limit);
    }
    if (json) return printJson(rows);
    printTable(rows);
  } finally {
    db.close();
  }
}

function findProjects(query, { json, limit, ctx }) {
  const db = ctx.openMain();
  try {
    let rows;
    if (!query) {
      rows = db.prepare('SELECT id, name, createdAt FROM projects ORDER BY name LIMIT ?').all(limit);
    } else if (UUID_RE.test(query)) {
      rows = db.prepare('SELECT id, name, description, createdAt FROM projects WHERE id = ?').all(query);
    } else {
      rows = db.prepare(
        'SELECT id, name, createdAt FROM projects WHERE LOWER(name) LIKE LOWER(?) ORDER BY name LIMIT ?'
      ).all(`%${query}%`, limit);
    }
    if (json) return printJson(rows);
    printTable(rows);
  } finally {
    db.close();
  }
}

// ---------- verb: chats ----------

function cmdChats(args, ctx) {
  const { flags } = parseSubArgs(args);
  const json = asBool(flags.json);
  const limit = asInt(flags.limit, 50);

  const db = ctx.openMain();
  try {
    let rows;
    if (flags.character) {
      const c = resolveCharacter(db, String(flags.character));
      rows = db.prepare(
        "SELECT id, title, chatType, messageCount, lastMessageAt, projectId " +
        "FROM chats WHERE participants LIKE ? ORDER BY lastMessageAt DESC LIMIT ?"
      ).all(`%${c.id}%`, limit);
      if (!json) console.log(`Chats for character: ${c.name} (${c.id})`);
    } else if (flags.project) {
      const p = resolveProject(db, String(flags.project));
      rows = db.prepare(
        "SELECT id, title, chatType, messageCount, lastMessageAt " +
        "FROM chats WHERE projectId = ? ORDER BY lastMessageAt DESC LIMIT ?"
      ).all(p.id, limit);
      if (!json) console.log(`Chats for project: ${p.name} (${p.id})`);
    } else {
      rows = db.prepare(
        "SELECT id, title, chatType, messageCount, lastMessageAt, projectId " +
        "FROM chats ORDER BY lastMessageAt DESC LIMIT ?"
      ).all(limit);
    }
    if (json) return printJson(rows);
    printTable(rows);
  } finally {
    db.close();
  }
}

// ---------- verb: messages ----------

function cmdMessages(args, ctx) {
  const { flags } = parseSubArgs(args);
  const json = asBool(flags.json);
  const last = asInt(flags.last, 20);
  const full = asBool(flags.full);
  if (!flags.chat) throw new Error('Usage: quilltap db messages --chat <id|title> [--last N] [--full] [--from <participant>] [--type <type>]');

  const db = ctx.openMain();
  try {
    const chat = resolveChat(db, String(flags.chat));
    const conditions = ['chatId = ?'];
    const params = [chat.id];
    if (flags.from) { conditions.push('participantId = ?'); params.push(String(flags.from)); }
    if (flags.type) { conditions.push('type = ?'); params.push(String(flags.type)); }

    const totalRow = db.prepare(`SELECT count(*) AS n FROM chat_messages WHERE ${conditions.join(' AND ')}`).get(...params);
    const sql = `
      SELECT id, createdAt, role, type, systemSender, participantId, content
      FROM chat_messages WHERE ${conditions.join(' AND ')}
      ORDER BY createdAt DESC LIMIT ?
    `;
    params.push(last);
    const rows = db.prepare(sql).all(...params).reverse(); // oldest first

    if (json) return printJson({ chat, total: totalRow.n, returned: rows.length, messages: rows });

    console.log(`Chat: ${chat.title} (${chat.id}) — showing ${rows.length} of ${totalRow.n} matching messages`);
    const summary = rows.map(r => ({
      createdAt: r.createdAt,
      id: r.id,
      role: r.role,
      type: r.type,
      from: r.systemSender || r.participantId || '',
      content: full ? r.content : truncate(r.content, 120),
    }));
    printTable(summary);
  } finally {
    db.close();
  }
}

// ---------- verb: logs ----------

function cmdLogs(args, ctx) {
  const { flags } = parseSubArgs(args);
  const json = asBool(flags.json);
  const limit = asInt(flags.limit, 50);

  const logsDb = ctx.openLogs();
  try {
    let rows;
    if (flags.message) {
      rows = logsDb.prepare(
        'SELECT id, createdAt, type, provider, modelName, chatId, characterId, durationMs FROM llm_logs WHERE messageId = ? ORDER BY createdAt DESC LIMIT ?'
      ).all(String(flags.message), limit);
    } else if (flags.chat) {
      // need to resolve chat from main DB if a name was given
      let chatId = String(flags.chat);
      if (!UUID_RE.test(chatId)) {
        const main = ctx.openMain();
        try {
          chatId = resolveChat(main, chatId).id;
        } finally {
          main.close();
        }
      }
      rows = logsDb.prepare(
        'SELECT id, createdAt, type, provider, modelName, messageId, characterId, durationMs FROM llm_logs WHERE chatId = ? ORDER BY createdAt DESC LIMIT ?'
      ).all(chatId, limit);
    } else if (flags.character) {
      const main = ctx.openMain();
      let c;
      try { c = resolveCharacter(main, String(flags.character)); } finally { main.close(); }
      rows = logsDb.prepare(
        'SELECT id, createdAt, type, provider, modelName, chatId, messageId, durationMs FROM llm_logs WHERE characterId = ? ORDER BY createdAt DESC LIMIT ?'
      ).all(c.id, limit);
    } else if (flags.tail) {
      const n = asInt(flags.tail, 20);
      rows = logsDb.prepare(
        'SELECT id, createdAt, type, provider, modelName, chatId, messageId, characterId, durationMs FROM llm_logs ORDER BY createdAt DESC LIMIT ?'
      ).all(n);
    } else {
      throw new Error('Usage: quilltap db logs (--chat <id|title> | --message <id> | --character <id|name> | --tail N) [--limit N]');
    }
    if (json) return printJson(rows);
    printTable(rows);
  } finally {
    logsDb.close();
  }
}

// ---------- verb: message (single record) ----------

function cmdMessage(args, ctx) {
  const { flags, positional } = parseSubArgs(args);
  const id = positional[0];
  if (!id) throw new Error('Usage: quilltap db message <id> [--json] [--rendered]');
  const json = asBool(flags.json);
  const rendered = asBool(flags.rendered);

  const db = ctx.openMain();
  try {
    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id);
    if (!row) throw new Error(`No chat_message with id ${id}`);
    if (json) return printJson(row);

    printRecord(`Message ${row.id}`, {
      chatId: row.chatId,
      createdAt: row.createdAt,
      role: row.role,
      type: row.type,
      systemSender: row.systemSender,
      participantId: row.participantId,
      provider: row.provider,
      modelName: row.modelName,
      tokenCount: row.tokenCount,
    });
    console.log('');
    console.log('── Content ──');
    console.log(row.content || '(empty)');
    if (rendered && row.renderedHtml) {
      console.log('');
      console.log('── Rendered HTML ──');
      console.log(row.renderedHtml);
    }
  } finally {
    db.close();
  }
}

// ---------- verb: log (single record) ----------

function cmdLog(args, ctx) {
  const { flags, positional } = parseSubArgs(args);
  const id = positional[0];
  if (!id) throw new Error('Usage: quilltap db log <id> [--json] [--field request|response|both]');
  const json = asBool(flags.json);
  const field = flags.field || 'both';

  const db = ctx.openLogs();
  try {
    const row = db.prepare('SELECT * FROM llm_logs WHERE id = ?').get(id);
    if (!row) throw new Error(`No llm_log with id ${id}`);
    if (json) return printJson(row);

    printRecord(`LLM log ${row.id}`, {
      createdAt: row.createdAt,
      type: row.type,
      provider: row.provider,
      modelName: row.modelName,
      chatId: row.chatId,
      messageId: row.messageId,
      characterId: row.characterId,
      durationMs: row.durationMs,
      usage: row.usage,
      cacheUsage: row.cacheUsage,
    });
    if (field === 'request' || field === 'both') {
      console.log('');
      console.log('── Request ──');
      console.log(row.request);
    }
    if (field === 'response' || field === 'both') {
      console.log('');
      console.log('── Response ──');
      console.log(row.response);
    }
  } finally {
    db.close();
  }
}

// ---------- verb: memories ----------

function cmdMemories(args, ctx) {
  const { flags } = parseSubArgs(args);
  const json = asBool(flags.json);
  const limit = asInt(flags.limit, 50);
  if (!flags.character) throw new Error('Usage: quilltap db memories --character <id|name> [--about <id|name>] [--source AUTO|MANUAL] [--limit N]');

  const db = ctx.openMain();
  try {
    const holder = resolveCharacter(db, String(flags.character));
    const conditions = ['characterId = ?'];
    const params = [holder.id];
    if (flags.about) {
      const a = resolveCharacter(db, String(flags.about));
      conditions.push('aboutCharacterId = ?');
      params.push(a.id);
    }
    if (flags.source) {
      conditions.push('source = ?');
      params.push(String(flags.source).toUpperCase());
    }
    const rows = db.prepare(`
      SELECT id, createdAt, source, importance, reinforcementCount,
             aboutCharacterId, chatId, summary
      FROM memories WHERE ${conditions.join(' AND ')}
      ORDER BY createdAt DESC LIMIT ?
    `).all(...params, limit);

    const totalRow = db.prepare(`SELECT count(*) AS n FROM memories WHERE ${conditions.join(' AND ')}`).get(...params);

    if (json) return printJson({ holder, total: totalRow.n, returned: rows.length, memories: rows });

    console.log(`Memories held by ${holder.name} (${holder.id}) — ${rows.length} of ${totalRow.n}`);
    printTable(rows.map(r => ({
      createdAt: r.createdAt,
      id: r.id,
      src: r.source,
      imp: r.importance,
      rein: r.reinforcementCount,
      about: r.aboutCharacterId === holder.id ? 'self' : (r.aboutCharacterId || ''),
      summary: truncate(r.summary, 100),
    })));
  } finally {
    db.close();
  }
}

// ---------- dispatch ----------

const VERBS = {
  schema: cmdSchema,
  find: cmdFind,
  chats: cmdChats,
  messages: cmdMessages,
  logs: cmdLogs,
  message: cmdMessage,
  log: cmdLog,
  memories: cmdMemories,
};

function isVerb(arg) {
  return Object.prototype.hasOwnProperty.call(VERBS, arg);
}

function runVerb(args, ctx) {
  const [verb, ...rest] = args;
  const handler = VERBS[verb];
  if (!handler) throw new Error(`Unknown db subcommand: ${verb}`);
  handler(rest, ctx);
}

function makeCtx(dataDir, pepper) {
  return {
    dataDir,
    openMain:   () => openMainDb(dataDir, pepper, { readonly: true }),
    openLogs:   () => openLlmLogsDb(dataDir, pepper, { readonly: true }),
    openMounts: () => openMountIndexDb(dataDir, pepper, { readonly: true }),
  };
}

module.exports = {
  VERBS,
  isVerb,
  runVerb,
  makeCtx,
  DB_DOMAINS,
  TABLE_DB,
  ddlAnchor,
};
