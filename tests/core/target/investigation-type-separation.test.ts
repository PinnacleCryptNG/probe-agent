import { describe, it, expect, beforeEach } from 'vitest';
import { TargetResolver } from '../../../src/core/target/target-resolver.js';
import { InvestigationPlanner } from '../../../src/core/planner/planner.js';
import { CapabilityRegistry } from '../../../src/core/capabilities/registry.js';
import { MockLLMProvider } from '../../../src/core/llm/interface.js';
import { EvidenceSynthesisEngine } from '../../../src/core/synthesis/synthesizer.js';
import { EvidenceValidator } from '../../../src/core/synthesis/validator.js';
import {
  formatInvestigationResult,
  formatTypedResult,
  formatWalletResult,
  formatTransactionResult,
  formatChainResult,
  formatTokenResult,
} from '../../../src/adapters/telegram/formatter.js';
import {
  InvestigationTarget,
  WalletTarget,
  TokenTarget,
  TransactionTarget,
  ChainTarget,
} from '../../../src/core/target/types.js';
import { EvidenceItem } from '../../../src/types/evidence.js';
import { InvestigationTurnResult } from '../../../src/core/investigation/types.js';
import { deriveNextSuggestions } from '../../../src/core/synthesis/formatting.js';

describe('PROBE — Final Investigation-Type Separation Regression Suite', () => {
  let targetResolver: TargetResolver;
  let planner: InvestigationPlanner;
  let registry: CapabilityRegistry;
  let synthesisEngine: EvidenceSynthesisEngine;
  let validator: EvidenceValidator;

  const TEST_WALLET_ADDR = '0xbba26f90162df285ece4037e90ec2d0c3d89c40a';
  const TEST_TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  beforeEach(() => {
    targetResolver = new TargetResolver();
    registry = new CapabilityRegistry();
    planner = new InvestigationPlanner({
      capabilityRegistry: registry,
      llmProvider: new MockLLMProvider(),
    });
    validator = new EvidenceValidator();
    synthesisEngine = new EvidenceSynthesisEngine({
      llmProvider: new MockLLMProvider(),
      validator,
    });
  });

  // =========================================================================
  // 1. TARGET TYPE MUST CONTROL INVESTIGATION MODE & RESOLUTION
  // =========================================================================
  describe('1. Target Classification & Resolution', () => {
    it('raw EVM wallet address becomes a wallet candidate target requiring chain selection', async () => {
      const res = await targetResolver.resolve({
        question: TEST_WALLET_ADDR,
      });

      expect(res.status).toBe('AMBIGUOUS');
      expect(res.candidateType).toBe('wallet');
      expect(res.candidateIdentifier).toBe(TEST_WALLET_ADDR);
      expect(res.availableChains).toContain('Ethereum');
    });

    it('wallet + Ethereum resolves deterministically to a WALLET target', async () => {
      const res = await targetResolver.resolve({
        question: `${TEST_WALLET_ADDR} on ethereum`,
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('wallet');
      expect((res.target as WalletTarget).address.toLowerCase()).toBe(TEST_WALLET_ADDR.toLowerCase());
      expect(res.target.chain).toBe('ethereum');
    });

    it('66-hex transaction hash resolves deterministically to a TRANSACTION target', async () => {
      const res = await targetResolver.resolve({
        question: TEST_TX_HASH,
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('transaction');
      expect((res.target as TransactionTarget).transactionHash).toBe(TEST_TX_HASH);
      expect(res.target.chain).toBe('ethereum');
    });

    it('transaction hash + explicit chain preserves chain', async () => {
      const res = await targetResolver.resolve({
        question: `${TEST_TX_HASH} on base`,
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('transaction');
      expect((res.target as TransactionTarget).transactionHash).toBe(TEST_TX_HASH);
      expect(res.target.chain).toBe('base');
    });

    it('$PEPE resolves to a TOKEN target', async () => {
      const res = await targetResolver.resolve({
        question: 'What is happening with $PEPE?',
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');
      expect((res.target as TokenTarget).token.symbol).toBe('PEPE');
    });

    it('$HYPE resolves to native Hyperliquid token target', async () => {
      const res = await targetResolver.resolve({
        question: 'Check $HYPE flows',
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');
      expect((res.target as TokenTarget).token.symbol).toBe('HYPE');
      expect((res.target as TokenTarget).token.chain).toBe('hyperliquid');
    });

    it('Ethereum standalone resolves to a CHAIN target', async () => {
      const res = await targetResolver.resolve({
        question: 'What is happening on Ethereum?',
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect(res.target.chain).toBe('ethereum');
      expect((res.target as ChainTarget).chainDisplayName).toBe('Ethereum');
    });

    it('Solana whale inquiry resolves to a CHAIN target', async () => {
      const res = await targetResolver.resolve({
        question: 'Who are the biggest whales on Solana?',
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect(res.target.chain).toBe('solana');
    });

    it('Base transaction inquiry resolves to a CHAIN target', async () => {
      const res = await targetResolver.resolve({
        question: 'What are the biggest transactions on Base?',
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect(res.target.chain).toBe('base');
    });
  });

  // =========================================================================
  // 2. TARGET SWITCHING
  // =========================================================================
  describe('2. Target Switching Across Modes', () => {
    it('active wallet + "$PEPE" switches to a new TOKEN investigation', async () => {
      const activeWallet: WalletTarget = {
        type: 'wallet',
        address: TEST_WALLET_ADDR,
        chain: 'ethereum',
      };

      const res = await targetResolver.resolve({
        question: '$PEPE',
        existingTarget: activeWallet,
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');
      expect((res.target as TokenTarget).token.symbol).toBe('PEPE');
    });

    it('active token + wallet address switches to a new WALLET investigation', async () => {
      const activeToken: TokenTarget = {
        type: 'token',
        chain: 'ethereum',
        token: {
          symbol: 'PEPE',
          chain: 'ethereum',
          address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
          name: 'Pepe',
          resolvedAt: new Date().toISOString(),
        },
      };

      const res = await targetResolver.resolve({
        question: TEST_WALLET_ADDR,
        existingTarget: activeToken,
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('wallet');
      expect((res.target as WalletTarget).address.toLowerCase()).toBe(TEST_WALLET_ADDR.toLowerCase());
    });

    it('active wallet + "Ethereum" keeps wallet as target and updates chain', async () => {
      const activeWallet: WalletTarget = {
        type: 'wallet',
        address: TEST_WALLET_ADDR,
        chain: 'base',
      };

      const res = await targetResolver.resolve({
        question: 'Ethereum',
        existingTarget: activeWallet,
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('wallet');
      expect((res.target as WalletTarget).address.toLowerCase()).toBe(TEST_WALLET_ADDR.toLowerCase());
      expect(res.target.chain).toBe('ethereum');
    });

    it('active token + "What is happening on Base?" switches to CHAIN investigation', async () => {
      const activeToken: TokenTarget = {
        type: 'token',
        chain: 'ethereum',
        token: {
          symbol: 'ETH',
          chain: 'ethereum',
          address: '0x0000000000000000000000000000000000000000',
          name: 'Ethereum',
          resolvedAt: new Date().toISOString(),
        },
      };

      const res = await targetResolver.resolve({
        question: 'What is happening on Base?',
        existingTarget: activeToken,
      });

      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect(res.target.chain).toBe('base');
    });
  });

  // =========================================================================
  // 3. PLANNER SEPARATION & CAPABILITY SELECTION
  // =========================================================================
  describe('3. Planner Separation & Capabilities Selection', () => {
    it('plans comprehensive wallet capabilities for EVM wallet investigation', async () => {
      const walletTarget: WalletTarget = {
        type: 'wallet',
        address: TEST_WALLET_ADDR,
        chain: 'ethereum',
      };

      const plan = await planner.plan({ target: walletTarget }, 'Investigate this wallet');

      const capabilityNames = plan.selectedCapabilities;
      expect(capabilityNames).toContain('wallet_current_balance');
      expect(capabilityNames).toContain('wallet_transactions');
      expect(capabilityNames).toContain('wallet_first_funder');
      expect(capabilityNames).toContain('wallet_counterparties');
      expect(capabilityNames).toContain('wallet_related');
    });

    it('plans specific wallet capability based on intent', async () => {
      const walletTarget: WalletTarget = {
        type: 'wallet',
        address: TEST_WALLET_ADDR,
        chain: 'ethereum',
      };

      const planFunder = await planner.plan({ target: walletTarget }, 'Who funded this wallet?');
      expect(planFunder.selectedCapabilities).toContain('wallet_first_funder');

      const planTxs = await planner.plan({ target: walletTarget }, 'What are its biggest transactions?');
      expect(planTxs.selectedCapabilities).toContain('wallet_transactions');

      const planCounterparties = await planner.plan({ target: walletTarget }, 'Who does it interact with?');
      expect(planCounterparties.selectedCapabilities).toContain(
        'wallet_counterparties'
      );

      const planRelated = await planner.plan({ target: walletTarget }, 'Show related wallets');
      expect(planRelated.selectedCapabilities).toContain('wallet_related');
    });

    it('Solana wallet produces deterministic limitations for unsupported capabilities', async () => {
      const solanaWallet: WalletTarget = {
        type: 'wallet',
        address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
        chain: 'solana',
      };

      const plan = await planner.plan({ target: solanaWallet }, 'What are its transactions and first funder?');

      expect(plan.unresolvedRequirements?.length).toBeGreaterThan(0);
      expect(
        plan.warnings.some((w) => w.code === 'CHAIN_UNSUPPORTED' && w.message.toLowerCase().includes('solana'))
      ).toBe(true);
    });

    it('Transaction target plans transaction_deep_dive on EVM', async () => {
      const txTarget: TransactionTarget = {
        type: 'transaction',
        transactionHash: TEST_TX_HASH,
        chain: 'ethereum',
      };

      const plan = await planner.plan({ target: txTarget }, 'What happened in this transaction?');

      expect(plan.selectedCapabilities).toContain('transaction_deep_dive');
    });

    it('Transaction target on Solana produces deterministic capability limitation', async () => {
      const txTarget: TransactionTarget = {
        type: 'transaction',
        transactionHash: TEST_TX_HASH,
        chain: 'solana',
      };

      const plan = await planner.plan({ target: txTarget }, 'What happened?');

      expect(plan.unresolvedRequirements?.length).toBeGreaterThan(0);
      expect(
        plan.warnings.some((w) => w.code === 'CHAIN_UNSUPPORTED' && w.message.toLowerCase().includes('solana'))
      ).toBe(true);
    });
  });

  // =========================================================================
  // 4. CRITICAL EPISTEMIC RULE FOR WALLETS (ZERO HOLDINGS)
  // =========================================================================
  describe('4. Wallet Epistemic Boundaries & Zero Holdings', () => {
    it('produces compliant statement for zero holdings and forbids unproven liquidation claims', async () => {
      const walletTarget: WalletTarget = {
        type: 'wallet',
        address: TEST_WALLET_ADDR,
        chain: 'ethereum',
      };

      const zeroBalanceEvidence: EvidenceItem = {
        evidenceId: 'evi_zero_bal',
        investigationId: 'inv_wallet_test',
        provenance: {
          capability: 'wallet_current_balance',
          endpoint: '/api/v1/wallet/balance',
          relevantWallet: TEST_WALLET_ADDR,
          creditsCost: 1,
          retrievedAt: new Date().toISOString(),
        },
        title: 'Wallet Current Balance: Empty',
        summary: 'Wallet has no current token positions',
        normalizedData: {
          tokens: [],
          total_value_usd: 0,
          native_balance: 0,
        },
        rawPayload: { tokens: [] },
      };

      const result = await synthesisEngine.synthesize({
        question: 'What are the current holdings of this wallet?',
        investigationId: 'inv_wallet_test',
        target: walletTarget,
        tokenContext: {
          symbol: 'ETH',
          chain: 'ethereum',
          address: TEST_WALLET_ADDR,
          name: 'Ethereum',
          resolvedAt: new Date().toISOString(),
        },
        evidence: [zeroBalanceEvidence],
      });

      expect(result.success).toBe(true);
      expect(result.validated).toBe(true);
      expect(result.answer).toContain('Current wallet balance data returned no token positions.');
      expect(result.answer).toContain(
        'PROBE could not establish why this wallet currently has no token positions from the available evidence.'
      );

      // Must NEVER claim unsupported causal narratives
      expect(result.answer).not.toMatch(/liquidated/i);
      expect(result.answer).not.toMatch(/transferred elsewhere/i);
      expect(result.answer).not.toMatch(/functions as an intermediary/i);
    });

    it('validator rejects ungrounded causal claims about zero holdings', () => {
      const invalidCandidate = {
        success: true,
        answer: 'This indicates the wallet completely liquidated its positions.',
        observations: [
          {
            id: 'fnd_1',
            statement: 'This indicates the wallet completely liquidated its positions.',
            evidenceRefs: ['evi_1'],
          },
        ],
        interpretations: [],
        hypotheses: [],
        unknowns: [],
        evidenceRefs: ['evi_1'],
        followUpQuestions: [],
        validated: false,
        investigationId: 'inv_1',
        createdAt: new Date().toISOString(),
      };

      const evidence: EvidenceItem[] = [
        {
          evidenceId: 'evi_1',
          investigationId: 'inv_1',
          provenance: {
            capability: 'wallet_current_balance',
            endpoint: '/balance',
            creditsCost: 1,
            retrievedAt: new Date().toISOString(),
          },
          title: 'Balance',
          summary: '0 positions',
          normalizedData: { tokens: [] },
        },
      ];

      const validation = validator.validate(invalidCandidate, evidence, 'inv_1', TEST_WALLET_ADDR);
      expect(validation.isValid).toBe(false);
      expect(
        validation.errors.some(
          (e) => e.code === 'UNSUPPORTED_CAUSAL_INFERENCE_FROM_ABSENCE'
        )
      ).toBe(true);
    });
  });

  // =========================================================================
  // 5. TELEGRAM PRESENTATION & DEDICATED FORMATS
  // =========================================================================
  describe('5. Telegram Presentation & Type Headers', () => {
    it('Wallet investigation outputs "🔎 WALLET INVESTIGATION" on Line 1', () => {
      const walletTarget: WalletTarget = {
        type: 'wallet',
        address: TEST_WALLET_ADDR,
        chain: 'ethereum',
        chainDisplayName: 'Ethereum',
      };

      const turnResult: InvestigationTurnResult = {
        investigationId: 'inv_wallet_format',
        question: 'Profile this wallet',
        target: walletTarget,
        status: 'completed',
        synthesis: {
          success: true,
          answer: '...',
          typedResult: {
            targetType: 'wallet',
            target: walletTarget,
            balances: {
              nativeAsset: 'ETH: 4.5',
              tokenPositions: ['USDC: 50,000 ($50,000)'],
              portfolioValue: '$62,500.00',
              rawCount: 1,
            },
            recentActivity: ['Transfer of 10.00 ETH to 0x1234...5678'],
            largeMovements: ['Transfer of 10.00 ETH to 0x1234...5678'],
            funding: {
              firstFunder: 'Binance Hot Wallet',
              firstFundingActivity: 'Initial funding transaction at 2024-01-01',
            },
            counterparties: ['Uniswap V3 Router (25 interactions)'],
            relatedWallets: ['0xabcd...ef01 (score: 95)'],
            findings: [
              {
                id: 'fnd_1',
                statement: 'First funded by: Binance Hot Wallet',
                evidenceRefs: ['evi_1'],
              },
            ],
            notEstablished: [],
            evidence: ['Wallet balance', 'Wallet transactions', 'First funder'],
            limitations: [],
            confidence: 'high',
            followUps: [
              'What are its biggest transactions?',
              'Who funded this wallet?',
              'Who does this wallet interact with?',
              'Show its recent activity.',
            ],
          },
          observations: [],
          interpretations: [],
          hypotheses: [],
          unknowns: [],
          evidenceRefs: ['evi_1'],
          followUpQuestions: ['Ask another question about this wallet.'],
          validated: true,
          investigationId: 'inv_wallet_format',
          createdAt: new Date().toISOString(),
        },
      };

      const formatted = formatInvestigationResult(turnResult);
      const lines = formatted.split('\n');

      expect(lines[0]).toBe('🔎 WALLET INVESTIGATION');
      expect(lines[1]).toContain('Ethereum');
      expect(formatted).toContain('CURRENT BALANCES');
      expect(formatted).toContain('RECENT ACTIVITY');
      expect(formatted).toContain('LARGE / NOTABLE MOVEMENTS');
      expect(formatted).toContain('FUNDING');
      expect(formatted).toContain('COUNTERPARTIES');
      expect(formatted).toContain('RELATED WALLETS');
      expect(formatted).toContain('EVIDENCE');
      expect(formatted).toContain('Ask another question about this wallet.');
    });

    it('Token investigation outputs "🔎 TOKEN INVESTIGATION" on Line 1', () => {
      const tokenTarget: TokenTarget = {
        type: 'token',
        chain: 'ethereum',
        chainDisplayName: 'Ethereum',
        token: {
          symbol: 'PEPE',
          chain: 'ethereum',
          address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
          name: 'Pepe',
          resolvedAt: new Date().toISOString(),
        },
      };

      const turnResult: InvestigationTurnResult = {
        investigationId: 'inv_token_format',
        question: 'Who is buying?',
        target: tokenTarget,
        status: 'completed',
        synthesis: {
          success: true,
          answer: '...',
          typedResult: {
            targetType: 'token',
            target: tokenTarget,
            overview: {
              token: 'Pepe (PEPE)',
              chain: 'Ethereum',
              contract: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
              marketContext: 'Pepe spot price is active',
            },
            flowActivity: {
              inflowsOutflows: 'Fresh Wallets: +$1.2M net flow',
              buyersSellers: 'Top buyer: 0x1111...2222',
            },
            notableActivity: ['Large transfer of 500M PEPE'],
            findings: [
              {
                id: 'fnd_1',
                statement: 'Top buyer: 0x1111...2222 ($250,000)',
                evidenceRefs: ['evi_1'],
              },
            ],
            evidence: ['Cohort net flows', 'Top buyer/seller data'],
            limitations: [],
            confidence: 'high',
            followUps: ['Who is selling?', 'Biggest transactions'],
          },
          observations: [],
          interpretations: [],
          hypotheses: [],
          unknowns: [],
          evidenceRefs: ['evi_1'],
          followUpQuestions: ['Ask another question about PEPE.'],
          validated: true,
          investigationId: 'inv_token_format',
          createdAt: new Date().toISOString(),
        },
      };

      const formatted = formatInvestigationResult(turnResult);
      const lines = formatted.split('\n');

      expect(lines[0]).toBe('🔎 TOKEN INVESTIGATION');
      expect(lines[1]).toContain('PEPE · Ethereum');
      expect(formatted).toContain('🔎 PEPE — Who is buying?');
    });

    it('Transaction investigation outputs "🔎 TRANSACTION INVESTIGATION" on Line 1', () => {
      const txTarget: TransactionTarget = {
        type: 'transaction',
        transactionHash: TEST_TX_HASH,
        chain: 'ethereum',
        chainDisplayName: 'Ethereum',
      };

      const turnResult: InvestigationTurnResult = {
        investigationId: 'inv_tx_format',
        question: 'Inspect this transaction',
        target: txTarget,
        status: 'completed',
        synthesis: {
          success: true,
          answer: '...',
          typedResult: {
            targetType: 'transaction',
            target: txTarget,
            status: 'Confirmed',
            when: '2024-03-01 12:00:00',
            from: '0xaaaa...1111',
            to: '0xbbbb...2222',
            assetValue: '$1,500,000 (500 ETH)',
            transactionType: 'Transfer',
            movement: '0xaaaa...1111 → 0xbbbb...2222',
            counterparties: ['0xaaaa...1111', '0xbbbb...2222'],
            notableDetails: ['Gas used: 21000'],
            findings: [
              {
                id: 'fnd_tx',
                statement: 'Transaction confirmed on ethereum at block timestamp 2024-03-01 12:00:00',
                evidenceRefs: ['evi_tx'],
              },
            ],
            notEstablished: [],
            evidence: ['Transaction record', 'Token transfer records'],
            limitations: [],
            confidence: 'high',
            followUps: ['Who sent this transaction?', 'Who was the recipient?'],
          },
          observations: [],
          interpretations: [],
          hypotheses: [],
          unknowns: [],
          evidenceRefs: ['evi_tx'],
          followUpQuestions: ['Ask another question about this transaction.'],
          validated: true,
          investigationId: 'inv_tx_format',
          createdAt: new Date().toISOString(),
        },
      };

      const formatted = formatInvestigationResult(turnResult);
      const lines = formatted.split('\n');

      expect(lines[0]).toBe('🔎 TRANSACTION INVESTIGATION');
      expect(formatted).toContain('STATUS');
      expect(formatted).toContain('WHEN');
      expect(formatted).toContain('FROM');
      expect(formatted).toContain('TO');
      expect(formatted).toContain('ASSET / VALUE');
      expect(formatted).toContain('TRANSACTION TYPE');
      expect(formatted).toContain('MOVEMENT');
    });

    it('Chain investigation outputs "🔎 CHAIN INVESTIGATION" on Line 1', () => {
      const chainTarget: ChainTarget = {
        type: 'chain',
        chain: 'ethereum',
        chainDisplayName: 'Ethereum',
      };

      const turnResult: InvestigationTurnResult = {
        investigationId: 'inv_chain_format',
        question: 'What is happening on Ethereum?',
        target: chainTarget,
        status: 'completed',
        synthesis: {
          success: true,
          answer: '...',
          typedResult: {
            targetType: 'chain',
            target: chainTarget,
            overview: {
              chain: 'Ethereum',
              nativeAsset: 'ETH',
            },
            currentActivity: 'Network flow: Fresh wallets net flow +$50.00M, Exchanges net flow -$10.00M.',
            largeTransactions: ['Transfer of 1,000.00 ETH from 0x1111...2222 → 0x3333...4444'],
            whaleSmartMoneyActivity: ['Whale wallets: +$20.00M net flow'],
            nativeAssetActivity: 'ETH spot price is currently $3,500',
            notableMovements: [],
            findings: [
              {
                id: 'fnd_ch',
                statement: 'Fresh-wallet net inflows indicate active capital deployment',
                evidenceRefs: ['evi_ch'],
              },
            ],
            notEstablished: [],
            evidence: ['ETH token metrics', 'Cohort net flows'],
            limitations: [],
            confidence: 'high',
            followUps: [
              'What are the biggest transactions on Ethereum?',
              'Who are the biggest whales on Ethereum?',
            ],
          },
          observations: [],
          interpretations: [],
          hypotheses: [],
          unknowns: [],
          evidenceRefs: ['evi_ch'],
          followUpQuestions: ['Ask another question about Ethereum.'],
          validated: true,
          investigationId: 'inv_chain_format',
          createdAt: new Date().toISOString(),
        },
      };

      const formatted = formatInvestigationResult(turnResult);
      const lines = formatted.split('\n');

      expect(lines[0]).toBe('🔎 CHAIN INVESTIGATION');
      expect(lines[1]).toBe('Ethereum');
      expect(formatted).toContain('CHAIN OVERVIEW');
      expect(formatted).toContain('CURRENT ACTIVITY');
      expect(formatted).toContain('LARGE TRANSACTIONS');
      expect(formatted).toContain('WHALE / SMART MONEY ACTIVITY');
    });

    it('deriveNextSuggestions respects chain capability support for wallets', () => {
      const evmWallet: WalletTarget = {
        type: 'wallet',
        address: TEST_WALLET_ADDR,
        chain: 'ethereum',
      };
      const evmSuggestions = deriveNextSuggestions('tell me about this wallet', '', evmWallet);
      expect(evmSuggestions).toContain('What are its biggest transactions?');
      expect(evmSuggestions).toContain('Who funded this wallet?');

      const solanaWallet: WalletTarget = {
        type: 'wallet',
        address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
        chain: 'solana',
      };
      const solanaSuggestions = deriveNextSuggestions('tell me about this wallet', '', solanaWallet);
      // Profiler transactions and first funder are NOT supported on Solana!
      expect(solanaSuggestions).not.toContain('What are its biggest transactions?');
      expect(solanaSuggestions).not.toContain('Who funded this wallet?');
      expect(solanaSuggestions).toContain('What is its current balance?');
    });
  });
});
