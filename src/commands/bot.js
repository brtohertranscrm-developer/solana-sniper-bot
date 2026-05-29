import { config } from '../config.js';
import {
  getTopTokens, getTokensByGrade, getUserChain, setUserChain, getStats,
} from '../utils/database.js';
import { getTokenOverview, analyzeHolders } from '../services/analyzer.js';
import { scanChain, scoreToken, fetchTrending } from '../services/scanner.js';
import {
  generateSolanaWallet, generateEVMWallet, getSavedWallets, saveWallet,
} from '../services/wallet.js';

const CHAIN_LABELS = { solana: 'Solana', bsc: 'BSC', eth: 'ETH' };
const CHAIN_EMOJI = { solana: '◎', bsc: '🔶', eth: '⟠' };

// ===== Inline Keyboards =====

function mainMenuKeyboard(userId) {
  const active = getUserChain(userId);
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔍 Scan Token Baru', callback_data: 'action_scan' },
          { text: '🔥 Trending', callback_data: 'action_trending' },
        ],
        [
          { text: '📊 Top Tokens', callback_data: 'action_top' },
          { text: '📈 Stats', callback_data: 'action_stats' },
        ],
        [
          { text: '💰 Generate Wallet', callback_data: 'action_wallet_menu' },
          { text: '🗂 My Wallets', callback_data: 'action_mywallets' },
        ],
        [{ text: `🌐 Network: ${CHAIN_EMOJI[active]} ${CHAIN_LABELS[active]}`, callback_data: 'action_network' }],
      ],
    },
  };
}

function networkKeyboard() {
  return {
    reply_markup: { inline_keyboard: [
      [
        { text: `${CHAIN_EMOJI.solana} Solana`, callback_data: 'chain_solana' },
        { text: `${CHAIN_EMOJI.bsc} BSC`, callback_data: 'chain_bsc' },
        { text: `${CHAIN_EMOJI.eth} ETH`, callback_data: 'chain_eth' },
      ],
      [{ text: '⬅️ Back to Menu', callback_data: 'action_menu' }],
    ]},
  };
}

function walletMenuKeyboard() {
  return {
    reply_markup: { inline_keyboard: [
      [
        { text: `${CHAIN_EMOJI.solana} Solana`, callback_data: 'wallet_gen_solana' },
        { text: `${CHAIN_EMOJI.bsc} BSC`, callback_data: 'wallet_gen_bsc' },
        { text: `${CHAIN_EMOJI.eth} ETH`, callback_data: 'wallet_gen_eth' },
      ],
      [{ text: '⬅️ Back to Menu', callback_data: 'action_menu' }],
    ]},
  };
}

function topMenuKeyboard() {
  return {
    reply_markup: { inline_keyboard: [
      [
        { text: 'A+', callback_data: 'top_A+' },
        { text: 'A', callback_data: 'top_A' },
        { text: 'B', callback_data: 'top_B' },
        { text: 'C', callback_data: 'top_C' },
        { text: 'D', callback_data: 'top_D' },
      ],
      [{ text: '🏆 All Top', callback_data: 'top_all' }],
      [{ text: '⬅️ Back to Menu', callback_data: 'action_menu' }],
    ]},
  };
}

function backToMenuKeyboard() {
  return {
    reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Menu', callback_data: 'action_menu' }]] },
  };
}

// ===== Token Analysis for Display =====

