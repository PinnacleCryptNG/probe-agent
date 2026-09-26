import { InvestigationState } from '../../types/domain.js';
import { InvestigationError } from '../../types/errors.js';

/**
 * Valid state transition graph for PROBE investigations:
 * ASK → PLAN → INVESTIGATE → EVIDENCE → ANSWER → CHALLENGE → FOLLOW UP
 */
const VALID_TRANSITIONS: Record<InvestigationState, InvestigationState[]> = {
  INITIALIZED: ['TOKEN_RESOLVED', 'CLOSED'],
  TOKEN_RESOLVED: ['PLANNING', 'CLOSED'],
  PLANNING: ['INVESTIGATING', 'ANSWERED', 'CLOSED'],
  INVESTIGATING: ['EVIDENCE_READY', 'PLANNING', 'ANSWERED', 'CLOSED'],
  EVIDENCE_READY: ['ANSWERED', 'CLOSED'],
  ANSWERED: ['PLANNING', 'CHALLENGED', 'CLOSED'],
  CHALLENGED: ['PLANNING', 'ANSWERED', 'CLOSED'],
  CLOSED: ['INITIALIZED'], // Re-open or start fresh
};

export function canTransition(currentState: InvestigationState, nextState: InvestigationState): boolean {
  if (currentState === nextState) return true;
  const allowed = VALID_TRANSITIONS[currentState] ?? [];
  return allowed.includes(nextState);
}

export function validateStateTransition(
  investigationId: string,
  currentState: InvestigationState,
  nextState: InvestigationState
): void {
  if (!canTransition(currentState, nextState)) {
    throw new InvestigationError(
      `Illegal investigation state transition from '${currentState}' to '${nextState}'`,
      investigationId,
      { currentState, nextState }
    );
  }
}
