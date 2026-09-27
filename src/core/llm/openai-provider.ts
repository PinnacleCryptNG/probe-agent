import { generateId } from '../../utils/ids.js';
import { logger } from '../../utils/logger.js';
import { ILLMProvider, MockLLMProvider } from './interface.js';
import {
  LLMChallengeRequest,
  LLMChallengeResponse,
  LLMPlanningRequest,
  LLMPlanningResponse,
  LLMSynthesisRequest,
  LLMSynthesisResponse,
} from './types.js';

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Production OpenAI LLM Provider connecting PROBE's planning and synthesis
 * to OpenAI models using native HTTP fetch.
 */
export class OpenAILLMProvider implements ILLMProvider {
  public readonly providerName = 'openai';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fallbackProvider: MockLLMProvider;

  constructor(options: OpenAIProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
    this.model = options.model || 'gpt-4o-mini';
    this.baseUrl = options.baseUrl || 'https://api.openai.com/v1';
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fallbackProvider = new MockLLMProvider();
  }

  public async planInvestigation(request: LLMPlanningRequest): Promise<LLMPlanningResponse> {
    if (!this.apiKey) {
      logger.warn('No OpenAI API key configured; falling back to deterministic planning');
      return this.fallbackProvider.planInvestigation(request);
    }

    const systemPrompt = `You are the investigation planner for PROBE, an on-chain cryptocurrency forensics agent.
Select the most relevant Nansen capabilities to investigate the user's question about ${request.tokenContext.symbol} (${request.tokenContext.chain}).
Max capabilities allowed: ${request.maxCallsAllowed}.
Respond ONLY in valid JSON matching this schema:
{
  "category": "ACCUMULATION_INSPECTION" | "HOLDER_CONCENTRATION" | "ACTIVITY_CHANGE" | "LARGE_TRANSACTIONS" | "GENERAL_INQUIRY",
  "summary": "One sentence describing investigation goal",
  "confidence": 0.95,
  "selectedCapabilities": [
    {
      "capabilityName": "exact_name",
      "reason": "why needed",
      "parameters": {
        "token_address": "${request.tokenContext.address}",
        "chain": "${request.tokenContext.chain}"
      }
    }
  ],
  "reasoningSummary": "One sentence explaining selection"
}`;

    const userPrompt = `User question: "${request.userQuestion}"
Available capabilities:
${JSON.stringify(
  request.availableCapabilities.map((c) => ({
    name: c.name,
    description: c.description,
    creditCost: c.creditCost,
    supportedChains: c.supportedChains,
  })),
  null,
  2
)}
${
  request.conversationHistory.length > 0
    ? `Prior messages:\n${request.conversationHistory.map((m) => `${m.role}: ${m.content}`).join('\n')}`
    : ''
}`;

    try {
      const responseText = await this.callOpenAI(systemPrompt, userPrompt, true);
      const parsed = JSON.parse(responseText);

      if (parsed && Array.isArray(parsed.selectedCapabilities) && parsed.selectedCapabilities.length > 0) {
        const sliced = parsed.selectedCapabilities.slice(0, request.maxCallsAllowed);
        const evidenceRequirements = sliced.map((c: any, index: number) => ({
          id: generateId('req'),
          capabilityName: String(c.capabilityName),
          reason: String(c.reason || 'Investigate target activity'),
          parameters: c.parameters || {
            token_address: request.tokenContext.address,
            chain: request.tokenContext.chain,
          },
          priority: index + 1,
          estimatedCost: 1,
        }));

        return {
          intent: {
            category: parsed.category || 'GENERAL_INQUIRY',
            summary: parsed.summary || `Analyze ${request.tokenContext.symbol}: ${request.userQuestion}`,
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
          },
          evidenceRequirements,
          reasoningSummary: parsed.reasoningSummary || `Selected ${evidenceRequirements.length} capability/capabilities.`,
        };
      }
    } catch (err) {
      logger.warn('OpenAI planning call failed; falling back to deterministic planning', {
        error: String(err),
      });
    }

    return this.fallbackProvider.planInvestigation(request);
  }

