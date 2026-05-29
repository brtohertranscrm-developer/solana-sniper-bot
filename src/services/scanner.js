import axios from 'axios';
import { config } from '../config.js';

const BIRDEYE_BASE = 'https://public-api.birdeye.so';
const DEXSCREENER_BASE = 'https://api.dexscreener.com';

const birdeyeHeaders = config.birdeyeApiKey
  ? { 'X-API-KEY': config.birdeyeApiKey }
  : { 'X-API-KEY': '***' };

const CHAIN_MAP = {
  solana: { birdeye: 'solana', dexscreener: 'solana' },
  bsc: { birdeye: 'bsc', dexscreener: 'bsc' },
  eth: { birdeye: 'ethereum', dexscreener: 'ethereum' },
};

/**
 * Fetch token list from Birdeye for a chain
 */
async function fetchBirdeyeTokens(chain, sortBy = 'v24hUSD', sortType = 'desc', limit = 20) {
  const chainId = CHAIN_MAP[chain]?.birdeye;
  if (!chainId) return [];

  try {
    const res = await axios.get(`${BIRDEYE_BASE}/defi/tokenlist`, {
      params: { chain_id: chainId, sort_by: sortBy, sort_type: sortType, offset: 0, limit },
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
      priceChange6h: t.priceChange6h || 0,
      priceChange1h: t.priceChange1h || 0,
      liquidity: t.liquidity || 0,
      holders: t.holder || 0,
    }));
  } catch (err) {
    console.error(`[Birdeye] Failed (${chain}):`, err.message);
    return [];
  }
}

/**
 * Fetch new pairs from Dexscreener for a chain
 */
async function fetchDexscreenerNewPairs(chain, limit = 30) {
  const chainId = CHAIN_MAP[chain]?.dexscreener;
  if (!chainId) return [];

  try {
    const res = await axios.get(`${DEXSCREENER_BASE}/token-boosts/latest/v1`, {
      params: { chainId },
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
    }));
  } catch (err) {
    console.error(`[Dexscreener] Failed (${chain}):`, err.message);
    return [];
  }
}

/**
 * Score a token
 */
export function scoreToken(token) {
  let score = 0;
  const breakdown = [];

  const mc = parseFloat(token.marketCap || 0);
  if (mc > 1000) { score += 1; breakdown.push('MC>$1K'); }
  if (mc > 10000) { score += 1; breakdown.push('MC>$10K'); }
  if (mc > 50000) { score += 1; breakdown.push('MC>$50K'); }
  if (mc > 500000) { score += 1; breakdown.push('MC>$500K'); }

  const liq = parseFloat(token.liquidity || 0);
  if (liq > 2000) { score += 1; breakdown.push('Liq>$2K'); }
  if (liq > 10000) { score += 1; breakdown.push('Liq>$10K'); }

  const holders = parseInt(token.holders || 0);
  if (holders > 10) { score += 1; breakdown.push('Holders>10'); }
  if (holders > 50) { score += 1; breakdown.push('Holders>50'); }

  const vol = parseFloat(token.volume_24h || 0);
  if (vol > 500) { score += 1; breakdown.push('Vol>$500'); }
  if (vol > 5000) { score += 1; breakdown.push('Vol>$5K'); }

  const priceChange = parseFloat(token.priceChange24h || 0);
  if (priceChange > 50) { score += 1; breakdown.push('+50%'); }
  if (priceChange > 200) { score += 1; breakdown.push('+200%'); }

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
 * Unified scan for a specific chain
 */
export async function scanChain(chain) {
  const [birdeyeTokens, dexPairs] = await Promise.allSettled([
    fetchBirdeyeTokens(chain, 'v24hUSD', 'desc', 20),
    fetchDexscreenerNewPairs(chain, 20),
  ]);

  const allTokens = [];

  if (birdeyeTokens.status === 'fulfilled') {
    birdeyeTokens.value.forEach(t => allTokens.push({ ...t, source: 'birdeye', chain }));
  }
  if (dexPairs.status === 'fulfilled') {
    dexPairs.value.forEach(t => allTokens.push({ ...t, source: 'dexscreener', chain }));
  }

  const seen = new Set();
  return allTokens.filter(t => {
    if (!t.address || seen.has(t.address)) return false;
    seen.add(t.address);
    return true;
  });
}

/**
 * Fetch trending for a specific chain
 */
export async function fetchTrending(chain) {
  const [birdeye, dex] = await Promise.allSettled([
    fetchBirdeyeTokens(chain, 'priceChange24h', 'desc', 10),
    fetchDexscreenerNewPairs(chain, 10),
  ]);

  const all = [];
  if (birdeye.status === 'fulfilled') {
    birdeye.value.forEach(t => all.push({ ...t, source: 'birdeye', chain }));
  }
  if (dex.status === 'fulfilled') {
    dex.value.forEach(t => all.push({ ...t, source: 'dexscreener', chain }));
  }

  const seen = new Set();
  return all.filter(t => {
    if (!t.address || seen.has(t.address)) return false;
    seen.add(t.address);
    return true;
  });
}

/**
 * Scan all chains
 */
export async function scanAllSources(chains = ['solana', 'bsc', 'eth']) {
  const results = await Promise.allSettled(chains.map(c => scanChain(c)));
  const allTokens = [];

  for (const r of results) {
    if (r.status === 'fulfilled') {
      allTokens.push(...r.value);
    }
  }

  return allTokens;
}
