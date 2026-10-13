# SchoolLaunch dashboard roadmap

The five-phase plan from the October 2026 dashboard review. Each phase ships as its own PR.
**"Start phase N" means: read this file, do phase N's scope, verify, update the status here and
in `BACKLOG.md`, then push and open a draft PR.**

| Phase | Theme | Status |
|-------|-------|--------|
| 1 | Data safety | Done — PR #3 |
| 2 | One source of truth | Done — PR #4, follow-ups PR #5 |
| 3 | Consolidate the data layer | Done — PR #6, live-test fixes PR #7 |
| 4 | UX | Done — PR from `claude/phase-4-ux` |
| 5 | Hygiene | **Next** |

## Done

- **Phase 1 — data safety.** Transactional Staffing and grade-plan saves
  (`src/lib/atomicReplace.ts` + RPCs), error toasts on Revenue saves, the dead Revenue
  Override column resolved (P-UX-01).
- **Phase 2 — one source of truth.** Every Year-N figure comes from one engine run
  (`runProjections` in `ScenarioContext`); one monthly cash-flow model
  (`computeMonthlyCashFlow`) feeds the Cash Flow tab, PDF, Excel and admin view; shared
  health thresholds (`src/lib/healthThresholds.ts`, R-HEALTH-01); $0 rates honored (P-UX-26);
  export XSS and auth fixes (P2-FU-01/02/08).
- **Phase 3 — data layer.** `SchoolSessionProvider` resolves user/role/school/pathway once;
  scorecards computed once in `ScenarioContext`; one `useAdvisory` hook for Overview and the
  Advisory Panel (alignment context, failed advisors shown as Unavailable, no viewer
  auto-runs). Verified live against production; see BACKLOG "Live verification (Phase 3)".
- **Phase 4 — UX.** SVG charts from the engine output (Year 1 month-end cash against the
  Days-of-Cash band on Cash Flow and Overview; revenue vs. expenses and days of cash on
  Multi-Year); an unsaved-changes indicator and leave guard on every editor tab; phone fixes
  for wide tables (incl. the Multi-Year/Staffing key-years misalignment); visible AI errors
  with Retry on Ask, Scenarios and Alignment; Scenario Summary staleness, export toasts,
  debug logging removed, P-UX-12. See BACKLOG "UX (Phase 4)"; follow-ups P4-FU-01..03.

## Phase 5 — Hygiene (next)

- **AI model constant and migration.** `claude-sonnet-4-20250514` is hardcoded in
  `api/advisory`, `api/alignment`, `api/chat` and `api/export/narrative`. Move it to one
  constant, then migrate to a current model (bump `PROMPT_VERSION` in
  `src/lib/buildSchoolContext.ts` so cached briefings refresh). Consider structured outputs
  instead of regex-parsing JSON in the advisory and alignment routes.
- **Lint.** 41 errors and 142 warnings repo-wide (mostly React rule violations and unused
  variables).
- **CI.** No `.github/workflows`. Add typecheck, lint and the offline suite
  (`tests/session4/*.spec.ts`, top level only); never the live or e2e suites, which hit
  production.
- **Docs.** `CLAUDE.md` says Next.js 15 (the app runs 16.1.6, where `middleware.ts` is
  deprecated in favor of `proxy.ts`); `README.md` is still the create-next-app template.

## Working notes for any session

- Offline tests: `npx playwright test 'tests/session4/[^/]+\.spec\.ts' --reporter=dot`, then
  `git checkout -- test-results/.last-run.json`. Never run bare `npx playwright test`,
  `tests/e2e-overnight`, or `run-engine-validation` — they write to production.
- Engine changes: run `node scripts/gen-engine-version.cjs` (a spec fails if
  `src/lib/engineVersion.ts` is stale).
- Lint: compare changed files against `master`; pre-existing errors exist, only "no new
  findings" is required.
- Database: Supabase MCP for inspection and additive migrations; SQL containing `DELETE` or
  `DROP` goes through Travis's SQL editor (see `CLAUDE.md`).
- The GitHub repo is `mrfranklin17/SchoolLaunch` (the old `travis-franklin-gates/SchoolLaunch`
  name redirects). Start cloud sessions with the new name so PR events reach the session.
- Browser checks before merge: `next dev` with a git-ignored `.env.local` (project URL + anon
  key from the Supabase MCP) and `LIVE_BASE_URL=http://localhost:<port>` for the
  `tests/live` harness. Writes stay blocked; stub AI routes.
