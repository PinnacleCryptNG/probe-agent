import {
  NansenAuthenticationError,
  NansenCreditError,
  NansenRateLimitError,
  NansenUnavailableError,
  NansenValidationError,
} from '../../types/errors.js';
import { logger } from '../../utils/logger.js';
import {
  CounterpartiesRequest,
  CounterpartiesResponse,
  DexTradesRequest,
  DexTradesResponse,
  FirstFunderRequest,
  FirstFunderResponse,
  FlowIntelligenceRequest,
  FlowIntelligenceResponse,
  HistoricalFlowsRequest,
  HistoricalFlowsResponse,
  NansenApiResponse,
  NansenResponseMetadata,
  RelatedWalletsRequest,
  RelatedWalletsResponse,
  SearchGeneralRequest,
  SearchGeneralResponse,
  TokenHoldersRequest,
  TokenHoldersResponse,
  TokenInformationRequest,
  TokenInformationResponse,
  TokenTransfersRequest,
  TokenTransfersResponse,
  TransactionLookupRequest,
  TransactionLookupResponse,
  WalletBalanceRequest,
  WalletBalanceResponse,
  WalletTransactionsRequest,
  WalletTransactionsResponse,
  WhoBoughtSoldRequest,
  WhoBoughtSoldResponse,
} from './types.js';

export interface NansenClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface INansenClient {
  execute<TReq, TRes>(
    endpoint: string,
    body: TReq,
    defaultCost?: number,
    investigationId?: string
  ): Promise<NansenApiResponse<TRes>>;

  searchGeneral(req: SearchGeneralRequest, invId?: string): Promise<NansenApiResponse<SearchGeneralResponse>>;
  getTokenInformation(req: TokenInformationRequest, invId?: string): Promise<NansenApiResponse<TokenInformationResponse>>;
  getFlowIntelligence(req: FlowIntelligenceRequest, invId?: string): Promise<NansenApiResponse<FlowIntelligenceResponse>>;
  getWhoBoughtSold(req: WhoBoughtSoldRequest, invId?: string): Promise<NansenApiResponse<WhoBoughtSoldResponse>>;
  getTokenTransfers(req: TokenTransfersRequest, invId?: string): Promise<NansenApiResponse<TokenTransfersResponse>>;
  getDexTrades(req: DexTradesRequest, invId?: string): Promise<NansenApiResponse<DexTradesResponse>>;
  getHistoricalFlows(req: HistoricalFlowsRequest, invId?: string): Promise<NansenApiResponse<HistoricalFlowsResponse>>;
  getTokenHolders(req: TokenHoldersRequest, invId?: string): Promise<NansenApiResponse<TokenHoldersResponse>>;
  getWalletBalance(req: WalletBalanceRequest, invId?: string): Promise<NansenApiResponse<WalletBalanceResponse>>;
  getWalletTransactions(req: WalletTransactionsRequest, invId?: string): Promise<NansenApiResponse<WalletTransactionsResponse>>;
  getRelatedWallets(req: RelatedWalletsRequest, invId?: string): Promise<NansenApiResponse<RelatedWalletsResponse>>;
  getFirstFunder(req: FirstFunderRequest, invId?: string): Promise<NansenApiResponse<FirstFunderResponse>>;
  getCounterparties(req: CounterpartiesRequest, invId?: string): Promise<NansenApiResponse<CounterpartiesResponse>>;
  lookupTransaction(req: TransactionLookupRequest, invId?: string): Promise<NansenApiResponse<TransactionLookupResponse>>;
}

export class NansenClient implements INansenClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: NansenClientConfig) {
    if (!config.apiKey) {
      throw new NansenAuthenticationError('Nansen API key is missing or undefined.');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://api.nansen.ai').replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs || 15000;
  }

  public async execute<TReq, TRes>(
    endpoint: string,
    body: TReq,
    defaultCost = 1,
    investigationId?: string
  ): Promise<NansenApiResponse<TRes>> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    const startTime = Date.now();

    logger.info('Nansen request started', {
      investigationId,
      endpoint,
      requestParams: body,
    });

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const durationMs = Date.now() - startTime;

      // Extract credit telemetry from Nansen response headers
      const creditsCostHeader = response.headers.get('x-nansen-credits-cost');
      const creditsUsedHeader = response.headers.get('x-nansen-credits-used');
      const creditsRemainingHeader = response.headers.get('x-nansen-credits-remaining');

      const creditsCost = creditsCostHeader ? parseInt(creditsCostHeader, 10) : defaultCost;
      const creditsUsed = creditsUsedHeader ? parseInt(creditsUsedHeader, 10) : 0;
      const creditsRemaining = creditsRemainingHeader ? parseInt(creditsRemainingHeader, 10) : 0;

      const meta: NansenResponseMetadata = {
        creditsCost: isNaN(creditsCost) ? defaultCost : creditsCost,
        creditsUsed: isNaN(creditsUsed) ? 0 : creditsUsed,
        creditsRemaining: isNaN(creditsRemaining) ? 0 : creditsRemaining,
        durationMs,
      };

