import { beforeEach, describe, expect, it } from 'vitest';
import { MockLLMProvider } from '../../../src/core/llm/interface.js';
import { EvidenceSynthesisEngine } from '../../../src/core/synthesis/synthesizer.js';
import { EvidenceValidator } from '../../../src/core/synthesis/validator.js';
import { SynthesisRequest, SynthesisResult } from '../../../src/core/synthesis/types.js';
import { TokenContext } from '../../../src/types/domain.js';
import { EvidenceItem } from '../../../src/types/evidence.js';

// ============================================================================
// TEST FIXTURES — NOT REAL BLOCKCHAIN DATA
// ============================================================================

const TEST_TOKEN: TokenContext = {
  address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
  symbol: 'UNI',
  name: 'Uniswap',
  chain: 'ethereum',
  resolvedAt: '2026-09-24T12:00:00Z',
};

const TEST_INVESTIGATION_ID = 'inv_test_synthesis_100';

const TEST_FIXTURE_EVIDENCE_1: EvidenceItem = {
  evidenceId: 'evi_valid_1',
  investigationId: TEST_INVESTIGATION_ID,
  title: 'Cohort Net Flows: ETHEREUM',
  epistemicStatus: 'OBSERVATION',
  summary: 'Smart money net flow +$900,000, whale net flow +$400,000 over 24h.',
  provenance: {
    source: 'nansen',
    endpoint: '/api/v1/tgm/flow-intelligence',
    capability: 'flow_intelligence',
    chain: 'ethereum',
    tokenAddress: TEST_TOKEN.address,
    queryParams: { token_address: TEST_TOKEN.address, chain: 'ethereum' },
    retrievedAt: '2026-09-24T12:00:00Z',
    creditsCost: 1,
  },
  normalizedData: {
    smartMoney: { net_flow_usd: 900000 },
    whales: { net_flow_usd: 400000 },
  },
  createdAt: '2026-09-24T12:00:00Z',
};

const TEST_FIXTURE_KNOWN_WALLET = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const TEST_FIXTURE_KNOWN_TX_HASH =
  '0x5555555555555555555555555555555555555555555555555555555555555555';

const TEST_FIXTURE_EVIDENCE_2: EvidenceItem = {
  evidenceId: 'evi_valid_2',
  investigationId: TEST_INVESTIGATION_ID,
  title: 'Top Buyers: ETHEREUM',
  epistemicStatus: 'OBSERVATION',
  summary: `Top buyer ${TEST_FIXTURE_KNOWN_WALLET} accumulated $250,000 volume in tx ${TEST_FIXTURE_KNOWN_TX_HASH}.`,
  provenance: {
    source: 'nansen',
    endpoint: '/api/v1/tgm/who-bought-sold',
    capability: 'who_bought_sold',
    chain: 'ethereum',
    tokenAddress: TEST_TOKEN.address,
    relevantWallet: TEST_FIXTURE_KNOWN_WALLET,
    transactionHash: TEST_FIXTURE_KNOWN_TX_HASH,
    queryParams: { token_address: TEST_TOKEN.address, chain: 'ethereum' },
    retrievedAt: '2026-09-24T12:01:00Z',
    creditsCost: 1,
  },
  normalizedData: {
    buyers: [{ address: TEST_FIXTURE_KNOWN_WALLET, volume: 250000 }],
    tx: TEST_FIXTURE_KNOWN_TX_HASH,
  },
  createdAt: '2026-09-24T12:01:00Z',
};

