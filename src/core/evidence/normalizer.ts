import { createHash } from 'node:crypto';
import { CapabilityName } from '../../types/capabilities.js';
import { EvidenceItem, EvidenceItemSchema, EvidenceProvenance } from '../../types/evidence.js';
import { generateId } from '../../utils/ids.js';
import {
  CounterpartiesResponse,
  FirstFunderResponse,
  RelatedWalletsResponse,
  TokenHoldersResponse,
  TransactionLookupResponse,
  WalletBalanceResponse,
  WalletTransactionsResponse,
} from '../nansen/types.js';

export interface NormalizerInput {
  capability: CapabilityName;
  rawData: unknown;
  provenance: EvidenceProvenance;
  investigationId: string;
}

export interface IEvidenceNormalizer {
  normalize(input: NormalizerInput): EvidenceItem[];
}

export class EvidenceNormalizer implements IEvidenceNormalizer {
  /**
   * Normalizes raw Nansen responses into structured, verified EvidenceItems.
   * Epistemic status is strictly set to OBSERVATION to prevent premature interpretation.
   */
  public normalize(input: NormalizerInput): EvidenceItem[] {
    const { capability, rawData, provenance, investigationId } = input;
    const createdAt = new Date().toISOString();
    const rawSerialized = JSON.stringify(rawData ?? {});
    const rawResponseHash = createHash('sha256').update(rawSerialized).digest('hex');

    const { title, summary, normalizedData } = this.extractDetails(capability, rawData, provenance);

    const item: EvidenceItem = {
      evidenceId: generateId('evi'),
      investigationId,
      title,
      epistemicStatus: 'OBSERVATION',
      summary,
      provenance,
      normalizedData,
      rawResponseHash,
      createdAt,
    };

    // Validate against EvidenceItemSchema
    const parseResult = EvidenceItemSchema.safeParse(item);
    if (!parseResult.success) {
      throw new Error(
        `Evidence normalization failed schema validation: ${parseResult.error.issues.map((i) => i.message).join('; ')}`
      );
    }

    return [parseResult.data];
  }

