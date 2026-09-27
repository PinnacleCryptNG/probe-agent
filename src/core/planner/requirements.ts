import { generateId } from '../../utils/ids.js';
import { getNativeAssetForChain } from '../target/native-assets.js';
import {
  PlanEvidenceRequirement,
  PlannerContext,
  PlannerIntent,
} from './types.js';

function getDefaultDateRange(days = 7): { from: string; to: string } {
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);
  const from = fromDate.toISOString().slice(0, 10);
  return { from, to };
}

export interface TimeWindowInfo {
  days: number;
  timeframe: '5m' | '1h' | '6h' | '12h' | '1d' | '7d';
  dateRange: { from: string; to: string };
  label: 'today' | 'this week' | 'this month' | 'recently' | 'default';
}

export function parseTimeWindow(question: string): TimeWindowInfo {
  const q = question.toLowerCase();
  if (/\b(today|past 24 hours?|last 24 hours?|24h)\b/.test(q)) {
    return {
      days: 1,
      timeframe: '1d',
      dateRange: getDefaultDateRange(1),
      label: 'today',
    };
  }
  if (/\b(this month|past 30 days?|last 30 days?|30d|past month|last month)\b/.test(q)) {
    return {
      days: 30,
      timeframe: '7d',
      dateRange: getDefaultDateRange(30),
      label: 'this month',
    };
  }
  if (/\b(recently|recent)\b/.test(q)) {
    return {
      days: 7,
      timeframe: '7d',
      dateRange: getDefaultDateRange(7),
      label: 'recently',
    };
  }
  if (/\b(this week|past 7 days?|last 7 days?|7d|past week|last week)\b/.test(q)) {
    return {
      days: 7,
      timeframe: '7d',
      dateRange: getDefaultDateRange(7),
      label: 'this week',
    };
  }
  return {
    days: 7,
    timeframe: '7d',
    dateRange: getDefaultDateRange(7),
    label: 'default',
  };
}

