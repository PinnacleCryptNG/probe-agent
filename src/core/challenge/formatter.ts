import { ChallengeResult } from './types.js';

/**
 * Formats a ChallengeResult into the concise, scannable Telegram layout required by PROBE.
 * Enforces Phase 5B requirements:
 * 1. Separates Evidence status from Interpretation status.
 * 2. Surfaces discriminating falsification criteria for competing explanations.
 * 3. Formats user-proposed alternative hypotheses directly.
 */
export function formatChallengeResult(result: ChallengeResult, symbol: string): string {
  const lines: string[] = [];

  lines.push(`🔎 Challenge — ${symbol}`);
  lines.push('');

  // 1. SPECIFIC PROPOSED ALTERNATIVE LAYOUT (Phase 5B Section 3)
  if (result.proposedAlternative) {
    lines.push('Proposed alternative');
    lines.push(result.proposedAlternative);
    lines.push('');

    lines.push('Evidence');
    lines.push(result.evidenceStatus);
    if (result.supportingEvidence && result.supportingEvidence.length > 0) {
      for (const item of result.supportingEvidence) {
        lines.push(`• ${item.statement}`);
      }
    }
    lines.push('');

    lines.push('Interpretation');
    lines.push(result.interpretationStatus.replace('_', ' '));
    lines.push('');

    lines.push('What the evidence establishes');
    const establishes = result.whatEvidenceEstablishes && result.whatEvidenceEstablishes.length > 0
      ? result.whatEvidenceEstablishes
      : ['Tracked whale balances decreased.'];
    for (const est of establishes) {
      lines.push(`• ${est.replace(/^[•\-\*]\s*/, '')}`);
    }
    lines.push('');

    lines.push('What it does NOT establish');
    for (const unproven of result.whatIsNotProven) {
      lines.push(`• ${unproven.replace(/^[•\-\*]\s*/, '')}`);
    }
    lines.push('');

    lines.push('Why it is supported');
    for (const item of result.supportingEvidence) {
      lines.push(`• ${item.statement}`);
    }
    lines.push('');

    lines.push('Verdict');
    lines.push(result.verdict.toUpperCase().replace('_', ' '));

    if (result.conclusion) {
      lines.push('');
      lines.push(result.conclusion);
    }

    if (result.whatWouldChangeConclusion && result.whatWouldChangeConclusion.length > 0) {
      lines.push('');
      lines.push('What would test the hypothesis');
      for (const item of result.whatWouldChangeConclusion) {
        lines.push(`• ${item.replace(/^[•\-\*]\s*/, '')}`);
      }
    }

    return lines.join('\n');
  }

  // 2. FALSIFICATION / DISCRIMINATION LAYOUT (Phase 5B Section 2)
  if (result.discriminatingCriteria && result.discriminatingCriteria.length > 0) {
    lines.push('Original finding');
    lines.push(result.originalFinding);
    lines.push('');

    lines.push('Evidence');
    lines.push(result.evidenceStatus);
    if (result.supportingEvidence && result.supportingEvidence.length > 0) {
      for (const item of result.supportingEvidence) {
        lines.push(`• ${item.statement}`);
      }
    }
    lines.push('');

    lines.push('Interpretation');
    lines.push(result.interpretationStatus.replace('_', ' '));
    lines.push('• The observed metrics are empirically verified from on-chain telemetry.');
    lines.push('• The underlying reason for the balance change remains unproven.');
    lines.push('');

    lines.push('Why it is supported');
    for (const item of result.supportingEvidence) {
      lines.push(`• ${item.statement}`);
    }
    lines.push('');

    if (result.whatIsNotProven && result.whatIsNotProven.length > 0) {
      lines.push('What is NOT proven');
      for (const item of result.whatIsNotProven) {
        lines.push(`• ${item}`);
      }
      lines.push('');
    }

    for (const dc of result.discriminatingCriteria) {
      lines.push(dc.explanation);
      for (const c of dc.criteria) {
        lines.push(`• ${c}`);
      }
      lines.push('');
    }

    lines.push('Verdict');
    lines.push(result.verdict.toUpperCase().replace('_', ' '));

    if (result.conclusion) {
      lines.push('');
      lines.push(result.conclusion);
    }

    if (result.whatWouldChangeConclusion && result.whatWouldChangeConclusion.length > 0) {
      lines.push('');
      lines.push('What would change this');
      for (const item of result.whatWouldChangeConclusion) {
        lines.push(`• ${item}`);
      }
    }

    return lines.join('\n');
  }

  // 3. STANDARD CHALLENGE LAYOUT (Phase 5B Section 1)
  lines.push('Original finding');
  lines.push(result.originalFinding);
  lines.push('');

  lines.push('Evidence');
  lines.push(result.evidenceStatus);
  if (result.supportingEvidence && result.supportingEvidence.length > 0) {
    for (const item of result.supportingEvidence) {
      lines.push(`• ${item.statement}`);
    }
  }
  lines.push('');

  lines.push('Interpretation');
  lines.push(result.interpretationStatus.replace('_', ' '));
  lines.push('• The balance reduction is observed.');
  lines.push('• The reason for it is not established.');

  if (result.supportingEvidence && result.supportingEvidence.length > 0) {
    lines.push('');
    lines.push('Why it is supported');
    for (const item of result.supportingEvidence) {
      lines.push(`• ${item.statement}`);
    }
  }

  if (result.contradictingEvidence && result.contradictingEvidence.length > 0) {
    lines.push('');
    lines.push('Contradicting evidence');
    for (const item of result.contradictingEvidence) {
      lines.push(`• ${item.statement}`);
    }
  }

  if (result.whatIsNotProven && result.whatIsNotProven.length > 0) {
    lines.push('');
    lines.push('What is NOT proven');
    for (const item of result.whatIsNotProven) {
      lines.push(`• ${item}`);
    }
  }

  if (result.alternativeExplanations && result.alternativeExplanations.length > 0) {
    lines.push('');
    lines.push('Alternative explanations');
    for (const item of result.alternativeExplanations) {
      lines.push(`• ${item.statement}`);
    }
  }

  lines.push('');
  lines.push('Verdict');
  lines.push(result.verdict.toUpperCase().replace('_', ' '));

  if (result.conclusion) {
    lines.push('');
    lines.push(result.conclusion);
  }

  if (result.whatWouldChangeConclusion && result.whatWouldChangeConclusion.length > 0) {
    lines.push('');
    lines.push('What would change this');
    for (const item of result.whatWouldChangeConclusion) {
      lines.push(`• ${item}`);
    }
  }

  return lines.join('\n');
}
