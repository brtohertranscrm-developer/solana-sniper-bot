import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { ethers } from 'ethers';
import { config } from '../config.js';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(process.cwd(), 'data', 'sniper.db');

function getDb() {
  return new Database(DB_PATH);
}

/**
 * Generate Solana wallet (keypair)
 */
export function generateSolanaWallet() {
  const keypair = Keypair.generate();
  return {
    chain: 'solana',
    address: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
  };
}

/**
 * Generate EVM wallet (BSC, ETH, Polygon, etc)
 */
export function generateEVMWallet() {
  const wallet = ethers.Wallet.createRandom();
  return {
    chain: 'evm',
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic.phrase,
  };
}

/**
 * Get saved wallets from DB
 */
export function getSavedWallets(chain) {
  const db = getDb();
  db.pragma('journal_mode = WAL');

  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain TEXT NOT NULL,
      label TEXT,
      address TEXT NOT NULL,
      private_key TEXT,
      mnemonic TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  if (chain) {
    return db.prepare('SELECT id, chain, label, address, private_key, mnemonic, created_at FROM wallets WHERE chain = ? ORDER BY id DESC').all(chain);
  }
  return db.prepare('SELECT id, chain, label, address, private_key, mnemonic, created_at FROM wallets ORDER BY id DESC').all();
}

/**
 * Save wallet to DB
 */
export function saveWallet(walletData) {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain TEXT NOT NULL,
      label TEXT,
      address TEXT NOT NULL,
      private_key TEXT,
      mnemonic TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.prepare(`
    INSERT INTO wallets (chain, label, address, private_key, mnemonic)
    VALUES (@chain, @label, @address, @private_key, @mnemonic)
  `).run({
    chain: walletData.chain,
    label: walletData.label || null,
    address: walletData.address,
    private_key: walletData.privateKey || walletData.private_key || null,
    mnemonic: walletData.mnemonic || null,
  });

  console.log(`[Wallet] Saved ${walletData.chain} wallet: ${walletData.address}`);
}
