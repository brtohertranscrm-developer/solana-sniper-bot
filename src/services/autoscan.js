import { scanAllSources, scoreToken } from './scanner.js';
import { analyzeHolders } from './analyzer.js';
import { upsertToken, getStats } from '../utils/database.js';
import { config } from '../config.js';
import { monitorPositions } from './portfolio.js';
import { monitorCopyTrade } from './copy-trade.js';
import { monitorRugPull } from './anti-rug.js';
import { checkAutoBuy } from './auto-buy.js';
import { processDCAOrders } from './dca.js';
import { processReinvest } from './budget-strategy.js';
import { monitorBondingCurve } from './bonding-curve.js';
import { monitorVolumeSpikes } from './volume-alert.js';
import { checkTieredTP } from './tiered-tp.js';

const CHAINS = ['solana', 'bsc', 'eth'];
let isScanning = false;

export async function runScanCycle(bot) {
  if (isScanning) return;
  isScanning = true;

  try {
    const tokens = await scanAllSources(CHAINS);
    if (!tokens.length) { isScanning = false; return; }

    const alerts = [];

    for (const token of tokens) {
      const address = token.address;
      if (!address) continue;

      const score = scoreToken(token);
      let risk = 'UNKNOWN';
      if (score.score >= 4 && token.chain === 'solana') {
        const h = await analyzeHolders(address);
        risk = h?.risk || 'UNKNOWN';
      }

      upsertToken({
        address,
        chain: token.chain || 'solana',
        name: token.name || 'Unknown',
        symbol: token.symbol || '???',
        source: token.source || 'unknown',
        market_cap: parseFloat(token.marketCap || 0),
        volume_24h: parseFloat(token.volume_24h || 0),
        holders: parseInt(token.holders || 0),
        price: parseFloat(token.price || 0),
        score: score.score,
        grade: score.grade,
        risk,
      });

      await checkAutoBuy(bot, { ...token, chain: token.chain || 'solana' });

      if (score.grade === 'A+' || score.grade === 'A') {
        alerts.push({ ...token, chain: token.chain, score, risk });
      }
    }

    // Alert admins for high-potential tokens
    if (alerts.length > 0 && bot) {
      for (const adminId of config.adminIds) {
        let msg = `⚡ HIGH POTENTIAL TOKEN:\n\n`;
        alerts.slice(0, 5).forEach(t => {
          msg += `[${t.score.grade}] ${t.name} (${t.symbol})\n`;
          msg += `MC: $${parseFloat(t.marketCap || 0).toLocaleString()} | Risk: ${t.risk}\n`;
          msg += `https://dexscreener.com/${t.chain}/${t.address}\n\n`;
        });
        try { await bot.telegram.sendMessage(adminId, msg, { disable_web_page_preview: true }); } catch {}
      }
    }

    // Monitor positions for TP/SL (every 4th scan cycle to save rate limits)
    // Actually monitor on separate interval

    const stats = getStats();
    console.log(`[Scan] ${tokens.length} tokens | DB: ${stats.total}`);
  } catch (err) {
    console.error('[Scan] Error:', err.message);
  } finally {
    isScanning = false;
  }
}

/**
 * Start auto-scan + position monitoring
 */
export function startAutoScan(bot) {
  console.log(`[Scan] Auto-scan started (${config.scanIntervalMs}ms) | Chains: ${CHAINS.join(', ')}`);
  runScanCycle(bot);

  // Scan interval
  const scanInterval = setInterval(() => runScanCycle(bot), config.scanIntervalMs);

  // Position monitoring (every 30 seconds)
  const monitorInterval = setInterval(async () => {
    try {
      const toSell = await monitorPositions(bot);
      if (toSell.length > 0 && bot) {
        for (const adminId of config.adminIds) {
          let msg = `🎯 TP/SL TRIGGERED:\n\n`;
          toSell.forEach(p => {
            msg += `${p.reason}: ${p.token_symbol} (${p.token_address.slice(0, 8)}...)\n`;
            msg += `${p.pctChange > 0 ? '+' : ''}${p.pctChange.toFixed(1)}%\n`;
            msg += `Use /sell_${p.token_address} to sell\n\n`;
          });
          try { await bot.telegram.sendMessage(adminId, msg); } catch {}
        }
      }
    } catch (err) {
      console.error('[Monitor] Error:', err.message);
    }
  }, 30000);

  const copyTradeInterval = setInterval(() => monitorCopyTrade(bot).catch(err => console.error('[CopyTrade] interval:', err.message)), config.copyTradeIntervalMs);
  const antiRugInterval = setInterval(() => monitorRugPull(bot).catch(err => console.error('[AntiRug] interval:', err.message)), config.antiRugIntervalMs);
  const dcaInterval = setInterval(() => processDCAOrders(bot).catch(err => console.error('[DCA] interval:', err.message)), config.dcaIntervalMs);
  const bondingInterval = setInterval(() => monitorBondingCurve(bot).catch(err => console.error('[Bonding] interval:', err.message)), config.bondingIntervalMs);
  const volumeInterval = setInterval(() => monitorVolumeSpikes(bot).catch(err => console.error('[Volume] interval:', err.message)), config.volumeIntervalMs);
  const tieredTpInterval = setInterval(() => checkTieredTP(bot).catch(err => console.error('[TieredTP] interval:', err.message)), config.tieredTpIntervalMs);
  const reinvestInterval = setInterval(() => processReinvest(bot).catch(err => console.error('[Reinvest] interval:', err.message)), 60000);

  return { scanInterval, monitorInterval, copyTradeInterval, antiRugInterval, dcaInterval, bondingInterval, volumeInterval, tieredTpInterval, reinvestInterval };
}
