import {
  ITargetResolver,
  InvestigationTarget,
  TargetResolutionResult,
  TargetResolverOptions,
  WalletTarget,
} from './types.js';
import { ITokenResolver, defaultTokenResolver } from '../token/resolver.js';
import { extractExplicitChain, getChainDisplayName, normalizeChain } from './chain-resolver.js';
import { isSolanaAddress, detectChainOnlyInput } from '../token/detector.js';
import { TokenCandidate, TokenResolutionResult } from '../token/types.js';
import { TokenContext } from '../../types/domain.js';
import { logger } from '../../utils/logger.js';
import { TelegramMessages } from '../../adapters/telegram/messages.js';
import {
  getNativeAssetForTicker,
  getNativeAssetForChain,
  isNativeAssetTicker,
} from './native-assets.js';

const EXCLUDED_WORDS = new Set([
  'IS', 'IT', 'AT', 'ON', 'IN', 'TO', 'SO', 'NO', 'MY', 'UP', 'DO', 'IF', 'ME', 'WE', 'US', 'OR', 'BY', 'AN', 'AS', 'HE',
  'WHY', 'WHO', 'WHAT', 'HOW', 'ARE', 'THE', 'AND', 'FOR', 'NOT', 'CAN',
  'HAS', 'DID', 'NOW', 'NEW', 'TOP', 'ALL', 'OUT', 'GET', 'DAY', 'WAS',
  'YOU', 'HER', 'HIM', 'HIS', 'OUR', 'SEE', 'ANY', 'BUY', 'DEX', 'USD',
  'SHOW', 'FIND', 'LAST', 'PAST', 'THIS', 'THAT', 'THEM', 'THEY', 'FROM',
  'OVER', 'SOME', 'MORE', 'MOST', 'WHEN', 'WITH', 'HAVE', 'BEEN', 'MUCH',
  'WHICH', 'WHERE', 'THERE', 'THEIR', 'ABOUT', 'THESE', 'THOSE', 'PLEASE',
  'TOKEN', 'COIN', 'CHAIN', 'NETWORK', 'CONTRACT', 'ADDRESS', 'WALLET',
  'WEEK', 'MONTH', 'YEAR', 'TODAY', 'YESTERDAY', 'TRANSACTION', 'TRANSACTIONS',
  'TRANSFER', 'TRANSFERS', 'BIGGEST', 'LARGEST', 'MOST', 'RECENT', 'RECENTLY',
  'VOLUME', 'ACTIVITY', 'PUMP', 'PUMPING', 'DUMP', 'DUMPING', 'SELL', 'SELLING',
  'BUYING', 'BUYERS', 'SELLERS', 'HOLDERS', 'HOLDER', 'WHO', 'WHALE', 'WHALES',
]);

