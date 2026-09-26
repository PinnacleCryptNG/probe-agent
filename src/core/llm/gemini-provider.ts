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

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Production Gemini LLM Provider connecting PROBE's planning and synthesis
 * to Google Gemini models using native HTTP fetch without external SDK overhead.
 */
export class GeminiLLMProvider implements ILLMProvider {
  public readonly providerName = 'gemini';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fallbackProvider: MockLLMProvider;

  constructor(options: GeminiProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || '';
    this.model = options.model || 'gemini-3.6-flash';
    this.baseUrl = options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.fallbackProvider = new MockLLMProvider();
  }

  public async planInvestigation(request: LLMPlanningRequest): Promise<LLMPlanningResponse> {
    if (!this.apiKey) {
      logger.warn('No Gemini API key configured; falling back to deterministic planning');
      return this.fallbackProvider.planInvestigation(request);
    }

    const prompt = `You are the investigation planner for PROBE, an on-chain cryptocurrency forensics agent.
Your job is to select the most relevant Nansen capabilities to investigate the user's question about ${request.tokenContext.symbol} (${request.tokenContext.chain}).
You have a hard maximum limit of ${request.maxCallsAllowed} capability calls allowed in this turn.
Do NOT exceed ${request.maxCallsAllowed} capabilities.

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

User question: "${request.userQuestion}"
${
  request.conversationHistory.length > 0
    ? `Prior conversation:\n${request.conversationHistory.map((m) => `${m.role}: ${m.content}`).join('\n')}`
    : ''
}

Respond ONLY with a valid JSON object matching this schema:
{
  "category": "ACCUMULATION_INSPECTION" | "HOLDER_CONCENTRATION" | "ACTIVITY_CHANGE" | "LARGE_TRANSACTIONS" | "GENERAL_INQUIRY",
  "summary": "One concise sentence describing the investigation goal",
  "confidence": 0.95,
  "selectedCapabilities": [
    {
      "capabilityName": "exact_name_from_available_capabilities",
      "reason": "why this capability is needed",
      "parameters": {
        "token_address": "${request.tokenContext.address}",
        "chain": "${request.tokenContext.chain}"
      }
    }
  ],
  "reasoningSummary": "One concise sentence explaining the capability selection"
}`;

    try {
      const responseText = await this.callGemini(prompt, true);
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
      logger.warn('Gemini planning call failed; falling back to deterministic planning', {
        error: String(err),
      });
    }

    return this.fallbackProvider.planInvestigation(request);
  }

  public async synthesizeAnswer(request: LLMSynthesisRequest): Promise<LLMSynthesisResponse> {
    if (!this.apiKey || request.evidence.length === 0) {
      return this.fallbackProvider.synthesizeAnswer(request);
    }

    const evidenceSummary = request.evidence
      .map(
        (e) =>
          `[${e.evidenceId}] (${e.provenance.capability}): ${e.title} — ${e.summary}\nNormalized Data: ${JSON.stringify(e.normalizedData)}`
      )
      .join('\n\n');

    const prompt = `You are the lead on-chain cryptocurrency forensics investigator for PROBE.
PROBE is an investigation agent, not a database viewer.

Your job is to answer the user's question directly using retrieved on-chain evidence.
User question: "${request.userQuestion}"
Target token: ${request.tokenContext.name} (${request.tokenContext.symbol}) on ${request.tokenContext.chain}.

Retrieved on-chain evidence:
${evidenceSummary}

${
  request.conversationHistory.length > 0
    ? `Prior conversation:\n${request.conversationHistory.map((m) => `${m.role}: ${m.content}`).join('\n')}`
    : ''
}

ANSWER PRINCIPLES & STRUCTURE:
1. HEADLINE / DIRECT ANSWER FIRST:
   - 1-2 sentences answering the question directly.
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
4. EVIDENCE CATEGORIES:
   - Short list of 2–4 human-readable categories/references (e.g. "Cohort net flows", "Top buyer/seller data", "${request.tokenContext.symbol}/WETH token metrics").
5. CONCISE: Total response should be approximately 150–250 words. Do NOT dump raw API objects.

Respond ONLY with a valid JSON object matching this schema:
{
  "headline": "1-2 sentence direct answer to the user's question",
  "observations": [
    {
      "claim": "Clean formatted metric observation",
      "evidenceId": "exact_evidence_id_from_above"
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

    try {
      const responseText = await this.callGemini(prompt, true);
      const parsed = JSON.parse(responseText);

      if (parsed && (parsed.headline || parsed.conclusion || parsed.observations)) {
        const headline = String(parsed.headline || parsed.conclusion || `On-chain evidence for ${request.tokenContext.symbol} reveals active participant flows.`);
        const interpretation = String(parsed.interpretation || (Array.isArray(parsed.interpretations) ? parsed.interpretations[0]?.claim : '') || '');
        const evidenceCategories = Array.isArray(parsed.evidenceCategories) ? parsed.evidenceCategories.map(String) : [];

        const findings: any[] = [];

        // Map observations
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

        // Map interpretation finding
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

        // Build markdown answer
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
      logger.warn('Gemini synthesis call failed; falling back to deterministic synthesis', {
        error: String(err),
      });
    }

    return this.fallbackProvider.synthesizeAnswer(request);
  }

  public async evaluateChallenge(request: LLMChallengeRequest): Promise<LLMChallengeResponse> {
    if (!this.apiKey) {
      return this.fallbackProvider.evaluateChallenge(request);
    }

    const prompt = `You are evaluating a challenge to an on-chain investigation finding.
Challenge: "${request.userChallenge}"
Current findings:
${request.currentFindings.map((f) => `- [${f.status}] ${f.claim}`).join('\n')}

Evidence available:
${request.availableEvidence.map((e) => `- ${e.title}: ${e.summary}`).join('\n')}

Respond ONLY with a valid JSON object matching:
{
  "evaluationMarkdown": "Detailed objective evaluation of whether the challenge has merit given the on-chain evidence",
  "concededPoints": ["Point 1 if any"],
  "counterEvidencePoints": ["Evidence that refutes challenge"]
}`;

    try {
      const responseText = await this.callGemini(prompt, true);
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

  private async callGemini(prompt: string, expectJson = false): Promise<string> {
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            ...(expectJson ? { responseMimeType: 'application/json' } : {}),
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errorBody = '';
        try {
          errorBody = await res.text();
        } catch {
          errorBody = 'Unable to read error body';
        }

        const errorType =
          res.status === 429
            ? 'RATE_LIMIT'
            : res.status === 503
            ? 'SERVICE_UNAVAILABLE'
            : res.status === 404
            ? 'MODEL_NOT_FOUND'
            : 'API_ERROR';

        logger.error('Gemini API call failed', {
          provider: 'gemini',
          status: res.status,
          model: this.model,
          errorType,
          sanitizedBody: errorBody.slice(0, 300),
        });

        throw new Error(`Gemini HTTP ${res.status} (${errorType}): ${errorBody.slice(0, 200)}`);
      }

      const json = (await res.json()) as any;
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini returned empty response content');
      }

      logger.info('Gemini API call succeeded', {
        provider: 'gemini',
        model: this.model,
      });

      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}
