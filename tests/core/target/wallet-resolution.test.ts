import { describe, it, expect, beforeEach } from 'vitest';
import { TargetResolver } from '../../../src/core/target/target-resolver.js';
import { InvestigationPlanner } from '../../../src/core/planner/planner.js';
import { TelegramMessages } from '../../../src/adapters/telegram/messages.js';
import { formatInvestigationResult } from '../../../src/adapters/telegram/formatter.js';
import { CapabilityRegistry } from '../../../src/core/capabilities/registry.js';
import { EvidenceExecutor } from '../../../src/core/evidence/executor.js';
import { EvidenceSynthesisEngine } from '../../../src/core/synthesis/synthesizer.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { InvestigationTarget } from '../../../src/types/domain.js';
import { INansenClient } from '../../../src/infrastructure/nansen/client.js';

describe('PROBE Wallet Target Detection & UX Regression', () => {
  let resolver: TargetResolver;
  let planner: InvestigationPlanner;
  const rawEvmAddress = '0xbba26f90162df285ece4037e90ec2d0c3d89c40a';

  beforeEach(() => {
    resolver = new TargetResolver();
    planner = new InvestigationPlanner();
  });

  describe('1. RAW WALLET (0x + 40 hex characters)', () => {
    it('treats raw 0x EVM address as wallet candidate and does not assume token', async () => {
      const result = await resolver.resolve({
        question: rawEvmAddress,
        chatId: 101,
      });

      expect(result.status).toBe('AMBIGUOUS');
      if (result.status === 'AMBIGUOUS') {
        expect(result.candidateType).toBe('wallet');
        expect(result.candidateIdentifier).toBe(rawEvmAddress.toLowerCase());
        expect(result.availableChains).toContain('Ethereum');
        expect(result.availableChains).toContain('Base');
      }
    });

    it('natural language wallet queries resolve as wallet target', async () => {
      const queries = [
        `Investigate ${rawEvmAddress}`,
        `Who owns this wallet? ${rawEvmAddress}`,
        `What has this wallet been doing? ${rawEvmAddress}`,
        `Show me this wallet's transactions: ${rawEvmAddress}`,
        `Who funded ${rawEvmAddress}?`,
        `What's the balance of ${rawEvmAddress}?`,
      ];

      for (const q of queries) {
        const result = await resolver.resolve({ question: q, chatId: 102 });
        expect(result.status).toBe('AMBIGUOUS');
        if (result.status === 'AMBIGUOUS') {
          expect(result.candidateType).toBe('wallet');
          expect(result.candidateIdentifier).toBe(rawEvmAddress.toLowerCase());
        }
      }
    });
  });

  describe('2. WALLET + CHAIN (Multi-turn clarification)', () => {
    it('prompts "Which chain?" for raw address then resolves wallet + Ethereum on response', async () => {
      // Step 1: User sends raw address
      const res1 = await resolver.resolve({
        question: rawEvmAddress,
        chatId: 201,
      });

      expect(res1.status).toBe('AMBIGUOUS');
      if (res1.status === 'AMBIGUOUS') {
        expect(res1.candidateType).toBe('wallet');
      }

      // Step 2: User responds with "Ethereum"
      const res2 = await resolver.resolve({
        question: 'Ethereum',
        chatId: 201,
      });

      expect(res2.status).toBe('RESOLVED');
      if (res2.status === 'RESOLVED') {
        expect(res2.target.type).toBe('wallet');
        if (res2.target.type === 'wallet') {
          expect(res2.target.address).toBe(rawEvmAddress.toLowerCase());
          expect(res2.target.chain).toBe('ethereum');
        }
      }
    });
  });

  describe('3. ACTIVE CHAIN + WALLET', () => {
    it('automatically resolves wallet + Ethereum without asking when Ethereum chain is active', async () => {
      const existingChainTarget: InvestigationTarget = {
        type: 'chain',
        chain: 'ethereum',
        chainDisplayName: 'Ethereum',
      };

      const result = await resolver.resolve({
        question: rawEvmAddress,
        existingTarget: existingChainTarget,
        chatId: 301,
      });

      expect(result.status).toBe('RESOLVED');
      if (result.status === 'RESOLVED') {
        expect(result.target.type).toBe('wallet');
        if (result.target.type === 'wallet') {
          expect(result.target.address).toBe(rawEvmAddress.toLowerCase());
          expect(result.target.chain).toBe('ethereum');
        }
      }
    });

    it('resolves explicit chain + wallet in single message: "Investigate this Ethereum wallet 0x..."', async () => {
      const result = await resolver.resolve({
        question: `Investigate this Ethereum wallet ${rawEvmAddress}`,
        chatId: 302,
      });

      expect(result.status).toBe('RESOLVED');
      if (result.status === 'RESOLVED') {
        expect(result.target.type).toBe('wallet');
        if (result.target.type === 'wallet') {
          expect(result.target.address).toBe(rawEvmAddress.toLowerCase());
          expect(result.target.chain).toBe('ethereum');
        }
      }
    });
  });

  describe('4. WALLET FOLLOW-UP & CHAIN SWITCHING', () => {
    const activeWallet: InvestigationTarget = {
      type: 'wallet',
      address: rawEvmAddress.toLowerCase(),
      chain: 'ethereum',
      rawIdentifier: rawEvmAddress,
    };

    it('preserves wallet target when asked "Who funded this wallet?"', async () => {
      const result = await resolver.resolve({
        question: 'Who funded this wallet?',
        existingTarget: activeWallet,
        chatId: 401,
      });

      expect(result.status).toBe('RESOLVED');
      if (result.status === 'RESOLVED') {
        expect(result.target.type).toBe('wallet');
        if (result.target.type === 'wallet') {
          expect(result.target.address).toBe(rawEvmAddress.toLowerCase());
          expect(result.target.chain).toBe('ethereum');
        }
      }

      // Planner should route to wallet_first_funder
      const plan = await planner.plan(
        { target: activeWallet },
        'Who funded this wallet?'
      );
      expect(plan.selectedCapabilities).toContain('wallet_first_funder');
    });

    it('preserves wallet target when asked "What has this wallet been doing?"', async () => {
      const result = await resolver.resolve({
        question: 'What has this wallet been doing?',
        existingTarget: activeWallet,
        chatId: 402,
      });

      expect(result.status).toBe('RESOLVED');
      if (result.status === 'RESOLVED') {
        expect(result.target.type).toBe('wallet');
        if (result.target.type === 'wallet') {
          expect(result.target.address).toBe(rawEvmAddress.toLowerCase());
        }
      }
    });

    it('switches chain to Base while preserving wallet address on "What about this wallet on Base?"', async () => {
      const result = await resolver.resolve({
        question: 'What about this wallet on Base?',
        existingTarget: activeWallet,
        chatId: 403,
      });

      expect(result.status).toBe('RESOLVED');
      if (result.status === 'RESOLVED') {
        expect(result.target.type).toBe('wallet');
        if (result.target.type === 'wallet') {
          expect(result.target.address).toBe(rawEvmAddress.toLowerCase());
          expect(result.target.chain).toBe('base');
        }
      }
    });
  });

  describe('5. WALLET INTENTS & CAPABILITY ROUTING', () => {
    const activeWallet: InvestigationTarget = {
      type: 'wallet',
      address: rawEvmAddress.toLowerCase(),
      chain: 'ethereum',
    };

    it('routes "Show me this wallet\'s transactions" to wallet_transactions', async () => {
      const plan = await planner.plan(
        { target: activeWallet },
        "Show me this wallet's transactions"
      );

      expect(plan.selectedCapabilities).toContain('wallet_transactions');
    });

    it('routes "What\'s the balance?" to wallet_current_balance', async () => {
      const plan = await planner.plan(
        { target: activeWallet },
        "What's the balance?"
      );

      expect(plan.selectedCapabilities).toContain('wallet_current_balance');
    });

    it('returns deterministic capability message when unsupported on chain (e.g. wallet_transactions on Solana)', async () => {
      const solanaWallet: InvestigationTarget = {
        type: 'wallet',
        address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
        chain: 'solana',
      };

      const mockNansenClient: INansenClient = {
        searchGeneral: async () => ({ data: { tokens: [], entities: [] } } as any),
        getTokenHistoricalData: async () => ({ data: [] } as any),
        getTokenFlowSummary: async () => ({ data: [] } as any),
        getSmartMoneyHolders: async () => ({ data: [] } as any),
        getTokenDexTrades: async () => ({ data: [] } as any),
        getTokenCurrentHolders: async () => ({ data: [] } as any),
        getFlowIntelligence: async () => ({ data: [] } as any),
        getWalletBalance: async () => ({ data: [] } as any),
        getWalletTransactions: async () => ({ data: [] } as any),
        getWalletFirstFunder: async () => ({ data: [] } as any),
        getWalletRelated: async () => ({ data: [] } as any),
        getWalletCounterparties: async () => ({ data: [] } as any),
        getTopTransactions: async () => ({ data: [] } as any),
      };

      const manager = new InvestigationManager();
      const registry = new CapabilityRegistry();
      const planner = new InvestigationPlanner({ capabilityRegistry: registry });
      const executor = new EvidenceExecutor(mockNansenClient, registry);
      const mockLLM = { generateInvestigationReport: async () => '' } as any;
      const synthesizer = new EvidenceSynthesisEngine({ llmProvider: mockLLM });
      const orchestrator = new InvestigationOrchestrator({
        planner,
        executor,
        synthesizer,
        manager,
      });

      const turn = await orchestrator.executeTurn({
        chatId: 501,
        question: "Show me this wallet's transactions",
        target: solanaWallet,
      });

      expect(turn.status).toBe('capability_unavailable');
      const formatted = formatInvestigationResult(turn);
      expect(formatted).toContain("I can't retrieve verified wallet transaction data for this wallet on Solana because the available Nansen capability does not support that query.");
    });
  });

  describe('6. TOKEN REGRESSION', () => {
    it('$PEPE resolves as token', async () => {
      const result = await resolver.resolve({ question: '$PEPE', chatId: 601 });
      expect(result.status).toBe('RESOLVED');
      if (result.status === 'RESOLVED') {
        expect(result.target.type).toBe('token');
        if (result.target.type === 'token') {
          expect(result.target.token.symbol).toBe('PEPE');
        }
      }
    });

    it('$HYPE resolves as Hyperliquid native asset', async () => {
      const result = await resolver.resolve({ question: '$HYPE', chatId: 602 });
      expect(result.status).toBe('RESOLVED');
      if (result.status === 'RESOLVED') {
        expect(result.target.type).toBe('token');
        if (result.target.type === 'token') {
          expect(result.target.token.symbol).toBe('HYPE');
          expect(result.target.chain).toBe('hyperliquid');
        }
      }
    });

    it('$SOL resolves as Solana native asset', async () => {
      const result = await resolver.resolve({ question: '$SOL', chatId: 603 });
      expect(result.status).toBe('RESOLVED');
      if (result.status === 'RESOLVED') {
        expect(result.target.type).toBe('token');
        if (result.target.type === 'token') {
          expect(result.target.token.symbol).toBe('SOL');
          expect(result.target.chain).toBe('solana');
        }
      }
    });

    it('$APT resolves as Aptos native asset', async () => {
      const result = await resolver.resolve({ question: '$APT', chatId: 604 });
      expect(result.status).toBe('RESOLVED');
      if (result.status === 'RESOLVED') {
        expect(result.target.type).toBe('token');
        if (result.target.type === 'token') {
          expect(result.target.token.symbol).toBe('APT');
          expect(result.target.chain).toBe('aptos');
        }
      }
    });

    it('$ETH resolves as Ethereum native asset', async () => {
      const result = await resolver.resolve({ question: '$ETH', chatId: 605 });
      expect(result.status).toBe('RESOLVED');
      if (result.status === 'RESOLVED') {
        expect(result.target.type).toBe('token');
        if (result.target.type === 'token') {
          expect(result.target.token.symbol).toBe('ETH');
          expect(result.target.chain).toBe('ethereum');
        }
      }
    });
  });

  describe('7. /START UX Copy', () => {
    it('welcome message matches exact required copy', () => {
      const welcome = TelegramMessages.welcome();
      const expected = [
        '🔎 PROBE',
        '',
        'Evidence-first on-chain investigation.',
        '',
        'Investigate chains, tokens, wallets, and transactions.',
        '',
        'Try:',
        "• What's happening on Ethereum?",
        '• Who are the biggest whales on Solana?',
        '• Investigate $PEPE',
        '• Investigate this wallet: 0x...',
        '• What were the biggest transactions this week?',
      ].join('\n');

      expect(welcome).toBe(expected);
      expect(welcome).not.toContain('flows and');
      expect(welcome).not.toContain('Who is buying ETH?');
    });
  });
});
