import { config } from '../config.js';
import { getDb } from '../utils/database.js';
import { scanAllSources } from './scanner.js';

let isMonitoring = false;

async function notifyAdmins(bot, text) {
  for (const adminId of config.adminIds) {
    try { await bot.telegram.sendMessage(adminId, text, { parse_mode: 'HTML', disable_web_page_preview: true }); } catch {}
  }
}

export async function monitorVolumeSpikes(bot) {
  if (isMonitoring) return [];
  isMonitoring = true;
  const spikes = [];
  try {
    const tokens = await scanAllSources(['solana', 'bsc', 'eth']);
    for (const token of tokens) {
      try {
        if (!token.address) continue;
        const chain = token.chain || 'solana';
        const volume = parseFloat(token.volume_24h || 0);
        const prev = getDb().prepare(`
          SELECT * FROM volume_snapshots
          WHERE chain = ? AND token_address = ?
          ORDER BY id DESC LIMIT 1
        `).get(chain, token.address);
        getDb().prepare(`
          INSERT INTO volume_snapshots (chain, token_address, volume_24h)
          VALUES (?, ?, ?)
        `).run(chain, token.address, volume);
        if (!prev || prev.volume_24h <= 0) continue;
        const pct = ((volume - prev.volume_24h) / prev.volume_24h) * 100;
        if (pct >= config.volumeSpikePct) {
          spikes.push({ token, pct });
          await notifyAdmins(bot, `📈 <b>Volume Spike</b>\n${token.symbol || token.address} ${chain.toUpperCase()}\n+${pct.toFixed(0)}% volume\n<a href="https://dexscreener.com/${chain}/${token.address}">Dexscreener</a>`);
        }
      } catch (err) {
        console.error('[Volume] token:', err.message);
      }
    }
  } catch (err) {
    console.error('[Volume] monitor:', err.message);
  } finally {
    isMonitoring = false;
  }
  return spikes;
}
