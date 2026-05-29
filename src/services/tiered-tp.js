import { getDb } from '../utils/database.js';
import { getTokenPriceSOL } from './solana-swapper.js';

export function setTieredTP(userId, chain, tokenAddress, tiers) {
  try {
    const clean = Array.isArray(tiers) ? tiers : [];
    getDb().prepare(`
      INSERT INTO tiered_tp (user_id, chain, token_address, tiers_json, triggered_json, active, updated_at)
      VALUES (?, ?, ?, ?, '[]', 1, datetime('now'))
      ON CONFLICT(user_id, chain, token_address) DO UPDATE SET
        tiers_json = excluded.tiers_json,
        active = 1,
        updated_at = datetime('now')
    `).run(userId, chain, tokenAddress, JSON.stringify(clean));
    return true;
  } catch (err) {
    console.error('[TieredTP] set:', err.message);
    return false;
  }
}

async function getCurrentPrice(pos) {
  if (pos.chain === 'solana') return getTokenPriceSOL(pos.token_address);
  try {
    const axios = (await import('axios')).default;
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.token_address}`, { timeout: 10000 });
    return parseFloat(res.data?.pairs?.[0]?.priceUsd || 0);
  } catch {
    return null;
  }
}

export async function checkTieredTP(bot) {
  const triggers = [];
  try {
    const configs = getDb().prepare('SELECT * FROM tiered_tp WHERE active = 1').all();
    for (const cfg of configs) {
      try {
        const pos = getDb().prepare(`
          SELECT * FROM portfolios
          WHERE user_id = ? AND chain = ? AND token_address = ? AND status = 'holding'
          ORDER BY id DESC LIMIT 1
        `).get(cfg.user_id, cfg.chain, cfg.token_address);
        if (!pos?.buy_price) continue;
        const current = await getCurrentPrice(pos);
        if (!current) continue;
        const pct = ((current - pos.buy_price) / pos.buy_price) * 100;
        const tiers = JSON.parse(cfg.tiers_json || '[]');
        const triggered = new Set(JSON.parse(cfg.triggered_json || '[]'));
        const newly = tiers.filter(t => pct >= Number(t.pct) && !triggered.has(Number(t.pct)));
        if (!newly.length) continue;
        newly.forEach(t => triggered.add(Number(t.pct)));
        getDb().prepare('UPDATE tiered_tp SET triggered_json = ?, updated_at = datetime(\'now\') WHERE id = ?').run(JSON.stringify([...triggered]), cfg.id);
        for (const tier of newly) {
          triggers.push({ cfg, pos, tier, pct });
          try {
            await bot.telegram.sendMessage(cfg.user_id, `🎯 <b>Tiered TP Hit</b>\n${pos.token_symbol || pos.token_address}\n+${pct.toFixed(1)}% hit tier ${tier.pct}%\nSell ${tier.sellPct}%: /sell ${pos.token_address}`, { parse_mode: 'HTML' });
          } catch {}
        }
      } catch (err) {
        console.error(`[TieredTP] cfg ${cfg.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[TieredTP] check:', err.message);
  }
  return triggers;
}
