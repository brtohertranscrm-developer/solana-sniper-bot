import { config } from '../config.js';
import { getUserChain, setUserChain, getStats } from '../utils/database.js';
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

const CL = { solana: 'Solana', bsc: 'BSC', eth: 'ETH' };
const CE = { solana: '◎', bsc: '🔶', eth: '⟠' };
const nativeUnit = c => c === 'solana' ? 'SOL' : c === 'bsc' ? 'BNB' : 'ETH';

// ===== KEYBOARDS =====

function mainMenu(uid) {
  const ch = getUserChain(uid);
  const pm = isPaperMode(uid);
  return { reply_markup: { inline_keyboard: [
    [{ text: '🔍 Scan', callback_data: 'do_scan' }, { text: '🔥 Trending', callback_data: 'do_trending' }, { text: '📊 Top', callback_data: 'do_top' }],
    [{ text: '🎯 Buy', callback_data: 'do_buy_help' }, { text: '💸 Sell', callback_data: 'do_sell_help' }, { text: '💼 Portfolio', callback_data: 'do_portfolio' }],
    [{ text: '🐋 Copy Trade', callback_data: 'sub_copytrade' }, { text: '🛡️ Anti-Rug', callback_data: 'sub_antirug' }, { text: '📡 Auto-Buy', callback_data: 'sub_autobuy' }],
    [{ text: '📈 DCA', callback_data: 'sub_dca' }, { text: '🏎️ Bonding', callback_data: 'sub_bonding' }, { text: '📢 Volume', callback_data: 'sub_volume' }],
    [{ text: '📺 Channel', callback_data: 'sub_channel' }, { text: '🧪 Paper', callback_data: 'sub_paper' }, { text: '🎯 Strategy', callback_data: 'sub_strategy' }],
    [{ text: '💰 Wallets', callback_data: 'sub_wallets' }, { text: '📋 PnL', callback_data: 'do_pnl' }, { text: `🌐 ${CE[ch]} ${CL[ch]}`, callback_data: 'sub_network' }],
  ]}};
}

function back() { return { reply_markup: { inline_keyboard: [[{ text: '⬅️ Menu', callback_data: 'main' }]] } }; }

function chainBtns() {
  return { reply_markup: { inline_keyboard: [
    [{ text: `${CE.solana} Solana`, callback_data: 'chain_solana' }, { text: `${CE.bsc} BSC`, callback_data: 'chain_bsc' }, { text: `${CE.eth} ETH`, callback_data: 'chain_eth' }],
    [{ text: '⬅️ Menu', callback_data: 'main' }],
  ]}};
}

function walletGenBtns() {
  return { reply_markup: { inline_keyboard: [
    [{ text: `${CE.solana} Solana`, callback_data: 'wgen_solana' }, { text: `${CE.bsc} BSC`, callback_data: 'wgen_bsc' }, { text: `${CE.eth} ETH`, callback_data: 'wgen_eth' }],
    [{ text: '⬅️ Menu', callback_data: 'main' }],
  ]}};
}

function topBtns() {
  return { reply_markup: { inline_keyboard: [
    [{ text: 'A+', callback_data: 'top_A+' }, { text: 'A', callback_data: 'top_A' }, { text: 'B', callback_data: 'top_B' }, { text: 'C', callback_data: 'top_C' }, { text: 'D', callback_data: 'top_D' }],
    [{ text: '🏆 All', callback_data: 'top_all' }],
    [{ text: '⬅️ Menu', callback_data: 'main' }],
  ]}};
}

// ===== SCAN/FORMATTING HELPERS =====

async function doScan(ctx, chain) {
  try {
    const tokens = await scanChain(chain);
    if (!tokens.length) { await ctx.editMessageText(`${CE[chain]} No tokens found.`, back()); return; }
    tokens.sort((a, b) => {
      const ord = { 'BUY': 0, 'WATCH': 1, 'CAUTION': 2, 'SKIP': 3, 'DANGER': 4 };
      const da = analyzeTokenForDisplay(a).decision, db_ = analyzeTokenForDisplay(b).decision;
      return (ord[da]||5) - (ord[db_]||5) || scoreToken(b).score - scoreToken(a).score;
    });
    let t = formatScanHeader(chain, tokens);
    tokens.slice(0, 15).forEach((tk, i) => { t += formatTokenCard(tk, i+1) + '\n'; });
    await ctx.editMessageText(t, { parse_mode: 'HTML', ...back(), disable_web_page_preview: true });
  } catch (e) { await ctx.editMessageText(`Error: ${e.message}`, back()); }
}