const COMMON_NAMES_TO_TICKER: Record<string, { ticker: string; defaultChain?: string; name: string }> = {
  bitcoin: { ticker: 'BTC', defaultChain: 'ethereum', name: 'Bitcoin' },
  ether: { ticker: 'ETH', defaultChain: 'ethereum', name: 'Ethereum' },
  tether: { ticker: 'USDT', defaultChain: 'ethereum', name: 'Tether' },
  'usd coin': { ticker: 'USDC', defaultChain: 'ethereum', name: 'USD Coin' },
  dai: { ticker: 'DAI', defaultChain: 'ethereum', name: 'Dai' },
  uniswap: { ticker: 'UNI', defaultChain: 'ethereum', name: 'Uniswap' },
  pepe: { ticker: 'PEPE', defaultChain: undefined, name: 'Pepe' },
  chainlink: { ticker: 'LINK', defaultChain: 'ethereum', name: 'Chainlink' },
  aave: { ticker: 'AAVE', defaultChain: 'ethereum', name: 'Aave' },
  matic: { ticker: 'MATIC', defaultChain: 'polygon', name: 'Matic' },
  'shiba inu': { ticker: 'SHIB', defaultChain: 'ethereum', name: 'Shiba Inu' },
  shib: { ticker: 'SHIB', defaultChain: 'ethereum', name: 'Shiba Inu' },
  dogecoin: { ticker: 'DOGE', defaultChain: 'ethereum', name: 'Dogecoin' },
  doge: { ticker: 'DOGE', defaultChain: 'ethereum', name: 'Dogecoin' },
  'wrapped ether': { ticker: 'WETH', defaultChain: 'ethereum', name: 'Wrapped Ether' },
  weth: { ticker: 'WETH', defaultChain: 'ethereum', name: 'Wrapped Ether' },
  'wrapped bitcoin': { ticker: 'WBTC', defaultChain: 'ethereum', name: 'Wrapped Bitcoin' },
  wbtc: { ticker: 'WBTC', defaultChain: 'ethereum', name: 'Wrapped Bitcoin' },
  maker: { ticker: 'MKR', defaultChain: 'ethereum', name: 'Maker' },
  curve: { ticker: 'CRV', defaultChain: 'ethereum', name: 'Curve' },
  lido: { ticker: 'LDO', defaultChain: 'ethereum', name: 'Lido' },
  pendle: { ticker: 'PENDLE', defaultChain: 'ethereum', name: 'Pendle' },
  bonk: { ticker: 'BONK', defaultChain: 'solana', name: 'Bonk' },
  dogwifhat: { ticker: 'WIF', defaultChain: 'solana', name: 'dogwifhat' },
  wif: { ticker: 'WIF', defaultChain: 'solana', name: 'dogwifhat' },
  jupiter: { ticker: 'JUP', defaultChain: 'solana', name: 'Jupiter' },
  raydium: { ticker: 'RAY', defaultChain: 'solana', name: 'Raydium' },
};

const COMMON_TICKERS = new Set([
  'ETH', 'SOL', 'BTC', 'WBTC', 'WETH', 'USDC', 'USDT', 'DAI', 'UNI', 'PEPE', 'LINK',
  'AAVE', 'ARB', 'OP', 'MATIC', 'SHIB', 'DOGE', 'AVAX', 'BNB', 'SUI', 'APT',
  'NEAR', 'FTM', 'TON', 'TRX', 'MKR', 'CRV', 'LDO', 'PENDLE', 'RENDER', 'FET',
  'BONK', 'WIF', 'JUP', 'RAY', 'POPCAT', 'BOME', 'MEW',
]);

const WALLET_CONTEXT_KEYWORDS = [
  'wallet', 'address', 'account', 'funder', 'who funded', 'counterpart',
  'related wallet', 'connected wallet', 'profiler', 'inspect wallet',
  'transactions for', 'balance of',
];

export class TargetResolver implements ITargetResolver {
  private readonly tokenResolver: ITokenResolver;
  private pendingByChatId = new Map<
    string,
    | { type: 'token'; symbol: string; selectedChain?: string; timestamp: number }
    | { type: 'wallet'; address: string; selectedChain?: string; timestamp: number }
  >();

  constructor(deps?: ITokenResolver | { tokenResolver?: ITokenResolver }) {
    if (deps && 'tokenResolver' in deps) {
      this.tokenResolver = deps.tokenResolver ?? defaultTokenResolver;
    } else {
      this.tokenResolver = (deps as ITokenResolver) ?? defaultTokenResolver;
    }
  }

  public setPendingResolution(
    chatId: number | string,
    pending:
      | { type: 'token'; symbol: string; selectedChain?: string }
      | { type: 'wallet'; address: string; selectedChain?: string }
  ): void {
    this.pendingByChatId.set(String(chatId), {
      ...pending,
      timestamp: Date.now(),
    });
  }

  public getPendingResolution(
    chatId: number | string
  ):
    | { type: 'token'; symbol: string; selectedChain?: string; timestamp: number }
    | { type: 'wallet'; address: string; selectedChain?: string; timestamp: number }
    | undefined {
    return this.pendingByChatId.get(String(chatId));
  }

  public clearPendingResolution(chatId: number | string): void {
    this.pendingByChatId.delete(String(chatId));
  }

  private async resolveCandidate(candidate: TokenCandidate): Promise<TokenResolutionResult> {
    if (typeof this.tokenResolver.resolveDetailed === 'function') {
      return this.tokenResolver.resolveDetailed(candidate);
    }
    const res = await this.tokenResolver.resolve(candidate) as any;
    if (res && res.status && res.token) {
      return res;
    }
    if (res && res.symbol && res.address) {
      return {
        status: 'RESOLVED',
        token: res as TokenContext,
        candidate,
        detectedChain: res.chain,
        creditCost: 0,
      };
    }
    return {
      status: 'NOT_FOUND',
      candidate,
      failureReason: 'NOT_FOUND',
      creditCost: 0,
    };
  }

