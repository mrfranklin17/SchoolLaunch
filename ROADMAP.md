# SchoolLaunch dashboard roadmap

The five-phase plan from the October 2026 dashboard review. Each phase ships as its own PR.
**"Start phase N" means: read this file, do phase N's scope, verify, update the status here and
in `BACKLOG.md`, then push and open a draft PR.**

| Phase | Theme | Status |
|-------|-------|--------|
| 1 | Data safety | Done — PR #3 |
| 2 | One source of truth | Done — PR #4, follow-ups PR #5 |
| 3 | Consolidate the data layer | Done — PR #6, live-test fixes PR #7 |
| 4 | UX | **Next** |
| 5 | Hygiene | Not started |

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

## Phase 4 — UX (next)

Status checked against `master` on 2026-10-13.

1. **Charts.** There are none, and no chart library is installed.
   - A Year 1 monthly cash-balance chart from `computeMonthlyCashFlow`, showing the low months
     (typically November and May) against the Stage 1 Days-of-Cash line from
     `healthThresholds.ts`. Cash Flow tab first; consider a small version on Overview.
   - A 5-year trend chart (revenue, expenses, ending cash or days of cash) from
     `ScenarioContext.multiYear`, on Overview or Multi-Year.
   - Choose between a small library (e.g. Recharts) and hand-rolled SVG; take colors and
     bands from `healthThresholds.ts` (`healthColor`).
2. **Unsaved-changes guard.** Revenue, Staffing, Operations, Cash Flow and Settings save with
   buttons, but none shows unsaved edits or warns before leaving (no `beforeunload`, no
   in-app navigation guard). Add a dirty indicator and a warning on tab close and on sidebar
   navigation.
3. **Mobile table fix.** The Overview "5-Year Trajectory" table
   (`src/app/(authenticated)/dashboard/page.tsx`, section 7) has no horizontal scroll, so
   Years 4–5 are clipped on phones. Check the other wide tables (Multi-Year, Scorecard,
   Staffing) at 375 px too.
4. **Clear AI failure states beyond the advisory panel** (the panel itself was done in Phase
   3): Ask SchoolLaunch, Alignment Review and the Scenarios AI analysis should show a visible
   error with a retry, never fail silently.
5. **Polish from the review.**
   - Overview Scenario Summary card: skips the staleness check the Scenarios tab does
     (`base_data_hash`), and its `<a href>` forces a full page reload (use `Link`).
   - Overview "Export PDF" / "Export Excel" failures only `console.error` — show a toast (the
     portfolio page already does). The PDF opens its tab after awaiting work, which popup
     blockers can stop; open the window first.
   - 17 `console.log` calls remain in `src/`.
   - P-UX-12 (OPEN in `BACKLOG.md`): Staffing custom titles containing a catalog keyword are
     re-typed on reload.

Verify with the offline suite, then in a real browser with the read-only harness in
`tests/live/` (desktop and 375 px).

## Phase 5 — Hygiene

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
