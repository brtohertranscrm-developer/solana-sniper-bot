import { Connection, PublicKey, VersionedTransaction, TransactionMessage, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../config.js';

const connection = new Connection(config.solanaRpc, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000,
});

/**
 * Build and send a swap transaction via Jupiter aggregator
 */
export async function jupiterSwap(params) {
  const { inputMint, outputMint, amount, slippageBps, walletPublicKey, walletPrivateKey } = params;

  // Step 1: Get quote from Jupiter
  const quoteResponse = await fetch(
    `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&onlyDirectRoutes=false`
  );
  
  if (!quoteResponse.ok) {
    throw new Error(`Jupiter quote failed: ${quoteResponse.status}`);
  }
  
  const quoteData = await quoteResponse.json();
  console.log(`[Jupiter] Quote: ${quoteData.inputAmount} in -> ${quoteData.outAmount} out`);
  console.log(`[Jupiter] Price impact: ${quoteData.priceImpactPct}%`);

  // Step 2: Get swap transaction
  const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quoteData,
      userPublicKey: walletPublicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });

  if (!swapResponse.ok) {
    const err = await swapResponse.json();
    throw new Error(`Jupiter swap failed: ${err.error || swapResponse.status}`);
  }

  const swapData = await swapResponse.json();
  console.log(`[Jupiter] Swap tx built`);

  // Step 3: Sign transaction
  const { swapTransaction } = swapData;
  const txBuf = Buffer.from(swapTransaction, 'base64');
  const transaction = VersionedTransaction.deserialize(txBuf);
  
  const keypair = bs58.decode(walletPrivateKey);
  // For VersionedTransaction, sign with all required keypairs
  // Jupiter returns a transaction that needs the user's signature
  const keypairSigner = await import('@solana/web3.js').then(m => {
    // Reconstruct keypair from private key bytes
    return {
      publicKey: new PublicKey(bs58.encode(keypair.subarray(0, 32))),
      secretKey: keypair,
    };
  });

  // Use the signTransaction approach
  const signerKeypair = await createSignerKeypair(walletPrivateKey);
  transaction.sign([signerKeypair]);

  // Step 4: Send transaction
  const rawTx = transaction.serialize();
  const txid = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    maxRetries: 3,
  });

  console.log(`[Jupiter] TX sent: ${txid}`);
  
  // Step 5: Confirm
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const confirmation = await connection.confirmTransaction({
    signature: txid,
    blockhash,
    lastValidBlockHeight,
  }, 'confirmed');

  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  return {
    success: true,
    txid,
    inputAmount: quoteData.inputAmount,
    outputAmount: quoteData.outAmount,
    priceImpact: quoteData.priceImpactPct,
  };
}

/**
 * Sell token back to SOL via Jupiter
 */
export async function jupiterSell(params) {
  const { tokenMint, tokenAmount, walletPublicKey, walletPrivateKey, slippageBps } = params;
  
  // SOL address (wrapped)
  const SOL_MINT = 'So11111111111111111111111111111111111111112';

  return jupiterSwap({
    inputMint: tokenMint,
    outputMint: SOL_MINT,
    amount: tokenAmount,
    slippageBps: slippageBps || 500,
    walletPublicKey,
    walletPrivateKey,
  });
}

/**
 * Get SOL balance
 */
export async function getSolBalance(address) {
  return connection.getBalance(new PublicKey(address));
}

/**
 * Get token balance via Helius or RPC
 */
export async function getTokenBalance(mint, owner) {
  try {
    const splToken = await import('@solana/spl-token');
    const mintPk = new PublicKey(mint);
    const ownerPk = new PublicKey(owner);
    
    // Find associated token account
    const ATA = await splToken.getAssociatedTokenAddress(mintPk, ownerPk);
    const balance = await splToken.getAccount(connection, ATA);
    return balance.amount;
  } catch (err) {
    console.log(`[Solana] Token balance check failed: ${err.message}`);
    return 0;
  }
}

/**
 * Get token price in SOL via Jupiter
 */
export async function getTokenPriceSOL(mint, amount = 1000000) {
  try {
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const res = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${SOL_MINT}&outputMint=${mint}&amount=${amount}&slippageBps=100&onlyDirectRoutes=false&size=1`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.outAmount || data.outAmount === '0') return null;
    // Price = SOL per token
    return parseFloat(amount) / parseFloat(data.outAmount);
  } catch {
    return null;
  }
}

/**
 * Create keypair from base58 private key
 */
async function createSignerKeypair(privateKeyBs58) {
  const { Keypair } = await import('@solana/web3.js');
  const secretKey = bs58.decode(privateKeyBs58);
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Get transaction details
 */
export async function getTxDetails(signature) {
  return connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
}

export default connection;
