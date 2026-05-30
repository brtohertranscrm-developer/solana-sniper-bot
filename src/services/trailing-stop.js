import { getDb } from '../utils/database.js';
import { getActiveWallet } from './multi-wallet.js';
import { jupiterSell, getTokenPriceSOL } from './solana-swapper.js';
import { evmSell } from './evm-swapper.js';
import { closePosition } from './portfolio.js';

const TRAILING_STOP_INTERVAL_MS = parseInt(process.env.TRAILING_STOP_INTERVAL_MS) || 20000;

async function notify(bot, userId, text) {
  try {
    await bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch {}
}

/**
 * Add a trailing stop for a position
 */
export function addTrailingStop(userId, chain, tokenAddress, trailPct) {
  const db = getDb();
  // Check if there's already an active trailing stop for this token+user
  const existing = db.prepare(
    "SELECT id FROM trailing_stops WHERE user_id = ? AND token_address = ? AND active = 1"
  ).get(userId, tokenAddress);

  if (existing) {
    // Update existing
    db.prepare(
      "UPDATE trailing_stops SET trail_pct = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(trailPct, existing.id);
    return existing.id;
  }

  // Find matching open position
  const pos = db.prepare(
    "SELECT id FROM portfolios WHERE user_id = ? AND token_address = ? AND status = 'holding' ORDER BY id DESC LIMIT 1"
  ).get(userId, tokenAddress);

  const result = db.prepare(`
    INSERT INTO trailing_stops (user_id, position_id, chain, token_address, trail_pct, highest_price, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 1, datetime('now'), datetime('now'))
  `).run(userId, pos?.id || null, chain, tokenAddress, trailPct);

  return result.lastInsertRowid;
}

/**
 * Disable a trailing stop
 */
export function disableTrailingStop(userId, tokenAddress) {
  const db = getDb();
  return db.prepare(
    "UPDATE trailing_stops SET active = 0, updated_at = datetime('now') WHERE user_id = ? AND token_address = ? AND active = 1"
  ).run(userId, tokenAddress).changes > 0;
}

/**
 * List active trailing stops for a user
 */
export function getActiveTrailingStops(userId) {
  return getDb().prepare(
    "SELECT * FROM trailing_stops WHERE user_id = ? AND active = 1 ORDER BY created_at DESC"
  ).all(userId);
}

/**
 * Get current price for a token (returns price in SOL for solana, USD for EVM)
 */
async function getCurrentPrice(chain, tokenAddress) {
  try {
    if (chain === 'solana') {
      return await getTokenPriceSOL(tokenAddress);
    }
    // EVM: use Dexscreener
    const axios = (await import('axios')).default;
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, { timeout: 5000 });
    const pair = res.data?.pairs?.[0];
    if (pair?.priceUsd) return parseFloat(pair.priceUsd);
    return null;
  } catch {
    return null;
  }
}

/**
 * Execute sell for trailing stop trigger
 */
async function executeTrailingSell(ts, currentPrice, bot) {
  try {
    const wallet = getActiveWallet(ts.chain);
    if (!wallet || !wallet.privateKey) {
      await notify(bot, ts.user_id, `⚠️ Trailing stop skipped: no wallet for ${ts.chain}`);
      return;
    }

    let result;
    if (ts.chain === 'solana') {
      const { getTokenBalance } = await import('./solana-swapper.js');
      const bal = await getTokenBalance(ts.token_address, wallet.address);
      if (!bal || bal === 0) {
        // No balance — mark inactive
        getDb().prepare("UPDATE trailing_stops SET active = 0, updated_at = datetime('now') WHERE id = ?").run(ts.id);
        await notify(bot, ts.user_id, `⚠️ Trailing stop: ${ts.token_address.slice(0, 12)} has 0 balance, removed.`);
        return;
      }
      result = await jupiterSell({
        tokenMint: ts.token_address,
        tokenAmount: bal.toString(),
        walletPublicKey: wallet.address,
        walletPrivateKey: wallet.privateKey,
        slippageBps: 1500, // 15% for trailing stop urgency
      });
    } else {
      result = await evmSell({
        chain: ts.chain,
        tokenAddress: ts.token_address,
        walletPrivateKey: wallet.privateKey,
        slippageBps: 1500,
      });
    }

    // Close position if exists
    const pos = getDb().prepare(
      "SELECT id, buy_amount_token FROM portfolios WHERE user_id = ? AND token_address = ? AND status = 'holding' ORDER BY id DESC LIMIT 1"
    ).get(ts.user_id, ts.token_address);

    if (pos) {
      closePosition(pos.id, currentPrice, pos.buy_amount_token || 0);
    }

    // Mark trailing stop as inactive
    getDb().prepare("UPDATE trailing_stops SET active = 0, updated_at = datetime('now') WHERE id = ?").run(ts.id);

    const dropPct = ts.highest_price > 0 ? (((ts.highest_price - currentPrice) / ts.highest_price) * 100).toFixed(1) : '?';
    await notify(
      bot,
      ts.user_id,
      `📉 <b>Trailing Stop Triggered</b>\n` +
      `Token: <code>${ts.token_address.slice(0, 12)}...</code>\n` +
      `Highest: ${ts.highest_price.toExponential(4)}\n` +
      `Current: ${currentPrice.toExponential(4)}\n` +
      `Drop: ${dropPct}% (trail: ${ts.trail_pct}%)\n` +
      `TX: <code>${result.txid}</code>`
    );

    console.log(`[TrailingStop] Triggered for ${ts.token_address}: highest=${ts.highest_price} current=${currentPrice}`);
  } catch (err) {
    console.error(`[TrailingStop] Sell failed for ${ts.token_address}:`, err.message);
    await notify(bot, ts.user_id, `❌ Trailing stop sell failed: ${err.message}`);
  }
}

/**
 * Run one trailing stop monitoring cycle
 */
async function trailingStopCycle(bot) {
  try {
    const stops = getDb().prepare("SELECT * FROM trailing_stops WHERE active = 1").all();
    if (!stops.length) return;

    for (const ts of stops) {
      try {
        const currentPrice = await getCurrentPrice(ts.chain, ts.token_address);
        if (!currentPrice) continue;

        // Initialize highest_price if 0
        if (ts.highest_price === 0) {
          getDb().prepare("UPDATE trailing_stops SET highest_price = ?, updated_at = datetime('now') WHERE id = ?").run(currentPrice, ts.id);
          continue;
        }

        // Update highest price if current is higher
        if (currentPrice > ts.highest_price) {
          getDb().prepare("UPDATE trailing_stops SET highest_price = ?, updated_at = datetime('now') WHERE id = ?").run(currentPrice, ts.id);
          continue;
        }

        // Check if price dropped below threshold
        const threshold = ts.highest_price * (1 - ts.trail_pct / 100);
        if (currentPrice <= threshold) {
          await executeTrailingSell(ts, currentPrice, bot);
        }
      } catch (err) {
        console.error(`[TrailingStop] Error checking ${ts.token_address}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[TrailingStop] Cycle error:', err.message);
  }
}

/**
 * Start trailing stop monitor loop
 */
export function startTrailingStopMonitor(bot) {
  console.log(`[TrailingStop] Monitoring started (every ${TRAILING_STOP_INTERVAL_MS}ms)`);
  setInterval(() => trailingStopCycle(bot), TRAILING_STOP_INTERVAL_MS);
}
