# SchoolLaunch — Claude Code Context

## Project Overview

SchoolLaunch is a Washington State charter school financial planning SaaS. Founders model their school's finances across staffing, revenue, operations, and multi-year projections, then receive AI-powered advisory analysis against the WA Charter School Commission's Financial Performance Framework (FPF).

- **Live**: schoollaunch.vercel.app
- **Stack**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Supabase (Postgres + Auth + Storage + RLS), Anthropic API (one model constant, `AI_MODEL` in `src/lib/anthropic-client.ts`, currently `claude-sonnet-5-5`), Vercel
- **Supabase project**: nlvlrznhiwuorxlapnej

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `organizations` | Organization-level grouping |
| `schools` | School records (name, org_id, status) |
| `school_profiles` | Demographics, enrollment, financial_assumptions (JSONB), advisory_cache (JSONB), logo_url |
| `user_roles` | Multi-user access: user_id + school_id + role (school_ceo, school_editor, school_viewer, org_admin, super_admin) + display_name, tour_completed |
| `staffing_positions` | 27 Commission-aligned position types with salary, FTE, year, classification, driver |
| `budget_projections` | Revenue and expense line items per school per year |
| `grade_expansion_plan` | Grade-by-grade expansion with sections, students_per_section, retention |
| `invitations` | Email invitations with token, role, school_id, expiration |
| `alignment_reviews` | AI-generated alignment review results |
| `org_notes` | Organization-level notes |

### Scenarios Table (Sandboxed)

The `scenarios` table is an **isolated sandbox** — changes here never modify budget_projections, staffing_positions, school_profiles, or any other table.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | uuid | gen_random_uuid() | Primary key |
| `school_id` | uuid | — | FK to schools (NOT NULL) |
| `name` | text | — | 'Conservative', 'Base Case', or 'Optimistic' (NOT NULL) |
| `is_base_case` | boolean | false | Legacy flag for old scenario slider |
| `assumptions` | jsonb | '{}' | 5 lever values (enrollment_fill_rate, per_pupil_funding_adjustment, personnel_cost_adjustment, facility_cost_monthly, startup_capital) |
| `results` | jsonb | null | Computed 5-year projections with FPF compliance per year |
| `ai_analysis` | text | null | Cached AI scenario comparison narrative |
| `scenario_type` | text | 'base_case' | 'base_case' (legacy) or 'engine' (new scenario engine) |
| `base_data_hash` | text | null | Hash of school's base data for staleness detection |
| `is_active` | boolean | true | Soft delete flag |
| `created_at` | timestamptz | now() | Creation timestamp |
| `updated_at` | timestamptz | now() | Last modification timestamp |

### Storage

- **Bucket**: `school-logos` (public read, CEO-only write via RLS)
- **Path pattern**: `{school_id}/logo.{ext}`

### RLS Policies

All tables have RLS enabled. Data tables use split policies:
- **SELECT**: All school-linked roles (ceo, editor, viewer) + org_admin via organization join
- **INSERT/UPDATE/DELETE**: school_ceo and school_editor only
- **Viewers** are read-only at the database level
- **user_roles**: "users see own role" + "ceo sees school team" (uses SECURITY DEFINER function to avoid circular RLS)

## Dashboard Structure

Left sidebar with 12 tabs in 4 groups:

**Planning**: Overview, Revenue, Staffing, Operations
**Projections**: Cash Flow, Multi-Year, **Scenarios**
**Assessment**: Ask SchoolLaunch, Advisory Panel, Alignment Review, Commission Scorecard
**Settings**: Settings

## Key Architecture

### Financial Calculation Engine

- `src/lib/calculations.ts` — Revenue model: `calcCommissionRevenue()` with 14 line items (Regular Ed, SPED, State SPED, Facilities, Levy Equity, Title I, IDEA, LAP, LAP High Poverty, TBIP, HiCap, Food Service Rev, Transportation Rev, Interest)
- `src/lib/budgetEngine.ts` — Multi-year projections: `computeMultiYearDetailed()`, `computeFPFScorecard()`, `computeCarryForward()`, `computeSummaryFromProjections()`
- `src/lib/types.ts` — `FinancialAssumptions`, `SchoolProfile`, `DEFAULT_ASSUMPTIONS`, 27 `COMMISSION_POSITIONS`

### Financial Constants

