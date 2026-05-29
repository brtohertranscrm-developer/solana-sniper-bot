import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'sniper.db');

let db;

export function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS scanned_tokens (
      address TEXT PRIMARY KEY,
      name TEXT,
      symbol TEXT,
      source TEXT,
      market_cap REAL DEFAULT 0,
      volume_24h REAL DEFAULT 0,
      holders INTEGER DEFAULT 0,
      price REAL DEFAULT 0,
      score INTEGER DEFAULT 0,
      grade TEXT DEFAULT 'D',
      risk TEXT DEFAULT 'UNKNOWN',
      flagged INTEGER DEFAULT 0,
      first_seen TEXT DEFAULT (datetime('now')),
      last_updated TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_address TEXT,
      alert_type TEXT,
      message TEXT,
      sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tokens_score ON scanned_tokens(score DESC);
    CREATE INDEX IF NOT EXISTS idx_tokens_grade ON scanned_tokens(grade);
    CREATE INDEX IF NOT EXISTS idx_tokens_source ON scanned_tokens(source);
    CREATE INDEX IF NOT EXISTS idx_tokens_flagged ON scanned_tokens(flagged);
  `);

  console.log('[DB] Database initialized');
  return db;
}

export function upsertToken(token) {
  const stmt = db.prepare(`
    INSERT INTO scanned_tokens (address, name, symbol, source, market_cap, volume_24h, holders, price, score, grade, risk)
    VALUES (@address, @name, @symbol, @source, @market_cap, @volume_24h, @holders, @price, @score, @grade, @risk)
    ON CONFLICT(address) DO UPDATE SET
      market_cap = @market_cap,
      volume_24h = @volume_24h,
      holders = @holders,
      price = @price,
      score = @score,
      grade = @grade,
      risk = @risk,
      last_updated = datetime('now')
  `);
  stmt.run(token);
}

export function getToken(address) {
  return db.prepare('SELECT * FROM scanned_tokens WHERE address = ?').get(address);
}

export function getTopTokens(limit = 20) {
  return db.prepare('SELECT * FROM scanned_tokens ORDER BY score DESC, last_updated DESC LIMIT ?').all(limit);
}

export function getTokensByGrade(grade, limit = 20) {
  return db.prepare('SELECT * FROM scanned_tokens WHERE grade = ? ORDER BY last_updated DESC LIMIT ?').all(grade, limit);
}

export function getFlaggedTokens(limit = 20) {
  return db.prepare('SELECT * FROM scanned_tokens WHERE flagged = 1 ORDER BY last_updated DESC LIMIT ?').all(limit);
}

export function flagToken(address, reason) {
  db.prepare('UPDATE scanned_tokens SET flagged = 1, risk = ? WHERE address = ?').run(reason, address);
}

export function getStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM scanned_tokens').get();
  const byGrade = db.prepare(`
    SELECT grade, COUNT(*) as count FROM scanned_tokens GROUP BY grade ORDER BY grade
  `).all();
  const bySource = db.prepare(`
    SELECT source, COUNT(*) as count FROM scanned_tokens GROUP BY source
  `).all();
  return { total: total.count, byGrade, bySource };
}

export default db;
