# SchoolLaunch dashboard roadmap

The five-phase plan from the October 2026 dashboard review. Each phase ships as its own PR.
**"Start phase N" means: read this file, do phase N's scope, verify, update the status here and
in `BACKLOG.md`, then push and open a draft PR.**

| Phase | Theme | Status |
|-------|-------|--------|
| 1 | Data safety | Done — PR #3 |
| 2 | One source of truth | Done — PR #4, follow-ups PR #5 |
| 3 | Consolidate the data layer | Done — PR #6, live-test fixes PR #7 |
| 4 | UX | Done — PR #9 |
| 5 | Hygiene | Done — PR from `claude/phase-5-hygiene` |
| 6 | Chat that makes changes | Planned — open decisions below; ships as 6a–6d |

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
- **Phase 5 — hygiene.** One model constant (`AI_MODEL`, now `claude-sonnet-5-5`) with effort
  per route, thinking-safe reply parsing, structured outputs for advisor and alignment JSON,
  refusal handling, `PROMPT_VERSION` v5; `npx eslint .` at zero findings; CI
  (`.github/workflows/ci.yml`); README and CLAUDE.md updated. See BACKLOG "Hygiene
  (Phase 5)"; follow-ups P5-FU-01..02.

All five phases of the October 2026 review are done. Phase 6 below is the next planned
feature; other work comes from `BACKLOG.md`.

## Phase 6 — chat that makes changes (planned)

**Goal.** A founder tells Ask SchoolLaunch a change in plain English ("cut the instructional
coach to half-time", "add a second kindergarten section in Year 2"); the chat finds the
records involved, shows the change and its financial impact, and applies it when the founder
confirms. Ask keeps its advisory role; editing is added alongside it.

**Core rule: the AI proposes, the founder applies.** The model never writes to the database.
It returns a typed proposal; the server validates it, the client previews it, and only a
founder's click on Apply saves it.

### How it works

1. **Request.** The founder types a change in Ask.
2. **Proposal.** `/api/chat` gives the model a fixed set of tools (Claude tool use, strict
   input schemas), each mapped to data the app already owns:

   | Tool | Changes |
   |------|---------|
   | `update_assumption` | One key in `school_profiles.financial_assumptions` |
   | `add_position` / `update_position` / `remove_position` | `staffing_positions` (FTE, salary, year, driver) |
   | `update_grade_plan` | `grade_expansion_plan` (sections, students per section, retention) |
   | `update_operations_line` | One operations category amount |
   | `ask_clarifying_question` | Nothing; used when the target is ambiguous |

   The model resolves plain names to record ids from the context it is given ("the coach" →
   a `staffing_positions` row). Two plausible matches → it asks rather than guesses.
3. **Validation.** The server checks every proposal against the same rules the editor tabs
   enforce (ranges, required fields, Year 1–5, catalog positions from `COMMISSION_POSITIONS`)
   and against the caller's role. Rejected proposals go back to the model to correct or explain.
4. **Preview card.** The client applies the proposal to an in-memory copy of the school's
   data and runs the existing engine (`computeMultiYearDetailed`, the FPF scorecard) — nothing
   saved. The card shows the field-level diff ("Instructional Coach: 1.0 → 0.5 FTE, Years
   1–5") and the impact (Days of Cash, personnel %, total margin, FPF badges, before → after),
   with **Apply / Edit / Cancel**.
5. **Apply.** A new route re-checks role and validation, then saves through the existing write
   paths (`atomicReplace.ts` for staffing and grade-plan rows), writes a change-log row, and
   triggers the same downstream refresh a manual edit does (scenario staleness via
   `base_data_hash`, advisory staleness via `advisoryDataHash`).
6. **Undo.** Each applied change shows an Undo control backed by the change log.

### Scope by step (each step its own PR)

- **6a — read-only "what if".** The model proposes; the preview card shows diff and impact;
  there is no Apply button. Validates intent-to-record matching and the preview engine with no
  write risk.
- **6b — propose and apply, narrow set.** `update_assumption` and `update_position` (FTE,
  salary, start year) only. Adds the apply route, server validation, the change-log table
  (additive migration: who, when, source `chat` | `manual`, table, record id, old → new
  values), Undo, and the role gate.
- **6c — wider coverage.** Add/remove positions, grade expansion, operations lines; bundled
  proposals that apply together or not at all ("open K–2 instead of K–3 and drop the 3rd grade
  teacher"); optional "Try in a scenario first" next to Apply.
- **6d — chat on every tab.** A side panel on each dashboard tab that knows the current tab,
  so "cut the coach" on Staffing needs no extra context. Ask SchoolLaunch remains the
  full-page view.

### Guardrails

- **Roles.** Edit tools are offered only to `school_ceo` / `school_editor` (or Owner only —
  see decisions); Viewers get today's advice-only chat. The apply route enforces this
  server-side; RLS remains the final backstop.
- **Fixed values.** The authorizer fee (3%), benefits load and other non-negotiable constants
  have no tool and cannot be changed through chat.
- **No silent edits.** Proposals appear only when the founder asks for a change. Advice that
  implies a change ends with "Want me to set that up?", which then produces a proposal.
- **Unsaved edits.** If the founder has unsaved edits on a tab (`unsavedChanges.ts`), Apply
  warns before saving over them.
- **Untrusted text.** Uploaded Alignment documents and free-text fields stay data, never
  instructions (`promptInjection.ts`); a proposal can only come from the founder's own message.
- **AI plumbing.** All calls go through `anthropic-client.ts`; bump `PROMPT_VERSION` when the
  prompt or tools change; add tool-call fixtures to `aiStub.ts` so offline tests cover the flow.

### Decisions needed from Travis before 6b

1. **Where edits land.** Recommended: straight to the live plan after Apply, with preview and
   Undo. Alternative: always into a scenario first, promoted later (safer, but `scenarios`
   holds only the 5 levers today and would need a fuller data shape).
2. **Which changes first.** 6b assumes assumptions + staffing FTE/salary/year; swap in the
   three or four requests founders make most.
3. **Who can apply.** Owners and Editors (matches today's edit rights), or Owners only at first.

### Done when

- 6a: a founder's request yields a correct diff and engine impact in the card for the 6b
  tool set; ambiguous requests get a clarifying question; offline tests cover it with stubs.
- 6b–6d: applied changes match what the editor tab would save, appear in the change log, undo
  cleanly, refresh scenario and advisory staleness, and Viewers cannot apply via UI or API.
  Live-harness check of each step against a branch build before merge.

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