- WA charter fiscal year: September 1 – August 31
- Benefits load: 30% (SEBB + FICA)
- Salary escalator: 2.5% annually
- Revenue COLA: 3% annually
- Operations escalator: 2% annually
- Authorizer fee: 3% of state apportionment (non-negotiable)
- OSPI payment schedule: Sep 9%, Oct 8%, Nov 5%, Dec 9%, Jan 8.5%, Feb 9%, Mar 9%, Apr 9%, May 5%, Jun 6%, Jul 12.5%, Aug 10%

### Scenario Engine

Sandboxed modeling environment at `/dashboard/scenarios`. Pulls base case data as starting point but all changes are isolated to the `scenarios` table.

**5 Financial Levers:**
| Lever | Range | Type |
|-------|-------|------|
| Enrollment Fill Rate | 70%–100% | Slider (percentage) |
| Per-Pupil Funding Adjustment | -10% to +5% | Slider (percentage) |
| Personnel Cost Adjustment | -10% to +15% | Slider (percentage) |
| Monthly Facility Cost | $0–$50,000 | Number input (currency) |
| Startup Capital | $0–$1,000,000 | Number input (currency) |

**3 Named Scenarios** per school: Conservative, Base Case, Optimistic — with smart defaults derived from the school's actual financial data.

**Key files:**
- `src/lib/scenarioEngine.ts` — Applies lever adjustments to base case data, then runs through `computeMultiYearDetailed` + `computeFPFScorecard`
- `src/app/api/scenarios/seed/route.ts` — POST: creates 3 scenarios with defaults
- `src/app/api/scenarios/calculate/route.ts` — POST: computes 5-year projections for one or all scenarios
- `src/app/(authenticated)/dashboard/scenarios/page.tsx` — Full scenario UI with lever controls, 3-column comparison, FPF compliance, AI analysis

**Integrations:**
- Overview page: Scenario Summary card with Reserve Days + FPF badges per scenario
- Budget Narrative PDF: Scenario Analysis section with comparison table + AI narrative
- Commission Excel export: SCENARIOS tab with assumptions, projections, and FPF matrix

### Advisory System

7 AI agents (Commission Reviewer, Enrollment Realist, Staffing Advisor, Compliance Officer, Operations Analyst, Board Finance Chair, SchoolCFO Advisor) + synthesized briefing.

**Key architecture decisions:**
- `buildAgentContextString()` — Summarized context for agents with pre-computed metrics as prose (no raw data that enables recomputation)
- `buildSchoolContextString()` — Full context for briefing synthesis and Ask SchoolLaunch chat
- `useAdvisory()` (`src/hooks/useAdvisory.ts`, rules in `src/lib/advisory.ts`) — the one advisory hook for the Overview briefing card and the Advisory Panel: same context (incl. Alignment Review findings), same cache, same staleness check
- Advisory cache: `school_profiles.advisory_cache` (JSONB) — `useAdvisory` queries Supabase directly on mount to get latest cache
- Cache invalidation: `advisoryDataHash()` = `computeAdvisoryHash()` (stable hash from rounded financial metrics) plus the latest Alignment Review id when one exists
- Failed agents are flagged (`failed: true`) by `/api/advisory` and shown as Unavailable; a panel with failures never replaces a complete cached panel
- Generation is for owners/editors only (also enforced by the API route); viewers read the cached panel
- Agents receive pre-computed Days of Cash value — never compute independently

### Multi-User Collaboration

- Roles: school_ceo (Owner), school_editor (Editor), school_viewer (Viewer), org_admin, super_admin
- `SchoolSessionProvider` (`src/contexts/SchoolSessionContext.tsx`, rules in `src/lib/schoolSession.ts`) resolves user, roles, current school, role there and pathway once; `useSchoolData`, `usePermissions`, `useStateConfig`, the Sidebar and the tour all read it — never add another `user_roles` lookup in a dashboard hook
- Current school: switcher selection if still a member → CEO school → newest membership. Role: the role at that school, else newest org-level role. Admin portfolio uses the newest org-level role (`orgRoleRow`)
- `usePermissions()` hook provides: canEdit, canManageTeam, canResetSchool, canEditIdentity, canExport, canUseAI
- Viewers get read-only access across all tabs (disabled inputs, hidden Save/Add/Delete buttons)
- Team management: `/api/team/invite`, `/api/team`, `/api/team/[userId]`
- School switcher for multi-school users via sessionStorage (`sl_selected_school`)
- Invitation acceptance supports both new users (create account) and existing users (sign in & join)

## Completed Features