async function doTrending(ctx, chain) {
  try {
    const tokens = await fetchTrending(chain);
    tokens.sort((a, b) => scoreToken(b).score - scoreToken(a).score);
    let t = formatScanHeader(chain, tokens);
    tokens.slice(0, 15).forEach((tk, i) => { t += formatTokenCard(tk, i+1) + '\n'; });
    await ctx.editMessageText(t, { parse_mode: 'HTML', ...back(), disable_web_page_preview: true });
  } catch (e) { await ctx.editMessageText(`Error: ${e.message}`, back()); }
}

async function doTop(ctx, chain, grade) {
  const { getTopTokens, getTokensByGrade } = await import('../utils/database.js');
  const tokens = grade === 'all' ? getTopTokens(chain, 15) : getTokensByGrade(chain, grade, 10);
  if (!tokens.length) { await ctx.editMessageText('No tokens.', back()); return; }
  let t = `${CE[chain]} Top${grade==='all'?'':` (${grade})`}:\n\n`;
  tokens.forEach((tk, i) => {
    const { score, decision } = analyzeTokenForDisplay(tk);
    const ic = { 'BUY':'🟢','WATCH':'🟡','SKIP':'⚪','CAUTION':'🟠','DANGER':'🔴' }[decision]||'⚪';
    t += `${i+1}. ${tk.name} (${tk.symbol}) [${tk.grade}] ${ic} ${decision}\n   MC: $${formatNumber(tk.market_cap)} | Vol: $${formatNumber(tk.volume_24h)} | Score: ${tk.score}\n   /analyze_${tk.address}\n\n`;
  });
  await ctx.editMessageText(t, { parse_mode: 'HTML', ...back(), disable_web_page_preview: true });
}

// ===== BUY EXECUTION =====

