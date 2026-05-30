import { getDb } from '../utils/database.js';

const PRICE_ALERT_INTERVAL_MS = parseInt(process.env.PRICE_ALERT_INTERVAL_MS) || 15000;

async function notify(bot, userId, text) {
  try {
    await bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch {}
}

/**
 * Fetch token price via Dexscreener
 */
async function getTokenPrice(tokenAddress) {
  try {
    const axios = (await import('axios')).default;
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
      timeout: 8000,
    });
    const pair = res.data?.pairs?.[0];
    if (!pair?.priceUsd) return null;
    return parseFloat(pair.priceUsd);
  } catch {
    return null;
  }
}

/**
 * Add a price alert
 */
export function addPriceAlert(userId, chain, tokenAddress, tokenSymbol, targetPrice, condition, alertType) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO price_alerts (user_id, chain, token_address, token_symbol, target_price, condition, alert_type, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).run(userId, chain, tokenAddress, tokenSymbol, targetPrice, condition, alertType);
  return result.lastInsertRowid;
}

/**
 * List active alerts for a user
 */
export function getPriceAlerts(userId) {
  return getDb().prepare('SELECT * FROM price_alerts WHERE user_id = ? AND active = 1 ORDER BY created_at DESC').all(userId);
}

/**
 * Cancel an alert
 */
export function cancelPriceAlert(alertId, userId) {
  return getDb().prepare('UPDATE price_alerts SET active = 0 WHERE id = ? AND user_id = ? AND active = 1').run(alertId, userId).changes > 0;
}

/**
 * Get all active alerts (for monitor)
 */
function getActiveAlerts() {
  return getDb().prepare('SELECT * FROM price_alerts WHERE active = 1').all();
}

/**
 * Monitor price alerts
 */
async function priceAlertCycle(bot) {
  try {
    const alerts = getActiveAlerts();
    if (!alerts.length) return;

    // Deduplicate by address to avoid repeated API calls
    const addressSet = new Set(alerts.map(a => a.token_address));
    const priceCache = new Map();

    for (const addr of addressSet) {
      const price = await getTokenPrice(addr);
      if (price !== null) priceCache.set(addr, price);
    }

    for (const alert of alerts) {
      try {
        const price = priceCache.get(alert.token_address);
        if (price === null || price === undefined) continue;

        let triggered = false;
        if (alert.condition === 'above' && price >= alert.target_price) {
          triggered = true;
        } else if (alert.condition === 'below' && price <= alert.target_price) {
          triggered = true;
        }

        if (!triggered) continue;

        const condText = alert.condition === 'above' ? 'above' : 'below';
        const emoji = alert.condition === 'above' ? '🚀' : '📉';
        const msg = `🔔 <b>Price Alert</b>\n\n${emoji} <b>${alert.token_symbol || alert.token_address.slice(0, 10) + '...'}</b> is now <b>$${price.toExponential(4)}</b>\nTarget: ${condText} $${alert.target_price.toExponential(4)}\nChain: ${alert.chain}`;

        await notify(bot, alert.user_id, msg);

        // Update trigger time
        const db = getDb();
        db.prepare('UPDATE price_alerts SET triggered_at = datetime(\'now\') WHERE id = ?').run(alert.id);

        // For 'once' type, deactivate
        if (alert.alert_type === 'once') {
          db.prepare('UPDATE price_alerts SET active = 0 WHERE id = ?').run(alert.id);
        }

        console.log(`[PriceAlert] Alert #${alert.id} triggered: ${alert.token_symbol} $${price} (${condText} $${alert.target_price})`);
      } catch (err) {
        console.error(`[PriceAlert] Error on alert #${alert.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[PriceAlert] Cycle error:', err.message);
  }
}

/**
 * Start price alert monitor loop
 */
export function startPriceAlertMonitor(bot) {
  console.log(`[PriceAlert] Monitoring started (every ${PRICE_ALERT_INTERVAL_MS}ms)`);
  setInterval(() => priceAlertCycle(bot), PRICE_ALERT_INTERVAL_MS);
}
