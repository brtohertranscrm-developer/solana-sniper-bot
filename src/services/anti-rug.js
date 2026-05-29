import { getDb } from '../utils/database.js';
import { getTokenTopHolders } from './analyzer.js';

let isMonitoring = false;

async function notify(bot, userId, text) {
  try { await bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML', disable_web_page_preview: true }); } catch {}
}

export async function monitorRugPull(bot) {
  if (isMonitoring) return [];
  isMonitoring = true;
  const alerts = [];
  try {
    const positions = getDb().prepare("SELECT * FROM portfolios WHERE status = 'holding'").all();
    for (const pos of positions) {
      try {
        if (pos.chain !== 'solana') continue;
        const holders = await getTokenTopHolders(pos.token_address, 10);
        const total = holders.reduce((sum, h) => sum + parseFloat(h.amount || 0), 0);
        if (!total || !holders[0]) continue;
        const currentPct = (parseFloat(holders[0].amount || 0) / total) * 100;
        const top = holders[0].owner || holders[0].address || 'unknown';
        const last = getDb().prepare(`
          SELECT * FROM rug_pull_alerts
          WHERE chain = ? AND token_address = ? AND top_holder_address = ?
          ORDER BY id DESC LIMIT 1
        `).get(pos.chain, pos.token_address, top);

        if (last && last.current_pct - currentPct >= 20) {
          const sellPct = last.current_pct - currentPct;
          getDb().prepare(`
            INSERT INTO rug_pull_alerts (user_id, chain, token_address, top_holder_address, previous_pct, current_pct, sell_pct, alert_sent)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
          `).run(pos.user_id, pos.chain, pos.token_address, top, last.current_pct, currentPct, sellPct);
          alerts.push({ ...pos, top_holder_address: top, sellPct });
          await notify(bot, pos.user_id, `🚨 <b>Anti-Rug Alert</b>\n${pos.token_symbol || pos.token_address}\nTop holder dropped ${sellPct.toFixed(1)}% of observed supply.\nConsider /sell ${pos.token_address}`);
        } else if (!last) {
          getDb().prepare(`
            INSERT INTO rug_pull_alerts (user_id, chain, token_address, top_holder_address, previous_pct, current_pct, sell_pct)
            VALUES (?, ?, ?, ?, ?, ?, 0)
          `).run(pos.user_id, pos.chain, pos.token_address, top, currentPct, currentPct);
        }
      } catch (err) {
        console.error(`[AntiRug] ${pos.token_address}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[AntiRug] monitor:', err.message);
  } finally {
    isMonitoring = false;
  }
  return alerts;
}
