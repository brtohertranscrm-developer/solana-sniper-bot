import { getDb } from '../utils/database.js';
import { getSavedWallets } from './wallet.js';
import { jupiterSwap } from './solana-swapper.js';
import { evmBuy } from './evm-swapper.js';
import { addPosition } from './portfolio.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

async function notify(bot, userId, text) {
  try { await bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML', disable_web_page_preview: true }); } catch {}
}

export function setAutoBuyConfig(userId, chain, enabled, minMC, maxMC, minHolders, minLiq, maxSlippage, amountPerBuy, maxBuysPerHour) {
  try {
    const current = getDb().prepare('SELECT * FROM auto_buy_config WHERE user_id = ? AND chain = ?').get(userId, chain) || {};
    getDb().prepare(`
      INSERT INTO auto_buy_config (user_id, chain, enabled, min_mc, max_mc, min_holders, min_liq, max_slippage, amount_per_buy, max_buys_per_hour, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, chain) DO UPDATE SET
        enabled = excluded.enabled,
        min_mc = excluded.min_mc,
        max_mc = excluded.max_mc,
        min_holders = excluded.min_holders,
        min_liq = excluded.min_liq,
        max_slippage = excluded.max_slippage,
        amount_per_buy = excluded.amount_per_buy,
        max_buys_per_hour = excluded.max_buys_per_hour,
        updated_at = datetime('now')
    `).run(
      userId,
      chain,
      enabled == null ? (current.enabled || 0) : (enabled ? 1 : 0),
      minMC == null || minMC === '' ? (current.min_mc ?? 0) : Number(minMC),
      maxMC == null || maxMC === '' ? (current.max_mc ?? 1_000_000_000) : Number(maxMC),
      minHolders == null || minHolders === '' ? (current.min_holders ?? 0) : Number(minHolders),
      minLiq == null || minLiq === '' ? (current.min_liq ?? 0) : Number(minLiq),
      maxSlippage == null || maxSlippage === '' ? (current.max_slippage ?? 10) : Number(maxSlippage),
      amountPerBuy == null || amountPerBuy === '' ? (current.amount_per_buy ?? 0) : Number(amountPerBuy),
      maxBuysPerHour == null || maxBuysPerHour === '' ? (current.max_buys_per_hour ?? 1) : Number(maxBuysPerHour),
    );
    return true;
  } catch (err) {
    console.error('[AutoBuy] config:', err.message);
    return false;
  }
}

export function getAutoBuyConfig(userId, chain = null) {
  try {
    if (chain) {
      return getDb().prepare('SELECT * FROM auto_buy_config WHERE user_id = ? AND chain = ?').get(userId, chain) || null;
    }
    return getDb().prepare('SELECT * FROM auto_buy_config WHERE user_id = ? ORDER BY chain').all(userId);
  } catch (err) {
    console.error('[AutoBuy] getConfig:', err.message);
    return chain ? null : [];
  }
}

function matches(config, token) {
  const mc = parseFloat(token.marketCap ?? token.market_cap ?? 0);
  const liq = parseFloat(token.liquidity ?? 0);
  const holders = parseInt(token.holders ?? 0);
  return mc >= config.min_mc
    && mc <= config.max_mc
    && holders >= config.min_holders
    && liq >= config.min_liq;
}

function canBuy(cfg) {
  const bucket = new Date().toISOString().slice(0, 13);
  if (cfg.hour_bucket !== bucket) {
    getDb().prepare('UPDATE auto_buy_config SET hour_bucket = ?, buys_this_hour = 0 WHERE user_id = ? AND chain = ?').run(bucket, cfg.user_id, cfg.chain);
    cfg.buys_this_hour = 0;
  }
  return cfg.buys_this_hour < cfg.max_buys_per_hour;
}

export async function checkAutoBuy(bot, token) {
  const buys = [];
  try {
    const chain = token.chain || 'solana';
    const configs = getDb().prepare('SELECT * FROM auto_buy_config WHERE chain = ? AND enabled = 1').all(chain);
    for (const cfg of configs) {
      try {
        if (!matches(cfg, token) || !canBuy(cfg) || cfg.amount_per_buy <= 0) continue;
        const wallets = getSavedWallets(chain);
        const wallet = wallets[0];
        if (!wallet?.private_key) {
          await notify(bot, cfg.user_id, `⚠️ Auto-Buy skipped: no ${chain} wallet/private key.`);
          continue;
        }

        let result;
        if (chain === 'solana') {
          result = await jupiterSwap({
            inputMint: SOL_MINT,
            outputMint: token.address,
            amount: Math.floor(cfg.amount_per_buy * 1_000_000_000),
            slippageBps: Math.floor(cfg.max_slippage * 100),
            walletPublicKey: wallet.address,
            walletPrivateKey: wallet.private_key,
          });
        } else {
          result = await evmBuy({
            chain,
            tokenAddress: token.address,
            amountInNative: cfg.amount_per_buy,
            walletPrivateKey: wallet.private_key,
            slippageBps: Math.floor(cfg.max_slippage * 100),
          });
        }

        getDb().prepare('UPDATE auto_buy_config SET buys_this_hour = buys_this_hour + 1 WHERE user_id = ? AND chain = ?').run(cfg.user_id, chain);
        addPosition({
          user_id: cfg.user_id,
          chain,
          token_address: token.address,
          token_symbol: token.symbol || 'TOKEN',
          buy_amount_native: cfg.amount_per_buy,
          buy_amount_token: null,
          buy_price: parseFloat(token.price || token.priceUsd || 0),
          txid: result.txid,
          tp_pct: 200,
          sl_pct: -30,
        });
        buys.push({ cfg, token, result });
        await notify(bot, cfg.user_id, `🤖 <b>Auto-Buy Filled</b>\n${token.symbol || token.address}\nAmount: ${cfg.amount_per_buy}\nTX: <code>${result.txid}</code>`);
      } catch (err) {
        console.error(`[AutoBuy] ${cfg.user_id}:`, err.message);
        await notify(bot, cfg.user_id, `⚠️ Auto-Buy failed for ${token.symbol || token.address}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[AutoBuy] check:', err.message);
  }
  return buys;
}
