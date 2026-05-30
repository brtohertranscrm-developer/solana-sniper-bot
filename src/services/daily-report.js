import { getDb } from '../utils/database.js';

const REPORT_CHECK_INTERVAL_MS = 60000; // Check every 60s
const DEFAULT_REPORT_HOUR = 15; // 15:00 UTC = 22:00 WIB (UTC+7)

async function notify(bot, userId, text) {
  try {
    await bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch {}
}

/**
 * Get report hour for a user
 */
function getReportHour(userId) {
  const row = getDb().prepare('SELECT report_hour FROM daily_report_settings WHERE user_id = ?').get(userId);
  return row ? row.report_hour : DEFAULT_REPORT_HOUR;
}

/**
 * Set report hour for a user
 */
export function setReportHour(userId, hour) {
  getDb().prepare(`
    INSERT INTO daily_report_settings (user_id, report_hour)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET report_hour = excluded.report_hour
  `).run(userId, hour);
}

/**
 * Get today's date string (UTC)
 */
function getTodayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Check if report already sent today for a user
 */
function wasReportSentToday(userId) {
  const today = getTodayUTC();
  const row = getDb().prepare('SELECT sent FROM daily_reports_sent WHERE user_id = ? AND date = ?').get(userId, today);
  return row ? row.sent === 1 : false;
}

/**
 * Mark report as sent today
 */
function markReportSent(userId) {
  const today = getTodayUTC();
  getDb().prepare(`
    INSERT INTO daily_reports_sent (user_id, date, sent)
    VALUES (?, ?, 1)
    ON CONFLICT(user_id, date) DO UPDATE SET sent = 1
  `).run(userId, today);
}

/**
 * Generate daily report for a user
 */
export function generateDailyReport(userId) {
  const db = getDb();
  const today = getTodayUTC();

  // Today's closed trades
  const closedTrades = db.prepare(
    "SELECT * FROM portfolios WHERE user_id = ? AND status = 'sold' AND sold_at LIKE ? || '%'"
  ).all(userId, today);

  // Today's open positions
  const openPositions = db.prepare(
    "SELECT * FROM portfolios WHERE user_id = ? AND status = 'holding'"
  ).all(userId);

  // Stats
  const wins = closedTrades.filter(t => t.pnl_pct > 0).length;
  const losses = closedTrades.filter(t => t.pnl_pct <= 0).length;
  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;

  // Total PnL from closed trades (use buy_amount_native as proxy for SOL)
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl_amount || 0), 0);

  // Best and worst trade
  let bestTrade = null;
  let worstTrade = null;
  for (const t of closedTrades) {
    if (t.pnl_amount != null) {
      if (!bestTrade || t.pnl_amount > bestTrade.pnl_amount) bestTrade = t;
      if (!worstTrade || t.pnl_amount < worstTrade.pnl_amount) worstTrade = t;
    }
  }

  // Open positions total invested
  const openTotal = openPositions.reduce((sum, t) => sum + (t.buy_amount_native || 0), 0);

  // Format date
  const now = new Date();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateStr = `${monthNames[now.getMonth()]} ${now.getDate()}`;

  let report = `📊 Daily Report - ${dateStr}\n`;
  report += `Trades: ${totalTrades} | Wins: ${wins} | Losses: ${losses} | Rate: ${winRate}%\n`;
  report += `Realized PnL: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(4)} SOL\n`;
  report += `Open positions: ${openPositions.length} (total: ${openTotal.toFixed(4)} SOL)\n`;

  if (bestTrade) {
    report += `Best trade: +${bestTrade.pnl_amount.toFixed(4)} SOL (+${bestTrade.pnl_pct.toFixed(0)}%)\n`;
  }
  if (worstTrade) {
    report += `Worst trade: ${worstTrade.pnl_amount.toFixed(4)} SOL (${worstTrade.pnl_pct.toFixed(0)}%)\n`;
  }

  return report;
}

/**
 * Send report to user
 */
export async function sendDailyReport(bot, userId) {
  try {
    const report = generateDailyReport(userId);
    await notify(bot, userId, report);
    markReportSent(userId);
    return true;
  } catch (err) {
    console.error(`[DailyReport] Failed to send for user ${userId}:`, err.message);
    return false;
  }
}

/**
 * Check and auto-send reports (called every 60s)
 */
async function checkAndSendReports(bot) {
  try {
    const settings = getDb().prepare('SELECT user_id, report_hour FROM daily_report_settings').all();
    const now = new Date();
    const currentHourUTC = now.getUTCHours();

    // Also check users with no settings (use default hour)
    const usersWithSettings = new Set(settings.map(s => s.user_id));

    // Get all authorized users
    const allUsers = getDb().prepare('SELECT user_id FROM authorized_users').all();

    for (const user of allUsers) {
      const userId = user.user_id;
      const hour = settings.find(s => s.user_id === userId)?.report_hour ?? DEFAULT_REPORT_HOUR;

      if (currentHourUTC !== hour) continue;
      if (wasReportSentToday(userId)) continue;

      await sendDailyReport(bot, userId);
    }
  } catch (err) {
    console.error('[DailyReport] Check error:', err.message);
  }
}

/**
 * Start daily report cron
 */
export function startDailyReportMonitor(bot) {
  console.log(`[DailyReport] Auto-report started (checks every ${REPORT_CHECK_INTERVAL_MS}ms, default hour: ${DEFAULT_REPORT_HOUR} UTC)`);
  setInterval(() => checkAndSendReports(bot), REPORT_CHECK_INTERVAL_MS);
}
