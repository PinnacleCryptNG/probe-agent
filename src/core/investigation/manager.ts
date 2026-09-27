import {
  Finding,
  Hypothesis,
  Investigation,
  InvestigationMessage,
  InvestigationState,
  InvestigationTarget,
  TimelineEvent,
  TokenContext,
} from '../../types/domain.js';
import { EvidenceItem } from '../../types/evidence.js';
import { InvestigationError } from '../../types/errors.js';
import { generateId } from '../../utils/ids.js';
import { logger } from '../../utils/logger.js';
import { validateStateTransition } from './state.js';

export interface CreateInvestigationParams {
  telegramChatId: number | string;
  token?: TokenContext;
  target?: InvestigationTarget;
  initialQuestion?: string;
}

export class InvestigationManager {
  private investigations = new Map<string, Investigation>();
  private activeByChatId = new Map<string, string>();

  /**
   * Initializes a new investigation instance for a resolved target (token, chain, or wallet).
   */
  public createInvestigation(params: CreateInvestigationParams): Investigation {
    const id = generateId('inv');
    const now = new Date().toISOString();

    const target: InvestigationTarget =
      params.target ??
      (params.token
        ? {
            type: 'token',
            token: params.token,
            chain: params.token.chain,
            rawIdentifier: params.token.symbol,
          }
        : {
            type: 'token',
            token: {
              address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
              symbol: 'ETH',
              name: 'Ethereum',
              chain: 'ethereum',
              resolvedAt: now,
            },
            chain: 'ethereum',
            rawIdentifier: 'ETH',
          });

    const token = target.type === 'token' ? target.token : params.token;
    const chain = target.chain;

    let summary = `Investigation started for ${chain}`;
    const details: Record<string, unknown> = { chain };

    if (target.type === 'token') {
      summary = `Investigation started for ${target.token.symbol} (${target.token.name}) on ${target.chain}`;
      details.tokenAddress = target.token.address;
    } else if (target.type === 'chain') {
      summary = `Investigation started for chain scope ${target.chainDisplayName} (${target.chain})`;
    } else if (target.type === 'wallet') {
      summary = `Investigation started for wallet ${target.address} on ${target.chain}`;
      details.walletAddress = target.address;
    }

    const investigation: Investigation = {
      id,
      telegramChatId: params.telegramChatId,
      token,
      target,
      chain,
      initialQuestion: params.initialQuestion ?? '',
      currentQuestion: params.initialQuestion ?? '',
      state: 'TOKEN_RESOLVED',
      messages: [],
      evidence: [],
      findings: [],
      hypotheses: [],
      openQuestions: [],
      timeline: [
        {
          id: generateId('evnt'),
          timestamp: now,
          eventType: 'INVESTIGATION_INITIALIZED',
          summary,
          details,
        },
      ],
      totalCreditsUsed: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.investigations.set(id, investigation);
    this.activeByChatId.set(String(params.telegramChatId), id);

    logger.info('Investigation started', {
      investigationId: id,
      chatId: params.telegramChatId,
      targetType: target.type,
      chain: target.chain,
      symbol: token?.symbol,
    });

    return investigation;
  }

  public updateInvestigationTarget(id: string, target: InvestigationTarget): void {
    const inv = this.getRequiredInvestigation(id);
    inv.target = target;
    inv.chain = target.chain;
    if (target.type === 'token') {
      inv.token = target.token;
    }
    inv.updatedAt = new Date().toISOString();
  }

  public getInvestigation(id: string): Investigation | undefined {
    return this.investigations.get(id);
  }

  public getRequiredInvestigation(id: string): Investigation {
    const inv = this.getInvestigation(id);
    if (!inv) {
      throw new InvestigationError(`Investigation not found: ${id}`, id);
    }
    return inv;
  }

  public getActiveInvestigationByChatId(chatId: number | string): Investigation | undefined {
    const invId = this.activeByChatId.get(String(chatId));
    if (!invId) return undefined;
    return this.investigations.get(invId);
  }

  public clearActiveInvestigation(chatId: number | string): void {
    const invId = this.activeByChatId.get(String(chatId));
    if (invId) {
      try {
        const inv = this.investigations.get(invId);
        if (inv && inv.state !== 'CLOSED') {
          this.transitionState(invId, 'CLOSED');
        }
      } catch {
        // Safe closure
      }
      this.activeByChatId.delete(String(chatId));
    }
  }

  public transitionState(investigationId: string, nextState: InvestigationState): void {
    const inv = this.getRequiredInvestigation(investigationId);
    validateStateTransition(investigationId, inv.state, nextState);

    const prevState = inv.state;
    inv.state = nextState;
    inv.updatedAt = new Date().toISOString();

    logger.info('Investigation state changed', {
      investigationId,
      from: prevState,
      to: nextState,
    });
  }

  public addMessage(
    investigationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: Record<string, unknown>
  ): InvestigationMessage {
    const inv = this.getRequiredInvestigation(investigationId);
    const msg: InvestigationMessage = {
      id: generateId('msg'),
      investigationId,
      role,
      content,
      timestamp: new Date().toISOString(),
      metadata,
    };

    inv.messages.push(msg);
    inv.updatedAt = new Date().toISOString();

    if (role === 'user') {
      inv.currentQuestion = content;
      if (!inv.initialQuestion) {
        inv.initialQuestion = content;
      }
      logger.info('Question received', {
        investigationId,
        questionLength: content.length,
      });
    }

    return msg;
  }

  public addEvidence(investigationId: string, evidence: EvidenceItem): void {
    const inv = this.getRequiredInvestigation(investigationId);
    inv.evidence.push(evidence);
    inv.updatedAt = new Date().toISOString();

    this.addTimelineEvent(investigationId, {
      timestamp: new Date().toISOString(),
      eventType: 'EVIDENCE_STORED',
      summary: `Evidence gathered from ${evidence.provenance.capability}: ${evidence.title}`,
      details: {
        evidenceId: evidence.evidenceId,
        epistemicStatus: evidence.epistemicStatus,
      },
      evidenceReferenceId: evidence.evidenceId,
    });

    logger.info('Evidence stored', {
      investigationId,
      evidenceId: evidence.evidenceId,
      capability: evidence.provenance.capability,
      epistemicStatus: evidence.epistemicStatus,
    });
  }

  public addFinding(investigationId: string, finding: Finding): void {
    const inv = this.getRequiredInvestigation(investigationId);
    inv.findings.push(finding);
    inv.updatedAt = new Date().toISOString();
  }

  public setHypotheses(investigationId: string, hypotheses: Hypothesis[]): void {
    const inv = this.getRequiredInvestigation(investigationId);
    inv.hypotheses = hypotheses;
    inv.updatedAt = new Date().toISOString();
  }

  public setOpenQuestions(investigationId: string, openQuestions: string[]): void {
    const inv = this.getRequiredInvestigation(investigationId);
    inv.openQuestions = openQuestions;
    inv.updatedAt = new Date().toISOString();
  }

  public addTimelineEvent(
    investigationId: string,
    event: Omit<TimelineEvent, 'id'>
  ): TimelineEvent {
    const inv = this.getRequiredInvestigation(investigationId);
    const fullEvent: TimelineEvent = {
      id: generateId('evnt'),
      ...event,
    };
    inv.timeline.push(fullEvent);
    inv.updatedAt = new Date().toISOString();
    return fullEvent;
  }

  public recordCredits(investigationId: string, credits: number): void {
    const inv = this.getRequiredInvestigation(investigationId);
    inv.totalCreditsUsed += credits;
    inv.updatedAt = new Date().toISOString();
  }
}

export const investigationManager = new InvestigationManager();
