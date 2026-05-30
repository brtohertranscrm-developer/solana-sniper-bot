import dotenv from 'dotenv';
dotenv.config();

export const config = {
  botToken: process.env.BOT_TOKEN,
  adminIds: (process.env.ADMIN_IDS || '').split(',').map(Number),
  solanaRpc: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  solanaWss: process.env.SOLANA_WSS_URL || 'wss://api.mainnet-beta.solana.com',
  heliusApiKey: process.env.HELIUS_API_KEY,
  birdeyeApiKey: process.env.BIRDEYE_API_KEY,
  bscscanApiKey: process.env.BSCSCAN_API_KEY || '',
  etherscanApiKey: process.env.ETHERSCAN_API_KEY || '',
  bscscanApiUrl: process.env.BSCSCAN_API_URL || 'https://api.bscscan.com/api',
  etherscanApiUrl: process.env.ETHERSCAN_API_URL || 'https://api.etherscan.io/api',
  pumpFunApiUrl: process.env.PUMP_FUN_API_URL || 'https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false',
  scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS) || 15000,
  copyTradeIntervalMs: parseInt(process.env.COPY_TRADE_INTERVAL_MS) || 30000,
  antiRugIntervalMs: parseInt(process.env.ANTI_RUG_INTERVAL_MS) || 60000,
  dcaIntervalMs: parseInt(process.env.DCA_INTERVAL_MS) || 15000,
  bondingIntervalMs: parseInt(process.env.BONDING_INTERVAL_MS) || 45000,
  volumeIntervalMs: parseInt(process.env.VOLUME_INTERVAL_MS) || 120000,
  tieredTpIntervalMs: parseInt(process.env.TIERED_TP_INTERVAL_MS) || 30000,
  autoSellIntervalMs: parseInt(process.env.AUTO_SELL_INTERVAL_MS) || 30000,
  limitOrderIntervalMs: parseInt(process.env.LIMIT_ORDER_INTERVAL_MS) || 15000,
  safetyMinScore: parseInt(process.env.SAFETY_MIN_SCORE) || 30,
  volumeSpikePct: parseFloat(process.env.VOLUME_SPIKE_PCT) || 500,
  bondingCompletionAlertPct: parseFloat(process.env.BONDING_COMPLETION_ALERT_PCT) || 90,
  defaultPaperBalance: parseFloat(process.env.DEFAULT_PAPER_BALANCE) || 10000,
  filters: {
    minLiquiditySol: parseFloat(process.env.MIN_LIQUIDITY_SOL) || 5,
    minHolders: parseInt(process.env.MIN_HOLDERS) || 20,
    maxTopHolderPct: parseFloat(process.env.MAX_TOP_HOLDER_PCT) || 30,
  },
  jito: {
    apiUrl: process.env.JITO_API_URL || 'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    tipLamports: parseInt(process.env.JITO_TIP_LAMPORTS) || 100000, // 0.0001 SOL default tip
    enabled: process.env.JITO_ENABLED === 'true',
  },
  solanaRpcEndpoints: (process.env.SOLANA_RPC_ENDPOINTS || 'https://api.mainnet-beta.solana.com').split(',').map(s => s.trim()),
  tools: {
    wsStreamEnabled: process.env.WS_STREAM_ENABLED === 'true',
    rpcFailoverEnabled: process.env.RPC_FAILOVER_ENABLED === 'true',
    cacheTtlMs: parseInt(process.env.TX_CACHE_TTL_MS) || 15000,
  },
  autoBuy: {
    amountPerBuySol: parseFloat(process.env.AMOUNT_PER_BUY_SOL) || 0.08,
    maxBuysPerHour: parseInt(process.env.MAX_BUYS_PER_HOUR) || 1,
    minMarketCap: parseFloat(process.env.MIN_MARKET_CAP) || 5000,
    maxMarketCap: parseFloat(process.env.MAX_MARKET_CAP) || 100000,
    maxSlippage: parseFloat(process.env.AUTO_BUY_SLIPPAGE) || 15,
  },
};

if (!config.botToken) {
  console.error('ERROR: BOT_TOKEN wajib diisi di .env');
  process.exit(1);
}
