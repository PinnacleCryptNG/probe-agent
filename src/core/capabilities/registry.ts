import { z } from 'zod';
import { PROBE_CONSTANTS } from '../../config/constants.js';
import { CapabilityDefinition, CapabilityName } from '../../types/capabilities.js';
import { UnsupportedCapabilityError, UnsupportedChainError } from '../../types/errors.js';
import { CAPABILITY_CHAIN_SUPPORT } from './chain-support.js';

function getDefaultDateRange(days = 7): { from: string; to: string } {
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);
  const from = fromDate.toISOString().slice(0, 10);
  return { from, to };
}

// Schemas for capability inputs
export const SearchGeneralInputSchema = z
  .object({
    search_query: z.string().optional(),
    query: z.string().optional(),
    chain: z.string().optional(),
    type: z.enum(['token', 'address', 'all']).default('token'),
  })
  .transform((val) => ({
    ...val,
    search_query: val.search_query ?? val.query ?? '',
    query: val.query ?? val.search_query ?? '',
  }));

export const TokenInformationInputSchema = z.object({
  token_address: z.string().min(1),
  chain: z.string().min(1),
  timeframe: z.enum(['5m', '1h', '6h', '12h', '1d', '7d']).default('1d'),
});

export const FlowIntelligenceInputSchema = z
  .object({
    token_address: z.string().min(1),
    chain: z.string().min(1),
    timeframe: z.enum(['5m', '1h', '6h', '12h', '1d', '7d']).optional(),
    time_frame: z.string().optional(),
  })
  .transform((val) => {
    let tf = val.timeframe;
    if (!tf && val.time_frame) {
      if (val.time_frame === '24h') tf = '1d';
      else if (val.time_frame === '7d') tf = '7d';
      else if (['5m', '1h', '6h', '12h', '1d', '7d'].includes(val.time_frame)) tf = val.time_frame as any;
    }
    return {
      token_address: val.token_address,
      chain: val.chain,
      timeframe: tf ?? '1d',
    };
  });

export const WhoBoughtSoldInputSchema = z.object({
  token_address: z.string().min(1),
  chain: z.string().min(1),
  date: z
    .object({
      from: z.string(),
      to: z.string(),
    })
    .default(() => getDefaultDateRange(7)),
  pagination: z
    .object({
      page: z.number().int().positive().default(1),
      per_page: z.number().int().min(1).max(100).default(20),
    })
    .optional(),
});

export const TokenTransfersInputSchema = z.object({
  token_address: z.string().min(1),
  chain: z.string().min(1),
  min_value_usd: z.number().nonnegative().optional(),
  date: z
    .object({
      from: z.string(),
      to: z.string(),
    })
    .default(() => getDefaultDateRange(7)),
  pagination: z
    .object({
      page: z.number().int().positive().default(1),
      per_page: z.number().int().min(1).max(100).default(25),
    })
    .optional(),
});

export const DexTradesInputSchema = z.object({
  token_address: z.string().min(1),
  chain: z.string().min(1),
  date: z
    .object({
      from: z.string(),
      to: z.string(),
    })
    .default(() => getDefaultDateRange(7)),
  pagination: z
    .object({
      page: z.number().int().positive().default(1),
      per_page: z.number().int().min(1).max(100).default(25),
    })
    .optional(),
});

export const HistoricalFlowsInputSchema = z.object({
  token_address: z.string().min(1),
  chain: z.string().min(1),
  date: z
    .object({
      from: z.string(),
      to: z.string(),
    })
    .default(() => getDefaultDateRange(7)),
});

export const TokenHoldersInputSchema = z.object({
  token_address: z.string().min(1),
  chain: z.string().min(1),
  premium_labels: z.literal(false).default(false),
  pagination: z
    .object({
      page: z.number().int().positive().default(1),
      per_page: z.number().int().min(1).max(100).default(25),
    })
    .optional(),
});

export const WalletBalanceInputSchema = z.object({
  address: z.string().min(1),
  chain: z.string().min(1),
});

export const WalletTransactionsInputSchema = z.object({
  address: z.string().min(1),
  chain: z.string().min(1),
  pagination: z
    .object({
      page: z.number().int().positive().default(1),
      per_page: z.number().int().min(1).max(100).default(25),
    })
    .optional(),
});

