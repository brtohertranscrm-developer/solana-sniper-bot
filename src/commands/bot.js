import { config } from '../config.js';
import {
  getTopTokens, getTokensByGrade, getUserChain, setUserChain, getStats,
} from '../utils/database.js';
import { getTokenOverview, analyzeHolders } from '../services/analyzer.js';
import { scanChain, scoreToken, fetchTrending } from '../services/scanner.js';
import {
  generateSolanaWallet, generateEVMWallet, getSavedWallets, saveWallet,
} from '../services/wallet.js';

const CHAIN_LABELS = {
  solana: 'Solana',
  bsc: 'BSC',
  eth: 'ETH',
};

const CHAIN_EMOJI = {
  solana: '◎',
  bsc: '🔶',
  eth: '⟠',
};

// ===== Inline Keyboards =====

function mainMenuKeyboard(userId) {
  const active = getUserChain(userId);
  return {
    reply_markup: {
      inline_keyboard: [
        // Row 1: Scanner
        [
          { text: '🔍 Scan Token Baru', callback_data: 'action_scan' },
          { text: '🔥 Trending', callback_data: 'action_trending' },
        ],
        // Row 2: Analysis
        [
          { text: '📊 Top Tokens', callback_data: 'action_top' },
          { text: '📈 Stats', callback_data: 'action_stats' },
        ],
        // Row 3: Wallet
        [
          { text: '💰 Generate Wallet', callback_data: 'action_wallet_menu' },
          { text: '🗂 My Wallets', callback_data: 'action_mywallets' },
        ],
        // Row 4: Network
        [{ text: `🌐 Network: ${CHAIN_EMOJI[active]} ${CHAIN_LABELS[active]}`, callback_data: 'action_network' }],
      ],
    },
  };
}

function networkKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: `${CHAIN_EMOJI.solana} Solana`, callback_data: 'chain_solana' },
          { text: `${CHAIN_EMOJI.bsc} BSC`, callback_data: 'chain_bsc' },
          { text: `${CHAIN_EMOJI.eth} ETH`, callback_data: 'chain_eth' },
        ],
        [{ text: '⬅️ Back to Menu', callback_data: 'action_menu' }],
      ],
    },
  };
}

function walletMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: `${CHAIN_EMOJI.solana} Solana`, callback_data: 'wallet_gen_solana' },
          { text: `${CHAIN_EMOJI.bsc} BSC`, callback_data: 'wallet_gen_bsc' },
          { text: `${CHAIN_EMOJI.eth} ETH`, callback_data: 'wallet_gen_eth' },
        ],
        [{ text: '⬅️ Back to Menu', callback_data: 'action_menu' }],
      ],
    },
  };
}

function topMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'A+', callback_data: 'top_A+' },
          { text: 'A', callback_data: 'top_A' },
          { text: 'B', callback_data: 'top_B' },
          { text: 'C', callback_data: 'top_C' },
          { text: 'D', callback_data: 'top_D' },
        ],
        [
          { text: '🏆 All Top', callback_data: 'top_all' },
        ],
        [{ text: '⬅️ Back to Menu', callback_data: 'action_menu' }],
      ],
    },
  };
}

function backToMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⬅️ Back to Menu', callback_data: 'action_menu' }],
      ],
    },
  };
}

// ===== Helper: send scan result =====
async function sendScanResult(ctx, chain, msg) {
  try {
    const tokens = await scanChain(chain);
    if (tokens.length === 0) {
      await ctx.editMessageText(`${CHAIN_EMOJI[chain]} Tidak ada token ditemukan di ${CHAIN_LABELS[chain]}.`, backToMenuKeyboard());
      return;
    }

    let text = `${CHAIN_EMOJI[chain]} Scan ${CHAIN_LABELS[chain]} - ${tokens.length} token:\n\n`;
    tokens.slice(0, 15).forEach((t, i) => {
      const score = scoreToken(t);
      text += `${i + 1}. ${t.name} (${t.symbol}) [${score.grade}]\n`;
      text += `   MC: $${parseFloat(t.marketCap || 0).toLocaleString()} | Liq: $${parseFloat(t.liquidity || 0).toLocaleString()} | Txns: ${t.holders}\n`;
      text += `   /analyze_${t.address}\n\n`;
    });

    await ctx.editMessageText(text, { ...backToMenuKeyboard(), disable_web_page_preview: true });
  } catch (err) {
    await ctx.editMessageText(`Error: ${err.message}`, backToMenuKeyboard());
  }
}

