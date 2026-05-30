import { config } from '../config.js';

// ============================================================
// a) Jito Bundle Submission
// ============================================================

/**
 * Submit a Jito bundle with tip.
 * @param {string[]} encodedTransactions - Base58-encoded transaction strings
 * @param {number} tipLamports - Tip amount in lamports (default from config)
 * @returns {Promise<{bundle_id: string, jsonrpc: string, result: object|null}>}
 */
export async function sendJitoBundle(encodedTransactions, tipLamports) {
  const apiUrl = config.jito?.apiUrl || 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';
  const tip = tipLamports || config.jito?.tipLamports || 100000;

  if (!encodedTransactions || encodedTransactions.length === 0) {
    throw new Error('No transactions provided for Jito bundle');
  }

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendBundle',
    params: [[...encodedTransactions]],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await res.json();

    if (data.error) {
      return { bundle_id: null, jsonrpc: data.jsonrpc, error: data.error.message };
    }

    return { bundle_id: data.result, jsonrpc: data.jsonrpc, result: data.result, tipLamports: tip };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return { bundle_id: null, jsonrpc: '2.0', error: 'Jito bundle request timed out (5s)' };
    }
    throw err;
  }
}

// ============================================================
// b) WebSocket Block Stream — new token detection
// ============================================================

const PUMPFUN_PROGRAM_ID = '6EF8rrecthK5Qj8pdVuKG9FCbwvUMU86BuXQQvwwjwB';
const RAYDIUM_AMM_V4 = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const ORCA_WHIRLPOOL = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';

let wsInstance = null;
let wsRunning = false;
let wsReconnectTimer = null;

/**
 * Subscribe to new token events via WebSocket.
 * @param {function} onToken - callback(tokenInfo) on new pair creation
 * @returns {void}
 */
export function subscribeNewTokens(onToken) {
  if (wsRunning && wsInstance) {
    return; // Already running
  }

  wsRunning = true;
  const wssUrl = config.solanaWss || 'wss://api.mainnet-beta.solana.com';

  function connect() {
    if (!wsRunning) return;
    try {
      wsInstance = new WebSocket(wssUrl);
    } catch (e) {
      console.error('[WS Stream] Connection error:', e.message);
      scheduleReconnect();
      return;
    }

    wsInstance.onopen = () => {
      console.log('[WS Stream] Connected to', wssUrl);
      // Subscribe to logs for target program IDs
      const params = {
        commitment: 'confirmed',
        mentions: [PUMPFUN_PROGRAM_ID, RAYDIUM_AMM_V4, ORCA_WHIRLPOOL],
      };
      wsInstance.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'logsSubscribe',
        params: [params],
      }));
    };

    wsInstance.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.method === 'logsNotification' && data.params?.result?.value) {
          const log = data.params.result.value;
          const signature = log.signature;
          const errMsg = log.err;
          if (errMsg) return; // Skip failed txs

          // Parse log messages for new pair creation indicators
          const logs = log.logs || [];
          const isPumpFun = logs.some(l => l.includes(PUMPFUN_PROGRAM_ID));
          const isRaydium = logs.some(l => l.includes(RAYDIUM_AMM_V4));
          const isOrca = logs.some(l => l.includes(ORCA_WHIRLPOOL));

          if (isPumpFun || isRaydium || isOrca) {
            onToken({
              signature,
              source: isPumpFun ? 'pumpfun' : isRaydium ? 'raydium' : 'orca',
              timestamp: Date.now(),
              logs,
              slot: log.slot,
            });
          }
        }
      } catch (e) {
        // Ignore parse errors for non-JSON messages
      }
    };

    wsInstance.onclose = () => {
      console.log('[WS Stream] Disconnected');
      scheduleReconnect();
    };

    wsInstance.onerror = (err) => {
      console.error('[WS Stream] Error:', err.message || err);
    };
  }

  function scheduleReconnect() {
    if (!wsRunning) return;
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(() => {
      console.log('[WS Stream] Reconnecting...');
      connect();
    }, 5000);
  }

  connect();
}

/**
 * Stop the WebSocket stream.
 */
export function unsubscribeNewTokens() {
  wsRunning = false;
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (wsInstance) {
    try { wsInstance.close(); } catch {}
    wsInstance = null;
  }
}

/**
 * Check if WS stream is currently running.
 */
export function isWsStreamRunning() {
  return wsRunning && wsInstance?.readyState === WebSocket.OPEN;
}

// ============================================================
// c) RPC Failover Manager
// ============================================================

export class RpcManager {
  constructor(endpoints) {
    this.endpoints = (endpoints || []).map(e => ({
      url: typeof e === 'string' ? e : e.url,
      latency: Infinity,
      lastCheck: 0,
      healthy: true,
    }));
    this.bestIndex = 0;
    this.checkIntervalMs = 30000;
    this._timer = null;
  }

  /**
   * Get the best (lowest latency) healthy RPC endpoint.
   */
  getBestRpc() {
    const healthy = this.endpoints.filter(e => e.healthy);
    if (healthy.length === 0) return this.endpoints[0]?.url || null;
    healthy.sort((a, b) => a.latency - b.latency);
    this.bestIndex = this.endpoints.indexOf(healthy[0]);
    return healthy[0].url;
  }

