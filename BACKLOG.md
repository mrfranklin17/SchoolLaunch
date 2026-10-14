# SchoolLaunch Backlog

Living list of known product, UX, and test-infra issues that are **not blocking
shipping** but need a home so they don't get lost. New items land here with a
status, context, and proposed fix — work gets promoted into a session plan or
audit when it's time to address them.

## Status legend

| Status          | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| `OPEN`          | Reproducible, root cause unknown or not yet investigated         |
| `INVESTIGATING` | Actively being diagnosed; has an owner or is in a session plan   |
| `DEFERRED`      | Root cause understood, fix intentionally postponed (low impact)  |
| `RESOLVED`      | Fixed — keep the entry until the next backlog cleanup pass       |

Entries stay under their category and are dated (`Opened: YYYY-MM-DD`) so the
list stays interpretable as the project ages.

---

## Product / UX

### P-UX-01 · Revenue tab: numeric input edits don't persist across reload
**Status:** `RESOLVED` · **Opened:** 2026-04-21 · **Source:** Cedar Ridge E2E, Phase 8
**Resolved:** 2026-10-12 — Root cause: the input was the Revenue tab's **Override**
column, which lived only in component state (`useState({})`). It was never saved
and never reached the engine, so it changed the tab's own totals while Overview,
Multi-Year, the Scorecard and both exports ignored it, and it vanished on reload.
Fix (Phase 1): the Override column is removed. Every per-pupil rate is now editable
in Settings → Revenue Assumptions — Title I, IDEA, LAP, TBIP and Highly Capable
rates were added there (they were the only lines with no persisted rate input) —
and those rates flow through `calcCommissionRevenue` into every tab and export.
Food/transportation revenue rates stay in Settings → Operations Benchmarks;
revenue the template doesn't list goes in Custom Revenue Lines. The Revenue page
subtitle links to Settings. Review follow-ups shipped with it: Settings now shows the
rates the engine actually uses (`getAssumptions`), saves write an `assumptions_version`
marker so the value-based remaps of retired defaults (LAP 690/400, HiCap 625/500,
IDEA 2200, …) stop overriding a founder's explicit entry, and the five new rates had to
be > $0 until Phase 2 made $0 meaningful (see P-UX-26). Phase 8 of `full-founder-journey.spec.ts` still edits
"the first number input" on Revenue — retarget it at a Settings rate input before
unskipping (see the comment above `PHASES_8_PLUS_SKIPPED`'s Phase 8 block).

A founder on `/dashboard/revenue` edits the first numeric input (per-pupil
override), the change appears to save (no error toast, Save button resolves),
but after `page.reload()` the input reads back empty — not the original value,
not the edit, literally empty. Playwright assertion:

```
Expected: "1"
Received: ""
```

**Candidate root causes (not yet eliminated):**
1. Autosave hasn't completed its round-trip before reload — race.
2. `input[type="number"]` locator identity drifts on rehydrate; the test is
   reading a different element than it wrote.
3. The field re-derives from source data on mount, discarding the override.

**Proposed next step:** open the page manually, edit a numeric input, reload,
inspect network panel during save + on rehydrate, and the React tree to see
whether the field is controlled by persisted state or a derivation.

**Test impact:** Phase 8 is currently skipped in `full-founder-journey.spec.ts`
via `PHASES_8_PLUS_SKIPPED`. Unskipping gated on this being root-caused.

---

### P-UX-02 · Joyride guided tour auto-launches on first dashboard visit
**Status:** `RESOLVED` · **Opened:** 2026-04-21 · **Resolved:** 2026-10-14 · **Source:** Cedar Ridge E2E, Phase 7
**Resolution:** The tour already auto-starts only right after onboarding completion (`?onboarding=complete` or the `onboarding_just_completed` flag), and a click on its overlay closes it. Now leaving the page a tour started on ends it (`TourRunner.tsx`; an abandoned overview counts as seen and never re-launches), so the overlay can't cover another tab, and `?skipTour=1` suppresses the auto-start for tests.

`react-joyride` renders a full-page overlay (`data-test-id="overlay"` inside
`#react-joyride-portal`) that intercepts pointer events. Any click on the
dashboard — including sidebar tab links — hangs on "subtree intercepts pointer
events" until the overlay is dismissed.

The E2E test currently masks this via a `dismissJoyrideIfPresent(page)` helper,
but that's a band-aid — real founders on slow connections have hit the same
race (overlay renders before hydration completes, user clicks through it, tour
state is lost mid-flight).

**Proposed fix (pick one, probably 1 + 3):**
1. Gate auto-launch on a `tour_completed`-style signal that flips to `true`
   the first time the user interacts with ANY sidebar link.
2. Add `?skipTour=1` query param and an env-gated test hook so E2E doesn't
   need the helper.
3. Lower the overlay's `z-index` / disable pointer intercept on the sidebar
   region so navigation works even when the tour is visible.

**Test impact:** Phases 8–13 (sidebar-heavy) currently skipped — flakiness
risk from overlay races. Unskipping gated on this being resolved.

---

### P-UX-03 · Staffing: position "driver" field not editable from UI
**Status:** `RESOLVED` · **Opened:** 2026-04-21
**Resolved:** 2026-05-12 — Driver badge on the Staffing tab
(`src/app/(authenticated)/dashboard/staffing/page.tsx`) is now a clickable
button toggling between the position's catalog-default per-pupil variant
and `fixed`. When `driver !== 'fixed'`, Y2-Y5 FTE inputs render disabled
with a tooltip pointing the user back at the badge. Toggling fixed →
per-pupil re-runs `computeSmartFte` to re-derive Y2-Y5; toggling per-pupil
→ fixed preserves existing FTE values intact. Engines unaffected —
`driver` is UI-scoped (zero references in `budgetEngine.ts` or
`scenarioEngine.ts`). Tour copy at `data-tour="driver-column"` updated to
mention the click-to-switch affordance.

**Related latent fix bundled:** the multi-year fill `.find` in the
Staffing page's useEffect rebuild (`staffing/page.tsx:366-368`) previously
matched DB rows on `position_type || title` only, so schools with multiple
positions of the same type (e.g., Cascade Charter Elementary's 4
paraeducators all at year=1) collapsed all Y2-Y5 values to the FIRST
matching row. Fixed by adding `ap.sort_order === p.sort_order` to the
match key. Self-heals on next save; no data migration needed.

**Follow-ups logged:** P-UX-07 (status enum display), P-UX-09
(driver-variant catalog drift), P-UX-10 (paraeducator Y1 minimum drift),
T-INFRA-05 (E2E driver toggle coverage).

Each of the 27 Commission-aligned positions has a `driver` column
(enrollment-based, section-based, fixed, etc.) that determines how the
position scales across years in the multi-year projection. The driver was
seeded from `COMMISSION_POSITIONS` in `src/lib/types.ts` and was not
exposed in the Staffing tab UI — founders couldn't override it even when
their school's staffing model intentionally differed (e.g., a dean
position that should scale with sections, not enrollment). Surfaced as a
real user bug when a founder reported Y2/Y3 paraeducator FTE values
reverting to formula output after entry.

