import { config } from '../config.js';
import { getUserChain, setUserChain, getStats, isAuthorized, authorizeUser, verifyPin, deauthorizeUser } from '../utils/database.js';
import { getTokenOverview, analyzeHolders } from '../services/analyzer.js';
import { scanChain, scoreToken, fetchTrending } from '../services/scanner.js';
import { analyzeTokenForDisplay, formatTokenCard, formatScanHeader, formatNumber } from './formatter.js';
import { generateSolanaWallet, generateEVMWallet, getSavedWallets, saveWallet } from '../services/wallet.js';
import { jupiterSwap, jupiterSell } from '../services/solana-swapper.js';
import { evmBuy, evmSell } from '../services/evm-swapper.js';
import { addPosition, getOpenPositions, getAllPositions, closePosition, getPortfolioSummary } from '../services/portfolio.js';
import { addWatchWallet, removeWatchWallet, getWatchWallets } from '../services/copy-trade.js';
import { getAutoBuyConfig, setAutoBuyConfig } from '../services/auto-buy.js';
import { createDCAOrder, getActiveDCAOrders, cancelDCAOrder } from '../services/dca.js';
import { getActiveWallet, addWalletToRotation, listRotationWallets, removeWalletFromRotation } from '../services/multi-wallet.js';
import { setPaperMode, isPaperMode, paperBuy, paperSell, getPaperPortfolio, getPaperPnL } from '../services/paper-trade.js';
import { addChannelMonitor, removeChannelMonitor, getChannelMonitors, processChannelMessage } from '../services/channel-monitor.js';
import { setTieredTP } from '../services/tiered-tp.js';
import { getStrategy, setStrategy, consumeBudget, pauseStrategy, resumeStrategy, getStrategyReport } from '../services/budget-strategy.js';
import { setAutoSell, getAutoSellStatus } from '../services/auto-sell.js';
import { checkTokenSafety, formatSafetyReport } from '../services/token-safety.js';
import { createLimitOrder, getLimitOrders, cancelLimitOrder } from '../services/limit-order.js';
import { addTrailingStop, disableTrailingStop, getActiveTrailingStops } from '../services/trailing-stop.js';
import { generateDailyReport, sendDailyReport, setReportHour } from '../services/daily-report.js';
import { addSmartWallet, removeSmartWallet, getSmartWallets, scanAllSmartWallets } from '../services/smart-money.js';
import { isNewPairEnabled, setNewPairEnabled, getNewPairFilters, setNewPairFilters } from '../services/new-pair-sniper.js';
import { addPriceAlert, getPriceAlerts, cancelPriceAlert } from '../services/price-alert.js';
import { generateBackup, restoreBackup, getBackupPreview } from '../services/wallet-backup.js';
import { formatTPCalc } from '../services/tp-calculator.js';
import { addToWatchlist, formatWatchlistDisplay, removeFromWatchlist } from '../services/watchlist.js';
import { RpcManager, sendJitoBundle, subscribeNewTokens, unsubscribeNewTokens, isWsStreamRunning, getRpcManager, getSwapQuote, setCachedQuote, clearTxCache, getTxCacheSize, estimatePriorityFee } from '../services/solana-tools.js';

const CL = { solana: 'Solana', bsc: 'BSC', eth: 'ETH' };
const CE = { solana: '◎', bsc: '🔶', eth: '⟠' };
const nativeUnit = c => c === 'solana' ? 'SOL' : c === 'bsc' ? 'BNB' : 'ETH';

// Quick Buy lookup: Map<string, Array> keyed by `${userId}_${timestamp}`
const quickBuyMap = new Map();

// ===== KEYBOARDS =====

function mainMenu(uid) {
  const ch = getUserChain(uid);
  const pm = isPaperMode(uid);
  return { reply_markup: { inline_keyboard: [
    [{ text: '🔍 Scanner', callback_data: 'cat_scanner' }, { text: '🎯 Trade', callback_data: 'cat_trade' }, { text: '💼 Portfolio', callback_data: 'do_portfolio' }],
    [{ text: '🤖 Auto', callback_data: 'cat_auto' }, { text: '🛡️ Safety', callback_data: 'cat_safety' }, { text: '📊 Stats', callback_data: 'do_pnl' }],
    [{ text: '🔧 Tools', callback_data: 'cat_tools' }, { text: '⚙️ Settings', callback_data: 'cat_settings' }],
  ]}};
}

function back() { return { reply_markup: { inline_keyboard: [[{ text: '⬅️ Menu', callback_data: 'main' }]] } }; }

function backTo(cat) { return { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: cat }]] } }; }

// Category: Scanner
function scannerMenu() {
  return { reply_markup: { inline_keyboard: [
    [{ text: '🔍 Scan Now', callback_data: 'do_scan' }, { text: '🔥 Trending', callback_data: 'do_trending' }],
    [{ text: '📊 Top Tokens', callback_data: 'do_top' }],
    [{ text: '🆕 New Pair Sniper', callback_data: 'sub_newpair' }],
    [{ text: '🔔 Price Alert', callback_data: 'sub_pricealert' }],
    [{ text: '⬅️ Menu', callback_data: 'main' }],
  ]}};
}

// Category: Trade
function tradeMenu(ch) {
  const nu = nativeUnit(ch);
  return { reply_markup: { inline_keyboard: [
    [{ text: '🎯 Buy', callback_data: 'do_buy_help' }, { text: '💸 Sell', callback_data: 'do_sell_help' }],
    [{ text: '📈 DCA', callback_data: 'sub_dca' }, { text: '🏎️ Snipe', callback_data: 'do_snipe_help' }],
    [{ text: '📉 Trailing Stop', callback_data: 'sub_trailingstop' }],
    [{ text: '🧮 TP Calculator', callback_data: 'sub_tpcalc' }],
    [{ text: '⬅️ Menu', callback_data: 'main' }],
  ]}};
}

// Category: Auto
function autoMenu(uid) {
  const ch = getUserChain(uid);
  const cfg = getAutoBuyConfig(uid, ch);
  const r = getStrategyReport(uid);
  return { reply_markup: { inline_keyboard: [
    [{ text: cfg?.enabled ? '✅ Auto-Buy ON' : '❌ Auto-Buy OFF', callback_data: 'sub_autobuy' }],
    [{ text: r?.enabled ? '✅ Strategy ON' : '🎯 Strategy', callback_data: 'sub_strategy' }],
    [{ text: '📊 Auto-Sell', callback_data: 'sub_autosell' }, { text: '📋 Limit Orders', callback_data: 'sub_limitorders' }],
    [{ text: '🐋 Copy Trade', callback_data: 'sub_copytrade' }],
    [{ text: '🧠 Smart Money', callback_data: 'sub_smartmoney' }],
    [{ text: '👀 Watchlist', callback_data: 'sub_watchlist' }],
    [{ text: '⬅️ Menu', callback_data: 'main' }],
  ]}};
}

// Category: Safety
function safetyMenu(uid) {
  return { reply_markup: { inline_keyboard: [
    [{ text: '🛡️ Anti-Rug', callback_data: 'sub_antirug' }],
    [{ text: '📢 Volume Alert', callback_data: 'sub_volume' }],
    [{ text: '🏎️ Bonding Monitor', callback_data: 'sub_bonding' }],
    [{ text: '📊 Daily Report', callback_data: 'sub_dailyreport' }],
    [{ text: '🔐 Wallet Backup', callback_data: 'sub_walletbackup' }],
    [{ text: '⬅️ Menu', callback_data: 'main' }],
  ]}};
}

// Category: Settings
function settingsMenu(uid) {
  const ch = getUserChain(uid);
  const pm = isPaperMode(uid);
  return { reply_markup: { inline_keyboard: [
    [{ text: `🌐 ${CE[ch]} ${CL[ch]}`, callback_data: 'sub_network' }],
    [{ text: '💰 Wallets', callback_data: 'sub_wallets' }],
    [{ text: pm ? '🧪 Paper: ON' : '⚡ Paper: OFF', callback_data: 'sub_paper' }],
    [{ text: '📺 Channels', callback_data: 'sub_channel' }],
    [{ text: '⬅️ Menu', callback_data: 'main' }],
  ]}};
}

function chainBtns() {
  return { reply_markup: { inline_keyboard: [
    [{ text: `${CE.solana} Solana`, callback_data: 'chain_solana' }, { text: `${CE.bsc} BSC`, callback_data: 'chain_bsc' }, { text: `${CE.eth} ETH`, callback_data: 'chain_eth' }],
    [{ text: '⬅️ Settings', callback_data: 'cat_settings' }],
  ]}};
}

// Category: Tools
function toolsMenu(uid) {
  const ch = getUserChain(uid);
  return { reply_markup: { inline_keyboard: [
    [{ text: `◎ Solana Tools`, callback_data: 'tools_solana' }, { text: `🔶 BSC Tools`, callback_data: 'tools_bsc' }, { text: `⟠ ETH Tools`, callback_data: 'tools_eth' }],
    [{ text: '⬅️ Menu', callback_data: 'main' }],
  ]}};
}

function solanaToolsMenu() {
  return { reply_markup: { inline_keyboard: [
    [{ text: '⚡ Jito Bundle', callback_data: 'sub_jito' }],
    [{ text: '📡 WebSocket Stream', callback_data: 'sub_wsstream' }],
    [{ text: '🌐 RPC Failover', callback_data: 'sub_rpcfailover' }],
    [{ text: '💾 TX Cache', callback_data: 'sub_txcache' }],
    [{ text: '⛽ Priority Fee', callback_data: 'sub_priorityfee' }],
    [{ text: '⬅️ Tools', callback_data: 'cat_tools' }],
  ]}};
}

function walletGenBtns() {
  return { reply_markup: { inline_keyboard: [
    [{ text: `${CE.solana} Solana`, callback_data: 'wgen_solana' }, { text: `${CE.bsc} BSC`, callback_data: 'wgen_bsc' }, { text: `${CE.eth} ETH`, callback_data: 'wgen_eth' }],
    [{ text: '⬅️ Settings', callback_data: 'cat_settings' }],
  ]}};
}

function topBtns() {
  return { reply_markup: { inline_keyboard: [
    [{ text: 'A+', callback_data: 'top_A+' }, { text: 'A', callback_data: 'top_A' }, { text: 'B', callback_data: 'top_B' }, { text: 'C', callback_data: 'top_C' }, { text: 'D', callback_data: 'top_D' }],
    [{ text: '🏆 All', callback_data: 'top_all' }],
    [{ text: '⬅️ Scanner', callback_data: 'cat_scanner' }],
  ]}};
}

// ===== SCAN/FORMATTING HELPERS =====

async function buildScanMsg(chain, tokens, userId) {
  const maxTokens = 8;
  let t = formatScanHeader(chain, tokens);
  let count = 0;
  for (const tk of tokens.slice(0, maxTokens)) {
    const card = formatTokenCard(tk, count+1) + '\n';
    if ((t + card).length > 3800) break;
    t += card;
    count++;
  }
  if (tokens.length > count) t += `\n...and ${tokens.length - count} more`;

  // Build inline buttons per token (index-based)
  const buttons = [];
  for (let i = 0; i < count; i++) {
    const sym = tokens[i]?.symbol || tokens[i]?.name?.slice(0,8) || `#${i+1}`;
    buttons.push([
      { text: `📊 ${sym}`, callback_data: `qa_${i}` },
      { text: `🎯 Buy 0.08 SOL`, callback_data: `qb_${i}` },
      { text: `👁️ Watch`, callback_data: `qw_${i}` },
    ]);
  }
  buttons.push([{ text: '⬅️ Menu', callback_data: 'main' }]);

  // Store token list for callback lookup
  if (userId) {
    const key = `${userId}_${Date.now()}`;
    quickBuyMap.set(key, tokens.slice(0, count));
    // Store key in buttons so callbacks can find it
    for (let i = 0; i < count; i++) {
      // Prefix index with a hash of the key to keep callback_data short
      const keyHash = key.slice(-6);
      buttons[i][0].callback_data = `qa_${keyHash}_${i}`;
      buttons[i][1].callback_data = `qb_${keyHash}_${i}`;
      buttons[i][2].callback_data = `qw_${keyHash}_${i}`;
    }
  }

  return { text: t, buttons };
}

async function doScan(ctx, chain) {
  try {
    const tokens = await scanChain(chain);
    if (!tokens.length) { await ctx.reply(`${CE[chain]} No tokens found.`); return; }
    tokens.sort((a, b) => {
      const ord = { 'BUY': 0, 'WATCH': 1, 'CAUTION': 2, 'SKIP': 3, 'DANGER': 4 };
      const da = analyzeTokenForDisplay(a).decision, db_ = analyzeTokenForDisplay(b).decision;
      return (ord[da]||5) - (ord[db_]||5) || scoreToken(b).score - scoreToken(a).score;
    });
    const result = await buildScanMsg(chain, tokens, ctx.from?.id);
    // Send result as new message since editMsg on callback context is unreliable
    for (const chunk of result.text.match(/[\s\S]{1,4000}/g) || [result.text]) {
      await ctx.reply(chunk, { parse_mode: 'HTML', reply_markup: chunk === result.text.match(/[\s\S]{1,4000}/g)?.[0] ? { inline_keyboard: result.buttons } : undefined, disable_web_page_preview: true });
    }
  } catch (e) { console.error('[Scan]', e.message); try { await ctx.reply(`Scan error: ${e.message}`); } catch {} }
}