  /**
   * Deterministically resolves an InvestigationTarget using strict precedence rules:
   * 1. Explicit target in current message
   * 2. Explicit target + explicit chain in current message
   * 3. Existing investigation context
   * 4. Ask user for target
   */
  public async resolve(options: TargetResolverOptions): Promise<TargetResolutionResult> {
    const question = options.question.trim();
    const chatIdKey = options.chatId !== undefined ? String(options.chatId) : undefined;
    const pendingFromMemory = chatIdKey ? this.getPendingResolution(chatIdKey) : undefined;
    const pendingContext = options.pendingResolution ?? pendingFromMemory;

    if (!question) {
      if (options.existingTarget) {
        return {
          status: 'RESOLVED',
          target: options.existingTarget,
          source: 'existing_context',
        };
      }
      return {
        status: 'NEEDS_TARGET',
        source: 'none',
        clarificationMessage: 'Which token, chain, or wallet would you like to investigate?',
      };
    }

    // Step 0: Check if answering a pending wallet clarification with a chain
    if (pendingContext && pendingContext.type === 'wallet') {
      const chainOnly = detectChainOnlyInput(question);
      const standaloneChain = normalizeChain(question);
      const explicitInMsg = extractExplicitChain(question);
      const resolvedChain = chainOnly
        ? normalizeChain(chainOnly) || chainOnly.toLowerCase()
        : standaloneChain || explicitInMsg?.chain;

      if (resolvedChain) {
        if (chatIdKey) {
          this.clearPendingResolution(chatIdKey);
        }
        const walletTarget: InvestigationTarget = {
          type: 'wallet',
          address: pendingContext.address,
          chain: resolvedChain,
          rawIdentifier: pendingContext.address,
          explicitChain: resolvedChain,
        };
        logger.info('Wallet target resolved via pending clarification', {
          address: pendingContext.address,
          chain: resolvedChain,
        });
        return {
          status: 'RESOLVED',
          target: walletTarget,
          source: 'explicit_message_with_chain',
        };
      }
    }

    // Step 0b: Check for standalone chain input (e.g. "solana", "on solana", "network: base", "arbitrum")
    const chainOnly = detectChainOnlyInput(question);
    if (chainOnly) {
      const canonicalChain = normalizeChain(chainOnly) || chainOnly.toLowerCase();
      if (chatIdKey && pendingContext && pendingContext.type === 'token') {
        this.setPendingResolution(chatIdKey, {
          ...pendingContext,
          selectedChain: canonicalChain,
        });
      }
      const chainTarget: InvestigationTarget = {
        type: 'chain',
        chain: canonicalChain,
        chainDisplayName: getChainDisplayName(canonicalChain),
        rawIdentifier: chainOnly,
      };
      logger.info('Standalone chain target resolved', { chain: canonicalChain });
      return {
        status: 'RESOLVED',
        target: chainTarget,
        source: 'explicit_message',
      };
    }

    // Step 1: Extract explicit chain context if mentioned ("on Ethereum", "on Solana", etc.)
    const explicitChainInfo = extractExplicitChain(question);
    const pendingChain = options.pendingResolution?.selectedChain || (chatIdKey ? this.getPendingResolution(chatIdKey)?.selectedChain : undefined);
    const contextChain =
      options.defaultChain ||
      pendingChain ||
      (options.existingTarget?.type === 'chain'
        ? options.existingTarget.chain
        : options.existingTarget?.chain);

    const targetChain = explicitChainInfo?.chain || contextChain;

    // Text with the explicit chain clause masked to prevent chain words from being misidentified as tokens
    let textWithoutChain = question;
    if (explicitChainInfo) {
      textWithoutChain = question.replace(explicitChainInfo.rawMatch, ' ');
    }

    // Step 1B: If active target is a wallet and user switches chain ("What about this wallet on Base?")
    const activeWallet = options.existingTarget?.type === 'wallet' ? options.existingTarget : undefined;
    if (
      activeWallet &&
      explicitChainInfo &&
      (question.toLowerCase().includes('wallet') || !this.detectTokenCandidate(textWithoutChain, targetChain))
    ) {
      if (chatIdKey) {
        this.clearPendingResolution(chatIdKey);
      }
      const switchedWallet: InvestigationTarget = {
        type: 'wallet',
        address: activeWallet.address,
        chain: explicitChainInfo.chain,
        rawIdentifier: activeWallet.rawIdentifier || activeWallet.address,
        explicitChain: explicitChainInfo.chain,
      };
      logger.info('Switched active wallet target chain', {
        address: switchedWallet.address,
        chain: switchedWallet.chain,
      });
      return {
        status: 'RESOLVED',
        target: switchedWallet,
        source: 'explicit_message_with_chain',
      };
    }

    // Step 2: Precedence Rule 1 - Explicit wallet/address syntax
    const walletMatch = this.detectWalletCandidate(question, targetChain);
    if (walletMatch) {
      if (walletMatch.chain) {
        if (chatIdKey) {
          this.clearPendingResolution(chatIdKey);
        }
        logger.info('Explicit wallet target resolved', { address: walletMatch.address, chain: walletMatch.chain });
        return {
          status: 'RESOLVED',
          target: walletMatch,
          source: explicitChainInfo ? 'explicit_message_with_chain' : (contextChain ? 'existing_context' : 'explicit_message'),
        };
      }

      // Chain cannot be determined from address alone: prompt user while preserving candidate
      if (chatIdKey) {
        this.setPendingResolution(chatIdKey, {
          type: 'wallet',
          address: walletMatch.address,
        });
      }
      const chains = ['Ethereum', 'Base', 'BNB', 'Arbitrum', 'Polygon', 'Optimism'];
      logger.info('Wallet candidate detected without chain; requesting clarification', { address: walletMatch.address });
      return {
        status: 'AMBIGUOUS',
        candidateIdentifier: walletMatch.address,
        candidateType: 'wallet',
        availableChains: chains,
        clarificationMessage: TelegramMessages.ambiguousSymbol(walletMatch.address, chains),
        source: 'explicit_message',
      };
    }

    // Malformed address checks
    const isExplicitTokenSyntax = /(?:token|contract|\$)\s*0x[a-fA-F0-9]{40}\b/i.test(question);
    const malformedEvm = question.match(/\b0x[a-zA-Z0-9]+\b/);
    if (malformedEvm && malformedEvm[0].length !== 42 && !isExplicitTokenSyntax) {
      return {
        status: 'INVALID_ADDRESS',
        candidateIdentifier: malformedEvm[0],
        candidateType: 'wallet',
        clarificationMessage: TelegramMessages.unresolvedToken(),
        source: 'explicit_message',
      };
    }

    // Step 3: Check for explicit token references in the text (outside explicit chain clause)
    const tokenCandidate = this.detectTokenCandidate(textWithoutChain, targetChain);
    if (tokenCandidate) {
      // 3a. Check deterministic native-asset registry first
      const native = getNativeAssetForTicker(tokenCandidate.identifier);
      if (native) {
        let resolvedChain = native.chain;
        let resolvedAddress = native.address;
        let resolvedName = native.name;

        if (explicitChainInfo) {
          const chainNative = getNativeAssetForChain(explicitChainInfo.chain);
          if (chainNative && (chainNative.ticker === native.ticker || chainNative.aliases?.includes(native.ticker))) {
            resolvedChain = explicitChainInfo.chain;
            resolvedAddress = chainNative.address;
            resolvedName = chainNative.name;
          } else {
            resolvedChain = explicitChainInfo.chain;
          }
        }

        // If explicit chain differs from native asset's home chain and is not native there (e.g. "$BTC on Ethereum"),
        // route through Nansen token resolution to find the bridged/wrapped token on that chain (e.g. WBTC)
        const isCrossChainToken =
          explicitChainInfo &&
          explicitChainInfo.chain !== native.chain &&
          getNativeAssetForChain(explicitChainInfo.chain)?.ticker !== native.ticker;

        if (!isCrossChainToken) {
          if (chatIdKey) {
            this.clearPendingResolution(chatIdKey);
          }
          const tokenTarget: InvestigationTarget = {
            type: 'token',
            token: {
              address: resolvedAddress,
              symbol: native.ticker,
              name: resolvedName,
              chain: resolvedChain,
              resolvedAt: new Date().toISOString(),
              decimals: 18,
            },
            chain: resolvedChain,
            rawIdentifier: tokenCandidate.identifier,
            explicitChain: explicitChainInfo?.chain,
          };

          logger.debug('Target resolution trace', {
            input: question,
            normalizedSymbol: native.ticker,
            nativeAssetMatch: `${native.ticker} (${native.chain})`,
            nansenSearchAttempted: false,
            candidateCount: 1,
            candidates: [
              {
                symbol: native.ticker,
                chain: resolvedChain,
                address: resolvedAddress,
              },
            ],
            selectedCandidate: {
              symbol: native.ticker,
              chain: resolvedChain,
              address: resolvedAddress,
            },
            ambiguityReason: null,
            finalTarget: tokenTarget,
          });

          logger.info('Native asset target resolved', {
            symbol: native.ticker,
            chain: resolvedChain,
            source: explicitChainInfo ? 'explicit_message_with_chain' : 'explicit_message',
          });

          return {
            status: 'RESOLVED',
            target: tokenTarget,
            source: explicitChainInfo ? 'explicit_message_with_chain' : 'explicit_message',
          };
        }
      }

      // 3b. Normal Nansen token resolution for non-native tokens or cross-chain tokens
      const detailed = await this.resolveCandidate(tokenCandidate);
      const candidatesList = (detailed.candidates ?? (detailed.token ? [detailed.token] : [])).map((c: any) => ({
        symbol: (c.symbol as string) ?? '',
        chain: (c.chain as string) ?? '',
        address: (c.address as string) ?? (c.contract_address as string) ?? '',
        rank: c.rank as number | undefined,
        volume_24h: (c.volume_24h ?? c.volume_24h_usd ?? c.volume24hUsd ?? c.volume24h) as number | undefined,
        market_cap: (c.market_cap ?? c.market_cap_usd ?? c.marketCapUsd ?? c.marketCap) as number | undefined,
      }));

      const selectedCandidateObj = detailed.token
        ? {
            symbol: detailed.token.symbol,
            chain: detailed.token.chain,
            address: detailed.token.address,
          }
        : null;

      const ambiguityReasonStr =
        detailed.status === 'AMBIGUOUS_SYMBOL'
          ? detailed.ambiguityReason ?? 'Competing chains without dominant token'
          : null;

      if (detailed.status === 'RESOLVED' && detailed.token) {
        if (chatIdKey) {
          this.clearPendingResolution(chatIdKey);
        }
        const tokenTarget: InvestigationTarget = {
          type: 'token',
          token: detailed.token,
          chain: detailed.token.chain,
          rawIdentifier: tokenCandidate.identifier,
          explicitChain: explicitChainInfo?.chain || targetChain,
        };

        logger.debug('Target resolution trace', {
          input: question,
          normalizedSymbol: tokenCandidate.identifier.toUpperCase(),
          nativeAssetMatch: native ? `${native.ticker} (${native.chain})` : null,
          nansenSearchAttempted: true,
          candidateCount: candidatesList.length,
          candidates: candidatesList,
          selectedCandidate: selectedCandidateObj,
          ambiguityReason: ambiguityReasonStr,
          finalTarget: tokenTarget,
        });

        logger.info('Explicit token target resolved', {
          symbol: detailed.token.symbol,
          chain: detailed.token.chain,
          source: explicitChainInfo ? 'explicit_message_with_chain' : 'explicit_message',
        });

        return {
          status: 'RESOLVED',
          target: tokenTarget,
          source: explicitChainInfo ? 'explicit_message_with_chain' : 'explicit_message',
        };
      }

      logger.debug('Target resolution trace', {
        input: question,
        normalizedSymbol: tokenCandidate.identifier.toUpperCase(),
        nativeAssetMatch: native ? `${native.ticker} (${native.chain})` : null,
        nansenSearchAttempted: true,
        candidateCount: candidatesList.length,
        candidates: candidatesList,
        selectedCandidate: selectedCandidateObj,
        ambiguityReason: ambiguityReasonStr,
        finalTarget: null,
      });

      if (detailed.status === 'AMBIGUOUS_SYMBOL') {
        if (chatIdKey) {
          this.setPendingResolution(chatIdKey, {
            type: 'token',
            symbol: tokenCandidate.identifier,
          });
        }
        const chains = detailed.availableChains ?? [];
        return {
          status: 'AMBIGUOUS',
          candidateIdentifier: tokenCandidate.identifier,
          availableChains: chains,
          clarificationMessage: TelegramMessages.ambiguousSymbol(tokenCandidate.identifier, chains),
          source: 'explicit_message',
        };
      }

      if (detailed.status === 'INVALID_ADDRESS') {
        return {
          status: 'INVALID_ADDRESS',
          candidateIdentifier: tokenCandidate.identifier,
          clarificationMessage: TelegramMessages.unresolvedToken(),
          source: 'explicit_message',
        };
      }

      if (detailed.status === 'NOT_FOUND') {
        return {
          status: 'UNRESOLVED',
          candidateIdentifier: tokenCandidate.identifier,
          clarificationMessage: TelegramMessages.tokenNotIndexed(),
          source: 'explicit_message',
        };
      }
    }

    // Step 4: If no token or wallet found, check for chain-only scope query
    // e.g. "What's happening on Solana?", "What's happening on Base?", "solana"
    if (explicitChainInfo) {
      const chainTarget: InvestigationTarget = {
        type: 'chain',
        chain: explicitChainInfo.chain,
        chainDisplayName: explicitChainInfo.displayName,
        rawIdentifier: explicitChainInfo.displayName,
      };

      logger.info('Explicit chain target scope resolved', { chain: explicitChainInfo.chain });
      return {
        status: 'RESOLVED',
        target: chainTarget,
        source: 'explicit_message',
      };
    }

    // Check standalone chain input without "on" (e.g. user simply typed "solana", "base", "ethereum")
    const standaloneChain = normalizeChain(question);
    if (standaloneChain) {
      if (chatIdKey && pendingContext && pendingContext.type === 'token') {
        this.setPendingResolution(chatIdKey, {
          ...pendingContext,
          selectedChain: standaloneChain,
        });
      }
      const displayName = getChainDisplayName(standaloneChain);
      const chainTarget: InvestigationTarget = {
        type: 'chain',
        chain: standaloneChain,
        chainDisplayName: displayName,
        rawIdentifier: displayName,
      };

      logger.info('Standalone chain target scope resolved', { chain: standaloneChain });
      return {
        status: 'RESOLVED',
        target: chainTarget,
        source: 'explicit_message',
      };
    }

    // Step 5: Precedence Rule 3 - Existing investigation context
    if (options.existingTarget) {
      logger.info('Reusing existing investigation target context', {
        type: options.existingTarget.type,
        target:
          options.existingTarget.type === 'token'
            ? options.existingTarget.token.symbol
            : options.existingTarget.type === 'wallet'
            ? options.existingTarget.address
            : options.existingTarget.chainDisplayName,
      });

      return {
        status: 'RESOLVED',
        target: options.existingTarget,
        source: 'existing_context',
      };
    }

    // Step 6: Precedence Rule 4 - Ask user for target
    logger.info('No target found in query or active context; asking user for target');
    return {
      status: 'NEEDS_TARGET',
      source: 'none',
      clarificationMessage:
        'Which token, chain, or wallet would you like to investigate? Please specify a token (e.g. $ETH, BTC, or contract address), chain (e.g. Solana, Base), or wallet address.',
    };
  }

