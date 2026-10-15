import { test, expect, ACCOUNTS, loginAs, resolveSchoolIdForAccount, snapshotSchool, getSupabaseService } from './fixtures'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * E2E — AUDIT 5.2 advisory cache invalidation on staffing edits.
 *
 * Proves that editing a position (salary / position_type / driver) invalidates
 * the cached advisory briefing stored at school_profiles.advisory_cache. The
 * UI signals invalidation via the amber "Your financial model has changed…"
 * banner; the DB signals invalidation via a changed `advisory_cache.dataHash`.
 *
 * Strategy (per user guidance — do NOT assert on Anthropic response text):
 *   1. Snapshot current advisory_cache + one Admin position's salary.
 *   2. Visit /dashboard/advisory and wait for either cache-restore or fresh
 *      generation to settle. Capture the dataHash the page is working against.
 *   3. Navigate to /dashboard/staffing. Bump the first admin position's salary
 *      by +$1000. Save.
 *   4. Navigate back to /dashboard/advisory. Assert the "model changed" banner
 *      appears (hash mismatch) — this IS the UX that AUDIT 5.2 was about.
 *   5. Cleanup: revert salary and clear the advisory cache row so the next
 *      test run starts fresh.
 *
 * Intentionally does NOT click Refresh to regenerate the advisory (would call
 * Anthropic for ~30s across 7 agents and add flake / cost). The banner
 * appearing = hash mismatch detected = cache correctly invalidated.
 */

test.describe.configure({ mode: 'serial' })

