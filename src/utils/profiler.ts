/**
 * PROBE Investigation Profiler
 * Lightweight, non-invasive latency and performance instrumentation.
 * Measures each stage of the investigation pipeline from Telegram receive to send.
 */

export interface StageRecord {
  name: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  meta?: Record<string, unknown>;
}

export interface NansenCallRecord {
  capability: string;
  endpoint: string;
  durationMs: number;
  cacheHit: boolean;
  status?: number;
}

export interface LlmCallRecord {
  provider: string;
  durationMs: number;
  model?: string;
  usage?: {
    promptTokens?: number;
    candidateTokens?: number;
    thoughtTokens?: number;
    totalTokens?: number;
  };
}

export interface ProfilerReport {
  totalDurationMs: number;
  stages: Record<string, StageRecord>;
  nansenCalls: NansenCallRecord[];
  llmCalls: LlmCallRecord[];
  totalNansenDurationMs: number;
  totalLlmDurationMs: number;
  evidenceExecutionMode: 'sequential' | 'parallel';
  canRunInParallel: boolean;
}

export class InvestigationProfiler {
  private requestStartTime = 0;
  private requestEndTime = 0;
  private stages: Map<string, StageRecord> = new Map();
  private stageAccumulators: Map<string, { durationMs: number; count: number; firstStart: number; lastEnd: number }> = new Map();
  private nansenCalls: NansenCallRecord[] = [];
  private llmCalls: LlmCallRecord[] = [];
  private evidenceMode: 'sequential' | 'parallel' = 'sequential';

  public reset(): void {
    this.requestStartTime = Date.now();
    this.requestEndTime = 0;
    this.stages.clear();
    this.stageAccumulators.clear();
    this.nansenCalls = [];
    this.llmCalls = [];
    this.evidenceMode = 'sequential';
  }

  public startRequest(): void {
    this.reset();
  }

  public endRequest(): void {
    this.requestEndTime = Date.now();
  }

  public recordStage(name: string, startTime: number, endTime: number, meta?: Record<string, unknown>): void {
    if (!this.requestStartTime) {
      this.requestStartTime = startTime;
    }
    this.stages.set(name, {
      name,
      startTime,
      endTime,
      durationMs: Math.max(0, endTime - startTime),
      meta,
    });
  }

  public accumulateStage(name: string, startTime: number, endTime: number, meta?: Record<string, unknown>): void {
    const duration = Math.max(0, endTime - startTime);
    const existing = this.stageAccumulators.get(name);
    if (existing) {
      existing.durationMs += duration;
      existing.count += 1;
      existing.lastEnd = Math.max(existing.lastEnd, endTime);
    } else {
      this.stageAccumulators.set(name, {
        durationMs: duration,
        count: 1,
        firstStart: startTime,
        lastEnd: endTime,
      });
    }

    const current = this.stageAccumulators.get(name)!;
    this.stages.set(name, {
      name,
      startTime: current.firstStart,
      endTime: current.lastEnd,
      durationMs: current.durationMs,
      meta: { ...meta, invocations: current.count },
    });
  }

  public recordNansenCall(call: NansenCallRecord): void {
    this.nansenCalls.push(call);
  }

  public recordLlmCall(call: LlmCallRecord): void {
    this.llmCalls.push(call);
  }

  public setEvidenceMode(mode: 'sequential' | 'parallel'): void {
    this.evidenceMode = mode;
  }

  public getReport(): ProfilerReport {
    const end = this.requestEndTime || Date.now();
    const totalDuration = this.requestStartTime ? Math.max(0, end - this.requestStartTime) : 0;

    const stagesObj: Record<string, StageRecord> = {};
    for (const [k, v] of this.stages.entries()) {
      stagesObj[k] = { ...v };
    }

    const totalNansen = this.nansenCalls.reduce((acc, c) => acc + c.durationMs, 0);
    const totalLlm = this.llmCalls.reduce((acc, c) => acc + c.durationMs, 0);

    return {
      totalDurationMs: totalDuration,
      stages: stagesObj,
      nansenCalls: [...this.nansenCalls],
      llmCalls: [...this.llmCalls],
      totalNansenDurationMs: totalNansen,
      totalLlmDurationMs: totalLlm,
      evidenceExecutionMode: this.evidenceMode,
      canRunInParallel: true, // Independent token requirements have no inter-dependencies
    };
  }
}

export const profiler = new InvestigationProfiler();
