function calcTierCommission(salesCount, tiers = []) {
  const sales = Number(salesCount) || 0;
  if (!sales || !tiers.length) {
    return { amount: 0, salesCount: sales, earnedTiers: [], breakdown: [] };
  }

  const sorted = [...tiers].sort((a, b) => a.minSales - b.minSales);
  let total = 0;
  const earnedTiers = [];
  const breakdown = [];

  for (const tier of sorted) {
    if (sales >= tier.minSales) {
      total += tier.bonusAmount;
      earnedTiers.push(tier);
      breakdown.push({
        label: tier.label || `${tier.minSales}+ sales`,
        minSales: tier.minSales,
        amount: tier.bonusAmount,
      });
    }
  }

  return {
    amount: Math.round(total * 100) / 100,
    salesCount: sales,
    earnedTiers,
    breakdown,
  };
}

module.exports = { calcTierCommission };
