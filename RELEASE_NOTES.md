# InsightLab v0.2.0

A rebuild of the application around one rule: numbers are computed from the data, and anything a
language model writes is labelled and checked against those numbers.

## Highlights

- **Working AI integration.** The previous Anthropic adapter asked the model for "the AnalysisPlan
  as defined in src/lib/types.ts" without ever sending the schema, so it could essentially never
  produce a valid plan and silently fell back to the rule planner. It is replaced by the official
  SDK with structured outputs (Zod schema), a guard against invented columns with one repair attempt,
  a separate interpretation step, a numeric grounding check, refusal and error handling, and
  cancellation. Default model: `claude-opus-5-5`.
- **Richer analysis.** Typed specs for aggregates (0–2 groupings, time grains, filters, top-N, shares),
  distributions, correlation matrices, two-variable relationships, summaries, outliers, row listings
  and data quality — replacing five hard-coded operations.
- **Real import pipeline.** Excel `.xlsx`, encoding detection, decimal commas, currency and percent
  values, day/month date detection, query-safe header renaming (headers such as `Unit Price ($)` used
  to be rejected), case-insensitive duplicate headers, null tokens (`N/A`, `-`, …).
- **Persistence.** Datasets and conversations are stored on disk with automatic deletion, so a reload
  or restart no longer loses work. Delete from the UI.
- **New interface.** Workspace with Overview, Data, Ask and SQL tabs; drag-and-drop upload with
  progress; column drill-down; server-paged data browser; conversation thread with live stages,
  cancellation and retry; chart export; Markdown report export; light/dark themes; mobile layouts.

## Bugs fixed

- Fake progress: the old UI cycled through stage names on a 400 ms timer regardless of what the
  server was doing. Stages now come from the server as they happen.
- Dates in `MM/DD/YYYY` were grouped by `substr(date, 1, 7)`, producing garbage months. Dates are now
  normalised to ISO at import.
- One unparseable value (e.g. `N/A`) turned a numeric column into text.
- A group of rows with a missing category could be reported as the "highest" group.
- Bar charts used a `[0, auto]` axis that broke for negative values; lines used smoothing that drew
  values the data does not contain.
- The keyword SQL validator rejected legitimate columns such as `"Last Update"` and flagged any query
  containing a string literal as unterminated.
- Column names differing only in case collided in SQLite.
- `next` 16.3.6 had published high-severity advisories; upgraded to 16.4.0.

## Removed

- `/api/export` (export now happens in the browser), `/api/sql/validate` (merged into the query
  endpoint), and the old `datasources` routes (replaced by `/api/datasets`).
