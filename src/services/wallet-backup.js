import crypto from 'crypto';
import { getDb } from '../utils/database.js';
import { getSavedWallets } from './wallet.js';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 16;
const SALT_LEN = 32;
const TAG_POSITION = KEY_LEN + IV_LEN; // tag goes after key+iv in header

/**
 * Derive a 32-byte AES key from password using scrypt
 */
function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, KEY_LEN, { N: 32768, r: 8, p: 1 });
}

/**
 * Encrypt data with AES-256-GCM, returns base64 string
 */
function encrypt(data, password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: salt(32) + iv(16) + tag(16) + ciphertext
  const combined = Buffer.concat([salt, iv, tag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt base64 string back to original data
 */
function decrypt(encryptedBase64, password) {
  try {
    const combined = Buffer.from(encryptedBase64, 'base64');
    const salt = combined.subarray(0, SALT_LEN);
    const iv = combined.subarray(SALT_LEN, SALT_LEN + IV_LEN);
    const tag = combined.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + 16);
    const ciphertext = combined.subarray(SALT_LEN + IV_LEN + 16);

    const key = deriveKey(password, salt);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch (err) {
    throw new Error('Decryption failed. Wrong password or corrupted backup.');
  }
}

/**
 * Get all saved wallets from the wallet service
 */
function getAllWallets() {
  return getSavedWallets();
}

/**
 * Generate an encrypted backup of all wallets
 */
export function generateBackup(password) {
  const wallets = getAllWallets();
  if (!wallets.length) {
    throw new Error('No wallets to backup.');
  }

  const backupData = wallets.map(w => ({
    chain: w.chain,
    address: w.address,
    private_key: w.privateKey,
    mnemonic: w.mnemonic || null,
    label: w.label || null,
  }));

  return encrypt(backupData, password);
}

/**
 * Restore wallets from encrypted backup
 */
export function restoreBackup(encryptedString, password) {
  const data = decrypt(encryptedString, password);

  if (!Array.isArray(data)) {
    throw new Error('Invalid backup format.');
  }

  const db = getDb();
  let count = 0;

  for (const w of data) {
    if (!w.chain || !w.address || !w.private_key) continue;

    // Check if wallet already exists (by chain + address)
    const existing = db.prepare('SELECT id FROM wallets WHERE chain = ? AND address = ?').get(w.chain, w.address);
    if (existing) continue; // Skip duplicates

    db.prepare(`
      INSERT INTO wallets (chain, address, private_key, mnemonic, label, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(w.chain, w.address, w.private_key, w.mnemonic || null, w.label || null);
    count++;
  }

  return count;
}

/**
 * Get wallet list for backup preview
 */
export function getBackupPreview() {
  const wallets = getAllWallets();
  if (!wallets.length) return null;

  return wallets.map(w => ({
    id: w.id,
    chain: w.chain,
    address: w.address,
    hasPrivateKey: !!w.privateKey,
    hasMnemonic: !!w.mnemonic,
  }));
}
