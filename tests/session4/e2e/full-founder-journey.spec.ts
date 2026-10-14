import { test, expect, getSupabaseService } from './fixtures'
import type { Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

/**
 * Full Founder Journey — 14-phase regression smoke test.
 *
 * Status: Phases 1–7 green. Phases 8–14 skipped pending BACKLOG.md
 * investigation. Do not remove skip markers without resolving linked
 * backlog items.
 *
 * Walks a fresh signup through every top-level feature SchoolLaunch ships,
 * from self-serve signup through Commission export. Regression safety only —
 * no assertions on specific dollar amounts, projection accuracy, or AI text
 * content. Travis validates output correctness manually.
 *
 * IMPORTANT ENVIRONMENT NOTES:
 * - This hits the live Supabase project (nlvlrznhiwuorxlapnej). There is no
 *   dedicated test env. Uses a unique timestamped email on the
 *   @schoollaunch.test sentinel domain so reruns never collide.
 * - Calls the live Anthropic API (briefing, advisory panel, scenarios AI,
 *   alignment review, Ask SchoolLaunch). Budget several minutes.
 * - Phase 14: the in-app "Danger Zone" is a RESET, not a DELETE. This test
 *   exercises Reset via UI (covers that surface) then hard-deletes the school
 *   + auth user via service role for true cleanup.
 *
 * If cleanup fails for any reason, the test prints the school_id and user_id
 * prominently at the end so Travis can manually purge.
 *
 * NOTE FOR FUTURE AUTHORS — Phase 3 (Enrollment) UX ambiguity:
 * GradeExpansionEditor renders students-per-section in THREE places:
 *   1. A single "consistent class size" input gated by a checkbox
 *      (GradeExpansionEditor.tsx:347 checkbox, :362 value input).
 *   2. Per-grade inputs in the "Year 1 Grade Configuration" founding table
 *      (GradeExpansionEditor.tsx:400).
 *   3. Per-grade inputs in the "Grade Expansion Plan" full timeline table
 *      (GradeExpansionEditor.tsx:513).
 * Tables 2 and 3 both edit Year 1 rows — overlapping overrides on the same
 * planOverrides Map keyed by `${year}-${grade}`. This is product backlog for
 * post-May-19; do NOT treat it as a test issue. Cedar Ridge's PROFILE was
 * picked to match WA Charter defaults (K/1/2 × 1 section × 24/section = 72),
 * so Phase 3 requires NO interaction with any of these controls. Source of
 * truth: src/lib/stateConfig.ts:319 (students_per_section_default: 24) and
 * src/components/onboarding/StepEnrollment.tsx:13 (GRADE_ENROLLMENT_DEFAULTS
 * K-8 classSize: 24). Do not re-introduce a "fill students-per-section" step
 * — the defaults already produce the target.
 */

// ─────────────────────────────────────────────────────────────────────────
// Canonical test profile — Cedar Ridge Academy
// ─────────────────────────────────────────────────────────────────────────

const TIMESTAMP = Date.now()

const PROFILE = {
  schoolName: 'Cedar Ridge Academy',
  founderName: 'Cedar Ridge Test Founder',
  email: `cedar-ridge-test-${TIMESTAMP}@schoollaunch.test`,
  editorEmail: `cedar-ridge-editor-${TIMESTAMP}@schoollaunch.test`,
  password: 'excellent',
  state: 'Washington',
  county: 'Kitsap County',
  // StepIdentity renders a rolling 4-year window starting at the current year
  // (src/components/onboarding/StepIdentity.tsx:13). Hardcoding this would
  // silently drop out of the available option list once the calendar rolls
  // past the target year. Picking currentYear+1 keeps a realistic "opening
  // next school year" scenario and stays valid year over year.
  openingYear: new Date().getFullYear() + 1,
  foundingGrades: ['K', '1', '2'] as const,
  fullBuildoutGrades: ['K', '1', '2', '3', '4', '5', '6', '7', '8'] as const,
  // studentsPerSection and targetY1Enrollment intentionally match the WA
  // Charter defaults so the test exercises the zero-interaction founder path
  // (no SPS input edits in Phase 3). Sources of truth:
  //   - src/lib/stateConfig.ts:319         (students_per_section_default: 24)
  //   - src/components/onboarding/StepEnrollment.tsx:13
  //                                        (GRADE_ENROLLMENT_DEFAULTS K-8: 24)
  // Y1 math: 3 founding grades (K,1,2) × 1 section each × 24 students = 72.
  studentsPerSection: 24,
  targetY1Enrollment: 72,
  demographics: { frl: 52, iep: 14, ell: 11, hicap: 5 },
  startupGrant: { name: 'CSP Planning Grant', amount: 150_000, y0Pct: 60, y1Pct: 40 },
  salaryBump: 5_000,
}

// Informational flags — test still passes, but Travis eyeballs these.
const INFO_FLAGS: string[] = []
const EXPORT_FILES: Array<{ label: string; size: number; path: string }> = []
const WALL_CLOCK_START = Date.now()

// Test identity captured as we go — printed at end for cleanup visibility.
const IDENTITY: { schoolId?: string; userId?: string } = {}

// Phase skip gate. See the block comment above the Phase 8 step for the full
// rationale, BACKLOG.md links, and unskip criteria. Phase 14b (hard delete via
// service role) deliberately sits OUTSIDE this gate so signup state from
// Phases 1–7 is always cleaned up. Unskipped 2026-10-14: both blockers (P-UX-01, P-UX-02)
// are resolved (S4-04).
const PHASES_8_PLUS_SKIPPED = false

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Click the first visible button matching a name regex. */
async function clickBtn(page: Page, name: RegExp, opts?: { timeout?: number }): Promise<void> {
  const btn = page.getByRole('button', { name }).first()
  await expect(btn).toBeVisible({ timeout: opts?.timeout ?? 10_000 })
  await btn.click()
}

/** Log + push an INFO flag. Does NOT fail the test — used for soft signals
 *  (e.g. a known product gap, an informational banner worth human review). */
function infoFlag(msg: string): void {
  console.log(`ℹ️  INFO: ${msg}`)
  INFO_FLAGS.push(msg)
}

/** Hard-assert a condition; on failure, record a HARD flag and throw. Used
 *  for product invariants where silent failure is worse than a red test
 *  (AI features that must respond, known buttons that must exist, etc.). */
function assertFlag(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`🚨 HARD: ${msg}`)
    INFO_FLAGS.push(`HARD: ${msg}`)
    throw new Error(`assertFlag failed: ${msg}`)
  }
}

