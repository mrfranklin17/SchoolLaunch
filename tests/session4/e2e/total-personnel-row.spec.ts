import { test, expect, ACCOUNTS, loginAs, resolveSchoolIdForAccount, getSupabaseService } from './fixtures'

/**
 * E2E — Session 2 follow-up: dead `Total Personnel` subtotal row in
 * `budget_projections` must stay deleted and never get re-written by the
 * onboarding-complete or staffing-save paths.
 *
 * The migration `20260420130000_s4_a3_remove_total_personnel_rows.sql` wiped
 * 10 pre-existing rows across 10 schools. Commit `947a961` removed the two
 * write sites (`/api/onboarding/complete` and `/dashboard/staffing`).
 *
 * Strategy:
 *   1. Assert zero `Total Personnel` rows for the Spokane Arts school.
 *   2. Trigger a staffing save (edit FTE by +0.5, save, then revert).
 *   3. Assert still zero rows — confirming the write path is gone.
 *   4. Verify Commission Excel export still renders / downloads without
 *      error. Per user note: xlsx content verification of the P&L's
 *      computed Total Personnel line is left as a MANUAL CHECK noted in
 *      the output; the existence of the download is what we automate.
 */

test.describe.configure({ mode: 'serial' })

test.describe('Suite 11 — Total Personnel budget_projections row stays gone', () => {
  test('Initial state: zero Total Personnel rows for Spokane Arts', async () => {
    const schoolId = await resolveSchoolIdForAccount(ACCOUNTS.spokaneArts)
    const supabase = getSupabaseService()
    const { count, error } = await supabase
      .from('budget_projections')
      .select('*', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('subcategory', 'Total Personnel')
    expect(error).toBeNull()
    expect(count, 'Migration 20260420130000 should have removed all Total Personnel rows').toBe(0)
  })

  test('Staffing save does not re-insert a Total Personnel row', async ({ page }) => {
    await loginAs(page, ACCOUNTS.spokaneArts)
    const schoolId = await resolveSchoolIdForAccount(ACCOUNTS.spokaneArts)
    const supabase = getSupabaseService()

    // Snapshot a Y1 admin FTE value to modify.
    const { data: positions } = await supabase
      .from('staffing_positions')
      .select('id, fte, position_type, sort_order, year')
      .eq('school_id', schoolId)
      .eq('year', 1)
      .eq('classification', 'Administrative')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .limit(1)
    expect(positions && positions.length > 0).toBeTruthy()
    const target = positions![0]
    const originalFte = target.fte as number
    const newFte = originalFte + 0.5

    await page.goto('/dashboard/staffing')
    await page.getByRole('button', { name: /^save changes$/i }).waitFor({ timeout: 15_000 })

    // FTE inputs have step=0.5; there are 5 per position row (Y1..Y5).
    // Locate Y1 of our target by finding the row whose position_type select matches.
    // Simpler: just edit the first Y1 FTE input that equals originalFte.
    const fteInputs = page.locator('input[type="number"][step="0.5"]')
    const n = await fteInputs.count()
    let idx = -1
    for (let i = 0; i < n; i++) {
      const v = await fteInputs.nth(i).inputValue()
      if (Number(v) === originalFte) { idx = i; break }
    }
    expect(idx, `Could not locate FTE input with value ${originalFte}`).toBeGreaterThanOrEqual(0)

    await fteInputs.nth(idx).fill(String(newFte))
    await page.getByRole('button', { name: /^save changes$/i }).click()
    await expect(page.getByText(/saved successfully/i)).toBeVisible({ timeout: 15_000 })

    // Assert: no Total Personnel row materialised.
    const { count } = await supabase
      .from('budget_projections')
      .select('*', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('subcategory', 'Total Personnel')
    expect(count, 'Staffing save must NOT write a Total Personnel subtotal row').toBe(0)

    // Revert FTE.
    const revertInputs = page.locator('input[type="number"][step="0.5"]')
    const n2 = await revertInputs.count()
    let idx2 = -1
    for (let i = 0; i < n2; i++) {
      const v = await revertInputs.nth(i).inputValue()
      if (Number(v) === newFte) { idx2 = i; break }
    }
    if (idx2 >= 0) {
      await revertInputs.nth(idx2).fill(String(originalFte))
      await page.getByRole('button', { name: /^save changes$/i }).click()
      await expect(page.getByText(/saved successfully/i)).toBeVisible({ timeout: 15_000 }).catch(() => {})
    }
  })

  test('Commission Excel export downloads without error (Total Personnel xlsx content is MANUAL CHECK)', async ({ page }) => {
    await loginAs(page, ACCOUNTS.spokaneArts)

    await page.goto('/dashboard')
    // Overview button text: "Export Excel" (WA charter) or "Export Plan" (generic).
    const exportButton = page
      .getByRole('button', { name: /export excel|export plan/i })
      .first()
    await expect(exportButton).toBeVisible({ timeout: 15_000 })

    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 })
    await exportButton.click()
    const download = await downloadPromise

    const filename = download.suggestedFilename()
    expect(filename.toLowerCase()).toMatch(/\.xlsx?$/)

    // Save so we can at least assert non-zero file size; xlsx content inspection of
    // the P&L tab's "Total Personnel" line is left as a manual verification — see
    // user note: "Playwright MCP can confirm download triggers but cannot inspect
    // xlsx contents" and session1/excel-cashflow.spec.ts already exercises the
    // full workbook shape.
    const artifactDir = 'tests/session4/e2e/artifacts'
    const fs = await import('node:fs')
    const path = await import('node:path')
    fs.mkdirSync(artifactDir, { recursive: true })
    const dest = path.join(artifactDir, `commission-${Date.now()}.xlsx`)
    await download.saveAs(dest)
    const stat = fs.statSync(dest)
    expect(stat.size, 'Downloaded Commission workbook should be non-empty').toBeGreaterThan(1000)

    console.log(`[total-personnel-row] Downloaded: ${dest} (${stat.size} bytes)`)
    console.log('[total-personnel-row] MANUAL CHECK: open the xlsx and confirm the P&L tab shows a non-zero Total Personnel line (computed from positions, not read from the deleted subtotal row).')
  })
})
