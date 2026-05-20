'use strict';

const fs = require('fs');
const path = require('path');
const { openMainDb, openLlmLogsDb, openMountIndexDb, openEncryptedDb } = require('./db-helpers');
const { getLockStatus } = require('./lock-helpers');

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

// ---------- verb: optimize ----------

const OPTIMIZE_TARGETS = {
  'main':         { filename: 'quilltap.db',              label: 'main' },
  'llm-logs':     { filename: 'quilltap-llm-logs.db',     label: 'llm-logs' },
  'mount-points': { filename: 'quilltap-mount-index.db',  label: 'mount-points' },
};

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  return `${(ms / 60_000).toFixed(2)} min`;
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function cmdOptimize(args, ctx) {
  const { flags, positional } = parseSubArgs(args);
  const json = asBool(flags.json);

  // Resolve target list
  let targets;
  if (positional.length === 0 || (positional.length === 1 && positional[0] === 'all')) {
    targets = Object.keys(OPTIMIZE_TARGETS);
  } else {
    targets = positional.map(p => {
      if (!OPTIMIZE_TARGETS[p]) {
        const allowed = Object.keys(OPTIMIZE_TARGETS).join(' | ');
        throw new Error(`Unknown optimize target '${p}'. Allowed: ${allowed} | all`);
      }
      return p;
    });
  }

  // Refuse to proceed if any instance is actively holding the lock.
  const lockStatus = getLockStatus(ctx.dataDir);
  if (lockStatus.state === 'active' || lockStatus.state === 'suspect') {
    const msg = lockStatus.state === 'active'
      ? `Database is currently in use — ${lockStatus.reason}.\n` +
        `Stop the running Quilltap instance before optimizing, then try again.\n` +
        `(See \`quilltap db --lock-status\` for details.)`
      : `Lock file ${lockStatus.reason}.\n` +
        `This may be a stale lock from a reused PID. Inspect it with\n` +
        `\`quilltap db --lock-status\` and clean it up with \`quilltap db --lock-clean\` if safe.`;
    const err = new Error(msg);
    err.locked = true;
    throw err;
  }
  if (lockStatus.state === 'corrupt') {
    throw new Error(
      `Lock file at ${lockStatus.lockPath} is corrupt. Inspect it manually or clean with ` +
      `\`quilltap db --lock-clean\`, then retry.`,
    );
  }

  const results = [];
  for (const key of targets) {
    const target = OPTIMIZE_TARGETS[key];
    const dbPath = path.join(ctx.dataDir, target.filename);
    if (!fs.existsSync(dbPath)) {
      if (!json) console.log(`Skipping ${target.label}: ${dbPath} not found.`);
      results.push({ target: target.label, skipped: true, reason: 'not found' });
      continue;
    }
    const result = optimizeOneDb(key, dbPath, ctx);
    results.push(result);
  }

  if (json) {
    printJson({ results });
    return;
  }

  // Final summary
  const totalSaved = results
    .filter(r => !r.skipped && r.sizeBefore != null && r.sizeAfter != null)
    .reduce((acc, r) => acc + (r.sizeBefore - r.sizeAfter), 0);
  if (totalSaved > 0) {
    console.log('');
    console.log(`Total reclaimed: ${formatBytes(totalSaved)}`);
  }
}

function optimizeOneDb(key, dbPath, ctx) {
  const target = OPTIMIZE_TARGETS[key];
  const opener = key === 'main' ? openMainDb : key === 'llm-logs' ? openLlmLogsDb : openMountIndexDb;

  console.log('');
  console.log(`── ${target.label}  (${dbPath}) ──`);
  const sizeBefore = fileSize(dbPath);
  console.log(`  size before: ${formatBytes(sizeBefore)}`);

  let db;
  try {
    db = opener(ctx.dataDir, ctx.pepper, { readonly: false });
  } catch (err) {
    console.log(`  open failed: ${err.message}`);
    return { target: target.label, skipped: true, reason: err.message };
  }

  const steps = [];
  function runStep(name, fn) {
    const t0 = Date.now();
    let info = '';
    try {
      info = fn() || '';
    } catch (err) {
      const elapsed = Date.now() - t0;
      console.log(`  ${name}: FAILED after ${formatDuration(elapsed)} — ${err.message}`);
      steps.push({ name, ok: false, ms: elapsed, error: err.message });
      throw err;
    }
    const elapsed = Date.now() - t0;
    console.log(`  ${name}: ${formatDuration(elapsed)}${info ? ` (${info})` : ''}`);
    steps.push({ name, ok: true, ms: elapsed });
  }

  try {
    runStep('VACUUM',          () => { db.exec('VACUUM'); });
    runStep('ANALYZE',         () => { db.exec('ANALYZE'); });
    runStep('PRAGMA optimize', () => { db.pragma('optimize'); });
  } catch {
    try { db.close(); } catch {}
    return { target: target.label, skipped: false, sizeBefore, sizeAfter: fileSize(dbPath), steps };
  } finally {
    try { db.close(); } catch {}
  }

  const sizeAfter = fileSize(dbPath);
  const delta = sizeBefore - sizeAfter;
  const deltaStr = delta === 0
    ? 'no change'
    : delta > 0
      ? `reclaimed ${formatBytes(delta)}`
      : `grew by ${formatBytes(-delta)}`;
  console.log(`  size after:  ${formatBytes(sizeAfter)}  (${deltaStr})`);
  return { target: target.label, skipped: false, sizeBefore, sizeAfter, steps };
}

