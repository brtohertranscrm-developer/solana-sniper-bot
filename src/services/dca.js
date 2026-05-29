import { getDb } from '../utils/database.js';
import { getSavedWallets } from './wallet.js';
import { jupiterSwap } from './solana-swapper.js';
import { evmBuy } from './evm-swapper.js';
import { addPosition } from './portfolio.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
let isProcessing = false;

async function notify(bot, userId, text) {
  try { await bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML', disable_web_page_preview: true }); } catch {}
}

export function createDCAOrder(userId, chain, tokenAddress, totalAmount, slices, intervalSeconds, slippage = 10) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const info = getDb().prepare(`
      INSERT INTO dca_orders (user_id, chain, token_address, total_amount, slices, interval_seconds, slippage, next_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, chain, tokenAddress, totalAmount, slices, intervalSeconds, slippage, now);
    return info.lastInsertRowid;
  } catch (err) {
    console.error('[DCA] create:', err.message);
    return null;
  }
}

export function getActiveDCAOrders(userId) {
  try {
    return getDb().prepare("SELECT * FROM dca_orders WHERE user_id = ? AND status = 'active' ORDER BY id DESC").all(userId);
  } catch (err) {
    console.error('[DCA] list:', err.message);
    return [];
  }
}

export function cancelDCAOrder(orderId) {
  try {
    return getDb().prepare("UPDATE dca_orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(orderId).changes > 0;
  } catch (err) {
    console.error('[DCA] cancel:', err.message);
    return false;
  }
}

export async function processDCAOrders(bot) {
  if (isProcessing) return [];
  isProcessing = true;
  const done = [];
  try {
    const now = Math.floor(Date.now() / 1000);
    const orders = getDb().prepare("SELECT * FROM dca_orders WHERE status = 'active' AND next_run_at <= ?").all(now);
    for (const order of orders) {
      try {
        const remaining = order.slices - order.executed_slices;
        if (remaining <= 0) {
          getDb().prepare("UPDATE dca_orders SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(order.id);
          continue;
        }
        const amount = order.total_amount / order.slices;
        const wallets = getSavedWallets(order.chain);
        const wallet = wallets[0];
        if (!wallet?.private_key) {
          await notify(bot, order.user_id, `⚠️ DCA #${order.id} skipped: missing ${order.chain} wallet/private key.`);
          continue;
        }

        let result;
        if (order.chain === 'solana') {
          result = await jupiterSwap({
            inputMint: SOL_MINT,
            outputMint: order.token_address,
            amount: Math.floor(amount * 1_000_000_000),
            slippageBps: Math.floor(order.slippage * 100),
            walletPublicKey: wallet.address,
            walletPrivateKey: wallet.private_key,
          });
        } else {
          result = await evmBuy({
            chain: order.chain,
            tokenAddress: order.token_address,
            amountInNative: amount,
            walletPrivateKey: wallet.private_key,
            slippageBps: Math.floor(order.slippage * 100),
          });
        }

        const nextRun = now + order.interval_seconds;
        const newExecuted = order.executed_slices + 1;
        const status = newExecuted >= order.slices ? 'completed' : 'active';
        getDb().prepare(`
          UPDATE dca_orders
          SET executed_slices = ?, amount_executed = amount_executed + ?, next_run_at = ?, status = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(newExecuted, amount, nextRun, status, order.id);
        addPosition({
          user_id: order.user_id,
          chain: order.chain,
          token_address: order.token_address,
          token_symbol: 'DCA',
          buy_amount_native: amount,
          buy_amount_token: null,
          buy_price: amount,
          txid: result.txid,
          tp_pct: 200,
          sl_pct: -30,
        });
        done.push({ order, result });
        await notify(bot, order.user_id, `🧩 <b>DCA Filled</b>\nOrder #${order.id} slice ${newExecuted}/${order.slices}\nTX: <code>${result.txid}</code>`);
      } catch (err) {
        console.error(`[DCA] order ${order.id}:`, err.message);
        await notify(bot, order.user_id, `⚠️ DCA #${order.id} failed: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[DCA] process:', err.message);
  } finally {
    isProcessing = false;
  }
  return done;
}