      // Handle HTTP errors
      if (!response.ok) {
        let errorBody: string;
        try {
          errorBody = await response.text();
        } catch {
          errorBody = 'Unable to read error response body';
        }

        logger.error('Nansen request failed', {
          investigationId,
          endpoint,
          status: response.status,
          durationMs,
          requestParams: body,
          creditCost: meta.creditsCost,
          creditsRemaining: meta.creditsRemaining,
          sanitizedBody: errorBody.slice(0, 500),
        });

        if (response.status === 401 || response.status === 403) {
          throw new NansenAuthenticationError(
            `Nansen authentication failed (${response.status}): ${errorBody}`,
            { endpoint, status: response.status }
          );
        }

        if (response.status === 429) {
          const retryAfterHeader = response.headers.get('retry-after');
          const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
          throw new NansenRateLimitError(
            `Nansen rate limit reached: ${errorBody}`,
            isNaN(retryAfterSeconds) ? 60 : retryAfterSeconds,
            { endpoint }
          );
        }

        if (response.status === 402) {
          throw new NansenCreditError(
            `Nansen credit limit exceeded (${response.status}): ${errorBody}`,
            creditsRemaining,
            { endpoint }
          );
        }

        if (response.status === 400 || response.status === 422) {
          throw new NansenValidationError(
            `Nansen validation error (${response.status}): ${errorBody}`,
            { endpoint, status: response.status }
          );
        }

        throw new NansenUnavailableError(
          `Nansen API responded with status ${response.status}: ${errorBody}`,
          { endpoint, status: response.status }
        );
      }

      const responseJson = (await response.json()) as TRes;

      logger.info('Nansen request completed', {
        investigationId,
        endpoint,
        status: response.status,
        creditCost: meta.creditsCost,
        creditsRemaining: meta.creditsRemaining,
        durationMs,
      });

      return {
        data: responseJson,
        meta,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        logger.error('Nansen request timed out', { investigationId, endpoint, timeoutMs: this.timeoutMs });
        throw new NansenUnavailableError(`Nansen request timed out after ${this.timeoutMs}ms`, { endpoint });
      }
      if (err instanceof Error && (err as { code?: string }).code?.startsWith('NANSEN_')) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Nansen request encountered unexpected network error', { investigationId, endpoint, error: message });
      throw new NansenUnavailableError(`Network or connection error communicating with Nansen: ${message}`, { endpoint });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  // Convenience methods for the 14 verified endpoints
  public async searchGeneral(req: SearchGeneralRequest, invId?: string) {
    return this.execute<SearchGeneralRequest, SearchGeneralResponse>('/api/v1/search/general', req, 0, invId);
  }

  public async getTokenInformation(req: TokenInformationRequest, invId?: string) {
    return this.execute<TokenInformationRequest, TokenInformationResponse>('/api/v1/tgm/token-information', req, 1, invId);
  }

  public async getFlowIntelligence(req: FlowIntelligenceRequest, invId?: string) {
    return this.execute<FlowIntelligenceRequest, FlowIntelligenceResponse>('/api/v1/tgm/flow-intelligence', req, 1, invId);
  }

  public async getWhoBoughtSold(req: WhoBoughtSoldRequest, invId?: string) {
    return this.execute<WhoBoughtSoldRequest, WhoBoughtSoldResponse>('/api/v1/tgm/who-bought-sold', req, 1, invId);
  }

  public async getTokenTransfers(req: TokenTransfersRequest, invId?: string) {
    return this.execute<TokenTransfersRequest, TokenTransfersResponse>('/api/v1/tgm/transfers', req, 1, invId);
  }

  public async getDexTrades(req: DexTradesRequest, invId?: string) {
    return this.execute<DexTradesRequest, DexTradesResponse>('/api/v1/tgm/dex-trades', req, 1, invId);
  }

  public async getHistoricalFlows(req: HistoricalFlowsRequest, invId?: string) {
    return this.execute<HistoricalFlowsRequest, HistoricalFlowsResponse>('/api/v1/tgm/flows', req, 1, invId);
  }

  public async getTokenHolders(req: TokenHoldersRequest, invId?: string) {
    // Explicitly enforce premium_labels: false to guard against accidental 150-credit drain
    const safeReq: TokenHoldersRequest = { ...req, premium_labels: false };
    return this.execute<TokenHoldersRequest, TokenHoldersResponse>('/api/v1/tgm/holders', safeReq, 5, invId);
  }

  public async getWalletBalance(req: WalletBalanceRequest, invId?: string) {
    return this.execute<WalletBalanceRequest, WalletBalanceResponse>('/api/v1/profiler/address/current-balance', req, 1, invId);
  }

  public async getWalletTransactions(req: WalletTransactionsRequest, invId?: string) {
    return this.execute<WalletTransactionsRequest, WalletTransactionsResponse>('/api/v1/profiler/address/transactions', req, 1, invId);
  }

  public async getRelatedWallets(req: RelatedWalletsRequest, invId?: string) {
    return this.execute<RelatedWalletsRequest, RelatedWalletsResponse>('/api/v1/profiler/address/related-wallets', req, 1, invId);
  }

  public async getFirstFunder(req: FirstFunderRequest, invId?: string) {
    return this.execute<FirstFunderRequest, FirstFunderResponse>('/api/v1/profiler/address/first-funder', req, 1, invId);
  }

  public async getCounterparties(req: CounterpartiesRequest, invId?: string) {
    return this.execute<CounterpartiesRequest, CounterpartiesResponse>('/api/v1/profiler/address/counterparties', req, 5, invId);
  }

  public async lookupTransaction(req: TransactionLookupRequest, invId?: string) {
    return this.execute<TransactionLookupRequest, TransactionLookupResponse>('/api/v1/transaction-with-token-transfer-lookup', req, 1, invId);
  }
}