// ---------- verb: backup ----------

// Targets mirror OPTIMIZE_TARGETS but live separately so the verb can grow
// its own per-target metadata (e.g. exclude logs) without disturbing optimize.
const BACKUP_TARGETS = OPTIMIZE_TARGETS;
const INTEGRITY_TARGETS = OPTIMIZE_TARGETS;

function isoTimestampForDir() {
  // 2026-05-20T14-32-07
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '').slice(0, 19);
}

function resolveBackupTargets(positional) {
  if (positional.length === 0 || (positional.length === 1 && positional[0] === 'all')) {
    return Object.keys(BACKUP_TARGETS);
  }
  return positional.map(p => {
    if (!BACKUP_TARGETS[p]) {
      const allowed = Object.keys(BACKUP_TARGETS).join(' | ');
      throw new Error(`Unknown backup target '${p}'. Allowed: ${allowed} | all`);
    }
    return p;
  });
}

async function cmdBackup(args, ctx) {
  const { flags, positional } = parseSubArgs(args);
  const json = asBool(flags.json);
  const out = typeof flags.out === 'string' ? flags.out : '';

  const targets = resolveBackupTargets(positional);

  // Backups are safe while the server is running — page-level online copy.
  // Log the situation and proceed; do not refuse.
  const lockStatus = getLockStatus(ctx.dataDir);
  if (!json && (lockStatus.state === 'active' || lockStatus.state === 'suspect')) {
    const pidPart = lockStatus.lock && lockStatus.lock.pid ? ` (PID ${lockStatus.lock.pid})` : '';
    console.log(`Live instance detected${pidPart} — taking online snapshot.`);
  }

  // Resolve destination directory. Default: <dataDir>/backups/<ISO-timestamp>/
  const destDir = out
    ? (out.startsWith('~') ? path.join(require('os').homedir(), out.slice(1)) : out)
    : path.join(ctx.dataDir, 'backups', isoTimestampForDir());
  fs.mkdirSync(destDir, { recursive: true });

  if (!json) {
    console.log(`Destination: ${destDir}`);
  }

  const results = [];
  for (const key of targets) {
    const target = BACKUP_TARGETS[key];
    const sourcePath = path.join(ctx.dataDir, target.filename);
    if (!fs.existsSync(sourcePath)) {
      if (!json) console.log(`Skipping ${target.label}: ${sourcePath} not found.`);
      results.push({ target: target.label, source: sourcePath, skipped: true, ok: false, reason: 'not found' });
      continue;
    }
    const result = await backupOneDb(key, sourcePath, destDir, ctx);
    results.push(result);
  }

  const okCount = results.filter(r => r.ok).length;
  const totalBytes = results.filter(r => r.ok && r.destSize != null).reduce((acc, r) => acc + r.destSize, 0);

  if (json) {
    printJson({ destDir, results, summary: { ok: okCount, total: results.length, totalBytes } });
    return;
  }

  console.log('');
  console.log(`Snapshot complete: ${okCount}/${results.length} target${results.length === 1 ? '' : 's'} (${formatBytes(totalBytes)} written).`);

  if (okCount !== results.length) {
    // Surface failure via non-zero exit so scripts can pick it up.
    const err = new Error('one or more snapshots failed');
    err.silent = true;
    throw err;
  }
}

