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
| 6 | Chat that makes changes | In progress — 6a PR #26, 6b PR #27 shipped; 6c (Editor requests) built; 6d–6e below |

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

All five phases of the October 2026 review are done. Phase 6 below is in progress; other
work comes from `BACKLOG.md`.

## Phase 6 — chat that makes changes (in progress)

**Goal.** A founder tells Ask SchoolLaunch a change in plain English ("cut the instructional
coach to half-time", "set rent to $25,000 a month"); the chat finds the records involved,
shows the change and its financial impact, and applies it when the founder confirms. Ask
keeps its advisory role; editing is added alongside it.

**Core rule: the AI proposes, a person applies.** The model never writes to the database.
It returns a typed proposal; the server validates it, the client previews it, and only an
Owner's click on Apply saves it.

### Decisions (Travis, 2026-10-26)

1. **Where edits land: the live plan.** After Apply, straight to the live plan, not a
   scenario. Before saving, the leader is told plainly that this changes the live plan
   (a confirm step naming what will change), then Undo is offered.
2. **Which changes 6b covers: staffing, operations and grade plan** (Travis, after "Choosing
   6b's changes" below). Rates and the school profile stay preview-only.
3. **Who applies: Owners.** Editors can *propose* a change to the Owner instead of applying
   it. The Owner gets an in-app notification the next time they log in and an inbox in their
   profile (unread messages with an indicator on the site), where they review the preview
   and apply or decline. Viewers keep advice-only chat.

### How it works

1. **Request.** The leader types a change in Ask.
2. **Proposal.** `/api/chat` gives the model five tools (Claude tool use, strict input
   schemas, `src/lib/chatEdits.ts`), each mapped to data the app already owns:

   | Tool | Changes |
   |------|---------|
   | `propose_staffing_change` | FTE (chosen years) and/or Year 1 base salary of an existing position |
   | `propose_operations_change` | One Year 1 operations line (the authorizer fee excluded) |
   | `propose_rate_change` | Salary/operations escalator, revenue COLA, attendance (AAFTE), interest on cash |
   | `propose_school_profile_change` | Enrollment targets (schools without a grade plan), demographic %, retention |
   | `propose_grade_plan_change` | Sections / students per section where they set enrollment (Year 1, or the year a grade is added) |

   The system prompt lists the editable items with keys (positions are P1, P2, … in Staffing
   tab order). Ambiguous requests get a clarifying question, not a guess.
3. **Validation.** The server reads the saved plan with the caller's session (RLS) and checks
   every call: the item exists, the years are on file, values are in range, and the change
   would actually move the engine. Invalid calls go back to the model as `is_error` tool
   results to correct or explain (up to 3 rounds).
4. **Preview card.** The client re-checks the proposal against its data, applies it to an
   in-memory copy and re-runs the engine (`runProjections` + FPF scorecard,
   `src/lib/chatPreview.ts`). The card shows before → after for each change and Years 1 and 5
   for enrollment, revenue, expenses, net income, ending cash, days of cash, personnel % and
   Commission measures met.
5. **Apply (6b).** Owner only (`canApplyPlanChanges`; the routes require `school_ceo`). A
   confirm step says the live plan will change. `/api/plan-changes/apply` re-reads the plan,
   re-validates, and refuses if the card's before → after lines no longer match the saved plan;
   it writes through the editor tabs' paths (`atomicReplace.ts` for staffing and the grade plan;
   the Operations tab's row update/insert and its per-student rate), putting earlier parts back
   if a later part fails, and logs the change in `plan_changes` (before and after state).
   `/api/plan-changes/undo` restores the before state only while the plan still matches the
   after state. Scenario and advisory staleness follow from the hashes, as for a manual edit.

### Scope by step (each step its own PR)

- **6a — read-only preview. Shipped (PR #26).** Tools, server validation, the stream marker, the preview
  card on Ask, offline tests (`tests/session4/chat-edits.spec.ts`), browser-checked on a
  branch build (desktop and phone, axe clean). WA charter pathway only.
- **6b — Owners apply. Shipped (PR #27).** Staffing, operations and grade plan; the confirm
  step, `/api/plan-changes/{apply,undo}` (`src/lib/planChangeStore.ts`), the `plan_changes` log
  (migration `20261026182948_phase6b_plan_changes.sql`, applied), Undo on the card, the
  Owner-only gate. Offline tests cover parsing, the rate sync and the state compare. Live
  apply → undo round trip on Spokane Arts (Travis's go-ahead, 2026-10-26): the three changes
  landed as the tabs would save them, Undo restored the school byte-for-byte (hashed before and
  after); the first run found that jsonb reorders keys, which made Undo refuse — fixed.
  Undo lives on the card, so it is gone after a reload; a durable "recent changes" list can
  come with 6c's inbox.
- **6c — Editors propose to the Owner. Built (PR pending).** `change_requests` (migration
  `20261026185528_phase6c_change_requests.sql`, applied; statuses pending / applied / declined /
  withdrawn / undone; RLS: Owner resolves, requester can only withdraw a pending request, viewers
  can't read, no delete). The Editor's card has **Send to Owner…** with an optional note
  (`/api/change-requests`). The Owner gets an **Inbox** item in the Sidebar with an unread
  badge, and a notice on whatever page they land on until they open the Inbox or dismiss it.
  The Inbox shows each waiting request on its preview card (re-checked against today's plan)
  with **Apply…** (through `/api/plan-changes/apply` with the request; the request's own
  changes are applied) or **Decline…** with a reason; earlier requests are listed with their
  outcome. Editors see their own requests there and can withdraw one still waiting. Undoing an
  applied request marks it "applied, then undone".
- **6d — wider coverage.** Add/remove positions, add grades, bundled changes that apply
  together or not at all, operations lines kept in step with their per-student rates.
- **6e — chat on every tab.** A side panel on each dashboard tab that knows the current tab.
  Ask SchoolLaunch remains the full-page view.

### Choosing 6b's changes (decision 2)

All five are previewable today in 6a. What each takes to *apply*, and how often it is likely
to come up:

| Change | Likely demand | Apply effort | Notes |
|--------|---------------|--------------|-------|
| Staffing FTE / salary | High: the most common "can I afford" question | Medium | Saves through the transactional staffing replace; must keep the Staffing tab's per-pupil recompute and manual-override flags intact |
| Operations lines (rent, contracted services, …) | High: facilities is the largest non-staff cost | Low–medium | One `budget_projections` row; lines the Operations tab derives from a per-student rate must update the rate too |
| Grade plan sections | High: 20 of 26 schools have a grade plan, so enrollment changes go here | Medium | Transactional grade-plan replace. Sections count only in Year 1 and the year a grade is added (the engine carries continuing students forward × retention), so "a second K section in Year 2" is refused with that explanation |
| Demographics % / enrollment targets | Medium | Low | One `school_profiles` update; enrollment targets matter only for the 6 schools without a grade plan |
| Planning rates (escalators, COLA, AAFTE, interest) | Low | Low | One `financial_assumptions` update |

Recommendation: staffing, operations and grade-plan sections (the three highest-demand),
with demographics as an inexpensive fourth.

### Guardrails

- **Roles.** Owners apply; Editors propose to the Owner; Viewers get advice-only chat (6a
  offers the preview tools to Owners and Editors). Enforced server-side; RLS is the backstop.
- **Fixed values.** Per-pupil funding rates, the benefits load and the authorizer fee have no
  tool. Startup funding stays Settings-only.
- **No silent edits.** Proposals appear only when the leader asks for a change; advice that
  implies one ends with "Want me to set that up?".
- **Unsaved edits.** If the leader has unsaved edits on a tab (`unsavedChanges.ts`), Apply
  warns before saving over them.
- **Untrusted text.** The editable-items list and titles are data, never instructions; a
  proposal comes only from the leader's own message.
- **AI plumbing.** All calls go through `anthropic-client.ts`; `aiStub.ts` streams expose
  `finalMessage()` like the SDK's. `PROMPT_VERSION` was not bumped for 6a: it keys the advisory
  cache, and neither the advisory prompts nor the context it hashes changed.

### Done when

- 6a (done): a request yields a correct diff and engine impact in the card for all five change
  kinds; out-of-range, unknown or ineffective changes are corrected or explained; offline tests
  cover parsing, validation, applying, the preview and the stream marker.
- 6b–6e: applied changes match what the editor tab would save, appear in the change log, undo
  cleanly, refresh scenario and advisory staleness; only Owners can apply via UI or API; an
  Editor's request reaches the Owner's inbox and indicator. Live-harness check of each step
  against a branch build before merge.

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
