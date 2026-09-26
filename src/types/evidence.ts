import { z } from 'zod';

/**
 * Epistemic distinction required by PROBE:
 * - OBSERVATION: Directly supported by retrieved on-chain data.
 * - INTERPRETATION: A reasonable analytical inference drawn from observations.
 * - HYPOTHESIS: A possible explanation or theory not definitively proven by available evidence.
 * - UNKNOWN: A critical dimension or question that current data cannot establish.
 */
export const EpistemicStatusSchema = z.enum([
  'OBSERVATION',
  'INTERPRETATION',
  'HYPOTHESIS',
  'UNKNOWN'
]);

export type EpistemicStatus = z.infer<typeof EpistemicStatusSchema>;

/**
 * Full provenance record preserving context for every piece of retrieved data.
 */
export const EvidenceProvenanceSchema = z.object({
  source: z.literal('nansen'),
  endpoint: z.string(),
  capability: z.string(),
  chain: z.string(),
  tokenAddress: z.string(),
  timeRange: z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .optional(),
  queryParams: z.record(z.string(), z.unknown()),
  retrievedAt: z.string().datetime(),
  relevantWallet: z.string().optional(),
  transactionHash: z.string().optional(),
  creditsCost: z.number().int().nonnegative().optional(),
});

export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;

/**
 * Normalized evidence item in PROBE.
 */
export const EvidenceItemSchema = z.object({
  evidenceId: z.string(),
  investigationId: z.string(),
  title: z.string(),
  epistemicStatus: EpistemicStatusSchema,
  summary: z.string(),
  provenance: EvidenceProvenanceSchema,
  normalizedData: z.record(z.string(), z.unknown()),
  rawResponseHash: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/**
 * Reference linking a finding or hypothesis back to specific evidence items.
 */
export const EvidenceReferenceSchema = z.object({
  evidenceId: z.string(),
  excerptOrMetric: z.string(),
  interpretation: z.string().optional(),
});

export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;
