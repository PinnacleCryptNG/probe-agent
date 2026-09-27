import { describe, it, expect, beforeEach } from 'vitest';
import { TargetResolver, detectUserCorrection } from '../../../src/core/target/target-resolver.js';
import { InvestigationPlanner } from '../../../src/core/planner/planner.js';
import { CapabilityRegistry } from '../../../src/core/capabilities/registry.js';
import { MockLLMProvider } from '../../../src/core/llm/interface.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { TokenResolver } from '../../../src/core/token/resolver.js';
import {
  WalletTarget,
  TokenTarget,
  ContractTarget,
  ChainTarget,
} from '../../../src/core/target/types.js';
import { getInvestigationHeader, formatInvestigationResult } from '../../../src/adapters/telegram/formatter.js';
import { isOffChainRoadmapOrIntent, isFuturePricePrediction } from '../../../src/core/planner/prediction.js';

import { EvidenceExecutor } from '../../../src/core/evidence/executor.js';
import { EvidenceSynthesisEngine } from '../../../src/core/synthesis/synthesizer.js';

describe('PROBE — Contract Correction & Intent Routing Regression Suite', () => {
  let targetResolver: TargetResolver;
  let tokenResolver: TokenResolver;
  let planner: InvestigationPlanner;
  let registry: CapabilityRegistry;
  let orchestrator: InvestigationOrchestrator;
  let manager: InvestigationManager;

  const ROBINHOOD_ADDRESS = '0xdDDF7AB756C35b4d0537825497e6932780710241';
  const PEPE_ADDRESS = '0x6982508145454ce325ddbe47a25d4ec3d2311933';
  const WALLET_ADDRESS = '0xbba275e390c9b0e1e695d73a0e67610344edc40a';

  beforeEach(() => {
    tokenResolver = new TokenResolver();
    targetResolver = new TargetResolver(tokenResolver);
    registry = new CapabilityRegistry();
    planner = new InvestigationPlanner({
      capabilityRegistry: registry,
      llmProvider: new MockLLMProvider(),
    });
    const executor = new EvidenceExecutor({} as any, registry);
    const synthesizer = new EvidenceSynthesisEngine({ llmProvider: new MockLLMProvider() });
    manager = new InvestigationManager();
    orchestrator = new InvestigationOrchestrator({
      planner,
      executor,
      synthesizer,
      manager,
      targetResolver,
    });
  });

  // =========================================================================
  // 1. EXACT SCREENSHOT FLOW REPRODUCTION
  // =========================================================================
  describe('1. Exact Telegram Screenshot Flow Regression', () => {
    it('reproduces the exact sequence without off-chain refusal for "who\'s buying"', async () => {
      const chatId = 9001;

      // Turn 1: User sends raw address
      const turn1 = await targetResolver.resolve({
        question: ROBINHOOD_ADDRESS,
        chatId,
      });

      expect(turn1.status).toBe('AMBIGUOUS');
      expect(turn1.candidateType).toBe('wallet');
      expect(turn1.availableChains).toBeDefined();
      expect(turn1.availableChains).toContain('Ethereum');
      expect(turn1.clarificationMessage).toContain('🔎 Address detected');
      expect(turn1.clarificationMessage).toContain('I need to determine whether this address is a wallet or contract before investigating it.');

      // Turn 2: User selects Ethereum
      const turn2 = await targetResolver.resolve({
        question: 'Ethereum',
        chatId,
      });

      expect(turn2.status).toBe('RESOLVED');
      expect(turn2.target.type).toBe('wallet');
      const walletTarget = turn2.target as WalletTarget;
      expect(walletTarget.address.toLowerCase()).toBe(ROBINHOOD_ADDRESS.toLowerCase());
      expect(walletTarget.chain).toBe('ethereum');

      // Turn 3: User corrects: "that's a contract"
      const turn3 = await targetResolver.resolve({
        question: "that's a contract",
        chatId,
        existingTarget: walletTarget,
      });

      expect(turn3.status).toBe('RESOLVED');
      expect(turn3.target.type).toBe('contract');
      const contractTarget = turn3.target as ContractTarget;
      expect(contractTarget.address.toLowerCase()).toBe(ROBINHOOD_ADDRESS.toLowerCase());
      expect(contractTarget.chain).toBe('ethereum');

      // Turn 4: User asks: "who's buying"
      // Verify planner classifies intent as accumulation, not unknown
      const plan = await planner.plan({ target: contractTarget }, "who's buying");

      expect(plan.intent).toBe('accumulation');
      expect(isOffChainRoadmapOrIntent("who's buying")).toBe(false);

      // Verify orchestrator executes turn without off-chain roadmap refusal
      const turn4Result = await orchestrator.executeTurn({
        chatId,
        question: "who's buying",
        target: contractTarget,
      });

      expect(turn4Result.status).toBe('capability_unavailable');
      const formatted = formatInvestigationResult(turn4Result);
      expect(formatted).not.toContain("I can't verify off-chain roadmap or developer intent");
      expect(formatted).toContain('🔎 CONTRACT ADDRESS');
      expect(formatted).toContain(
        'I can identify this address, but PROBE does not currently have a dedicated smart-contract investigation mode for this contract type.'
      );
    });
  });

  // =========================================================================
  // 2. VERIFIED TOKEN CONTRACT CORRECTION
  // =========================================================================
  describe('2. Verified Token Contract vs Non-Token Contract Resolution', () => {
    it('re-resolves a verified token contract (PEPE) to a TOKEN target upon "that\'s a contract"', async () => {
      const chatId = 9002;

      // User provides PEPE contract with chain -> initially wallet
      const initial = await targetResolver.resolve({
        question: `${PEPE_ADDRESS} on ethereum`,
        chatId,
      });
      expect(initial.target.type).toBe('wallet');

      // User corrects: "that's a contract"
      const corrected = await targetResolver.resolve({
        question: "that's a contract",
        chatId,
        existingTarget: initial.target,
      });

      expect(corrected.status).toBe('RESOLVED');
      expect(corrected.target.type).toBe('token');
      const tokenTarget = corrected.target as TokenTarget;
      expect(tokenTarget.token.symbol).toBe('PEPE');
      expect(tokenTarget.token.chain).toBe('ethereum');

      // Now "who's buying" on verified token routes to WHO_BOUGHT_SOLD
      const plan = await planner.plan({ target: tokenTarget }, "who's buying");

      expect(plan.intent).toBe('accumulation');
      expect(plan.selectedCapabilities).toContain('who_bought_sold');
    });

    it('re-resolves a verified token contract upon "that\'s a token contract"', async () => {
      const initialWallet: WalletTarget = {
        type: 'wallet',
        address: PEPE_ADDRESS.toLowerCase(),
        chain: 'ethereum',
        rawIdentifier: PEPE_ADDRESS,
      };

      const res = await targetResolver.resolve({
        question: "that's a token contract",
        existingTarget: initialWallet,
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');
      expect((res.target as TokenTarget).token.symbol).toBe('PEPE');
    });

    it('asks clarification when user claims "that\'s a token contract" for an unverified contract', async () => {
      const initialWallet: WalletTarget = {
        type: 'wallet',
        address: ROBINHOOD_ADDRESS.toLowerCase(),
        chain: 'ethereum',
        rawIdentifier: ROBINHOOD_ADDRESS,
      };

      const res = await targetResolver.resolve({
        question: "that's a token contract",
        existingTarget: initialWallet,
      });

      expect(res.status).toBe('AMBIGUOUS');
      expect(res.clarificationMessage).toBe(
        "Is this a token contract you'd like me to investigate, or another smart contract?"
      );
    });

    it('switches TOKEN target to WALLET upon "that\'s a wallet" correction', async () => {
      const activeToken: TokenTarget = {
        type: 'token',
        token: {
          address: PEPE_ADDRESS.toLowerCase(),
          symbol: 'PEPE',
          name: 'Pepe',
          chain: 'ethereum',
          resolvedAt: new Date().toISOString(),
        },
        chain: 'ethereum',
        rawIdentifier: 'PEPE',
      };

      const res = await targetResolver.resolve({
        question: "that's a wallet",
        existingTarget: activeToken,
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('wallet');
      expect((res.target as WalletTarget).address.toLowerCase()).toBe(PEPE_ADDRESS.toLowerCase());
    });
  });

  // =========================================================================
  // 3. USER CORRECTION DETECTOR REGEX
  // =========================================================================
  describe('3. User Correction Detection Variations', () => {
    it('detects all standard contract correction phrases', () => {
      const phrases = [
        "that's a contract",
        "it's a contract",
        "this is a contract",
        "thats a contract",
        "its a contract",
        "not a wallet",
        "it's not a wallet",
        "contract not wallet",
        "contract",
        "smart contract",
      ];
      for (const phrase of phrases) {
        const detection = detectUserCorrection(phrase);
        expect(detection.isCorrection).toBe(true);
        expect(detection.correctionType).toBe('contract');
      }
    });

    it('detects all standard token contract correction phrases', () => {
      const phrases = [
        "that's a token contract",
        "that's the token contract",
        "it's a token contract",
        "this is a token contract",
        "token contract not wallet",
        "token contract",
      ];
      for (const phrase of phrases) {
        const detection = detectUserCorrection(phrase);
        expect(detection.isCorrection).toBe(true);
        expect(detection.correctionType).toBe('token_contract');
      }
    });

    it('detects all standard wallet correction phrases', () => {
      const phrases = [
        "that's a wallet",
        "it's a wallet",
        "this is a wallet",
        "not a contract",
        "not a token",
        "wallet not contract",
        "wallet",
      ];
      for (const phrase of phrases) {
        const detection = detectUserCorrection(phrase);
        expect(detection.isCorrection).toBe(true);
        expect(detection.correctionType).toBe('wallet');
      }
    });

    it('does NOT misclassify natural investigation questions containing "wallet" or "contract"', () => {
      const nonCorrections = [
        "Who owns this wallet?",
        "Show me this wallet's transactions",
        "What is the balance of this wallet?",
        "Who funded this wallet?",
        "What does this contract do?",
        "who's buying",
        "who's selling",
        "can this go to $10?",
      ];
      for (const query of nonCorrections) {
        const detection = detectUserCorrection(query);
        expect(detection.isCorrection).toBe(false);
      }
    });
  });

  // =========================================================================
  // 4. INDEPENDENT TARGET AND INTENT RESOLUTION
  // =========================================================================
  describe('4. Independent Target and Intent Resolution Requirements', () => {
    it('$PEPE resolves to TOKEN', async () => {
      const res = await targetResolver.resolve({ question: '$PEPE' });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');
      expect((res.target as TokenTarget).token.symbol).toBe('PEPE');
    });

    it('$PEPE who is buying? resolves to TOKEN + WHO_BOUGHT_SOLD', async () => {
      const res = await targetResolver.resolve({ question: '$PEPE who is buying?' });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');

      const plan = await planner.plan({ target: res.target }, '$PEPE who is buying?');
      expect(plan.intent).toBe('accumulation');
      expect(plan.selectedCapabilities).toContain('who_bought_sold');
    });

    it('0x... wallet resolves to WALLET', async () => {
      const res = await targetResolver.resolve({
        question: `${WALLET_ADDRESS} on ethereum`,
      });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('wallet');
      expect((res.target as WalletTarget).address.toLowerCase()).toBe(WALLET_ADDRESS.toLowerCase());
    });

    it('"who funded it?" on wallet resolves to FIRST_FUNDER', async () => {
      const walletTarget: WalletTarget = {
        type: 'wallet',
        address: WALLET_ADDRESS.toLowerCase(),
        chain: 'ethereum',
        rawIdentifier: WALLET_ADDRESS,
      };

      const plan = await planner.plan({ target: walletTarget }, 'who funded it?');

      expect(plan.intent).toBe('wallet_relationships');
      expect(plan.selectedCapabilities).toContain('wallet_first_funder');
    });

    it('"biggest transactions?" on wallet resolves to WALLET_TRANSACTIONS', async () => {
      const walletTarget: WalletTarget = {
        type: 'wallet',
        address: WALLET_ADDRESS.toLowerCase(),
        chain: 'ethereum',
        rawIdentifier: WALLET_ADDRESS,
      };

      const plan = await planner.plan({ target: walletTarget }, 'biggest transactions?');

      expect(plan.selectedCapabilities).toContain('wallet_transactions');
    });

    it('"who does it interact with?" on wallet resolves to COUNTERPARTIES', async () => {
      const walletTarget: WalletTarget = {
        type: 'wallet',
        address: WALLET_ADDRESS.toLowerCase(),
        chain: 'ethereum',
        rawIdentifier: WALLET_ADDRESS,
      };

      const plan = await planner.plan({ target: walletTarget }, 'who does it interact with?');

      expect(plan.intent).toBe('wallet_relationships');
      expect(plan.selectedCapabilities).toContain('wallet_counterparties');
    });

    it('"what\'s happening on Ethereum?" resolves to CHAIN', async () => {
      const res = await targetResolver.resolve({
        question: "what's happening on Ethereum?",
      });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect((res.target as ChainTarget).chain).toBe('ethereum');
    });

    it('"who are the biggest whales on Solana?" resolves to CHAIN Solana', async () => {
      const res = await targetResolver.resolve({
        question: 'who are the biggest whales on Solana?',
      });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect((res.target as ChainTarget).chain).toBe('solana');
    });

    it('"can this go to $10?" triggers speculative/future-price handling', () => {
      expect(isFuturePricePrediction('can this go to $10?')).toBe(true);
      expect(isOffChainRoadmapOrIntent('can this go to $10?')).toBe(false);
    });

    it('"what is the team\'s roadmap?" triggers off-chain roadmap limitation', () => {
      expect(isOffChainRoadmapOrIntent("what is the team's roadmap?")).toBe(true);
      expect(isFuturePricePrediction("what is the team's roadmap?")).toBe(false);
    });

    it('"who\'s buying?" NEVER routes to speculative/off-chain refusal', () => {
      const buyingPhrases = [
        "who's buying",
        "whos buying",
        "who is buying",
        "who's buying?",
        "whos buying?",
        "who is buying?",
        "who's selling",
        "who's selling?",
        "who holds it?",
        "who is accumulating?",
        "who is dumping?",
        "where are funds flowing?",
        "biggest transactions",
        "whale activity",
        "smart money activity",
        "recent activity",
      ];

      for (const phrase of buyingPhrases) {
        expect(isOffChainRoadmapOrIntent(phrase)).toBe(false);
        expect(isFuturePricePrediction(phrase)).toBe(false);
      }
    });
  });

  // =========================================================================
  // 5. INVESTIGATION HEADERS IDENTIFY TARGET TYPE
  // =========================================================================
  describe('5. Investigation Headers Identify Target Type', () => {
    it('formats TOKEN header properly', () => {
      const target: TokenTarget = {
        type: 'token',
        token: {
          address: PEPE_ADDRESS.toLowerCase(),
          symbol: 'PEPE',
          name: 'Pepe',
          chain: 'ethereum',
          resolvedAt: new Date().toISOString(),
        },
        chain: 'ethereum',
        rawIdentifier: 'PEPE',
      };
      const header = getInvestigationHeader(target);
      expect(header).toBe('🔎 TOKEN INVESTIGATION\nPEPE · Ethereum');
    });

    it('formats WALLET header properly', () => {
      const target: WalletTarget = {
        type: 'wallet',
        address: '0xbba275e390c9b0e1e695d73a0e67610344edc40a',
        chain: 'ethereum',
        rawIdentifier: '0xbba275e390c9b0e1e695d73a0e67610344edc40a',
      };
      const header = getInvestigationHeader(target);
      expect(header).toBe('🔎 WALLET INVESTIGATION\n0xbba2...c40a · Ethereum');
    });

    it('formats TRANSACTION header properly', () => {
      const target = {
        type: 'transaction' as const,
        transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        chain: 'ethereum',
        rawIdentifier: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };
      const header = getInvestigationHeader(target);
      expect(header).toBe('🔎 TRANSACTION INVESTIGATION\n0x123456...abcdef · Ethereum');
    });

    it('formats CHAIN header properly', () => {
      const target: ChainTarget = {
        type: 'chain',
        chain: 'ethereum',
        chainDisplayName: 'Ethereum',
        rawIdentifier: 'Ethereum',
      };
      const header = getInvestigationHeader(target);
      expect(header).toBe('🔎 CHAIN INVESTIGATION\nEthereum');
    });

    it('formats CONTRACT header properly', () => {
      const target: ContractTarget = {
        type: 'contract',
        address: ROBINHOOD_ADDRESS.toLowerCase(),
        chain: 'ethereum',
        rawIdentifier: ROBINHOOD_ADDRESS,
      };
      const header = getInvestigationHeader(target);
      expect(header).toBe('🔎 CONTRACT ADDRESS\n0xdddf...0241 · Ethereum');
    });
  });
});