**Original proposed fix (superseded by the shipped click-to-override
badge):** surface `driver` as an inline dropdown on the staffing row,
with the default value pre-selected and a warning tooltip when the
founder deviates from the Commission default ("Commission models this
role on enrollment — override only if your staffing plan justifies").

---

### P-UX-04 · `GradeExpansionEditor`: students-per-section input rendered in 3 places
**Status:** `DEFERRED` · **Opened:** 2026-04-21 · **Source:** noted in
`full-founder-journey.spec.ts` header comment

`src/components/onboarding/GradeExpansionEditor.tsx` renders the SPS value in:

1. A "consistent class size" input gated by a checkbox (lines 347 / 362).
2. Per-grade inputs in the "Year 1 Grade Configuration" founding table
   (line 400).
3. Per-grade inputs in the "Grade Expansion Plan" full timeline table
   (line 513).

Tables 2 and 3 both edit Year 1 rows — overlapping overrides on the same
`planOverrides` Map keyed by `${year}-${grade}`. A founder who edits Y1
in Table 2, then opens Table 3 and edits it again, will see their first
change silently replaced. Conversely, checking "consistent class size"
masks per-grade edits without warning.

**Deferred because:** no reported user confusion in onboarding sessions; the
most common flow (WA charter defaults at 24) skips this surface entirely.

**Proposed fix (when picked up):** collapse to a single source of truth —
probably Table 2 — and render Tables 1 and 3 as read-only projections of
that state, or gate them behind an "override Y1" toggle that clearly
signals which surface wins.

---

### P-UX-05 · Settings → Danger Zone: copy + CTA labels inconsistent
**Status:** `RESOLVED` · **Opened:** 2026-04-21
**Resolved:** 2026-04-21 — Dialog body rewritten, confirm button changed to "Reset School Data", name-typing confirmation retained. See commit touching `src/app/(authenticated)/dashboard/settings/page.tsx`.
The in-app Danger Zone is a RESET (clears school financial data, routes the
user back to `/onboarding`), not a DELETE. The current copy and button
labels don't make that distinction clearly:

- Trigger button: "Reset School… start over" (ambiguous — sounds like delete)
- Modal header: references "permanently" in some paths
- Confirm button: "Reset School Data" (clear) vs historical "Permanently
  Reset" (implies deletion)

Founders have misread this as "delete my school" during live demos. Hard
deletion is service-role-only by design; the UI surface should make that
contract explicit.

**Proposed fix:** rename trigger to "Reset School Data", drop
"permanently" language, and add a one-line explainer under the button
("Clears financial data and returns you to onboarding. Your account and
school record are preserved.").

---

### P-UX-06 · `StepIdentity`: opening-year dropdown is a rolling 4-year window
**Status:** `RESOLVED` · **Opened:** 2026-04-21 · **Resolved:** 2026-10-14
**Resolution:** Onboarding offers this year and the next five, plus the saved year when it falls outside that window (`openingYearOptions`, `src/lib/openingYears.ts`). Settings already used a number input.

`src/components/onboarding/StepIdentity.tsx:13` derives the opening-year
options as:

```ts
const YEARS = Array.from({ length: 4 }, (_, i) => currentYear + i)
```

This rolls forward every calendar year. A founder who picks year `N+3`
and comes back 18 months later will find that value no longer in the
dropdown — the field silently resets or shows a stale selection with no
matching option.

**Deferred because:** impact is narrow (founders typically complete
onboarding within weeks, not years) and the E2E test works around it by
selecting `currentYear + 1`.

**Proposed fix:** when loading a saved school profile, union the saved
`opening_year` into `YEARS` so the user's existing choice is always
representable. Optionally widen the default window to 6 years forward.

---

### P-UX-07 · Startup funding status dropdown shows raw lowercase enum
**Status:** `RESOLVED` · **Opened:** 2026-05-12 · **Resolved:** 2026-10-14
**Resolution:** `FUNDING_STATUS_LABELS` (`src/lib/fundingLabels.ts`) labels the status options and badges: Received, Pledged, Applied, Projected, N/A. Stored values unchanged.

The status `<select>` on both the Revenue tab editor
(`src/app/(authenticated)/dashboard/revenue/page.tsx:586-593`) and the
onboarding Step 5 startup-funding row
(`src/components/onboarding/StepOperations.tsx:610-617`) renders the raw
lowercase enum values (`received | pledged | applied | projected | n/a`)
as option labels. The two editors were aligned to lowercase as part of the
2026-05-12 startup-funding discoverability fix so they matched, but the
founder-facing display should be Title Case
(`Received | Pledged | Applied | Projected | N/A`) for readability.

**Proposed fix:** add a `FUNDING_STATUS_LABELS` map (raw → Title Case) and
render `<option value={raw}>{LABEL[raw]}</option>` on both surfaces.
Display only — no data migration. Low priority, polish.

---

### P-UX-08 · Settings-as-canonical home for startup funding sources
**Status:** `RESOLVED` · **Opened:** 2026-05-12 · **Resolved:** 2026-10-14
**Resolution:** `StartupFundingEditor` (`src/components/dashboard/`) is the one editor, in Settings → Startup Funding (`#startup-funding`, its own Save, unsaved-changes guard, read-only for viewers). The Revenue tab shows a summary with a link; Cash Flow and Multi-Year link to Settings. Settings scrolls to a `#hash` section after loading.

The Revenue tab is the canonical post-onboarding editor for startup
funding sources today
(`src/app/(authenticated)/dashboard/revenue/page.tsx:510-682`). On
2026-05-12 a discoverability fix shipped on top of it: `id="startup-grants"`
anchor added, Cash Flow empty-state replaced with a primary-button `<Link>`,
footer note linkified, helper text added for the Y0 requirement. This
resolved the reported founder bug (couldn't assign funding to pre-opening
expenses because no sources existed). Phase 2 — extract a shared editor
and make Settings the canonical home — was deferred.

**Phase 2 work:**
1. Extract `<StartupFundingEditor>` from the inline Revenue-tab block into
   a reusable component
   (`src/components/dashboard/StartupFundingEditor.tsx`).
2. Add a Settings section "Startup Funding" between Programs and Revenue
   Assumptions, rendering the extracted editor.
3. Add a Cash Flow inline "Manage funding sources" modal wrapping the same
   editor; parent `reload()` refreshes the dependent dropdowns on close.
4. Retire the inline editor on the Revenue tab; leave a deep-link pointer
   ("Manage in Settings → Startup Funding").

**Deferred because:** the discoverability fix already resolves the reported
founder bug. Settings-as-canonical is structural cleanup, not a
user-blocking issue. Medium priority, post-RFP.

---

### P-UX-09 · Dead driver-variant catalog drift in `COMMISSION_POSITIONS`
**Status:** `RESOLVED` · **Opened:** 2026-05-12 · **Resolved:** 2026-10-14 · **Source:** P-UX-03 follow-up
**Resolution:** Option (a). `COMMISSION_POSITIONS` drivers now match the Staffing tab (teachers `per_pupil`; SPED teacher and assistant principal `fixed`), the tab reads them from the catalog (`defaultDriver`, `positionTypes.ts`), and the per-band variants are gone from the WA catalog. Generic pathway configs keep theirs (onboarding still reads them).

`COMMISSION_POSITIONS` (`src/lib/types.ts:241-273`) encodes four per-pupil
driver variants — `per_pupil_elem`, `per_pupil_ms`, `per_pupil_hs`,
`per_pupil_sped` — that are dead. The Staffing page's `POSITION_DRIVER`
map (`src/app/(authenticated)/dashboard/staffing/page.tsx:66-100`)
collapses all three teacher types to plain `per_pupil`, and the SPED
teacher to `fixed`. `computeSmartFte` does not branch on the variants.
`DRIVER_LABELS` (staffing/page.tsx:199-204) exposes only `fixed`,
`per_pupil`, `per_pupil_sped`, and `per_pupil_el`.

**Decision needed:** either
(a) Prune the dead variants from `COMMISSION_POSITIONS` to match the
    UI-canonical mapping (cleanup, lower-risk), or
(b) Wire the variants through `computeSmartFte` so elem/ms/hs/sped
    scale differently (new feature; requires defining the scaling math
    and updating the seed route).

**Why it matters:** the drift becomes user-visible the moment driver
becomes a `<select>` with all variants exposed (the "full" P-UX-03
follow-up Option C). Until then it's a maintenance-only smell. Medium
priority — decision required before any expanded driver-editor work.

---

### P-UX-10 · Y1 paraeducator FTE minimum drift between seed and dashboard
**Status:** `RESOLVED` · **Opened:** 2026-05-12 · **Resolved:** 2026-10-14 · **Source:** P-UX-03 follow-up
**Resolution:** `computeSmartFte` never lowers Year 1, so the only path below the floor was switching a row to paraeducator (it kept the row's FTE, often 1). That now starts at `PARAEDUCATOR_MIN_FTE` (2), the constant the seed route also uses.

The staffing seed route (`src/app/api/staffing/seed/route.ts:42-51`)
enforces a Y1 paraeducator FTE minimum:
`Math.max(2, round(enrollment / 48 * 2) / 2)`. The staffing-page formula
`computeSmartFte`
(`src/app/(authenticated)/dashboard/staffing/page.tsx:213-250`) does not.

**Effect:** a paraeducator seeded at Y1=2 stays there as long as the user
never touches the cell. But any user interaction that re-runs
`computeSmartFte` — type-dropdown change, toggle to fixed and back
(P-UX-03 fix path), or a useEffect rebuild — can derive a Y1 value below
2 if Y1 enrollment is small.

**Proposed fix:** align `computeSmartFte`'s paraeducator branch to apply
the same `Math.max(2, …)` floor that the seed uses. One-line change at
line ~244. Low priority, consistency cleanup.

---

### P-UX-11 · Dashboard crashes when `startup_funding` JSON has unexpected shape
**Status:** `RESOLVED` · **Opened:** 2026-05-22 · **Resolved:** 2026-10-14 · **Source:** V11 Cedar Grove validation, Session 1
**Resolution:** Fixed in 01cf828 (canonicalizer hardened against non-editor shapes); the engine side followed in P-UX-18 (b3bad8d). Pinned by `startup-funding-canonicalizer.spec.ts`.

Populating `school_profiles.startup_funding` via direct DB insert with shape
`[{id, name, amount, type, status, year_allocations: {y0..y4}}]` causes the
dashboard Overview to crash with:

```
TypeError: Cannot read properties of undefined (reading 'localeCompare')
  at canonicalizeProjectionInputs
  at computeAdvisoryHash
  at DashboardPage.useMemo[currentDataHash]
```

The error boundary catches it but the entire dashboard is unrenderable until
the column is reverted to `[]`. The user UI (Revenue tab Startup Funding editor)
writes a canonical shape and is presumably safe; this only surfaces for code
paths that build `startup_funding` JSON outside the editor — direct DB seeding,
future import features, backfill migrations, manual Supabase MCP edits during
support work.

**Root cause hypothesis:** `canonicalizeProjectionInputs` sorts startup_funding
items by a string field that doesn't exist on all valid JSON shapes the schema
accepts. The sort comparator calls `localeCompare` on `undefined`.

**Proposed fix (pick one, probably 1 + 3):**
1. Harden the sort comparator: guard `localeCompare` with `?? ''` or
   `String(x ?? '')`. Cheap, defensive.
2. Add a JSON schema validator on the column with a CHECK constraint.
3. Document the canonical shape in a TS type and add a runtime guard in
   `canonicalizeProjectionInputs` that throws a recognizable error if the
   shape is wrong, rather than crashing the dashboard render.

**Reference:** `tests/audit/v11-cedar-grove/SESSION_1_GAPS.md` §10.C

---

### P-UX-12 · Staffing tab inline title edit doesn't persist
**Status:** `RESOLVED` · **Opened:** 2026-05-22 · **Resolved:** 2026-10-13 · **Source:** V11 Cedar Grove validation, Session 1
**Resolved (Phase 4):** the title did save. On reload the tab re-typed every
`position_type = 'custom'` row from its title (`inferPositionType`), so a custom position
titled e.g. "Math Teacher" came back as the catalog "Classroom Teacher – Elementary", with the
catalog's name, driver and salary benchmark, and every custom position came back in the
Classified section. `'custom'` is ambiguous in the table: the Staffing tab saves a founder's
custom position with `students_per_position = 0`, while older untyped rows (onboarding API,
imports) carry the column defaults `'custom'` / 24 (live: 155 tab-saved custom rows in 8
schools, 166 untyped rows). `src/lib/positionTypes.ts` keeps tab-saved custom rows as custom
in their saved section and types only the untyped rows from their title, as before. Every
live tab-saved custom row loads exactly as it did before, apart from the bug case. Pinned in
`tests/session4/phase4-ux.spec.ts`.

On the dashboard Staffing tab, editing a position's title text via the inline
input does not save to the database. Salary and FTE numeric inputs on the same
row do save correctly. Combined with onboarding's grade-agnostic position
seeding (P-UX-13), this means founders can't rename a wrong-grade-band default
position — they have to delete the row and re-create it.

**Reproduction:**
1. Go to Staffing tab
2. Type a new title into the title input of any position row
3. Click Save Changes
4. Refresh — title reverts to original; salary/FTE changes from the same Save
   are persisted

**Proposed fix:** the title input is likely not wired into the row's dirty-state
or update mutation. Check whether the field is included in the patch payload
sent to Supabase. Probably a single line fix in the row form handler.

**Reference:** `tests/audit/v11-cedar-grove/SESSION_1_GAPS.md` §10.B and §6

---

### P-UX-13 · Onboarding Staffing step seeds 6 generic positions regardless of grade configuration
**Status:** `RESOLVED` · **Opened:** 2026-05-22 · **Resolved:** 2026-10-14 · **Source:** V11 Cedar Grove validation, Session 1
**Resolution:** Both seed builders (`staffingDefaults.ts`) add one teacher row per grade band in the opening grades (elementary, middle, high), with sections from the Year 1 grade plan or split by grade count; the old elementary default only applies with no grade information.

Onboarding's Staffing step seeds 6 default positions (CEO, Principal, Classroom
Teacher Elementary @ 10 FTE, SPED Teacher, Admin Assistant, Paraeducators @ 4 FTE)
regardless of which grades the school will serve or how many sections it plans.

Particularly problematic: "Classroom Teacher - Elementary @ 10 FTE" is seeded
for a 6-12 school that has no elementary grades. The user must delete the
default and re-add the correct teacher types. Combined with P-UX-12 (title
edits don't persist), users can't even rename the wrong-grade-band default.

**Risk:**
- Inflated personnel cost projections during onboarding from irrelevant default
  positions
- Users may not realize they need to delete defaults and end up with wrong
  personnel numbers downstream

**Proposed fix (pick one):**
1. Make seeded positions grade-aware: don't seed elementary teachers if no
   K-5 grades exist; seed HS teachers only when 9-12 grades exist.
2. Skip default seeding entirely; show an empty staffing table with "+Add
   Position" prominent.
3. Show a position-type picker during onboarding: "Which of these roles will
   you have in Year 1?" with checkboxes pre-populated based on grade
   configuration.

Recommend (3) — teaches the user the position taxonomy while letting them
opt in.

**Reference:** `tests/audit/v11-cedar-grove/SESSION_1_GAPS.md` §10.E

---

### P-UX-14 · Onboarding completion blanks for ~5 seconds without spinner
**Status:** `RESOLVED` · **Opened:** 2026-05-22 · **Resolved:** 2026-10-14 · **Source:** V11 Cedar Grove validation, Session 1
**Resolution:** A full-screen "Setting up your school…" status covers the form while completion runs; a guard stops double submits, and on failure the error banner (`role="alert"`) returns with a retry.

After clicking "Complete Onboarding", the screen goes blank with no visible
spinner or progress indicator for several seconds before redirecting to
`/dashboard`. The completion handler does substantial server-side work
(seeding budget projections, generating initial advisory cache, etc.), so the
delay is real — it just has no UI affordance.

**Risk:** user assumes the click failed, refreshes the page, potentially
triggering duplicate state writes or creating a confusing partial-completion
state.

**Proposed fix:** add a loading state to the Complete Onboarding button:
1. Inline spinner + disabled button until the redirect fires, or
2. Full-screen loading interstitial with "Setting up your school…" copy.

Recommend (2) — the user benefits from knowing substantial setup is happening.

**Reference:** `tests/audit/v11-cedar-grove/SESSION_1_GAPS.md` §10.F

---

### P-UX-15 · Default retention rate of 92% diverges from Commission V11's implicit 100%
**Status:** `RESOLVED` · **Opened:** 2026-05-22 · **Resolved:** 2026-10-14 · **Source:** V11 Cedar Grove validation, Session 1
**Resolution:** Option 1: kept the 92% default; the retention slider now says the Commission template has no retention input (every student returns), so it matches this model at 100%.

SchoolLaunch defaults `retention_rate` to 92% (set by R-ENR-01 fix on
2026-05-11). The Commission's V11 Long-Range Projection template has no
retention input — it implicitly assumes 100% retention (Y2 enrollment = Y2
target grade-buildout fill, no cohort attrition).

Result: a school using SchoolLaunch defaults will project lower Y2-Y5
enrollment than the same school's V11 model produces. For Cedar Grove:
- 92% retention: Y2 ~459, Y3 ~628, Y4 ~660, Y5 ~600 (approximation)
- 100% retention: Y2 480, Y3 690, Y4 780, Y5 780 (matches V11)

SchoolLaunch's 92% default is **more conservative and probably more honest**
than V11's implicit 100% — real charter schools experience attrition — but
the divergence means applicants comparing the two models see different
enrollment trajectories without understanding why.

**Proposed fix (pick one):**
1. Keep 92% default; add Settings copy noting that V11 / many authorizer
   templates implicitly assume 100%; let users adjust if they need to match.
2. Add a "Run as Stress Test" view: model at 100% by default for headline
   metrics, separately show "Stress test at X% retention" view.
3. Change default to 100% to match V11; force users to opt into attrition
   modeling.

Recommend (1) — don't downgrade the more-conservative default to match a
less-conservative template. Documentation is the right fix.

**Reference:** `tests/audit/v11-cedar-grove/SESSION_1_GAPS.md` §8

---

### P-UX-16 · Diagnose projSlice for the same canonicalizer brittleness P-UX-11 fixed
**Status:** `RESOLVED` · **Opened:** 2026-06-03 · **Resolved:** 2026-06-05 · **Source:** P-UX-11

**Resolution (P-UX-16 commit):** New shared value-preserving `canonicalizeBudgetProjections`
(`src/lib/budgetProjections.ts`) applied at the advisory hash `projSlice` boundary
(`buildSchoolContext.ts:80`), mirroring how `fundingSlice` layers on `canonicalizeStartupFunding`
(P-UX-18) and the pre-opening canonicalizers (P-UX-19) — but a DISTINCT `BudgetProjection` shape, so
a new canonicalizer (not reuse). COERCE semantics (not P-UX-19 DROP): drop only null/non-object
entries; coerce category/subcategory -> string (null -> ''), amount -> finite (non-finite -> 0); row
count stable, matching projSlice's existing keep-every-row-and-coerce behavior. Closes all three
failure modes — Mode 1 null/non-object element (`reading 'year'` throw at :82), Mode 2 null cat/sub
(`localeCompare` throw at :91/:92), Mode 3 non-finite amount (`Math.round(NaN)` -> JSON `null`,
silently corrupting both the djb2 hash and the |len discriminator). Strict no-op on canonical input:
`computeAdvisoryHash` byte-identical (WA `v3-2026-05|53ec6cd11605|ff272d0d|1599`, Generic
`...|85dcf73f|1561`) so NO cache invalidates. `budgetProjections.ts` deliberately EXCLUDED from
`ENGINE_HASH_FILES` (ENGINE_VERSION stays `53ec6cd11605` — advisory-only consumer, not engine math).
Engine untouched (computeCarryForward WA 350000 / Generic 120000; computeMultiYearDetailed /
computeGenericProjections 0 diff lines). Spec: `tests/session4/advisory-projslice-canonicalizer.spec.ts`
(8/8). Engine-side sibling logged as P-UX-22. This completes the canonicalization shape-defense thread
across both engine (P-UX-18/19) and advisory (P-UX-11/16) paths.
Reference: `tests/audit/v11-cedar-grove/P-UX-16-diagnosis.md`.

P-UX-11 hardened the fundingSlice pipeline in `canonicalizeProjectionInputs`
(`src/lib/buildSchoolContext.ts`) against non-canonical startup_funding shapes.
The sibling projSlice (same function, lines ~60-73) has a latent version of the
same bug: it sorts on `a.cat.localeCompare(b.cat)` / `a.sub.localeCompare(b.sub)`
where `cat: r.category` and `sub: r.subcategory` carry NO `?? ''` default (unlike
posSlice / gepSlice, which default their sort keys). A budget_projections row
with a missing/null category or subcategory would throw the same TypeError and
crash the same dashboard surfaces (Overview, Advisory, Scenarios).

Not fixed under P-UX-11 by decision: scope was held to the diagnosed
startup_funding vector, and projSlice uses a COMPOUND sort key
(`y -> rev -> cat -> sub`), not fundingSlice's single-key string sort, so the
P-UX-11 `coerceSource` helper does not transfer as a provably byte-identical
shared guard. budget_projections is editor/DB-controlled (category/subcategory
effectively always present today), so the risk is currently low.

**Proposed next step:** diagnose whether any seeding/import path (e.g. the
R-REV-03 OSPI line-item work) can write projection rows without category /
subcategory. If so, harden cat/sub with the same `?? ''` pattern posSlice/gepSlice
already use (a pure superset, byte-identical for valid input). Confirm against the
advisory-hash byte-identical guard before shipping.

**Reference:** `tests/audit/v11-cedar-grove/P-UX-11-diagnosis.md` §D3

---

### P-UX-17 · Cold-load editor hydration / Save data-loss guard (Revenue tab)
**Status:** `RESOLVED` · **Opened:** 2026-06-03 · **Resolved:** 2026-06-03 · **Source:** R-REV-03 build (integration)

The Revenue-tab editors (Startup Funding, and the new R-REV-03 Custom Revenue
Lines) initialized their `useState` from `profile`. On a COLD direct-load or
refresh of `/dashboard/revenue`, those initializers run during the loading-skeleton
render - before the async profile hydrates - so they captured empty / DEFAULT_SOURCES
state. Clicking Save then persisted that, overwriting real data: confirmed live that
the funding editor showed DEFAULT_SOURCES ($150k/$50k) instead of the school's actual
$350k CSP grant, so a cold-load Save was an active corruption bug. The warm path
(Overview -> Revenue via SPA nav) was unaffected because the profile was already loaded
at mount.

**Fix (this commit):** a single `hydrated` flag gates BOTH editors - Save/Add are
disabled until the profile loads - and one `useEffect` re-initializes both editors
from the loaded profile once `loading` flips false (guarded so post-Save reloads do
not clobber local edits). Warm-path behavior unchanged (hydrates on the first effect
tick at mount); cold load no longer presents a saveable empty/default state.

**Verification:** Playwright against test-columbia - warm nav renders the seeded
custom lines as before; a cold direct-load then Save no longer wipes the seeded
custom_revenue_lines or the real startup_funding grant.

**Reference:** `src/app/(authenticated)/dashboard/revenue/page.tsx`

---

### P-UX-18 · Engine crashes on malformed startup_funding (raw reader, sibling of P-UX-11)
**Status:** `RESOLVED` · **Opened:** 2026-06-04 · **Resolved:** 2026-06-04 · **Source:** overnight E2E Divergence #1

P-UX-11 hardened the advisory-hash canonicalizer, but the ENGINE reads RAW
`profile.startup_funding` and was never guarded. Three readers in `budgetEngine.ts`
iterate entries unguarded and throw on a null/non-object entry (direct DB seed / import /
backfill — the same threat model as P-UX-11): `computeCarryForward:107` (the actual first
crash site, `f.amount` on null — `Cannot read properties of null (reading 'amount')`),
`getGrantRevenueForYear:63`, and `getGrantAllocationsForYear:85`. Blast radius: every
engine-backed surface (Revenue, Overview, Multi-Year, FPF) crashes for that profile.

**Fix (this commit):** one shared, value-preserving `canonicalizeStartupFunding(raw):
StartupFundingSource[]` in `src/lib/startupFunding.ts` (drops null/non-object entries,
coerces `source`->string and `amount`->finite number, keeps `yearAllocations` only when a
plain object; strict no-op on canonical input). Called inside all three engine readers; the
advisory `fundingSlice` was refactored to layer its hash projection ON TOP of the same
function, so the two readers share ONE definition and `coerceSource` now lives there too.

**Verification:** new spec `tests/session4/startup-funding-engine-canonicalizer.spec.ts`
(8 tests): no-crash + finite + valid-grant-correct on malformed input; canonicalizer no-op +
idempotent + garbage-cleaning; BYTE-IDENTICAL guards pinned to pre-change baselines —
`computeCarryForward` (350000 / 120000), full `computeMultiYearDetailed` deep-equal, and
`computeAdvisoryHash` UNCHANGED (`ff272d0d|1599` WA, `85dcf73f|1561` Generic — cached
advisories not invalidated). Full pure session4 suite 148 green; tsc clean; overnight Half A
scenario 7b now passes (51/51).

**Reference:** `tests/audit/v11-cedar-grove/P-UX-18-diagnosis.md`

---

### P-UX-19 · computeCarryForward crashes on null pre_opening_transactions / pre_opening_expenses entries
**Status:** `RESOLVED` · **Opened:** 2026-06-04 · **Resolved:** 2026-06-04 · **Source:** P-UX-18 diagnosis (D3)

Same null-entry crash class as P-UX-18, different fields. In `computeCarryForward`
(`budgetEngine.ts:129-130`): `pre_opening_transactions.reduce((s, tx) => s + tx.amount, 0)`
and `pre_opening_expenses.reduce((s, e) => s + e.budgeted, 0)` read `.amount` / `.budgeted`
with no per-entry guard. A null entry (direct DB seed / import / backfill) throws
`Cannot read properties of null (reading 'amount')`; a non-finite numeric (e.g. `{amount:'x'}`)
silently string-concatenates to a masked NaN that wrongly triggers the budget fallback path.

**Fix (this commit):** two distinct value-preserving canonicalizers in `src/lib/preOpening.ts`
(`canonicalizePreOpeningTransactions`, `canonicalizePreOpeningExpenses` — NOT
`canonicalizeStartupFunding`; the shapes differ). Semantics: DROP entries that are
null/non-object/non-finite-numeric (no zero-coercion — a fabricated $0 line is its own
corruption); well-formed entries pass through byte-identical; idempotent. Both
`computeCarryForward` reads routed through them at the boundary. Advisory path NOT touched
(these fields are not in `computeAdvisoryHash`). Scope held to the engine reader per decision.

**Verification:** `tests/session4/pre-opening-engine-canonicalizer.spec.ts` (7 tests): malformed
inputs assert the actual carry-forward VALUE (null-throw -> 300000; masked-NaN -> 300000, was
wrongly 340001); no-op + idempotent; byte-identical pins (carry-forward WA 350000 / Generic
120000, `computeMultiYearDetailed` unchanged, `computeAdvisoryHash` unchanged). Full pure
session4 suite green; tsc clean; `npm run build` exit 0.

**Reference:** `tests/audit/v11-cedar-grove/P-UX-19-diagnosis.md`

---

### P-UX-20 · Remove parallel carry-forward / preOpenCash derivations; route all through computeCarryForward
**Status:** `RESOLVED` · **Opened:** 2026-06-04 · **Resolved:** 2026-06-04 · **Source:** P-UX-19 (scope decision)

The `multiyear/page.tsx` inline reader (~50-51) re-implements pre-opening carry-forward instead
of calling `computeCarryForward` — a single-source violation and, until rerouted, a null-entry
crash vector on malformed `pre_opening_transactions`/`pre_opening_expenses`. Fix: delete the
re-implementation, read from the canonical engine (made crash-safe by P-UX-19); the multiyear
crash closes as a consequence.

Diagnosis MUST grep for every site that derives carry-forward or preOpenCash WITHOUT calling
`computeCarryForward` (multiyear page, scorecard/advisory preOpenCash path, exports, anywhere).
This likely also explains overnight Divergence #2 (84-vs-88 DCOH gap between the cached advisory
and the `computeCarryForward`-derived preOpenCash); if the inventory finds a second preOpenCash
source feeding the scorecard, that resolves Divergence #2 directly. The cashflow editor read is
flagged here as a WRITER (editor path, outside the import/seed threat model) — confirm
read-vs-write in diagnosis; canonicalize only if it reads raw. Must land before R-REV-04 CSP
fixtures. Byte-identical proof required on multiyear displayed values across all four pathways.

**Reference:** `tests/audit/v11-cedar-grove/P-UX-18-diagnosis.md` (sibling crash classes)

**Resolution (P-UX-20 commit):** Inventory found the multiyear page already used `computeCarryForward`
for the total; only its *component* displays (year0Total, preOpenExpenses) were re-derived (with raw
`pre_opening_*` reads). The real independent formula was on `alignment/page.tsx` (`preOpeningNet=0` +
`Math.round(startupFunding*0.6)`). Fix: added `computeCarryForwardBreakdown()` (computeCarryForward
delegates to it; byte-identical), rerouted the multiyear components to read it (zero raw reads), and
rerouted alignment to `computeCarryForward` for both projections and scorecard. Alignment Review DCOH
Y1 corrected **44 → 88** (now matches Overview/scorecard). Cashflow editor confirmed writer/live-preview
(out of scope). **Divergence #2 = stale cache (iii)**, not a second source — explained in the diagnosis;
test-columbia's stale cache cleared. Reference: `tests/audit/v11-cedar-grove/P-UX-20-diagnosis.md`.

---

### P-UX-21 · Advisory cache must invalidate on engine-code changes (not just inputs + PROMPT_VERSION)
**Status:** `RESOLVED` · **Opened:** 2026-06-04 · **Resolved:** 2026-06-04 · **Source:** P-UX-20 (Divergence #2 root cause)

**Resolution (P-UX-21 commit):** Mechanism #2 (build-time engine content-hash). `scripts/gen-engine-version.cjs`
(npm `prebuild`, plain Node, LF-normalized sha256 of the 9 number-engine files) writes the committed
`src/lib/engineVersion.ts` (`ENGINE_VERSION`); `computeAdvisoryHash` now returns
`PROMPT_VERSION|ENGINE_VERSION|djb2|len`, so engine-math changes invalidate advisory caches AND
`scenarios.base_data_hash` (same function). Split: engine math = auto content-hash; prose/context =
PROMPT_VERSION (buildSchoolContext deliberately EXCLUDED from the hashed set). File list documented as
`ENGINE_HASH_FILES` in buildSchoolContext.ts; a test asserts parity with the gen script's list. Mismatch
behavior preserved (serve cached + Model-Changed banner; auto-generate only on no-cache) — no auto-recompute,
no API storm. One-time ship: the 7 existing v3 caches become 3-segment mismatches and flag stale on first
access (self-heal). Engine untouched (computeMultiYearDetailed/computeGenericProjections 0 diff lines).
Rejected #1 manual constant (forgettable — the original bug) and #3 git-SHA (busts every deploy).
Reference: `tests/audit/v11-cedar-grove/P-UX-21-diagnosis.md`.

`computeAdvisoryHash` (`src/lib/buildSchoolContext.ts`) hashes inputs + `PROMPT_VERSION` only. It does
NOT capture the engine-code version, so when engine math changes (e.g. the Jun-3 P-FIN-01/02 DCOH
rework + R-REV revenue changes moved test-columbia DCOH from 84 to 88), advisory caches with unchanged
inputs never invalidate and serve stale computed figures. This is the confirmed root cause of overnight
Divergence #2 (the May-12 cache served 84 while the live engine produced 88).

**Fix:** incorporate an engine-version token into `computeAdvisoryHash`. **Decision deferred to P-UX-21
diagnosis:** a manual `ENGINE_VERSION` constant (simple but fragile — easy to forget bumping) vs a
content-hash of the engine modules (`budgetEngine.ts` + deps; robust but needs a build-time/precomputed
hash since the hash runs in-browser). Must keep byte-identical hashing for a given engine version so
caches aren't needlessly busted within a release. Pairs with scenario staleness (`base_data_hash` uses
the same `computeAdvisoryHash`).

**Reference:** `tests/audit/v11-cedar-grove/P-UX-20-diagnosis.md` §Q3

---

### P-UX-22 · Engine readers throw on a null array element in budget_projections
**Status:** `RESOLVED` · **Opened:** 2026-06-05 · **Resolved:** 2026-10-14 · **Source:** P-UX-16
**Resolution:** `computeMultiYearDetailed` / `computeGenericProjections` read projections through `projectionRows()`, which drops null / non-object entries; valid rows pass through unchanged (a spec checks dirty and clean input give identical rows on both pathways). ENGINE_VERSION changed, as planned.

P-UX-16 hardened the advisory-path `projSlice` against malformed `budget_projections`
(`canonicalizeBudgetProjections`). The ENGINE-side readers remain raw: `computeMultiYearDetailed` /
`computeGenericProjections` filter projections via `.filter((p) => !p.is_revenue && p.category === '…')`
(e.g. `budgetEngine.ts:209, 212, 230, 304`). The equality comparisons are null-`category`/`subcategory`
SAFE (a null simply never matches a known category), so P-UX-16's Mode 2 is a non-issue here — BUT a
**null / non-object array element** would throw on `!p.is_revenue` (P-UX-16 Mode 1) at the engine
boundary. Same non-editor threat model (DB seed / import / backfill / CSP fixtures).

**Out of P-UX-16 scope by decision:** this is engine-scope. Hardening it touches an `ENGINE_HASH_FILES`
member (`budgetEngine.ts`), which would bump `ENGINE_VERSION` and invalidate advisory caches — a
deliberate, separately-reviewed event, not something to fold into an advisory-only shape-defense.

**Proposed next step:** at the `computeMultiYearDetailed` / `computeGenericProjections` projection
readers, drop null/non-object entries before the `.filter`/`.find` chains (a value-preserving guard:
canonical rows pass through byte-identical, so the WA 350000 / Generic 120000 carry-forward pins and
the multiyear deep-equal guards stay green). Confirm the engine-content-hash bump is expected and that
the cache-invalidation cascade is acceptable before shipping. Consider whether `canonicalizeBudgetProjections`
(advisory-only today) should be promoted into the engine readers too — if so it would JOIN the engine
hash set, which is the ENGINE_VERSION-bumping event to plan for.

**Reference:** `tests/audit/v11-cedar-grove/P-UX-16-diagnosis.md` §"Sibling found"

---

### P-UX-23 · Staffing / grade-plan saves could wipe all rows on a failed insert
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-12 · **Source:** dashboard review (Phase 1)

The Staffing tab, Settings → Grade Expansion and onboarding Step 2 saved by
DELETEing every row for the school, then INSERTing the new set as a separate
request. A failed insert (network drop, bad value, RLS) left the school with zero
staffing positions in all five years (or no grade plan) while the toast said
"changes not saved". Settings didn't check either error at all.

**Fix:** `src/lib/atomicReplace.ts` (`replaceStaffingPositions`,
`replaceGradeExpansionPlan`) calls two SECURITY INVOKER RPCs that delete + insert
in one transaction (`supabase/migrations/20261012120000_p1_atomic_replace_rpcs.sql`).
Until that migration is applied, the helper detects the missing function
(PGRST202 / 42883) and falls back to snapshot → delete → insert, re-inserting the
snapshot if the insert fails. Toasts now say whether the previous data survived.
Settings only replaces the plan after the profile save succeeds.

**Migration applied 2026-10-12** — run by Travis in the Supabase SQL editor (the
Supabase connector holds any statement containing `DELETE` for a confirmation that does
not reach cloud sessions, so `apply_migration` timed out). Verified live: both function
bodies match the file, SECURITY INVOKER, `search_path=public`, `anon` has no EXECUTE,
`authenticated`/`service_role` do; input validation and a no-op call behave as expected.
Recorded in `supabase_migrations.schema_migrations` as version `20261012120000`. The
RPC path is now the live save path; the fallback only runs if the functions go missing.
The RPCs fill missing keys with the live column defaults (verified against the live
table definitions).

The fallback also handles a lost response (postgrest-js status 0, empty code): it
counts the school's rows before deciding, so an insert that actually committed is not
"restored" into duplicates, and a delete that committed carries on to the insert.

**Tests:** `tests/session4/atomic-replace.spec.ts` (16 cases, fake client: RPC
success/failure, fallback success, rejected-insert restore, restore-fails, lost
insert/delete responses that did or didn't commit, read/delete failures, empty set). The migration SQL was also exercised against a PGlite replica
schema with Supabase-style roles + RLS (editor replace, school_id forcing, rollback on
bad row, viewer and cross-school rejection, anon denied, unique-key grade plan).

---

### P-UX-24 · Onboarding Step 4 and /api/onboarding/complete still delete-then-insert Y1 staffing
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-14 · **Source:** P-UX-23 follow-up
**Resolution:** Step 4 and `/api/onboarding/complete` write typed Year 1 rows through `replaceStaffingPositions` (`src/lib/onboardingStaffing.ts`), resending Years 2–5 unchanged in the same transaction. Budget projections are upserted on their unique key before stale Year 1 lines are removed; the new base scenario is inserted before the old one is deleted; a failed `startup_funding` upsert now stops completion with an error. Still not one transaction across staffing, projections and scenario (each step is safe and a retry converges); a single completion RPC would need a migration.

`saveStep4` in `src/app/(onboarding)/onboarding/page.tsx` and
`src/app/api/onboarding/complete/route.ts` (service role) still DELETE Year 1
`staffing_positions` and INSERT separately. Lower risk than P-UX-23 — the wizard
still holds the positions in memory, so a retry recovers — and their rows omit
`benchmark_salary` / `students_per_position` / `manual_override`, so moving them onto
`replace_staffing_positions` needs a Year-1-scoped variant (or a `p_year` parameter)
and a check of those columns' NOT NULL/defaults first. The complete route also
deletes and re-creates `budget_projections` Y1 rows and the base scenario
non-atomically; a single server-side RPC for the whole completion would close both.
Same area: `completeOnboarding` (client) ignores the error from its
`school_profiles` upsert of `startup_funding` / `custom_revenue_lines` before calling
the complete route, so a failed upsert lands the founder on a dashboard without
their startup funding and nothing says so.

---

### P-UX-26 · A $0 categorical/federal rate can't be represented
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-12 · **Source:** Phase 1 review (REV-1)
**Resolved:** Phase 2. `getAssumptions` now decides "0 means default" in one place: on a
row carrying the `assumptions_version` marker (every Settings save writes it) an explicit
$0 for State SPED, LAP, LAP High Poverty, TBIP, HiCap, Title I or IDEA is honored and
removes the line; a missing, null or non-numeric value, or a 0 on a legacy row without the
marker, still resolves to the default (no live row held a 0, so no school's numbers
moved). `calcCommissionRevenue` falls back only on `null`/`undefined` (`??`). Settings
drops the > $0 guard and rejects only negative rates; formula strings on the Revenue tab,
in the narrative PDF and in the AI context show the resolved rate as-is (the PDF also read
the wrong food/transportation keys and always printed $710/$560). Pinned in
`tests/session4/assumptions-version.spec.ts`.

`getAssumptions` (`!raw.x`) and `calcCommissionRevenue` (`x || default`) treat a $0
Title I / IDEA / LAP / TBIP / HiCap rate as "missing" and substitute the default, so a
saved $0 would be silently ignored. Phase 1 therefore rejects a non-positive value for
those five rates at Settings save time. To support $0 (e.g. a founder excluding
Title I in Year 1): switch those checks to `== null` / `??` in `types.ts` and
`calculations.ts` and in the Revenue-page / narrative-export formula strings.
`calculations.ts` is an `ENGINE_HASH_FILES` member, so this bumps ENGINE_VERSION and
marks every cached briefing stale — bundle it with Phase 2's engine consolidation,
which bumps it anyway.

---

### P-UX-25 · Silent save failures on Revenue, Operations, Scenarios and logo upload
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-12 · **Source:** dashboard review (Phase 1)

These writes ignored Supabase errors, so a failed save looked successful until the
next reload: Revenue → Custom Revenue Lines and Startup Funding; Operations →
Facility Financing and Custom Expense Lines; Scenarios → lever changes; Settings →
logo upload/remove. All now check the error and show a persistent error toast (or the
logo component's inline error); successful saves show "Saved". Scenario lever saves
also used ONE debounce timer for all three scenarios, so adjusting two scenarios
within 500 ms silently dropped the first save — timers are now per scenario, and a
failed recalculation offers a Recalculate action. Logo upload now uploads the new
file before deleting old ones, and only deletes stale files after the profile points
at the new logo (previously a failed upload left the school with no logo).

---

## Test Infrastructure

### T-INFRA-01 · No isolated Supabase test environment
**Status:** `DEFERRED` · **Opened:** 2026-04-21

`full-founder-journey.spec.ts` hits the live Supabase project
(`nlvlrznhiwuorxlapnej`) and the live Anthropic API. Every run:

- Creates a real auth user + school row
- Burns Anthropic tokens (briefing, advisory panel, scenarios AI,
  alignment review, Ask SchoolLaunch)
- Leaves cleanup exposure — if Phase 14b fails, a real orphan persists
  in production data until manually purged

**Deferred because:** no current budget to spin up a dedicated Supabase
project + seed data; Anthropic cost per run is tolerable.

**Proposed fix (future):** create a `schoollaunch-e2e` Supabase project
mirroring prod schema; swap `NEXT_PUBLIC_SUPABASE_URL` via env in the
Playwright config; mock or stub the Anthropic endpoints used in smoke
tests.

---

### T-INFRA-02 · Manual orphan-purge fallback when Phase 14b fails
**Status:** `RESOLVED` · **Opened:** 2026-04-21 · **Resolved:** 2026-10-14
**Resolution:** `scripts/purge-orphan.cjs <school_id> [user_id]` counts the school's rows (dry run) and deletes them with `--confirm`, in the Phase 14b order; it keeps the auth user when they hold a role at another school. The CLEANUP INCOMPLETE banner prints the command.

When the hard-delete phase fails (service-role auth error, flaky network,
assertion thrown after partial delete), the test prints a
`🚨 CLEANUP INCOMPLETE` banner with the school_id + user_id, but there is
no automated recovery — Travis has to purge via the Supabase MCP manually.

**Proposed fix:** a `scripts/purge-orphan.ts` that takes a school_id and
walks the standard deletion order (staffing_positions → budget_projections
→ scenarios → grade_expansion_plan → org_notes → invitations → user_roles
→ school_profiles → schools → auth.users), usable as a one-liner from the
CI log output.

---

### T-INFRA-03 · `dismissJoyrideIfPresent` helper is load-bearing
**Status:** `RESOLVED` · **Opened:** 2026-04-21 · **Resolved:** 2026-10-14
**Resolution:** With P-UX-02 the tour only auto-starts right after onboarding and ends on navigation, so it can no longer re-appear mid-run; the helper now only dismisses the one tour Phase 7 legitimately triggers.

See **P-UX-02** — the Joyride overlay intercepts clicks. The current
helper tries four selectors in order (Close button, Skip button,
`data-test-id="button-skip"`, role-based "Skip tour"), each with a 2s
timeout, and silently moves on if none appear.

That works for Phase 7, but it makes downstream tab navigation (Phases
8–13) subtly fragile — any re-trigger of the tour (e.g., route change
resets tour state) surfaces the overlay mid-step without the helper
being invoked.

**Proposed fix:** resolve **P-UX-02** at the product level, then delete
this helper.

---

### T-INFRA-05 · Update `full-founder-journey` E2E to exercise the new driver toggle
**Status:** `RESOLVED` · **Opened:** 2026-05-12 · **Resolved:** 2026-10-14 · **Source:** P-UX-03 follow-up
**Resolution:** Phase 9 clicks the driver toggle (`Driver: … Click to switch to …`), checks the label flips, saves, reloads and checks the flipped driver survived (P4-FU-01). Phase 9 still sits behind the `PHASES_8_PLUS_SKIPPED` gate (S4-04), so it hasn't run yet.

The driver-flip step at
`tests/session4/e2e/full-founder-journey.spec.ts:547-567` looks for a
`<select>` element to change driver. It never found one (driver was
read-only) and gracefully `infoFlag`s, providing false reassurance. As of
2026-05-12 (P-UX-03 resolution) driver is now a `<button>` on the Staffing
tab — the test still finds no `<select>` and still `infoFlag`s, but the
underlying gap (no driver-flip coverage) is now real test debt.

**Proposed fix:** update the test to locate the new button (approximately
`button[title^="Click to switch"]`), click it, verify the badge label
flips and a Y2-Y5 FTE input's `disabled` attribute toggles accordingly.
Remove the comment block at lines 563-566 that referenced the old
read-only `<span>`. Low priority, test debt.

---

## R-ENR-01 — Enrollment retention modeling paired fix (RESOLVED)

**Resolved:** 2026-05-11

**Summary:** Two compounded bugs in the enrollment model. F1 (UI) was a hardcoded `const retentionRate = 100` in `GradeExpansionEditor.tsx:64` plus a useEffect that pushed 100 back to parent on every render, overwriting any DB value. F2 (engine) was `computeExpansionEnrollments` at `gradeExpansion.ts:180-205` accepting a `retentionRate` parameter but never referencing it in the function body — same pattern at `expansionToEnrollmentArray:227-245`. F3 surfaced during fix: AI context strings at `buildSchoolContext.ts:213, 377` narrated attrition handling that the engine wasn't doing, causing advisory agents to hallucinate against a model that didn't exist.

**Fix:** Engine now applies retention to continuing-grade students using whole-year compounding (Formula A). New-grade students enroll at full planned capacity. UI converted from hardcoded const to useState. Settings → Grade Expansion slider added (range 70-100, step 1, default 92%). Onboarding Step 2 also exposes the slider. F3 prose rewritten to accurately describe Formula A behavior including buildout-decline disclaimer for Y5 < Y4 case.

**DB migration:** 16 planning-status schools at retention_rate=100 backfilled to 92. advisory_cache and dataHash cleared for all 12 schools that had cache. Migration recorded as `supabase/migrations/20260511220000_r_enr_01_backfill_retention_default.sql`.

**Tests:** 18 invariant tests in `tests/session4/grade-expansion.spec.ts` covering retention=90, 92, 100 trajectories plus boundary cases.

**Related findings** logged during R-ENR-01 work:
- **RF-1 (orphan school):** 24 schools in `schools` table, 23 with `school_profiles` rows. One school is missing its profile, joins through profile data fail for it. Diagnostic: `SELECT id, name, status, created_at FROM schools WHERE id NOT IN (SELECT school_id FROM school_profiles)`. Recommended action: identify and either fully delete (cascade) or restore profile row.
- **RF-2 (scenarios staleness verification):** Engine output changed; cached scenarios `results` and `ai_analysis` may be stale. Existing staleness detector should fire on next user visit (base_data_hash mismatch). Verify on a school with stored scenarios.
- **RF-3 (spec/schema mismatch):** v4.0 spec Section 14.1 references "Advisory cache clear: UPDATE school_profiles SET advisory_cache = NULL, advisory_data_hash = NULL" but `advisory_data_hash` is not a column. The hash lives inside `advisory_cache.dataHash` JSONB property. Setting `advisory_cache = NULL` atomically clears the hash. Doc fix for next spec revision.
- **RF-4 (banner deferred):** In-app banner for authorized/exported schools deferred — zero current targets in production. Per-user-per-school dismissal requires a new column or table (e.g., `dismissed_notices` table with school_id + user_id + notice_id + dismissed_at) with RLS policy scoped to the user, plus a dismissal endpoint and component integration. Build when first school transitions to `authorized` status.

---

## Revenue engine

### R-REV-01 · LAP High Poverty missing 50% FRL gate + SSE double-accounting
**Status:** `RESOLVED` · **Opened:** 2026-04-21 · **Resolved:** 2026-04-21

Two related defects in `calcCommissionRevenue` (`src/lib/calculations.ts`): (1) LAP
High Poverty was computed as a flat `enrollment × rate`, missing OSPI's 50% FRPL
threshold gate and the `(pctFrl / 100)` scaling factor — the UI showed a
constant $17,952 regardless of FRL; and (2) `rev.total` excluded Small School
Enhancement, but one caller (`budgetEngine.ts:533`, `computeMultiYearDetailed`)
added SSE externally while 8 other sites used bare `rev.total` — so sub-threshold
schools silently under-reported revenue everywhere except the multi-year engine,
and Step 2's `totalGrants = rev.total - baseRevenue` could go negative.

**Fix (Option A-wide):** gate LAP HP at 50% FRL and multiply by `pctFrl/100`; add
an optional `sse` param to `calcCommissionRevenue` so `rev.total` is now a true
total; drop the external `+ smallSchoolEnhancement` add at `budgetEngine.ts:533`;
thread SSE through all remaining callers. Regression guardrail: `tests/session4/revenue-integrity.spec.ts` — 4 tests pinning the threshold gate, SSE inclusion in `rev.total`, Step 2/Step 3 cross-consistency, and the constituent-sum invariant.

---

### R-REV-02 · Investigate possible LAP / LAP High Poverty double-counting for new applicants
**Status:** `RESOLVED` · **Opened:** 2026-05-22 · **Resolved:** 2026-06-03 · **Source:** V11 Cedar Grove validation, Session 1

Cedar Grove at 60% FRL × 240 students produces in SchoolLaunch:
- LAP base: `240 × 0.60 × $816` = $117,504
- LAP High Poverty: `240 × 0.60 × $374` = $53,856 (gated on FRL ≥ 50%, added in R-REV-01)
- **Combined: $171,360**

V11's Cedar Grove model has a single LAP line at $370/total-pupil × 240 = $88,800.
Roughly half of SchoolLaunch's combined output.

**What OSPI confirms:** LAP base and LAP High Poverty are two real, separate
allocations per OSPI's LAP Guide 2025 and RCW 28A.165.005. Schools with a
3-year rolling FRPL average ≥ 50% qualify for the High Poverty supplement on
top of the base allocation. Cedar Grove at 60% FRL would qualify — if it had
3 years of FRPL history.

**Two possible reasons for the V11 vs. SchoolLaunch gap:**
1. V11 omits LAP High Poverty for **new applicants** because they don't have
   a 3-year FRPL history yet (the rolling average is backward-looking).
2. V11 conflates the two allocations into one line to simplify presentation.

**Action:** confirm whether SchoolLaunch's LAP High Poverty line should be gated
not just on `FRL ≥ 50%` but also on **whether the school has 3 years of FRPL
history**. New applicant schools should likely show LAP High Poverty = $0 in
Years 1–3 and only begin populating in Year 4. Needs WSCSC interpretation: does
the Commission expect new applicants to project LAP High Poverty as $0 or to
project it at the FRL%-implied rate?

**Reference:** `tests/audit/v11-cedar-grove/SESSION_1_GAPS.md` §5.C, OSPI LAP
Guide 2025, RCW 28A.165.005

**Resolution (2026-06-03):** Option A + (i). Gated the LAP High Poverty
**supplement** in `calcCommissionRevenue` (`src/lib/calculations.ts`) behind a
new optional `hasFrplHistory: boolean = false` parameter; the supplement is now
$0 across the full Y1-Y5 horizon for new applicants (matching V11 / the
Commission template), while the LAP **base** line is untouched. No schema change
- the WA Charter pathway is a pre-opening planning tool, so every school is a
new applicant by definition and there is no FRPL-history column to gate on. The
Generic pathway is unaffected (it has no LAP High Poverty line). Diagnosis:
`tests/audit/v11-cedar-grove/R-REV-02-diagnosis.md`. Regression coverage added
to `tests/session4/revenue-integrity.spec.ts` (new-applicant $0 path, Cedar
Grove pin, and the prior scaling-formula assertions retained via
`hasFrplHistory: true`). The Y4 ramp (Option ii) was deliberately not taken;
it remains open pending WSCSC interpretation.

---

### R-REV-03 · Add missing OSPI revenue line types to WA Charter pathway
**Status:** `RESOLVED` · **Opened:** 2026-05-22 · **Resolved:** 2026-10-14 · **Source:** V11 Cedar Grove validation, Session 1
**Resolution:** Fixed in ce0831f: custom revenue lines (`custom_revenue_lines`) with presets for Title II, Title III, State Food Service (4198), Transportation Operations (4199), OSPI special purpose (6100) and sales (2200). SPED Apportionment and State Special Education were already separate lines.

Confirmed missing from SchoolLaunch's WA Charter revenue model, all present in V11:

| OSPI account | Line | Notes |
|---|---|---|
| Title II | Federal Title II | ~$36/pupil, supports teacher quality |
| Title III | Federal Title III | ~$23/pupil, English Language Acquisition |
| 4198 | State Food Service | $23/pupil, separate from federal 6198 |
| 4199 | Transportation Operations | $595/pupil, currently modeled only as expense |
| 6100 | OSPI Special Purpose Unassigned | Catch-all for additional OSPI grants |
| 2200 | Sale of Goods/Supplies/Services | Small but expected |
| 3121 (semantic) | SPED General Apportionment | May be conflated with 4121 State SPED in current SPED-per-pupil field — verify and split if needed |

**Proposed fix (split approach):**

(a) **For the long tail** (Title II/III, 6100, 2200, 4198): add a "Custom Revenue
    Lines" UI that surfaces `school_profiles.custom_revenue_lines` (JSONB
    column already exists in schema, currently unused). Users add
    OSPI-account-coded lines with name + per-pupil rate + driver + recurring
    flag. The Revenue page renders these alongside first-class lines.
    Faster, flexible, doesn't require schema work each time OSPI adds a
    categorical.

(b) **For the load-bearing ones**: add 4199 Transportation Operations as a
    first-class line since it has a matching expense (already modeled), and
    split 3121/4121 SPED since SPED math touches many places. These need
    direct engine integration.

**Blocker resolution:** once this lands, the V11 Cedar Grove reconciliation
can close ~$25K–$200K of the Y1 revenue gap depending on which lines are added.

**Reference:** `tests/audit/v11-cedar-grove/SESSION_1_GAPS.md` §4, V11 INPUTS R41-R76

---

### R-REV-04 · CSP semantic decision: recurring operating vs. non-recurring startup
**Status:** `OPEN` (requires product decision) · **Opened:** 2026-05-22 · **Source:** V11 Cedar Grove validation, Session 1

The federal Charter Schools Program (CSP) grant is modeled differently in
SchoolLaunch vs. V11:

- **SchoolLaunch:** CSP appears in "Startup & Other Grants — Funding Sources",
  modeled as one-time startup funding. **Excluded from sustainability metrics**
  (Total Margin, DCOH calculations that drive FPF scorecard).
- **V11 (Cedar Grove):** CSP is a recurring operating revenue line at
  $400,000/year for Y2-Y5 ($1.6M cumulative). **Included in Total Revenue**
  for FPF scorecard purposes.

**Why this matters:** for a 5-year projection, CSP at $400K/year on a $5-16M
revenue base affects Total Margin by 2-8 percentage points and DCOH by 30-90
days. The same school will pass or fail FPF Stage 1/2 thresholds depending on
which model is applied. CSP is a multi-year federal grant — defensible to
model either way. WSCSC's actual interpretation determines which one is right
for charter application financial plans.

**Proposed fix (pick one):**
1. Move CSP to recurring operating revenue (match V11).
2. Keep CSP as startup funding but expose a toggle: "Include CSP in operating
   revenue for FPF calculations: Yes / No". Default ON for WA Charter pathway
   since V11 (the Commission's template) treats it as recurring.
3. Leave current behavior, document in spec, let users override on Revenue page.

Recommend (2) — gives users control without forcing a default that may not
match their authorizer's interpretation.

**Reference:** `tests/audit/v11-cedar-grove/SESSION_1_GAPS.md` §4 (CSP row)

---

### R-REV-05 · Default WA Charter salary benchmarks are 25-40% below V11/OSPI/BLS levels
**Status:** `RESOLVED` · **Opened:** 2026-05-22 · **Resolved:** 2026-10-14 · **Source:** V11 Cedar Grove validation, Session 1
**Resolution:** Fixed in 368cfd4: WA salary defaults come from one OSPI/BLS catalog (CEO $164,800, Principal $123,600, SPED Teacher $87,550, Office Manager $56,650, Paraeducator $41,200) with source tooltips. Regional salary defaults remain a possible follow-up.

Comparing SchoolLaunch's default WA Charter salaries against V11's preloaded
OSPI/BLS benchmarks (V11 STAFFING Section 2):

| Position | SchoolLaunch default | V11 default | Cedar Grove used | Diff |
|---|---:|---:|---:|---:|
| CEO/Executive Director | $120,000 | $200,000 | $206,000 | -40% |
| Principal/Head of School | $95,000 | $130,000 | $133,900 | -27% |
| SPED Teacher | $62,000 | $85,000 | $85,000 | -27% |
| Administrative Asst | $52,000 | (V11 blank) | $68,000 | -24% |
| Paraeducator | $38,000 | $40,000 | $40,000 | -5% |

**Risk:** a WA charter applicant onboarding with SchoolLaunch's defaults and
not overriding them will submit a financial plan with personnel costs
systematically below market. Two failure modes: (1) the Commission rejects the
projection as unrealistic, (2) the school authorizes on an unrealistic budget
and can't actually hire to plan, triggering Y1 over-spend findings.

**Proposed fix:**
1. Update default WA Charter salaries to match V11/OSPI/BLS benchmarks.
2. Add a tooltip or info icon next to each salary input noting the source:
   "Default from BLS WA / OSPI S-275 — verify against your local market".
3. Bonus consideration: regionalize salary defaults (Spokane vs. Seattle vs.
   Yakima market differences are large). May be Phase 2.

**Reference:** `tests/audit/v11-cedar-grove/SESSION_1_GAPS.md` §6 salary
defaults table

---

### R-REV-06 · Authorizer fee base may not include all state revenue
**Status:** `INVESTIGATING` · **Opened:** 2026-05-22 · **Source:** V11 Cedar Grove validation, Session 1

SchoolLaunch shows Y1 authorizer fee at $102,005 for Cedar Grove. V11 documents
the fee base as "3% of State Revenue" and Cedar Grove's V11 Y1 fee is $100,974.
Close ($1,031 difference, ~1%) but not identical. The discrepancy may be from:

- Different definition of "state revenue" (BEA only vs. BEA + state categoricals)
- SchoolLaunch applying the 3% before/after regionalization multiplier
- Inclusion or exclusion of SSE in the base

Cedar Grove's V11 fee base appears to be: BEA + 3121 SPED + 4121 State SPED +
LAP + TBIP + HiCap + 4198 State Food Service + 4199 Transportation. SSE
included. Current SchoolLaunch spec (§9.7) says authorizer fee base includes
SSE as "working assumption pending charter contract verification" — this needs
verification against a real charter contract or WSCSC publication.

**Action:**
1. Determine SchoolLaunch's current authorizer fee calculation: which revenue
   lines are in the base, in what order with regionalization.
2. Compare against V11's apparent inclusions.
3. Verify against the WSCSC's actual contract language (Travis has access via
   the charter community).
4. Update spec §9.7 to remove "working assumption" language once verified.

**Reference:** `tests/audit/v11-cedar-grove/SESSION_1_GAPS.md` §5.B, V11 INPUTS R122,
SchoolLaunch Product Spec v4.0 §9.7

---

### R-REV-08 · Settings grant-preview computes LAP High Poverty independently and divergently
**Status:** `RESOLVED` · **Opened:** 2026-06-03 · **Resolved:** 2026-10-14 · **Source:** R-REV-02 diagnosis (D1)
**Resolution:** The Settings grant preview now calls `calcCommissionRevenue`, and the dead `calcAllGrants` is gone.

The Settings page renders a "grant preview" that recomputes LAP High Poverty
inline instead of calling `calcCommissionRevenue`:

```
// src/app/(authenticated)/dashboard/settings/page.tsx:113
lapHighPoverty: Math.round(enrollY1 * (fa.lap_high_poverty_per_pupil || 374)),
```

This parallel computation diverges from the canonical line in two ways and was
already wrong **before** R-REV-02: it has **no 50% FRL threshold gate** and
**no `pctFrl/100` scaling** (flat `enrollment x rate`). After R-REV-02 it also
fails to reflect the new-applicant `hasFrplHistory` gate, so the Settings
preview will show a non-zero LAP High Poverty figure where every projection
surface now correctly shows $0. It is a rate-illustration widget, not a
projection, so impact is cosmetic/advisory only - but it violates the
single-source-of-truth principle and will confuse founders comparing Settings
against Revenue / Multi-Year.

**Proposed fix:** drive the Settings preview from `calcCommissionRevenue`
(or `calcAllGrants` once that dead helper is either removed or aligned) so all
grant figures share one computation. Out of scope for R-REV-02 (no-driveby);
logged here for a future Revenue-engine consolidation pass. Note: `calcAllGrants`
(`src/lib/calculations.ts:82`) is dead code carrying its own duplicate HP gate
and should be removed or aligned in the same pass.

**Reference:** `tests/audit/v11-cedar-grove/R-REV-02-diagnosis.md` §D1

---

### R-REV-09 · Dead parallel WA Charter salary catalog in stateConfig.ts
**Status:** `RESOLVED` · **Opened:** 2026-06-03 · **Resolved:** 2026-10-14 · **Source:** R-REV-05
**Resolution:** `WA_CHARTER_POSITIONS` is now derived from `COMMISSION_POSITIONS` (a spec checks they match). The sub-note's fixture salaries in `revenue-classification.spec.ts` were left as they are: they're inputs that spec's expected values are pinned to.

After the R-REV-05 consolidation, `WA_CHARTER_POSITIONS` in `src/lib/stateConfig.ts`
is a dead parallel 27-position salary catalog. Its comment claims "Exact match to
COMMISSION_POSITIONS in types.ts", but it is NOT consumed by WA Charter onboarding:
`StepStaffing.getDefaults()` routes the `wa_charter` pathway to
`buildDefaultPositions` (which now reads salaries from `COMMISSION_POSITIONS` via
`waSeedSalary`), and only non-WA pathways call `buildDefaultPositionsFromConfig`,
which is the only reader of stateConfig position salaries. So `WA_CHARTER_POSITIONS`
carries `default_salary` numbers that nothing in the WA path uses, and which can
silently drift from the single source of truth.

**Proposed fix:** either delete `WA_CHARTER_POSITIONS` (if no WA path needs a
stateConfig-shaped position list) or derive it from `COMMISSION_POSITIONS` so there
is exactly one place salaries live. Confirm no remaining reader before deleting.

**Sub-note:** `tests/session4/revenue-classification.spec.ts:75-80` carries stale
inline salary literals (the old below-market onboarding defaults: 120000 / 95000 /
58000 / 62000 / 52000 / 38000). They do not break the test (inline fixture data,
not catalog reads) but should be refreshed to the current benchmark values in the
same pass for realism.

**Reference:** `tests/audit/v11-cedar-grove/R-REV-05-diagnosis.md` §D1

---

## Financial model consistency (Phase 2)

### R-HEALTH-01 · Health thresholds duplicated and drifting across surfaces
**Status:** `RESOLVED` · **Opened:** 2026-05-11 · **Resolved:** 2026-10-12 · **Source:** F-001/F-011 follow-up
Every health threshold, label and color now comes from `src/lib/healthThresholds.ts`:
Commission FPF bands (Stage 1 for Years 1–2, Stage 2 for Year 3+) for WA charters,
the generic benchmark bands for other pathways, plus facility %, personnel %,
break-even and financial-aid bands, shared colors and prompt helpers. The FPF and
generic scorecards classify through it (output byte-identical), and the Overview
tiles, Staffing badge, Operations facility advisory, Multi-Year, Scenarios, admin
portfolio views, PDF and Excel exports and the AI prompts read it instead of their own
literals. Visible fixes: the Staffing badge used steady-state bands (72–78%) while its
callout used the founding-year band (65–72%); the Overview Total Margin used −5% where
the FPF uses −2%; Year 1–2 day-count colors used Stage 2 cut-offs; generic schools were
colored with WA bands. The file is in the engine hash set, so changing a threshold
invalidates cached briefings. Pinned in `tests/session4/health-thresholds.spec.ts`.

### R-SSOT-01 · Year-1 numbers came from a second, legacy calculation path
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-12 · **Source:** dashboard review (Phase 2)
`computeSummaryFromProjections` / `computeScenario` (ScenarioContext) recomputed Year 1
from `target_enrollment_y1`, opening-grade SSE, the WA revenue formula (even for generic
schools) and the saved operations rows, and `computeCashFlow` spread it over the year
with its own rules. Personnel %, facility %, the 90% sensitivity line, the Cash Flow tab,
the PDF's monthly table and ratios, and the admin detail page disagreed with Multi-Year,
the Scorecard and the Excel. All of it is gone: ScenarioContext runs the pathway's
5-year engine once (`runProjections`), every surface reads its rows through shared
helpers (`personnelPctOfRevenue`, `facilityPctOfRevenue`, `breakEvenEnrollment`,
`totalMarginPct`, `beginningCashOf`, `row.endingCash`), the 90% stress test re-runs the
engine (`computeEnrollmentSensitivity`), and one monthly model (`computeMonthlyCashFlow`)
feeds the Cash Flow tab, PDF, Excel and admin view. Year-end cash adds back non-cash
depreciation everywhere, so financed schools now reconcile across surfaces. Pinned in
`tests/session4/monthly-cash-flow.spec.ts`; `engine-version-current.spec.ts` fails if the
committed ENGINE_VERSION goes stale.

### P2-FU-01 · Editor tabs may seed form state before school data loads
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-13 · **Source:** Phase 2 migration (Cash Flow tab fix)
The Cash Flow tab seeded its Year-0 state from the profile while `useSchoolData` was
still loading, so a hard reload could show defaults and a Save could overwrite saved
data; Phase 2 re-seeds it once loading finishes. Audit of the other editor tabs: every
tab renders its skeleton while `loading` is true (so no Save can run on empty state) and
re-seeds once from the loaded data — Revenue and Operations (`hydrated` effects), Settings
(`initialized` block), Staffing (rebuild effect), Scenarios (loads after `loading`), Cash Flow
(`seededSchoolId`, now with fresh ids for the default expenses). `reload()` never sets
`loading` back to true, and switching schools is a full page load, so no guard re-seeds
over edits. One real gap: the Operations table rebuilt its rows from the database on any
reload, so saving facility financing or a custom expense line silently discarded unsaved
table edits while their rate overrides lingered and were written by the next table Save.
The rows now keep unsaved edits until the table's own Save succeeds.

### P2-FU-02 · `/api/portfolio/export-pdf` has no auth check and does not escape names
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-13 · **Source:** Phase 2 migration
**Resolved:** the route requires an org-level role (`authenticateOrgRequest`: 401 signed out,
403 without `org_admin`/`super_admin`, the same roles the Sidebar and login redirect treat
as admins) and builds its HTML in `src/lib/portfolioPdf.ts`, escaping every string through
the shared `escapeHtml` (`src/lib/html.ts`). The narrative route escapes position titles,
funding sources, scenario names and AI/advisory text too (AI risk text keeps bare
`<strong>` only). The sibling `/api/portfolio/export-excel` route gets the same org-level check, and the
portfolio page now shows an error toast when either export is refused or fails. The
narrative route also coerces the engine numbers it prints raw, so a malformed body can only
render NaN. Pinned in `tests/session4/export-html-escaping.spec.ts` (including the narrative
builder with hostile strings for WA and generic payloads).
The route has no `authenticateRequest` and interpolates client-supplied organization and
school names into HTML that the admin page opens with `document.write`, so a crafted
school name could run script for an org admin. The narrative PDF route likewise writes
position titles, funding-source names and AI text unescaped (custom line names are
escaped). Both pre-date Phase 2.

### P2-FU-08 · `/api/staffing/seed` wrote with the service-role key and no auth check
**Status:** `RESOLVED` · **Opened:** 2026-10-13 · **Resolved:** 2026-10-13 · **Source:** P2-FU-02 review
The route inserted the default staffing roster for any `schoolId` with zero positions,
using the service-role client (which bypasses RLS) and no authentication, so anyone could
seed rows into a school mid-onboarding. It now requires a signed-in member of that school
(`authenticateRequest` with the explicit `schoolId`); the Staffing tab, which calls it on
load for every role, is unaffected.

### P2-FU-03 · Generic-pathway gaps outside the dashboard
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-14 · **Source:** Phase 2 migration
**Resolution:** Scenarios (tab, `/api/scenarios/calculate`, Excel SCENARIOS tab, narrative "x/3 pass") run and grade generic schools on the generic engine and health scorecard; the funding lever moves the per-pupil or tuition line. The admin portfolio grades each school on its pathway (`portfolioHealthFor`). The Excel DASHBOARD tab was already pathway-aware. Month labels follow the school's fiscal year (`fiscalMonthLabels`; Jul–Jun for `generic_charter`), on the dashboard, exports and AI context. The generic engine reads `interest_rate_on_cash` (default 3, unchanged for every live school), and positions are priced at the pathway's benefits load everywhere (`benefitsRateFor`).
The Scenarios tab and `/api/scenarios/calculate` always run the WA engine; the admin
portfolio list, detail page and PDF compute the WA FPF scorecard for generic schools;
the Excel DASHBOARD tab prints FPF measures with WA targets for them. Generic month
labels stay Sep–Aug although `generic_charter` starts its fiscal year in July. The
generic engine uses a fixed 3% interest rate and the pathway benefits load while the
AI context prices positions with the WA load.

### P2-FU-04 · Line items that don't add up to engine totals
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-14 · **Source:** Phase 2 migration
**Resolution:** `src/lib/lineItems.ts` turns an engine row into labeled lines that sum to its totals. Multi-Year lists custom revenue and expenses, facility interest and non-cash depreciation; the Operations tab reads Year 1 rows only, shows saved values (no benchmark auto-fill; a "Use benchmark" button instead), takes subtotals from the engine and lists computed lines (contingency, custom lines, interest, depreciation) read-only; the Overview Base Case table adds interest, grants and one-time revenue.
Multi-Year's Operations section has no rows for depreciation, facility interest or
custom expenses; the Operations tab's "Total Operations" is the sum of its rows (no
contingency, custom expenses, depreciation or interest; it auto-fills $0 rows from
rates and reads ops rows of every year); the Overview Base Case table lists only
operating revenue and startup grants (no interest or one-time revenue). Totals are
the engine's; the listed lines are not.

### P2-FU-05 · Modeling simplifications to revisit
**Status:** `DEFERRED` · **Opened:** 2026-10-12 · **Source:** Phase 2 decisions
- Federal revenue arrives in tenths Oct–Jul; the V11 model uses reimbursement timing
  ($0 Sep–Oct, catch-up in August).
- Facility loan principal is not modeled, so monthly cash and FPF cash are slightly
  optimistic for financed schools (about $44K in Year 1 on $3M at 5% over 30 years).
- Engine SSE is $0 when a school has no grade-expansion plan (every live school has one);
  the Settings SSE card still previews the opening-grades fallback.
- Title I eligibility uses FRL > 40% in the engine and ≥ 40% in prompt prose.
- The scenario "X/4 pass" summary (dashboard and PDF) counts "approaches" as passing.

### P2-FU-06 · AI prompt facts not backed by the engine
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-14 · **Source:** Phase 2 migration
**Resolution:** Prompts no longer state a levy-equity rate (the chat route says to use the school's own) or a Debt Service Coverage Ratio threshold the engine doesn't compute. Both contexts now carry Year 1 month-end cash (full months for the briefing and Ask; a summary and the 12 balances for advisors), so worst-month questions are answered from the engine. PROMPT_VERSION v6-2026-10.
The chat route's WA knowledge says levy equity is about $1,500 per student (the default
is $0); the Board Finance Chair prompt quotes a Debt Service Coverage Ratio ≥ 1.25 that no
engine metric or band backs; the Board Finance Chair and Commission Reviewer ask for
worst-month cash, but the agent context has no monthly cash flow
(`computeMonthlyCashFlow`'s lowest month could be added).

### P2-FU-07 · Admin portfolio pages still call `.single()` on `user_roles`
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-13 · **Source:** Phase 2 migration
CLAUDE.md says every `.single()` on `user_roles` was replaced for multi-school users,
but the admin portfolio list and detail pages still use it, so an org admin with more
than one role row is redirected incorrectly.
**Resolved (Phase 3):** both pages read the shared school session and use the user's
newest org-level role (`orgRoleRow`) for the organization; users without one go to
`/dashboard`, signed-out users to `/login`. On the portfolio the Sidebar shows the admin nav
for any org-level role (a live org admin also holds a newer editor role, which used to win),
and the dashboard nav links back to the portfolio for them. Onboarding had the same
`.single()` and now picks the newest CEO school (else the newest membership); the
middleware's onboarding gate orders by `created_at` so both pick the same school.

## Data layer (Phase 3)

### R-DATA-01 · Five hooks resolved the user, role and school separately
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-13 · **Source:** dashboard review (Phase 3)
`useSchoolData`, `usePermissions`, `StateConfigProvider`, the Sidebar and the tour each ran
their own `auth.getUser()` + `user_roles` lookup with different rules for picking the
school: the data could come from the switcher's school while permissions came from the
newest role row and the pathway from an unordered `roles[0]`, so a multi-school user could
see one school's numbers with another school's pathway labels and edit rights.
`SchoolSessionProvider` (`src/contexts/SchoolSessionContext.tsx`, rules in
`src/lib/schoolSession.ts`) now resolves it once per load: the current school is the
switcher selection when the user is still a member (a stale selection is cleared), else
the CEO school, else the newest membership; the role is the role held there, else the
newest org-level role; the pathway is the current school's. Every hook reads that answer.
Pinned in `tests/session4/school-session.spec.ts`.

### R-DATA-02 · Scorecards recomputed on every page
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-13 · **Source:** dashboard review (Phase 3)
Overview, Scorecard, Advisory, Ask and Alignment each ran `computeFPFScorecard` (and two
of them the generic scorecard) on the shared engine rows. `ScenarioContext` now exposes
`fpfScorecard` and `genericScorecard`, computed once.

### R-DATA-03 · Overview and Advisory Panel wrote different analyses to one cache
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-13 · **Source:** dashboard review (Phase 3)
Both pages generated and cached `school_profiles.advisory_cache`, but only the Advisory
Panel appended Alignment Review findings to the context, so whichever page ran last
decided what the panel said. A failed advisor came back as an amber "Needs Attention"
verdict with "Unable to generate assessment" and was cached (two live schools held
all-failed panels with an empty briefing and re-ran eight AI calls on every visit), and
viewers triggered generation on any visit without a cache. One hook, `useAdvisory`
(`src/hooks/useAdvisory.ts`, rules in `src/lib/advisory.ts`), now serves both pages: one
context including alignment findings; a staleness hash that adds the review id only when a
review exists (caches of schools without one stay valid; a new review marks the panel
stale); failed advisors are flagged by `/api/advisory`, left out of the briefing, shown
as "Unavailable" with a retry, and not counted in the portfolio or the narrative PDF; a
panel with failures never replaces a complete cached one (it is saved only when there is
no complete panel, so a flaky advisor doesn't re-run eight calls on every visit), and a
panel whose briefing alone failed still shows its advisors. Generation is limited to
owners and editors (also enforced by the API route), waits for the cache and review to
load, never auto-runs for a school still in onboarding, and auto-runs at most once per
school per tab session. Pinned in `tests/session4/advisory-shared.spec.ts`.

## Live verification (Phase 3, production)

Read-only browser tests of the Phase 3 deploy against schoollaunch.vercel.app (2026-10-13), as
the Spokane Arts owner, the Columbia Valley owner (advisory states with a stubbed
`/api/advisory`), the ESWA org admin, and signed-out / cross-school API callers. A harness
aborted every database write and AI call the test didn't allow, and a before/after hash of the
test schools' rows confirmed nothing changed. Every Phase 3 check passed: one session per
user, consistent Year-1 numbers across Overview, Multi-Year and Scorecard, the advisory
error / empty / partial / no-briefing states, once-per-tab auto-run, admin nav and portfolio
counts for legacy all-failed panels, and 401/403 on every hardened route (org admins get 403
on `/api/advisory`). It found the issues below, none caused by Phase 3.

### LIVE-01 · Organizations unreadable: blank portfolio header, `_Portfolio_Summary` exports
**Status:** `RESOLVED` · **Opened:** 2026-10-13 · **Resolved:** 2026-10-13 · **Source:** live tests (AUDIT_REPORT 4.7)
`organizations` had RLS enabled and no policy, so the org admin's portfolio header was empty
and the PDF/Excel exports carried an empty org name. Migration
`20261013164916_organizations_select_members` adds a SELECT-only policy: members of the org
(any `user_roles` row with its `organization_id`) and super_admins can read it; writes stay
denied. Verified in SQL as each test user and live on the portfolio.

### LIVE-02 · `.single()` on optional rows logged 406 errors on page load
**Status:** `RESOLVED` · **Opened:** 2026-10-13 · **Resolved:** 2026-10-13 · **Source:** live tests
PostgREST answers 406 when `.single()` finds no row. The Alignment tab (schools with no review)
and the portfolio's org lookup now use `.maybeSingle()`. `useSchoolData` also looked up a
legacy base-case scenario on every dashboard load (9 of 26 schools have none, so a 406 each
time) for a `scenarioId` nothing has read since Phase 2 removed the slider; the lookup and
field are gone.

### LIVE-03 · Playwright login helpers used input ids the forms no longer have
**Status:** `RESOLVED` · **Opened:** 2026-10-13 · **Resolved:** 2026-10-13 · **Source:** live tests
`FormField` generates input ids (`useId`), so `#email` / `#password` in
`tests/session1/fixtures.ts` and the signup step of `full-founder-journey.spec.ts` matched
nothing. Both now find fields by label (the login helper scoped to the password form, since
the page also has magic-link and reset forms); verified against the live login and signup
pages.

---

## UX (Phase 4)

### R-UX-01 · No charts anywhere in the dashboard
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-13 · **Source:** dashboard review (Phase 4)
Hand-rolled SVG charts (no new dependency) in `src/components/charts/`, data shaped by
`src/lib/chartData.ts` from the same engine output the tables show:
- **Year 1 month-end cash** (Cash Flow tab; compact on Overview): the
  `computeMonthlyCashFlow` balances against the year's Days-of-Cash band drawn in dollars
  (WA Stage 1: 30-day target, 21-day floor; generic: 60 / 30), the small-payment months
  (WA: Nov and May) shaded, months under the target marked in the status color, the lowest
  month labeled.
- **Revenue vs. expenses** and **Days of cash** for Years 1–5 (Multi-Year): the target is a
  step that rises from 30 to 60 days at Stage 2; columns carry their value and verdict.
Series hues are validated categorical slots (CVD-separated); status hues come only from
`healthThresholds.ts`. Every chart has hover and arrow-key readouts and an aria summary,
and its table sits on the same page.

### R-UX-02 · Editor tabs lost unsaved edits silently
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-13 · **Source:** dashboard review (Phase 4)
Revenue (custom lines, startup funding), Staffing, Operations (table, custom lines, facility
financing), Cash Flow (Year 0) and Settings now compare their edits with what was loaded or
last saved and show "Unsaved changes" beside the Save button (reverting an edit clears it).
While any editor is dirty, closing or reloading the tab triggers the browser's leave prompt,
and any in-app link, the school switcher and Sign out ask first (`src/lib/unsavedChanges.ts`,
`src/hooks/useUnsavedChanges.ts`). Cancelling keeps the page and the edits; the switcher no
longer changes the selected school before asking.

### R-UX-03 · Wide tables clipped on phones
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-13 · **Source:** dashboard review (Phase 4)
The Overview "5-Year Trajectory" table now scrolls sideways with its label column pinned.
Multi-Year's "key years" phone mode hid Year 2/4 headers but not the cells of Grades
Served, Net Position, Beginning/Ending Cash, Days Cash and the enrollment rows, so their
values sat under the wrong year; Staffing's total rows had the same gap. All per-year cells
are now tagged. The Revenue and Operations custom-line toolbars and the Staffing enrollment
row overflowed a 375 px screen; they wrap. Every dashboard tab was checked at 375 px for
page-level horizontal overflow (none left).

### R-UX-04 · AI failures outside the Advisory Panel were silent or dead ends
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-13 · **Source:** dashboard review (Phase 4)
Shared messages in `src/lib/aiErrors.ts`.
- **Ask SchoolLaunch:** every failure (HTTP error, dropped connection, empty answer, answer
  cut off mid-stream) ends in a visible error with Retry, which replaces the failed exchange.
  The `/api/chat` stream's `[Error: …]` marker is no longer shown as part of an answer.
- **Scenarios AI analysis:** a failed request did nothing; an interrupted stream was saved
  over the previous analysis with the error text in it. Now the previous analysis is kept
  (on screen and in the database) and an error with Retry is shown; a failed save is a toast.
- **Alignment Review:** errors now have Retry and readable status messages, and a review
  that fails to save says so instead of logging to the console.

### R-UX-05 · Review polish
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-13 · **Source:** dashboard review (Phase 4)
- Overview Scenario Summary runs the Scenarios tab's staleness check (one helper,
  `scenarioBaseHash`, also used by `/api/scenarios/calculate`) and links with `<Link>`.
- Overview exports: failures show a toast; the PDF tab opens inside the click (popup
  blockers no longer stop it) and closes if the export fails.
- The 17 `console.log` calls (all in `/api/onboarding/complete`, several dumping staffing
  and projection payloads) are removed.
- P-UX-12 resolved (above).

### P4-FU-01 · Staffing ignores a saved driver on reload
**Status:** `RESOLVED` · **Opened:** 2026-10-13 · **Resolved:** 2026-10-14 · **Source:** Phase 4 (P-UX-12 investigation)
**Resolution:** The tab keeps a saved driver when the founder could have set it (the type's default or `fixed`); anything else reads as the type's default (`resolveDriver`).
The tab rebuilds each row's driver from its type (`getDriver(posType)`), so a driver the
founder toggled (fixed ↔ per-pupil) and saved is shown as the type's default after a reload,
and the next Save writes it back. Years 2–5 FTE are read from the saved rows, so totals are
right until something triggers a recompute. Fix: prefer the saved `driver` when it is valid.

### P4-FU-02 · Onboarding re-inserts Year 1 staffing without types
**Status:** `RESOLVED` · **Opened:** 2026-10-13 · **Resolved:** 2026-10-14 · **Source:** Phase 4 (P-UX-12 investigation)
**Resolution:** Bundled with P-UX-24: onboarding rows carry `position_type`, `driver`, `classification`, `students_per_position` and `benchmark_salary`.
Onboarding saves typed positions, then `/api/onboarding/complete` deletes Year 1 and
re-inserts it with only title/category/FTE/salary, so every new school starts with untyped
(`'custom'`, 24) rows that the Staffing tab must type from their titles. Bundle with P-UX-24:
write `position_type`, `driver` and `classification`, through the atomic replace.

### P4-FU-03 · Leave guard gaps: browser Back and programmatic navigation
**Status:** `DEFERRED` · **Opened:** 2026-10-13 · **Source:** Phase 4
Back/forward (`popstate`) can't be cancelled, so the guard doesn't cover them; any
`router.push` outside the Sidebar is unguarded too (none on the editor tabs today).

## Hygiene (Phase 5)

### R-HYG-01 · Hardcoded, retiring model in every AI route
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-14 · **Source:** dashboard review (Phase 5)
`claude-sonnet-4-20250514` was written into `/api/advisory`, `/api/alignment`, `/api/chat` and
`/api/export/narrative`. One constant, `AI_MODEL` in `src/lib/anthropic-client.ts`, now
names the model (`claude-sonnet-5-5`, chosen by Travis; $2 / $10 per MTok, below Sonnet 4's
$3 / $15); a spec fails if a route hardcodes a model id.
- **Thinking is on by default** (it can't be disabled), so each call sets `output_config.effort`
  (advisors, chat and the narrative PDF `low`; the briefing and Alignment Review `medium`) and
  `max_tokens` covers the thinking as well as the reply.
- **Replies can open with thinking blocks.** Every route read `content[0]`, which would have
  returned an empty string for every AI feature; they now use `responseText` / `responseJson`.
- **Structured outputs** replace regex-extracting JSON in the advisory agents and Alignment
  Review (`output_config.format` with a JSON schema; status/severity enums enforced).
- **Refusals** (`stop_reason: 'refusal'`) throw `AIRefusalError`: a failed advisor, a 422 on
  Alignment, an empty PDF section, and "declined" in Ask and the Scenarios analysis.
- `PROMPT_VERSION` → `v5-2026-10`, so every cached briefing and scenario regenerates once.

### R-HYG-02 · 41 lint errors, 142 warnings
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-14 · **Source:** dashboard review (Phase 5)
`npx eslint .` is clean (0 / 0) and CI keeps it there.
- **Fixed:** impure `Date.now()` during render (portfolio, school picker), a component
  created during render (portfolio sort icons), `selectSchool` used before declaration,
  hydration effects that set state synchronously (Revenue, Operations: now render-time),
  a Cash Flow memo that mutated a closure, unstable memo inputs (Cash Flow funding sources,
  Generic revenue lines), a missing dependency (Staffing seeding), and unused code (dead
  portfolio stats, scenario FPF key map, imports).
- **Typed instead of `any`:** the e2e-overnight harness and XLSX test readers.
- **Documented exceptions:** four async loaders (school data, team list, scenarios,
  portfolio) and the Operations table rebuild (its ref guard is deliberate, P2-FU-01) carry an
  `eslint-disable-next-line react-hooks/set-state-in-effect` with the reason.
- **Config:** the V11 analysis scripts (`tests/audit/v11-cedar-grove/session2/scripts`) are
  ignored as an archived record; `.cjs` scripts may use `require()`.

### R-HYG-03 · No CI
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-14 · **Source:** dashboard review (Phase 5)
`.github/workflows/ci.yml` runs both typechecks, lint and the offline suite on every pull
request and push to master. The live, e2e and e2e-overnight suites are excluded (they use
production).

### R-HYG-04 · Stale docs
**Status:** `RESOLVED` · **Opened:** 2026-10-12 · **Resolved:** 2026-10-14 · **Source:** dashboard review (Phase 5)
`README.md` replaces the create-next-app template (setup, env vars, checks, which suites touch
production); `CLAUDE.md` states Next.js 16 and the AI-call conventions.

### P5-FU-01 · Rename `middleware.ts` to `proxy.ts`
**Status:** `RESOLVED` · **Opened:** 2026-10-14 · **Resolved:** 2026-10-14 · **Source:** Phase 5
**Resolution:** `src/middleware.ts` is now `src/proxy.ts` exporting `proxy`. Checked on `next dev`: no deprecation warning, `/dashboard` signed out redirects to `/login`, signed-in tabs load.
Next.js 16 deprecates the `middleware` file convention in favor of `proxy` (it still runs and
logs a deprecation warning). It holds the auth gate and the onboarding redirect, so rename it
in its own change and verify sign-in, onboarding and the admin redirect on the preview.

### P5-FU-02 · Opt into server-side refusal fallbacks
**Status:** `DEFERRED` · **Opened:** 2026-10-14 · **Source:** Phase 5
A declined request now fails visibly. The API can instead re-run it on a fallback model
(`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`); the installed SDK (0.78)
doesn't type that parameter. Revisit with an SDK upgrade if refusals show up in the logs.

## Backlog pass 1 follow-ups

### BP1-FU-01 · Generic engine ignores some Settings rates
**Status:** `OPEN` · **Opened:** 2026-10-14 · **Source:** P2-FU-03
The generic engine still uses fixed salary and operations escalators and a 0% authorizer fee;
the Settings fields for them only drive WA. Matters most for `generic_charter`, where the
authorizer fee field is editable but has no effect.

### BP1-FU-02 · Scenario fill-rate lever and per-pupil custom revenue lines (WA)
**Status:** `OPEN` · **Opened:** 2026-10-14 · **Source:** P2-FU-03
Lower enrollment fill doesn't scale custom revenue lines that use the per-pupil driver, so their
per-student amount rises as fill falls. Left as is to keep WA scenario results unchanged.

### BP1-FU-03 · Payment schedules are indexed by fiscal month
**Status:** `OPEN` · **Opened:** 2026-10-14 · **Source:** P2-FU-03
Tuition and even schedules are stored as 12 fiscal-month shares, so a July-start tuition school
shows May–June as its no-collection months (the schedule was written for Sep–Jun collection).
Decide whether the schedules should be calendar-anchored.

### BP1-FU-04 · Onboarding completion is not one transaction
**Status:** `OPEN` · **Opened:** 2026-10-14 · **Source:** P-UX-24
Staffing, budget projections and the base scenario each save safely and a retry converges, but
a failure partway leaves them out of step until the retry. One completion RPC (a migration)
would close it. The staffing replace RPC also resets `funding_source` / `notes` on the rows it
resends (the Staffing tab's save already did).

## Session 4 audit — deferred items

These came out of the Session 4 audit and weren't addressed in that
session's scope. Kept here so the next audit pass can pick them up.

### S4-01 · Scenario engine AI analysis retry/backoff coverage
**Status:** `RESOLVED` · **Opened:** 2026-04-21 · **Resolved:** 2026-10-14 · **Source:** Session 4 audit 5.5
**Resolution:** Scenario analysis calls `/api/chat`, which streams through `streamAnthropic`'s retry wrapper; `anthropic-retry.spec.ts` covers 429 with retry-after, 529 exhaustion, connection errors and non-retryable 4xx.

`src/lib/anthropic.ts` now centralizes Anthropic calls with retry/backoff
(per commit `c500626`). The scenarios AI endpoint uses the centralized
path, but there's no E2E assertion that a 429 on the first attempt
surfaces as a successful retry to the user. Add a minimal network-mock
harness test.

---

### S4-02 · FPF badge Stage 1/Stage 2 tooltip copy review
**Status:** `DEFERRED` · **Opened:** 2026-04-21 · **Source:** Session 4 audit

Tooltips were added in commit `09d0dc7` but copy hasn't been reviewed by
the Commission-facing stakeholder. Non-blocking — current copy is
accurate, just not reviewed.

---

### S4-03 · Custom title tooltip component — a11y regression sweep
**Status:** `DEFERRED` · **Opened:** 2026-04-21 · **Source:** Session 4 audit, commit `f9d90ed`

Native HTML `title` attributes were replaced with a custom `Tooltip`
component for consistent styling. One more pass with an actual screen
reader (VoiceOver / NVDA) to confirm the custom component announces
correctly — no regressions from the native behavior.

---

### S4-04 · Cedar Ridge E2E — Phase 8+ findings
**Status:** `OPEN` · **Opened:** 2026-04-21
**Update 2026-10-14:** both blockers are resolved (P-UX-01 on 2026-10-12, P-UX-02 now). Unskipping Phases 8–14a means flipping `PHASES_8_PLUS_SKIPPED` and running the journey against production (it creates a school and spends AI tokens), so it waits for Travis's go-ahead.

Umbrella entry covering everything that came up while hardening
`full-founder-journey.spec.ts` beyond Phase 7:

- **P-UX-01** (Revenue-tab persistence) — primary blocker
- **P-UX-02** (Joyride overlay race) — contributing blocker
- **T-INFRA-03** (helper load-bearing status)

Unskipping Phases 8–14a in the E2E test is gated on **P-UX-01** and
**P-UX-02** both moving to `RESOLVED`.

---