export class RequirementFormulator {
  /**
   * Formulates structured evidence requirements based on intent, question semantics,
   * token context, and prior investigation state.
   */
  public formulate(
    intent: PlannerIntent,
    question: string,
    context: PlannerContext
  ): PlanEvidenceRequirement[] {
    const q = question.toLowerCase();
    const target = context.target ?? (context.token ? ({ type: 'token', token: context.token, chain: context.token.chain } as const) : undefined);
    const chain = target?.chain ?? context.token?.chain ?? 'ethereum';
    let tokenAddress = target?.type === 'token' ? target.token.address : (context.token?.address || '');
    if (!tokenAddress && target?.type === 'chain') {
      const native = getNativeAssetForChain(chain);
      if (native) {
        tokenAddress = native.address;
      }
    }
    const timeWindow = parseTimeWindow(question);
    const defaultDate = timeWindow.dateRange;

    switch (intent) {
      case 'activity_change': {
        // e.g. "Why is this token suddenly pumping?", "Why did volume spike?"
        // Credit awareness: use 1-credit flow/trading capabilities. Do NOT default to 5-credit holders.
        return [
          {
            id: generateId('req'),
            concept: 'current token price and spot activity',
            priority: 'required',
            rationale: 'Establish baseline price, volume, and market valuation at time of query',
            candidateCapabilities: ['token_information'],
            parameters: { token_address: tokenAddress, chain, timeframe: timeWindow.timeframe },
          },
          {
            id: generateId('req'),
            concept: 'cohort flow dynamics (smart money, whales, fresh wallets)',
            priority: 'required',
            rationale: 'Determine which market participant cohorts drove net inflows or outflows',
            candidateCapabilities: ['flow_intelligence'],
            parameters: { token_address: tokenAddress, chain, timeframe: timeWindow.timeframe },
          },
          {
            id: generateId('req'),
            concept: 'top accumulating and distributing entities',
            priority: 'required',
            rationale: 'Identify the specific addresses executing the largest net purchases or sales',
            candidateCapabilities: ['who_bought_sold'],
            parameters: { token_address: tokenAddress, chain, date: defaultDate },
          },
          {
            id: generateId('req'),
            concept: 'historical volume baseline',
            priority: 'optional',
            rationale: 'Verify whether today’s activity exceeds normal historical averages',
            candidateCapabilities: ['historical_flows'],
            parameters: { token_address: tokenAddress, chain, date: defaultDate },
          },
          {
            id: generateId('req'),
            concept: 'causal market sentiment and external off-chain catalysts',
            priority: 'unresolved',
            rationale: 'Off-chain news, sentiment, team marketing, or exchange listing rumors cannot be definitively proven on-chain',
            candidateCapabilities: [],
            parameters: {},
          },
        ];
      }

      case 'accumulation': {
        // e.g. "Who is accumulating?", "Are smart wallets buying?"
        return [
          {
            id: generateId('req'),
            concept: 'top net buyers identification',
            priority: 'required',
            rationale: 'Pinpoint individual addresses accumulating the largest share of token volume',
            candidateCapabilities: ['who_bought_sold'],
            parameters: { token_address: tokenAddress, chain, date: defaultDate },
          },
          {
            id: generateId('req'),
            concept: 'cohort accumulation metrics',
            priority: 'required',
            rationale: 'Measure aggregate smart money and whale net accumulation',
            candidateCapabilities: ['flow_intelligence'],
            parameters: { token_address: tokenAddress, chain, timeframe: '1d' },
          },
          {
            id: generateId('req'),
            concept: 'large decentralized swap executions',
            priority: 'optional',
            rationale: 'Inspect specific DEX trades where accumulation occurred',
            candidateCapabilities: ['dex_trades'],
            parameters: { token_address: tokenAddress, chain, date: defaultDate },
          },
        ];
      }

      case 'distribution': {
        // e.g. "Are whales dumping?", "Who is selling?"
        return [
          {
            id: generateId('req'),
            concept: 'top net sellers identification',
            priority: 'required',
            rationale: 'Identify addresses disposing of the largest token amounts',
            candidateCapabilities: ['who_bought_sold'],
            parameters: { token_address: tokenAddress, chain, date: defaultDate },
          },
          {
            id: generateId('req'),
            concept: 'cohort outflow dynamics',
            priority: 'required',
            rationale: 'Quantify whale and exchange net outflows',
            candidateCapabilities: ['flow_intelligence'],
            parameters: { token_address: tokenAddress, chain, timeframe: '1d' },
          },
          {
            id: generateId('req'),
            concept: 'large token transfers to exchanges',
            priority: 'optional',
            rationale: 'Trace whether sellers moved tokens through direct transfer contracts',
            candidateCapabilities: ['token_transfers'],
            parameters: { token_address: tokenAddress, chain, date: defaultDate },
          },
        ];
      }

      case 'holder_analysis': {
        // e.g. "Who are the top holders?", "How concentrated is the supply?"
        // Explicitly requires token_holders (5 credits)
        return [
          {
            id: generateId('req'),
            concept: 'top token holders and concentration percentages',
            priority: 'required',
            rationale: 'Quantify top 10 and top 50 holder concentration and address ownership',
            candidateCapabilities: ['token_holders'],
            parameters: { token_address: tokenAddress, chain, premium_labels: false },
          },
          {
            id: generateId('req'),
            concept: 'token circulating supply baseline',
            priority: 'optional',
            rationale: 'Cross-reference total supply and market capitalization',
            candidateCapabilities: ['token_information'],
            parameters: { token_address: tokenAddress, chain, timeframe: '1d' },
          },
        ];
      }

      case 'transfers':
      case 'large_transactions': {
        // e.g. "What were the biggest transactions?", "Show large transfers"
        return [
          {
            id: generateId('req'),
            concept: 'large on-chain token transfer transactions',
            priority: 'required',
            rationale: 'Retrieve individual transfer events above threshold value',
            candidateCapabilities: ['token_transfers'],
            parameters: {
              token_address: tokenAddress,
              chain,
              date: defaultDate,
              time_window: timeWindow.label,
              timeframe: timeWindow.timeframe,
            },
          },
          {
            id: generateId('req'),
            concept: 'DEX swap executions comparison',
            priority: 'optional',
            rationale: 'Compare direct transfers against decentralized exchange trades',
            candidateCapabilities: ['dex_trades'],
            parameters: {
              token_address: tokenAddress,
              chain,
              date: defaultDate,
              time_window: timeWindow.label,
              timeframe: timeWindow.timeframe,
            },
          },
        ];
      }

      case 'historical_comparison': {
        // e.g. "Is today's activity unusual compared to last week?"
        return [
          {
            id: generateId('req'),
            concept: 'historical net flows timeline',
            priority: 'required',
            rationale: 'Compare current daily activity with multi-day historical baseline',
            candidateCapabilities: ['historical_flows'],
            parameters: { token_address: tokenAddress, chain, date: defaultDate },
          },
          {
            id: generateId('req'),
            concept: 'multi-day cohort flow trends',
            priority: 'required',
            rationale: 'Evaluate 7d and 30d cohort net movements',
            candidateCapabilities: ['flow_intelligence'],
            parameters: { token_address: tokenAddress, chain, timeframe: '7d' },
          },
        ];
      }

      case 'wallet_activity': {
        const targetWallet =
          context.targetWalletAddress ||
          (target?.type === 'wallet' ? target.address : undefined) ||
          (q.match(/0x[a-fA-F0-9]{40}/)?.[0] ?? '');

        // If user specifically asked about balance / holdings / portfolio
        if (q.includes('balance') || q.includes('holding') || q.includes('portfolio') || q.includes('worth')) {
          return [
            {
              id: generateId('req'),
              concept: 'wallet current asset holdings',
              priority: 'required',
              rationale: 'Determine current portfolio value and token balances',
              candidateCapabilities: ['wallet_current_balance'],
              parameters: { address: targetWallet, chain },
            },
          ];
        }

        // If user specifically asked about transactions / transfer history
        if (q.includes('transaction') || q.includes('transfer') || q.includes('history') || q.includes('tx')) {
          return [
            {
              id: generateId('req'),
              concept: 'wallet transaction history',
              priority: 'required',
              rationale: 'Inspect recent on-chain transactions and call methods executed by target wallet',
              candidateCapabilities: ['wallet_transactions'],
              parameters: { address: targetWallet, chain },
            },
          ];
        }

        // General wallet activity inspection (e.g. "What has this wallet been doing?", "Investigate 0x...")
        return [
          {
            id: generateId('req'),
            concept: 'wallet transaction history',
            priority: 'required',
            rationale: 'Inspect recent on-chain transactions and call methods executed by target wallet',
            candidateCapabilities: ['wallet_transactions'],
            parameters: { address: targetWallet, chain },
          },
          {
            id: generateId('req'),
            concept: 'wallet current asset holdings',
            priority: 'optional',
            rationale: 'Determine current portfolio value and token balances',
            candidateCapabilities: ['wallet_current_balance'],
            parameters: { address: targetWallet, chain },
          },
          {
            id: generateId('req'),
            concept: 'wallet interaction counterparties',
            priority: 'optional',
            rationale: 'Discover key entities and protocols interacting with the wallet',
            candidateCapabilities: ['wallet_counterparties'],
            parameters: { address: targetWallet, chain },
          },
        ];
      }

      case 'wallet_relationships': {
        const targetWallet =
          context.targetWalletAddress ||
          (target?.type === 'wallet' ? target.address : undefined) ||
          (q.match(/0x[a-fA-F0-9]{40}/)?.[0] ?? '');

        // If user specifically asked who funded the wallet
        if (q.includes('funder') || q.includes('funded') || q.includes('funding')) {
          return [
            {
              id: generateId('req'),
              concept: 'first funder origin identity',
              priority: 'required',
              rationale: 'Trace origin gas funding source to discover creator or parent entity',
              candidateCapabilities: ['wallet_first_funder'],
              parameters: { address: targetWallet, chain },
            },
            {
              id: generateId('req'),
              concept: 'co-controlled related wallet clusters',
              priority: 'optional',
              rationale: 'Discover address clusters exhibiting shared ownership or coordinated transfers',
              candidateCapabilities: ['wallet_related'],
              parameters: { address: targetWallet, chain },
            },
          ];
        }

        // If user specifically asked about counterparties
        if (q.includes('counterpart')) {
          return [
            {
              id: generateId('req'),
              concept: 'frequent counterparty network',
              priority: 'required',
              rationale: 'Map highest-frequency transaction destinations',
              candidateCapabilities: ['wallet_counterparties'],
              parameters: { address: targetWallet, chain },
            },
          ];
        }

        // General wallet relationships
        return [
          {
            id: generateId('req'),
            concept: 'co-controlled related wallet clusters',
            priority: 'required',
            rationale: 'Discover address clusters exhibiting shared ownership or coordinated transfers',
            candidateCapabilities: ['wallet_related'],
            parameters: { address: targetWallet, chain },
          },
          {
            id: generateId('req'),
            concept: 'first funder origin identity',
            priority: 'optional',
            rationale: 'Trace origin gas funding source to discover creator or parent entity',
            candidateCapabilities: ['wallet_first_funder'],
            parameters: { address: targetWallet, chain },
          },
          {
            id: generateId('req'),
            concept: 'frequent counterparty network',
            priority: 'optional',
            rationale: 'Map highest-frequency transaction destinations',
            candidateCapabilities: ['wallet_counterparties'],
            parameters: { address: targetWallet, chain },
          },
        ];
      }

      case 'trading_activity':
      case 'dex_activity': {
        // e.g. "Show me DEX swaps", "Are people trading on Uniswap?"
        return [
          {
            id: generateId('req'),
            concept: 'decentralized exchange swap executions',
            priority: 'required',
            rationale: 'Analyze DEX volume, traders, and transaction amounts',
            candidateCapabilities: ['dex_trades'],
            parameters: { token_address: tokenAddress, chain },
          },
          {
            id: generateId('req'),
            concept: 'token spot trading volume',
            priority: 'optional',
            rationale: 'Establish 24h aggregate volume context',
            candidateCapabilities: ['token_information'],
            parameters: { token_address: tokenAddress, chain },
          },
        ];
      }

      case 'flow_analysis': {
        return [
          {
            id: generateId('req'),
            concept: 'cohort flow distributions',
            priority: 'required',
            rationale: 'Assess smart money vs whale net flow positions',
            candidateCapabilities: ['flow_intelligence'],
            parameters: { token_address: tokenAddress, chain, time_frame: '24h' },
          },
          {
            id: generateId('req'),
            concept: 'historical flow time series',
            priority: 'optional',
            rationale: 'Evaluate historical trend line of flows',
            candidateCapabilities: ['historical_flows'],
            parameters: { token_address: tokenAddress, chain },
          },
        ];
      }

      case 'token_activity': {
        return [
          {
            id: generateId('req'),
            concept: 'token spot metadata and status',
            priority: 'required',
            rationale: 'Obtain current price, volume, and market cap metrics',
            candidateCapabilities: ['token_information'],
            parameters: { token_address: tokenAddress, chain },
          },
          {
            id: generateId('req'),
            concept: 'recent cohort flow activity',
            priority: 'optional',
            rationale: 'Check if there is active cohort flow movement',
            candidateCapabilities: ['flow_intelligence'],
            parameters: { token_address: tokenAddress, chain, time_frame: '24h' },
          },
        ];
      }

      case 'unknown':
      default: {
        // e.g. "Will this token reach $100?", "What is the dev team's secret roadmap?"
        return [
          {
            id: generateId('req'),
            concept: 'baseline token verification',
            priority: 'optional',
            rationale: 'Verify the token contract exists and retrieve current status',
            candidateCapabilities: ['token_information'],
            parameters: { token_address: tokenAddress, chain },
          },
          {
            id: generateId('req'),
            concept: 'future price projection or off-chain subjective intent',
            priority: 'unresolved',
            rationale: 'On-chain forensic data cannot predict future price speculation or read off-chain developer intent',
            candidateCapabilities: [],
            parameters: {},
          },
        ];
      }
    }
  }

