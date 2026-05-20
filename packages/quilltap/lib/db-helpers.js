'use strict';

const path = require('path');
const fs = require('fs');

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const DEL = String.fromCharCode(0x7F);

function resolveDataDir(overrideDir) {
  if (overrideDir) {
    const resolved = overrideDir.startsWith('~')
      ? path.join(require('os').homedir(), overrideDir.slice(1))
      : overrideDir;
    return path.join(resolved, 'data');
  }
  const os = require('os');
  if (process.env.QUILLTAP_DATA_DIR) {
    return path.join(process.env.QUILLTAP_DATA_DIR, 'data');
  }
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Quilltap', 'data');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Quilltap', 'data');
  return path.join(home, '.quilltap', 'data');
}

// Resolve the data dir + database passphrase a subcommand should use, given
// the raw flag values it parsed. `--instance Foo` looks up the registry; an
// explicit `--data-dir` or `--passphrase` still wins so callers can override.
// Errors out if both `--instance` and `--data-dir` were supplied — these
// configure the same thing two different ways and must not silently disagree.
//
// Precedence order (highest to lowest):
//   1. --data-dir (explicit override)
//   2. --instance (explicit instance)
//   3. registered default instance
//   4. QUILLTAP_DATA_DIR env var
//   5. OS platform default
//
// Returns `usedPlatformDefault: true` only when falling back to the true
// platform default (no flags, no env var, no registered default).
// Callers can use this to decide whether to prompt the user with a
// "did you forget --instance?" hint.
function resolveDataDirAndPassphrase({ dataDir, instance, passphrase }) {
  if (dataDir && instance) {
    throw new Error('Specify either --instance or --data-dir, not both.');
  }
  if (instance) {
    const { resolveInstance } = require('./instances');
    const inst = resolveInstance(instance);
    return {
      dataDir: path.join(inst.path, 'data'),
      passphrase: passphrase || inst.passphrase || '',
      instanceName: inst.name,
      usedPlatformDefault: false,
    };
  }
  if (!dataDir && !process.env.QUILLTAP_DATA_DIR) {
    const { getDefaultInstance, resolveInstance } = require('./instances');
    const defaultName = getDefaultInstance();
    if (defaultName) {
      try {
        const inst = resolveInstance(defaultName);
        return {
          dataDir: path.join(inst.path, 'data'),
          passphrase: passphrase || inst.passphrase || '',
          instanceName: inst.name,
          usedPlatformDefault: false,
        };
      } catch {
        // Fall through to env var / platform default if default resolution fails
      }
    }
  }
  const usedPlatformDefault = !dataDir && !process.env.QUILLTAP_DATA_DIR;
  return {
    dataDir: resolveDataDir(dataDir),
    passphrase: passphrase || '',
    instanceName: null,
    usedPlatformDefault,
  };
}

// Print a one-line stderr hint when the CLI silently fell back to the platform
// default instance but the user has registered alternatives — Friday, Ignite,
// etc. The hint fires at most once per process so repeated openDb() calls
// inside a single subcommand stay quiet.
let _instanceHintPrinted = false;
function printDefaultInstanceHint(resolved) {
  if (_instanceHintPrinted) return;
  if (!resolved || !resolved.usedPlatformDefault) return;
  if (process.env.QUILLTAP_QUIET_HINTS) return;
  let registered;
  try {
    const { listInstances } = require('./instances');
    registered = listInstances();
  } catch {
    return;
  }
  if (!registered || registered.length === 0) return;
  _instanceHintPrinted = true;
  const names = registered.map((r) => r.name).join(', ');
  process.stderr.write(
    `Hint: using the default instance (${resolved.dataDir}). ` +
    `Registered: ${names}. Pass --instance <name> to target one. ` +
    `(set QUILLTAP_QUIET_HINTS=1 to silence)\n`
  );
}

