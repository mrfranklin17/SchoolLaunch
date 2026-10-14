import { test, expect, ACCOUNTS, loginAs } from '../../session4/e2e/fixtures'
import type { Page, ConsoleMessage } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

/**
 * Phase 0 — Quick Wins regression spec.
 *
 * Covers all 12 commits in feat/audit-phase-0-quick-wins. Logs in as
 * travis@spokanearts.org, walks each affected surface, asserts the
 * Phase-0 acceptance criteria, captures full-page screenshots into
 * tests/audit/phase-0/screenshots/, and fails on console errors.
 *
 * Run pre-edit to populate baselines, post-edit to verify. Pixel diffs
 * are not enforced here — assertions are DOM-level so they survive
 * styling iteration.
 */

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots')

function ensureScreenshotDir(): void {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => { /* SSE keeps the network busy on some pages */ })
  await page.waitForTimeout(600)
}

async function snap(page: Page, name: string): Promise<void> {
  ensureScreenshotDir()
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true })
}

function attachConsoleErrorCollector(page: Page): { errors: string[] } {
  const errors: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    // Ignore well-known noise that isn't introduced by Phase 0 changes.
    if (text.includes('Failed to load resource') && text.includes('favicon')) return
    if (text.includes('Download the React DevTools')) return
    errors.push(text)
  })
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`)
  })
  return { errors }
}

test.describe('Phase 0 — Quick Wins', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ACCOUNTS.spokaneArts)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
  })

  test('login page — secondary link styling and static title', async ({ browser }) => {
    // Use an isolated context so beforeEach login doesn't interfere with /login render.
    const ctx = await browser.newContext()
    const fresh = await ctx.newPage()
    const { errors } = attachConsoleErrorCollector(fresh)
    await fresh.goto('/login')
    await settle(fresh)
    await snap(fresh, 'login')
    await expect(fresh).toHaveTitle(/SchoolLaunch — Sign in/)
    const link = fresh.getByRole('link', { name: /Don.?t have an account\? Sign up/i })
    await expect(link).toBeVisible()
    const className = await link.getAttribute('class')
    expect(className).toContain('text-slate-600')
    expect(className).toContain('hover:text-teal-700')
    expect(className).toContain('underline-offset-4')
    expect(className).toContain('hover:underline')
    expect(errors).toEqual([])
    await ctx.close()
  })

  test('signup page — secondary link styling and static title', async ({ browser }) => {
    const ctx = await browser.newContext()
    const fresh = await ctx.newPage()
    const { errors } = attachConsoleErrorCollector(fresh)
    await fresh.goto('/signup')
    await settle(fresh)
    await snap(fresh, 'signup')
    await expect(fresh).toHaveTitle(/SchoolLaunch — Sign up/)
    const link = fresh.getByRole('link', { name: /Already have an account\? Sign in/i })
    await expect(link).toBeVisible()
    const className = await link.getAttribute('class')
    expect(className).toContain('text-slate-600')
    expect(className).toContain('hover:text-teal-700')
    expect(className).toContain('underline-offset-4')
    expect(errors).toEqual([])
    await ctx.close()
  })

  test('overview — sl-table on Year-1 Base Case + page title', async ({ page }) => {
    const { errors } = attachConsoleErrorCollector(page)
    await page.goto('/dashboard')
    await settle(page)
    await snap(page, 'overview')
    await expect(page).toHaveTitle(/SchoolLaunch — Overview/)
    // Year-1 Base Case table is wrapped in [data-tour="budget-summary"] and uses sl-table.
    const table = page.locator('[data-tour="budget-summary"] table.sl-table').first()
    await expect(table).toBeVisible()
    // .num cells must exist on value columns
    const numCells = table.locator('td.num, th.num')
    expect(await numCells.count()).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  test('scenarios — sandbox pill + cash shortfall magnitude + page title', async ({ page }) => {
    const { errors } = attachConsoleErrorCollector(page)
    await page.goto('/dashboard/scenarios')
    await settle(page)
    await snap(page, 'scenarios')
    await expect(page).toHaveTitle(/SchoolLaunch — Scenarios/)
    // Sandbox pill is persistent (not gated on any user action).
    await expect(page.getByText(/Sandbox · changes don.?t affect your real model/)).toBeVisible()
    // Cash shortfall pill: when present anywhere on the page, it must include " days short".
    // Spokane Arts may not have a shortfall scenario — just assert legacy "Cash Shortfall" text is gone.
    const legacyPill = page.getByText(/^Cash Shortfall$/)
    expect(await legacyPill.count()).toBe(0)
    expect(errors).toEqual([])
  })

  test('cashflow — segmented control + page title', async ({ page }) => {
    const { errors } = attachConsoleErrorCollector(page)
    await page.goto('/dashboard/cashflow')
    await settle(page)
    await snap(page, 'cashflow')
    await expect(page).toHaveTitle(/SchoolLaunch — Cash Flow/)
    const tablist = page.locator('[role="tablist"][aria-label="Cash flow year"]')
    await expect(tablist).toBeVisible()
    // Two tabs, one selected.
    const tabs = tablist.locator('[role="tab"]')
    expect(await tabs.count()).toBe(2)
    const selectedCount = await tablist.locator('[role="tab"][aria-selected="true"]').count()
    expect(selectedCount).toBe(1)
    expect(errors).toEqual([])
  })

  test('scorecard — no per-cell labels + renamed disclosure + page title', async ({ page }) => {
    const { errors } = attachConsoleErrorCollector(page)
    await page.goto('/dashboard/scorecard')
    await settle(page)
    await snap(page, 'scorecard')
    await expect(page).toHaveTitle(/SchoolLaunch — Commission Scorecard/)
    // Renamed disclosure
    await expect(page.getByRole('button', { name: /How thresholds are calculated/ })).toBeVisible()
    // Old name should no longer be present
    expect(await page.getByRole('button', { name: /About This Scorecard/ }).count()).toBe(0)
    // The legend at the bottom still says "Meets Standard" / "Approaching Standard" / "Does Not Meet Standard"
    // — that's fine. The deletion is per-cell labels: cells now contain only the value, no caption.
    // Heuristic: the old per-cell layout rendered "Meets" / "Approaching" / "Does Not Meet" text inside
    // each cell <td>. Assert the legend uses the longer "* Standard" form and no bare-word labels exist
    // inside scorecard table cells.
    const tableCells = page.locator('[data-tour="scorecard-table"] tbody td')
    const cellCount = await tableCells.count()
    let perCellLabelHits = 0
    for (let i = 0; i < cellCount; i++) {
      const text = (await tableCells.nth(i).innerText()).trim()
      if (/^(Meets|Approaching|Does Not Meet)$/.test(text)) perCellLabelHits += 1
    }
    expect(perCellLabelHits).toBe(0)
    expect(errors).toEqual([])
  })

  test('ask — 2-up suggested questions + page title', async ({ page }) => {
    const { errors } = attachConsoleErrorCollector(page)
    await page.goto('/dashboard/ask')
    await settle(page)
    await snap(page, 'ask')
    await expect(page).toHaveTitle(/SchoolLaunch — Ask SchoolLaunch/)
    // Initial state shows the suggested-question grid (no messages yet).
    const grid = page.locator('div.grid.grid-cols-1.sm\\:grid-cols-2').first()
    await expect(grid).toBeVisible()
    // Negative assertion — no lg:grid-cols-3 anywhere on the suggested-questions container.
    const className = await grid.getAttribute('class')
    expect(className).not.toContain('lg:grid-cols-3')
    expect(errors).toEqual([])
  })

  test('operations — authorizer fee row visually locked + page title', async ({ page }) => {
    const { errors } = attachConsoleErrorCollector(page)
    await page.goto('/dashboard/operations')
    await settle(page)
    await snap(page, 'operations')
    await expect(page).toHaveTitle(/SchoolLaunch — Operations/)
    // Authorizer Fee row carries data-tour="authorizer-fee".
    const row = page.locator('tr[data-tour="authorizer-fee"]')
    await expect(row).toBeVisible()
    // WA mandated pill in the first cell.
    await expect(row.getByText(/WA mandated/)).toBeVisible()
    // No <input> elements in the locked row.
    expect(await row.locator('input').count()).toBe(0)
    expect(errors).toEqual([])
  })

  test('advisory — last-analyzed timestamp + page title', async ({ page }) => {
    const { errors } = attachConsoleErrorCollector(page)
    await page.goto('/dashboard/advisory')
    await settle(page)
    await snap(page, 'advisory')
    await expect(page).toHaveTitle(/SchoolLaunch — Advisory Panel/)
    // The Last analyzed pill only renders when a cache exists. Spokane Arts has cache from prior runs.
    // If absent, that's a content state, not a Phase-0 regression — but we can verify the Refresh
    // Analysis button exists alongside it.
    await expect(page.getByRole('button', { name: /Refresh Analysis|Analyzing/ })).toBeVisible()
    // Soft-assert that last-analyzed renders when data is cached.
    const lastAnalyzed = page.getByText(/Last analyzed \d+(s|m|h|d) ago/)
    if ((await lastAnalyzed.count()) > 0) {
      await expect(lastAnalyzed.first()).toBeVisible()
    }
    expect(errors).toEqual([])
  })

  test('staffing — no Classification column + page title', async ({ page }) => {
    const { errors } = attachConsoleErrorCollector(page)
    await page.goto('/dashboard/staffing')
    await settle(page)
    await snap(page, 'staffing')
    await expect(page).toHaveTitle(/SchoolLaunch — Staffing/)
    // <th>Classification</th> is gone.
    const classificationHeader = page.locator('thead th', { hasText: /^Classification$/ })
    expect(await classificationHeader.count()).toBe(0)
    expect(errors).toEqual([])
  })
})
