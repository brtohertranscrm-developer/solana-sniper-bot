# Crypto Sniper Bot v3

Telegram trading bot for Solana, BSC, and Ethereum. It scans tokens, scores opportunities, tracks portfolios, supports live and paper trading, and runs background monitors for copy trade, anti-rug, auto-buy, DCA, bonding curve, and volume alerts.

## Features

- Multi-chain scanner: Solana, BSC, ETH
- Token scoring, trending, top grade lists, and holder analysis
- Wallet generation plus multi-wallet rotation
- Live buy/sell through Jupiter, PancakeSwap, and Uniswap V2 routers
- Portfolio tracking with TP/SL and tiered take-profit alerts
- Copy-trade wallet watch polling
- Anti-rug top-holder dump alerts
- Criteria-based auto-buy with per-hour limits
- DCA order processing
- Pump.fun bonding curve completion alerts
- 500%+ volume spike alerts
- Telegram channel signal monitoring
- Paper trading mode, paper portfolio, and paper PnL

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Required `.env` values:

- `BOT_TOKEN` from BotFather
- `ADMIN_IDS` comma-separated Telegram user IDs

Recommended:

- `SOLANA_RPC_URL` from a paid RPC provider
- `HELIUS_API_KEY` for Solana holder analysis
- `BIRDEYE_API_KEY` for token overview data
- `BSCSCAN_API_KEY` and `ETHERSCAN_API_KEY` for copy-trade EVM polling

## Commands

Core:

- `/menu` - Open the inline control menu
- `/scan` - Scan active network
- `/trending` - Trending tokens
- `/top [grade]` - Top tokens, optionally `A+`, `A`, `B`, `C`, or `D`
- `/analyze <address>` - Detailed token analysis
- `/network` - Switch active network
- `/stats` - Scanner database stats

Trading:

- `/wallet [solana|bsc|eth]` - Generate wallet
- `/mywallets` - List saved wallets
- `/rotate_add <address> <private_key>` - Add wallet to round-robin rotation
- `/rotate_list` - List rotation wallets for active network
- `/rotate_rm <id>` - Disable a rotation wallet
- `/buy <token_address> <amount> [slippage%]`
- `/sell <token_address> [slippage%]`
- `/snipe <token_address>` - Quick buy using default small size

Automation:

- `/copy <wallet_address> [label]`
- `/uncopy <id>`
- `/copylist`
- `/autobuy on|off`
- `/autobuy set <minMC> <maxMC> <minHolders> <minLiq> <maxSlippage> <amountPerBuy> <maxBuysPerHour>`
- `/dca <token> <total_amount> <slices> <interval_sec> [slippage]`
- `/dca list`
- `/dca cancel <id>`
- `/tieredtp <token> [100:25,200:25,500:50]`

Signals and paper trading:

- `/channel_add <channel_id> [label]`
- `/channel_rm <channel_id>`
- `/paper on|off`
- `/paper_portfolio`
- `/portfolio`
- `/pnl`

## Notes

- The bot uses `better-sqlite3` synchronous APIs and stores data in `data/sniper.db`.
- `.env` is intentionally not modified by setup or runtime.
- Live trading requires funded wallets and private keys in either saved wallets or wallet rotation.
- Paper mode intercepts `/buy` and `/sell` for the user and records simulated positions.
