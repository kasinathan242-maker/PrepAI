# PrepAI — Testing & Benchmarking

Results below were recorded on 2026-10-07 on the reference machine (Windows 11, RTX 3050 6 GB,
Node 26, Python 3, MongoDB, Ollama with `qwen2.5-coder:7b` + `qwen3:8b`, Laya on CPU).

| Suite | Location | Command | Result |
|---|---|---|---|
| Server unit | `server/src/tests/unit/*.test.js` | `npm run test:server` | 39 / 39 |
| API integration | `server/src/tests/integration/api.test.js` | `npm run test:integration` | 14 / 14 (~4 min) |
| Laya service | `services/laya-engine/tests/` | `npm run test:laya` | 7 / 7 |
| Frontend unit | `frontend/src/test/*.test.ts(x)` (Vitest) | `npm run test:frontend` | 17 / 17 |
| End-to-end | `frontend/tests/e2e/*.spec.ts` (Playwright) | `npm run test:e2e` | 9 / 9 |
| Type check, lint, build | `frontend/` | `npm --prefix frontend run build`, `npm run lint:frontend` | clean |
| Evaluation benchmark | `server/src/evals/` | `npm --prefix server run benchmark` | see [BENCHMARKS.md](BENCHMARKS.md) |

## 1. Server unit tests (no database, no models)

Run with Node's built-in runner; model providers and Laya are mocked where needed
(`t.mock.method`).

- **Evaluation** (`evaluation.test.js`): weights sum to 1 and malformed weights are rejected;
  deterministic aggregation; non-answers vs short real answers; non-verbatim evidence and claims
  are dropped; concepts without evidence become UNVERIFIED; invalid model output is rejected; the
  conflict policy (agreement, evidence-resolved conflict, REVIEW_REQUIRED); caps never raise a
  score; a provider failure yields `failed` with no score; a full mocked pipeline run; non-answers
  never call a model.
- **Engines** (`engines.test.js`): mastery bands, recency weighting and smoothing; difficulty rules
  (no change on one lucky answer, no easy↔hard oscillation); state-machine plans, phase advance,
  strategy selection (including off-topic → clarification via Laya relevance), duplicate questions
  and UI phase mapping; prompt-markup sanitising of interviewer turns; deferral of grading during a
  live interview; aptitude numeric tolerance, option resolution and balanced answer positions;
  resume extraction verified against the source text; benchmark metric maths; cosine similarity;
  token-bucket rate limiting; PII scrubbing (incl. Indian phone formats); reasoning-block stripping;
  JSON extraction; speech/communication statistics.

## 2. API integration tests (live stack)

Needs MongoDB, the API (`npm run dev:server`), Laya and the AI model service running. Each run registers
`itest_*` users and deletes everything they own (sessions, turns, evaluations, reports, resumes,
mastery, notifications, test event and question) in `after()`.

Covers: health, request ids, security headers and CORS allowlist; auth bypass, role escalation,
duplicate sign-up, refresh rotation and logout revocation, forgot-password enumeration and OTP
checks; the honest empty dashboard; aptitude (no answer-key leak, server timing, scoring with
skipped questions, idempotent XP, ownership, closed sessions); a full interview (state machine,
ownership, async evaluation with verbatim evidence, evaluation ownership, report, share link,
PDF, notifications, mastery); an empty interview scoring 0 with no XP; resume upload (PDF only,
verified skills, ownership, delete); study plan and skill gap; quests; the anonymised leaderboard;
admin analytics, events, CSV import with row errors, CSV export, AI-quality access control; internal
AI health, models, metrics and a typed Laya decision whose probabilities sum to 1.

## 3. End-to-end (Playwright)

`frontend/tests/e2e/auth.spec.ts` (register, wrong password, staff sign-in, redirect when signed
out) and `platform.spec.ts` (every student and admin screen renders with no page errors, console
errors or 5xx responses; students cannot open the admin console; unknown routes show the 404 page).
The app must be running on `http://localhost:5174` (override with `E2E_BASE_URL`).

## 4. Benchmark methodology

See [BENCHMARKS.md](BENCHMARKS.md): 120 expert-labelled answers, three systems from one run
(fusion, LLM only, Laya only), 3- and 5-class accuracy and macro-F1, MAE, Pearson r, in-range rate,
false-positive / false-negative rates, p50 / p95 latency, structured-output failure rate, conflict
rate and re-run consistency.
