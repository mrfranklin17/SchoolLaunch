# Advisor eval (AI-EXP-01 step 3)

Fixture schools with planted problems, run through the real advisor panel, so a prompt change
shows what it fixed or broke. Real AI calls: run it on demand, never in CI.

## The cases

`advisorFixtures.ts` builds a sound WA K-5 school (288 students, King County) in memory and plants
one problem per case. Each runs through the dashboard's own engine and context builders
(`runProjections`, `computeFPFScorecard`, `buildAdvisoryRequest`).

| Case | Planted problem | Checks |
|---|---|---|
| `control` | none | no advisor reports risk |
| `year3_cliff` | CSP grant carries Years 1-2, enrollment stalls; Year 3 net turns negative | an advisor flags Year 3; the briefing names it |
| `sped_understaffed` | 14% IEP with one 0.5 FTE SPED teacher | Staffing Advisor flags SPED; the briefing names it |
| `thin_back_office` | no business manager, $8,000 Contracted Services | an advisor flags the back office |
| `regular_ed_rate` | Regular Ed base rate $13,900 vs the $11,812 default | Commission Reviewer flags the rate |

Every case also checks that the panel came back complete, and that no answer repeats a
corrected claim (a legal SPED caseload cap; an October count or January true-up). Checks live
in `advisorChecks.ts`. `tests/session4/advisor-eval-fixtures.spec.ts` (offline, in CI) proves
each fixture really contains its problem and the control none, and that the scoring works.

The report also lists **figures not given**: dollar amounts in the answers that appear in
neither context nor the prompts. Most are correct derivations ($300 × 288 students = $86,400),
so it's a list to skim, not a check. A figure with no derivation is an invented number.

## Running it

Against a deployment (signs in as the test-columbia owner; `/api/advisory` writes nothing):

```bash
EVAL_BASE_URL=https://schoollaunch.vercel.app npx playwright test -c tests/evals/playwright.eval.config.ts
```

To test unmerged prompt changes, point `EVAL_BASE_URL` at the branch's Vercel preview, or run
in-process with `ANTHROPIC_API_KEY` set and no `EVAL_BASE_URL`.

| Variable | Effect |
|---|---|
| `EVAL_RUNS=3` | answers per case (AI varies; the scores read 2/3 etc.) |
| `EVAL_CASES=control,year3_cliff` | run only these cases |
| `EVAL_RESCORE=1` | re-score the last run's saved answers, no AI calls (after editing a check) |
| `EVAL_UPDATE_BASELINE=1` | save this run's scores as `baseline.json` |
| `AI_STUB=1` | in-process on canned replies: checks the harness only |
| `EVAL_OUT=dir` | where answers and the report go (default `tests/evals/results/`, git-ignored) |

Cost: eight AI calls per case per run (seven advisors and the briefing). A full run with
`EVAL_RUNS=2` makes 80 calls and takes about a minute.

## Reading the result

The summary prints each check's pass count, each advisor's status per run, and the figures not
given. Where a score differs from `baseline.json`, it shows the baseline beside it. After a
prompt change that you keep, re-run with `EVAL_UPDATE_BASELINE=1` and commit the new baseline
with the change.

Adding a case: add a fixture to `EVAL_CASES`, its checks to `CASE_CHECKS`, and an offline test
that the planted problem is in the engine output.
