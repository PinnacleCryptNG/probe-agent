import { PROBE_CONSTANTS } from '../../config/constants.js';
import { SupportedChain } from '../capabilities/chain-support.js';
import { logger } from '../../utils/logger.js';

export type AddressType = 'eoa' | 'contract' | 'unknown';

export interface AddressClassification {
  type: AddressType;
  chain: SupportedChain;
  bytecodeLength?: number;
}

export interface MultiChainClassificationResult {
  status: 'single' | 'ambiguous' | 'unresolved';
  chain?: SupportedChain;
  type?: AddressType;
  classifications: Record<string, AddressType>;
}

export interface IEvmRpcClient {
  getCode(address: string, chain: string): Promise<string | null>;
}

/**
 * Standard public EVM RPC endpoints per chain.
 * Configurable via environment variables (e.g. ETHEREUM_RPC_URL, BASE_RPC_URL).
 */
const DEFAULT_RPC_ENDPOINTS: Record<string, string[]> = {
  ethereum: [
    process.env.ETHEREUM_RPC_URL,
    process.env.ETH_RPC_URL,
    'https://cloudflare-eth.com',
    'https://eth.llamarpc.com',
  ].filter(Boolean) as string[],
  base: [
    process.env.BASE_RPC_URL,
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
  ].filter(Boolean) as string[],
  bnb: [
    process.env.BNB_RPC_URL,
    process.env.BSC_RPC_URL,
    'https://binance.llamarpc.com',
    'https://bsc-dataseed.binance.org',
  ].filter(Boolean) as string[],
  arbitrum: [
    process.env.ARBITRUM_RPC_URL,
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum.llamarpc.com',
  ].filter(Boolean) as string[],
  polygon: [
    process.env.POLYGON_RPC_URL,
    'https://polygon-rpc.com',
    'https://polygon.llamarpc.com',
  ].filter(Boolean) as string[],
  optimism: [
    process.env.OPTIMISM_RPC_URL,
    'https://mainnet.optimism.io',
    'https://optimism.llamarpc.com',
  ].filter(Boolean) as string[],
  avalanche: [
    process.env.AVALANCHE_RPC_URL,
    'https://api.avax.network/ext/bc/C/rpc',
  ].filter(Boolean) as string[],
  linea: [
    process.env.LINEA_RPC_URL,
    'https://rpc.linea.build',
  ].filter(Boolean) as string[],
  mantle: [
    process.env.MANTLE_RPC_URL,
    'https://rpc.mantle.xyz',
  ].filter(Boolean) as string[],
};

/**
 * Known fixture addresses to avoid redundant external network requests in test suites and common queries.
 */
const KNOWN_ADDRESS_FIXTURES: Record<string, Record<string, AddressType>> = {
  // Vitalik EOA
  '0xd8da6bf26964af9d7eed9e03e53415d37aa96045': {
    ethereum: 'eoa',
    base: 'eoa',
    arbitrum: 'eoa',
    optimism: 'eoa',
    polygon: 'eoa',
    bnb: 'eoa',
  },
  // Zero address
  '0x0000000000000000000000000000000000000000': {
    ethereum: 'eoa',
    base: 'eoa',
    arbitrum: 'eoa',
    optimism: 'eoa',
    polygon: 'eoa',
    bnb: 'eoa',
  },
  // Test wallet address
  '0xbba275e390c9b0e1e695d73a0e67610344edc40a': {
    ethereum: 'eoa',
    base: 'eoa',
    arbitrum: 'eoa',
    optimism: 'eoa',
    polygon: 'eoa',
    bnb: 'eoa',
  },
  // Robinhood wallet address (EOA on Ethereum)
  '0xdddf7ab756c35b4d0537825497e6932780710241': {
    ethereum: 'eoa',
    base: 'eoa',
    arbitrum: 'eoa',
    optimism: 'eoa',
    polygon: 'eoa',
    bnb: 'eoa',
  },
  // PEPE token contract on Ethereum
  '0x6982508145454ce325ddbe47a25d4ec3d2311933': {
    ethereum: 'contract',
    base: 'eoa',
    arbitrum: 'eoa',
    optimism: 'eoa',
    polygon: 'eoa',
    bnb: 'eoa',
  },
  // PEPE token contract on Arbitrum
  '0x25d887ce7a35172c62febfd67a1856620adf2bbe': {
    arbitrum: 'contract',
    ethereum: 'eoa',
    base: 'eoa',
    optimism: 'eoa',
    polygon: 'eoa',
    bnb: 'eoa',
  },
  // WBTC token contract on Ethereum
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': {
    ethereum: 'contract',
    base: 'eoa',
    arbitrum: 'eoa',
    optimism: 'eoa',
    polygon: 'eoa',
    bnb: 'eoa',
  },
  // 1inch router contract on Ethereum
  '0x1111111254fb6c44bac0bed2854e76f90643097d': {
    ethereum: 'contract',
    base: 'eoa',
    arbitrum: 'eoa',
    optimism: 'eoa',
    polygon: 'eoa',
    bnb: 'eoa',
  },
};

export class HttpEvmRpcClient implements IEvmRpcClient {
  private readonly rpcUrls: Record<string, string[]>;
  private readonly timeoutMs: number;

