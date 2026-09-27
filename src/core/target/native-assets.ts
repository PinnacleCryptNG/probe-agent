import { PROBE_CONSTANTS } from '../../config/constants.js';
import { getChainDisplayName } from './chain-resolver.js';

export interface NativeChainAsset {
  chain: string;
  chainDisplayName: string;
  ticker: string;
  name: string;
  address: string;
  aliases?: string[];
}

/**
 * Static metadata catalog for native assets across known blockchain architectures.
 * The active native asset registry is deterministically derived by filtering this catalog
 * against the application's configured supported chains (PROBE_CONSTANTS).
 */
const NATIVE_ASSET_CATALOG: Record<string, { ticker: string; name: string; address: string; aliases?: string[]; chainOverride?: string }> = {
  ethereum: {
    ticker: 'ETH',
    name: 'Ethereum',
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    aliases: ['ETHER'],
  },
  solana: {
    ticker: 'SOL',
    name: 'Solana',
    address: 'So11111111111111111111111111111111111111112',
  },
  aptos: {
    ticker: 'APT',
    name: 'Aptos',
    address: '0x1::aptos_coin::AptosCoin',
  },
  hyperliquid: {
    ticker: 'HYPE',
    name: 'Hyperliquid',
    address: '0x0000000000000000000000000000000000000000',
  },
  hyperevm: {
    ticker: 'HYPE',
    name: 'Hyperliquid EVM',
    address: '0x0000000000000000000000000000000000000000',
  },
  bitcoin: {
    ticker: 'BTC',
    name: 'Bitcoin',
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    chainOverride: 'ethereum',
  },
  avalanche: {
    ticker: 'AVAX',
    name: 'Avalanche',
    address: '0x0000000000000000000000000000000000000000',
  },
  bnb: {
    ticker: 'BNB',
    name: 'BNB Chain',
    address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  },
  polygon: {
    ticker: 'POL',
    name: 'Polygon',
    address: '0x0000000000000000000000000000000000001010',
    aliases: ['MATIC'],
  },
  arbitrum: {
    ticker: 'ARB',
    name: 'Arbitrum',
    address: '0x912ce59144191c1204e64559fe8253a0e49e6548',
  },
  optimism: {
    ticker: 'OP',
    name: 'Optimism',
    address: '0x4200000000000000000000000000000000000042',
  },
  base: {
    ticker: 'ETH',
    name: 'Base',
    address: '0x4200000000000000000000000000000000000006',
  },
  sui: {
    ticker: 'SUI',
    name: 'Sui',
    address: '0x2::sui::SUI',
  },
  near: {
    ticker: 'NEAR',
    name: 'NEAR',
    address: 'wrap.near',
  },
  ton: {
    ticker: 'TON',
    name: 'TON',
    address: 'native',
  },
  tron: {
    ticker: 'TRX',
    name: 'Tron',
    address: 'native',
  },
  injective: {
    ticker: 'INJ',
    name: 'Injective',
    address: 'inj',
  },
  mantra: {
    ticker: 'OM',
    name: 'Mantra',
    address: 'uom',
  },
  stacks: {
    ticker: 'STX',
    name: 'Stacks',
    address: 'native',
  },
  stellar: {
    ticker: 'XLM',
    name: 'Stellar',
    address: 'native',
  },
  algorand: {
    ticker: 'ALGO',
    name: 'Algorand',
    address: '0',
  },
  sei: {
    ticker: 'SEI',
    name: 'Sei',
    address: 'usei',
  },
  sonic: {
    ticker: 'S',
    name: 'Sonic',
    address: 'native',
  },
  monad: {
    ticker: 'MON',
    name: 'Monad',
    address: 'native',
  },
  metis: {
    ticker: 'METIS',
    name: 'Metis',
    address: '0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000',
  },
  chiliz: {
    ticker: 'CHZ',
    name: 'Chiliz',
    address: '0x0000000000000000000000000000000000000000',
  },
  linea: {
    ticker: 'ETH',
    name: 'Linea',
    address: '0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f',
  },
  mantle: {
    ticker: 'MNT',
    name: 'Mantle',
    address: '0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000',
  },
  starknet: {
    ticker: 'STRK',
    name: 'Starknet',
    address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  },
  bitlayer: {
    ticker: 'BTC',
    name: 'Bitlayer',
    address: 'native',
  },
  citrea: {
    ticker: 'cBTC',
    name: 'Citrea',
    address: 'native',
  },
  arc: {
    ticker: 'ETH',
    name: 'Arc',
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  },
  gravity: {
    ticker: 'G',
    name: 'Gravity',
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  },
  iotaevm: {
    ticker: 'IOTA',
    name: 'IOTA EVM',
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  },
  katana: {
    ticker: 'RON',
    name: 'Katana / Ronin',
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  },
  plasma: {
    ticker: 'ETH',
    name: 'Plasma',
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  },
  robinhood: {
    ticker: 'ETH',
    name: 'Robinhood Chain',
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  },
  viction: {
    ticker: 'VIC',
    name: 'Viction',
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  },
};

