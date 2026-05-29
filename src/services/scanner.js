import axios from 'axios';
import { config } from '../config.js';

const BIRDEYE_BASE = 'https://public-api.birdeye.so';
const DEXSCREENER_BASE = 'https://api.dexscreener.com';

const birdeyeHeaders = config.birdeyeApiKey
  ? { 'X-API-KEY': config.birdeyeApiKey }
  : { 'X-API-KEY': 'public' };

/**
 * Fetch top gainers / newest tokens from Birdeye
 */
export async function fetchBirdeyeNewTokens(limit = 20) {
  try {
    const res = await axios.get(`${BIRDEYE_BASE}/defi/tokenlist`, {
      params: {
        chain_id: 'solana',
        sort_by: 'v24hUSD',
        sort_type: 'desc',
        offset: 0,
        limit,
      },
      headers: birdeyeHeaders,
      timeout: 15000,
    });
    
    if (!res.data?.success) {
      console.error('[Birdeye] API returned unsuccessful:', res.data?.message);
      return [];
    }
    
    return (res.data.data || []).map(t => ({
      address: t.address,
      name: t.name,
      symbol: t.symbol,
      marketCap: t.mc || 0,
      volume_24h: t.v24hUSD || 0,
      price: t.price || 0,
      priceChange24h: t.priceChange24h || 0,
      priceChange6h: t.priceChange6h || 0,
      priceChange1h: t.priceChange1h || 0,
      liquidity: t.liquidity || 0,
      holders: t.holder || 0,
    }));
  } catch (err) {
    console.error('[Birdeye] Failed to fetch new tokens:', err.message);
    return [];
  }
}

/**
 * Fetch trending tokens from Birdeye (top gainers)
 */
export async function fetchBirdeyeTrending(limit = 20) {
  try {
    const res = await axios.get(`${BIRDEYE_BASE}/defi/tokenlist`, {
      params: {
        chain_id: 'solana',
        sort_by: 'priceChange24h',
        sort_type: 'desc',
        offset: 0,
        limit,
      },
      headers: birdeyeHeaders,
      timeout: 15000,
    });

    if (!res.data?.success) return [];

    return (res.data.data || []).map(t => ({
      address: t.address,
      name: t.name,
      symbol: t.symbol,
      marketCap: t.mc || 0,
      volume_24h: t.v24hUSD || 0,
      price: t.price || 0,
      priceChange24h: t.priceChange24h || 0,
      liquidity: t.liquidity || 0,
      holders: t.holder || 0,
    }));
  } catch (err) {
    console.error('[Birdeye] Failed to fetch trending:', err.message);
    return [];
  }
}

/**
 * Fetch newly launched pairs from Dexscreener (Solana)
 */
export async function fetchDexscreenerNewPairs(limit = 30) {
  try {
    const res = await axios.get(`${DEXSCREENER_BASE}/token-boosts/latest/v1`, {
      params: { chainId: 'solana' },
      timeout: 15000,
    });

    return (res.data || []).slice(0, limit).map(t => ({
      address: t.tokenAddress || t.address,
      name: t.description || t.token?.name || 'Unknown',
      symbol: t.token?.symbol || '?',
      marketCap: parseFloat(t.marketCap || t.fdv || 0),
      volume_24h: parseFloat(t.volume || t.volume24h || 0),
      price: parseFloat(t.price || 0),
      liquidity: parseFloat(t.liquidity || 0),
      holders: parseInt(t.txns?.buys || 0) + parseInt(t.txns?.sells || 0),
      source: 'dexscreener',
    }));
  } catch (err) {
    console.error('[Dexscreener] Failed to fetch new pairs:', err.message);
    return [];
  }
}

/**
 * Search Dexscreener for specific token
 */
export async function searchDexscreener(query) {
  try {
    const res = await axios.get(`${DEXSCREENER_BASE}/latest/dex/search`, {
      params: { q: query },
      timeout: 10000,
    });
    return (res.data?.pairs || []).filter(p => p.chainId === 'solana').slice(0, 10);
  } catch {
    return [];
  }
}

/**
 * Score a token based on available metrics
 */
export function scoreToken(token) {
  let score = 0;
  const breakdown = [];

  // Market cap tiers
  const mc = parseFloat(token.marketCap || 0);
  if (mc > 1000) { score += 1; breakdown.push('MC>$1K'); }
  if (mc > 10000) { score += 1; breakdown.push('MC>$10K'); }
  if (mc > 50000) { score += 1; breakdown.push('MC>$50K'); }
  if (mc > 500000) { score += 1; breakdown.push('MC>$500K'); }

  // Liquidity (important for safety)
  const liq = parseFloat(token.liquidity || 0);
  if (liq > 2000) { score += 1; breakdown.push('Liq>$2K'); }
  if (liq > 10000) { score += 1; breakdown.push('Liq>$10K'); }

  // Holders / transactions
  const holders = parseInt(token.holders || 0);
  if (holders > 10) { score += 1; breakdown.push('Holders>10'); }
  if (holders > 50) { score += 1; breakdown.push('Holders>50'); }

  // Volume
  const vol = parseFloat(token.volume_24h || 0);
  if (vol > 500) { score += 1; breakdown.push('Vol>$500'); }
  if (vol > 5000) { score += 1; breakdown.push('Vol>$5K'); }

  // Price momentum
  const priceChange = parseFloat(token.priceChange24h || 0);
  if (priceChange > 50) { score += 1; breakdown.push('+50%'); }
  if (priceChange > 200) { score += 1; breakdown.push('+200%'); }

  // Risk flag: if MC too high vs liquidity (potential no liquidity)
  if (mc > 0 && liq > 0 && mc / liq > 20) {
    score -= 2;
    breakdown.push('RISK:highMC/Liq');
  }

  score = Math.max(0, score);

  return {
    score,
    maxScore: 12,
    breakdown,
    grade: score >= 10 ? 'A+' : score >= 7 ? 'A' : score >= 5 ? 'B' : score >= 3 ? 'C' : 'D',
  };
}

/**
 * Unified scan - combines multiple sources
 */
export async function scanAllSources() {
  const [birdeyeTokens, dexPairs] = await Promise.allSettled([
    fetchBirdeyeTrending(20),
    fetchDexscreenerNewPairs(20),
  ]);

  const allTokens = [];

  if (birdeyeTokens.status === 'fulfilled' && birdeyeTokens.value.length > 0) {
    birdeyeTokens.value.forEach(t => allTokens.push({ ...t, source: 'birdeye' }));
  }

  if (dexPairs.status === 'fulfilled' && dexPairs.value.length > 0) {
    dexPairs.value.forEach(t => allTokens.push({ ...t, source: 'dexscreener' }));
  }

  // Deduplicate by address
  const seen = new Set();
  return allTokens.filter(t => {
    if (!t.address || seen.has(t.address)) return false;
    seen.add(t.address);
    return true;
  });
}