  /**
   * Detects whether the query references a specific wallet address.
   */
  private detectWalletCandidate(text: string, targetChain?: string): WalletTarget | undefined {
    const qLower = text.toLowerCase();
    const isExplicitToken = /(?:token|contract|\$)\s*0x[a-fA-F0-9]{40}\b/i.test(text);

    // 1. Check for EVM address (must not be an explicit token inquiry like "token 0x..." or "$0x...")
    const evmMatch = text.match(/\b0x[a-fA-F0-9]{40}\b/i);
    if (evmMatch && !isExplicitToken) {
      const addr = evmMatch[0].toLowerCase();
      return {
        type: 'wallet',
        address: addr,
        chain: targetChain as any,
        rawIdentifier: evmMatch[0],
      };
    }

    // 2. Check for Solana base58 address accompanied by wallet keywords
    const solMatch = text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
    const hasWalletKeyword = WALLET_CONTEXT_KEYWORDS.some((kw) => qLower.includes(kw));
    if (solMatch && hasWalletKeyword && isSolanaAddress(solMatch[0])) {
      return {
        type: 'wallet',
        address: solMatch[0],
        chain: targetChain || 'solana',
        rawIdentifier: solMatch[0],
      };
    }

    return undefined;
  }

  /**
   * Extracts a token candidate from text.
   * Recognizes: cashtags ($BTC), common names (Bitcoin), tickers (BTC), contract addresses.
   */
  private detectTokenCandidate(text: string, explicitChain?: string): TokenCandidate | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;