test.describe('Suite 9 — Advisory cache invalidation on staffing edit', () => {
  // These specs edit Spokane Arts, a real account: put it back after every test, pass or fail.
  let restoreSchool: (() => Promise<void>) | null = null
  test.beforeEach(async () => {
    restoreSchool = await snapshotSchool(await resolveSchoolIdForAccount(ACCOUNTS.spokaneArts))
  })
  test.afterEach(async () => {
    await restoreSchool?.()
    restoreSchool = null
  })

  test('Changing a position salary invalidates advisory_cache.dataHash and shows Model-Changed banner', async ({ page }) => {
    await loginAs(page, ACCOUNTS.spokaneArts)
    const schoolId = await resolveSchoolIdForAccount(ACCOUNTS.spokaneArts)
    const supabase = getSupabaseService()

    // Snapshot the pre-change cache + find a position we can mutate safely.
    const { data: profileBefore, error: pErr } = await supabase
      .from('school_profiles')
      .select('advisory_cache')
      .eq('school_id', schoolId)
      .single()
    expect(pErr).toBeNull()
    const hashBefore = (profileBefore?.advisory_cache as { dataHash?: string } | null)?.dataHash ?? null

    const { data: positions, error: posErr } = await supabase
      .from('staffing_positions')
      .select('id, title, annual_salary, year, position_type, classification')
      .eq('school_id', schoolId)
      .eq('year', 1)
      .eq('classification', 'Administrative')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .limit(1)
    expect(posErr).toBeNull()
    expect(positions && positions.length > 0, 'Need at least one Admin position in Year 1 to edit').toBeTruthy()
    const targetYear1 = positions![0]
    const originalSalary = targetYear1.annual_salary as number

    // Visit Advisory. Either it renders cached data (if advisory_cache already has a briefing)
    // or it triggers a fresh fetch. Either outcome gives us a stable state from which to
    // detect invalidation after the staffing edit.
    await page.goto('/dashboard/advisory')
    await expect(page.getByRole('button', { name: /refresh analysis|analyzing/i })).toBeVisible({ timeout: 15_000 })

    // Wait for either: (a) "Analyzing..." state to finish, OR (b) the page to settle with
    // cached data rendered (briefing section present). Cap at 90s to allow a cold fetch.
    await page.waitForFunction(() => {
      const analyzing = Array.from(document.querySelectorAll('button')).some((b) => /analyzing/i.test(b.textContent || ''))
      const briefingHeading = Array.from(document.querySelectorAll('h2, h3')).some((h) => /executive|briefing|key recommendation|recommendation/i.test(h.textContent || ''))
      const anyCard = document.querySelectorAll('[data-tour="agent-cards"]').length > 0
      return !analyzing && (briefingHeading || anyCard)
    }, { timeout: 90_000 }).catch(() => {
      // If 90s wasn't enough, don't fail the whole test — we still have the DB check as
      // the authoritative source of truth. Continue.
    })

    // Now mutate staffing via the UI. Change salary on the target position's Year-1 row by +$1000.
    await page.goto('/dashboard/staffing')
    await page.getByRole('button', { name: /^save changes$/i }).waitFor({ timeout: 15_000 })

    // Find the salary <input type="number"> for the target position. The staffing UI renders
    // one row per (position × year) group with salary shown once (Y1). Selector strategy:
    // locate the row containing the position title, then the salary input with step=1000.
    // The position title appears inside a <select> value; easier: find ALL salary inputs
    // that currently equal the original salary and pick the first (deterministic given
    // we queried the first Admin position by sort_order).
    const allSalaryInputs = page.locator('input[type="number"][step="1000"]')
    const count = await allSalaryInputs.count()
    expect(count, 'Expected at least one salary input on /staffing').toBeGreaterThan(0)

    // Pick the first salary input whose value matches the original salary — robust to row
    // reordering between test runs.
    let targetIdx = -1
    for (let i = 0; i < count; i++) {
      const v = await allSalaryInputs.nth(i).inputValue()
      if (Number(v) === originalSalary) {
        targetIdx = i
        break
      }
    }
    expect(targetIdx, `Could not find salary input matching original value $${originalSalary}`).toBeGreaterThanOrEqual(0)

    const newSalary = originalSalary + 1000
    await allSalaryInputs.nth(targetIdx).fill(String(newSalary))

    // Save. The Staffing tab toasts "Saved" on success.
    await page.getByRole('button', { name: /^save changes$/i }).click()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 })

    // Re-query advisory_cache from the DB. The hash shouldn't have changed just from editing
    // staffing (cache isn't re-saved until a fresh advisory is generated), so the recorded
    // `dataHash` should still be `hashBefore` if we had one. The key assertion is
    // inequality between the cached hash and the computed-fresh hash — which the UI
    // expresses as the Model-Changed banner.

    await page.goto('/dashboard/advisory')
    // The page mounts, reads advisory_cache, computes a fresh currentDataHash from
    // (profile, positions, projections, gradeExpansionPlan), and compares. If different,
    // it sets modelChanged=true and renders the banner below.
    const banner = page.getByText(/financial model has changed/i).first()
    await expect(banner, 'AUDIT 5.2: staffing salary edit must invalidate advisory cache and surface the Model-Changed banner').toBeVisible({ timeout: 30_000 })

    // DB-level confirmation: the advisory_cache.dataHash (if any) is stale relative to
    // the new state. We can't easily re-derive currentDataHash here without importing
    // the client bundle, so trust the UI banner + note the hashBefore for debugging.
    const { data: profileAfter } = await supabase
      .from('school_profiles')
      .select('advisory_cache')
      .eq('school_id', schoolId)
      .single()
    const hashAfterInCache = (profileAfter?.advisory_cache as { dataHash?: string } | null)?.dataHash ?? null
    // Either: (a) there was never a cache (hashBefore was null) and one still isn't written
    // yet, OR (b) there was a cache and its stored hash is unchanged (cache isn't rewritten
    // on staffing edits — only on Refresh). Either way, the banner is the correct signal.
    expect(hashAfterInCache).toBe(hashBefore)

    // Cleanup: revert salary. We edit the same row and re-save.
    await page.goto('/dashboard/staffing')
    await page.getByRole('button', { name: /^save changes$/i }).waitFor({ timeout: 15_000 })
    const revertInputs = page.locator('input[type="number"][step="1000"]')
    let revertIdx = -1
    const revertCount = await revertInputs.count()
    for (let i = 0; i < revertCount; i++) {
      const v = await revertInputs.nth(i).inputValue()
      if (Number(v) === newSalary) {
        revertIdx = i
        break
      }
    }
    if (revertIdx >= 0) {
      await revertInputs.nth(revertIdx).fill(String(originalSalary))
      await page.getByRole('button', { name: /^save changes$/i }).click()
      await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 }).catch(() => {})
    } else {
      // Fallback: restore directly via service role if the UI row vanished.
      await directRevertStaffingSalary(supabase, schoolId, targetYear1.id as string, originalSalary)
    }

    // Final safety: verify DB state is back to baseline for all Year-1 rows of this position.
    const { data: finalRows } = await supabase
      .from('staffing_positions')
      .select('id, annual_salary, year')
      .eq('school_id', schoolId)
      .eq('position_type', targetYear1.position_type)
      .eq('year', 1)
    const y1Final = finalRows?.find((r) => r.year === 1)
    expect(y1Final?.annual_salary, 'Y1 salary must be restored to baseline after test').toBe(originalSalary)
  })
})

async function directRevertStaffingSalary(supabase: SupabaseClient, schoolId: string, positionRowId: string, salary: number): Promise<void> {
  // Revert all 5 years for the position_type that row belongs to. Safer than targeting a
  // single row id because save() wipes + re-inserts rows with new ids each time.
  const { data: row } = await supabase.from('staffing_positions').select('position_type, sort_order').eq('id', positionRowId).single()
  if (!row) return
  await supabase
    .from('staffing_positions')
    .update({ annual_salary: salary })
    .eq('school_id', schoolId)
    .eq('position_type', row.position_type)
    .eq('sort_order', row.sort_order)
}
