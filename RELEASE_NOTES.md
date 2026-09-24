# InsightLab v0.1.0

**Release name:** InsightLab v0.1.0 — portfolio release
**Status:** portfolio-quality. Not production-ready; see limitations below.

## What is included

- **Next.js 16 app** (App Router, TypeScript, Tailwind): workspace UI with dataset overview, column
  profiles, data-quality panel, question input with schema-derived suggestions, and result cards
  exposing Answer, Visualization, Data, SQL, Python, Plan and Trace tabs.
- **7 typed API routes**: create data source (demo or CSV upload), profile, sample, validate SQL,
  execute read-only SQL, analyze, export.
- **Data-source abstraction** with an in-memory SQLite implementation; CSV and demo data are loaded
  into a real `dataset` table, so SQL execution is real SQL.
- **Deterministic demo dataset**: 820 seeded e-commerce rows across 12 columns, byte-identical on
  every run, including ~3% missing regions so data-quality handling is visible.
- **Agent layer**: `LlmProvider` interface, a fully functional offline `LocalPlanner`, and an
  `AnthropicPlanner` adapter; `guardPlan` validates every plan column against the real schema.
- **Four-layer SQL safety** and a **FastAPI Python sandbox** (AST allowlist, forked child,
  `setrlimit`, cleared environment, reduced builtins, output caps).
- **Tests**: 54 Vitest, 18 Pytest, an 18-check HTTP smoke suite, and a Playwright suite that has not
  yet been run.
- Docs: `README.md`, `PORTFOLIO_STATUS.md`, this file, `.env.example`, `.gitignore`, MIT `LICENSE`,
  `docker-compose.yml` and two Dockerfiles.

## Verification results

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run build` | compiled successfully, 9 routes |
| `npm test` | 54 passed / 54 |
| `pytest tests -q` (sandbox) | 18 passed / 18 |
| `node scripts/smoke.mjs` (HTTP) | 18 passed / 18 |
| Unsafe SQL rejection | verified (5 statement classes over HTTP, 9 in unit tests) |
| Unsafe Python rejection | verified (imports, eval/exec/open/getattr, dunder walking, timeout) |
| Empty result | verified — 0 rows returned cleanly |
| Off-topic question | verified — refused, no invented answer |
| CSV upload + profiling | verified |
| Demo analysis | verified — SQL, 9 monthly rows, line chart, computed figures |
| Docker | **not verified** — no Docker daemon available |
| Browser / UI | **not verified** — Playwright browser binaries unavailable in the build sandbox |
| Anthropic adapter | **not verified** — no API key available |

## Known limitations

Post-hoc SQL timeouts; a language-level (not kernel-level) Python sandbox; in-process session
storage; no authentication or ownership checks; no PostgreSQL/MySQL adapters; line and bar charts
only; a rule-based local planner that refuses unfamiliar phrasing rather than guessing. Full detail
in `PORTFOLIO_STATUS.md`.

## Security notes

- SQL is built from typed plan objects with quoted identifiers; the user's question text never
  reaches the query string.
- Read-only is enforced at two levels: the validator rejects the text, and `PRAGMA query_only` makes
  the connection refuse writes regardless.
- Dataset values — including cells reading "ignore previous instructions" — are treated as data, and
  a test asserts this.
- No credentials, `.env` files, datasets or build artifacts are in the repository. `.env.example`
  contains placeholders only.
- The analysis service must stay on an internal network. Do not expose it publicly.

## How to run locally

```bash
unzip insightlab-v0.1.0.zip && cd insightlab
cp .env.example .env
npm install
npm run dev                 # http://localhost:3000
```

Optional Python analysis service (second terminal):

```bash
cd services/analysis
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

Then set `PYTHON_SERVICE_URL=http://127.0.0.1:8000` in `.env` and restart the dev server.

## Three example demo questions

1. **How has revenue changed over time?** — monthly SQL aggregation, line chart, trend answer.
2. **Which category has the highest profit?** — grouped ranking, bar chart, share of total.
3. **Which columns have the most missing data?** — profiling path, no SQL, quality findings.

## Three recommended next steps

1. `npx playwright install chromium && npm run test:e2e` to close the UI verification gap.
2. Add authentication and per-session ownership checks before deploying anywhere.
3. Implement a `PostgresDataSource` behind the existing interface to prove the abstraction.