  public async synthesizeAnswer(request: LLMSynthesisRequest): Promise<LLMSynthesisResponse> {
    if (!this.apiKey || request.evidence.length === 0) {
      return this.fallbackProvider.synthesizeAnswer(request);
    }

    const systemPrompt = `You are the lead on-chain cryptocurrency forensics investigator for PROBE.
PROBE is an investigation agent, not a database viewer.

ANSWER PRINCIPLES & STRUCTURE:
1. HEADLINE / DIRECT ANSWER FIRST:
   - 1-2 sentences answering the user's question directly.
   - Do NOT lead with generic spot price/market cap unless the user specifically asked about price.
   - Do NOT use vague boilerplate like "localized activity across participating cohorts".
2. KEY OBSERVATIONS (Maximum 3–5 bullets):
   - Only include the most relevant observations for the user's question.
   - Prioritize cohort net flows (Fresh Wallets, Exchanges, Smart Money / Top PnL, Whales), top buyers/sellers, and unusual activity.
   - Format each observation cleanly with verified metrics (e.g. "Fresh wallets: +$613.97M net flow", "Exchanges: +$61.27M", "Smart Money / Top PnL: +$36.57M", "Whales: $0").
   - Every observation MUST cite the exact "evidenceId" it was derived from.
3. INTERPRETATION:
   - One short paragraph explaining what the observations indicate.
   - Epistemic clarity: clearly distinguish observation from interpretation.
   - NEVER invent causality (e.g. do NOT say "ETH pumped because whales accumulated").
   - If off-chain intent is unknown, state that the data shows flows but cannot establish motives.
   - CRITICAL EPISTEMIC RULE: Absence of data or 0 holdings must NEVER automatically become a causal explanation.
     Do NOT claim "this indicates the wallet liquidated its positions", "this means assets were transferred elsewhere", or "the wallet functions as an intermediary".
     Allowed: "Current balance data returned no token positions."
     Explicitly state what cannot be established: "PROBE could not establish why this wallet currently has no token positions from the available evidence."
4. EVIDENCE CATEGORIES:
   - Short list of 2–4 human-readable categories/references (e.g. "Cohort net flows", "Top buyer/seller data", "${request.tokenContext.symbol}/WETH token metrics").
5. CONCISE: Total response should be approximately 150–250 words. Do NOT dump raw API objects.

Respond ONLY with a valid JSON object matching:
{
  "headline": "1-2 sentence direct answer to the user's question",
  "observations": [
    {
      "claim": "Clean formatted metric observation",
      "evidenceId": "exact_evidence_id"
    }
  ],
  "interpretation": "One short paragraph explaining what the observations indicate",
  "evidenceCategories": [
    "Cohort net flows",
    "Top buyer/seller data"
  ],
  "hypotheses": [
    {
      "statement": "Forward-looking condition or hypothesis"
    }
  ]
}`;

    const userPrompt = `User question: "${request.userQuestion}"
Token: ${request.tokenContext.name} (${request.tokenContext.symbol}) on ${request.tokenContext.chain}.

Retrieved evidence:
${request.evidence
  .map((e) => `[${e.evidenceId}] (${e.provenance.capability}): ${e.title} — ${e.summary}\nNormalized Data: ${JSON.stringify(e.normalizedData)}`)
  .join('\n\n')}
${
  request.conversationHistory.length > 0
    ? `Prior conversation:\n${request.conversationHistory.map((m) => `${m.role}: ${m.content}`).join('\n')}`
    : ''
}`;

    try {
      const responseText = await this.callOpenAI(systemPrompt, userPrompt, true);
      const parsed = JSON.parse(responseText);

      if (parsed && (parsed.headline || parsed.conclusion || parsed.observations)) {
        const headline = String(parsed.headline || parsed.conclusion || `On-chain evidence for ${request.tokenContext.symbol} reveals active participant flows.`);
        const interpretation = String(parsed.interpretation || (Array.isArray(parsed.interpretations) ? parsed.interpretations[0]?.claim : '') || '');
        const evidenceCategories = Array.isArray(parsed.evidenceCategories) ? parsed.evidenceCategories.map(String) : [];

        const findings: any[] = [];

        if (Array.isArray(parsed.observations)) {
          for (const obs of parsed.observations.slice(0, 5)) {
            const evRef = request.evidence.find((e) => e.evidenceId === obs.evidenceId) || request.evidence[0];
            findings.push({
              id: generateId('fnd'),
              claim: String(obs.claim),
              status: 'OBSERVATION',
              evidenceReferences: [
                {
                  evidenceId: evRef.evidenceId,
                  excerptOrMetric: String(obs.claim),
                },
              ],
              confidence: 1.0,
            });
          }
        }

        if (interpretation) {
          findings.push({
            id: generateId('fnd'),
            claim: interpretation,
            status: 'INTERPRETATION',
            evidenceReferences: request.evidence.map((e) => ({
              evidenceId: e.evidenceId,
              excerptOrMetric: interpretation,
            })),
            confidence: 0.85,
          });
        }

        const answerLines: string[] = [];
        answerLines.push(headline);
        if (findings.filter((f) => f.status === 'OBSERVATION').length > 0) {
          answerLines.push('');
          for (const obs of findings.filter((f) => f.status === 'OBSERVATION')) {
            answerLines.push(`• ${obs.claim}`);
          }
        }
        if (interpretation) {
          answerLines.push('');
          answerLines.push(interpretation);
        }
        if (evidenceCategories.length > 0) {
          answerLines.push('');
          answerLines.push('Evidence');
          for (const cat of evidenceCategories) {
            answerLines.push(`• ${cat}`);
          }
        }
        answerLines.push('');
        answerLines.push(`Ask another question about ${request.tokenContext.symbol}.`);

        return {
          answerMarkdown: answerLines.join('\n'),
          headline,
          interpretation,
          evidenceCategories,
          findings,
          hypotheses: Array.isArray(parsed.hypotheses)
            ? parsed.hypotheses.map((h: any) => ({
                id: generateId('hyp'),
                statement: String(h.statement),
                supportingFindingIds: findings.map((f) => f.id),
                counterFindingIds: [],
                confidence: 0.75,
              }))
            : [],
          openQuestions: [`Ask another question about ${request.tokenContext.symbol}.`],
        };
      }
    } catch (err) {
      logger.warn('OpenAI synthesis call failed; falling back to deterministic synthesis', {
        error: String(err),
      });
    }

    return this.fallbackProvider.synthesizeAnswer(request);
  }