  private extractDetails(
    capability: CapabilityName,
    raw: unknown,
    provenance: EvidenceProvenance
  ): { title: string; summary: string; normalizedData: Record<string, unknown> } {
    switch (capability) {
      case 'token_search': {
        const rawObj = (raw ?? {}) as any;
        const results = rawObj.tokens ?? rawObj.results ?? (Array.isArray(rawObj.data) ? rawObj.data : []);
        const query = (provenance.queryParams.search_query as string) ?? (provenance.queryParams.query as string) ?? '';
        return {
          title: `Token Search: ${query || provenance.tokenAddress}`,
          summary: `Retrieved ${results.length} token search results for query '${query}'.`,
          normalizedData: {
            results,
            count: results.length,
          },
        };
      }

      case 'token_information': {
        const rawObj = (raw ?? {}) as any;
        const inner = rawObj.data ?? rawObj;
        const symbol = inner.symbol ?? rawObj.symbol ?? 'Token';
        const name = inner.name ?? rawObj.name ?? symbol;
        const details = inner.token_details ?? rawObj.token_details ?? {};
        const metrics = inner.spot_metrics ?? rawObj.spot_metrics ?? {};

        let priceVal = inner.price_usd ?? metrics.price_usd ?? rawObj.price_usd;
        if (priceVal === undefined && details.market_cap_usd && details.circulating_supply && Number(details.circulating_supply) > 0) {
          priceVal = Math.round((Number(details.market_cap_usd) / Number(details.circulating_supply)) * 100) / 100;
        }
        const price = priceVal !== undefined ? `$${priceVal.toLocaleString()}` : 'N/A';
        const mcapVal = details.market_cap_usd ?? inner.market_cap_usd ?? rawObj.market_cap_usd;
        const mcap = mcapVal !== undefined ? `$${Math.round(Number(mcapVal)).toLocaleString()}` : 'N/A';
        const volVal = metrics.volume_total_usd ?? inner.volume_24h_usd ?? rawObj.volume_24h_usd;
        const vol = volVal !== undefined ? `$${Math.round(Number(volVal)).toLocaleString()}` : 'N/A';
        const holders = metrics.total_holders ?? details.total_holders ?? inner.total_holders;

        return {
          title: `Token Spot Metadata: ${symbol}`,
          summary: `Spot metadata for ${name} (${symbol}): price ${price}, market cap ${mcap}, 24h volume ${vol}${holders ? `, holders ${Number(holders).toLocaleString()}` : ''}.`,
          normalizedData: {
            symbol,
            name,
            decimals: inner.decimals ?? rawObj.decimals,
            priceUsd: priceVal,
            marketCapUsd: mcapVal,
            volume24hUsd: volVal,
            totalSupply: details.total_supply ?? inner.total_supply ?? rawObj.total_supply,
            circulatingSupply: details.circulating_supply ?? inner.circulating_supply ?? rawObj.circulating_supply,
            spotMetrics: metrics,
          },
        };
      }

      case 'flow_intelligence': {
        const rawObj = (raw ?? {}) as any;
        const flowRecord = Array.isArray(rawObj.data)
          ? rawObj.data[0]
          : Array.isArray(rawObj)
          ? rawObj[0]
          : rawObj;

        const smNet = flowRecord?.smart_trader_net_flow_usd ?? rawObj.smart_money?.net_flow_usd ?? 0;
        const topPnlNet = flowRecord?.top_pnl_net_flow_usd ?? 0;
        const whaleNet = flowRecord?.whale_net_flow_usd ?? rawObj.whales?.net_flow_usd ?? 0;
        const freshNet = flowRecord?.fresh_wallets_net_flow_usd ?? rawObj.fresh_wallets?.net_flow_usd ?? 0;
        const exNet = flowRecord?.exchange_net_flow_usd ?? rawObj.exchanges?.net_flow_usd ?? 0;
        const pubFigureNet = flowRecord?.public_figure_net_flow_usd ?? 0;

        const combinedSmartMoney = smNet !== 0 ? smNet : topPnlNet;

        return {
          title: `Cohort Net Flows: ${provenance.chain.toUpperCase()}`,
          summary: `Cohort net flows: Smart Money/Top PnL $${Math.round(combinedSmartMoney).toLocaleString()}, Fresh Wallets $${Math.round(freshNet).toLocaleString()}, Exchanges $${Math.round(exNet).toLocaleString()}, Whales $${Math.round(whaleNet).toLocaleString()}.`,
          normalizedData: {
            smartMoneyNetUsd: combinedSmartMoney,
            topPnlNetUsd: topPnlNet,
            whalesNetUsd: whaleNet,
            freshWalletsNetUsd: freshNet,
            exchangesNetUsd: exNet,
            publicFigureNetUsd: pubFigureNet,
            rawRecord: flowRecord,
          },
        };
      }

      case 'who_bought_sold': {
        const rawObj = (raw ?? {}) as any;
        let buyers = rawObj.buyers ?? [];
        let sellers = rawObj.sellers ?? [];

        if (Array.isArray(rawObj.data)) {
          buyers = rawObj.data.filter((t: any) => (t.bought_volume_usd || 0) >= (t.sold_volume_usd || 0));
          sellers = rawObj.data.filter((t: any) => (t.sold_volume_usd || 0) > (t.bought_volume_usd || 0));
          if (buyers.length === 0 && sellers.length === 0) {
            buyers = rawObj.data;
          }
        }

        const topBuyer = buyers[0];
        const topBuyerDesc = topBuyer
          ? `${topBuyer.address_label || topBuyer.label || topBuyer.address?.slice(0, 8) + '...'}`
          : 'None';

        return {
          title: `Top Accumulators & Distributors: ${provenance.chain.toUpperCase()}`,
          summary: `Identified ${buyers.length} top net buyers and ${sellers.length} top net sellers. Top accumulator: ${topBuyerDesc}.`,
          normalizedData: {
            buyers,
            sellers,
            totalBuyersCount: rawObj.total_buyers_count ?? buyers.length,
            totalSellersCount: rawObj.total_sellers_count ?? sellers.length,
          },
        };
      }

      case 'token_transfers': {
        const rawObj = (raw ?? {}) as any;
        const transfers = Array.isArray(rawObj.data) ? rawObj.data : (rawObj.transfers ?? (Array.isArray(rawObj) ? rawObj : []));
        return {
          title: `Granular Token Transfers: ${provenance.chain.toUpperCase()}`,
          summary: `Retrieved ${transfers.length} token transfer transactions.`,
          normalizedData: {
            transfers,
            count: transfers.length,
          },
        };
      }

      case 'dex_trades': {
        const rawObj = (raw ?? {}) as any;
        const trades = Array.isArray(rawObj.data) ? rawObj.data : (rawObj.trades ?? (Array.isArray(rawObj) ? rawObj : []));
        return {
          title: `DEX Trade Executions: ${provenance.chain.toUpperCase()}`,
          summary: `Retrieved ${trades.length} decentralized exchange swap events.`,
          normalizedData: {
            trades,
            count: trades.length,
          },
        };
      }

      case 'historical_flows': {
        const rawObj = (raw ?? {}) as any;
        const flows = Array.isArray(rawObj.data) ? rawObj.data : (rawObj.flows ?? (Array.isArray(rawObj) ? rawObj : []));
        return {
          title: `Historical Flow Series: ${provenance.chain.toUpperCase()}`,
          summary: `Retrieved ${flows.length} time-series flow records.`,
          normalizedData: {
            flows,
            count: flows.length,
          },
        };
      }

      case 'token_holders': {
        const data = (raw ?? {}) as TokenHoldersResponse;
        const holders = data.holders ?? [];
        const top10 = data.top_10_percentage !== undefined ? `${data.top_10_percentage}%` : 'N/A';
        const top50 = data.top_50_percentage !== undefined ? `${data.top_50_percentage}%` : 'N/A';
        return {
          title: `Token Holder Concentration: ${provenance.chain.toUpperCase()}`,
          summary: `Token supply distribution: top 10 holders control ${top10}, top 50 control ${top50} (inspected ${holders.length} holders).`,
          normalizedData: {
            holders,
            top10Percentage: data.top_10_percentage,
            top50Percentage: data.top_50_percentage,
            count: holders.length,
          },
        };
      }

      case 'wallet_current_balance': {
        const data = (raw ?? {}) as WalletBalanceResponse;
        const tokens = data.tokens ?? [];
        const totalUsd = data.total_usd_value !== undefined ? `$${data.total_usd_value.toLocaleString()}` : 'N/A';
        const addr = data.address || provenance.relevantWallet || 'wallet';
        return {
          title: `Wallet Holdings: ${addr.slice(0, 10)}...`,
          summary: `Wallet holds ${tokens.length} token positions with total portfolio value ${totalUsd}.`,
          normalizedData: {
            address: data.address,
            chain: data.chain,
            totalUsdValue: data.total_usd_value,
            tokens,
          },
        };
      }

      case 'wallet_transactions': {
        const data = (raw ?? {}) as WalletTransactionsResponse;
        const transactions = data.transactions ?? [];
        const addr = provenance.relevantWallet || 'wallet';
        return {
          title: `Wallet Activity Log: ${addr.slice(0, 10)}...`,
          summary: `Retrieved ${transactions.length} historical transactions for wallet.`,
          normalizedData: {
            transactions,
            count: transactions.length,
          },
        };
      }

      case 'wallet_related': {
        const data = (raw ?? {}) as RelatedWalletsResponse;
        const related = data.related_wallets ?? [];
        const addr = data.address || provenance.relevantWallet || 'wallet';
        return {
          title: `Related Wallet Clusters: ${addr.slice(0, 10)}...`,
          summary: `Discovered ${related.length} cluster linkages and co-controlled wallet connections.`,
          normalizedData: {
            address: data.address,
            relatedWallets: related,
            count: related.length,
          },
        };
      }

      case 'wallet_first_funder': {
        const data = (raw ?? {}) as FirstFunderResponse;
        const funder = data.first_funder_address ?? 'unknown';
        const label = data.first_funder_label ? ` (${data.first_funder_label})` : '';
        const addr = data.address || provenance.relevantWallet || 'wallet';
        return {
          title: `Origin Funder: ${addr.slice(0, 10)}...`,
          summary: `Origin gas funder for ${addr} is ${funder}${label} via transaction ${data.funding_transaction_hash ?? 'N/A'}.`,
          normalizedData: {
            address: data.address,
            firstFunderAddress: data.first_funder_address,
            firstFunderLabel: data.first_funder_label,
            fundingTransactionHash: data.funding_transaction_hash,
            fundingTimestamp: data.funding_timestamp,
            initialAmountEth: data.initial_amount_eth,
          },
        };
      }

      case 'wallet_counterparties': {
        const data = (raw ?? {}) as CounterpartiesResponse;
        const counterparties = data.counterparties ?? [];
        const addr = provenance.relevantWallet || 'wallet';
        return {
          title: `Counterparty Interactions: ${addr.slice(0, 10)}...`,
          summary: `Identified ${counterparties.length} interacting counterparty addresses/contracts.`,
          normalizedData: {
            counterparties,
            count: counterparties.length,
          },
        };
      }

      case 'transaction_deep_dive': {
        const data = (raw ?? {}) as TransactionLookupResponse;
        const txHash = data.transaction_hash || provenance.transactionHash || 'tx';
        const gasUsd = data.gas_usd !== undefined ? `$${data.gas_usd}` : 'N/A';
        const transfersCount = data.transfers?.length ?? 0;
        return {
          title: `Transaction Inspection: ${txHash.slice(0, 12)}...`,
          summary: `Transaction ${txHash} on ${data.chain}: status ${data.status}, gas ${gasUsd}, internal transfers: ${transfersCount}.`,
          normalizedData: {
            transactionHash: data.transaction_hash,
            chain: data.chain,
            timestamp: data.timestamp,
            from: data.from,
            to: data.to,
            status: data.status,
            gasUsd: data.gas_usd,
            transfers: data.transfers ?? [],
          },
        };
      }

      default: {
        const data = (raw ?? {}) as Record<string, unknown>;
        return {
          title: `Evidence: ${capability}`,
          summary: `Retrieved evidence for capability ${capability}.`,
          normalizedData: data,
        };
      }
    }
  }
}

export const evidenceNormalizer = new EvidenceNormalizer();
