import Database from 'better-sqlite3';
import { getNativeBalance, getTokenBalance } from '../services/evm-swapper.js';
import { getSolBalance, getTokenBalance as getSolTokenBalance } from '../services/solana-swapper.js';
import { getTokenPriceSOL } from '../services/solana-swapper.js';

const DB_PATH = process.cwd() + '/data/sniper.db';

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
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
  `);
  return db;
}

/**
 * Add a buy to portfolio
 */
export function addPosition(data) {
  const db = getDb();
  db.prepare(`
    INSERT INTO portfolios (user_id, chain, token_address, token_symbol, buy_amount_native, buy_amount_token, buy_price, txid, tp_pct, sl_pct)
    VALUES (@user_id, @chain, @token_address, @token_symbol, @buy_amount_native, @buy_amount_token, @buy_price, @txid, @tp_pct, @sl_pct)
  `).run(data);
  console.log(`[Portfolio] Added position: ${data.token_symbol} on ${data.chain}`);
}

/**
 * Get open positions for a user
 */
export function getOpenPositions(userId, chain) {
  const db = getDb();
  if (chain) {
    return db.prepare('SELECT * FROM portfolios WHERE user_id = ? AND chain = ? AND status = ? ORDER BY created_at DESC').all(userId, chain, 'holding');
  }
  return db.prepare('SELECT * FROM portfolios WHERE user_id = ? AND status = ? ORDER BY created_at DESC').all(userId, 'holding');
}

/**
 * Get all positions (including closed)
 */
export function getAllPositions(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM portfolios WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
}

/**
 * Mark position as sold
 */
export function closePosition(id, sellPrice, sellAmount) {
  const db = getDb();
  const pos = db.prepare('SELECT * FROM portfolios WHERE id = ?').get(id);
  if (!pos) return;

  const pnlPct = pos.buy_price > 0 ? ((sellPrice - pos.buy_price) / pos.buy_price * 100) : 0;
  const pnlAmount = (sellPrice * sellAmount) - (pos.buy_price * pos.buy_amount_token);

  db.prepare(`
    UPDATE portfolios SET 
      status = 'sold', 
      sold_at = datetime('now'), 
      sell_price = @sellPrice, 
      sell_amount = @sellAmount, 
      pnl_pct = @pnlPct, 
      pnl_amount = @pnlAmount
    WHERE id = @id
  `).run({ id, sellPrice, sellAmount, pnlPct, pnlAmount });

  return { ...pos, pnlPct, pnlAmount };
}

/**
 * Get positions that need TP/SL check (holding status)
 */
export function getActivePositionsForMonitoring() {
  const db = getDb();
  return db.prepare('SELECT * FROM portfolios WHERE status = ?').all('holding');
}

/**
 * Get portfolio summary
 */
export function getPortfolioSummary(userId) {
  const db = getDb();
  const totalBuys = db.prepare('SELECT COUNT(*) as count, SUM(buy_amount_native) as total FROM portfolios WHERE user_id = ? AND status = ?').get(userId, 'holding');
  const totalSells = db.prepare('SELECT COUNT(*) as count, SUM(pnl_amount) as total_pnl FROM portfolios WHERE user_id = ? AND status = ? AND pnl_pct IS NOT NULL').get(userId, 'sold');
  
  const wins = db.prepare("SELECT COUNT(*) as count FROM portfolios WHERE user_id = ? AND status = 'sold' AND pnl_pct > 0").get(userId);
  const losses = db.prepare("SELECT COUNT(*) as count FROM portfolios WHERE user_id = ? AND status = 'sold' AND pnl_pct <= 0").get(userId);
  const totalClosed = wins.count + losses.count;
  const winRate = totalClosed > 0 ? ((wins.count / totalClosed) * 100).toFixed(1) : '0';

  return {
    openPositions: totalBuys.count,
    totalInvested: totalBuys.total || 0,
    closedTrades: totalClosed,
    wins: wins.count,
    losses: losses.count,
    winRate,
    totalPnl: totalSells.total_pnl || 0,
  };
}

/**
 * Update TP/SL for a position
 */
export function updateTPSL(id, tpPct, slPct) {
  const db = getDb();
  if (tpPct !== undefined) db.prepare('UPDATE portfolios SET tp_pct = ? WHERE id = ?').run(tpPct, id);
  if (slPct !== undefined) db.prepare('UPDATE portfolios SET sl_pct = ? WHERE id = ?').run(slPct, id);
}

/**
 * Delete position
 */
export function deletePosition(id, userId) {
  const db = getDb();
  db.prepare('DELETE FROM portfolios WHERE id = ? AND user_id = ? AND status = ?').run(id, userId, 'holding');
}

/**
 * Monitor all active positions and check TP/SL
 * Returns positions that should be sold
 */
export async function monitorPositions(bot) {
  const positions = getActivePositionsForMonitoring();
  const toSell = [];

  for (const pos of positions) {
    try {
      let currentPrice = null;

      if (pos.chain === 'solana') {
        currentPrice = await getTokenPriceSOL(pos.token_address);
      } else {
        // For EVM chains, use Dexscreener price or skip
        // Simple: fetch from Dexscreener
        try {
          const axios = (await import('axios')).default;
          const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.token_address}`);
          const pair = res.data?.pairs?.[0];
          if (pair?.priceUsd) {
            // Convert to native price
            // This is simplified - real impl would need proper oracle
            currentPrice = parseFloat(pair.priceUsd);
          }
        } catch {
          continue;
        }
      }

      if (!currentPrice || !pos.buy_price) continue;

      const pctChange = ((currentPrice - pos.buy_price) / pos.buy_price) * 100;

      // Check TP
      if (pos.tp_pct && pctChange >= pos.tp_pct) {
        toSell.push({ ...pos, currentPrice, pctChange, reason: 'TP_HIT' });
      }
      // Check SL
      else if (pos.sl_pct && pctChange <= pos.sl_pct) {
        toSell.push({ ...pos, currentPrice, pctChange, reason: 'SL_HIT' });
      }
    } catch (err) {
      console.error(`[Monitor] Error checking ${pos.token_address}: ${err.message}`);
    }
  }

  return toSell;
}