async function backupOneDb(key, sourcePath, destDir, ctx) {
  const target = BACKUP_TARGETS[key];
  const opener = key === 'main' ? openMainDb : key === 'llm-logs' ? openLlmLogsDb : openMountIndexDb;
  const destPath = path.join(destDir, target.filename);

  console.log('');
  console.log(`── ${target.label}  (${sourcePath}) ──`);
  const sourceSize = fileSize(sourcePath);
  console.log(`  source size: ${formatBytes(sourceSize)}`);

  if (fs.existsSync(destPath)) {
    console.log(`  refusing: destination ${destPath} already exists`);
    return { target: target.label, source: sourcePath, sourceSize, dest: destPath, ok: false, error: 'destination exists' };
  }

  // Open source RW. We need write capability for `wal_checkpoint(TRUNCATE)`
  // and `BEGIN EXCLUSIVE`. The lock is held only for the duration of the
  // file copy itself.
  let src;
  try {
    src = opener(ctx.dataDir, ctx.pepper, { readonly: false });
  } catch (err) {
    console.log(`  open failed: ${err.message}`);
    return { target: target.label, source: sourcePath, sourceSize, dest: destPath, ok: false, error: err.message };
  }

  // The SQLCipher build in this driver does not expose `sqlcipher_export`
  // and the SQLite online-backup API refuses cross-cipher copies. We
  // instead take a brief exclusive lock, force a WAL checkpoint, and copy
  // the encrypted .db file at the byte level — the pages are already
  // encrypted in the source, so the destination inherits the key.
  const t0 = Date.now();
  let inTxn = false;
  try {
    src.exec('BEGIN EXCLUSIVE');
    inTxn = true;
    try { src.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
    fs.copyFileSync(sourcePath, destPath);
    src.exec('COMMIT');
    inTxn = false;
  } catch (err) {
    if (inTxn) { try { src.exec('ROLLBACK'); } catch {} }
    try { src.close(); } catch {}
    try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
    console.log(`  backup failed: ${err.message}`);
    return { target: target.label, source: sourcePath, sourceSize, dest: destPath, ok: false, error: err.message, durationMs: Date.now() - t0 };
  } finally {
    try { src.close(); } catch {}
  }
  const durationMs = Date.now() - t0;
  const destSize = fileSize(destPath);
  console.log(`  dest: ${destPath}`);
  console.log(`  dest size:   ${formatBytes(destSize)}  (${formatDuration(durationMs)})`);

  // Post-flight: open the snapshot with the same key and run quick_check.
  let verifyDb;
  try {
    verifyDb = openEncryptedDb(destPath, ctx.pepper, { readonly: true, friendlyName: `snapshot of ${target.label}` });
  } catch (err) {
    console.log(`  verify failed: ${err.message}`);
    return { target: target.label, source: sourcePath, sourceSize, dest: destPath, destSize, durationMs, ok: false, error: `verify open failed: ${err.message}` };
  }
  try {
    const rows = verifyDb.pragma('quick_check');
    const result = rows && rows[0] ? (rows[0].integrity_check || rows[0].quick_check || Object.values(rows[0])[0]) : 'unknown';
    if (result !== 'ok') {
      console.log(`  verify failed: quick_check returned ${result}`);
      return { target: target.label, source: sourcePath, sourceSize, dest: destPath, destSize, durationMs, ok: false, error: `quick_check: ${result}` };
    }
    console.log(`  verify: ok`);
  } catch (err) {
    console.log(`  verify failed: ${err.message}`);
    return { target: target.label, source: sourcePath, sourceSize, dest: destPath, destSize, durationMs, ok: false, error: err.message };
  } finally {
    try { verifyDb.close(); } catch {}
  }

  return { target: target.label, source: sourcePath, sourceSize, dest: destPath, destSize, durationMs, ok: true };
}

// ---------- verb: integrity ----------

function cmdIntegrity(args, ctx) {
  const { flags, positional } = parseSubArgs(args);
  const json = asBool(flags.json);

  let targets;
  if (positional.length === 0 || (positional.length === 1 && positional[0] === 'all')) {
    targets = Object.keys(INTEGRITY_TARGETS);
  } else {
    targets = positional.map(p => {
      if (!INTEGRITY_TARGETS[p]) {
        const allowed = Object.keys(INTEGRITY_TARGETS).join(' | ');
        throw new Error(`Unknown integrity target '${p}'. Allowed: ${allowed} | all`);
      }
      return p;
    });
  }

  // Read-only — safe alongside a running instance. Log it once if active.
  const lockStatus = getLockStatus(ctx.dataDir);
  if (!json && (lockStatus.state === 'active' || lockStatus.state === 'suspect')) {
    const pidPart = lockStatus.lock && lockStatus.lock.pid ? ` (PID ${lockStatus.lock.pid})` : '';
    console.log(`Live instance detected${pidPart} — running read-only checks.`);
  }

  const results = [];
  for (const key of targets) {
    const target = INTEGRITY_TARGETS[key];
    const dbPath = path.join(ctx.dataDir, target.filename);
    if (!fs.existsSync(dbPath)) {
      if (!json) console.log(`Skipping ${target.label}: ${dbPath} not found.`);
      results.push({ target: target.label, ok: false, openable: false, issues: [], reason: 'not found' });
      continue;
    }
    const result = integrityOneDb(key, dbPath, ctx);
    results.push(result);
  }

  const anyOpenFailed = results.some(r => r.openable === false && r.reason !== 'not found');
  const anyIssues = results.some(r => r.openable !== false && !r.ok);

  if (json) {
    printJson({ results });
  } else {
    console.log('');
    if (!anyIssues && !anyOpenFailed) {
      console.log('All databases reported ok.');
    } else if (anyOpenFailed) {
      console.log('One or more databases could not be opened.');
    } else {
      console.log('One or more databases reported integrity issues — see above.');
    }
  }

  if (anyOpenFailed) {
    const err = new Error('database open failure');
    err.silent = true;
    err.exitCode = 2;
    throw err;
  }
  if (anyIssues) {
    const err = new Error('integrity issues detected');
    err.silent = true;
    err.exitCode = 1;
    throw err;
  }
}

function integrityOneDb(key, dbPath, ctx) {
  const target = INTEGRITY_TARGETS[key];
  const opener = key === 'main' ? openMainDb : key === 'llm-logs' ? openLlmLogsDb : openMountIndexDb;

  console.log('');
  console.log(`── ${target.label}  (${dbPath}) ──`);

  let db;
  try {
    db = opener(ctx.dataDir, ctx.pepper, { readonly: true });
  } catch (err) {
    console.log(`  open failed: ${err.message}`);
    return { target: target.label, ok: false, openable: false, issues: [], reason: err.message };
  }

  const issues = [];
  let cipherCheck = null;
  let integrityCheck = null;
  const t0 = Date.now();
  try {
    try {
      const rows = db.pragma('cipher_integrity_check');
      if (rows && rows.length === 0) {
        cipherCheck = 'ok';
        console.log('  cipher_integrity_check: ok');
      } else {
        const lines = rows.map(r => (r.cipher_integrity_check || Object.values(r)[0] || '')).filter(Boolean);
        if (lines.length === 1 && lines[0] === 'ok') {
          cipherCheck = 'ok';
          console.log('  cipher_integrity_check: ok');
        } else {
          cipherCheck = lines.join('; ');
          for (const line of lines) {
            console.log(`  cipher_integrity_check: ${line}`);
            issues.push({ pragma: 'cipher_integrity_check', message: line });
          }
        }
      }
    } catch (err) {
      // Plain SQLite has no cipher_integrity_check; treat as N/A and continue.
      cipherCheck = `n/a (${err.message})`;
      console.log(`  cipher_integrity_check: n/a (${err.message})`);
    }

    const integRows = db.pragma('integrity_check');
    const lines = integRows.map(r => (r.integrity_check || Object.values(r)[0] || '')).filter(Boolean);
    if (lines.length === 1 && lines[0] === 'ok') {
      integrityCheck = 'ok';
      console.log('  integrity_check:        ok');
    } else {
      integrityCheck = lines.join('; ');
      for (const line of lines) {
        console.log(`  integrity_check:        ${line}`);
        issues.push({ pragma: 'integrity_check', message: line });
      }
    }
  } finally {
    try { db.close(); } catch {}
  }
  const durationMs = Date.now() - t0;
  console.log(`  duration: ${formatDuration(durationMs)}`);

  const ok = (cipherCheck === 'ok' || cipherCheck === null || (typeof cipherCheck === 'string' && cipherCheck.startsWith('n/a')))
    && integrityCheck === 'ok';
  return {
    target: target.label,
    ok,
    openable: true,
    cipherIntegrityCheck: cipherCheck,
    integrityCheck,
    issues,
    durationMs,
  };
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
  optimize: cmdOptimize,
  backup: cmdBackup,
  integrity: cmdIntegrity,
};

function isVerb(arg) {
  return Object.prototype.hasOwnProperty.call(VERBS, arg);
}

async function runVerb(args, ctx) {
  const [verb, ...rest] = args;
  const handler = VERBS[verb];
  if (!handler) throw new Error(`Unknown db subcommand: ${verb}`);
  return handler(rest, ctx);
}

function makeCtx(dataDir, pepper) {
  return {
    dataDir,
    pepper,
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
