export function computeHedge(market, badOutcomeCost) {
  const yesPrice = clamp(Number(market.yesPrice ?? market.probability ?? 0.5), 0.01, 0.99);
  const shares = Math.max(1, Math.round(Number(badOutcomeCost || 0)));
  const premium = roundCurrency(shares * yesPrice);
  const payout = roundCurrency(shares);
  const netIfBad = roundCurrency(payout - premium);
  const coverage = badOutcomeCost > 0 ? Math.round((netIfBad / badOutcomeCost) * 100) : 0;
  const confidence = confidenceFor(market, yesPrice);

  return {
    ...market,
    yesPrice,
    probability: Number(market.probability ?? yesPrice),
    shares,
    premium,
    payout,
    netIfBad,
    coverage: clamp(coverage, 0, 100),
    recommendedAmount: premium,
    confidence
  };
}

export function scoreMarket(market, query, category) {
  const haystack = `${market.title} ${market.description} ${market.category}`.toLowerCase();
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const keywordScore = words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
  const categoryScore = category && market.category?.toLowerCase() === category.toLowerCase() ? 4 : 0;
  const volumeScore = market.volume ? 1 : 0;
  return keywordScore + categoryScore + volumeScore;
}

function confidenceFor(market, price) {
  const hasVolume = Boolean(market.volume);
  if ((price >= 0.55 && price <= 0.8 && hasVolume) || price >= 0.7) return "High";
  if (price >= 0.35 && price < 0.7) return "Medium";
  return "Low";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}