function analyzeTokenForDisplay(token) {
  const score = scoreToken(token);
  const mc = parseFloat(token.marketCap || 0);
  const liq = parseFloat(token.liquidity || 0);
  const vol = parseFloat(token.volume_24h || 0);
  const holders = parseInt(token.holders || 0);
  const priceChange = parseFloat(token.priceChange24h || 0);

  // Flags
  const flags = [];

  // Liquidity check
  if (liq > 0 && mc / liq > 10) flags.push('MC/Liq ratio tinggi');
  if (liq < 1000 && mc > 10000) flags.push('Liquidity rendah vs MC');

  // Volume check
  if (vol > 0 && mc > 0) {
    const volToMc = (vol / mc * 100).toFixed(0);
    if (parseInt(volToMc) > 200) flags.push(`Volume ${volToMc}% dari MC (aktif)`);
  }

  // Price momentum
  if (priceChange > 500) flags.push('Pump sangat tinggi (>500%)');
  if (priceChange > 200) flags.push('Pump kuat (>200%)');

  // Decision
  let decision = 'SKIP';
  let reason = '';

  if (score.grade === 'A+' || score.grade === 'A') {
    if (liq >= 2000 && holders >= 10 && priceChange < 500) {
      decision = 'BUY';
      reason = 'Score tinggi, likuiditas cukup, momentum masih wajar';
    } else if (liq >= 5000 && holders >= 20) {
      decision = 'WATCH';
      reason = 'Fundamental bagus, tunggu entry lebih baik';
    } else {
      decision = 'CAUTION';
      reason = 'Score tinggi tapi perlu cek lebih lanjut';
    }
  } else if (score.grade === 'B') {
    if (liq >= 5000 && holders >= 20 && vol >= 1000) {
      decision = 'WATCH';
      reason = 'Potensial, perlu konfirmasi volume';
    } else {
      decision = 'SKIP';
      reason = 'Data belum cukup kuat';
    }
  } else if (score.grade === 'C') {
    decision = 'SKIP';
    reason = 'Score rendah, risk tinggi';
  } else {
    decision = 'SKIP';
    reason = 'Tidak memenuhi kriteria minimal';
  }

  // Override: danger flags
  if (liq < 500 && mc > 5000) {
    decision = 'DANGER';
    reason = 'Likuiditas terlalu rendah untuk MC ini';
  }

  return { score, flags, decision, reason };
}

function formatTokenCard(token, idx) {
  const { score, flags, decision, reason } = analyzeTokenForDisplay(token);
  const mc = parseFloat(token.marketCap || 0);
  const liq = parseFloat(token.liquidity || 0);
  const vol = parseFloat(token.volume_24h || 0);
  const holders = parseInt(token.holders || 0);
  const priceChange = parseFloat(token.priceChange24h || 0);

  const decisionIcon = {
    'BUY': '🟢',
    'WATCH': '🟡',
    'SKIP': '⚪',
    'CAUTION': '🟠',
    'DANGER': '🔴',
  }[decision] || '⚪';

  let card = `${idx}. <b>${token.name} (${token.symbol})</b> [${score.grade}]\n`;
  card += `   ${decisionIcon} <b>${decision}</b>: ${reason}\n`;
  card += `   MC: $${formatNumber(mc)} | Liq: $${formatNumber(liq)} | Vol: $${formatNumber(vol)}\n`;
  if (priceChange) card += `   24h: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(1)}%\n`;
  card += `   Txns: ${holders} | Score: ${score.score}/${score.maxScore}`;

  if (flags.length > 0) {
    card += `\n   ⚠️ ${flags.join(' | ')}`;
  }

  card += `\n   <a href="https://dexscreener.com/${token.chain || 'solana'}/${token.address}">Dexscreener</a> | /analyze_${token.address}`;
  card += '\n';

  return card;
}

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(2);
}

function formatScanHeader(chain, tokens) {
  let header = `${CHAIN_EMOJI[chain]} Scan ${CHAIN_LABELS[chain]} - ${tokens.length} token ditemukan\n`;
  header += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Summary
  const buys = tokens.filter(t => analyzeTokenForDisplay(t).decision === 'BUY').length;
  const watches = tokens.filter(t => analyzeTokenForDisplay(t).decision === 'WATCH').length;
  const dangers = tokens.filter(t => analyzeTokenForDisplay(t).decision === 'DANGER').length;

  header += `🟢 BUY: ${buys} | 🟡 WATCH: ${watches} | 🔴 DANGER: ${dangers} | ⚪ SKIP: ${tokens.length - buys - watches - dangers}\n\n`;

  return header;
}

// ===== Scan Helpers =====

