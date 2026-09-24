import type { AnalysisPlan, ColumnProfile, DatasetSchema } from '../types';

export interface PlanInput {
  question: string;
  schema: DatasetSchema;
  profiles: ColumnProfile[];
  sampleRows: Record<string, unknown>[];
  history: string[];
}

/** Every planner implements this. The orchestrator depends only on the interface. */
export interface LlmProvider {
  readonly name: string;
  plan(input: PlanInput): Promise<AnalysisPlan>;
}
