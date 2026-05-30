import { getDb } from '../utils/database.js';
import { getActiveWallet } from './multi-wallet.js';
import { jupiterSell } from './solana-swapper.js';
import { evmSell } from './evm-swapper.js';
import { getTokenPriceSOL } from './solana-swapper.js';
import { closePosition } from './portfolio.js';

const AUTO_SELL_INTERVAL_MS = parseInt(process.env.AUTO_SELL_INTERVAL_MS) || 30000;

async function notify(bot, userId, text) {
  try {
    await bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch {}
}

function isAutoSellEnabled(userId) {
  const row = getDb().prepare('SELECT enabled FROM auto_sell_config WHERE user_id = ?').get(userId);
  return row ? row.enabled === 1 : false;
}

export function setAutoSell(userId, enabled) {
  getDb().prepare(`
    INSERT INTO auto_sell_config (user_id, enabled)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled
  `).run(userId, enabled ? 1 : 0);
}

export function getAutoSellStatus(userId) {
  const row = getDb().prepare('SELECT enabled FROM auto_sell_config WHERE user_id = ?').get(userId);
  return row ? row.enabled === 1 : false;
}

/**
 * Get current price for a token
 */
async function getCurrentPrice(chain, tokenAddress) {
  try {
    if (chain === 'solana') {
      return await getTokenPriceSOL(tokenAddress);
    }

    // EVM: use Dexscreener
    const axios = (await import('axios')).default;
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
      timeout: 5000,
    });
    const pair = res.data?.pairs?.[0];
    if (pair?.priceUsd) {
      return parseFloat(pair.priceUsd);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Execute a sell for a position
 */
async function executeAutoSell(pos, bot) {
  const chain = pos.chain;
  const tokenAddress = pos.token_address;

  try {
    const wallet = getActiveWallet(chain);
    if (!wallet || !wallet.privateKey) {
      await notify(bot, pos.user_id, `⚠️ Auto-sell skipped: no wallet for ${chain}`);
      return false;
    }

    let result;
    if (chain === 'solana') {
      const { getTokenBalance } = await import('./solana-swapper.js');
      const bal = await getTokenBalance(tokenAddress, wallet.address);
      if (!bal || bal === 0) {
        // No balance — close as 0
        closePosition(pos.id, 0, 0);
        await notify(bot, pos.user_id, `⚠️ Auto-sell: ${pos.token_symbol || tokenAddress} has 0 balance, closed.`);
        return true;
      }
      result = await jupiterSell({
        tokenMint: tokenAddress,
        tokenAmount: bal.toString(),
        walletPublicKey: wallet.address,
        walletPrivateKey: wallet.privateKey,
        slippageBps: 1000, // 10% slippage for auto-sell
      });
    } else {
      result = await evmSell({
        chain,
        tokenAddress,
        walletPrivateKey: wallet.privateKey,
        slippageBps: 1000,
      });
    }

    // Update position to sold
    const closed = closePosition(pos.id, pos.currentPrice || 0, pos.buy_amount_token || 0);

    const pnlEmoji = (closed.pnlPct || 0) >= 0 ? '🟢' : '🔴';
    await notify(
      bot,
      pos.user_id,
      `${pnlEmoji} <b>Auto-Sell (${pos.sellReason || 'TP/SL'})</b>\n` +
      `${pos.token_symbol || tokenAddress.slice(0, 12)}...\n` +
      `PnL: ${closed.pnlPct >= 0 ? '+' : ''}${closed.pnlPct.toFixed(2)}%\n` +
      `TX: <code>${result.txid}</code>`
    );

    return true;
  } catch (err) {
    console.error(`[AutoSell] Sell failed for ${tokenAddress}: ${err.message}`);
    await notify(bot, pos.user_id, `❌ Auto-sell failed for ${pos.token_symbol || tokenAddress.slice(0, 12)}: ${err.message}`);
    return false;
  }
}

/**
 * Run one auto-sell monitoring cycle
 */
async function autoSellCycle(bot) {
  try {
    const positions = getDb().prepare("SELECT * FROM portfolios WHERE status = 'holding'").all();
    if (!positions.length) return;

    for (const pos of positions) {
      try {
        if (!isAutoSellEnabled(pos.user_id)) continue;

        const currentPrice = await getCurrentPrice(pos.chain, pos.token_address);
        if (!currentPrice || !pos.buy_price || pos.buy_price === 0) continue;

        const pctChange = ((currentPrice - pos.buy_price) / pos.buy_price) * 100;

        let reason = null;
        if (pos.tp_pct && pctChange >= pos.tp_pct) {
          reason = 'TP HIT';
        } else if (pos.sl_pct && pctChange <= pos.sl_pct) {
          reason = 'SL HIT';
        }

        if (reason) {
          console.log(`[AutoSell] ${reason}: ${pos.token_symbol} (${pos.token_address}) ${pctChange.toFixed(1)}% | User: ${pos.user_id}`);
          await executeAutoSell({ ...pos, currentPrice, sellReason: reason }, bot);
        }
      } catch (err) {
        console.error(`[AutoSell] Error checking position #${pos.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[AutoSell] Cycle error:', err.message);
  }
}

/**
 * Start auto-sell monitor loop
 */
export function startAutoSell(bot) {
  console.log(`[AutoSell] Monitoring started (every ${AUTO_SELL_INTERVAL_MS}ms)`);
  setInterval(() => autoSellCycle(bot), AUTO_SELL_INTERVAL_MS);
}