  public async evaluateChallenge(request: LLMChallengeRequest): Promise<LLMChallengeResponse> {
    if (!this.apiKey) {
      return this.fallbackProvider.evaluateChallenge(request);
    }

    const systemPrompt = `Evaluate this challenge to an on-chain investigation finding. Respond in valid JSON with fields: evaluationMarkdown, concededPoints, counterEvidencePoints.`;
    const userPrompt = `Challenge: "${request.userChallenge}"
Current findings: ${JSON.stringify(request.currentFindings.map((f) => f.claim))}
Evidence: ${JSON.stringify(request.availableEvidence.map((e) => e.summary))}`;

    try {
      const responseText = await this.callOpenAI(systemPrompt, userPrompt, true);
      const parsed = JSON.parse(responseText);

      return {
        evaluationMarkdown: parsed.evaluationMarkdown || 'Challenge evaluated against available on-chain evidence.',
        concededPoints: Array.isArray(parsed.concededPoints) ? parsed.concededPoints : [],
        counterEvidencePoints: Array.isArray(parsed.counterEvidencePoints) ? parsed.counterEvidencePoints : [],
        updatedFindings: request.currentFindings,
      };
    } catch {
      return this.fallbackProvider.evaluateChallenge(request);
    }
  }

  private async callOpenAI(systemPrompt: string, userPrompt: string, expectJson = false): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          ...(expectJson ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`OpenAI HTTP ${res.status}: ${errorBody.slice(0, 200)}`);
      }

      const json = (await res.json()) as any;
      const text = json.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('OpenAI returned empty message content');
      }

      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}
