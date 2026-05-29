import { config } from '../config.js';
import {
  getUserChain, setUserChain, getStats,
} from '../utils/database.js';
import { getTokenOverview, analyzeHolders } from '../services/analyzer.js';
import { scanChain, scoreToken, fetchTrending } from '../services/scanner.js';
import { analyzeTokenForDisplay, formatTokenCard, formatScanHeader, formatNumber } from './formatter.js';
import {
  generateSolanaWallet, generateEVMWallet, getSavedWallets, saveWallet,
} from '../services/wallet.js';
import { jupiterSwap, jupiterSell, getSolBalance } from '../services/solana-swapper.js';
import { evmBuy, evmSell, getNativeBalance, getTokenBalance } from '../services/evm-swapper.js';
import {
  addPosition, getOpenPositions, getAllPositions, closePosition,
  getPortfolioSummary, updateTPSL, deletePosition, monitorPositions,
} from '../services/portfolio.js';

const CHAIN_LABELS = { solana: 'Solana', bsc: 'BSC', eth: 'ETH' };
const CHAIN_EMOJI = { solana: '◎', bsc: '🔶', eth: '⟠' };

// ===== Keyboards =====

function mainMenuKeyboard(userId) {
  const active = getUserChain(userId);
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔍 Scan Token', callback_data: 'action_scan' }, { text: '🔥 Trending', callback_data: 'action_trending' }],
        [{ text: '🎯 Quick Buy', callback_data: 'action_buy_prompt' }, { text: '💸 Quick Sell', callback_data: 'action_sell_prompt' }],
        [{ text: '📊 Top Tokens', callback_data: 'action_top' }, { text: '📈 Stats', callback_data: 'action_stats' }],
        [{ text: '💼 Portfolio', callback_data: 'action_portfolio' }, { text: '⚙️ Settings', callback_data: 'action_settings' }],
        [{ text: '💰 Wallet', callback_data: 'action_wallet_menu' }, { text: '🌐 Network', callback_data: 'action_network' }],
      ],
    },
  };
}

function backToMenuKeyboard() {
  return { reply_markup: { inline_keyboard: [[{ text: '⬅️ Menu', callback_data: 'action_menu' }]] } };
}

function networkKeyboard() {
  return { reply_markup: { inline_keyboard: [
    [{ text: `${CHAIN_EMOJI.solana} Solana`, callback_data: 'chain_solana' }, { text: `${CHAIN_EMOJI.bsc} BSC`, callback_data: 'chain_bsc' }, { text: `${CHAIN_EMOJI.eth} ETH`, callback_data: 'chain_eth' }],
    [{ text: '⬅️ Menu', callback_data: 'action_menu' }],
  ]}};
}

function walletMenuKeyboard() {
  return { reply_markup: { inline_keyboard: [
    [{ text: `${CHAIN_EMOJI.solana} Solana`, callback_data: 'wallet_gen_solana' }, { text: `${CHAIN_EMOJI.bsc} BSC`, callback_data: 'wallet_gen_bsc' }, { text: `${CHAIN_EMOJI.eth} ETH`, callback_data: 'wallet_gen_eth' }],
    [{ text: '⬅️ Menu', callback_data: 'action_menu' }],
  ]}};
}

function topMenuKeyboard() {
  return { reply_markup: { inline_keyboard: [
    [{ text: 'A+', callback_data: 'top_A+' }, { text: 'A', callback_data: 'top_A' }, { text: 'B', callback_data: 'top_B' }, { text: 'C', callback_data: 'top_C' }, { text: 'D', callback_data: 'top_D' }],
    [{ text: '🏆 All', callback_data: 'top_all' }],
    [{ text: '⬅️ Menu', callback_data: 'action_menu' }],
  ]}};
}

function portfolioMenuKeyboard() {
  return { reply_markup: { inline_keyboard: [
    [{ text: '📋 Open Positions', callback_data: 'portfolio_open' }, { text: '📊 Summary', callback_data: 'portfolio_summary' }],
    [{ text: '📜 Trade History', callback_data: 'portfolio_history' }],
    [{ text: '⬅️ Menu', callback_data: 'action_menu' }],
  ]}};
}