function promptPassphrase(prompt) {
  return new Promise((resolve, reject) => {
    const readline = require('readline');
    if (!process.stdin.isTTY) {
      reject(new Error('This database requires a passphrase. Use --passphrase <pass> or set QUILLTAP_DB_PASSPHRASE'));
      return;
    }
    process.stdout.write(prompt || 'Passphrase: ');
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let passphrase = '';
    const onData = (ch) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r' || c === CTRL_D) {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        rl.close();
        process.stdout.write('\n');
        resolve(passphrase);
      } else if (c === CTRL_C) {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        rl.close();
        process.stdout.write('\n');
        process.exit(130);
      } else if (c === DEL || c === '\b') {
        if (passphrase.length > 0) {
          passphrase = passphrase.slice(0, -1);
        }
      } else {
        passphrase += c;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function loadDbKey(dataDir, passphrase) {
  const crypto = require('crypto');
  const dbkeyPath = path.join(dataDir, 'quilltap.dbkey');
  if (!fs.existsSync(dbkeyPath)) {
    return null;
  }

  const data = JSON.parse(fs.readFileSync(dbkeyPath, 'utf8'));
  const INTERNAL_PASSPHRASE = '__quilltap_no_passphrase__';

  if ('hasPassphrase' in data) {
    delete data.hasPassphrase;
    fs.writeFileSync(dbkeyPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  function tryDecrypt(pass) {
    const salt = Buffer.from(data.salt, 'hex');
    const key = crypto.pbkdf2Sync(pass, new Uint8Array(salt), data.kdfIterations, 32, data.kdfDigest);
    const iv = Buffer.from(data.iv, 'hex');
    const decipher = crypto.createDecipheriv(data.algorithm, new Uint8Array(key), new Uint8Array(iv));
    decipher.setAuthTag(new Uint8Array(Buffer.from(data.authTag, 'hex')));
    let plaintext = decipher.update(data.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
    if (hash !== data.pepperHash) {
      throw new Error('Pepper hash mismatch');
    }
    return plaintext;
  }

  try {
    return tryDecrypt(INTERNAL_PASSPHRASE);
  } catch {
    // Internal passphrase failed — need user passphrase
  }

  if (!passphrase && process.env.QUILLTAP_DB_PASSPHRASE) {
    passphrase = process.env.QUILLTAP_DB_PASSPHRASE;
  }

  if (!passphrase) {
    passphrase = await promptPassphrase('Database passphrase: ');
    if (!passphrase) {
      throw new Error('No passphrase provided');
    }
  }

  return tryDecrypt(passphrase);
}

function openEncryptedDb(dbPath, pepper, { readonly = true, friendlyName = 'database' } = {}) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`${friendlyName} not found: ${dbPath}`);
  }

  let Database;
  try {
    Database = require('better-sqlite3-multiple-ciphers');
  } catch {
    Database = require('better-sqlite3');
  }
  const db = new Database(dbPath, { readonly });

  if (pepper) {
    const keyHex = Buffer.from(pepper, 'base64').toString('hex');
    db.pragma(`key = "x'${keyHex}'"`);
  }

  try {
    db.prepare('SELECT 1').get();
  } catch (err) {
    db.close();
    throw new Error(`Cannot open ${friendlyName}: ${err.message}\n` +
      'The database may be encrypted with a different key, or the .dbkey file may be missing.');
  }

  return db;
}

function openMainDb(dataDir, pepper, opts = {}) {
  return openEncryptedDb(path.join(dataDir, 'quilltap.db'), pepper, { ...opts, friendlyName: 'main database' });
}

function openLlmLogsDb(dataDir, pepper, opts = {}) {
  return openEncryptedDb(path.join(dataDir, 'quilltap-llm-logs.db'), pepper, { ...opts, friendlyName: 'LLM logs database' });
}

function openMountIndexDb(dataDir, pepper, opts = {}) {
  return openEncryptedDb(path.join(dataDir, 'quilltap-mount-index.db'), pepper, { ...opts, friendlyName: 'mount index database' });
}

// ---------- shared name resolvers ----------
// Used by `db` and `memories` (and any future CLI namespace) to turn fuzzy
// user input — a UUID, a name, an alias, a substring — into a concrete row.
// Throws an `ambiguous` error (with `.ambiguous = true`) when multiple rows
// match so callers can surface a clean list instead of a stack trace.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ambiguous(kind, rows) {
  const list = rows.slice(0, 10).map(r => `  ${r.id}  ${r.name || r.title || ''}`).join('\n');
  const more = rows.length > 10 ? `\n  … and ${rows.length - 10} more` : '';
  const err = new Error(`Multiple ${kind}s match. Use a UUID or a more specific name:\n${list}${more}`);
  err.ambiguous = true;
  return err;
}

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

module.exports = {
  resolveDataDir,
  resolveDataDirAndPassphrase,
  printDefaultInstanceHint,
  promptPassphrase,
  loadDbKey,
  openEncryptedDb,
  openMainDb,
  openLlmLogsDb,
  openMountIndexDb,
  UUID_RE,
  ambiguous,
  resolveCharacter,
  resolveChat,
  resolveProject,
};