describe('EvidenceSynthesisEngine (Phase 2C)', () => {
  let mockLLM: MockLLMProvider;
  let validator: EvidenceValidator;
  let engine: EvidenceSynthesisEngine;

  beforeEach(() => {
    mockLLM = new MockLLMProvider();
    validator = new EvidenceValidator();
    engine = new EvidenceSynthesisEngine({
      llmProvider: mockLLM,
      validator,
    });
  });

  // 1. Valid evidence-backed answer
  it('1. generates a valid, evidence-grounded investigation finding', async () => {
    const request: SynthesisRequest = {
      question: 'Who is accumulating and what are cohort flows?',
      investigationId: TEST_INVESTIGATION_ID,
      tokenContext: TEST_TOKEN,
      evidence: [TEST_FIXTURE_EVIDENCE_1, TEST_FIXTURE_EVIDENCE_2],
    };

    const result = await engine.synthesize(request);

    expect(result.success).toBe(true);
    expect(result.validated).toBe(true);
    expect(result.observations.length).toBeGreaterThanOrEqual(2);
    expect(result.observations.length).toBeLessThanOrEqual(5);
    expect(result.observations[0].evidenceRefs).toContain('evi_valid_1');
    expect(result.interpretations.length).toBeGreaterThan(0);
    expect(result.answer).toContain(`🔎 ${TEST_TOKEN.symbol}`);
    expect(result.answer).toContain('Evidence');
    expect(result.answer).toContain(`Ask another question about ${TEST_TOKEN.symbol}.`);
  });

  // 2. Observation with valid evidence reference
  it('2. validates observations citing verified EvidenceItem IDs', () => {
    const candidate: SynthesisResult = {
      success: true,
      answer: 'Sample answer',
      observations: [
        {
          id: 'fnd_1',
          statement: 'Smart money accumulated $900,000.',
          evidenceRefs: ['evi_valid_1'],
        },
      ],
      interpretations: [],
      hypotheses: [],
      unknowns: [],
      evidenceRefs: ['evi_valid_1'],
      followUpQuestions: [],
      validated: false,
      investigationId: TEST_INVESTIGATION_ID,
      createdAt: new Date().toISOString(),
    };

    const validation = validator.validate(
      candidate,
      [TEST_FIXTURE_EVIDENCE_1],
      TEST_INVESTIGATION_ID,
      TEST_TOKEN.address
    );

    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  // 3. Invalid evidence reference rejected
  it('3. rejects candidate when an observation cites a non-existent Evidence ID', () => {
    const candidate: SynthesisResult = {
      success: true,
      answer: 'Sample answer',
      observations: [
        {
          id: 'fnd_bad_ref',
          statement: 'Factual claim citing manufactured evidence ID.',
          evidenceRefs: ['evi_hallucinated_999'],
        },
      ],
      interpretations: [],
      hypotheses: [],
      unknowns: [],
      evidenceRefs: ['evi_hallucinated_999'],
      followUpQuestions: [],
      validated: false,
      investigationId: TEST_INVESTIGATION_ID,
      createdAt: new Date().toISOString(),
    };

    const validation = validator.validate(
      candidate,
      [TEST_FIXTURE_EVIDENCE_1],
      TEST_INVESTIGATION_ID,
      TEST_TOKEN.address
    );

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.code === 'UNKNOWN_EVIDENCE_REFERENCE')).toBe(true);
  });

  // 4. Missing evidence for factual claim rejected
  it('4. rejects factual observations that do not cite any evidence references', () => {
    const candidate: SynthesisResult = {
      success: true,
      answer: 'Sample answer',
      observations: [
        {
          id: 'fnd_no_ref',
          statement: 'Unreferenced factual claim.',
          evidenceRefs: [], // Missing!
        },
      ],
      interpretations: [],
      hypotheses: [],
      unknowns: [],
      evidenceRefs: [],
      followUpQuestions: [],
      validated: false,
      investigationId: TEST_INVESTIGATION_ID,
      createdAt: new Date().toISOString(),
    };

    const validation = validator.validate(
      candidate,
      [TEST_FIXTURE_EVIDENCE_1],
      TEST_INVESTIGATION_ID,
      TEST_TOKEN.address
    );

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.code === 'FACTUAL_CLAIM_WITHOUT_EVIDENCE')).toBe(true);
  });

  // 5. Interpretation with supporting evidence accepted
  it('5. accepts interpretations with confidence rating and supporting evidence refs', () => {
    const candidate: SynthesisResult = {
      success: true,
      answer: 'Sample answer',
      observations: [
        {
          id: 'fnd_obs',
          statement: 'Observed net flow.',
          evidenceRefs: ['evi_valid_1'],
        },
      ],
      interpretations: [
        {
          id: 'fnd_interp',
          statement: 'Flow dynamics suggest buy pressure from institutional cohorts.',
          confidence: 'high',
          confidenceRationale: 'Derived from smart money net inflow',
          evidenceRefs: ['evi_valid_1'],
        },
      ],
      hypotheses: [],
      unknowns: [],
      evidenceRefs: ['evi_valid_1'],
      followUpQuestions: [],
      validated: false,
      investigationId: TEST_INVESTIGATION_ID,
      createdAt: new Date().toISOString(),
    };

    const validation = validator.validate(
      candidate,
      [TEST_FIXTURE_EVIDENCE_1],
      TEST_INVESTIGATION_ID,
      TEST_TOKEN.address
    );

    expect(validation.isValid).toBe(true);
  });

  // 6. Hypothesis with supporting evidence accepted
  it('6. accepts hypotheses supported by verified evidence references', () => {
    const candidate: SynthesisResult = {
      success: true,
      answer: 'Sample answer',
      observations: [
        {
          id: 'fnd_obs',
          statement: 'Observed net flow.',
          evidenceRefs: ['evi_valid_1'],
        },
      ],
      interpretations: [],
      hypotheses: [
        {
          id: 'hyp_1',
          statement: 'Continued net inflows may support local price floor.',
          evidenceRefs: ['evi_valid_1'],
        },
      ],
      unknowns: [],
      evidenceRefs: ['evi_valid_1'],
      followUpQuestions: [],
      validated: false,
      investigationId: TEST_INVESTIGATION_ID,
      createdAt: new Date().toISOString(),
    };

    const validation = validator.validate(
      candidate,
      [TEST_FIXTURE_EVIDENCE_1],
      TEST_INVESTIGATION_ID,
      TEST_TOKEN.address
    );

    expect(validation.isValid).toBe(true);
  });

  // 7. Unknown claim accepted without evidence
  it('7. accepts unknown claims without requiring evidence references', () => {
    const candidate: SynthesisResult = {
      success: true,
      answer: 'Sample answer',
      observations: [
        {
          id: 'fnd_obs',
          statement: 'Observed net flow.',
          evidenceRefs: ['evi_valid_1'],
        },
      ],
      interpretations: [],
      hypotheses: [],
      unknowns: [
        {
          statement: 'Future exchange listings and marketing roadmaps',
          reason: 'Cannot be determined from on-chain data alone.',
        },
      ],
      evidenceRefs: ['evi_valid_1'],
      followUpQuestions: [],
      validated: false,
      investigationId: TEST_INVESTIGATION_ID,
      createdAt: new Date().toISOString(),
    };

    const validation = validator.validate(
      candidate,
      [TEST_FIXTURE_EVIDENCE_1],
      TEST_INVESTIGATION_ID,
      TEST_TOKEN.address
    );

    expect(validation.isValid).toBe(true);
  });

  // 8. Causal claim converted/rejected when evidence does not establish causation
  it('8. rejects ungrounded causal claims disguised as direct observations', () => {
    const candidate: SynthesisResult = {
      success: true,
      answer: 'Sample answer',
      observations: [
        {
          id: 'fnd_causal_bad',
          statement: 'The token pumped because of a viral announcement on Twitter.',
          evidenceRefs: ['evi_valid_1'],
        },
      ],
      interpretations: [],
      hypotheses: [],
      unknowns: [],
      evidenceRefs: ['evi_valid_1'],
      followUpQuestions: [],
      validated: false,
      investigationId: TEST_INVESTIGATION_ID,
      createdAt: new Date().toISOString(),
    };

    const validation = validator.validate(
      candidate,
      [TEST_FIXTURE_EVIDENCE_1],
      TEST_INVESTIGATION_ID,
      TEST_TOKEN.address
    );

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.code === 'UNSUPPORTED_CAUSAL_CLAIM')).toBe(true);
  });

  // 9. Hallucinated transaction hash rejected
  it('9. rejects candidate that cites an invented transaction hash not present in evidence', () => {
    const fakeHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const candidate: SynthesisResult = {
      success: true,
      answer: 'Sample answer',
      observations: [
        {
          id: 'fnd_halluc_tx',
          statement: `Funds were drained in tx ${fakeHash}.`,
          evidenceRefs: ['evi_valid_1'],
        },
      ],
      interpretations: [],
      hypotheses: [],
      unknowns: [],
      evidenceRefs: ['evi_valid_1'],
      followUpQuestions: [],
      validated: false,
      investigationId: TEST_INVESTIGATION_ID,
      createdAt: new Date().toISOString(),
    };

    const validation = validator.validate(
      candidate,
      [TEST_FIXTURE_EVIDENCE_1],
      TEST_INVESTIGATION_ID,
      TEST_TOKEN.address
    );

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.code === 'HALLUCINATED_TRANSACTION_HASH')).toBe(true);
  });

  // 10. Hallucinated wallet address rejected
  it('10. rejects candidate referencing an invented wallet address not found in evidence', () => {
    const fakeAddress = '0x9999999999999999999999999999999999999999';
    const candidate: SynthesisResult = {
      success: true,
      answer: 'Sample answer',
      observations: [
        {
          id: 'fnd_halluc_addr',
          statement: `Whale account ${fakeAddress} sold their entire stack.`,
          evidenceRefs: ['evi_valid_1'],
        },
      ],
      interpretations: [],
      hypotheses: [],
      unknowns: [],
      evidenceRefs: ['evi_valid_1'],
      followUpQuestions: [],
      validated: false,
      investigationId: TEST_INVESTIGATION_ID,
      createdAt: new Date().toISOString(),
    };

    const validation = validator.validate(
      candidate,
      [TEST_FIXTURE_EVIDENCE_1],
      TEST_INVESTIGATION_ID,
      TEST_TOKEN.address
    );

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.code === 'HALLUCINATED_WALLET_ADDRESS')).toBe(true);
  });

  // 11. Empty evidence produces insufficient-evidence response
  it('11. returns structured insufficient evidence answer when evidence array is empty', async () => {
    const request: SynthesisRequest = {
      question: 'Why did the price crash?',
      investigationId: TEST_INVESTIGATION_ID,
      tokenContext: TEST_TOKEN,
      evidence: [], // Empty!
    };

    const result = await engine.synthesize(request);

    expect(result.success).toBe(true);
    expect(result.validated).toBe(true);
    expect(result.observations).toHaveLength(0);
    expect(result.answer).toContain("couldn't establish a reliable explanation");
    expect(result.followUpQuestions).toEqual([`Ask another question about ${TEST_TOKEN.symbol}.`]);
    expect(result.unknowns[0].reason).toContain('No on-chain evidence');
  });

  // 12. Multiple evidence references
  it('12. accepts observations and interpretations that cite multiple valid evidence items', () => {
    const candidate: SynthesisResult = {
      success: true,
      answer: 'Sample answer',
      observations: [
        {
          id: 'fnd_multi',
          statement: 'Combined analysis of cohort flows and top buyer distributions.',
          evidenceRefs: ['evi_valid_1', 'evi_valid_2'],
        },
      ],
      interpretations: [
        {
          id: 'fnd_interp_multi',
          statement: 'Both metrics confirm accumulating momentum.',
          confidence: 'high',
          evidenceRefs: ['evi_valid_1', 'evi_valid_2'],
        },
      ],
      hypotheses: [],
      unknowns: [],
      evidenceRefs: ['evi_valid_1', 'evi_valid_2'],
      followUpQuestions: [],
      validated: false,
      investigationId: TEST_INVESTIGATION_ID,
      createdAt: new Date().toISOString(),
    };

    const validation = validator.validate(
      candidate,
      [TEST_FIXTURE_EVIDENCE_1, TEST_FIXTURE_EVIDENCE_2],
      TEST_INVESTIGATION_ID,
      TEST_TOKEN.address
    );

    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  // 13. Evidence from another investigation rejected
  it('13. rejects evidence items that belong to a different investigation', () => {
    const foreignEvidence: EvidenceItem = {
      ...TEST_FIXTURE_EVIDENCE_1,
      evidenceId: 'evi_foreign_99',
      investigationId: 'inv_other_alien_case', // Wrong investigation!
    };

    const candidate: SynthesisResult = {
      success: true,
      answer: 'Sample answer',
      observations: [
        {
          id: 'fnd_cross',
          statement: 'Observation citing foreign evidence.',
          evidenceRefs: ['evi_foreign_99'],
        },
      ],
      interpretations: [],
      hypotheses: [],
      unknowns: [],
      evidenceRefs: ['evi_foreign_99'],
      followUpQuestions: [],
      validated: false,
      investigationId: TEST_INVESTIGATION_ID,
      createdAt: new Date().toISOString(),
    };

    const validation = validator.validate(
      candidate,
      [foreignEvidence],
      TEST_INVESTIGATION_ID,
      TEST_TOKEN.address
    );

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.code === 'CROSS_INVESTIGATION_EVIDENCE')).toBe(true);
  });

  // 14. Follow-up questions grounded in unresolved evidence
  it('14. produces an optional/invitational follow-up rather than a forced question', async () => {
    const request: SynthesisRequest = {
      question: 'Who is buying?',
      investigationId: TEST_INVESTIGATION_ID,
      tokenContext: TEST_TOKEN,
      evidence: [TEST_FIXTURE_EVIDENCE_2], // Evidence containing buyer data
    };

    const result = await engine.synthesize(request);

    expect(result.followUpQuestions).toHaveLength(1);
    expect(result.followUpQuestions[0]).toBe(`Ask another question about ${TEST_TOKEN.symbol}.`);
    expect(result.answer).toContain(`Ask another question about ${TEST_TOKEN.symbol}.`);
  });

  // 15. Structured output validation failure handled safely
  it('15. handles validation failure safely without accepting false claims', async () => {
    // Engine should fail validation if LLM injects an unknown evidence reference
    const badValidator = new EvidenceValidator();
    vi.spyOn(badValidator, 'validate').mockReturnValueOnce({
      isValid: false,
      errors: [
        {
          code: 'FACTUAL_CLAIM_WITHOUT_EVIDENCE',
          message: 'Simulated validation failure.',
        },
      ],
      warnings: [],
    });

    const engineWithMockValidator = new EvidenceSynthesisEngine({
      llmProvider: mockLLM,
      validator: badValidator,
    });

    const result = await engineWithMockValidator.synthesize({
      question: 'What is happening?',
      investigationId: TEST_INVESTIGATION_ID,
      tokenContext: TEST_TOKEN,
      evidence: [TEST_FIXTURE_EVIDENCE_1],
    });

    expect(result.success).toBe(false);
    expect(result.validated).toBe(false);
    expect(result.validationErrors).toContain('Simulated validation failure.');
    expect(result.answer).toContain('Synthesis Validation Failed');
  });
});

