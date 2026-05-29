import { ethers } from 'ethers';
import { config } from '../config.js';

// ===== PancakeSwap / Uniswap Router ABI (minimal) =====
const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] amounts)',
];

const ERC20_ABI = [
  'function approve(address spender, uint amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

// Router & WETH addresses per chain
const CHAIN_CONFIG = {
  bsc: {
    router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap V2
    weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    rpc: 'https://bsc-dataseed.binance.org',
    chainId: 56,
    explorer: 'https://bscscan.com/tx/',
  },
  eth: {
    router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    rpc: 'https://eth.llamarpc.com',
    chainId: 1,
    explorer: 'https://etherscan.io/tx/',
  },
};

/**
 * Buy token on BSC or ETH via DEX
 */
export async function evmBuy(params) {
  const { chain, tokenAddress, amountInNative, walletPrivateKey, slippageBps } = params;
  const cfg = CHAIN_CONFIG[chain];
  if (!cfg) throw new Error(`Unsupported chain: ${chain}`);

  const provider = new ethers.JsonRpcProvider(cfg.rpc);
  const wallet = new ethers.Wallet(walletPrivateKey, provider);
  const router = new ethers.Contract(cfg.router, ROUTER_ABI, wallet);

  const amountIn = ethers.parseEther(amountInNative.toString());
  const path = [cfg.weth, tokenAddress];
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min

  // Get expected output
  const amounts = await router.getAmountsOut(amountIn, path);
  const amountOutMin = (amounts[1] * BigInt(10000 - (slippageBps || 500))) / 10000n;

  console.log(`[EVM:${chain}] Buy: ${amountInNative} ${chain === 'bsc' ? 'BNB' : 'ETH'} -> expected ${ethers.formatUnits(amounts[1], 18)} tokens`);

  let tx;
  if (chain === 'bsc') {
    tx = await router.swapExactETHForTokens(amountOutMin, path, wallet.address, deadline, {
      value: amountIn,
      gasLimit: 300000,
      gasPrice: ethers.parseUnits('5', 'gwei'),
    });
  } else {
    tx = await router.swapExactETHForTokens(amountOutMin, path, wallet.address, deadline, {
      value: amountIn,
      gasLimit: 300000,
    });
  }

  console.log(`[EVM:${chain}] TX sent: ${tx.hash}`);

  const receipt = await tx.wait();
  if (receipt.status !== 1) {
    throw new Error(`Transaction reverted`);
  }

  return {
    success: true,
    txid: tx.hash,
    explorer: `${cfg.explorer}${tx.hash}`,
    gasUsed: receipt.gasUsed.toString(),
  };
}

/**
 * Sell token on BSC or ETH
 */
export async function evmSell(params) {
  const { chain, tokenAddress, tokenAmount, walletPrivateKey, slippageBps } = params;
  const cfg = CHAIN_CONFIG[chain];
  if (!cfg) throw new Error(`Unsupported chain: ${chain}`);

  const provider = new ethers.JsonRpcProvider(cfg.rpc);
  const wallet = new ethers.Wallet(walletPrivateKey, provider);

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const decimals = await token.decimals();
  const symbol = await token.symbol().catch(() => '???');

  // Check balance
  const balance = await token.balanceOf(wallet.address);
  const amountIn = tokenAmount || balance;

  if (amountIn === 0n) throw new Error(`No ${symbol} balance to sell`);

  // Approve router to spend tokens
  const approveTx = await token.approve(cfg.router, amountIn);
  await approveTx.wait();
  console.log(`[EVM:${chain}] Approved router for ${symbol}`);

  const router = new ethers.Contract(cfg.router, ROUTER_ABI, wallet);
  const path = [tokenAddress, cfg.weth];
  const deadline = Math.floor(Date.now() / 1000) + 300;

  const amounts = await router.getAmountsOut(amountIn, path);
  const amountOutMin = (amounts[1] * BigInt(10000 - (slippageBps || 500))) / 10000n;

  console.log(`[EVM:${chain}] Sell: ${ethers.formatUnits(amountIn, decimals)} ${symbol} -> expected ${ethers.formatUnits(amounts[1], 18)} ${chain === 'bsc' ? 'BNB' : 'ETH'}`);

  const tx = await router.swapExactTokensForETH(amountIn, amountOutMin, path, wallet.address, deadline, {
    gasLimit: 300000,
    gasPrice: chain === 'bsc' ? ethers.parseUnits('5', 'gwei') : undefined,
  });

  console.log(`[EVM:${chain}] TX sent: ${tx.hash}`);

  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`Transaction reverted`);

  return {
    success: true,
    txid: tx.hash,
    explorer: `${cfg.explorer}${tx.hash}`,
    gasUsed: receipt.gasUsed.toString(),
  };
}

/**
 * Get native token balance (SOL/BNB/ETH)
 */
export async function getNativeBalance(chain, address) {
  const cfg = CHAIN_CONFIG[chain];
  if (!cfg) throw new Error(`Unsupported chain: ${chain}`);
  const provider = new ethers.JsonRpcProvider(cfg.rpc);
  return provider.getBalance(address);
}

/**
 * Get ERC20 token balance
 */
export async function getTokenBalance(chain, tokenAddress, walletAddress) {
  const cfg = CHAIN_CONFIG[chain];
  if (!cfg) throw new Error(`Unsupported chain: ${chain}`);
  const provider = new ethers.JsonRpcProvider(cfg.rpc);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return token.balanceOf(walletAddress);
}

/**
 * Get token info
 */
export async function getTokenInfo(chain, tokenAddress) {
  const cfg = CHAIN_CONFIG[chain];
  if (!cfg) return null;
  const provider = new ethers.JsonRpcProvider(cfg.rpc);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  try {
    const [decimals, symbol, name] = await Promise.all([
      token.decimals(),
      token.symbol(),
      token.name(),
    ]);
    return { decimals, symbol, name };
  } catch {
    return null;
  }
}