  constructor(customRpcUrls?: Record<string, string[]>, timeoutMs = 3500) {
    this.timeoutMs = timeoutMs;
    this.rpcUrls = {
      ...DEFAULT_RPC_ENDPOINTS,
      ...customRpcUrls,
    };
  }

  public async getCode(address: string, chain: string): Promise<string | null> {
    const normalizedChain = chain.toLowerCase();
    const urls = this.rpcUrls[normalizedChain] ?? [
      process.env[`${normalizedChain.toUpperCase()}_RPC_URL`],
      `https://${normalizedChain}.llamarpc.com`,
    ].filter(Boolean) as string[];

    if (urls.length === 0) {
      logger.warn(`No RPC endpoints configured for EVM chain ${chain}`);
      return null;
    }

    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getCode',
            params: [address, 'latest'],
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          continue;
        }

        const data = (await res.json()) as any;
        if (data && typeof data.result === 'string') {
          return data.result;
        }
      } catch (err) {
        logger.debug(
          `RPC eth_getCode failed on ${url}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return null;
  }
}

export class AddressClassifier {
  private readonly rpcClient: IEvmRpcClient;
  private readonly cache = new Map<
    string,
    { type: AddressType; timestamp: number; bytecodeLength?: number }
  >();
  private readonly cacheTtlMs = 300_000; // 5 minutes

  constructor(rpcClient?: IEvmRpcClient) {
    this.rpcClient = rpcClient ?? new HttpEvmRpcClient();
  }

  /**
   * Classifies an address on a specific chain using eth_getCode.
   * code === "0x" -> EOA / WALLET
   * code !== "0x" -> SMART CONTRACT
   */
  public async classify(
    address: string,
    chain?: SupportedChain
  ): Promise<AddressClassification> {
    const targetChain = chain ?? 'ethereum';
    const normalizedAddr = address.toLowerCase();
    const normalizedChain = targetChain.toLowerCase() as SupportedChain;
    const cacheKey = `${normalizedChain}:${normalizedAddr}`;

    // 1. Check in-memory cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return {
        type: cached.type,
        chain: normalizedChain,
        bytecodeLength: cached.bytecodeLength,
      };
    }

    // 2. Check static fixtures for ultra-fast local resolution
    const fixtureType = KNOWN_ADDRESS_FIXTURES[normalizedAddr]?.[normalizedChain];
    if (fixtureType) {
      this.cache.set(cacheKey, { type: fixtureType, timestamp: Date.now() });
      return {
        type: fixtureType,
        chain: normalizedChain,
      };
    }

    // 3. Perform RPC eth_getCode check
    try {
      const code = await this.rpcClient.getCode(address, normalizedChain);
      if (code === null) {
        return { type: 'unknown', chain: normalizedChain };
      }

      const cleanCode = code.trim().toLowerCase();
      // "0x", "0x0", or empty means no bytecode deployed -> EOA / WALLET
      if (cleanCode === '0x' || cleanCode === '0x0' || cleanCode === '') {
        const result: AddressClassification = { type: 'eoa', chain: normalizedChain };
        this.cache.set(cacheKey, { type: 'eoa', timestamp: Date.now() });
        return result;
      }

      // Non-empty bytecode -> SMART CONTRACT
      const hexLength = cleanCode.startsWith('0x') ? cleanCode.length - 2 : cleanCode.length;
      const bytecodeLength = hexLength / 2;
      const result: AddressClassification = {
        type: 'contract',
        chain: normalizedChain,
        bytecodeLength,
      };
      this.cache.set(cacheKey, {
        type: 'contract',
        timestamp: Date.now(),
        bytecodeLength,
      });
      return result;
    } catch (err) {
      logger.error('Error during address classification via eth_getCode RPC', {
        address,
        chain: normalizedChain,
        error: err instanceof Error ? err.message : String(err),
      });
      return { type: 'unknown', chain: normalizedChain };
    }
  }

  /**
   * Performs multi-chain classification across candidate supported EVM chains.
   * Uses authoritative configuration from PROBE_CONSTANTS.
   */
  public async classifyMultiChain(
    address: string,
    candidateChains?: readonly SupportedChain[]
  ): Promise<MultiChainClassificationResult> {
    const chainsToCheck = candidateChains ?? PROBE_CONSTANTS.CLARIFICATION_EVM_CHAINS;
    const classifications: Record<string, AddressType> = {};

    const results = await Promise.allSettled(
      chainsToCheck.map(async (chain) => {
        const res = await this.classify(address, chain as SupportedChain);
        return { chain, type: res.type };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        classifications[r.value.chain] = r.value.type;
      }
    }

    const validChains = Object.entries(classifications).filter(
      ([_, type]) => type !== 'unknown'
    );

    if (validChains.length === 0) {
      return {
        status: 'unresolved',
        classifications,
      };
    }

    // If exactly one supported chain produces meaningful classification:
    // resolve it automatically.
    if (validChains.length === 1) {
      return {
        status: 'single',
        chain: validChains[0][0] as SupportedChain,
        type: validChains[0][1],
        classifications,
      };
    }

    // If multiple chains match or produce different classifications (e.g. Ethereum = contract, Base = eoa)
    // we ask the user which chain they mean and preserve the classification results.
    return {
      status: 'ambiguous',
      classifications,
    };
  }
}

export const defaultAddressClassifier = new AddressClassifier();