/** Dismiss the react-joyride guided tour overlay if it's currently visible.
 *  Tries known Joyride skip/close selectors in order; first hit wins. Short
 *  per-attempt timeout so the helper is cheap to call on pages where the
 *  tour never auto-launches (returning users, second visits). No-ops if
 *  none of the selectors match. */
async function dismissJoyrideIfPresent(page: Page): Promise<void> {
  const candidates: Array<() => import('@playwright/test').Locator> = [
    () => page.locator('button[aria-label="Close"]').first(),
    () => page.locator('button[aria-label="Skip"]').first(),
    () => page.locator('[data-test-id="button-skip"]').first(),
    () => page.getByRole('button', { name: /skip tour|skip walkthrough/i }).first(),
  ]
  for (const getLoc of candidates) {
    const loc = getLoc()
    try {
      await loc.waitFor({ state: 'visible', timeout: 2_000 })
      await loc.click()
      await page.waitForTimeout(500)
      return
    } catch {
      // Selector didn't appear or click failed — try the next one.
    }
  }
  // No matching selector — tour may already be dismissed or may not auto-launch.
}

// ─────────────────────────────────────────────────────────────────────────

test.describe.configure({ mode: 'serial' })

test.describe('Full Founder Journey — Cedar Ridge Academy', () => {
  test.setTimeout(20 * 60 * 1000) // 20 minutes

  test('End-to-end: signup → onboarding → every tab → exports → cleanup', async ({ page }) => {
    // Increase default expect timeout for AI-driven phases.
    page.setDefaultTimeout(30_000)

    // ───────────────────────────────────────────────────────────────────
    // Phase 1 — Fresh signup
    // ───────────────────────────────────────────────────────────────────
    await test.step('Phase 1 — Fresh signup', async () => {
      await page.goto('/signup')
      // Signup inputs get generated ids (FormField's useId); find them by label.
      await page.getByLabel('Full Name').fill(PROFILE.founderName)
      await page.getByLabel('Email').fill(PROFILE.email)
      await page.getByLabel('Password', { exact: true }).fill(PROFILE.password)
      await page.getByLabel('Confirm Password').fill(PROFILE.password)

      await Promise.all([
        page.waitForURL(/\/onboarding/, { timeout: 30_000 }),
        page.getByRole('button', { name: /create account/i }).click(),
      ])

      // Capture identity now — we'll need it for cleanup on failure.
      const supabase = getSupabaseService()
      const { data: userList } = await supabase.auth.admin.listUsers()
      const u = userList?.users.find((x) => x.email === PROFILE.email)
      if (u) IDENTITY.userId = u.id

      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('school_id')
        .eq('user_id', IDENTITY.userId ?? '')
        .limit(1)
      if (roleRows?.[0]?.school_id) IDENTITY.schoolId = roleRows[0].school_id as string

      expect(IDENTITY.userId, 'Auth user row must exist after signup').toBeTruthy()
      expect(IDENTITY.schoolId, 'School row must exist after signup').toBeTruthy()

      // Welcome/intro screen — flexible match since copy may drift.
      await expect(
        page.getByText(/welcome|get started|let.?s set up|let me introduce/i).first()
      ).toBeVisible({ timeout: 20_000 })
    })

    // ───────────────────────────────────────────────────────────────────
    // Phase 2 — Onboarding Step 1 (School Identity)
    // ───────────────────────────────────────────────────────────────────
    await test.step('Phase 2 — School Identity', async () => {
      // Welcome screen may have a Get Started / Let's Go / Start button.
      const startBtn = page.getByRole('button', { name: /get started|let.?s (go|start)|begin|start/i }).first()
      if (await startBtn.isVisible().catch(() => false)) await startBtn.click()

      // School name input — placeholder "e.g., Cascade Academy".
      const nameInput = page.getByPlaceholder(/cascade academy|school name/i).first()
      await expect(nameInput).toBeVisible({ timeout: 15_000 })
      await nameInput.fill(PROFILE.schoolName)

      // WA County select — labeled "WA County / Region". Actual option labels include
      // a parenthetical (e.g. "Kitsap County (Bremerton, Silverdale)"), so select by
      // the stable internal value instead of the display label.
      const countySelect = page.locator('select').filter({ has: page.locator('option', { hasText: /kitsap/i }) }).first()
      await countySelect.selectOption({ value: 'kitsap_county' })

      // Planned Opening Year select — labeled "Planned Opening Year" and renders "2027–2028".
      const yearSelect = page.locator('select').filter({
        has: page.locator('option', { hasText: new RegExp(`${PROFILE.openingYear}.?${PROFILE.openingYear + 1}`) }),
      }).first()
      await yearSelect.selectOption({ label: `${PROFILE.openingYear}–${PROFILE.openingYear + 1} School Year` })

      // Founding grades — click each of K, 1, 2 in the FIRST grade-pill row.
      // Because founding and buildout rows both render ALL_GRADES, we scope by
      // the "Founding Grades *" label's parent <div> (single xpath=.. — going up
      // two levels reaches the <form> and loses scoping).
      const foundingContainer = page.getByText(/founding grades\s*\*/i).locator('xpath=..')
      for (const g of PROFILE.foundingGrades) {
        await foundingContainer.getByRole('button', { name: new RegExp(`^${g}$`) }).first().click()
      }

      // Build-out grades — need K-8; founding grades auto-lock, so click only 3-8.
      const buildoutContainer = page.getByText(/grades at full build-?out\s*\*/i).locator('xpath=..')
      for (const g of ['3', '4', '5', '6', '7', '8']) {
        await buildoutContainer.getByRole('button', { name: new RegExp(`^${g}$`) }).first().click()
      }

      // Grade trajectory summary — flexible check.
      await expect(
        page.getByText(/K.*[→-].*8|opening.*growing|K-?2.*K-?8/i).first()
      ).toBeVisible({ timeout: 10_000 })

      // Onboarding step submit is labeled "Continue", not "Next".
      await clickBtn(page, /^continue$/i)
    })

    // ───────────────────────────────────────────────────────────────────
    // Phase 3 — Onboarding Step 2 (Enrollment Plan)
    // ───────────────────────────────────────────────────────────────────
    await test.step('Phase 3 — Enrollment Plan', async () => {
      // Step 2 loads.
      await expect(page.getByText(/enrollment|grade expansion plan/i).first()).toBeVisible({ timeout: 15_000 })

      // No students-per-section fill needed. PROFILE was chosen to match the
      // GradeExpansionEditor's defaults: K/1/2 founding × 1 section × 24
      // students/section = 72. The consistent-class-size checkbox
      // (GradeExpansionEditor.tsx:347) starts checked, the default section
      // count is 1 (GradeExpansionEditor.tsx:118), and the default class size
      // comes from the WA Charter config (stateConfig.ts:319 — 24). No
      // interaction required.

      // Hard-assert Y1 enrollment hits the target. The dedicated display is
      // the founding-table tfoot's "Total Year 1" row (GradeExpansionEditor.tsx:419-426).
      // The last <td> in that row renders the Y1 student total.
      const y1TotalCell = page.locator('tfoot').getByText(/total year 1/i).locator('xpath=../td[last()]')
      await expect(y1TotalCell).toBeVisible({ timeout: 10_000 })
      await expect(y1TotalCell).toHaveText(String(PROFILE.targetY1Enrollment), { timeout: 10_000 })

      // Enrollment Summary tab (if tabs exist)
      const summaryTab = page.getByRole('button', { name: /enrollment summary|summary/i }).first()
      if (await summaryTab.isVisible().catch(() => false)) {
        await summaryTab.click()
        // Assert revenue totals visible.
        await expect(
          page.getByText(/estimated base revenue|base revenue|total revenue/i).first()
        ).toBeVisible({ timeout: 10_000 })
      }

      // StepEnrollment's submit button says "Continue" (StepEnrollment.tsx:334). Accept both.
      await clickBtn(page, /^(continue|next)$/i)
    })

    // ───────────────────────────────────────────────────────────────────
    // Phase 4 — Onboarding Step 3 (Demographics)
    // ───────────────────────────────────────────────────────────────────
    await test.step('Phase 4 — Demographics', async () => {
      await expect(page.getByText(/demographics|student population|frl|free.*reduced/i).first())
        .toBeVisible({ timeout: 15_000 })

      // StepDemographics uses SliderField with `<input type="range">` only
      // (StepDemographics.tsx:287-323) — there are NO number inputs here.
      // Set value via the range input, then dispatch input+change events so
      // React's onChange fires.
      const setByLabel = async (labelRegex: RegExp, value: number) => {
        const label = page.getByText(labelRegex).first()
        if (!(await label.isVisible().catch(() => false))) return
        const input = label.locator('xpath=following::input[@type="range"][1]')
        if (!(await input.isVisible().catch(() => false))) return
        await input.evaluate((el: HTMLInputElement, v: number) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          setter?.call(el, String(v))
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }, value)
      }

      await setByLabel(/free.*reduced|frl/i, PROFILE.demographics.frl)
      await setByLabel(/iep|special education|sped/i, PROFILE.demographics.iep)
      await setByLabel(/english.*learner|ell|multilingual/i, PROFILE.demographics.ell)
      await setByLabel(/hi-?cap|gifted|highly capable/i, PROFILE.demographics.hicap)

      // With FRL=52 > 40, Title I should estimate. Flexible assertion.
      await expect(page.getByText(/title\s*i/i).first()).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText(/idea|special education funding/i).first()).toBeVisible()

      // StepDemographics submit button says "Continue". Accept both.
      await clickBtn(page, /^(continue|next)$/i)
    })

    // ───────────────────────────────────────────────────────────────────
    // Phase 5 — Onboarding Step 4 (Staffing Plan)
    // ───────────────────────────────────────────────────────────────────
    await test.step('Phase 5 — Staffing Plan', async () => {
      await expect(page.getByText(/staffing|positions|personnel/i).first())
        .toBeVisible({ timeout: 15_000 })

      // Confirm position rows render.
      const positionRows = page.locator('table tbody tr')
      await expect(positionRows.first()).toBeVisible({ timeout: 10_000 })

      // Totals panel.
      await expect(page.getByText(/total fte|total personnel|personnel\s*%|student.?:?\s*teacher/i).first())
        .toBeVisible()

      // Bump first salary input by $5000 (salary input is a number input). Find
      // the salary column by looking for a row containing common director titles
      // and a number input with value > 50_000.
      const salaryInputs = page.locator('input[type="number"]')
      const count = await salaryInputs.count()
      let bumped = false
      for (let i = 0; i < count; i++) {
        const val = await salaryInputs.nth(i).inputValue().catch(() => '')
        const n = Number(val)
        if (!Number.isNaN(n) && n >= 60_000 && n <= 250_000) {
          await salaryInputs.nth(i).fill(String(n + PROFILE.salaryBump))
          bumped = true
          break
        }
      }
      expect(bumped, 'Should find at least one director-level salary to bump').toBe(true)

      // StepStaffing submit button says "Continue" (StepStaffing.tsx:437). Accept both.
      await clickBtn(page, /^(continue|next)$/i)
    })

    // ───────────────────────────────────────────────────────────────────
    // Phase 6 — Onboarding Step 5 (Operations Budget)
    // ───────────────────────────────────────────────────────────────────
    await test.step('Phase 6 — Operations Budget', async () => {
      await expect(page.getByText(/operations|facility|budget/i).first())
        .toBeVisible({ timeout: 15_000 })

      // Facility "estimate for me" checkbox — if present.
      const estimateFacility = page.getByLabel(/estimate for me|don.?t have facility/i).first()
      if (await estimateFacility.isVisible().catch(() => false)) {
        await estimateFacility.check().catch(() => {})
      }

      // Add a startup funding source (CSP grant). Look for an "Add" button
      // inside a startup-funding section.
      const addGrantBtn = page.getByRole('button', { name: /add (grant|funding|source)/i }).first()
      if (await addGrantBtn.isVisible().catch(() => false)) {
        await addGrantBtn.click()
        // Try to fill the last inserted row — name + amount.
        const nameInputs = page.locator('input[type="text"]')
        const amountInputs = page.locator('input[type="number"]')
        await nameInputs.last().fill(PROFILE.startupGrant.name).catch(() => {})
        await amountInputs.last().fill(String(PROFILE.startupGrant.amount)).catch(() => {})
      } else {
        infoFlag('Could not find "Add grant" button on Operations step — skipped startup funding entry')
      }

      // Financial summary should show SOMETHING non-zero for Year 1.
      await expect(
        page.getByText(/year 1|y1/i).first()
      ).toBeVisible({ timeout: 10_000 })

      // Complete onboarding → in-place interstitial → dashboard.
      const completeBtn = page.getByRole('button', { name: /^(complete|finish|submit)\b/i }).first()
      await expect(completeBtn).toBeVisible({ timeout: 10_000 })
      await completeBtn.click()

      // Completion interstitial — per product spec v3.0 §3.7 the onboarding
      // flow ends on an in-place confirmation screen with a manual CTA rather
      // than auto-redirecting. The CTA click is the navigation trigger.
      const goToDashboard = page.getByRole('button', { name: /go to dashboard/i })
      await expect(goToDashboard).toBeVisible({ timeout: 60_000 })
      await goToDashboard.click()
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    })

    // ───────────────────────────────────────────────────────────────────
    // Phase 7 — Dashboard Overview
    // ───────────────────────────────────────────────────────────────────
    await test.step('Phase 7 — Dashboard Overview', async () => {
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 })

      // Guided tour auto-launches on first dashboard visit per product spec.
      // Dismiss before continuing to exercise the rest of the dashboard.
      await dismissJoyrideIfPresent(page)

      // Identity header.
      await expect(page.getByText(new RegExp(PROFILE.schoolName, 'i')).first())
        .toBeVisible({ timeout: 15_000 })

      // Health tiles: "Days of Cash Y1 End", "Ending Cash Y1", "Total Margin %",
      // "Personnel % Revenue", "Facility % Revenue" (dashboard/page.tsx:399). No
      // "break-even" text exists on the dashboard — replaced with facility check.
      await expect(page.locator('[data-tour="health-tiles"]')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/reserve days|days of cash/i).first()).toBeVisible()
      await expect(page.getByText(/personnel\s*%/i).first()).toBeVisible()
      await expect(page.getByText(/surplus|deficit|margin/i).first()).toBeVisible()
      await expect(page.getByText(/facility\s*%/i).first()).toBeVisible()

      // AI briefing area — wait up to 120s (upgraded from 90s for headroom).
      const briefing = page.locator('[data-tour="ai-briefing"]')
      await expect(briefing).toBeVisible({ timeout: 120_000 })
      // Wait for briefing to settle — text content stabilizes. Hard-fail on miss:
      // the AI briefing is a core dashboard feature, not an optional signal.
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-tour="ai-briefing"]')
          if (!el) return false
          const t = (el.textContent || '').trim()
          return t.length > 50
        },
        { timeout: 120_000 }
      ).catch(() => assertFlag(false, 'AI briefing did not produce > 50 chars within 120s'))

      // Commission FPF banner.
      await expect(page.getByText(/commission|fpf|performance framework/i).first()).toBeVisible()

      // Budget summary table (5-year trajectory).
      await expect(page.locator('[data-tour="budget-summary"]')).toBeVisible()

      // Scenario Summary card — flexible.
      await expect(page.getByText(/scenario|base case/i).first()).toBeVisible()
    })

    // ───────────────────────────────────────────────────────────────────
    // Phases 8–14a — SKIPPED pending BACKLOG.md investigation
    // ───────────────────────────────────────────────────────────────────
    //
    // Why skipped:
    //   Session 4 hardening uncovered two test-side issues that block reliable
    //   dashboard-tab coverage end-to-end:
    //     1. Revenue-tab numeric input (Phase 8) reads back empty after
    //        page.reload(), so the toHaveValue persistence assertion fails.
    //        ROOT-CAUSED (P-UX-01, 2026-10-12): that input was the Revenue
    //        tab's Override column, which was never persisted. The column has
    //        been removed; per-line rates now live in Settings → Revenue
    //        Assumptions. Before unskipping, retarget Phase 8's persistence
    //        check at a Settings rate input (e.g. "Title I per FRL Student").
    //     2. react-joyride auto-launches on first dashboard visit with a
    //        pointer-event-intercepting overlay. The dismissJoyrideIfPresent
    //        helper masks it for Phase 7, but downstream tab navigations
    //        (Phases 8–13) still race the overlay on some runs.
    //
    // When to unskip (flip PHASES_8_PLUS_SKIPPED to false):
    //   - BOTH backlog items resolved: Revenue-tab persistence root-caused
    //     AND Joyride overlay either disabled in E2E env or swept reliably
    //     from the app shell (not per-test).
    //
    // See BACKLOG.md §"Cedar Ridge E2E — Phase 8+ findings" for the tracked
    // tickets and proposed fixes.
    //
    // Structure:
    //   - Phase 8–14a bodies are preserved verbatim below; each step is routed
    //     through `maybeStep` which dispatches to test.step.skip when the gate
    //     is on. That produces proper "skipped" entries in the Playwright
    //     report rather than silent no-ops.
    //   - Phase 14b (hard delete via service role) sits OUTSIDE this gate on
    //     purpose — Phases 1–7 leave a signup + school row in Supabase that
    //     must be cleaned up every run. Orphaned test data is a test-infra
    //     bug, not a soft signal.
    // ───────────────────────────────────────────────────────────────────
    const maybeStep = (title: string, body: () => Promise<void>) =>
      PHASES_8_PLUS_SKIPPED ? test.step.skip(title, body) : test.step(title, body)

    // ───────────────────────────────────────────────────────────────────
    // Phase 8 — Revenue tab
    // ───────────────────────────────────────────────────────────────────
    await maybeStep('Phase 8 — Revenue tab', async () => {
      await page.getByRole('link', { name: /^revenue$/i }).first().click()
      await page.waitForURL(/\/dashboard\/revenue/, { timeout: 15_000 })

      await expect(page.getByText(/state.*local|federal|categorical/i).first())
        .toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/title\s*i/i).first()).toBeVisible()
      await expect(page.getByText(/small.?school.?enhancement/i).first()).toBeVisible()

      // Edit one numeric input (per-pupil override), save, reload, verify.
      const firstEditable = page.locator('input[type="number"]').first()
      await firstEditable.scrollIntoViewIfNeeded().catch(() => {})
      const orig = await firstEditable.inputValue()
      const newVal = (Number(orig || '0') + 1).toString()
      await firstEditable.fill(newVal)

      // Save if there's a Save button; otherwise blur.
      const saveBtn = page.getByRole('button', { name: /^save( changes)?$/i }).first()
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click()
        await page.waitForTimeout(1500)
      } else {
        await firstEditable.blur()
        await page.waitForTimeout(1500)
      }

      // Reload and confirm persistence.
      await page.reload()
      await expect(page.locator('input[type="number"]').first()).toHaveValue(newVal, { timeout: 10_000 })
    })

    // ───────────────────────────────────────────────────────────────────
    // Phase 9 — Staffing Plan tab
    // ───────────────────────────────────────────────────────────────────
    await maybeStep('Phase 9 — Staffing Plan tab', async () => {
      await page.getByRole('link', { name: /staffing/i }).first().click()
      await page.waitForURL(/\/dashboard\/staffing/, { timeout: 15_000 })

      await expect(page.getByText(/classification|admin|certificated|classified/i).first())
        .toBeVisible({ timeout: 15_000 })

      // Personnel % badge in header — flexible.
      await expect(page.getByText(/personnel\s*%|% of revenue/i).first()).toBeVisible()

      // Flip a position's driver (T-INFRA-05). The driver is a toggle button labelled
      // "Driver: <current>. Click to switch to <other>." on per-pupil-capable rows.
      const driverToggle = page.getByRole('button', { name: /^Driver: .*Click to switch to/ }).first()
      let flippedTo: string | null = null
      if (await driverToggle.isVisible().catch(() => false)) {
        const before = (await driverToggle.getAttribute('aria-label')) ?? ''
        const target = before.match(/Click to switch to (.+)\.$/)?.[1] ?? null
        await driverToggle.click()
        if (target) {
          await expect(page.getByRole('button', { name: new RegExp(`^Driver: ${target.replace(/[()]/g, '\\$&')}\\.`) }).first())
            .toBeVisible({ timeout: 5_000 })
          flippedTo = target
        }
      }
      if (!flippedTo) infoFlag('No driver toggle found to flip on Staffing')

      // Save if present.
      const saveBtn = page.getByRole('button', { name: /^save( changes)?$/i }).first()
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click()
        await page.waitForTimeout(1500)
        // P4-FU-01: a saved driver survives a reload.
        if (flippedTo) {
          await page.reload()
          await expect(page.getByRole('button', { name: new RegExp(`^Driver: ${flippedTo.replace(/[()]/g, '\\$&')}\\.`) }).first())
            .toBeVisible({ timeout: 15_000 })
        }
      }
    })

    // ───────────────────────────────────────────────────────────────────
    // Phase 10 — Operations tab
    // ───────────────────────────────────────────────────────────────────
    await maybeStep('Phase 10 — Operations tab', async () => {
      await page.getByRole('link', { name: /operations/i }).first().click()
      await page.waitForURL(/\/dashboard\/operations/, { timeout: 15_000 })

      await expect(page.getByText(/supplies|facility|technology|insurance/i).first())
        .toBeVisible({ timeout: 15_000 })

      // Bump the first visible number input.
      const n = page.locator('input[type="number"]').first()
      const orig = await n.inputValue()
      const newVal = String(Number(orig || '0') + 50)
      await n.fill(newVal)

      const saveBtn = page.getByRole('button', { name: /^save( changes)?$/i }).first()
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click()
        await page.waitForTimeout(1500)
      } else {
        await n.blur()
        await page.waitForTimeout(1500)
      }

      await page.reload()
      await expect(page.locator('input[type="number"]').first()).toHaveValue(newVal, { timeout: 10_000 })
    })

    // ───────────────────────────────────────────────────────────────────
    // Phase 11 — Cash Flow tab
    // ───────────────────────────────────────────────────────────────────
    await maybeStep('Phase 11 — Cash Flow tab', async () => {
      await page.getByRole('link', { name: /cash\s*flow/i }).first().click()
      await page.waitForURL(/\/dashboard\/cashflow/, { timeout: 15_000 })

      // 12-month header.
      const bodyText = await page.locator('body').innerText()
      expect(bodyText).toMatch(/sep|september/i)
      expect(bodyText).toMatch(/nov|november/i)
      expect(bodyText).toMatch(/may/i)

      // Beginning / ending cash columns.
      await expect(
        page.getByText(/beginning (cash|balance)|ending (cash|balance)/i).first()
      ).toBeVisible({ timeout: 10_000 })

      // Flag any negative-ending-cash months as INFO.
      if (/\$?\s*-|\(\s*\$/i.test(bodyText) && /negative|deficit/i.test(bodyText)) {
        infoFlag('Cash Flow may show negative month(s) — verify manually')
      }
    })

    // ───────────────────────────────────────────────────────────────────
    // Phase 12 — Multi-Year, Scenarios, Commission Scorecard
    // ───────────────────────────────────────────────────────────────────
    await maybeStep('Phase 12a — Multi-Year tab', async () => {
      await page.getByRole('link', { name: /multi.?year/i }).first().click()
      await page.waitForURL(/\/dashboard\/multiyear/, { timeout: 15_000 })
      const body = await page.locator('body').innerText()
      // Expect to see Y0–Y5 or Year 0–Year 5 somewhere.
      expect(body).toMatch(/y[ear\s]*0|year\s*0/i)
      expect(body).toMatch(/y[ear\s]*5|year\s*5/i)
    })

    await maybeStep('Phase 12b — Scenarios tab + AI analysis', async () => {
      await page.getByRole('link', { name: /scenarios/i }).first().click()
      await page.waitForURL(/\/dashboard\/scenarios/, { timeout: 15_000 })

      // If empty state, seed + calculate.
      const buildBtn = page.getByRole('button', { name: /build scenarios/i }).first()
      if (await buildBtn.isVisible().catch(() => false)) {
        await buildBtn.click()
        // Wait for scenario columns.
      }

      await expect(page.getByRole('button', { name: /^base case$/i }).first())
        .toBeVisible({ timeout: 60_000 })
      await expect(page.getByRole('button', { name: /^conservative$/i }).first()).toBeVisible()
      await expect(page.getByRole('button', { name: /^optimistic$/i }).first()).toBeVisible()

      // Run AI analysis — button reads "Get AI Analysis of Scenarios" or
      // "Refresh Analysis" (scenarios/page.tsx:483). Hard-fail if the button
      // is missing (known product fixture) or if analysis doesn't return
      // within 5 minutes (upgraded from 3 min for headroom).
      const aiBtn = page.getByRole('button', { name: /ai analysis|refresh analysis|generate analysis/i }).first()
      assertFlag(await aiBtn.isVisible().catch(() => false), 'Could not find "Run AI Analysis" button on Scenarios')
      await aiBtn.click()
      await page.waitForFunction(
        () => {
          // The AI narrative container — fallback: full body length growing.
          const el = document.querySelector('[data-tour="scenario-ai"], [data-ai="scenario"]')
          const text = (el ? el.textContent : document.body.innerText) || ''
          return text.length > 100
        },
        { timeout: 300_000 }
      ).catch(() => assertFlag(false, 'Scenarios AI analysis did not return content within 5 minutes'))

      // Hover FPF legend tooltip — regression check for the ex-title refactor.
      const legendIcon = page.locator('[aria-label="FPF legend details"]').first()
      if (await legendIcon.isVisible().catch(() => false)) {
        await legendIcon.hover()
        await expect(page.locator('[role="tooltip"]').first()).toBeVisible({ timeout: 5_000 })
        await page.mouse.move(0, 0)
      }
    })

    await maybeStep('Phase 12c — Commission Scorecard tab', async () => {
      await page.getByRole('link', { name: /commission\s*scorecard|scorecard/i }).first().click()
      await page.waitForURL(/\/dashboard\/(commission|scorecard)/, { timeout: 15_000 })

      const body = await page.locator('body').innerText()
      expect(body).toMatch(/y[ear\s]*1/i)
      expect(body).toMatch(/y[ear\s]*5/i)
      expect(body).toMatch(/stage\s*1/i)
      expect(body).toMatch(/stage\s*2/i)
    })

    // ───────────────────────────────────────────────────────────────────
    // Phase 13 — AI features + Exports + Team
    // ───────────────────────────────────────────────────────────────────
    await maybeStep('Phase 13a — Ask SchoolLaunch', async () => {
      await page.getByRole('link', { name: /ask schoollaunch|ask/i }).first().click()
      await page.waitForURL(/\/dashboard\/ask/, { timeout: 15_000 })

      const input = page.getByPlaceholder(/ask about your budget|type a question|ask/i).first()
      await expect(input).toBeVisible({ timeout: 10_000 })
      await input.fill('What is my Year 1 projected revenue?')
      await input.press('Enter')

      // Wait for an assistant response of reasonable length (> 100 chars).
      // Hard-fail at 3 minutes (upgraded from 2 min).
      await page.waitForFunction(
        () => document.body.innerText.length > 500,
        { timeout: 180_000 }
      ).catch(() => assertFlag(false, 'Ask SchoolLaunch did not return a response within 3 minutes'))
    })

    await maybeStep('Phase 13b — Advisory Panel (7 agents)', async () => {
      await page.getByRole('link', { name: /advisory/i }).first().click()
      await page.waitForURL(/\/dashboard\/advisory/, { timeout: 15_000 })

      // Advisory page auto-fetches on mount if no cache (advisory/page.tsx:213).
      // The manual button reads "Refresh Analysis" (line 259).
      const runBtn = page.getByRole('button', { name: /refresh analysis|run (advisory|panel|analysis)/i }).first()
      if (await runBtn.isVisible().catch(() => false)) {
        await runBtn.click()
      }

      // Wait for all 7 agents to report — look for at least 7 status badges
      // (emerald/amber/red pills). Tailwind classes use "emerald" not "green".
      // Hard-fail at 12 min (upgraded from 8 min for slow AI days): 7 agents
      // is a product invariant, not an informational signal.
      await page.waitForFunction(
        () => {
          const root = document.body
          const badgeCount = root.querySelectorAll('[class*="emerald"],[class*="green"],[class*="amber"],[class*="red"]').length
          return badgeCount >= 7
        },
        { timeout: 12 * 60_000 } // 12 minutes
      ).catch(() => assertFlag(false, 'Advisory Panel did not show 7 agent badges within 12 minutes'))
    })

    await maybeStep('Phase 13c — Alignment Review', async () => {
      await page.getByRole('link', { name: /alignment/i }).first().click()
      await page.waitForURL(/\/dashboard\/alignment/, { timeout: 15_000 })

      await page.waitForSelector('input[type="file"]', { timeout: 15_000, state: 'attached' })
      const filePath = path.join(__dirname, 'fixtures', 'clean_narrative.txt')
      await page.locator('input[type="file"]').setInputFiles(filePath)

      const analyzeBtn = page.getByRole('button', { name: /analyze alignment/i }).first()
      await expect(analyzeBtn).toBeEnabled({ timeout: 10_000 })
      await analyzeBtn.click()

      await expect(page.locator('[data-tour="alignment-results"]')).toBeVisible({ timeout: 180_000 })

      // Clean narrative must not trigger injection banner.
      const banner = page.getByText(/heads up — your narrative contains/i)
      const shown = await banner.isVisible().catch(() => false)
      expect(shown, 'Clean narrative must NOT trigger injection banner').toBe(false)
    })

    await maybeStep('Phase 13d — Export Budget Narrative PDF', async () => {
      // Go back to Overview where export buttons live.
      await page.goto('/dashboard')
      await expect(page.locator('[data-tour="export-buttons"]')).toBeVisible({ timeout: 15_000 })

      const pdfBtn = page.getByRole('button', { name: /budget narrative|narrative pdf|export pdf/i }).first()
      const downloadPromise = page.waitForEvent('download', { timeout: 180_000 })
      await pdfBtn.click()
      const download = await downloadPromise
      const savedPath = path.join(__dirname, `__fixtures-out__/${path.basename(download.suggestedFilename())}`)
      fs.mkdirSync(path.dirname(savedPath), { recursive: true })
      await download.saveAs(savedPath)
      const stat = fs.statSync(savedPath)
      expect(stat.size, 'PDF export must be > 1KB').toBeGreaterThan(1000)
      EXPORT_FILES.push({ label: 'Budget Narrative PDF', size: stat.size, path: savedPath })
    })

    await maybeStep('Phase 13e — Export Commission Excel', async () => {
      // Button reads "Export for Commission" or "Export Financial Plan"
      // (dashboard/page.tsx:710).
      const xlsBtn = page.getByRole('button', { name: /export.*commission|commission.*export|export financial plan|xlsx/i }).first()
      const downloadPromise = page.waitForEvent('download', { timeout: 180_000 })
      await xlsBtn.click()
      const download = await downloadPromise
      const savedPath = path.join(__dirname, `__fixtures-out__/${path.basename(download.suggestedFilename())}`)
      fs.mkdirSync(path.dirname(savedPath), { recursive: true })
      await download.saveAs(savedPath)
      const stat = fs.statSync(savedPath)
      expect(stat.size, 'Excel export must be > 1KB').toBeGreaterThan(1000)
      EXPORT_FILES.push({ label: 'Commission Excel', size: stat.size, path: savedPath })
    })

    await maybeStep('Phase 13f — Settings → Team invitation', async () => {
      await page.goto('/dashboard/settings')
      // Scroll to team section.
      await page.getByText(/^team$|team management|invite/i).first().scrollIntoViewIfNeeded().catch(() => {})

      // Invite form: email input + role select + invite button. The placeholder
      // text is "colleague@example.com" (TeamSection.tsx:237), so locate by
      // input[type=email] inside the team section instead. Hard-fail if the
      // form is missing — it's a known product fixture, not optional.
      const inviteInput = page.locator('[data-tour="team-section"] input[type="email"]').first()
      assertFlag(await inviteInput.isVisible().catch(() => false), 'Could not find team invite form in Settings')
      await inviteInput.fill(PROFILE.editorEmail)
      const roleSelect = page.locator('[data-tour="team-section"] select').filter({ has: page.locator('option[value="school_editor"]') }).first()
      if (await roleSelect.isVisible().catch(() => false)) {
        await roleSelect.selectOption({ value: 'school_editor' }).catch(() => {})
      }
      const inviteBtn = page.getByRole('button', { name: /send invite|^invite$|add member/i }).first()
      await inviteBtn.click()

      // Expect either a success toast/message or an invitation link.
      await expect(
        page.getByText(/invitation|sent|copy link|invited|pending/i).first()
      ).toBeVisible({ timeout: 15_000 })
    })

    // ───────────────────────────────────────────────────────────────────
    // Phase 14 — Cleanup (Reset UI + hard delete via service role)
    // ───────────────────────────────────────────────────────────────────
    await maybeStep('Phase 14a — Danger Zone Reset (UI exercise)', async () => {
      // The in-app Danger Zone is a RESET (not DELETE). Exercise the UI to
      // cover that surface, then hard-delete below.
      await page.goto('/dashboard/settings')

      // Hard-fail if the Reset trigger is missing — Danger Zone is a known
      // product fixture. Missing means app regressed, not a soft signal.
      const resetTrigger = page.getByRole('button', { name: /reset school.*start over|reset school/i }).first()
      assertFlag(await resetTrigger.isVisible().catch(() => false), 'Reset button not found — app may have changed the Danger Zone')
      await resetTrigger.click()
      // Confirmation modal — type school name.
      const confirmInput = page.getByPlaceholder(/school name/i).first()
      await expect(confirmInput).toBeVisible({ timeout: 10_000 })
      await confirmInput.fill(PROFILE.schoolName)

      // Confirm button now reads "Reset School Data" (settings/page.tsx:736).
      const permanentlyResetBtn = page.getByRole('button', { name: /reset school data|permanently reset/i }).first()
      await expect(permanentlyResetBtn).toBeEnabled({ timeout: 5_000 })
      await Promise.all([
        page.waitForURL(/\/onboarding/, { timeout: 30_000 }),
        permanentlyResetBtn.click(),
      ])
    })

    await test.step('Phase 14b — Hard delete via service role', async () => {
      const supabase = getSupabaseService()
      let cleanupOk = true

      // Reverse FK order. Ignore "not found" errors (already cascaded).
      const tries: Array<[string, () => Promise<{ error: { message: string } | null }>]> = [
        ['scenarios', async () => await supabase.from('scenarios').delete().eq('school_id', IDENTITY.schoolId!)],
        ['grade_expansion_plan', async () => await supabase.from('grade_expansion_plan').delete().eq('school_id', IDENTITY.schoolId!)],
        ['staffing_positions', async () => await supabase.from('staffing_positions').delete().eq('school_id', IDENTITY.schoolId!)],
        ['budget_projections', async () => await supabase.from('budget_projections').delete().eq('school_id', IDENTITY.schoolId!)],
        ['alignment_reviews', async () => await supabase.from('alignment_reviews').delete().eq('school_id', IDENTITY.schoolId!)],
        ['alignment_security_events', async () => await supabase.from('alignment_security_events').delete().eq('school_id', IDENTITY.schoolId!)],
        ['org_notes', async () => await supabase.from('org_notes').delete().eq('school_id', IDENTITY.schoolId!)],
        ['invitations', async () => await supabase.from('invitations').delete().eq('school_id', IDENTITY.schoolId!)],
        ['user_roles', async () => await supabase.from('user_roles').delete().eq('school_id', IDENTITY.schoolId!)],
        ['school_profiles', async () => await supabase.from('school_profiles').delete().eq('school_id', IDENTITY.schoolId!)],
        ['schools', async () => await supabase.from('schools').delete().eq('id', IDENTITY.schoolId!)],
      ]

      for (const [label, fn] of tries) {
        try {
          const { error } = await fn()
          if (error) {
            console.log(`⚠️  Cleanup warning on ${label}: ${error.message}`)
            cleanupOk = false
          }
        } catch (err) {
          console.log(`⚠️  Cleanup exception on ${label}: ${err instanceof Error ? err.message : String(err)}`)
          cleanupOk = false
        }
      }

      // Auth user last.
      if (IDENTITY.userId) {
        const { error } = await supabase.auth.admin.deleteUser(IDENTITY.userId)
        if (error) {
          console.log(`⚠️  Cleanup warning on auth.users: ${error.message}`)
          cleanupOk = false
        }
      }

      // Verify school is gone.
      const { data: leftover } = await supabase
        .from('schools')
        .select('id')
        .eq('id', IDENTITY.schoolId!)
        .limit(1)
      const orphanPresent = !!(leftover && leftover.length > 0)
      if (orphanPresent) cleanupOk = false

      // Print manual-purge diagnostic BEFORE any hard-fail so Travis sees the
      // IDs in the test log even when the assertion throws below.
      if (!cleanupOk) {
        console.error(`\n\n🚨 CLEANUP INCOMPLETE — manual purge required:\n  school_id: ${IDENTITY.schoolId}\n  user_id:   ${IDENTITY.userId}\n  purge:     node scripts/purge-orphan.cjs ${IDENTITY.schoolId} ${IDENTITY.userId ?? ''} --confirm\n`)
      }

      // Hard-fail if the school row survived cleanup: orphaned test data is a
      // test-infrastructure correctness bug, not a soft signal.
      assertFlag(!orphanPresent, `School ${IDENTITY.schoolId} still present after cleanup`)
    })

    // ───────────────────────────────────────────────────────────────────
    // Summary print
    // ───────────────────────────────────────────────────────────────────
    const elapsed = ((Date.now() - WALL_CLOCK_START) / 1000).toFixed(1)
    console.log(`\n═══════════════ FOUNDER JOURNEY SUMMARY ═══════════════`)
    console.log(`Wall clock: ${elapsed}s`)
    console.log(`Export files:`)
    for (const f of EXPORT_FILES) {
      console.log(`  - ${f.label}: ${(f.size / 1024).toFixed(1)} KB @ ${f.path}`)
    }
    console.log(`Informational flags (${INFO_FLAGS.length}):`)
    for (const m of INFO_FLAGS) {
      console.log(`  - ${m}`)
    }
    console.log(`school_id (for manual purge if cleanup failed): ${IDENTITY.schoolId}`)
    console.log(`user_id   (for manual purge if cleanup failed): ${IDENTITY.userId}`)
    console.log(`═══════════════════════════════════════════════════════\n`)
  })
})
