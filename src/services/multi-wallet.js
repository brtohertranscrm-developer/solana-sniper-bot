import { getDb } from '../utils/database.js';
import { getSavedWallets } from './wallet.js';

const cursors = new Map();

export function getActiveWallet(chain) {
  try {
    const wallets = getDb().prepare('SELECT * FROM wallet_rotation WHERE chain = ? AND active = 1 ORDER BY id').all(chain);
    if (wallets.length) {
      const idx = cursors.get(chain) || 0;
      const wallet = wallets[idx % wallets.length];
      cursors.set(chain, (idx + 1) % wallets.length);
      getDb().prepare("UPDATE wallet_rotation SET last_used_at = datetime('now') WHERE id = ?").run(wallet.id);
      return { ...wallet, privateKey: wallet.private_key };
    }

    const saved = getSavedWallets(chain);
    const wallet = saved[0];
    if (!wallet) return null;
    return { ...wallet, privateKey: wallet.private_key };
  } catch (err) {
    console.error('[WalletRotation] get:', err.message);
    return null;
  }
}

export function addWalletToRotation(userId, chain, address, privateKey) {
  try {
    const info = getDb().prepare(`
      INSERT INTO wallet_rotation (user_id, chain, address, private_key)
      VALUES (?, ?, ?, ?)
    `).run(userId, chain, address, privateKey);
    return info.lastInsertRowid;
  } catch (err) {
    console.error('[WalletRotation] add:', err.message);
    return null;
  }
}

export function removeWalletFromRotation(walletId) {
  try {
    return getDb().prepare('UPDATE wallet_rotation SET active = 0 WHERE id = ?').run(walletId).changes > 0;
  } catch (err) {
    console.error('[WalletRotation] remove:', err.message);
    return false;
  }
}

export function listRotationWallets(chain) {
  try {
    if (chain) return getDb().prepare('SELECT id, user_id, chain, address, active, last_used_at, created_at FROM wallet_rotation WHERE chain = ? ORDER BY id DESC').all(chain);
    return getDb().prepare('SELECT id, user_id, chain, address, active, last_used_at, created_at FROM wallet_rotation ORDER BY id DESC').all();
  } catch (err) {
    console.error('[WalletRotation] list:', err.message);
    return [];
  }
}
