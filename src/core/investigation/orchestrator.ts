import { TokenContext } from '../../types/domain.js';
import { EvidenceItem } from '../../types/evidence.js';
import { generateId } from '../../utils/ids.js';
import { logger } from '../../utils/logger.js';
import { ExecutionContext, ExecutionResult } from '../evidence/types.js';
import { EvidenceExecutor } from '../evidence/executor.js';
import { InvestigationPlanner } from '../planner/planner.js';
import { InvestigationPlan, PlannerContext } from '../planner/types.js';
import { EvidenceSynthesisEngine } from '../synthesis/synthesizer.js';
import { SynthesisRequest, SynthesisResult } from '../synthesis/types.js';
import { InvestigationManager, investigationManager as defaultManager } from './manager.js';
import { InvestigationTurnRequest, InvestigationTurnResult } from './types.js';
import { ITargetResolver, defaultTargetResolver, InvestigationTarget } from '../target/index.js';
import { getNativeAssetForChain } from '../target/native-assets.js';
import { isFuturePricePrediction } from '../planner/prediction.js';
import { truncateAddress } from '../synthesis/formatting.js';

import { detectChallenge } from '../challenge/detector.js';
import { ChallengeSynthesizer } from '../challenge/synthesizer.js';
import { formatChallengeResult } from '../challenge/formatter.js';
import { profiler } from '../../utils/profiler.js';

export interface InvestigationOrchestratorDependencies {
  planner: InvestigationPlanner;
  executor: EvidenceExecutor;
  synthesizer: EvidenceSynthesisEngine;
  challengeSynthesizer?: ChallengeSynthesizer;
  investigationManager?: InvestigationManager;
  manager?: InvestigationManager;
  targetResolver?: ITargetResolver;
}

/**
 * InvestigationOrchestrator represents one complete PROBE investigation turn:
 * User Question
 *   ↓
 * TargetResolver (source of truth for current turn)
 *   ↓
 * InvestigationPlanner
 *   ↓
 * EvidenceExecutor
 *   ↓
 * EvidenceSynthesisEngine (with EvidenceValidator)
 *   ↓
 * Investigation State
 *   ↓
 * SynthesisResult / InvestigationTurnResult
 */
export class InvestigationOrchestrator {
  private readonly planner: InvestigationPlanner;
  private readonly executor: EvidenceExecutor;
  private readonly synthesizer: EvidenceSynthesisEngine;
  private readonly challengeSynthesizer: ChallengeSynthesizer;
  private readonly manager: InvestigationManager;
  private readonly targetResolver: ITargetResolver;

  constructor(deps: InvestigationOrchestratorDependencies) {
    this.planner = deps.planner;
    this.executor = deps.executor;
    this.synthesizer = deps.synthesizer;
    this.challengeSynthesizer = deps.challengeSynthesizer ?? new ChallengeSynthesizer();
    this.manager = deps.investigationManager ?? deps.manager ?? defaultManager;
    this.targetResolver = deps.targetResolver ?? defaultTargetResolver;
  }

