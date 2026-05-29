import axios from 'axios';
import { config } from '../config.js';

const HELIUS_BASE = config.heliusApiKey
  ? `https://api.helius.xyz/v0`
  : null;

const BIRDEYE_BASE = 'https://public-api.birdeye.so';

// Birdeye headers
const birdeyeHeaders = config.birdeyeApiKey
  ? { 'X-API-KEY': config.birdeyeApiKey }
  : {};

/**
 * Fetch token metadata & overview from Birdeye
 */
export async function getTokenOverview(tokenAddress) {
  try {
    const res = await axios.get(`${BIRDEYE_BASE}/defi/token_overview`, {
      params: { address: tokenAddress },
      headers: birdeyeHeaders,
      timeout: 10000,
    });
    return res.data?.success ? res.data.data : null;
  } catch (err) {
    console.error(`[Birdeye] Failed to fetch overview for ${tokenAddress}:`, err.message);
    return null;
  }
}

/**
 * Get top holders for a token via Helius
 */
export async function getTokenTopHolders(tokenAddress, limit = 20) {
  if (!HELIUS_BASE) {
    console.warn('[Helius] No API key configured, skipping holders fetch');
    return [];
  }
  try {
    const res = await axios.post(`${HELIUS_BASE}/addresses/tokenAccounts`, {
      mint: tokenAddress,
      limit,
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    return res.data?.token_accounts || [];
  } catch (err) {
    console.error(`[Helius] Failed to fetch holders for ${tokenAddress}:`, err.message);
    return [];
  }
}

/**
 * Analyze holder distribution - returns concentration score
 * Lower score = better distribution
 */
export async function analyzeHolders(tokenAddress) {
  const holders = await getTokenTopHolders(tokenAddress, 20);
  if (holders.length === 0) return null;

  const totalSupply = holders.reduce((sum, h) => sum + parseFloat(h.amount || 0), 0);
  if (totalSupply === 0) return null;

  // Calculate top holder percentage
  const topHolderPct = (parseFloat(holders[0]?.amount || 0) / totalSupply) * 100;
  
  // Calculate top 5 holders percentage
  const top5Pct = holders.slice(0, 5).reduce((sum, h) => sum + parseFloat(h.amount || 0), 0) / totalSupply * 100;

  // Check if top holder is the mint authority / dev wallet
  const isTopHolderDev = holders[0]?.owner === holders[0]?.mint; // rough check

  return {
    totalHolders: holders.length,
    topHolderPct: Math.round(topHolderPct * 100) / 100,
    top5Pct: Math.round(top5Pct * 100) / 100,
    holders: holders.slice(0, 5).map(h => ({
      address: h.owner,
      pct: Math.round((parseFloat(h.amount || 0) / totalSupply) * 10000) / 100,
    })),
    risk: topHolderPct > 50 ? 'HIGH' : top5Pct > 60 ? 'MEDIUM' : 'LOW',
  };
}

/**
 * Get token trade data (volume, price change) from Birdeye
 */
export async function getTokenTradeData(tokenAddress, timeframe = '24h') {
  try {
    const res = await axios.get(`${BIRDEYE_BASE}/defi/ohlcv`, {
      params: {
        address: tokenAddress,
        time_zone: 'UTC',
        type: timeframe === '24h' ? '1H' : '4H',
      },
      headers: birdeyeHeaders,
      timeout: 10000,
    });
    return res.data?.success ? res.data.data : null;
  } catch (err) {
    console.error(`[Birdeye] Trade data failed for ${tokenAddress}:`, err.message);
    return null;
  }
}

/**
 * Get recent swaps / liquidity events (simplified)
 */
export async function getRecentSwaps(tokenAddress) {
  try {
    const res = await axios.get(`${BIRDEYE_BASE}/defi/txs/token`, {
      params: {
        address: tokenAddress,
        sort_by: 'time',
        sort_type: 'desc',
        limit: 10,
      },
      headers: birdeyeHeaders,
      timeout: 10000,
    });
    return res.data?.success ? res.data.data?.txs || [] : [];
  } catch {
    return [];
  }
}