async function sendTrendingResult(ctx, chain) {
  try {
    const tokens = await fetchTrending(chain);

    let text = `${CHAIN_EMOJI[chain]} Trending ${CHAIN_LABELS[chain]}:\n\n`;
    tokens.slice(0, 15).forEach((t, i) => {
      const score = scoreToken(t);
      text += `${i + 1}. ${t.name} (${t.symbol}) [${score.grade}]\n`;
      text += `   MC: $${parseFloat(t.marketCap || 0).toLocaleString()} | +${parseFloat(t.priceChange24h || 0).toFixed(1)}%\n`;
      text += `   /analyze_${t.address}\n\n`;
    });

    if (tokens.length === 0) text += 'Tidak ada trending token.';

    await ctx.editMessageText(text, { ...backToMenuKeyboard(), disable_web_page_preview: true });
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
    text += `${i + 1}. ${t.name} (${t.symbol}) [${t.grade}] Score: ${t.score}\n`;
    text += `   MC: $${t.market_cap.toLocaleString()} | Vol: $${t.volume_24h.toLocaleString()} | Risk: ${t.risk}\n`;
    text += `   /analyze_${t.address}\n\n`;
  });

  await ctx.editMessageText(text, { ...backToMenuKeyboard(), disable_web_page_preview: true });
}

// ===== Setup All Commands =====

