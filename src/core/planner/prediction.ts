/**
 * Evaluates whether a question is genuinely asking for a future price prediction
 * rather than an on-chain forensic investigation.
 *
 * Examples that ARE predictions:
 * - "Will ETH hit $5,000?"
 * - "Will SOL pump tomorrow?"
 * - "Where will BTC price be next week?"
 * - "What is your price target for SOL?"
 *
 * Examples that are NOT predictions:
 * - "Why is BTC moving?"
 * - "Who is buying BTC?"
 * - "Who are the biggest whales on Ethereum?"
 * - "What changed on Solana?"
 * - "What were the biggest transactions this week?"
 * - "Why is ETH pumping?"
 */
export function isFuturePricePrediction(question: string): boolean {
  const trimmed = question.trim();
  if (!trimmed) return false;
  const q = trimmed.toLowerCase();

  // 1. Explicit future price action questions:
  // e.g. "Will ETH hit $5,000?", "Will SOL pump tomorrow?", "Will it reach 100?", "Can this go to $10?"
  if (
    /\b(?:will|can|could|is)\s+.*?\b(?:hit|reach|pump|dump|drop|moon|crash|go\s+to|go\s+up|go\s+down)\s*(?:\$?\d+|\bsoon\b|\btomorrow\b|\bnext\b)/i.test(q) ||
    /\bwill\s+.*?\b(?:hit|reach|pump|dump|drop|moon|crash|go\s+up|go\s+down)\b/i.test(q) ||
    /\bcan\s+(?:this|it|token|\$?\w+)\s+(?:go\s+to|reach|hit)\s+\$?\d+/i.test(q)
  ) {
    return true;
  }

  // 2. Future price location questions:
  // e.g. "Where will BTC price be next week?", "What will the price of ETH be?"
  if (/\b(?:where|what)\s+will\s+.*?\b(?:price|value)\s*(?:be)?\b/i.test(q)) {
    return true;
  }

  // 3. Explicit prediction terminology
  if (/\b(?:future\s+)?price\s+prediction\b/i.test(q)) {
    return true;
  }

  if (/\bprice\s+target\b/i.test(q)) {
    return true;
  }

  if (/\bpredict\s+(?:the\s+)?(?:future\s+)?(?:price|movement)\b/i.test(q)) {
    return true;
  }

  return false;
}

/**
 * Evaluates whether a question is genuinely asking about off-chain developer roadmap,
 * marketing strategy, or internal team intent that cannot be verified on-chain.
 *
 * Examples that ARE off-chain intent:
 * - "What is the team's roadmap?"
 * - "What is the developer intent?"
 * - "What is their marketing strategy?"
 *
 * Examples that are NOT off-chain intent:
 * - "Who is buying?"
 * - "Who's buying?"
 * - "Who is selling?"
 * - "Biggest transactions"
 * - "What is happening?"
 */
export function isOffChainRoadmapOrIntent(question: string): boolean {
  const trimmed = question.trim();
  if (!trimmed) return false;
  const q = trimmed.toLowerCase();

  return (
    q.includes('roadmap') ||
    q.includes('marketing strategy') ||
    q.includes('marketing plan') ||
    q.includes('developer intent') ||
    q.includes('dev team secret') ||
    q.includes('dev team plan') ||
    q.includes('team roadmap') ||
    q.includes("team's roadmap") ||
    q.includes('founder intent') ||
    q.includes('off-chain plan')
  );
}