function settingsMenuKeyboard() {
  return { reply_markup: { inline_keyboard: [
    [{ text: '🌐 Network', callback_data: 'action_network' }],
    [{ text: '💰 Wallet', callback_data: 'action_wallet_menu' }],
    [{ text: '⬅️ Menu', callback_data: 'action_menu' }],
  ]}};
}

// ===== Scan Helpers =====

async function sendScanResult(ctx, chain) {
  try {
    const tokens = await scanChain(chain);
    if (tokens.length === 0) {
      await ctx.editMessageText(`${CHAIN_EMOJI[chain]} Tidak ada token.`, backToMenuKeyboard());
      return;
    }
    tokens.sort((a, b) => {
      const order = { 'BUY': 0, 'WATCH': 1, 'CAUTION': 2, 'SKIP': 3, 'DANGER': 4 };
      const da = analyzeTokenForDisplay(a).decision;
      const db_ = analyzeTokenForDisplay(b).decision;
      if (order[da] !== order[db_]) return order[da] - order[db_];
      return scoreToken(b).score - scoreToken(a).score;
    });
    let text = formatScanHeader(chain, tokens);
    tokens.slice(0, 15).forEach((t, i) => { text += formatTokenCard(t, i + 1) + '\n'; });
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...backToMenuKeyboard(), disable_web_page_preview: true });
  } catch (err) {
    await ctx.editMessageText(`Error: ${err.message}`, backToMenuKeyboard());
  }
}

async function sendTrendingResult(ctx, chain) {
  try {
    const tokens = await fetchTrending(chain);
    tokens.sort((a, b) => scoreToken(b).score - scoreToken(a).score);
    let text = formatScanHeader(chain, tokens);
    tokens.slice(0, 15).forEach((t, i) => { text += formatTokenCard(t, i + 1) + '\n'; });
    if (tokens.length === 0) text += 'Tidak ada trending token.';
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...backToMenuKeyboard(), disable_web_page_preview: true });
  } catch (err) {
    await ctx.editMessageText(`Error: ${err.message}`, backToMenuKeyboard());
  }
}

async function sendTopResult(ctx, chain, grade) {
  const { getTopTokens, getTokensByGrade } = await import('../utils/database.js');
  const tokens = grade === 'all' ? getTopTokens(chain, 15) : getTokensByGrade(chain, grade, 10);
  if (tokens.length === 0) {
    await ctx.editMessageText(`Tidak ada token.`, backToMenuKeyboard());
    return;
  }
  let text = `${CHAIN_EMOJI[chain]} Top Tokens${grade === 'all' ? '' : ` (${grade})`}:\n\n`;
  tokens.forEach((t, i) => {
    const { score, decision, reason } = analyzeTokenForDisplay(t);
    const icon = { 'BUY': '🟢', 'WATCH': '🟡', 'SKIP': '⚪', 'CAUTION': '🟠', 'DANGER': '🔴' }[decision] || '⚪';
    text += `${i + 1}. ${t.name} (${t.symbol}) [${t.grade}] ${icon} ${decision}\n`;
    text += `   MC: $${formatNumber(t.market_cap)} | Vol: $${formatNumber(t.volume_24h)} | Score: ${t.score}\n`;
    text += `   /analyze_${t.address}\n\n`;
  });
  await ctx.editMessageText(text, { parse_mode: 'HTML', ...backToMenuKeyboard(), disable_web_page_preview: true });
}

// ===== Buy Helper =====