export function setupCommands(bot) {

  // /start & /menu -> main menu
  const sendMainMenu = (ctx) => {
    ctx.reply(
      `◎ Crypto Token Scanner Bot\nMulti-Chain: Solana | BSC | ETH\n\nPilih menu di bawah:`,
      mainMenuKeyboard(ctx.from.id)
    );
  };

  bot.start(sendMainMenu);
  bot.command('menu', sendMainMenu);

  // /help
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
      `Grades: A+(10+) | A(7-9) | B(5-6) | C(3-4) | D(0-2)`
    );
  });

  // ===== TEXT COMMANDS =====

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
      let text = `${CHAIN_EMOJI[chain]} Scan ${CHAIN_LABELS[chain]} - ${tokens.length} token:\n\n`;
      tokens.slice(0, 15).forEach((t, i) => {
        const score = scoreToken(t);
        text += `${i + 1}. ${t.name} (${t.symbol}) [${score.grade}]\n`;
        text += `   MC: $${parseFloat(t.marketCap || 0).toLocaleString()} | Liq: $${parseFloat(t.liquidity || 0).toLocaleString()} | Txns: ${t.holders}\n\n`;
      });
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { disable_web_page_preview: true });
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

      let text = `${CHAIN_EMOJI[chain]} Analysis Report - ${CHAIN_LABELS[chain]}\n`;
      text += `Address: ${clean.slice(0, 8)}...${clean.slice(-4)}\n\n`;
      if (overview) {
        text += `Symbol: ${overview.symbol || 'N/A'}\n`;
        text += `Price: $${parseFloat(overview.price || 0).toExponential(4)}\n`;
        text += `MC: $${parseFloat(overview.mc || 0).toLocaleString()}\n`;
        text += `Vol 24h: $${parseFloat(overview.v24hUSD || 0).toLocaleString()}\n`;
        text += `Liquidity: $${parseFloat(overview.liquidity || 0).toLocaleString()}\n`;
        text += `24h: ${overview.priceChange24h || 'N/A'}% | 6h: ${overview.priceChange6h || 'N/A'}% | 1h: ${overview.priceChange1h || 'N/A'}%\n`;
      } else {
        text += `Basic info: Data not available (Birdeye API key needed)\n`;
      }
      text += `\nHolder Analysis:\n`;
      if (holders) {
        text += `Analyzed: ${holders.totalHolders} wallets\nTop holder: ${holders.topHolderPct}%\nTop 5: ${holders.top5Pct}%\nRisk: ${holders.risk}\n\n`;
        text += `Top Holders:\n`;
        holders.holders.forEach((h, i) => {
          text += `  ${i + 1}. ${h.address.slice(0, 6)}...${h.address.slice(-4)} (${h.pct}%)\n`;
        });
      } else {
        text += `Not available (need Helius API key for Solana)\n`;
      }
      text += `\nDexscreener: https://dexscreener.com/${chain}/${clean}\n`;
      if (chain === 'solana') text += `Solscan: https://solscan.io/token/${clean}\n`;
      else if (chain === 'bsc') text += `BscScan: https://bscscan.com/token/${clean}\n`;
      else text += `Etherscan: https://etherscan.io/token/${clean}\n`;

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { disable_web_page_preview: true });
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
      let text = `${CHAIN_EMOJI[chain]} Trending ${CHAIN_LABELS[chain]}:\n\n`;
      tokens.slice(0, 15).forEach((t, i) => {
        const score = scoreToken(t);
        text += `${i + 1}. ${t.name} (${t.symbol}) [${score.grade}]\n`;
        text += `   MC: $${parseFloat(t.marketCap || 0).toLocaleString()} | +${parseFloat(t.priceChange24h || 0).toFixed(1)}%\n\n`;
      });
      if (tokens.length === 0) text += 'Tidak ada trending token.';
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { disable_web_page_preview: true });
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${err.message}`);
    }
  });

  // /wallet
  bot.command('wallet', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    let chain = (parts[1] || getUserChain(ctx.from.id)).toLowerCase();
    if (!CHAIN_LABELS[chain]) {
      return ctx.reply(`Format: /wallet [solana|bsc|eth]`, walletMenuKeyboard());
    }
    try {
      let wallet;
      if (chain === 'solana') {
        wallet = generateSolanaWallet();
      } else {
        wallet = generateEVMWallet();
        wallet.chain = chain;
      }
      saveWallet(wallet);
      let text = `${CHAIN_EMOJI[chain]} Wallet ${CHAIN_LABELS[chain]} Generated:\n\nAddress:\n${wallet.address}\n\nPrivate Key:\n${wallet.privateKey}\n`;
      if (wallet.mnemonic) text += `\nMnemonic (simpan baik-baik!):\n${wallet.mnemonic}`;
      text += `\n\nWallet tersimpan di database.`;
      await ctx.reply(text);
    } catch (err) {
      await ctx.reply(`Error: ${err.message}`);
    }
  });

  // /mywallets
  bot.command('mywallets', async (ctx) => {
    const wallets = getSavedWallets();
    if (wallets.length === 0) return ctx.reply('Belum ada wallet. Ketik /wallet untuk generate.');
    let text = `Saved Wallets:\n\n`;
    let prevChain = '';
    wallets.forEach((w) => {
      if (w.chain !== prevChain) {
        prevChain = w.chain;
        text += `${CHAIN_EMOJI[prevChain] || ''} ${CHAIN_LABELS[prevChain] || prevChain}:\n`;
      }
      text += `  #${w.id} | ${w.address.slice(0, 10)}...${w.address.slice(-6)}\n`;
    });
    await ctx.reply(text);
  });

  // /network
  bot.command('network', (ctx) => {
    ctx.reply('Pilih jaringan:', networkKeyboard());
  });

  // /stats
  bot.command('stats', async (ctx) => {
    const stats = getStats();
    let text = `Scanner Stats:\nTotal: ${stats.total}\n\nChain:\n`;
    stats.byChain.forEach(c => { text += `  ${CHAIN_LABELS[c.chain] || c.chain}: ${c.count}\n`; });
    text += `\nGrade:\n`;
    stats.byGrade.forEach(g => { text += `  ${g.grade}: ${g.count}\n`; });
    await ctx.reply(text);
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

  // Main menu
  bot.action('action_menu', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText(
      `◎ Crypto Token Scanner Bot\nMulti-Chain: Solana | BSC | ETH\n\nPilih menu di bawah:`,
      mainMenuKeyboard(ctx.from.id)
    );
  });

  // Scan
  bot.action('action_scan', (ctx) => {
    const chain = getUserChain(ctx.from.id);
    ctx.answerCbQuery();
    ctx.editMessageText(
      `${CHAIN_EMOJI[chain]} Scanning ${CHAIN_LABELS[chain]}...`,
      backToMenuKeyboard()
    );
    sendScanResult(ctx, chain);
  });

  // Trending
  bot.action('action_trending', (ctx) => {
    const chain = getUserChain(ctx.from.id);
    ctx.answerCbQuery();
    ctx.editMessageText(
      `${CHAIN_EMOJI[chain]} Fetching trending ${CHAIN_LABELS[chain]}...`,
      backToMenuKeyboard()
    );
    sendTrendingResult(ctx, chain);
  });

  // Top tokens
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

  // Stats
  bot.action('action_stats', (ctx) => {
    ctx.answerCbQuery();
    const stats = getStats();
    let text = `Scanner Stats:\nTotal: ${stats.total}\n\n`;
    text += `Chain:\n`;
    stats.byChain.forEach(c => { text += `  ${CHAIN_EMOJI[c.chain] || ''} ${CHAIN_LABELS[c.chain] || c.chain}: ${c.count}\n`; });
    text += `\nGrade:\n`;
    stats.byGrade.forEach(g => { text += `  ${g.grade}: ${g.count}\n`; });
    text += `\nSource:\n`;
    stats.bySource.forEach(s => { text += `  ${s.source}: ${s.count}\n`; });
    ctx.editMessageText(text, backToMenuKeyboard());
  });

  // Network selector
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

  // Wallet menu
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

      let text = `${CHAIN_EMOJI[chain]} Wallet ${CHAIN_LABELS[chain]} Generated:\n\nAddress:\n${wallet.address}\n\nPrivate Key:\n${wallet.privateKey}\n`;
      if (wallet.mnemonic) text += `\nMnemonic (simpan baik-baik!):\n${wallet.mnemonic}`;

      // Can't edit to include private key safely, send as new message
      await ctx.reply(text);
      ctx.editMessageText(`Wallet ${CHAIN_LABELS[chain]} sudah di-generate. Cek pesan di atas untuk private key.`, backToMenuKeyboard());
    } catch (err) {
      ctx.reply(`Error: ${err.message}`);
      ctx.editMessageText('Gagal generate wallet.', backToMenuKeyboard());
    }
  });

  // My wallets
  bot.action('action_mywallets', (ctx) => {
    ctx.answerCbQuery();
    const wallets = getSavedWallets();
    if (wallets.length === 0) {
      ctx.editMessageText('Belum ada wallet tersimpan.\nGenerate wallet dulu dari menu Wallet.', backToMenuKeyboard());
      return;
    }
    let text = 'Saved Wallets:\n\n';
    let prevChain = '';
    wallets.forEach((w) => {
      if (w.chain !== prevChain) {
        prevChain = w.chain;
        text += `${CHAIN_EMOJI[prevChain] || ''} ${CHAIN_LABELS[prevChain] || prevChain}:\n`;
      }
      text += `  #${w.id} | ${w.address.slice(0, 10)}...${w.address.slice(-6)}\n`;
    });
    ctx.editMessageText(text, backToMenuKeyboard());
  });
}
