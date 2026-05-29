import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config.js';
import { getDb } from '../utils/database.js';

const connection = new Connection(config.solanaRpc, 'confirmed');
let isMonitoring = false;

function explorerApi(chain, address) {
  if (chain === 'bsc') {
    return {
      url: config.bscscanApiUrl,
      params: { module: 'account', action: 'txlist', address, sort: 'desc', apikey: config.bscscanApiKey || '' },
    };
  }
  if (chain === 'eth') {
    return {
      url: config.etherscanApiUrl,
      params: { module: 'account', action: 'txlist', address, sort: 'desc', apikey: config.etherscanApiKey || '' },
    };
  }
  return null;
}

async function notify(bot, userId, text) {
  try { await bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML', disable_web_page_preview: true }); } catch {}
}

export function addWatchWallet(userId, chain, address, label = null) {
  try {
    const info = getDb().prepare(`
      INSERT INTO copy_trade_watches (user_id, chain, wallet_address, label)
      VALUES (?, ?, ?, ?)
    `).run(userId, chain, address, label);
    return info.lastInsertRowid;
  } catch (err) {
    console.error('[CopyTrade] addWatchWallet:', err.message);
    return null;
  }
}

export function removeWatchWallet(id) {
  try {
    return getDb().prepare('UPDATE copy_trade_watches SET active = 0 WHERE id = ?').run(id).changes > 0;
  } catch (err) {
    console.error('[CopyTrade] removeWatchWallet:', err.message);
    return false;
  }
}

export function getWatchWallets(userId) {
  try {
    return getDb().prepare('SELECT * FROM copy_trade_watches WHERE user_id = ? AND active = 1 ORDER BY id DESC').all(userId);
  } catch (err) {
    console.error('[CopyTrade] getWatchWallets:', err.message);
    return [];
  }
}

async function latestSolanaSignature(address) {
  const signatures = await connection.getSignaturesForAddress(new PublicKey(address), { limit: 1 });
  return signatures[0]?.signature || null;
}

async function latestEvmTx(chain, address) {
  const api = explorerApi(chain, address);
  if (!api) return null;
  const res = await axios.get(api.url, { params: api.params, timeout: 15000 });
  const tx = Array.isArray(res.data?.result) ? res.data.result[0] : null;
  return tx?.hash || null;
}

export async function monitorCopyTrade(bot) {
  if (isMonitoring) return [];
  isMonitoring = true;
  const hits = [];
  try {
    const watches = getDb().prepare('SELECT * FROM copy_trade_watches WHERE active = 1').all();
    for (const watch of watches) {
      try {
        const latest = watch.chain === 'solana'
          ? await latestSolanaSignature(watch.wallet_address)
          : await latestEvmTx(watch.chain, watch.wallet_address);
        if (!latest) continue;

        if (!watch.last_tx_signature) {
          getDb().prepare('UPDATE copy_trade_watches SET last_tx_signature = ? WHERE id = ?').run(latest, watch.id);
          continue;
        }

        if (latest !== watch.last_tx_signature) {
          getDb().prepare('UPDATE copy_trade_watches SET last_tx_signature = ? WHERE id = ?').run(latest, watch.id);
          const item = { ...watch, tx: latest };
          hits.push(item);
          const link = watch.chain === 'solana'
            ? `https://solscan.io/tx/${latest}`
            : watch.chain === 'bsc'
              ? `https://bscscan.com/tx/${latest}`
              : `https://etherscan.io/tx/${latest}`;
          await notify(bot, watch.user_id, `👁 <b>Copy Trade Watch</b>\n${watch.label || watch.wallet_address}\n${watch.chain.toUpperCase()} new tx:\n<a href="${link}">${latest.slice(0, 20)}...</a>`);
        }
      } catch (err) {
        console.error(`[CopyTrade] watch ${watch.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[CopyTrade] monitor:', err.message);
  } finally {
    isMonitoring = false;
  }
  return hits;
}
