import { describe, expect, it, vi } from 'vitest';
import { UserFromGetMe } from 'grammy/types';
import { TokenResolver } from '../../../src/core/token/resolver.js';
import { INansenClient } from '../../../src/core/nansen/client.js';
import { ProbeTelegramBot } from '../../../src/adapters/telegram/bot.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';
import { SearchGeneralStrategy } from '../../../src/core/token/strategies/search-general-strategy.js';
import { TokenInformationStrategy } from '../../../src/core/token/strategies/token-information-strategy.js';
import { isExactAddressMatch, normalizeAddress } from '../../../src/core/token/address-utils.js';

const MOCK_BOT_INFO: UserFromGetMe = {
  id: 999999,
  is_bot: true,
  first_name: 'PROBE Bot',
  username: 'probe_test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

describe('Solana Token Resolution Test Matrix & UX Flow', () => {
  // A. Known Solana token address that Nansen resolves
  it('A. Known Solana token address that Nansen resolves via SearchGeneral (0 credits)', async () => {
    const solanaMint = '3znS89gifim2Hhhu8wjb2PfSgaCDdma187D5NMkDpump';

    const mockClient: INansenClient = {
      searchGeneral: vi.fn().mockResolvedValue({
        data: {
          tokens: [
            {
              name: '🌱 Buttbrain',
              symbol: 'BRAIN',
              chain: 'solana',
              address: solanaMint,
              decimals: 6,
            },
          ],
        },
        meta: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 5 },
      }),
      getTokenInformation: vi.fn(),
    } as unknown as INansenClient;

    const resolver = new TokenResolver({ nansenClient: mockClient });
    const result = await resolver.resolveDetailed(solanaMint);

    expect(result.status).toBe('RESOLVED');
    expect(result.token).toBeDefined();
    expect(result.token?.address).toBe(solanaMint);
    expect(result.token?.symbol).toBe('BRAIN');
    expect(result.token?.chain).toBe('solana');
    expect(result.creditCost).toBe(0);
    expect(mockClient.searchGeneral).toHaveBeenCalledTimes(1);
    expect(mockClient.getTokenInformation).not.toHaveBeenCalled();
  });

  // B1. Solana address that search/general does not return, resolved by TokenInformation fallback (1 credit)
  it('B1. Solana address not in search/general is resolved by TokenInformation fallback (1 credit)', async () => {
    const solanaMint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

    const mockClient: INansenClient = {
      searchGeneral: vi.fn().mockResolvedValue({
        data: { tokens: [] },
        meta: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 5 },
      }),
      getTokenInformation: vi.fn().mockResolvedValue({
        data: {
          token_address: solanaMint,
          symbol: 'BONK',
          name: 'Bonk',
          chain: 'solana',
          decimals: 5,
        },
        meta: { creditsCost: 1, creditsUsed: 1, creditsRemaining: 999, durationMs: 10 },
      }),
    } as unknown as INansenClient;

    const resolver = new TokenResolver({ nansenClient: mockClient });
    const result = await resolver.resolveDetailed(solanaMint);

    expect(result.status).toBe('RESOLVED');
    expect(result.token?.symbol).toBe('BONK');
    expect(result.token?.chain).toBe('solana');
    expect(result.token?.address).toBe(solanaMint);
    expect(result.creditCost).toBe(1);
    expect(mockClient.searchGeneral).toHaveBeenCalledTimes(2); // with chain, then without chain
    expect(mockClient.getTokenInformation).toHaveBeenCalledWith(
      expect.objectContaining({
        token_address: solanaMint,
        chain: 'solana',
      })
    );
  });

  // B2. Solana address that neither search/general nor token-information can resolve -> VALID ADDRESS BUT NOT RESOLVED
  it('B2. Valid Solana address not indexed by Nansen returns NOT_FOUND (VALID ADDRESS BUT NOT RESOLVED)', async () => {
    const validSolanaMint = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';

    const mockClient: INansenClient = {
      searchGeneral: vi.fn().mockResolvedValue({
        data: { tokens: [] },
        meta: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 5 },
      }),
      getTokenInformation: vi.fn().mockRejectedValue(new Error('Token not found (404)')),
    } as unknown as INansenClient;

    const resolver = new TokenResolver({ nansenClient: mockClient });
    const result = await resolver.resolveDetailed(validSolanaMint);

    expect(result.status).toBe('NOT_FOUND');
    expect(result.token).toBeUndefined();
    expect(result.failureReason).toBe('NOT_INDEXED_BY_NANSEN');
    expect(result.creditCost).toBe(1);
  });

  // C. Solana address where search returns a different token (fuzzy match)
  it('C. Rejects fuzzy search match when returned address does not match input address', async () => {
    const inputAddress = '3znS89gifim2Hhhu8wjb2PfSgaCDdma187D5NMkDupmp'; // Ends with Dupmp
    const differentAddress = '3znS89gifim2Hhhu8wjb2PfSgaCDdma187D5NMkDpump'; // Ends with Dpump

    const mockClient: INansenClient = {
      searchGeneral: vi.fn().mockResolvedValue({
        data: {
          tokens: [
            {
              name: 'Fuzzy Token',
              symbol: 'FUZZY',
              chain: 'solana',
              address: differentAddress, // DIFFERENT address
            },
          ],
        },
        meta: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 5 },
      }),
      getTokenInformation: vi.fn().mockResolvedValue({
        data: {
          // Token info returns empty / zero shell
          data: {
            name: '',
            symbol: '',
            contract_address: inputAddress,
          },
        },
        meta: { creditsCost: 1, creditsUsed: 1, creditsRemaining: 999, durationMs: 10 },
      }),
    } as unknown as INansenClient;

    const resolver = new TokenResolver({ nansenClient: mockClient });
    const result = await resolver.resolveDetailed(inputAddress);

    // MUST NOT accept the different token! Must return NOT_FOUND
    expect(result.status).toBe('NOT_FOUND');
    expect(result.token).toBeUndefined();
  });

  // D. Invalid base58 string
  it('D. Invalid base58 string returns INVALID_ADDRESS without calling Nansen API', async () => {
    // Contains '0', which is an invalid Base58 character
    const invalidBase58 = '3znS89gifim2Hhhu8wjb2PfSgaCDdma187D5NMkDupm0';

    const mockClient: INansenClient = {
      searchGeneral: vi.fn(),
      getTokenInformation: vi.fn(),
    } as unknown as INansenClient;

    const resolver = new TokenResolver({ nansenClient: mockClient });
    const result = await resolver.resolveDetailed(invalidBase58);

    expect(result.status).toBe('INVALID_ADDRESS');
    expect(result.token).toBeUndefined();
    expect(result.creditCost).toBe(0);
    expect(mockClient.searchGeneral).not.toHaveBeenCalled();
    expect(mockClient.getTokenInformation).not.toHaveBeenCalled();
  });

  // E. EVM token address
  it('E. EVM token address resolves with case-insensitive address normalization', async () => {
    const evmAddrMixed = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const evmAddrLower = evmAddrMixed.toLowerCase();

    const mockClient: INansenClient = {
      searchGeneral: vi.fn().mockResolvedValue({
        data: {
          tokens: [
            {
              name: 'USD Coin',
              symbol: 'USDC',
              chain: 'ethereum',
              address: evmAddrLower,
              decimals: 6,
            },
          ],
        },
        meta: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 5 },
      }),
    } as unknown as INansenClient;

    const resolver = new TokenResolver({ nansenClient: mockClient });
    const result = await resolver.resolveDetailed(evmAddrMixed);

    expect(result.status).toBe('RESOLVED');
    expect(result.token?.symbol).toBe('USDC');
    expect(result.token?.chain).toBe('ethereum');
    expect(result.creditCost).toBe(0);
    expect(isExactAddressMatch(evmAddrMixed, evmAddrLower, 'ethereum')).toBe(true);
  });

  // F. Symbol-only input
  it('F. Symbol-only input resolves when unambiguous', async () => {
    const mockClient: INansenClient = {
      searchGeneral: vi.fn().mockResolvedValue({
        data: {
          tokens: [
            {
              name: 'Solana',
              symbol: 'SOL',
              chain: 'solana',
              address: 'So11111111111111111111111111111111111111112',
              volume_24h: 1000000000,
            },
          ],
        },
        meta: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 5 },
      }),
    } as unknown as INansenClient;

    const resolver = new TokenResolver({ nansenClient: mockClient });
    const result = await resolver.resolveDetailed('SOL');

    expect(result.status).toBe('RESOLVED');
    expect(result.token?.symbol).toBe('SOL');
    expect(result.token?.chain).toBe('solana');
  });

  // G. Same symbol on multiple chains -> AMBIGUOUS_SYMBOL
  it('G. Same symbol on multiple chains returns AMBIGUOUS_SYMBOL with relevant chains', async () => {
    const mockClient: INansenClient = {
      searchGeneral: vi.fn().mockResolvedValue({
        data: {
          tokens: [
            {
              name: 'Pepe',
              symbol: 'PEPE',
              chain: 'ethereum',
              address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
              volume_24h: 50000000,
            },
            {
              name: 'Pepe',
              symbol: 'PEPE',
              chain: 'arbitrum',
              address: '0x25d887ce7a350f4438f5fb049a72c37935697368',
              volume_24h: 40000000,
            },
            {
              name: 'Pepe',
              symbol: 'PEPE',
              chain: 'solana',
              address: '25hAyBQfoDhfWx9ay6rarspvGCwMhC22zpV1iDWYpump',
              volume_24h: 30000000,
            },
          ],
        },
        meta: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 5 },
      }),
    } as unknown as INansenClient;

    const resolver = new TokenResolver({ nansenClient: mockClient });
    const result = await resolver.resolveDetailed('PEPE');

    expect(result.status).toBe('AMBIGUOUS_SYMBOL');
    expect(result.token).toBeUndefined();
    expect(result.availableChains).toBeDefined();
    expect(result.availableChains).toContain('Ethereum');
    expect(result.availableChains).toContain('Arbitrum');
    expect(result.availableChains).toContain('Solana');
  });

  // Telegram UX distinction tests
  describe('Telegram UX message distinction', () => {
    let replies: Array<{ text: string }>;
    let bot: any;
    let manager: InvestigationManager;
    let orchestratorMock: InvestigationOrchestrator;

    const setupBotWithResolver = (resolver: TokenResolver) => {
      replies = [];
      manager = new InvestigationManager();
      orchestratorMock = {
        executeTurn: vi.fn(),
      } as unknown as InvestigationOrchestrator;

      const probeBot = new ProbeTelegramBot({
        botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        orchestrator: orchestratorMock,
        investigationManager: manager,
        tokenResolver: resolver,
      });

      bot = probeBot.getBot();
      bot.botInfo = MOCK_BOT_INFO;

      bot.api.config.use(async (_prev: any, method: string, payload: any) => {
        if (method === 'sendMessage') {
          replies.push(payload);
          return { ok: true, result: { message_id: replies.length, chat: { id: payload.chat_id, type: 'private' }, text: payload.text } };
        }
        return { ok: true, result: {} };
      });
    };

    it('UX 1: Invalid address returns "I couldn\'t identify that token."', async () => {
      const resolver = new TokenResolver();
      setupBotWithResolver(resolver);

      await bot.handleUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 1001, type: 'private' },
          from: { id: 1001, is_bot: false, first_name: 'User1' },
          text: '3znS89gifim2Hhhu8wjb2PfSgaCDdma187D5NMkDupm0', // invalid base58
        },
      });

      expect(replies).toHaveLength(1);
      expect(replies[0].text).toContain("I couldn't identify that token.");
    });

    it('UX 2: Valid address but NOT resolved returns "I couldn\'t find that token in Nansen\'s indexed data."', async () => {
      const mockClient: INansenClient = {
        searchGeneral: vi.fn().mockResolvedValue({ data: { tokens: [] }, meta: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 1 } }),
        getTokenInformation: vi.fn().mockRejectedValue(new Error('404 Not Found')),
      } as unknown as INansenClient;

      const resolver = new TokenResolver({ nansenClient: mockClient });
      setupBotWithResolver(resolver);

      // Valid 44-character base58 Solana address
      const validUnindexedSolanaAddress = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';

      await bot.handleUpdate({
        update_id: 2,
        message: {
          message_id: 2,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 1002, type: 'private' },
          from: { id: 1002, is_bot: false, first_name: 'User2' },
          text: validUnindexedSolanaAddress,
        },
      });

      expect(replies).toHaveLength(1);
      expect(replies[0].text).toBe("I couldn't find that token in Nansen's indexed data.");
      expect(replies[0].text).not.toContain("I couldn't identify that token.");
    });

    it('UX 3: Resolved token returns "🔎 TOKEN \\n\\n What do you want to investigate?"', async () => {
      const solanaMint = '3znS89gifim2Hhhu8wjb2PfSgaCDdma187D5NMkDpump';
      const mockClient: INansenClient = {
        searchGeneral: vi.fn().mockResolvedValue({
          data: {
            tokens: [
              {
                name: 'Buttbrain',
                symbol: 'BRAIN',
                chain: 'solana',
                address: solanaMint,
              },
            ],
          },
          meta: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 1 },
        }),
      } as unknown as INansenClient;

      const resolver = new TokenResolver({ nansenClient: mockClient });
      setupBotWithResolver(resolver);

      await bot.handleUpdate({
        update_id: 3,
        message: {
          message_id: 3,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 1003, type: 'private' },
          from: { id: 1003, is_bot: false, first_name: 'User3' },
          text: solanaMint,
        },
      });

      expect(replies).toHaveLength(1);
      expect(replies[0].text).toContain('🔎 BRAIN');
      expect(replies[0].text).toContain('What do you want to investigate?');
    });

    it('UX 4: Ambiguous symbol prompts "Which chain?" with candidate chains', async () => {
      const mockClient: INansenClient = {
        searchGeneral: vi.fn().mockResolvedValue({
          data: {
            tokens: [
              { name: 'Pepe', symbol: 'PEPE', chain: 'ethereum', address: '0x123' },
              { name: 'Pepe', symbol: 'PEPE', chain: 'arbitrum', address: '0x456' },
            ],
          },
          meta: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 1 },
        }),
      } as unknown as INansenClient;

      const resolver = new TokenResolver({ nansenClient: mockClient });
      setupBotWithResolver(resolver);

      await bot.handleUpdate({
        update_id: 4,
        message: {
          message_id: 4,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 1004, type: 'private' },
          from: { id: 1004, is_bot: false, first_name: 'User4' },
          text: 'PEPE',
        },
      });

      expect(replies).toHaveLength(1);
      expect(replies[0].text).toContain('Which chain?');
      expect(replies[0].text).toContain('• Ethereum');
      expect(replies[0].text).toContain('• Arbitrum');
    });
  });
});
