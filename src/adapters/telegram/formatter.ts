import { deriveEvidenceCategories, deriveNextSuggestions } from '../../core/synthesis/synthesizer.js';
import { InvestigationTurnResult } from '../../core/investigation/types.js';
import { formatChallengeResult } from '../../core/challenge/formatter.js';

/**
 * Renders a structured InvestigationTurnResult into a human-readable Telegram response.
 * Follows the 5-section synthesis structure:
 * 1. Headline / Direct Answer
 * 2. Key Observations (max 3-5 bullets)
 * 3. Interpretation (short paragraph)
 * 4. Evidence (short list of categories/references)
 * 5. Optional Next Question
 */
export function formatInvestigationResult(result: InvestigationTurnResult): string {
  // 1. Clarification needed
  if (result.status === 'needs_clarification') {
    if (result.unresolvedRequirements?.includes('token_context')) {
      return [
        'Which token would you like to investigate?',
        '',
        'Send a token symbol or contract address.',
      ].join('\n');
    }

    const questions =
      result.clarificationQuestions && result.clarificationQuestions.length > 0
        ? result.clarificationQuestions
        : ['Please specify a token symbol or contract address to investigate.'];

    return questions.join('\n\n');
  }

  // 2. Safe error states (Never leak API keys, stack traces, or internal URLs)
  if (result.status === 'failed') {
    const code = result.error?.code;
    if (code === 'PLANNER_ERROR') {
      return '⚠️ PROBE was unable to plan this investigation. Please try rephrasing your question.';
    }
    if (code === 'RATE_LIMIT_ERROR') {
      return '⚠️ On-chain intelligence provider is currently rate-limited. Please wait a moment and try again.';
    }
    if (code === 'EXECUTION_ERROR' || code === 'EVIDENCE_RETRIEVAL_FAILED') {
      return '⚠️ An issue occurred while retrieving on-chain evidence. Please try again shortly.';
    }
    if (code === 'SYNTHESIS_VALIDATION_FAILED') {
      return '⚠️ Findings could not be verified against on-chain evidence. Claim rejected for lack of proof.';
    }
    return '⚠️ An unexpected issue occurred during the investigation. Please try again.';
  }

  const symbol =
    result.target?.type === 'token'
      ? result.target.token.symbol
      : result.target?.type === 'wallet'
      ? result.target.label || `${result.target.address.slice(0, 6)}...${result.target.address.slice(-4)}`
      : result.target?.type === 'chain'
      ? result.target.chainDisplayName
      : result.plan?.tokenContext?.symbol ?? result.token?.symbol ?? 'ETH';

  // Challenge Mode result formatting
  if (result.challenge) {
    return formatChallengeResult(result.challenge, symbol);
  }

  // Capability unavailable on target/chain state
  if (result.status === 'capability_unavailable') {
    const errorMsg = result.error?.message;
    if (errorMsg) return errorMsg;
    return `I couldn't retrieve verified transaction-level data for ${symbol} over this period because the available Nansen capability does not support that query.`;
  }

  // No records found in Nansen's indexed data state
  if (result.status === 'no_records_found') {
    const qLower = (result.question || '').toLowerCase();
    const isTx = /transaction|transfer|swap/i.test(qLower);
    const msg = isTx
      ? `No large transactions were detected for ${symbol} over this period in Nansen's indexed data.`
      : `No matching records were found for ${symbol} over this period in Nansen's indexed data.`;
    return [
      `🔎 ${symbol} — ${result.question}`,
      '',
      msg,
      '',
      `Ask another question about ${symbol}.`,
    ].join('\n');
  }

  // 3. Insufficient evidence state
  if (result.status === 'insufficient_evidence') {
    const lines = [
      "I couldn't establish a reliable explanation from the available on-chain data.",
    ];

    const actualObservations = result.synthesis?.observations ?? [];
    if (actualObservations.length > 0) {
      lines.push('');
      for (const obs of actualObservations.slice(0, 3)) {
        const clean = obs.statement.replace(/^[•\-\*]\s*/, '');
        lines.push(`• ${clean}`);
      }
    }

    lines.push('');
    lines.push(`Ask another question about ${symbol}.`);

    return lines.join('\n');
  }

  // 4. Completed or budget_limited states
  const synthesis = result.synthesis;
  if (!synthesis) {
    return `🔎 ${symbol} — ${result.question}\n\nNo synthesis output available.\n\nAsk another question about ${symbol}.`;
  }

  const lines: string[] = [];

  if (result.status === 'budget_limited') {
    lines.push(
      '⚠️ The investigation reached the available evidence budget. The findings below are based on the evidence retrieved so far:'
    );
    lines.push('');
  }

  lines.push(`🔎 ${symbol} — ${result.question}`);

  // 1. HEADLINE / DIRECT ANSWER FIRST
  const headline =
    synthesis.headline ||
    (synthesis.answer && !synthesis.answer.startsWith('#') && !synthesis.answer.startsWith('🔎')
      ? synthesis.answer.split('\n')[0]
      : synthesis.interpretations?.[0]?.statement ||
        `On-chain evidence for ${symbol} indicates active participant flows during the observed period.`);

  lines.push('');
  lines.push(headline);

  // 2. KEY OBSERVATIONS (Maximum 3–5 bullets)
  if (synthesis.observations && synthesis.observations.length > 0) {
    lines.push('');
    for (const obs of synthesis.observations.slice(0, 5)) {
      const clean = obs.statement.replace(/^[•\-\*]\s*/, '');
      lines.push(`• ${clean}`);
    }
  }

  // 3. INTERPRETATION (One short paragraph)
  const interpretation = synthesis.interpretations?.[0]?.statement;
  if (interpretation && interpretation !== headline) {
    lines.push('');
    lines.push(interpretation);
  }

  // 4. EVIDENCE (Short list of categories/references, never a raw payload dump)
  const categories =
    synthesis.evidenceCategories && synthesis.evidenceCategories.length > 0
      ? synthesis.evidenceCategories
      : deriveEvidenceCategories(result.evidence ?? [], symbol);

  if (categories.length > 0) {
    lines.push('');
    lines.push('Evidence');
    for (const cat of categories) {
      const clean = cat.replace(/^[•\-\*]\s*/, '');
      lines.push(`• ${clean}`);
    }
  }

  // 5. UNCERTAINTY / NOT PROVEN
  if (synthesis.unknowns && synthesis.unknowns.length > 0) {
    lines.push('');
    lines.push('Not Proven');
    for (const unk of synthesis.unknowns) {
      const clean = unk.statement.replace(/^[•\-\*]\s*/, '');
      lines.push(`• ${clean}`);
    }
  }

  // 6. OPTIONAL NEXT QUESTION (Single invitational line)
  lines.push('');
  lines.push(`Ask another question about ${symbol}.`);
  const suggestions = deriveNextSuggestions(result.question, symbol);
  if (suggestions.length > 0) {
    lines.push(`Suggested: ${suggestions.map((q) => `"${q}"`).join(' • ')}`);
  }

  return lines.join('\n');
}

