import { test, expect, ACCOUNTS, loginAs, parseCurrency, downloadCommissionExcel, readPLRowYear } from './fixtures'
import * as path from 'path'
import * as fs from 'fs'

/**
 * Suite 1 — Cross-surface state apportionment consistency (Fix 1 + Session 2 Fix 4).
 *
 * Verifies that the Y1 Authorizer Fee shown on Multi-Year, Operations, and the Commission
 * Excel P&L tab all agree within $1 — true when all three surfaces read the same engine
 * row (the engine computes the fee from the canonical `stateApportionmentBase(rev, sse)`).
 *
 * Surfaces handled:
 *  - Multi-Year:    the engine's Year 1 row (useScenario().multiYear, via runProjections).
 *  - Operations:    the same engine row's authorizer fee (useScenario().y1.operations.authorizerFee).
 *                   (Session 2 Fix 4 — previously read persisted `budget_projections`;
 *                   Phase 2 — previously re-derived from a separate legacy apportionment.)
 *  - Excel P&L:     the same engine rows, serialized to XLSX.
 *  - Dashboard Overview, Scenarios, Settings, Excel CASH FLOW: no per-line authorizer fee
 *                   exposed, so excluded by design.
 */

const ARTIFACT_DIR = path.resolve(process.cwd(), 'tests', 'session1', 'artifacts')
fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

async function captureMultiYearAuthorizerFee(page: import('@playwright/test').Page): Promise<number | null> {
  await page.goto('/dashboard/multiyear')
  await page.waitForSelector('[data-tour="multiyear-table"]', { timeout: 15_000 }).catch(() => {})
  // Find the "Authorizer Fee" row and extract Year 1 (first data column after the label).
  const row = page.locator('tr', { hasText: 'Authorizer Fee' }).first()
  await row.waitFor({ timeout: 10_000 }).catch(() => {})
  const cells = row.locator('td, th')
  const count = await cells.count()
  if (count < 2) return null
  // Column 0 = label, column 1 = Year 1 value
  const y1Text = (await cells.nth(1).innerText()).trim()
  return parseCurrency(y1Text)
}

async function captureOperationsAuthorizerFee(page: import('@playwright/test').Page): Promise<number | null> {
  await page.goto('/dashboard/operations')
  await page.waitForSelector('[data-tour="authorizer-fee"]', { timeout: 15_000 }).catch(() => {})
  // data-tour="authorizer-fee" sits on the label <div> inside the Expense cell; take its row.
  const row = page.locator('tr', { has: page.locator('[data-tour="authorizer-fee"]') }).first()
  if (await row.count() === 0) return null
  // The amount cell is the last <td>. It contains a <span> with currency text (read-only row).
  const amountCell = row.locator('td').last()
  const text = (await amountCell.innerText()).trim()
  return parseCurrency(text)
}

test.describe('Suite 1 — Cross-surface Y1 authorizer fee consistency', () => {
  for (const accountKey of ['spokaneArts', 'columbiaValley'] as const) {
    test(`${ACCOUNTS[accountKey].label} — Multi-Year, Operations, Excel P&L agree`, async ({ page }) => {
      await loginAs(page, ACCOUNTS[accountKey])

      const multiYearFee = await captureMultiYearAuthorizerFee(page)
      const operationsFee = await captureOperationsAuthorizerFee(page)

      expect(multiYearFee, 'Multi-Year should expose Y1 Authorizer Fee').not.toBeNull()
      expect(operationsFee, 'Operations should expose Authorizer Fee (for reporting)').not.toBeNull()

      // Excel P&L: trigger download from dashboard Overview, parse Year 1 cell of the
      // "Authorizer Fee" row. Year indexing: Year 0 is column 1 → yearIndex=1 means column 2.
      const xlsxPath = path.join(ARTIFACT_DIR, `${accountKey}_commission.xlsx`)
      await downloadCommissionExcel(page, '', xlsxPath)
      const excelY1 = readPLRowYear(xlsxPath, 'Authorizer Fee', 1)
      expect(excelY1, 'Excel P&L Authorizer Fee Y1 cell should be numeric').not.toBeNull()

      const my = multiYearFee as number
      const op = operationsFee as number
      const xl = excelY1 as number
      console.log(`[suite1:${accountKey}] MultiYear=$${my}  Operations=$${op}(live)  Excel=$${xl}`)

      // All three surfaces read the engine's Year 1 authorizer fee (state apportionment ×
      // authorizer_fee_pct) and must agree within $1 (rounding slack).
      expect(Math.abs(my - xl), `Multi-Year vs Excel P&L: $${my} vs $${xl}`).toBeLessThanOrEqual(1)
      expect(Math.abs(my - op), `Multi-Year vs Operations: $${my} vs $${op}`).toBeLessThanOrEqual(1)
      expect(Math.abs(op - xl), `Operations vs Excel P&L: $${op} vs $${xl}`).toBeLessThanOrEqual(1)
    })
  }
})
