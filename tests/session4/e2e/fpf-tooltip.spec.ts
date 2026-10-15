import { test, expect, ACCOUNTS, loginAs, resolveSchoolIdForAccount, snapshotSchool } from './fixtures'

/**
 * E2E — Polish: FPF badge legend tooltip on /dashboard/scenarios.
 *
 * The legend row above the FPF Compliance grid shows three inline badges
 * (Meets / Approaching / Does Not Meet) plus a `?` icon wrapped in a
 * custom <Tooltip> component (src/components/ui/Tooltip.tsx). The tooltip
 * appears on mouseover/focus and dismisses on mouseout/blur. Its text
 * explains threshold colors and the Stage 1 (Years 1-2) / Stage 2 (Years 3+)
 * distinction.
 *
 * Unlike a native HTML `title` attribute (OS-rendered, invisible to the DOM),
 * the custom component renders its panel as a `<span role="tooltip">` sibling,
 * so Playwright can observe appearance and dismissal.
 */

test.describe.configure({ mode: 'serial' })

async function gotoScenariosAndSettle(page: import('@playwright/test').Page, schoolId: string): Promise<void> {
  await page.goto('/dashboard/scenarios')

  // Preflight: seed + calculate if empty state.
  // Wait for the page to settle on either the empty state or the scenario tabs.
  const buildBtn = page.getByRole('button', { name: /^build scenarios$/i })
  const baseCaseTab = page.getByRole('button', { name: /^base case$/i }).first()
  await expect(buildBtn.or(baseCaseTab).first()).toBeVisible({ timeout: 30_000 })
  if (await buildBtn.isVisible()) {
    const seedRes = await page.request.post('/api/scenarios/seed', {
      data: { schoolId },
      headers: { 'Content-Type': 'application/json' },
    })
    expect([200, 201]).toContain(seedRes.status())
    const calcRes = await page.request.post('/api/scenarios/calculate', {
      data: { schoolId },
      headers: { 'Content-Type': 'application/json' },
    })
    expect(calcRes.status()).toBeLessThan(400)
    await page.reload()
  }

  await expect(page.getByRole('button', { name: /^base case$/i }).first()).toBeVisible({ timeout: 30_000 })

  const fpfSectionHeader = page.getByText(/commission fpf compliance|fpf compliance/i).first()
  if (await fpfSectionHeader.isVisible().catch(() => false)) {
    const legendVisible = await page.getByText(/^legend:$/i).isVisible().catch(() => false)
    if (!legendVisible) {
      await fpfSectionHeader.click().catch(() => {})
    }
  }
}

test.describe('Suite 14 — FPF badge legend tooltip on Scenarios', () => {
  // These specs edit Spokane Arts, a real account: put it back after every test, pass or fail.
  let restoreSchool: (() => Promise<void>) | null = null
  test.beforeEach(async () => {
    restoreSchool = await snapshotSchool(await resolveSchoolIdForAccount(ACCOUNTS.spokaneArts))
  })
  test.afterEach(async () => {
    await restoreSchool?.()
    restoreSchool = null
  })

  test('Legend badges render and `?` icon surfaces the expected tooltip content on hover', async ({ page }) => {
    await loginAs(page, ACCOUNTS.spokaneArts)
    const schoolId = await resolveSchoolIdForAccount(ACCOUNTS.spokaneArts)
    expect(schoolId).toMatch(/^[0-9a-f-]{36}$/i)

    await gotoScenariosAndSettle(page, schoolId)

    // 1) The three legend badges render.
    const legendRow = page.getByText(/^legend:$/i).locator('xpath=..')
    await expect(legendRow, 'Legend row with badges should be visible near FPF grid').toBeVisible({ timeout: 15_000 })
    await expect(legendRow.getByText(/^meets$/i).first()).toBeVisible()
    await expect(legendRow.getByText(/^approaching$/i).first()).toBeVisible()
    await expect(legendRow.getByText(/^does not meet$/i).first()).toBeVisible()

    // 2) The `?` icon exists with aria-label="FPF legend details" and cursor-help styling.
    const legendIcon = page.locator('[aria-label="FPF legend details"]')
    await expect(legendIcon).toBeVisible()
    const iconClass = (await legendIcon.getAttribute('class')) || ''
    expect(iconClass).toMatch(/cursor-help/)

    // 3) No native `title` attribute — the custom component owns the tooltip.
    const nativeTitle = await legendIcon.getAttribute('title')
    expect(nativeTitle, '`?` icon should not carry a native title attribute anymore').toBeFalsy()

    // 4) Before hover, the tooltip panel is hidden (it stays in the DOM so the icon's
    //    aria-describedby always resolves, S4-03).
    const tooltipPanel = page.locator('[role="tooltip"]').filter({ hasText: /stage 1/i })
    await expect(tooltipPanel).toBeHidden()
    expect(await legendIcon.getAttribute('aria-describedby')).toBeTruthy()

    // 5) Hover triggers the tooltip.
    await legendIcon.hover()
    await expect(tooltipPanel).toBeVisible({ timeout: 5_000 })

    const tooltipText = (await tooltipPanel.innerText()) || ''
    expect(tooltipText.length, 'tooltip content must be non-empty').toBeGreaterThan(0)

    const lower = tooltipText.toLowerCase()
    expect(lower, 'tooltip should mention threshold semantics').toContain('threshold')
    expect(lower, 'tooltip should mention Stage 1').toContain('stage 1')
    expect(lower, 'tooltip should mention Stage 2').toContain('stage 2')
    expect(tooltipText).toMatch(/years?\s*1\s*[-–—]\s*2|year\s*1/i)
    expect(tooltipText).toMatch(/years?\s*3\+|year\s*3/i)

    // Each status label present.
    const hasAllLabels =
      /meets/i.test(tooltipText) &&
      /approach/i.test(tooltipText) &&
      /does not meet/i.test(tooltipText)
    expect(hasAllLabels, 'tooltip should reference all three status labels').toBe(true)
  })

  test('Tooltip dismisses on mouse-out', async ({ page }) => {
    await loginAs(page, ACCOUNTS.spokaneArts)
    const schoolId = await resolveSchoolIdForAccount(ACCOUNTS.spokaneArts)

    await gotoScenariosAndSettle(page, schoolId)

    const legendIcon = page.locator('[aria-label="FPF legend details"]')
    await expect(legendIcon).toBeVisible()

    const tooltipPanel = page.locator('[role="tooltip"]').filter({ hasText: /stage 1/i })

    // Hover → tooltip appears.
    await legendIcon.hover()
    await expect(tooltipPanel).toBeVisible({ timeout: 5_000 })

    // Move cursor away → tooltip disappears. Use the page body corner as a
    // neutral hover target so React sees mouseleave on the icon.
    await page.mouse.move(0, 0)
    await expect(tooltipPanel).toBeHidden({ timeout: 5_000 })

    // Keyboard: focus shows it, Escape dismisses it (WCAG 1.4.13).
    await legendIcon.focus()
    await expect(tooltipPanel).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
    await expect(tooltipPanel).toBeHidden({ timeout: 5_000 })
  })
})
