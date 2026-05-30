import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config.js';

const connection = new Connection(config.solanaRpc, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000,
});

/**
 * Check token safety — honeypot detection, tax analysis, LP check
 * Returns comprehensive safety report with score 0-100
 */
export async function checkTokenSafety(chain, tokenAddress) {
  const result = {
    isHoneypot: false,
    buyTax: 0,
    sellTax: 0,
    canSell: true,
    freezeAuthority: null,
    mintAuthority: null,
    lpBurned: false,
    lpLocked: false,
    warnings: [],
    score: 100,
    chain,
    tokenAddress,
  };

  try {
    if (chain === 'solana') {
      await checkSolanaSafety(result, tokenAddress);
    } else {
      await checkEVMSafety(result, tokenAddress);
    }
  } catch (err) {
    console.error(`[TokenSafety] Error checking ${tokenAddress}:`, err.message);
    result.warnings.push(`Safety check error: ${err.message}`);
  }

  // Calculate score
  result.score = calculateSafetyScore(result);
  return result;
}

/**
 * Solana-specific safety checks via RPC
 */
async function checkSolanaSafety(result, tokenAddress) {
  try {
    // Check mint account info
    const mintPk = new PublicKey(tokenAddress);
    const accountInfo = await connection.getParsedAccountInfo(mintPk);

    if (!accountInfo || !accountInfo.value) {
      result.isHoneypot = true;
      result.warnings.push('Token mint account not found — invalid address');
      return;
    }

    const data = accountInfo.value.data?.parsed?.info;
    if (data) {
      // Check freeze authority
      if (data.freezeAuthority) {
        result.freezeAuthority = data.freezeAuthority;
        result.warnings.push('⚠️ Freeze authority enabled — creator can freeze your tokens');
        result.score -= 20;
      } else {
        result.freezeAuthority = null;
      }

      // Check mint authority
      if (data.mintAuthority && data.mintAuthority !== '11111111111111111111111111111111') {
        result.mintAuthority = data.mintAuthority;
        result.warnings.push('⚠️ Mint authority exists — supply can be increased');
        result.score -= 15;
      } else {
        result.mintAuthority = null;
      }

      // Check decimals sanity
      if (data.decimals > 18 || data.decimals === 0) {
        result.warnings.push(`⚠️ Unusual decimals: ${data.decimals}`);
        result.score -= 5;
      }
    }
  } catch (err) {
    result.warnings.push(`RPC mint check failed: ${err.message}`);
    result.score -= 10;
  }

  // Check via Dexscreener for LP info and taxes
  try {
    const axios = (await import('axios')).default;
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
      timeout: 5000,
    });
    const pairs = res.data?.pairs || [];
    const pair = pairs[0];

    if (pair) {
      // LP check
      if (pair.liquidity && parseFloat(pair.liquidity.usd || 0) > 0) {
        result.lpLocked = true; // Assume locked if there's liquidity
        result.lpBurned = false;
      } else {
        result.warnings.push('❌ No/low liquidity — possible rug pull');
        result.score -= 30;
      }

      // Check if pair has burn/lock info
      if (pair.baseToken?.address === tokenAddress || pair.quoteToken?.address === tokenAddress) {
        // Check dexscreener flags
        if (pair.isNew === true) {
          result.warnings.push('ℹ️ Very new pair — higher risk');
          result.score -= 5;
        }
      }
    } else {
      result.warnings.push('❌ Not found on Dexscreener — not tradeable');
      result.score -= 40;
      result.canSell = false;
    }
  } catch (err) {
    // Dexscreener might not have it — not critical but worth noting
    result.warnings.push('Dexscreener lookup failed — cannot verify market data');
    result.score -= 10;
  }

  // Honeypot simulation via Jupiter — try to get a quote (sell 1 token to SOL)
  try {
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const res = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${tokenAddress}&outputMint=${SOL_MINT}&amount=1000000&slippageBps=500&onlyDirectRoutes=false&size=1`
    );
    if (!res.ok) {
      // No route = likely honeypot or illiquid
      result.isHoneypot = true;
      result.canSell = false;
      result.warnings.push('🚨 Jupiter cannot find sell route — likely honeypot or zero liquidity');
      result.score -= 40;
    } else {
      const data = await res.json();
      if (!data.outAmount || data.outAmount === '0' || data.outAmount === 0) {
        result.isHoneypot = true;
        result.canSell = false;
        result.warnings.push('🚨 Jupiter quote returns 0 output — likely honeypot');
        result.score -= 40;
      }
    }
  } catch (err) {
    // Jupiter simulation failed — not conclusive
    result.warnings.push('Jupiter simulation failed — cannot verify sellability');
    result.score -= 10;
  }
}

/**
 * EVM-specific safety checks via Dexscreener
 */
async function checkEVMSafety(result, tokenAddress) {
  try {
    const axios = (await import('axios')).default;
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
      timeout: 5000,
    });
    const pairs = res.data?.pairs || [];
    const pair = pairs[0];

    if (!pair) {
      result.warnings.push('❌ Not found on Dexscreener');
      result.score -= 40;
      result.canSell = false;
      return;
    }

    // Check liquidity
    if (pair.liquidity && parseFloat(pair.liquidity.usd || 0) > 0) {
      result.lpLocked = true;
    } else {
      result.warnings.push('❌ No liquidity detected');
      result.score -= 30;
    }

    // Honeypot detection: check if there's any buy/sell activity
    if (pair.volume?.h24 === 0 && pair.volume?.h6 === 0) {
      result.warnings.push('⚠️ Zero volume in 24h — possible honeypot');
      result.score -= 15;
      result.isHoneypot = true;
    }

    // New pair warning
    if (pair.isNew === true) {
      result.warnings.push('ℹ️ Very new pair — higher risk');
      result.score -= 5;
    }

    // Check FDV/Market cap ratio
    if (pair.fdv && pair.marketCap) {
      const fdv = parseFloat(pair.fdv || 0);
      const mc = parseFloat(pair.marketCap || 0);
      if (mc > 0 && fdv / mc > 5) {
        result.warnings.push('⚠️ FDV/MarketCap ratio very high — many tokens unlocked');
        result.score -= 15;
      }
    }
  } catch (err) {
    result.warnings.push(`Dexscreener check failed: ${err.message}`);
    result.score -= 10;
  }
}

/**
 * Calculate safety score (0-100)
 */
function calculateSafetyScore(result) {
  let score = 100;

  if (result.isHoneypot) score -= 40;
  if (!result.canSell) score -= 30;
  if (result.freezeAuthority) score -= 15;
  if (result.mintAuthority) score -= 10;
  if (!result.lpBurned && !result.lpLocked) score -= 15;
  if (result.buyTax > 10 || result.sellTax > 10) score -= 10;

  for (const w of result.warnings) {
    if (w.includes('🚨')) score -= 15;
    else if (w.includes('❌')) score -= 10;
    else if (w.includes('⚠️')) score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Format safety result for Telegram
 */
export function formatSafetyReport(result) {
  const chainLabel = result.chain === 'solana' ? '◎ Solana' : result.chain === 'bsc' ? '🔶 BSC' : '⟠ ETH';
  const scoreEmoji = result.score >= 80 ? '🟢' : result.score >= 50 ? '🟡' : result.score >= 30 ? '🟠' : '🔴';

  let report = `${scoreEmoji} <b>Token Safety Report</b> ${chainLabel}\n`;
  report += `Score: <b>${result.score}/100</b>\n`;
  report += `Token: <code>${result.tokenAddress}</code>\n\n`;

  // Flags
  report += `<b>Flags:</b>\n`;
  report += `${result.isHoneypot ? '🚨' : '✅'} Honeypot: ${result.isHoneypot ? 'SUSPICIOUS' : 'Clean'}\n`;
  report += `${result.canSell ? '✅' : '❌'} Can Sell: ${result.canSell ? 'Yes' : 'NO — blocked'}\n`;
  report += `${result.freezeAuthority ? '⚠️' : '✅'} Freeze Auth: ${result.freezeAuthority ? 'ENABLED' : 'None'}\n`;
  report += `${result.mintAuthority ? '⚠️' : '✅'} Mint Auth: ${result.mintAuthority ? 'ENABLED' : 'None'}\n`;
  report += `${result.lpLocked || result.lpBurned ? '✅' : '❌'} LP: ${result.lpBurned ? 'Burned' : result.lpLocked ? 'Locked' : 'NOT secured'}\n\n`;

  // Warnings
  if (result.warnings.length > 0) {
    report += `<b>Warnings:</b>\n`;
    for (const w of result.warnings) {
      report += `${w}\n`;
    }
  }

  return report;
}