async function doTrending(ctx, chain) {
  try {
    const tokens = await fetchTrending(chain);
    tokens.sort((a, b) => scoreToken(b).score - scoreToken(a).score);
    const result = await buildScanMsg(chain, tokens, ctx.from?.id);
    for (const chunk of result.text.match(/[\s\S]{1,4000}/g) || [result.text]) {
      await ctx.reply(chunk, { parse_mode: 'HTML', reply_markup: chunk === result.text.match(/[\s\S]{1,4000}/g)?.[0] ? { inline_keyboard: result.buttons } : undefined, disable_web_page_preview: true });
    }
  } catch (e) { console.error('[Trending]', e.message); try { await ctx.reply(`Trending error: ${e.message}`); } catch {} }
}

async function doTop(ctx, chain, grade) {
  const { getTopTokens, getTokensByGrade } = await import('../utils/database.js');
  const tokens = grade === 'all' ? getTopTokens(chain, 15) : getTokensByGrade(chain, grade, 10);
  const eb = async (text, opts = {}) => { try { return await ctx.editMessageText(text, { chat_id: ctx.chat?.id, message_id: ctx.callbackQuery?.message?.message_id, ...opts }); } catch { return ctx.reply(text, opts); } };
  if (!tokens.length) { await eb('No tokens.', back()); return; }
  let t = `${CE[chain]} Top${grade==='all'?'':` (${grade})`}:

`;
  tokens.forEach((tk, i) => {
    const { score, decision } = analyzeTokenForDisplay(tk);
    const ic = { 'BUY':'⟢','WATCH':'⟡','SKIP':'⚪','CAUTION':'⟠','DANGER':'❔' }[decision]||'⚪';
    t += `${i+1}. ${tk.name} (${tk.symbol}) [${tk.grade}] ${ic} ${decision}
   MC: $${formatNumber(tk.market_cap)} | Vol: $${formatNumber(tk.volume_24h)} | Score: ${tk.score}
   /analyze_${tk.address}

`;
  });
  await eb(t, { parse_mode: 'HTML', ...back(), disable_web_page_preview: true });
}


// ===== BUY EXECUTION =====