async function sendScanResult(ctx, chain) {
  try {
    const tokens = await scanChain(chain);
    if (tokens.length === 0) {
      await ctx.editMessageText(`${CHAIN_EMOJI[chain]} Tidak ada token ditemukan di ${CHAIN_LABELS[chain]}.`, backToMenuKeyboard());
      return;
    }

    // Sort: BUY first, then WATCH, then others by score desc
    tokens.sort((a, b) => {
      const da = analyzeTokenForDisplay(a).decision;
      const db_ = analyzeTokenForDisplay(b).decision;
      const order = { 'BUY': 0, 'WATCH': 1, 'CAUTION': 2, 'SKIP': 3, 'DANGER': 4 };
      if (order[da] !== order[db_]) return order[da] - order[db_];
      return scoreToken(b).score - scoreToken(a).score;
    });

    let text = formatScanHeader(chain, tokens);
    tokens.slice(0, 15).forEach((t, i) => {
      text += formatTokenCard(t, i + 1) + '\n';
    });

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...backToMenuKeyboard(), disable_web_page_preview: true });
  } catch (err) {
    await ctx.editMessageText(`Error: ${err.message}`, backToMenuKeyboard());
  }
}

async function sendTrendingResult(ctx, chain) {
  try {
    const tokens = await fetchTrending(chain);
    tokens.sort((a, b) => {
      const sa = scoreToken(a).score;
      const sb = scoreToken(b).score;
      return sb - sa;
    });

    let text = `${CHAIN_EMOJI[chain]} Trending ${CHAIN_LABELS[chain]}:\n\n`;
    tokens.slice(0, 15).forEach((t, i) => {
      text += formatTokenCard(t, i + 1) + '\n';
    });

    if (tokens.length === 0) text += 'Tidak ada trending token.';

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...backToMenuKeyboard(), disable_web_page_preview: true });
  } catch (err) {
    await ctx.editMessageText(`Error: ${err.message}`, backToMenuKeyboard());
  }
}

async function sendTopResult(ctx, chain, grade) {
  const tokens = grade === 'all'
    ? getTopTokens(chain, 15)
    : getTokensByGrade(chain, grade, 10);

  if (tokens.length === 0) {
    await ctx.editMessageText(`Tidak ada token ${grade === 'all' ? '' : `grade ${grade}`} di database.`, backToMenuKeyboard());
    return;
  }

  let text = `${CHAIN_EMOJI[chain]} Top Tokens${grade === 'all' ? '' : ` (${grade})`}:\n\n`;
  tokens.forEach((t, i) => {
    const { score, decision, reason } = analyzeTokenForDisplay(t);
    const decisionIcon = { 'BUY': '🟢', 'WATCH': '🟡', 'SKIP': '⚪', 'CAUTION': '🟠', 'DANGER': '🔴' }[decision] || '⚪';
    text += `${i + 1}. ${t.name} (${t.symbol}) [${t.grade}] ${decisionIcon} ${decision}\n`;
    text += `   MC: $${formatNumber(t.market_cap)} | Vol: $${formatNumber(t.volume_24h)} | Score: ${t.score}\n`;
    text += `   /analyze_${t.address}\n\n`;
  });

  await ctx.editMessageText(text, { parse_mode: 'HTML', ...backToMenuKeyboard(), disable_web_page_preview: true });
}

// ===== Setup All Commands =====

