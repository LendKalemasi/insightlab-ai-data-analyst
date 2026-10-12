import 'server-only';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { AppError } from '../errors';
import { appendTurn, listTurns } from '../store/analyses';
import { openDataset } from '../store/datasets';
import type { AnalysisEvent, AnalysisTurn, TraceEvent } from '../types';
import { compute } from './compute';
import { crossCheck } from './crosscheck';
import { checkGrounding } from './grounding';
import { guardSpec } from './guard';
import { planWithLlm } from './llm-planner';
import { narrate } from './narrator';
import { planWithRules } from './rules-planner';
import type { Plan } from './spec';

/**
 * question → plan → guard → compute (SQL + statistics) → cross-check → narrative.
 *
 * Only the plan and the narrative involve the language model. Results are
 * always computed by code; if the narrative fails, the computed answer is
 * still returned and the failure is shown, never hidden behind fake text.
 */
export async function runAnalysis(datasetId: string, question: string, emit: (e: AnalysisEvent) => void, signal?: AbortSignal): Promise<AnalysisTurn> {
  const started = Date.now();
  const { info, db } = openDataset(datasetId);
  const history = listTurns(datasetId);
  const trace: TraceEvent[] = [];
  const useLlm = config.llm.provider === 'anthropic';
  const turn: AnalysisTurn = {
    id: `an_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    dataset_id: datasetId,
    question,
    created_at: new Date().toISOString(),
    duration_ms: 0,
    status: 'error',
    planner: { kind: useLlm ? 'anthropic' : 'rules', model: useLlm ? config.llm.model : null },
    interpretation: '',
    assumptions: [],
    clarification: null,
    spec: null,
    columns_used: [],
    sql: null,
    result: null,
    facts: [],
    computed_summary: '',
    chart: null,
    narrative: null,
    narrative_note: null,
    grounding: null,
    verification: null,
    warnings: [],
    trace,
    error: null,
  };
  const finish = (): AnalysisTurn => {
    turn.duration_ms = Date.now() - started;
    if (signal?.aborted) throw new AppError('CANCELLED', 'The analysis was cancelled.', 499);
    appendTurn(datasetId, turn);
    return turn;
  };
  const step = async <T>(name: string, fn: () => Promise<T> | T, detail: (v: T) => string): Promise<T> => {
    const t0 = Date.now();
    try {
      const v = await fn();
      trace.push({ step: name, status: 'ok', duration_ms: Date.now() - t0, detail: detail(v) });
      return v;
    } catch (e) {
      trace.push({ step: name, status: 'error', duration_ms: Date.now() - t0, detail: e instanceof Error ? e.message : 'failed' });
      throw e;
    }
  };
  const fail = (e: unknown): AnalysisTurn => {
    if (e instanceof AppError && e.code === 'CANCELLED') throw e;
    if (signal?.aborted) throw new AppError('CANCELLED', 'The analysis was cancelled.', 499);
    const err = e instanceof AppError ? e : new AppError('ANALYSIS_FAILED', 'The analysis failed unexpectedly.', 500, true);
    if (!(e instanceof AppError)) console.error('[insightlab] analysis failed:', e instanceof Error ? e.message : e);
    turn.status = 'error';
    turn.error = { code: err.code, message: err.message, retryable: err.retryable };
    return finish();
  };

  // 1. Plan
  emit({ type: 'stage', stage: 'planning', message: useLlm ? 'Planning the analysis with Claude' : 'Planning the analysis' });
  let plan: Plan;
  try {
    plan = await step('plan', async () => {
      if (!useLlm) return planWithRules(question, info, history);
      const res = await planWithLlm(question, info, history, signal);
      turn.planner.model = res.model;
      return res.data;
    }, (p) => `${useLlm ? `model=${turn.planner.model}` : 'rule-based planner'} · ${p.status}${p.analysis ? ` · ${p.analysis.kind}` : ''}`);
  } catch (e) { return fail(e); }

  turn.interpretation = plan.interpretation;
  turn.assumptions = plan.assumptions;
  if (plan.status === 'clarify') {
    turn.status = 'clarification';
    turn.clarification = { question: plan.clarification_question ?? 'Could you say a bit more about what you want to measure?', options: plan.clarification_options.slice(0, 4) };
    return finish();
  }
  if (plan.status === 'unsupported' || !plan.analysis) {
    turn.status = 'unsupported';
    turn.interpretation = plan.unsupported_reason ?? plan.interpretation ?? 'This dataset cannot answer the question.';
    return finish();
  }

  // 2. Guard: the spec must fit the real schema before anything runs.
  let guarded = guardSpec(plan.analysis, info, { maxResultRows: config.maxResultRows });
  trace.push({ step: 'validate_plan', status: guarded.ok ? 'ok' : 'error', duration_ms: 0, detail: guarded.ok ? `columns: ${guarded.columns.join(', ') || 'none'}` : guarded.problems.join(' ') });
  if (!guarded.ok && useLlm) {
    // Give the model one chance to repair a plan that named a missing column or misused a type.
    try {
      const repaired = await step('plan_repair', async () => {
        const res = await planWithLlm(`${question}\n\n(Your previous plan was rejected by the validator: ${guarded.ok ? '' : guarded.problems.join(' ')} Produce a corrected plan using only valid columns, or mark the question unsupported.)`, info, history, signal);
        return res.data;
      }, (p) => p.status);
      if (repaired.status === 'analysis' && repaired.analysis) {
        plan = repaired;
        turn.interpretation = plan.interpretation;
        turn.assumptions = plan.assumptions;
        guarded = guardSpec(plan.analysis!, info, { maxResultRows: config.maxResultRows });
      }
    } catch (e) { return fail(e); }
  }
  if (!guarded.ok) {
    turn.status = 'unsupported';
    turn.interpretation = `The analysis could not be run on this dataset: ${guarded.problems.join(' ')}`;
    return finish();
  }
  turn.spec = guarded.spec;
  turn.columns_used = guarded.columns;
  turn.assumptions = [...turn.assumptions, ...guarded.notes];

  // 3. Compute
  emit({ type: 'stage', stage: 'querying', message: 'Running the query and computing statistics' });
  try {
    const out = compute(db, info, guarded.spec, plan.chart, config.maxResultRows);
    for (const s of out.steps) trace.push({ step: s.step, status: 'ok', duration_ms: s.ms, detail: s.detail });
    Object.assign(turn, { sql: out.sql, result: out.result, facts: out.facts, computed_summary: out.summary, chart: out.chart, warnings: out.warnings });
  } catch (e) { return fail(e); }
  turn.status = 'answered';

  // 4. Optional independent cross-check of aggregates.
  if (guarded.spec.kind === 'aggregate' && turn.result) {
    try {
      const spec = guarded.spec;
      const types = new Map(info.columns.map((c) => [c.name, c.type]));
      const { verification } = await step('pandas_crosscheck', () => crossCheck(db, info.row_count, spec, types, turn.result!, signal), (v) => v.verification.status);
      turn.verification = verification;
    } catch (e) {
      if (signal?.aborted) return fail(new AppError('CANCELLED', 'The analysis was cancelled.', 499));
      turn.verification = { status: 'unavailable', detail: 'The cross-check could not run.' };
    }
  }

  // 5. Narrative (AI only). Failure here keeps the computed answer.
  if (useLlm) {
    emit({ type: 'stage', stage: 'interpreting', message: 'Writing the interpretation' });
    try {
      const { narrative } = await step('narrate', () => narrate({
        question, interpretation: turn.interpretation, info, facts: turn.facts,
        summary: turn.computed_summary, result: turn.result, warnings: turn.warnings, signal,
      }), (n) => `${n.narrative.insights.length} insights`);
      turn.narrative = narrative;
      turn.grounding = checkGrounding(narrative, turn.facts, turn.result, question);
      trace.push({ step: 'check_numbers', status: turn.grounding.unverified.length ? 'error' : 'ok', duration_ms: 0, detail: `${turn.grounding.checked} figures checked, ${turn.grounding.unverified.length} unverified` });
    } catch (e) {
      if (signal?.aborted) return fail(new AppError('CANCELLED', 'The analysis was cancelled.', 499));
      turn.narrative_note = `The AI interpretation could not be generated (${e instanceof AppError ? e.message : 'unexpected error'}). The computed results below are complete.`;
    }
  } else {
    turn.narrative_note = config.llm.message;
  }

  return finish();
}
