import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GeminiLLMProvider,
  SYNTHESIS_RESPONSE_SCHEMA,
} from '../../../src/core/llm/gemini-provider.js';
import { LLMPlanningRequest, LLMSynthesisRequest } from '../../../src/core/llm/types.js';
import { compactNormalizedData } from '../../../src/core/synthesis/prompts.js';
import { EvidenceItem } from '../../../src/types/evidence.js';

describe('GeminiLLMProvider Latency & Schema Optimization', () => {
  const originalFetch = global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;
  let provider: GeminiLLMProvider;

  const mockEvidence: EvidenceItem[] = [
    {
      evidenceId: 'evi_flow_123',
      investigationId: 'inv_test_1',
      title: 'Cohort Net Flows: ETHEREUM',
      epistemicStatus: 'OBSERVATION',
      summary: 'Fresh wallets net +$613.97M, Exchanges net +$61.27M',
      provenance: {
        capability: 'flow_intelligence',
        chain: 'ethereum',
        tokenAddress: '0x123',
        fetchedAt: new Date().toISOString(),
        queryParams: {},
      },
      normalizedData: {
        freshWalletsNetUsd: 613970000,
        exchangesNetUsd: 61270000,
        smartMoneyNetUsd: 36570000,
        whalesNetUsd: 0,
        rawRecord: { redundant_huge_payload: true },
      },
      rawResponseHash: 'hash123',
      createdAt: new Date().toISOString(),
    },
  ];

  const synthesisRequest: LLMSynthesisRequest = {
    tokenContext: {
      address: '0x123',
      chain: 'ethereum',
      symbol: 'ETH',
      name: 'Ethereum',
    },
    userQuestion: 'Why is ETH moving?',
    evidence: mockEvidence,
    conversationHistory: [],
  };

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    provider = new GeminiLLMProvider({
      apiKey: 'test-api-key',
      model: 'gemini-3.6-flash',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('1. configures thinkingConfig with thinkingLevel: "low"', async () => {
    const mockJson = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  headline: 'ETH is experiencing strong inflows.',
                  observations: [
                    { claim: 'Fresh wallets: +$613.97M net flow', evidenceId: 'evi_flow_123' },
                  ],
                  interpretation: 'New wallet creation accounts for the net volume.',
                  evidenceCategories: ['Cohort net flows'],
                }),
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 150,
        candidatesTokenCount: 80,
        thoughtsTokenCount: 50,
        totalTokenCount: 280,
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockJson,
      text: async () => JSON.stringify(mockJson),
    });

    await provider.synthesizeAnswer(synthesisRequest);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, requestInit] = mockFetch.mock.calls[0];
    const body = JSON.parse(requestInit.body);

    expect(body.generationConfig).toBeDefined();
    expect(body.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: 'low',
    });
  });

  it('2. sets maxOutputTokens to 600', async () => {
    const mockJson = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  headline: 'Headline text',
                  observations: [{ claim: 'Claim 1', evidenceId: 'evi_flow_123' }],
                  interpretation: 'Interp text',
                  evidenceCategories: ['Cat 1'],
                }),
              },
            ],
          },
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockJson,
    });

    await provider.synthesizeAnswer(synthesisRequest);

    const [, requestInit] = mockFetch.mock.calls[0];
    const body = JSON.parse(requestInit.body);

    expect(body.generationConfig.maxOutputTokens).toBe(600);
  });

  it('3. passes native responseSchema matching PROBE synthesis specification', async () => {
    const mockJson = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  headline: 'Headline text',
                  observations: [{ claim: 'Claim 1', evidenceId: 'evi_flow_123' }],
                  interpretation: 'Interp text',
                  evidenceCategories: ['Cat 1'],
                }),
              },
            ],
          },
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockJson,
    });

    await provider.synthesizeAnswer(synthesisRequest);

    const [, requestInit] = mockFetch.mock.calls[0];
    const body = JSON.parse(requestInit.body);

    expect(body.generationConfig.responseSchema).toEqual(SYNTHESIS_RESPONSE_SCHEMA);
    expect(SYNTHESIS_RESPONSE_SCHEMA.type).toBe('OBJECT');
    expect((SYNTHESIS_RESPONSE_SCHEMA as any).required).toContain('headline');
    expect((SYNTHESIS_RESPONSE_SCHEMA as any).required).toContain('observations');
    expect((SYNTHESIS_RESPONSE_SCHEMA as any).required).toContain('interpretation');
    expect((SYNTHESIS_RESPONSE_SCHEMA as any).required).toContain('evidenceCategories');
  });

  it('4. correctly parses valid structured output and extracts usage metadata', async () => {
    const mockJson = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  headline: 'Fresh wallet inflows are the primary driver of ETH activity.',
                  observations: [
                    {
                      claim: 'Fresh wallets recorded +$613.97M net flow',
                      evidenceId: 'evi_flow_123',
                    },
                  ],
                  interpretation: 'Capital is entering via newly initialized addresses.',
                  evidenceCategories: ['Cohort net flows'],
                  hypotheses: [
                    { statement: 'Inflows may represent new institutional sub-accounts.' },
                  ],
                }),
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 350,
        candidatesTokenCount: 120,
        thoughtsTokenCount: 45,
        totalTokenCount: 515,
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockJson,
    });

    const result = await provider.synthesizeAnswer(synthesisRequest);

    expect(result.headline).toBe('Fresh wallet inflows are the primary driver of ETH activity.');
    expect(result.interpretation).toBe('Capital is entering via newly initialized addresses.');
    expect(result.evidenceCategories).toEqual(['Cohort net flows']);
    expect(result.findings).toHaveLength(2); // 1 observation + 1 interpretation finding
    expect(result.findings[0].status).toBe('OBSERVATION');
    expect(result.findings[0].evidenceReferences[0].evidenceId).toBe('evi_flow_123');
    expect(result.hypotheses).toHaveLength(1);
    expect(result.hypotheses[0].statement).toBe(
      'Inflows may represent new institutional sub-accounts.'
    );
    expect(result.usage).toEqual({
      promptTokens: 350,
      candidateTokens: 120,
      thoughtTokens: 45,
      totalTokens: 515,
    });
  });

  it('5. gracefully falls back to deterministic synthesis when LLM returns malformed output', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'NOT VALID JSON {{{' }],
            },
          },
        ],
      }),
    });

    const result = await provider.synthesizeAnswer(synthesisRequest);

    expect(result).toBeDefined();
    expect(result.answerMarkdown).toContain('ETH');
    // Fallback deterministic synthesis was invoked cleanly
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('6. compactNormalizedData eliminates redundant nested payloads while keeping necessary metrics', () => {
    const rawFlowData = {
      smartMoneyNetUsd: 1000000,
      topPnlNetUsd: 500000,
      whalesNetUsd: 2000000,
      freshWalletsNetUsd: 3000000,
      exchangesNetUsd: -4000000,
      publicFigureNetUsd: 0,
      rawRecord: {
        massive_duplicate_tree: Array.from({ length: 50 }, (_, i) => ({ id: i })),
      },
    };

    const compacted = compactNormalizedData(rawFlowData, 'flow_intelligence');

    expect(compacted.smartMoneyNetUsd).toBe(1000000);
    expect(compacted.freshWalletsNetUsd).toBe(3000000);
    expect(compacted.exchangesNetUsd).toBe(-4000000);
    expect((compacted as any).rawRecord).toBeUndefined();
  });

  it('7. planInvestigation also configures thinkingLevel: "low" and maxOutputTokens: 600', async () => {
    const mockJson = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  category: 'ACTIVITY_CHANGE',
                  summary: 'Analyze ETH activity changes',
                  confidence: 0.95,
                  selectedCapabilities: [
                    {
                      capabilityName: 'flow_intelligence',
                      reason: 'Inspect cohort flow variance',
                    },
                  ],
                  reasoningSummary: 'Selected flow_intelligence',
                }),
              },
            ],
          },
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockJson,
    });

    const planRequest: LLMPlanningRequest = {
      tokenContext: { address: '0x123', chain: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
      userQuestion: 'What changed?',
      availableCapabilities: [
        {
          name: 'flow_intelligence',
          description: 'Cohort flows',
          creditCost: 1,
          supportedChains: 'ALL',
        },
      ],
      conversationHistory: [],
      maxCallsAllowed: 2,
      remainingCredits: 10,
    };

    await provider.planInvestigation(planRequest);

    const [, requestInit] = mockFetch.mock.calls[0];
    const body = JSON.parse(requestInit.body);

    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('low');
    expect(body.generationConfig.maxOutputTokens).toBe(600);
  });
});
