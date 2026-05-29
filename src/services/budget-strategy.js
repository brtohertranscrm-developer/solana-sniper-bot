import { getDb } from '../utils/database.js';
import { config } from '../config.js';

export function getStrategy(userId) {
  const db = getDb();
  const s = db.prepare('SELECT * FROM user_strategy WHERE user_id = ?').get(userId);
  if (!s) return null;
  const tiers = JSON.parse(s.tp_tiers || '[]');
  const paused = db.prepare('SELECT reason FROM budget_pauses WHERE user_id = ? AND active = 1').get(userId);
  return { ...s, tp_tiers: tiers, paused: paused?.reason || null };
}

export function setStrategy(userId, fields) {
  const db = getDb();
  const existing = db.prepare('SELECT user_id FROM user_strategy WHERE user_id = ?').get(userId);
  const allowed = ['chain','daily_budget','max_per_trade','max_trades_day','target_roi','stop_loss','auto_reinvest','enabled'];
  const sets = [], vals = { userId };
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`${k} = @${k}`); vals[k] = fields[k]; }
  }
  if (sets.length === 0) return;
  if (existing) {
    db.prepare(`UPDATE user_strategy SET ${sets.join(', ')}, updated_at = datetime('now') WHERE user_id = @userId`).run(vals);
  } else {
    const cols = ['user_id', ...Object.keys(vals).filter(k => k !== 'userId'), 'updated_at'];
    const phs = cols.map(c => `@${c === 'userId' ? 'userId' : c}`).join(', ');
    const insertVals = { ...vals, updated_at: new Date().toISOString() };
    db.prepare(`INSERT INTO user_strategy (${cols.join(', ')}) VALUES (${phs})`).run(insertVals);
  }
}

export function consumeBudget(userId, amount) {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const s = db.prepare('SELECT * FROM user_strategy WHERE user_id = ?').get(userId);
  if (!s || !s.enabled) return { ok: false, reason: 'Strategy not enabled' };

  // Check daily budget
  const spent = db.prepare(
    "SELECT COALESCE(SUM(buy_amount_native), 0) as total FROM portfolios WHERE user_id = ? AND created_at LIKE ? AND status = 'holding'"
  ).get(userId, `${today}%`);
  const spentToday = spent?.total || 0;

  if (spentToday + amount > s.daily_budget) {
    return { ok: false, reason: `Daily budget limit (${s.daily_budget} ${nativeUnit(s.chain)}). Spent: ${spentToday.toFixed(4)}` };
  }

  // Check max per trade
  if (amount > s.max_per_trade) {
    return { ok: false, reason: `Max per trade: ${s.max_per_trade} ${nativeUnit(s.chain)}` };
  }

  // Check max trades per day
  const tradeCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM portfolios WHERE user_id = ? AND created_at LIKE ?"
  ).get(userId, `${today}%`);
  if (tradeCount.cnt >= s.max_trades_day) {
    return { ok: false, reason: `Max trades/day reached (${s.max_trades_day})` };
  }

  // Check pause
  const paused = db.prepare('SELECT reason FROM budget_pauses WHERE user_id = ? AND active = 1').get(userId);
  if (paused) {
    return { ok: false, reason: `Paused: ${paused.reason}` };
  }

  return { ok: true, spentToday: spentToday, remaining: s.daily_budget - spentToday };
}

export function pauseStrategy(userId, reason = 'Manual pause') {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO budget_pauses (user_id, reason, active, created_at) VALUES (?, ?, 1, datetime('now'))").run(userId, reason);
}

export function resumeStrategy(userId) {
  const db = getDb();
  db.prepare('UPDATE budget_pauses SET active = 0 WHERE user_id = ?').run(userId);
}

export function processReinvest(bot) {
  const db = getDb();
  // Find users with auto_reinvest enabled and closed profitable positions
  const users = db.prepare("SELECT DISTINCT user_id FROM user_strategy WHERE enabled = 1 AND auto_reinvest = 1").all();
  for (const u of users) {
    const profits = db.prepare(
      "SELECT COALESCE(SUM(pnl_amount), 0) as total FROM portfolios WHERE user_id = ? AND status = 'closed' AND pnl_amount > 0 AND reinvested = 0"
    ).get(u.user_id);
    if (profits && profits.total > 0) {
      const s = db.prepare('SELECT * FROM user_strategy WHERE user_id = ?').get(u.user_id);
      if (s) {
        const reinvestAmt = Math.min(profits.total, s.max_per_trade);
        db.prepare("UPDATE portfolios SET reinvested = 1 WHERE user_id = ? AND status = 'closed' AND reinvested = 0 AND pnl_amount > 0").run(u.user_id);
        // Notify user
        if (bot) {
          for (const adminId of config.adminIds) {
            if (String(adminId) === String(u.user_id)) {
              try {
                bot.telegram.sendMessage(adminId,
                  `💰 <b>Auto-Reinvest</b>\n${reinvestAmt.toFixed(4)} ${nativeUnit(s.chain)} profit reinvested into new trades.`,
                  { parse_mode: 'HTML' }
                );
              } catch {}
            }
          }
        }
      }
    }
  }
}

export function getStrategyReport(userId) {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const s = db.prepare('SELECT * FROM user_strategy WHERE user_id = ?').get(userId);
  if (!s) return null;

  const spent = db.prepare(
    "SELECT COALESCE(SUM(buy_amount_native), 0) as total FROM portfolios WHERE user_id = ? AND created_at LIKE ? AND status = 'holding'"
  ).get(userId, `${today}%`);
  const trades = db.prepare(
    "SELECT COUNT(*) as cnt FROM portfolios WHERE user_id = ? AND created_at LIKE ?"
  ).get(userId, `${today}%`);
  const pnl = db.prepare(
    "SELECT COALESCE(SUM(pnl_amount), 0) as total, COUNT(*) as closed FROM portfolios WHERE user_id = ? AND status = 'closed'"
  ).get(userId);
  const paused = db.prepare('SELECT reason FROM budget_pauses WHERE user_id = ? AND active = 1').get(userId);

  return {
    ...s,
    spent_today: spent?.total || 0,
    remaining: s.daily_budget - (spent?.total || 0),
    trades_today: trades?.cnt || 0,
    total_pnl: pnl?.total || 0,
    closed_trades: pnl?.closed || 0,
    paused: paused?.reason || null,
  };
}

export function initStrategyTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_strategy (
      user_id INTEGER PRIMARY KEY,
      chain TEXT DEFAULT 'solana',
      daily_budget REAL DEFAULT 0.1,
      max_per_trade REAL DEFAULT 0.01,
      max_trades_day INTEGER DEFAULT 10,
      target_roi REAL DEFAULT 200,
      stop_loss REAL DEFAULT -50,
      auto_reinvest INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 0,
      tp_tiers TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS budget_pauses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      reason TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function nativeUnit(chain) {
  return chain === 'solana' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';
}
