import {
  CreditBudgetExceededError,
  MaxCallsPerTurnExceededError,
} from '../../types/errors.js';
import { logger } from '../../utils/logger.js';

export interface CreditManagerConfig {
  totalBudget: number;
  maxCallsPerTurn: number;
}

export interface CreditUsageRecord {
  estimatedCost: number;
  actualCost?: number;
  investigationId?: string;
  userId?: string;
  capability?: string;
  endpoint?: string;
  timestamp: string;
}

export interface CreditSummary {
  totalBudget: number;
  spentBudget: number;
  remainingBudget: number;
  totalCalls: number;
}

export class CreditBudgetManager {
  private totalBudget: number;
  private maxCallsPerTurn: number;
  private spentBudget = 0;
  private reservedBudget = 0;
  private investigationCosts = new Map<string, number>();
  private userCosts = new Map<string, number>();
  private turnCallCounters = new Map<string, number>();
  private usageHistory: CreditUsageRecord[] = [];

  constructor(config: CreditManagerConfig) {
    this.totalBudget = config.totalBudget;
    this.maxCallsPerTurn = config.maxCallsPerTurn;
  }

  public getRemainingBudget(): number {
    return Math.max(0, this.totalBudget - this.spentBudget - this.reservedBudget);
  }

  public getReservedBudget(): number {
    return this.reservedBudget;
  }

  public getTotalBudget(): number {
    return this.totalBudget;
  }

  public getSpentBudget(): number {
    return this.spentBudget;
  }

  public getMaxCallsPerTurn(): number {
    return this.maxCallsPerTurn;
  }

  /**
   * Pre-execution validation: asserts that sufficient budget remains for the estimated cost.
   * Throws CreditBudgetExceededError if budget is insufficient.
   */
  public assertCanSpend(estimatedCost: number): void {
    const remaining = this.getRemainingBudget();
    if (estimatedCost > remaining) {
      logger.warn('Credit budget exceeded check', {
        estimatedCost,
        remainingBudget: remaining,
      });
      throw new CreditBudgetExceededError(estimatedCost, remaining);
    }
  }

  /**
   * Reserves estimated credits before an async live call begins, preventing concurrent race conditions.
   */
  public reserveCredits(estimatedCost: number): void {
    this.assertCanSpend(estimatedCost);
    this.reservedBudget += estimatedCost;
  }

  /**
   * Releases previously reserved credits when an async live call finishes or fails.
   */
  public releaseReservation(estimatedCost: number): void {
    this.reservedBudget = Math.max(0, this.reservedBudget - estimatedCost);
  }

  /**
   * Enforces the hard limit of Nansen calls permitted per conversational user turn.
   */
  public recordTurnCall(turnKey: string): void {
    const currentCalls = this.turnCallCounters.get(turnKey) ?? 0;
    if (currentCalls >= this.maxCallsPerTurn) {
      logger.warn('Turn call limit exceeded', { turnKey, currentCalls, maxCalls: this.maxCallsPerTurn });
      throw new MaxCallsPerTurnExceededError(currentCalls + 1, this.maxCallsPerTurn);
    }
    this.turnCallCounters.set(turnKey, currentCalls + 1);
  }

  public getTurnCallCount(turnKey: string): number {
    return this.turnCallCounters.get(turnKey) ?? 0;
  }

  public resetTurn(turnKey: string): void {
    this.turnCallCounters.delete(turnKey);
  }

  /**
   * Records actual or estimated credit consumption, updating system, per-investigation,
   * and per-user balances.
   */
  public recordUsage(usage: {
    estimatedCost: number;
    actualCost?: number;
    investigationId?: string;
    userId?: string;
    capability?: string;
    endpoint?: string;
  }): void {
    const costToCharge = usage.actualCost !== undefined ? usage.actualCost : usage.estimatedCost;

    if (this.reservedBudget > 0) {
      this.reservedBudget = Math.max(0, this.reservedBudget - usage.estimatedCost);
    }

    this.spentBudget += costToCharge;

    if (usage.investigationId) {
      const currentInvCost = this.investigationCosts.get(usage.investigationId) ?? 0;
      this.investigationCosts.set(usage.investigationId, currentInvCost + costToCharge);
    }

    if (usage.userId) {
      const currentUserCost = this.userCosts.get(usage.userId) ?? 0;
      this.userCosts.set(usage.userId, currentUserCost + costToCharge);
    }

    const record: CreditUsageRecord = {
      estimatedCost: usage.estimatedCost,
      actualCost: usage.actualCost,
      investigationId: usage.investigationId,
      userId: usage.userId,
      capability: usage.capability,
      endpoint: usage.endpoint,
      timestamp: new Date().toISOString(),
    };
    this.usageHistory.push(record);

    logger.info('Credit cost recorded', {
      investigationId: usage.investigationId,
      capability: usage.capability,
      creditCost: costToCharge,
      creditsRemaining: this.getRemainingBudget(),
    });
  }

  public getInvestigationCost(investigationId: string): number {
    return this.investigationCosts.get(investigationId) ?? 0;
  }

  public getUserCost(userId: string): number {
    return this.userCosts.get(userId) ?? 0;
  }

  public getSummary(): CreditSummary {
    return {
      totalBudget: this.totalBudget,
      spentBudget: this.spentBudget,
      remainingBudget: this.getRemainingBudget(),
      totalCalls: this.usageHistory.length,
    };
  }

  public reset(): void {
    this.spentBudget = 0;
    this.reservedBudget = 0;
    this.investigationCosts.clear();
    this.userCosts.clear();
    this.turnCallCounters.clear();
    this.usageHistory = [];
  }
}
