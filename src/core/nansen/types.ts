/**
 * Strongly typed request/response definitions for the 14 verified Nansen endpoints.
 */

export interface NansenResponseMetadata {
  creditsCost: number;
  creditsUsed: number;
  creditsRemaining: number;
  durationMs: number;
}

export interface NansenApiResponse<T> {
  data: T;
  meta: NansenResponseMetadata;
}

// 1. Search General (Token Resolution)
export interface SearchGeneralRequest {
  search_query?: string;
  query?: string;
  chain?: string;
  type?: 'token' | 'address' | 'all';
}

export interface SearchGeneralResultItem {
  id?: string;
  name?: string;
  symbol?: string;
  address?: string;
  chain?: string;
  type?: string;
  decimals?: number;
  verified?: boolean;
  price?: number;
  volume_24h?: number;
  market_cap?: number;
  rank?: number;
  [key: string]: unknown;
}

export interface SearchGeneralResponse {
  results?: SearchGeneralResultItem[];
  tokens?: SearchGeneralResultItem[];
  [key: string]: unknown;
}

// 2. Token Information
export interface TokenInformationRequest {
  token_address: string;
  chain: string;
  timeframe?: '5m' | '1h' | '6h' | '12h' | '1d' | '7d';
}

export interface TokenInformationDetails {
  token_deployment_date?: string;
  website?: string;
  market_cap_usd?: number;
  fdv_usd?: number;
  circulating_supply?: number | string;
  total_supply?: number | string;
  [key: string]: unknown;
}

export interface TokenInformationSpotMetrics {
  volume_total_usd?: number;
  buy_volume_usd?: number;
  sell_volume_usd?: number;
  total_buys?: number;
  total_sells?: number;
  unique_buyers?: number;
  unique_sellers?: number;
  liquidity_usd?: number;
  total_holders?: number;
  [key: string]: unknown;
}

