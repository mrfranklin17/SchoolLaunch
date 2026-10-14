import { test, expect, ACCOUNTS, loginAs, getCurrentSchoolId, getSupabaseService } from './fixtures'

/**
 * Suite 2 — Authorizer fee lock for WA charter (Fix 2).
 *
 * Verifies that on Settings for a wa_charter school:
 *  - The Authorizer Fee input is disabled / readonly and shows 3.0.
 *  - Even if a user bypasses the disabled state via devtools (forced set + click Save),
 *    the persisted `financial_assumptions.authorizer_fee_pct` remains 3 (save-handler override).
 */

test.describe('Suite 2 — Authorizer fee lock (WA charter)', () => {
  test('Spokane Arts: input is disabled and save handler enforces 3%', async ({ page }) => {
    await loginAs(page, ACCOUNTS.spokaneArts)

    // Read persisted fee BEFORE any manipulation.
    const schoolId = await getCurrentSchoolId(page)
    expect(schoolId, 'sl_selected_school must be populated after login').toBeTruthy()
    const supabase = getSupabaseService()
    const { data: before } = await supabase
      .from('school_profiles')
      .select('financial_assumptions')
      .eq('school_id', schoolId!)
      .single()
    const feeBefore = (before?.financial_assumptions as { authorizer_fee_pct?: number } | null)?.authorizer_fee_pct
    // Baseline: should already be 3 for a WA charter.
    expect(feeBefore).toBe(3)

    await page.goto('/dashboard/settings')
    // Find the authorizer fee input by its label.
    const label = page.getByText('Authorizer Fee (%)').first()
    await label.waitFor({ timeout: 10_000 })
    // Locate the input that follows the label in DOM.
    const feeInput = page.locator('label:has-text("Authorizer Fee (%)") + input, label:has-text("Authorizer Fee (%)") ~ input').first()
    await feeInput.waitFor({ timeout: 5_000 })

    // Assertion 1: input is disabled.
    const isDisabled = await feeInput.evaluate((el) => (el as HTMLInputElement).disabled)
    expect(isDisabled, 'Authorizer Fee input must be disabled for wa_charter').toBe(true)

    // Assertion 2: displayed value is 3.0.
    const displayedVal = await feeInput.inputValue()
    expect(parseFloat(displayedVal)).toBeCloseTo(3.0, 1)

    // Assertion 3: helper copy mentions the Commission lock.
    const helper = page.locator('text=/Fixed at 3% by WA Charter School Commission contract/i')
    await expect(helper).toBeVisible()

    // Attempt client-side bypass: remove the `disabled` attribute and set a bogus value, then
    // (try to) save. Even if UI logic sees the bogus value, the save handler overrides.
    await feeInput.evaluate((el) => {
      const input = el as HTMLInputElement
      input.removeAttribute('disabled')
      input.disabled = false
      // Use native setter to bypass React's synthetic-event gate.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '0')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Click Save. Button text on Settings is "Save" / "Save Changes".
    const saveBtn = page.getByRole('button', { name: /^save( changes)?$/i }).first()
    if (await saveBtn.count() > 0 && await saveBtn.isEnabled().catch(() => false)) {
      await saveBtn.click().catch(() => {})
      // Wait for either a toast or a reload.
      await page.waitForTimeout(1500)
    }

    // Verify persisted value via DB.
    const { data: after } = await supabase
      .from('school_profiles')
      .select('financial_assumptions')
      .eq('school_id', schoolId!)
      .single()
    const feeAfter = (after?.financial_assumptions as { authorizer_fee_pct?: number } | null)?.authorizer_fee_pct
    expect(feeAfter, 'Save handler must override to pathway value (3)').toBe(3)
  })
})
