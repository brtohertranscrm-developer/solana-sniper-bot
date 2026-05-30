import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { initDb } from './utils/database.js';
import { setupCommands } from './commands/bot.js';
import { startAutoScan } from './services/autoscan.js';
import { startAutoSell } from './services/auto-sell.js';
import { startLimitOrderMonitor } from './services/limit-order.js';
import { startTrailingStopMonitor } from './services/trailing-stop.js';
import { startDailyReportMonitor } from './services/daily-report.js';
import { startSmartMoneyMonitor } from './services/smart-money.js';
import { startNewPairSniper } from './services/new-pair-sniper.js';
import { startPriceAlertMonitor } from './services/price-alert.js';
import { startWatchlistMonitor } from './services/watchlist.js';

// Init database
initDb();

// Init bot
const bot = new Telegraf(config.botToken);

// Admin middleware
bot.use((ctx, next) => {
  return next();
});

// Setup commands
setupCommands(bot);

// Handle errors
bot.catch((err) => {
  console.error('[Bot] Error:', err.message, err.stack);
});

// Start
bot.launch((err) => {
  if (err) {
    console.error('[Bot] Launch failed:', err.message);
    process.exit(1);
  }
  console.log('[Bot] Telegram bot started');

  // Start monitors
  startAutoScan(bot);
  startAutoSell(bot);
  startLimitOrderMonitor(bot);
  startTrailingStopMonitor(bot);
  startDailyReportMonitor(bot);
  startSmartMoneyMonitor(bot);
  startNewPairSniper(bot);
  startPriceAlertMonitor(bot);
  startWatchlistMonitor(bot);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Bot] Shutting down...');
  bot.stop('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit(0);
});
