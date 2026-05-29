# Solana Token Scanner Bot (Phase 1)

Bot Telegram untuk scanning dan analisis token Solana yang potensial.

## Phase 1 - Scanner & Analyzer

### Fitur
- Auto-scan token baru dari Pump.fun (setiap 15 detik)
- Scoring system otomatis (A+ / A / B / C / D)
- Analisis holder distribution (via Helius)
- Token overview via Birdeye (price, MC, volume, liquidity)
- High-potential token alerts ke admin
- Manual scan, trending, dan analyze per token

### Cara Setup

1. Install dependencies:
```bash
npm install
```

2. Copy `.env.example` ke `.env` dan isi:
```bash
cp .env.example .env
```

3. Setting wajib:
- `BOT_TOKEN` - Dari @BotFather
- `ADMIN_IDS` - Telegram user ID kamu

4. Setting opsional (untuk fitur lengkap):
- `HELIUS_API_KEY` - Untuk holder analysis (daftar gratis di helius.xyz)
- `BIRDEYE_API_KEY` - Untuk token overview & trade data
- `SOLANA_RPC_URL` - Gunakan paid RPC untuk rate limit tinggi

5. Jalankan:
```bash
npm start
```

### Perintah Bot
- `/scan` - Manual scan token baru
- `/top [grade]` - Top token by score (filter: A+, A, B, C, D)
- `/analyze <address>` - Analisis detail token
- `/trending` - Token trending Pump.fun
- `/stats` - Statistik scanner
- `/help` - Bantuan

### Scoring System
Token di-score berdasarkan:
- Market cap
- Jumlah holders
- Volume 24h
- Price momentum
- Bonding curve status

Grade:
- A+ = Sangat potensial (8+)
- A = Potensial (6-7)
- B = Menarik (4-5)
- C = Perlu perhatian (3)
- D = Rendah (0-2)

### Roadmap
- [x] Phase 1: Scanner + Analyzer
- [ ] Phase 2: Sniper engine (auto-buy)
- [ ] Phase 3: Portfolio tracker + auto-sell (TP/SL)
- [ ] Phase 4: Copy trade + whale watching
