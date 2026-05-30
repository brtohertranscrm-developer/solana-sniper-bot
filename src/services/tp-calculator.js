const FEE_RATE = 0.15; // 15% default fee

/**
 * Calculate TP table for given buy price and amount
 */
export function calculateTP(buyPrice, buyAmount, tpPcts) {
  if (!tpPcts || !tpPcts.length) {
    tpPcts = [50, 100, 200];
  }

  const results = [];
  const totalCost = buyPrice * buyAmount;

  for (const pct of tpPcts) {
    const sellPrice = buyPrice * (1 + pct / 100);
    const sellAmount = sellPrice * buyAmount;
    const grossProfit = sellAmount - totalCost;
    const fee = sellAmount * FEE_RATE;
    const netProfit = grossProfit - fee;
    const netSell = sellAmount - fee;
    const netPct = ((netSell - totalCost) / totalCost) * 100;

    results.push({
      tp_pct: pct,
      sell_price: sellPrice,
      sell_amount: sellAmount,
      gross_profit: grossProfit,
      fee,
      net_profit: netProfit,
      net_sell: netSell,
      net_pct: netPct,
    });
  }

  // Break-even price: price where sell covers fees
  // sellPrice * buyAmount * (1 - feeRate) = buyPrice * buyAmount
  // sellPrice = buyPrice / (1 - feeRate)
  const breakEvenPrice = buyPrice / (1 - FEE_RATE);
  const breakEvenPct = ((breakEvenPrice - buyPrice) / buyPrice) * 100;

  return { results, breakEvenPrice, breakEvenPct, totalCost, feeRate: FEE_RATE };
}

/**
 * Format TP calculator output for Telegram
 */
export function formatTPCalc(buyPrice, buyAmount, tpPcts) {
  const data = calculateTP(buyPrice, buyAmount, tpPcts);

  const fmtNum = (n) => {
    if (Math.abs(n) >= 1000) return n.toFixed(2);
    if (Math.abs(n) >= 1) return n.toFixed(4);
    if (Math.abs(n) >= 0.001) return n.toFixed(6);
    return n.toExponential(4);
  };

  let text = `📊 <b>Profit Calculator</b>\n\n`;
  text += `Buy: ${fmtNum(buyAmount)} @ $${fmtNum(buyPrice)}\n`;
  text += `Total cost: ${fmtNum(data.totalCost)}\n\n`;

  text += `<b>Gross (before fees):</b>\n`;
  for (const r of data.results) {
    text += `TP +${r.tp_pct}%: Sell = ${fmtNum(r.sell_amount)} | Profit = +${fmtNum(r.gross_profit)}\n`;
  }

  text += `\n<b>Net (after ~${Math.round(data.feeRate * 100)}% fees):</b>\n`;
  for (const r of data.results) {
    const emoji = r.net_profit > 0 ? '🟢' : '🔴';
    text += `${emoji} TP +${r.tp_pct}%: Net = ${fmtNum(r.net_profit)} (${r.net_pct >= 0 ? '+' : ''}${r.net_pct.toFixed(1)}%)\n`;
  }

  text += `\n💡 Break-even: $${fmtNum(data.breakEvenPrice)} (+${data.breakEvenPct.toFixed(1)}%)\n`;
  text += `(Price needed to cover ${Math.round(data.feeRate * 100)}% fees)`;

  return text;
}
