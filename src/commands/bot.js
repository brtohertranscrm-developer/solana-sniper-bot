import { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { getTopTokens, getTokensByGrade, getFlaggedTokens, getToken, getStats } from '../utils/database.js';
import { getTokenOverview, analyzeHolders, getTokenTradeData } from '../services/analyzer.js';
import { fetchPumpfunNewTokens, fetchPumpfunTrending, scorePumpfunToken } from '../services/scanner.js';

export function setupCommands(bot) {
  // /start
  bot.start((ctx) => {
    ctx.reply(
      `Solana Token Scanner Bot v1.0\n\n` +
      `Perintah:\n` +
      `/scan - Scan token baru sekarang\n` +
      `/top - Token dengan score tertinggi\n` +
      `/analyze [address] - Analisis detail token\n` +
      `/trending - Token trending Pump.fun\n` +
      `/stats - Statistik scanner\n` +
      `/help - Bantuan`,
      { parse_mode: 'Markdown' }
    );
  });

  // /help
  bot.help((ctx) => {
    ctx.reply(
      `Solana Token Scanner Bot\n\n` +
      `Scanner & Analyzer Phase 1\n\n` +
      `Perintah:\n` +
      `/scan - Manual scan token baru\n` +
      `/top [A+/A/B/C/D] - Top token by grade\n` +
      `/analyze <token_address> - Detail analisis token\n` +
      `/trending - Token trending Pump.fun\n` +
      `/stats - Statistik database\n` +
      `/clear - Reset database\n\n` +
      `Scoring:\n` +
      `A+ = Sangat potensial (score 8+)\n` +
      `A = Potensial (6-7)\n` +
      `B = Menarik (4-5)\n` +
      `C = Perlu perhatian (3)\n` +
      `D = Rendah (0-2)`,
      { parse_mode: 'Markdown' }
    );
  });

  // /scan - Manual scan
  bot.command('scan', async (ctx) => {
    const msg = await ctx.reply('Scanning new tokens...');
    try {
      const tokens = await fetchPumpfunNewTokens(30);
      if (tokens.length === 0) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'Tidak ada token baru ditemukan.');
        return;
      }

      let text = `Scan selesai. ${tokens.length} token ditemukan:\n\n`;
      tokens.slice(0, 15).forEach((t, i) => {
        const name = t.name || 'Unknown';
        const symbol = t.symbol || '?';
        const mc = parseFloat(t.usd_market_cap || t.marketCap || 0);
        const holders = t.holder_count || t.holders || '?';
        text += `${i + 1}. ${name} (${symbol})\n`;
        text += `   MC: $${mc.toLocaleString()} | Holders: ${holders}\n`;
        text += `   /analyze_${t.mint || t.address}\n\n`;
      });

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text);
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${err.message}`);
    }
  });

  // /top - Top scored tokens
  bot.command('top', async (ctx) => {
    const grade = ctx.message.text.replace('/top', '').trim().toUpperCase();
    const tokens = grade ? getTokensByGrade(grade, 10) : getTopTokens(15);

    if (tokens.length === 0) {
      return ctx.reply(`Tidak ada token ${grade ? `grade ${grade}` : 'terdeteksi'} di database.`);
    }

    let text = `Top Tokens${grade ? ` (Grade ${grade})` : ''}:\n\n`;
    tokens.forEach((t, i) => {
      text += `${i + 1}. ${t.name} (${t.symbol}) [${t.grade}] - Score: ${t.score}\n`;
      text += `   MC: $${t.market_cap.toLocaleString()} | Vol24h: $${t.volume_24h.toLocaleString()} | Risk: ${t.risk}\n`;
      text += `   /analyze_${t.address}\n\n`;
    });

    await ctx.reply(text, { disable_web_page_preview: true });
  });

  // /analyze
  bot.command('analyze', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    const address = parts[1]?.startsWith('/') ? parts[1].replace('/analyze_', '') : parts[1];

    if (!address) {
      return ctx.reply('Format: /analyze <token_address>');
    }

    const msg = await ctx.reply(`Analyzing ${address}...`);

    try {
      const [overview, holders] = await Promise.all([
        getTokenOverview(address),
        analyzeHolders(address),
      ]);

      let text = `Analysis Report\n`;
      text += `Address: \`${address.slice(0, 8)}...${address.slice(-4)}\`\n\n`;

      if (overview) {
        text += `Name: ${overview.symbol || 'N/A'}\n`;
        text += `Price: $${parseFloat(overview.price || 0).toExponential(4)}\n`;
        text += `Market Cap: $${parseFloat(overview.mc || 0).toLocaleString()}\n`;
        text += `Volume 24h: $${parseFloat(overview.v24hUSD || 0).toLocaleString()}\n`;
        text += `Liquidity: $${parseFloat(overview.liquidity || 0).toLocaleString()}\n`;
        text += `Price 24h: ${overview.priceChange24h || 'N/A'}%\n`;
        text += `Price 6h: ${overview.priceChange6h || 'N/A'}%\n`;
        text += `Price 1h: ${overview.priceChange1h || 'N/A'}%\n`;
      } else {
        text += `Basic info: Data not available via Birdeye\n`;
      }

      text += `\nHolder Analysis:\n`;
      if (holders) {
        text += `Total analyzed: ${holders.totalHolders}\n`;
        text += `Top holder: ${holders.topHolderPct}%\n`;
        text += `Top 5 holders: ${holders.top5Pct}%\n`;
        text += `Risk level: ${holders.risk}\n\n`;
        text += `Top Holders:\n`;
        holders.holders.forEach((h, i) => {
          text += `  ${i + 1}. ${h.address.slice(0, 6)}...${h.address.slice(-4)} (${h.pct}%)\n`;
        });
      } else {
        text += `Data not available (Helius API key needed)\n`;
      }

      // SolanaFM / Dexscreener links
      text += `\nLinks:\n`;
      text += `Dexscreener: https://dexscreener.com/solana/${address}\n`;
      text += `Solscan: https://solscan.io/token/${address}\n`;

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${err.message}`);
    }
  });

  // /trending - Pump.fun trending
  bot.command('trending', async (ctx) => {
    const msg = await ctx.reply('Fetching trending tokens...');
    try {
      const tokens = await fetchPumpfunTrending(20);
      if (tokens.length === 0) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'Tidak ada trending token.');
        return;
      }

      let text = `Trending Pump.fun:\n\n`;
      tokens.forEach((t, i) => {
        const score = scorePumpfunToken(t);
        const mc = parseFloat(t.usd_market_cap || t.marketCap || 0);
        const vol = parseFloat(t.volume_24h || t.volume24h || 0);
        text += `${i + 1}. ${t.name} (${t.symbol}) [${score.grade}]\n`;
        text += `   MC: $${mc.toLocaleString()} | Vol: $${vol.toLocaleString()}\n`;
        text += `   Score: ${score.score}/${score.maxScore} (${score.breakdown.join(', ')})\n`;
        text += `   /analyze_${t.mint || t.address}\n\n`;
      });

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text);
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${err.message}`);
    }
  });

  // /stats
  bot.command('stats', async (ctx) => {
    const stats = getStats();
    let text = `Scanner Stats:\n`;
    text += `Total tokens: ${stats.total}\n\n`;
    text += `By Grade:\n`;
    stats.byGrade.forEach(g => {
      text += `  ${g.grade}: ${g.count}\n`;
    });
    text += `\nBy Source:\n`;
    stats.bySource.forEach(s => {
      text += `  ${s.source}: ${s.count}\n`;
    });
    await ctx.reply(text);
  });

  // /clear - Reset DB
  bot.command('clear', async (ctx) => {
    if (!config.adminIds.includes(ctx.from.id)) {
      return ctx.reply('Unauthorized');
    }
    const db = (await import('../utils/database.js')).default;
    db.exec('DELETE FROM scanned_tokens');
    db.exec('DELETE FROM alerts');
    await ctx.reply('Database cleared.');
  });

  // Handle callback queries for inline analyze buttons
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (data?.startsWith('analyze_')) {
      const address = data.replace('analyze_', '');
      ctx.answerCbQuery();
      // Forward to /analyze logic
      ctx.state.address = address;
      ctx.message = { text: `/analyze ${address}`, from: ctx.from, chat: ctx.callbackQuery.message.chat };
      // Re-use analyze command
      await bot.commands.get('analyze')({ ...ctx, reply: ctx.reply.bind(ctx), telegram: ctx.telegram });
    }
  });
}
