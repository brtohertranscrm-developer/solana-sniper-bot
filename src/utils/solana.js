import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config.js';

const connection = new Connection(config.solanaRpc, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000,
});

export default connection;

export function isValidAddress(address) {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export async function getSolPrice() {
  try {
    // Use Jupiter price API (free, no key needed)
    const res = await fetch('https://price.jup.ag/v6/price?ids=SOL');
    const data = await res.json();
    return data.data?.SOL?.price || 150;
  } catch {
    return 150; // fallback
  }
}

export function lamportsToSol(lamports) {
  return lamports / 1_000_000_000;
}
