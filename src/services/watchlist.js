import { getDb } from '../utils/database.js';

const WATCHLIST_INTERVAL_MS = parseInt(process.env.WATCHLIST_INTERVAL_MS) || 60000;
const ALERT_THRESHOLD_PCT = 20; // Alert if >20% change in 1 hour

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
 * Add token to watchlist
 */
export function addToWatchlist(userId, chain, tokenAddress, tokenSymbol, notes) {
  const db = getDb();

  // Get current price
  // Note: we'll set added_price to 0 and let the monitor fill it
  const result = db.prepare(`
    INSERT INTO watchlist (user_id, chain, token_address, token_symbol, added_price, notes, active, created_at)
    VALUES (?, ?, ?, ?, 0, ?, 1, datetime('now'))
  `).run(userId, chain, tokenAddress, tokenSymbol, notes || null);
  return result.lastInsertRowid;
}

/**
 * List active watchlist for a user
 */
export function getWatchlist(userId) {
  return getDb().prepare('SELECT * FROM watchlist WHERE user_id = ? AND active = 1 ORDER BY created_at DESC').all(userId);
}

/**
 * Remove from watchlist
 */
export function removeFromWatchlist(id, userId) {
  return getDb().prepare('UPDATE watchlist SET active = 0 WHERE id = ? AND user_id = ? AND active = 1').run(id, userId).changes > 0;
}

/**
 * Update watchlist entry price
 */
function updateWatchlistPrice(id, price) {
  const db = getDb();
  // If added_price is 0, set it (first price check)
  const current = db.prepare('SELECT added_price FROM watchlist WHERE id = ?').get(id);
  if (current && current.added_price === 0) {
    db.prepare('UPDATE watchlist SET added_price = ?, last_checked = datetime(\'now\') WHERE id = ?').run(price, id);
  } else {
    db.prepare('UPDATE watchlist SET last_checked = datetime(\'now\') WHERE id = ?').run(id);
  }
}

/**
 * Get all active watchlist entries
 */
function getActiveWatchlist() {
  return getDb().prepare('SELECT * FROM watchlist WHERE active = 1').all();
}

/**
 * Key-value helpers for alert dedup tracking
 */
function getAlertSent(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM key_value_store WHERE key = ?').get(key);
  if (!row) return false;
  const ts = parseInt(row.value);
  // Don't re-alert within 1 hour
  return (Date.now() - ts) < 3600000;
}

function setAlertSent(key) {
  const db = getDb();
  db.prepare(`
    INSERT INTO key_value_store (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, Date.now().toString());
}

/**
 * Monitor watchlist
 */
async function watchlistCycle(bot) {
  try {
    const entries = getActiveWatchlist();
    if (!entries.length) return;

    // Deduplicate by address
    const addressSet = new Set(entries.map(e => e.token_address));
    const priceCache = new Map();

    for (const addr of addressSet) {
      const price = await getTokenPrice(addr);
      if (price !== null) priceCache.set(addr, price);
    }

    for (const entry of entries) {
      try {
        const price = priceCache.get(entry.token_address);
        if (price === null || price === undefined) continue;

        // Update first-time added_price
        updateWatchlistPrice(entry.id, price);

        // Check for significant price change if we have added_price
        if (entry.added_price > 0) {
          const changePct = ((price - entry.added_price) / entry.added_price) * 100;

          if (Math.abs(changePct) >= ALERT_THRESHOLD_PCT) {
            const alertKey = `watchlist_alert_${entry.id}`;
            if (!getAlertSent(alertKey)) {
              const direction = changePct > 0 ? '🚀' : '📉';
              const symbol = entry.token_symbol || entry.token_address.slice(0, 10) + '...';
              await notify(
                bot,
                entry.user_id,
                `👀 <b>Watchlist Alert</b>\n\n${direction} <b>${symbol}</b>\n` +
                `Added: $${entry.added_price.toExponential(4)} → Now: $${price.toExponential(4)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%)\n` +
                `Chain: ${entry.chain}` +
                (entry.notes ? `\nNote: ${entry.notes}` : '')
              );
              setAlertSent(alertKey);
            }
          }
        }
      } catch (err) {
        console.error(`[Watchlist] Error on entry #${entry.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Watchlist] Cycle error:', err.message);
  }
}

/**
 * Format watchlist for display with current prices
 */
export async function formatWatchlistDisplay(userId) {
  const entries = getWatchlist(userId);
  if (!entries.length) return null;

  // Batch fetch prices
  const addressSet = new Set(entries.map(e => e.token_address));
  const priceCache = new Map();
  for (const addr of addressSet) {
    const price = await getTokenPrice(addr);
    if (price !== null) priceCache.set(addr, price);
  }

  const CE = { solana: '◎', bsc: '🔶', eth: '⟠' };
  const fmtP = (n) => n === 0 ? 'N/A' : n.toExponential(4);

  let text = `👀 <b>Watchlist</b>\n\n`;
  entries.forEach((e, i) => {
    const currentPrice = priceCache.get(e.token_address);
    const sym = e.token_symbol || e.token_address.slice(0, 10) + '...';

    text += `${i + 1}. ${CE[e.chain] || ''} <b>${sym}</b>`;
    if (currentPrice !== null && currentPrice !== undefined) {
      const change = e.added_price > 0 ? ((currentPrice - e.added_price) / e.added_price * 100) : 0;
      const changeStr = change > 0 ? `+${change.toFixed(1)}%` : change < 0 ? `${change.toFixed(1)}%` : '';
      text += `\n   Added: $${fmtP(e.added_price)} → Now: $${fmtP(currentPrice)} ${changeStr}`;
    } else {
      text += `\n   Added: $${fmtP(e.added_price)} → Now: fetching...`;
    }
    if (e.notes) text += `\n   📝 ${e.notes}`;
    text += `\n   /unwatch ${e.id}\n\n`;
  });

  text += `/watch <token> [note] — add\n/watchlist — refresh`;
  return text;
}

/**
 * Start watchlist monitor loop
 */
export function startWatchlistMonitor(bot) {
  console.log(`[Watchlist] Monitoring started (every ${WATCHLIST_INTERVAL_MS}ms)`);
  setInterval(() => watchlistCycle(bot), WATCHLIST_INTERVAL_MS);
}