/**
 * Splits a long response string into multiple chunks within Telegram's max message limit.
 * Splits on section/paragraph boundaries (\n\n) or line boundaries (\n) when possible,
 * preserving ordering without truncating or silently discarding content.
 */
export function splitTelegramMessage(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  const paragraphs = text.split('\n\n');
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxLength) {
      // Flush current accumulated chunk
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // Split oversized paragraph by single line breaks
      const lines = paragraph.split('\n');
      for (const line of lines) {
        if (line.length > maxLength) {
          if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
          }
          // Hard split oversized line
          let remaining = line;
          while (remaining.length > maxLength) {
            chunks.push(remaining.slice(0, maxLength));
            remaining = remaining.slice(maxLength);
          }
          if (remaining.length > 0) {
            currentChunk = remaining;
          }
        } else {
          if (currentChunk.length + line.length + 1 > maxLength) {
            chunks.push(currentChunk.trim());
            currentChunk = line;
          } else {
            currentChunk = currentChunk.length > 0 ? `${currentChunk}\n${line}` : line;
          }
        }
      }
    } else {
      if (currentChunk.length + paragraph.length + 2 > maxLength) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } else {
        currentChunk = currentChunk.length > 0 ? `${currentChunk}\n\n${paragraph}` : paragraph;
      }
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
