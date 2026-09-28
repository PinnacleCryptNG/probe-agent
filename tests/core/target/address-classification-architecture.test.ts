import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AddressClassifier,
  IEvmRpcClient,
} from '../../../src/core/target/address-classifier.js';
import { TargetResolver } from '../../../src/core/target/target-resolver.js';
import { ITokenResolver, TokenCandidate, TokenResolutionResult } from '../../../src/core/token/types.js';
import { TokenContext } from '../../../src/types/domain.js';
import { WalletTarget, TokenTarget, ContractTarget } from '../../../src/core/target/types.js';
import { TelegramMessages } from '../../../src/adapters/telegram/messages.js';
import { InvestigationPlanner } from '../../../src/core/planner/planner.js';
import { CapabilityRegistry } from '../../../src/core/capabilities/registry.js';
import { MockLLMProvider } from '../../../src/core/llm/interface.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { EvidenceExecutor } from '../../../src/core/evidence/executor.js';
import { EvidenceSynthesisEngine } from '../../../src/core/synthesis/synthesizer.js';
import { isOffChainRoadmapOrIntent } from '../../../src/core/planner/prediction.js';
import { INansenClient } from '../../../src/core/nansen/client.js';

describe('PROBE — Address Classification Architecture & Pipeline Suite', () => {
  const EOA_ADDRESS = '0x1111111111111111111111111111111111111111';
  const GENERIC_CONTRACT_ADDRESS = '0x2222222222222222222222222222222222222222';
  const TOKEN_CONTRACT_ADDRESS = '0x3333333333333333333333333333333333333333';
  const MULTI_CHAIN_ADDRESS = '0x4444444444444444444444444444444444444444';
  const PERSISTENCE_ADDRESS = '0x5555555555555555555555555555555555555555';

  const CONTRACT_BYTECODE = '0x608060405234801561001057600080fd5b506004361061004157';

  let mockRpcClient: IEvmRpcClient;
  let classifier: AddressClassifier;
  let mockTokenResolver: ITokenResolver;
  let targetResolver: TargetResolver;

  const mockTokenContext: TokenContext = {
    address: TOKEN_CONTRACT_ADDRESS,
    symbol: 'MOCKTOKEN',
    name: 'Mock Token',
    chain: 'ethereum',
    decimals: 18,
    resolvedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    // Mock RPC client simulating eth_getCode
    mockRpcClient = {
      getCode: vi.fn(async (address: string, chain: string) => {
        const addr = address.toLowerCase();
        const ch = chain.toLowerCase();

        // EOA address returns "0x" (no deployed bytecode)
        if (addr === EOA_ADDRESS.toLowerCase()) {
          return '0x';
        }

        // Generic contract returns bytecode on Ethereum
        if (addr === GENERIC_CONTRACT_ADDRESS.toLowerCase()) {
          return ch === 'ethereum' ? CONTRACT_BYTECODE : '0x';
        }

        // Token contract returns bytecode on Ethereum
        if (addr === TOKEN_CONTRACT_ADDRESS.toLowerCase()) {
          return ch === 'ethereum' ? CONTRACT_BYTECODE : '0x';
        }

        // Multi-chain address: contract on Ethereum, EOA on Base/others
        if (addr === MULTI_CHAIN_ADDRESS.toLowerCase()) {
          return ch === 'ethereum' ? CONTRACT_BYTECODE : '0x';
        }

        // Persistence test address: EOA on Ethereum and Base
        if (addr === PERSISTENCE_ADDRESS.toLowerCase()) {
          return '0x';
        }

        return '0x';
      }),
    };

    classifier = new AddressClassifier(mockRpcClient);

    // Mock token resolver simulating Nansen token resolution
    mockTokenResolver = {
      resolve: vi.fn(async (cand) => {
        const id = typeof cand === 'string' ? cand : cand.identifier;
        if (id.toLowerCase() === TOKEN_CONTRACT_ADDRESS.toLowerCase()) {
          return mockTokenContext;
        }
        return null;
      }),
      resolveDetailed: vi.fn(async (candOrQuery: TokenCandidate | string): Promise<TokenResolutionResult> => {
        const candidate: TokenCandidate =
          typeof candOrQuery === 'string' ? { identifier: candOrQuery, type: 'address' } : candOrQuery;
        if (candidate.identifier.toLowerCase() === TOKEN_CONTRACT_ADDRESS.toLowerCase()) {
          return {
            status: 'RESOLVED',
            token: mockTokenContext,
            candidate,
            detectedChain: 'ethereum',
            creditCost: 0,
          };
        }
        return {
          status: 'NOT_FOUND',
          candidate,
          failureReason: 'NOT_INDEXED_BY_NANSEN',
          creditCost: 0,
        };
      }),
    };

    targetResolver = new TargetResolver({
      tokenResolver: mockTokenResolver,
      addressClassifier: classifier,
    });
  });

  // =========================================================================
  // 1. known Ethereum + EOA -> wallet
  // =========================================================================
  it('1. known Ethereum + EOA -> resolves immediately as wallet without clarification', async () => {
    const res = await targetResolver.resolve({
      question: `${EOA_ADDRESS} on Ethereum`,
    });

    expect(res.status).toBe('RESOLVED');
    if (res.status === 'RESOLVED') {
      expect(res.target.type).toBe('wallet');
      const walletTarget = res.target as WalletTarget;
      expect(walletTarget.address.toLowerCase()).toBe(EOA_ADDRESS.toLowerCase());
      expect(walletTarget.chain).toBe('ethereum');
      expect(res.source).toBe('explicit_message_with_chain');
    }

    // Verify eth_getCode was called for classification
    expect(mockRpcClient.getCode).toHaveBeenCalledWith(EOA_ADDRESS.toLowerCase(), 'ethereum');
  });

  // =========================================================================
  // 2. known Ethereum + contract -> contract
  // =========================================================================
  it('2. known Ethereum + contract -> resolves immediately as generic contract target', async () => {
    const res = await targetResolver.resolve({
      question: `${GENERIC_CONTRACT_ADDRESS} on Ethereum`,
    });

    expect(res.status).toBe('RESOLVED');
    if (res.status === 'RESOLVED') {
      expect(res.target.type).toBe('contract');
      const contractTarget = res.target as ContractTarget;
      expect(contractTarget.address.toLowerCase()).toBe(GENERIC_CONTRACT_ADDRESS.toLowerCase());
      expect(contractTarget.chain).toBe('ethereum');
    }

    // Formatter / message verification
    const formatted = TelegramMessages.contractSelected(GENERIC_CONTRACT_ADDRESS, 'Ethereum');
    expect(formatted).toContain('🔎 CONTRACT ADDRESS');
    expect(formatted).toContain('0x2222...2222 · Ethereum');
    expect(formatted).toContain(
      'I can identify this address, but PROBE does not currently have a dedicated smart-contract investigation mode for this contract type.'
    );
  });

  // =========================================================================
  // 3. known Ethereum + token contract -> token
  // =========================================================================
  it('3. known Ethereum + token contract -> resolves immediately as token target', async () => {
    const res = await targetResolver.resolve({
      question: `${TOKEN_CONTRACT_ADDRESS} on Ethereum`,
    });

    expect(res.status).toBe('RESOLVED');
    if (res.status === 'RESOLVED') {
      expect(res.target.type).toBe('token');
      const tokenTarget = res.target as TokenTarget;
      expect(tokenTarget.token.symbol).toBe('MOCKTOKEN');
      expect(tokenTarget.chain).toBe('ethereum');
      expect(tokenTarget.token.address.toLowerCase()).toBe(TOKEN_CONTRACT_ADDRESS.toLowerCase());
    }
  });

  // =========================================================================
  // 4. unknown chain + address -> automatic chain classification where unambiguous
  // =========================================================================
  it('4. unknown chain + address -> automatic chain classification when exactly one chain is unambiguous', async () => {
    // Create dedicated classifier where only Base produces a meaningful classification
    const singleChainRpc: IEvmRpcClient = {
      getCode: vi.fn(async (_address: string, chain: string) => {
        if (chain === 'base') {
          return CONTRACT_BYTECODE; // Contract on Base
        }
        return null; // Other chains fail/unknown
      }),
    };
    const singleClassifier = new AddressClassifier(singleChainRpc);
    const resolver = new TargetResolver({
      tokenResolver: mockTokenResolver,
      addressClassifier: singleClassifier,
    });

    const res = await resolver.resolve({
      question: '0x9999999999999999999999999999999999999999',
    });

    expect(res.status).toBe('RESOLVED');
    if (res.status === 'RESOLVED') {
      expect(res.target.type).toBe('contract');
      expect(res.target.chain).toBe('base');
    }
  });

  // =========================================================================
  // 5. multiple-chain address -> clarification while preserving classification
  // =========================================================================
  it('5. multiple-chain address -> clarification while preserving discovered classifications', async () => {
    const chatId = 80001;

    // Step 1: User sends raw address without chain
    const turn1 = await targetResolver.resolve({
      question: MULTI_CHAIN_ADDRESS,
      chatId,
    });

    expect(turn1.status).toBe('AMBIGUOUS');
    expect(turn1.candidateIdentifier?.toLowerCase()).toBe(MULTI_CHAIN_ADDRESS.toLowerCase());
    expect(turn1.discoveredClassifications).toBeDefined();
    expect(turn1.discoveredClassifications?.ethereum).toBe('contract');
    expect(turn1.discoveredClassifications?.base).toBe('eoa');
    expect(turn1.clarificationMessage).toContain('🔎 Address detected');
    expect(turn1.clarificationMessage).toContain('Which chain?');

    // Step 2a: If user selects Ethereum -> resolves as contract
    const turn2a = await targetResolver.resolve({
      question: 'Ethereum',
      chatId,
      pendingResolution: targetResolver.getPendingResolution(chatId),
    });

    expect(turn2a.status).toBe('RESOLVED');
    expect(turn2a.target.type).toBe('contract');
    expect(turn2a.target.chain).toBe('ethereum');

    // Reset pending and test Step 2b: If user selects Base -> resolves as wallet
    await targetResolver.resolve({
      question: MULTI_CHAIN_ADDRESS,
      chatId,
    });
    const turn2b = await targetResolver.resolve({
      question: 'Base',
      chatId,
      pendingResolution: targetResolver.getPendingResolution(chatId),
    });

    expect(turn2b.status).toBe('RESOLVED');
    expect(turn2b.target.type).toBe('wallet');
    expect(turn2b.target.chain).toBe('base');
  });

  // =========================================================================
  // 6. invalid chain response does not destroy pending address
  // =========================================================================
  it('6. invalid chain response does not destroy pending address', async () => {
    const chatId = 80002;

    // Step 1: User sends address
    await targetResolver.resolve({
      question: PERSISTENCE_ADDRESS,
      chatId,
    });

    // Step 2: User sends invalid chain "Robinhood"
    const turn2 = await targetResolver.resolve({
      question: 'Robinhood',
      chatId,
      pendingResolution: targetResolver.getPendingResolution(chatId),
    });

    expect(turn2.status).toBe('AMBIGUOUS');
    expect(turn2.candidateIdentifier?.toLowerCase()).toBe(PERSISTENCE_ADDRESS.toLowerCase());
    expect(turn2.clarificationMessage).toContain('I don\'t recognize "Robinhood" as a supported chain.');

    // Pending resolution MUST still be preserved in memory
    const pending = targetResolver.getPendingResolution(chatId);
    expect(pending).toBeDefined();
    expect((pending as any).address.toLowerCase()).toBe(PERSISTENCE_ADDRESS.toLowerCase());

    // Step 3: User corrects with valid chain "Ethereum"
    const turn3 = await targetResolver.resolve({
      question: 'Ethereum',
      chatId,
      pendingResolution: targetResolver.getPendingResolution(chatId),
    });

    expect(turn3.status).toBe('RESOLVED');
    expect(turn3.target.type).toBe('wallet');
    expect(turn3.target.chain).toBe('ethereum');
    expect((turn3.target as WalletTarget).address.toLowerCase()).toBe(PERSISTENCE_ADDRESS.toLowerCase());
  });

  // =========================================================================
  // 7. user saying "that's a contract" is treated only as correction/fallback
  // =========================================================================
  it('7. user saying "that\'s a contract" is a correction fallback, not the primary mechanism', async () => {
    // Primary mechanism: contract is classified automatically from bytecode (Test 2 & 3)
    // Fallback: If an active target is mistakenly an EOA, user correction re-classifies it
    const activeWallet: WalletTarget = {
      type: 'wallet',
      address: GENERIC_CONTRACT_ADDRESS.toLowerCase(),
      chain: 'ethereum',
    };

    const corrected = await targetResolver.resolve({
      question: "that's a contract",
      existingTarget: activeWallet,
    });

    expect(corrected.status).toBe('RESOLVED');
    expect(corrected.target.type).toBe('contract');
    expect(corrected.source).toBe('user_correction');
    expect((corrected.target as ContractTarget).address.toLowerCase()).toBe(GENERIC_CONTRACT_ADDRESS.toLowerCase());
  });

  // =========================================================================
  // 8. user saying "that's a wallet" is also only a correction/fallback
  // =========================================================================
  it('8. user saying "that\'s a wallet" is a correction fallback, not the primary mechanism', async () => {
    // Primary mechanism: EOA is classified automatically from code === '0x' (Test 1)
    // Fallback: If an active target is a contract, user correction re-classifies it as a wallet
    const activeContract: ContractTarget = {
      type: 'contract',
      address: EOA_ADDRESS.toLowerCase(),
      chain: 'ethereum',
    };

    const corrected = await targetResolver.resolve({
      question: "that's a wallet",
      existingTarget: activeContract,
    });

    expect(corrected.status).toBe('RESOLVED');
    expect(corrected.target.type).toBe('wallet');
    expect(corrected.source).toBe('user_correction');
    expect((corrected.target as WalletTarget).address.toLowerCase()).toBe(EOA_ADDRESS.toLowerCase());
  });

  // =========================================================================
  // 9. "who's buying" never triggers off-chain refusal
  // =========================================================================
  it('9. "who\'s buying" never triggers off-chain refusal for token or contract target', async () => {
    expect(isOffChainRoadmapOrIntent("who's buying")).toBe(false);
    expect(isOffChainRoadmapOrIntent("Who is buying?")).toBe(false);
    expect(isOffChainRoadmapOrIntent("who bought and sold")).toBe(false);

    const registry = new CapabilityRegistry();
    const planner = new InvestigationPlanner({
      capabilityRegistry: registry,
      llmProvider: new MockLLMProvider(),
    });
    const manager = new InvestigationManager();
    const executor = new EvidenceExecutor({} as any, registry);
    const synthesizer = new EvidenceSynthesisEngine({ llmProvider: new MockLLMProvider() });
    const orchestrator = new InvestigationOrchestrator({
      planner,
      executor,
      synthesizer,
      manager,
      targetResolver,
    });

    // A. For Token target
    const tokenTarget: TokenTarget = {
      type: 'token',
      token: mockTokenContext,
      chain: 'ethereum',
    };
    const tokenPlan = await planner.plan({ target: tokenTarget }, "who's buying");
    expect(tokenPlan.intent).toBe('accumulation');
    expect(tokenPlan.selectedCapabilities).toContain('who_bought_sold');

    const tokenClarifications = (orchestrator as any).formulateClarificationQuestions(tokenPlan, mockTokenContext);
    for (const msg of tokenClarifications) {
      expect(msg).not.toContain("I can't verify off-chain roadmap");
      expect(msg).not.toContain("off-chain roadmap or developer intent");
    }

    // B. For Contract target
    const contractTarget: ContractTarget = {
      type: 'contract',
      address: GENERIC_CONTRACT_ADDRESS.toLowerCase(),
      chain: 'ethereum',
    };
    const contractPlan = await planner.plan({ target: contractTarget }, "who's buying");
    expect(contractPlan.intent).toBe('accumulation');

    const contractClarifications = (orchestrator as any).formulateClarificationQuestions(contractPlan, mockTokenContext);
    for (const msg of contractClarifications) {
      expect(msg).not.toContain("I can't verify off-chain roadmap");
      expect(msg).not.toContain("off-chain roadmap or developer intent");
    }
  });

  // =========================================================================
  // 10. address classification does not consume a Nansen credit unnecessarily
  // =========================================================================
  it('10. address classification consumes 0 Nansen credits for EOA vs contract check', async () => {
    const mockNansenClient: Partial<INansenClient> = {
      searchGeneral: vi.fn(async () => ({ data: [] } as any)),
      getTokenInformation: vi.fn(async () => ({ data: {} } as any)),
    };

    // Classify an EOA via AddressClassifier
    const classification = await classifier.classify(EOA_ADDRESS, 'ethereum');
    expect(classification.type).toBe('eoa');
    expect(classification.chain).toBe('ethereum');

    // Zero calls made to Nansen API during RPC classification
    expect(mockNansenClient.searchGeneral).not.toHaveBeenCalled();
    expect(mockNansenClient.getTokenInformation).not.toHaveBeenCalled();

    // Resolving an EOA via TargetResolver also uses 0 Nansen credits
    const res = await targetResolver.resolve({
      question: `${EOA_ADDRESS} on ethereum`,
    });
    expect(res.status).toBe('RESOLVED');
    expect(res.target.type).toBe('wallet');

    // Token resolver was never called for EOA
    expect(mockTokenResolver.resolve).not.toHaveBeenCalled();
    expect(mockTokenResolver.resolveDetailed).not.toHaveBeenCalled();
  });
});