  /**
   * Formulates evidence requirements specifically tailored for a challenge against an existing finding.
   */
  public formulateForChallenge(
    challengeText: string,
    context: PlannerContext
  ): PlanEvidenceRequirement[] {
    const target = context.target ?? (context.token ? ({ type: 'token', token: context.token, chain: context.token.chain } as const) : undefined);
    const chain = target?.chain ?? context.token?.chain ?? 'ethereum';
    let tokenAddress = target?.type === 'token' ? target.token.address : (context.token?.address || '');
    if (!tokenAddress && target?.type === 'chain') {
      const native = getNativeAssetForChain(chain);
      if (native) {
        tokenAddress = native.address;
      }
    }

    return [
      {
        id: generateId('req'),
        concept: 'granular buyer and seller entity verification',
        priority: 'required',
        rationale: `Cross-examine challenge hypothesis: "${challengeText}" by checking individual accumulating and distributing entities`,
        candidateCapabilities: ['who_bought_sold'],
        parameters: { token_address: tokenAddress, chain },
      },
      {
        id: generateId('req'),
        concept: 'granular DEX trade execution inspection',
        priority: 'required',
        rationale: 'Examine direct swap timestamps and transaction hashes to verify counter-claims',
        candidateCapabilities: ['dex_trades'],
        parameters: { token_address: tokenAddress, chain },
      },
      {
        id: generateId('req'),
        concept: 'large token transfer audit',
        priority: 'optional',
        rationale: 'Audit non-DEX token transfers that could explain counterpoint movements',
        candidateCapabilities: ['token_transfers'],
        parameters: { token_address: tokenAddress, chain },
      },
    ];
  }
}
