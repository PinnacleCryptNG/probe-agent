import { ChallengeDetectionResult } from './types.js';

/**
 * Deterministically detects whether a user input constitutes a challenge to a previous finding,
 * and categorizes the challenge type without requiring exact phrase matches.
 */
export function detectChallenge(text: string): ChallengeDetectionResult {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // 1. Falsification / What would disprove or confirm
  if (
    /what (?:evidence )?would (?:actually )?(?:disprove|falsif|change (?:your mind|the conclusion|this)|confirm|refute|prove)/i.test(lower) ||
    /what (?:would|evidence) (?:actually )?confirm (?:selling|buying|dumping|accumulation)/i.test(lower) ||
    /how (?:could|would) (?:this|that|it) be (?:disproven|proven|confirmed)/i.test(lower)
  ) {
    return {
      isChallenge: true,
      category: 'FALSIFICATION',
    };
  }

  // 2. Alternative Explanation
  // e.g. "Could there be another explanation?", "another explanation", "Could the whales just be moving funds between their own wallets?"
  if (
    /another explanation|alternative explanation/i.test(lower) ||
    /could (there be|it be|the|this|that|whales?)/i.test(lower) ||
    /might (they|it|whales?)/i.test(lower) ||
    /what if (they|it|whales?)/i.test(lower) ||
    /just (be )?(moving|transferring|internal)/i.test(lower) ||
    /internal wallet/i.test(lower)
  ) {
    // Extract hypothesis if the user proposed a specific alternative
    let specificHypothesis: string | undefined;
    if (/another explanation|alternative explanation/i.test(lower)) {
      specificHypothesis = undefined;
    } else if (/internal wallet/i.test(lower)) {
      specificHypothesis = 'internal wallet movement';
    } else {
      const match = lower.match(/could (?:the )?(?:whales? )?(?:just )?(.+?)(?:\?|$)/i);
      if (match && match[1] && !/there be/i.test(match[1])) {
        specificHypothesis = match[1].trim();
      }
    }

    return {
      isChallenge: true,
      category: 'ALTERNATIVE_EXPLANATION',
      specificHypothesis,
    };
  }

  // 3. Contradiction
  if (
    /contradict|evidence against|counter[- ]evidence|conflicting (data|evidence)|is there anything against/i.test(lower)
  ) {
    return {
      isChallenge: true,
      category: 'CONTRADICTION',
    };
  }

  // 4. Evidence Challenge / Proof
  if (
    /prove (it|that|this)|proof/i.test(lower) ||
    /what evidence|evidence for (that|this)|show (me )?(the )?evidence/i.test(lower) ||
    /how do you know|source for (that|this)|where is the data/i.test(lower) ||
    /challenge (that|this)|defend (that|this)/i.test(lower)
  ) {
    return {
      isChallenge: true,
      category: 'EVIDENCE_CHALLENGE',
    };
  }

  // 5. Certainty / Proven / Confidence
  if (
    /are you sure|how sure|how certain|certainty/i.test(lower) ||
    /why do you think|why do you say|how can you conclude/i.test(lower) ||
    /(is that|is this|actually) proven|has that been proven/i.test(lower)
  ) {
    return {
      isChallenge: true,
      category: 'CERTAINTY',
    };
  }

  return {
    isChallenge: false,
  };
}