async function execBuy(ctx, chain, addr, amt, slip) {
  // Safety check before buy
  try {
    const safety = await checkTokenSafety(chain, addr);
    if (safety.score < 30) {
      await ctx.reply(`🚨 <b>Safety Check Failed</b>

${formatSafetyReport(safety)}

⚠️ Score ${safety.score}/100 — buy blocked.
Use /safety ${addr} for details.
Type /forcebuy ${addr} ${amt} ${slip} to bypass.`, { parse_mode: 'HTML' });
      return;
    }
  } catch (e) {
    // Safety check failed — continue with buy, just warn
    console.error(`[Safety] Check error for ${addr}:`, e.message);
  }

  if (isPaperMode(ctx.from.id)) {
    paperBuy(ctx.from.id, chain, addr, amt, 0, 'TOKEN');
    await ctx.reply(`${CE[chain]} PAPER BUY: ${amt} ${nativeUnit(chain)} on ${addr.slice(0,8)}...`);
    return;
  }
  const wls = getActiveWallet(chain);
  if (!wls) { await ctx.reply(`${CE[chain]} No wallet. /wallet ${chain}`); return; }
  const msg = await ctx.reply(`${CE[chain]} Buying...`);
  try {
    let r;
    if (chain === 'solana') {
      r = await jupiterSwap({ inputMint: 'So11111111111111111111111111111111111111112', outputMint: addr, amount: Math.floor(amt*1e9), slippageBps: slip*100, walletPublicKey: wls.address, walletPrivateKey: wls.privateKey });
    } else {
      r = await evmBuy({ chain, tokenAddress: addr, amountInNative: amt, walletPrivateKey: wls.privateKey, slippageBps: slip*100 });
    }
    addPosition({ user_id: ctx.from.id, chain, token_address: addr, token_symbol: 'TOKEN', buy_amount_native: amt, buy_price: amt, txid: r.txid, tp_pct: 200, sl_pct: -30 });
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
      `${CE[chain]} <b>BUY OK</b>\n${amt} ${nativeUnit(chain)} | ${addr.slice(0,12)}...\nTX: ${r.txid.slice(0,20)}...\nTP:200% SL:-30%`,
      { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (e) {
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `BUY FAIL: ${e.message}`);
  }
}

// execBuyUnsafe — buy without safety check (used by /forcebuy)
async function execBuyUnsafe(ctx, chain, addr, amt, slip) {
  if (isPaperMode(ctx.from.id)) {
    paperBuy(ctx.from.id, chain, addr, amt, 0, 'TOKEN');
    await ctx.reply(`${CE[chain]} PAPER BUY: ${amt} ${nativeUnit(chain)} on ${addr.slice(0,8)}...`);
    return;
  }
  const wls = getActiveWallet(chain);
  if (!wls) { await ctx.reply(`${CE[chain]} No wallet. /wallet ${chain}`); return; }
  const msg = await ctx.reply(`${CE[chain]} Buying...`);
  try {
    let r;
    if (chain === 'solana') {
      r = await jupiterSwap({ inputMint: 'So11111111111111111111111111111111111111112', outputMint: addr, amount: Math.floor(amt*1e9), slippageBps: slip*100, walletPublicKey: wls.address, walletPrivateKey: wls.privateKey });
    } else {
      r = await evmBuy({ chain, tokenAddress: addr, amountInNative: amt, walletPrivateKey: wls.privateKey, slippageBps: slip*100 });
    }
    addPosition({ user_id: ctx.from.id, chain, token_address: addr, token_symbol: 'TOKEN', buy_amount_native: amt, buy_price: amt, txid: r.txid, tp_pct: 200, sl_pct: -30 });
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
      `${CE[chain]} <b>BUY OK (bypassed safety)</b>\n${amt} ${nativeUnit(chain)} | ${addr.slice(0,12)}...\nTX: ${r.txid.slice(0,20)}...\nTP:200% SL:-30%`,
      { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (e) {
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `BUY FAIL: ${e.message}`);
  }
}

// ===== SETUP =====

export function setupCommands(bot) {

  const ADMIN_IDS = config.adminIds || [];
  const BANNER_PATH = process.cwd() + '/media/banner.jpg';

  // ===== PIN AUTH =====
  const pinState = new Map(); // uid -> { step: 'waiting'|'idle' }

  function needsAuth(uid) {
    return !ADMIN_IDS.includes(uid) && !isAuthorized(uid);
  }

  bot.command('setpin', ctx => {
    const uid = ctx.from.id;
    if (!ADMIN_IDS.includes(uid)) return ctx.reply('Unauthorized.');
    const pin = ctx.message.text.split(' ')[1];
    if (!pin || pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) return ctx.reply('Format: /setpin <4-6 digit>\nContoh: /setpin 1234');
    authorizeUser(uid, pin);
    ctx.reply('✅ PIN diset. Gunakan /login &lt;PIN&gt; untuk akses.');
  });

  bot.command('login', ctx => {
    const uid = ctx.from.id;
    const pin = ctx.message.text.split(' ')[1];
    if (!pin) return ctx.reply('Format: /login &lt;PIN&gt;');
    if (verifyPin(uid, pin)) {
      ctx.reply('✅ Login berhasil!');
      ctx.replyWithPhoto({ source: BANNER_PATH }, { caption: `◎ Crypto Sniper Bot v3.0\nMulti-Chain: Solana | BSC | ETH\nMode: ${isPaperMode(uid)?'🧪 PAPER':'⚡ LIVE'}`, ...mainMenu(uid) });
    } else {
      ctx.reply('❌ PIN salah.');
    }
  });

  bot.command('lock', ctx => {
    deauthorizeUser(ctx.from.id);
    ctx.reply('🔒 Bot terkunci. Ketik /login &lt;PIN&gt; untuk buka.');
  });

  // Auth gate middleware - reject non-auth users from all commands except /login /setpin
  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    const text = ctx.message?.text || '';
    const isAuthCmd = text.startsWith('/login') || text.startsWith('/setpin') || text.startsWith('/start');
    if (uid && needsAuth(uid) && !isAuthCmd) {
      await ctx.reply('🔒 Bot dilindungi PIN.\nKetik /login &lt;PIN&gt; untuk akses.');
      return; // don't pass to next handler
    }
    return next();
  });

  const menu = ctx => ctx.replyWithPhoto({ source: BANNER_PATH }, { caption: `◎ Crypto Sniper Bot v3.0\nMulti-Chain: Solana | BSC | ETH\nMode: ${isPaperMode(ctx.from.id)?'🧪 PAPER':'⚡ LIVE'}`, ...mainMenu(ctx.from.id) });

  bot.start(menu);
  bot.command('menu', menu);

  bot.help(async ctx => {
    const parts = [
      `<b>Cypher Sniper Bot v3.0</b>\nMulti-chain: Solana | BSC | ETH\n\n`,
      `<b>SCANNER</b>\n/scan - Token terbaik (grade A-B)\n/scanall - Semua token terdeteksi\n/analyze &lt;addr&gt; - Detail token\n/top - Top token by score\n/newpair on|off - Token baru listing\n/newpairfilters - Filter token baru\n\n`,
      `<b>TRADE</b>\n/buy &lt;token&gt; &lt;amount&gt; [slip] - Beli manual\n/forcebuy &lt;token&gt; &lt;amount&gt; [slip] - Buy skip safety\n/sell &lt;token&gt; [slip] - Jual semua\n/portfolio - Posisi aktif\n/trail &lt;token&gt; &lt;pct&gt; - Trailing stop\n/trailoff &lt;token&gt; - Stop trailing\n/traillist - Trailing aktif\n\n`,
      `<b>AUTO</b>\n/autobuy set &lt;min_mc&gt; &lt;max_mc&gt; &lt;min_holders&gt; &lt;min_liq&gt; &lt;amount&gt; &lt;max_buys&gt; &lt;slip&gt;\n/autobuy on|off - Toggle auto-buy\n/autobuy status - Cek status\n/smartadd &lt;wallet&gt; [label] - Track wallet\n/smartlist - Wallet di-track\n/smartscan - Analisis ulang\n/smartremove &lt;id&gt; - Hapus tracking\n/watch &lt;token&gt; [note] - Tambah watchlist\n/watchlist - Watchlist + harga live\n/unwatch &lt;id&gt; - Hapus watchlist\n\n`,
      `<b>SAFETY</b>\n/safety &lt;token&gt; - Cek keamanan (0-100)\n/autosell on|off - Auto-sell TP/SL\n/limitbuy &lt;token&gt; &lt;price&gt; &lt;amount&gt; [slip]\n/limitsell &lt;token&gt; &lt;price&gt; [slip]\n/limitlist - Pending orders\n/limitcancel &lt;id&gt; - Batalkan order\n/report - Laporan PnL harian\n/reportset &lt;jam&gt; - Jam auto-report\n/backup - Backup wallet terenkripsi\n/restore &lt;string&gt; - Restore wallet\n\n`,
      `<b>TOOLS</b>\n/calc &lt;price&gt; &lt;amount&gt; [tp1] [tp2] [tp3]\n/pricealert &lt;token&gt; <above|below> &lt;price&gt; [once|recurring]\n/alertlist - Active alerts\n/alertcancel &lt;id&gt; - Batalkan alert\n/wallet add|list|remove|active\n/chain solana|bsc|eth\n/paper on|off\n/setpin &lt;pin&gt; - Set PIN (admin)\n/login &lt;pin&gt; - Login (user)\n/lock - Kunci bot\n\n`,
      `<b>SPEED TOOLS (Solana)</b>\n/jito on|off - Toggle Jito Bundle\n/jito tip <lamports> - Set tip amount\n/jito status - Check status\n/wsstream on|off - Toggle WebSocket stream\n/wsstream status - Check stream status\n/rpctest - Test all RPC latency\n/rpcfailover on|off - Toggle RPC failover\n/priorityfee low|medium|high|turbo|auto - Estimate fee\n\n`,
      `<b>KRITERIA AUTO-SNIPE</b>\n\nGrade A (80-100) Premium\nMC $5K-$100K, Holders >50\nVolume >$10K, Liq >$5K\nLP burned, no mint/freeze\n\nGrade B (60-79) Bagus\nMC $3K-$200K, Holders >20\nVolume >$3K, Liq >$2K\nTax <5%\n\nGrade C (40-59) Risikon\nMC $1K-$500K, Holders >10\nVolume >$1K, Liq >$500\nTax <15%\n\nGrade D (20-39) Berisiko\nHolder <10, Volume rendah\n\nGrade F (0-19) Bahaya\nHoneypot, LP tidak locked\nMint/freeze authority aktif\n\n`,
      `<b>SAFETY CHECK</b>\nScore <30 = BLOCKED\nScore 30-49 = WARNING\nScore >=50 = OK\n\nDicek: freeze authority, mint authority, honeypot detection, buy/sell tax, LP status, holder distribution\n\n`,
      `<b>DEFAULT AUTO-BUY</b>\nMin MC: $5,000\nMax MC: $100,000\nMin Holders: 20\nMin Liq: $5,000\nAmount: 0.08 SOL\nMax Buy/Hour: 1\nSlippage: 15%\n\n`,
      `<b>SETUP AWAL</b>\n1. /wallet add\n2. /setpin &lt;pin&gt;\n3. /autobuy set 5000 100000 20 5000 0.08 1 15\n4. /autosell on\n5. /newpair on\n6. Deposit 0.1 SOL`
    ];
    for (const p of parts) {
      await ctx.reply(p, { parse_mode: 'HTML', disable_web_page_preview: true });
    }
  });


  // ===== TEXT COMMANDS =====

  bot.command('scan', async ctx => {
    const ch = getUserChain(ctx.from.id);
    const msg = await ctx.reply(`${CE[ch]} Scanning...`);
    try {
      const tokens = await scanChain(ch);
      if (!tokens.length) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'No tokens.'); return; }
      tokens.sort((a,b) => { const o={BUY:0,WATCH:1,CAUTION:2,SKIP:3,DANGER:4}; const da=analyzeTokenForDisplay(a).decision,db_=analyzeTokenForDisplay(b).decision; return (o[da]||5)-(o[db_]||5)||scoreToken(b).score-scoreToken(a).score; });
      const result = await buildScanMsg(ch, tokens, ctx.from.id);
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, result.text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: result.buttons }, disable_web_page_preview: true });
    } catch(e) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${e.message}`); }
  });

  bot.command('buy', ctx => {
    const p = ctx.message.text.split(' ');
    const addr = p[1], amt = parseFloat(p[2]), slip = parseFloat(p[3])||10;
    if (!addr||!amt||amt<=0) return ctx.reply(`Format: /buy &lt;token_address&gt; <amount_${nativeUnit(getUserChain(ctx.from.id))}> [slippage%]`);
    execBuy(ctx, getUserChain(ctx.from.id), addr, amt, slip);
  });

  bot.command('sell', async ctx => {
    const p = ctx.message.text.split(' ');
    const addr = p[1], slip = parseFloat(p[2])||10;
    if (!addr) return ctx.reply('Format: /sell &lt;token_address&gt; [slippage%]');
    if (isPaperMode(ctx.from.id)) {
      paperSell(ctx.from.id, getUserChain(ctx.from.id), addr, 0);
      await ctx.reply(`PAPER SELL: ${addr.slice(0,8)}...`);
      return;
    }
    const ch = getUserChain(ctx.from.id), msg = await ctx.reply(`${CE[ch]} Selling...`);
    try {
      const wls = getActiveWallet(ch);
      if (!wls) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'No wallet.'); return; }
      let r;
      if (ch === 'solana') {
        const { getTokenBalance } = await import('../services/solana-swapper.js');
        const bal = await getTokenBalance(addr, wls.address);
        if (!bal) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'No balance.'); return; }
        r = await jupiterSell({ tokenMint: addr, tokenAmount: bal.toString(), walletPublicKey: wls.address, walletPrivateKey: wls.privateKey, slippageBps: slip*100 });
      } else {
        r = await evmSell({ chain: ch, tokenAddress: addr, walletPrivateKey: wls.privateKey, slippageBps: slip*100 });
      }
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `${CE[ch]} <b>SELL OK</b>\nTX: ${r.txid.slice(0,20)}...`, { parse_mode: 'HTML' });
    } catch(e) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `SELL FAIL: ${e.message}`); }
  });

  bot.command('top', ctx => {
    const ch = getUserChain(ctx.from.id), g = ctx.message.text.replace('/top','').trim().toUpperCase();
    doTop({ ...ctx, editMessageText: (t,o) => ctx.reply(t,o) }, ch, g||'all');
  });

  bot.command('analyze', async ctx => {
    const p = ctx.message.text.split(' '), addr = p[1]||'', ch = getUserChain(ctx.from.id);
    if (!addr) return ctx.reply('Format: /analyze &lt;token_address&gt;');
    const cl = addr.replace(/^\/analyze_/,''), msg = await ctx.reply('Analyzing...');
    try {
      const [ov,h] = await Promise.all([getTokenOverview(cl), analyzeHolders(cl)]);
      let t = `${CE[ch]} <b>Analysis</b> - ${CL[ch]}\n<code>${cl.slice(0,12)}...${cl.slice(-6)}</code>\n\n`;
      if (ov) {
        t += `<b>${ov.symbol||'N/A'}</b>\nPrice: $${parseFloat(ov.price||0).toExponential(4)}\nMC: $${formatNumber(parseFloat(ov.mc||0))}\nVol: $${formatNumber(parseFloat(ov.v24hUSD||0))}\nLiq: $${formatNumber(parseFloat(ov.liquidity||0))}\n`;
        t += `24h: ${ov.priceChange24h||'N/A'}% | 6h: ${ov.priceChange6h||'N/A'}% | 1h: ${ov.priceChange1h||'N/A'}%\n`;
      } else t += `Basic info: N/A\n`;
      t += `\n<b>Holders:</b>\n`;
      if (h) { t += `Top: ${h.topHolderPct}% | Top5: ${h.top5Pct}% | Risk: ${h.risk}\n`; h.holders.forEach((x,i)=>{t+=`  ${i+1}. <code>${x.address.slice(0,8)}...${x.address.slice(-4)}</code> (${x.pct}%)\n`;}); }
      else t += `N/A\n`;
      t += `\n<a href="https://dexscreener.com/${ch}/${cl}">Dexscreener</a>`;
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, t, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch(e) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${e.message}`); }
  });

  bot.command('trending', async ctx => {
    const ch = getUserChain(ctx.from.id), msg = await ctx.reply(`${CE[ch]} Loading...`);
    try {
      const tokens = await fetchTrending(ch);
      const result = await buildScanMsg(ch, tokens, ctx.from.id);
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, result.text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: result.buttons }, disable_web_page_preview: true });
    } catch(e) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${e.message}`); }
  });

  bot.command('wallet', async ctx => {
    const p = ctx.message.text.split(' ');
    let ch = (p[1]||getUserChain(ctx.from.id)).toLowerCase();
    if (!CL[ch]) return ctx.reply('Format: /wallet [solana|bsc|eth]', walletGenBtns());
    try {
      let w; if (ch==='solana') w=generateSolanaWallet(); else {w=generateEVMWallet();w.chain=ch;}
      saveWallet(w);
      let t = `${CE[ch]} <b>Wallet ${CL[ch]}</b>\n\nAddress:\n<code>${w.address}</code>\n\nPrivate Key:\n<code>${w.privateKey}</code>\n`;
      if (w.mnemonic) t += `\n<b>Mnemonic</b>:\n<code>${w.mnemonic}</code>`;
      ctx.reply(t, { parse_mode: 'HTML' });
    } catch(e) { ctx.reply(`Error: ${e.message}`); }
  });

  bot.command('mywallets', ctx => {
    const wls = getSavedWallets();
    if (!wls.length) return ctx.reply('No wallet. /wallet to generate.');
    let t = '<b>Wallets:</b>\n\n'; let prev='';
    wls.forEach(w => { if (w.chain!==prev){prev=w.chain;t+=`${CE[prev]} ${CL[prev]}:\n`;} t+=`  #${w.id} <code>${w.address}</code>\n`; });
    ctx.reply(t, { parse_mode: 'HTML' });
  });

  bot.command('portfolio', ctx => {
    const pos = getOpenPositions(ctx.from.id);
    if (!pos.length) return ctx.reply('No open positions.');
    let t = '<b>Open Positions:</b>\n\n';
    pos.forEach((p,i) => { t += `${i+1}. ${CE[p.chain]||''} ${p.token_symbol} (${p.token_address.slice(0,8)}...)\n   Buy: ${p.buy_amount_native} | TP:+${p.tp_pct}% | SL:${p.sl_pct}%\n   /sell_${p.token_address}\n\n`; });
    ctx.reply(t, { parse_mode: 'HTML', disable_web_page_preview: true });
  });

  bot.command('pnl', ctx => {
    const s = getPortfolioSummary(ctx.from.id);
    ctx.reply(`<b>Portfolio</b>\n\nOpen: ${s.openPositions} | Invested: ${s.totalInvested}\nClosed: ${s.closedTrades}\nW: ${s.wins} | L: ${s.losses} | Rate: ${s.winRate}%\nPnL: ${s.totalPnl>=0?'+':''}${s.totalPnl.toFixed(4)}`, { parse_mode: 'HTML' });
  });

  bot.command('network', ctx => ctx.reply('Pilih:', chainBtns()));

  bot.command('stats', ctx => {
    const st = getStats(); let t = `<b>Stats</b>\nTotal: ${st.total}\n\n`;
    st.byChain.forEach(c=>{t+=`  ${CE[c.chain]||''} ${CL[c.chain]||c.chain}: ${c.count}\n`;});
    t += '\n'; st.byGrade.forEach(g=>{t+=`  ${g.grade}: ${g.count}\n`;});
    ctx.reply(t, { parse_mode: 'HTML' });
  });

  // Copy Trade
  bot.command('copy', ctx => {
    const p = ctx.message.text.split(' ');
    const addr = p[1], label = p.slice(2).join(' ') || 'Watched';
    if (!addr) return ctx.reply('Format: /copy &lt;wallet_address&gt; [label]');
    const ch = getUserChain(ctx.from.id);
    addWatchWallet(ctx.from.id, ch, addr, label);
    ctx.reply(`${CE[ch]} Now watching wallet for copy trade.\n/uncopy to stop.`);
  });

  bot.command('uncopy', ctx => {
    const id = parseInt(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply('Format: /uncopy &lt;id&gt;');
    removeWatchWallet(id);
    ctx.reply('Stopped watching.');
  });

  bot.command('copylist', ctx => {
    const wls = getWatchWallets(ctx.from.id);
    if (!wls.length) return ctx.reply('No watched wallets.\n/copy &lt;address&gt; to add.');
    let t = '<b>Copy Trade Watches:</b>\n\n';
    wls.forEach(w => { t += `#${w.id} ${CE[w.chain]} ${w.label} | <code>${w.wallet_address.slice(0,10)}...</code> | ${w.active?'✅':'❌'}\n`; });
    ctx.reply(t, { parse_mode: 'HTML' });
  });

  // Auto-Buy
  bot.command('autobuy', ctx => {
    const p = ctx.message.text.split(' ');
    const cmd = p[1], ch = getUserChain(ctx.from.id);
    if (cmd === 'on') { setAutoBuyConfig(ctx.from.id, ch, 1); ctx.reply(`${CE[ch]} Auto-buy ON`); }
    else if (cmd === 'off') { setAutoBuyConfig(ctx.from.id, ch, 0); ctx.reply(`${CE[ch]} Auto-buy OFF`); }
    else if (cmd === 'set') { setAutoBuyConfig(ctx.from.id, ch, null, p[2], p[3], p[4], p[5], p[6], p[7], p[8]); ctx.reply('Config updated.'); }
    else { const cfg = getAutoBuyConfig(ctx.from.id, ch); ctx.reply(`Auto-Buy ${CL[ch]}: ${cfg?.enabled?'ON':'OFF'}\nMC: $${cfg?.min_mc||0}-$${cfg?.max_mc||'∞'}\nHolders:>${cfg?.min_holders||0} Liq:>$${cfg?.min_liq||0}\nAmount: ${cfg?.amount_per_buy||0} ${nativeUnit(ch)}/buy\nMax: ${cfg?.max_buys_per_hour||1}/hour`); }
  });

  // DCA
  bot.command('dca', ctx => {
    const p = ctx.message.text.split(' ');
    if (p[1] === 'list') { const ords = getActiveDCAOrders(ctx.from.id); if (!ords.length) return ctx.reply('No active DCA orders.'); let t=''; ords.forEach(o=>{t+=`#${o.id} ${CE[o.chain]} ${o.token_address.slice(0,8)}... ${o.executed_slices}/${o.slices}\n`;}); ctx.reply(t); return; }
    if (p[1] === 'cancel') { cancelDCAOrder(parseInt(p[2])); ctx.reply('Cancelled.'); return; }
    if (!p[1]||!p[2]||!p[3]||!p[4]) return ctx.reply('Format:\n/dca &lt;token&gt; &lt;total_amount&gt; &lt;slices&gt; &lt;interval_sec&gt; [slippage]\n/dca list\n/dca cancel &lt;id&gt;');
    const ch = getUserChain(ctx.from.id);
    createDCAOrder(ctx.from.id, ch, p[1], parseFloat(p[2]), parseInt(p[3]), parseInt(p[4]), parseFloat(p[5])||10);
    ctx.reply(`${CE[ch]} DCA order created: ${p[3]} slices of ${parseFloat(p[2])/parseInt(p[3])} ${nativeUnit(ch)} each.`);
  });

  // Paper Trading
  bot.command('paper', ctx => {
    const cmd = ctx.message.text.split(' ')[1];
    if (cmd === 'on') { setPaperMode(ctx.from.id, 1); ctx.reply('🧪 Paper mode ON'); }
    else if (cmd === 'off') { setPaperMode(ctx.from.id, 0); ctx.reply('⚡ Paper mode OFF - LIVE trading'); }
    else { ctx.reply(`Paper mode: ${isPaperMode(ctx.from.id)?'🧪 ON':'⚡ OFF'}\n/paper on|off`); }
  });

  bot.command('paper_portfolio', ctx => {
    const pos = getPaperPortfolio(ctx.from.id);
    const pnl = getPaperPnL(ctx.from.id);
    let t = `<b>Paper Portfolio</b> (${pnl.mode})\nBalance: $${pnl.balance?.toFixed(2)}\nPnL: ${pnl.pnl>=0?'+':''}${pnl.pnl?.toFixed(2)}\n\n`;
    pos.forEach((p,i) => { t += `${i+1}. ${p.token_symbol} | Entry: $${p.amount_native} | ${p.status}\n`; });
    ctx.reply(t, { parse_mode: 'HTML' });
  });

  bot.command('snipe', ctx => {
    const addr = ctx.message.text.split(' ')[1];
    if (!addr) return ctx.reply('Format: /snipe &lt;token_address&gt;');
    const ch = getUserChain(ctx.from.id);
    const amt = ch === 'solana' ? 0.01 : ch === 'eth' ? 0.001 : 0.005;
    execBuy(ctx, ch, addr, amt, 15);
  });

  // ===== AUTO-SELL COMMAND =====
  bot.command('autosell', ctx => {
    const cmd = ctx.message.text.split(' ')[1];
    if (!cmd || cmd === 'status') {
      const on = getAutoSellStatus(ctx.from.id);
      ctx.reply(`Auto-sell: ${on ? '✅ ON' : '❌ OFF'}
/autosell on|off`);
      return;
    }
    if (cmd === 'on') { setAutoSell(ctx.from.id, true); ctx.reply('✅ Auto-sell ON — positions will auto-close on TP/SL'); }
    else if (cmd === 'off') { setAutoSell(ctx.from.id, false); ctx.reply('❌ Auto-sell OFF'); }
    else { ctx.reply('Format: /autosell on|off'); }
  });

  // ===== SAFETY CHECK COMMAND =====
  bot.command('safety', async ctx => {
    const addr = ctx.message.text.split(' ')[1];
    if (!addr) return ctx.reply('Format: /safety &lt;token_address&gt;');
    const ch = getUserChain(ctx.from.id);
    const msg = await ctx.reply('Checking token safety...');
    try {
      const result = await checkTokenSafety(ch, addr);
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, formatSafetyReport(result), { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (e) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Safety check error: ${e.message}`);
    }
  });

  // ===== FORCE BUY (bypass safety) =====
  bot.command('forcebuy', ctx => {
    const p = ctx.message.text.split(' ');
    const addr = p[1], amt = parseFloat(p[2]), slip = parseFloat(p[3])||10;
    if (!addr||!amt||amt<=0) return ctx.reply(`Format: /forcebuy &lt;token&gt; &lt;amount&gt; [slip%]`);
    // Skip safety check by calling original buy logic
    execBuyUnsafe(ctx, getUserChain(ctx.from.id), addr, amt, slip);
  });

  // ===== LIMIT ORDER COMMANDS =====
  bot.command('limitbuy', ctx => {
    const p = ctx.message.text.split(' ');
    const addr = p[1], targetPrice = parseFloat(p[2]), amount = parseFloat(p[3]), slip = parseFloat(p[4]) || 10;
    if (!addr || !targetPrice || !amount || targetPrice <= 0 || amount <= 0) {
      return ctx.reply('Format: /limitbuy &lt;token&gt; &lt;target_price&gt; &lt;amount&gt; [slippage%]\n\nExample:\n/limitbuy TokenAddr 0.00001 0.01 10');
    }
    const ch = getUserChain(ctx.from.id);
    const id = createLimitOrder(ctx.from.id, ch, addr, 'buy', targetPrice, amount, slip);
    ctx.reply(`${CE[ch]} Limit buy #${id} placed\nTarget: $${targetPrice}\nAmount: ${amount} ${nativeUnit(ch)}`);
  });

  bot.command('limitsell', ctx => {
    const p = ctx.message.text.split(' ');
    const addr = p[1], targetPrice = parseFloat(p[2]), slip = parseFloat(p[3]) || 10;
    if (!addr || !targetPrice || targetPrice <= 0) {
      return ctx.reply('Format: /limitsell &lt;token&gt; &lt;target_price&gt; [slippage%]\n\nSells entire position.');
    }
    const ch = getUserChain(ctx.from.id);
    const id = createLimitOrder(ctx.from.id, ch, addr, 'sell', targetPrice, 0, slip);
    ctx.reply(`${CE[ch]} Limit sell #${id} placed\nTarget: $${targetPrice}\nSells full position.`);
  });

  bot.command('limitlist', ctx => {
    const orders = getLimitOrders(ctx.from.id);
    if (!orders.length) return ctx.reply('No limit orders.\n/limitbuy &lt;token&gt; &lt;price&gt; &lt;amount&gt;\n/limitsell &lt;token&gt; &lt;price&gt;');
    let t = '<b>Limit Orders:</b>\n\n';
    orders.forEach(o => {
      const statusEmoji = o.status === 'pending' ? '⏳' : o.status === 'filled' ? '✅' : '❌';
      t += `#${o.id} ${statusEmoji} ${CE[o.chain]||''} ${o.side.toUpperCase()} ${o.token_address.slice(0,10)}...\n   Target: $${o.target_price} | ${o.amount > 0 ? 'Amt: '+o.amount : 'Full position'}\n   Status: ${o.status}\n\n`;
    });
    ctx.reply(t, { parse_mode: 'HTML' });
  });

  bot.command('limitcancel', ctx => {
    const id = parseInt(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply('Format: /limitcancel &lt;id&gt;');
    if (cancelLimitOrder(id, ctx.from.id)) {
      ctx.reply(`Limit order #${id} cancelled.`);
    } else {
      ctx.reply(`Order #${id} not found or already filled/cancelled.`);
    }
  });

  // ===== STRATEGY COMMAND =====
  bot.command('strategy', ctx => {
    const p = ctx.message.text.split(' ');
    const sub = p[1];
    const ch = getUserChain(ctx.from.id);

    if (!sub) {
      const r = getStrategyReport(ctx.from.id);
      if (!r) return ctx.reply(`Set strategi dulu:

/strategy set &lt;daily_budget&gt; &lt;max_per_trade&gt; &lt;max_trades&gt; <target_roi%> <stop_loss%>

Contoh:
/strategy set 0.1 0.01 10 200 50`);
      const nu = nativeUnit(ch);
      ctx.reply(
        `<b>🎯 Strategy Report</b> ${CE[ch]}
` +
        `Status: ${r.enabled ? '✅ ON' : '❌ OFF'} ${r.paused ? '⚠️ PAUSED' : ''}
` +
        `Budget: ${r.daily_budget} ${nu}/day
` +
        `Max/trade: ${r.max_per_trade} ${nu}
` +
        `Max trades: ${r.max_trades_day}/day
` +
        `Target ROI: +${r.target_roi}%
` +
        `Stop Loss: -${r.stop_loss}%
` +
        `Auto-reinvest: ${r.auto_reinvest ? 'ON' : 'OFF'}
` +
        `
<b>Today:</b>
` +
        `Spent: ${r.spent_today.toFixed(4)} ${nu}
` +
        `Remaining: ${r.remaining.toFixed(4)} ${nu}
` +
        `Trades: ${r.trades_today}
` +
        `Total PnL: ${r.total_pnl >= 0 ? '+' : ''}${r.total_pnl.toFixed(4)} ${nu}
` +
        `
/strategy on|off|pause|resume
/strategy set &lt;budget&gt; <max/trade> &lt;max_trades&gt; &lt;roi&gt; &lt;sl&gt;
/strategy reinvest on|off`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (sub === 'on') { setStrategy(ctx.from.id, { enabled: 1 }); ctx.reply('🎯 Strategy ON'); }
    else if (sub === 'off') { setStrategy(ctx.from.id, { enabled: 0 }); ctx.reply('🎯 Strategy OFF'); }
    else if (sub === 'pause') { pauseStrategy(ctx.from.id); ctx.reply('Strategy PAUSED'); }
    else if (sub === 'resume') { resumeStrategy(ctx.from.id); ctx.reply('Strategy RESUMED'); }
    else if (sub === 'set') {
      if (!p[2]) return ctx.reply('Format: /strategy set &lt;daily_budget&gt; &lt;max_per_trade&gt; &lt;max_trades&gt; <target_roi%> <stop_loss%>');
      setStrategy(ctx.from.id, {
        daily_budget: parseFloat(p[2]),
        max_per_trade: parseFloat(p[3]),
        max_trades_day: parseInt(p[4]),
        target_roi: parseFloat(p[5]),
        stop_loss: parseFloat(p[6]),
        enabled: 1,
        chain: ch,
      });
      ctx.reply(`Strategy set! Budget: ${p[2]} ${nativeUnit(ch)}/day | Max: ${p[3]} ${nativeUnit(ch)}/trade | Trades: ${p[4]}/day | ROI: +${p[5]}% | SL: -${p[6]}%`);
    }
    else if (sub === 'reinvest') {
      const v = p[2] === 'on' ? 1 : 0;
      setStrategy(ctx.from.id, { auto_reinvest: v });
      ctx.reply(`Auto-reinvest: ${v ? 'ON' : 'OFF'}`);
    }
    else { ctx.reply('Sub: on|off|pause|resume|set|reinvest'); }
  });

  bot.command('clear', async ctx => {
    if (!config.adminIds.includes(ctx.from.id)) return ctx.reply('Unauthorized');
    const { getDb } = await import('../utils/database.js');
    const db = getDb();
    db.exec('DELETE FROM scanned_tokens');
    ctx.reply('Cleared.');
  });

  bot.command('channel_add', ctx => {
    const p = ctx.message.text.split(' ');
    const channelId = p[1];
    const label = p.slice(2).join(' ') || channelId;
    if (!channelId) return ctx.reply('Format: /channel_add &lt;channel_id&gt; [label]');
    const ch = getUserChain(ctx.from.id);
    addChannelMonitor(ctx.from.id, channelId, ch, label);
    ctx.reply(`Channel monitor added for ${channelId}.`);
  });

  bot.command('channel_rm', ctx => {
    const channelId = ctx.message.text.split(' ')[1];
    if (!channelId) return ctx.reply('Format: /channel_rm &lt;channel_id&gt;');
    removeChannelMonitor(ctx.from.id, channelId);
    ctx.reply('Channel monitor removed.');
  });

  bot.command('tieredtp', ctx => {
    const p = ctx.message.text.split(' ');
    const addr = p[1];
    if (!addr) return ctx.reply('Format: /tieredtp &lt;token&gt; [100:25,200:25,500:50]');
    const tiers = (p[2] || '100:25,200:25,500:50').split(',').map(item => {
      const [pct, sellPct] = item.split(':').map(Number);
      return { pct, sellPct };
    }).filter(t => Number.isFinite(t.pct) && Number.isFinite(t.sellPct));
    setTieredTP(ctx.from.id, getUserChain(ctx.from.id), addr, tiers);
    ctx.reply(`Tiered TP set for ${addr.slice(0, 8)}...`);
  });

  bot.command('rotate_add', ctx => {
    const p = ctx.message.text.split(' ');
    const address = p[1], privateKey = p[2];
    if (!address || !privateKey) return ctx.reply('Format: /rotate_add &lt;address&gt; &lt;private_key&gt;');
    const ch = getUserChain(ctx.from.id);
    const id = addWalletToRotation(ctx.from.id, ch, address, privateKey);
    ctx.reply(id ? `Rotation wallet #${id} added for ${CL[ch]}.` : 'Failed to add rotation wallet.');
  });

  bot.command('rotate_rm', ctx => {
    const id = parseInt(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply('Format: /rotate_rm &lt;id&gt;');
    ctx.reply(removeWalletFromRotation(id) ? 'Rotation wallet removed.' : 'Wallet not found.');
  });

  bot.command('rotate_list', ctx => {
    const ch = getUserChain(ctx.from.id);
    const wallets = listRotationWallets(ch);
    if (!wallets.length) return ctx.reply(`No rotation wallets for ${CL[ch]}.`);
    let t = `<b>Rotation Wallets - ${CL[ch]}</b>\n\n`;
    wallets.forEach(w => { t += `#${w.id} ${w.active ? '✅' : '❌'} <code>${w.address}</code>\n`; });
    ctx.reply(t, { parse_mode: 'HTML' });
  });

  // ===== TRAILING STOP COMMANDS =====
  bot.command('trail', ctx => {
    const p = ctx.message.text.split(' ');
    const addr = p[1];
    const pct = parseFloat(p[2]) || 10;
    if (!addr) return ctx.reply('Format: /trail &lt;token_address&gt; [trail_pct%]\n\nDefault trail: 10%\nExample: /trail TokenAddr 15');
    const ch = getUserChain(ctx.from.id);
    const id = addTrailingStop(ctx.from.id, ch, addr, pct);
    if (!id) return ctx.reply('Trailing stop already active for this token.');
    ctx.reply(`${CE[ch]} Trailing stop #${id} active\nToken: <code>${addr.slice(0,16)}...</code>\nTrail: ${pct}% from highest\n/trailoff ${addr.slice(0,8)} to disable\n/traillist to view`, { parse_mode: 'HTML' });
  });

  bot.command('trailoff', ctx => {
    const addr = ctx.message.text.split(' ')[1];
    if (!addr) return ctx.reply('Format: /trailoff &lt;token_address&gt;');
    if (disableTrailingStop(ctx.from.id, addr)) {
      ctx.reply(`Trailing stop disabled for ${addr.slice(0,12)}...`);
    } else {
      ctx.reply(`No active trailing stop found for ${addr.slice(0,12)}...`);
    }
  });

  bot.command('traillist', ctx => {
    const stops = getActiveTrailingStops(ctx.from.id);
    if (!stops.length) return ctx.reply('No active trailing stops.\n/trail &lt;token&gt; [pct%] to add.');
    let t = '<b>Active Trailing Stops:</b>\n\n';
    stops.forEach(s => {
      t += `#${s.id} ${CE[s.chain]} <code>${s.token_address.slice(0,12)}...</code>\n   Trail: ${s.trail_pct}% | Highest: ${s.highest_price > 0 ? s.highest_price.toExponential(4) : 'tracking...'}\n\n`;
    });
    ctx.reply(t, { parse_mode: 'HTML' });
  });

  // ===== DAILY REPORT COMMANDS =====
  bot.command('report', async ctx => {
    const report = generateDailyReport(ctx.from.id);
    await ctx.reply(report, { parse_mode: 'HTML' });
  });

  bot.command('reportset', ctx => {
    const hour = parseInt(ctx.message.text.split(' ')[1]);
    if (isNaN(hour) || hour < 0 || hour > 23) return ctx.reply('Format: /reportset &lt;hour&gt;\n\nDefault: 15 (22:00 WIB)\nExample: /reportset 15');
    setReportHour(ctx.from.id, hour);
    ctx.reply(`Daily report scheduled at ${hour}:00 UTC (WIB: ${((hour + 7) % 24)}:00).`);
  });

  // ===== SMART MONEY COMMANDS =====
  bot.command('smartadd', ctx => {
    const p = ctx.message.text.split(' ');
    const addr = p[1];
    const label = p.slice(2).join(' ') || 'Smart Wallet';
    if (!addr) return ctx.reply('Format: /smartadd &lt;wallet_address&gt; [label]');
    const ch = getUserChain(ctx.from.id);
    const id = addSmartWallet(ctx.from.id, addr, label, ch);
    if (!id) return ctx.reply('Wallet already tracked.');
    ctx.reply(`🧠 Smart wallet #${id} added\n<code>${addr.slice(0,16)}...</code>\nLabel: ${label}\nChain: ${CL[ch]}`, { parse_mode: 'HTML' });
  });

  bot.command('smartlist', ctx => {
    const wallets = getSmartWallets(ctx.from.id);
    if (!wallets.length) return ctx.reply('No tracked wallets.\n/smartadd &lt;address&gt; [label] to add.');
    let t = '<b>🧠 Smart Money Wallets:</b>\n\n';
    wallets.forEach(w => {
      t += `#${w.id} ${CE[w.chain]} ${w.label}\n   <code>${w.address.slice(0,16)}...</code>\n   Trades: ${w.trades} | Win: ${w.win_rate.toFixed(0)}% | PnL: ${w.pnl.toFixed(4)}\n\n`;
    });
    t += `/smartscan to analyze all\n/smartremove &lt;id&gt; to remove`;
    ctx.reply(t, { parse_mode: 'HTML' });
  });

  bot.command('smartremove', ctx => {
    const id = parseInt(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply('Format: /smartremove &lt;id&gt;');
    if (removeSmartWallet(id, ctx.from.id)) {
      ctx.reply(`Smart wallet #${id} removed.`);
    } else {
      ctx.reply('Wallet not found.');
    }
  });

  bot.command('smartscan', async ctx => {
    const msg = await ctx.reply('🧠 Analyzing smart wallets...');
    try {
      const results = await scanAllSmartWallets(bot, ctx.from.id);
      if (!results || !results.length) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'No tracked wallets.\n/smartadd &lt;address&gt; [label] to add.');
        return;
      }
      let t = '<b>🧠 Smart Money Scan Results:</b>\n\n';
      results.forEach(r => {
        t += `${r.label}: ${r.trades} trades | Win: ${r.win_rate.toFixed(0)}%${r.error ? ` | ⚠️ ${r.error}` : ''}\n`;
      });
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, t, { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${e.message}`);
    }
  });

  // ===== NEW PAIR SNIPER COMMANDS =====
  bot.command('newpair', ctx => {
    const sub = ctx.message.text.split(' ')[1];
    if (!sub) {
      const on = isNewPairEnabled(ctx.from.id);
      const f = getNewPairFilters(ctx.from.id);
      ctx.reply(`🆕 New Pair Sniper: ${on ? '✅ ON' : '❌ OFF'}\nFilters: Min liq $${f.minLiquidity} | Max age ${f.maxAgeSeconds}s\n\n/newpair on|off\n/newpairfilters`);
      return;
    }
    if (sub === 'on') { setNewPairEnabled(ctx.from.id, true); ctx.reply('🆕 New Pair Sniper ON — alerts for new pairs on Solana & BSC'); }
    else if (sub === 'off') { setNewPairEnabled(ctx.from.id, false); ctx.reply('❌ New Pair Sniper OFF'); }
    else { ctx.reply('Format: /newpair on|off'); }
  });

  bot.command('newpairfilters', ctx => {
    const p = ctx.message.text.split(' ');
    const minLiq = parseFloat(p[1]);
    const maxAge = parseInt(p[2]);
    if (isNaN(minLiq) || isNaN(maxAge)) {
      const f = getNewPairFilters(ctx.from.id);
      ctx.reply(`Current filters:\nMin Liquidity: $${f.minLiquidity}\nMax Age: ${f.maxAgeSeconds}s\n\nSet: /newpairfilters &lt;min_liq&gt; &lt;max_age_sec&gt;\nExample: /newpairfilters 500 60`);
      return;
    }
    setNewPairFilters(ctx.from.id, minLiq, maxAge);
    ctx.reply(`Filters updated:\nMin Liquidity: $${minLiq}\nMax Age: ${maxAge}s`);
  });

  bot.on('channel_post', ctx => processChannelMessage(ctx));

  // ===== CALLBACKS =====

  const BANNER_PATH2 = process.cwd() + '/media/banner.jpg';
  bot.action('main', async ctx => {
    ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}
    ctx.replyWithPhoto({ source: BANNER_PATH2 }, { caption: `◎ Crypto Sniper Bot v3.0\nMulti-Chain: Solana | BSC | ETH\nMode: ${isPaperMode(ctx.from.id)?'🧪 PAPER':'⚡ LIVE'}`, ...mainMenu(ctx.from.id) });
  });

  // Helper: edit message works on both text and photo messages
  function editMsg(ctx, text, opts = {}) {
    const msg = ctx.msg || ctx.callbackQuery?.message || ctx.update?.callback_query?.message;
    const o = { parse_mode: opts.parse_mode || 'HTML', ...opts };
    if (msg?.photo) return ctx.editMessageCaption(text, o);
    return ctx.editMessageText(text, o);
  }

  // Category menus
  bot.action('cat_scanner', ctx => { ctx.answerCbQuery(); editMsg(ctx, '<b>🔍 Scanner</b>\n\nScan trending tokens dan top picks.', scannerMenu()); });
  bot.action('cat_trade', ctx => { ctx.answerCbQuery(); const ch=getUserChain(ctx.from.id); editMsg(ctx, `<b>🎯 Trade ${CL[ch]}</b>\n\nManual buy/sell dan DCA.`, tradeMenu(ch)); });
  bot.action('cat_auto', ctx => { ctx.answerCbQuery(); editMsg(ctx, '<b>🤖 Auto Trading</b>\n\nAutomated strategies.', autoMenu(ctx.from.id)); });
  bot.action('cat_safety', ctx => { ctx.answerCbQuery(); editMsg(ctx, '<b>🛡️ Safety</b>\n\nProtection dan monitoring.', safetyMenu(ctx.from.id)); });
  bot.action('cat_settings', ctx => { ctx.answerCbQuery(); editMsg(ctx, '<b>⚙️ Settings</b>', settingsMenu(ctx.from.id)); });

  // Tools
  bot.action('cat_tools', ctx => { ctx.answerCbQuery(); editMsg(ctx, '<b>🔧 Speed Tools</b>\n\nTools untuk meningkatkan kecepatan snipe per chain.', toolsMenu(ctx.from.id)); });
  bot.action('tools_solana', ctx => { ctx.answerCbQuery(); editMsg(ctx, '<b>◎ Solana Speed Tools</b>\n\nFitur khusus untuk mempercepat snipe di Solana.', solanaToolsMenu()); });
  bot.action('tools_bsc', ctx => { ctx.answerCbQuery(); editMsg(ctx, '🔶 <b>BSC Tools</b>\n\nComing soon.\n\nPlanned:\n• MEV Blocker integration\n• Priority Gas bidding\n• BSC WebSocket stream', { parse_mode: 'HTML', ...backTo('cat_tools') }); });
  bot.action('tools_eth', ctx => { ctx.answerCbQuery(); editMsg(ctx, '⟠ <b>ETH Tools</b>\n\nComing soon.\n\nPlanned:\n• Flashbots Protect\n• EIP-1559 fee optimization\n• ETH WebSocket stream', { parse_mode: 'HTML', ...backTo('cat_tools') }); });

  // Solana Tool submenus
  bot.action('sub_jito', ctx => {
    ctx.answerCbQuery();
    const jito = config.jito;
    const on = jito?.enabled;
    const tip = jito?.tipLamports || 100000;
    editMsg(ctx,
      `<b>⚡ Jito Bundle</b>

Status: ${on ? '✅ ON' : '❌ OFF'}
Tip: ${(tip / 1e9).toFixed(4)} SOL (${tip} lamports)`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
        [{ text: on ? '✅ ON - Tap to OFF' : '❌ OFF - Tap to ON', callback_data: 'jito_toggle' }],
        [{ text: '💰 0.0001 SOL', callback_data: 'jito_tip_100000' }, { text: '💰 0.001 SOL', callback_data: 'jito_tip_1000000' }, { text: '💰 0.005 SOL', callback_data: 'jito_tip_5000000' }],
        [{ text: '⬅️ Solana Tools', callback_data: 'tools_solana' }],
      ]}, disable_web_page_preview: true }
    );
  });

  bot.action('jito_toggle', async ctx => {
    config.jito.enabled = !config.jito.enabled;
    await ctx.answerCbQuery(config.jito.enabled ? 'Jito ON' : 'Jito OFF');
    const on = config.jito.enabled;
    const tip = config.jito.tipLamports || 100000;
    try {
      await editMsg(ctx,
        `<b>⚡ Jito Bundle</b>

Status: ${on ? '✅ ON' : '❌ OFF'}
Tip: ${(tip / 1e9).toFixed(4)} SOL (${tip} lamports)`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
          [{ text: on ? '✅ ON - Tap to OFF' : '❌ OFF - Tap to ON', callback_data: 'jito_toggle' }],
          [{ text: '💰 0.0001 SOL', callback_data: 'jito_tip_100000' }, { text: '💰 0.001 SOL', callback_data: 'jito_tip_1000000' }, { text: '💰 0.005 SOL', callback_data: 'jito_tip_5000000' }],
          [{ text: '⬅️ Solana Tools', callback_data: 'tools_solana' }],
        ]}, disable_web_page_preview: true }
      );
    } catch {}
  });

  bot.action(/^jito_tip_(\d+)$/, async ctx => {
    const tip = parseInt(ctx.match[1]);
    config.jito.tipLamports = tip;
    await ctx.answerCbQuery('Tip: ' + (tip/1e9).toFixed(4) + ' SOL');
    const on = config.jito.enabled;
    try {
      await editMsg(ctx,
        `<b>⚡ Jito Bundle</b>

Status: ${on ? '✅ ON' : '❌ OFF'}
Tip: ${(tip / 1e9).toFixed(4)} SOL (${tip} lamports)`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
          [{ text: on ? '✅ ON - Tap to OFF' : '❌ OFF - Tap to ON', callback_data: 'jito_toggle' }],
          [{ text: '💰 0.0001 SOL', callback_data: 'jito_tip_100000' }, { text: '💰 0.001 SOL', callback_data: 'jito_tip_1000000' }, { text: '💰 0.005 SOL', callback_data: 'jito_tip_5000000' }],
          [{ text: '⬅️ Solana Tools', callback_data: 'tools_solana' }],
        ]}, disable_web_page_preview: true }
      );
    } catch {}
  });

  bot.action('sub_wsstream', ctx => {
    ctx.answerCbQuery();
    const running = isWsStreamRunning();
    editMsg(ctx, `<b>📡 WebSocket Stream</b>\n\nStatus: ${running ? '🟢 Connected' : '🔴 Disconnected'}\nMonitors: Pump.fun, Raydium, Orca\n\n<b>Commands:</b>\n/wsstream on|off - Toggle\n/wsstream status - Check status`, { parse_mode: 'HTML', ...backTo('tools_solana') });
  });

  bot.action('sub_rpcfailover', ctx => {
    ctx.answerCbQuery();
    const rpc = getRpcManager();
    const best = rpc.getBestRpc();
    editMsg(ctx, `<b>🌐 RPC Failover</b>\n\nActive: ${config.tools?.rpcFailoverEnabled ? '✅ ON' : '❌ OFF'}\nBest RPC: ${best ? best.replace(/https?:\/\//, '').split('/')[0] : 'none'}\nEndpoints: ${rpc.endpoints.length}\n\n<b>Commands:</b>\n/rpctest - Test all RPC latency\n/rpcfailover on|off - Toggle`, { parse_mode: 'HTML', ...backTo('tools_solana') });
  });

  bot.action('sub_txcache', ctx => {
    ctx.answerCbQuery();
    const size = getTxCacheSize();
    const ttl = config.tools?.cacheTtlMs || 15000;
    editMsg(ctx, `<b>💾 TX Cache</b>\n\nCached quotes: ${size}\nTTL: ${ttl / 1000}s\n\nCache otomatis menyimpan Jupiter quotes untuk akses cepat.`, { parse_mode: 'HTML', ...backTo('tools_solana') });
  });

  bot.action('sub_priorityfee', ctx => {
    ctx.answerCbQuery();
    editMsg(ctx,
      '<b>⛽ Priority Fee</b>\n\nPilih level kecepatan:',
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
        [{ text: '🟢 Low', callback_data: 'pfee_low' }, { text: '🟡 Medium', callback_data: 'pfee_medium' }],
        [{ text: '🟠 High', callback_data: 'pfee_high' }, { text: '🔴 Turbo', callback_data: 'pfee_turbo' }],
        [{ text: '🔍 Auto Estimate', callback_data: 'pfee_auto' }],
        [{ text: '⬅️ Solana Tools', callback_data: 'tools_solana' }],
      ]}, disable_web_page_preview: true }
    );
  });

  bot.action(/^pfee_(low|medium|high|turbo)$/, async ctx => {
    const levels = { low: 100000, medium: 500000, high: 2000000, turbo: 10000000 };
    const names = { low: '🟢 Low', medium: '🟡 Medium', high: '🟠 High', turbo: '🔴 Turbo' };
    const level = ctx.match[1];
    const fee = levels[level];
    if (!config.tools) config.tools = {};
    config.tools.priorityFeeLevel = level;
    config.tools.priorityFeeMicroLamports = fee;
    await ctx.answerCbQuery(names[level] + ': ' + fee + ' microLamports (~' + (fee/1e9).toFixed(6) + ' SOL)');
    try {
      await editMsg(ctx,
        '<b>⛽ Priority Fee</b>\n\nActive: <b>' + names[level] + '</b>\nFee: ' + fee + ' microLamports (~' + (fee/1e9).toFixed(6) + ' SOL)',
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
          [{ text: '🟢 Low', callback_data: 'pfee_low' }, { text: '🟡 Medium', callback_data: 'pfee_medium' }],
          [{ text: '🟠 High', callback_data: 'pfee_high' }, { text: '🔴 Turbo', callback_data: 'pfee_turbo' }],
          [{ text: '🔍 Auto Estimate', callback_data: 'pfee_auto' }],
          [{ text: '⬅️ Solana Tools', callback_data: 'tools_solana' }],
        ]}, disable_web_page_preview: true }
      );
    } catch {}
  });

  bot.action('pfee_auto', async ctx => {
    ctx.answerCbQuery('Estimating...');
    try {
      const fee = await estimatePriorityFee('medium');
      await editMsg(ctx,
        '<b>⛽ Auto Estimate</b>\n\nNetwork fee: <b>' + fee + '</b> microLamports\n~' + (fee/1e9).toFixed(6) + ' SOL',
        { parse_mode: 'HTML', ...backTo('tools_solana') }
      );
    } catch (e) {
      await editMsg(ctx, 'Estimate error: ' + e.message, { parse_mode: 'HTML', ...backTo('tools_solana') });
    }
  });

  // Scanner
  bot.action('do_scan', ctx => { ctx.answerCbQuery(); ctx.reply(`${CE[getUserChain(ctx.from.id)]} Scanning...`).catch(()=>{}); doScan(ctx, getUserChain(ctx.from.id)); });
  bot.action('do_trending', ctx => { ctx.answerCbQuery(); ctx.reply('Loading trending...').catch(()=>{}); doTrending(ctx, getUserChain(ctx.from.id)); });
  bot.action('do_top', ctx => { ctx.answerCbQuery(); editMsg(ctx, 'Pilih grade:', topBtns()); });
  bot.action(/^top_(.+)$/, ctx => { ctx.answerCbQuery(); doTop({ ...ctx, chat: ctx.chat, reply: async (t,o) => ctx.reply(t,o), editMessageText: async (t,o) => ctx.reply(t,o) }, getUserChain(ctx.from.id), ctx.match[1]==='all'?'all':ctx.match[1]); });

  // Buy/Sell help
  bot.action('do_buy_help', ctx => { ctx.answerCbQuery(); editMsg(ctx, `<b>Quick Buy</b>\n/buy &lt;token&gt; &lt;amount_${nativeUnit(getUserChain(ctx.from.id))}&gt; [slip%]\n\nExample:\n/buy TokenAddr 0.01 10`, { parse_mode: 'HTML', ...backTo('cat_trade') }); });
  bot.action('do_sell_help', ctx => { ctx.answerCbQuery(); editMsg(ctx, `<b>Quick Sell</b>\n/sell &lt;token&gt; [slip%]\n\nSells all balance.`, { parse_mode: 'HTML', ...backTo('cat_trade') }); });
  bot.action('do_snipe_help', ctx => { ctx.answerCbQuery(); editMsg(ctx, `<b>Quick Snipe</b>\n/snipe &lt;token_address&gt;\n\nQuick buy small amount on new token.`, { parse_mode: 'HTML', ...backTo('cat_trade') }); });

  // Portfolio
  bot.action('do_portfolio', ctx => {
    ctx.answerCbQuery();
    const pos = getOpenPositions(ctx.from.id);
    if (!pos.length) { editMsg(ctx, 'No open positions.', back()); return; }
    let t = '<b>Portfolio:</b>\n\n';
    pos.forEach((p,i) => { t += `${i+1}. ${CE[p.chain]} ${p.token_symbol} (${p.token_address.slice(0,8)}...)\n   Buy: ${p.buy_amount_native} | TP:+${p.tp_pct}% | SL:${p.sl_pct}%\n\n`; });
    editMsg(ctx, t, { parse_mode: 'HTML', ...back() });
  });

  // PnL
  bot.action('do_pnl', ctx => {
    ctx.answerCbQuery();
    const s = getPortfolioSummary(ctx.from.id);
    editMsg(ctx, `<b>PnL</b>\nOpen: ${s.openPositions} | Closed: ${s.closedTrades}\nW: ${s.wins} | L: ${s.losses} | Rate: ${s.winRate}%\nPnL: ${s.totalPnl>=0?'+':''}${s.totalPnl.toFixed(4)}`, { parse_mode: 'HTML', ...back() });
  });

  // Network
  bot.action('sub_network', ctx => { ctx.answerCbQuery(); editMsg(ctx, 'Pilih jaringan:', chainBtns()); });
  bot.action(/^chain_(solana|bsc|eth)$/, ctx => {
    const ch = ctx.match[1]; setUserChain(ctx.from.id, ch);
    ctx.answerCbQuery(`${CL[ch]}`);
    editMsg(ctx, `Network: ${CE[ch]} ${CL[ch]}`, mainMenu(ctx.from.id));
  });

  // Wallets
  bot.action('sub_wallets', ctx => { ctx.answerCbQuery(); editMsg(ctx, 'Generate wallet:', walletGenBtns()); });
  bot.action(/^wgen_(solana|bsc|eth)$/, async ctx => {
    const ch = ctx.match[1]; ctx.answerCbQuery();
    try {
      let w; if (ch==='solana') w=generateSolanaWallet(); else {w=generateEVMWallet();w.chain=ch;}
      saveWallet(w);
      let t = `${CE[ch]} <b>${CL[ch]}</b>\n\n<code>${w.address}</code>\n\n<code>${w.privateKey}</code>`;
      if (w.mnemonic) t += `\n\n<b>Mnemonic</b>:\n<code>${w.mnemonic}</code>`;
      await ctx.reply(t, { parse_mode: 'HTML' });
      editMsg(ctx, 'Generated. Check above.', back());
    } catch(e) { ctx.reply(`Error: ${e.message}`); }
  });

  // Copy Trade submenu
  bot.action('sub_copytrade', ctx => {
    ctx.answerCbQuery();
    const wls = getWatchWallets(ctx.from.id);
    let t = `<b>🐋 Copy Trade</b>\n\n/copy &lt;wallet_address&gt; [label]\n/uncopy &lt;id&gt; /copylist\n\nWatching ${wls.length} wallets.`;
    editMsg(ctx, t, { parse_mode: 'HTML', ...back() });
  });

  // Anti-Rug submenu
  bot.action('sub_antirug', ctx => {
    ctx.answerCbQuery();
    editMsg(ctx, `<b>🛡️ Anti-Rug Pull</b>\n\nActive monitoring: ON\nThreshold: 20% dump = rug alert\nAuto-sell: Alert only (no auto-sell)\n\nMonitors top holder activity for all open positions.`, { parse_mode: 'HTML', ...back() });
  });

  // Auto-Buy submenu
  bot.action('sub_autobuy', ctx => {
    ctx.answerCbQuery();
    const ch = getUserChain(ctx.from.id), cfg = getAutoBuyConfig(ctx.from.id, ch);
    editMsg(ctx, 
      `<b>📡 Auto-Buy ${CL[ch]}</b>\nStatus: ${cfg?.enabled?'✅ ON':'❌ OFF'}\n\n` +
      `/autobuy on|off\n/autobuy set minMC maxMC minHolders minLiq amountPerBuy maxBuysPerHour\n\n` +
      `Current: MC $${cfg?.min_mc||0}-$${cfg?.max_mc||'∞'} | Holders>${cfg?.min_holders||0} | Liq>$${cfg?.min_liq||0}\nAmount: ${cfg?.amount_per_buy||0} ${nativeUnit(ch)}/buy`,
      { parse_mode: 'HTML', ...back() }
    );
  });

  // Auto-Sell submenu
  bot.action('sub_autosell', ctx => {
    ctx.answerCbQuery();
    const on = getAutoSellStatus(ctx.from.id);
    editMsg(ctx, 
      `<b>📊 Auto-Sell TP/SL</b>\nStatus: ${on ? '✅ ON' : '❌ OFF'}\n\n` +
      `Automatically sells positions when TP or SL is hit.\nMonitors all holding positions every 30s.\n\n` +
      `/autosell on|off\n/settp &lt;position_id&gt; &lt;pct&gt;\n/setsl &lt;position_id&gt; &lt;pct&gt;`,
      { parse_mode: 'HTML', ...back() }
    );
  });

  // Limit Orders submenu
  bot.action('sub_limitorders', ctx => {
    ctx.answerCbQuery();
    const ords = getLimitOrders(ctx.from.id, 'pending');
    editMsg(ctx, 
      `<b>📋 Limit Orders</b>\n\n` +
      `/limitbuy &lt;token&gt; &lt;target_price&gt; &lt;amount&gt; [slip%]\n` +
      `/limitsell &lt;token&gt; &lt;target_price&gt; [slip%]\n` +
      `/limitlist\n` +
      `/limitcancel &lt;id&gt;\n\n` +
      `Pending: ${ords.length}`,
      { parse_mode: 'HTML', ...back() }
    );
  });

  // DCA submenu
  bot.action('sub_dca', ctx => {
    ctx.answerCbQuery();
    const ords = getActiveDCAOrders(ctx.from.id);
    let t = `<b>📈 DCA</b>\n\n/dca &lt;token&gt; &lt;total&gt; &lt;slices&gt; &lt;interval_sec&gt;\n/dca list\n/dca cancel &lt;id&gt;\n\nActive: ${ords.length}`;
    editMsg(ctx, t, { parse_mode: 'HTML', ...back() });
  });

  // Bonding submenu
  bot.action('sub_bonding', ctx => {
    ctx.answerCbQuery();
    editMsg(ctx, `<b>🏎️ Bonding Curve Sniper</b>\n\nMonitors Pump.fun tokens approaching bonding curve completion (>90%).\n\nAlert only mode.\nTo quick-snipe: /snipe &lt;token_address&gt;`, { parse_mode: 'HTML', ...back() });
  });

  // Volume submenu
  bot.action('sub_volume', ctx => {
    ctx.answerCbQuery();
    editMsg(ctx, `<b>📢 Volume Spike Alert</b>\n\nActive: ON\nThreshold: 500%+ spike in 5 min\n\nAlerts sent automatically.`, { parse_mode: 'HTML', ...back() });
  });

  // Channel submenu
  bot.action('sub_channel', ctx => {
    ctx.answerCbQuery();
    const chs = getChannelMonitors(ctx.from.id);
    let t = `<b>📺 Channel Monitor</b>\n\nMonitor: /channel_add &lt;channel_id&gt;\nRemove: /channel_rm &lt;id&gt;\n\nWatching ${chs.length} channels.`;
    editMsg(ctx, t, { parse_mode: 'HTML', ...back() });
  });

  // Paper submenu
  bot.action('sub_paper', ctx => {
    ctx.answerCbQuery();
    const pm = isPaperMode(ctx.from.id);
    editMsg(ctx, `<b>🧪 Paper Trading</b>\nMode: ${pm?'ON':'OFF'}\n\n/paper on|off\n/paper_portfolio\n\nWhen ON, all buy/sell are simulated.`, { parse_mode: 'HTML', ...back() });
  });

  // Settings submenu
  bot.action('sub_settings', ctx => {
    ctx.answerCbQuery();
    const ch = getUserChain(ctx.from.id), pm = isPaperMode(ctx.from.id);
    editMsg(ctx, 
      `<b>⚙️ Settings</b>\n\nNetwork: ${CE[ch]} ${CL[ch]}\nMode: ${pm?'🧪 PAPER':'⚡ LIVE'}\n\nSubmenus: Network, Wallets, Paper\nUse /network /wallet /paper`,
      { parse_mode: 'HTML', ...back() }
    );
  });

  // Trailing Stop submenu
  bot.action('sub_trailingstop', ctx => {
    ctx.answerCbQuery();
    const stops = getActiveTrailingStops(ctx.from.id);
    let t = `<b>📉 Trailing Stop</b>\n\n`;
    t += `/trail &lt;token&gt; [trail_pct%] — set trailing stop\n`;
    t += `/trailoff &lt;token&gt; — disable\n`;
    t += `/traillist — view active\n\n`;
    if (stops.length) {
      t += `Active: ${stops.length}\n`;
      stops.slice(0, 3).forEach(s => {
        t += `  ${CE[s.chain]} ${s.token_address.slice(0,10)}... (${s.trail_pct}%)\n`;
      });
      if (stops.length > 3) t += `  ...+${stops.length - 3} more`;
    } else {
      t += 'No active trailing stops.';
    }
    editMsg(ctx, t, { parse_mode: 'HTML', ...back() });
  });

  // Daily Report submenu
  bot.action('sub_dailyreport', async ctx => {
    ctx.answerCbQuery();
    const { getDb } = await import('../utils/database.js');
    const row = getDb().prepare('SELECT report_hour FROM daily_report_settings WHERE user_id = ?').get(ctx.from.id);
    const hour = row ? row.report_hour : 15;
    const wibHour = (hour + 7) % 24;
    editMsg(ctx, 
      `<b>📊 Daily Report</b>\n\n` +
      `Auto-sent daily at ${hour}:00 UTC (${wibHour}:00 WIB)\n\n` +
      `/report — get today's report now\n` +
      `/reportset &lt;hour&gt; — change hour (0-23 UTC)\n\n` +
      `Contains: trades, PnL, win rate, best/worst trade`,
      { parse_mode: 'HTML', ...back() }
    );
  });

  // Smart Money submenu
  bot.action('sub_smartmoney', ctx => {
    ctx.answerCbQuery();
    const wallets = getSmartWallets(ctx.from.id);
    let t = `<b>🧠 Smart Money Tracker</b>\n\n`;
    t += `/smartadd &lt;address&gt; [label] — add wallet\n`;
    t += `/smartlist — list tracked wallets\n`;
    t += `/smartremove &lt;id&gt; — remove\n`;
    t += `/smartscan — analyze all wallets\n\n`;
    t += `Tracking ${wallets.length} wallets.\n`;
    t += `Auto-alerts on new buys every 5 min.`;
    editMsg(ctx, t, { parse_mode: 'HTML', ...back() });
  });

  // ===== PRICE ALERT COMMANDS =====
  bot.command('pricealert', ctx => {
    const p = ctx.message.text.split(' ');
    const tokenAddr = p[1];
    const condition = (p[2] || '').toLowerCase();
    const targetPrice = parseFloat(p[3]);
    const alertType = (p[4] || 'once').toLowerCase();

    if (!tokenAddr || !['above', 'below'].includes(condition) || !targetPrice || targetPrice <= 0) {
      return ctx.reply('Format: /pricealert &lt;token&gt; <above|below> &lt;price&gt; [once|recurring]\n\nExample:\n/pricealert TokenAddr above 0.00001 once\n/pricealert TokenAddr below 0.00005 recurring');
    }
    if (!['once', 'recurring'].includes(alertType)) {
      return ctx.reply('Alert type must be: once or recurring');
    }

    const ch = getUserChain(ctx.from.id);
    const id = addPriceAlert(ctx.from.id, ch, tokenAddr, 'TOKEN', targetPrice, condition, alertType);
    ctx.reply(`🔔 Alert #${id} set\n${CE[ch]} <code>${tokenAddr.slice(0, 16)}...</code>\nCondition: ${condition} $${targetPrice}\nType: ${alertType}\n/alertlist to view`, { parse_mode: 'HTML' });
  });

  bot.command('alertlist', ctx => {
    const alerts = getPriceAlerts(ctx.from.id);
    if (!alerts.length) return ctx.reply('No active alerts.\n/pricealert &lt;token&gt; <above|below> &lt;price&gt;');
    let t = '<b>🔔 Active Alerts:</b>\n\n';
    alerts.forEach(a => {
      const condEmoji = a.condition === 'above' ? '🚀' : '📉';
      const typeLabel = a.alert_type === 'once' ? '1x' : '🔁';
      t += `#${a.id} ${condEmoji} ${CE[a.chain]||''} ${a.token_symbol||a.token_address.slice(0,10)}... ${a.condition} $${a.target_price} [${typeLabel}]\n`;
    });
    t += '\n/alertcancel &lt;id&gt; to cancel';
    ctx.reply(t, { parse_mode: 'HTML' });
  });

  bot.command('alertcancel', ctx => {
    const id = parseInt(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply('Format: /alertcancel &lt;id&gt;');
    if (cancelPriceAlert(id, ctx.from.id)) {
      ctx.reply(`Alert #${id} cancelled.`);
    } else {
      ctx.reply(`Alert #${id} not found.`);
    }
  });

  // ===== TP CALCULATOR COMMAND =====
  bot.command('calc', ctx => {
    const p = ctx.message.text.split(' ');
    const buyPrice = parseFloat(p[1]);
    const buyAmount = parseFloat(p[2]);
    if (!buyPrice || buyPrice <= 0 || !buyAmount || buyAmount <= 0) {
      return ctx.reply('Format: /calc &lt;buy_price&gt; &lt;buy_amount&gt; [tp1%] [tp2%] [tp3%]\n\nExample:\n/calc 0.00001 0.08 50 100 200');
    }
    const tpPcts = p.slice(3).map(Number).filter(n => Number.isFinite(n) && n > 0);
    const text = formatTPCalc(buyPrice, buyAmount, tpPcts.length ? tpPcts : [50, 100, 200]);
    ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true });
  });

  // ===== WATCHLIST COMMANDS =====
  bot.command('watch', ctx => {
    const p = ctx.message.text.split(' ');
    const tokenAddr = p[1];
    const notes = p.slice(2).join(' ') || null;
    if (!tokenAddr) return ctx.reply('Format: /watch &lt;token_address&gt; [note]');
    const ch = getUserChain(ctx.from.id);
    const id = addToWatchlist(ctx.from.id, ch, tokenAddr, 'TOKEN', notes);
    ctx.reply(`👀 Added to watchlist #${id}\n${CE[ch]} <code>${tokenAddr.slice(0, 16)}...</code>${notes ? `\n📝 ${notes}` : ''}\n/watchlist to view`, { parse_mode: 'HTML' });
  });

  bot.command('watchlist', async ctx => {
    const msg = await ctx.reply('Loading watchlist...');
    try {
      const text = await formatWatchlistDisplay(ctx.from.id);
      if (!text) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'No watched tokens.\n/watch &lt;token&gt; [note] to add.');
        return;
      }
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (e) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${e.message}`);
    }
  });

  bot.command('unwatch', ctx => {
    const id = parseInt(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply('Format: /unwatch &lt;id&gt;');
    if (removeFromWatchlist(id, ctx.from.id)) {
      ctx.reply(`Watchlist #${id} removed.`);
    } else {
      ctx.reply(`Watchlist #${id} not found.`);
    }
  });

  // ===== WALLET BACKUP COMMANDS =====
  bot.command('backuplist', ctx => {
    const wallets = getBackupPreview();
    if (!wallets || !wallets.length) return ctx.reply('No wallets to backup.\n/wallet to generate one.');
    let t = '<b>🔐 Wallets for Backup:</b>\n\n';
    wallets.forEach(w => {
      t += `#${w.id} ${CE[w.chain]||''} <code>${w.address}</code>\n`;
      t += `   Key: ${w.hasPrivateKey ? '✅' : '❌'} | Mnemonic: ${w.hasMnemonic ? '✅' : '❌'}\n`;
    });
    t += `\nTotal: ${wallets.length} wallet(s)`;
    ctx.reply(t, { parse_mode: 'HTML' });
  });

  bot.command('backup', async ctx => {
    // Ask for password via reply
    try {
      const wallets = getBackupPreview();
      if (!wallets || !wallets.length) {
        ctx.reply('No wallets to backup. /wallet to generate one.');
        return;
      }
      await ctx.reply(`🔐 <b>Wallet Backup</b>\n\nYou have ${wallets.length} wallet(s).\n\n⚠️ You will need a password to encrypt the backup.\n\nReply with your password (min 6 chars):`, { parse_mode: 'HTML' });
      // Store state for next message
      backupState.set(ctx.from.id, 'waiting_password');
    } catch (e) {
      ctx.reply(`Error: ${e.message}`);
    }
  });

  const backupState = new Map(); // uid -> 'waiting_password'

  bot.on('message', async ctx => {
    const uid = ctx.from?.id;
    if (!uid || !backupState.has(uid)) return;
    const state = backupState.get(uid);
    backupState.delete(uid);

    if (state === 'waiting_password') {
      const password = ctx.message.text;
      if (!password || password.length < 6) {
        await ctx.reply('Password must be at least 6 characters.\n/backup to try again.');
        return;
      }
      try {
        const encrypted = generateBackup(password);
        // Split if too long for Telegram (4096 chars)
        const msg1 = `✅ <b>Backup Generated!</b>\n\n⚠️ <b>Keep this safe!</b> Anyone with this string + password can access your wallets.\n\n<code>${encrypted.slice(0, 4000)}</code>`;
        await ctx.reply(msg1, { parse_mode: 'HTML' });
        if (encrypted.length > 4000) {
          await ctx.reply(`<code>${encrypted.slice(4000)}</code>`, { parse_mode: 'HTML' });
        }
      } catch (e) {
        await ctx.reply(`Backup error: ${e.message}`);
      }
      return;
    }

    if (state === 'waiting_restore_password') {
      const password = ctx.message.text;
      if (!password) {
        await ctx.reply('Password required. /restore to try again.');
        return;
      }
      const encrypted = restoreStateData.get(uid);
      restoreStateData.delete(uid);
      try {
        const count = restoreBackup(encrypted, password);
        await ctx.reply(`✅ <b>Restore Complete!</b>\n\n${count} wallet(s) restored.\n/mywallets to view.`);
      } catch (e) {
        await ctx.reply(`❌ Restore failed: ${e.message}`);
      }
      return;
    }
  });

  const restoreStateData = new Map(); // uid -> encrypted string

  bot.command('restore', async ctx => {
    const encrypted = ctx.message.text.replace('/restore', '').trim();
    if (!encrypted) {
      return ctx.reply('Format: /restore &lt;encrypted_string&gt;\n\nSend the encrypted backup string after /restore, then provide the password when prompted.');
    }
    try {
      restoreStateData.set(ctx.from.id, encrypted);
      await ctx.reply('🔓 Enter your backup password:');
      backupState.set(ctx.from.id, 'waiting_restore_password');
    } catch (e) {
      ctx.reply(`Error: ${e.message}`);
    }
  });

  // ===== New Pair Sniper submenu
  bot.action('sub_newpair', ctx => {
    ctx.answerCbQuery();
    const on = isNewPairEnabled(ctx.from.id);
    const f = getNewPairFilters(ctx.from.id);
    editMsg(ctx, 
      `<b>🆕 New Pair Sniper</b>\nStatus: ${on ? '✅ ON' : '❌ OFF'}\n\n` +
      `Scans Dexscreener for new pairs on Solana & BSC.\nFilters: Min liq $${f.minLiquidity} | Max age ${f.maxAgeSeconds}s\n\n` +
      `/newpair on|off\n` +
      `/newpairfilters [min_liq] [max_age]`,
      { parse_mode: 'HTML', ...back() }
    );
  });

  // Strategy submenu
  bot.action('sub_strategy', ctx => {
    ctx.answerCbQuery();
    const ch = getUserChain(ctx.from.id);
    const r = getStrategyReport(ctx.from.id);
    const nu = nativeUnit(ch);
    if (!r) {
      editMsg(ctx, 
        `<b>🎯 Strategy (Budget Manager)</b>

Set daily budget dan auto-trade rules.

/strategy set &lt;daily_budget&gt; &lt;max_per_trade&gt; &lt;max_trades&gt; <target_roi%> <stop_loss%>

Contoh:
/strategy set 0.1 0.01 10 200 50

Fitur:
- Budget limit harian
- Max per trade
- Max trades per hari
- Auto TP/SL
- Auto-reinvest profit`,
        { parse_mode: 'HTML', ...back() }
      );
    } else {
      editMsg(ctx, 
        `<b>🎯 Strategy</b> ${CE[ch]}
Status: ${r.enabled ? '✅' : '❌'} ${r.paused ? '⚠️ PAUSED' : ''}
` +
        `Budget: ${r.daily_budget} ${nu}/day
` +
        `Max/trade: ${r.max_per_trade} ${nu}
` +
        `Trades: ${r.max_trades_day}/day
` +
        `ROI target: +${r.target_roi}%
` +
        `Stop loss: -${r.stop_loss}%
` +
        `Reinvest: ${r.auto_reinvest ? 'ON' : 'OFF'}
` +
        `
<b>Today:</b> Spent ${r.spent_today.toFixed(4)} | Left ${r.remaining.toFixed(4)} ${nu}
` +
        `PnL: ${r.total_pnl >= 0 ? '+' : ''}${r.total_pnl.toFixed(4)} ${nu}
` +
        `
/strategy on|off|pause|resume
/strategy set &lt;budget&gt; <max/trade> &lt;trades&gt; &lt;roi&gt; &lt;sl&gt;
/strategy reinvest on|off`,
        { parse_mode: 'HTML', ...back() }
      );
    }
  });

  // ===== PRICE ALERT SUBMENU =====
  bot.action('sub_pricealert', ctx => {
    ctx.answerCbQuery();
    const alerts = getPriceAlerts(ctx.from.id);
    let t = `<b>🔔 Price Alerts</b>\n\n`;
    t += `/pricealert &lt;token&gt; <above|below> &lt;price&gt; [once|recurring]\n`;
    t += `/alertlist — view active\n`;
    t += `/alertcancel &lt;id&gt; — cancel\n\n`;
    t += `Active: ${alerts.length}`;
    if (alerts.length) {
      t += '\n\n';
      alerts.slice(0, 5).forEach(a => {
        const condEmoji = a.condition === 'above' ? '🚀' : '📉';
        const typeLabel = a.alert_type === 'once' ? '1x' : '🔁';
        t += `${condEmoji} #${a.id} ${a.token_symbol||a.token_address.slice(0,8)}... ${a.condition} $${a.target_price} [${typeLabel}]\n`;
      });
      if (alerts.length > 5) t += `  ...+${alerts.length - 5} more`;
    }
    editMsg(ctx, t, { parse_mode: 'HTML', ...back() });
  });

  // ===== TP CALCULATOR SUBMENU =====
  bot.action('sub_tpcalc', ctx => {
    ctx.answerCbQuery();
    editMsg(ctx, 
      `<b>🧮 TP Calculator</b>\n\n` +
      `Calculate profit at different take-profit levels.\n\n` +
      `/calc &lt;buy_price&gt; &lt;buy_amount&gt; [tp1%] [tp2%] [tp3%]\n\n` +
      `Example:\n/calc 0.00001 0.08 50 100 200\n\n` +
      `Default TPs: 50%, 100%, 200%\n` +
      `Shows gross/net profit after ~15% fees and break-even price.`,
      { parse_mode: 'HTML', ...back() }
    );
  });

  // ===== WATCHLIST SUBMENU =====
  bot.action('sub_watchlist', async ctx => {
    ctx.answerCbQuery();
    try {
      const text = await formatWatchlistDisplay(ctx.from.id);
      if (!text) {
        editMsg(ctx, 
          `<b>👀 Watchlist</b>\n\n` +
          `/watch &lt;token&gt; [note] — add token\n` +
          `/watchlist — view with prices\n` +
          `/unwatch &lt;id&gt; — remove\n\n` +
          `Monitors watched tokens every 60s.\n` +
          `Alerts on >20% price change.`,
          { parse_mode: 'HTML', ...back() }
        );
        return;
      }
      editMsg(ctx, text, { parse_mode: 'HTML', ...back() });
    } catch (e) {
      editMsg(ctx, `Error: ${e.message}`, back());
    }
  });

  // ===== WALLET BACKUP SUBMENU =====
  bot.action('sub_walletbackup', ctx => {
    ctx.answerCbQuery();
    const wallets = getBackupPreview();
    let t = `<b>🔐 Wallet Backup</b>\n\n`;
    t += `/backup — generate encrypted backup\n`;
    t += `/restore &lt;encrypted&gt; — restore from backup\n`;
    t += `/backuplist — preview wallets\n\n`;
    t += `Wallets: ${wallets ? wallets.length : 0}\n\n`;
    t += `⚠️ AES-256-GCM encrypted.\nPassword-based. Keep backup safe!`;
    editMsg(ctx, t, { parse_mode: 'HTML', ...back() });
  });

  // ===== QUICK BUY CALLBACKS =====
  // Helper to find quickBuyMap entry by key hash
  function findQBMap(keyHash) {
    for (const [key, tokens] of quickBuyMap) {
      if (key.endsWith(keyHash)) return tokens;
    }
    return null;
  }

  // Analyze button callback
  bot.action(/^qa_([a-zA-Z0-9]+)_(\d+)$/, async ctx => {
    const keyHash = ctx.match[1];
    const idx = parseInt(ctx.match[2]);
    ctx.answerCbQuery();
    const tokens = findQBMap(keyHash);
    if (!tokens || !tokens[idx]) {
      await ctx.answerCbQuery('Token data expired. Rescan.');
      return;
    }
    const tk = tokens[idx];
    const ch = getUserChain(ctx.from.id);
    const addr = tk.address || tk.token_address || tk.addressUrl?.split('/').pop() || '';
    if (!addr) { await ctx.answerCbQuery('No address found.'); return; }
    ctx.reply(`Use /analyze <code>${addr}</code>`, { parse_mode: 'HTML' });
  });

  // ===== SPEED TOOLS TEXT COMMANDS =====

  bot.command('jito', ctx => {
    const p = ctx.message.text.split(' ');
    const sub = (p[1] || '').toLowerCase();
    if (sub === 'on') {
      config.jito.enabled = true;
      return ctx.reply('⚡ Jito Bundle: ✅ ON\nTransactions akan dikirim via Jito tip router.');
    }
    if (sub === 'off') {
      config.jito.enabled = false;
      return ctx.reply('⚡ Jito Bundle: ❌ OFF');
    }
    if (sub === 'tip') {
      const val = parseInt(p[2]);
      if (!val || val <= 0) return ctx.reply('Format: /jito tip <lamports>');
      config.jito.tipLamports = val;
      return ctx.reply(`⚡ Jito tip set: ${(val / 1e9).toFixed(6)} SOL (${val} lamports)`);
    }
    if (sub === 'status' || !sub) {
      const jito = config.jito;
      return ctx.reply(`⚡ <b>Jito Bundle Status</b>\n\nEnabled: ${jito.enabled ? '✅' : '❌'}\nTip: ${(jito.tipLamports / 1e9).toFixed(6)} SOL\nAPI: ${jito.apiUrl}`, { parse_mode: 'HTML' });
    }
    return ctx.reply('Usage: /jito on|off|tip <lamports>|status');
  });

  bot.command('wsstream', ctx => {
    const p = ctx.message.text.split(' ');
    const sub = (p[1] || '').toLowerCase();
    if (sub === 'on') {
      subscribeNewTokens((token) => {
        console.log('[WS] New token detected:', token.signature, token.source);
      });
      return ctx.reply('📡 WebSocket Stream: 🟢 Started\nMonitoring Pump.fun, Raydium, Orca.');
    }
    if (sub === 'off') {
      unsubscribeNewTokens();
      return ctx.reply('📡 WebSocket Stream: 🔴 Stopped');
    }
    if (sub === 'status' || !sub) {
      const running = isWsStreamRunning();
      return ctx.reply(`📡 <b>WebSocket Stream</b>\n\nStatus: ${running ? '🟢 Connected' : '🔴 Disconnected'}\nMonitors: Pump.fun, Raydium, Orca`, { parse_mode: 'HTML' });
    }
    return ctx.reply('Usage: /wsstream on|off|status');
  });

  bot.command('rpctest', async ctx => {
    const rpc = getRpcManager();
    const msg = await ctx.reply('🌐 Testing RPC endpoints...');
    try {
      const status = await rpc.healthCheck();
      let t = '🌐 <b>RPC Test Results</b>\n\n';
      for (const s of status) {
        t += `${s.best} ${s.healthy} <code>${s.url.replace(/https?:\/\//, '').split('/')[0]}</code> - ${s.latency}\n`;
      }
      t += `\n⭐ Best: ${rpc.getBestRpc()?.replace(/https?:\/\//, '').split('/')[0] || 'none'}`;
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, t, { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `RPC test error: ${e.message}`);
    }
  });

  bot.command('rpcfailover', ctx => {
    const p = ctx.message.text.split(' ');
    const sub = (p[1] || '').toLowerCase();
    if (sub === 'on') {
      config.tools.rpcFailoverEnabled = true;
      const rpc = getRpcManager();
      rpc.startAutoCheck();
      return ctx.reply('🌐 RPC Failover: ✅ ON\nAuto health check setiap 30 detik.');
    }
    if (sub === 'off') {
      config.tools.rpcFailoverEnabled = false;
      const rpc = getRpcManager();
      rpc.stopAutoCheck();
      return ctx.reply('🌐 RPC Failover: ❌ OFF');
    }
    return ctx.reply('Usage: /rpcfailover on|off');
  });

  bot.command('priorityfee', async ctx => {
    const p = ctx.message.text.split(' ');
    const level = (p[1] || 'medium').toLowerCase();
    if (!['low', 'medium', 'high', 'turbo', 'auto'].includes(level)) {
      return ctx.reply('Usage: /priorityfee low|medium|high|turbo|auto');
    }
    try {
      const est = await estimatePriorityFee(level);
      await ctx.reply(`⛽ <b>Priority Fee (${est.level})</b>\n\nEstimated: ${est.microLamports.toLocaleString()} microLamports\n≈ ${est.sol} SOL\nSource: ${est.source}${est.sampleSize ? ` (${est.sampleSize} samples)` : ''}`, { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.reply(`Priority fee error: ${e.message}`);
    }
  });

  // Quick Buy button callback
  bot.action(/^qb_([a-zA-Z0-9]+)_(\d+)$/, async ctx => {
    const keyHash = ctx.match[1];
    const idx = parseInt(ctx.match[2]);
    ctx.answerCbQuery();
    const tokens = findQBMap(keyHash);
    if (!tokens || !tokens[idx]) {
      await ctx.answerCbQuery('Token data expired. Rescan.');
      return;
    }
    const tk = tokens[idx];
    const addr = tk.address || tk.token_address || tk.addressUrl?.split('/').pop() || '';
    if (!addr) { await ctx.answerCbQuery('No address found.'); return; }
    const ch = tk.chain || getUserChain(ctx.from.id);
    const sym = tk.symbol || tk.name?.slice(0, 12) || 'TOKEN';
    const nu = nativeUnit(ch);

    // Show confirm/cancel
    await ctx.reply(
      `🎯 <b>Quick Buy Confirm</b>\n\n` +
      `${CE[ch]||''} <b>${sym}</b>\n<code>${addr}</code>\n\n` +
      `Amount: 0.08 ${nu}\nSlippage: 15%\n\n` +
      `Proceed?`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
          [{ text: '✅ Confirm Buy', callback_data: `qbc_${keyHash}_${idx}` },
           { text: '❌ Cancel', callback_data: 'qb_cancel' }],
        ]},
      }
    );
  });

  // Confirm Quick Buy
  bot.action(/^qbc_([a-zA-Z0-9]+)_(\d+)$/, async ctx => {
    const keyHash = ctx.match[1];
    const idx = parseInt(ctx.match[2]);
    ctx.answerCbQuery();
    const tokens = findQBMap(keyHash);
    if (!tokens || !tokens[idx]) {
      await ctx.answerCbQuery('Token data expired.');
      return;
    }
    const tk = tokens[idx];
    const addr = tk.address || tk.token_address || tk.addressUrl?.split('/').pop() || '';
    if (!addr) { await ctx.answerCbQuery('No address.'); return; }
    const ch = tk.chain || getUserChain(ctx.from.id);

    try {
      await editMsg(ctx, `🎯 Buying 0.08 ${nativeUnit(ch)}...`);
      await execBuy(ctx, ch, addr, 0.08, 15);
    } catch (e) {
      await editMsg(ctx, `❌ Buy failed: ${e.message}`);
    }
  });

  // Cancel Quick Buy
  bot.action('qb_cancel', async ctx => {
    ctx.answerCbQuery('Cancelled');
    try { await editMsg(ctx, '❌ Quick buy cancelled.', back()); } catch {}
  });

  // Watch from scan callback
  bot.action(/^qw_([a-zA-Z0-9]+)_(\d+)$/, async ctx => {
    const keyHash = ctx.match[1];
    const idx = parseInt(ctx.match[2]);
    ctx.answerCbQuery();
    const tokens = findQBMap(keyHash);
    if (!tokens || !tokens[idx]) {
      await ctx.answerCbQuery('Token data expired. Rescan.');
      return;
    }
    const tk = tokens[idx];
    const addr = tk.address || tk.token_address || tk.addressUrl?.split('/').pop() || '';
    if (!addr) { await ctx.answerCbQuery('No address.'); return; }
    const ch = tk.chain || getUserChain(ctx.from.id);
    const sym = tk.symbol || tk.name?.slice(0, 12) || 'TOKEN';
    const id = addToWatchlist(ctx.from.id, ch, addr, sym, 'From scan');
    ctx.answerCbQuery(`Added to watchlist #${id}`);
  });
}