export interface TokenInformationResponse {
  token_address?: string;
  chain?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  price_usd?: number;
  market_cap_usd?: number;
  volume_24h_usd?: number;
  total_supply?: string;
  circulating_supply?: string;
  data?: {
    name?: string;
    symbol?: string;
    contract_address?: string;
    token_details?: TokenInformationDetails;
    spot_metrics?: TokenInformationSpotMetrics;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// 3. Flow Intelligence
export interface FlowIntelligenceRequest {
  token_address: string;
  chain: string;
  timeframe?: '5m' | '1h' | '6h' | '12h' | '1d' | '7d';
  time_frame?: string;
}

export interface FlowIntelligenceCohort {
  inflow_usd?: number;
  outflow_usd?: number;
  net_flow_usd?: number;
  active_wallets_count?: number;
}

export interface FlowIntelligenceRecord {
  public_figure_net_flow_usd?: number;
  public_figure_avg_flow_usd?: number;
  public_figure_wallet_count?: number;
  top_pnl_net_flow_usd?: number;
  top_pnl_avg_flow_usd?: number;
  top_pnl_wallet_count?: number;
  whale_net_flow_usd?: number;
  whale_avg_flow_usd?: number;
  whale_wallet_count?: number;
  smart_trader_net_flow_usd?: number;
  smart_trader_avg_flow_usd?: number;
  smart_trader_wallet_count?: number;
  exchange_net_flow_usd?: number;
  exchange_avg_flow_usd?: number;
  exchange_wallet_count?: number;
  fresh_wallets_net_flow_usd?: number;
  fresh_wallets_avg_flow_usd?: number;
  fresh_wallets_wallet_count?: number;
  [key: string]: unknown;
}

export interface FlowIntelligenceResponse {
  token_address?: string;
  chain?: string;
  whales?: FlowIntelligenceCohort;
  smart_money?: FlowIntelligenceCohort;
  exchanges?: FlowIntelligenceCohort;
  fresh_wallets?: FlowIntelligenceCohort;
  data?: FlowIntelligenceRecord[];
  [key: string]: unknown;
}

// 4. Who Bought/Sold
export interface WhoBoughtSoldRequest {
  token_address: string;
  chain: string;
  date?: {
    from: string;
    to: string;
  };
  pagination?: {
    page: number;
    per_page: number;
  };
}

export interface WhoBoughtSoldItem {
  address: string;
  address_label?: string;
  label?: string;
  bought_volume_usd?: number;
  sold_volume_usd?: number;
  trade_volume_usd?: number;
  net_volume_usd?: number;
  bought_token_volume?: number;
  sold_token_volume?: number;
  token_amount?: string;
  [key: string]: unknown;
}

export interface WhoBoughtSoldResponse {
  buyers?: WhoBoughtSoldItem[];
  sellers?: WhoBoughtSoldItem[];
  data?: WhoBoughtSoldItem[];
  total_buyers_count?: number;
  total_sellers_count?: number;
  [key: string]: unknown;
}

// 5. Transfers
export interface TokenTransfersRequest {
  token_address: string;
  chain: string;
  min_value_usd?: number;
  date?: {
    from: string;
    to: string;
  };
  pagination?: {
    page: number;
    per_page: number;
  };
}

export interface TokenTransferItem {
  transaction_hash: string;
  block_timestamp: string;
  from_address: string;
  from_label?: string;
  from_address_label?: string;
  to_address: string;
  to_label?: string;
  to_address_label?: string;
  amount?: string;
  transfer_amount?: number | string;
  amount_usd?: number;
  transfer_value_usd?: number;
  [key: string]: unknown;
}

export interface TokenTransfersResponse {
  transfers?: TokenTransferItem[];
  data?: TokenTransferItem[];
  [key: string]: unknown;
}

// 6. DEX Trades
export interface DexTradesRequest {
  token_address: string;
  chain: string;
  date?: {
    from: string;
    to: string;
  };
  pagination?: {
    page: number;
    per_page: number;
  };
}

export interface DexTradeItem {
  transaction_hash: string;
  block_timestamp?: string;
  timestamp?: string;
  dex_name?: string;
  action?: 'BUY' | 'SELL';
  trade_type?: 'BUY' | 'SELL';
  trader_address: string;
  trader_label?: string;
  trader_address_label?: string;
  token_amount?: string | number;
  usd_value?: number;
  estimated_value_usd?: number;
  [key: string]: unknown;
}

export interface DexTradesResponse {
  trades?: DexTradeItem[];
  data?: DexTradeItem[];
  [key: string]: unknown;
}

// 7. Historical Flows
export interface HistoricalFlowsRequest {
  token_address: string;
  chain: string;
  date?: {
    from: string;
    to: string;
  };
}

export interface HistoricalFlowPoint {
  date?: string;
  timestamp?: string;
  net_flow_usd?: number;
  inflow_usd?: number;
  outflow_usd?: number;
  price_usd?: number;
  token_amount?: number;
  value_usd?: number;
  holders_count?: number;
  total_inflows_count?: number;
  total_outflows_count?: number;
  [key: string]: unknown;
}

export interface HistoricalFlowsResponse {
  flows?: HistoricalFlowPoint[];
  data?: HistoricalFlowPoint[];
  [key: string]: unknown;
}

// 8. Token Holders (Standard, 5 credits)
export interface TokenHoldersRequest {
  token_address: string;
  chain: string;
  premium_labels?: false; // NEVER set to true (costs 150 credits)
  pagination?: {
    page: number;
    per_page: number;
  };
}

export interface TokenHolderItem {
  address: string;
  balance: string;
  percentage_held: number;
  usd_value?: number;
  label?: string;
}

export interface TokenHoldersResponse {
  holders?: TokenHolderItem[];
  data?: TokenHolderItem[];
  top_10_percentage?: number;
  top_50_percentage?: number;
  [key: string]: unknown;
}

// 9. Wallet Current Balance
export interface WalletBalanceRequest {
  address: string;
  chain: string;
}

export interface WalletTokenBalance {
  token_address: string;
  symbol: string;
  balance: string;
  usd_value?: number;
}

export interface WalletBalanceResponse {
  address: string;
  chain: string;
  total_usd_value?: number;
  tokens: WalletTokenBalance[];
}

// 10. Wallet Transactions (Not supported on Solana)
export interface WalletTransactionsRequest {
  address: string;
  chain: string;
  pagination?: {
    page: number;
    per_page: number;
  };
}

export interface WalletTransactionItem {
  transaction_hash: string;
  timestamp: string;
  from_address: string;
  to_address: string;
  method?: string;
  value_usd?: number;
}

export interface WalletTransactionsResponse {
  transactions: WalletTransactionItem[];
}

// 11. Related Wallets
export interface RelatedWalletsRequest {
  address: string;
  chain: string;
}

export interface RelatedWalletItem {
  related_address: string;
  relation_type: string;
  confidence_score?: number;
}

export interface RelatedWalletsResponse {
  address: string;
  related_wallets: RelatedWalletItem[];
}

// 12. First Funder (EVM only)
export interface FirstFunderRequest {
  address: string;
  chain: string;
}

export interface FirstFunderResponse {
  address: string;
  first_funder_address?: string;
  first_funder_label?: string;
  funding_transaction_hash?: string;
  funding_timestamp?: string;
  initial_amount_eth?: string;
}

// 13. Counterparties (5 credits)
export interface CounterpartiesRequest {
  address: string;
  chain: string;
  pagination?: {
    page: number;
    per_page: number;
  };
}

export interface CounterpartyItem {
  counterparty_address: string;
  counterparty_label?: string;
  interaction_count: number;
  total_volume_usd?: number;
  last_interaction_timestamp?: string;
}

export interface CounterpartiesResponse {
  counterparties: CounterpartyItem[];
}

// 14. Transaction Deep Dive
export interface TransactionLookupRequest {
  transaction_hash: string;
  chain: string;
}

export interface TransactionLookupResponse {
  transaction_hash: string;
  chain: string;
  timestamp: string;
  from: string;
  to: string;
  status: string;
  gas_usd?: number;
  transfers: Array<{
    token_address: string;
    symbol?: string;
    from: string;
    to: string;
    amount: string;
    amount_usd?: number;
  }>;
}
