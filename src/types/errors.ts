/**
 * Domain and external service typed errors for PROBE.
 */

export abstract class ProbeError extends Error {
  public abstract readonly code: string;
  public readonly timestamp: string;

  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NansenAuthenticationError extends ProbeError {
  public readonly code = 'NANSEN_AUTH_ERROR';

  constructor(message = 'Invalid or missing Nansen API key (401/403)', details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class NansenRateLimitError extends ProbeError {
  public readonly code = 'NANSEN_RATE_LIMIT_ERROR';

  constructor(
    message = 'Nansen rate limit reached (429)',
    public readonly retryAfterSeconds?: number,
    details?: Record<string, unknown>
  ) {
    super(message, { ...details, retryAfterSeconds });
  }
}

export class NansenCreditError extends ProbeError {
  public readonly code = 'NANSEN_CREDIT_ERROR';

  constructor(
    message = 'Insufficient Nansen API credits or credit limit reached',
    public readonly creditsRemaining?: number,
    details?: Record<string, unknown>
  ) {
    super(message, { ...details, creditsRemaining });
  }
}

export class NansenValidationError extends ProbeError {
  public readonly code = 'NANSEN_VALIDATION_ERROR';

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class NansenUnavailableError extends ProbeError {
  public readonly code = 'NANSEN_UNAVAILABLE_ERROR';

  constructor(message = 'Nansen API endpoint unavailable or timed out', details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class UnsupportedChainError extends ProbeError {
  public readonly code = 'UNSUPPORTED_CHAIN_ERROR';

  constructor(public readonly chain: string, public readonly capability?: string) {
    super(
      `Chain '${chain}' is not supported${capability ? ` for capability '${capability}'` : ''}.`,
      { chain, capability }
    );
  }
}

export class UnsupportedCapabilityError extends ProbeError {
  public readonly code = 'UNSUPPORTED_CAPABILITY_ERROR';

  constructor(public readonly capability: string) {
    super(`Capability '${capability}' is not supported or not enabled.`, { capability });
  }
}

export class CreditBudgetExceededError extends ProbeError {
  public readonly code = 'CREDIT_BUDGET_EXCEEDED_ERROR';

  constructor(
    public readonly requestedCost: number,
    public readonly remainingBudget: number,
    details?: Record<string, unknown>
  ) {
    super(
      `Credit budget exceeded: requested cost ${requestedCost} credits, but only ${remainingBudget} credits remain in budget.`,
      { ...details, requestedCost, remainingBudget }
    );
  }
}

export class MaxCallsPerTurnExceededError extends ProbeError {
  public readonly code = 'MAX_CALLS_PER_TURN_EXCEEDED';

  constructor(public readonly currentCalls: number, public readonly maxCalls: number) {
    super(
      `Exceeded maximum allowed Nansen calls per turn: attempted ${currentCalls}, maximum is ${maxCalls}.`,
      { currentCalls, maxCalls }
    );
  }
}

export class InvestigationError extends ProbeError {
  public readonly code = 'INVESTIGATION_ERROR';

  constructor(message: string, public readonly investigationId?: string, details?: Record<string, unknown>) {
    super(message, { ...details, investigationId });
  }
}