export const RelatedWalletsInputSchema = z.object({
  address: z.string().min(1),
  chain: z.string().min(1),
});

export const FirstFunderInputSchema = z.object({
  address: z.string().min(1),
  chain: z.string().min(1),
});

export const CounterpartiesInputSchema = z.object({
  address: z.string().min(1),
  chain: z.string().min(1),
  pagination: z
    .object({
      page: z.number().int().positive().default(1),
      per_page: z.number().int().min(1).max(50).default(10),
    })
    .optional(),
});

export const TransactionLookupInputSchema = z.object({
  transaction_hash: z.string().min(1),
  chain: z.string().min(1),
});

export class CapabilityRegistry {
  private capabilities = new Map<CapabilityName, CapabilityDefinition>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    // 1. Token Search / General Resolution
    this.register({
      name: 'token_search',
      description: 'Resolves token symbols, names, and contract addresses across supported chains.',
      endpoint: '/api/v1/search/general',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.TOKEN_SEARCH,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.token_search,
      requiresToken: false,
      requiresAddress: false,
      inputSchema: SearchGeneralInputSchema,
    });

    // 2. Token Information
    this.register({
      name: 'token_information',
      description: 'Retrieves current spot metadata, price, market cap, and volume for a token.',
      endpoint: '/api/v1/tgm/token-information',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.TOKEN_INFORMATION,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.token_information,
      requiresToken: true,
      requiresAddress: false,
      inputSchema: TokenInformationInputSchema,
    });

    // 3. Flow Intelligence
    this.register({
      name: 'flow_intelligence',
      description: 'Analyzes net inflows and outflows across cohorts (whales, smart traders, fresh wallets, exchanges).',
      endpoint: '/api/v1/tgm/flow-intelligence',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.FLOW_INTELLIGENCE,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.flow_intelligence,
      requiresToken: true,
      requiresAddress: false,
      inputSchema: FlowIntelligenceInputSchema,
    });

    // 4. Who Bought / Sold
    this.register({
      name: 'who_bought_sold',
      description: 'Identifies top net buyers and sellers over a timeframe to discover accumulation or dumping.',
      endpoint: '/api/v1/tgm/who-bought-sold',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.WHO_BOUGHT_SOLD,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.who_bought_sold,
      requiresToken: true,
      requiresAddress: false,
      inputSchema: WhoBoughtSoldInputSchema,
    });

    // 5. Token Transfers
    this.register({
      name: 'token_transfers',
      description: 'Fetches granular on-chain token transfer transactions, with optional USD thresholds.',
      endpoint: '/api/v1/tgm/transfers',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.TOKEN_TRANSFERS,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.token_transfers,
      requiresToken: true,
      requiresAddress: false,
      inputSchema: TokenTransfersInputSchema,
    });

    // 6. DEX Trades
    this.register({
      name: 'dex_trades',
      description: 'Retrieves decentralized exchange swap executions for the specified token.',
      endpoint: '/api/v1/tgm/dex-trades',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.DEX_TRADES,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.dex_trades,
      requiresToken: true,
      requiresAddress: false,
      inputSchema: DexTradesInputSchema,
    });

    // 7. Historical Flows
    this.register({
      name: 'historical_flows',
      description: 'Supplies historical time-series of token inflows, outflows, and net flows.',
      endpoint: '/api/v1/tgm/flows',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.HISTORICAL_FLOWS,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.historical_flows,
      requiresToken: true,
      requiresAddress: false,
      inputSchema: HistoricalFlowsInputSchema,
    });

    // 8. Token Holders (Standard, 5 credits)
    this.register({
      name: 'token_holders',
      description: 'Inspects top token holders, concentration percentage, and supply distribution.',
      endpoint: '/api/v1/tgm/holders',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.TOKEN_HOLDERS_STANDARD,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.token_holders,
      requiresToken: true,
      requiresAddress: false,
      inputSchema: TokenHoldersInputSchema,
    });

    // 9. Wallet Current Balance
    this.register({
      name: 'wallet_current_balance',
      description: 'Fetches the current token holdings and USD portfolio value for a specific wallet address.',
      endpoint: '/api/v1/profiler/address/current-balance',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.WALLET_CURRENT_BALANCE,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.wallet_current_balance,
      requiresToken: false,
      requiresAddress: true,
      inputSchema: WalletBalanceInputSchema,
    });

