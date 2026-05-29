import axios from 'axios';
import { config } from '../config.js';
import { getDb } from '../utils/database.js';

let isMonitoring = false;

async function notifyAdmins(bot, text) {
  for (const adminId of config.adminIds) {
    try { await bot.telegram.sendMessage(adminId, text, { parse_mode: 'HTML', disable_web_page_preview: true }); } catch {}
  }
}

export async function monitorBondingCurve(bot) {
  if (isMonitoring) return [];
  isMonitoring = true;
  const alerts = [];
  try {
    if (!config.pumpFunApiUrl) return alerts;
    const res = await axios.get(config.pumpFunApiUrl, { timeout: 15000 });
    const tokens = Array.isArray(res.data) ? res.data : (res.data?.tokens || res.data?.data || []);
    for (const token of tokens.slice(0, 100)) {
      try {
        const address = token.mint || token.address || token.tokenAddress;
        if (!address) continue;
        const completion = parseFloat(token.bondingCurveProgress ?? token.complete ?? token.progress ?? 0);
        const symbol = token.symbol || token.ticker || 'PUMP';
        getDb().prepare(`
          INSERT INTO bonding_watch (chain, token_address, symbol, completion_pct, updated_at)
          VALUES ('solana', ?, ?, ?, datetime('now'))
          ON CONFLICT(chain, token_address) DO UPDATE SET
            symbol = excluded.symbol,
            completion_pct = excluded.completion_pct,
            updated_at = datetime('now')
        `).run(address, symbol, completion);
        const row = getDb().prepare('SELECT alerted FROM bonding_watch WHERE chain = ? AND token_address = ?').get('solana', address);
        if (completion >= config.bondingCompletionAlertPct && !row?.alerted) {
          getDb().prepare('UPDATE bonding_watch SET alerted = 1 WHERE chain = ? AND token_address = ?').run('solana', address);
          alerts.push({ address, symbol, completion });
          await notifyAdmins(bot, `🚀 <b>Bonding Curve Near Complete</b>\n${symbol}: ${completion.toFixed(1)}%\n<code>${address}</code>\n/snipe ${address}`);
        }
      } catch (err) {
        console.error('[Bonding] token:', err.message);
      }
    }
  } catch (err) {
    console.error('[Bonding] monitor:', err.message);
  } finally {
    isMonitoring = false;
  }
  return alerts;
}
