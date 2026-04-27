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

function openMountIndexDb(dataDir, pepper, { readonly = true } = {}) {
  const dbPath = path.join(dataDir, 'quilltap-mount-index.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Mount index database not found: ${dbPath}`);
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
    throw new Error(`Cannot open mount index database: ${err.message}\n` +
      'The database may be encrypted with a different key, or the .dbkey file may be missing.');
  }

  return db;
}

module.exports = {
  resolveDataDir,
  promptPassphrase,
  loadDbKey,
  openMountIndexDb,
};