async function executeBuy(ctx, chain, tokenAddress, amountNative, slippage) {
  // Get user's wallet
  const wallets = getSavedWallets(chain);
  if (wallets.length === 0) {
    await ctx.reply(`${CHAIN_EMOJI[chain]} Belum ada wallet ${CHAIN_LABELS[chain]}. Ketik /wallet ${chain} untuk generate.`);
    return;
  }

  const wallet = wallets[0];
  const msg = await ctx.reply(`${CHAIN_EMOJI[chain]} Executing buy...`);

  try {
    let result;

    if (chain === 'solana') {
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const amountLamports = Math.floor(amountNative * 1_000_000_000);
      result = await jupiterSwap({
        inputMint: SOL_MINT,
        outputMint: tokenAddress,
        amount: amountLamports,
        slippageBps: slippage * 100,
        walletPublicKey: wallet.address,
        walletPrivateKey: wallet.private_key,
      });
    } else {
      result = await evmBuy({
        chain,
        tokenAddress,
        amountInNative: amountNative,
        walletPrivateKey: wallet.private_key,
        slippageBps: slippage * 100,
      });
    }

    // Save to portfolio
    addPosition({
      user_id: ctx.from.id,
      chain,
      token_address: tokenAddress,
      token_symbol: 'TOKEN',
      buy_amount_native: amountNative,
      buy_price: amountNative,
      txid: result.txid,
      tp_pct: 200,
      sl_pct: -30,
    });

    let text = `${CHAIN_EMOJI[chain]} <b>BUY SUCCESS</b>\n\n`;
    text += `Amount: ${amountNative} ${chain === 'solana' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH'}\n`;
    text += `Token: <code>${tokenAddress.slice(0, 12)}...</code>\n`;
    text += `TX: <a href="${result.explorer || `https://solscan.io/tx/${result.txid}`}">${result.txid.slice(0, 20)}...</a>\n`;
    text += `Slippage: ${slippage}%\n\n`;
    text += `Position saved. TP: 200% | SL: -30%\n`;
    text += `Check: /portfolio`;

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (err) {
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `BUY FAILED: ${err.message}`, backToMenuKeyboard());
  }
}

// ===== Setup All Commands =====

