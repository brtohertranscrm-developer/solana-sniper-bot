import { getDb } from '../utils/database.js';
import { getActiveWallet } from './multi-wallet.js';
import { jupiterSwap, jupiterSell } from './solana-swapper.js';
import { evmBuy, evmSell } from './evm-swapper.js';
import { addPosition } from './portfolio.js';

const LIMIT_ORDER_INTERVAL_MS = parseInt(process.env.LIMIT_ORDER_INTERVAL_MS) || 15000;
const SOL_MINT = 'So11111111111111111111111111111111111111112';

async function notify(bot, userId, text) {
  try {
    await bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch {}
}

/**
 * Fetch current price via Dexscreener
 */
async function getTokenPrice(tokenAddress) {
  try {
    const axios = (await import('axios')).default;
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
      timeout: 5000,
    });
    const pair = res.data?.pairs?.[0];
    if (!pair?.priceUsd) return null;
    return parseFloat(pair.priceUsd);
  } catch {
    return null;
  }
}

/**
 * Create a limit order
 */
export function createLimitOrder(userId, chain, tokenAddress, side, targetPrice, amount, slippage = 10) {
  const result = getDb().prepare(`
    INSERT INTO limit_orders (user_id, chain, token_address, side, target_price, amount, slippage, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
  `).run(userId, chain, tokenAddress, side, targetPrice, amount, slippage);
  return result.lastInsertRowid;
}

/**
 * List pending limit orders for a user
 */
export function getLimitOrders(userId, status = null) {
  if (status) {
    return getDb().prepare('SELECT * FROM limit_orders WHERE user_id = ? AND status = ? ORDER BY created_at DESC').all(userId, status);
  }
  return getDb().prepare('SELECT * FROM limit_orders WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

/**
 * Cancel a limit order
 */
export function cancelLimitOrder(orderId, userId) {
  return getDb().prepare("UPDATE limit_orders SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending'").run(orderId, userId).changes > 0;
}

/**
 * Get all pending orders (for monitor)
 */
function getPendingOrders() {
  return getDb().prepare("SELECT * FROM limit_orders WHERE status = 'pending'").all();
}

/**
 * Execute a filled limit buy order
 */
async function executeLimitBuy(order, currentPrice) {
  const wallet = getActiveWallet(order.chain);
  if (!wallet || !wallet.privateKey) {
    throw new Error(`No wallet for ${order.chain}`);
  }

  let result;
  const slipBps = Math.floor(order.slippage * 100);

  if (order.chain === 'solana') {
    result = await jupiterSwap({
      inputMint: SOL_MINT,
      outputMint: order.token_address,
      amount: Math.floor(order.amount * 1e9),
      slippageBps: slipBps,
      walletPublicKey: wallet.address,
      walletPrivateKey: wallet.privateKey,
    });
  } else {
    result = await evmBuy({
      chain: order.chain,
      tokenAddress: order.token_address,
      amountInNative: order.amount,
      walletPrivateKey: wallet.privateKey,
      slippageBps: slipBps,
    });
  }

  addPosition({
    user_id: order.user_id,
    chain: order.chain,
    token_address: order.token_address,
    token_symbol: 'TOKEN',
    buy_amount_native: order.amount,
    buy_price: currentPrice,
    txid: result.txid,
    tp_pct: 200,
    sl_pct: -30,
  });

  return result;
}

/**
 * Execute a filled limit sell order
 */
async function executeLimitSell(order, currentPrice) {
  const wallet = getActiveWallet(order.chain);
  if (!wallet || !wallet.privateKey) {
    throw new Error(`No wallet for ${order.chain}`);
  }

  const slipBps = Math.floor(order.slippage * 100);
  let result;

  if (order.chain === 'solana') {
    const { getTokenBalance } = await import('./solana-swapper.js');
    const bal = await getTokenBalance(order.token_address, wallet.address);
    if (!bal || bal === 0) throw new Error('No token balance to sell');
    result = await jupiterSell({
      tokenMint: order.token_address,
      tokenAmount: bal.toString(),
      walletPublicKey: wallet.address,
      walletPrivateKey: wallet.privateKey,
      slippageBps: slipBps,
    });
  } else {
    result = await evmSell({
      chain: order.chain,
      tokenAddress: order.token_address,
      walletPrivateKey: wallet.privateKey,
      slippageBps: slipBps,
    });
  }

  // Close any open position for this token
  const pos = getDb().prepare("SELECT id, buy_amount_token FROM portfolios WHERE user_id = ? AND token_address = ? AND status = 'holding' ORDER BY id DESC LIMIT 1").get(order.user_id, order.token_address);
  if (pos) {
    const { closePosition } = await import('./portfolio.js');
    closePosition(pos.id, currentPrice, pos.buy_amount_token || 0);
  }

  return result;
}

/**
 * Monitor and fill limit orders
 */
async function limitOrderCycle(bot) {
  try {
    const orders = getPendingOrders();
    if (!orders.length) return;

    for (const order of orders) {
      try {
        const currentPrice = await getTokenPrice(order.token_address);
        if (!currentPrice) continue;

        let shouldFill = false;

        if (order.side === 'buy' && currentPrice <= order.target_price) {
          shouldFill = true;
        } else if (order.side === 'sell' && currentPrice >= order.target_price) {
          shouldFill = true;
        }

        if (!shouldFill) continue;

        console.log(`[LimitOrder] Filling #${order.id}: ${order.side} ${order.token_address} @ ${order.target_price} (current: ${currentPrice})`);

        let result;
        if (order.side === 'buy') {
          result = await executeLimitBuy(order, currentPrice);
        } else {
          result = await executeLimitSell(order, currentPrice);
        }

        // Update order status
        getDb().prepare(`
          UPDATE limit_orders SET status = 'filled', filled_at = datetime('now'), txid = ? WHERE id = ?
        `).run(result.txid, order.id);

        const chainEmoji = { solana: '◎', bsc: '🔶', eth: '⟠' }[order.chain] || '';
        await notify(
          bot,
          order.user_id,
          `${chainEmoji} <b>Limit ${order.side.toUpperCase()} Filled</b>\n` +
          `Order #${order.id}\n` +
          `Target: ${order.target_price} | Actual: ${currentPrice}\n` +
          `Amount: ${order.amount}\n` +
          `TX: <code>${result.txid}</code>`
        );
      } catch (err) {
        console.error(`[LimitOrder] Error on #${order.id}:`, err.message);
        // Don't cancel on error — retry next cycle
        await notify(bot, order.user_id, `❌ Limit order #${order.id} execution failed: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[LimitOrder] Cycle error:', err.message);
  }
}

/**
 * Start limit order monitor loop
 */
export function startLimitOrderMonitor(bot) {
  console.log(`[LimitOrder] Monitoring started (every ${LIMIT_ORDER_INTERVAL_MS}ms)`);
  setInterval(() => limitOrderCycle(bot), LIMIT_ORDER_INTERVAL_MS);
}
