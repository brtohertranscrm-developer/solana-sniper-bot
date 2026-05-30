import { getDb } from '../utils/database.js';

const NEW_PAIR_INTERVAL_MS = parseInt(process.env.NEW_PAIR_INTERVAL_MS) || 30000; // 30s
const MAX_PAIR_AGE_MS = 120000; // 2 minutes
const ALERT_COOLDOWN_MS = 1800000; // 30 min cooldown per token per user

const CHAINS = ['solana', 'bsc'];
const chainEmojis = { solana: '◎', bsc: '🔶', eth: '⟠' };

async function notify(bot, userId, text) {
  try {
    await bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch {}
}

/**
 * Check if new pair sniper is enabled for a user
 */
export function isNewPairEnabled(userId) {
  const row = getDb().prepare('SELECT enabled FROM new_pair_settings WHERE user_id = ?').get(userId);
  return row ? row.enabled === 1 : false;
}

/**
 * Toggle new pair sniper for a user
 */
export function setNewPairEnabled(userId, enabled) {
  getDb().prepare(`
    INSERT INTO new_pair_settings (user_id, enabled)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled
  `).run(userId, enabled ? 1 : 0);
}

/**
 * Get new pair filters for a user
 */
export function getNewPairFilters(userId) {
  const row = getDb().prepare('SELECT min_liquidity, max_age_seconds FROM new_pair_settings WHERE user_id = ?').get(userId);
  return {
    minLiquidity: row?.min_liquidity || 100,
    maxAgeSeconds: row?.max_age_seconds || 120,
  };
}

/**
 * Set new pair filters
 */
export function setNewPairFilters(userId, minLiquidity, maxAgeSeconds) {
  getDb().prepare(`
    INSERT INTO new_pair_settings (user_id, enabled, min_liquidity, max_age_seconds)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET min_liquidity = excluded.min_liquidity, max_age_seconds = excluded.max_age_seconds
  `).run(userId, minLiquidity, maxAgeSeconds);
}

/**
 * Check if we already alerted for this token/user combo recently
 */
function wasAlertedRecently(userId, chain, tokenAddress) {
  const cutoff = Date.now() - ALERT_COOLDOWN_MS;
  const row = getDb().prepare(
    "SELECT 1 FROM new_pair_alerts WHERE user_id = ? AND chain = ? AND token_address = ? AND alerted_at > ?"
  ).get(userId, chain, tokenAddress, new Date(cutoff).toISOString());
  return !!row;
}

/**
 * Record an alert to prevent duplicate
 */
function recordAlert(userId, chain, tokenAddress) {
  getDb().prepare(`
    INSERT INTO new_pair_alerts (user_id, chain, token_address, alerted_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(userId, chain, tokenAddress);
}

/**
 * Fetch new pairs from Dexscreener for a chain
 */
async function fetchNewPairs(chainId) {
  try {
    const axios = (await import('axios')).default;
    const res = await axios.get(`https://api.dexscreener.com/latest/new-pairs?chainId=${chainId}`, {
      timeout: 10000,
    });
    return res.data?.pairs || [];
  } catch (err) {
    console.error(`[NewPairSniper] Fetch error for ${chainId}:`, err.message);
    return [];
  }
}

/**
 * Check basic safety: not zero liquidity, not rug
 */
function passesBasicSafety(pair) {
  if (!pair) return false;
  const liq = pair.liquidity?.usd || pair.liquidity?.base || 0;
  if (liq <= 0) return false;
  if (pair.pairCreatedAt) {
    const age = Date.now() - pair.pairCreatedAt;
    if (age > MAX_PAIR_AGE_MS) return false;
  }
  return true;
}

/**
 * Run one new pair detection cycle
 */
async function newPairCycle(bot) {
  try {
    // Get all users with new pair enabled
    const users = getDb().prepare('SELECT user_id FROM new_pair_settings WHERE enabled = 1').all();
    if (!users.length) return;

    for (const chainId of CHAINS) {
      try {
        const pairs = await fetchNewPairs(chainId);
        if (!pairs.length) continue;

        for (const pair of pairs) {
          if (!passesBasicSafety(pair)) continue;

          // Use base token as the "new" token
          const tokenAddress = pair.baseToken?.address;
          const tokenSymbol = pair.baseToken?.symbol || 'UNKNOWN';

          if (!tokenAddress) continue;

          for (const user of users) {
            try {
              const userId = user.user_id;
              if (wasAlertedRecently(userId, chainId, tokenAddress)) continue;

              // Check user's filters
              const filters = getNewPairFilters(userId);
              const liq = pair.liquidity?.usd || pair.liquidity?.base || 0;
              if (liq < filters.minLiquidity) continue;

              // Build alert
              const priceUsd = pair.priceUsd || pair.priceNative || '?';
              const mc = pair.fdv || pair.marketCap || '?';
              const liqStr = typeof liq === 'number' ? (liq > 1000 ? `$${(liq/1000).toFixed(1)}K` : `$${liq.toFixed(0)}`) : '?';

              // Calculate age
              let ageStr = '?';
              if (pair.pairCreatedAt) {
                const ageSec = Math.floor((Date.now() - pair.pairCreatedAt) / 1000);
                ageStr = ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec/60)}m ${ageSec%60}s`;
              }

              const mcStr = typeof mc === 'number' ?
                (mc >= 1000000 ? `$${(mc/1000000).toFixed(2)}M` :
                 mc >= 1000 ? `$${(mc/1000).toFixed(1)}K` : `$${mc.toFixed(0)}`) : '?';

              const shortAddr = tokenAddress.slice(0, 12);

              let alert = `🆕 <b>New Pair Detected!</b>\n`;
              alert += `Chain: ${chainId.charAt(0).toUpperCase() + chainId.slice(1)}\n`;
              alert += `Token: ${tokenSymbol} (<code>${shortAddr}...</code>)\n`;
              alert += `Price: $${priceUsd} | MC: ${mcStr} | Liq: ${liqStr}\n`;
              alert += `Age: ${ageStr}\n`;
              alert += `/analyze_${tokenAddress} for full analysis\n`;
              alert += `/buy ${tokenAddress} 0.08 15 to buy`;

              await notify(bot, userId, alert);
              recordAlert(userId, chainId, tokenAddress);
            } catch (err) {
              console.error(`[NewPairSniper] Alert error for user ${user.user_id}:`, err.message);
            }
          }
        }
      } catch (err) {
        console.error(`[NewPairSniper] Chain ${chainId} error:`, err.message);
      }
    }
  } catch (err) {
    console.error('[NewPairSniper] Cycle error:', err.message);
  }
}

/**
 * Start new pair sniper monitor
 */
export function startNewPairSniper(bot) {
  console.log(`[NewPairSniper] Monitoring started (every ${NEW_PAIR_INTERVAL_MS}ms, chains: ${CHAINS.join(', ')})`);
  setInterval(() => newPairCycle(bot), NEW_PAIR_INTERVAL_MS);
}
