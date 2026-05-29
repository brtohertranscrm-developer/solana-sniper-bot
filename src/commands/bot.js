import { config } from '../config.js';
import { getTopTokens, getTokensByGrade, getToken, getStats } from '../utils/database.js';
import { getTokenOverview, analyzeHolders } from '../services/analyzer.js';
import { scanAllSources, scoreToken, fetchBirdeyeTrending, fetchDexscreenerNewPairs } from '../services/scanner.js';

export function setupCommands(bot) {
  // /start
  bot.start((ctx) => {
    ctx.reply(
      `Solana Token Scanner Bot v1.0\n\n` +
      `Commands:\n` +
      `/scan - Scan token baru sekarang\n` +
      `/top - Token dengan score tertinggi\n` +
      `/analyze [address] - Analisis detail token\n` +
      `/trending - Token trending\n` +
      `/stats - Statistik scanner\n` +
      `/help - Bantuan`
    );
  });

  // /help
  bot.help((ctx) => {
    ctx.reply(
      `Solana Token Scanner Bot\n\n` +
      `Phase 1: Scanner & Analyzer\n\n` +
      `Commands:\n` +
      `/scan - Manual scan token baru\n` +
      `/top [A+/A/B/C/D] - Top token by grade\n` +
      `/analyze <address> - Detail analisis token\n` +
      `/trending - Token trending\n` +
      `/stats - Statistik database\n` +
      `/help - Bantuan\n\n` +
      `Scoring:\n` +
      `A+ = Sangat potensial (10+)\n` +
      `A = Potensial (7-9)\n` +
      `B = Menarik (5-6)\n` +
      `C = Perlu perhatian (3-4)\n` +
      `D = Rendah (0-2)`
    );
  });

  // /scan - Manual scan
  bot.command('scan', async (ctx) => {
    const msg = await ctx.reply('Scanning...');
    try {
      const tokens = await scanAllSources();
      if (tokens.length === 0) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, 'Tidak ada token ditemukan.');
        return;
      }

      let text = `Scan selesai. ${tokens.length} token ditemukan:\n\n`;
      tokens.slice(0, 15).forEach((t, i) => {
        const score = scoreToken(t);
        text += `${i + 1}. ${t.name} (${t.symbol}) [${score.grade}]\n`;
        text += `   MC: $${parseFloat(t.marketCap || 0).toLocaleString()} | Liq: $${parseFloat(t.liquidity || 0).toLocaleString()} | Holders: ${t.holders}\n`;
        text += `   Source: ${t.source} | /analyze_${t.address}\n\n`;
      });

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, {
        disable_web_page_preview: true,
      });
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
      text += `${i + 1}. ${t.name} (${t.symbol}) [${t.grade}] Score: ${t.score}\n`;
      text += `   MC: $${t.market_cap.toLocaleString()} | Vol24h: $${t.volume_24h.toLocaleString()} | Risk: ${t.risk}\n`;
      text += `   /analyze_${t.address}\n\n`;
    });

    await ctx.reply(text, { disable_web_page_preview: true });
  });

  // /analyze
  bot.command('analyze', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    const address = parts[1] || '';

    if (!address) {
      return ctx.reply('Format: /analyze <token_address>');
    }

    const cleanAddress = address.replace(/^\/analyze_/, '');
    const msg = await ctx.reply(`Analyzing ${cleanAddress}...`);

    try {
      const [overview, holders] = await Promise.all([
        getTokenOverview(cleanAddress),
        analyzeHolders(cleanAddress),
      ]);

      let text = `Analysis Report\n`;
      text += `Address: ${cleanAddress.slice(0, 8)}...${cleanAddress.slice(-4)}\n\n`;

      if (overview) {
        text += `Symbol: ${overview.symbol || 'N/A'}\n`;
        text += `Price: $${parseFloat(overview.price || 0).toExponential(4)}\n`;
        text += `Market Cap: $${parseFloat(overview.mc || 0).toLocaleString()}\n`;
        text += `Volume 24h: $${parseFloat(overview.v24hUSD || 0).toLocaleString()}\n`;
        text += `Liquidity: $${parseFloat(overview.liquidity || 0).toLocaleString()}\n`;
        text += `Price 24h: ${overview.priceChange24h || 'N/A'}%\n`;
        text += `Price 6h: ${overview.priceChange6h || 'N/A'}%\n`;
        text += `Price 1h: ${overview.priceChange1h || 'N/A'}%\n`;
      } else {
        text += `Basic info: Data not available\n`;
      }

      text += `\nHolder Analysis:\n`;
      if (holders) {
        text += `Analyzed: ${holders.totalHolders} wallets\n`;
        text += `Top holder owns: ${holders.topHolderPct}%\n`;
        text += `Top 5 own: ${holders.top5Pct}%\n`;
        text += `Risk: ${holders.risk}\n\n`;
        text += `Top Holders:\n`;
        holders.holders.forEach((h, i) => {
          text += `  ${i + 1}. ${h.address.slice(0, 6)}...${h.address.slice(-4)} (${h.pct}%)\n`;
        });
      } else {
        text += `Not available (need Helius API key for full data)\n`;
      }

      text += `\nLinks:\n`;
      text += `Dexscreener: https://dexscreener.com/solana/${cleanAddress}\n`;
      text += `Solscan: https://solscan.io/token/${cleanAddress}\n`;

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, {
        disable_web_page_preview: true,
      });
    } catch (err) {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Error: ${err.message}`);
    }
  });

  // /trending
  bot.command('trending', async (ctx) => {
    const msg = await ctx.reply('Fetching trending tokens...');
    try {
      const [birdeye, dex] = await Promise.allSettled([
        fetchBirdeyeTrending(10),
        fetchDexscreenerNewPairs(10),
      ]);

      let text = `Trending Solana Tokens:\n\n`;
      let count = 0;

      if (birdeye.status === 'fulfilled') {
        birdeye.value.forEach((t, i) => {
          if (count >= 15) return;
          count++;
          const score = scoreToken(t);
          text += `${count}. ${t.name} (${t.symbol}) [${score.grade}]\n`;
          text += `   MC: $${parseFloat(t.marketCap || 0).toLocaleString()} | +${t.priceChange24h || 0}%\n`;
          text += `   Source: Birdeye | /analyze_${t.address}\n\n`;
        });
      }

      if (dex.status === 'fulfilled') {
        dex.value.forEach((t) => {
          if (count >= 15) return;
          count++;
          const score = scoreToken(t);
          text += `${count}. ${t.name} (${t.symbol}) [${score.grade}]\n`;
          text += `   MC: $${parseFloat(t.marketCap || 0).toLocaleString()} | Liq: $${parseFloat(t.liquidity || 0).toLocaleString()}\n`;
          text += `   Source: Dexscreener | /analyze_${t.address}\n\n`;
        });
      }

      if (count === 0) {
        text += 'Tidak ada trending token ditemukan.';
      }

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, {
        disable_web_page_preview: true,
      });
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

  // /clear
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