async function execBuy(ctx, chain, addr, amt, slip) {
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

// ===== SETUP =====

export function setupCommands(bot) {

  const menu = ctx => ctx.reply(`◎ Crypto Sniper Bot v3.0\nMulti-Chain: Solana | BSC | ETH\nMode: ${isPaperMode(ctx.from.id)?'🧪 PAPER':'⚡ LIVE'}`, mainMenu(ctx.from.id));

  bot.start(menu);
  bot.command('menu', menu);

  bot.help(ctx => ctx.reply(
    `<b>Crypto Sniper Bot v3.0</b>\n\n` +
    `<b>Scanner:</b>\n/scan /trending /top [grade] /analyze &lt;addr&gt;\n\n` +
    `<b>Trading:</b>\n/buy &lt;addr&gt; &lt;amount&gt; [slip%]\n/sell &lt;addr&gt; [slip%]\n/dca &lt;addr&gt; &lt;total&gt; &lt;slices&gt; &lt;interval_sec&gt;\n/snipe &lt;addr&gt;\n\n` +
    `<b>Copy Trade:</b>\n/copy &lt;wallet&gt; [label]\n/uncopy &lt;id&gt;\n/copylist\n\n` +
    `<b>Auto:</b>\n/autobuy on|off|set\n/autopaper on|off\n\n` +
    `<b>Portfolio:</b>\n/portfolio /pnl /paper_portfolio\n\n` +
    `<b>Wallet:</b>\n/wallet [chain] /mywallets /network`,
    { parse_mode: 'HTML' }
  ));

  // ===== TEXT COMMANDS =====

  bot.command('scan', async ctx => {
    const ch = getUserChain(ctx.from.id);
    const msg = await ctx.reply(`${CE[ch]} Scanning...`);
    try {
      const tokens = await scanChain(ch);
      if (!tokens.length) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'No tokens.'); return; }
      tokens.sort((a,b) => { const o={BUY:0,WATCH:1,CAUTION:2,SKIP:3,DANGER:4}; const da=analyzeTokenForDisplay(a).decision,db_=analyzeTokenForDisplay(b).decision; return (o[da]||5)-(o[db_]||5)||scoreToken(b).score-scoreToken(a).score; });
      let t = formatScanHeader(ch, tokens);
      tokens.slice(0,15).forEach((tk,i) => { t += formatTokenCard(tk,i+1)+'\n'; });
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, t, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch(e) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${e.message}`); }
  });

  bot.command('buy', ctx => {
    const p = ctx.message.text.split(' ');
    const addr = p[1], amt = parseFloat(p[2]), slip = parseFloat(p[3])||10;
    if (!addr||!amt||amt<=0) return ctx.reply(`Format: /buy <token_address> <amount_${nativeUnit(getUserChain(ctx.from.id))}> [slippage%]`);
    execBuy(ctx, getUserChain(ctx.from.id), addr, amt, slip);
  });

  bot.command('sell', async ctx => {
    const p = ctx.message.text.split(' ');
    const addr = p[1], slip = parseFloat(p[2])||10;
    if (!addr) return ctx.reply('Format: /sell <token_address> [slippage%]');
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
    if (!addr) return ctx.reply('Format: /analyze <token_address>');
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
      tokens.sort((a,b)=>scoreToken(b).score-scoreToken(a).score);
      let t = formatScanHeader(ch, tokens);
      tokens.slice(0,15).forEach((tk,i)=>{t+=formatTokenCard(tk,i+1)+'\n';});
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, t, { parse_mode: 'HTML', disable_web_page_preview: true });
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
    if (!addr) return ctx.reply('Format: /copy <wallet_address> [label]');
    const ch = getUserChain(ctx.from.id);
    addWatchWallet(ctx.from.id, ch, addr, label);
    ctx.reply(`${CE[ch]} Now watching wallet for copy trade.\n/uncopy to stop.`);
  });

  bot.command('uncopy', ctx => {
    const id = parseInt(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply('Format: /uncopy <id>');
    removeWatchWallet(id);
    ctx.reply('Stopped watching.');
  });

  bot.command('copylist', ctx => {
    const wls = getWatchWallets(ctx.from.id);
    if (!wls.length) return ctx.reply('No watched wallets.\n/copy <address> to add.');
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
    if (!p[1]||!p[2]||!p[3]||!p[4]) return ctx.reply('Format:\n/dca <token> <total_amount> <slices> <interval_sec> [slippage]\n/dca list\n/dca cancel <id>');
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
    if (!addr) return ctx.reply('Format: /snipe <token_address>');
    const ch = getUserChain(ctx.from.id);
    const amt = ch === 'solana' ? 0.01 : ch === 'eth' ? 0.001 : 0.005;
    execBuy(ctx, ch, addr, amt, 15);
  });

  // ===== STRATEGY COMMAND =====
  bot.command('strategy', ctx => {
    const p = ctx.message.text.split(' ');
    const sub = p[1];
    const ch = getUserChain(ctx.from.id);

    if (!sub) {
      const r = getStrategyReport(ctx.from.id);
      if (!r) return ctx.reply(`Set strategi dulu:

/strategy set <daily_budget> <max_per_trade> <max_trades> <target_roi%> <stop_loss%>

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
/strategy set <budget> <max/trade> <max_trades> <roi> <sl>
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
      if (!p[2]) return ctx.reply('Format: /strategy set <daily_budget> <max_per_trade> <max_trades> <target_roi%> <stop_loss%>');
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
    if (!channelId) return ctx.reply('Format: /channel_add <channel_id> [label]');
    const ch = getUserChain(ctx.from.id);
    addChannelMonitor(ctx.from.id, channelId, ch, label);
    ctx.reply(`Channel monitor added for ${channelId}.`);
  });

  bot.command('channel_rm', ctx => {
    const channelId = ctx.message.text.split(' ')[1];
    if (!channelId) return ctx.reply('Format: /channel_rm <channel_id>');
    removeChannelMonitor(ctx.from.id, channelId);
    ctx.reply('Channel monitor removed.');
  });

  bot.command('tieredtp', ctx => {
    const p = ctx.message.text.split(' ');
    const addr = p[1];
    if (!addr) return ctx.reply('Format: /tieredtp <token> [100:25,200:25,500:50]');
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
    if (!address || !privateKey) return ctx.reply('Format: /rotate_add <address> <private_key>');
    const ch = getUserChain(ctx.from.id);
    const id = addWalletToRotation(ctx.from.id, ch, address, privateKey);
    ctx.reply(id ? `Rotation wallet #${id} added for ${CL[ch]}.` : 'Failed to add rotation wallet.');
  });

  bot.command('rotate_rm', ctx => {
    const id = parseInt(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply('Format: /rotate_rm <id>');
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

  bot.on(['channel_post', 'text'], ctx => processChannelMessage(ctx));

  // ===== CALLBACKS =====

  bot.action('main', ctx => { ctx.answerCbQuery(); ctx.editMessageText(`◎ Crypto Sniper Bot v3.0\nMode: ${isPaperMode(ctx.from.id)?'🧪 PAPER':'⚡ LIVE'}`, mainMenu(ctx.from.id)); });

  // Scanner
  bot.action('do_scan', ctx => { ctx.answerCbQuery(); const ch=getUserChain(ctx.from.id); ctx.editMessageText(`${CE[ch]} Scanning...`, back()); doScan(ctx, ch); });
  bot.action('do_trending', ctx => { ctx.answerCbQuery(); const ch=getUserChain(ctx.from.id); ctx.editMessageText('Loading...', back()); doTrending(ctx, ch); });
  bot.action('do_top', ctx => { ctx.answerCbQuery(); ctx.editMessageText('Pilih grade:', topBtns()); });
  bot.action(/^top_(.+)$/, ctx => { ctx.answerCbQuery(); doTop(ctx, getUserChain(ctx.from.id), ctx.match[1]==='all'?'all':ctx.match[1]); });

  // Buy/Sell help
  bot.action('do_buy_help', ctx => { ctx.answerCbQuery(); ctx.editMessageText(`<b>Quick Buy</b>\n/buy &lt;token&gt; &lt;amount_${nativeUnit(getUserChain(ctx.from.id))}&gt; [slip%]\n\nExample:\n/buy TokenAddr 0.01 10`, { parse_mode: 'HTML', ...back() }); });
  bot.action('do_sell_help', ctx => { ctx.answerCbQuery(); ctx.editMessageText(`<b>Quick Sell</b>\n/sell &lt;token&gt; [slip%]\n\nSells all balance.`, { parse_mode: 'HTML', ...back() }); });

  // Portfolio
  bot.action('do_portfolio', ctx => {
    ctx.answerCbQuery();
    const pos = getOpenPositions(ctx.from.id);
    if (!pos.length) { ctx.editMessageText('No open positions.', back()); return; }
    let t = '<b>Portfolio:</b>\n\n';
    pos.forEach((p,i) => { t += `${i+1}. ${CE[p.chain]} ${p.token_symbol} (${p.token_address.slice(0,8)}...)\n   Buy: ${p.buy_amount_native} | TP:+${p.tp_pct}% | SL:${p.sl_pct}%\n\n`; });
    ctx.editMessageText(t, { parse_mode: 'HTML', ...back() });
  });

  // PnL
  bot.action('do_pnl', ctx => {
    ctx.answerCbQuery();
    const s = getPortfolioSummary(ctx.from.id);
    ctx.editMessageText(`<b>PnL</b>\nOpen: ${s.openPositions} | Closed: ${s.closedTrades}\nW: ${s.wins} | L: ${s.losses} | Rate: ${s.winRate}%\nPnL: ${s.totalPnl>=0?'+':''}${s.totalPnl.toFixed(4)}`, { parse_mode: 'HTML', ...back() });
  });

  // Network
  bot.action('sub_network', ctx => { ctx.answerCbQuery(); ctx.editMessageText('Pilih jaringan:', chainBtns()); });
  bot.action(/^chain_(solana|bsc|eth)$/, ctx => {
    const ch = ctx.match[1]; setUserChain(ctx.from.id, ch);
    ctx.answerCbQuery(`${CL[ch]}`);
    ctx.editMessageText(`Network: ${CE[ch]} ${CL[ch]}`, mainMenu(ctx.from.id));
  });

  // Wallets
  bot.action('sub_wallets', ctx => { ctx.answerCbQuery(); ctx.editMessageText('Generate wallet:', walletGenBtns()); });
  bot.action(/^wgen_(solana|bsc|eth)$/, async ctx => {
    const ch = ctx.match[1]; ctx.answerCbQuery();
    try {
      let w; if (ch==='solana') w=generateSolanaWallet(); else {w=generateEVMWallet();w.chain=ch;}
      saveWallet(w);
      let t = `${CE[ch]} <b>${CL[ch]}</b>\n\n<code>${w.address}</code>\n\n<code>${w.privateKey}</code>`;
      if (w.mnemonic) t += `\n\n<b>Mnemonic</b>:\n<code>${w.mnemonic}</code>`;
      await ctx.reply(t, { parse_mode: 'HTML' });
      ctx.editMessageText('Generated. Check above.', back());
    } catch(e) { ctx.reply(`Error: ${e.message}`); }
  });

  // Copy Trade submenu
  bot.action('sub_copytrade', ctx => {
    ctx.answerCbQuery();
    const wls = getWatchWallets(ctx.from.id);
    let t = `<b>🐋 Copy Trade</b>\n\n/copy &lt;wallet_address&gt; [label]\n/uncopy &lt;id&gt; /copylist\n\nWatching ${wls.length} wallets.`;
    ctx.editMessageText(t, { parse_mode: 'HTML', ...back() });
  });

  // Anti-Rug submenu
  bot.action('sub_antirug', ctx => {
    ctx.answerCbQuery();
    ctx.editMessageText(`<b>🛡️ Anti-Rug Pull</b>\n\nActive monitoring: ON\nThreshold: 20% dump = rug alert\nAuto-sell: Alert only (no auto-sell)\n\nMonitors top holder activity for all open positions.`, { parse_mode: 'HTML', ...back() });
  });

  // Auto-Buy submenu
  bot.action('sub_autobuy', ctx => {
    ctx.answerCbQuery();
    const ch = getUserChain(ctx.from.id), cfg = getAutoBuyConfig(ctx.from.id, ch);
    ctx.editMessageText(
      `<b>📡 Auto-Buy ${CL[ch]}</b>\nStatus: ${cfg?.enabled?'✅ ON':'❌ OFF'}\n\n` +
      `/autobuy on|off\n/autobuy set minMC maxMC minHolders minLiq amountPerBuy maxBuysPerHour\n\n` +
      `Current: MC $${cfg?.min_mc||0}-$${cfg?.max_mc||'∞'} | Holders>${cfg?.min_holders||0} | Liq>$${cfg?.min_liq||0}\nAmount: ${cfg?.amount_per_buy||0} ${nativeUnit(ch)}/buy`,
      { parse_mode: 'HTML', ...back() }
    );
  });

  // DCA submenu
  bot.action('sub_dca', ctx => {
    ctx.answerCbQuery();
    const ords = getActiveDCAOrders(ctx.from.id);
    let t = `<b>📈 DCA</b>\n\n/dca &lt;token&gt; &lt;total&gt; &lt;slices&gt; &lt;interval_sec&gt;\n/dca list\n/dca cancel &lt;id&gt;\n\nActive: ${ords.length}`;
    ctx.editMessageText(t, { parse_mode: 'HTML', ...back() });
  });

  // Bonding submenu
  bot.action('sub_bonding', ctx => {
    ctx.answerCbQuery();
    ctx.editMessageText(`<b>🏎️ Bonding Curve Sniper</b>\n\nMonitors Pump.fun tokens approaching bonding curve completion (>90%).\n\nAlert only mode.\nTo quick-snipe: /snipe &lt;token_address&gt;`, { parse_mode: 'HTML', ...back() });
  });

  // Volume submenu
  bot.action('sub_volume', ctx => {
    ctx.answerCbQuery();
    ctx.editMessageText(`<b>📢 Volume Spike Alert</b>\n\nActive: ON\nThreshold: 500%+ spike in 5 min\n\nAlerts sent automatically.`, { parse_mode: 'HTML', ...back() });
  });

  // Channel submenu
  bot.action('sub_channel', ctx => {
    ctx.answerCbQuery();
    const chs = getChannelMonitors(ctx.from.id);
    let t = `<b>📺 Channel Monitor</b>\n\nMonitor: /channel_add &lt;channel_id&gt;\nRemove: /channel_rm &lt;id&gt;\n\nWatching ${chs.length} channels.`;
    ctx.editMessageText(t, { parse_mode: 'HTML', ...back() });
  });

  // Paper submenu
  bot.action('sub_paper', ctx => {
    ctx.answerCbQuery();
    const pm = isPaperMode(ctx.from.id);
    ctx.editMessageText(`<b>🧪 Paper Trading</b>\nMode: ${pm?'ON':'OFF'}\n\n/paper on|off\n/paper_portfolio\n\nWhen ON, all buy/sell are simulated.`, { parse_mode: 'HTML', ...back() });
  });

  // Settings submenu
  bot.action('sub_settings', ctx => {
    ctx.answerCbQuery();
    const ch = getUserChain(ctx.from.id), pm = isPaperMode(ctx.from.id);
    ctx.editMessageText(
      `<b>⚙️ Settings</b>\n\nNetwork: ${CE[ch]} ${CL[ch]}\nMode: ${pm?'🧪 PAPER':'⚡ LIVE'}\n\nSubmenus: Network, Wallets, Paper\nUse /network /wallet /paper`,
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
      ctx.editMessageText(
        `<b>🎯 Strategy (Budget Manager)</b>

Set daily budget dan auto-trade rules.

/strategy set <daily_budget> <max_per_trade> <max_trades> <target_roi%> <stop_loss%>

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
      ctx.editMessageText(
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
/strategy set <budget> <max/trade> <trades> <roi> <sl>
/strategy reinvest on|off`,
        { parse_mode: 'HTML', ...back() }
      );
    }
  });
}