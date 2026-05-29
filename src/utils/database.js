import Database from 'better-sqlite3';

const DB_PATH = process.cwd() + '/data/sniper.db';
let db;

export function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS scanned_tokens (
      address TEXT,
      chain TEXT DEFAULT 'solana',
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
      last_updated TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (address, chain)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_address TEXT,
      chain TEXT DEFAULT 'solana',
      alert_type TEXT,
      message TEXT,
      sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain TEXT NOT NULL,
      label TEXT,
      address TEXT NOT NULL,
      private_key TEXT,
      mnemonic TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      active_chain TEXT DEFAULT 'solana'
    );

    CREATE INDEX IF NOT EXISTS idx_tokens_score ON scanned_tokens(score DESC);
    CREATE INDEX IF NOT EXISTS idx_tokens_chain ON scanned_tokens(chain);
    CREATE INDEX IF NOT EXISTS idx_tokens_grade ON scanned_tokens(grade);
  `);

  console.log('[DB] Database initialized');
  return db;
}

export function getUserChain(userId) {
  const row = db.prepare('SELECT active_chain FROM user_settings WHERE user_id = ?').get(userId);
  return row?.active_chain || 'solana';
}

export function setUserChain(userId, chain) {
  db.prepare(`
    INSERT INTO user_settings (user_id, active_chain) VALUES (@userId, @chain)
    ON CONFLICT(user_id) DO UPDATE SET active_chain = @chain
  `).run({ userId, chain });
}

export function upsertToken(token) {
  const stmt = db.prepare(`
    INSERT INTO scanned_tokens (address, chain, name, symbol, source, market_cap, volume_24h, holders, price, score, grade, risk)
    VALUES (@address, @chain, @name, @symbol, @source, @market_cap, @volume_24h, @holders, @price, @score, @grade, @risk)
    ON CONFLICT(address, chain) DO UPDATE SET
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

export function getToken(address, chain) {
  return db.prepare('SELECT * FROM scanned_tokens WHERE address = ? AND chain = ?').get(address, chain);
}

export function getTopTokens(chain, limit = 20) {
  if (chain) {
    return db.prepare('SELECT * FROM scanned_tokens WHERE chain = ? ORDER BY score DESC, last_updated DESC LIMIT ?').all(chain, limit);
  }
  return db.prepare('SELECT * FROM scanned_tokens ORDER BY score DESC, last_updated DESC LIMIT ?').all(limit);
}

export function getTokensByGrade(chain, grade, limit = 20) {
  if (chain) {
    return db.prepare('SELECT * FROM scanned_tokens WHERE chain = ? AND grade = ? ORDER BY last_updated DESC LIMIT ?').all(chain, grade, limit);
  }
  return db.prepare('SELECT * FROM scanned_tokens WHERE grade = ? ORDER BY last_updated DESC LIMIT ?').all(grade, limit);
}

export function getStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM scanned_tokens').get();
  const byGrade = db.prepare('SELECT grade, COUNT(*) as count FROM scanned_tokens GROUP BY grade ORDER BY grade').all();
  const byChain = db.prepare('SELECT chain, COUNT(*) as count FROM scanned_tokens GROUP BY chain').all();
  const bySource = db.prepare('SELECT source, COUNT(*) as count FROM scanned_tokens GROUP BY source').all();
  return { total: total.count, byGrade, byChain, bySource };
}

export default db;
