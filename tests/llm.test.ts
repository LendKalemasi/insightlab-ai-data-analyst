import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { useTempDataDir } from './helpers';

/**
 * Exercises the real Anthropic SDK code path against a local stand-in for the
 * Messages API. It verifies request shape, structured-output parsing, error
 * mapping, the plan-repair loop and the grounding check — everything except
 * the live model itself, which needs a real ANTHROPIC_API_KEY.
 */
type Handler = (body: Record<string, unknown>) => { status?: number; headers?: Record<string, string>; json: unknown };
let handler: Handler = () => ({ json: {} });
const requests: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> }[] = [];

const server = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    const body = JSON.parse(data || '{}');
    requests.push({ headers: req.headers, body });
    const out = handler(body);
    res.writeHead(out.status ?? 200, { 'content-type': 'application/json', ...(out.headers ?? {}) });
    res.end(JSON.stringify(out.json));
  });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

useTempDataDir();
process.env.LLM_PROVIDER = 'anthropic';
process.env.ANTHROPIC_API_KEY = 'sk-test-not-a-real-key';
process.env.LLM_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.LLM_TIMEOUT_MS = '5000';

const { finish } = await import('@/lib/ingest');
const { demoTable } = await import('@/lib/demo-data');
const store = await import('@/lib/store/datasets');
const { runAnalysis } = await import('@/lib/analysis/orchestrator');
const { appStatus } = await import('@/lib/config');

const message = (payload: unknown, stop = 'end_turn') => ({
  json: {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
});
const isPlanner = (body: Record<string, unknown>) => JSON.stringify(body.system).includes('planning component');

const plan = (analysis: unknown, extra: Record<string, unknown> = {}) => ({
  status: 'analysis', interpretation: 'Total profit for each category.', assumptions: [],
  clarification_question: null, clarification_options: [], unsupported_reason: null, analysis, chart: 'auto', ...extra,
});
const byCategory = (column: string) => ({ kind: 'aggregate', dimensions: [{ column: 'category', time_grain: null }], measures: [{ column, agg: 'sum' }], filters: [], sort: null, limit: null, include_share: false });

const demo = store.createDataset(finish(demoTable(), 'demo', null), { name: 'demo', fileName: null, fileBytes: null });

beforeEach(() => { requests.length = 0; });

describe('AI planner and narrator via the Anthropic SDK', () => {
  it('reports AI as configured without exposing the key', () => {
    const status = appStatus();
    expect(status.ai).toMatchObject({ provider: 'anthropic', configured: true, model: 'claude-opus-5-5' });
    expect(JSON.stringify(status)).not.toContain('sk-test');
  });

  it('plans, repairs a hallucinated column, computes, narrates and checks the numbers', async () => {
    let plannerCalls = 0;
    handler = (body) => {
      if (isPlanner(body)) {
        plannerCalls++;
        // First plan names a column that does not exist; the guard must reject it.
        return message(plan(byCategory(plannerCalls === 1 ? 'net_margin' : 'profit')));
      }
      return message({
        headline: 'Electronics leads on total profit',
        summary: 'Electronics has the highest total profit. Profit grew 999% last year.',
        insights: [{ text: 'Electronics is the most profitable category.', columns: ['category', 'profit'] }],
        caveats: [], follow_ups: ['How has profit changed over time?', 'Which region has the highest profit?', 'What is the distribution of profit?'],
      });
    };
    const turn = await runAnalysis(demo.id, 'Which category is most profitable?', () => {});
    expect(turn.status).toBe('answered');
    expect(plannerCalls).toBe(2);
    expect(turn.trace.find((t) => t.step === 'validate_plan')?.detail).toMatch(/net_margin.*does not exist/);
    expect(turn.spec).toMatchObject({ measures: [{ column: 'profit' }] });
    expect(turn.planner).toEqual({ kind: 'anthropic', model: 'claude-opus-5-5' });
    expect(turn.narrative?.headline).toMatch(/Electronics/);
    // "999%" appears nowhere in the computed results, so it must be flagged.
    expect(turn.grounding?.unverified).toContain('999%');

    const first = requests[0];
    expect(first.headers['x-api-key']).toBe('sk-test-not-a-real-key');
    expect(first.body.model).toBe('claude-opus-5-5');
    expect(first.body.output_config).toMatchObject({ effort: 'medium', format: { type: 'json_schema' } });
    // Only schema, statistics and top category values are sent — never raw rows.
    const sent = JSON.stringify(first.body);
    expect(sent).toContain('category (categorical');
    expect(sent).not.toContain('C1000,');
  });

  it('returns clarifications from the model without running anything', async () => {
    handler = () => message(plan(null, { status: 'clarify', interpretation: 'Ambiguous.', clarification_question: 'Which metric defines best?', clarification_options: ['Which category has the highest total revenue?', 'Which category has the highest total profit?'] }));
    const turn = await runAnalysis(demo.id, 'Which is best?', () => {});
    expect(turn.status).toBe('clarification');
    expect(turn.clarification?.options).toHaveLength(2);
    expect(turn.sql).toBeNull();
  });

  it('keeps computed results when only the narrative fails', async () => {
    handler = (body) => (isPlanner(body) ? message(plan(byCategory('revenue'))) : { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } } });
    const turn = await runAnalysis(demo.id, 'Revenue by category', () => {});
    expect(turn.status).toBe('answered');
    expect(turn.result?.row_count).toBe(4);
    expect(turn.narrative).toBeNull();
    expect(turn.narrative_note).toMatch(/could not be generated.*computed results below are complete/);
  });

  it('maps provider failures to actionable, retryable errors without fake answers', async () => {
    handler = () => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
    const auth = await runAnalysis(demo.id, 'Revenue by category', () => {});
    expect(auth.status).toBe('error');
    expect(auth.error).toMatchObject({ code: 'AI_AUTH', retryable: false });
    expect(auth.error!.message).not.toContain('sk-test');
    expect(auth.result).toBeNull();

    requests.length = 0;
    handler = () => ({ status: 429, headers: { 'retry-after-ms': '5', 'retry-after': '7' }, json: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } });
    const limited = await runAnalysis(demo.id, 'Revenue by category', () => {});
    expect(limited.error).toMatchObject({ code: 'AI_RATE_LIMITED', retryable: true });
    expect(requests.length).toBe(3); // the SDK retried twice before giving up

    handler = () => message(plan(byCategory('revenue')), 'refusal');
    const refused = await runAnalysis(demo.id, 'Revenue by category', () => {});
    expect(refused.error?.code).toBe('AI_REFUSED');
  });

  it('retries once when the model returns JSON that does not match the schema', async () => {
    let calls = 0;
    handler = (body) => {
      if (!isPlanner(body)) return message({ headline: 'x', summary: 'y', insights: [], caveats: [], follow_ups: [] });
      calls++;
      return calls === 1 ? message({ status: 'maybe' }) : message(plan(byCategory('units')));
    };
    const turn = await runAnalysis(demo.id, 'Units by category', () => {});
    expect(calls).toBe(2);
    expect(turn.status).toBe('answered');
  });

  it('cancels in-flight work when the client aborts', async () => {
    handler = () => message(plan(byCategory('revenue')));
    const controller = new AbortController();
    controller.abort();
    await expect(runAnalysis(demo.id, 'Revenue by category', () => {}, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