  /**
   * Executes a bounded, deterministic investigation turn for a user question.
   */
  public async executeTurn(request: InvestigationTurnRequest): Promise<InvestigationTurnResult> {
    const turnId = generateId('turn');
    const trimmedQuestion = request.question.trim();

    logger.info('Starting investigation turn', {
      turnId,
      investigationId: request.investigationId,
      chatId: request.chatId,
      question: trimmedQuestion,
    });

    // 1. Resolve or initialize investigation state
    let investigationId = request.investigationId;
    let existingInv = investigationId
      ? this.manager.getInvestigation(investigationId)
      : request.chatId !== undefined
      ? this.manager.getActiveInvestigationByChatId(request.chatId)
      : undefined;

    if (investigationId && !existingInv) {
      logger.warn('Investigation not found', { investigationId });
      return {
        investigationId,
        turnId,
        status: 'failed',
        question: trimmedQuestion,
        evidence: [],
        error: {
          code: 'INVESTIGATION_NOT_FOUND',
          message: `Investigation '${investigationId}' was not found in active state.`,
        },
      };
    }

    if (existingInv && !investigationId) {
      investigationId = existingInv.id;
    }

    // Determine existing target context
    const existingTarget: InvestigationTarget | undefined =
      request.target ??
      existingInv?.target ??
      (request.token
        ? { type: 'token', token: request.token, chain: request.token.chain, rawIdentifier: request.token.symbol }
        : existingInv?.token
        ? { type: 'token', token: existingInv.token, chain: existingInv.token.chain, rawIdentifier: existingInv.token.symbol }
        : undefined);

    // Run deterministic target resolution before planner (Precedence Rules 1-4)
    const resolution = await this.targetResolver.resolve({
      question: trimmedQuestion,
      existingTarget,
      chatId: request.chatId,
    });

    if (resolution.status === 'AMBIGUOUS') {
      logger.info('Turn needs clarification: ambiguous target symbol', { candidate: resolution.candidateIdentifier });
      const clarMsg =
        resolution.clarificationMessage ??
        (resolution.availableChains && resolution.availableChains.length > 0
          ? `The symbol '${resolution.candidateIdentifier}' exists on multiple chains (${resolution.availableChains.join(', ')}). Please specify the chain (e.g. '${resolution.candidateIdentifier} on ${resolution.availableChains[0]}').`
          : `Which chain for ${resolution.candidateIdentifier}?`);

      return {
        investigationId: existingInv?.id ?? '',
        turnId,
        status: 'needs_clarification',
        question: trimmedQuestion,
        evidence: [],
        clarificationQuestions: [clarMsg],
        unresolvedRequirements: ['token_context'],
      };
    }

    if (resolution.status === 'NEEDS_TARGET') {
      logger.info('Turn needs clarification: missing target');
      return {
        investigationId: existingInv?.id ?? '',
        turnId,
        status: 'needs_clarification',
        question: trimmedQuestion,
        evidence: [],
        clarificationQuestions: [
          resolution.clarificationMessage ??
            'Which token would you like to investigate? Please specify a token contract address or symbol.',
        ],
        unresolvedRequirements: ['token_context'],
      };
    }

    if (resolution.status === 'INVALID_ADDRESS') {
      logger.info('Turn needs clarification: invalid target address');
      return {
        investigationId: existingInv?.id ?? '',
        turnId,
        status: 'needs_clarification',
        question: trimmedQuestion,
        evidence: [],
        clarificationQuestions: [
          resolution.clarificationMessage ?? 'The provided address is invalid. Please check the contract address.',
        ],
        unresolvedRequirements: ['invalid_address'],
      };
    }

    if (resolution.status !== 'RESOLVED') {
      return {
        investigationId: existingInv?.id ?? '',
        turnId,
        status: 'needs_clarification',
        question: trimmedQuestion,
        evidence: [],
        clarificationQuestions: ['Which token, chain, or wallet would you like to investigate?'],
        unresolvedRequirements: ['token_context'],
      };
    }

    const resolvedTarget = resolution.target;

    // Check if user explicitly switched to a new target
    const isNewTarget =
      !existingInv ||
      (resolvedTarget.type === 'token'
        ? !existingInv.token ||
          existingInv.token.symbol !== resolvedTarget.token.symbol ||
          existingInv.token.chain !== resolvedTarget.token.chain
        : resolvedTarget.type === 'chain'
        ? !existingInv.target ||
          existingInv.target.type !== 'chain' ||
          existingInv.target.chain !== resolvedTarget.chain
        : !existingInv.target ||
          existingInv.target.type !== 'wallet' ||
          existingInv.target.address.toLowerCase() !== resolvedTarget.address.toLowerCase());

    if (isNewTarget && resolution.source !== 'existing_context') {
      if (request.chatId !== undefined) {
        this.manager.clearActiveInvestigation(request.chatId);
      }
      const newInv = this.manager.createInvestigation({
        telegramChatId: request.chatId ?? 'default_chat',
        target: resolvedTarget,
        token: resolvedTarget.type === 'token' ? resolvedTarget.token : undefined,
        initialQuestion: trimmedQuestion,
      });
      investigationId = newInv.id;
      existingInv = newInv;
    } else if (!investigationId && !existingInv) {
      const newInv = this.manager.createInvestigation({
        telegramChatId: request.chatId ?? 'default_chat',
        target: resolvedTarget,
        token: resolvedTarget.type === 'token' ? resolvedTarget.token : undefined,
        initialQuestion: trimmedQuestion,
      });
      investigationId = newInv.id;
      existingInv = newInv;
    }

    const currentInv = this.manager.getRequiredInvestigation(investigationId!);
    if (!currentInv.target && resolvedTarget) {
      this.manager.updateInvestigationTarget(currentInv.id, resolvedTarget);
    }

    let effectiveToken: TokenContext | undefined;
    let tokenCtxForSynthesis: TokenContext;

    if (resolvedTarget.type === 'token') {
      effectiveToken = resolvedTarget.token;
      tokenCtxForSynthesis = resolvedTarget.token;
    } else if (resolvedTarget.type === 'chain') {
      effectiveToken = undefined;
      const native = getNativeAssetForChain(resolvedTarget.chain);
      tokenCtxForSynthesis = {
        address: native?.address ?? '0x0000000000000000000000000000000000000000',
        symbol: native?.ticker ?? resolvedTarget.chainDisplayName.toUpperCase(),
        name: resolvedTarget.chainDisplayName,
        chain: resolvedTarget.chain as any,
        resolvedAt: new Date().toISOString(),
        decimals: 18,
      };
    } else {
      effectiveToken = currentInv.token;
      tokenCtxForSynthesis = effectiveToken ?? {
        address: resolvedTarget.address,
        symbol: resolvedTarget.label || truncateAddress(resolvedTarget.address),
        name: resolvedTarget.label || truncateAddress(resolvedTarget.address),
        chain: resolvedTarget.chain as any,
        resolvedAt: new Date().toISOString(),
        decimals: 18,
      };
    }

    // Capture prior conversation history before recording the new user question
    const priorHistory = [...currentInv.messages];

    // Record user question in conversation history
    this.manager.addMessage(currentInv.id, 'user', trimmedQuestion);

    // Transition state to PLANNING
    try {
      this.manager.transitionState(currentInv.id, 'PLANNING');
    } catch {
      // If already in PLANNING, transition is a no-op
    }

    this.manager.addTimelineEvent(currentInv.id, {
      timestamp: new Date().toISOString(),
      eventType: 'TURN_STARTED',
      summary: `User asked: "${trimmedQuestion}"`,
      details: { turnId, question: trimmedQuestion },
    });

    // 1.5. Detect and route Challenge Mode intents
    const challengeDetection = detectChallenge(trimmedQuestion);
    if (challengeDetection.isChallenge) {
      logger.info('Challenge intent detected; routing to challenge synthesis', {
        investigationId: currentInv.id,
        category: challengeDetection.category,
        question: trimmedQuestion,
      });

      // Find original finding from previous findings / messages
      let originalFinding: string | undefined;
      const qLower = trimmedQuestion.toLowerCase();

      if (currentInv.findings.length > 0) {
        if (/whale/i.test(qLower)) {
          const wf = currentInv.findings.find((f) => /whale/i.test(f.claim));
          if (wf) originalFinding = wf.claim;
        } else if (/smart money/i.test(qLower)) {
          const smf = currentInv.findings.find((f) => /smart money/i.test(f.claim));
          if (smf) originalFinding = smf.claim;
        } else if (/buy/i.test(qLower)) {
          const bf = currentInv.findings.find((f) => /buyer|accumulat/i.test(f.claim));
          if (bf) originalFinding = bf.claim;
        } else if (/sell/i.test(qLower)) {
          const sf = currentInv.findings.find((f) => /seller|exchange/i.test(f.claim));
          if (sf) originalFinding = sf.claim;
        }
        if (!originalFinding) {
          originalFinding = currentInv.findings[0].claim;
        }
      }

      if (!originalFinding && currentInv.messages.length > 0) {
        const lastAssistantMsg = [...currentInv.messages].reverse().find((m) => m.role === 'assistant');
        if (lastAssistantMsg) {
          const lines = lastAssistantMsg.content
            .split('\n')
            .filter((l) => l.trim().length > 0 && !l.startsWith('🔎') && !l.startsWith('•'));
          if (lines.length > 0) {
            originalFinding = lines[0];
          }
        }
      }

      const challengeResult = this.challengeSynthesizer.synthesizeChallenge({
        investigationId: currentInv.id,
        question: trimmedQuestion,
        tokenContext: effectiveToken ?? tokenCtxForSynthesis,
        evidence: currentInv.evidence,
        originalFinding,
        findings: currentInv.findings,
        hypotheses: currentInv.hypotheses,
        category: challengeDetection.category,
        specificHypothesis: challengeDetection.specificHypothesis,
      });

      const formatted = formatChallengeResult(challengeResult, effectiveToken?.symbol ?? tokenCtxForSynthesis.symbol);

      this.manager.addMessage(currentInv.id, 'assistant', formatted, {
        turnId,
        isChallenge: true,
        category: challengeDetection.category,
        verdict: challengeResult.verdict,
      });

      try {
        this.manager.transitionState(currentInv.id, 'ANSWERED');
      } catch {
        // Safe transition
      }

      this.manager.addTimelineEvent(currentInv.id, {
        timestamp: new Date().toISOString(),
        eventType: 'CHALLENGE_ADDRESSED',
        summary: `Challenge processed: ${challengeResult.verdict}`,
        details: {
          turnId,
          category: challengeDetection.category,
          verdict: challengeResult.verdict,
        },
      });

      return {
        investigationId: currentInv.id,
        turnId,
        status: challengeResult.verdict === 'insufficient_evidence' ? 'insufficient_evidence' : 'completed',
        question: trimmedQuestion,
        target: resolvedTarget,
        token: effectiveToken,
        evidence: currentInv.evidence,
        challenge: challengeResult,
      };
    }

    // 2. Pass question and context to InvestigationPlanner
    const plannerContext: PlannerContext = {
      token: effectiveToken,
      target: resolvedTarget,
      conversationHistory: priorHistory,
      activeFindings: currentInv.findings,
      remainingCredits: request.remainingCredits,
      maxCallsAllowed: request.maxCallsAllowed,
      targetWalletAddress:
        resolvedTarget.type === 'wallet' ? resolvedTarget.address : request.targetWalletAddress,
    };

    let plan: InvestigationPlan;
    try {
      const tPlanStart = Date.now();
      plan = await this.planner.plan(plannerContext, trimmedQuestion);
      const tPlanEnd = Date.now();
      profiler.recordStage('3. Investigation planning', tPlanStart, tPlanEnd, {
        intent: plan.intent,
        selectedCapabilities: plan.selectedCapabilities,
      });
    } catch (plannerErr) {
      const errMsg = plannerErr instanceof Error ? plannerErr.message : String(plannerErr);
      logger.error('Planner execution failed', {
        investigationId: currentInv.id,
        turnId,
        error: errMsg,
      });
      return {
        investigationId: currentInv.id,
        turnId,
        status: 'failed',
        question: trimmedQuestion,
        target: resolvedTarget,
        token: effectiveToken,
        evidence: [],
        error: {
          code: 'PLANNER_ERROR',
          message: `Investigation planner failure: ${errMsg}`,
        },
      };
    }

    // 3. Check for unresolved requirements that prevent safe execution or speculative queries
    const isSpeculative = plan.intent === 'unknown';
    const hasNoPlannedCapabilities = plan.plannedCapabilities.length === 0;
    const hasUnresolvedRequired = plan.evidenceRequirements.some(
      (r) => r.priority === 'required' && !r.resolvedCapability
    );

    if (isSpeculative || hasNoPlannedCapabilities || hasUnresolvedRequired) {
      logger.info('Plan requires clarification or cannot be executed on-chain', {
        investigationId: currentInv.id,
        intent: plan.intent,
        plannedCount: plan.plannedCapabilities.length,
        unresolvedCount: plan.unresolvedRequirements.length,
      });

      const clarificationQuestions = this.formulateClarificationQuestions(plan, effectiveToken ?? tokenCtxForSynthesis);

      // Record assistant clarification response
      this.manager.addMessage(currentInv.id, 'assistant', clarificationQuestions.join('\n'), {
        turnId,
        needsClarification: true,
        unresolvedRequirements: plan.unresolvedRequirements,
      });

      this.manager.addTimelineEvent(currentInv.id, {
        timestamp: new Date().toISOString(),
        eventType: 'CLARIFICATION_REQUESTED',
        summary: `Clarification needed: ${clarificationQuestions[0]}`,
        details: { turnId, unresolved: plan.unresolvedRequirements },
      });

      try {
        this.manager.transitionState(currentInv.id, 'ANSWERED');
      } catch {
        // State remains in current valid state
      }

      return {
        investigationId: currentInv.id,
        turnId,
        status: 'needs_clarification',
        question: trimmedQuestion,
        target: resolvedTarget,
        token: effectiveToken,
        plan,
        evidence: [],
        clarificationQuestions,
        unresolvedRequirements: plan.unresolvedRequirements,
      };
    }

    // 4. Execute planned capabilities through EvidenceExecutor
    try {
      this.manager.transitionState(currentInv.id, 'INVESTIGATING');
    } catch {
      // Transition if allowed
    }

    await request.onProgress?.('token_identified');

    const executableReqs = this.planner.toExecutableRequirements(plan);
    const execContext: ExecutionContext = {
      investigationId: currentInv.id,
      turnKey: `${currentInv.id}:${turnId}`,
      tokenAddress: effectiveToken?.address,
      chain: effectiveToken?.chain ?? resolvedTarget.chain ?? 'ethereum',
      walletAddress: resolvedTarget.type === 'wallet' ? resolvedTarget.address : request.targetWalletAddress,
      userId: request.userId,
    };

    let executionResults: ExecutionResult[];
    try {
      executionResults = await this.executor.executeMany(executableReqs, execContext);
      await request.onProgress?.('activity_analyzed');
    } catch (execErr) {
      const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
      logger.error('Evidence execution unexpected failure', {
        investigationId: currentInv.id,
        turnId,
        error: errMsg,
      });
      return {
        investigationId: currentInv.id,
        turnId,
        status: 'failed',
        question: trimmedQuestion,
        target: resolvedTarget,
        token: effectiveToken,
        plan,
        evidence: [],
        error: {
          code: 'EXECUTION_ERROR',
          message: `Evidence execution failed: ${errMsg}`,
        },
      };
    }

    // 5. Collect evidence items and track budget / execution errors
    const retrievedEvidence: EvidenceItem[] = [];
    const executionErrors: string[] = [];
    let isBudgetLimited = false;
    let isRateLimited = false;

    for (const res of executionResults) {
      if (res.evidence && res.evidence.length > 0) {
        retrievedEvidence.push(...res.evidence);
        for (const ev of res.evidence) {
          this.manager.addEvidence(currentInv.id, ev);
        }
      }

      if (!res.success) {
        executionErrors.push(...res.errors);
        for (const err of res.errors) {
          const lower = err.toLowerCase();
          if (lower.includes('budget') || lower.includes('credit limit') || lower.includes('maximum allowed')) {
            isBudgetLimited = true;
          }
          if (lower.includes('rate limit') || lower.includes('429')) {
            isRateLimited = true;
          }
        }
      }
    }

    // 6. Handle empty evidence scenarios
    if (retrievedEvidence.length === 0) {
      logger.warn('No evidence retrieved from planned execution', {
        investigationId: currentInv.id,
        turnId,
        executionErrors,
      });

      // Synthesize empty evidence to produce grounded unknown response
      await request.onProgress?.('building_report');
      const emptySynthesis = await this.synthesizer.synthesize({
        question: trimmedQuestion,
        investigationId: currentInv.id,
        tokenContext: tokenCtxForSynthesis,
        target: resolvedTarget,
        plan,
        evidence: [],
        conversationHistory: currentInv.messages,
        activeFindings: currentInv.findings,
      });

      this.manager.addMessage(currentInv.id, 'assistant', emptySynthesis.answer, {
        turnId,
        emptyEvidence: true,
        isBudgetLimited,
      });

      try {
        this.manager.transitionState(currentInv.id, 'ANSWERED');
      } catch {
        // Safe transition
      }

      const finalStatus = isBudgetLimited
        ? 'budget_limited'
        : isRateLimited || executionErrors.length > 0
        ? 'insufficient_evidence'
        : 'insufficient_evidence';

      return {
        investigationId: currentInv.id,
        turnId,
        status: finalStatus,
        question: trimmedQuestion,
        target: resolvedTarget,
        token: effectiveToken,
        plan,
        evidence: [],
        synthesis: emptySynthesis,
        unresolvedRequirements: [
          ...plan.unresolvedRequirements,
          ...(executionErrors.length > 0 ? executionErrors : ['No on-chain records returned']),
        ],
        error: executionErrors.length > 0 ? {
          code: isRateLimited ? 'RATE_LIMIT_ERROR' : isBudgetLimited ? 'BUDGET_EXCEEDED' : 'EVIDENCE_RETRIEVAL_FAILED',
          message: executionErrors.join('; '),
        } : undefined,
      };
    }

    // 7. Pass retrieved evidence to EvidenceSynthesisEngine
    try {
      this.manager.transitionState(currentInv.id, 'EVIDENCE_READY');
    } catch {
      // Transition if allowed
    }

    const synthesisRequest: SynthesisRequest = {
      question: trimmedQuestion,
      investigationId: currentInv.id,
      tokenContext: tokenCtxForSynthesis,
      target: resolvedTarget,
      plan,
      evidence: retrievedEvidence,
      conversationHistory: currentInv.messages,
      activeFindings: currentInv.findings,
    };

    let synthesis: SynthesisResult;
    try {
      await request.onProgress?.('building_report');
      synthesis = await this.synthesizer.synthesize(synthesisRequest);
    } catch (synthErr) {
      const errMsg = synthErr instanceof Error ? synthErr.message : String(synthErr);
      logger.error('Synthesis engine execution error', {
        investigationId: currentInv.id,
        turnId,
        error: errMsg,
      });
      return {
        investigationId: currentInv.id,
        turnId,
        status: 'failed',
        question: trimmedQuestion,
        target: resolvedTarget,
        token: effectiveToken,
        plan,
        evidence: retrievedEvidence,
        error: {
          code: 'SYNTHESIS_ERROR',
          message: `Synthesis engine error: ${errMsg}`,
        },
      };
    }

    // 8. Handle synthesis validation failure safely
    if (!synthesis.success) {
      logger.error('Synthesis validation failed; returning structured failure', {
        investigationId: currentInv.id,
        validationErrors: synthesis.validationErrors,
      });
      return {
        investigationId: currentInv.id,
        turnId,
        status: 'failed',
        question: trimmedQuestion,
        target: resolvedTarget,
        token: effectiveToken,
        plan,
        evidence: retrievedEvidence,
        synthesis,
        error: {
          code: 'SYNTHESIS_VALIDATION_FAILED',
          message: synthesis.validationErrors?.join('; ') ?? 'Synthesis validation failed',
        },
      };
    }

    // 9. Persist verified results to investigation state
    this.manager.addMessage(currentInv.id, 'assistant', synthesis.answer, {
      turnId,
      planId: plan.planId,
      evidenceRefsCount: synthesis.evidenceRefs.length,
    });

    // Persist verified observations into findings
    for (const obs of synthesis.observations) {
      this.manager.addFinding(currentInv.id, {
        id: obs.id,
        claim: obs.statement,
        status: 'OBSERVATION',
        evidenceReferences: obs.evidenceRefs.map((ref) => ({
          evidenceId: ref,
          excerptOrMetric: obs.statement,
        })),
        confidence: 1.0,
      });
    }

    // Persist analytical interpretations into findings
    for (const interp of synthesis.interpretations) {
      const confValue = interp.confidence === 'high' ? 0.8 : interp.confidence === 'medium' ? 0.5 : 0.2;
      this.manager.addFinding(currentInv.id, {
        id: interp.id,
        claim: interp.statement,
        status: 'INTERPRETATION',
        evidenceReferences: interp.evidenceRefs.map((ref) => ({
          evidenceId: ref,
          excerptOrMetric: interp.statement,
          interpretation: interp.confidenceRationale,
        })),
        confidence: confValue,
      });
    }

    // Persist hypotheses
    if (synthesis.hypotheses.length > 0) {
      this.manager.setHypotheses(
        currentInv.id,
        synthesis.hypotheses.map((h) => ({
          id: h.id,
          statement: h.statement,
          supportingFindingIds: [],
          counterFindingIds: [],
          confidence: 0.5,
        }))
      );
    }

    // Persist open questions and unknowns
    this.manager.setOpenQuestions(currentInv.id, [
      ...synthesis.followUpQuestions,
      ...synthesis.unknowns.map((u) => u.statement),
    ]);

    // Transition state to ANSWERED
    try {
      this.manager.transitionState(currentInv.id, 'ANSWERED');
    } catch {
      // Safe transition
    }

    this.manager.addTimelineEvent(currentInv.id, {
      timestamp: new Date().toISOString(),
      eventType: 'TURN_COMPLETED',
      summary: `Turn completed with ${retrievedEvidence.length} evidence items, ${synthesis.observations.length} observations.`,
      details: {
        turnId,
        observationsCount: synthesis.observations.length,
        interpretationsCount: synthesis.interpretations.length,
        isBudgetLimited,
      },
    });

    const status = isBudgetLimited ? 'budget_limited' : 'completed';

    return {
      investigationId: currentInv.id,
      turnId,
      status,
      question: trimmedQuestion,
      target: resolvedTarget,
      token: effectiveToken,
      plan,
      evidence: retrievedEvidence,
      synthesis,
      unresolvedRequirements: isBudgetLimited
        ? ['Remaining capabilities unexecuted due to budget constraint', ...plan.unresolvedRequirements]
        : plan.unresolvedRequirements,
      error: executionErrors.length > 0 ? {
        code: isBudgetLimited ? 'BUDGET_EXCEEDED' : 'PARTIAL_EXECUTION_FAILURE',
        message: executionErrors.join('; '),
      } : undefined,
    };
  }