// Derived registry maps
const CHAIN_TO_NATIVE_ASSET = new Map<string, NativeChainAsset>();
const TICKER_TO_NATIVE_ASSET = new Map<string, NativeChainAsset>();

// Initialize maps derived strictly from PROBE_CONSTANTS supported chains
const allSupportedChains = [
  ...PROBE_CONSTANTS.SUPPORTED_EVM_CHAINS,
  ...PROBE_CONSTANTS.SUPPORTED_NON_EVM_CHAINS,
];

for (const chain of allSupportedChains) {
  const meta = NATIVE_ASSET_CATALOG[chain.toLowerCase()];
  if (meta) {
    const resolvedChain = (meta.chainOverride ?? chain).toLowerCase();
    const displayName = getChainDisplayName(resolvedChain) ?? meta.name;
    const asset: NativeChainAsset = {
      chain: resolvedChain,
      chainDisplayName: displayName,
      ticker: meta.ticker.toUpperCase(),
      name: meta.name,
      address: meta.address,
      aliases: meta.aliases,
    };

    CHAIN_TO_NATIVE_ASSET.set(chain.toLowerCase(), asset);

    // Primary native chains take precedence in ticker collision (e.g. ETH on Ethereum takes precedence over ETH on Base)
    const upperTicker = meta.ticker.toUpperCase();
    const existing = TICKER_TO_NATIVE_ASSET.get(upperTicker);
    const isPrimaryChain =
      PROBE_CONSTANTS.PRIMARY_CHAINS.includes(chain.toLowerCase() as any) ||
      chain.toLowerCase() === 'ethereum' ||
      chain.toLowerCase() === 'solana' ||
      chain.toLowerCase() === 'hyperliquid' ||
      chain.toLowerCase() === 'aptos' ||
      chain.toLowerCase() === 'bitcoin';

    if (!existing || isPrimaryChain) {
      TICKER_TO_NATIVE_ASSET.set(upperTicker, asset);
    }

    if (meta.aliases) {
      for (const alias of meta.aliases) {
        TICKER_TO_NATIVE_ASSET.set(alias.toUpperCase(), asset);
      }
    }
  }
}

/**
 * Normalizes an asset identifier by trimming whitespace and stripping any leading '$'.
 */
export function normalizeAssetSymbol(identifier: string): string {
  return identifier.trim().replace(/^\$/, '').toUpperCase();
}

/**
 * Resolves a ticker or cashtag (e.g. "ETH", "$ETH", "SOL", "$SOL", "APT", "$APT", "HYPE", "$HYPE")
 * against the native asset registry.
 */
export function getNativeAssetForTicker(tickerOrCashtag: string): NativeChainAsset | undefined {
  if (!tickerOrCashtag) return undefined;
  const normalized = normalizeAssetSymbol(tickerOrCashtag);
  return TICKER_TO_NATIVE_ASSET.get(normalized);
}

/**
 * Retrieves the native asset configured for a supported chain.
 */
export function getNativeAssetForChain(chain: string): NativeChainAsset | undefined {
  if (!chain) return undefined;
  return CHAIN_TO_NATIVE_ASSET.get(chain.trim().toLowerCase());
}

/**
 * Checks whether a ticker or cashtag represents a native chain asset.
 */
export function isNativeAssetTicker(tickerOrCashtag: string): boolean {
  return getNativeAssetForTicker(tickerOrCashtag) !== undefined;
}

/**
 * Returns all registered native assets.
 */
export function getAllNativeAssets(): NativeChainAsset[] {
  return Array.from(CHAIN_TO_NATIVE_ASSET.values());
}
