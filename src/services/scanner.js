import axios from 'axios';
import { config } from '../config.js';

/**
 * Fetch newly created tokens from Pump.fun
 */
export async function fetchPumpfunNewTokens(limit = 20) {
  try {
    const res = await axios.get('https://frontend-v3.pump.fun/coins/new', {
      params: { limit, offset: 0 },
      timeout: 15000,
    });
    return res.data || [];
  } catch (err) {
    console.error('[Pump.fun] Failed to fetch new tokens:', err.message);
    return [];
  }
}

/**
 * Fetch trending tokens from Pump.fun
 */
export async function fetchPumpfunTrending(limit = 20) {
  try {
    const res = await axios.get('https://frontend-v3.pump.fun/coins/trending', {
      params: { limit, offset: 0 },
      timeout: 15000,
    });
    return res.data || [];
  } catch (err) {
    console.error('[Pump.fun] Failed to fetch trending:', err.message);
    return [];
  }
}

/**
 * Fetch recent Raydium AMM pools
 */
export async function fetchRaydiumNewPools(limit = 20) {
  try {
    // Raydium API - fetch recent pools
    const res = await axios.get('https://api.raydium.io/v2/sdk/pools', {
      params: { sort: 'creation_time', order: 'desc', pageSize: limit },
      timeout: 15000,
    });
    return res.data?.data || res.data || [];
  } catch (err) {
    console.error('[Raydium] Failed to fetch pools:', err.message);
    return [];
  }
}

/**
 * Quick score for Pump.fun token
 */
export function scorePumpfunToken(token) {
  let score = 0;
  const scoreBreakdown = [];

  // Market cap (higher = more activity)
  const mc = parseFloat(token.usd_market_cap || token.marketCap || 0);
  if (mc > 1000) { score += 1; scoreBreakdown.push('MC>$1K'); }
  if (mc > 10000) { score += 1; scoreBreakdown.push('MC>$10K'); }
  if (mc > 50000) { score += 1; scoreBreakdown.push('MC>$50K'); }

  // Holders
  const holders = parseInt(token.holder_count || token.holders || 0);
  if (holders > 5) { score += 1; scoreBreakdown.push('Holders>5'); }
  if (holders > 20) { score += 1; scoreBreakdown.push('Holders>20'); }
  if (holders > 100) { score += 1; scoreBreakdown.push('Holders>100'); }

  // Volume
  const volume = parseFloat(token.volume_24h || token.volume24h || 0);
  if (volume > 500) { score += 1; scoreBreakdown.push('Vol>$500'); }
  if (volume > 5000) { score += 1; scoreBreakdown.push('Vol>$5K'); }

  // Price change (momentum)
  const priceChange = parseFloat(token.price_change_24h || token.priceChange24h || 0);
  if (priceChange > 100) { score += 1; scoreBreakdown.push('Rally>100%'); }

  // Complete bonding curve
  if (token.complete === true) { score += 1; scoreBreakdown.push('BondingDone'); }

  return {
    score,
    maxScore: 10,
    breakdown: scoreBreakdown,
    grade: score >= 8 ? 'A+' : score >= 6 ? 'A' : score >= 4 ? 'B' : score >= 3 ? 'C' : 'D',
  };
}