- Full revenue model with 14 line items including Food Service (NSLP) and Transportation (State) revenue
- 27 Commission-aligned staffing positions with driver-based scaling
- 13 operations categories flowing through multi-year engine
- 5-year multi-year projections with grade expansion support
- Commission FPF Scorecard (8 metrics × 5 years with Stage 1/Stage 2 thresholds)
- Monthly cash flow projections using OSPI apportionment schedule
- 7-agent AI advisory panel with synthesized briefing and caching
- Enhanced Scenario Engine with 5-lever modeling, 3-scenario side-by-side comparison, FPF compliance checks, AI analysis, responsive mobile layout, PDF and Excel export integration
- Multi-user collaboration with role-based permissions (Owner/Editor/Viewer)
- School logo upload via Supabase Storage
- Guided tour system with per-tab walkthroughs
- Budget Narrative PDF and Commission Excel exports
- Alignment Review (document upload + AI analysis)
- Ask SchoolLaunch AI chat with full financial context

## Development Notes

- **Git pushes** — Claude commits and pushes on Travis's behalf; no review is needed before pushing
- **Roadmap** — `ROADMAP.md` holds the phased dashboard plan and each phase's status; "start phase N" refers to it. Update it when a phase ships
- **Live tests** — `tests/live/harness.cjs` drives a real browser against production read-only (writes and AI calls blocked unless allowed); see `tests/live/README.md`. To check an unmerged branch the same way, run `next dev` with a git-ignored `.env.local` holding the project URL and anon key, and set `LIVE_BASE_URL=http://localhost:<port>`
- **AI calls** — every route goes through `src/lib/anthropic-client.ts`: model `AI_MODEL`, retries, `responseText` / `responseJson` (replies can open with thinking blocks; a refusal throws `AIRefusalError`). Effort (`output_config.effort`) is the latency/cost control; JSON replies use structured outputs (`output_config.format`). Changing the model or a prompt means bumping `PROMPT_VERSION` in `buildSchoolContext.ts`
- **CI and lint** — `.github/workflows/ci.yml` runs both typechecks, `npx eslint .` (kept at zero findings) and the offline suite; never the live/e2e suites
- **Proxy** — `src/proxy.ts` (Next.js 16's name for middleware) refreshes the Supabase session and runs the auth and onboarding redirects (`src/lib/supabase/middleware.ts`)
- **Startup funding** — edited only in Settings → Startup Funding (`StartupFundingEditor`); other tabs summarize and link there
- **Line items** — tables that list lines under an engine total build them with `src/lib/lineItems.ts`, so the lines sum to the total
- **Position catalog** — `COMMISSION_POSITIONS` (types.ts) is the one WA catalog: salaries, default drivers (`defaultDriver` in positionTypes.ts), students per position
- **Colors / contrast** — `globals.css` `@theme` darkens Tailwind's slate-400/500, teal-500/600/700, emerald-600/700 and amber-600/700 so text passes WCAG AA on light surfaces; dark surfaces (Sidebar) pin lighter grays explicitly. Don't fade text with `opacity-*`; check new pages with `@axe-core/playwright`
- **Charts** — hand-rolled SVG in `src/components/charts/`, data shaped in `src/lib/chartData.ts` from engine output; series hues from `SERIES` in `chartUtils.ts`, status hues only from `healthThresholds.ts`
- **Editor tabs** — register unsaved edits with `useUnsavedChanges` (or `useSavedSnapshot` for state that doesn't compare directly to the stored shape) and show `UnsavedIndicator` beside Save; the app-wide leave guard is `src/lib/unsavedChanges.ts`
- **Supabase MCP** — Use for all schema inspections and migrations (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). Any SQL containing `DELETE` (even inside a function body) or `DROP` is held for a confirmation that cloud sessions can't see and times out after 60 s — for those, commit the migration file, ask Travis to run it in the Supabase SQL editor, then verify it and record it in `supabase_migrations.schema_migrations`
- **Advisory caching** — `useAdvisory` (shared by Overview and Advisory) queries Supabase directly for `advisory_cache` on mount (not from React state) to avoid stale-cache bugs
- **useSchoolData** — Loads the current school from `SchoolSessionProvider` (multi-school users pick via sessionStorage `sl_selected_school`)
- **Scorecards** — read `fpfScorecard` / `genericScorecard` from `useScenario()`; don't recompute them in pages
- **All `.single()` calls on user_roles replaced** with multi-row queries to support users with roles at multiple schools
- **Replacing a school's rows** (staffing_positions, grade_expansion_plan) — use `src/lib/atomicReplace.ts`, never a client-side delete-then-insert; it calls transactional RPCs with a safe fallback
