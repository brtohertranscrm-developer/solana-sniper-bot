import { getDb } from '../utils/database.js';

const ADDRESS_RE = /(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})/g;

export function addChannelMonitor(userId, channelId, chain = 'solana', label = null) {
  try {
    getDb().prepare(`
      INSERT INTO channel_monitors (user_id, channel_id, chain, label)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, channel_id) DO UPDATE SET chain = excluded.chain, label = excluded.label, active = 1
    `).run(userId, channelId, chain, label);
    return true;
  } catch (err) {
    console.error('[ChannelMonitor] add:', err.message);
    return false;
  }
}

export function removeChannelMonitor(userId, channelId) {
  try {
    return getDb().prepare('UPDATE channel_monitors SET active = 0 WHERE user_id = ? AND channel_id = ?').run(userId, channelId).changes > 0;
  } catch (err) {
    console.error('[ChannelMonitor] remove:', err.message);
    return false;
  }
}

export function getChannelMonitors(userId) {
  try {
    return getDb().prepare('SELECT * FROM channel_monitors WHERE user_id = ? AND active = 1 ORDER BY id DESC').all(userId);
  } catch (err) {
    console.error('[ChannelMonitor] list:', err.message);
    return [];
  }
}

export async function processChannelMessage(ctx) {
  try {
    const message = ctx.channelPost || ctx.message;
    const channelId = String(message?.chat?.id || '');
    const text = message?.text || message?.caption || '';
    if (!channelId || !text) return [];
    const monitors = getDb().prepare('SELECT * FROM channel_monitors WHERE channel_id = ? AND active = 1').all(channelId);
    if (!monitors.length) return [];
    const addresses = [...new Set(text.match(ADDRESS_RE) || [])];
    if (!addresses.length) return [];
    for (const monitor of monitors) {
      try {
        await ctx.telegram.sendMessage(
          monitor.user_id,
          `📣 <b>Channel Signal</b>\n${monitor.label || channelId}\n${monitor.chain.toUpperCase()}: <code>${addresses[0]}</code>\n/buy ${addresses[0]} 0.01`,
          { parse_mode: 'HTML', disable_web_page_preview: true }
        );
      } catch {}
    }
    return addresses;
  } catch (err) {
    console.error('[ChannelMonitor] process:', err.message);
    return [];
  }
}