export function setupCommands(bot) {

  const sendMainMenu = (ctx) => {
    ctx.reply(
      `◎ Crypto Sniper Bot v2.0\nMulti-Chain: Solana | BSC | ETH\n\nPilih menu:`,
      mainMenuKeyboard(ctx.from.id)
    );
  };

  bot.start(sendMainMenu);
  bot.command('menu', sendMainMenu);

  bot.help((ctx) => {
    ctx.reply(
      `<b>Crypto Sniper Bot v2.0</b>\n\n` +
      `<b>Commands:</b>\n` +
      `/menu - Main menu\n` +
      `/scan - Scan token baru\n` +
      `/trending - Trending tokens\n` +
      `/top [grade] - Top tokens\n` +
      `/analyze &lt;address&gt; - Detail analisis\n\n` +
      `<b>Trading:</b>\n` +
      `/buy &lt;address&gt; &lt;amount&gt; - Buy token\n` +
      `/sell &lt;address&gt; - Sell all token\n` +
      `/portfolio - Portfolio\n` +
      `/pnl - Summary PnL\n\n` +
      `<b>Wallet:</b>\n` +
      `/wallet [chain] - Generate wallet\n` +
      `/mywallets - Lihat wallet\n` +
      `/network - Ganti jaringan\n\n` +
      `<b>Signals:</b>\n` +
      `🟢 BUY | 🟡 WATCH | 🟠 CAUTION | 🔴 DANGER | ⚪ SKIP`,
      { parse_mode: 'HTML' }
    );
  });

  // /scan
  bot.command('scan', async (ctx) => {
    const chain = getUserChain(ctx.from.id);
    const msg = await ctx.reply(`${CHAIN_EMOJI[chain]} Scanning...`);
    try {
      const tokens = await scanChain(chain);
      if (!tokens.length) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'No tokens.'); return; }
      tokens.sort((a, b) => {
        const order = { 'BUY': 0, 'WATCH': 1, 'CAUTION': 2, 'SKIP': 3, 'DANGER': 4 };
        const da = analyzeTokenForDisplay(a).decision;
        const db_ = analyzeTokenForDisplay(b).decision;
        return (order[da] || 5) - (order[db_] || 5) || scoreToken(b).score - scoreToken(a).score;
      });
      let text = formatScanHeader(chain, tokens);
      tokens.slice(0, 15).forEach((t, i) => { text += formatTokenCard(t, i + 1) + '\n'; });
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${err.message}`);
    }
  });

  // /buy <address> <amount> [slippage]
  bot.command('buy', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    const address = parts[1];
    const amount = parseFloat(parts[2]);
    const slippage = parseFloat(parts[3]) || 10;

    if (!address || !amount || amount <= 0) {
      return ctx.reply(`Format: /buy <token_address> <amount_${getUserChain(ctx.from.id) === 'solana' ? 'SOL' : getUserChain(ctx.from.id) === 'bsc' ? 'BNB' : 'ETH'}> [slippage%]\n\nExample:\n/buy TokenAddress 0.01 10\n0.01 SOL, slippage 10%`);
    }

    const chain = getUserChain(ctx.from.id);
    const maxAmount = chain === 'solana' ? 1 : chain === 'eth' ? 0.5 : 2;
    if (amount > maxAmount) {
      return ctx.reply(`Amount terlalu besar. Max ${maxAmount} ${chain === 'solana' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH'} per trade.`);
    }

    await executeBuy(ctx, chain, address, amount, slippage);
  });

  // /sell <address> [slippage]
  bot.command('sell', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    const address = parts[1];
    const slippage = parseFloat(parts[2]) || 10;

    if (!address) return ctx.reply(`Format: /sell <token_address> [slippage%]`);

    const chain = getUserChain(ctx.from.id);
    const msg = await ctx.reply(`${CHAIN_EMOJI[chain]} Executing sell...`);

    try {
      const wallets = getSavedWallets(chain);
      if (!wallets.length) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'No wallet.'); return; }

      let result;

      if (chain === 'solana') {
        const { getTokenBalance } = await import('../services/solana-swapper.js');
        const balance = await getTokenBalance(address, wallets[0].address);
        if (!balance || balance === 0) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'No token balance.'); return; }
        result = await jupiterSell({
          tokenMint: address,
          tokenAmount: balance.toString(),
          walletPublicKey: wallets[0].address,
          walletPrivateKey: wallets[0].private_key,
          slippageBps: slippage * 100,
        });
      } else {
        result = await evmSell({
          chain,
          tokenAddress: address,
          walletPrivateKey: wallets[0].private_key,
          slippageBps: slippage * 100,
        });
      }

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
        `${CHAIN_EMOJI[chain]} <b>SELL SUCCESS</b>\n\nTX: <a href="${result.explorer || `https://solscan.io/tx/${result.txid}`}">${result.txid.slice(0, 20)}...</a>\nSlippage: ${slippage}%`,
        { parse_mode: 'HTML', disable_web_page_preview: true }
      );
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `SELL FAILED: ${err.message}`, backToMenuKeyboard());
    }
  });

  // /top
  bot.command('top', async (ctx) => {
    const chain = getUserChain(ctx.from.id);
    const grade = ctx.message.text.replace('/top', '').trim().toUpperCase();
    await sendTopResult({ ...ctx, editMessageText: (t, o) => ctx.reply(t, o) }, chain, grade || 'all');
  });

  // /analyze
  bot.command('analyze', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    const address = parts[1] || '';
    const chain = getUserChain(ctx.from.id);
    if (!address) return ctx.reply('Format: /analyze <token_address>');
    const clean = address.replace(/^\/analyze_/, '');
    const msg = await ctx.reply(`Analyzing...`);
    try {
      const [overview, holders] = await Promise.all([getTokenOverview(clean), analyzeHolders(clean)]);
      let text = `${CHAIN_EMOJI[chain]} <b>Analysis</b> - ${CHAIN_LABELS[chain]}\n<code>${clean.slice(0, 12)}...${clean.slice(-6)}</code>\n\n`;
      if (overview) {
        text += `<b>${overview.symbol || 'N/A'}</b>\nPrice: $${parseFloat(overview.price || 0).toExponential(4)}\nMC: $${formatNumber(parseFloat(overview.mc || 0))}\nVol 24h: $${formatNumber(parseFloat(overview.v24hUSD || 0))}\nLiq: $${formatNumber(parseFloat(overview.liquidity || 0))}\n`;
        text += `24h: ${overview.priceChange24h || 'N/A'}% | 6h: ${overview.priceChange6h || 'N/A'}% | 1h: ${overview.priceChange1h || 'N/A'}%\n`;
      } else { text += `Basic info: N/A (need Birdeye API key)\n`; }
      text += `\n<b>Holders:</b>\n`;
      if (holders) {
        text += `Analyzed: ${holders.totalHolders} | Top: ${holders.topHolderPct}% | Top5: ${holders.top5Pct}%\nRisk: ${holders.risk}\n`;
        holders.holders.forEach((h, i) => { text += `  ${i + 1}. <code>${h.address.slice(0, 8)}...${h.address.slice(-4)}</code> (${h.pct}%)\n`; });
      } else { text += `N/A (need Helius API key)\n`; }
      text += `\n<a href="https://dexscreener.com/${chain}/${clean}">Dexscreener</a>`;
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${err.message}`);
    }
  });

  // /trending
  bot.command('trending', async (ctx) => {
    const chain = getUserChain(ctx.from.id);
    const msg = await ctx.reply(`${CHAIN_EMOJI[chain]} Fetching...`);
    try {
      const tokens = await fetchTrending(chain);
      tokens.sort((a, b) => scoreToken(b).score - scoreToken(a).score);
      let text = formatScanHeader(chain, tokens);
      tokens.slice(0, 15).forEach((t, i) => { text += formatTokenCard(t, i + 1) + '\n'; });
      if (!tokens.length) text += 'No tokens.';
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${err.message}`);
    }
  });

  // /wallet
  bot.command('wallet', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    let chain = (parts[1] || getUserChain(ctx.from.id)).toLowerCase();
    if (!CHAIN_LABELS[chain]) return ctx.reply(`Format: /wallet [solana|bsc|eth]`, walletMenuKeyboard());
    try {
      let wallet;
      if (chain === 'solana') wallet = generateSolanaWallet();
      else { wallet = generateEVMWallet(); wallet.chain = chain; }
      saveWallet(wallet);
      let text = `${CHAIN_EMOJI[chain]} <b>Wallet ${CHAIN_LABELS[chain]}</b>\n\nAddress:\n<code>${wallet.address}</code>\n\nPrivate Key:\n<code>${wallet.privateKey}</code>\n`;
      if (wallet.mnemonic) text += `\n<b>Mnemonic</b>:\n<code>${wallet.mnemonic}</code>`;
      text += `\n\nTersimpan.`;
      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (err) { await ctx.reply(`Error: ${err.message}`); }
  });

  // /mywallets
  bot.command('mywallets', (ctx) => {
    const wallets = getSavedWallets();
    if (!wallets.length) return ctx.reply('No wallet. /wallet to generate.');
    let text = '<b>Saved Wallets:</b>\n\n';
    let prev = '';
    wallets.forEach((w) => {
      if (w.chain !== prev) { prev = w.chain; text += `${CHAIN_EMOJI[prev]} ${CHAIN_LABELS[prev]}:\n`; }
      text += `  #${w.id} | <code>${w.address}</code>\n`;
    });
    ctx.reply(text, { parse_mode: 'HTML' });
  });

  // /portfolio
  bot.command('portfolio', (ctx) => {
    const positions = getOpenPositions(ctx.from.id);
    if (!positions.length) return ctx.reply('No open positions.');
    let text = '<b>Open Positions:</b>\n\n';
    positions.forEach((p, i) => {
      text += `${i + 1}. ${CHAIN_EMOJI[p.chain] || ''} ${p.token_symbol} (${p.token_address.slice(0, 8)}...)\n`;
      text += `   Buy: ${p.buy_amount_native} | TP: ${p.tp_pct}% | SL: ${p.sl_pct}%\n`;
      text += `   /sell_${p.token_address}\n\n`;
    });
    ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true });
  });

  // /pnl
  bot.command('pnl', (ctx) => {
    const summary = getPortfolioSummary(ctx.from.id);
    let text = '<b>Portfolio Summary</b>\n\n';
    text += `Open: ${summary.openPositions} positions\nInvested: ${summary.totalInvested}\n\n`;
    text += `Closed Trades: ${summary.closedTrades}\nWins: ${summary.wins} | Losses: ${summary.losses}\nWin Rate: ${summary.winRate}%\n`;
    text += `Total PnL: ${summary.totalPnl >= 0 ? '+' : ''}${summary.totalPnl.toFixed(4)}\n`;
    ctx.reply(text, { parse_mode: 'HTML' });
  });

  // /network
  bot.command('network', (ctx) => ctx.reply('Pilih jaringan:', networkKeyboard()));

  // /stats
  bot.command('stats', (ctx) => {
    const stats = getStats();
    let text = `<b>Stats</b>\nTotal: ${stats.total}\n\nChain:\n`;
    stats.byChain.forEach(c => { text += `  ${CHAIN_EMOJI[c.chain] || ''} ${CHAIN_LABELS[c.chain] || c.chain}: ${c.count}\n`; });
    text += `\nGrade:\n`;
    stats.byGrade.forEach(g => { text += `  ${g.grade}: ${g.count}\n`; });
    ctx.reply(text, { parse_mode: 'HTML' });
  });

  // /clear
  bot.command('clear', async (ctx) => {
    if (!config.adminIds.includes(ctx.from.id)) return ctx.reply('Unauthorized');
    const db = (await import('../utils/database.js')).default;
    db.exec('DELETE FROM scanned_tokens');
    db.exec('DELETE FROM alerts');
    await ctx.reply('Database cleared.');
  });

  // ===== CALLBACKS =====

  bot.action('action_menu', (ctx) => { ctx.answerCbQuery(); ctx.editMessageText(`◎ Crypto Sniper Bot v2.0\nMulti-Chain: Solana | BSC | ETH\n\nPilih menu:`, mainMenuKeyboard(ctx.from.id)); });

  bot.action('action_scan', (ctx) => { ctx.answerCbQuery(); ctx.editMessageText(`${CHAIN_EMOJI[getUserChain(ctx.from.id)]} Scanning...`, backToMenuKeyboard()); sendScanResult(ctx, getUserChain(ctx.from.id)); });
  bot.action('action_trending', (ctx) => { ctx.answerCbQuery(); ctx.editMessageText('Loading...', backToMenuKeyboard()); sendTrendingResult(ctx, getUserChain(ctx.from.id)); });
  bot.action('action_top', (ctx) => { ctx.answerCbQuery(); ctx.editMessageText('Pilih grade:', topMenuKeyboard()); });
  bot.action(/^top_(.+)$/, (ctx) => { ctx.answerCbQuery(); sendTopResult(ctx, getUserChain(ctx.from.id), ctx.match[1] === 'all' ? 'all' : ctx.match[1]); });

  bot.action('action_buy_prompt', (ctx) => {
    ctx.answerCbQuery();
    const chain = getUserChain(ctx.from.id);
    const native = chain === 'solana' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';
    ctx.editMessageText(
      `<b>Quick Buy</b>\nFormat:\n/buy &lt;token_address&gt; &lt;amount_${native}&gt; [slippage%]\n\nExample:\n/buy TokenAddr 0.01 10\n\n0.01 ${native}, slippage 10%\n\nOr tap scan results to buy.`,
      { parse_mode: 'HTML', ...backToMenuKeyboard() }
    );
  });

  bot.action('action_sell_prompt', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText(
      `<b>Quick Sell</b>\nFormat:\n/sell &lt;token_address&gt; [slippage%]\n\nSells all token balance.\n\nOr use /portfolio to see positions.`,
      { parse_mode: 'HTML', ...backToMenuKeyboard() }
    );
  });

  bot.action('action_stats', (ctx) => {
    ctx.answerCbQuery();
    const stats = getStats();
    let text = `<b>Stats</b>\nTotal: ${stats.total}\n\nChain:\n`;
    stats.byChain.forEach(c => { text += `  ${CHAIN_EMOJI[c.chain] || ''} ${CHAIN_LABELS[c.chain] || c.chain}: ${c.count}\n`; });
    text += `\nGrade:\n`;
    stats.byGrade.forEach(g => { text += `  ${g.grade}: ${g.count}\n`; });
    text += `\nSource:\n`;
    stats.bySource.forEach(s => { text += `  ${s.source}: ${s.count}\n`; });
    ctx.editMessageText(text, { parse_mode: 'HTML', ...backToMenuKeyboard() });
  });

  bot.action('action_network', (ctx) => { ctx.answerCbQuery(); ctx.editMessageText('Pilih jaringan:', networkKeyboard()); });

  bot.action(/^chain_(solana|bsc|eth)$/, (ctx) => {
    const chain = ctx.match[1];
    setUserChain(ctx.from.id, chain);
    ctx.answerCbQuery(`Switched to ${CHAIN_LABELS[chain]}`);
    ctx.editMessageText(`Network: ${CHAIN_EMOJI[chain]} ${CHAIN_LABELS[chain]}`, mainMenuKeyboard(ctx.from.id));
  });

  bot.action('action_wallet_menu', (ctx) => { ctx.answerCbQuery(); ctx.editMessageText('Generate wallet:', walletMenuKeyboard()); });

  bot.action(/^wallet_gen_(solana|bsc|eth)$/, async (ctx) => {
    const chain = ctx.match[1];
    ctx.answerCbQuery();
    try {
      let wallet;
      if (chain === 'solana') wallet = generateSolanaWallet();
      else { wallet = generateEVMWallet(); wallet.chain = chain; }
      saveWallet(wallet);
      let text = `${CHAIN_EMOJI[chain]} <b>Wallet ${CHAIN_LABELS[chain]}</b>\n\n<code>${wallet.address}</code>\n\n<code>${wallet.privateKey}</code>\n`;
      if (wallet.mnemonic) text += `\n<b>Mnemonic</b>:\n<code>${wallet.mnemonic}</code>`;
      await ctx.reply(text, { parse_mode: 'HTML' });
      ctx.editMessageText(`Wallet generated. Check above.`, backToMenuKeyboard());
    } catch (err) { ctx.reply(`Error: ${err.message}`); ctx.editMessageText('Failed.', backToMenuKeyboard()); }
  });

  bot.action('action_portfolio', (ctx) => { ctx.answerCbQuery(); ctx.editMessageText('Portfolio:', portfolioMenuKeyboard()); });

  bot.action('portfolio_open', (ctx) => {
    ctx.answerCbQuery();
    const positions = getOpenPositions(ctx.from.id);
    if (!positions.length) { ctx.editMessageText('No open positions.', backToMenuKeyboard()); return; }
    let text = '<b>Open Positions:</b>\n\n';
    positions.forEach((p, i) => {
      text += `${i + 1}. ${CHAIN_EMOJI[p.chain] || ''} ${p.token_symbol} (${p.token_address.slice(0, 8)}...)\n`;
      text += `   Buy: ${p.buy_amount_native} | TP: +${p.tp_pct}% | SL: ${p.sl_pct}%\n\n`;
    });
    ctx.editMessageText(text, { parse_mode: 'HTML', ...backToMenuKeyboard() });
  });

  bot.action('portfolio_summary', (ctx) => {
    ctx.answerCbQuery();
    const s = getPortfolioSummary(ctx.from.id);
    ctx.editMessageText(
      `<b>Portfolio Summary</b>\n\nOpen: ${s.openPositions} | Invested: ${s.totalInvested}\n\nClosed: ${s.closedTrades}\nW: ${s.wins} | L: ${s.losses} | Rate: ${s.winRate}%\nPnL: ${s.totalPnl >= 0 ? '+' : ''}${s.totalPnl.toFixed(4)}`,
      { parse_mode: 'HTML', ...backToMenuKeyboard() }
    );
  });

  bot.action('portfolio_history', (ctx) => {
    ctx.answerCbQuery();
    const positions = getAllPositions(ctx.from.id);
    const closed = positions.filter(p => p.status === 'sold');
    if (!closed.length) { ctx.editMessageText('No trade history.', backToMenuKeyboard()); return; }
    let text = '<b>Trade History:</b>\n\n';
    closed.slice(0, 15).forEach((p, i) => {
      const icon = p.pnl_pct > 0 ? '🟢' : '🔴';
      text += `${i + 1}. ${icon} ${p.token_symbol} (${p.token_address.slice(0, 8)}...)\n`;
      text += `   PnL: ${p.pnl_pct > 0 ? '+' : ''}${p.pnl_pct.toFixed(1)}% | ${p.pnl_amount >= 0 ? '+' : ''}${p.pnl_amount.toFixed(6)}\n\n`;
    });
    ctx.editMessageText(text, { parse_mode: 'HTML', ...backToMenuKeyboard() });
  });

  bot.action('action_settings', (ctx) => { ctx.answerCbQuery(); ctx.editMessageText('Settings:', settingsMenuKeyboard()); });
}