    // 1. Check for cashtags ($BTC, $ETH, $SOL, etc.)
    const cashtagMatch = trimmed.match(/\$([A-Za-z0-9]{1,15})\b/);
    if (cashtagMatch) {
      const ticker = cashtagMatch[1].toUpperCase();
      return {
        identifier: ticker,
        type: 'symbol',
        detectedChain: explicitChain || (ticker === 'SOL' ? 'solana' : undefined),
      };
    }

    // 2. Check for explicit EVM token contract address in text (e.g. "token 0x...", "contract 0x...", "$0x...")
    const explicitTokenEvm = trimmed.match(/(?:token|contract|\$)\s*(0x[a-fA-F0-9]{40})\b/i);
    if (explicitTokenEvm) {
      return {
        identifier: explicitTokenEvm[1].toLowerCase(),
        type: 'address',
        detectedChain: explicitChain || 'ethereum',
      };
    }

    // Check for malformed EVM address (e.g. "0xinvalidaddress123")
    const malformedEvm = trimmed.match(/\b0x[a-zA-Z0-9]+\b/);
    if (malformedEvm && malformedEvm[0].length !== 42) {
      return {
        identifier: malformedEvm[0],
        type: 'invalid_address',
        detectedChain: explicitChain || 'ethereum',
      };
    }

