import { capabilityRegistry as defaultRegistry, CapabilityRegistry } from '../capabilities/registry.js';
import { ILLMProvider } from '../llm/interface.js';
import { EvidenceRequirement } from '../../types/domain.js';
import { generateId } from '../../utils/ids.js';
import { logger } from '../../utils/logger.js';
import { CapabilitySelector } from './capability-selector.js';
import { RequirementFormulator } from './requirements.js';
import { isFuturePricePrediction, isOffChainRoadmapOrIntent } from './prediction.js';
import {
  InvestigationPlan,
  PlannerContext,
  PlannerIntent,
} from './types.js';

export interface PlannerDependencies {
  capabilityRegistry?: CapabilityRegistry;
  llmProvider?: ILLMProvider;
  selector?: CapabilitySelector;
  formulator?: RequirementFormulator;
}

export class InvestigationPlanner {
  private readonly registry: CapabilityRegistry;
  private readonly llmProvider?: ILLMProvider;
  private readonly selector: CapabilitySelector;
  private readonly formulator: RequirementFormulator;

  constructor(deps?: PlannerDependencies) {
    this.registry = deps?.capabilityRegistry ?? defaultRegistry;
    this.llmProvider = deps?.llmProvider;
    this.selector = deps?.selector ?? new CapabilitySelector(this.registry);
    this.formulator = deps?.formulator ?? new RequirementFormulator();
  }

  /**
   * Translates an arbitrary natural-language question into an evidence-oriented InvestigationPlan.
   */
  public async plan(context: PlannerContext, question: string): Promise<InvestigationPlan> {
    const trimmedQuestion = question.trim();
    const planId = generateId('plan');
    const createdAt = new Date().toISOString();

    const target =
      context.target ??
      (context.token
        ? {
            type: 'token' as const,
            token: context.token,
            chain: context.token.chain,
            rawIdentifier: context.token.symbol,
          }
        : undefined);

    const tokenContext = target?.type === 'token' ? target.token : context.token;
    const chain = target?.chain ?? tokenContext?.chain ?? 'ethereum';

    logger.info('Planning investigation for question', {
      planId,
      question: trimmedQuestion,
      targetType: target?.type,
      targetIdentifier:
        target?.type === 'token'
          ? target.token.symbol
          : target?.type === 'wallet'
          ? target.address
          : target?.type === 'chain'
          ? target.chainDisplayName
          : target?.type === 'contract'
          ? target.address
          : target?.transactionHash,
      chain,
    });

    // 1. Intent understanding via semantic classification & follow-up context
    const intent = this.classifyIntent(trimmedQuestion, context);

    // 2. Formulate structured requirements based on intent & epistemic boundaries
    const rawRequirements = this.formulator.formulate(intent, trimmedQuestion, context);

    // 3. Deterministic capability selection, chain validation, and deduplication
    const selection = this.selector.select(rawRequirements, context);

    const plan: InvestigationPlan = {
      planId,
      question: trimmedQuestion,
      intent,
      target,
      tokenContext,
      evidenceRequirements: selection.resolvedRequirements,
      selectedCapabilities: selection.selectedCapabilities,
      plannedCapabilities: selection.plannedCapabilities,
      estimatedCreditCost: selection.estimatedCreditCost,
      unresolvedRequirements: selection.unresolvedRequirements,
      warnings: selection.warnings,
      createdAt,
    };

    logger.info('Investigation plan generated', {
      planId,
      intent,
      selectedCapabilities: selection.selectedCapabilities,
      estimatedCost: selection.estimatedCreditCost,
      unresolvedCount: selection.unresolvedRequirements.length,
      warningCount: selection.warnings.length,
    });

    return plan;
  }

  /**
   * Formulates a specialized investigation plan to cross-examine or verify a challenged finding.
   */
  public async planChallenge(
    context: PlannerContext,
    challengeText: string,
    targetedFindingId?: string
  ): Promise<InvestigationPlan> {
    const planId = generateId('plan');
    const createdAt = new Date().toISOString();

    const challengeContext: PlannerContext = {
      ...context,
      isChallenge: true,
      targetFindingId: targetedFindingId,
    };

    const rawRequirements = this.formulator.formulateForChallenge(challengeText, challengeContext);
    const selection = this.selector.select(rawRequirements, challengeContext);

    return {
      planId,
      question: challengeText,
      intent: 'historical_comparison',
      target: context.target,
      tokenContext: context.target?.type === 'token' ? context.target.token : context.token,
      evidenceRequirements: selection.resolvedRequirements,
      selectedCapabilities: selection.selectedCapabilities,
      plannedCapabilities: selection.plannedCapabilities,
      estimatedCreditCost: selection.estimatedCreditCost,
      unresolvedRequirements: selection.unresolvedRequirements,
      warnings: selection.warnings,
      createdAt,
    };
  }

