import Database from 'better-sqlite3';

const DB_PATH = process.cwd() + '/data/sniper.db';
let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function initDb() {
  db = getDb();
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

    CREATE TABLE IF NOT EXISTS portfolios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chain TEXT NOT NULL,
      token_address TEXT NOT NULL,
      token_symbol TEXT,
      buy_amount_native REAL NOT NULL,
      buy_amount_token REAL,
      buy_price REAL,
      txid TEXT,
      status TEXT DEFAULT 'holding',
      tp_pct REAL DEFAULT 200,
      sl_pct REAL DEFAULT -30,
      created_at TEXT DEFAULT (datetime('now')),
      sold_at TEXT,
      sell_price REAL,
      sell_amount REAL,
      pnl_pct REAL,
      pnl_amount REAL
    );

    CREATE TABLE IF NOT EXISTS copy_trade_watches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chain TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      label TEXT,
      active INTEGER DEFAULT 1,
      last_tx_signature TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rug_pull_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      chain TEXT NOT NULL,
      token_address TEXT NOT NULL,
      top_holder_address TEXT,
      previous_pct REAL DEFAULT 0,
      current_pct REAL DEFAULT 0,
      sell_pct REAL DEFAULT 0,
      alert_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auto_buy_config (
      user_id INTEGER NOT NULL,
      chain TEXT NOT NULL,
      enabled INTEGER DEFAULT 0,
      min_mc REAL DEFAULT 0,
      max_mc REAL DEFAULT 1000000000,
      min_holders INTEGER DEFAULT 0,
      min_liq REAL DEFAULT 0,
      max_slippage REAL DEFAULT 10,
      amount_per_buy REAL DEFAULT 0,
      max_buys_per_hour INTEGER DEFAULT 1,
      buys_this_hour INTEGER DEFAULT 0,
      hour_bucket TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, chain)
    );

    CREATE TABLE IF NOT EXISTS dca_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chain TEXT NOT NULL,
      token_address TEXT NOT NULL,
      total_amount REAL NOT NULL,
      slices INTEGER NOT NULL,
      interval_seconds INTEGER NOT NULL,
      slippage REAL DEFAULT 10,
      executed_slices INTEGER DEFAULT 0,
      amount_executed REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      next_run_at INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallet_rotation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chain TEXT NOT NULL,
      address TEXT NOT NULL,
      private_key TEXT,
      active INTEGER DEFAULT 1,
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bonding_watch (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain TEXT DEFAULT 'solana',
      token_address TEXT NOT NULL,
      symbol TEXT,
      completion_pct REAL DEFAULT 0,
      alerted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(chain, token_address)
    );

    CREATE TABLE IF NOT EXISTS volume_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain TEXT NOT NULL,
      token_address TEXT NOT NULL,
      volume_24h REAL DEFAULT 0,
      alert_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS channel_monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      chain TEXT DEFAULT 'solana',
      label TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS paper_settings (
      user_id INTEGER PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      starting_balance REAL DEFAULT 10000,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS paper_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chain TEXT NOT NULL,
      token_address TEXT NOT NULL,
      token_symbol TEXT,
      amount_native REAL NOT NULL,
      token_amount REAL DEFAULT 0,
      entry_price REAL DEFAULT 0,
      exit_price REAL,
      status TEXT DEFAULT 'holding',
      pnl REAL DEFAULT 0,
      pnl_pct REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tiered_tp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chain TEXT NOT NULL,
      token_address TEXT NOT NULL,
      tiers_json TEXT NOT NULL,
      triggered_json TEXT DEFAULT '[]',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, chain, token_address)
    );

    CREATE INDEX IF NOT EXISTS idx_tokens_score ON scanned_tokens(score DESC);
    CREATE INDEX IF NOT EXISTS idx_tokens_chain ON scanned_tokens(chain);
    CREATE INDEX IF NOT EXISTS idx_tokens_grade ON scanned_tokens(grade);
    CREATE INDEX IF NOT EXISTS idx_copy_trade_active ON copy_trade_watches(active, chain);
    CREATE INDEX IF NOT EXISTS idx_dca_active ON dca_orders(status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_volume_snapshots ON volume_snapshots(chain, token_address, created_at);
    CREATE INDEX IF NOT EXISTS idx_paper_positions ON paper_positions(user_id, status);
  `);

  console.log('[DB] Database initialized');
  return db;
}

export function getUserChain(userId) {
  const row = getDb().prepare('SELECT active_chain FROM user_settings WHERE user_id = ?').get(userId);
  return row?.active_chain || 'solana';
}

export function setUserChain(userId, chain) {
  getDb().prepare(`
    INSERT INTO user_settings (user_id, active_chain) VALUES (@userId, @chain)
    ON CONFLICT(user_id) DO UPDATE SET active_chain = @chain
  `).run({ userId, chain });
}

export function upsertToken(token) {
  const stmt = getDb().prepare(`
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
  return getDb().prepare('SELECT * FROM scanned_tokens WHERE address = ? AND chain = ?').get(address, chain);
}

export function getTopTokens(chain, limit = 20) {
  if (chain) {
    return getDb().prepare('SELECT * FROM scanned_tokens WHERE chain = ? ORDER BY score DESC, last_updated DESC LIMIT ?').all(chain, limit);
  }
  return getDb().prepare('SELECT * FROM scanned_tokens ORDER BY score DESC, last_updated DESC LIMIT ?').all(limit);
}

export function getTokensByGrade(chain, grade, limit = 20) {
  if (chain) {
    return getDb().prepare('SELECT * FROM scanned_tokens WHERE chain = ? AND grade = ? ORDER BY last_updated DESC LIMIT ?').all(chain, grade, limit);
  }
  return getDb().prepare('SELECT * FROM scanned_tokens WHERE grade = ? ORDER BY last_updated DESC LIMIT ?').all(grade, limit);
}

export function getStats() {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as count FROM scanned_tokens').get();
  const byGrade = db.prepare('SELECT grade, COUNT(*) as count FROM scanned_tokens GROUP BY grade ORDER BY grade').all();
  const byChain = db.prepare('SELECT chain, COUNT(*) as count FROM scanned_tokens GROUP BY chain').all();
  const bySource = db.prepare('SELECT source, COUNT(*) as count FROM scanned_tokens GROUP BY source').all();
  return { total: total.count, byGrade, byChain, bySource };
}

export default getDb;
