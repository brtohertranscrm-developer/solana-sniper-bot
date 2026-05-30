# Cypher Sniper Bot v3.0

Multi-chain crypto sniper bot: Solana, BSC, ETH
12 fitur premium, auto-scan, auto-buy, safety check

---

FITUR DAN CARA PAKAI

SCANNER

/scan - Lihat token terbaik (grade A-B)
/scanall - Semua token yang terdeteksi
/analyze <address> - Analisis detail token
/top - Top token berdasarkan score
/newpair on|off - Deteksi token baru listing
/newpairfilters - Set filter (min liq, max age)

TRADE

/buy <token> <amount> [slippage] - Beli token manual
/forcebuy <token> <amount> [slip] - Buy tanpa safety check
/sell <token> [slippage] - Jual semua token
/portfolio - Lihat semua posisi aktif
/trail <token> <trail_pct> - Trailing stop loss
/trailoff <token> - Nonaktifkan trailing stop
/traillist - Lihat trailing stop aktif

AUTO

/autobuy set <min_mc> <max_mc> <min_holders> <min_liq> <amount> <max_buys> <slippage> - Set kriteria auto-buy
/autobuy on|off - Toggle auto-buy
/autobuy status - Cek status auto-buy
/smartadd <wallet> [label] - Track smart money wallet
/smartlist - Lihat wallet yang di-track
/smartscan - Analisis ulang tracked wallet
/smartremove <id> - Hapus wallet tracking
/watch <token> [note] - Tambah ke watchlist
/watchlist - Lihat watchlist + harga live
/unwatch <id> - Hapus dari watchlist

SAFETY

/safety <token> - Cek keamanan token (score 0-100)
/autosell on|off - Auto-sell saat TP/SL hit
/limitbuy <token> <price> <amount> [slip] - Limit buy order
/limitsell <token> <price> [slip] - Limit sell order
/limitlist - Lihat pending orders
/limitcancel <id> - Batalkan limit order
/report - Laporan PnL harian manual
/reportset <jam> - Set jam auto-report (0-23 UTC)
/backup - Backup wallet terenkripsi
/restore <string> - Restore wallet dari backup

TOOLS & SETTINGS

/calc <price> <amount> [tp1] [tp2] [tp3] - Kalkulator profit multi-TP
/pricealert <token> <above|below> <price> [once|recurring] - Set harga alert
/alertlist - Lihat active alerts
/alertcancel <id> - Batalkan alert
/wallet add|list|remove|active - Kelola wallet
/chain solana|bsc|eth - Ganti chain aktif
/paper on|off - Mode paper trading
/setpin <pin> - Set PIN akses (admin)
/login <pin> - Login ke bot (user)
/lock - Kunci bot

---

KRITERIA AUTO-SNIPE

SETIAP TOKEN DI-GRADING:

Grade A (Score 80-100) Token Premium
- MC $5K - $100K
- Holders > 50
- Volume 24h > $10K
- Liquidity > $5K
- LP Burned, contract renounced
- Harga stabil, tidak spike abnormal

Grade B (Score 60-79) Token Bagus
- MC $3K - $200K
- Holders > 20
- Volume 24h > $3K
- Liquidity > $2K
- Buy/sell tax < 5%
- Tidak ada red flag major

Grade C (Score 40-59) Token Risikon
- MC $1K - $500K
- Holders > 10
- Volume 24h > $1K
- Liquidity > $500
- Tax < 15%
- Ada warning tapi bukan rug pull

Grade D (Score 20-39) Token Berisiko
- MC sangat rendah atau sangat tinggi
- Holders < 10
- Volume rendah
- Ada indikasi risk

Grade F (Score 0-19) Token Berbahaya
- Honeypot (tidak bisa sell)
- LP tidak locked/burned
- Mint/freeze authority aktif
- Token baru < 5 menit, volume mencurigakan
- Top holder > 20% supply

---

SAFETY CHECK SEBELUM BUY

Score < 30 = BLOCKED (buy dibatalkan otomatis)
Score 30-49 = WARNING (muncul peringatan, konfirmasi diperlukan)
Score >= 50 = OK (lanjut buy)

Yang dicek safety:
1. Freeze authority aktif = warning
2. Mint authority aktif = warning
3. Honeypot detection (simulate sell via Jupiter)
4. Buy/sell tax estimate
5. LP status (burned/locked)
6. Holder distribution (top holder %)

---

DEFAULT AUTO-BUY

Min MC: $5,000
Max MC: $100,000
Min Holders: 20
Min Liquidity: $5,000
Amount per Buy: 0.08 SOL (~117K IDR)
Max Buy per Hour: 1 trade
Slippage: 15%

---

PROFIT MODEL (Budget 150K IDR)

Saldo: 0.1 SOL
Gas reserve: ~0.02 SOL
Amount per buy: 0.08 SOL

Fee per trade: ~15% total
(Break-even di TP +17%)

Profit per TP level:
- TP +30% = ~11K IDR
- TP +50% = ~37K IDR
- TP +70% = ~64K IDR
- TP +100% = ~103K IDR
- TP +200% = ~220K IDR

---

SETUP AWAL

1. /wallet add - Tambah Solana wallet
2. /setpin 1234 - Set PIN (ganti 1234)
3. /autobuy set 5000 100000 20 5000 0.08 1 15
4. /autosell on
5. /newpair on
6. Deposit 0.1 SOL ke wallet

---

MONITOR YANG BERJALAN

Auto-Scan: 15 detik
Auto-Sell: 30 detik
Limit Order: 15 detik
Trailing Stop: 20 detik
Daily Report: 60 detik
Smart Money: 5 menit
New Pair: 30 detik
Price Alert: 15 detik
Watchlist: 60 detik

---

KEAMANAN

- PIN protection (/setpin, /login, /lock)
- Paper trading mode (/paper on)
- Safety check blocking (score < 30 = tidak bisa buy)
- Wallet backup terenkripsi AES-256 (/backup)
- Budget limit per trade & per hari
- Max 1 buy per hour (default, bisa diubah)

---
Terakhir update: 30 Mei 2026
