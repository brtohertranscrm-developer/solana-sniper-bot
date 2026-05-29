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

function networkKeyboard(userId) {
  const active = getUserChain(userId);
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: `${CHAIN_EMOJI.solana} Solana`, callback_data: `chain_solana`, },
          { text: `${CHAIN_EMOJI.bsc} BSC`, callback_data: `chain_bsc`, },
          { text: `${CHAIN_EMOJI.eth} ETH`, callback_data: `chain_eth`, },
        ],
      ],
    },
  };
}

function chainKeyboard(chain) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: `${CHAIN_EMOJI.solana} Solana`, callback_data: `chain_solana`, },
          { text: `${CHAIN_EMOJI.bsc} BSC`, callback_data: `chain_bsc`, },
          { text: `${CHAIN_EMOJI.eth} ETH`, callback_data: `chain_eth`, },
        ],
      ],
    },
  };
}

export function setupCommands(bot) {
  // ===== /start =====
  bot.start((ctx) => {
    ctx.reply(
      `Solana Token Scanner Bot v1.1\nMulti-Chain Support\n\n` +
      `Commands:\n` +
      `/scan - Scan token baru\n` +
      `/top - Top scored tokens\n` +
      `/analyze [address] - Analisis detail token\n` +
      `/trending - Token trending\n` +
      `/wallet - Generate wallet\n` +
      `/network - Ganti jaringan\n` +
      `/stats - Statistik scanner\n` +
      `/help - Bantuan`,
      networkKeyboard(ctx.from.id)
    );
  });

  // ===== /help =====
  bot.help((ctx) => {
    ctx.reply(
      `Solana Token Scanner Bot v1.1\n\n` +
      `Multi-Chain: Solana | BSC | ETH\n\n` +
      `Commands:\n` +
      `/scan - Manual scan token baru\n` +
      `/top [grade] - Top token by grade\n` +
      `/analyze <address> - Detail analisis\n` +
      `/trending - Token trending\n` +
      `/wallet [solana|bsc|eth] - Generate wallet\n` +
      `/mywallets - Lihat wallet tersimpan\n` +
      `/network - Ganti jaringan aktif\n` +
      `/stats - Statistik database\n\n` +
      `Scoring: A+(10+) | A(7-9) | B(5-6) | C(3-4) | D(0-2)`,
      networkKeyboard(ctx.from.id)
    );
  });

  // ===== /network - Switch network =====
  bot.command('network', (ctx) => {
    const active = getUserChain(ctx.from.id);
    ctx.reply(
      `Pilih jaringan aktif:\n\nSaat ini: ${CHAIN_EMOJI[active]} ${CHAIN_LABELS[active]}`,
      networkKeyboard(ctx.from.id)
    );
  });

  // ===== Callback: network switch =====
  bot.action(/^chain_(solana|bsc|eth)$/, (ctx) => {
    const chain = ctx.match[1];
    setUserChain(ctx.from.id, chain);
    ctx.answerCbQuery(`Switched to ${CHAIN_LABELS[chain]}`);
    ctx.editMessageText(
      `Jaringan aktif: ${CHAIN_EMOJI[chain]} ${CHAIN_LABELS[chain]}\n\n` +
      `Ketik /scan untuk scan ${CHAIN_LABELS[chain]}\nKetik /help untuk semua perintah`,
      chainKeyboard(chain)
    );
  });

  // ===== /scan =====
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
        text += `   MC: $${parseFloat(t.marketCap || 0).toLocaleString()} | Liq: $${parseFloat(t.liquidity || 0).toLocaleString()} | Txns: ${t.holders}\n`;
        text += `   /analyze_${t.address}\n\n`;
      });

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, {
        disable_web_page_preview: true,
      });
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${err.message}`);
    }
  });

  // ===== /top =====
  bot.command('top', async (ctx) => {
    const chain = getUserChain(ctx.from.id);
    const grade = ctx.message.text.replace('/top', '').trim().toUpperCase();
    const tokens = grade ? getTokensByGrade(chain, grade, 10) : getTopTokens(chain, 15);

    if (tokens.length === 0) {
      return ctx.reply(`Tidak ada token ${grade ? `grade ${grade}` : 'terdeteksi'} di database.`);
    }

    let text = `${CHAIN_EMOJI[chain]} Top Tokens ${CHAIN_LABELS[chain]}${grade ? ` (${grade})` : ''}:\n\n`;
    tokens.forEach((t, i) => {
      text += `${i + 1}. ${t.name} (${t.symbol}) [${t.grade}] Score: ${t.score}\n`;
      text += `   MC: $${t.market_cap.toLocaleString()} | Vol: $${t.volume_24h.toLocaleString()} | Risk: ${t.risk}\n`;
      text += `   /analyze_${t.address}\n\n`;
    });

    await ctx.reply(text, { disable_web_page_preview: true });
  });

  // ===== /analyze =====
  bot.command('analyze', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    const address = parts[1] || '';
    const chain = getUserChain(ctx.from.id);

    if (!address) {
      return ctx.reply('Format: /analyze <token_address>', chainKeyboard(chain));
    }

    const cleanAddress = address.replace(/^\/analyze_/, '');
    const msg = await ctx.reply(`Analyzing ${cleanAddress}...`);

    try {
      const [overview, holders] = await Promise.all([
        getTokenOverview(cleanAddress),
        analyzeHolders(cleanAddress),
      ]);

      let text = `${CHAIN_EMOJI[chain]} Analysis Report - ${CHAIN_LABELS[chain]}\n`;
      text += `Address: ${cleanAddress.slice(0, 8)}...${cleanAddress.slice(-4)}\n\n`;

      if (overview) {
        text += `Symbol: ${overview.symbol || 'N/A'}\n`;
        text += `Price: $${parseFloat(overview.price || 0).toExponential(4)}\n`;
        text += `Market Cap: $${parseFloat(overview.mc || 0).toLocaleString()}\n`;
        text += `Volume 24h: $${parseFloat(overview.v24hUSD || 0).toLocaleString()}\n`;
        text += `Liquidity: $${parseFloat(overview.liquidity || 0).toLocaleString()}\n`;
        text += `24h: ${overview.priceChange24h || 'N/A'}% | 6h: ${overview.priceChange6h || 'N/A'}% | 1h: ${overview.priceChange1h || 'N/A'}%\n`;
      } else {
        text += `Basic info: Data not available (Birdeye API key needed)\n`;
      }

      text += `\nHolder Analysis:\n`;
      if (holders) {
        text += `Analyzed: ${holders.totalHolders} wallets\n`;
        text += `Top holder: ${holders.topHolderPct}%\n`;
        text += `Top 5: ${holders.top5Pct}%\n`;
        text += `Risk: ${holders.risk}\n\n`;
        text += `Top Holders:\n`;
        holders.holders.forEach((h, i) => {
          text += `  ${i + 1}. ${h.address.slice(0, 6)}...${h.address.slice(-4)} (${h.pct}%)\n`;
        });
      } else {
        text += `Not available (Helius API key needed for Solana holders)\n`;
      }

      text += `\nLinks:\n`;
      text += `Dexscreener: https://dexscreener.com/${chain}/${cleanAddress}\n`;
      if (chain === 'solana') {
        text += `Solscan: https://solscan.io/token/${cleanAddress}\n`;
      } else if (chain === 'bsc') {
        text += `BscScan: https://bscscan.com/token/${cleanAddress}\n`;
      } else {
        text += `Etherscan: https://etherscan.io/token/${cleanAddress}\n`;
      }

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, {
        disable_web_page_preview: true,
      });
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${err.message}`);
    }
  });

  // ===== /trending =====
  bot.command('trending', async (ctx) => {
    const chain = getUserChain(ctx.from.id);
    const msg = await ctx.reply(`${CHAIN_EMOJI[chain]} Fetching trending ${CHAIN_LABELS[chain]}...`);

    try {
      const tokens = await fetchTrending(chain);

      let text = `${CHAIN_EMOJI[chain]} Trending ${CHAIN_LABELS[chain]}:\n\n`;
      tokens.slice(0, 15).forEach((t, i) => {
        const score = scoreToken(t);
        text += `${i + 1}. ${t.name} (${t.symbol}) [${score.grade}]\n`;
        text += `   MC: $${parseFloat(t.marketCap || 0).toLocaleString()} | +${parseFloat(t.priceChange24h || 0).toFixed(1)}%\n`;
        text += `   /analyze_${t.address}\n\n`;
      });

      if (tokens.length === 0) {
        text += 'Tidak ada trending token ditemukan.';
      }

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, {
        disable_web_page_preview: true,
      });
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${err.message}`);
    }
  });

  // ===== /wallet - Generate wallet =====
  bot.command('wallet', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    let chain = (parts[1] || getUserChain(ctx.from.id)).toLowerCase();

    if (!CHAIN_LABELS[chain]) {
      return ctx.reply(
        `Format: /wallet [solana|bsc|eth]\n\n${CHAIN_EMOJI.solana} Solana\n${CHAIN_EMOJI.bsc} BSC\n${CHAIN_EMOJI.eth} ETH\n\nWallet BSC & ETH sama (EVM compatible)`,
        networkKeyboard(ctx.from.id)
      );
    }

    try {
      let wallet;
      if (chain === 'solana') {
        wallet = generateSolanaWallet();
      } else {
        wallet = generateEVMWallet();
        wallet.chain = chain;
      }

      // Save to DB
      saveWallet(wallet);

      let text = `${CHAIN_EMOJI[chain]} Wallet ${CHAIN_LABELS[chain]} Generated:\n\n`;
      text += `Address:\n${wallet.address}\n\n`;
      text += `Private Key:\n${wallet.privateKey}\n`;
      if (wallet.mnemonic) {
        text += `\nMnemonic (simpan baik-baik!):\n${wallet.mnemonic}`;
      }

      text += `\n\nWallet sudah disimpan di database.`;

      await ctx.reply(text);
    } catch (err) {
      await ctx.reply(`Error: ${err.message}`);
    }
  });

  // ===== /mywallets =====
  bot.command('mywallets', async (ctx) => {
    const wallets = getSavedWallets();

    if (wallets.length === 0) {
      return ctx.reply('Belum ada wallet tersimpan.\nKetik /wallet untuk generate.');
    }

    let text = `Saved Wallets:\n\n`;
    let prevChain = '';

    wallets.forEach((w, i) => {
      if (w.chain !== prevChain) {
        prevChain = w.chain;
        text += `${CHAIN_EMOJI[prevChain] || ''} ${CHAIN_LABELS[prevChain] || prevChain}:\n`;
      }
      text += `  ${w.label || `#${w.id}`} | ${w.address.slice(0, 10)}...${w.address.slice(-6)}\n`;
    });

    await ctx.reply(text);
  });

  // ===== /stats =====
  bot.command('stats', async (ctx) => {
    const stats = getStats();
    let text = `Scanner Stats:\n`;
    text += `Total tokens: ${stats.total}\n\n`;
    text += `By Chain:\n`;
    stats.byChain.forEach(c => {
      text += `  ${CHAIN_LABELS[c.chain] || c.chain}: ${c.count}\n`;
    });
    text += `\nBy Grade:\n`;
    stats.byGrade.forEach(g => {
      text += `  ${g.grade}: ${g.count}\n`;
    });
    text += `\nBy Source:\n`;
    stats.bySource.forEach(s => {
      text += `  ${s.source}: ${s.count}\n`;
    });
    await ctx.reply(text);
  });

  // ===== /clear =====
  bot.command('clear', async (ctx) => {
    if (!config.adminIds.includes(ctx.from.id)) {
      return ctx.reply('Unauthorized');
    }
    const db = (await import('../utils/database.js')).default;
    db.exec('DELETE FROM scanned_tokens');
    db.exec('DELETE FROM alerts');
    await ctx.reply('Database cleared.');
  });
}