  /**
   * Formulates grounded clarification questions when planning cannot safely execute on-chain.
   */
  private formulateClarificationQuestions(plan: InvestigationPlan, _token: TokenContext): string[] {
    const questions: string[] = [];
    const qLower = (plan.question || '').toLowerCase();

    // 1. Future price prediction requests (Requirement 6)
    const isPricePrediction = isFuturePricePrediction(plan.question || '');

    if (isPricePrediction) {
      questions.push(
        "I can't verify future price predictions from on-chain evidence.\n\nI can investigate the on-chain activity instead.\n\nExamples:\n• What's happening?\n• Who is buying?\n• Biggest transactions"
      );
      return questions;
    }

    // 2. Off-chain roadmap or team intent requests (Requirement 6)
    const isOffChainIntent =
      qLower.includes('roadmap') ||
      qLower.includes('marketing') ||
      qLower.includes('dev team') ||
      plan.unresolvedRequirements.some((r) => r.toLowerCase().includes('roadmap') || r.toLowerCase().includes('intent'));

    if (isOffChainIntent) {
      questions.push(
        "I can't verify off-chain roadmap or developer intent from on-chain evidence.\n\nI can investigate the on-chain activity instead.\n\nExamples:\n• What's happening?\n• Who is buying?\n• Biggest transactions"
      );
      return questions;
    }

    for (const warning of plan.warnings) {
      if (warning.code === 'MISSING_WALLET_INPUT') {
        questions.push('Please specify a target wallet address (0x...) to analyze its activity or counterparties.');
      } else if (warning.code === 'CHAIN_UNSUPPORTED') {
        questions.push("That investigation isn't available for this token's chain yet.");
      }
    }

    if (questions.length === 0) {
      questions.push('Could you clarify which specific on-chain transactions, wallets, or timeframes you would like to examine?');
    }

    return questions;
  }
}
