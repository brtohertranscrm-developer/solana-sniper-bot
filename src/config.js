import dotenv from 'dotenv';
dotenv.config();

export const config = {
  botToken: process.env.BOT_TOKEN,
  adminIds: (process.env.ADMIN_IDS || '').split(',').map(Number),
  solanaRpc: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  solanaWss: process.env.SOLANA_WSS_URL || 'wss://api.mainnet-beta.solana.com',
  heliusApiKey: process.env.HELIUS_API_KEY,
  birdeyeApiKey: process.env.BIRDEYE_API_KEY,
  scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS) || 15000,
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