  /**
   * Converts an InvestigationPlan into domain EvidenceRequirement objects
   * ready for batch execution in EvidenceExecutor.executeMany().
   */
  public toExecutableRequirements(plan: InvestigationPlan): EvidenceRequirement[] {
    return plan.plannedCapabilities.map((pc, idx) => ({
      id: generateId('req'),
      capabilityName: pc.name,
      reason: pc.reason,
      parameters: pc.parameters,
      priority: pc.priority === 'required' ? idx + 1 : idx + 10,
      estimatedCost: pc.estimatedCost,
    }));
  }

  /**
   * Classifies user intent from natural language, incorporating follow-up context.
   */
  public classifyIntent(question: string, context?: PlannerContext): PlannerIntent {
    const q = question.toLowerCase();

    // 0a. Explicit off-chain roadmap, dev team intent, or marketing plan refusal
    if (isOffChainRoadmapOrIntent(question)) {
      return 'unknown';
    }

    // 0b. Genuine future price prediction checks (e.g. "Will ETH pump tomorrow?", "Will ETH hit $5,000?", "Can this go to $10?")
    if (isFuturePricePrediction(question)) {
      return 'unknown';
    }

    // 0c. Transaction target or explicit 66-char transaction hash
    if (context?.target?.type === 'transaction' || /\b0x[a-fA-F0-9]{64}\b/i.test(q)) {
      return 'transaction_inspection';
    }

    // 1. Check for follow-up context pronouns or references (e.g. "those tokens afterward", "why?", "who did that?")
    const isFollowUp =
      q.includes('afterward') ||
      q.includes('after that') ||
      q.includes('those tokens') ||
      q.includes('where did') ||
      q.includes('what happened to them') ||
      q.includes('did they sell') ||
      q.includes('did they transfer') ||
      q === 'why' ||
      q === 'why?' ||
      q.includes('who did that') ||
      q.includes('what caused it');

    if (isFollowUp && context?.conversationHistory && context.conversationHistory.length > 0) {
      const lastUserMsg = [...context.conversationHistory]
        .reverse()
        .find((m) => m.role === 'user')?.content.toLowerCase();

      if (q.includes('who did that')) {
        if (lastUserMsg && (lastUserMsg.includes('sell') || lastUserMsg.includes('dump'))) {
          return 'distribution';
        }
        return 'accumulation';
      }

      if (q === 'why' || q === 'why?' || q.includes('what caused it')) {
        return 'activity_change';
      }

      if (lastUserMsg && (lastUserMsg.includes('bought') || lastUserMsg.includes('accumul'))) {
        return 'transfers';
      }
      return 'wallet_activity';
    }

    // 2. Large transactions & transfers
    if (
      q.includes('biggest transaction') ||
      q.includes('biggest transactions') ||
      q.includes('largest transaction') ||
      q.includes('largest transactions') ||
      q.includes('large transaction') ||
      q.includes('large transactions') ||
      q.includes('large transfer') ||
      q.includes('large transfers') ||
      q.includes('biggest eth transaction') ||
      q.includes('biggest eth transactions') ||
      q.includes('transfers') ||
      q.includes('transfer log')
    ) {
      return 'large_transactions';
    }

    // 3. Accumulation / buyers
    if (
      q.includes('accumulate') ||
      q.includes('accumulating') ||
      q.includes('who bought') ||
      q.includes('who is buying') ||
      q.includes("who's buying") ||
      q.includes('whos buying') ||
      q.includes('who is accumulating') ||
      q.includes("who's accumulating") ||
      q.includes('whos accumulating') ||
      q.includes('who were the buyers') ||
      q.includes('who were the biggest buyers') ||
      q.includes('biggest buyers') ||
      q.includes('buyers') ||
      q.includes('who acquired') ||
      q.includes('inflow') ||
      q.includes('inflows') ||
      q.includes('smart money buying')
    ) {
      return 'accumulation';
    }

    // 4. Distribution / sellers
    if (
      q.includes('dump') ||
      q.includes('dumping') ||
      q.includes('who sold') ||
      q.includes('who is selling') ||
      q.includes("who's selling") ||
      q.includes('whos selling') ||
      q.includes('who is dumping') ||
      q.includes("who's dumping") ||
      q.includes('whos dumping') ||
      q.includes('who were the sellers') ||
      q.includes('who were the biggest sellers') ||
      q.includes('biggest sellers') ||
      q.includes('sellers') ||
      q.includes('outflow') ||
      q.includes('outflows') ||
      q.includes('whales selling')
    ) {
      return 'distribution';
    }

    // 5. Cohort flows & whales (e.g. "Who are the biggest whales on Ethereum?", "Where are funds flowing?")
    if (
      q.includes('biggest whales') ||
      q.includes('biggest whale') ||
      q.includes('whales') ||
      q.includes('whale') ||
      q.includes('smart money') ||
      q.includes('cohort') ||
      q.includes('funds flowing') ||
      q.includes('money flowing') ||
      q.includes('fund flow') ||
      q.includes('fund flows') ||
      q.includes('flow') ||
      q.includes('flows')
    ) {
      return 'flow_analysis';
    }

    // 6. Holder analysis (supply distribution, top holders, who holds it)
    if (
      q.includes('holder') ||
      q.includes('holders') ||
      q.includes('who holds') ||
      q.includes('who is holding') ||
      q.includes('who owns') ||
      q.includes('concentration') ||
      q.includes('supply distribution')
    ) {
      return 'holder_analysis';
    }

    // 7. Wallet relationships (counterparties, related wallets, first funder, who funded it)
    if (
      q.includes('related wallet') ||
      q.includes('related wallets') ||
      q.includes('connected') ||
      q.includes('first funder') ||
      q.includes('who funded') ||
      q.includes('funder') ||
      q.includes('funded') ||
      q.includes('funding') ||
      q.includes('who does it interact with') ||
      q.includes('interact with') ||
      q.includes('counterpart') ||
      q.includes('cluster')
    ) {
      return 'wallet_relationships';
    }

    // 8. Activity change / sudden movement / price pump
    if (
      q.includes('what changed') ||
      q.includes('changed recently') ||
      q.includes('recent change') ||
      q.includes('recent changes') ||
      q.includes('what happened to this token today') ||
      q.includes('what happened') ||
      q.includes("what's happening") ||
      q.includes('whats happening') ||
      q.includes('what is happening') ||
      q.includes("what's moving") ||
      q.includes('whats moving') ||
      q.includes('what is moving') ||
      q.includes('why is activity changing') ||
      q.includes('activity change') ||
      q.includes('activity changing') ||
      q.includes('recent activity') ||
      q.includes('why is') ||
      q.includes('why are') ||
      q.includes('why did') ||
      q.includes('what caused') ||
      q.includes('what about') ||
      q.includes('how about') ||
      q.includes('pump') ||
      q.includes('pumping') ||
      q.includes('crash') ||
      q.includes('spike') ||
      q.includes('suddenly') ||
      q.includes('surge')
    ) {
      return 'activity_change';
    }

    // 9. Historical comparison
    if (
      q.includes('unusual') ||
      q.includes('compared to') ||
      q.includes('past week') ||
      q.includes('last week') ||
      q.includes('historical') ||
      q.includes('baseline') ||
      q.includes('trend')
    ) {
      return 'historical_comparison';
    }

    // 10. Specific wallet activity & balances
    const isWalletContext =
      context?.target?.type === 'wallet' ||
      context?.targetWalletAddress !== undefined ||
      /\b0x[a-fA-F0-9]{40}\b/i.test(q);

    if (
      q.includes('which wallets') ||
      q.includes('most active') ||
      q.includes('target address') ||
      (isWalletContext &&
        (q.includes('wallet') ||
          q.includes('balance') ||
          q.includes('holding') ||
          q.includes('portfolio') ||
          q.includes('worth') ||
          q.includes('transaction') ||
          q.includes('activity') ||
          q.includes('doing') ||
          q.includes('investigate') ||
          q.includes('what has this wallet')))
    ) {
      return 'wallet_activity';
    }

    // 11. DEX trading
    if (
      q.includes('dex') ||
      q.includes('swap') ||
      q.includes('swaps') ||
      q.includes('uniswap') ||
      q.includes('trading volume')
    ) {
      return 'dex_activity';
    }

    // 12. General token activity
    if (q.includes('activity') || q.includes('price') || q.includes('status') || q.includes('info')) {
      return 'token_activity';
    }

    // 13. Context-driven defaults if question had no explicit keywords
    if (context?.target?.type === 'wallet') {
      return 'wallet_activity';
    }
    if (context?.target?.type === 'chain') {
      return 'flow_analysis';
    }
    if (context?.target?.type === 'token') {
      return 'token_activity';
    }
    if (context?.target?.type === 'contract') {
      return 'token_activity';
    }

    return 'unknown';
  }
}

export const investigationPlanner = new InvestigationPlanner();
