import { test, expect, ACCOUNTS, loginAs, resolveSchoolIdForAccount, snapshotSchool, getSupabaseService } from './fixtures'

/**
 * E2E — AUDIT 6.2 scenario staleness detection.
 *
 * Proves that editing a base-case staffing salary marks existing scenarios
 * as stale on the Scenarios page. The UI signal is the amber banner with
 * text "Your base financial model has changed since these scenarios were
 * last calculated." and a "Recalculate All Scenarios" action.
 *
 * Strategy:
 *   1. Seed scenarios via POST /api/scenarios/seed (idempotent) so the test
 *      has something to stale-check against. If scenarios already exist for
 *      this school the endpoint returns 200 without duplicating.
 *   2. Calculate all scenarios so base_data_hash is populated.
 *   3. Visit /dashboard/scenarios. Confirm NO stale banner initially.
 *   4. Edit a Y1 admin position salary +$1000 through the staffing UI.
 *   5. Return to /dashboard/scenarios. Assert the stale banner appears.
 *   6. Revert salary. (Do not recalc scenarios — leaving the hash stale
 *      does no harm; the next manual Recalc will refresh it.)
 */

test.describe.configure({ mode: 'serial' })

test.describe('Suite 10 — Scenario staleness on base data change', () => {
  // These specs edit Spokane Arts, a real account: put it back after every test, pass or fail.
  let restoreSchool: (() => Promise<void>) | null = null
  test.beforeEach(async () => {
    restoreSchool = await snapshotSchool(await resolveSchoolIdForAccount(ACCOUNTS.spokaneArts))
  })
  test.afterEach(async () => {
    await restoreSchool?.()
    restoreSchool = null
  })

  test('Editing a position salary marks Base Case scenario stale', async ({ page }) => {
    await loginAs(page, ACCOUNTS.spokaneArts)
    const schoolId = await resolveSchoolIdForAccount(ACCOUNTS.spokaneArts)
    const supabase = getSupabaseService()

    // Preflight: ensure engine-type scenarios exist and have been calculated.
    const { data: existing } = await supabase
      .from('scenarios')
      .select('id, name, base_data_hash, results')
      .eq('school_id', schoolId)
      .eq('scenario_type', 'engine')

    const hasCalcdScenarios = (existing?.length ?? 0) >= 3 && existing!.every((s) => s.results && s.base_data_hash)
    if (!hasCalcdScenarios) {
      // Seed + calculate using the authenticated browser context's cookies.
      await page.goto('/dashboard/scenarios')
      const seedRes = await page.request.post('/api/scenarios/seed', {
        data: { schoolId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect([200, 201]).toContain(seedRes.status())
      const calcRes = await page.request.post('/api/scenarios/calculate', {
        data: { schoolId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(calcRes.status(), `calculate returned ${calcRes.status()}`).toBeLessThan(400)
    }

    // Confirm pre-state: no stale banner on /scenarios.
    await page.goto('/dashboard/scenarios')
    // Wait for scenarios to load — one of the tabs should be visible.
    await expect(page.getByRole('button', { name: /^base case$/i }).first()).toBeVisible({ timeout: 30_000 })
    const staleBanner = page.getByText(/base financial model has changed since these scenarios were last calculated/i)
    // Allow a brief moment for the staleness check (useEffect + computeAdvisoryHash) to run.
    await page.waitForTimeout(1000)
    expect(await staleBanner.isVisible().catch(() => false), 'Precondition: no stale banner before staffing edit').toBe(false)

    // Find a Y1 admin position to edit.
    const { data: positions, error: posErr } = await supabase
      .from('staffing_positions')
      .select('id, title, annual_salary, year, position_type, classification, sort_order')
      .eq('school_id', schoolId)
      .eq('year', 1)
      .eq('classification', 'Administrative')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .limit(1)
    expect(posErr).toBeNull()
    expect(positions && positions.length > 0).toBeTruthy()
    const target = positions![0]
    const originalSalary = target.annual_salary as number

    // Edit salary via Staffing UI (+$1000).
    await page.goto('/dashboard/staffing')
    await page.getByRole('button', { name: /^save changes$/i }).waitFor({ timeout: 15_000 })
    const salaryInputs = page.locator('input[type="number"][step="1000"]')
    const n = await salaryInputs.count()
    let idx = -1
    for (let i = 0; i < n; i++) {
      const v = await salaryInputs.nth(i).inputValue()
      if (Number(v) === originalSalary) { idx = i; break }
    }
    expect(idx, `Could not locate salary input with value $${originalSalary}`).toBeGreaterThanOrEqual(0)
    const newSalary = originalSalary + 1000
    await salaryInputs.nth(idx).fill(String(newSalary))
    await page.getByRole('button', { name: /^save changes$/i }).click()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 })

    // Back to scenarios — stale banner should now appear.
    await page.goto('/dashboard/scenarios')
    await expect(page.getByRole('button', { name: /^base case$/i }).first()).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByText(/base financial model has changed since these scenarios were last calculated/i)
    ).toBeVisible({ timeout: 15_000 })
    // The banner also includes a "Recalculate All Scenarios" action per scenarios/page.tsx:280.
    await expect(page.getByRole('button', { name: /recalculate all scenarios/i })).toBeVisible()

    // Cleanup: revert salary back through the UI.
    await page.goto('/dashboard/staffing')
    await page.getByRole('button', { name: /^save changes$/i }).waitFor({ timeout: 15_000 })
    const revertInputs = page.locator('input[type="number"][step="1000"]')
    const n2 = await revertInputs.count()
    let idx2 = -1
    for (let i = 0; i < n2; i++) {
      const v = await revertInputs.nth(i).inputValue()
      if (Number(v) === newSalary) { idx2 = i; break }
    }
    if (idx2 >= 0) {
      await revertInputs.nth(idx2).fill(String(originalSalary))
      await page.getByRole('button', { name: /^save changes$/i }).click()
      await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 }).catch(() => {})
    }

    // Verify DB baseline restored.
    const { data: finalRows } = await supabase
      .from('staffing_positions')
      .select('annual_salary, year')
      .eq('school_id', schoolId)
      .eq('position_type', target.position_type)
      .eq('year', 1)
    expect(finalRows?.[0]?.annual_salary, 'Salary must be restored to baseline').toBe(originalSalary)
  })
})