export function setupCommands(bot) {

  const sendMainMenu = (ctx) => {
    ctx.reply(
      `◎ Crypto Token Scanner Bot\nMulti-Chain: Solana | BSC | ETH\n\nPilih menu di bawah:`,
      mainMenuKeyboard(ctx.from.id)
    );
  };

  bot.start(sendMainMenu);
  bot.command('menu', sendMainMenu);

  bot.help((ctx) => {
    ctx.reply(
      `Crypto Token Scanner Bot\n\n` +
      `Menu Commands:\n` +
      `/menu atau /start - Buka menu utama\n` +
      `/scan - Scan token baru\n` +
      `/trending - Trending tokens\n` +
      `/top [grade] - Top tokens\n` +
      `/analyze <address> - Analisis detail\n` +
      `/wallet [chain] - Generate wallet\n` +
      `/mywallets - Lihat wallet tersimpan\n` +
      `/network - Ganti jaringan\n` +
      `/stats - Statistik\n\n` +
      `Grades: A+(10+) | A(7-9) | B(5-6) | C(3-4) | D(0-2)\n\n` +
      `Signals:\n` +
      `🟢 BUY - Cocok untuk beli\n` +
      `🟡 WATCH - Pantau dulu\n` +
      `🟠 CAUTION - Harus hati-hati\n` +
      `🔴 DANGER - Berbahaya, hindari\n` +
      `⚪ SKIP - Tidak memenuhi kriteria`
    );
  });

  // /scan
  bot.command('scan', async (ctx) => {
    const chain = getUserChain(ctx.from.id);
    const msg = await ctx.reply(`${CHAIN_EMOJI[chain]} Scanning ${CHAIN_LABELS[chain]}...`);
    try {
      const tokens = await scanChain(chain);
      if (tokens.length === 0) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'Tidak ada token ditemukan.');
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
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${err.message}`);
    }
  });

  // /top
  bot.command('top', async (ctx) => {
    const chain = getUserChain(ctx.from.id);
    const grade = ctx.message.text.replace('/top', '').trim().toUpperCase();
    sendTopResult({ ...ctx, editMessageText: (t, o) => ctx.reply(t, o) }, chain, grade || 'all');
  });

  // /analyze
  bot.command('analyze', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    const address = parts[1] || '';
    const chain = getUserChain(ctx.from.id);
    if (!address) return ctx.reply('Format: /analyze <token_address>');
    const clean = address.replace(/^\/analyze_/, '');
    const msg = await ctx.reply(`Analyzing ${clean}...`);
    try {
      const [overview, holders] = await Promise.all([
        getTokenOverview(clean),
        analyzeHolders(clean),
      ]);
      const decisionData = { decision: 'SKIP', reason: 'Insufficient data' };

      let text = `${CHAIN_EMOJI[chain]} <b>Analysis Report</b> - ${CHAIN_LABELS[chain]}\n`;
      text += `<code>${clean.slice(0, 12)}...${clean.slice(-6)}</code>\n\n`;

      if (overview) {
        text += `<b>${overview.symbol || 'N/A'}</b>\n`;
        text += `Price: $${parseFloat(overview.price || 0).toExponential(4)}\n`;
        text += `MC: $${formatNumber(parseFloat(overview.mc || 0))}\n`;
        text += `Vol 24h: $${formatNumber(parseFloat(overview.v24hUSD || 0))}\n`;
        text += `Liquidity: $${formatNumber(parseFloat(overview.liquidity || 0))}\n`;
        text += `24h: ${overview.priceChange24h || 'N/A'}% | 6h: ${overview.priceChange6h || 'N/A'}% | 1h: ${overview.priceChange1h || 'N/A'}%\n`;
      } else {
        text += `Basic info: Data not available\n`;
      }

      text += `\n<b>Holder Analysis:</b>\n`;
      if (holders) {
        text += `Analyzed: ${holders.totalHolders} wallets\n`;
        text += `Top holder: ${holders.topHolderPct}%\n`;
        text += `Top 5: ${holders.top5Pct}%\n`;
        text += `Risk: ${holders.risk}\n\n`;
        text += `<b>Top Holders:</b>\n`;
        holders.holders.forEach((h, i) => {
          text += `  ${i + 1}. <code>${h.address.slice(0, 8)}...${h.address.slice(-4)}</code> (${h.pct}%)\n`;
        });
      } else {
        text += `Not available (need Helius API key)\n`;
      }

      text += `\n<a href="https://dexscreener.com/${chain}/${clean}">Dexscreener</a>\n`;
      if (chain === 'solana') text += `<a href="https://solscan.io/token/${clean}">Solscan</a>`;
      else if (chain === 'bsc') text += `<a href="https://bscscan.com/token/${clean}">BscScan</a>`;
      else text += `<a href="https://etherscan.io/token/${clean}">Etherscan</a>`;

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${err.message}`);
    }
  });

  // /trending
  bot.command('trending', async (ctx) => {
    const chain = getUserChain(ctx.from.id);
    const msg = await ctx.reply(`${CHAIN_EMOJI[chain]} Fetching trending...`);
    try {
      const tokens = await fetchTrending(chain);
      tokens.sort((a, b) => scoreToken(b).score - scoreToken(a).score);
      let text = formatScanHeader(chain, tokens);
      tokens.slice(0, 15).forEach((t, i) => { text += formatTokenCard(t, i + 1) + '\n'; });
      if (tokens.length === 0) text += 'Tidak ada trending token.';
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
      if (chain === 'solana') {
        wallet = generateSolanaWallet();
      } else {
        wallet = generateEVMWallet();
        wallet.chain = chain;
      }
      saveWallet(wallet);
      let text = `${CHAIN_EMOJI[chain]} <b>Wallet ${CHAIN_LABELS[chain]} Generated</b>\n\n`;
      text += `Address:\n<code>${wallet.address}</code>\n\n`;
      text += `Private Key:\n<code>${wallet.privateKey}</code>\n`;
      if (wallet.mnemonic) text += `\n<b>Mnemonic</b> (simpan baik-baik!):\n<code>${wallet.mnemonic}</code>`;
      text += `\n\nWallet tersimpan di database.`;
      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`Error: ${err.message}`);
    }
  });

  // /mywallets
  bot.command('mywallets', async (ctx) => {
    const wallets = getSavedWallets();
    if (wallets.length === 0) return ctx.reply('Belum ada wallet. Ketik /wallet untuk generate.');
    let text = '<b>Saved Wallets:</b>\n\n';
    let prevChain = '';
    wallets.forEach((w) => {
      if (w.chain !== prevChain) {
        prevChain = w.chain;
        text += `${CHAIN_EMOJI[prevChain]} ${CHAIN_LABELS[prevChain]}:\n`;
      }
      text += `  #${w.id} | <code>${w.address}</code>\n`;
    });
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // /network
  bot.command('network', (ctx) => ctx.reply('Pilih jaringan:', networkKeyboard()));

  // /stats
  bot.command('stats', async (ctx) => {
    const stats = getStats();
    let text = `<b>Scanner Stats</b>\nTotal: ${stats.total}\n\n`;
    text += `Chain:\n`;
    stats.byChain.forEach(c => { text += `  ${CHAIN_EMOJI[c.chain] || ''} ${CHAIN_LABELS[c.chain] || c.chain}: ${c.count}\n`; });
    text += `\nGrade:\n`;
    stats.byGrade.forEach(g => { text += `  ${g.grade}: ${g.count}\n`; });
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // /clear
  bot.command('clear', async (ctx) => {
    if (!config.adminIds.includes(ctx.from.id)) return ctx.reply('Unauthorized');
    const db = (await import('../utils/database.js')).default;
    db.exec('DELETE FROM scanned_tokens');
    db.exec('DELETE FROM alerts');
    await ctx.reply('Database cleared.');
  });

  // ===== CALLBACK QUERY HANDLERS =====

  bot.action('action_menu', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText(
      `◎ Crypto Token Scanner Bot\nMulti-Chain: Solana | BSC | ETH\n\nPilih menu di bawah:`,
      mainMenuKeyboard(ctx.from.id)
    );
  });

  bot.action('action_scan', (ctx) => {
    const chain = getUserChain(ctx.from.id);
    ctx.answerCbQuery();
    ctx.editMessageText(`${CHAIN_EMOJI[chain]} Scanning ${CHAIN_LABELS[chain]}...`, backToMenuKeyboard());
    sendScanResult(ctx, chain);
  });

  bot.action('action_trending', (ctx) => {
    const chain = getUserChain(ctx.from.id);
    ctx.answerCbQuery();
    ctx.editMessageText(`${CHAIN_EMOJI[chain]} Fetching trending ${CHAIN_LABELS[chain]}...`, backToMenuKeyboard());
    sendTrendingResult(ctx, chain);
  });

  bot.action('action_top', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText(
      `Pilih grade token:\n\nA+ = Sangat potensial (10+)\nA = Potensial (7-9)\nB = Menarik (5-6)\nC = Perlu perhatian (3-4)\nD = Rendah (0-2)`,
      topMenuKeyboard()
    );
  });

  bot.action(/^top_(.+)$/, (ctx) => {
    const grade = ctx.match[1] === 'all' ? 'all' : ctx.match[1];
    const chain = getUserChain(ctx.from.id);
    ctx.answerCbQuery();
    sendTopResult(ctx, chain, grade);
  });

  bot.action('action_stats', (ctx) => {
    ctx.answerCbQuery();
    const stats = getStats();
    let text = `<b>Scanner Stats</b>\nTotal: ${stats.total}\n\nChain:\n`;
    stats.byChain.forEach(c => { text += `  ${CHAIN_EMOJI[c.chain] || ''} ${CHAIN_LABELS[c.chain] || c.chain}: ${c.count}\n`; });
    text += `\nGrade:\n`;
    stats.byGrade.forEach(g => { text += `  ${g.grade}: ${g.count}\n`; });
    text += `\nSource:\n`;
    stats.bySource.forEach(s => { text += `  ${s.source}: ${s.count}\n`; });
    ctx.editMessageText(text, { parse_mode: 'HTML', ...backToMenuKeyboard() });
  });

  bot.action('action_network', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText('Pilih jaringan:', networkKeyboard());
  });

  bot.action(/^chain_(solana|bsc|eth)$/, (ctx) => {
    const chain = ctx.match[1];
    setUserChain(ctx.from.id, chain);
    ctx.answerCbQuery(`Switched to ${CHAIN_LABELS[chain]}`);
    ctx.editMessageText(
      `Jaringan aktif: ${CHAIN_EMOJI[chain]} ${CHAIN_LABELS[chain]}\n\nSemua scan & analyze akan pakai ${CHAIN_LABELS[chain]}.`,
      mainMenuKeyboard(ctx.from.id)
    );
  });

  bot.action('action_wallet_menu', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText('Pilih chain untuk generate wallet:', walletMenuKeyboard());
  });

  bot.action(/^wallet_gen_(solana|bsc|eth)$/, async (ctx) => {
    const chain = ctx.match[1];
    ctx.answerCbQuery();
    try {
      let wallet;
      if (chain === 'solana') {
        wallet = generateSolanaWallet();
      } else {
        wallet = generateEVMWallet();
        wallet.chain = chain;
      }
      saveWallet(wallet);
      let text = `${CHAIN_EMOJI[chain]} <b>Wallet ${CHAIN_LABELS[chain]}</b>\n\n`;
      text += `Address:\n<code>${wallet.address}</code>\n\n`;
      text += `Private Key:\n<code>${wallet.privateKey}</code>\n`;
      if (wallet.mnemonic) text += `\n<b>Mnemonic</b>:\n<code>${wallet.mnemonic}</code>`;
      await ctx.reply(text, { parse_mode: 'HTML' });
      ctx.editMessageText(`Wallet ${CHAIN_LABELS[chain]} sudah di-generate. Cek pesan di atas.`, backToMenuKeyboard());
    } catch (err) {
      ctx.reply(`Error: ${err.message}`);
      ctx.editMessageText('Gagal generate wallet.', backToMenuKeyboard());
    }
  });

  bot.action('action_mywallets', (ctx) => {
    ctx.answerCbQuery();
    const wallets = getSavedWallets();
    if (wallets.length === 0) {
      ctx.editMessageText('Belum ada wallet. Generate dulu dari menu Wallet.', backToMenuKeyboard());
      return;
    }
    let text = '<b>Saved Wallets:</b>\n\n';
    let prevChain = '';
    wallets.forEach((w) => {
      if (w.chain !== prevChain) { prevChain = w.chain; text += `${CHAIN_EMOJI[prevChain]} ${CHAIN_LABELS[prevChain]}:\n`; }
      text += `  #${w.id} | <code>${w.address}</code>\n`;
    });
    ctx.editMessageText(text, { parse_mode: 'HTML', ...backToMenuKeyboard() });
  });
}
