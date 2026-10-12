# Project status — InsightLab v0.2.0

An honest record of what was run and observed for this release (Windows 11, Node 22.23, Python 3.14).

## Verified by execution

| Check | Command | Result |
|---|---|---|
| Type checking | `npm run typecheck` | clean |
| Unit + integration tests | `npm test` | 64 passed / 64 |
| Production build | `npm run build` | compiled, no warnings, 13 routes |
| Browser tests (Edge via Playwright, production server) | `E2E_CHANNEL=msedge npm run test:e2e` | 6 passed / 6 |
| HTTP smoke test (production server) | `npm run smoke` | 25 passed / 25 |
| Python validator tests | `pytest tests/test_validator.py` | 12 passed / 12 |
| Generated cross-check code vs. the sandbox's AST validator | ad-hoc script | 3 / 3 accepted |
| Production dependency audit | `npm audit --omit=dev` | 0 vulnerabilities |

Manually exercised in the browser (desktop 1280 px and mobile 375 px, light and dark):
demo import → overview → column drill-down → data browser (sort, search, filter deep link) →
questions (trend, ranking, correlation heatmap, clarification, unsupported, failure + retry) →
SQL editor (SELECT and a rejected DELETE) → chart PNG/SVG export → conversation persisting across reloads.

AI mode was exercised end to end in a production build **against a local stand-in for the Messages
API**: streaming stages, the labelled interpretation, the grounding check flagging an invented "27%",
clarifications, and an honest error with Retry when the provider was unreachable. No secrets appeared
in the client bundle, API responses, logs or stored data.

Performance (200,000 rows, 10 MB CSV, production build): import 2.8 s; analysis SQL 10–200 ms per
step, about 0.3 s server time per question in rule-based mode; data-browser pages ~150 ms.

## Not verified here

| Item | Why | How to verify |
|---|---|---|
| Live Claude responses | No `ANTHROPIC_API_KEY` in this environment. The SDK path, request shape and error handling are covered by tests against a stand-in API, but real model output quality and acceptance of the JSON schema by the live API were not observed. | Add a key to `.env`, ask the demo questions, and check the "How this was answered" tab. |
| pandas cross-check at runtime | The sandbox needs Linux (`fork`, `resource`); on this machine Windows Application Control also blocks NumPy's DLLs. | `docker compose up --build`, then ask "Total revenue by region" and check *Independent check* in the method tab. |
| Python runner tests | Same reason. | Run in CI (Ubuntu) or Docker. |
| Docker / Compose | No Docker daemon available. | `docker compose up --build`. |
| Load / concurrency | Not measured beyond single-user use. | Load-test before multi-user deployment. |

## Known limitations

1. **No authentication.** Dataset ids are unguessable, but there are no user accounts. Add auth before exposing the app.
2. **Single process.** SQL runs synchronously (better-sqlite3) on the request thread; the query timeout is checked after execution. Data size is bounded by `MAX_ROWS` (250k by default), where queries take well under a second.
3. **Import is synchronous** and holds the server for a few seconds on large files.
4. **Rule-based mode** understands a fixed set of phrasings; it declines others rather than guessing. Claude handles free-form questions.
5. **Excel**: the first non-empty sheet is imported; other sheets are listed in the import notes. Formulas use the values cached by Excel.
6. **Grounding check** is numeric: it verifies figures, not the correctness of every qualitative statement. AI text is labelled as interpretation for that reason.
7. **Charts** are one-axis by design; two measures of different scale are not overlaid.

## Configuration note for this checkout

The existing `.env` was left unchanged. It sets `LLM_PROVIDER=local` (AI off), `LLM_MODEL=claude-sonnet-4-6`,
`MAX_UPLOAD_BYTES=5242880` (5 MB) and `PYTHON_SERVICE_URL=http://127.0.0.1:8000`. With that URL set but no
service running, answers show the cross-check as "unavailable". Compare with `.env.example` for the new defaults.