    // 3. Check for Solana mint address in text
    const solMatch = trimmed.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
    if (solMatch && isSolanaAddress(solMatch[0])) {
      return {
        identifier: solMatch[0],
        type: 'address',
        detectedChain: explicitChain || 'solana',
      };
    }

    // Check for malformed Solana Base58 Address (32-44 characters without spaces, but invalid Base58 chars)
    if (trimmed.length >= 32 && trimmed.length <= 44 && !trimmed.includes(' ') && !isSolanaAddress(trimmed)) {
      return {
        identifier: trimmed,
        type: 'invalid_address',
        detectedChain: explicitChain || 'solana',
      };
    }

    // 4. Check for common token names (Bitcoin, Ethereum, Solana, Tether, etc.)
    const lower = trimmed.toLowerCase();
    for (const [commonName, info] of Object.entries(COMMON_NAMES_TO_TICKER)) {
      // Use word boundary to avoid matching substring inside other words
      const regex = new RegExp(`\\b${commonName}\\b`, 'i');
      if (regex.test(lower)) {
        return {
          identifier: info.ticker,
          type: 'symbol',
          detectedChain: explicitChain || info.defaultChain,
        };
      }
    }

    // 5. Check for clean ticker symbols embedded in natural language
    const words = trimmed.split(/[\s,?.!;:()]+/);
    for (const word of words) {
      const upper = word.toUpperCase();
      if (
        word.length >= 2 &&
        word.length <= 10 &&
        /^[A-Za-z0-9]+$/.test(word) &&
        !EXCLUDED_WORDS.has(upper) &&
        !detectChainOnlyInput(word) &&
        !/^\d+$/.test(word) &&
        (isNativeAssetTicker(upper) || COMMON_TICKERS.has(upper) || word === upper)
      ) {
        return {
          identifier: upper,
          type: 'symbol',
          detectedChain: explicitChain || (upper === 'SOL' ? 'solana' : undefined),
        };
      }
    }

    return undefined;
  }
}

export const defaultTargetResolver = new TargetResolver();