describe('Answer Quality & Synthesis Output Requirements', () => {
  const TEST_ETH_TOKEN: TokenContext = {
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    symbol: 'ETH',
    name: 'Ethereum',
    chain: 'ethereum',
    resolvedAt: '2026-09-24T12:00:00Z',
  };

  const TEST_ETH_FLOW_EVIDENCE: EvidenceItem = {
    evidenceId: 'evi_eth_flow',
    investigationId: TEST_INVESTIGATION_ID,
    title: 'Cohort Net Flows: ETHEREUM',
    epistemicStatus: 'OBSERVATION',
    summary: 'Cohort Net Flows: Fresh Wallets +$613.97M, Exchanges +$61.27M, Smart Money +$36.57M, Whales $0.',
    provenance: {
      source: 'nansen',
      endpoint: '/api/v1/tgm/flow-intelligence',
      capability: 'flow_intelligence',
      chain: 'ethereum',
      tokenAddress: TEST_ETH_TOKEN.address,
      queryParams: { token_address: TEST_ETH_TOKEN.address, chain: 'ethereum' },
      retrievedAt: '2026-09-24T12:00:00Z',
      creditsCost: 1,
    },
    normalizedData: {
      freshWalletsNetUsd: 613970000,
      exchangesNetUsd: 61270000,
      smartMoneyNetUsd: 36570000,
      whalesNetUsd: 0,
    },
    createdAt: '2026-09-24T12:00:00Z',
  };

  const TEST_ETH_METADATA_EVIDENCE: EvidenceItem = {
    evidenceId: 'evi_eth_info',
    investigationId: TEST_INVESTIGATION_ID,
    title: 'Token Spot Metadata: ETHEREUM',
    epistemicStatus: 'OBSERVATION',
    summary: 'Wrapped Ether spot price is $3,450.25 with 24h volume of $1.2B.',
    provenance: {
      source: 'nansen',
      endpoint: '/api/v1/tgm/token-information',
      capability: 'token_information',
      chain: 'ethereum',
      tokenAddress: TEST_ETH_TOKEN.address,
      queryParams: { token_address: TEST_ETH_TOKEN.address, chain: 'ethereum' },
      retrievedAt: '2026-09-24T12:00:00Z',
      creditsCost: 1,
    },
    normalizedData: {
      priceUsd: 3450.25,
      volume24hUsd: 1200000000,
    },
    createdAt: '2026-09-24T12:00:00Z',
  };

  let mockLLM: MockLLMProvider;
  let validator: EvidenceValidator;
  let engine: EvidenceSynthesisEngine;

  beforeEach(() => {
    mockLLM = new MockLLMProvider();
    validator = new EvidenceValidator();
    engine = new EvidenceSynthesisEngine({
      llmProvider: mockLLM,
      validator,
    });
  });

  // 1. "What's happening?" produces a direct answer first.
  it('1. "What\'s happening?" produces a direct answer first', async () => {
    const result = await engine.synthesize({
      question: "What's happening?",
      investigationId: TEST_INVESTIGATION_ID,
      tokenContext: TEST_ETH_TOKEN,
      evidence: [TEST_ETH_FLOW_EVIDENCE, TEST_ETH_METADATA_EVIDENCE],
    });

    expect(result.success).toBe(true);
    expect(result.answer).toContain("🔎 ETH — What's happening?");
    // Direct answer is stated upfront, right after the headline
    expect(result.answer).toContain(
      'Fresh-wallet and exchange activity are the clearest signals in the available data.'
    );
    expect(result.answer).not.toContain(
      'Observed on-chain patterns on ethereum are consistent with localized activity across participating cohorts.'
    );
  });

  // 2. Raw evidence is not dumped.
  it('2. raw evidence payload/titles are not dumped into output', async () => {
    const result = await engine.synthesize({
      question: "What's happening?",
      investigationId: TEST_INVESTIGATION_ID,
      tokenContext: TEST_ETH_TOKEN,
      evidence: [TEST_ETH_FLOW_EVIDENCE, TEST_ETH_METADATA_EVIDENCE],
    });

    // Should not dump raw evidence title headers or raw JSON
    expect(result.answer).not.toContain('Token Spot Metadata: ETHEREUM');
    expect(result.answer).not.toContain('Cohort Net Flows: ETHEREUM');
    expect(result.answer).not.toContain('provenance');
    expect(result.answer).not.toContain('endpoint');
    expect(result.answer).not.toContain('normalizedData');
    expect(result.answer).not.toContain('creditsCost');
  });

  // 3. Relevant observations are selected.
  it('3. selects relevant observations capped at maximum 3-5 bullets', async () => {
    const result = await engine.synthesize({
      question: "What's happening?",
      investigationId: TEST_INVESTIGATION_ID,
      tokenContext: TEST_ETH_TOKEN,
      evidence: [TEST_ETH_FLOW_EVIDENCE],
    });

    expect(result.observations.length).toBeGreaterThanOrEqual(3);
    expect(result.observations.length).toBeLessThanOrEqual(5);
    // Observations match relevant cohort flows
    expect(result.observations.some((o) => o.statement.includes('Fresh wallets'))).toBe(true);
    expect(result.observations.some((o) => o.statement.includes('Exchanges'))).toBe(true);
    expect(result.observations.some((o) => o.statement.includes('Smart Money'))).toBe(true);
  });

  // 4. Irrelevant token metadata is omitted.
  it('4. omits irrelevant token metadata (e.g. spot price) when not asked', async () => {
    const result = await engine.synthesize({
      question: "What's happening?",
      investigationId: TEST_INVESTIGATION_ID,
      tokenContext: TEST_ETH_TOKEN,
      evidence: [TEST_ETH_FLOW_EVIDENCE, TEST_ETH_METADATA_EVIDENCE],
    });

    // Since question is not about price and flow evidence exists, spot price is omitted
    expect(result.answer).not.toContain('Wrapped Ether spot price is');
    expect(result.answer).not.toContain('$3,450.25');
  });

  // 5. Observation and interpretation remain distinct.
  it('5. keeps observations and interpretation strictly distinct', async () => {
    const result = await engine.synthesize({
      question: "What's happening?",
      investigationId: TEST_INVESTIGATION_ID,
      tokenContext: TEST_ETH_TOKEN,
      evidence: [TEST_ETH_FLOW_EVIDENCE],
    });

    // Observations are concrete data points with evidence refs
    expect(result.observations.length).toBeGreaterThan(0);
    for (const obs of result.observations) {
      expect(obs.evidenceRefs.length).toBeGreaterThan(0);
    }

    // Interpretations explain what the data points indicate
    expect(result.interpretations.length).toBeGreaterThan(0);
    expect(result.interpretations[0].statement).toContain('points to substantial fresh-wallet inflows');
    expect(result.interpretations[0].confidence).toBeDefined();

    // Text output separates them cleanly
    const obsIndex = result.answer.indexOf('• Fresh wallets:');
    const interpIndex = result.answer.indexOf('This points to substantial fresh-wallet inflows');
    expect(obsIndex).toBeGreaterThan(-1);
    expect(interpIndex).toBeGreaterThan(obsIndex);
  });

  // 6. No unsupported causal claims.
  it('6. rejects or prevents unsupported causal claims without evidence', () => {
    const invalidCandidate: SynthesisResult = {
      success: true,
      answer: 'ETH is pumping because whales are aggressively manipulating the price.',
      observations: [
        {
          id: 'obs_bad',
          statement: 'ETH is pumping because whales are manipulating the order book.',
          evidenceRefs: ['evi_eth_flow'],
        },
      ],
      interpretations: [],
      hypotheses: [],
      unknowns: [],
      evidenceRefs: ['evi_eth_flow'],
      followUpQuestions: [],
      validated: false,
      investigationId: TEST_INVESTIGATION_ID,
      createdAt: new Date().toISOString(),
    };

    const validation = validator.validate(
      invalidCandidate,
      [TEST_ETH_FLOW_EVIDENCE],
      TEST_INVESTIGATION_ID,
      TEST_ETH_TOKEN.address
    );

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.code === 'UNSUPPORTED_CAUSAL_CLAIM')).toBe(true);
  });

  // 7. No hallucinated values.
  it('7. rejects hallucinated wallet addresses or transaction hashes', () => {
    const hallucinatedCandidate: SynthesisResult = {
      success: true,
      answer: 'Found movement from wallet 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      observations: [
        {
          id: 'obs_hal',
          statement: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef deposited $50M',
          evidenceRefs: ['evi_eth_flow'],
        },
      ],
      interpretations: [],
      hypotheses: [],
      unknowns: [],
      evidenceRefs: ['evi_eth_flow'],
      followUpQuestions: [],
      validated: false,
      investigationId: TEST_INVESTIGATION_ID,
      createdAt: new Date().toISOString(),
    };

    const validation = validator.validate(
      hallucinatedCandidate,
      [TEST_ETH_FLOW_EVIDENCE],
      TEST_INVESTIGATION_ID,
      TEST_ETH_TOKEN.address
    );

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.code === 'HALLUCINATED_WALLET_ADDRESS')).toBe(true);
  });

  // 8. Answer remains concise.
  it('8. ensures answer remains concise and within Telegram message budget', async () => {
    const result = await engine.synthesize({
      question: "What's happening?",
      investigationId: TEST_INVESTIGATION_ID,
      tokenContext: TEST_ETH_TOKEN,
      evidence: [TEST_ETH_FLOW_EVIDENCE, TEST_ETH_METADATA_EVIDENCE],
    });

    const wordCount = result.answer.trim().split(/\s+/).length;
    expect(wordCount).toBeLessThan(300);
    expect(wordCount).toBeGreaterThan(25);
  });

  // 9. Follow-up is optional/invitational rather than a question requiring action.
  it('9. provides optional/invitational follow-up rather than demanding a question response', async () => {
    const result = await engine.synthesize({
      question: "What's happening?",
      investigationId: TEST_INVESTIGATION_ID,
      tokenContext: TEST_ETH_TOKEN,
      evidence: [TEST_ETH_FLOW_EVIDENCE],
    });

    expect(result.followUpQuestions).toEqual(['Ask another question about ETH.']);
    expect(result.answer).toContain('Ask another question about ETH.');
    expect(result.answer).not.toContain('Would you like to');
    expect(result.answer).not.toContain('Should we inspect');
  });

  // 10. Existing evidence validation still passes.
  it('10. passes evidence validation when observations strictly cite verified evidence items', async () => {
    const result = await engine.synthesize({
      question: "What's happening?",
      investigationId: TEST_INVESTIGATION_ID,
      tokenContext: TEST_ETH_TOKEN,
      evidence: [TEST_ETH_FLOW_EVIDENCE],
    });

    expect(result.success).toBe(true);
    expect(result.validated).toBe(true);
    expect(result.validationErrors).toBeUndefined();
  });
});
