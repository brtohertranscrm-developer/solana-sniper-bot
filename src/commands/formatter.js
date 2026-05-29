import { scoreToken } from '../services/scanner.js';

const CHAIN_EMOJI = { solana: '◎', bsc: '🔶', eth: '⟠' };

export function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(2);
}

export function analyzeTokenForDisplay(token) {
  const score = scoreToken(token);
  const mc = parseFloat(token.marketCap || 0);
  const liq = parseFloat(token.liquidity || 0);
  const vol = parseFloat(token.volume_24h || 0);
  const holders = parseInt(token.holders || 0);
  const priceChange = parseFloat(token.priceChange24h || 0);

  const flags = [];
  if (liq > 0 && mc / liq > 10) flags.push('MC/Liq ratio tinggi');
  if (liq < 1000 && mc > 10000) flags.push('Liq rendah vs MC');
  if (vol > 0 && mc > 0) {
    const volToMc = (vol / mc * 100).toFixed(0);
    if (parseInt(volToMc) > 200) flags.push(`Volume ${volToMc}% dari MC`);
  }
  if (priceChange > 500) flags.push('Pump >500%');
  if (priceChange > 200) flags.push('Pump >200%');

  let decision = 'SKIP';
  let reason = '';

  if (score.grade === 'A+' || score.grade === 'A') {
    if (liq >= 2000 && holders >= 10 && priceChange < 500) {
      decision = 'BUY'; reason = 'Score tinggi, likuiditas cukup, momentum wajar';
    } else if (liq >= 5000 && holders >= 20) {
      decision = 'WATCH'; reason = 'Fundamental bagus, tunggu entry';
    } else {
      decision = 'CAUTION'; reason = 'Score tinggi tapi perlu dicek';
    }
  } else if (score.grade === 'B') {
    if (liq >= 5000 && holders >= 20 && vol >= 1000) {
      decision = 'WATCH'; reason = 'Potensial, perlu konfirmasi volume';
    } else {
      decision = 'SKIP'; reason = 'Data belum cukup kuat';
    }
  } else if (score.grade === 'C') {
    decision = 'SKIP'; reason = 'Score rendah, risk tinggi';
  } else {
    decision = 'SKIP'; reason = 'Tidak memenuhi kriteria';
  }

  if (liq < 500 && mc > 5000) {
    decision = 'DANGER'; reason = 'Likuiditas terlalu rendah untuk MC ini';
  }

  return { score, flags, decision, reason };
}

export function formatTokenCard(token, idx) {
  const { score, flags, decision, reason } = analyzeTokenForDisplay(token);
  const mc = parseFloat(token.marketCap || 0);
  const liq = parseFloat(token.liquidity || 0);
  const vol = parseFloat(token.volume_24h || 0);
  const holders = parseInt(token.holders || 0);
  const priceChange = parseFloat(token.priceChange24h || 0);

  const icon = { 'BUY': '🟢', 'WATCH': '🟡', 'SKIP': '⚪', 'CAUTION': '🟠', 'DANGER': '🔴' }[decision] || '⚪';

  let card = `${idx}. <b>${token.name} (${token.symbol})</b> [${score.grade}]\n`;
  card += `   ${icon} <b>${decision}</b>: ${reason}\n`;
  card += `   MC: $${formatNumber(mc)} | Liq: $${formatNumber(liq)} | Vol: $${formatNumber(vol)}\n`;
  if (priceChange) card += `   24h: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(1)}%\n`;
  card += `   Txns: ${holders} | Score: ${score.score}/${score.maxScore}`;
  if (flags.length) card += `\n   ⚠️ ${flags.join(' | ')}`;
  card += `\n   <a href="https://dexscreener.com/${token.chain || 'solana'}/${token.address}">Dexscreener</a> | /analyze_${token.address}`;
  card += '\n';
  return card;
}

export function formatScanHeader(chain, tokens) {
  let header = `${CHAIN_EMOJI[chain] || ''} Scan ${chain} - ${tokens.length} token\n`;
  header += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  const buys = tokens.filter(t => analyzeTokenForDisplay(t).decision === 'BUY').length;
  const watches = tokens.filter(t => analyzeTokenForDisplay(t).decision === 'WATCH').length;
  const dangers = tokens.filter(t => analyzeTokenForDisplay(t).decision === 'DANGER').length;
  header += `🟢 BUY: ${buys} | 🟡 WATCH: ${watches} | 🔴 DANGER: ${dangers} | ⚪ SKIP: ${tokens.length - buys - watches - dangers}\n\n`;
  return header;
}
