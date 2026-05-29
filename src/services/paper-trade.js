import { getDb } from '../utils/database.js';

export function setPaperMode(userId, enabled, startingBalance = 10000) {
  try {
    getDb().prepare(`
      INSERT INTO paper_settings (user_id, enabled, starting_balance, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, starting_balance = excluded.starting_balance, updated_at = datetime('now')
    `).run(userId, enabled ? 1 : 0, startingBalance);
    return true;
  } catch (err) {
    console.error('[Paper] setMode:', err.message);
    return false;
  }
}

export function isPaperMode(userId) {
  try {
    const row = getDb().prepare('SELECT enabled FROM paper_settings WHERE user_id = ?').get(userId);
    return !!row?.enabled;
  } catch (err) {
    console.error('[Paper] mode:', err.message);
    return false;
  }
}

export function paperBuy(userId, chain, tokenAddress, amountNative, price = 0, symbol = 'PAPER') {
  try {
    const tokenAmount = price > 0 ? amountNative / price : amountNative;
    const info = getDb().prepare(`
      INSERT INTO paper_positions (user_id, chain, token_address, token_symbol, amount_native, token_amount, entry_price)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, chain, tokenAddress, symbol, amountNative, tokenAmount, price);
    return info.lastInsertRowid;
  } catch (err) {
    console.error('[Paper] buy:', err.message);
    return null;
  }
}

export function paperSell(userId, chainOrTokenAddress, tokenAddressOrPrice = 0, maybePrice = 0) {
  try {
    const hasChain = ['solana', 'bsc', 'eth'].includes(String(chainOrTokenAddress).toLowerCase());
    const chain = hasChain ? String(chainOrTokenAddress).toLowerCase() : null;
    const tokenAddress = hasChain ? tokenAddressOrPrice : chainOrTokenAddress;
    const price = hasChain ? maybePrice : tokenAddressOrPrice;
    const pos = getDb().prepare(`
      SELECT * FROM paper_positions
      WHERE user_id = ? AND token_address = ? AND status = 'holding'
        AND (? IS NULL OR chain = ?)
      ORDER BY id DESC LIMIT 1
    `).get(userId, tokenAddress, chain, chain);
    if (!pos) return null;
    const exit = price || pos.entry_price;
    const pnl = (exit - pos.entry_price) * pos.token_amount;
    const pnlPct = pos.entry_price > 0 ? ((exit - pos.entry_price) / pos.entry_price) * 100 : 0;
    getDb().prepare(`
      UPDATE paper_positions SET status = 'sold', exit_price = ?, pnl = ?, pnl_pct = ?, closed_at = datetime('now') WHERE id = ?
    `).run(exit, pnl, pnlPct, pos.id);
    return { ...pos, exit_price: exit, pnl, pnl_pct: pnlPct };
  } catch (err) {
    console.error('[Paper] sell:', err.message);
    return null;
  }
}

export function getPaperPortfolio(userId) {
  try {
    return getDb().prepare('SELECT * FROM paper_positions WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(userId);
  } catch (err) {
    console.error('[Paper] portfolio:', err.message);
    return [];
  }
}

export function getPaperPnL(userId) {
  try {
    const settings = getDb().prepare('SELECT * FROM paper_settings WHERE user_id = ?').get(userId) || { starting_balance: 10000 };
    const closed = getDb().prepare("SELECT COUNT(*) as trades, SUM(pnl) as pnl FROM paper_positions WHERE user_id = ? AND status = 'sold'").get(userId);
    const open = getDb().prepare("SELECT COUNT(*) as count, SUM(amount_native) as invested FROM paper_positions WHERE user_id = ? AND status = 'holding'").get(userId);
    return {
      startingBalance: settings.starting_balance,
      trades: closed.trades || 0,
      realizedPnl: closed.pnl || 0,
      openPositions: open.count || 0,
      invested: open.invested || 0,
      equity: (settings.starting_balance || 10000) + (closed.pnl || 0),
    };
  } catch (err) {
    console.error('[Paper] pnl:', err.message);
    return { startingBalance: 10000, trades: 0, realizedPnl: 0, openPositions: 0, invested: 0, equity: 10000 };
  }
}