  /**
   * Test latency of a single endpoint.
   */
  async testEndpoint(endpoint) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
        signal: controller.signal,
      });
      clearTimeout(tid);
      const data = await res.json();
      const latency = Date.now() - start;
      endpoint.healthy = !data.error;
      endpoint.latency = endpoint.healthy ? latency : Infinity;
      endpoint.lastCheck = Date.now();
    } catch (e) {
      endpoint.healthy = false;
      endpoint.latency = Infinity;
      endpoint.lastCheck = Date.now();
    }
  }

  /**
   * Health check all endpoints.
   */
  async healthCheck() {
    await Promise.all(this.endpoints.map(e => this.testEndpoint(e)));
    return this.getStatus();
  }

  /**
   * Start automatic periodic health checks.
   */
  startAutoCheck() {
    if (this._timer) return;
    this._timer = setInterval(() => this.healthCheck(), this.checkIntervalMs);
  }

  /**
   * Stop automatic health checks.
   */
  stopAutoCheck() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Get status report of all endpoints.
   */
  getStatus() {
    return this.endpoints.map((e, i) => ({
      url: e.url,
      latency: `${e.latency === Infinity ? 'timeout' : e.latency + 'ms'}`,
      healthy: e.healthy ? '✅' : '❌',
      best: i === this.bestIndex ? '⭐' : '',
    }));
  }
}

// Singleton instance
let rpcManagerInstance = null;

export function getRpcManager() {
  if (!rpcManagerInstance) {
    const endpoints = config.solanaRpcEndpoints || ['https://api.mainnet-beta.solana.com'];
    rpcManagerInstance = new RpcManager(endpoints);
  }
  return rpcManagerInstance;
}

// ============================================================
// d) Pre-built Transaction Cache
// ============================================================

class TxCache {
  constructor(ttlMs = 15000) {
    this.cache = new Map();
    this.ttl = ttlMs;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

const txCache = new TxCache(config.tools?.cacheTtlMs || 15000);

/**
 * Get swap quote from cache if fresh (<15s), otherwise returns null.
 * @param {string} inputMint
 * @param {string} outputMint
 * @param {number} amount
 * @returns {object|null}
 */
export function getCachedQuote(inputMint, outputMint, amount) {
  const key = `${inputMint}-${outputMint}-${amount}`;
  return txCache.get(key);
}

/**
 * Store a swap quote in cache.
 * @param {string} inputMint
 * @param {string} outputMint
 * @param {number} amount
 * @param {object} quoteData
 */
export function setCachedQuote(inputMint, outputMint, amount, quoteData) {
  const key = `${inputMint}-${outputMint}-${amount}`;
  txCache.set(key, quoteData);
}

/**
 * Get swap quote: return cached if fresh (<15s), else return null (caller should fetch).
 * @param {string} inputMint
 * @param {string} outputMint
 * @param {number} amount
 * @returns {object|null}
 */
export function getSwapQuote(inputMint, outputMint, amount) {
  return getCachedQuote(inputMint, outputMint, amount);
}

/**
 * Clear the transaction cache.
 */
export function clearTxCache() {
  txCache.clear();
}

/**
 * Get cache size.
 */
export function getTxCacheSize() {
  return txCache.size();
}

// ============================================================
// e) Priority Fee Estimator
// ============================================================

const PRIORITY_LEVELS = {
  low: 100_000,       // 0.0001 SOL
  medium: 500_000,    // 0.0005 SOL
  high: 2_000_000,    // 0.002 SOL
  turbo: 10_000_000,  // 0.01 SOL
};

/**
 * Estimate priority fee based on recent block compute unit prices.
 * @param {string} level - 'low', 'medium', 'high', 'turbo'
 * @param {string} [rpcUrl] - Optional RPC URL
 * @returns {Promise<{level: string, microLamports: number, sol: string}>}
 */
export async function estimatePriorityFee(level = 'medium', rpcUrl) {
  const rpc = rpcUrl || getRpcManager().getBestRpc() || config.solanaRpc;

  // Try to get actual compute unit prices from recent blocks
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getRecentPrioritizationFees',
        params: [],
      }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const data = await res.json();

    if (data.result && data.result.length > 0) {
      // Sort by prioritization fee descending
      const fees = data.result.sort((a, b) => (b.prioritizationFee || 0) - (a.prioritizationFee || 0));

      // Use median as baseline, then adjust by level
      const median = fees[Math.floor(fees.length / 2)]?.prioritizationFee || PRIORITY_LEVELS[level];

      const multiplier = { low: 1.0, medium: 1.5, high: 3.0, turbo: 10.0 };
      const estimated = Math.max(median * (multiplier[level] || 1.5), PRIORITY_LEVELS[level]);

      return {
        level,
        microLamports: Math.round(estimated),
        sol: (estimated / 1_000_000_000).toFixed(6),
        source: 'estimated',
        medianFee: median,
        sampleSize: fees.length,
      };
    }
  } catch (e) {
    // Fallback to static values
  }

  // Fallback: use static priority levels
  const microLamports = PRIORITY_LEVELS[level] || PRIORITY_LEVELS.medium;
  return {
    level,
    microLamports,
    sol: (microLamports / 1_000_000_000).toFixed(6),
    source: 'static',
  };
}
