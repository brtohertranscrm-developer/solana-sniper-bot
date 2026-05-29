import { scanAllSources, scoreToken } from './scanner.js';
import { analyzeHolders } from './analyzer.js';
import { upsertToken, getStats } from '../utils/database.js';
import { config } from '../config.js';

const CHAINS = ['solana', 'bsc', 'eth'];
let isScanning = false;

export async function runScanCycle(bot) {
  if (isScanning) return;
  isScanning = true;

  try {
    const tokens = await scanAllSources(CHAINS);
    if (tokens.length === 0) {
      console.log('[Scan] No tokens found this cycle');
      isScanning = false;
      return;
    }

    const alerts = [];

    for (const token of tokens) {
      const address = token.address;
      if (!address) continue;

      const score = scoreToken(token);

      let risk = 'UNKNOWN';
      if (score.score >= 4 && token.chain === 'solana') {
        const holderAnalysis = await analyzeHolders(address);
        risk = holderAnalysis?.risk || 'UNKNOWN';
      }

      const tokenData = {
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
      };

      upsertToken(tokenData);

      if (score.grade === 'A+' || score.grade === 'A') {
        alerts.push(tokenData);
      }
    }

    if (alerts.length > 0 && bot) {
      for (const adminId of config.adminIds) {
        let msg = `HIGH POTENTIAL TOKEN DETECTED:\n\n`;
        alerts.slice(0, 5).forEach(t => {
          const chainLabel = t.chain.toUpperCase();
          msg += `[${t.grade}] [${chainLabel}] ${t.name} (${t.symbol})\n`;
          msg += `MC: $${t.market_cap.toLocaleString()} | Vol: $${t.volume_24h.toLocaleString()} | Holders: ${t.holders} | Risk: ${t.risk}\n`;
          msg += `https://dexscreener.com/${t.chain}/${t.address}\n\n`;
        });
        try {
          await bot.telegram.sendMessage(adminId, msg, { disable_web_page_preview: true });
        } catch {
          // ignore
        }
      }
    }

    const stats = getStats();
    console.log(`[Scan] Processed ${tokens.length} tokens | DB total: ${stats.total}`);
  } catch (err) {
    console.error('[Scan] Error:', err.message);
  } finally {
    isScanning = false;
  }
}

export function startAutoScan(bot) {
  console.log(`[Scan] Auto-scan started (interval: ${config.scanIntervalMs}ms) | Chains: ${CHAINS.join(', ')}`);
  runScanCycle(bot);

  const interval = setInterval(() => {
    runScanCycle(bot);
  }, config.scanIntervalMs);

  return interval;
}
