import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { initDb } from './utils/database.js';
import { setupCommands } from './commands/bot.js';
import { startAutoScan } from './services/autoscan.js';

// Init database
initDb();

// Init bot
const bot = new Telegraf(config.botToken);

// Admin middleware
bot.use((ctx, next) => {
  if (config.adminIds.length > 0) {
    // Allow all users for read commands, restrict write commands
  }
  return next();
});

// Setup commands
setupCommands(bot);

// Handle errors
bot.catch((err) => {
  console.error('[Bot] Error:', err.message);
});

// Start
bot.launch((err) => {
  if (err) {
    console.error('[Bot] Launch failed:', err.message);
    process.exit(1);
  }
  console.log('[Bot] Telegram bot started');

  // Start auto-scan after bot is ready
  startAutoScan(bot);
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
