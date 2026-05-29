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
  volumeSpikePct: parseFloat(process.env.VOLUME_SPIKE_PCT) || 500,
  bondingCompletionAlertPct: parseFloat(process.env.BONDING_COMPLETION_ALERT_PCT) || 90,
  defaultPaperBalance: parseFloat(process.env.DEFAULT_PAPER_BALANCE) || 10000,
  filters: {
    minLiquiditySol: parseFloat(process.env.MIN_LIQUIDITY_SOL) || 5,
    minHolders: parseInt(process.env.MIN_HOLDERS) || 10,
    maxTopHolderPct: parseFloat(process.env.MAX_TOP_HOLDER_PCT) || 30,
  },
};

if (!config.botToken) {
  console.error('ERROR: BOT_TOKEN wajib diisi di .env');
  process.exit(1);
}