    // 10. Wallet Transactions (Unsupported on Solana)
    this.register({
      name: 'wallet_transactions',
      description: 'Retrieves historical transactions executed by a wallet address (EVM and non-Solana chains).',
      endpoint: '/api/v1/profiler/address/transactions',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.WALLET_TRANSACTIONS,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.wallet_transactions,
      unsupportedChains: ['solana'],
      requiresToken: false,
      requiresAddress: true,
      inputSchema: WalletTransactionsInputSchema,
    });

    // 11. Related Wallets
    this.register({
      name: 'wallet_related',
      description: 'Uncovers cluster linkages and co-controlled wallet connections for a given address.',
      endpoint: '/api/v1/profiler/address/related-wallets',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.WALLET_RELATED,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.wallet_related,
      requiresToken: false,
      requiresAddress: true,
      inputSchema: RelatedWalletsInputSchema,
    });

    // 12. First Funder
    this.register({
      name: 'wallet_first_funder',
      description: 'Identifies the origin entity or address that initially funded gas for a wallet.',
      endpoint: '/api/v1/profiler/address/first-funder',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.WALLET_FIRST_FUNDER,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.wallet_first_funder,
      requiresToken: false,
      requiresAddress: true,
      inputSchema: FirstFunderInputSchema,
    });

    // 13. Counterparties (5 credits)
    this.register({
      name: 'wallet_counterparties',
      description: 'Identifies the top addresses and contracts that interact with a target wallet.',
      endpoint: '/api/v1/profiler/address/counterparties',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.WALLET_COUNTERPARTIES,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.wallet_counterparties,
      requiresToken: false,
      requiresAddress: true,
      inputSchema: CounterpartiesInputSchema,
    });

    // 14. Transaction Deep Dive
    this.register({
      name: 'transaction_deep_dive',
      description: 'Decodes a specific transaction with all internal token transfers and status details.',
      endpoint: '/api/v1/transaction-with-token-transfer-lookup',
      httpMethod: 'POST',
      creditCost: PROBE_CONSTANTS.CAPABILITY_COSTS.TRANSACTION_DEEP_DIVE,
      enabledForMvp: true,
      supportedChains: CAPABILITY_CHAIN_SUPPORT.transaction_deep_dive,
      requiresToken: false,
      requiresAddress: false,
      inputSchema: TransactionLookupInputSchema,
    });
  }

  public register(cap: CapabilityDefinition): void {
    this.capabilities.set(cap.name, cap);
  }

  public getCapability(name: CapabilityName): CapabilityDefinition {
    const cap = this.capabilities.get(name);
    if (!cap) {
      throw new UnsupportedCapabilityError(name);
    }
    return cap;
  }

  public hasCapability(name: string): boolean {
    return this.capabilities.has(name as CapabilityName);
  }

  public getAllCapabilities(): CapabilityDefinition[] {
    return Array.from(this.capabilities.values());
  }

  public getMvpCapabilities(): CapabilityDefinition[] {
    return this.getAllCapabilities().filter((cap) => cap.enabledForMvp);
  }

  public isChainSupported(name: CapabilityName, chain: string): boolean {
    const cap = this.getCapability(name);
    const normalizedChain = chain.trim().toLowerCase();

    if (cap.unsupportedChains?.includes(normalizedChain)) {
      return false;
    }

    if (cap.supportedChains === 'ALL') {
      return true;
    }

    return (cap.supportedChains as readonly string[]).includes(normalizedChain);
  }

  public assertChainSupported(name: CapabilityName, chain: string): void {
    if (!this.isChainSupported(name, chain)) {
      throw new UnsupportedChainError(chain, name);
    }
  }

  public validateInputs(name: CapabilityName, inputs: unknown): { success: boolean; data?: unknown; error?: string } {
    const cap = this.getCapability(name);
    const result = cap.inputSchema.safeParse(inputs);
    if (!result.success) {
      const errorMsg = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      return { success: false, error: errorMsg };
    }
    return { success: true, data: result.data };
  }

  public getEstimatedCost(name: CapabilityName): number {
    return this.getCapability(name).creditCost;
  }
}

export const capabilityRegistry = new CapabilityRegistry();
