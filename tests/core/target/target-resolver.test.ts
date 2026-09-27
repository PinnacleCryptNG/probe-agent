import { describe, it, expect, vi } from 'vitest';
import { TargetResolver } from '../../../src/core/target/target-resolver.js';
import {
  InvestigationTarget,
  TokenTarget,
  ChainTarget,
  WalletTarget,
} from '../../../src/core/target/types.js';
import { ITokenResolver, TokenCandidate, TokenResolutionResult } from '../../../src/core/token/types.js';
import { TokenContext } from '../../../src/types/domain.js';

describe('TargetResolver Unit Tests', () => {
  const mockBtcToken: TokenContext = {
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    symbol: 'BTC',
    name: 'Bitcoin',
    chain: 'ethereum',
    resolvedAt: '2026-03-20T00:00:00.000Z',
  };

  const mockEthToken: TokenContext = {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    chain: 'ethereum',
    resolvedAt: '2026-03-20T00:00:00.000Z',
  };

  const mockSolToken: TokenContext = {
    address: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    name: 'Solana',
    chain: 'solana',
    resolvedAt: '2026-03-20T00:00:00.000Z',
  };

  const mockPepeTokenArb: TokenContext = {
    address: '0x25d887ce7a35172c62febfd67a1856620adf2bbe',
    symbol: 'PEPE',
    name: 'Pepe',
    chain: 'arbitrum',
    resolvedAt: '2026-03-20T00:00:00.000Z',
  };

  const activeEthTarget: TokenTarget = {
    type: 'token',
    token: mockEthToken,
    chain: 'ethereum',
    rawIdentifier: 'ETH',
  };

  const activeBtcTarget: TokenTarget = {
    type: 'token',
    token: mockBtcToken,
    chain: 'ethereum',
    rawIdentifier: 'BTC',
  };

  const createMockTokenResolver = (overrides?: Partial<ITokenResolver>): ITokenResolver => ({
    resolve: vi.fn().mockImplementation(async (candidateOrQuery) => {
      const id = typeof candidateOrQuery === 'string' ? candidateOrQuery : candidateOrQuery.identifier;
      const upper = id.toUpperCase();
      if (upper === 'BTC' || upper === 'WBTC' || upper === 'BITCOIN') return mockBtcToken;
      if (upper === 'ETH' || upper === 'ETHER' || upper === 'ETHEREUM') return mockEthToken;
      if (upper === 'SOL' || upper === 'SOLANA') return mockSolToken;
      if (upper === 'PEPE') return mockPepeTokenArb;
      return null;
    }),
    resolveDetailed: vi.fn().mockImplementation(async (candidateOrQuery: TokenCandidate | string): Promise<TokenResolutionResult> => {
      const candidate: TokenCandidate =
        typeof candidateOrQuery === 'string'
          ? { identifier: candidateOrQuery, type: 'symbol' }
          : candidateOrQuery;

      if (candidate.type === 'invalid_address') {
        return {
          status: 'INVALID_ADDRESS',
          candidate,
          failureReason: 'INVALID_ADDRESS_FORMAT',
          creditCost: 0,
        };
      }

      const upper = candidate.identifier.toUpperCase();
      if (upper === 'BTC' || upper === 'WBTC' || upper === 'BITCOIN') {
        return {
          status: 'RESOLVED',
          token: mockBtcToken,
          candidate,
          detectedChain: 'ethereum',
          creditCost: 0,
        };
      }
      if (upper === 'ETH' || upper === 'ETHER' || upper === 'ETHEREUM') {
        return {
          status: 'RESOLVED',
          token: mockEthToken,
          candidate,
          detectedChain: 'ethereum',
          creditCost: 0,
        };
      }
      if (upper === 'SOL' || upper === 'SOLANA') {
        return {
          status: 'RESOLVED',
          token: mockSolToken,
          candidate,
          detectedChain: 'solana',
          creditCost: 0,
        };
      }
      if (upper === 'PEPE' && candidate.detectedChain === 'arbitrum') {
        return {
          status: 'RESOLVED',
          token: mockPepeTokenArb,
          candidate,
          detectedChain: 'arbitrum',
          creditCost: 0,
        };
      }
      if (upper === 'PEPE' && !candidate.detectedChain) {
        return {
          status: 'AMBIGUOUS_SYMBOL',
          candidate,
          availableChains: ['ethereum', 'arbitrum'],
          failureReason: 'MULTIPLE_CHAINS_FOR_SYMBOL',
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
    ...overrides,
  });

  // 1. ETH -> BTC context switch
  it('switches target from active ETH to BTC when user asks "What about BTC?"', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: 'What about BTC?',
      existingTarget: activeEthTarget,
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.target.type).toBe('token');
      expect((result.target as TokenTarget).token.symbol).toBe('BTC');
      expect(result.source).toBe('explicit_message');
    }
  });

  // 2. ETH -> $BTC context switch
  it('switches target from active ETH to BTC when user asks "Why is $BTC pumping suddenly"', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: 'Why is $BTC pumping suddenly',
      existingTarget: activeEthTarget,
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.target.type).toBe('token');
      expect((result.target as TokenTarget).token.symbol).toBe('BTC');
      expect(result.source).toBe('explicit_message');
    }
  });

  // 3. ETH -> Bitcoin context switch
  it('switches target from active ETH to BTC when user asks "Why is Bitcoin pumping?"', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: 'Why is Bitcoin pumping?',
      existingTarget: activeEthTarget,
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.target.type).toBe('token');
      expect((result.target as TokenTarget).token.symbol).toBe('BTC');
      expect(result.source).toBe('explicit_message');
    }
  });

  // 4. ETH -> SOL context switch
  it('switches target from active ETH to SOL when user asks "Who is buying SOL?"', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: 'Who is buying SOL?',
      existingTarget: activeEthTarget,
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.target.type).toBe('token');
      expect((result.target as TokenTarget).token.symbol).toBe('SOL');
      expect((result.target as TokenTarget).chain).toBe('solana');
      expect(result.source).toBe('explicit_message');
    }
  });

  // 5. Token + explicit chain
  it('resolves explicit token and explicit chain context "BTC on Ethereum"', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: 'What were the biggest transactions this week for BTC on Ethereum?',
      existingTarget: activeEthTarget,
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.target.type).toBe('token');
      const tokenTarget = result.target as TokenTarget;
      expect(tokenTarget.token.symbol).toBe('BTC');
      expect(tokenTarget.explicitChain).toBe('ethereum');
      expect(result.source).toBe('explicit_message_with_chain');
    }
  });

  it('resolves explicit token and explicit chain context "SOL on Solana"', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: 'Who is buying SOL on Solana?',
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.target.type).toBe('token');
      const tokenTarget = result.target as TokenTarget;
      expect(tokenTarget.token.symbol).toBe('SOL');
      expect(tokenTarget.explicitChain).toBe('solana');
      expect(result.source).toBe('explicit_message_with_chain');
    }
  });

  // 6. Chain-only investigation
  it('switches scope to Solana chain when user asks "What\'s happening on Solana?" with active ETH', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: "What's happening on Solana?",
      existingTarget: activeEthTarget,
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.target.type).toBe('chain');
      const chainTarget = result.target as ChainTarget;
      expect(chainTarget.chain).toBe('solana');
      expect(chainTarget.chainDisplayName).toBe('Solana');
    }
  });

  it('switches scope to Base chain when user asks "What\'s happening on Base?" with active ETH', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: "What's happening on Base?",
      existingTarget: activeEthTarget,
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.target.type).toBe('chain');
      const chainTarget = result.target as ChainTarget;
      expect(chainTarget.chain).toBe('base');
      expect(chainTarget.chainDisplayName).toBe('Base');
    }
  });

  it('resolves standalone chain inputs like "solana" and "arbitrum"', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());

    const solRes = await resolver.resolve({ question: 'solana' });
    expect(solRes.status).toBe('RESOLVED');
    if (solRes.status === 'RESOLVED') {
      expect(solRes.target.type).toBe('chain');
      expect((solRes.target as ChainTarget).chain).toBe('solana');
    }

    const arbRes = await resolver.resolve({ question: 'arbitrum' });
    expect(arbRes.status).toBe('RESOLVED');
    if (arbRes.status === 'RESOLVED') {
      expect(arbRes.target.type).toBe('chain');
      expect((arbRes.target as ChainTarget).chain).toBe('arbitrum');
    }
  });

  // 7. Wallet target
  it('resolves explicit wallet target with keywords "inspect wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: 'inspect wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      existingTarget: activeEthTarget,
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.target.type).toBe('wallet');
      const walletTarget = result.target as WalletTarget;
      expect(walletTarget.address.toLowerCase()).toBe('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
      expect(walletTarget.chain).toBe('ethereum');
    }
  });

  // 8. Follow-up using existing context
  it('preserves active ETH context for generic follow-up "Who is buying?"', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: 'Who is buying?',
      existingTarget: activeEthTarget,
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.target.type).toBe('token');
      expect((result.target as TokenTarget).token.symbol).toBe('ETH');
      expect(result.source).toBe('existing_context');
    }
  });

  it('preserves active ETH context for generic follow-up "Biggest transactions"', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: 'Biggest transactions',
      existingTarget: activeEthTarget,
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.target.type).toBe('token');
      expect((result.target as TokenTarget).token.symbol).toBe('ETH');
      expect(result.source).toBe('existing_context');
    }
  });

  // 9. Explicit target always overrides old context
  it('always overrides old context when new asset is explicitly named (BTC -> ETH and ETH -> BTC)', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());

    // ETH active, user mentions BTC
    const toBtc = await resolver.resolve({
      question: 'Why is BTC volume up?',
      existingTarget: activeEthTarget,
    });
    expect(toBtc.status).toBe('RESOLVED');
    if (toBtc.status === 'RESOLVED') {
      expect((toBtc.target as TokenTarget).token.symbol).toBe('BTC');
      expect(toBtc.source).toBe('explicit_message');
    }

    // BTC active, user mentions ETH
    const toEth = await resolver.resolve({
      question: 'What about ETH activity?',
      existingTarget: activeBtcTarget,
    });
    expect(toEth.status).toBe('RESOLVED');
    if (toEth.status === 'RESOLVED') {
      expect((toEth.target as TokenTarget).token.symbol).toBe('ETH');
      expect(toEth.source).toBe('explicit_message');
    }
  });

  // 10. Ambiguous ticker handling
  it('returns AMBIGUOUS status when multi-chain symbol is specified without chain', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: 'Why is PEPE pumping?',
    });

    expect(result.status).toBe('AMBIGUOUS');
    if (result.status === 'AMBIGUOUS') {
      expect(result.candidateIdentifier).toBe('PEPE');
      expect(result.availableChains).toContain('ethereum');
      expect(result.availableChains).toContain('arbitrum');
      expect(result.clarificationMessage).toContain('Which chain?');
    }
  });

  it('resolves ambiguous symbol when explicit chain is provided "PEPE on Arbitrum"', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: 'Why is PEPE on Arbitrum pumping?',
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.target.type).toBe('token');
      const tokenTarget = result.target as TokenTarget;
      expect(tokenTarget.token.symbol).toBe('PEPE');
      expect(tokenTarget.chain).toBe('arbitrum');
    }
  });

  // 11. Malformed address handling
  it('returns INVALID_ADDRESS status when user inputs a malformed hex address', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: '0xinvalidaddress123',
    });

    expect(result.status).toBe('INVALID_ADDRESS');
  });

  // 12. Empty question / no context handling
  it('returns NEEDS_TARGET when there is no question and no active target', async () => {
    const resolver = new TargetResolver(createMockTokenResolver());
    const result = await resolver.resolve({
      question: '',
    });

    expect(result.status).toBe('NEEDS_TARGET');
  });
});
