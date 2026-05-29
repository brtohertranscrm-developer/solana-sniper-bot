import { fetchPumpfunNewTokens, scorePumpfunToken } from './scanner.js';
import { analyzeHolders } from './analyzer.js';
import { upsertToken, getStats } from '../utils/database.js';
import { config } from '../config.js';

let isScanning = false;

/**
 * Run a single scan cycle - fetch new tokens, score them, store results
 */
export async function runScanCycle(bot) {
  if (isScanning) return;
  isScanning = true;

  try {
    const tokens = await fetchPumpfunNewTokens(50);
    if (tokens.length === 0) {
      isScanning = false;
      return;
    }

    const alerts = []; // tokens worth alerting

    for (const token of tokens) {
      const address = token.mint || token.address;
      if (!address) continue;

      const score = scorePumpfunToken(token);

      // Only analyze holders for promising tokens (score >= 4)
      let risk = 'UNKNOWN';
      if (score.score >= 4) {
        const holderAnalysis = await analyzeHolders(address);
        risk = holderAnalysis?.risk || 'UNKNOWN';
      }

      const tokenData = {
        address,
        name: token.name || 'Unknown',
        symbol: token.symbol || '???',
        source: 'pumpfun',
        market_cap: parseFloat(token.usd_market_cap || token.marketCap || 0),
        volume_24h: parseFloat(token.volume_24h || token.volume24h || 0),
        holders: parseInt(token.holder_count || token.holders || 0),
        price: parseFloat(token.price || 0),
        score: score.score,
        grade: score.grade,
        risk,
      };

      upsertToken(tokenData);

      // Alert for high-potential tokens (A+ or A grade)
      if (score.grade === 'A+' || score.grade === 'A') {
        alerts.push(tokenData);
      }
    }

    // Send alerts to admin
    if (alerts.length > 0 && bot) {
      for (const adminId of config.adminIds) {
        let msg = `HIGH POTENTIAL TOKEN DETECTED:\n\n`;
        alerts.slice(0, 5).forEach(t => {
          msg += `[${t.grade}] ${t.name} (${t.symbol})\n`;
          msg += `MC: $${t.market_cap.toLocaleString()} | Holders: ${t.holders} | Risk: ${t.risk}\n`;
          msg += `https://dexscreener.com/solana/${t.address}\n\n`;
        });
        try {
          await bot.telegram.sendMessage(adminId, msg, { disable_web_page_preview: true });
        } catch {
          // ignore send errors
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

/**
 * Start periodic scanning
 */
export function startAutoScan(bot) {
  console.log(`[Scan] Auto-scan started (interval: ${config.scanIntervalMs}ms)`);
  
  // Run first scan immediately
  runScanCycle(bot);

  // Then repeat
  const interval = setInterval(() => {
    runScanCycle(bot);
  }, config.scanIntervalMs);

  return interval;
}
